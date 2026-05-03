import { PartialType } from '@nestjs/mapped-types';
import { CreateMenuDto } from './create-menu.dto';
import { IsInt, IsOptional } from 'class-validator';

export class UpdateMenuDto extends PartialType(CreateMenuDto) {
  @IsOptional()
  @IsInt()
  id: number;
}
