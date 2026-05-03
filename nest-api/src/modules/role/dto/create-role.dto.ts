import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateRoleDto {
  @ApiProperty({
    description: '角色名称',
    required: true,
    example: '超级管理员',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  roleName: string;

  @ApiProperty({ description: '角色描述', example: '拥有至高无上的权限' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  roleDesc?: string;
}
