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
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
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
   * 注意：
   * - 过滤 deletedAt IS NULL，软删行不参与读取（与 uq_agent_bot_configs_agent_id
   *   部分索引的语义一致）。
   * - menuConfig / messageConfig 在 DB 中以 JSON 字符串形式存储，
   *   读取时解析；解析失败降级为空值，避免旧数据格式导致前端崩溃。
   */
  async loadUiConfig(agentId: number): Promise<{
    welcomeText: string;
    packageGroupText: string;
    menuConfig: MenuRowDto[];
    messageConfig: MessageTemplatesDto;
    updatedAt: string;
  }> {
    const rows = await this.conn
      .select()
      .from(agentBotConfigsTable)
      .where(
        and(
          eq(agentBotConfigsTable.agentId, agentId),
          isNull(agentBotConfigsTable.deletedAt),
        ),
      );
    const row = rows[0];
    if (!row) {
      return {
        welcomeText: '',
        packageGroupText: '',
        menuConfig: [],
        messageConfig: this.emptyTemplates(),
        updatedAt: new Date(0).toISOString(),
      };
    }
    return {
      welcomeText: row.welcomeText ?? '',
      packageGroupText: row.packageGroupText ?? '',
      menuConfig: this.parseJsonArray(row.menuConfig),
      messageConfig:
        this.parseMessageConfig(row.messageConfig),
      updatedAt: (row.updatedAt ?? new Date(0)).toISOString(),
    };
  }

  /**
   * 保存 agent 的 UI 配置。调用前应已通过 validate() 校验。
   *
   * 并发策略：
   * - 无 expectedUpdatedAt：走 insert().onConflictDoUpdate()，依赖部分 unique 索引
   *   `uq_agent_bot_configs_agent_id`（WHERE deleted_at IS NULL）实现原子 upsert，
   *   彻底消除 select-then-insert 的 TOCTOU 空档。
   * - 带 expectedUpdatedAt：走 UPDATE ... WHERE agent_id=? AND updated_at=?
   *   AND deleted_at IS NULL，把乐观锁下沉到 SQL 层；affected rows=0 即冲突。
   *
   * 注意：menuConfig/messageConfig 空值统一写 null（而非空数组/空对象序列化），
   * 语义更清晰，读取时由 emptyTemplates() 兜底。
   *
   * @throws HttpException(CONFLICT) 当 expectedUpdatedAt 与当前 DB 不匹配
   *   （可能原因：已被他人更新 / 记录不存在——两者都要求前端重新 GET 后再写）
   */
  async saveUiConfig(
    agentId: number,
    dto: UiConfigDto,
    expectedUpdatedAt?: string,
  ): Promise<{ updatedAt: string }> {
    const now = new Date();
    const nextValues: Record<string, unknown> = {
      welcomeText: dto.welcomeText ?? '',
      packageGroupText: dto.packageGroupText ?? '',
      menuConfig: dto.menuConfig?.length ? JSON.stringify(dto.menuConfig) : null,
      updatedAt: now,
    };
    // 只有前端显式传入 messageConfig 时才更新——
    // 未传（undefined）时保留 DB 原值，避免保存菜单时误清消息模板。
    if (dto.messageConfig !== undefined) {
      nextValues['messageConfig'] = dto.messageConfig
        ? JSON.stringify(dto.messageConfig)
        : null;
    }

    if (expectedUpdatedAt) {
      // 带乐观锁：UPDATE 附加 WHERE updated_at = expected，affected rows=0 即冲突。
      const updated = await this.conn
        .update(agentBotConfigsTable)
        .set(nextValues)
        .where(
          and(
            eq(agentBotConfigsTable.agentId, agentId),
            eq(
              agentBotConfigsTable.updatedAt,
              new Date(expectedUpdatedAt),
            ),
            isNull(agentBotConfigsTable.deletedAt),
          ),
        )
        .returning({ id: agentBotConfigsTable.id });

      if (updated.length === 0) {
        throw new HttpException(
          '配置已被他人修改，请刷新后重试',
          HttpStatus.CONFLICT,
        );
      }
      return { updatedAt: now.toISOString() };
    }

    // 无 expectedUpdatedAt：首次创建或覆盖写，用 onConflictDoUpdate 保证原子。
    // targetWhere 必须匹配 uq_agent_bot_configs_agent_id 的部分索引谓词，
    // 否则 PG 无法识别目标索引。
    await this.conn
      .insert(agentBotConfigsTable)
      .values({ agentId, botStatus: 'disabled', ...nextValues })
      .onConflictDoUpdate({
        target: agentBotConfigsTable.agentId,
        targetWhere: isNull(agentBotConfigsTable.deletedAt),
        set: nextValues,
      });
    return { updatedAt: now.toISOString() };
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

  /**
   * 解析 messageConfig：先 parseJsonObject，再合并 emptyTemplates() 保证所有字段都是 string。
   * 防止 DB 存了 `{}` 或部分字段缺失导致前端拿到 undefined 字段后回传触发验证失败。
   */
  private parseMessageConfig(val: unknown): MessageTemplatesDto {
    const parsed = this.parseJsonObject(val);
    if (!parsed) return this.emptyTemplates();
    const defaults = this.emptyTemplates();
    return {
      welcome: typeof parsed.welcome === 'string' ? parsed.welcome : defaults.welcome,
      orderCreated: typeof parsed.orderCreated === 'string' ? parsed.orderCreated : defaults.orderCreated,
      payPending: typeof parsed.payPending === 'string' ? parsed.payPending : defaults.payPending,
      paySuccess: typeof parsed.paySuccess === 'string' ? parsed.paySuccess : defaults.paySuccess,
      payFailed: typeof parsed.payFailed === 'string' ? parsed.payFailed : defaults.payFailed,
      addressInvalid: typeof parsed.addressInvalid === 'string' ? parsed.addressInvalid : defaults.addressInvalid,
      unknownCommand: typeof parsed.unknownCommand === 'string' ? parsed.unknownCommand : defaults.unknownCommand,
      packageUnavailable: typeof parsed.packageUnavailable === 'string' ? parsed.packageUnavailable : defaults.packageUnavailable,
      walletQueryResult: typeof parsed.walletQueryResult === 'string' ? parsed.walletQueryResult : defaults.walletQueryResult,
    };
  }
}
