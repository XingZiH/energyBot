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
 *     - dryRun=true：只跑校验链，不写入 DB（前端"预检"场景）
 *     - Header `If-Unmodified-Since: <ISO>`：乐观锁，与服务端当前 updatedAt
 *       不一致时返回 409 Conflict
 *
 * 校验链（DTO → Service）：
 *   ValidationPipe (class-validator 基础格式)
 *   → uiConfigService.validate (菜单深度 + 套餐 ID 归属)
 *   → checkConcurrency (乐观锁)
 *   → saveUiConfig
 */
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
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
import { UiConfigDto } from '../dto/ui-config.dto';
import { EnergyRentalService } from '../energy-rental.service';
import { UiConfigService } from '../services/ui-config.service';

@ApiTags('能量租赁-UI配置')
@Controller('energy-rental/ui-config')
export class UiConfigController {
  constructor(
    private readonly uiConfigService: UiConfigService,
    private readonly energyRentalService: EnergyRentalService,
  ) {}

  @Get()
  @UseGuards(JwtGuard, AuthGuard)
  @Permission('default:energy-rental:bot-config')
  async getUiConfig(@Req() req: { user?: { userId?: number } }) {
    const agentId = await this.energyRentalService.resolveAgentId(
      req.user?.userId,
    );
    const data = await this.uiConfigService.loadUiConfig(agentId);
    return ResultData.success(data);
  }

  @Put()
  @UseGuards(JwtGuard, AuthGuard)
  @Permission('default:energy-rental:bot-config')
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

    const canWrite = await this.uiConfigService.checkConcurrency(
      agentId,
      ifUnmodifiedSince,
    );
    if (!canWrite) {
      throw new HttpException(
        '配置已被他人修改，请刷新后重试',
        HttpStatus.CONFLICT,
      );
    }

    const result = await this.uiConfigService.saveUiConfig(agentId, dto);
    return ResultData.success(result);
  }
}
