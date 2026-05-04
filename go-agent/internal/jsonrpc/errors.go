package jsonrpc

// JSON-RPC 2.0 与 Energybot Agent RPC 错误码常量。
//
// 与 Nest 端 nest-api/src/modules/agent/util/jsonrpc.util.ts 中
// JsonRpcErrorCode / AgentRpcErrorCode 对齐。
const (
	// 标准 JSON-RPC 2.0 错误码
	CodeParseError     = -32700
	CodeInvalidRequest = -32600
	CodeMethodNotFound = -32601
	CodeInvalidParams  = -32602
	CodeInternalError  = -32603

	// Energybot Agent RPC 错误码（与 Nest 端 AgentRpcErrorCode 对齐）
	CodeBadRequest     = -40001
	CodeLicenseRevoked = -40003
	CodeFlapping       = -40013
	CodeNotReady       = -40029
	CodeReplaced       = -40041
)
