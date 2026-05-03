import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsDate,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * 创建用户 DTO。
 *
 * 补齐 class-validator 装饰器以配合全局 ValidationPipe（whitelist: true）。
 * 字段可选性严格与 schema.ts 的 userTable 保持一致：
 *   - notNull 字段 → 必填（运行时不能缺）
 *   - nullable 字段 → @IsOptional()
 *
 * 校验强度保守：只约束类型和最大长度；取值合法性（如性别枚举）由前端表单校验负责，
 * 避免引入跟旧行为不一致的 regression。
 */
export class CreateUserDto {
  @ApiProperty({ description: '用户名称', required: true })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  userName: string;

  @ApiProperty({ description: '是否可用', default: true })
  @IsBoolean()
  available: boolean;

  @ApiProperty({ description: '性别(0:女 1:男)' })
  @IsInt()
  sex: 0 | 1;

  @ApiProperty({ description: '手机号' })
  @IsString()
  @MaxLength(20)
  mobile: string;

  @ApiProperty({ description: '邮箱', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  email?: string;

  @ApiProperty({ description: '密码' })
  @IsString()
  @MinLength(1)
  password: string;

  @ApiProperty({ description: '最后登录时间', required: false })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  lastLoginTime?: Date;

  @ApiProperty({ description: '创建时间', required: false })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  createdTime?: Date;

  @ApiProperty({ description: '电话号码', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  telephone?: string;

  @ApiProperty({ description: '角色 id 列表' })
  @IsArray()
  @IsInt({ each: true })
  roleId: number[];

  @ApiProperty({ description: '部门 id' })
  @IsInt()
  departmentId: number;

  @ApiProperty({ description: '部门名称', required: false })
  @IsOptional()
  @IsString()
  departmentName?: string;
}
