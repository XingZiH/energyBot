import { Logger } from '@nestjs/common';
import { OnGatewayConnection, WebSocketGateway } from '@nestjs/websockets';
import { IncomingMessage } from 'http';
import { WebSocket } from 'ws';
import { LicenseService } from '../license/license.service';
import { PrecheckErrorCode } from '../license/dto/license.dto';
import { AgentRegistry } from './agent.registry';
import { AgentService, HeartbeatMetrics } from './agent.service';
import {
  AgentRpcErrorCode,
  JsonRpcErrorCode,
  JsonRpcMessage,
  jsonRpcError,
  jsonRpcResult,
  parseJsonRpc,
} from './util/jsonrpc.util';

/**
 * AgentGateway —— B1 子系统 WebSocket 入口。
 *
 * 职责：
 *  1. handleConnection 内手工读 HTTP Upgrade headers 复用 license precheck 签名
 *  2. 成功握手后，ws.on('close' / 'message') 手工绑定（不用 @nestjs/websockets 的
 *     handleDisconnect lifecycle —— 因为"后来者赢"替换场景下旧 ws 的 disconnect 会误清新状态，
 *     见计划 D4）
 *  3. 连接状态机 connected → hello_received，挂在 ws._agent（计划 D8）
 *  4. 每次 heartbeat 复查 findActiveByKey 支持吊销实时下线（计划 D7）
 *
 * 偏离计划的地方：
 *   - 计划 D4/case1 期望 handleConnection 直接 registry.register；但 AgentRegistry.register
 *     实际签名要求 bootTime（用于抗抖动判断），而 bootTime 直到 agent.hello 才到。
 *     因此本实现把 register 推迟到 agent.hello 中执行，handleConnection 只挂 state。
 *     close handler 通过 registry.get()?.ws === ws 做幂等校验，hello 前断开时 get() 返 undefined
 *     同样走 noop 分支，不会造成误清除。
 */

/** PrecheckErrorCode → ws 错误码映射（计划 D5）。 */
const PRECHECK_TO_WS: Record<
  PrecheckErrorCode,
  { rpc: number; close: 1008 | 4003; reason: string }
> = {
  // -40001 / 1008 —— 请求协议/签名/时钟类，客户端可重试
  [PrecheckErrorCode.BAD_REQUEST]:       { rpc: AgentRpcErrorCode.BAD_REQUEST, close: 1008, reason: 'bad request' },
  [PrecheckErrorCode.CLOCK_SKEW]:        { rpc: AgentRpcErrorCode.BAD_REQUEST, close: 1008, reason: 'clock skew' },
  [PrecheckErrorCode.SIGNATURE_INVALID]: { rpc: AgentRpcErrorCode.BAD_REQUEST, close: 1008, reason: 'signature invalid' },
  [PrecheckErrorCode.NONCE_REPLAYED]:    { rpc: AgentRpcErrorCode.BAD_REQUEST, close: 1008, reason: 'nonce replayed' },
  // -40003 / 4003 —— license 状态类，客户端应退出不重连
  [PrecheckErrorCode.KEY_NOT_FOUND]:      { rpc: AgentRpcErrorCode.LICENSE_REVOKED, close: 4003, reason: 'license not found' },
  [PrecheckErrorCode.LICENSE_REVOKED]:    { rpc: AgentRpcErrorCode.LICENSE_REVOKED, close: 4003, reason: 'license revoked' },
  [PrecheckErrorCode.CUSTOMER_SUSPENDED]: { rpc: AgentRpcErrorCode.LICENSE_REVOKED, close: 4003, reason: 'customer suspended' },
};

type AgentState = 'connected' | 'hello_received';
interface WsAgentSlot {
  licenseId: number;
  customerId: number;
  licenseKey: string;
  publicIp: string;
  state: AgentState;
}

/** bootTime 合法窗口：now - 30d ~ now + 60s。 */
const BOOT_TIME_MIN_OFFSET_MS = 30 * 86_400_000;
const BOOT_TIME_MAX_FUTURE_MS = 60_000;

/** 内部控制流错误，被 handleError 捕获映射成 -40001 bad_request。 */
class BadRequestError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'BadRequestError';
  }
}

@WebSocketGateway({ path: '/agent' })
export class AgentGateway implements OnGatewayConnection {
  private readonly logger = new Logger(AgentGateway.name);

  constructor(
    private readonly licenseService: LicenseService,
    private readonly registry: AgentRegistry,
    private readonly agentService: AgentService,
  ) {}

  // ---------------- connection ----------------

  async handleConnection(ws: WebSocket, req: IncomingMessage): Promise<void> {
    try {
      const headers = this.extractHeaders(req);

      const result = await this.licenseService.verifyPrecheckForHandshake({
        licenseKey: headers.licenseKey,
        timestamp: headers.timestamp,
        nonce: headers.nonce,
        signature: headers.signature,
      });

      if (result.ok === false) {
        const map = PRECHECK_TO_WS[result.code];
        // 握手阶段 id 未知 —— 按计划 D6，只 close 不发 jsonRpcError
        ws.close(map.close, map.reason);
        return;
      }

      // 挂 state；bootTime/register 延迟到 agent.hello
      // TODO(任务 10): 改用 WeakMap<WebSocket, WsAgentSlot> 消除 as any（ws GC 时 slot 自动释放）
      (ws as any)._agent = {
        licenseId: result.licenseId,
        customerId: result.customerId,
        licenseKey: headers.licenseKey,
        publicIp: (req.socket && (req.socket as any).remoteAddress) || 'unknown',
        state: 'connected',
      } as WsAgentSlot;

      // 绑 close handler（含 replaced guard）
      const closeHandler = async () => {
        try {
          const cur = this.registry.get(result.licenseId);
          if (!cur || cur.ws !== ws) return; // 未 register 或已被替换
          this.registry.unregister(result.licenseId, ws);
          await this.agentService.markOfflineByLicense(result.licenseId);
        } catch (err) {
          this.logger.warn(
            `license ${result.licenseId} close 清理失败: ${(err as Error).message}`,
          );
        }
      };
      ws.on('close', closeHandler);

      // 绑 message handler
      ws.on('message', async (buf: any) => {
        await this.handleMessage(ws, buf);
      });
    } catch (err) {
      this.handleError(ws, err, undefined, /* closeOnError */ true);
    }
  }

  // ---------------- message dispatch ----------------

  private async handleMessage(ws: WebSocket, buf: any): Promise<void> {
    let id: JsonRpcMessage['id'] = null;
    try {
      const raw = typeof buf === 'string' ? buf : buf?.toString?.() ?? '';
      const parsed = parseJsonRpc(raw);
      if (parsed.ok === false) {
        // 非法 JSON：不 close、回 -32700。id 未知用 null（jsonrpc 规范允许）
        ws.send(jsonRpcError(null, parsed.code, 'parse error'));
        return;
      }
      const msg = parsed.msg;
      id = msg.id ?? null;

      // 防御：notification（无 id）不回包，直接丢弃（与 util 决议一致）
      if (id == null) return;

      switch (msg.method) {
        case 'agent.hello':
          await this.handleAgentHello(ws, id, msg.params);
          return;
        case 'agent.heartbeat':
          await this.handleAgentHeartbeat(ws, id, msg.params);
          return;
        default:
          ws.send(
            jsonRpcError(id, AgentRpcErrorCode.BAD_REQUEST, 'method not found'),
          );
          return;
      }
    } catch (err) {
      this.handleError(ws, err, id, /* closeOnError */ false);
    }
  }

  // ---------------- agent.hello ----------------

  private async handleAgentHello(
    ws: WebSocket,
    id: JsonRpcMessage['id'],
    rawParams: unknown,
  ): Promise<void> {
    const slot = (ws as any)._agent as WsAgentSlot | undefined;
    if (!slot) {
      // 理论不可达：未握手的 ws 不会进到这里
      ws.send(jsonRpcError(id, AgentRpcErrorCode.NOT_READY, 'not ready'));
      return;
    }

    if (slot.state !== 'connected') {
      // 已 hello_received 再发 → -40029 already_hello
      ws.send(
        jsonRpcError(id, AgentRpcErrorCode.NOT_READY, 'already hello'),
      );
      return;
    }

    const params = this.requireObject(rawParams, 'params');
    const agentVersion = this.requireString(params.agent_version, 'agent_version');
    const hostName = this.requireString(params.host_name, 'host_name');
    const osInfo = this.requireString(params.os_info, 'os_info');
    const bootTime = this.requireBootTime(params.boot_time);

    // 抗抖动 / replaced：先走 registry 仲裁
    const reg = this.registry.register(slot.licenseId, ws, bootTime);
    if (reg.outcome === 'rejected_flapping') {
      // 计划 7a 第 5 条：抗抖动 close 4013
      ws.send(
        jsonRpcError(id, AgentRpcErrorCode.FLAPPING, 'flapping'),
      );
      ws.close(4013, 'flapping');
      return;
    }

    await this.agentService.upsertOnline({
      licenseId: slot.licenseId,
      customerId: slot.customerId,
      agentVersion,
      publicIp: slot.publicIp,
      hostName,
      kernel: osInfo,
      bootTime: new Date(bootTime),
    });

    slot.state = 'hello_received';
    ws.send(
      jsonRpcResult(id, {
        ok: true,
        heartbeat_interval_sec: 30,
        server_time: Math.floor(Date.now() / 1000),
      }),
    );
  }

  // ---------------- agent.heartbeat ----------------

  private async handleAgentHeartbeat(
    ws: WebSocket,
    id: JsonRpcMessage['id'],
    rawParams: unknown,
  ): Promise<void> {
    const slot = (ws as any)._agent as WsAgentSlot | undefined;
    if (!slot || slot.state !== 'hello_received') {
      ws.send(jsonRpcError(id, AgentRpcErrorCode.NOT_READY, 'not ready'));
      return;
    }

    // 心跳路径复查 license.isActive（D7）
    const row = await this.licenseService.findActiveByKey(slot.licenseKey);
    if (
      row == null ||
      row.licenseRevokedAt != null ||
      row.customerStatus !== 'active'
    ) {
      ws.send(
        jsonRpcError(
          id,
          AgentRpcErrorCode.LICENSE_REVOKED,
          'license revoked',
        ),
      );
      ws.close(4003, 'license revoked');
      return;
    }

    const params = this.requireObject(rawParams, 'params');
    const metrics: HeartbeatMetrics = {
      uptimeSeconds: this.requireNumber(params.uptime_seconds, 'uptime_seconds'),
      cpuPercent: this.requireNumber(params.cpu_percent, 'cpu_percent'),
      memUsedBytes: this.requireNumber(params.mem_used_bytes, 'mem_used_bytes'),
      memTotalBytes: this.requireNumber(params.mem_total_bytes, 'mem_total_bytes'),
      loadavg1: this.requireNumber(params.loadavg_1, 'loadavg_1'),
    };

    await this.agentService.updateHeartbeat(slot.licenseId, metrics);
    this.registry.touchHeartbeat(slot.licenseId);

    ws.send(
      jsonRpcResult(id, {
        ok: true,
        server_time: Math.floor(Date.now() / 1000),
      }),
    );
  }

  // ---------------- helpers ----------------

  private extractHeaders(req: IncomingMessage): {
    licenseKey: string;
    timestamp: string;
    nonce: string;
    signature: string;
    agentVersion: string;
  } {
    const h = req.headers || {};
    const pick = (k: string): string => {
      const v = (h as any)[k];
      if (typeof v !== 'string' || v.length === 0) {
        throw new BadRequestError(`missing header: ${k}`);
      }
      return v;
    };
    return {
      licenseKey: pick('x-license-key'),
      timestamp: pick('x-timestamp'),
      nonce: pick('x-nonce'),
      signature: pick('x-signature'),
      agentVersion: pick('x-agent-version'),
    };
  }

  private requireObject(v: unknown, name: string): Record<string, unknown> {
    if (v == null || typeof v !== 'object' || Array.isArray(v)) {
      throw new BadRequestError(`invalid ${name}`);
    }
    return v as Record<string, unknown>;
  }

  private requireString(v: unknown, name: string): string {
    if (typeof v !== 'string' || v.length === 0) {
      throw new BadRequestError(`invalid ${name}`);
    }
    return v;
  }

  private requireNumber(v: unknown, name: string): number {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new BadRequestError(`invalid ${name}`);
    }
    return v;
  }

  private requireBootTime(v: unknown): number {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new BadRequestError('invalid boot_time');
    }
    const now = Date.now();
    if (v <= now - BOOT_TIME_MIN_OFFSET_MS || v > now + BOOT_TIME_MAX_FUTURE_MS) {
      throw new BadRequestError('boot_time out of range');
    }
    return v;
  }

  /**
   * 错误出口：BadRequestError 映射成 -40001 bad_request / close 1008；
   * 其他未知异常归入 internal error。
   */
  private handleError(
    ws: WebSocket,
    err: unknown,
    id: JsonRpcMessage['id'] | undefined,
    closeOnError: boolean,
  ): void {
    const isBadReq = err instanceof BadRequestError;
    const rpcCode = isBadReq
      ? AgentRpcErrorCode.BAD_REQUEST // -40001
      : JsonRpcErrorCode.InternalError;
    const closeCode: 1008 | 1011 = isBadReq ? 1008 : 1011;
    const reason = isBadReq ? 'bad request' : 'internal error';
    const msg = (err as Error)?.message ?? 'error';

    if (id != null) {
      try {
        ws.send(jsonRpcError(id, rpcCode, isBadReq ? msg : 'internal error'));
      } catch (sendErr) {
        this.logger.debug(
          `ws.send 失败（ws 可能已关闭）: ${(sendErr as Error).message}`,
        );
      }
    } else if (!isBadReq) {
      this.logger.error(`gateway error: ${msg}`);
    }

    if (closeOnError) {
      try {
        ws.close(closeCode, reason);
      } catch (closeErr) {
        this.logger.debug(
          `ws.close 失败（ws 可能已关闭）: ${(closeErr as Error).message}`,
        );
      }
    }
  }
}
