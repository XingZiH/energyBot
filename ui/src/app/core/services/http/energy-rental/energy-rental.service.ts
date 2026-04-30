import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { PageInfo, SearchCommonVO } from '@core/services/types';

import { BaseHttpService } from '../base-http.service';

export interface EnergyRentalDashboard {
  scope?: 'platform' | 'agent';
  agentId?: number | null;
  agentWalletBalanceSun?: number | string | null;
  activePackageCount: number;
  activeRentalCount: number;
  failedReturnTaskCount: number;
  netWalletSun: number;
  overdueReturnTaskCount: number;
  pendingOrderCount: number;
  providerBalanceMonitors: ProviderBalanceMonitor[];
  totalEnergyRented: number;
  totalOrderCount: number;
  totalRevenueSun: number;
  walletExpenseSun: number;
  walletIncomeSun: number;
}

export interface ProviderBalanceMonitor {
  provider: string;
  providerLabel: string;
  channel: string;
  channelLabel: string;
  status: string;
  wallet: string;
  rechargeAddress: string;
  balanceSun: number;
  balanceTrx: number;
  alertThresholdSun: number;
  alertThresholdTrx: number;
  message: string;
  checkedAt: string;
}

export interface ProviderRechargeResult {
  provider: string;
  providerLabel: string;
  channel: string;
  channelLabel: string;
  amountSun: number;
  amountTrx: number;
  estimatedFeeSun: number;
  estimatedFeeTrx: number;
  estimatedTotalSun: number;
  estimatedTotalTrx: number;
  walletBalanceSun: number | null;
  walletBalanceTrx: number | null;
  hasEnoughBalance: boolean | null;
  bandwidthBytes: number;
  availableBandwidth: number;
  bandwidthPriceSun: number;
  accountCreateFeeSun: number;
  fromAddress: string;
  rechargeAddress: string;
  txHash: string;
  status: string;
  submittedAt: string;
}

export interface ProviderRechargePreview extends Omit<ProviderRechargeResult, 'txHash' | 'status' | 'submittedAt'> {
  feeNote: string;
  previewedAt: string;
}

export interface EnergyRentalPackage {
  id: number;
  agentId?: number | null;
  platformPackageId?: number | null;
  packageKind?: 'platform_price' | 'admin_package' | 'user_package' | string;
  platformPackageName?: string | null;
  platformPackageStatus?: string | null;
  platformEnergyAmount?: number | string | null;
  platformDurationHours?: number | string | null;
  platformPriceSun?: number | string | null;
  platformIdlePriceSun?: number | string | null;
  platformBusyPriceSun?: number | string | null;
  platformCurrentPriceSun?: number | string | null;
  platformBasePriceSun?: number | string | null;
  packageName: string;
  energyAmount: number;
  durationHours: number;
  priceSun: number | string;
  idlePriceSun?: number | string;
  busyPriceSun?: number | string;
  currentPriceSun?: number | string;
  pricePeriod?: 'idle' | 'busy';
  basePriceSun?: number | string;
  status: string;
  sortOrder?: number;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface EnergyPackageEstimate {
  energyAmount: number;
  durationHours: number;
  minEnergyAmount: number;
  energyRentPerTrx: number;
  energyStakePerTrx: number;
  unitDailyPriceTrx: number;
  rentFeeTrx: number;
  securityDepositTrx: number;
  liquidationReserveTrx: number;
  totalPrepayTrx: number;
  platformCapitalTrx: number;
  delegatedTrx: number;
  salePriceTrx: number;
  profitTrx: number;
  profitRate: number;
  provider?: string;
  providerLabel?: string;
  catfeeEnvironment?: string;
  catfeeAutoActivate?: boolean;
  trxPriceUsd?: number | null;
  source: string;
  estimatedAt: string;
}

export interface EnergyRentalOrder {
  id: number;
  orderNo: string;
  packageId: number;
  packageName: string;
  buyerAddress: string;
  receiverAddress: string;
  energyAmount: number;
  durationHours: number;
  paymentAmountSun: number | string;
  paymentExpiresAt?: string;
  paymentTxHash?: string;
  rentTxHash?: string;
  energyProvider?: string;
  externalOrderId?: string;
  externalProviderEnvironment?: string;
  externalStatus?: string;
  externalConfirmStatus?: string;
  providerCostSun?: number | string;
  status: string;
  returnStatus: string;
  rentedAt?: string;
  expiresAt?: string;
  returnedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface EnergyUserAddressStats {
  id: number;
  telegramChatId: string;
  label: string;
  address: string;
  isDefault: boolean;
  status: string;
  orderCount: number;
  pendingOrderCount: number;
  rentingOrderCount: number;
  completedOrderCount: number;
  failedOrderCount: number;
  cancelledOrderCount: number;
  totalEnergyAmount: number;
  totalPaymentSun: number | string;
  lastOrderAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface WalletTransaction {
  id: number;
  txHash: string;
  walletAddress: string;
  direction: string;
  transactionType: string;
  amountSun: number | string;
  relatedOrderId?: number;
  status: string;
  confirmedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AgentAccount {
  agentId: number;
  balanceSun: number | string;
  balanceTrx: number;
  totalRechargeSun: number | string;
  totalDeductedSun: number | string;
  rechargeTtlMinutes: number;
}

export interface AgentBotConfig {
  scope?: 'platform' | 'agent';
  agentId: number | null;
  botStatus: string;
  telegramBotToken: string;
  telegramBotTokenConfigured: boolean;
  telegramBotUsername: string;
  remark?: string;
}

export interface BotRuntimeStatus {
  scope: 'platform' | 'agent';
  agentId: number | null;
  desiredStatus: string;
  desiredStatusLabel: string;
  serviceStatus: string;
  serviceStatusLabel: string;
  runtimeStatus: string;
  pollingStatus: string;
  lastHeartbeatAt: string | null;
  heartbeatAgeSeconds: number | null;
  lastStartedAt: string | null;
  lastStoppedAt: string | null;
  lastError: string;
  instanceId: string;
  telegramBotTokenConfigured: boolean;
  canEnable: boolean;
  activeAgentBotCount?: number;
}

export interface AgentRechargeOrder {
  id: number;
  agentId: number;
  orderNo: string;
  amountSun: number | string;
  paymentAddress: string;
  paymentTxHash?: string;
  paymentGateway?: string;
  bitcartInvoiceId?: string;
  bitcartInvoiceStatus?: string;
  bitcartCheckoutUrl?: string;
  bitcartPaymentId?: string;
  bitcartPaymentUrl?: string;
  bitcartPaymentCurrency?: string;
  bitcartPaymentAmount?: string | number;
  bitcartExceptionStatus?: string;
  bitcartSentAmount?: string | number;
  bitcartPaidCurrency?: string;
  status: string;
  expiresAt?: string;
  confirmedAt?: string;
  remark?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ReturnTask {
  id: number;
  orderId: number;
  receiverAddress: string;
  energyAmount: number;
  status: string;
  attempts: number;
  lastError?: string;
  nextRetryAt?: string;
  completedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface EnergyPlatformConfig {
  botStatus: string;
  telegramBotToken: string;
  telegramBotTokenConfigured: boolean;
  tronApiBaseUrl: string;
  tronApiKey: string;
  tronApiKeyConfigured: boolean;
  justlendContractAddress: string;
  justlendPayerPrivateKey: string;
  justlendPayerPrivateKeyConfigured: boolean;
  energyProvider: string;
  catfeeEnvironment: string;
  catfeeProdApiBaseUrl: string;
  catfeeProdApiKey: string;
  catfeeProdApiKeyConfigured: boolean;
  catfeeProdApiSecret: string;
  catfeeProdApiSecretConfigured: boolean;
  catfeeNileApiBaseUrl: string;
  catfeeNileApiKey: string;
  catfeeNileApiKeyConfigured: boolean;
  catfeeNileApiSecret: string;
  catfeeNileApiSecretConfigured: boolean;
  catfeeAutoActivate: boolean;
  orderPaymentTtlMinutes: number;
  telegramPollingIntervalSeconds: number;
  workerIntervalSeconds: number;
  minTrxReserveSun: string | number;
  bitcartApiBaseUrl: string;
  bitcartAdminBaseUrl: string;
  bitcartApiToken: string;
  bitcartApiTokenConfigured: boolean;
  bitcartStoreId: string;
  bitcartCurrency: string;
  bitcartWebhookBaseUrl: string;
  bitcartWebhookSecret: string;
  bitcartWebhookSecretConfigured: boolean;
}

export interface EnergyLinkTestStep {
  key: string;
  title: string;
  status: string;
  message: string;
  details?: Record<string, string | number | boolean | null>;
}

export interface EnergyLinkTestResult {
  provider: string;
  environment: string;
  apiBaseUrl: string;
  energyAmount: number;
  durationHours: number;
  overallStatus: string;
  account?: {
    wallet: string;
    rechargeAddress: string;
    balanceSun: number;
    balanceTrx: number;
    balanceUsdtSun: number;
    balanceUsdt: number;
    whitelist: string;
  } | null;
  estimate?: {
    costSun: number;
    costTrx: number;
    requestPath: string;
  } | null;
  order?: {
    id: string;
    clientOrderId: string;
    resourceType: string;
    sourceType: string;
    receiver: string;
    delegateHash: string;
    reclaimHash: string;
    payAmountSun: number;
    payAmountTrx: number;
    activateAmountSun: number;
    activateAmountTrx: number;
    quantity: number;
    stakedSun: number;
    duration: number;
    expiredTimestamp: number;
    status: string;
    activateStatus: string;
    confirmStatus: string;
    balance: number;
    requestPath: string;
  } | null;
  steps: EnergyLinkTestStep[];
  testedAt: string;
}

@Injectable({
  providedIn: 'root'
})
export class EnergyRentalService {
  private http = inject(BaseHttpService);

  getDashboard(): Observable<EnergyRentalDashboard> {
    return this.http.get('/energy-rental/dashboard');
  }

  getPackages(param: SearchCommonVO<Partial<EnergyRentalPackage>>): Observable<PageInfo<EnergyRentalPackage>> {
    return this.http.post('/energy-rental/packages/list', param);
  }

  getPackageDetail(id: number): Observable<EnergyRentalPackage> {
    return this.http.get(`/energy-rental/packages/${id}`);
  }

  getPlatformPackageOptions(): Observable<EnergyRentalPackage[]> {
    return this.http.get('/energy-rental/packages/platform-options');
  }

  getPlatformPrices(param: SearchCommonVO<Partial<EnergyRentalPackage>>): Observable<PageInfo<EnergyRentalPackage>> {
    return this.http.post('/energy-rental/platform-prices/list', param);
  }

  getPlatformPriceDetail(id: number): Observable<EnergyRentalPackage> {
    return this.http.get(`/energy-rental/platform-prices/${id}`);
  }

  createPlatformPrice(param: Partial<EnergyRentalPackage>): Observable<void> {
    return this.http.post('/energy-rental/platform-prices/create', param, { needSuccessInfo: true });
  }

  updatePlatformPrice(param: Partial<EnergyRentalPackage>): Observable<void> {
    return this.http.put('/energy-rental/platform-prices/update', param, { needSuccessInfo: true });
  }

  deletePlatformPrices(ids: number[]): Observable<void> {
    return this.http.post('/energy-rental/platform-prices/del', { ids }, { needSuccessInfo: true });
  }

  estimatePackage(param: { energyAmount: number; durationHours?: number; priceTrx?: number }): Observable<EnergyPackageEstimate> {
    return this.http.post('/energy-rental/packages/estimate', param);
  }

  createPackage(param: Partial<EnergyRentalPackage>): Observable<void> {
    return this.http.post('/energy-rental/packages/create', param, { needSuccessInfo: true });
  }

  updatePackage(param: Partial<EnergyRentalPackage>): Observable<void> {
    return this.http.put('/energy-rental/packages/update', param, { needSuccessInfo: true });
  }

  deletePackages(ids: number[]): Observable<void> {
    return this.http.post('/energy-rental/packages/del', { ids }, { needSuccessInfo: true });
  }

  getOrders(param: SearchCommonVO<Partial<EnergyRentalOrder>>): Observable<PageInfo<EnergyRentalOrder>> {
    return this.http.post('/energy-rental/orders/list', param);
  }

  getAddresses(param: SearchCommonVO<Partial<EnergyUserAddressStats>>): Observable<PageInfo<EnergyUserAddressStats>> {
    return this.http.post('/energy-rental/addresses/list', param);
  }

  getOrderDetail(id: number): Observable<EnergyRentalOrder> {
    return this.http.get(`/energy-rental/orders/${id}`);
  }

  updateOrder(param: Partial<EnergyRentalOrder>): Observable<void> {
    return this.http.put('/energy-rental/orders/update', param, { needSuccessInfo: true });
  }

  getWalletTransactions(param: SearchCommonVO<Partial<WalletTransaction>>): Observable<PageInfo<WalletTransaction>> {
    return this.http.post('/energy-rental/wallet-transactions/list', param);
  }

  getReturnTasks(param: SearchCommonVO<Partial<ReturnTask>>): Observable<PageInfo<ReturnTask>> {
    return this.http.post('/energy-rental/return-tasks/list', param);
  }

  retryReturnTask(id: number): Observable<void> {
    return this.http.post(`/energy-rental/return-tasks/${id}/retry`, undefined, { needSuccessInfo: true });
  }

  getPlatformConfig(): Observable<EnergyPlatformConfig> {
    return this.http.get('/energy-rental/platform-config');
  }

  getAgentAccount(): Observable<AgentAccount> {
    return this.http.get('/energy-rental/agent-account');
  }

  getAgentBotConfig(): Observable<AgentBotConfig> {
    return this.http.get('/energy-rental/agent-bot-config');
  }

  updateAgentBotConfig(param: Partial<AgentBotConfig>): Observable<void> {
    return this.http.put('/energy-rental/agent-bot-config/update', param, { needSuccessInfo: true });
  }

  getBotRuntimeStatus(): Observable<BotRuntimeStatus> {
    return this.http.get('/energy-rental/bot-runtime/status');
  }

  updateBotRuntimeStatus(param: { botStatus: 'enabled' | 'disabled' }): Observable<void> {
    return this.http.put('/energy-rental/bot-runtime/status', param, { needSuccessInfo: true });
  }

  getAgentRechargeOrders(param: SearchCommonVO<Partial<AgentRechargeOrder>>): Observable<PageInfo<AgentRechargeOrder>> {
    return this.http.post('/energy-rental/agent-recharges/list', param);
  }

  createAgentRechargeOrder(param: { amountTrx: number }): Observable<AgentRechargeOrder> {
    return this.http.post('/energy-rental/agent-recharges/create', param);
  }

  syncAgentRechargeOrder(id: number): Observable<{ credited: boolean; status: string }> {
    return this.http.post(`/energy-rental/agent-recharges/${id}/sync`);
  }

  updatePlatformConfig(param: Partial<EnergyPlatformConfig>): Observable<void> {
    return this.http.put('/energy-rental/platform-config/update', param, { needSuccessInfo: true });
  }

  runLinkTest(param: {
    energyAmount: number;
    durationHours?: number;
    createOrder?: boolean;
    receiverAddress?: string;
    clientOrderId?: string;
  }): Observable<EnergyLinkTestResult> {
    return this.http.post('/energy-rental/link-test/run', param);
  }

  previewProviderRecharge(param: { provider: string; amountTrx: number }): Observable<ProviderRechargePreview> {
    return this.http.post('/energy-rental/provider-recharge/preview', param);
  }

  rechargeProviderBalance(param: { provider: string; amountTrx: number }): Observable<ProviderRechargeResult> {
    return this.http.post('/energy-rental/provider-recharge', param, { needSuccessInfo: true });
  }
}
