// Package jsonrpc 实现 JSON-RPC 2.0 over WebSocket 的编解码。
//
// 与 Nest 端 nest-api/src/modules/agent/util/jsonrpc.util.ts 对端兼容。
package jsonrpc

import (
	"encoding/json"
	"fmt"
)

// Request 表示 JSON-RPC 2.0 请求或通知。
//
// ID 为 nil 时表示 notification（不期望 response）。
// Params 使用 json.RawMessage 延迟反序列化，由上层按 Method 决定目标类型。
type Request struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      *RequestID      `json:"id,omitempty"` // nil/缺省为 notification
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

// Response 表示 JSON-RPC 2.0 响应。Result 和 Error 互斥（恰有一个非空）。
type Response struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      *RequestID      `json:"id"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *ErrorObject    `json:"error,omitempty"`
}

// ErrorObject 是 JSON-RPC 2.0 错误体。
type ErrorObject struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data,omitempty"`
}

// RequestID 允许 id 为 number 或 string（JSON-RPC 2.0 规范允许两者）。
//
// IsString 决定序列化时采用哪个字段：
//   - IsString=false：输出 Num（int64）
//   - IsString=true：输出 Str（string）
//
// notification 通过 Request.ID = nil 表达，而非 id:null。
type RequestID struct {
	IsString bool
	Num      int64
	Str      string
}

// MarshalJSON 按 IsString 选择 number 或 string 形式输出。
func (id RequestID) MarshalJSON() ([]byte, error) {
	if id.IsString {
		return json.Marshal(id.Str)
	}
	return json.Marshal(id.Num)
}

// UnmarshalJSON 先尝试解析为 number，失败则尝试 string；
// 其他形式（null、bool、对象等）返回错误。
func (id *RequestID) UnmarshalJSON(b []byte) error {
	var n int64
	if err := json.Unmarshal(b, &n); err == nil {
		id.IsString = false
		id.Num = n
		return nil
	}
	var s string
	if err := json.Unmarshal(b, &s); err == nil {
		id.IsString = true
		id.Str = s
		return nil
	}
	return fmt.Errorf("jsonrpc: id must be number or string, got %s", string(b))
}

// IntID 构造一个 number 类型的 RequestID。
func IntID(n int64) *RequestID {
	return &RequestID{IsString: false, Num: n}
}

// StrID 构造一个 string 类型的 RequestID。
func StrID(s string) *RequestID {
	return &RequestID{IsString: true, Str: s}
}
