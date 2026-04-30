import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class SigninUserDto {
  @IsString()
  @IsNotEmpty()
  userName: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}

export class SignupUserDto extends SigninUserDto {
  @IsString()
  @IsOptional()
  agentName?: string;

  @IsString()
  @IsOptional()
  mobile?: string;

  @IsString()
  @IsOptional()
  email?: string;
}
