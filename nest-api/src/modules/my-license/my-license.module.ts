import { Module } from '@nestjs/common';

import { DrizzleModule } from '../../drizzle/drizzle.module';
import { LicenseModule } from '../license/license.module';
import { MyLicenseController } from './my-license.controller';
import { MyLicenseService } from './my-license.service';

/**
 * 终端客户自助「我的 License」模块。
 *
 * 依赖：
 * - DrizzleModule：读 user / customers / licenses
 * - LicenseModule：复用 LicenseService.getInstallCommand（含 secret 解密）
 */
@Module({
  imports: [DrizzleModule, LicenseModule],
  controllers: [MyLicenseController],
  providers: [MyLicenseService],
  exports: [MyLicenseService],
})
export class MyLicenseModule {}
