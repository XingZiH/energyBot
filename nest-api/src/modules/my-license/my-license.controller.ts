import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ResultData } from '../../common/result/result';
import { Permission } from '../../decorators/permission.decorator';
import { AuthGuard } from '../../guards/auth.guard';
import { JwtGuard } from '../../guards/jwt.guard';
import { MyLicenseService } from './my-license.service';

/**
 * 终端客户自助查看自己 license 的入口。
 *
 * 权限：
 * - GET /my-license                需要 default:account:my-license（所有登录用户默认授予）
 * - GET /my-license/install-command 需要 default:account:my-license:reveal
 *   （默认也授予；如果未来想让某些账号看不了安装命令，可以从 role 上摘掉）
 *
 * 关键安全原则：controller 绝不信任任何外部传入的 customerId/userId，
 * 一切以 JwtGuard 解析并挂在 req.user.userId 上的值为准。
 */
@ApiTags('我的 License（终端客户）')
@Controller('my-license')
export class MyLicenseController {
  constructor(private readonly myLicenseService: MyLicenseService) {}

  @ApiOperation({ summary: '查询当前登录用户所绑定客户的 license 概况' })
  @Get()
  @UseGuards(JwtGuard, AuthGuard)
  @Permission('default:account:my-license')
  async findMine(@Req() req: { user?: { userId?: number } }) {
    const userId = req.user?.userId ?? 0;
    const view = await this.myLicenseService.findByUserId(userId);
    return ResultData.success(view);
  }

  @ApiOperation({ summary: '查看当前 license 的安装命令（含 secret 明文）' })
  @Get('install-command')
  @UseGuards(JwtGuard, AuthGuard)
  @Permission('default:account:my-license:reveal')
  async getInstallCommand(@Req() req: { user?: { userId?: number } }) {
    const userId = req.user?.userId ?? 0;
    const cmd = await this.myLicenseService.getInstallCommand(userId);
    return ResultData.success({ installCommand: cmd });
  }
}
