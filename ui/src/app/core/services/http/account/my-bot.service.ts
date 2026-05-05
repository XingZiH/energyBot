import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { BaseHttpService } from '../base-http.service';

/**
 * 终端客户自助「我的 Bot」视图模型。
 *
 * 与后端 my-bot.service.ts#MyBotAgentView 保持一致；
 * 时间字段统一是 ISO-8601 字符串（后端 toISOString()），前端渲染前走 DatePipe。
 *
 * 注意：
 * - cpuPercent 与 loadavg1 是 PostgreSQL numeric 类型，pg 驱动会序列化为 string；
 *   前端如需进行数值比较/运算，需要 parseFloat，但本页仅展示，可直接原样渲染。
 * - uptimeSeconds 可能为 null（agent 首次上报前）。
 */
export interface MyBotAgentView {
  id: number;
  licenseId: number;
  status: string; // 'online' | 'offline' | 'never_seen'
  agentVersion: string | null;
  publicIp: string | null;
  hostName: string | null;
  kernel: string | null;
  bootTime: string | null;
  connectedAt: string | null;
  lastHeartbeatAt: string | null;
  uptimeSeconds: number | null;
  cpuPercent: string | null;
  memUsedBytes: number | null;
  memTotalBytes: number | null;
  loadavg1: string | null;
  createdAt: string | null;
  updatedAt: string | null;

  // B3-T5：bot 运行态。agent 未启用 supervisor / 旧版 agent → 全 null。
  // botStatus 取值：'unknown' | 'stopped' | 'starting' | 'running' | 'error' | null
  botStatus: string | null;
  botPid: number | null;
  botUptimeSeconds: number | null;
  botConfigVersion: string | null;
  botLastTgPollAt: string | null;
  botLastError: string | null;
}

/**
 * 「我的 Bot」终端用户自助服务。
 *
 * 设计：
 * - 不接受任何 userId/customerId 入参——后端只信 JWT.userId
 * - 返回当前用户所属客户名下全部 agent；未绑定客户时后端 404，由前端展示"空状态"
 *
 * B3-T5 新增动作接口（start/stop/reload）：
 * - 后端 204 + ResultData.success(null) 语义；ownership 校验后才下发 WS notification
 * - 下发 fire-and-forget；真实状态由下一次心跳 bot 字段回传，前端应在动作后
 *   延迟 ~2s 再 poll findMine() 刷新
 * - 后端错误码：404（未绑客户）/ 403（licenseId 不属己）/ 503（agent 离线）
 *   BaseHttpService 会 toast 错误，组件层只需 catchError 后恢复按钮 disabled
 */
@Injectable({ providedIn: 'root' })
export class MyBotService {
  http = inject(BaseHttpService);

  public findMine(): Observable<MyBotAgentView[]> {
    return this.http.get('/my-bot');
  }

  public startBot(licenseId: number): Observable<null> {
    return this.http.post(`/my-bot/${licenseId}/start`, null, { needSuccessInfo: true });
  }

  public stopBot(licenseId: number): Observable<null> {
    return this.http.post(`/my-bot/${licenseId}/stop`, null, { needSuccessInfo: true });
  }

  public reloadBot(licenseId: number): Observable<null> {
    return this.http.post(`/my-bot/${licenseId}/reload`, null, { needSuccessInfo: true });
  }
}
