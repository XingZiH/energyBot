/**
 * 存量 user 补齐 customer + license CLI。
 *
 * 场景：在 signup / UserService.create 切换为"自动开 license"之前，已经存在的用户
 * （admin、内部运营、种子数据 test、历史注册）都没有绑定 customer，进不了「我的 License」页。
 * 本脚本扫描 user 表里 customer_id IS NULL 的行，为每条补建 customer + license 并回填
 * user.customer_id。
 *
 * 设计约定：
 * - 幂等：重复运行时 WHERE customer_id IS NULL 只捞未处理的行；已补齐的不会重复建
 * - 每条用户独立事务：部分失败不会污染其他用户的补齐进度
 * - 含 admin：按你的要求，所有平台用户都应持有自己的一份 license（admin 也会售卖套餐）
 * - --dry-run：只打印将要处理的 userId 列表，不落库
 *
 * 使用：
 *   # 本地 dry-run
 *   npm run build && node dist/src/scripts/backfill-user-licenses.js --dry-run
 *
 *   # 生产执行（在容器内，继承同样的 DB / LICENSE_SECRET_ENC_KEY env）
 *   docker compose -p maer-energy exec api node dist/src/scripts/backfill-user-licenses.js
 *
 * 退出码：
 *   0  成功（含无事可做的情况）
 *   1  未预期异常（未捕获的 DB 错误等）；已处理的行不回滚
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, isNull } from 'drizzle-orm';
import { AppModule } from '../app.module';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.provider';
import * as schema from '../drizzle/schema';
import { userTable } from '../drizzle/schema';
import { CustomerService } from '../modules/customer/customer.service';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const logger = new Logger('BackfillUserLicenses');

  // 最小 Nest context：不启 HTTP 层，直接拿到 DI 容器
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const conn = app.get<NodePgDatabase<typeof schema>>(DrizzleAsyncProvider);
    const customerService = app.get(CustomerService);

    const pending = await conn
      .select({ id: userTable.id, userName: userTable.userName })
      .from(userTable)
      .where(isNull(userTable.customerId));

    logger.log(`待补齐用户数：${pending.length}`);
    if (pending.length === 0) {
      logger.log('无事可做');
      return;
    }

    if (dryRun) {
      for (const u of pending) {
        logger.log(`[dry-run] userId=${u.id} userName=${u.userName}`);
      }
      logger.log(`[dry-run] 共 ${pending.length} 条，未写入`);
      return;
    }

    let ok = 0;
    let failed = 0;
    for (const u of pending) {
      try {
        // 每条独立事务：失败一条不影响整体进度
        await conn.transaction(async (tx) => {
          // 额外幂等检查：在并发/重跑窗口里，行有可能已被另一轮处理过
          const [row] = await tx
            .select({ customerId: userTable.customerId })
            .from(userTable)
            .where(eq(userTable.id, u.id));
          if (row?.customerId) {
            logger.log(`跳过 userId=${u.id}（已被补齐为 customer=${row.customerId}）`);
            return;
          }

          const credential = await customerService.provisionForUser(
            tx,
            u.id,
            u.userName,
            u.id, // 自颁发：issuedBy 记录为该用户自己，审计溯源到批量补齐
          );
          logger.log(
            `补齐成功 userId=${u.id} userName=${u.userName} ` +
              `customerId=${credential.customerId} licenseKey=${credential.licenseKey}`,
          );
          // 注意：licenseSecret 不打印日志，避免泄漏；运营需要时可走 reveal 接口
        });
        ok += 1;
      } catch (err) {
        failed += 1;
        logger.error(
          `补齐失败 userId=${u.id} userName=${u.userName}: ${(err as Error).message}`,
          (err as Error).stack,
        );
      }
    }

    logger.log(`汇总：成功 ${ok} 条，失败 ${failed} 条，总计 ${pending.length} 条`);
    if (failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[backfill-user-licenses] 未捕获异常:', err);
  process.exit(1);
});
