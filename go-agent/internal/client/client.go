package client

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"github.com/anomalyco/energybot-agent/internal/auth"
	"github.com/anomalyco/energybot-agent/internal/botinfo"
	"github.com/anomalyco/energybot-agent/internal/host"
	"github.com/anomalyco/energybot-agent/internal/jsonrpc"
)

// helloID 是 hello 请求使用的固定 id（每个连接内 id 命名空间独立，
// 当前连接内只用这一个 id 即可）。
const helloID int64 = 1

// Client 是 energybot agent 到 nest-api 的 WebSocket 长连接客户端。
//
// 并发模型：
//   - Run goroutine：主循环，负责 Dial / hello / 读循环 / 重连。
//   - 单独的 write goroutine（由 runOnce 启停）：从 sendCh 读并写入 conn。
//   - SendHeartbeat 被任意调用方调用：非阻塞写入 sendCh，满则 ErrSendBufferFull。
//
// sendCh 生命周期：每轮 runOnce 在 hello OK 后创建、断连后置 nil 并 close。
// SendHeartbeat 通过 sendChMu 保护对 sendCh 的读写引用。
//
// ready channel 生命周期：New 里构造，首次 hello OK + sendCh 就绪时 close 一次
// 且永不 reset——语义为"agent 至少成功连过一次"。后续重连断连过程中 ready 保持
// closed 状态，heartbeat 无需感知重连细节。
type Client struct {
	cfg       Config
	parsedURL *url.URL

	// sendChMu 保护对 sendCh 指针的读写，确保 SendHeartbeat 与 runOnce 间无 race。
	sendChMu sync.RWMutex
	sendCh   chan []byte

	// ready 在首次 hello OK 后被 close；readyOnce 保证多轮重连时不重复 close。
	ready     chan struct{}
	readyOnce sync.Once
}

// New 构造 Client。返错场景：Config 必填字段缺失，或 APIURL 无法解析 / scheme 非 ws|wss / host 为空。
func New(cfg Config) (*Client, error) {
	if err := cfg.validate(); err != nil {
		return nil, err
	}
	cfg.fillDefaults()
	u, err := url.Parse(cfg.APIURL)
	if err != nil {
		return nil, fmt.Errorf("client: invalid APIURL %q: %w", cfg.APIURL, err)
	}
	if u.Scheme != "ws" && u.Scheme != "wss" {
		return nil, fmt.Errorf("client: invalid APIURL scheme %q, expect ws or wss", u.Scheme)
	}
	if u.Host == "" {
		return nil, fmt.Errorf("client: invalid APIURL %q: empty host", cfg.APIURL)
	}
	return &Client{cfg: cfg, parsedURL: u, ready: make(chan struct{})}, nil
}

// Ready 返一个 channel，在 client 首次进入 ready 状态（hello OK + sendCh 就绪）
// 时被 close。close 后永远保持 closed，不随断连 reset——语义为"agent 至少成功
// 连过一次"。调用方可 `<-cli.Ready()` 阻塞等待首次 ready，适合给 heartbeat 做
// 冷启动同步。
func (c *Client) Ready() <-chan struct{} {
	return c.ready
}

// Run 阻塞执行主循环直到 ctx 取消或 terminal close。
//
// 返回值：
//   - nil：ctx 取消、或 terminal close（4001/4003，已调用 ExitFunc）。
//   - 非 nil：不可恢复错误（当前实现下几乎不会发生，预留给未来）。
//
// 重连策略：
//   - attempt=0 不等；后续等 min(BackoffMin<<(n-1), BackoffMax)。
//   - Dial + hello 全部成功过的连接在断开后，attempt 重置为 0。
func (c *Client) Run(ctx context.Context) error {
	attempt := 0
	for {
		if err := ctx.Err(); err != nil {
			return nil
		}
		if attempt > 0 {
			d := c.backoff(attempt)
			c.cfg.Logger.Printf("client: 第 %d 次重连，等待 %v", attempt, d)
			select {
			case <-ctx.Done():
				return nil
			case <-time.After(d):
			}
		}
		attempt++

		closeCode, helloOK, err := c.runOnce(ctx)

		// ctx 取消：无论 err 如何都正常退出。
		if ctxErr := ctx.Err(); ctxErr != nil {
			return nil
		}

		// terminal close：调 ExitFunc(42) 后 return nil。
		if closeCode == 4001 || closeCode == 4003 {
			c.cfg.Logger.Printf(
				"client: terminal close %d，退出（exit 42）",
				closeCode,
			)
			c.cfg.ExitFunc(42)
			return nil
		}

		if err != nil {
			c.cfg.Logger.Printf("client: 连接错误（将重连）: %v", err)
		} else {
			c.cfg.Logger.Printf(
				"client: 连接关闭 code=%d（将重连）",
				closeCode,
			)
		}

		if helloOK {
			// hello 曾成功，视本轮为"正常运行后断线"，下次不退避。
			c.cfg.Logger.Printf("client: connection was ready, resetting backoff")
			attempt = 0
		}
	}
}

// runOnce 执行一轮 Dial + hello + 读循环，直到断连或 ctx 取消。
//
// 返回值：
//   - closeCode：WS close frame 的 code；无 close frame（TCP 断）视为 1006。
//     0 表示 ctx 取消或 Dial 前失败。
//   - helloOK：本轮是否完成 hello 握手并进入 ready。
//   - err：连接期间捕获的 error；ctx 取消场景返 nil。
func (c *Client) runOnce(ctx context.Context) (closeCode int, helloOK bool, err error) {
	u, err := url.Parse(c.cfg.APIURL)
	if err != nil {
		return 0, false, fmt.Errorf("parse APIURL: %w", err)
	}

	headers, err := c.buildHandshakeHeaders(u)
	if err != nil {
		return 0, false, fmt.Errorf("build headers: %w", err)
	}

	dialer := &websocket.Dialer{
		HandshakeTimeout: c.cfg.DialTimeout,
	}
	dialCtx, dialCancel := context.WithTimeout(ctx, c.cfg.DialTimeout)
	defer dialCancel()

	conn, _, err := dialer.DialContext(dialCtx, c.cfg.APIURL, headers)
	if err != nil {
		return 0, false, fmt.Errorf("dial: %w", err)
	}
	c.cfg.Logger.Printf("client: connected to %s", c.cfg.APIURL)
	// defer close 兜底；正常路径会在读循环退出时关。
	defer func() {
		_ = conn.Close()
	}()

	// --- 握手阶段：hello 不走 sendCh，直接写 conn 独占使用 ---
	helloBody, err := c.buildHelloRequest()
	if err != nil {
		return 0, false, fmt.Errorf("build hello: %w", err)
	}
	// 给 hello 写设置一个短超时，防止极端 TCP 栈阻塞卡死。
	_ = conn.SetWriteDeadline(time.Now().Add(c.cfg.HelloTimeout))
	if err := conn.WriteMessage(websocket.TextMessage, helloBody); err != nil {
		return 0, false, fmt.Errorf("write hello: %w", err)
	}
	_ = conn.SetWriteDeadline(time.Time{})

	// 读 hello 响应：起一个小 goroutine 读取一条消息，主线程用 select 等。
	type readResult struct {
		data []byte
		err  error
	}
	helloCh := make(chan readResult, 1)
	go func() {
		_, data, err := conn.ReadMessage()
		helloCh <- readResult{data: data, err: err}
	}()

	select {
	case <-ctx.Done():
		_ = conn.Close()
		<-helloCh // 等 reader 退出
		return 0, false, nil
	case <-time.After(c.cfg.HelloTimeout):
		_ = conn.Close()
		<-helloCh
		return 0, false, ErrHelloTimeout
	case res := <-helloCh:
		if res.err != nil {
			code := extractCloseCode(res.err)
			return code, false, fmt.Errorf("hello read: %w", res.err)
		}
		var resp jsonrpc.Response
		if err := json.Unmarshal(res.data, &resp); err != nil {
			return 0, false, fmt.Errorf("hello decode: %w", err)
		}
		if resp.Error != nil {
			return 0, false, fmt.Errorf(
				"%w: code=%d msg=%q",
				ErrHelloRejected, resp.Error.Code, resp.Error.Message,
			)
		}
		if resp.ID == nil || resp.ID.IsString || resp.ID.Num != helloID {
			return 0, false, fmt.Errorf(
				"hello response id mismatch: got %+v", resp.ID,
			)
		}
		// hello OK：进入 ready 阶段。
	}

	// --- ready 阶段：启动 write goroutine + 继续读循环 ---
	helloOK = true

	sendCh := make(chan []byte, c.cfg.SendBuffer)
	// stopCh 用来通知 writeLoop 退出；close 它必然能唤醒阻塞在 select 上的 writer，
	// 且不会像 close(sendCh) 那样导致并发 SendHeartbeat 写入 closed channel panic。
	stopCh := make(chan struct{})

	c.sendChMu.Lock()
	c.sendCh = sendCh
	c.sendChMu.Unlock()

	c.cfg.Logger.Printf("client: ready, send_buffer=%d", c.cfg.SendBuffer)

	// 首次 ready 时 close(c.ready)，通知外部等待者（如 heartbeat）。
	// readyOnce 保证多轮重连场景下不会重复 close 造成 panic。
	c.readyOnce.Do(func() {
		close(c.ready)
	})

	// 退出清理：先切断 sendCh 外部引用（让后续 SendHeartbeat 返 ErrSendBufferFull），
	// 然后 close(stopCh) 让 writeLoop 退出；此时不 close(sendCh) 避免 race。
	cleanupOnce := func() func() {
		var once sync.Once
		return func() {
			once.Do(func() {
				c.sendChMu.Lock()
				c.sendCh = nil
				c.sendChMu.Unlock()
				close(stopCh)
			})
		}
	}()
	defer cleanupOnce()

	// write goroutine 退出信号。
	writeDone := make(chan struct{})
	go c.writeLoop(conn, sendCh, stopCh, writeDone)

	// ctx 监听 goroutine：ctx 取消时关 conn 唤醒 ReadMessage。
	// 用 stopCh 作为自身退出信号（读循环正常结束时也会 close(stopCh)）。
	ctxWatchDone := make(chan struct{})
	go func() {
		defer close(ctxWatchDone)
		select {
		case <-ctx.Done():
			_ = conn.Close()
		case <-stopCh:
		}
	}()

	// 主读循环：server 推消息或 close。
	// B1：仅处理 response（含 hello ack 已在上方 helloCh 处理，此处应不再有 hello）
	// B3-T5：支持 server 下行 notification（无 id），调 Dispatcher 转发给 supervisor。
	for {
		_, data, readErr := conn.ReadMessage()
		if readErr != nil {
			code := extractCloseCode(readErr)
			// 触发 cleanup：切断 sendCh + 关 stopCh。
			cleanupOnce()
			// 关 conn 让 writeLoop 若正卡在 WriteMessage 也能醒（EPIPE）。
			_ = conn.Close()
			// 等 writeLoop 和 ctxWatch 退出，保证 race-clean。
			<-writeDone
			<-ctxWatchDone
			// ctx cancel 触发的 abnormal close 当作正常退出。
			if ctx.Err() != nil {
				return 0, helloOK, nil
			}
			if code == websocket.CloseNormalClosure {
				// 服务端主动优雅关闭，视作可重连。
				return code, helloOK, nil
			}
			return code, helloOK, readErr
		}
		c.handleServerFrame(data)
	}
}

// handleServerFrame 处理一条服务端下行消息。
//
// JSON-RPC 2.0 语义：
//   - 带 id + method → 请求（T11.10：调 RequestDispatcher 同步拿 result，回 response）
//   - 带 id + result/error → 响应（agent 不会收到 server 回它自己的 response；
//     当前 agent 侧 hello/heartbeat 的 response 在 helloCh/写路径处理。
//     这里兜底忽略。）
//   - 无 id + method → notification（B3-T5：转给 Dispatcher）
func (c *Client) handleServerFrame(data []byte) {
	var req jsonrpc.Request
	if err := json.Unmarshal(data, &req); err != nil {
		c.cfg.Logger.Printf("client: 下行消息解析失败，已丢弃: %v", err)
		return
	}
	if req.Method == "" {
		// 非请求/通知——可能是响应或无意义消息；忽略。
		return
	}
	if req.ID != nil {
		// server → agent request：需要回 response。
		c.handleServerRequest(req)
		return
	}
	// notification：dispatch 给外部
	if c.cfg.Dispatcher == nil {
		c.cfg.Logger.Printf("client: 未设 Dispatcher，丢弃 notification method=%s", req.Method)
		return
	}
	if err := c.cfg.Dispatcher.Dispatch(req.Method, req.Params); err != nil {
		c.cfg.Logger.Printf("client: Dispatcher 处理 method=%s 失败: %v", req.Method, err)
	}
}

// handleServerRequest 处理 server 下行 JSON-RPC request（T11.10）。
//
// 调用 RequestDispatcher（若实现）同步拿 result 或 error，构造 response
// 帧写入 sendCh。若 Dispatcher 未实现 RequestDispatcher，回 -32601
// MethodNotFound 错，避免 server 端 callAgent Promise 悬挂至超时。
//
// 非阻塞：DispatchRequest 本身可能耗时（exec 子进程），开 goroutine 避免
// 阻塞 client 主读循环。
func (c *Client) handleServerRequest(req jsonrpc.Request) {
	go func() {
		id := req.ID
		reqDisp, ok := c.cfg.Dispatcher.(RequestDispatcher)
		if !ok {
			c.cfg.Logger.Printf(
				"client: Dispatcher 未实现 RequestDispatcher，回 MethodNotFound method=%s",
				req.Method,
			)
			c.sendResponseError(id, -32601, fmt.Sprintf("method %s not found", req.Method))
			return
		}
		result, err := reqDisp.DispatchRequest(req.Method, req.Params)
		if err != nil {
			c.cfg.Logger.Printf(
				"client: DispatchRequest method=%s 失败: %v",
				req.Method, err,
			)
			c.sendResponseError(id, -40001, err.Error())
			return
		}
		c.sendResponseResult(id, result)
	}()
}

// sendResponseResult 把 result 序列化为 JSON-RPC response 帧写入 sendCh。
// 若 sendCh 已满或连接已断（ch=nil），日志记录丢弃，不阻塞。
func (c *Client) sendResponseResult(id *jsonrpc.RequestID, result any) {
	resp := jsonrpc.Response{JSONRPC: "2.0", ID: id, Result: mustMarshalRaw(result)}
	body, err := json.Marshal(resp)
	if err != nil {
		c.cfg.Logger.Printf("client: 序列化 response result 失败: %v", err)
		return
	}
	c.enqueueFrame(body)
}

// sendResponseError 把 error 序列化为 JSON-RPC response 帧写入 sendCh。
func (c *Client) sendResponseError(id *jsonrpc.RequestID, code int, message string) {
	resp := jsonrpc.Response{
		JSONRPC: "2.0",
		ID:      id,
		Error:   &jsonrpc.ErrorObject{Code: code, Message: message},
	}
	body, err := json.Marshal(resp)
	if err != nil {
		c.cfg.Logger.Printf("client: 序列化 response error 失败: %v", err)
		return
	}
	c.enqueueFrame(body)
}

// enqueueFrame 把 raw frame 写入 sendCh（非阻塞）。
// sendCh 已 close 或满 → 记日志丢弃，避免阻塞 server request 处理 goroutine。
func (c *Client) enqueueFrame(body []byte) {
	c.sendChMu.RLock()
	ch := c.sendCh
	c.sendChMu.RUnlock()
	if ch == nil {
		c.cfg.Logger.Printf("client: response 帧无处可发（连接已断），已丢弃")
		return
	}
	select {
	case ch <- body:
	default:
		c.cfg.Logger.Printf("client: sendCh 满（SendBuffer=%d），response 帧已丢弃", c.cfg.SendBuffer)
	}
}

// mustMarshalRaw 把任意 any 序列化为 json.RawMessage。
// 失败时返回 "null"（配合 jsonrpc.Response.Result 的 omitempty 不会生效，
// 所以要保证至少是合法 JSON 字面量）。
func mustMarshalRaw(v any) json.RawMessage {
	b, err := json.Marshal(v)
	if err != nil {
		return json.RawMessage(`null`)
	}
	return json.RawMessage(b)
}

// writeLoop 从 sendCh 连续读取 bytes 写入 conn。
// 退出条件：stopCh 关闭、或 WriteMessage 返错（conn 已断）。
// sendCh 本身永不被 close，避免与并发 SendHeartbeat 产生 send-on-closed 的 race。
func (c *Client) writeLoop(
	conn *websocket.Conn,
	sendCh <-chan []byte,
	stopCh <-chan struct{},
	done chan<- struct{},
) {
	defer close(done)
	for {
		select {
		case <-stopCh:
			return
		case data := <-sendCh:
			if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
				c.cfg.Logger.Printf("client: 写失败: %v", err)
				return
			}
		}
	}
}

// SendHeartbeat 编码 agent.heartbeat notification 并非阻塞入队。
// 未进入 ready 状态（未完成 hello 或已断开）时返 ErrSendBufferFull。
//
// botInfo 可为 nil（agent 不管理 bot 时），心跳 payload 将省略 bot 字段。
func (c *Client) SendHeartbeat(m host.Metrics, botInfo *botinfo.BotInfo) error {
	body, err := buildHeartbeatRequest(m, botInfo)
	if err != nil {
		return fmt.Errorf("build heartbeat: %w", err)
	}
	c.sendChMu.RLock()
	ch := c.sendCh
	c.sendChMu.RUnlock()
	if ch == nil {
		return ErrSendBufferFull
	}
	select {
	case ch <- body:
		return nil
	default:
		return ErrSendBufferFull
	}
}

// backoff 计算第 n 次重连的等待时长：
//   - n <= 0 返 0
//   - 1 → BackoffMin，2 → 2*BackoffMin，... 上限 BackoffMax
func (c *Client) backoff(n int) time.Duration {
	if n <= 0 {
		return 0
	}
	d := c.cfg.BackoffMin
	for i := 1; i < n; i++ {
		d *= 2
		if d >= c.cfg.BackoffMax {
			return c.cfg.BackoffMax
		}
	}
	return d
}

// buildHandshakeHeaders 构造 5 个 X-* headers。
// timestamp 使用 now unix ms；nonce 为 16 字节随机 hex（32 字符）。
// 签名使用 auth.Sign，method=CONNECT、path=u.Path、body 空。
func (c *Client) buildHandshakeHeaders(u *url.URL) (http.Header, error) {
	ts := strconv.FormatInt(time.Now().UnixMilli(), 10)
	nonce, err := randomHexNonce(16)
	if err != nil {
		return nil, fmt.Errorf("nonce: %w", err)
	}
	sig := auth.Sign(auth.SignParams{
		Secret:    c.cfg.LicenseSecret,
		Method:    "CONNECT",
		Path:      u.Path,
		Timestamp: ts,
		Nonce:     nonce,
		Body:      nil,
	})
	h := http.Header{}
	h.Set("X-License-Key", c.cfg.LicenseKey)
	h.Set("X-Timestamp", ts)
	h.Set("X-Nonce", nonce)
	h.Set("X-Agent-Version", c.cfg.AgentVersion)
	h.Set("X-Signature", sig)
	return h, nil
}

// randomHexNonce 返回 n 字节随机源的 lowercase hex（长度 2n）。
func randomHexNonce(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// buildHelloRequest 序列化 agent.hello 请求（带 helloID）。
func (c *Client) buildHelloRequest() ([]byte, error) {
	info, err := c.cfg.Collector.Hello()
	if err != nil {
		return nil, fmt.Errorf("collector.Hello: %w", err)
	}
	params := map[string]any{
		"agent_version": c.cfg.AgentVersion,
		"host_name":     info.HostName,
		"os_info":       info.OSInfo,
		"boot_time":     info.BootTime.UnixMilli(),
	}
	paramsRaw, err := json.Marshal(params)
	if err != nil {
		return nil, err
	}
	req := jsonrpc.Request{
		JSONRPC: "2.0",
		ID:      jsonrpc.IntID(helloID),
		Method:  "agent.hello",
		Params:  paramsRaw,
	}
	return json.Marshal(req)
}

// buildHeartbeatRequest 序列化 agent.heartbeat 请求（带递增 id）。
//
// spec 定义 heartbeat 为 request（带 id，服务端需回 ack），不是 notification。
// 服务端 handleMessage 对 notification（id=nil）直接丢弃（防御性过滤），
// 所以这里必须带 id 才能触达 handleAgentHeartbeat 真正写入 last_heartbeat_at。
// id 使用单调递增值（基于 nanosecond 时间戳的高 31 位），保证连接生命周期内
// 全局唯一；agent 不等 ack，纯单向汇报。
//
// botInfo 非 nil 时，会以 "bot" 键嵌入 params 顶层；为 nil 时 payload 完全省略
// bot 字段，保持与未接入 supervisor 的旧 agent 协议兼容。
func buildHeartbeatRequest(m host.Metrics, botInfo *botinfo.BotInfo) ([]byte, error) {
	params := map[string]any{
		"uptime_seconds":  m.UptimeSeconds,
		"cpu_percent":     m.CPUPercent,
		"mem_used_bytes":  m.MemUsedBytes,
		"mem_total_bytes": m.MemTotalBytes,
		"loadavg_1":       m.Loadavg1,
	}
	if botInfo != nil {
		params["bot"] = botInfo
	}
	paramsRaw, err := json.Marshal(params)
	if err != nil {
		return nil, err
	}
	// id 基于 nanosecond，避免与 helloID(=1) 冲突
	hbID := time.Now().UnixNano()
	req := jsonrpc.Request{
		JSONRPC: "2.0",
		ID:      jsonrpc.IntID(hbID),
		Method:  "agent.heartbeat",
		Params:  paramsRaw,
	}
	return json.Marshal(req)
}

// extractCloseCode 从 ReadMessage 错误中提取 WS close code：
//   - *websocket.CloseError → 返其 Code
//   - 其他（TCP RST、EOF 等）→ 返 1006（abnormal closure）
func extractCloseCode(err error) int {
	var ce *websocket.CloseError
	if errors.As(err, &ce) {
		return ce.Code
	}
	return websocket.CloseAbnormalClosure
}
