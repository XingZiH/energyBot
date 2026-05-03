import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class PermissionAssignRoleMenuReqDto {
  @ApiProperty({ description: '角色id', example: '1' })
  @IsInt()
  roleId: number;

  @ApiProperty({ description: '该角色拥有的所有权限码', example: '1' })
  @IsArray()
  @IsString({ each: true })
  permCodes: string[];
}

export class CreatePermissionDto {
  @ApiProperty({ description: '角色id', example: '1' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  roleId?: string;

  @ApiProperty({ description: '菜单id', example: '1' })
  @IsOptional()
  @IsInt()
  menuId?: number;
}
