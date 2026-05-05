package client

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"github.com/anomalyco/energybot-agent/internal/botinfo"
	"github.com/anomalyco/energybot-agent/internal/host"
	"github.com/anomalyco/energybot-agent/internal/jsonrpc"
)

// stubCollector 是 heartbeat 单元测试专用 Collector；
// 通过可注入的 sampleFn 控制第 N 次调用返值，允许模拟失败分支。
// 刻意与 client_test.go 里的 fakeCollector 区分，避免耦合。
type stubCollector struct {
	mu       sync.Mutex
	calls    int
	hello    host.HelloInfo
	sampleFn func(call int) (host.Metrics, error)
}

func (s *stubCollector) Hello() (host.HelloInfo, error) {
	return s.hello, nil
}

func (s *stubCollector) Sample() (host.Metrics, error) {
	s.mu.Lock()
	s.calls++
	n := s.calls
	fn := s.sampleFn
	s.mu.Unlock()
	if fn != nil {
		return fn(n)
	}
	return host.Metrics{}, nil
}

func (s *stubCollector) callCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.calls
}

// stubSender 是 heartbeat 单元测试专用 Sender；记录每次入参，
// 可注入 sendFn 控制返错路径。
//
// ready 字段用于模拟 Client.Ready() 语义：默认构造用 newStubSender(true) 返
// 已 closed channel，让 heartbeat 测试跟旧行为等价；改 closed=false 构造开着
// 的 channel，用于验证 heartbeat 在 ready 前不 tick。
type stubSender struct {
	mu       sync.Mutex
	calls    []host.Metrics
	botCalls []*botinfo.BotInfo
	sendFn   func(call int, m host.Metrics) error
	ready    chan struct{}
}

// newStubSender 构造 stubSender。readyClosed=true 表示"已进入 ready 状态"，
// 这是绝大多数 heartbeat 测试的默认前提。
func newStubSender(readyClosed bool) *stubSender {
	ch := make(chan struct{})
	if readyClosed {
		close(ch)
	}
	return &stubSender{ready: ch}
}

func (s *stubSender) Ready() <-chan struct{} {
	return s.ready
}

func (s *stubSender) SendHeartbeat(m host.Metrics, bi *botinfo.BotInfo) error {
	s.mu.Lock()
	s.calls = append(s.calls, m)
	s.botCalls = append(s.botCalls, bi)
	n := len(s.calls)
	fn := s.sendFn
	s.mu.Unlock()
	if fn != nil {
		return fn(n, m)
	}
	return nil
}

func (s *stubSender) callCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.calls)
}

func (s *stubSender) snapshot() []host.Metrics {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]host.Metrics, len(s.calls))
	copy(out, s.calls)
	return out
}

// botSnapshot 返回所有 tick 中 sender 收到的 bot 参数，用于验证
// heartbeat 是否正确将 provider.Snapshot() 的结果透传给 client。
func (s *stubSender) botSnapshot() []*botinfo.BotInfo {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]*botinfo.BotInfo, len(s.botCalls))
	copy(out, s.botCalls)
	return out
}

// stubBotProvider 是 botinfo.Provider 的测试桩。
//
// snapshotFn 返 nil 时走默认 (nil, nil)；想测「agent 管理 bot 但未就绪」可注入
// 返 &BotInfo{Status: BotStatusUnknown}, nil 的 fn。
type stubBotProvider struct {
	mu         sync.Mutex
	calls      int
	snapshotFn func() (*botinfo.BotInfo, error)
}

func (p *stubBotProvider) Snapshot() (*botinfo.BotInfo, error) {
	p.mu.Lock()
	p.calls++
	fn := p.snapshotFn
	p.mu.Unlock()
	if fn != nil {
		return fn()
	}
	return nil, nil
}

func (p *stubBotProvider) callCount() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.calls
}

// --- Case 1: NewHeartbeat 必填项校验 ---

func TestHeartbeat_New_RequiresSender(t *testing.T) {
	_, err := NewHeartbeat(HeartbeatConfig{
		Collector: &stubCollector{},
	})
	if err == nil {
		t.Fatal("期望 err non-nil，缺 Sender 应报错")
	}
	if !strings.Contains(err.Error(), "Sender") {
		t.Fatalf("err 应提及 Sender，实际: %v", err)
	}
}

func TestHeartbeat_New_RequiresCollector(t *testing.T) {
	_, err := NewHeartbeat(HeartbeatConfig{
		Sender: newStubSender(true),
	})
	if err == nil {
		t.Fatal("期望 err non-nil，缺 Collector 应报错")
	}
	if !strings.Contains(err.Error(), "Collector") {
		t.Fatalf("err 应提及 Collector，实际: %v", err)
	}
}

// --- Case 3: Interval 默认 30s ---

func TestHeartbeat_New_DefaultsInterval30s(t *testing.T) {
	hb, err := NewHeartbeat(HeartbeatConfig{
		Sender:    newStubSender(true),
		Collector: &stubCollector{},
	})
	if err != nil {
		t.Fatalf("NewHeartbeat 不应报错: %v", err)
	}
	if hb.interval != 30*time.Second {
		t.Fatalf("默认 interval 应 30s，实际 %v", hb.interval)
	}
}

// --- Case 4: 每 tick 正确调用 Sender 并传递 Collector 返值 ---

func TestHeartbeat_Run_TickCallsSender(t *testing.T) {
	want := host.Metrics{
		UptimeSeconds: 100,
		CPUPercent:    5.5,
		MemUsedBytes:  2048,
		MemTotalBytes: 8192,
		Loadavg1:      1.23,
	}
	col := &stubCollector{
		sampleFn: func(_ int) (host.Metrics, error) {
			return want, nil
		},
	}
	sender := newStubSender(true)

	hb, err := NewHeartbeat(HeartbeatConfig{
		Sender:    sender,
		Collector: col,
		Interval:  20 * time.Millisecond,
		Logger:    quietLogger(),
	})
	if err != nil {
		t.Fatalf("NewHeartbeat: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	runDone := make(chan error, 1)
	go func() { runDone <- hb.Run(ctx) }()

	// 100ms / 20ms ≈ 5 次，留 3 次下限容纳调度抖动。
	waitFor(t, 500*time.Millisecond, func() bool {
		return sender.callCount() >= 3
	}, "sender 未被调用足够次数")

	cancel()
	select {
	case err := <-runDone:
		if err != nil {
			t.Fatalf("Run 应返 nil，实际: %v", err)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("Run 没在 ctx cancel 后退出")
	}

	for i, got := range sender.snapshot() {
		if got != want {
			t.Fatalf("第 %d 次 metrics 不匹配: got %+v want %+v", i, got, want)
		}
	}
}

// --- Case 5: Collector.Sample 返错时 skip，不中断循环 ---

func TestHeartbeat_Run_SkipsOnCollectorError(t *testing.T) {
	okMetrics := host.Metrics{UptimeSeconds: 42}
	col := &stubCollector{
		sampleFn: func(call int) (host.Metrics, error) {
			// 奇数次失败、偶数次成功，确保 collector 错与 sender 成功路径都走到。
			if call%2 == 1 {
				return host.Metrics{}, errors.New("sample boom")
			}
			return okMetrics, nil
		},
	}
	sender := newStubSender(true)

	hb, err := NewHeartbeat(HeartbeatConfig{
		Sender:    sender,
		Collector: col,
		Interval:  20 * time.Millisecond,
		Logger:    quietLogger(),
	})
	if err != nil {
		t.Fatalf("NewHeartbeat: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	runDone := make(chan error, 1)
	go func() { runDone <- hb.Run(ctx) }()

	// 跑 ~80ms 应有 ≥ 3 次 tick → ≥ 1 次 ok。
	waitFor(t, 500*time.Millisecond, func() bool {
		return col.callCount() >= 3
	}, "collector 未被调用足够次数")

	cancel()
	select {
	case err := <-runDone:
		if err != nil {
			t.Fatalf("Run 应返 nil，实际: %v", err)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("Run 没在 ctx cancel 后退出")
	}

	// sender 的调用次数应等于 collector 成功次数，肯定少于 collector 调用次数。
	if sender.callCount() == 0 {
		t.Fatal("sender 应至少被调一次（偶数次 collector 返 ok）")
	}
	if sender.callCount() >= col.callCount() {
		t.Fatalf("sender(%d) 不应 >= collector(%d)，错误 tick 应 skip sender",
			sender.callCount(), col.callCount())
	}
	// sender 收到的 metrics 应全部是 okMetrics（不是零值）。
	for i, got := range sender.snapshot() {
		if got != okMetrics {
			t.Fatalf("第 %d 次 sender 收到非 ok metrics: %+v", i, got)
		}
	}
}

// --- Case 6: SendHeartbeat 返 ErrSendBufferFull 时继续不中断 ---

func TestHeartbeat_Run_ContinuesOnBufferFull(t *testing.T) {
	col := &stubCollector{
		sampleFn: func(_ int) (host.Metrics, error) {
			return host.Metrics{UptimeSeconds: 1}, nil
		},
	}
	sender := newStubSender(true)
	sender.sendFn = func(_ int, _ host.Metrics) error {
		return ErrSendBufferFull
	}

	hb, err := NewHeartbeat(HeartbeatConfig{
		Sender:    sender,
		Collector: col,
		Interval:  20 * time.Millisecond,
		Logger:    quietLogger(),
	})
	if err != nil {
		t.Fatalf("NewHeartbeat: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	runDone := make(chan error, 1)
	go func() { runDone <- hb.Run(ctx) }()

	waitFor(t, 500*time.Millisecond, func() bool {
		return sender.callCount() >= 2
	}, "sender 未被调用至少 2 次（buffer full 应不中断）")

	cancel()
	select {
	case err := <-runDone:
		if err != nil {
			t.Fatalf("Run 应返 nil，实际: %v", err)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("Run 没在 ctx cancel 后退出")
	}
}

// --- Case 7: ctx cancel 立即返 nil ---

func TestHeartbeat_Run_CtxCancelReturnsNil(t *testing.T) {
	hb, err := NewHeartbeat(HeartbeatConfig{
		Sender:    newStubSender(true),
		Collector: &stubCollector{},
		Interval:  1 * time.Hour, // ticker 不会触发
		Logger:    quietLogger(),
	})
	if err != nil {
		t.Fatalf("NewHeartbeat: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	runDone := make(chan error, 1)
	go func() { runDone <- hb.Run(ctx) }()

	// 让 goroutine 有机会进入 select。
	time.Sleep(10 * time.Millisecond)
	cancel()

	select {
	case err := <-runDone:
		if err != nil {
			t.Fatalf("Run 应返 nil，实际: %v", err)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("Run 未在 500ms 内返回")
	}
}

// --- Case 8: 首次 tick 非立即 ---

func TestHeartbeat_FirstTickNotImmediate(t *testing.T) {
	sender := newStubSender(true)
	hb, err := NewHeartbeat(HeartbeatConfig{
		Sender:    sender,
		Collector: &stubCollector{},
		Interval:  200 * time.Millisecond,
		Logger:    quietLogger(),
	})
	if err != nil {
		t.Fatalf("NewHeartbeat: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	runDone := make(chan error, 1)
	go func() { runDone <- hb.Run(ctx) }()

	// 50ms 时 ticker 尚未触发，sender 应 0 次。
	time.Sleep(50 * time.Millisecond)
	got := sender.callCount()
	cancel()
	<-runDone

	if got != 0 {
		t.Fatalf("首次 tick 不应立即发，50ms 时 sender 应 0 次，实际 %d", got)
	}
}

// --- Case 8b: Run 会等待 Sender.Ready() 后才开始 tick ---
//
// 语义：heartbeat 依赖 Client 的 ready 信号（首次 hello OK），ready 前即便
// ticker 到期也不应发心跳（会撞 ErrSendBufferFull）。
func TestHeartbeat_Run_WaitsForReady(t *testing.T) {
	sender := newStubSender(false) // ready 未 close
	col := &stubCollector{
		sampleFn: func(_ int) (host.Metrics, error) {
			return host.Metrics{UptimeSeconds: 1}, nil
		},
	}
	hb, err := NewHeartbeat(HeartbeatConfig{
		Sender:    sender,
		Collector: col,
		Interval:  20 * time.Millisecond,
		Logger:    quietLogger(),
	})
	if err != nil {
		t.Fatalf("NewHeartbeat: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	runDone := make(chan error, 1)
	go func() { runDone <- hb.Run(ctx) }()

	// interval=20ms 跑 100ms 足够多次；若 heartbeat 不等 ready，此时应有 >0 次调用。
	time.Sleep(100 * time.Millisecond)
	if n := sender.callCount(); n != 0 {
		t.Fatalf("ready 前 heartbeat 不应发送，实际调用 %d 次", n)
	}
	// Collector 也不应被调用（合理推论：tick 本身没有跑过）。
	if n := col.callCount(); n != 0 {
		t.Fatalf("ready 前 collector 不应被调用，实际 %d 次", n)
	}

	// 开闸：close ready，heartbeat 应在下一个 interval 后开始 tick。
	close(sender.ready)
	waitFor(t, 500*time.Millisecond, func() bool {
		return sender.callCount() >= 1
	}, "ready 后应开始 tick")

	cancel()
	select {
	case err := <-runDone:
		if err != nil {
			t.Fatalf("Run 应返 nil，实际: %v", err)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("Run 未在 ctx cancel 后退出")
	}
}

// --- Case 9: 集成测试 —— 真 Client + httptest mockServer 端到端验证 wire ---

func TestHeartbeat_Integration_SendsToRealClient(t *testing.T) {
	// 记录 server 端收到的 heartbeat notification 次数与最后一条 params。
	var (
		hbCount   atomic.Int32
		lastMu    sync.Mutex
		lastHBRaw []byte
	)

	ms := newMockServer(t, nil, func(conn *websocket.Conn, data []byte) {
		var req jsonrpc.Request
		if err := json.Unmarshal(data, &req); err != nil {
			return
		}
		switch req.Method {
		case "agent.hello":
			replyHelloOK(conn, data)
		case "agent.heartbeat":
			hbCount.Add(1)
			lastMu.Lock()
			lastHBRaw = append([]byte(nil), req.Params...)
			lastMu.Unlock()
		}
	})

	// 固定 Collector 返一组 known metrics，便于 wire 字段断言。
	wantMetrics := host.Metrics{
		UptimeSeconds: 7777,
		CPUPercent:    33.25,
		MemUsedBytes:  1234567,
		MemTotalBytes: 8_000_000,
		Loadavg1:      0.75,
	}
	col := &fakeCollector{
		hello: host.HelloInfo{
			HostName: "it-host",
			OSInfo:   "Linux it",
			BootTime: time.UnixMilli(1714800000000),
		},
		metrics: wantMetrics,
	}

	cfg := baseConfig(ms.URL)
	cfg.Collector = col

	cli, err := New(cfg)
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	cliDone := make(chan error, 1)
	go func() { cliDone <- cli.Run(ctx) }()

	// 等 client 完成 hello（通过 dials 和第一条消息已处理判断）。
	waitFor(t, 1*time.Second, func() bool {
		return ms.dials() >= 1
	}, "client 未连接")

	// 再等 sendCh 就绪：SendHeartbeat 不再返 ErrSendBufferFull。
	waitFor(t, 1*time.Second, func() bool {
		err := cli.SendHeartbeat(host.Metrics{}, nil) // 探针
		return err == nil
	}, "client 未进入 ready")

	hb, err := NewHeartbeat(HeartbeatConfig{
		Sender:    cli,
		Collector: col,
		Interval:  30 * time.Millisecond,
		Logger:    quietLogger(),
	})
	if err != nil {
		t.Fatalf("NewHeartbeat: %v", err)
	}

	hbDone := make(chan error, 1)
	go func() { hbDone <- hb.Run(ctx) }()

	// 期望 150ms 内至少 3 条 heartbeat notification。
	waitFor(t, 1*time.Second, func() bool {
		return hbCount.Load() >= 3
	}, "未收到足够 heartbeat notification")

	// 校验最后一条 params 的 wire 字段。
	lastMu.Lock()
	raw := append([]byte(nil), lastHBRaw...)
	lastMu.Unlock()

	var got map[string]any
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("解析 heartbeat params 失败: %v", err)
	}

	// JSON 反序列化后数值均为 float64；用 delta 比较。
	checkNum := func(key string, want float64) {
		v, ok := got[key]
		if !ok {
			t.Fatalf("params 缺 key %q，got=%+v", key, got)
		}
		f, ok := v.(float64)
		if !ok {
			t.Fatalf("key %q 不是数值: %T", key, v)
		}
		if f != want {
			t.Fatalf("key %q: got %v want %v", key, f, want)
		}
	}
	checkNum("uptime_seconds", float64(wantMetrics.UptimeSeconds))
	checkNum("cpu_percent", wantMetrics.CPUPercent)
	checkNum("mem_used_bytes", float64(wantMetrics.MemUsedBytes))
	checkNum("mem_total_bytes", float64(wantMetrics.MemTotalBytes))
	checkNum("loadavg_1", wantMetrics.Loadavg1)

	cancel()
	select {
	case err := <-hbDone:
		if err != nil {
			t.Fatalf("hb.Run 应返 nil，实际: %v", err)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("hb.Run 未在 ctx cancel 后退出")
	}
	select {
	case <-cliDone:
	case <-time.After(1 * time.Second):
		t.Fatal("cli.Run 未在 ctx cancel 后退出")
	}
}

// --- B3 T3: bot 信息 provider 注入 ---

// TestHeartbeat_Run_DefaultBotProviderIsNoop 未配置 BotProvider 时，
// heartbeat tick 发给 sender 的 bot 参数应为 nil（即 NoopProvider.Snapshot() 结果）。
func TestHeartbeat_Run_DefaultBotProviderIsNoop(t *testing.T) {
	col := &stubCollector{}
	sender := newStubSender(true)

	hb, err := NewHeartbeat(HeartbeatConfig{
		Sender:    sender,
		Collector: col,
		Interval:  10 * time.Millisecond,
		Logger:    quietLogger(),
	})
	if err != nil {
		t.Fatalf("NewHeartbeat: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go hb.Run(ctx)

	waitFor(t, 300*time.Millisecond, func() bool {
		return sender.callCount() >= 2
	}, "sender 未被调用足够次数")

	cancel()

	for i, got := range sender.botSnapshot() {
		if got != nil {
			t.Errorf("tick#%d 应无 bot 字段（默认 NoopProvider），got %+v", i, got)
		}
	}
}

// TestHeartbeat_Run_ForwardsBotProviderSnapshot 配置了 BotProvider 时，
// 每个 tick 的 bot 参数应等于 provider.Snapshot() 返回值。
func TestHeartbeat_Run_ForwardsBotProviderSnapshot(t *testing.T) {
	want := &botinfo.BotInfo{
		Status:        botinfo.BotStatusRunning,
		PID:           12345,
		UptimeSeconds: 60,
		ConfigVersion: 3,
	}
	provider := &stubBotProvider{
		snapshotFn: func() (*botinfo.BotInfo, error) {
			return want, nil
		},
	}

	col := &stubCollector{}
	sender := newStubSender(true)

	hb, err := NewHeartbeat(HeartbeatConfig{
		Sender:      sender,
		Collector:   col,
		BotProvider: provider,
		Interval:    10 * time.Millisecond,
		Logger:      quietLogger(),
	})
	if err != nil {
		t.Fatalf("NewHeartbeat: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go hb.Run(ctx)

	waitFor(t, 300*time.Millisecond, func() bool {
		return sender.callCount() >= 2
	}, "sender 未被调用足够次数")

	cancel()

	for i, got := range sender.botSnapshot() {
		if got != want {
			t.Errorf("tick#%d bot 不匹配: got %+v want %+v", i, got, want)
		}
	}

	if provider.callCount() < 2 {
		t.Errorf("provider 调用次数 %d 少于预期 2", provider.callCount())
	}
}

// TestHeartbeat_Run_BotProviderErrorDoesNotBlockMetrics provider 报错时，
// heartbeat 仍应发送主指标，bot 字段降级为 nil。
func TestHeartbeat_Run_BotProviderErrorDoesNotBlockMetrics(t *testing.T) {
	provider := &stubBotProvider{
		snapshotFn: func() (*botinfo.BotInfo, error) {
			return nil, errors.New("simulated supervisor error")
		},
	}

	wantMetrics := host.Metrics{UptimeSeconds: 999}
	col := &stubCollector{
		sampleFn: func(_ int) (host.Metrics, error) { return wantMetrics, nil },
	}
	sender := newStubSender(true)

	hb, err := NewHeartbeat(HeartbeatConfig{
		Sender:      sender,
		Collector:   col,
		BotProvider: provider,
		Interval:    10 * time.Millisecond,
		Logger:      quietLogger(),
	})
	if err != nil {
		t.Fatalf("NewHeartbeat: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go hb.Run(ctx)

	waitFor(t, 300*time.Millisecond, func() bool {
		return sender.callCount() >= 2
	}, "sender 未被调用足够次数")

	cancel()

	// metrics 应正常；bot 应全部为 nil（provider 报错降级）
	for i, got := range sender.snapshot() {
		if got != wantMetrics {
			t.Errorf("tick#%d metrics 不匹配: got %+v want %+v", i, got, wantMetrics)
		}
	}
	for i, got := range sender.botSnapshot() {
		if got != nil {
			t.Errorf("tick#%d provider 报错应导致 bot=nil，实际 %+v", i, got)
		}
	}
}

// TestBuildHeartbeatRequest_EmbedsBotField 确保 wire 协议按约定：
//   - botInfo 非 nil 时 params.bot 嵌入
//   - botInfo nil 时 params 不含 bot 键
func TestBuildHeartbeatRequest_EmbedsBotField(t *testing.T) {
	metrics := host.Metrics{
		UptimeSeconds: 10,
		CPUPercent:    1.5,
		MemUsedBytes:  100,
		MemTotalBytes: 1000,
		Loadavg1:      0.5,
	}

	// case 1: botInfo nil → params 不含 bot
	raw, err := buildHeartbeatRequest(metrics, nil)
	if err != nil {
		t.Fatalf("build nil: %v", err)
	}
	var req1 struct {
		Params map[string]any `json:"params"`
	}
	if err := json.Unmarshal(raw, &req1); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if _, ok := req1.Params["bot"]; ok {
		t.Errorf("botInfo=nil 时 params 不应含 bot 键")
	}

	// case 2: botInfo 非 nil → params.bot 内嵌
	bot := &botinfo.BotInfo{
		Status: botinfo.BotStatusRunning,
		PID:    999,
	}
	raw, err = buildHeartbeatRequest(metrics, bot)
	if err != nil {
		t.Fatalf("build bot: %v", err)
	}
	var req2 struct {
		Params map[string]any `json:"params"`
	}
	if err := json.Unmarshal(raw, &req2); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	botRaw, ok := req2.Params["bot"]
	if !ok {
		t.Fatal("botInfo 非 nil 时 params 应含 bot 键")
	}
	botMap, ok := botRaw.(map[string]any)
	if !ok {
		t.Fatalf("params.bot 应为 object，实际 %T", botRaw)
	}
	if botMap["status"] != "running" {
		t.Errorf("params.bot.status = %v, want running", botMap["status"])
	}
	// 数字 JSON unmarshal 会成 float64
	if pid, _ := botMap["pid"].(float64); int(pid) != 999 {
		t.Errorf("params.bot.pid = %v, want 999", botMap["pid"])
	}
}
