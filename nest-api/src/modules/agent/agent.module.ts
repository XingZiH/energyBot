import { Module } from '@nestjs/common';

import { DrizzleModule } from '../../drizzle/drizzle.module';
import { LicenseModule } from '../license/license.module';
import { AgentGateway } from './agent.gateway';
import { AgentRegistry } from './agent.registry';
import { AgentService } from './agent.service';
import { AgentOfflineScheduler } from './agent.offline-scheduler';
import { MyBotService } from './my-bot.service';
import { MyBotController } from './my-bot.controller';

/**
 * B1 Agent 子系统装配模块。
 *
 * 依赖：
 * - DrizzleModule：读写 agents / licenses / customers / user
 * - LicenseModule：复用 LicenseService.verifyPrecheckForHandshake / findActiveByKey
 *
 * providers 均为模块内消费，不 exports（YAGNI，当前无外部消费者）。
 */
@Module({
  imports: [DrizzleModule, LicenseModule],
  controllers: [MyBotController],
  providers: [
    AgentGateway,
    AgentRegistry,
    AgentService,
    AgentOfflineScheduler,
    MyBotService,
  ],
})
export class AgentModule {}
