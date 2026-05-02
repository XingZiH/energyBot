import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsEnum,
  IsArray,
  IsInt,
  IsIn,
  ValidateNested,
  ArrayMaxSize,
  MaxLength,
  ValidateIf,
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
  bgColor?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  textColor?: string;
}

export class PackageGroupDto {
  @ApiProperty()
  @IsArray()
  @IsInt({ each: true })
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
  url?: string;

  @ApiProperty({ required: false })
  @ValidateIf((o) => o.action === ButtonAction.TEXT)
  @IsString()
  message?: string;

  @ApiProperty({ required: false })
  @ValidateIf((o) => o.action === ButtonAction.COMMAND)
  @IsString()
  command?: string;

  @ApiProperty({ required: false, type: () => [MenuRowDto] })
  @ValidateIf((o) => o.action === ButtonAction.SUBMENU)
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MenuRowDto)
  @ArrayMaxSize(8)
  submenu?: MenuRowDto[];

  @ApiProperty({ required: false, type: () => PackageGroupDto })
  @ValidateIf((o) => o.action === ButtonAction.ENERGY_PACKAGE_GROUP)
  @ValidateNested()
  @Type(() => PackageGroupDto)
  packageGroup?: PackageGroupDto;

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
  @ApiProperty() @IsString() welcome!: string;
  @ApiProperty() @IsString() orderCreated!: string;
  @ApiProperty() @IsString() payPending!: string;
  @ApiProperty() @IsString() paySuccess!: string;
  @ApiProperty() @IsString() payFailed!: string;
  @ApiProperty() @IsString() addressInvalid!: string;
  @ApiProperty() @IsString() unknownCommand!: string;
  @ApiProperty() @IsString() packageUnavailable!: string;
  @ApiProperty() @IsString() walletQueryResult!: string;
}

export class UiConfigDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  welcomeText?: string;

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
