package client

import (
	"context"
	"encoding/json"
	"log"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"github.com/anomalyco/energybot-agent/internal/auth"
	"github.com/anomalyco/energybot-agent/internal/host"
	"github.com/anomalyco/energybot-agent/internal/jsonrpc"
)

// fakeCollector 提供固定的 Hello/Metrics 以便测试可断言。
type fakeCollector struct {
	hello   host.HelloInfo
	metrics host.Metrics
}

func (f *fakeCollector) Hello() (host.HelloInfo, error)  { return f.hello, nil }
func (f *fakeCollector) Sample() (host.Metrics, error)   { return f.metrics, nil }

// quietLogger 返回一个丢弃输出的 logger，避免测试日志噪声。
// 用 log.New(io.Discard,...) 但需引入 io，简单起见返 log.Default() 也可；
// 这里用 io.Discard 干净一点。
func quietLogger() *log.Logger {
	return log.New(discardWriter{}, "", 0)
}

type discardWriter struct{}

func (discardWriter) Write(p []byte) (int, error) { return len(p), nil }

// baseConfig 构造一份测试用的 Config，时间参数全量压缩。
// 调用方可覆盖需要的字段。
func baseConfig(apiURL string) Config {
	return Config{
		APIURL:        apiURL,
		LicenseKey:    "lic_test",
		LicenseSecret: "secret_test",
		AgentVersion:  "1.0.0",
		Collector: &fakeCollector{
			hello: host.HelloInfo{
				HostName: "h1",
				OSInfo:   "Linux 6.1",
				BootTime: time.UnixMilli(1714800000000),
			},
			metrics: host.Metrics{
				UptimeSeconds: 3600,
				CPUPercent:    12.5,
				MemUsedBytes:  1024,
				MemTotalBytes: 4096,
				Loadavg1:      0.5,
			},
		},
		Logger:       quietLogger(),
		HelloTimeout: 200 * time.Millisecond,
		BackoffMin:   10 * time.Millisecond,
		BackoffMax:   50 * time.Millisecond,
		DialTimeout:  1 * time.Second,
		SendBuffer:   16,
	}
}

// replyHelloOK 是标准的 hello 成功应答：识别 method=agent.hello 且 id 非空的请求，
// 回一条 {"jsonrpc":"2.0","id":<same>,"result":{"ok":true,...}}。
func replyHelloOK(conn *websocket.Conn, data []byte) {
	var req jsonrpc.Request
	if err := json.Unmarshal(data, &req); err != nil {
		return
	}
	if req.Method != "agent.hello" || req.ID == nil {
		return
	}
	resp := jsonrpc.Response{
		JSONRPC: "2.0",
		ID:      req.ID,
		Result:  json.RawMessage(`{"ok":true,"server_time":1714800000000}`),
	}
	buf, err := json.Marshal(resp)
	if err != nil {
		return
	}
	_ = conn.WriteMessage(websocket.TextMessage, buf)
}

// waitFor 在超时前反复轮询 cond 直到返 true；超时 t.Fatalf。
func waitFor(t *testing.T, timeout time.Duration, cond func() bool, msg string) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("waitFor 超时: %s", msg)
}

// Case 1: Dial 握手 header 完整性 + 签名可校验。
func TestClient_Dial_SendsAllHeaders(t *testing.T) {
	// server 接到连接后立即关闭，让 client 不会卡 hello。
	ms := newMockServer(t,
		func(conn *websocket.Conn) {
			// 立即关，模拟拒绝握手。
			_ = conn.WriteControl(
				websocket.CloseMessage,
				websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""),
				time.Now().Add(100*time.Millisecond),
			)
			_ = conn.Close()
		},
		nil,
	)

	cfg := baseConfig(ms.URL)
	cli, err := New(cfg)
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	runDone := make(chan error, 1)
	go func() { runDone <- cli.Run(ctx) }()

	// 等 headers 被记录。
	waitFor(t, 500*time.Millisecond, func() bool {
		return ms.headers() != nil
	}, "server 未收到 upgrade 请求")

	h := ms.headers()
	if h.Get("X-License-Key") != cfg.LicenseKey {
		t.Errorf("X-License-Key = %q，期望 %q", h.Get("X-License-Key"), cfg.LicenseKey)
	}
	if h.Get("X-Agent-Version") != cfg.AgentVersion {
		t.Errorf("X-Agent-Version = %q，期望 %q", h.Get("X-Agent-Version"), cfg.AgentVersion)
	}
	if h.Get("X-Timestamp") == "" {
		t.Error("X-Timestamp 缺失")
	}
	if h.Get("X-Nonce") == "" {
		t.Error("X-Nonce 缺失")
	}
	sig := h.Get("X-Signature")
	if sig == "" {
		t.Fatal("X-Signature 缺失")
	}

	// 验签：用同 secret + 解析到的 ts/nonce/path 重新计算。
	ok := auth.Verify(auth.SignParams{
		Secret:    cfg.LicenseSecret,
		Method:    "CONNECT",
		Path:      "/agent",
		Timestamp: h.Get("X-Timestamp"),
		Nonce:     h.Get("X-Nonce"),
		Body:      nil,
	}, sig)
	if !ok {
		t.Errorf("X-Signature 校验失败")
	}

	// 校验 timestamp 是合理的 ms unix（避免 unit 错误）。
	if ts, err := strconv.ParseInt(h.Get("X-Timestamp"), 10, 64); err == nil {
		now := time.Now().UnixMilli()
		if ts < now-10_000 || ts > now+10_000 {
			t.Errorf("X-Timestamp %d 偏离当前时间过远", ts)
		}
	}

	cancel()
	select {
	case <-runDone:
	case <-time.After(2 * time.Second):
		t.Fatal("Run 未在 ctx cancel 后退出")
	}
}

// Case 2: hello payload 字段齐全且值正确。
func TestClient_Hello_SendsParamsCorrectly(t *testing.T) {
	received := make(chan []byte, 4)
	ms := newMockServer(t, nil,
		func(conn *websocket.Conn, data []byte) {
			// 拷贝一份避免 buffer 复用。
			cp := make([]byte, len(data))
			copy(cp, data)
			select {
			case received <- cp:
			default:
			}
			replyHelloOK(conn, data)
		},
	)

	cfg := baseConfig(ms.URL)
	cli, err := New(cfg)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	runDone := make(chan error, 1)
	go func() { runDone <- cli.Run(ctx) }()

	var helloRaw []byte
	select {
	case helloRaw = <-received:
	case <-time.After(1 * time.Second):
		t.Fatal("server 未收到 hello")
	}

	var req jsonrpc.Request
	if err := json.Unmarshal(helloRaw, &req); err != nil {
		t.Fatalf("hello 解码失败: %v, raw=%s", err, string(helloRaw))
	}
	if req.JSONRPC != "2.0" {
		t.Errorf("jsonrpc = %q，期望 2.0", req.JSONRPC)
	}
	if req.Method != "agent.hello" {
		t.Errorf("method = %q，期望 agent.hello", req.Method)
	}
	if req.ID == nil {
		t.Error("hello 必须带 id（非 notification）")
	} else if req.ID.IsString || req.ID.Num != 1 {
		t.Errorf("hello id = %+v，期望 int 1", req.ID)
	}

	var params struct {
		AgentVersion string `json:"agent_version"`
		HostName     string `json:"host_name"`
		OSInfo       string `json:"os_info"`
		BootTime     int64  `json:"boot_time"`
	}
	if err := json.Unmarshal(req.Params, &params); err != nil {
		t.Fatalf("hello params 解码失败: %v", err)
	}
	if params.AgentVersion != "1.0.0" {
		t.Errorf("agent_version = %q", params.AgentVersion)
	}
	if params.HostName != "h1" {
		t.Errorf("host_name = %q", params.HostName)
	}
	if params.OSInfo != "Linux 6.1" {
		t.Errorf("os_info = %q", params.OSInfo)
	}
	if params.BootTime != 1714800000000 {
		t.Errorf("boot_time = %d", params.BootTime)
	}

	cancel()
	select {
	case <-runDone:
	case <-time.After(2 * time.Second):
		t.Fatal("Run 未退出")
	}
}

// Case 3: hello 超时后客户端应退避并再次 Dial。
func TestClient_Hello_Timeout_ReconnectsNextAttempt(t *testing.T) {
	ms := newMockServer(t, nil, nil) // onMessage=nil，server 不回应 hello

	cfg := baseConfig(ms.URL)
	cfg.HelloTimeout = 80 * time.Millisecond
	cfg.BackoffMin = 10 * time.Millisecond
	cfg.BackoffMax = 20 * time.Millisecond
	cli, err := New(cfg)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	runDone := make(chan error, 1)
	go func() { runDone <- cli.Run(ctx) }()

	// 第一次 hello 超时约 80ms + backoff 10ms；300ms 内应至少 2 次 upgrade。
	waitFor(t, 1*time.Second, func() bool {
		return ms.dials() >= 2
	}, "client 未在 hello 超时后重连")

	cancel()
	select {
	case <-runDone:
	case <-time.After(2 * time.Second):
		t.Fatal("Run 未退出")
	}
}

// Case 4: close 4001 触发 ExitFunc(42)。
func TestClient_Close4001_TriggersExit42(t *testing.T) {
	ms := newMockServer(t, nil,
		func(conn *websocket.Conn, data []byte) {
			replyHelloOK(conn, data)
			// gorilla ws 同 conn 顺序写保证，hello result 先于 close 到达。
			_ = conn.WriteControl(
				websocket.CloseMessage,
				websocket.FormatCloseMessage(4001, "replaced"),
				time.Now().Add(100*time.Millisecond),
			)
		},
	)

	var exitCode atomic.Int32
	exitCode.Store(-1)
	cfg := baseConfig(ms.URL)
	cfg.ExitFunc = func(code int) {
		exitCode.Store(int32(code))
	}
	cli, err := New(cfg)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	runDone := make(chan error, 1)
	go func() { runDone <- cli.Run(ctx) }()

	select {
	case err := <-runDone:
		if err != nil {
			t.Errorf("Run 返 err=%v，期望 nil", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Run 未在 close 4001 后退出")
	}
	if got := exitCode.Load(); got != 42 {
		t.Errorf("ExitFunc 收到 code=%d，期望 42", got)
	}
}

// Case 5: close 4003 触发 ExitFunc(42)。
func TestClient_Close4003_TriggersExit42(t *testing.T) {
	ms := newMockServer(t, nil,
		func(conn *websocket.Conn, data []byte) {
			replyHelloOK(conn, data)
			_ = conn.WriteControl(
				websocket.CloseMessage,
				websocket.FormatCloseMessage(4003, "license_revoked"),
				time.Now().Add(100*time.Millisecond),
			)
		},
	)

	var exitCode atomic.Int32
	exitCode.Store(-1)
	cfg := baseConfig(ms.URL)
	cfg.ExitFunc = func(code int) { exitCode.Store(int32(code)) }
	cli, err := New(cfg)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	runDone := make(chan error, 1)
	go func() { runDone <- cli.Run(ctx) }()

	select {
	case err := <-runDone:
		if err != nil {
			t.Errorf("Run 返 err=%v，期望 nil", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Run 未在 close 4003 后退出")
	}
	if got := exitCode.Load(); got != 42 {
		t.Errorf("ExitFunc 收到 code=%d，期望 42", got)
	}
}

// Case 6: close 1006（abnormal，直接 TCP 断）应重连，不触发 ExitFunc。
func TestClient_Close1006_Reconnects(t *testing.T) {
	var connCount atomic.Int32
	ms := newMockServer(t, nil,
		func(conn *websocket.Conn, data []byte) {
			replyHelloOK(conn, data)
			// 第一次连接 hello OK 后直接关底层 TCP，制造 1006。
			if connCount.Add(1) == 1 {
				_ = conn.Close()
			}
			// 第二次连接 hello OK 后保持住。
		},
	)

	var exitCalled atomic.Bool
	cfg := baseConfig(ms.URL)
	cfg.ExitFunc = func(code int) { exitCalled.Store(true) }
	cli, err := New(cfg)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	runDone := make(chan error, 1)
	go func() { runDone <- cli.Run(ctx) }()

	waitFor(t, 2*time.Second, func() bool {
		return ms.dials() >= 2
	}, "client 未在 1006 后重连")

	if exitCalled.Load() {
		t.Error("1006 不应触发 ExitFunc")
	}

	cancel()
	select {
	case <-runDone:
	case <-time.After(2 * time.Second):
		t.Fatal("Run 未退出")
	}
}

// Case 7: 退避序列，连续失败时应多次重连。
func TestClient_Backoff_Sequence(t *testing.T) {
	// 每次连接都立即关 TCP → 1006 → backoff 重连。
	ms := newMockServer(t,
		func(conn *websocket.Conn) {
			_ = conn.Close()
		},
		nil,
	)

	cfg := baseConfig(ms.URL)
	cfg.BackoffMin = 10 * time.Millisecond
	cfg.BackoffMax = 40 * time.Millisecond
	cfg.HelloTimeout = 500 * time.Millisecond // 不想被 hello timeout 干扰时间
	cli, err := New(cfg)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	runDone := make(chan error, 1)
	go func() { runDone <- cli.Run(ctx) }()

	// 预期 ≥ 4 次 dial：(dial + close 即时) + backoff 10/20/40/40...
	waitFor(t, 600*time.Millisecond, func() bool {
		return ms.dials() >= 4
	}, "预期 ≥ 4 次 dial")

	cancel()
	select {
	case <-runDone:
	case <-time.After(2 * time.Second):
		t.Fatal("Run 未退出")
	}
}

// Case 8: ctx cancel 后 Run 返 nil。
func TestClient_CtxCancel_ReturnsNil(t *testing.T) {
	ms := newMockServer(t, nil,
		func(conn *websocket.Conn, data []byte) {
			replyHelloOK(conn, data)
			// 保持连接不动。
		},
	)

	cfg := baseConfig(ms.URL)
	cli, err := New(cfg)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	runDone := make(chan error, 1)
	go func() { runDone <- cli.Run(ctx) }()

	// 等至少一次连接建立。
	waitFor(t, 1*time.Second, func() bool { return ms.dials() >= 1 }, "未连上")
	// 等 client 进入 ready（SendHeartbeat 返 nil 即 sendCh 就绪）。
	waitFor(t, 1*time.Second, func() bool {
		return cli.SendHeartbeat(host.Metrics{UptimeSeconds: 1}) == nil
	}, "client 未进入 ready")

	cancel()
	select {
	case err := <-runDone:
		if err != nil {
			t.Errorf("Run 返 err=%v，期望 nil", err)
		}
	case <-time.After(1 * time.Second):
		t.Fatal("Run 未在 1s 内退出")
	}
}

// Case 9: SendHeartbeat 产出合规的 agent.heartbeat notification。
func TestClient_SendHeartbeat_EncodesCorrectly(t *testing.T) {
	received := make(chan []byte, 8)
	ms := newMockServer(t, nil,
		func(conn *websocket.Conn, data []byte) {
			cp := make([]byte, len(data))
			copy(cp, data)
			select {
			case received <- cp:
			default:
			}
			replyHelloOK(conn, data)
		},
	)

	cfg := baseConfig(ms.URL)
	cli, err := New(cfg)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	runDone := make(chan error, 1)
	go func() { runDone <- cli.Run(ctx) }()

	// 先吃掉 hello。
	select {
	case <-received:
	case <-time.After(1 * time.Second):
		t.Fatal("未收到 hello")
	}

	// 等客户端进入 ready（sendCh 就绪）。用 SendHeartbeat 重试直到成功或超时。
	metrics := host.Metrics{
		UptimeSeconds: 3600,
		CPUPercent:    12.5,
		MemUsedBytes:  1024,
		MemTotalBytes: 4096,
		Loadavg1:      0.5,
	}
	deadline := time.Now().Add(1 * time.Second)
	for time.Now().Before(deadline) {
		if err := cli.SendHeartbeat(metrics); err == nil {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	var hbRaw []byte
	select {
	case hbRaw = <-received:
	case <-time.After(1 * time.Second):
		t.Fatal("server 未收到 heartbeat")
	}

	var req jsonrpc.Request
	if err := json.Unmarshal(hbRaw, &req); err != nil {
		t.Fatalf("heartbeat 解码失败: %v, raw=%s", err, string(hbRaw))
	}
	if req.JSONRPC != "2.0" {
		t.Errorf("jsonrpc=%q", req.JSONRPC)
	}
	if req.Method != "agent.heartbeat" {
		t.Errorf("method=%q", req.Method)
	}
	if req.ID == nil {
		t.Error("heartbeat 必须带 id（spec L217：服务端 handleMessage 对 id=nil 的 notification 直接丢弃）")
	}

	var p struct {
		UptimeSeconds uint64  `json:"uptime_seconds"`
		CPUPercent    float64 `json:"cpu_percent"`
		MemUsedBytes  uint64  `json:"mem_used_bytes"`
		MemTotalBytes uint64  `json:"mem_total_bytes"`
		Loadavg1      float64 `json:"loadavg_1"`
	}
	if err := json.Unmarshal(req.Params, &p); err != nil {
		t.Fatalf("heartbeat params 解码失败: %v", err)
	}
	if p.UptimeSeconds != 3600 {
		t.Errorf("uptime_seconds=%d", p.UptimeSeconds)
	}
	if p.CPUPercent != 12.5 {
		t.Errorf("cpu_percent=%v", p.CPUPercent)
	}
	if p.MemUsedBytes != 1024 {
		t.Errorf("mem_used_bytes=%d", p.MemUsedBytes)
	}
	if p.MemTotalBytes != 4096 {
		t.Errorf("mem_total_bytes=%d", p.MemTotalBytes)
	}
	if p.Loadavg1 != 0.5 {
		t.Errorf("loadavg_1=%v", p.Loadavg1)
	}

	cancel()
	select {
	case <-runDone:
	case <-time.After(2 * time.Second):
		t.Fatal("Run 未退出")
	}
}

// Case 10: sendCh 满时 SendHeartbeat 返 ErrSendBufferFull。
func TestClient_SendHeartbeat_BufferFull(t *testing.T) {
	// 服务端吞掉 hello 然后不再读任何消息，制造 server 端 socket buffer 最终回压。
	// 但 go ws write 被 socket buffer 缓冲，所以主要靠 sendCh 本身容量触发。
	var helloDone atomic.Bool
	ms := newMockServer(t, nil,
		func(conn *websocket.Conn, data []byte) {
			if !helloDone.Load() {
				replyHelloOK(conn, data)
				helloDone.Store(true)
				return
			}
			// 后续消息什么都不做，让 writer 或 socket buffer 逐步堵塞。
		},
	)

	cfg := baseConfig(ms.URL)
	cfg.SendBuffer = 1
	cli, err := New(cfg)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	runDone := make(chan error, 1)
	go func() { runDone <- cli.Run(ctx) }()

	// 等 client ready。
	deadline := time.Now().Add(1 * time.Second)
	metrics := host.Metrics{UptimeSeconds: 1}
	for time.Now().Before(deadline) {
		if err := cli.SendHeartbeat(metrics); err == nil {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !helloDone.Load() {
		t.Fatal("hello 未完成")
	}

	// 快速塞入多条，逼迫 sendCh 满后返 ErrSendBufferFull。
	// 第一条进 sendCh 后可能立即被 writer 消费，需要在 writer 写入底层 TCP buffer
	// 满之前制造出 channel 积压——写 100 条几乎一定能触发。
	var lastErr error
	for i := 0; i < 10000; i++ {
		lastErr = cli.SendHeartbeat(metrics)
		if lastErr == ErrSendBufferFull {
			break
		}
	}
	if lastErr != ErrSendBufferFull {
		t.Errorf("未观察到 ErrSendBufferFull，lastErr=%v", lastErr)
	}

	cancel()
	select {
	case <-runDone:
	case <-time.After(2 * time.Second):
		t.Fatal("Run 未退出")
	}
}

// Case 11: APIURL 无法 url.Parse 时 New 立即返 err。
func TestClient_New_InvalidURL_ReturnsError(t *testing.T) {
	cfg := baseConfig("://bad")
	_, err := New(cfg)
	if err == nil {
		t.Fatal("期望 New 返 non-nil err，实际 nil")
	}
	if !strings.Contains(err.Error(), "APIURL") {
		t.Errorf("err message 未含 APIURL，got: %v", err)
	}
}

// Case 12: APIURL scheme 非 ws/wss 时 New 立即返 err。
func TestClient_New_UnsupportedScheme_ReturnsError(t *testing.T) {
	cfg := baseConfig("http://example.com/agent")
	_, err := New(cfg)
	if err == nil {
		t.Fatal("期望 New 返 non-nil err，实际 nil")
	}
	if !strings.Contains(err.Error(), "scheme") {
		t.Errorf("err message 未含 scheme，got: %v", err)
	}
}

// Case 13: hello OK 后 Ready() channel 被 close。
//
// 验证语义：Client.Ready() 是 heartbeat 等待首次可发心跳的信号。hello 握手
// 成功后，sendCh 已就绪，Ready 必须立即解除阻塞。
func TestClient_Ready_ClosedAfterHelloOK(t *testing.T) {
	ms := newMockServer(t, nil,
		func(conn *websocket.Conn, data []byte) {
			replyHelloOK(conn, data)
			// 保持连接存活，让 cli 维持 ready 状态。
		},
	)

	cfg := baseConfig(ms.URL)
	cli, err := New(cfg)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	runDone := make(chan error, 1)
	go func() { runDone <- cli.Run(ctx) }()

	select {
	case <-cli.Ready():
		// 预期路径。
	case <-time.After(1 * time.Second):
		t.Fatal("Ready() 在 1s 内未被 close（hello 已应答）")
	}

	// 二次读取应立即返回（已 closed channel 永不阻塞）。
	select {
	case <-cli.Ready():
	case <-time.After(50 * time.Millisecond):
		t.Fatal("Ready() 二次读取应立即返回（closed channel）")
	}

	cancel()
	select {
	case <-runDone:
	case <-time.After(2 * time.Second):
		t.Fatal("Run 未退出")
	}
}

// Case 14: hello 前 Ready() channel 不 close（select default 能走到）。
//
// server 不应答 hello，client 卡在 helloTimeout；此期间 Ready() 不应已 close，
// 否则 heartbeat 会在 client 尚未 ready 时发送、撞上 ErrSendBufferFull。
func TestClient_Ready_BeforeHello_DoesNotClose(t *testing.T) {
	ms := newMockServer(t, nil, nil) // onMessage=nil：不回 hello

	cfg := baseConfig(ms.URL)
	cfg.HelloTimeout = 500 * time.Millisecond
	cli, err := New(cfg)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	runDone := make(chan error, 1)
	go func() { runDone <- cli.Run(ctx) }()

	// 等确认 server 已收到 upgrade，client 正等 hello 应答。
	waitFor(t, 500*time.Millisecond, func() bool {
		return ms.dials() >= 1
	}, "server 未收到 upgrade")

	// 在 helloTimeout 到期前（留 200ms 安全距离）抽样多次。
	deadline := time.Now().Add(200 * time.Millisecond)
	for time.Now().Before(deadline) {
		select {
		case <-cli.Ready():
			t.Fatal("hello 未完成，Ready() 不应被 close")
		default:
		}
		time.Sleep(20 * time.Millisecond)
	}

	cancel()
	select {
	case <-runDone:
	case <-time.After(2 * time.Second):
		t.Fatal("Run 未退出")
	}
}
