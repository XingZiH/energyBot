package botruntime

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/anomalyco/energybot-bot/internal/config"
	"github.com/anomalyco/energybot-bot/internal/telegram"
)

const defaultReconcileInterval = 10 * time.Second

type botRunner interface {
	Run(context.Context) error
}

type botFactory func(config.Config, *sql.DB, *log.Logger, Target) (botRunner, error)

type Manager struct {
	cfg               config.Config
	db                *sql.DB
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

func NewManager(cfg config.Config, db *sql.DB, logger *log.Logger) (*Manager, error) {
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
			m.logRuntimeStatus(target, RuntimeError, PollingError, err.Error(), nil, nil)
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
		m.logRuntimeStatus(target, status, polling, lastError, nil, stoppedAt)
		return nil
	}

	m.mu.Lock()
	active := m.active[key]
	if active != nil && active.target.Token == target.Token {
		m.mu.Unlock()
		m.logRuntimeStatus(target, RuntimeRunning, PollingPolling, "", nil, nil)
		return nil
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
	m.logRuntimeStatus(target, RuntimeRunning, PollingPolling, "", &startedAt, nil)

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

	m.logRuntimeStatus(target, status, polling, lastError, nil, &stoppedAt)
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

// loadAgentBotConfigs 在 B3 客户机单 agent 视角下：
// 返回空切片——bot 只有唯一的 Platform target（从 energy_platform_config 单例派生）。
// bot_config 表内容（加密 token、welcome 文案等）由 T5 Bot 启动时单独读取。
func (m *Manager) loadAgentBotConfigs(ctx context.Context) ([]AgentBotConfig, error) {
	return nil, nil
}

// logRuntimeStatus 客户机 bot 不入库 bot_runtime_status，只打日志。
// 真实状态通过 go-agent 心跳扩展 bot 字段上报主站（T3 实现）。
func (m *Manager) logRuntimeStatus(
	target Target,
	runtimeStatus string,
	pollingStatus string,
	lastError string,
	startedAt *time.Time,
	stoppedAt *time.Time,
) {
	msg := fmt.Sprintf(
		"bot runtime status: key=%s desired=%s runtime=%s polling=%s instance=%s",
		RuntimeKey(target), target.DesiredStatus, runtimeStatus, pollingStatus, m.instanceID,
	)
	if startedAt != nil {
		msg += fmt.Sprintf(" started=%s", startedAt.Format(time.RFC3339))
	}
	if stoppedAt != nil {
		msg += fmt.Sprintf(" stopped=%s", stoppedAt.Format(time.RFC3339))
	}
	if strings.TrimSpace(lastError) != "" {
		msg += fmt.Sprintf(" error=%q", lastError)
	}
	m.logger.Print(msg)
}

func defaultBotFactory(cfg config.Config, db *sql.DB, logger *log.Logger, target Target) (botRunner, error) {
	if target.Scope == ScopeAgent {
		return telegram.NewAgentBot(cfg, db, logger, target.AgentID, target.Token)
	}
	return telegram.NewBot(cfg, db, logger)
}

func timePtr(value time.Time) *time.Time {
	return &value
}

type poolQueryRower struct {
	db *sql.DB
}

func (p poolQueryRower) QueryRow(ctx context.Context, sql string, args ...any) config.RowScanner {
	return p.db.QueryRowContext(ctx, sql, args...)
}
