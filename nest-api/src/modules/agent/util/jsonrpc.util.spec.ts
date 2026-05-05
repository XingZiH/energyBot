import {
  parseJsonRpc,
  jsonRpcError,
  jsonRpcResult,
  jsonRpcRequest,
  AgentRpcErrorCode,
  JsonRpcErrorCode,
} from './jsonrpc.util';

describe('parseJsonRpc', () => {
  it('合法请求返回 method + id + params', () => {
    const r = parseJsonRpc(
      '{"jsonrpc":"2.0","id":1,"method":"agent.hello","params":{"v":"1.0"}}',
    );
    expect(r.ok).toBe(true);
    if (r.ok && r.kind === 'request') {
      expect(r.msg).toEqual({
        jsonrpc: '2.0',
        id: 1,
        method: 'agent.hello',
        params: { v: '1.0' },
      });
    } else {
      fail('expected request');
    }
  });

  it('缺 method 且缺 result/error 返回 InvalidRequest', () => {
    const r = parseJsonRpc('{"jsonrpc":"2.0","id":1}');
    expect(r).toEqual({ ok: false, code: -32600 });
  });

  it('非法 JSON 返回 ParseError', () => {
    const r = parseJsonRpc('not json');
    expect(r).toEqual({ ok: false, code: -32700 });
  });

  it('notification（无 id）合法', () => {
    const r = parseJsonRpc(
      '{"jsonrpc":"2.0","method":"agent.heartbeat","params":{}}',
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.kind).toBe('request');
  });

  it('response（带 id + result）返回 kind=response', () => {
    const r = parseJsonRpc('{"jsonrpc":"2.0","id":7,"result":{"ok":true}}');
    expect(r.ok).toBe(true);
    if (r.ok && r.kind === 'response') {
      expect(r.id).toBe(7);
      expect(r.result).toEqual({ ok: true });
      expect(r.error).toBeUndefined();
    } else {
      fail('expected response');
    }
  });

  it('response（带 id + error）返回 kind=response + error', () => {
    const r = parseJsonRpc(
      '{"jsonrpc":"2.0","id":7,"error":{"code":-40001,"message":"bad"}}',
    );
    expect(r.ok).toBe(true);
    if (r.ok && r.kind === 'response') {
      expect(r.id).toBe(7);
      expect(r.result).toBeUndefined();
      expect(r.error).toEqual({ code: -40001, message: 'bad' });
    } else {
      fail('expected response');
    }
  });

  it('同时有 result 和 error 视为 InvalidRequest', () => {
    const r = parseJsonRpc(
      '{"jsonrpc":"2.0","id":7,"result":1,"error":{"code":0,"message":""}}',
    );
    expect(r).toEqual({ ok: false, code: -32600 });
  });
});

describe('jsonRpcRequest', () => {
  it('输出带 id+method+params 的 request 帧', () => {
    const s = jsonRpcRequest(99, 'agent.applyConfig', { licenseId: 4 });
    expect(JSON.parse(s)).toEqual({
      jsonrpc: '2.0',
      id: 99,
      method: 'agent.applyConfig',
      params: { licenseId: 4 },
    });
  });

  it('params 省略时不出现 params 字段', () => {
    const s = jsonRpcRequest(1, 'ping');
    expect(JSON.parse(s)).toEqual({ jsonrpc: '2.0', id: 1, method: 'ping' });
  });
});

describe('jsonRpcError / jsonRpcResult', () => {
  it('jsonRpcError 输出正确结构', () => {
    const s = jsonRpcError(42, AgentRpcErrorCode.BAD_REQUEST, 'bye');
    expect(JSON.parse(s)).toEqual({
      jsonrpc: '2.0',
      id: 42,
      error: { code: -40001, message: 'bye' },
    });
  });

  it('jsonRpcResult 输出正确结构', () => {
    const s = jsonRpcResult(42, { ok: true });
    expect(JSON.parse(s)).toEqual({
      jsonrpc: '2.0',
      id: 42,
      result: { ok: true },
    });
  });
});

describe('AgentRpcErrorCode 常量', () => {
  it('业务错误码值对齐计划 D5 语义', () => {
    expect(AgentRpcErrorCode).toEqual({
      BAD_REQUEST: -40001,
      LICENSE_REVOKED: -40003,
      FLAPPING: -40013,
      NOT_READY: -40029,
      REPLACED: -40041,
    });
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
