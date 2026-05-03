import { Module } from '@nestjs/common';
import { ConfigModule as Config } from '@nestjs/config';
import * as Joi from 'joi'; // 对环境变量进行校验
import * as process from 'node:process';

// 环境变量加载顺序，数组元素索引靠前的优先级高
const envFilePath = [`.env.${process.env.NODE_ENV || 'development'}`, '.env'];

// 对环境变量进行校验
const schema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production')
    .default('development'),
  DATABASE_URL: Joi.string(),
  // DB_HOST: Joi.string().ip()
  // License secret 加密主密钥：base64 编码的 32 字节随机数
  // 生成方式：openssl rand -base64 32
  LICENSE_SECRET_ENC_KEY: Joi.string()
    .base64()
    .length(44) // 32 字节 base64 编码后 44 字符（含尾部 =）
    .required(),
});

@Module({
  imports: [
    Config.forRoot({
      isGlobal: true,
      envFilePath,
      // 对环境变量进行校验
      validationSchema: schema,
    }),
  ],
  providers: [],
  exports: [],
})
export class ConfigModule {}
