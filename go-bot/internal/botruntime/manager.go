package botruntime

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"ng-antd-admin/go-bot/internal/config"
	"ng-antd-admin/go-bot/internal/telegram"
)

const defaultReconcileInterval = 10 * time.Second

type botRunner interface {
	Run(context.Context) error
}

type botFactory func(config.Config, *pgxpool.Pool, *log.Logger, Target) (botRunner, error)

type Manager struct {
	cfg               config.Config
	db                *pgxpool.Pool
	logger            *log.Logger
	reconcileInterval time.Duration
	instanceID        string
	newBot            botFactory

	mu     sync.Mutex
	active map[string]*runningBot
}

type runningBot struct {
	target Target
	cancel context.CancelFunc
}

func NewManager(cfg config.Config, db *pgxpool.Pool, logger *log.Logger) (*Manager, error) {
	if strings.TrimSpace(cfg.DatabaseURL) == "" {
		return nil, errors.New("database url is required")
	}
	if db == nil {
		return nil, errors.New("database pool is required")
	}
	if logger == nil {
		logger = log.Default()
	}

	hostname, _ := os.Hostname()
	if strings.TrimSpace(hostname) == "" {
		hostname = "go-bot"
	}

	return &Manager{
		cfg:               cfg,
		db:                db,
		logger:            logger,
		reconcileInterval: defaultReconcileInterval,
		instanceID:        fmt.Sprintf("%s:%d", hostname, os.Getpid()),
		newBot:            defaultBotFactory,
		active:            map[string]*runningBot{},
	}, nil
}

func (m *Manager) Run(ctx context.Context) error {
	if err := m.ReconcileOnce(ctx); err != nil {
		m.logger.Printf("bot runtime reconcile failed: %v", err)
	}

	ticker := time.NewTicker(m.reconcileInterval)
	defer ticker.Stop()
	defer m.stopAll()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			if err := m.ReconcileOnce(ctx); err != nil {
				m.logger.Printf("bot runtime reconcile failed: %v", err)
			}
		}
	}
}

func (m *Manager) ReconcileOnce(ctx context.Context) error {
	cfg, err := config.LoadFromDatabase(ctx, config.EnvMap{"DATABASE_URL": m.cfg.DatabaseURL}, poolQueryRower{db: m.db})
	if err != nil {
		return err
	}

	agents, err := m.loadAgentBotConfigs(ctx)
	if err != nil {
		return err
	}
	targets := DesiredTargets(PlatformBotConfig{
		BotStatus:        cfg.BotStatus,
		TelegramBotToken: cfg.TelegramBotToken,
	}, agents)
	desiredKeys := make(map[string]struct{}, len(targets))
	for _, target := range targets {
		desiredKeys[RuntimeKey(target)] = struct{}{}
	}

	m.mu.Lock()
	for key, active := range m.active {
		if _, ok := desiredKeys[key]; !ok {
			active.cancel()
			delete(m.active, key)
		}
	}
	m.mu.Unlock()

	for _, target := range targets {
		if err := m.reconcileTarget(ctx, cfg, target); err != nil {
			m.logger.Printf("bot runtime target %s reconcile failed: %v", RuntimeKey(target), err)
			_ = m.writeRuntimeStatus(ctx, target, RuntimeError, PollingError, err.Error(), nil, nil)
		}
	}
	return nil
}

func (m *Manager) reconcileTarget(ctx context.Context, cfg config.Config, target Target) error {
	key := RuntimeKey(target)
	shouldRun := target.DesiredStatus == StatusEnabled && target.TokenConfigured
	if !shouldRun {
		var stoppedAt *time.Time
		if m.stopTarget(key) {
			stoppedAt = timePtr(time.Now())
		}
		status := RuntimeStopped
		polling := PollingStopped
		lastError := ""
		if target.DesiredStatus == StatusEnabled && !target.TokenConfigured {
			status = RuntimeError
			polling = PollingError
			lastError = "Telegram Bot Token 未配置"
		}
		return m.writeRuntimeStatus(ctx, target, status, polling, lastError, nil, stoppedAt)
	}

	m.mu.Lock()
	active := m.active[key]
	if active != nil && active.target.Token == target.Token {
		m.mu.Unlock()
		return m.writeRuntimeStatus(ctx, target, RuntimeRunning, PollingPolling, "", nil, nil)
	}
	if active != nil {
		active.cancel()
		delete(m.active, key)
	}
	m.mu.Unlock()

	botCfg := cfg
	botCfg.BotStatus = target.DesiredStatus
	botCfg.TelegramBotToken = target.Token
	bot, err := m.newBot(botCfg, m.db, m.logger, target)
	if err != nil {
		return err
	}

	botCtx, cancel := context.WithCancel(ctx)
	m.mu.Lock()
	m.active[key] = &runningBot{target: target, cancel: cancel}
	m.mu.Unlock()

	startedAt := time.Now()
	if err := m.writeRuntimeStatus(ctx, target, RuntimeRunning, PollingPolling, "", &startedAt, nil); err != nil {
		cancel()
		return err
	}

	go m.runBot(botCtx, key, target, bot)
	return nil
}

func (m *Manager) runBot(ctx context.Context, key string, target Target, bot botRunner) {
	err := bot.Run(ctx)
	m.mu.Lock()
	active := m.active[key]
	if active != nil && active.target.Token == target.Token {
		delete(m.active, key)
	}
	m.mu.Unlock()

	stoppedAt := time.Now()
	status := RuntimeStopped
	polling := PollingStopped
	lastError := ""
	if err != nil && !errors.Is(err, context.Canceled) {
		status = RuntimeError
		polling = PollingError
		lastError = err.Error()
	}

	writeCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if writeErr := m.writeRuntimeStatus(writeCtx, target, status, polling, lastError, nil, &stoppedAt); writeErr != nil {
		m.logger.Printf("bot runtime status write failed: %v", writeErr)
	}
}

func (m *Manager) stopTarget(key string) bool {
	m.mu.Lock()
	active := m.active[key]
	if active != nil {
		active.cancel()
		delete(m.active, key)
	}
	m.mu.Unlock()
	return active != nil
}

func (m *Manager) stopAll() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for key, active := range m.active {
		active.cancel()
		delete(m.active, key)
	}
}

func (m *Manager) loadAgentBotConfigs(ctx context.Context) ([]AgentBotConfig, error) {
	rows, err := m.db.Query(ctx, `
select c.agent_id,
       coalesce(c.bot_status, 'disabled'),
       coalesce(c.telegram_bot_token, ''),
       p.status = 'active'
from agent_bot_configs c
join agent_profiles p on p.id = c.agent_id
where c.deleted_at is null
  and p.deleted_at is null
order by c.agent_id asc`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var configs []AgentBotConfig
	for rows.Next() {
		var item AgentBotConfig
		if err := rows.Scan(
			&item.AgentID,
			&item.BotStatus,
			&item.TelegramBotToken,
			&item.AgentActive,
		); err != nil {
			return nil, err
		}
		configs = append(configs, item)
	}
	return configs, rows.Err()
}

func (m *Manager) writeRuntimeStatus(
	ctx context.Context,
	target Target,
	runtimeStatus string,
	pollingStatus string,
	lastError string,
	startedAt *time.Time,
	stoppedAt *time.Time,
) error {
	now := time.Now()
	var agentID any
	if target.Scope == ScopeAgent {
		agentID = target.AgentID
	}
	_, err := m.db.Exec(ctx, `
insert into bot_runtime_status (
  bot_scope,
  agent_id,
  desired_status,
  runtime_status,
  polling_status,
  instance_id,
  last_heartbeat_at,
  last_started_at,
  last_stopped_at,
  last_error,
  created_at,
  updated_at
) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $7, $7)
on conflict (bot_scope, coalesce(agent_id, 0))
do update set
  desired_status = excluded.desired_status,
  runtime_status = excluded.runtime_status,
  polling_status = excluded.polling_status,
  instance_id = excluded.instance_id,
  last_heartbeat_at = excluded.last_heartbeat_at,
  last_started_at = coalesce(excluded.last_started_at, bot_runtime_status.last_started_at),
  last_stopped_at = coalesce(excluded.last_stopped_at, bot_runtime_status.last_stopped_at),
  last_error = excluded.last_error,
  updated_at = excluded.updated_at`,
		target.Scope,
		agentID,
		target.DesiredStatus,
		runtimeStatus,
		pollingStatus,
		m.instanceID,
		now,
		startedAt,
		stoppedAt,
		strings.TrimSpace(lastError),
	)
	return err
}

func defaultBotFactory(cfg config.Config, db *pgxpool.Pool, logger *log.Logger, target Target) (botRunner, error) {
	if target.Scope == ScopeAgent {
		return telegram.NewAgentBot(cfg, db, logger, target.AgentID, target.Token)
	}
	return telegram.NewBot(cfg, db, logger)
}

func timePtr(value time.Time) *time.Time {
	return &value
}

type poolQueryRower struct {
	db *pgxpool.Pool
}

func (p poolQueryRower) QueryRow(ctx context.Context, sql string, args ...any) config.RowScanner {
	return p.db.QueryRow(ctx, sql, args...)
}
