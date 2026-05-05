// Package supervisor 在 go-agent 内管理 energybot-bot 子进程的生命周期。
//
// 设计要点：
//   - Manager 提供 Start / Stop / Reload / Snapshot 4 个公共方法
//   - Process 抽象 + ProcessLauncher 抽象 让 exec.Cmd 与逻辑解耦，便于单测
//   - 每个进程实例在后台开 watch goroutine 等 Wait 返回，捕获崩溃
//   - 状态机：stopped → starting → running → (stopping → stopped) | error
//   - Snapshot 实现 botinfo.Provider 接口，供心跳采集使用
//
// 进程退出语义：
//   - 由 Stop() 主动停 → 状态置 stopped，与 exit code 无关
//   - 进程自己崩 → 状态置 error，记录 lastError
//   - Reload 内部先 Stop 再 Start，watch goroutine 知道是预期退出（stoppingFlag）
package supervisor

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/anomalyco/energybot-agent/internal/botinfo"
)

// Process 是 supervisor 启动的子进程的最小抽象，便于测试注入 fake。
type Process interface {
	Pid() int
	Signal(sig string) error // sig: "SIGTERM" | "SIGHUP"
	Kill() error
	Wait() (exitCode int, err error)
}

// ProcessLauncher 抽象 fork+exec；生产实现见 process_exec.go。
// env 为子进程完整环境变量（key=value 列表）；传 nil 表示继承父进程。
type ProcessLauncher interface {
	Launch(bin string, args []string, env []string) (Process, error)
}

// Logger 是 manager 内部用的最小日志接口（与心跳/客户端模块同款）。
type Logger interface {
	Printf(format string, args ...any)
}

// Manager 是单 bot 子进程的生命周期管家。线程安全。
type Manager struct {
	mu        sync.Mutex
	launcher  ProcessLauncher
	binPath   string
	args      []string
	stopGrace time.Duration
	now       func() time.Time
	logger    Logger

	// 子进程启动时注入的 env（key=value 列表）；nil/空切片表示继承父进程。
	// 由 SetEnv 设置，Start 时拷贝传给 launcher。T11 为让 bot 知道 DATABASE_URL
	// （SQLite 路径）等配置，agent 启动时会构造这个切片。
	env []string

	// 状态
	status        botinfo.BotStatus
	proc          Process // running 时非 nil
	startedAt     time.Time
	lastError     string
	configVersion int

	// 用于优雅退出 / Reload 协调
	stopping   bool          // true 时 watch goroutine 不要把退出当成"崩溃"
	cancelWait func()        // 关闭 watch goroutine
	waitDone   chan struct{} // watch goroutine 退出信号；nil 表示未运行
}

// NewManager 构造 Manager。binPath 是 energybot-bot 二进制绝对路径。
func NewManager(launcher ProcessLauncher, binPath string, args []string, logger Logger) *Manager {
	return &Manager{
		launcher:   launcher,
		binPath:    binPath,
		args:       args,
		stopGrace:  10 * time.Second,
		now:        time.Now,
		logger:     logger,
		status:     botinfo.BotStatusStopped,
		cancelWait: func() {},
	}
}

// Start 异步启动 bot 子进程。已 running 时幂等返 nil。
//
// 返回时进程状态可能仍是 starting；调用方需要等心跳 / Snapshot 看准实状态。
// （为保持简单，本实现 Launch 成功就直接置 running——大部分 launcher 在
//  Launch 返回时进程已 spawn 完毕。后续若需要 readiness probe 再加 starting 阶段。）
func (m *Manager) Start() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.status == botinfo.BotStatusRunning || m.status == botinfo.BotStatusStarting {
		return nil
	}
	proc, err := m.launcher.Launch(m.binPath, m.args, m.env)
	if err != nil {
		m.status = botinfo.BotStatusError
		m.lastError = truncate(fmt.Sprintf("launch: %v", err), 500)
		return err
	}
	m.proc = proc
	m.status = botinfo.BotStatusRunning
	m.startedAt = m.now()
	m.lastError = ""
	m.stopping = false

	// 后台 watch：等进程退出，转换状态
	waitDone := make(chan struct{})
	m.waitDone = waitDone
	ctx, cancel := context.WithCancel(context.Background())
	m.cancelWait = cancel
	go m.watch(ctx, proc, waitDone)
	return nil
}

// Stop 优雅停 bot：SIGTERM；超过 stopGrace 还没退则 Kill()。
// 已 stopped 时幂等返 nil。
func (m *Manager) Stop() error {
	m.mu.Lock()
	if m.status == botinfo.BotStatusStopped {
		m.mu.Unlock()
		return nil
	}
	if m.proc == nil {
		// 状态是 error 但没有 proc（Start 时 launch 直接失败）
		m.status = botinfo.BotStatusStopped
		m.mu.Unlock()
		return nil
	}
	proc := m.proc
	waitDone := m.waitDone
	m.stopping = true
	grace := m.stopGrace
	m.mu.Unlock()

	if err := proc.Signal("SIGTERM"); err != nil {
		m.logger.Printf("supervisor: SIGTERM failed: %v", err)
	}

	timer := time.NewTimer(grace)
	defer timer.Stop()
	select {
	case <-waitDone:
		// 进程已退出
	case <-timer.C:
		m.logger.Printf("supervisor: grace timeout, killing pid=%d", proc.Pid())
		if err := proc.Kill(); err != nil {
			m.logger.Printf("supervisor: Kill failed: %v", err)
		}
		<-waitDone // 仍等 Wait 返回
	}

	m.mu.Lock()
	m.status = botinfo.BotStatusStopped
	m.proc = nil
	m.mu.Unlock()
	return nil
}

// Reload 让 bot 重新加载配置：当前实现为 stop-then-start。
// 后续可优化为 SIGHUP，但 bot 端需先实现 SIGHUP handler。
func (m *Manager) Reload() error {
	if err := m.Stop(); err != nil {
		return fmt.Errorf("reload stop: %w", err)
	}
	if err := m.Start(); err != nil {
		return fmt.Errorf("reload start: %w", err)
	}
	return nil
}

// Snapshot 实现 botinfo.Provider —— 心跳每 30s 调一次。
func (m *Manager) Snapshot() (*botinfo.BotInfo, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	info := &botinfo.BotInfo{
		Status:        m.status,
		ConfigVersion: m.configVersion,
		LastError:     m.lastError,
	}
	if m.proc != nil {
		info.PID = m.proc.Pid()
	}
	if m.status == botinfo.BotStatusRunning && !m.startedAt.IsZero() {
		info.UptimeSeconds = int64(m.now().Sub(m.startedAt).Seconds())
	}
	return info, nil
}

// SetConfigVersion 由外部（heartbeat 或 reload 触发器）调用，
// 在 bot 端实际接受 config 后记录其版本号供下一次 Snapshot 上报。
func (m *Manager) SetConfigVersion(v int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.configVersion = v
}

// SetEnv 设置下次 Start 时注入给子进程的环境变量。
// 传 nil 或空切片表示让子进程继承父进程 env（默认行为）。
// 已 running 的进程不受影响——下次 Reload / Stop+Start 才生效。
//
// 典型用法：agent 启动时调 SetEnv([]string{"DATABASE_URL=sqlite:///..."})
// 让 bot 能找到 SQLite；后续 applyConfig 往 SQLite 表写具体 token/API key 等。
func (m *Manager) SetEnv(env []string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	// 拷贝防止外部修改影响 Manager 状态
	cp := make([]string, len(env))
	copy(cp, env)
	m.env = cp
}

// shutdown 用于测试 cleanup：取消 watch goroutine 并等其退出。
// 生产路径不应直接调用——agent 关停时调 Stop() 即可。
func (m *Manager) shutdown(ctx context.Context) error {
	m.mu.Lock()
	cancel := m.cancelWait
	waitDone := m.waitDone
	m.mu.Unlock()
	cancel()
	if waitDone == nil {
		return nil
	}
	select {
	case <-waitDone:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(2 * time.Second):
		return errors.New("shutdown: watch goroutine did not exit")
	}
}

// watch 在后台等 proc.Wait 返回；非 stopping 时退出 → 状态转 error。
func (m *Manager) watch(ctx context.Context, proc Process, done chan struct{}) {
	defer close(done)

	type waitResult struct {
		code int
		err  error
	}
	wch := make(chan waitResult, 1)
	go func() {
		c, e := proc.Wait()
		wch <- waitResult{code: c, err: e}
	}()

	select {
	case res := <-wch:
		m.mu.Lock()
		stopping := m.stopping
		// 仅当还指向当前 proc 时才更新状态——避免 Reload 后误覆盖新进程状态
		isCurrent := m.proc == proc
		if stopping || !isCurrent {
			m.mu.Unlock()
			return
		}
		// 非预期退出
		m.status = botinfo.BotStatusError
		if res.err != nil {
			m.lastError = truncate(fmt.Sprintf("exit: %v (code=%d)", res.err, res.code), 500)
		} else {
			m.lastError = truncate(fmt.Sprintf("exit code %d", res.code), 500)
		}
		m.proc = nil
		errSnapshot := m.lastError // 锁内快照避免锁外读 race
		m.mu.Unlock()
		m.logger.Printf("supervisor: bot exited unexpectedly: %s", errSnapshot)
	case <-ctx.Done():
		// shutdown 路径
		return
	}
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max]
}
