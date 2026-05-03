import { Module } from '@nestjs/common';
import { DrizzleModule } from '../../drizzle/drizzle.module';
import { CustomerService } from './customer.service';
import { CustomerController } from './customer.controller';
import { LicenseModule } from '../license/license.module';

@Module({
  imports: [DrizzleModule, LicenseModule],
  controllers: [CustomerController],
  providers: [CustomerService],
  exports: [CustomerService],
})
export class CustomerModule {}
