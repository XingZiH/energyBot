/**
 * Bot UI 配置端点（WebUI 设计器使用）。
 *
 * 安全设计：
 * - agentId 从 JWT 中的 userId 解析（EnergyRentalService.resolveAgentId），
 *   忽略客户端通过 URL / body 传入的任何 agentId，防止越权访问他人数据。
 *
 * 端点：
 *   GET  /energy-rental/ui-config
 *     → 返回当前 agent 的 UI 配置
 *   PUT  /energy-rental/ui-config?dryRun=true|false
 *     → 保存 UI 配置
 *     - dryRun=true：只跑校验链（DTO + 菜单深度 + 套餐 ID），
 *       不做并发检查，不写 DB（前端"预检"场景）
 *     - Header `If-Unmodified-Since: <ISO>`：乐观锁。与服务端当前 updatedAt
 *       不一致时由 service 层抛 409 Conflict（SQL WHERE 下沉，消除 TOCTOU）
 *
 * 校验链（DTO → Service）：
 *   ValidationPipe (class-validator 基础格式)
 *   → uiConfigService.validate (菜单深度 + 套餐 ID 归属)
 *   → uiConfigService.saveUiConfig (乐观锁 + 原子 upsert)
 */
import {
  Body,
  Controller,
  Get,
  Headers,
  Logger,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ResultData } from '../../../common/result/result';
import { Permission } from '../../../decorators/permission.decorator';
import { AuthGuard } from '../../../guards/auth.guard';
import { JwtGuard } from '../../../guards/jwt.guard';
import { AgentApplyConfigService } from '../../agent/agent-apply-config.service';
import { UiConfigDto } from '../dto/ui-config.dto';
import { EnergyRentalService } from '../energy-rental.service';
import { UiConfigService } from '../services/ui-config.service';

/**
 * UI 配置读写所需权限码。与菜单权限配置保持同一常量，避免字符串散落。
 */
const PERM_BOT_CONFIG = 'default:energy-rental:bot-config';

@ApiTags('能量租赁-UI配置')
@Controller('energy-rental/ui-config')
export class UiConfigController {
  private readonly logger = new Logger(UiConfigController.name);

  constructor(
    private readonly uiConfigService: UiConfigService,
    private readonly energyRentalService: EnergyRentalService,
    private readonly applyConfigSvc: AgentApplyConfigService,
  ) {}

  @Get()
  @UseGuards(JwtGuard, AuthGuard)
  @Permission(PERM_BOT_CONFIG)
  async getUiConfig(@Req() req: { user?: { userId?: number } }) {
    const agentId = await this.energyRentalService.resolveAgentId(
      req.user?.userId,
    );
    const data = await this.uiConfigService.loadUiConfig(agentId);
    return ResultData.success(data);
  }

  @Put()
  @UseGuards(JwtGuard, AuthGuard)
  @Permission(PERM_BOT_CONFIG)
  async updateUiConfig(
    @Req() req: { user?: { userId?: number } },
    @Body() dto: UiConfigDto,
    @Query('dryRun') dryRun: string,
    @Headers('if-unmodified-since') ifUnmodifiedSince?: string,
  ) {
    const agentId = await this.energyRentalService.resolveAgentId(
      req.user?.userId,
    );

    // ValidationPipe 已在全局处理 class-validator 基础校验，
    // 这里进一步跑业务校验（菜单深度 + 套餐 ID 归属）。
    await this.uiConfigService.validate(dto, agentId);

    if (dryRun === 'true') {
      return ResultData.success({ valid: true });
    }

    // 乐观锁已下沉到 saveUiConfig（UPDATE WHERE updated_at=expected），
    // 冲突时 service 层抛 HttpException(CONFLICT)，由全局异常处理冒泡。
    const result = await this.uiConfigService.saveUiConfig(
      agentId,
      dto,
      ifUnmodifiedSince,
    );

    // 保存成功后，静默推送最新配置到 agent（如果 bot 正在运行则实时生效）。
    // 使用 fire-and-forget + catch，不阻塞响应——applyConfigSilent 内部已有 warn 日志。
    const userId = req.user?.userId;
    if (userId) {
      this.applyConfigSvc.applyConfigSilent(userId).catch((err) => {
        this.logger.warn(
          `保存 UI 配置后推送失败 user=${userId}: ${err?.message ?? err}`,
        );
      });
    }

    return ResultData.success(result);
  }
}
