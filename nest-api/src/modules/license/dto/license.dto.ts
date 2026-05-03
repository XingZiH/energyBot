import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { LICENSE_KEY_REGEX } from '../../../common/crypto/license-key.util';

/**
 * 客户端安装脚本发起的 precheck 请求 body。
 *
 * 注意：HMAC 签名的字段都在 HTTP header 里（X-License-Key / X-Timestamp / X-Nonce / X-Signature），
 * 此处 body 用于扩展（未来加版本号、agent 机器指纹等）。当前为空 DTO，仅为 ValidationPipe 兼容。
 */
export class LicensePrecheckBodyDto {
  @ApiProperty({ description: '客户端版本（预留）', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  clientVersion?: string;
}

/**
 * precheck 成功时的响应 data。
 */
export class LicensePrecheckResultDto {
  @ApiProperty({ description: '客户名称，仅供显示' })
  @IsString()
  customerName: string;

  @ApiProperty({ description: '服务端时间（毫秒），供客户端对时参考' })
  @IsInt()
  serverTime: number;
}

/**
 * 管理端创建客户时的 license 返回信息（一次性抽屉使用）。
 */
export class LicenseCredentialDto {
  @ApiProperty({ description: 'license key 明文' })
  @IsString()
  @Matches(LICENSE_KEY_REGEX)
  licenseKey: string;

  @ApiProperty({ description: 'license secret 明文（base64url）' })
  @IsString()
  @MinLength(43)
  @MaxLength(64)
  licenseSecret: string;

  @ApiProperty({ description: '一键安装命令（已拼好 key+secret 环境变量）' })
  @IsString()
  installCommand: string;
}

/**
 * precheck 端点的标准错误码（对外契约，install.sh 据此做差异化提示）。
 */
export enum PrecheckErrorCode {
  KEY_NOT_FOUND = 'key_not_found',
  LICENSE_REVOKED = 'license_revoked',
  CUSTOMER_SUSPENDED = 'customer_suspended',
  CLOCK_SKEW = 'clock_skew',
  SIGNATURE_INVALID = 'signature_invalid',
  NONCE_REPLAYED = 'nonce_replayed',
  BAD_REQUEST = 'bad_request',
}
