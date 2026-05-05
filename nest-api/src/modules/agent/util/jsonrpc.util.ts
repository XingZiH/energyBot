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
  | { ok: true; kind: 'request'; msg: JsonRpcMessage }
  | {
      ok: true;
      kind: 'response';
      id: number | string;
      result?: unknown;
      error?: { code: number; message: string; data?: unknown };
    }
  | { ok: false; code: number };

export function parseJsonRpc(raw: string): ParseResult {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return { ok: false, code: JsonRpcErrorCode.ParseError };
  }
  if (!obj || typeof obj !== 'object')
    return { ok: false, code: JsonRpcErrorCode.InvalidRequest };
  const m = obj as Record<string, unknown>;
  if (m.jsonrpc !== '2.0')
    return { ok: false, code: JsonRpcErrorCode.InvalidRequest };

  const hasMethod = typeof m.method === 'string' && !!m.method;
  // 用 `in` 代替 hasOwnProperty：规避 @typescript-eslint/no-unsafe-assignment
  // 语义区别可忽略——JSON.parse 产出的对象不带继承属性，`in` 等价于 hasOwnProperty
  const hasResult = 'result' in m;
  const hasError = 'error' in m;

  // response: 带 id + 恰好一个 result/error，且无 method
  if (!hasMethod && (hasResult || hasError)) {
    if (hasResult && hasError)
      return { ok: false, code: JsonRpcErrorCode.InvalidRequest };
    const idRaw = m.id;
    if (idRaw === null || idRaw === undefined)
      return { ok: false, code: JsonRpcErrorCode.InvalidRequest };
    if (typeof idRaw !== 'number' && typeof idRaw !== 'string')
      return { ok: false, code: JsonRpcErrorCode.InvalidRequest };
    if (hasError) {
      const errObj = m.error as Record<string, unknown> | null;
      if (!errObj || typeof errObj !== 'object')
        return { ok: false, code: JsonRpcErrorCode.InvalidRequest };
      const code = errObj.code;
      const message = errObj.message;
      if (typeof code !== 'number' || typeof message !== 'string')
        return { ok: false, code: JsonRpcErrorCode.InvalidRequest };
      return {
        ok: true,
        kind: 'response',
        id: idRaw,
        error: {
          code,
          message,
          ...(errObj.data !== undefined ? { data: errObj.data } : {}),
        },
      };
    }
    return { ok: true, kind: 'response', id: idRaw, result: m.result };
  }

  // request / notification
  if (!hasMethod) return { ok: false, code: JsonRpcErrorCode.InvalidRequest };
  return {
    ok: true,
    kind: 'request',
    msg: {
      jsonrpc: '2.0',
      id: (m.id ?? null) as JsonRpcMessage['id'],
      method: m.method as string,
      params: m.params,
    },
  };
}

export function jsonRpcResult(
  id: JsonRpcMessage['id'],
  result: unknown,
): string {
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

/**
 * JSON-RPC 2.0 notification（服务端 → 客户端，无 id，不期望回包）。
 *
 * 使用场景（B3-T5）：主站下发 bot.start/bot.stop/bot.reload 到 agent。
 * agent 端 client.handleServerFrame 识别「无 id + method」→ 调 Dispatcher。
 */
export function jsonRpcNotification(method: string, params?: unknown): string {
  const frame: Record<string, unknown> = { jsonrpc: '2.0', method };
  if (params !== undefined) frame.params = params;
  return JSON.stringify(frame);
}

/**
 * JSON-RPC 2.0 request（服务端 → 客户端，带 id，期望 agent 回 response）。
 *
 * 使用场景（T11.10）：agent.applyConfig 需要等 agent 真的把 bot.db 写好
 * 才能下发 bot.start，否则两个 notification 并发 goroutine 导致 SQLite locked。
 * nest-api 发 request 后在 pending map 里挂 Promise，agent 回包后 resolve。
 */
export function jsonRpcRequest(
  id: number | string,
  method: string,
  params?: unknown,
): string {
  const frame: Record<string, unknown> = { jsonrpc: '2.0', id, method };
  if (params !== undefined) frame.params = params;
  return JSON.stringify(frame);
}
