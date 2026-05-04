import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ResultData } from '../../common/result/result';
import { Permission } from '../../decorators/permission.decorator';
import { AuthGuard } from '../../guards/auth.guard';
import { JwtGuard } from '../../guards/jwt.guard';
import { MyBotService } from './my-bot.service';

/**
 * 终端客户自助查看自己客户下 agents 列表的入口。
 *
 * 路由选型：`/my-bot` 而非 `/agent/my-bot`——避开与 AgentGateway WS `/agent`
 * 命名歧义；权限码沿用 SQL 已 seed 的 `default:account:my-bot`，不需新迁移。
 *
 * 安全：controller 绝不信任任何外部传入的 customerId/userId，一切以 JwtGuard
 * 解析并挂在 req.user.userId 上的值为准。
 */
@ApiTags('我的 Bot（终端客户）')
@Controller('my-bot')
export class MyBotController {
  constructor(private readonly myBotService: MyBotService) {}

  @ApiOperation({ summary: '查询当前登录用户所绑定客户的 agents 列表' })
  @Get()
  @UseGuards(JwtGuard, AuthGuard)
  @Permission('default:account:my-bot')
  async findMine(@Req() req: { user?: { userId?: number } }) {
    const userId = req.user?.userId ?? 0;
    const views = await this.myBotService.findByUserId(userId);
    return ResultData.success(views);
  }
}
