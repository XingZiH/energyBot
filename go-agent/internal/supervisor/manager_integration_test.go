//go:build integration

// Package supervisor 集成测试：用真实的 ExecLauncher + os/exec 子进程
// 验证 Manager 与 OS 进程信号之间的端到端行为。
//
// 与 manager_test.go（fakeLauncher 单测）的区别：
//   - 单测：覆盖 Manager 状态机所有分支，但完全不碰 OS 进程
//   - 本文件：少量用例，只验证 ExecLauncher 真的把 SIGTERM/SIGKILL 发对了，
//     stdout/stderr pump 真的工作，Wait 的 exitCode 真的提取出来
//
// 跑法：
//
//	go test -tags=integration -count=1 -v ./internal/supervisor/...
//
// 不带 -tags=integration 时本文件被排除，CI 默认套件不受影响。
//
// 平台：依赖 /bin/sh /bin/sleep /usr/bin/true，darwin + linux 都满足。
// 不依赖 docker / 真实 bot 二进制，纯本地秒级跑完。

package supervisor

import (
	"log"
	"os"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/anomalyco/energybot-agent/internal/botinfo"
)

// syscallSig0 返回 syscall.Signal(0)——unix 探活信号（不实际投递，只检查
// 进程是否存在且我们有权信号它）。darwin / linux 都支持。
func syscallSig0() os.Signal {
	return syscall.Signal(0)
}

// stdLogger 把测试期间的 logger 输出转 t.Log，方便排障。
type tLogger struct {
	t *testing.T
}

func (l tLogger) Printf(format string, args ...any) {
	l.t.Logf(format, args...)
}

// 给一个 default logger 兜底——这里用 stderr 而非 manager_test.go 里的
// discardLogger（同包共享），以便在 -v 失败时能看到子进程输出。
func integLogger() Logger {
	return log.New(os.Stderr, "[integ] ", log.LstdFlags)
}

func newRealManager(t *testing.T, bin string, args []string) *Manager {
	t.Helper()
	launcher := NewExecLauncher(integLogger())
	m := NewManager(launcher, bin, args, tLogger{t})
	// 单测保留 10s 默认；集成测试中 SIGTERM 路径希望 200ms 内收到退出
	m.stopGrace = 200 * time.Millisecond
	return m
}

// snapshotOrFatal 给 Snapshot 包一层便捷 helper——Snapshot 返 error 仅当
// Manager 内部状态非法（健全性用），集成测试里都不应出错；出错直接 t.Fatal。
func snapshotOrFatal(t *testing.T, m *Manager) *botinfo.BotInfo {
	t.Helper()
	snap, err := m.Snapshot()
	if err != nil {
		t.Fatalf("Snapshot: %v", err)
	}
	if snap == nil {
		t.Fatalf("Snapshot returned nil")
	}
	return snap
}

// ---------- 用例 1：Start 一个真实 sleep 进程，Snapshot 能拿到 PID ----------

func TestIntegration_StartSpawnsRealProcessAndReportsPid(t *testing.T) {
	m := newRealManager(t, "/bin/sleep", []string{"30"})
	defer func() {
		if err := m.Stop(); err != nil {
			t.Logf("teardown Stop: %v", err)
		}
	}()

	if err := m.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}

	// 让 cmd.Start 完成、watch goroutine 就绪
	time.Sleep(50 * time.Millisecond)

	snap := snapshotOrFatal(t, m)
	if snap.Status != botinfo.BotStatusRunning {
		t.Fatalf("expected running, got %s", snap.Status)
	}
	if snap.PID <= 0 {
		t.Fatalf("expected positive PID, got %d", snap.PID)
	}
	// /proc 在 darwin 上不存在；用 os.FindProcess + Signal(0) 探活，跨平台。
	proc, err := os.FindProcess(snap.PID)
	if err != nil {
		t.Fatalf("FindProcess(%d): %v", snap.PID, err)
	}
	if err := proc.Signal(syscallSig0()); err != nil {
		t.Fatalf("Signal(0) on real PID %d: %v", snap.PID, err)
	}
}

// ---------- 用例 2：Stop 发 SIGTERM，进程秒级退出，状态归 stopped ----------

func TestIntegration_StopSendsSIGTERMAndProcessExitsCleanly(t *testing.T) {
	// /bin/sleep 默认 trap SIGTERM 后立即退出
	m := newRealManager(t, "/bin/sleep", []string{"30"})
	if err := m.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	pid := snapshotOrFatal(t, m).PID
	if pid <= 0 {
		t.Fatalf("PID should be set after Start")
	}

	stopErr := make(chan error, 1)
	go func() { stopErr <- m.Stop() }()

	select {
	case err := <-stopErr:
		if err != nil {
			t.Fatalf("Stop returned err: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Stop did not return within 2s; SIGTERM not honored?")
	}

	snap := snapshotOrFatal(t, m)
	if snap.Status != botinfo.BotStatusStopped {
		t.Errorf("expected stopped, got %s (lastError=%q)", snap.Status, snap.LastError)
	}

	// 真实进程应已不存在：os.FindProcess 在 unix 上总成功，用 Signal(0) 探活
	proc, _ := os.FindProcess(pid)
	if err := proc.Signal(syscallSig0()); err == nil {
		t.Errorf("PID %d still alive after Stop", pid)
	}
}

// ---------- 用例 3：忽略 SIGTERM 的进程触发 grace 超时走 SIGKILL ----------

func TestIntegration_StopTimesOutAndForceKillsStubbornProcess(t *testing.T) {
	// 关键 1：sh 在 -c 模式下若最后一条命令是 'sleep 30' 会 exec 替换成 sleep
	// 自身，trap 失效；改用「trap + 无限循环」迫使 shell 保留进程身份。
	// 关键 2：trap '' TERM 是 shell builtin，cmd.Start 返回时 trap 尚未执行；
	// Start 后必须 sleep 让 sh 解析并装好 trap 才能 Stop，否则 SIGTERM
	// 抢在 trap 之前到达，shell 默认行为是终止——race 输了就测不到 grace 路径。
	script := `trap '' TERM; while :; do sleep 0.05; done`
	m := newRealManager(t, "/bin/sh", []string{"-c", script})
	m.stopGrace = 300 * time.Millisecond // 留足时间观测 grace 超时边界

	if err := m.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	// 等 trap 装好——150ms 在 darwin/linux 上经验值绰绰有余
	time.Sleep(150 * time.Millisecond)
	pid := snapshotOrFatal(t, m).PID

	t0 := time.Now()
	if err := m.Stop(); err != nil {
		t.Fatalf("Stop returned err: %v", err)
	}
	elapsed := time.Since(t0)

	// 应该 ≥ stopGrace（300ms）但 < 1.5s（一个宽松上限避免 flaky）
	if elapsed < 300*time.Millisecond {
		t.Errorf("Stop returned in %v, expected ≥ stopGrace 300ms", elapsed)
	}
	if elapsed > 1500*time.Millisecond {
		t.Errorf("Stop took %v, expected < 1.5s after SIGKILL", elapsed)
	}

	snap := snapshotOrFatal(t, m)
	if snap.Status != botinfo.BotStatusStopped {
		t.Errorf("status=%s lastError=%q after force-kill", snap.Status, snap.LastError)
	}

	// 真进程应已被 SIGKILL 收割
	proc, _ := os.FindProcess(pid)
	if err := proc.Signal(syscallSig0()); err == nil {
		t.Errorf("PID %d still alive after force kill", pid)
	}
}

// ---------- 用例 4：进程自己崩（exit 1）被 watch goroutine 捕获为 error ----------

func TestIntegration_ProcessSelfExitNonZeroBecomesError(t *testing.T) {
	// /bin/sh -c 'exit 7' —— 立即以非 0 退出
	m := newRealManager(t, "/bin/sh", []string{"-c", "exit 7"})

	if err := m.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}

	// watch goroutine 异步捕获崩溃；轮询直到状态变 error 或超时
	if !waitForStatus(m, botinfo.BotStatusError, time.Second) {
		snap := snapshotOrFatal(t, m)
		t.Fatalf("expected status=error within 1s, got status=%s lastError=%q",
			snap.Status, snap.LastError)
	}
	snap := snapshotOrFatal(t, m)
	if snap.LastError == "" {
		t.Errorf("expected non-empty lastError after self-exit")
	}
}

// ---------- 用例 5：Reload = Stop + Start，新 PID ≠ 旧 PID ----------

func TestIntegration_ReloadSpawnsNewProcessWithDifferentPid(t *testing.T) {
	m := newRealManager(t, "/bin/sleep", []string{"30"})
	defer func() { _ = m.Stop() }()

	if err := m.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	oldPid := snapshotOrFatal(t, m).PID

	if err := m.Reload(); err != nil {
		t.Fatalf("Reload: %v", err)
	}

	// Reload 内部串行 Stop + Start，返回时新进程应已 running
	snap := snapshotOrFatal(t, m)
	if snap.Status != botinfo.BotStatusRunning {
		t.Errorf("after Reload status=%s, expected running", snap.Status)
	}
	if snap.PID == oldPid {
		t.Errorf("Reload should yield new PID; got same %d", oldPid)
	}
	if snap.PID <= 0 {
		t.Errorf("new PID should be positive, got %d", snap.PID)
	}
}

// ---------- 用例 6：SetConfigVersion 透传到 Snapshot ----------

func TestIntegration_SetConfigVersionPropagatesToSnapshot(t *testing.T) {
	m := newRealManager(t, "/bin/sleep", []string{"5"})
	defer func() { _ = m.Stop() }()

	m.SetConfigVersion(42)
	if err := m.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	snap := snapshotOrFatal(t, m)
	if snap.ConfigVersion != 42 {
		t.Errorf("ConfigVersion=%d, want 42", snap.ConfigVersion)
	}
}

// ---------- 用例 7：并发 Start 幂等，不会 spawn 第二个进程 ----------

func TestIntegration_ConcurrentStartIsIdempotent(t *testing.T) {
	m := newRealManager(t, "/bin/sleep", []string{"30"})
	defer func() { _ = m.Stop() }()

	const N = 10
	var wg sync.WaitGroup
	wg.Add(N)
	for i := 0; i < N; i++ {
		go func() {
			defer wg.Done()
			_ = m.Start()
		}()
	}
	wg.Wait()

	snap := snapshotOrFatal(t, m)
	if snap.Status != botinfo.BotStatusRunning {
		t.Errorf("status=%s after concurrent Start", snap.Status)
	}
	if snap.PID <= 0 {
		t.Errorf("PID=%d invalid", snap.PID)
	}
	// 难以直接验证「只 spawn 了 1 次」——但 Manager.proc 单字段保证最多 1 个；
	// 此处主要验证不会出 runtime panic / race（go test -race 时尤其有意义）
}

// ---------- 工具 ----------

// waitForStatus 轮询 Snapshot 直到 status 匹配，或超时返回 false。
// 忽略 Snapshot 的 err——进程 spawn 后内部状态应总合法；出错视为未达状态。
func waitForStatus(m *Manager, want botinfo.BotStatus, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		snap, err := m.Snapshot()
		if err == nil && snap != nil && snap.Status == want {
			return true
		}
		time.Sleep(20 * time.Millisecond)
	}
	return false
}
