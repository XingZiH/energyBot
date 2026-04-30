import { Module } from '@nestjs/common';
import { DrizzleModule } from '../../drizzle/drizzle.module';
import { EnergyRentalController } from './energy-rental.controller';
import { EnergyRentalService } from './energy-rental.service';

@Module({
  imports: [DrizzleModule],
  controllers: [EnergyRentalController],
  providers: [EnergyRentalService],
})
export class EnergyRentalModule {}
