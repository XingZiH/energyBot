import { Module } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { DrizzleModule } from '../../drizzle/drizzle.module';
import { CustomerModule } from '../customer/customer.module';

@Module({
  imports: [DrizzleModule, CustomerModule],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
