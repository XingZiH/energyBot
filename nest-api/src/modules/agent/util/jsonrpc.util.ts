/**
 * JSON-RPC 2.0 编解码小工具。仅覆盖 AgentGateway 用到的子集：
 * - request（含 id）+ notification（无 id）
 * - 单条，不支持 batch（agent 不需要）
 */

export interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: unknown;
}

/** 标准错误码（JSON-RPC 2.0 约定） */
export const JsonRpcErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
} as const;

/**
 * B1 自定义业务错误码（-40xxx 段）。
 *
 * 语义与值对齐 AgentGateway 决策表（计划 D5）：
 *   BAD_REQUEST        客户端协议/参数/签名/时钟/nonce 等可改正错误（WS close 1008）
 *   LICENSE_REVOKED    license/customer 状态类错误，客户端应退出不重连（WS close 4003）
 *   FLAPPING           300ms 抗抖动，新连接被拒（WS close 4013）
 *   NOT_READY          gateway 级状态机错位（未 hello 发心跳 / 已 hello 重发 hello）
 *   REPLACED           后来者赢，旧连接被替换（**保留给协议文档；当前实现只用 WS close 4001，不发此 JSON-RPC 码**）
 */
export const AgentRpcErrorCode = {
  BAD_REQUEST: -40001,
  LICENSE_REVOKED: -40003,
  FLAPPING: -40013,
  NOT_READY: -40029,
  REPLACED: -40041,
} as const;

export type ParseResult =
  | { ok: true; msg: JsonRpcMessage }
  | { ok: false; code: number };

export function parseJsonRpc(raw: string): ParseResult {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return { ok: false, code: JsonRpcErrorCode.ParseError };
  }
  if (!obj || typeof obj !== 'object') return { ok: false, code: JsonRpcErrorCode.InvalidRequest };
  const m = obj as Record<string, unknown>;
  if (m.jsonrpc !== '2.0') return { ok: false, code: JsonRpcErrorCode.InvalidRequest };
  if (typeof m.method !== 'string' || !m.method) return { ok: false, code: JsonRpcErrorCode.InvalidRequest };
  return {
    ok: true,
    msg: {
      jsonrpc: '2.0',
      id: (m.id ?? null) as JsonRpcMessage['id'],
      method: m.method,
      params: m.params,
    },
  };
}

export function jsonRpcResult(id: JsonRpcMessage['id'], result: unknown): string {
  return JSON.stringify({ jsonrpc: '2.0', id, result });
}

export function jsonRpcError(
  id: JsonRpcMessage['id'],
  code: number,
  message: string,
  data?: unknown,
): string {
  const err: Record<string, unknown> = { code, message };
  if (data !== undefined) err.data = data;
  return JSON.stringify({ jsonrpc: '2.0', id, error: err });
}
