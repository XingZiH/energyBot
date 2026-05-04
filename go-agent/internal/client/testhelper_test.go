package client

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/gorilla/websocket"
)

// mockServer 是一个基于 httptest 的 WS 伪造服务器，供客户端集成测试使用。
//
// 使用方式：newMockServer(t, onConnect, onMessage)
//   - onConnect 在 upgrade 成功后、进入读循环前被同步调用。
//     允许阻塞；传 nil 表示空操作。
//   - onMessage 对每条收到的 text frame 调一次；传 nil 表示空操作。
//
// 所有上下文都在 t.Cleanup 中清理，测试结束自动关停。
type mockServer struct {
	URL string // ws://host:port/agent

	httpServer *httptest.Server

	// 并发保护：Dial 头和连接数都从 handler goroutine 写入，断言从测试主线程读。
	mu           sync.Mutex
	lastHeaders  http.Header
	allHeaders   []http.Header
	dialCount    atomic.Int32

	// 在 cleanup 中关所有还活着的连接。
	connsMu sync.Mutex
	conns   []*websocket.Conn
}

func newMockServer(
	t *testing.T,
	onConnect func(conn *websocket.Conn),
	onMessage func(conn *websocket.Conn, data []byte),
) *mockServer {
	t.Helper()
	ms := &mockServer{}

	upgrader := websocket.Upgrader{
		// 跨域松绑，测试场景无需严格校验。
		CheckOrigin: func(r *http.Request) bool { return true },
	}

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// 记录本次 upgrade 的 headers，必须在 Upgrade 之前读，
		// 否则 hijack 后 r.Header 仍可用但规避不确定性。
		hCopy := r.Header.Clone()
		ms.mu.Lock()
		ms.lastHeaders = hCopy
		ms.allHeaders = append(ms.allHeaders, hCopy)
		ms.mu.Unlock()
		ms.dialCount.Add(1)

		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			// Upgrade 自身已写 HTTP 错误，打日志即可。
			t.Logf("mockServer: upgrade 失败: %v", err)
			return
		}
		ms.connsMu.Lock()
		ms.conns = append(ms.conns, conn)
		ms.connsMu.Unlock()

		if onConnect != nil {
			onConnect(conn)
		}

		// onConnect 可能已经 Close 了连接；若如此 ReadMessage 立即返 error，退出。
		for {
			_, data, err := conn.ReadMessage()
			if err != nil {
				return
			}
			if onMessage != nil {
				onMessage(conn, data)
			}
		}
	})

	ms.httpServer = httptest.NewServer(handler)
	// httptest 返 http://127.0.0.1:xxx；替换 scheme 为 ws，追加固定 path。
	ms.URL = "ws" + strings.TrimPrefix(ms.httpServer.URL, "http") + "/agent"

	t.Cleanup(func() {
		ms.connsMu.Lock()
		for _, c := range ms.conns {
			_ = c.Close()
		}
		ms.connsMu.Unlock()
		ms.httpServer.Close()
	})
	return ms
}

// headers 返回最近一次 upgrade 收到的 HTTP headers（并发安全）。
func (ms *mockServer) headers() http.Header {
	ms.mu.Lock()
	defer ms.mu.Unlock()
	if ms.lastHeaders == nil {
		return nil
	}
	return ms.lastHeaders.Clone()
}

// dials 返回至今累计的 upgrade 次数。
func (ms *mockServer) dials() int {
	return int(ms.dialCount.Load())
}
