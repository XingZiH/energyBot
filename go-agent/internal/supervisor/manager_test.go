// Package supervisor 管理 energybot-bot 子进程的生命周期。
//
// 设计动机（B3-T5）：
//   - go-agent 装在客户 VPS；bot 业务逻辑由独立二进制 energybot-bot 承担
//   - 前端「开启机器人」需要从主站下发指令、客户机 agent 真正 fork+exec bot
//   - 心跳需要上报 bot 状态给主站，让客户看到"在跑/崩溃/停止"
//
// 本文件：表驱动测试覆盖状态机与并发语义。
// 实际 exec.Cmd 交互在 process_exec.go（仅供生产）；
// 测试用 fakeProcessLauncher 屏蔽真实 fork。
package supervisor

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/anomalyco/energybot-agent/internal/botinfo"
)

// fakeLauncher 是 ProcessLauncher 的测试替身。
//
// 每次 Launch 产出一个 fakeProcess：记录 signal 调用、允许测试显式触发 exit。
// 设计出发点：
//   - 主线程对 Manager 调用 Start/Stop/Reload/Snapshot 观测状态
//   - 测试通过 fakeProcess.triggerExit() 模拟进程退出
type fakeLauncher struct {
	lastProc *fakeProcess
	launches int
	// 测试可以覆盖：Launch 返 err 模拟 spawn 失败
	launchErr error
}

func (l *fakeLauncher) Launch(bin string, args []string) (Process, error) {
	l.launches++
	if l.launchErr != nil {
		return nil, l.launchErr
	}
	p := &fakeProcess{
		pid:       1000 + l.launches,
		exitCh:    make(chan processExit, 1),
		signalLog: []string{},
	}
	l.lastProc = p
	return p, nil
}

type processExit struct {
	code int
	err  error
}

type fakeProcess struct {
	pid       int
	exitCh    chan processExit

	mu        sync.Mutex // 保护 signalLog/killed —— Manager.Stop 在 goroutine
	signalLog []string   // 中调 Signal/Kill，主测试 goroutine 读断言；-race 必须加锁
	killed    bool
}

func (p *fakeProcess) Pid() int { return p.pid }

func (p *fakeProcess) Signal(sig string) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.signalLog = append(p.signalLog, sig)
	return nil
}

func (p *fakeProcess) Kill() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.killed = true
	return nil
}

// wasKilled / signalsCopy —— 测试只读快照，避免外部直接读裸字段触发 race。
func (p *fakeProcess) wasKilled() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.killed
}

func (p *fakeProcess) signalsCopy() []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	out := make([]string, len(p.signalLog))
	copy(out, p.signalLog)
	return out
}

// Wait 阻塞直到 triggerExit 被调用或 ctx 取消。
func (p *fakeProcess) Wait() (int, error) {
	res := <-p.exitCh
	return res.code, res.err
}

// triggerExit 由测试调用，模拟进程退出。只能调一次。
func (p *fakeProcess) triggerExit(code int, err error) {
	p.exitCh <- processExit{code: code, err: err}
	close(p.exitCh)
}

// ----- 测试 -----

func TestManager_InitialStatus_Stopped(t *testing.T) {
	m := newManagerForTest(t, &fakeLauncher{})
	snap, err := m.Snapshot()
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if snap == nil {
		t.Fatal("expected snapshot, got nil")
	}
	if snap.Status != botinfo.BotStatusStopped {
		t.Errorf("initial status want=stopped got=%s", snap.Status)
	}
	if snap.PID != 0 {
		t.Errorf("initial pid want=0 got=%d", snap.PID)
	}
}

func TestManager_Start_TransitionsToRunning(t *testing.T) {
	launcher := &fakeLauncher{}
	m := newManagerForTest(t, launcher)

	if err := m.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	if launcher.launches != 1 {
		t.Errorf("launches want=1 got=%d", launcher.launches)
	}
	snap, _ := m.Snapshot()
	if snap.Status != botinfo.BotStatusRunning {
		t.Errorf("status after Start want=running got=%s", snap.Status)
	}
	if snap.PID == 0 {
		t.Error("pid should be set after Start")
	}
}

func TestManager_Start_Idempotent(t *testing.T) {
	launcher := &fakeLauncher{}
	m := newManagerForTest(t, launcher)
	if err := m.Start(); err != nil {
		t.Fatalf("Start1: %v", err)
	}
	if err := m.Start(); err != nil {
		t.Fatalf("Start2: %v", err)
	}
	// 第二次 Start 不应再 launch
	if launcher.launches != 1 {
		t.Errorf("launches want=1 got=%d (Start 不幂等)", launcher.launches)
	}
}

func TestManager_Start_LaunchErr_StatusError(t *testing.T) {
	launcher := &fakeLauncher{launchErr: errors.New("exec: permission denied")}
	m := newManagerForTest(t, launcher)
	err := m.Start()
	if err == nil {
		t.Fatal("expected err when launcher fails")
	}
	snap, _ := m.Snapshot()
	if snap.Status != botinfo.BotStatusError {
		t.Errorf("status after failed Start want=error got=%s", snap.Status)
	}
	if snap.LastError == "" {
		t.Error("lastError should be set on launch failure")
	}
}

func TestManager_Stop_WhenStopped_NoOp(t *testing.T) {
	launcher := &fakeLauncher{}
	m := newManagerForTest(t, launcher)
	// 未启动时 Stop 应无副作用
	if err := m.Stop(); err != nil {
		t.Fatalf("Stop on stopped: %v", err)
	}
	if launcher.launches != 0 {
		t.Errorf("launches want=0 got=%d", launcher.launches)
	}
}

func TestManager_Stop_WhenRunning_SendsSigterm(t *testing.T) {
	launcher := &fakeLauncher{}
	m := newManagerForTest(t, launcher)
	if err := m.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	proc := launcher.lastProc

	// Stop 会阻塞等 Wait；开一个 goroutine 模拟进程收到 SIGTERM 后 500ms 退出
	go func() {
		// 等 Stop 发送 SIGTERM（通常 <50ms）
		time.Sleep(20 * time.Millisecond)
		proc.triggerExit(0, nil)
	}()

	if err := m.Stop(); err != nil {
		t.Fatalf("Stop: %v", err)
	}
	sigs := proc.signalsCopy()
	if len(sigs) == 0 || sigs[0] != "SIGTERM" {
		t.Errorf("signalLog want=[SIGTERM] got=%v", sigs)
	}
	if proc.wasKilled() {
		t.Error("Kill should not be called on graceful exit")
	}
	snap, _ := m.Snapshot()
	if snap.Status != botinfo.BotStatusStopped {
		t.Errorf("status after Stop want=stopped got=%s", snap.Status)
	}
}

func TestManager_Stop_GraceTimeout_ForcesKill(t *testing.T) {
	launcher := &fakeLauncher{}
	m := newManagerForTest(t, launcher)
	// 用极短超时便于测试
	m.stopGrace = 30 * time.Millisecond
	if err := m.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	proc := launcher.lastProc

	// 不调 triggerExit —— 模拟进程拒绝 SIGTERM
	// Stop 应等 stopGrace 后 Kill()，Kill 后再等 triggerExit 才返回
	done := make(chan error, 1)
	go func() { done <- m.Stop() }()

	// 等 Kill 调用（通常在 stopGrace 到期后）
	time.Sleep(80 * time.Millisecond)
	if !proc.wasKilled() {
		t.Fatal("Kill should be called after grace timeout")
	}
	// 模拟 Kill 后进程退出
	proc.triggerExit(-1, errors.New("signal: killed"))

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("Stop: %v", err)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("Stop did not return within 500ms after exit")
	}
	snap, _ := m.Snapshot()
	if snap.Status != botinfo.BotStatusStopped {
		t.Errorf("status after kill want=stopped got=%s", snap.Status)
	}
}

func TestManager_UnexpectedExit_TransitionsToError(t *testing.T) {
	launcher := &fakeLauncher{}
	m := newManagerForTest(t, launcher)
	if err := m.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	proc := launcher.lastProc

	// 模拟进程自己崩了（非 Stop 触发）
	proc.triggerExit(137, errors.New("signal: killed by OOM"))

	// 等状态转换（后台 goroutine 收到 Wait）
	waitFor(t, 200*time.Millisecond, func() bool {
		snap, _ := m.Snapshot()
		return snap.Status == botinfo.BotStatusError
	})
	snap, _ := m.Snapshot()
	if snap.Status != botinfo.BotStatusError {
		t.Errorf("status after crash want=error got=%s", snap.Status)
	}
	if snap.LastError == "" {
		t.Error("lastError should record crash reason")
	}
}

func TestManager_Reload_StopsThenStarts(t *testing.T) {
	launcher := &fakeLauncher{}
	m := newManagerForTest(t, launcher)
	if err := m.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	proc1 := launcher.lastProc

	// 开异步让 proc1 响应 SIGTERM
	go func() {
		time.Sleep(20 * time.Millisecond)
		proc1.triggerExit(0, nil)
	}()

	if err := m.Reload(); err != nil {
		t.Fatalf("Reload: %v", err)
	}
	if launcher.launches != 2 {
		t.Errorf("launches after Reload want=2 got=%d", launcher.launches)
	}
	if launcher.lastProc == proc1 {
		t.Error("Reload should spawn a new process")
	}
	snap, _ := m.Snapshot()
	if snap.Status != botinfo.BotStatusRunning {
		t.Errorf("status after Reload want=running got=%s", snap.Status)
	}
}

func TestManager_Snapshot_IncludesUptime(t *testing.T) {
	launcher := &fakeLauncher{}
	// 用可控 clock
	var nowCall int64 = 1_700_000_000 // arbitrary unix sec
	clock := func() time.Time { return time.Unix(nowCall, 0) }
	m := newManagerWithClock(t, launcher, clock)
	if err := m.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	nowCall += 300 // 模拟 300 秒过去
	snap, _ := m.Snapshot()
	if snap.UptimeSeconds != 300 {
		t.Errorf("uptime want=300 got=%d", snap.UptimeSeconds)
	}
}

// ---------- helpers ----------

func newManagerForTest(t *testing.T, launcher ProcessLauncher) *Manager {
	t.Helper()
	return newManagerWithClock(t, launcher, func() time.Time { return time.Now() })
}

func newManagerWithClock(t *testing.T, launcher ProcessLauncher, now func() time.Time) *Manager {
	t.Helper()
	m := &Manager{
		launcher:   launcher,
		binPath:    "/fake/energybot-bot",
		stopGrace:  500 * time.Millisecond,
		now:        now,
		logger:     discardLogger{},
		status:     botinfo.BotStatusStopped,
		cancelWait: func() {},
	}
	t.Cleanup(func() {
		// 清理后台 goroutine
		_ = m.shutdown(context.Background())
	})
	return m
}

func waitFor(t *testing.T, timeout time.Duration, pred func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if pred() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("condition not met within %v", timeout)
}

type discardLogger struct{}

func (discardLogger) Printf(string, ...any) {}
