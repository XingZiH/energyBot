import { Module } from '@nestjs/common';
import { DrizzleModule } from '../../drizzle/drizzle.module';
import { LicenseService } from './license.service';
import { LicensePublicController } from './license.public.controller';
import { NonceCacheService } from '../../common/nonce/nonce-cache.service';

@Module({
  imports: [DrizzleModule],
  controllers: [LicensePublicController],
  providers: [LicenseService, NonceCacheService],
  exports: [LicenseService],
})
export class LicenseModule {}
