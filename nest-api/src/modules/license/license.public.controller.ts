import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { LicenseService } from './license.service';
import { LicensePrecheckBodyDto } from './dto/license.dto';
import { ResultData } from '../../common/result/result';

/**
 * License Precheck 公开端点。
 *
 * 职责：给客户的 install.sh 脚本一次性校验 license 有效性。
 * - 无 JWT guard，只靠 HMAC 签名自证
 * - 所有关键参数（licenseKey / timestamp / nonce / signature）走 HTTP header 传递
 * - body 暂时空实体，供将来扩展客户端版本号等
 *
 * 路径选择 /api/v1 前缀，与现有管理端 API（无前缀）明确区隔，便于 nginx / CF
 * 只开放这一个子路径给公网，其余仍可走内网或 admin_only。
 */
@ApiTags('License Precheck（公开）')
@Controller('api/v1/license')
export class LicensePublicController {
  constructor(private readonly licenseService: LicenseService) {}

  @Post('precheck')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '客户端一键脚本的 license 校验入口（HMAC 签名）' })
  async precheck(
    @Headers('x-license-key') licenseKey: string,
    @Headers('x-timestamp') timestamp: string,
    @Headers('x-nonce') nonce: string,
    @Headers('x-signature') signature: string,
    @Req() req: Request,
    @Body() _body: LicensePrecheckBodyDto,
  ) {
    // 尽量以 request.rawBody 或原始 JSON 字符串做 hash——nest 默认没开 rawBody，
    // 退化为把 _body 再序列化的方案不够稳；precheck 的约定是 body 为空或固定字段，
    // 实现侧直接按 body === '' 作为规范串的占位；客户端 install.sh 也按 EMPTY_BODY_SHA256 算。
    const body = '';
    const path = req.originalUrl?.split('?')[0] ?? '/api/v1/license/precheck';
    const method = req.method ?? 'POST';

    const data = await this.licenseService.verifyPrecheck({
      licenseKey: (licenseKey ?? '').trim(),
      timestamp: (timestamp ?? '').trim(),
      nonce: (nonce ?? '').trim(),
      signature: (signature ?? '').trim(),
      method,
      path,
      body,
    });
    return ResultData.success(data);
  }
}
