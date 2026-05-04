import { parseJsonRpc, jsonRpcError, jsonRpcResult, AgentRpcErrorCode, JsonRpcErrorCode } from './jsonrpc.util';

describe('parseJsonRpc', () => {
  it('合法请求返回 method + id + params', () => {
    const r = parseJsonRpc('{"jsonrpc":"2.0","id":1,"method":"agent.hello","params":{"v":"1.0"}}');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.msg).toEqual({ jsonrpc: '2.0', id: 1, method: 'agent.hello', params: { v: '1.0' } });
    }
  });

  it('缺 method 返回 InvalidRequest', () => {
    const r = parseJsonRpc('{"jsonrpc":"2.0","id":1}');
    expect(r).toEqual({ ok: false, code: -32600 });
  });

  it('非法 JSON 返回 ParseError', () => {
    const r = parseJsonRpc('not json');
    expect(r).toEqual({ ok: false, code: -32700 });
  });

  it('notification（无 id）合法', () => {
    const r = parseJsonRpc('{"jsonrpc":"2.0","method":"agent.heartbeat","params":{}}');
    expect(r.ok).toBe(true);
  });
});

describe('jsonRpcError / jsonRpcResult', () => {
  it('jsonRpcError 输出正确结构', () => {
    const s = jsonRpcError(42, AgentRpcErrorCode.LICENSE_REVOKED, 'bye');
    expect(JSON.parse(s)).toEqual({
      jsonrpc: '2.0', id: 42,
      error: { code: -40001, message: 'bye' },
    });
  });

  it('jsonRpcResult 输出正确结构', () => {
    const s = jsonRpcResult(42, { ok: true });
    expect(JSON.parse(s)).toEqual({ jsonrpc: '2.0', id: 42, result: { ok: true } });
  });
});

describe('JsonRpcErrorCode 常量', () => {
  it('数值符合 JSON-RPC 2.0 规范', () => {
    expect(JsonRpcErrorCode).toEqual({
      ParseError: -32700,
      InvalidRequest: -32600,
      MethodNotFound: -32601,
      InvalidParams: -32602,
      InternalError: -32603,
    });
  });
});
