import { Injectable, Logger } from '@nestjs/common';
import { WebSocket } from 'ws';

import { jsonRpcNotification } from './util/jsonrpc.util';

export interface AgentConn {
  ws: WebSocket;
  bootTime: number; // agent 进程 boot unix ms，用于抗抖动识别
  lastHb: number; // 最近一次心跳时刻 ms
  connectedAt: number;
}

export type RegisterOutcome = 'new' | 'replaced' | 'rejected_flapping';
export interface RegisterResult {
  outcome: RegisterOutcome;
  previous?: AgentConn;
}

/**
 * 进程内 licenseId → 当前 WebSocket 连接映射。
 *
 * 策略：
 * - "后来者赢"：新握手替换旧连接，旧连接收到 close code 4001。
 * - 抗抖动：若同 licenseId 在 300ms 内再次以**相同 bootTime** 握手，判定为网络抖动，
 *   拒绝新连接（gateway 侧发 4013）；不同 bootTime 正常替换。
 * - 单进程内存态：多实例部署时需 sticky session 或更换方案，B1 假设单进程。
 */
@Injectable()
export class AgentRegistry {
  private static readonly FLAP_WINDOW_MS = 300;

  private readonly logger = new Logger(AgentRegistry.name);
  private readonly conns = new Map<number, AgentConn>();

  register(licenseId: number, ws: WebSocket, bootTime: number): RegisterResult {
    const now = Date.now();
    const prev = this.conns.get(licenseId);

    if (
      prev &&
      prev.bootTime === bootTime &&
      now - prev.connectedAt < AgentRegistry.FLAP_WINDOW_MS
    ) {
      this.logger.warn(
        `license ${licenseId} 握手抗抖动：同 bootTime ${bootTime} < ${AgentRegistry.FLAP_WINDOW_MS}ms`,
      );
      return { outcome: 'rejected_flapping', previous: prev };
    }

    if (prev) {
      this.logger.log(
        `license ${licenseId} 替换：旧 bootTime=${prev.bootTime} 新=${bootTime}`,
      );
      try {
        prev.ws.close(4001, 'replaced by newer connection');
      } catch {
        /* ignore */
      }
    }

    this.conns.set(licenseId, { ws, bootTime, lastHb: now, connectedAt: now });
    return { outcome: prev ? 'replaced' : 'new', previous: prev };
  }

  /**
   * 只有当 ws 仍是 map 中当前持有的 ws 时才删除。
   * 防止"替换后旧 ws 的 close 回调迟到"错误清除新连接。
   */
  unregister(licenseId: number, ws: WebSocket): void {
    const cur = this.conns.get(licenseId);
    if (cur && cur.ws === ws) {
      this.conns.delete(licenseId);
    }
  }

  get(licenseId: number): AgentConn | undefined {
    return this.conns.get(licenseId);
  }

  has(licenseId: number): boolean {
    return this.conns.has(licenseId);
  }

  touchHeartbeat(licenseId: number): void {
    const c = this.conns.get(licenseId);
    if (c) c.lastHb = Date.now();
  }

  /**
   * 向指定 licenseId 的在线 agent 发送 JSON-RPC notification（无 id，不期望回包）。
   *
   * 用于 B3-T5 主站下行：bot.start / bot.stop / bot.reload。
   *
   * 返 false 的三种情况（调用方自行决定是否 4xx/5xx 给前端）：
   *  1. licenseId 未在 registry（agent 离线/未连接）
   *  2. ws 非 OPEN 状态（readyState !== 1）——握手中、关闭中、已关闭
   *  3. ws.send 抛异常（管道破/底层 socket 已坏）——不让异常冒泡到 controller
   *
   * 注意：本方法不等待 agent 端确认。agent 收到后异步执行 supervisor 操作，
   * 真实状态通过下一次心跳 bot 字段反映回来。
   */
  sendToAgent(licenseId: number, method: string, params?: unknown): boolean {
    const conn = this.conns.get(licenseId);
    if (!conn) {
      this.logger.warn(
        `sendToAgent license ${licenseId} 未在线，丢弃 ${method}`,
      );
      return false;
    }
    // ws.OPEN === 1，但 ws 实例上的常量在某些 mock 里没有，直接用字面量。
    if (conn.ws.readyState !== 1) {
      this.logger.warn(
        `sendToAgent license ${licenseId} ws 非 OPEN (state=${conn.ws.readyState})，丢弃 ${method}`,
      );
      return false;
    }
    const frame = jsonRpcNotification(method, params);
    try {
      conn.ws.send(frame);
      return true;
    } catch (e: unknown) {
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === 'string'
            ? e
            : JSON.stringify(e);
      this.logger.warn(`sendToAgent license ${licenseId} send 失败: ${msg}`);
      return false;
    }
  }

  /** 测试用 */
  size(): number {
    return this.conns.size;
  }
}
