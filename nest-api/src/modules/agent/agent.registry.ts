import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { WebSocket } from 'ws';

import { jsonRpcNotification, jsonRpcRequest } from './util/jsonrpc.util';

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

  /**
   * pending request 表：licenseId → (id → resolver)。
   *
   * callAgent 下发 JSON-RPC request 时插入；handleResponse（gateway 回调）按 id
   * 查表 resolve/reject。每个连接独立 namespace，避免 license 间 id 冲突。
   *
   * 清理路径：
   *  - 收到匹配 id 的 response → resolve/reject + delete
   *  - 超时 → reject(Timeout) + delete
   *  - unregister（连接关闭）→ 全部 reject(Disconnected) + 清空该 license map
   */
  private readonly pending = new Map<
    number,
    Map<
      number,
      {
        resolve: (v: unknown) => void;
        reject: (err: Error) => void;
        timer: ReturnType<typeof setTimeout>;
      }
    >
  >();

  // 单调递增 id 生成器；进程内全局唯一即够（pending 表内仍按 license 分桶）。
  private nextRequestId = 1;

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
   *
   * 连接真的下线时，附带把该 license 名下所有 pending callAgent 全部 reject。
   */
  unregister(licenseId: number, ws: WebSocket): void {
    const cur = this.conns.get(licenseId);
    if (cur && cur.ws === ws) {
      this.conns.delete(licenseId);
      this.rejectAllPending(licenseId, 'agent 连接已断开');
    }
  }

  private rejectAllPending(licenseId: number, reason: string): void {
    const bucket = this.pending.get(licenseId);
    if (!bucket) return;
    for (const [, p] of bucket) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
    }
    this.pending.delete(licenseId);
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

  /**
   * 向指定 licenseId 的在线 agent 发送 JSON-RPC **request**（带 id），等待 agent
   * 回 response 后 resolve/reject。
   *
   * 与 sendToAgent（notification）的区别：
   *  - sendToAgent 是 fire-and-forget，UI/调用方不知道 agent 端成败
   *  - callAgent 是同步语义，nest-api 可以串行依赖 agent 真实完成
   *
   * 失败语义（reject 抛 Error）：
   *  - agent 不在线 / ws 非 OPEN → ServiceUnavailableException
   *  - send 异常（broken pipe）→ ServiceUnavailableException
   *  - 超时 → Error('agent {licenseId} {method} timeout')
   *  - agent 回 error 包 → Error(error.message)（保留 code 在 message）
   *  - 连接断开（unregister）→ Error('agent 连接已断开')
   *
   * timeoutMs 调用方按业务语义指定；建议 agent.applyConfig 用 10000（exec
   * subprocess 在 cgo 编译的 sqlite3 binary 上 cold start 可能 1-2s）。
   */
  callAgent(
    licenseId: number,
    method: string,
    params: unknown,
    timeoutMs: number,
  ): Promise<unknown> {
    const conn = this.conns.get(licenseId);
    if (!conn) {
      return Promise.reject(
        new ServiceUnavailableException(
          `agent license=${licenseId} 未在线，无法调用 ${method}`,
        ),
      );
    }
    if (conn.ws.readyState !== 1) {
      return Promise.reject(
        new ServiceUnavailableException(
          `agent license=${licenseId} ws 非 OPEN (state=${conn.ws.readyState})，无法调用 ${method}`,
        ),
      );
    }

    const id = this.nextRequestId++;
    const frame = jsonRpcRequest(id, method, params);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const bucket = this.pending.get(licenseId);
        bucket?.delete(id);
        if (bucket && bucket.size === 0) this.pending.delete(licenseId);
        reject(
          new Error(
            `agent license=${licenseId} ${method} timeout (${timeoutMs}ms)`,
          ),
        );
      }, timeoutMs);

      let bucket = this.pending.get(licenseId);
      if (!bucket) {
        bucket = new Map();
        this.pending.set(licenseId, bucket);
      }
      bucket.set(id, { resolve, reject, timer });

      try {
        conn.ws.send(frame);
      } catch (e: unknown) {
        // 立刻清理 pending；用 ServiceUnavailable 语义 reject
        bucket.delete(id);
        if (bucket.size === 0) this.pending.delete(licenseId);
        clearTimeout(timer);
        const msg =
          e instanceof Error
            ? e.message
            : typeof e === 'string'
              ? e
              : JSON.stringify(e);
        reject(
          new ServiceUnavailableException(
            `agent license=${licenseId} ${method} send 失败: ${msg}`,
          ),
        );
      }
    });
  }

  /**
   * 收到 agent 回的 response 时由 gateway 调用：根据 (licenseId, id) 查 pending
   * 表 resolve（result）或 reject（error）。
   *
   * 返 true 表示有 pending 被处理；返 false 表示 id 不在表里——属意外（agent 回了
   * 一个 nest 没发过的 id），日志一下静默忽略。
   */
  resolvePending(
    licenseId: number,
    id: number | string,
    result: unknown,
    error: { code: number; message: string; data?: unknown } | undefined,
  ): boolean {
    if (typeof id !== 'number') {
      this.logger.warn(
        `resolvePending license=${licenseId} 非数字 id=${String(id)} 已丢弃`,
      );
      return false;
    }
    const bucket = this.pending.get(licenseId);
    const entry = bucket?.get(id);
    if (!bucket || !entry) {
      this.logger.warn(
        `resolvePending license=${licenseId} id=${id} 不在 pending 表（已超时或意外）`,
      );
      return false;
    }
    clearTimeout(entry.timer);
    bucket.delete(id);
    if (bucket.size === 0) this.pending.delete(licenseId);
    if (error) {
      entry.reject(
        new Error(`agent error code=${error.code} message=${error.message}`),
      );
    } else {
      entry.resolve(result);
    }
    return true;
  }
}
