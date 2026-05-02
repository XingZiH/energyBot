import { Module } from '@nestjs/common';
import { DrizzleModule } from '../../drizzle/drizzle.module';
import { UiConfigController } from './controllers/ui-config.controller';
import { EnergyRentalController } from './energy-rental.controller';
import { EnergyRentalService } from './energy-rental.service';
import { UiConfigService } from './services/ui-config.service';

@Module({
  imports: [DrizzleModule],
  controllers: [EnergyRentalController, UiConfigController],
  providers: [EnergyRentalService, UiConfigService],
  exports: [UiConfigService],
})
export class EnergyRentalModule {}
