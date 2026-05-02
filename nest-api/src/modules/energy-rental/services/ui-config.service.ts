/**
 * Bot UI 配置校验服务。
 *
 * 职责（在 DTO class-validator 之上的业务层校验）：
 * - 菜单嵌套深度校验（MAX_MENU_DEPTH=3，与 Go bot 一致）
 * - 套餐 ID 存在性 + 归属校验（必须属于当前 agentId）
 *
 * 三端契约：
 * - DTO: ../dto/ui-config.dto.ts
 * - Go bot 深度常量：go-bot/internal/telegram/designer.go:MaxMenuDepth
 */
import { Inject, Injectable, BadRequestException } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.provider';
import * as schema from '../../../drizzle/schema';
import { energyPackagesTable } from '../../../drizzle/schema';
import {
  ButtonAction,
  MenuRowDto,
  UiConfigDto,
} from '../dto/ui-config.dto';

export const MAX_MENU_DEPTH = 3;

@Injectable()
export class UiConfigService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly conn: NodePgDatabase<typeof schema>,
  ) {}

  /**
   * 递归校验菜单嵌套深度。
   * @throws BadRequestException 当深度超过 MAX_MENU_DEPTH
   */
  validateMenuDepth(
    rows: MenuRowDto[],
    currentDepth = 1,
    maxDepth = MAX_MENU_DEPTH,
  ): void {
    if (currentDepth > maxDepth) {
      throw new BadRequestException(
        `菜单嵌套深度不能超过 ${maxDepth} 层`,
      );
    }
    for (const row of rows) {
      for (const btn of row.buttons) {
        if (btn.action === ButtonAction.SUBMENU && btn.submenu?.length) {
          this.validateMenuDepth(btn.submenu, currentDepth + 1, maxDepth);
        }
      }
    }
  }

  /**
   * 校验菜单中所有 energy_package_group 按钮引用的套餐 ID
   * 均存在且归属当前 agent。
   * @throws BadRequestException 当存在缺失或越权 ID
   */
  async validatePackageIds(rows: MenuRowDto[], agentId: number): Promise<void> {
    const allIds = this.collectPackageIds(rows);
    if (allIds.length === 0) return;

    const existing = await this.conn
      .select()
      .from(energyPackagesTable)
      .where(
        and(
          inArray(energyPackagesTable.id, allIds),
          eq(energyPackagesTable.agentId, agentId),
        ),
      );

    const existingSet = new Set(existing.map((p: any) => p.id));
    const missing = allIds.filter((id) => !existingSet.has(id));
    if (missing.length > 0) {
      throw new BadRequestException(
        `套餐 ID 不存在或不属于当前 agent：${missing.join(', ')}`,
      );
    }
  }

  /**
   * 深度遍历菜单，收集所有套餐组引用的套餐 ID（去重）。
   */
  private collectPackageIds(rows: MenuRowDto[]): number[] {
    const ids: number[] = [];
    for (const row of rows) {
      for (const btn of row.buttons) {
        if (
          btn.action === ButtonAction.ENERGY_PACKAGE_GROUP &&
          btn.packageGroup
        ) {
          ids.push(...btn.packageGroup.packageIds);
        }
        if (btn.action === ButtonAction.SUBMENU && btn.submenu) {
          ids.push(...this.collectPackageIds(btn.submenu));
        }
      }
    }
    return Array.from(new Set(ids));
  }

  /**
   * 组合校验入口。在 DTO class-validator 通过后调用。
   */
  async validate(dto: UiConfigDto, agentId: number): Promise<void> {
    if (dto.menuConfig?.length) {
      this.validateMenuDepth(dto.menuConfig);
      await this.validatePackageIds(dto.menuConfig, agentId);
    }
  }
}
