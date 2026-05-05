import { Module } from '@nestjs/common';

import { DrizzleModule } from '../../drizzle/drizzle.module';
import { LicenseModule } from '../license/license.module';
import { AgentApplyConfigService } from './agent-apply-config.service';
import { AgentGateway } from './agent.gateway';
import { AgentRegistry } from './agent.registry';
import { AgentService } from './agent.service';
import { AgentOfflineScheduler } from './agent.offline-scheduler';
import { MyBotActionController } from './my-bot-action.controller';
import { MyBotActionService } from './my-bot-action.service';
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
 *
 * B3-T5 新增：
 * - MyBotActionController + MyBotActionService：终端客户对自己 agent 下发
 *   bot.start / bot.stop / bot.reload notification，复用 AgentRegistry。
 *
 * B3-T11.4 新增：
 * - AgentApplyConfigService：bot.start 前先下发 agent.applyConfig 把完整
 *   platform + bot 运行配置写进 agent 本地 SQLite，agent 才知道用什么 token
 *   启 bot。MyBotActionService.start 内部级联调用本 service。
 */
@Module({
  imports: [DrizzleModule, LicenseModule],
  controllers: [MyBotController, MyBotActionController],
  providers: [
    AgentGateway,
    AgentRegistry,
    AgentService,
    AgentOfflineScheduler,
    MyBotService,
    MyBotActionService,
    AgentApplyConfigService,
  ],
})
export class AgentModule {}
