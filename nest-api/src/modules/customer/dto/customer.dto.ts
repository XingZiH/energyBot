import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';
import { PageDomain } from '../../../common/result/result';
import { Transform } from 'class-transformer';

/**
 * 创建客户 DTO。
 *
 * 后端在事务里自动为客户生成初始 license，DTO 只负责客户画像字段。
 */
export class CreateCustomerDto {
  @ApiProperty({ description: '客户名称', required: true, example: '张三公司' })
  @IsString()
  @MinLength(2, { message: '客户名称至少 2 个字符' })
  @MaxLength(120, { message: '客户名称不得超过 120 个字符' })
  name: string;

  @ApiProperty({
    description: '联系方式（Telegram / 邮箱 / 电话等自由文本）',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  contact?: string;

  @ApiProperty({ description: '备注（合同号、销售等）', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  remark?: string;
}

/**
 * 更新客户 DTO：所有字段可选；id 必填。
 */
export class UpdateCustomerDto extends PartialType(CreateCustomerDto) {
  @ApiProperty({ description: '客户 id', required: true })
  @IsInt()
  id: number;

  @ApiProperty({
    description: '状态：active | suspended',
    required: false,
    example: 'active',
  })
  @IsOptional()
  @IsString()
  @IsIn(['active', 'suspended'])
  status?: string;
}

/**
 * 客户列表查询参数（过滤 + 分页）。
 */
export class ListCustomerFilterDto extends PageDomain {
  @ApiProperty({ description: '按名称模糊搜索', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiProperty({
    description: '状态：active | suspended | all（默认 all）',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsIn(['active', 'suspended', 'all'])
  status?: string;
}

/**
 * 吊销 license 时的请求体。
 */
export class RevokeLicenseDto {
  @ApiProperty({ description: '客户 id', required: true })
  @IsInt()
  @Transform(({ value }) => Number(value))
  customerId: number;

  @ApiProperty({ description: '吊销原因（可选）', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}
