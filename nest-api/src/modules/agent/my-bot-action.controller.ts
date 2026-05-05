import {
  Controller,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ResultData } from '../../common/result/result';
import { Permission } from '../../decorators/permission.decorator';
import { AuthGuard } from '../../guards/auth.guard';
import { JwtGuard } from '../../guards/jwt.guard';
import { MyBotActionService } from './my-bot-action.service';

/**
 * 终端客户对自己的 agent 下发 bot 启停/重载指令。
 *
 * 路由选型：
 * - 沿用 /my-bot 前缀 + :licenseId 分段；与 GET /my-bot 读接口同 controller 前缀不同
 *   文件，便于独立演进（读 = my-bot.controller；写 = 本文件）
 * - 权限码沿用 'default:account:my-bot'（已 seed），不新迁移；admin 在管理后台
 *   给自己挂同样权限码即可，无需 controller 层 bypass
 *
 * 动作语义：agent 端 supervisor 异步执行，不返回同步结果。真实状态由下一次
 * 心跳 bot 字段回传，前端自行 poll /my-bot 或延迟刷新。
 *
 * HTTP 语义：
 * - 204 No Content：下发成功（fire-and-forget）
 * - 404：用户不存在 / 未绑客户
 * - 403：licenseId 不属于当前用户的 customer
 * - 503：agent 当前不在线 / 通道异常（可重试）
 */
@ApiTags('我的 Bot 操作（终端客户）')
@Controller('my-bot')
export class MyBotActionController {
  constructor(private readonly actionSvc: MyBotActionService) {}

  @ApiOperation({ summary: '启动 bot（agent 侧 supervisor.Start）' })
  @Post(':licenseId/start')
  @HttpCode(204)
  @UseGuards(JwtGuard, AuthGuard)
  @Permission('default:account:my-bot')
  async start(
    @Req() req: { user?: { userId?: number } },
    @Param('licenseId', ParseIntPipe) licenseId: number,
  ) {
    const userId = req.user?.userId ?? 0;
    await this.actionSvc.start(userId, licenseId);
    return ResultData.success(null);
  }

  @ApiOperation({ summary: '停止 bot（agent 侧 supervisor.Stop）' })
  @Post(':licenseId/stop')
  @HttpCode(204)
  @UseGuards(JwtGuard, AuthGuard)
  @Permission('default:account:my-bot')
  async stop(
    @Req() req: { user?: { userId?: number } },
    @Param('licenseId', ParseIntPipe) licenseId: number,
  ) {
    const userId = req.user?.userId ?? 0;
    await this.actionSvc.stop(userId, licenseId);
    return ResultData.success(null);
  }

  @ApiOperation({
    summary: '重载 bot（agent 侧 supervisor.Reload，等价 stop+start）',
  })
  @Post(':licenseId/reload')
  @HttpCode(204)
  @UseGuards(JwtGuard, AuthGuard)
  @Permission('default:account:my-bot')
  async reload(
    @Req() req: { user?: { userId?: number } },
    @Param('licenseId', ParseIntPipe) licenseId: number,
  ) {
    const userId = req.user?.userId ?? 0;
    await this.actionSvc.reload(userId, licenseId);
    return ResultData.success(null);
  }
}
