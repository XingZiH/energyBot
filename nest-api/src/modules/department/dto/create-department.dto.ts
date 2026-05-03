import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateDepartmentDto {
  @ApiProperty({
    description: '部门名称',
    required: true,
    example: '超级管理员',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  departmentName: string;

  @ApiProperty({ description: '父级id，第一级为0', example: '0' })
  @IsOptional()
  @IsInt()
  fatherId?: number;

  @ApiProperty({ description: '排序', example: '0' })
  @IsOptional()
  @IsInt()
  orderNum?: number;

  @ApiProperty({ description: '状态(是否启用)', example: 'true' })
  @IsOptional()
  @IsBoolean()
  state?: boolean;
}
