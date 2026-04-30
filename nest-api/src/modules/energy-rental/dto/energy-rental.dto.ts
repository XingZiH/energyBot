import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsNumber, IsOptional, IsString } from 'class-validator';

export class EnergyPackageFiltersDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  packageName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  status?: string;
}

export class CreateEnergyPackageDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  platformPackageId?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  packageName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  energyAmount?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  durationHours?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  priceSun?: string | number;

  @ApiProperty({ required: false })
  @IsOptional()
  idlePriceSun?: string | number;

  @ApiProperty({ required: false })
  @IsOptional()
  busyPriceSun?: string | number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  sortOrder?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateEnergyPackageDto extends CreateEnergyPackageDto {
  @ApiProperty()
  @IsNumber()
  id: number;
}

export class EstimateEnergyPackageDto {
  @ApiProperty()
  @IsNumber()
  energyAmount: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  durationHours?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  priceTrx?: number;
}

export class RunLinkTestDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  energyAmount?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  durationHours?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  createOrder?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  receiverAddress?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  clientOrderId?: string;
}

export class RechargeProviderBalanceDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  provider?: string;

  @ApiProperty()
  @IsNumber()
  amountTrx: number;
}

export class PreviewProviderRechargeDto extends RechargeProviderBalanceDto {}

export class EnergyOrderFiltersDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  orderNo?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  packageId?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  buyerAddress?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  receiverAddress?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  returnStatus?: string;
}

export class EnergyAddressFiltersDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  telegramChatId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  label?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  status?: string;
}

export class UpdateEnergyOrderDto {
  @ApiProperty()
  @IsNumber()
  id: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  returnStatus?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  paymentTxHash?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  rentTxHash?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  rentedAt?: Date | string;

  @ApiProperty({ required: false })
  @IsOptional()
  expiresAt?: Date | string;

  @ApiProperty({ required: false })
  @IsOptional()
  returnedAt?: Date | string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  remark?: string;
}

export class WalletTransactionFiltersDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  txHash?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  walletAddress?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  direction?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  transactionType?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  relatedOrderId?: number;
}

export class ReturnTaskFiltersDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  orderId?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  receiverAddress?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  status?: string;
}

export class UpdatePlatformConfigDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  botStatus?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  telegramBotToken?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  tronApiBaseUrl?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  tronApiKey?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  justlendContractAddress?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  justlendPayerPrivateKey?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  energyProvider?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  catfeeEnvironment?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  catfeeProdApiBaseUrl?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  catfeeProdApiKey?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  catfeeProdApiSecret?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  catfeeNileApiBaseUrl?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  catfeeNileApiKey?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  catfeeNileApiSecret?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  catfeeAutoActivate?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  orderPaymentTtlMinutes?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  telegramPollingIntervalSeconds?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  workerIntervalSeconds?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  minTrxReserveSun?: string | number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  bitcartApiBaseUrl?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  bitcartAdminBaseUrl?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  bitcartApiToken?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  bitcartStoreId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  bitcartCurrency?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  bitcartWebhookBaseUrl?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  bitcartWebhookSecret?: string;
}

export class UpdateAgentBotConfigDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  botStatus?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  telegramBotToken?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  telegramBotUsername?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  remark?: string;
}

export class UpdateBotRuntimeStatusDto {
  @ApiProperty({ enum: ['enabled', 'disabled'] })
  @IsString()
  @IsIn(['enabled', 'disabled'])
  botStatus: string;
}

export class CreateAgentRechargeOrderDto {
  @ApiProperty()
  @IsNumber()
  amountTrx: number;
}

export class AgentRechargeOrderFiltersDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  orderNo?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  status?: string;
}

export class BitcartInvoiceWebhookDto {
  @ApiProperty()
  @IsString()
  id: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  status?: string;
}
