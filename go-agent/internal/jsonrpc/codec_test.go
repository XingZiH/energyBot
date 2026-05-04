package jsonrpc

import (
	"encoding/json"
	"testing"
)

// Case 1: Request 序列化 —— number id + params
func TestRequest_Marshal_WithNumberID(t *testing.T) {
	req := Request{
		JSONRPC: "2.0",
		ID:      IntID(1),
		Method:  "agent.hello",
		Params:  json.RawMessage(`{"host":"a"}`),
	}

	b, err := json.Marshal(req)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var got map[string]any
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatalf("unmarshal to map: %v", err)
	}

	if got["jsonrpc"] != "2.0" {
		t.Errorf("jsonrpc = %v, want 2.0", got["jsonrpc"])
	}
	// encoding/json 反序列化 number 到 any 走 float64
	if n, ok := got["id"].(float64); !ok || n != 1 {
		t.Errorf("id = %v (%T), want 1", got["id"], got["id"])
	}
	if got["method"] != "agent.hello" {
		t.Errorf("method = %v, want agent.hello", got["method"])
	}
	params, ok := got["params"].(map[string]any)
	if !ok {
		t.Fatalf("params not object: %v", got["params"])
	}
	if params["host"] != "a" {
		t.Errorf("params.host = %v, want a", params["host"])
	}
}

// Case 2: Notification —— ID 为 nil 时 id 字段应被省略
func TestRequest_Marshal_AsNotification(t *testing.T) {
	req := Request{
		JSONRPC: "2.0",
		Method:  "agent.ping",
	}

	b, err := json.Marshal(req)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var got map[string]any
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatalf("unmarshal to map: %v", err)
	}

	if _, exists := got["id"]; exists {
		t.Errorf("notification must omit id, got: %v", got["id"])
	}
	if got["method"] != "agent.ping" {
		t.Errorf("method = %v, want agent.ping", got["method"])
	}
}

// Case 3: 反序列化 string id
func TestRequest_Unmarshal_StringID(t *testing.T) {
	raw := []byte(`{"jsonrpc":"2.0","id":"abc","method":"agent.heartbeat"}`)

	var req Request
	if err := json.Unmarshal(raw, &req); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if req.ID == nil {
		t.Fatal("ID is nil")
	}
	if !req.ID.IsString {
		t.Errorf("IsString = false, want true")
	}
	if req.ID.Str != "abc" {
		t.Errorf("Str = %q, want abc", req.ID.Str)
	}
	if req.Method != "agent.heartbeat" {
		t.Errorf("Method = %q, want agent.heartbeat", req.Method)
	}
}

// Case 4: 反序列化 number id
func TestRequest_Unmarshal_NumberID(t *testing.T) {
	raw := []byte(`{"jsonrpc":"2.0","id":42,"method":"x"}`)

	var req Request
	if err := json.Unmarshal(raw, &req); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if req.ID == nil {
		t.Fatal("ID is nil")
	}
	if req.ID.IsString {
		t.Errorf("IsString = true, want false")
	}
	if req.ID.Num != 42 {
		t.Errorf("Num = %d, want 42", req.ID.Num)
	}
}

// Case 5: Response 成功 —— 有 result、无 error
func TestResponse_Marshal_Success(t *testing.T) {
	resp := Response{
		JSONRPC: "2.0",
		ID:      IntID(1),
		Result:  json.RawMessage(`{"ok":true}`),
	}

	b, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var got map[string]any
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatalf("unmarshal to map: %v", err)
	}

	if _, exists := got["result"]; !exists {
		t.Errorf("missing result field")
	}
	if _, exists := got["error"]; exists {
		t.Errorf("success response must not have error field, got: %v", got["error"])
	}
	result, ok := got["result"].(map[string]any)
	if !ok {
		t.Fatalf("result not object")
	}
	if result["ok"] != true {
		t.Errorf("result.ok = %v, want true", result["ok"])
	}
}

// Case 6: Response 错误 —— 有 error、无 result
func TestResponse_Marshal_Error(t *testing.T) {
	resp := Response{
		JSONRPC: "2.0",
		ID:      IntID(1),
		Error: &ErrorObject{
			Code:    -40001,
			Message: "bad request",
		},
	}

	b, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var got map[string]any
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatalf("unmarshal to map: %v", err)
	}

	if _, exists := got["result"]; exists {
		t.Errorf("error response must not have result field, got: %v", got["result"])
	}
	errObj, ok := got["error"].(map[string]any)
	if !ok {
		t.Fatalf("error not object, got: %v", got["error"])
	}
	if code, _ := errObj["code"].(float64); code != -40001 {
		t.Errorf("error.code = %v, want -40001", errObj["code"])
	}
	if errObj["message"] != "bad request" {
		t.Errorf("error.message = %v, want bad request", errObj["message"])
	}
}

// Case 7: 错误码常量值锁定 —— 防未来有人改
func TestErrorCodes_AgentRpcParity(t *testing.T) {
	// JSON-RPC 2.0 标准错误码
	cases := []struct {
		name string
		got  int
		want int
	}{
		{"CodeParseError", CodeParseError, -32700},
		{"CodeInvalidRequest", CodeInvalidRequest, -32600},
		{"CodeMethodNotFound", CodeMethodNotFound, -32601},
		{"CodeInvalidParams", CodeInvalidParams, -32602},
		{"CodeInternalError", CodeInternalError, -32603},
		// Energybot Agent RPC 错误码
		{"CodeBadRequest", CodeBadRequest, -40001},
		{"CodeLicenseRevoked", CodeLicenseRevoked, -40003},
		{"CodeFlapping", CodeFlapping, -40013},
		{"CodeNotReady", CodeNotReady, -40029},
		{"CodeReplaced", CodeReplaced, -40041},
	}
	for _, c := range cases {
		if c.got != c.want {
			t.Errorf("%s = %d, want %d", c.name, c.got, c.want)
		}
	}
}
