/**
 * Bot 设计器后端 DTO（三端共享数据契约）。
 *
 * 条件必填规则（@ValidateIf）：
 * - action=url → url 必填（@IsString + @IsUrl）
 * - action=text → message 必填（@IsString + @MaxLength 4096）
 * - action=command → command 必填（@Matches /xxx 格式）
 * - action=submenu → submenu 必填（@IsDefined + @ValidateNested）
 * - action=energy_package_group → packageGroup 必填（@IsDefined + @ValidateNested）
 *
 * 其他校验位置（按实施计划分层）：
 * - 深度校验（MAX_MENU_DEPTH=3）→ 任务 4 service 层（ui-config.service.ts）
 * - 套餐 ID 存在性校验 → 任务 4 service 层
 *
 * 三端契约同步（修改字段名/action 值务必同步）：
 * - 前端: ui/src/app/pages/energy-rental/agent-bot-config/designer/types.ts
 * - Go bot: go-bot/internal/telegram/designer.go
 */
import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsDefined,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum ButtonAction {
  URL = 'url',
  TEXT = 'text',
  COMMAND = 'command',
  START = 'start',
  SUBMENU = 'submenu',
  ENERGY_PACKAGE_GROUP = 'energy_package_group',
  ADDRESS_MANAGE = 'address_manage',
  WALLET_QUERY = 'wallet_query',
  ORDERS = 'orders',
}

export class ButtonStyleDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Matches(/^#[0-9a-fA-F]{3,8}$/, {
    message: 'bgColor 必须是 #RGB/#RRGGBB/#RRGGBBAA 格式',
  })
  bgColor?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Matches(/^#[0-9a-fA-F]{3,8}$/, {
    message: 'textColor 必须是 #RGB/#RRGGBB/#RRGGBBAA 格式',
  })
  textColor?: string;
}

export class PackageGroupDto {
  @ApiProperty()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  packageIds!: number[];

  @ApiProperty({ enum: ['price_asc', 'price_desc', 'manual'] })
  @IsIn(['price_asc', 'price_desc', 'manual'])
  sortBy!: string;

  @ApiProperty()
  @IsString()
  textTemplate!: string;
}

export class MenuButtonDto {
  @ApiProperty()
  @IsString()
  id!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(64)
  text!: string;

  @ApiProperty({ enum: ButtonAction })
  @IsEnum(ButtonAction)
  action!: ButtonAction;

  @ApiProperty({ required: false })
  @ValidateIf((o) => o.action === ButtonAction.URL)
  @IsString()
  @IsNotEmpty()
  @IsUrl({ require_protocol: true })
  url?: string;

  @ApiProperty({ required: false })
  @ValidateIf((o) => o.action === ButtonAction.TEXT)
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  message?: string;

  @ApiProperty({ required: false })
  @ValidateIf((o) => o.action === ButtonAction.COMMAND)
  @IsString()
  @IsNotEmpty()
  @Matches(/^\/[a-zA-Z0-9_]+$/, {
    message: 'command 必须是 /xxx 格式（字母数字下划线）',
  })
  command?: string;

  @ApiProperty({ required: false, type: () => [MenuRowDto] })
  @ValidateIf((o) => o.action === ButtonAction.SUBMENU)
  @IsDefined({ message: 'submenu 是必填字段（当 action=submenu）' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MenuRowDto)
  @ArrayMaxSize(8)
  submenu?: MenuRowDto[];

  @ApiProperty({ required: false, type: () => PackageGroupDto })
  @ValidateIf((o) => o.action === ButtonAction.ENERGY_PACKAGE_GROUP)
  @IsDefined({
    message: 'packageGroup 是必填字段（当 action=energy_package_group）',
  })
  @ValidateNested()
  @Type(() => PackageGroupDto)
  packageGroup?: PackageGroupDto;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  submenuText?: string;

  @ApiProperty({ required: false, type: () => ButtonStyleDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ButtonStyleDto)
  style?: ButtonStyleDto;
}

export class MenuRowDto {
  @ApiProperty()
  @IsString()
  id!: string;

  @ApiProperty({ type: () => [MenuButtonDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MenuButtonDto)
  @ArrayMaxSize(4)
  buttons!: MenuButtonDto[];
}

export class MessageTemplatesDto {
  @ApiProperty()
  @IsString()
  welcome!: string;

  @ApiProperty()
  @IsString()
  orderCreated!: string;

  @ApiProperty()
  @IsString()
  payPending!: string;

  @ApiProperty()
  @IsString()
  paySuccess!: string;

  @ApiProperty()
  @IsString()
  payFailed!: string;

  @ApiProperty()
  @IsString()
  addressInvalid!: string;

  @ApiProperty()
  @IsString()
  unknownCommand!: string;

  @ApiProperty()
  @IsString()
  packageUnavailable!: string;

  @ApiProperty()
  @IsString()
  walletQueryResult!: string;
}

export class UiConfigDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  welcomeText?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  packageGroupText?: string;

  @ApiProperty({ required: false, type: () => [MenuRowDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MenuRowDto)
  @ArrayMaxSize(8)
  menuConfig?: MenuRowDto[];

  @ApiProperty({ required: false, type: () => MessageTemplatesDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => MessageTemplatesDto)
  messageConfig?: MessageTemplatesDto;
}
