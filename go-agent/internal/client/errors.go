// Package client 提供 energybot agent 到 nest-api 的 WebSocket 长连接实现。
//
// 单连接模型：
//   - Dial 成功后立即发 agent.hello；5s 内必须收到 success response，否则重连。
//   - 成功握手后启动 write goroutine（sendCh cap=16），SendHeartbeat 非阻塞入队。
//   - Close code 4001（replaced）/ 4003（license_revoked/customer_suspended）触发退出 42。
//   - 其他断连走 1s/2s/4s/8s/16s/32s/60s 指数退避重连。
//   - 不启用 WS 层 ping/pong，依赖应用层心跳与 TCP RST 检测断线。
package client

import "errors"

// ErrSendBufferFull 表示写 channel 已满或客户端尚未完成 hello 握手，
// SendHeartbeat 非阻塞返回此错；调用方应记录但不 panic。
var ErrSendBufferFull = errors.New("client: send buffer full, message dropped")

// ErrHelloTimeout 表示 hello 在 HelloTimeout 内未收到 success response。
// 上层 runOnce 捕获后走重连。
var ErrHelloTimeout = errors.New("client: hello timeout")

// ErrHelloRejected 表示 server 返回了 error response（非 close，但不接受 hello）。
var ErrHelloRejected = errors.New("client: hello rejected by server")
