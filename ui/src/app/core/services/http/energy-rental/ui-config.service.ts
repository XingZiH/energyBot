/**
 * Bot 设计器 UI 配置 HTTP 服务（Designer v2 专用）。
 *
 * 后端对应：
 * - controller: nest-api/src/modules/energy-rental/controllers/ui-config.controller.ts
 * - service:    nest-api/src/modules/energy-rental/services/ui-config.service.ts
 * - DTO:        nest-api/src/modules/energy-rental/dto/ui-config.dto.ts
 *
 * 与旧 /agent-bot-config 端点（JSON 字符串字段）并存——新设计器用这个强类型端点，
 * 旧面板继续走 EnergyRentalService.getAgentBotConfig。
 *
 * 乐观锁：saveUiConfig 支持 If-Unmodified-Since 请求头。后端（service 层）
 * 将 expected updatedAt 下沉到 SQL WHERE 子句，冲突时抛 HttpStatus.CONFLICT(409)。
 *
 * dryRun：dryRunValidate 只跑 class-validator + 业务校验（菜单深度、套餐 ID 归属），
 * 不落库，用于前端"保存前预检"。
 */
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { BaseHttpService, HttpRawConfig } from '../base-http.service';

import type { MenuRow, MessageTemplates } from '../../../../pages/energy-rental/agent-bot-config/designer/types';

/**
 * 后端 GET /energy-rental/ui-config 返回结构（ResultData.data 层）。
 *
 * 注意：updatedAt 始终是 ISO 串——后端未配置时返回 epoch
 * ('1970-01-01T00:00:00.000Z')，而非 null。调用方传给 saveUiConfig
 * 做乐观锁时需要自行判断这个 epoch 值（表示"首次保存"路径）。
 */
export interface UiConfig {
  welcomeText: string;
  menuConfig: MenuRow[];
  messageConfig: MessageTemplates;
  updatedAt: string;
}

/**
 * PUT /energy-rental/ui-config 请求体，三字段全可选（对齐后端 UiConfigDto）。
 */
export interface UiConfigPayload {
  welcomeText?: string;
  menuConfig?: MenuRow[];
  messageConfig?: MessageTemplates;
}

/**
 * PUT /energy-rental/ui-config （非 dryRun）返回结构。
 */
export interface UiConfigSaveResult {
  updatedAt: string;
}

@Injectable({ providedIn: 'root' })
export class UiConfigService {
  private readonly http = inject(BaseHttpService);

  /**
   * 加载当前 agent（JWT 解析）的 UI 配置。
   */
  getUiConfig(): Observable<UiConfig> {
    return this.http.get<UiConfig>('/energy-rental/ui-config');
  }

  /**
   * 保存 UI 配置（实际写库）。
   *
   * @param payload  welcomeText / menuConfig / messageConfig
   * @param ifUnmodifiedSince 上次拉取的 updatedAt（ISO 串），用作乐观锁。
   *   传空串 / null / undefined 都不发 If-Unmodified-Since 头——
   *   后端会走 upsert（onConflictDoUpdate）路径，适用于首次保存。
   *
   * 成功时触发通用"操作成功"提示（needSuccessInfo=true）；
   * 409 冲突由 BaseHttpService 的错误通道显示后端的"配置已被他人修改"消息。
   */
  saveUiConfig(payload: UiConfigPayload, ifUnmodifiedSince?: string | null): Observable<UiConfigSaveResult> {
    const config: HttpRawConfig = { needSuccessInfo: true };
    if (ifUnmodifiedSince) {
      config.headers = { 'If-Unmodified-Since': ifUnmodifiedSince };
    }
    return this.http.putRaw<UiConfigSaveResult>('/energy-rental/ui-config', payload, config);
  }

  /**
   * 仅校验不落库（?dryRun=true）。
   *
   * 用于前端"保存前预检"——提前暴露 DTO 格式错误、菜单深度超限、
   * 套餐 ID 不属于当前 agent 等 400 错误，避免用户填完长表单才失败。
   *
   * 刻意不传 needSuccessInfo——校验通过不弹 toast，避免干扰用户。
   */
  dryRunValidate(payload: UiConfigPayload): Observable<{ valid: true }> {
    return this.http.putRaw<{ valid: true }>('/energy-rental/ui-config', payload, {
      query: { dryRun: 'true' }
    });
  }
}
