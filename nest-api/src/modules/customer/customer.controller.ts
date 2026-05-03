import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CustomerService } from './customer.service';
import {
  CreateCustomerDto,
  ListCustomerFilterDto,
  RevokeLicenseDto,
  UpdateCustomerDto,
} from './dto/customer.dto';
import { ResultData } from '../../common/result/result';
import { JwtGuard } from '../../guards/jwt.guard';
import { AuthGuard } from '../../guards/auth.guard';
import { Permission } from '../../decorators/permission.decorator';

/**
 * 客户与 license 管理 controller（管理员后台使用）。
 *
 * 权限码约定（见 sql/20260503-customers-and-licenses.sql）：
 * - default:system:customers          查看列表与详情
 * - default:system:customers:add      创建客户并签发 license
 * - default:system:customers:edit     修改客户资料
 * - default:system:customers:revoke   吊销 / 重新颁发
 * - default:system:customers:reveal   查看 secret 明文
 */
@ApiTags('客户与 License 管理')
@Controller('customer')
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  @ApiOperation({ summary: '创建客户并签发初始 license（返回一次性凭据）' })
  @Post('create')
  @UseGuards(JwtGuard, AuthGuard)
  @Permission('default:system:customers:add')
  async create(
    @Body() dto: CreateCustomerDto,
    @Req() req: { user?: { userId?: number } },
  ) {
    const createdBy = req.user?.userId ?? 0;
    const data = await this.customerService.create(dto, createdBy);
    return ResultData.success(data);
  }

  @ApiOperation({ summary: '分页查询客户列表' })
  @Post('list')
  @UseGuards(JwtGuard, AuthGuard)
  @Permission('default:system:customers')
  async list(@Body() params: ListCustomerFilterDto) {
    const data = await this.customerService.list(params);
    return ResultData.success(data);
  }

  @ApiOperation({ summary: '查看客户详情（含 license 历史）' })
  @Get(':id')
  @UseGuards(JwtGuard, AuthGuard)
  @Permission('default:system:customers')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const data = await this.customerService.findById(id);
    return ResultData.success(data);
  }

  @ApiOperation({ summary: '修改客户基础信息（名称 / 联系 / 备注 / 状态）' })
  @Put('update')
  @UseGuards(JwtGuard, AuthGuard)
  @Permission('default:system:customers:edit')
  async update(@Body() dto: UpdateCustomerDto) {
    await this.customerService.update(dto);
    return ResultData.success(null);
  }

  @ApiOperation({ summary: '吊销客户当前有效 license（不删除历史）' })
  @Post('revoke-license')
  @UseGuards(JwtGuard, AuthGuard)
  @Permission('default:system:customers:revoke')
  async revokeLicense(@Body() dto: RevokeLicenseDto) {
    const data = await this.customerService.revokeLicense(
      dto.customerId,
      dto.reason,
    );
    return ResultData.success(data);
  }

  @ApiOperation({ summary: '重新颁发 license（吊销旧的 + 生成新的，返回新凭据）' })
  @Post('reissue-license')
  @UseGuards(JwtGuard, AuthGuard)
  @Permission('default:system:customers:revoke')
  async reissueLicense(
    @Body() dto: RevokeLicenseDto,
    @Req() req: { user?: { userId?: number } },
  ) {
    const issuedBy = req.user?.userId ?? 0;
    const data = await this.customerService.reissueLicense(
      dto.customerId,
      issuedBy,
      dto.reason,
    );
    return ResultData.success(data);
  }

  @ApiOperation({ summary: '查看客户当前 license 的安装命令（含 secret）' })
  @Get(':id/install-command')
  @UseGuards(JwtGuard, AuthGuard)
  @Permission('default:system:customers:reveal')
  async getInstallCommand(@Param('id', ParseIntPipe) id: number) {
    const cmd = await this.customerService.getInstallCommand(id);
    return ResultData.success({ installCommand: cmd });
  }
}
