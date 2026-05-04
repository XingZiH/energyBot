import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
// https://ysx.cosine.ren/nest-learn-project-1/
// https://github.com/nestjs/awesome-nestjs#open-source
async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // 接入 ws 原生适配器（AgentGateway 走 path=/agent 的 ws.WebSocket）
  app.useWebSocketAdapter(new WsAdapter(app));
  app.useStaticAssets('public'); // 配置静态资源

  // 全局 ValidationPipe
  // - transform: true       将请求体反序列化为 DTO 实例（配合 @Type() 和 @Transform() 做类型转换）
  // - whitelist: true       剥离 DTO 未声明的字段，防止意外写入
  // - forbidNonWhitelisted   false（兼容）：旧客户端可能多带字段，允许"剥掉而不 reject"
  // - transformOptions.enableImplicitConversion  false：避免"1" 被偷偷当成 int，强制显式 @Type
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('NgAntdAdmin Api')
    .setDescription('这里是ngAntdAdmin的nestjs api')
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();
