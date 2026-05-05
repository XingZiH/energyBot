// Package client —— server → agent 方向下行 notification 处理的单元测试（B3-T5）。
//
// 背景：
//   - B1 的 client 只处理 agent→server（hello/heartbeat req-reply）；
//     client.go L281 for-loop 读到任何 server 下行消息都忽略。
//   - B3 要支持主站下发 bot.start / bot.stop / bot.reload-config 指令，
//     agent 必须接受下行 notification 并转发给 Dispatcher 接口。
//
// 本测试覆盖：
//   - server 发 notification（无 id）→ Dispatcher.Dispatch 被调，参数透传
//   - 未设 Dispatcher → 消息被静默丢弃，不影响后续心跳
//   - Dispatcher 返错 → 记日志不 crash
package client

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/anomalyco/energybot-agent/internal/host"
	"github.com/gorilla/websocket"
)

// recordingDispatcher 记录每次 Dispatch 调用，供测试断言。
type recordingDispatcher struct {
	mu    sync.Mutex
	calls []dispatchCall
	err   error
}

type dispatchCall struct {
	method string
	params json.RawMessage
}

func (d *recordingDispatcher) Dispatch(method string, params json.RawMessage) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.calls = append(d.calls, dispatchCall{
		method: method,
		params: append(json.RawMessage(nil), params...),
	})
	return d.err
}

func (d *recordingDispatcher) snapshot() []dispatchCall {
	d.mu.Lock()
	defer d.mu.Unlock()
	out := make([]dispatchCall, len(d.calls))
	copy(out, d.calls)
	return out
}

func TestClient_ServerNotification_DispatchCalled(t *testing.T) {
	disp := &recordingDispatcher{}
	// onMessage：只回 hello，不主动发其他消息（push 由测试主线程触发）。
	conns := make(chan *websocket.Conn, 1)
	ms := newMockServer(t, nil,
		func(conn *websocket.Conn, data []byte) {
			replyHelloOK(conn, data)
			select {
			case conns <- conn:
			default:
			}
		},
	)

	cfg := baseConfig(ms.URL)
	cfg.Dispatcher = disp
	cli, err := New(cfg)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	runDone := make(chan error, 1)
	go func() { runDone <- cli.Run(ctx) }()

	// 等 hello 完成
	select {
	case <-cli.Ready():
	case <-time.After(2 * time.Second):
		t.Fatal("client 未在 2s 内 ready")
	}
	conn := <-conns

	// server 主动下发 notification
	push := []byte(`{"jsonrpc":"2.0","method":"bot.start","params":{"config_version":7}}`)
	if err := conn.WriteMessage(websocket.TextMessage, push); err != nil {
		t.Fatalf("server push: %v", err)
	}

	// 等 Dispatch 被调
	waitForDispatchCount(t, disp, 1, 1*time.Second)

	calls := disp.snapshot()
	if len(calls) != 1 {
		t.Fatalf("want 1 dispatch, got %d", len(calls))
	}
	if calls[0].method != "bot.start" {
		t.Errorf("method want=bot.start got=%s", calls[0].method)
	}
	var p struct {
		ConfigVersion int `json:"config_version"`
	}
	if err := json.Unmarshal(calls[0].params, &p); err != nil {
		t.Fatalf("params unmarshal: %v", err)
	}
	if p.ConfigVersion != 7 {
		t.Errorf("config_version want=7 got=%d", p.ConfigVersion)
	}

	cancel()
	<-runDone
}

func TestClient_ServerNotification_NoDispatcher_Ignored(t *testing.T) {
	conns := make(chan *websocket.Conn, 1)
	ms := newMockServer(t, nil,
		func(conn *websocket.Conn, data []byte) {
			replyHelloOK(conn, data)
			select {
			case conns <- conn:
			default:
			}
		},
	)
	cfg := baseConfig(ms.URL)
	// cfg.Dispatcher = nil
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
	case <-time.After(2 * time.Second):
		t.Fatal("client 未 ready")
	}
	conn := <-conns

	// 发 notification；不应导致 client 崩溃
	push := []byte(`{"jsonrpc":"2.0","method":"bot.start","params":{}}`)
	if err := conn.WriteMessage(websocket.TextMessage, push); err != nil {
		t.Fatalf("push: %v", err)
	}
	// 给 reader 一点时间消化
	time.Sleep(50 * time.Millisecond)

	// client 应仍 alive：下次 SendHeartbeat 不应失败
	if err := cli.SendHeartbeat(host.Metrics{UptimeSeconds: 1}, nil); err != nil {
		t.Errorf("client should still accept SendHeartbeat: %v", err)
	}

	cancel()
	<-runDone
}

func TestClient_ServerNotification_DispatcherErr_ClientKeepsRunning(t *testing.T) {
	disp := &recordingDispatcher{err: errors.New("dispatch failed")}
	conns := make(chan *websocket.Conn, 1)
	ms := newMockServer(t, nil,
		func(conn *websocket.Conn, data []byte) {
			replyHelloOK(conn, data)
			select {
			case conns <- conn:
			default:
			}
		},
	)
	cfg := baseConfig(ms.URL)
	cfg.Dispatcher = disp
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
	case <-time.After(2 * time.Second):
		t.Fatal("client 未 ready")
	}
	conn := <-conns

	// 第一条
	if err := conn.WriteMessage(websocket.TextMessage, []byte(`{"jsonrpc":"2.0","method":"bot.start","params":{}}`)); err != nil {
		t.Fatal(err)
	}
	waitForDispatchCount(t, disp, 1, 1*time.Second)

	// 第二条仍应被 dispatch（client 没有因为 disp 错就退出）
	if err := conn.WriteMessage(websocket.TextMessage, []byte(`{"jsonrpc":"2.0","method":"bot.stop","params":{}}`)); err != nil {
		t.Fatal(err)
	}
	waitForDispatchCount(t, disp, 2, 1*time.Second)

	cancel()
	<-runDone
}

// ---- 辅助 ----

func waitForDispatchCount(t *testing.T, d *recordingDispatcher, n int, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if len(d.snapshot()) >= n {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("waited %v for %d dispatch calls, got %d", timeout, n, len(d.snapshot()))
}
