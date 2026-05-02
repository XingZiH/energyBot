import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import {
  EnergyRentalPackage,
  EnergyRentalService,
} from '@services/energy-rental/energy-rental.service';

/**
 * 套餐选择器使用的简化数据契约。
 *
 * 与后端 `energy_packages` 表字段不同：把后端 Sun 单位价格归一为 TRX、
 * 展示用字段名（energy / priceTRX），方便 UI 层直接绑定。
 *
 * 仅包含 selector 需要的字段，后续需要更多信息（例如 platformPackageName、
 * description 等）再按需扩展。
 */
export interface EnergyPackage {
  id: number;
  name: string;
  priceTRX: number;
  energy: number;
  durationHours: number;
  enabled: boolean;
}

/**
 * Designer 专用套餐列表服务。
 *
 * 当前实现：包装已有的 `EnergyRentalService.getPackages`，把 Nest 端返回的
 * `EnergyRentalPackage[]`（PageInfo 包装）转成简化的 `EnergyPackage[]`。
 *
 * TODO(任务 22)：目前 Nest 端 `/energy-rental/packages/list` 是分页 POST，
 * 前端按当前登录用户（agent）过滤；当需要支持管理员查询任意 agent 的套餐时，
 * 应接入新的 `GET /api/agents/:agentId/packages` 或给现有接口加 filters.agentId。
 * 届时：
 * 1. 在 `EnergyRentalService` 追加 `getAgentPackages(agentId)` 方法。
 * 2. 替换此 service 的实现为调用新方法。
 * 3. 更新单测替换 mock。
 */
@Injectable({ providedIn: 'root' })
export class EnergyPackageService {
  private readonly rentalService = inject(EnergyRentalService);

  /**
   * 列出可选套餐。
   *
   * @param agentId 当前机器人所属 agent 的 ID。目前后端依据 JWT 自动过滤当前
   *                 agent 的套餐，`agentId` 参数保留给任务 22 的 filters 透传。
   */
  listPackages(_agentId: number): Observable<EnergyPackage[]> {
    // TODO(任务 22): 替换为 `getAgentPackages(_agentId)` 或在 filters 中传入
    //                agentId/packageKind=user_package。
    return this.rentalService
      .getPackages({
        pageIndex: 1,
        pageSize: 200,
        filters: { status: 'active' },
      })
      .pipe(
        map((page) => (page.list ?? []).map(toEnergyPackage)),
        catchError(() => of<EnergyPackage[]>([])),
      );
  }
}

/**
 * 把 EnergyRentalPackage（后端契约）映射为 UI 契约 EnergyPackage。
 *
 * 价格字段后端用 Sun 存储（1 TRX = 1_000_000 Sun），UI 展示前统一除以 1e6
 * 并保留到整数位，避免浮点误差（NaN 回退为 0）。
 */
function toEnergyPackage(pkg: EnergyRentalPackage): EnergyPackage {
  const priceSun = Number(pkg.priceSun ?? 0);
  const priceTRX = Number.isFinite(priceSun) ? priceSun / 1_000_000 : 0;
  return {
    id: pkg.id,
    name: pkg.packageName ?? `套餐 #${pkg.id}`,
    priceTRX,
    energy: Number(pkg.energyAmount ?? 0),
    durationHours: Number(pkg.durationHours ?? 0),
    enabled: pkg.status === 'active',
  };
}
