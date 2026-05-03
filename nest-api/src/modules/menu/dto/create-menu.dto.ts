import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * 创建菜单 DTO。
 *
 * 与 schema.ts 的 menuTable 对齐：
 *   - notNull 字段：menuName/menuType/code/orderNum/fatherId → 必填
 *   - nullable 字段：path/alIcon/icon/status/newLinkFlag/visible → @IsOptional
 */
export class CreateMenuDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @ApiProperty({
    description: '阿里图标',
    example: '超级管理员',
  })
  alIcon?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @ApiProperty({
    description: 'zorro图标',
    example: 'icon-mel-help',
  })
  icon?: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(255)
  @ApiProperty({
    description: '图形编辑器',
    example: 'left',
  })
  menuName: string;

  @IsString()
  @MaxLength(100)
  @ApiProperty({
    description: 'C:菜单，F:按钮',
    example: 'C',
  })
  menuType: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @ApiProperty({
    description: '路由地址',
    example: '/default/page-demo/flow',
  })
  path?: string;

  @IsString()
  @MaxLength(100)
  @ApiProperty({ description: '权限码', example: 'default:dashboard' })
  code: string;

  @IsInt()
  @ApiProperty({ description: '排序', example: '0' })
  orderNum: number;

  @IsInt()
  @ApiProperty({ description: '父节点Id', example: '一级节点为0' })
  fatherId: number;

  @IsOptional()
  @IsBoolean()
  @ApiProperty({ description: '状态(是否可用)', example: 'true' })
  status?: boolean;

  @IsOptional()
  @IsBoolean()
  @ApiProperty({ description: '外链标记', example: 'false' })
  newLinkFlag?: boolean;

  @IsOptional()
  @IsBoolean()
  @ApiProperty({ description: '是否展示', example: 'true' })
  visible?: boolean;
}
