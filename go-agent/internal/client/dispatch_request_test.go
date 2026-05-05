// Package client —— T11.10：server → agent 方向 JSON-RPC request 的单元测试。
//
// 背景：
//   - B3-T5 只支持 server 下行 notification（无 id，agent 不回包）
//   - T11.10 升级：支持 server 下行 request（带 id + method），agent 回 response
//     给 nest-api callAgent 的 pending Promise，用于 agent.applyConfig 这种
//     nest 必须等 agent 真正完成才能继续下一步的场景
//
// 本测试覆盖：
//   - 收到 request（带 id）→ 调 RequestDispatcher.DispatchRequest，把 result
//     序列化为 JSON-RPC response（带相同 id）写回
//   - RequestDispatcher.DispatchRequest 返 error → 回 error response（带 error.code/message）
//   - Dispatcher 未实现 RequestDispatcher → 回 MethodNotFound 错 response，不崩
package client

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// recordingRequestDispatcher 同时实现 Dispatcher + RequestDispatcher 接口。
type recordingRequestDispatcher struct {
	mu       sync.Mutex
	notifies []dispatchCall
	reqs     []dispatchCall

	// DispatchRequest 的返回值可控
	wantResult any
	wantErr    error
}

func (d *recordingRequestDispatcher) Dispatch(method string, params json.RawMessage) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.notifies = append(d.notifies, dispatchCall{method: method, params: append(json.RawMessage(nil), params...)})
	return nil
}

func (d *recordingRequestDispatcher) DispatchRequest(method string, params json.RawMessage) (any, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.reqs = append(d.reqs, dispatchCall{method: method, params: append(json.RawMessage(nil), params...)})
	return d.wantResult, d.wantErr
}

func (d *recordingRequestDispatcher) reqSnapshot() []dispatchCall {
	d.mu.Lock()
	defer d.mu.Unlock()
	out := make([]dispatchCall, len(d.reqs))
	copy(out, d.reqs)
	return out
}

// waitResponseFrame 读 conn 上的下一条 message，解析为 JSON-RPC response。
func waitResponseFrame(t *testing.T, conn *websocket.Conn, timeout time.Duration) map[string]any {
	t.Helper()
	_ = conn.SetReadDeadline(time.Now().Add(timeout))
	defer func() { _ = conn.SetReadDeadline(time.Time{}) }()
	_, data, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("waitResponseFrame: %v", err)
	}
	var m map[string]any
	if err := json.Unmarshal(data, &m); err != nil {
		t.Fatalf("response 解析失败: %v raw=%s", err, string(data))
	}
	return m
}

func TestClient_ServerRequest_ResultFrameSent(t *testing.T) {
	disp := &recordingRequestDispatcher{wantResult: map[string]any{"ok": true}}
	conns := make(chan *websocket.Conn, 1)
	outCh := make(chan []byte, 4)
	ms := newMockServer(t, nil,
		func(conn *websocket.Conn, data []byte) {
			// 握手阶段：method=agent.hello → 回 hello OK
			// 之后阶段：透传到 outCh（筛掉 agent 心跳）
			var probe map[string]any
			_ = json.Unmarshal(data, &probe)
			if probe["method"] == "agent.hello" {
				replyHelloOK(conn, data)
				select {
				case conns <- conn:
				default:
				}
				return
			}
			if probe["method"] == "agent.heartbeat" {
				return
			}
			cp := make([]byte, len(data))
			copy(cp, data)
			select {
			case outCh <- cp:
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
		t.Fatal("client 未在 2s 内 ready")
	}
	conn := <-conns

	// server push request
	push := []byte(`{"jsonrpc":"2.0","id":42,"method":"agent.applyConfig","params":{"licenseId":4}}`)
	if err := conn.WriteMessage(websocket.TextMessage, push); err != nil {
		t.Fatalf("push: %v", err)
	}

	// 等 agent 回 response
	var raw []byte
	select {
	case raw = <-outCh:
	case <-time.After(2 * time.Second):
		t.Fatal("agent 2s 内未回 response")
	}
	var resp map[string]any
	if err := json.Unmarshal(raw, &resp); err != nil {
		t.Fatalf("response 解析失败: %v raw=%s", err, string(raw))
	}
	if resp["jsonrpc"] != "2.0" {
		t.Errorf("jsonrpc want=2.0 got=%v", resp["jsonrpc"])
	}
	if idNum, ok := resp["id"].(float64); !ok || int(idNum) != 42 {
		t.Errorf("id want=42 got=%v (%T)", resp["id"], resp["id"])
	}
	result, ok := resp["result"].(map[string]any)
	if !ok {
		t.Fatalf("want result field, got: %v", resp)
	}
	if result["ok"] != true {
		t.Errorf("result.ok want=true got=%v", result["ok"])
	}

	reqs := disp.reqSnapshot()
	if len(reqs) != 1 {
		t.Fatalf("want 1 DispatchRequest call, got %d", len(reqs))
	}
	if reqs[0].method != "agent.applyConfig" {
		t.Errorf("method want=agent.applyConfig got=%s", reqs[0].method)
	}
	_ = waitResponseFrame
}

func TestClient_ServerRequest_DispatcherErr_ErrorFrameSent(t *testing.T) {
	disp := &recordingRequestDispatcher{wantErr: errors.New("apply-config failed: locked")}
	conns := make(chan *websocket.Conn, 1)
	outCh := make(chan []byte, 4)
	ms := newMockServer(t, nil,
		func(conn *websocket.Conn, data []byte) {
			var probe map[string]any
			_ = json.Unmarshal(data, &probe)
			if probe["method"] == "agent.hello" {
				replyHelloOK(conn, data)
				select {
				case conns <- conn:
				default:
				}
				return
			}
			if probe["method"] == "agent.heartbeat" {
				return
			}
			cp := make([]byte, len(data))
			copy(cp, data)
			select {
			case outCh <- cp:
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
		t.Fatal("未 ready")
	}
	conn := <-conns

	if err := conn.WriteMessage(
		websocket.TextMessage,
		[]byte(`{"jsonrpc":"2.0","id":7,"method":"agent.applyConfig","params":{}}`),
	); err != nil {
		t.Fatal(err)
	}

	var raw []byte
	select {
	case raw = <-outCh:
	case <-time.After(2 * time.Second):
		t.Fatal("2s 内未收到 agent 回包")
	}
	var resp map[string]any
	if err := json.Unmarshal(raw, &resp); err != nil {
		t.Fatalf("解析: %v raw=%s", err, string(raw))
	}
	if idNum, ok := resp["id"].(float64); !ok || int(idNum) != 7 {
		t.Errorf("id want=7 got=%v", resp["id"])
	}
	errObj, ok := resp["error"].(map[string]any)
	if !ok {
		t.Fatalf("want error field, got: %v", resp)
	}
	if _, ok := errObj["code"].(float64); !ok {
		t.Errorf("error.code missing or not number: %v", errObj["code"])
	}
	if msg, _ := errObj["message"].(string); msg == "" {
		t.Errorf("error.message empty")
	}
}

func TestClient_ServerRequest_PlainDispatcher_ReturnsMethodNotFound(t *testing.T) {
	// 普通 Dispatcher（只实现 Dispatch，不实现 DispatchRequest）收到 request
	// 应该回 MethodNotFound 错 response；client 不得 crash
	plain := &recordingDispatcher{}
	conns := make(chan *websocket.Conn, 1)
	outCh := make(chan []byte, 4)
	ms := newMockServer(t, nil,
		func(conn *websocket.Conn, data []byte) {
			var probe map[string]any
			_ = json.Unmarshal(data, &probe)
			if probe["method"] == "agent.hello" {
				replyHelloOK(conn, data)
				select {
				case conns <- conn:
				default:
				}
				return
			}
			if probe["method"] == "agent.heartbeat" {
				return
			}
			cp := make([]byte, len(data))
			copy(cp, data)
			select {
			case outCh <- cp:
			default:
			}
		},
	)
	cfg := baseConfig(ms.URL)
	cfg.Dispatcher = plain
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
		t.Fatal("未 ready")
	}
	conn := <-conns

	if err := conn.WriteMessage(
		websocket.TextMessage,
		[]byte(`{"jsonrpc":"2.0","id":9,"method":"agent.applyConfig","params":{}}`),
	); err != nil {
		t.Fatal(err)
	}

	var raw []byte
	select {
	case raw = <-outCh:
	case <-time.After(2 * time.Second):
		t.Fatal("2s 内未收到 agent 回包")
	}
	var resp map[string]any
	if err := json.Unmarshal(raw, &resp); err != nil {
		t.Fatalf("解析: %v", err)
	}
	errObj, ok := resp["error"].(map[string]any)
	if !ok {
		t.Fatalf("want error field got: %v", resp)
	}
	code, _ := errObj["code"].(float64)
	if code != -32601 {
		t.Errorf("error.code want=-32601 MethodNotFound got=%v", code)
	}
	_ = runDone
}
