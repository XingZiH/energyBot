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
import {
  Inject,
  Injectable,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.provider';
import * as schema from '../../../drizzle/schema';
import {
  agentBotConfigsTable,
  energyPackagesTable,
} from '../../../drizzle/schema';
import {
  ButtonAction,
  MenuRowDto,
  MessageTemplatesDto,
  UiConfigDto,
} from '../dto/ui-config.dto';

/**
 * 菜单最大嵌套层数（根菜单 = 第 1 层）。
 * ⚠️ 修改时必须同步以下三处，保持三端契约一致：
 *   - go-bot/internal/telegram/designer.go: MaxMenuDepth
 *   - ui/src/app/pages/energy-rental/agent-bot-config/designer/menu-tree.service.ts: MAX_MENU_DEPTH（任务 14 创建）
 *   - 本文件
 */
export const MAX_MENU_DEPTH = 3;

@Injectable()
export class UiConfigService {
  private readonly logger = new Logger(UiConfigService.name);

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
   * 均存在、归属当前 agent、且可用。
   *
   * 归属语义与 energy-rental.service.ts:isUserOwnedPackage 对齐：
   *   !deletedAt AND packageKind='user_package' AND agentId=scope.agentId
   * 额外叠加 status='active'，防止引用已停用套餐导致 bot 运行时失败。
   *
   * @throws BadRequestException 当存在缺失、越权、已软删、非 user_package 或非 active 套餐
   */
  async validatePackageIds(rows: MenuRowDto[], agentId: number): Promise<void> {
    const allIds = this.collectPackageIds(rows);
    if (allIds.length === 0) return;

    const existing = await this.conn
      .select({ id: energyPackagesTable.id })
      .from(energyPackagesTable)
      .where(
        and(
          inArray(energyPackagesTable.id, allIds),
          eq(energyPackagesTable.agentId, agentId),
          eq(energyPackagesTable.packageKind, 'user_package'),
          isNull(energyPackagesTable.deletedAt),
          eq(energyPackagesTable.status, 'active'),
        ),
      );

    const existingSet = new Set(existing.map((p) => p.id));
    const missing = allIds.filter((id) => !existingSet.has(id));
    if (missing.length > 0) {
      // 详情仅入日志，响应消息降敏以防 ID 枚举攻击
      this.logger.warn(
        `agent=${agentId} 提交了无效套餐引用: [${missing.join(',')}]`,
      );
      throw new BadRequestException(
        `存在 ${missing.length} 个无效的套餐引用，请重新选择`,
      );
    }
  }

  /**
   * 深度遍历菜单，收集所有套餐组引用的套餐 ID（去重）。
   * 使用 Set 累积避免中间数组开销；SUBMENU 与 ENERGY_PACKAGE_GROUP 互斥（else if）。
   */
  private collectPackageIds(rows: MenuRowDto[]): number[] {
    const ids = new Set<number>();
    const walk = (rs: MenuRowDto[]) => {
      for (const row of rs) {
        for (const btn of row.buttons) {
          if (
            btn.action === ButtonAction.ENERGY_PACKAGE_GROUP &&
            btn.packageGroup
          ) {
            btn.packageGroup.packageIds.forEach((id) => ids.add(id));
          } else if (btn.action === ButtonAction.SUBMENU && btn.submenu) {
            walk(btn.submenu);
          }
        }
      }
    };
    walk(rows);
    return Array.from(ids);
  }

  /**
   * 组合校验入口。在 DTO class-validator 通过后调用。
   */
  async validate(dto: UiConfigDto, agentId: number): Promise<void> {
    if (!Number.isInteger(agentId) || agentId <= 0) {
      throw new BadRequestException('非法 agentId');
    }
    if (dto.menuConfig?.length) {
      this.validateMenuDepth(dto.menuConfig);
      await this.validatePackageIds(dto.menuConfig, agentId);
    }
  }

  /**
   * 读取 agent 的 UI 配置。若不存在，返回空配置 + epoch updatedAt。
   *
   * 注意：menuConfig / messageConfig 在 DB 中以 JSON 字符串形式存储，
   * 读取时解析；解析失败降级为空值，避免旧数据格式导致前端崩溃。
   */
  async loadUiConfig(agentId: number): Promise<{
    welcomeText: string;
    menuConfig: MenuRowDto[];
    messageConfig: MessageTemplatesDto;
    updatedAt: string;
  }> {
    const rows = await this.conn
      .select()
      .from(agentBotConfigsTable)
      .where(eq(agentBotConfigsTable.agentId, agentId));
    const row = rows[0];
    if (!row) {
      return {
        welcomeText: '',
        menuConfig: [],
        messageConfig: this.emptyTemplates(),
        updatedAt: new Date(0).toISOString(),
      };
    }
    return {
      welcomeText: row.welcomeText ?? '',
      menuConfig: this.parseJsonArray(row.menuConfig),
      messageConfig:
        this.parseJsonObject(row.messageConfig) ?? this.emptyTemplates(),
      updatedAt: (row.updatedAt ?? new Date(0)).toISOString(),
    };
  }

  /**
   * 保存 agent 的 UI 配置（upsert）。调用前应已通过 validate() 校验。
   *
   * 实现选择：先 select 再 update/insert，而非用 drizzle onConflict。
   * 原因：agent_bot_configs 表上 agentId 没有 unique 约束（一个 agent 可以
   * 理论上有多条记录，尽管当前业务只建一条），走 select+分支能避免对
   * schema 做额外约束变更，与 AuthService.signup 保持一致风格。
   */
  async saveUiConfig(
    agentId: number,
    dto: UiConfigDto,
  ): Promise<{ updatedAt: string }> {
    const now = new Date();
    const values = {
      welcomeText: dto.welcomeText ?? '',
      menuConfig: dto.menuConfig ? JSON.stringify(dto.menuConfig) : null,
      messageConfig: dto.messageConfig
        ? JSON.stringify(dto.messageConfig)
        : null,
      updatedAt: now,
    };
    const existing = await this.conn
      .select({ id: agentBotConfigsTable.id })
      .from(agentBotConfigsTable)
      .where(eq(agentBotConfigsTable.agentId, agentId));

    if (existing[0]) {
      await this.conn
        .update(agentBotConfigsTable)
        .set(values)
        .where(eq(agentBotConfigsTable.id, existing[0].id));
    } else {
      await this.conn.insert(agentBotConfigsTable).values({
        agentId,
        botStatus: 'disabled',
        ...values,
      });
    }
    return { updatedAt: now.toISOString() };
  }

  /**
   * 乐观锁：基于客户端提供的 If-Unmodified-Since 判断是否冲突。
   *
   * @param ifUnmodifiedSince 客户端上次读取时的 updatedAt（ISO 字符串）。
   *                          缺省视为不使用乐观锁，允许继续写入。
   * @returns true 表示无冲突可写入；false 表示服务端已有更新，需返回 409。
   */
  async checkConcurrency(
    agentId: number,
    ifUnmodifiedSince: string | undefined,
  ): Promise<boolean> {
    if (!ifUnmodifiedSince) return true;
    const rows = await this.conn
      .select({ updatedAt: agentBotConfigsTable.updatedAt })
      .from(agentBotConfigsTable)
      .where(eq(agentBotConfigsTable.agentId, agentId));
    const row = rows[0];
    if (!row) return true; // 首次创建场景，无历史版本可冲突
    const currentUpdatedAt = (row.updatedAt ?? new Date(0)).toISOString();
    return currentUpdatedAt === ifUnmodifiedSince;
  }

  /**
   * 空的消息模板（所有字段为空字符串），用于未配置场景的默认值。
   */
  private emptyTemplates(): MessageTemplatesDto {
    return {
      welcome: '',
      orderCreated: '',
      payPending: '',
      paySuccess: '',
      payFailed: '',
      addressInvalid: '',
      unknownCommand: '',
      packageUnavailable: '',
      walletQueryResult: '',
    };
  }

  /**
   * 宽松解析 JSON 数组：空值/非字符串/解析失败 → 返回空数组。
   */
  private parseJsonArray(val: unknown): MenuRowDto[] {
    if (val == null) return [];
    if (Array.isArray(val)) return val as MenuRowDto[];
    if (typeof val !== 'string') return [];
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? (parsed as MenuRowDto[]) : [];
    } catch {
      return [];
    }
  }

  /**
   * 宽松解析 JSON 对象：空值/非字符串/非对象/解析失败 → 返回 null。
   */
  private parseJsonObject(val: unknown): MessageTemplatesDto | null {
    if (val == null) return null;
    if (typeof val === 'object' && !Array.isArray(val)) {
      return val as MessageTemplatesDto;
    }
    if (typeof val !== 'string') return null;
    try {
      const parsed = JSON.parse(val);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as MessageTemplatesDto)
        : null;
    } catch {
      return null;
    }
  }
}
