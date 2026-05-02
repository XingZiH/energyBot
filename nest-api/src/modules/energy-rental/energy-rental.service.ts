import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { FilterParam, TableDataInfo } from '../../common/result/result';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.provider';
import * as schema from '../../drizzle/schema';
import {
  agentBotConfigsTable,
  agentProfilesTable,
  agentRechargeOrdersTable,
  agentWalletAccountsTable,
  botRuntimeStatusTable,
  energyOrdersTable,
  energyPackagesTable,
  energyPlatformConfigTable,
  energyReturnTasksTable,
  energyUserAddressesTable,
  energyWalletTransactionsTable,
  sysUserRoleTable,
} from '../../drizzle/schema';
import {
  CreateEnergyPackageDto,
  EnergyAddressFiltersDto,
  EnergyOrderFiltersDto,
  EnergyPackageFiltersDto,
  EstimateEnergyPackageDto,
  PreviewProviderRechargeDto,
  RechargeProviderBalanceDto,
  RunLinkTestDto,
  ReturnTaskFiltersDto,
  UpdateEnergyOrderDto,
  UpdateEnergyPackageDto,
  UpdatePlatformConfigDto,
  WalletTransactionFiltersDto,
  UpdateAgentBotConfigDto,
  UpdateBotRuntimeStatusDto,
  CreateAgentRechargeOrderDto,
  AgentRechargeOrderFiltersDto,
  BitcartInvoiceWebhookDto,
} from './dto/energy-rental.dto';

type Row = Record<string, any>;
type LinkTestStepStatus = 'success' | 'warning' | 'failed';
type ProviderBalanceStatus = 'ok' | 'warning' | 'unconfigured' | 'error';

interface LinkTestStep {
  key: string;
  title: string;
  status: LinkTestStepStatus;
  message: string;
  details?: Row;
}

interface ProviderBalanceMonitor {
  provider: string;
  providerLabel: string;
  channel: string;
  channelLabel: string;
  status: ProviderBalanceStatus;
  wallet: string;
  rechargeAddress: string;
  balanceSun: number;
  balanceTrx: number;
  alertThresholdSun: number;
  alertThresholdTrx: number;
  message: string;
  checkedAt: string;
}

interface AccessScope {
  scope: 'platform' | 'agent';
  userId?: number;
  agentId?: number;
}

interface BitcartConfig {
  apiBaseUrl: string;
  adminBaseUrl: string;
  apiToken: string;
  storeId: string;
  currency: string;
  webhookBaseUrl: string;
  webhookSecret: string;
}

interface BitcartInvoicePayment {
  id?: string;
  currency?: string;
  payment_address?: string;
  payment_url?: string;
  amount?: string | number;
}

interface BitcartInvoice {
  id: string;
  status: string;
  store_id?: string | null;
  order_id?: string | null;
  currency?: string;
  sent_amount?: string | number;
  payment_id?: string | null;
  paid_currency?: string | null;
  exception_status?: string | null;
  tx_hashes?: string[];
  payments?: BitcartInvoicePayment[];
}

interface OnChainRechargePayment {
  txHash: string;
  amountSun: number;
  amountTrx: string;
  confirmedAt: Date;
}

interface ConfirmAgentRechargePaymentInput {
  invoiceId: string;
  txHash: string;
  paymentAddress: string;
  bitcartInvoiceStatus: string;
  bitcartPaymentId: string;
  bitcartPaymentUrl: string;
  bitcartPaymentCurrency: string;
  bitcartPaymentAmount: string | null;
  bitcartExceptionStatus: string | null;
  bitcartSentAmount: string | null;
  bitcartPaidCurrency: string | null;
  confirmedAt: Date;
  orderPaymentTtlMinutes?: unknown;
}

const platformConfigDefaults = {
  botStatus: 'disabled',
  tronApiBaseUrl: 'https://api.trongrid.io',
  energyProvider: 'justlend',
  catfeeEnvironment: 'nile',
  catfeeProdApiBaseUrl: 'https://api.catfee.io',
  catfeeNileApiBaseUrl: 'https://nile.catfee.io',
  catfeeAutoActivate: true,
  orderPaymentTtlMinutes: 10,
  telegramPollingIntervalSeconds: 2,
  workerIntervalSeconds: 60,
  minTrxReserveSun: '10000000',
  bitcartApiBaseUrl: '',
  bitcartAdminBaseUrl: '',
  bitcartCurrency: 'TRX',
};

const MIN_PACKAGE_ENERGY_AMOUNT = 1;
const MIN_CATFEE_ENERGY_AMOUNT = 65000;
const MIN_JUSTLEND_ENERGY_AMOUNT = 100000;
const MIN_PROVIDER_BALANCE_RESERVE_SUN = 10_000_000;
const LINK_TEST_DEFAULT_ENERGY_AMOUNT = MIN_CATFEE_ENERGY_AMOUNT;
const LINK_TEST_ORDER_POLL_ATTEMPTS = 6;
const LINK_TEST_ORDER_POLL_INTERVAL_MS = 3_000;
const CATFEE_GET_RETRY_ATTEMPTS = 2;
const JUSTLEND_DASHBOARD_URL = 'https://labc.ablesdxd.link/strx/dashboard';
const MAX_ACTIVE_PENDING_RECHARGE_ORDERS_PER_AGENT = 3;
const MAX_BITCART_PAYABLE_AMOUNT_OFFSET_SUN = 999;
const BOT_RUNTIME_HEARTBEAT_STALE_MS = 90_000;
const PACKAGE_KIND_PLATFORM_PRICE = 'platform_price';
const PACKAGE_KIND_ADMIN_PACKAGE = 'admin_package';
const PACKAGE_KIND_USER_PACKAGE = 'user_package';
const PAYMENT_GATEWAY_BITCART = 'bitcart';
const BITCART_FINAL_PAID_STATUS = 'complete';
const BITCART_ONCHAIN_CONFIRMED_STATUS = 'onchain_confirmed';
const BITCART_FAILED_STATUSES = new Set(['expired', 'invalid', 'failed']);

@Injectable()
export class EnergyRentalService {
  constructor(
    @Inject(DrizzleAsyncProvider) private conn: NodePgDatabase<typeof schema>,
  ) {}

  async getDashboard(userId?: number) {
    const [packages, orders, walletTransactions, returnTasks, config, scope] =
      await Promise.all([
        this.getRows<Row>(energyPackagesTable),
        this.getRows<Row>(energyOrdersTable),
        this.getRows<Row>(energyWalletTransactionsTable),
        this.getRows<Row>(energyReturnTasksTable),
        this.findPlatformConfigRow(),
        this.resolveAccessScope(userId),
      ]);
    const scopedOrders = this.applyAgentScope(orders, scope);
    const scopedWalletTransactions = this.applyAgentScope(
      walletTransactions,
      scope,
    );
    const scopedReturnTasks =
      scope.scope === 'agent'
        ? []
        : this.applyAgentScope(returnTasks, scope);
    const walletAccount =
      scope.scope === 'agent'
        ? await this.findAgentWalletAccount(scope.agentId)
        : null;
    const providerBalanceMonitors =
      scope.scope === 'agent'
        ? []
        : await this.getProviderBalanceMonitors(config);

    const walletIncomeSun = sumBy(
      scopedWalletTransactions.filter((item) => item.direction === 'in'),
      'amountSun',
    );
    const walletExpenseSun = sumBy(
      scopedWalletTransactions.filter((item) => item.direction === 'out'),
      'amountSun',
    );

    return {
      ...(scope.scope === 'agent'
        ? {
            scope: scope.scope,
            agentId: scope.agentId ?? null,
            agentWalletBalanceSun: Number(walletAccount?.balanceSun ?? 0),
          }
        : {}),
      activePackageCount: packageRowsForScope(packages, scope).filter(
        (item) => item.status === 'active',
      ).length,
      activeRentalCount: scopedOrders.filter((item) => item.status === 'renting')
        .length,
      failedReturnTaskCount: scopedReturnTasks.filter(
        (item) => item.status === 'failed',
      ).length,
      netWalletSun: walletIncomeSun - walletExpenseSun,
      overdueReturnTaskCount: scopedReturnTasks.filter(
        (item) => item.status === 'failed',
      ).length,
      pendingOrderCount: scopedOrders.filter((item) => item.status === 'pending')
        .length,
      providerBalanceMonitors,
      totalEnergyRented: sumBy(
        scopedOrders.filter((item) => isSettledOrder(item)),
        'energyAmount',
      ),
      totalOrderCount: scopedOrders.length,
      totalRevenueSun: sumBy(
        scopedOrders.filter((item) => isSettledOrder(item)),
        'paymentAmountSun',
      ),
      walletExpenseSun,
      walletIncomeSun,
    };
  }

  async findPackages(
    searchParam: FilterParam<EnergyPackageFiltersDto>,
    userId?: number,
  ) {
    const now = new Date();
    const [packages, scope] = await Promise.all([
      this.getRows<Row>(energyPackagesTable),
      this.resolveAccessScope(userId),
    ]);
    const rows = packageRowsForScope(packages, scope, now);
    return this.toTableData(
      rows,
      searchParam,
      (item, filters) =>
        matchesText(item.packageName, filters.packageName) &&
        matchesExact(item.status, filters.status),
      (a, b) =>
        Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0) ||
        Number(a.id ?? 0) - Number(b.id ?? 0),
    );
  }

  async findPlatformPackageOptions() {
    const now = new Date();
    return (await this.getRows<Row>(energyPackagesTable))
      .filter((item) => isPlatformPackageTemplate(item))
      .filter((item) => String(item.status ?? 'active') === 'active')
      .filter((item) => !item.deletedAt)
      .map((item) => withCurrentPackagePrice(item, now))
      .sort(
        (a, b) =>
          Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0) ||
          Number(a.id ?? 0) - Number(b.id ?? 0),
      );
  }

  async findPlatformPrices(
    searchParam: FilterParam<EnergyPackageFiltersDto>,
  ) {
    const now = new Date();
    const rows = (await this.getRows<Row>(energyPackagesTable))
      .filter((item) => isPlatformPackageTemplate(item))
      .map((item) => withCurrentPackagePrice(item, now));
    return this.toTableData(
      rows,
      searchParam,
      (item, filters) =>
        matchesText(item.packageName, filters.packageName) &&
        matchesExact(item.status, filters.status),
      (a, b) =>
        Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0) ||
        Number(a.id ?? 0) - Number(b.id ?? 0),
    );
  }

  async findPlatformPrice(id: number) {
    const now = new Date();
    const row = (await this.getRows<Row>(energyPackagesTable)).find(
      (item) => Number(item.id) === Number(id) && isPlatformPackageTemplate(item),
    );
    return row ? withCurrentPackagePrice(row, now) : null;
  }

  async findPackage(id: number, userId?: number) {
    const now = new Date();
    const [packages, scope] = await Promise.all([
      this.getRows<Row>(energyPackagesTable),
      this.resolveAccessScope(userId),
    ]);
    return (
      packageRowsForScope(packages, scope, now).find(
        (item) => Number(item.id) === id,
      ) ?? null
    );
  }

  async estimatePackage(data: EstimateEnergyPackageDto, userId?: number) {
    const scope = await this.resolveAccessScope(userId);
    if (scope.scope === 'agent') {
      throw new BadRequestException('当前用户不能查看平台服务商价格');
    }
    const energyAmount = Number(data.energyAmount);
    const durationHours = Number(data.durationHours || 1);
    const salePriceTrx =
      data.priceTrx === undefined || data.priceTrx === null
        ? 0
        : Number(data.priceTrx);

    if (!Number.isFinite(durationHours) || durationHours <= 0) {
      throw new BadRequestException('租赁时长必须大于 0');
    }

    const config = await this.findPlatformConfigRow();
    const provider = normalizeProvider(config?.energyProvider);
    this.assertPackageAmount(energyAmount, provider);
    if (provider === 'catfee') {
      return this.estimateCatFeePackage(config, {
        energyAmount,
        durationHours,
        salePriceTrx,
      });
    }

    const dashboard = await this.fetchJustLendDashboard();
    const energyRentPerTrx = positiveNumber(
      dashboard.energyRentPerTrx,
      'energyRentPerTrx',
    );
    const energyStakePerTrx = positiveNumber(
      dashboard.energyStakePerTrx,
      'energyStakePerTrx',
    );
    const rentFeeTrx = (energyAmount / energyRentPerTrx) * (durationHours / 24);
    const securityDepositTrx = energyAmount / energyRentPerTrx;
    const delegatedTrx = energyAmount / energyStakePerTrx;
    const liquidationReserveTrx = Math.max(delegatedTrx * 0.00008, 20);
    const platformCapitalTrx = securityDepositTrx + liquidationReserveTrx;
    const totalPrepayTrx = rentFeeTrx + platformCapitalTrx;
    const profitTrx = salePriceTrx - rentFeeTrx;

    return {
      energyAmount,
      durationHours,
      minEnergyAmount: MIN_JUSTLEND_ENERGY_AMOUNT,
      energyRentPerTrx: roundTrx(energyRentPerTrx),
      energyStakePerTrx: roundTrx(energyStakePerTrx),
      unitDailyPriceTrx: roundTrx(MIN_JUSTLEND_ENERGY_AMOUNT / energyRentPerTrx),
      rentFeeTrx: roundTrx(rentFeeTrx),
      securityDepositTrx: roundTrx(securityDepositTrx),
      liquidationReserveTrx: roundTrx(liquidationReserveTrx),
      totalPrepayTrx: roundTrx(totalPrepayTrx),
      platformCapitalTrx: roundTrx(platformCapitalTrx),
      delegatedTrx: roundTrx(delegatedTrx),
      salePriceTrx: roundTrx(salePriceTrx),
      profitTrx: roundTrx(profitTrx),
      profitRate:
        salePriceTrx > 0 ? roundTrx((profitTrx / salePriceTrx) * 100) : 0,
      provider: 'justlend',
      providerLabel: 'JustLend',
      trxPriceUsd: numberOrNull(dashboard.trxPrice),
      source: JUSTLEND_DASHBOARD_URL,
      estimatedAt: new Date().toISOString(),
    };
  }

  async createPackage(
    userIdOrData: number | undefined | CreateEnergyPackageDto,
    dataArg?: CreateEnergyPackageDto,
  ) {
    const userId =
      typeof userIdOrData === 'object' ? undefined : userIdOrData;
    const data =
      typeof userIdOrData === 'object'
        ? userIdOrData
        : (dataArg ?? ({} as CreateEnergyPackageDto));
    const scope = await this.resolveAccessScope(userId);
    if (scope.scope === 'agent') {
      return this.createAgentPackage(scope, data);
    }

    return this.createAdminPackage(data);
  }

  async createPlatformPrice(data: CreateEnergyPackageDto) {
    const config = await this.findPlatformConfigRow();
    this.assertPackageAmount(
      data.energyAmount,
      normalizeProvider(config?.energyProvider),
    );
    await (this.conn as any)
      .insert(energyPackagesTable)
      .values({
        packageKind: PACKAGE_KIND_PLATFORM_PRICE,
        agentId: null,
        platformPackageId: null,
        ...this.buildPackageValues(data, true),
      });
    return null;
  }

  async updatePackage(
    userIdOrData: number | undefined | UpdateEnergyPackageDto,
    dataArg?: UpdateEnergyPackageDto,
  ) {
    const userId =
      typeof userIdOrData === 'object' ? undefined : userIdOrData;
    const data =
      typeof userIdOrData === 'object'
        ? userIdOrData
        : (dataArg ?? ({} as UpdateEnergyPackageDto));
    const scope = await this.resolveAccessScope(userId);
    if (scope.scope === 'agent') {
      return this.updateAgentPackage(scope, data);
    }

    return this.updateAdminPackage(data);
  }

  async updatePlatformPrice(data: UpdateEnergyPackageDto) {
    const { id, ...obj } = data;
    const rows = await this.getRows<Row>(energyPackagesTable);
    const current = rows.find(
      (item) =>
        Number(item.id) === Number(id) && isPlatformPackageTemplate(item),
    );
    if (!current) {
      throw new BadRequestException('平台价格不存在或无权编辑');
    }
    if (obj.energyAmount !== undefined && obj.energyAmount !== null) {
      const config = await this.findPlatformConfigRow();
      this.assertPackageAmount(
        obj.energyAmount,
        normalizeProvider(config?.energyProvider),
      );
    }
    await this.conn
      .update(energyPackagesTable)
      .set({
        ...this.buildPackageValues(obj),
        packageKind: PACKAGE_KIND_PLATFORM_PRICE,
        agentId: null,
        platformPackageId: null,
        updatedAt: new Date(),
      } as any)
      .where(eq(energyPackagesTable.id, id));
    return null;
  }

  async removePackages(ids: number[], userId?: number) {
    if (!ids.length) return null;
    const scope = await this.resolveAccessScope(userId);
    if (scope.scope === 'agent') {
      const rows = await this.getRows<Row>(energyPackagesTable);
      const ownedIds = new Set(
        packageRowsForScope(rows, scope)
          .filter((item) => ids.includes(Number(item.id)))
          .map((item) => Number(item.id)),
      );
      if (ownedIds.size !== ids.length) {
        throw new BadRequestException('套餐不存在或无权删除');
      }
    } else {
      const rows = await this.getRows<Row>(energyPackagesTable);
      const ownedIds = new Set(
        rows
          .filter((item) => isPlatformOwnedPackage(item))
          .filter((item) => ids.includes(Number(item.id)))
          .map((item) => Number(item.id)),
      );
      if (ownedIds.size !== ids.length) {
        throw new BadRequestException('套餐不存在或无权删除');
      }
    }
    await this.conn
      .delete(energyPackagesTable)
      .where(inArray(energyPackagesTable.id, ids));
    return null;
  }

  async removePlatformPrices(ids: number[]) {
    if (!ids.length) return null;
    const rows = await this.getRows<Row>(energyPackagesTable);
    const templateIds = new Set(
      rows
        .filter((item) => isPlatformPackageTemplate(item))
        .filter((item) => ids.includes(Number(item.id)))
        .map((item) => Number(item.id)),
    );
    if (templateIds.size !== ids.length) {
      throw new BadRequestException('平台价格不存在或无权删除');
    }

    const referencedIds = new Set(
      rows
        .filter((item) => !item.deletedAt)
        .filter((item) => packageKindOf(item) === PACKAGE_KIND_USER_PACKAGE)
        .map((item) => Number(item.platformPackageId ?? 0))
        .filter((id) => ids.includes(id)),
    );
    if (referencedIds.size > 0) {
      throw new BadRequestException(
        '平台价格已被套餐引用，请先停用或迁移对应套餐后再删除',
      );
    }

    await this.conn
      .delete(energyPackagesTable)
      .where(inArray(energyPackagesTable.id, ids));
    return null;
  }

  async findOrders(
    searchParam: FilterParam<EnergyOrderFiltersDto>,
    userId?: number,
  ) {
    const scope = await this.resolveAccessScope(userId);
    const rows = this.applyAgentScope(
      await this.getRows<Row>(energyOrdersTable),
      scope,
    ).map((item) => sanitizeOrderForScope(item, scope));
    return this.toTableData(
      rows,
      searchParam,
      (item, filters) =>
        matchesText(item.orderNo, filters.orderNo) &&
        matchesNumber(item.packageId, filters.packageId) &&
        matchesText(item.buyerAddress, filters.buyerAddress) &&
        matchesText(item.receiverAddress, filters.receiverAddress) &&
        matchesExact(item.status, filters.status) &&
        matchesExact(item.returnStatus, filters.returnStatus),
    );
  }

  async findAddresses(
    searchParam: FilterParam<EnergyAddressFiltersDto>,
    userId?: number,
  ) {
    const [addresses, orders, scope] = await Promise.all([
      this.getRows<Row>(energyUserAddressesTable),
      this.getRows<Row>(energyOrdersTable),
      this.resolveAccessScope(userId),
    ]);
    const scopedAddresses = this.applyAgentScope(addresses, scope);
    const statsByAddress = buildAddressStats(this.applyAgentScope(orders, scope));
    const rows: Row[] = scopedAddresses.map((item) => ({
      ...item,
      telegramChatId: String(item.telegramChatId ?? ''),
      ...(statsByAddress.get(normalizeAddressKey(item.address)) ??
        emptyAddressStats()),
    }));

    return this.toTableData(
      rows,
      searchParam,
      (item, filters) =>
        matchesText(item.telegramChatId, filters.telegramChatId) &&
        matchesText(item.label, filters.label) &&
        matchesText(item.address, filters.address) &&
        matchesExact(item.status, filters.status),
    );
  }

  async findOrder(id: number, userId?: number) {
    const scope = await this.resolveAccessScope(userId);
    const order = await this.findById(energyOrdersTable, id);
    if (!order || !this.rowVisibleInScope(order, scope)) return null;
    return sanitizeOrderForScope(order, scope);
  }

  async updateOrder(data: UpdateEnergyOrderDto) {
    const { id, ...obj } = data;
    await this.conn
      .update(energyOrdersTable)
      .set({ ...obj, updatedAt: new Date() } as any)
      .where(eq(energyOrdersTable.id, id));
    return null;
  }

  async findWalletTransactions(
    searchParam: FilterParam<WalletTransactionFiltersDto>,
    userId?: number,
  ) {
    const scope = await this.resolveAccessScope(userId);
    const rows = this.applyAgentScope(
      await this.getRows<Row>(energyWalletTransactionsTable),
      scope,
    );
    return this.toTableData(
      rows,
      searchParam,
      (item, filters) =>
        matchesText(item.txHash, filters.txHash) &&
        matchesText(item.walletAddress, filters.walletAddress) &&
        matchesExact(item.direction, filters.direction) &&
        matchesExact(item.transactionType, filters.transactionType) &&
        matchesExact(item.status, filters.status) &&
        matchesNumber(item.relatedOrderId, filters.relatedOrderId),
    );
  }

  async findReturnTasks(searchParam: FilterParam<ReturnTaskFiltersDto>) {
    const rows = await this.getRows<Row>(energyReturnTasksTable);
    return this.toTableData(
      rows,
      searchParam,
      (item, filters) =>
        matchesNumber(item.orderId, filters.orderId) &&
        matchesText(item.receiverAddress, filters.receiverAddress) &&
        matchesExact(item.status, filters.status),
    );
  }

  async retryReturnTask(id: number) {
    await this.conn
      .update(energyReturnTasksTable)
      .set({
        status: 'pending',
        lastError: null,
        nextRetryAt: null,
        updatedAt: new Date(),
      } as any)
      .where(eq(energyReturnTasksTable.id, id));
    return null;
  }

  async getPlatformConfig() {
    const row = await this.findPlatformConfigRow();
    return {
      botStatus: row?.botStatus ?? platformConfigDefaults.botStatus,
      telegramBotToken: '',
      telegramBotTokenConfigured: hasValue(row?.telegramBotToken),
      tronApiBaseUrl:
        row?.tronApiBaseUrl ?? platformConfigDefaults.tronApiBaseUrl,
      tronApiKey: '',
      tronApiKeyConfigured: hasValue(row?.tronApiKey),
      justlendContractAddress: row?.justlendContractAddress ?? '',
      justlendPayerPrivateKey: '',
      justlendPayerPrivateKeyConfigured: hasValue(row?.justlendPayerPrivateKey),
      energyProvider:
        row?.energyProvider ?? platformConfigDefaults.energyProvider,
      catfeeEnvironment:
        row?.catfeeEnvironment ?? platformConfigDefaults.catfeeEnvironment,
      catfeeProdApiBaseUrl:
        row?.catfeeProdApiBaseUrl ??
        platformConfigDefaults.catfeeProdApiBaseUrl,
      catfeeProdApiKey: '',
      catfeeProdApiKeyConfigured: hasValue(row?.catfeeProdApiKey),
      catfeeProdApiSecret: '',
      catfeeProdApiSecretConfigured: hasValue(row?.catfeeProdApiSecret),
      catfeeNileApiBaseUrl:
        row?.catfeeNileApiBaseUrl ??
        platformConfigDefaults.catfeeNileApiBaseUrl,
      catfeeNileApiKey: '',
      catfeeNileApiKeyConfigured: hasValue(row?.catfeeNileApiKey),
      catfeeNileApiSecret: '',
      catfeeNileApiSecretConfigured: hasValue(row?.catfeeNileApiSecret),
      catfeeAutoActivate:
        row?.catfeeAutoActivate ??
        platformConfigDefaults.catfeeAutoActivate,
      orderPaymentTtlMinutes: numberOrDefault(
        row?.orderPaymentTtlMinutes,
        platformConfigDefaults.orderPaymentTtlMinutes,
      ),
      telegramPollingIntervalSeconds: numberOrDefault(
        row?.telegramPollingIntervalSeconds,
        platformConfigDefaults.telegramPollingIntervalSeconds,
      ),
      workerIntervalSeconds: numberOrDefault(
        row?.workerIntervalSeconds,
        platformConfigDefaults.workerIntervalSeconds,
      ),
      minTrxReserveSun: String(
        providerBalanceReserveSun(
          row?.minTrxReserveSun ?? platformConfigDefaults.minTrxReserveSun,
        ),
      ),
      bitcartApiBaseUrl:
        row?.bitcartApiBaseUrl ?? platformConfigDefaults.bitcartApiBaseUrl,
      bitcartAdminBaseUrl:
        row?.bitcartAdminBaseUrl ?? platformConfigDefaults.bitcartAdminBaseUrl,
      bitcartApiToken: '',
      bitcartApiTokenConfigured: hasValue(row?.bitcartApiToken),
      bitcartStoreId: row?.bitcartStoreId ?? '',
      bitcartCurrency:
        row?.bitcartCurrency ?? platformConfigDefaults.bitcartCurrency,
      bitcartWebhookBaseUrl: row?.bitcartWebhookBaseUrl ?? '',
      bitcartWebhookSecret: '',
      bitcartWebhookSecretConfigured: hasValue(row?.bitcartWebhookSecret),
    };
  }

  async updatePlatformConfig(data: UpdatePlatformConfigDto) {
    const current = await this.findPlatformConfigRow();
    const values = this.buildPlatformConfigValues(data, !current);

    if (current) {
      await this.conn
        .update(energyPlatformConfigTable)
        .set({ ...values, updatedAt: new Date() } as any)
        .where(eq(energyPlatformConfigTable.id, current.id));
    } else {
      await (this.conn as any)
        .insert(energyPlatformConfigTable)
        .values({ id: 1, ...values });
    }
    return null;
  }

  async getAgentAccount(userId?: number) {
    const scope = await this.resolveRequiredAgentScope(userId);
    const [walletAccount, config] = await Promise.all([
      this.findAgentWalletAccount(scope.agentId),
      this.findPlatformConfigRow(),
    ]);
    return {
      agentId: scope.agentId,
      balanceSun: String(walletAccount?.balanceSun ?? '0'),
      balanceTrx: roundTrx(Number(walletAccount?.balanceSun ?? 0) / 1_000_000),
      totalRechargeSun: String(walletAccount?.totalRechargeSun ?? '0'),
      totalDeductedSun: String(walletAccount?.totalDeductedSun ?? '0'),
      rechargeTtlMinutes: numberOrDefault(
        config?.orderPaymentTtlMinutes,
        platformConfigDefaults.orderPaymentTtlMinutes,
      ),
    };
  }

  async getAgentBotConfig(userId?: number) {
    const scope = await this.resolveAccessScope(userId);
    if (scope.scope !== 'agent') {
      const row = await this.findPlatformConfigRow();
      return {
        scope: 'platform',
        agentId: null,
        botStatus: row?.botStatus ?? platformConfigDefaults.botStatus,
        telegramBotToken: '',
        telegramBotTokenConfigured: hasValue(row?.telegramBotToken),
        telegramBotUsername: '',
        welcomeText: row?.welcomeText ?? '',
        messageConfig: row?.messageConfig ?? '',
        menuConfig: row?.menuConfig ?? '',
        remark: '',
      };
    }
    const rows = await this.getRows<Row>(agentBotConfigsTable);
    const row = rows.find((item) => Number(item.agentId) === scope.agentId);
    return {
      scope: 'agent',
      agentId: scope.agentId,
      botStatus: row?.botStatus ?? 'disabled',
      telegramBotToken: '',
      telegramBotTokenConfigured: hasValue(row?.telegramBotToken),
      telegramBotUsername: row?.telegramBotUsername ?? '',
      welcomeText: row?.welcomeText ?? '',
      messageConfig: row?.messageConfig ?? '',
      menuConfig: row?.menuConfig ?? '',
      remark: row?.remark ?? '',
    };
  }

  async updateAgentBotConfig(userId: number | undefined, data: UpdateAgentBotConfigDto) {
    const scope = await this.resolveAccessScope(userId);
    if (scope.scope !== 'agent') {
      const current = await this.findPlatformConfigRow();
      const values: Row = {};
      setTrimmed(values, 'botStatus', data.botStatus);
      setSecret(values, 'telegramBotToken', data.telegramBotToken);
      setTrimmed(values, 'welcomeText', data.welcomeText);
      setTrimmed(values, 'messageConfig', data.messageConfig);
      setTrimmed(values, 'menuConfig', data.menuConfig);

      if (current) {
        await this.conn
          .update(energyPlatformConfigTable)
          .set({ ...values, updatedAt: new Date() } as any)
          .where(eq(energyPlatformConfigTable.id, current.id));
      } else {
        await (this.conn as any)
          .insert(energyPlatformConfigTable)
          .values({ id: 1, ...platformConfigDefaults, ...values });
      }
      return null;
    }

    const values: Row = {};
    setTrimmed(values, 'botStatus', data.botStatus);
    setSecret(values, 'telegramBotToken', data.telegramBotToken);
    setTrimmed(values, 'telegramBotUsername', data.telegramBotUsername);
    setTrimmed(values, 'welcomeText', data.welcomeText);
    setTrimmed(values, 'messageConfig', data.messageConfig);
    setTrimmed(values, 'menuConfig', data.menuConfig);
    setTrimmed(values, 'remark', data.remark);

    const rows = await this.getRows<Row>(agentBotConfigsTable);
    const current = rows.find((item) => Number(item.agentId) === scope.agentId);
    if (current) {
      await this.conn
        .update(agentBotConfigsTable)
        .set({ ...values, updatedAt: new Date() } as any)
        .where(eq(agentBotConfigsTable.id, current.id));
    } else {
      await (this.conn as any)
        .insert(agentBotConfigsTable)
        .values({ agentId: scope.agentId, botStatus: 'disabled', ...values });
    }
    return null;
  }

  async getBotRuntimeStatus(userId?: number, now = new Date()) {
    const scope = await this.resolveAccessScope(userId);
    const [
      platformConfig,
      agentProfiles,
      agentBotConfigs,
      runtimeRows,
    ] = await Promise.all([
      this.findPlatformConfigRow(),
      this.getRows<Row>(agentProfilesTable),
      this.getRows<Row>(agentBotConfigsTable),
      this.getRows<Row>(botRuntimeStatusTable),
    ]);

    if (scope.scope === 'agent') {
      const config = agentBotConfigs.find(
        (item) => Number(item.agentId) === Number(scope.agentId),
      );
      return this.buildBotRuntimeStatus({
        scope: 'agent',
        agentId: scope.agentId ?? null,
        desiredStatus: normalizeBotStatus(config?.botStatus),
        tokenConfigured: hasValue(config?.telegramBotToken),
        runtime: latestBotRuntimeStatus(runtimeRows, 'agent', scope.agentId),
        now,
      });
    }

    return this.buildBotRuntimeStatus({
      scope: 'platform',
      agentId: null,
      desiredStatus: normalizeBotStatus(platformConfig?.botStatus),
      tokenConfigured: hasValue(platformConfig?.telegramBotToken),
      runtime: latestBotRuntimeStatus(runtimeRows, 'platform', null),
      now,
      activeAgentBotCount: countActiveAgentBots(agentProfiles, agentBotConfigs),
    });
  }

  async updateBotRuntimeStatus(
    userId: number | undefined,
    data: UpdateBotRuntimeStatusDto,
  ) {
    const botStatus = assertBotStatus(data.botStatus);
    const scope = await this.resolveAccessScope(userId);
    const now = new Date();

    if (scope.scope === 'agent') {
      const rows = await this.getRows<Row>(agentBotConfigsTable);
      const current = rows.find(
        (item) => Number(item.agentId) === Number(scope.agentId),
      );
      if (botStatus === 'enabled' && !hasValue(current?.telegramBotToken)) {
        throw new BadRequestException('请先配置 Telegram Bot Token');
      }
      if (current) {
        await this.conn
          .update(agentBotConfigsTable)
          .set({ botStatus, updatedAt: now } as any)
          .where(eq(agentBotConfigsTable.id, current.id));
      } else {
        await (this.conn as any).insert(agentBotConfigsTable).values({
          agentId: scope.agentId,
          botStatus,
          createdAt: now,
          updatedAt: now,
        });
      }
      return null;
    }

    const current = await this.findPlatformConfigRow();
    if (botStatus === 'enabled' && !hasValue(current?.telegramBotToken)) {
      throw new BadRequestException('请先配置平台 Telegram Bot Token');
    }
    if (current) {
      await this.conn
        .update(energyPlatformConfigTable)
        .set({ botStatus, updatedAt: now } as any)
        .where(eq(energyPlatformConfigTable.id, current.id));
    } else {
      await (this.conn as any).insert(energyPlatformConfigTable).values({
        id: 1,
        ...platformConfigDefaults,
        botStatus,
        createdAt: now,
        updatedAt: now,
      });
    }
    return null;
  }

  async createAgentRechargeOrder(
    userId: number | undefined,
    data: CreateAgentRechargeOrderDto,
  ) {
    const scope = await this.resolveRequiredAgentScope(userId);
    const requestedAmountSun = trxToSun(data.amountTrx);
    if (requestedAmountSun <= 0) {
      throw new BadRequestException('充值金额必须大于 0');
    }
    const config = await this.findPlatformConfigRow();
    const bitcart = bitcartConfigFor(config);
    const ttlMinutes = numberOrDefault(
      config?.orderPaymentTtlMinutes,
      platformConfigDefaults.orderPaymentTtlMinutes,
    );
    const now = new Date();
    const orderNo = newAgentRechargeOrderNo(now);
    const created = await this.conn.transaction(async (db) => {
      await this.lockAgentRechargeNamespace(db, scope.agentId, requestedAmountSun);
      await this.lockBitcartPayableAmountAllocation(db);
      const existingOrders = await this.getRowsFrom<Row>(
        db,
        agentRechargeOrdersTable,
      );
      assertAgentRechargeOrderCanBeCreated(
        scope.agentId,
        requestedAmountSun,
        existingOrders,
        now,
      );
      const payableAmountSun = allocateUniqueBitcartPayableAmountSun(
        requestedAmountSun,
        existingOrders,
        now,
      );
      const [createdOrder] = await (db as any)
        .insert(agentRechargeOrdersTable)
        .values({
          agentId: scope.agentId,
          orderNo,
          requestedAmountSun: String(requestedAmountSun),
          amountSun: String(payableAmountSun),
          paymentAddress: '',
          paymentGateway: PAYMENT_GATEWAY_BITCART,
          status: 'creating',
          expiresAt: new Date(now.getTime() + ttlMinutes * 60_000),
        })
        .returning({
          id: agentRechargeOrdersTable.id,
          orderNo: agentRechargeOrdersTable.orderNo,
          amountSun: agentRechargeOrdersTable.amountSun,
          paymentAddress: agentRechargeOrdersTable.paymentAddress,
          expiresAt: agentRechargeOrdersTable.expiresAt,
        });
      return createdOrder;
    });

    try {
      const invoice = await this.createBitcartInvoice(bitcart, {
        amountSun: Number(created.amountSun),
        orderNo,
        ttlMinutes,
      });
      const payment = firstBitcartPayment(invoice);
      const paymentAddress = String(payment?.payment_address ?? '').trim();
      if (!paymentAddress) {
        throw new BadRequestException('Bitcart 发票未返回付款地址');
      }
      const checkoutUrl = buildBitcartCheckoutUrl(bitcart, invoice.id);
      const updatedOrder = {
        ...created,
        paymentAddress,
        paymentGateway: PAYMENT_GATEWAY_BITCART,
        bitcartInvoiceId: invoice.id,
        bitcartInvoiceStatus: normalizeBitcartInvoiceStatus(invoice.status),
        bitcartCheckoutUrl: checkoutUrl,
        bitcartPaymentUrl: String(payment?.payment_url ?? ''),
        bitcartPaymentCurrency: String(
          payment?.currency ?? invoice.currency ?? bitcart.currency,
        ).toUpperCase(),
        bitcartPaymentAmount: normalizeDecimalText(payment?.amount),
        status: localRechargeStatusFromBitcart(invoice.status),
      };

      await this.conn
        .update(agentRechargeOrdersTable)
        .set({
          paymentAddress,
          paymentGateway: PAYMENT_GATEWAY_BITCART,
          bitcartInvoiceId: invoice.id,
          bitcartInvoiceStatus: updatedOrder.bitcartInvoiceStatus,
          bitcartCheckoutUrl: checkoutUrl,
          bitcartPaymentUrl: updatedOrder.bitcartPaymentUrl,
          bitcartPaymentCurrency: updatedOrder.bitcartPaymentCurrency,
          bitcartPaymentAmount: updatedOrder.bitcartPaymentAmount,
          status: updatedOrder.status,
          updatedAt: new Date(),
        } as any)
        .where(eq(agentRechargeOrdersTable.id, Number(created.id)));

      return updatedOrder;
    } catch (error) {
      await this.conn
        .update(agentRechargeOrdersTable)
        .set({
          status: 'failed',
          remark: `Bitcart 发票创建失败：${errorMessage(error)}`,
          updatedAt: new Date(),
        } as any)
        .where(eq(agentRechargeOrdersTable.id, Number(created.id)));
      throw new BadRequestException(`Bitcart 发票创建失败：${errorMessage(error)}`);
    }
  }

  async findAgentRechargeOrders(
    searchParam: FilterParam<AgentRechargeOrderFiltersDto>,
    userId?: number,
  ) {
    const scope = await this.resolveAccessScope(userId);
    const rows = await this.expireDueAgentRechargeOrders(
      this.applyAgentScope(
        await this.getRows<Row>(agentRechargeOrdersTable),
        scope,
      ),
    );
    return this.toTableData(
      rows,
      searchParam,
      (item, filters) =>
        matchesText(item.orderNo, filters.orderNo) &&
        matchesExact(item.status, filters.status),
    );
  }

  async syncAgentRechargeOrder(id: number, userId?: number) {
    const scope = await this.resolveAccessScope(userId);
    const order = (await this.getRows<Row>(agentRechargeOrdersTable)).find(
      (item) => Number(item.id) === Number(id),
    );
    if (!order || !this.rowVisibleInScope(order, scope)) {
      throw new BadRequestException('充值订单不存在或无权操作');
    }
    if (String(order.paymentGateway ?? '') !== PAYMENT_GATEWAY_BITCART) {
      throw new BadRequestException('当前订单不是 Bitcart 发票订单');
    }
    if (!hasValue(order.bitcartInvoiceId)) {
      if (isExpiredRechargeOrder(order, new Date())) {
        return this.markAgentRechargeOrderExpired(order);
      }
      throw new BadRequestException('当前订单未生成 Bitcart 发票');
    }
    return this.refreshBitcartRechargeOrder(order);
  }

  async handleBitcartInvoiceWebhook(
    data: BitcartInvoiceWebhookDto,
    secret?: string,
  ) {
    const config = await this.findPlatformConfigRow();
    const webhookSecret = String(config?.bitcartWebhookSecret ?? '').trim();
    if (!hasValue(webhookSecret) || !safeEqual(String(secret ?? ''), webhookSecret)) {
      throw new BadRequestException('Bitcart 回调校验失败');
    }
    const invoiceId = String(data.id ?? '').trim();
    if (!invoiceId) {
      throw new BadRequestException('Bitcart 回调缺少发票 ID');
    }
    const orders = await this.getRows<Row>(agentRechargeOrdersTable);
    const order = orders.find(
      (item) =>
        String(item.paymentGateway ?? '') === PAYMENT_GATEWAY_BITCART &&
        String(item.bitcartInvoiceId ?? '') === invoiceId,
    );
    if (!order) {
      return { credited: false, status: 'ignored', reason: 'order_not_found' };
    }
    if (String(order.status ?? '') === 'confirmed') {
      return { credited: false, status: 'confirmed' };
    }
    let bitcart: BitcartConfig;
    try {
      bitcart = bitcartConfigFor(config);
    } catch (error) {
      if (isExpiredRechargeOrder(order, new Date())) {
        return this.markAgentRechargeOrderExpired(order);
      }
      throw error;
    }
    return this.refreshBitcartRechargeOrder(order, bitcart, config);
  }

  private async createBitcartInvoice(
    bitcart: BitcartConfig,
    {
      amountSun,
      orderNo,
      ttlMinutes,
    }: { amountSun: number; orderNo: string; ttlMinutes: number },
  ) {
    const body = {
      price: sunToTrxText(amountSun),
      store_id: bitcart.storeId,
      order_id: orderNo,
      currency: bitcart.currency,
      expiration: ttlMinutes,
      notification_url: buildBitcartWebhookUrl(bitcart),
      metadata: {
        source: 'maer-energy',
        orderNo,
      },
      notes: `马儿能量用户充值 ${orderNo}`,
    };
    return this.requestBitcart<BitcartInvoice>(
      bitcart,
      'POST',
      `/invoices/order_id/${encodeURIComponent(orderNo)}`,
      body,
    );
  }

  private async refreshBitcartRechargeOrder(
    order: Row,
    bitcartArg?: BitcartConfig,
    configArg?: Row | null,
  ) {
    if (String(order.status ?? '') === 'confirmed') {
      return { credited: false, status: 'confirmed' };
    }
    const config = configArg ?? (await this.findPlatformConfigRow());
    const bitcart = bitcartArg ?? bitcartConfigFor(config);
    const invoiceId = String(order.bitcartInvoiceId ?? '').trim();
    if (!invoiceId) {
      throw new BadRequestException('当前订单未生成 Bitcart 发票');
    }
    const invoice = await this.fetchBitcartInvoice(bitcart, invoiceId);
    if (String(invoice.id ?? '') !== invoiceId) {
      throw new BadRequestException('Bitcart 发票校验失败');
    }
    if (String(invoice.store_id ?? '') !== bitcart.storeId) {
      throw new BadRequestException('Bitcart 店铺校验失败');
    }
    if (
      hasValue(invoice.order_id) &&
      String(invoice.order_id) !== String(order.orderNo)
    ) {
      throw new BadRequestException('Bitcart 发票订单号校验失败');
    }
    return this.applyBitcartInvoiceToRechargeOrder(order, invoice, config);
  }

  private async fetchBitcartInvoice(bitcart: BitcartConfig, invoiceId: string) {
    return this.requestBitcart<BitcartInvoice>(
      bitcart,
      'GET',
      `/invoices/${encodeURIComponent(invoiceId)}`,
    );
  }

  private async applyBitcartInvoiceToRechargeOrder(
    order: Row,
    invoice: BitcartInvoice,
    config: Row | null,
  ) {
    const status = normalizeBitcartInvoiceStatus(invoice.status);
    const payment = firstBitcartPayment(invoice);
    const paymentAddress = String(
      payment?.payment_address ?? order.paymentAddress ?? '',
    ).trim();
    const paymentUrl = String(payment?.payment_url ?? order.bitcartPaymentUrl ?? '');
    const paymentCurrency = String(
      payment?.currency ?? invoice.currency ?? order.bitcartPaymentCurrency ?? '',
    ).toUpperCase();
    const paymentAmount = normalizeDecimalText(
      payment?.amount ?? order.bitcartPaymentAmount,
    );
    const paymentId = String(invoice.payment_id ?? payment?.id ?? '');
    const now = new Date();

    if (status === BITCART_FINAL_PAID_STATUS) {
      const txHash = firstTxHash(invoice);
      const sentAmountSun = trxToSun(invoice.sent_amount);
      const orderAmountSun = Number(order.amountSun ?? 0);
      if (!txHash || sentAmountSun < orderAmountSun) {
        await this.conn
          .update(agentRechargeOrdersTable)
          .set({
            status: 'failed',
            bitcartInvoiceStatus: status,
            bitcartExceptionStatus:
              invoice.exception_status ?? 'amount_or_hash_mismatch',
            bitcartSentAmount: normalizeDecimalText(invoice.sent_amount),
            updatedAt: now,
            remark: 'Bitcart 发票完成但链上金额或交易 Hash 异常，未自动入账',
          } as any)
          .where(eq(agentRechargeOrdersTable.id, Number(order.id)));
        return { credited: false, status: 'failed' };
      }

      return this.confirmAgentRechargePayment(order, {
        invoiceId: String(invoice.id),
        txHash,
        paymentAddress,
        bitcartInvoiceStatus: status,
        bitcartPaymentId: paymentId,
        bitcartPaymentUrl: paymentUrl,
        bitcartPaymentCurrency: paymentCurrency,
        bitcartPaymentAmount: paymentAmount,
        bitcartExceptionStatus: invoice.exception_status ?? 'none',
        bitcartSentAmount: normalizeDecimalText(invoice.sent_amount),
        bitcartPaidCurrency: String(invoice.paid_currency || paymentCurrency || 'TRX'),
        confirmedAt: now,
      });
    }

    const onChainPayment = await this.findOnChainRechargePayment(
      order,
      paymentAddress,
      config,
    );
    if (onChainPayment) {
      return this.confirmAgentRechargePayment(order, {
        invoiceId: String(invoice.id),
        txHash: onChainPayment.txHash,
        paymentAddress,
        bitcartInvoiceStatus: BITCART_ONCHAIN_CONFIRMED_STATUS,
        bitcartPaymentId: paymentId,
        bitcartPaymentUrl: paymentUrl,
        bitcartPaymentCurrency: paymentCurrency || 'TRX',
        bitcartPaymentAmount: paymentAmount,
        bitcartExceptionStatus:
          invoice.exception_status ?? 'bitcart_pending_onchain_confirmed',
        bitcartSentAmount: onChainPayment.amountTrx,
        bitcartPaidCurrency: String(invoice.paid_currency || paymentCurrency || 'TRX'),
        confirmedAt: onChainPayment.confirmedAt,
        orderPaymentTtlMinutes: config?.orderPaymentTtlMinutes,
      });
    }

    if (isExpiredRechargeOrder(order, now)) {
      return this.markAgentRechargeOrderExpired(order);
    }

    const nextStatus = BITCART_FAILED_STATUSES.has(status) ? status : 'pending';
    await this.conn
      .update(agentRechargeOrdersTable)
      .set({
        status: nextStatus === 'expired' ? 'expired' : nextStatus === 'pending' ? 'pending' : 'failed',
        paymentAddress,
        bitcartInvoiceStatus: status,
        bitcartPaymentId: String(invoice.payment_id ?? ''),
        bitcartPaymentUrl: paymentUrl,
        bitcartPaymentCurrency: paymentCurrency,
        bitcartPaymentAmount: paymentAmount,
        bitcartExceptionStatus: invoice.exception_status ?? null,
        bitcartSentAmount: normalizeDecimalText(invoice.sent_amount),
        bitcartPaidCurrency: invoice.paid_currency ?? null,
        paymentTxHash: firstTxHash(invoice) || order.paymentTxHash || null,
        updatedAt: now,
      } as any)
      .where(eq(agentRechargeOrdersTable.id, Number(order.id)));
    return { credited: false, status };
  }

  private async confirmAgentRechargePayment(
    order: Row,
    payment: ConfirmAgentRechargePaymentInput,
  ) {
    const now = new Date();
    return this.conn.transaction(async (db) => {
      await this.lockBitcartInvoiceNamespace(db, payment.invoiceId);
      const currentOrder = (
        await this.getRowsFrom<Row>(db, agentRechargeOrdersTable)
      ).find((item) => Number(item.id) === Number(order.id));
      if (!currentOrder) {
        throw new BadRequestException('充值订单不存在');
      }
      if (String(currentOrder.status ?? '') === 'confirmed') {
        return { credited: false, status: 'confirmed' };
      }
      if (
        isExpiredRechargeOrder(currentOrder, now) &&
        !isRechargePaymentWithinWindow(
          {
            ...currentOrder,
            orderPaymentTtlMinutes:
              payment.orderPaymentTtlMinutes ??
              currentOrder.orderPaymentTtlMinutes,
          },
          payment.confirmedAt,
        )
      ) {
        await this.markAgentRechargeOrderExpired(currentOrder, db);
        return { credited: false, status: 'expired' };
      }

      const duplicateTransaction = (
        await this.getRowsFrom<Row>(db, energyWalletTransactionsTable)
      ).find(
        (item) =>
          String(item.txHash ?? '') === payment.txHash &&
          Number(item.relatedOrderId) !== Number(order.id),
      );
      if (duplicateTransaction) {
        await db
          .update(agentRechargeOrdersTable)
          .set({
            status: 'failed',
            paymentTxHash: payment.txHash,
            paymentAddress: payment.paymentAddress,
            bitcartInvoiceStatus: payment.bitcartInvoiceStatus,
            bitcartPaymentId: payment.bitcartPaymentId,
            bitcartPaymentUrl: payment.bitcartPaymentUrl,
            bitcartPaymentCurrency: payment.bitcartPaymentCurrency,
            bitcartPaymentAmount: payment.bitcartPaymentAmount,
            bitcartExceptionStatus: 'duplicate_chain_transaction',
            bitcartSentAmount: payment.bitcartSentAmount,
            bitcartPaidCurrency: payment.bitcartPaidCurrency,
            updatedAt: now,
            remark: '该链上交易已被其他充值订单使用，未自动入账',
          } as any)
          .where(eq(agentRechargeOrdersTable.id, Number(order.id)));
        return { credited: false, status: 'failed' };
      }

      await db
        .update(agentRechargeOrdersTable)
        .set({
          status: 'confirmed',
          paymentTxHash: payment.txHash,
          paymentAddress: payment.paymentAddress,
          bitcartInvoiceStatus: payment.bitcartInvoiceStatus,
          bitcartPaymentId: payment.bitcartPaymentId,
          bitcartPaymentUrl: payment.bitcartPaymentUrl,
          bitcartPaymentCurrency: payment.bitcartPaymentCurrency,
          bitcartPaymentAmount: payment.bitcartPaymentAmount,
          bitcartExceptionStatus: payment.bitcartExceptionStatus,
          bitcartSentAmount: payment.bitcartSentAmount,
          bitcartPaidCurrency: payment.bitcartPaidCurrency,
          confirmedAt: payment.confirmedAt,
          updatedAt: now,
        } as any)
        .where(eq(agentRechargeOrdersTable.id, Number(order.id)));

      const amountSun = String(
        rechargeCreditAmountSun(currentOrder) ??
          rechargeCreditAmountSun(order) ??
          currentOrder.amountSun ??
          order.amountSun,
      );
      await db
        .update(agentWalletAccountsTable)
        .set({
          balanceSun: sql`${agentWalletAccountsTable.balanceSun} + ${amountSun}`,
          totalRechargeSun: sql`${agentWalletAccountsTable.totalRechargeSun} + ${amountSun}`,
          updatedAt: now,
        } as any)
        .where(
          eq(
            agentWalletAccountsTable.agentId,
            Number(currentOrder.agentId ?? order.agentId),
          ),
        );

      await db.insert(energyWalletTransactionsTable).values({
        agentId: Number(currentOrder.agentId ?? order.agentId),
        txHash: payment.txHash,
        walletAddress: payment.paymentAddress,
        direction: 'in',
        transactionType: 'agent_recharge',
        amountSun,
        relatedOrderId: Number(order.id),
        status: 'confirmed',
        confirmedAt: payment.confirmedAt,
        remark: `Bitcart 充值入账：${roundTrx(Number(amountSun) / 1_000_000)} TRX`,
      });

      return { credited: true, status: 'confirmed' };
    });
  }

  private async findOnChainRechargePayment(
    order: Row,
    paymentAddress: string,
    config: Row | null,
  ): Promise<OnChainRechargePayment | null> {
    const address = String(paymentAddress ?? '').trim();
    const expectedAmountSun = Number(order.amountSun ?? 0);
    if (
      !hasValue(address) ||
      !Number.isSafeInteger(expectedAmountSun) ||
      expectedAmountSun <= 0
    ) {
      return null;
    }
    const window = rechargePaymentWindow({
      ...order,
      orderPaymentTtlMinutes: config?.orderPaymentTtlMinutes,
    });
    if (!window) {
      return null;
    }
    const apiBaseUrl = trimTrailingSlash(
      config?.tronApiBaseUrl ?? platformConfigDefaults.tronApiBaseUrl,
    );
    if (!hasValue(apiBaseUrl)) {
      return null;
    }

    const query = new URLSearchParams({
      only_to: 'true',
      only_confirmed: 'true',
      limit: '50',
      order_by: 'block_timestamp,desc',
    });
    const headers: Record<string, string> = {};
    const apiKey = String(config?.tronApiKey ?? '').trim();
    if (hasValue(apiKey)) {
      headers['TRON-PRO-API-KEY'] = apiKey;
    }

    try {
      const response = await fetch(
        `${apiBaseUrl}/v1/accounts/${encodeURIComponent(
          address,
        )}/transactions?${query.toString()}`,
        {
          method: 'GET',
          headers,
        },
      );
      if (!response.ok) {
        return null;
      }
      const body = (await response.json().catch(() => null)) as Row | null;
      const transactions = Array.isArray(body?.data) ? body.data : [];
      for (const transaction of transactions) {
        const payment = trxTransferFromTransaction(transaction);
        if (
          payment &&
          payment.amountSun === expectedAmountSun &&
          payment.confirmedAt >= window.startsAt &&
          payment.confirmedAt <= window.expiresAt
        ) {
          return payment;
        }
      }
    } catch {
      return null;
    }
    return null;
  }

  private async expireDueAgentRechargeOrders(rows: Row[], now = new Date()) {
    const expiredRows = rows.filter((item) => isExpiredRechargeOrder(item, now));
    for (const order of expiredRows) {
      await this.markAgentRechargeOrderExpired(order);
    }
    return rows.map((item) =>
      isExpiredRechargeOrder(item, now) ? expiredRechargeOrderView(item) : item,
    );
  }

  private async markAgentRechargeOrderExpired(
    order: Row,
    conn: unknown = this.conn,
  ) {
    const updater = (conn as { update?: unknown }).update;
    if (typeof updater === 'function') {
      await (conn as any)
        .update(agentRechargeOrdersTable)
        .set({
          status: 'expired',
          bitcartInvoiceStatus: 'expired',
          updatedAt: new Date(),
        } as any)
        .where(eq(agentRechargeOrdersTable.id, Number(order.id)));
    }
    return { credited: false, status: 'expired' };
  }

  private async requestBitcart<T>(
    bitcart: BitcartConfig,
    method: 'GET' | 'POST',
    path: string,
    body?: Row,
  ): Promise<T> {
    const response = await fetch(`${bitcart.apiBaseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: bitcartAuthorizationHeader(bitcart.apiToken),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const responseBody = await response.json().catch(() => null);
    if (!response.ok) {
      throw new BadRequestException(
        `Bitcart API 请求失败：HTTP ${response.status}`,
      );
    }
    return responseBody as T;
  }

  async runLinkTest(data: RunLinkTestDto = {}) {
    const energyAmount = Number(
      data.energyAmount ?? LINK_TEST_DEFAULT_ENERGY_AMOUNT,
    );
    const durationHours = Number(data.durationHours ?? 1);
    this.assertPackageAmount(energyAmount, 'catfee');
    if (durationHours !== 1) {
      throw new BadRequestException('链路测试仅支持 CatFee 1 小时租赁参数');
    }

    const config = await this.findPlatformConfigRow();
    const catFee = catFeeConfigFor(config, 'nile');
    const steps: LinkTestStep[] = [];
    let account: Row | null = null;
    let estimate: Row | null = null;
    let order: Row | null = null;
    const createOrder = data.createOrder === true;
    const receiverAddress = String(data.receiverAddress ?? '').trim();

    const hasCredentials = hasValue(catFee.apiKey) && hasValue(catFee.apiSecret);
    steps.push({
      key: 'config',
      title: '读取测试环境配置',
      status: hasCredentials ? 'success' : 'failed',
      message: hasCredentials
        ? 'Nile API 地址、Key、Secret 已配置'
        : 'Nile API Key 或 Secret 未配置',
      details: {
        apiBaseUrl: catFee.apiBaseUrl,
        activeProvider: normalizeProvider(config?.energyProvider),
        activeEnvironment: normalizeCatFeeEnvironment(config?.catfeeEnvironment),
        keyConfigured: hasValue(catFee.apiKey),
        secretConfigured: hasValue(catFee.apiSecret),
        autoActivate:
          config?.catfeeAutoActivate ?? platformConfigDefaults.catfeeAutoActivate,
      },
    });

    if (hasCredentials) {
      try {
        const data = await this.fetchCatFeeData<Row>(
          catFee,
          'GET',
          '/v1/account',
        );
        account = sanitizeCatFeeAccount(data);
        steps.push({
          key: 'account',
          title: '连接 CatFee 账户',
          status: 'success',
          message: '账户接口连接成功',
          details: account,
        });
      } catch (error) {
        steps.push({
          key: 'account',
          title: '连接 CatFee 账户',
          status: 'failed',
          message: errorMessage(error),
        });
      }

      if (!steps.some((item) => item.key === 'account' && item.status === 'failed')) {
        try {
          const query = new URLSearchParams();
          query.set('duration', `${durationHours}h`);
          query.set('quantity', String(energyAmount));
          const requestPath = `/v1/estimate?${query.toString()}`;
          const costSun = Number(
            await this.fetchCatFeeData<number>(catFee, 'GET', requestPath),
          );
          if (!Number.isFinite(costSun) || costSun < 0) {
            throw new Error('CatFee 预估价格返回异常');
          }
          estimate = {
            costSun,
            costTrx: roundTrx(costSun / 1_000_000),
            requestPath,
          };
          steps.push({
            key: 'estimate',
            title: '预估 1 小时能量成本',
            status: 'success',
            message: `预估成本 ${roundTrx(costSun / 1_000_000)} TRX`,
            details: estimate,
          });
        } catch (error) {
          steps.push({
            key: 'estimate',
            title: '预估 1 小时能量成本',
            status: 'failed',
            message: errorMessage(error),
          });
        }
      }

      if (!steps.some((item) => item.status === 'failed')) {
        if (createOrder) {
          if (!hasValue(receiverAddress)) {
            steps.push({
              key: 'order-config',
              title: '测试下单参数',
              status: 'failed',
              message: '开启真实下单测试时必须填写 Nile 接收能量地址',
            });
          } else if (!/^T[a-zA-Z0-9]{20,}$/.test(receiverAddress)) {
            steps.push({
              key: 'order-config',
              title: '测试下单参数',
              status: 'failed',
              message: '接收能量地址格式不正确，TRON 地址必须以 T 开头',
              details: { receiverAddress },
            });
          } else if (
            account &&
            estimate &&
            Number(account.balanceSun ?? 0) < Number(estimate.costSun ?? 0)
          ) {
            steps.push({
              key: 'order-balance',
              title: '测试下单余额检查',
              status: 'failed',
              message: 'CatFee Nile 账户余额不足，无法创建测试订单',
              details: {
                balanceTrx: account.balanceTrx,
                estimatedCostTrx: estimate.costTrx,
              },
            });
          } else {
            try {
              const orderRequestPath = this.buildCatFeeTestOrderPath({
                energyAmount,
                durationHours,
                receiverAddress,
                activate:
                  config?.catfeeAutoActivate ??
                  platformConfigDefaults.catfeeAutoActivate,
                clientOrderId: data.clientOrderId,
              });
              const createdOrder = sanitizeCatFeeOrder(
                await this.fetchCatFeeData<Row>(catFee, 'POST', orderRequestPath),
                orderRequestPath,
              );
              if (!hasValue(createdOrder.id)) {
                throw new Error('CatFee 创建订单未返回订单 ID');
              }
              order = createdOrder;
              steps.push({
                key: 'order-create',
                title: '创建 CatFee 测试订单',
                status: 'success',
                message: `测试订单已创建：${createdOrder.id}`,
                details: createdOrder,
              });

              order = await this.pollCatFeeOrderConfirmation(catFee, createdOrder);
              const isConfirmed =
                String(order.confirmStatus ?? '') === 'DELEGATION_CONFIRMED';
              const isFailed = catFeeOrderFailed(order);
              steps.push({
                key: 'order-confirm',
                title: '确认测试订单到账',
                status: isConfirmed ? 'success' : isFailed ? 'failed' : 'warning',
                message: isConfirmed
                  ? '测试订单已链上确认，能量下发链路可用'
                  : isFailed
                    ? '测试订单执行失败，请查看状态和 CatFee 后台'
                    : '测试订单已创建，但暂未链上确认，请稍后在 CatFee 或 Nile 浏览器继续查看',
                details: order,
              });
            } catch (error) {
              steps.push({
                key: 'order-create',
                title: '创建 CatFee 测试订单',
                status: 'failed',
                message: errorMessage(error),
              });
            }
          }
        } else {
          steps.push({
            key: 'safety',
            title: '安全检查',
            status: 'success',
            message: '当前为安全模式：未创建 CatFee 订单，也未触发真实能量下发',
          });
        }
      }
    }

    return {
      provider: 'catfee',
      environment: 'nile',
      apiBaseUrl: catFee.apiBaseUrl,
      energyAmount,
      durationHours,
      overallStatus: linkTestOverallStatus(steps),
      account,
      estimate,
      order,
      steps,
      testedAt: new Date().toISOString(),
    };
  }

  private buildCatFeeTestOrderPath({
    energyAmount,
    durationHours,
    receiverAddress,
    activate,
    clientOrderId,
  }: {
    energyAmount: number;
    durationHours: number;
    receiverAddress: string;
    activate: boolean;
    clientOrderId?: string;
  }) {
    const orderId = String(
      clientOrderId || `link-test-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    )
      .trim()
      .slice(0, 64);
    const query = new URLSearchParams();
    query.set('duration', `${durationHours}h`);
    query.set('quantity', String(energyAmount));
    query.set('receiver', receiverAddress);
    query.set('activate', String(activate));
    query.set('client_order_id', orderId);
    return `/v1/order?${query.toString()}`;
  }

  private async pollCatFeeOrderConfirmation(
    catFee: ReturnType<typeof catFeeConfigFor>,
    createdOrder: Row,
  ) {
    let latestOrder = createdOrder;
    for (let attempt = 0; attempt < LINK_TEST_ORDER_POLL_ATTEMPTS; attempt += 1) {
      const detail = sanitizeCatFeeOrder(
        await this.fetchCatFeeData<Row>(
          catFee,
          'GET',
          `/v1/order/${encodeURIComponent(String(createdOrder.id))}`,
        ),
      );
      latestOrder = { ...createdOrder, ...detail };
      if (
        String(latestOrder.confirmStatus ?? '') === 'DELEGATION_CONFIRMED' ||
        catFeeOrderFailed(latestOrder)
      ) {
        return latestOrder;
      }
      if (attempt < LINK_TEST_ORDER_POLL_ATTEMPTS - 1) {
        await sleep(LINK_TEST_ORDER_POLL_INTERVAL_MS);
      }
    }
    return latestOrder;
  }

  async rechargeProviderBalance(data: RechargeProviderBalanceDto) {
    const context = await this.buildProviderRechargeContext(data);
    const fee = await this.estimateTrxTransferFee({
      ...context,
      toAddress: context.rechargeAddress,
    });
    const estimatedTotalSun = context.amountSun + fee.estimatedFeeSun;
    if (fee.walletBalanceSun !== null && fee.walletBalanceSun < estimatedTotalSun) {
      throw new BadRequestException(
        `平台钱包余额不足，预计需要 ${roundTrx(estimatedTotalSun / 1_000_000)} TRX，当前余额 ${roundTrx(fee.walletBalanceSun / 1_000_000)} TRX`,
      );
    }

    const transfer = await this.sendTrxTransfer({
      privateKey: context.privateKey,
      fromAddress: context.fromAddress,
      toAddress: context.rechargeAddress,
      amountSun: context.amountSun,
      tronApiBaseUrl: context.tronApiBaseUrl,
      tronApiKey: context.tronApiKey,
    });

    await (this.conn as any).insert(energyWalletTransactionsTable).values({
      txHash: transfer.txHash,
      walletAddress: transfer.fromAddress,
      direction: 'out',
      transactionType: 'provider_recharge',
      amountSun: String(context.amountSun),
      status: 'confirmed',
      confirmedAt: new Date(),
      remark: `CatFee 生产环境充值 ${roundTrx(context.amountSun / 1_000_000)} TRX，预计手续费 ${fee.estimatedFeeTrx} TRX，充值地址 ${context.rechargeAddress}`,
    });

    return {
      provider: 'catfee',
      providerLabel: 'CatFee',
      channel: 'prod',
      channelLabel: catFeeChannelLabel('prod'),
      amountSun: context.amountSun,
      amountTrx: roundTrx(context.amountSun / 1_000_000),
      estimatedFeeSun: fee.estimatedFeeSun,
      estimatedFeeTrx: fee.estimatedFeeTrx,
      estimatedTotalSun,
      estimatedTotalTrx: roundTrx(estimatedTotalSun / 1_000_000),
      walletBalanceSun: fee.walletBalanceSun,
      walletBalanceTrx:
        fee.walletBalanceSun === null
          ? null
          : roundTrx(fee.walletBalanceSun / 1_000_000),
      hasEnoughBalance: fee.hasEnoughBalance,
      bandwidthBytes: fee.bandwidthBytes,
      availableBandwidth: fee.availableBandwidth,
      bandwidthPriceSun: fee.bandwidthPriceSun,
      accountCreateFeeSun: fee.accountCreateFeeSun,
      fromAddress: transfer.fromAddress,
      rechargeAddress: context.rechargeAddress,
      txHash: transfer.txHash,
      status: 'submitted',
      submittedAt: new Date().toISOString(),
    };
  }

  async previewProviderRecharge(data: PreviewProviderRechargeDto) {
    const context = await this.buildProviderRechargeContext(data);
    const fee = await this.estimateTrxTransferFee({
      ...context,
      toAddress: context.rechargeAddress,
    });
    const estimatedTotalSun = context.amountSun + fee.estimatedFeeSun;

    return {
      provider: 'catfee',
      providerLabel: 'CatFee',
      channel: 'prod',
      channelLabel: catFeeChannelLabel('prod'),
      amountSun: context.amountSun,
      amountTrx: roundTrx(context.amountSun / 1_000_000),
      estimatedFeeSun: fee.estimatedFeeSun,
      estimatedFeeTrx: fee.estimatedFeeTrx,
      estimatedTotalSun,
      estimatedTotalTrx: roundTrx(estimatedTotalSun / 1_000_000),
      walletBalanceSun: fee.walletBalanceSun,
      walletBalanceTrx:
        fee.walletBalanceSun === null
          ? null
          : roundTrx(fee.walletBalanceSun / 1_000_000),
      hasEnoughBalance: fee.hasEnoughBalance,
      bandwidthBytes: fee.bandwidthBytes,
      availableBandwidth: fee.availableBandwidth,
      bandwidthPriceSun: fee.bandwidthPriceSun,
      accountCreateFeeSun: fee.accountCreateFeeSun,
      fromAddress: context.fromAddress,
      rechargeAddress: context.rechargeAddress,
      feeNote: '手续费为按当前 TRON 带宽和链上参数预估，最终扣费以链上交易结果为准。',
      previewedAt: new Date().toISOString(),
    };
  }

  private async buildProviderRechargeContext(data: RechargeProviderBalanceDto) {
    const provider = normalizeProvider(data.provider ?? 'catfee');
    if (provider !== 'catfee') {
      throw new BadRequestException('当前仅支持 CatFee 服务商充值');
    }

    const amountSun = trxToSun(data.amountTrx);
    if (amountSun <= 0) {
      throw new BadRequestException('充值金额必须大于 0 TRX');
    }

    const config = await this.findPlatformConfigRow();
    const catFee = catFeeConfigFor(config, 'prod');
    if (!hasValue(catFee.apiKey) || !hasValue(catFee.apiSecret)) {
      throw new BadRequestException('CatFee 生产环境 API Key / Secret 未配置');
    }

    const account = sanitizeCatFeeAccount(
      await this.fetchCatFeeData<Row>(catFee, 'GET', '/v1/account'),
    );
    if (!hasValue(account.rechargeAddress)) {
      throw new BadRequestException('CatFee 生产环境充值地址为空');
    }

    const rawPrivateKey = String(config?.justlendPayerPrivateKey ?? '').trim();
    if (!hasValue(rawPrivateKey)) {
      throw new BadRequestException('平台付款私钥未配置');
    }
    const privateKey = normalizeTronPrivateKey(rawPrivateKey);
    const tronApiBaseUrl =
      config?.tronApiBaseUrl ?? platformConfigDefaults.tronApiBaseUrl;
    const tronApiKey = String(config?.tronApiKey ?? '').trim();
    const fromAddress = await this.deriveTronAddressFromPrivateKey({
      privateKey,
      tronApiBaseUrl,
      tronApiKey,
    });

    return {
      privateKey,
      fromAddress,
      rechargeAddress: account.rechargeAddress,
      amountSun,
      tronApiBaseUrl,
      tronApiKey,
    };
  }

  private async deriveTronAddressFromPrivateKey({
    privateKey,
    tronApiBaseUrl,
    tronApiKey,
  }: {
    privateKey: string;
    tronApiBaseUrl: string;
    tronApiKey?: string;
  }) {
    try {
      const normalizedPrivateKey = normalizeTronPrivateKey(privateKey);
      const tronWeb = await this.createTronWeb({
        tronApiBaseUrl,
        tronApiKey,
        privateKey: normalizedPrivateKey,
      });
      const address = tronWeb.address.fromPrivateKey(normalizedPrivateKey);
      if (!tronWeb.isAddress(address)) {
        throw new Error('invalid derived address');
      }
      return String(address);
    } catch {
      throw new BadRequestException(
        '平台付款私钥格式不正确，请填写 64 位十六进制私钥，不要填写助记词、钱包地址或 TRON API Key',
      );
    }
  }

  private async findById(table: unknown, id: number) {
    const rows = await this.getRows<Row>(table);
    return rows.find((item) => Number(item.id) === id) ?? null;
  }

  private async resolveAccessScope(userId?: number): Promise<AccessScope> {
    const numericUserId = Number(userId);
    if (!Number.isFinite(numericUserId) || numericUserId <= 0) {
      return { scope: 'platform' };
    }

    const userRoles = await this.getRows<Row>(sysUserRoleTable);
    const isPlatformAdmin = userRoles.some(
      (item) =>
        Number(item.userId) === numericUserId && Number(item.roleId) === 1,
    );
    if (isPlatformAdmin) {
      return { scope: 'platform', userId: numericUserId };
    }

    const agents = await this.getRows<Row>(agentProfilesTable);
    const agent = agents.find(
      (item) =>
        Number(item.userId) === numericUserId &&
        String(item.status ?? 'active') === 'active',
    );
    if (!agent) {
      return { scope: 'platform', userId: numericUserId };
    }
    return {
      scope: 'agent',
      userId: numericUserId,
      agentId: Number(agent.id),
    };
  }

  private async resolveRequiredAgentScope(
    userId?: number,
  ): Promise<Required<Pick<AccessScope, 'scope' | 'agentId'>> & AccessScope> {
    const scope = await this.resolveAccessScope(userId);
    if (scope.scope !== 'agent' || !scope.agentId) {
      throw new BadRequestException('当前账号没有用户账户');
    }
    return scope as Required<Pick<AccessScope, 'scope' | 'agentId'>> &
      AccessScope;
  }

  private async findAgentWalletAccount(agentId?: number) {
    if (!agentId) return null;
    const rows = await this.getRows<Row>(agentWalletAccountsTable);
    return rows.find((item) => Number(item.agentId) === Number(agentId)) ?? null;
  }

  private buildBotRuntimeStatus({
    scope,
    agentId,
    desiredStatus,
    tokenConfigured,
    runtime,
    now,
    activeAgentBotCount,
  }: {
    scope: 'platform' | 'agent';
    agentId: number | null;
    desiredStatus: string;
    tokenConfigured: boolean;
    runtime?: Row | null;
    now: Date;
    activeAgentBotCount?: number;
  }) {
    const heartbeatAt = toDateOrNull(runtime?.lastHeartbeatAt);
    const heartbeatAgeSeconds = heartbeatAt
      ? Math.max(0, Math.floor((now.getTime() - heartbeatAt.getTime()) / 1000))
      : null;
    const serviceStatus =
      heartbeatAt &&
      now.getTime() - heartbeatAt.getTime() <= BOT_RUNTIME_HEARTBEAT_STALE_MS
        ? 'online'
        : 'offline';

    return {
      scope,
      agentId,
      desiredStatus,
      desiredStatusLabel: desiredStatus === 'enabled' ? '启用' : '停用',
      serviceStatus,
      serviceStatusLabel: serviceStatus === 'online' ? '在线' : '离线',
      runtimeStatus: String(
        runtime?.runtimeStatus ??
          (desiredStatus === 'disabled' ? 'stopped' : 'unknown'),
      ),
      pollingStatus: String(
        runtime?.pollingStatus ??
          (desiredStatus === 'disabled' ? 'stopped' : 'unknown'),
      ),
      lastHeartbeatAt: heartbeatAt?.toISOString() ?? null,
      heartbeatAgeSeconds,
      lastStartedAt: toDateOrNull(runtime?.lastStartedAt)?.toISOString() ?? null,
      lastStoppedAt: toDateOrNull(runtime?.lastStoppedAt)?.toISOString() ?? null,
      lastError: String(runtime?.lastError ?? ''),
      instanceId: String(runtime?.instanceId ?? ''),
      telegramBotTokenConfigured: tokenConfigured,
      canEnable: tokenConfigured,
      ...(scope === 'platform'
        ? { activeAgentBotCount: activeAgentBotCount ?? 0 }
        : {}),
    };
  }

  private applyAgentScope<T extends Row>(rows: T[], scope: AccessScope): T[] {
    if (scope.scope !== 'agent') {
      return rows;
    }
    return rows.filter((item) => this.rowVisibleInScope(item, scope));
  }

  private rowVisibleInScope(row: Row, scope: AccessScope): boolean {
    if (scope.scope !== 'agent') {
      return true;
    }
    return Number(row.agentId) === Number(scope.agentId);
  }

  private async getRows<T>(table: unknown): Promise<T[]> {
    return this.getRowsFrom<T>(this.conn, table);
  }

  private async getRowsFrom<T>(conn: unknown, table: unknown): Promise<T[]> {
    return (await (conn as any).select().from(table)) as T[];
  }

  private async lockAgentRechargeNamespace(
    conn: unknown,
    agentId: number,
    requestedAmountSun: number,
  ) {
    const executor = (conn as { execute?: (query: unknown) => Promise<unknown> })
      .execute;
    if (typeof executor !== 'function') {
      return;
    }
    await executor.call(
      conn,
      sql`SELECT pg_advisory_xact_lock(hashtext(CAST(${'bitcart-agent:' + agentId} AS text)), hashtext(CAST(${String(requestedAmountSun)} AS text)))`,
    );
  }

  private async lockBitcartPayableAmountAllocation(conn: unknown) {
    const executor = (conn as { execute?: (query: unknown) => Promise<unknown> })
      .execute;
    if (typeof executor !== 'function') {
      return;
    }
    await executor.call(
      conn,
      sql`SELECT pg_advisory_xact_lock(hashtext(CAST(${'bitcart-payable-allocation'} AS text)), 0)`,
    );
  }

  private async lockBitcartInvoiceNamespace(conn: unknown, invoiceId: string) {
    const executor = (conn as { execute?: (query: unknown) => Promise<unknown> })
      .execute;
    if (typeof executor !== 'function') {
      return;
    }
    await executor.call(
      conn,
      sql`SELECT pg_advisory_xact_lock(hashtext(CAST(${'bitcart-invoice'} AS text)), hashtext(CAST(${invoiceId} AS text)))`,
    );
  }

  private async findPlatformConfigRow(): Promise<Row | null> {
    const rows = await this.getRows<Row>(energyPlatformConfigTable);
    return rows.find((item) => Number(item.id) === 1) ?? rows[0] ?? null;
  }

  private async getProviderBalanceMonitors(
    config: Row | null,
  ): Promise<ProviderBalanceMonitor[]> {
    const monitors: ProviderBalanceMonitor[] = [];
    if (normalizeProvider(config?.energyProvider) === 'catfee') {
      monitors.push(await this.getCatFeeBalanceMonitor(config));
    }
    return monitors;
  }

  private async getCatFeeBalanceMonitor(
    config: Row | null,
  ): Promise<ProviderBalanceMonitor> {
    const catFee = catFeeConfigFor(config, 'prod');
    const alertThresholdSun = providerBalanceReserveSun(
      config?.minTrxReserveSun ?? platformConfigDefaults.minTrxReserveSun,
    );
    const base = {
      provider: 'catfee',
      providerLabel: 'CatFee',
      channel: catFee.environment,
      channelLabel: catFeeChannelLabel(catFee.environment),
      wallet: '',
      rechargeAddress: '',
      balanceSun: 0,
      balanceTrx: 0,
      alertThresholdSun,
      alertThresholdTrx: roundTrx(alertThresholdSun / 1_000_000),
      checkedAt: new Date().toISOString(),
    };

    if (!hasValue(catFee.apiKey) || !hasValue(catFee.apiSecret)) {
      return {
        ...base,
        status: 'unconfigured',
        message: `CatFee ${base.channelLabel} API Key / Secret 未配置`,
      };
    }

    try {
      const account = sanitizeCatFeeAccount(
        await this.fetchCatFeeData<Row>(catFee, 'GET', '/v1/account'),
      );
      const status: ProviderBalanceStatus =
        alertThresholdSun > 0 && account.balanceSun < alertThresholdSun
          ? 'warning'
          : 'ok';
      return {
        ...base,
        status,
        wallet: account.wallet,
        rechargeAddress: account.rechargeAddress,
        balanceSun: account.balanceSun,
        balanceTrx: account.balanceTrx,
        message:
          status === 'warning'
            ? '服务商余额低于预警线，请及时充值 CatFee 账户'
            : '服务商余额正常',
      };
    } catch (error) {
      return {
        ...base,
        status: 'error',
        message: `CatFee 余额查询失败：${errorMessage(error)}`,
      };
    }
  }

  private async estimateTrxTransferFee({
    privateKey,
    fromAddress,
    toAddress,
    amountSun,
    tronApiBaseUrl,
    tronApiKey,
  }: {
    privateKey?: string;
    fromAddress: string;
    toAddress: string;
    amountSun: number;
    tronApiBaseUrl: string;
    tronApiKey?: string;
  }) {
    const tronWeb = await this.createTronWeb({
      tronApiBaseUrl,
      tronApiKey,
    });
    if (!tronWeb.isAddress(fromAddress)) {
      throw new BadRequestException('平台付款钱包地址不是有效 TRON 地址');
    }
    if (hasValue(privateKey)) {
      const normalizedPrivateKey = normalizeTronPrivateKey(privateKey);
      let derivedAddress = '';
      try {
        derivedAddress = tronWeb.address.fromPrivateKey(normalizedPrivateKey);
      } catch {
        throw new BadRequestException(
          '平台付款私钥格式不正确，请填写 64 位十六进制私钥',
        );
      }
      if (String(derivedAddress) !== fromAddress) {
        throw new BadRequestException('付款钱包地址校验失败');
      }
    }
    if (!tronWeb.isAddress(toAddress)) {
      throw new BadRequestException('CatFee 充值地址不是有效 TRON 地址');
    }
    if (amountSun <= 0) {
      throw new BadRequestException('充值金额必须大于 0 TRX');
    }

    const [resources, chainParameters, toAccount, walletBalanceRaw] = await Promise.all([
      tronWeb.trx.getAccountResources(fromAddress).catch(() => ({})),
      tronWeb.trx.getChainParameters().catch(() => []),
      tronWeb.trx.getAccount(toAddress).catch(() => null),
      tronWeb.trx.getBalance(fromAddress).catch(() => null),
    ]);
    const bandwidthBytes = 350;
    const freeNetRemaining = Math.max(
      0,
      Number(resources?.freeNetLimit ?? 0) - Number(resources?.freeNetUsed ?? 0),
    );
    const paidNetRemaining = Math.max(
      0,
      Number(resources?.NetLimit ?? 0) - Number(resources?.NetUsed ?? 0),
    );
    const availableBandwidth = Math.floor(freeNetRemaining + paidNetRemaining);
    const bandwidthPriceSun = chainParameterValue(
      chainParameters,
      'getTransactionFee',
      1000,
    );
    const accountCreateFeeSun = toAccount?.address
      ? 0
      : chainParameterValue(
          chainParameters,
          'getCreateNewAccountFeeInSystemContract',
          1_000_000,
        );
    const bandwidthFeeSun =
      Math.max(0, bandwidthBytes - availableBandwidth) * bandwidthPriceSun;
    const estimatedFeeSun = Math.max(
      0,
      Math.ceil(bandwidthFeeSun + accountCreateFeeSun),
    );
    const walletBalanceSun = normalizeNullableSun(walletBalanceRaw);
    const estimatedTotalSun = amountSun + estimatedFeeSun;

    return {
      estimatedFeeSun,
      estimatedFeeTrx: roundTrx(estimatedFeeSun / 1_000_000),
      walletBalanceSun,
      hasEnoughBalance:
        walletBalanceSun === null ? null : walletBalanceSun >= estimatedTotalSun,
      bandwidthBytes,
      availableBandwidth,
      bandwidthPriceSun,
      accountCreateFeeSun,
    };
  }

  private async createTronWeb({
    tronApiBaseUrl,
    tronApiKey,
    privateKey,
  }: {
    tronApiBaseUrl: string;
    tronApiKey?: string;
    privateKey?: string;
  }) {
    const normalizedPrivateKey = hasValue(privateKey)
      ? normalizeTronPrivateKey(privateKey)
      : undefined;
    const tronWebModule = await import('tronweb');
    const TronWebCtor =
      (tronWebModule as any).TronWeb ??
      (tronWebModule as any).default ??
      tronWebModule;
    return new TronWebCtor({
      fullHost: trimTrailingSlash(tronApiBaseUrl),
      headers: hasValue(tronApiKey)
        ? { 'TRON-PRO-API-KEY': String(tronApiKey).trim() }
        : undefined,
      privateKey: normalizedPrivateKey,
    });
  }

  private async sendTrxTransfer({
    privateKey,
    fromAddress,
    toAddress,
    amountSun,
    tronApiBaseUrl,
    tronApiKey,
  }: {
    privateKey: string;
    fromAddress: string;
    toAddress: string;
    amountSun: number;
    tronApiBaseUrl: string;
    tronApiKey?: string;
  }): Promise<{ txHash: string; fromAddress: string }> {
    const normalizedPrivateKey = normalizeTronPrivateKey(privateKey);
    const tronWeb = await this.createTronWeb({
      tronApiBaseUrl,
      tronApiKey,
      privateKey: normalizedPrivateKey,
    });

    if (!tronWeb.isAddress(toAddress)) {
      throw new BadRequestException('CatFee 充值地址不是有效 TRON 地址');
    }

    let derivedAddress = '';
    try {
      derivedAddress = tronWeb.address.fromPrivateKey(normalizedPrivateKey);
    } catch {
      throw new BadRequestException(
        '平台付款私钥格式不正确，请填写 64 位十六进制私钥',
      );
    }
    if (String(derivedAddress) !== fromAddress) {
      throw new BadRequestException('付款钱包地址校验失败');
    }

    const result = await tronWeb.trx.sendTransaction(
      toAddress,
      amountSun,
      normalizedPrivateKey,
    );
    if (!result?.result) {
      throw new BadRequestException(
        result?.message
          ? `TRON 转账失败：${String(result.message)}`
          : 'TRON 转账失败',
      );
    }

    const txHash = result.txid ?? result.transaction?.txID;
    if (!hasValue(txHash)) {
      throw new BadRequestException('TRON 转账未返回交易哈希');
    }

    return {
      txHash: String(txHash),
      fromAddress,
    };
  }

  private assertPackageAmount(energyAmount?: number, provider = 'justlend'): void {
    const value = Number(energyAmount);
    const normalizedProvider = normalizeProvider(provider);
    const minEnergyAmount =
      normalizedProvider === 'justlend'
        ? MIN_JUSTLEND_ENERGY_AMOUNT
        : normalizedProvider === 'catfee'
          ? MIN_CATFEE_ENERGY_AMOUNT
          : MIN_PACKAGE_ENERGY_AMOUNT;
    if (!Number.isFinite(value) || value < minEnergyAmount) {
      const providerLabel =
        normalizedProvider === 'justlend'
          ? 'JustLend'
          : normalizedProvider === 'catfee'
            ? 'CatFee'
            : '当前服务商';
      throw new BadRequestException(
        `${providerLabel} 套餐能量不能低于 ${minEnergyAmount}`,
      );
    }
  }

  private async fetchJustLendDashboard(): Promise<Row> {
    const response = await fetch(JUSTLEND_DASHBOARD_URL);
    if (!response.ok) {
      throw new BadRequestException('JustLend 实时参数获取失败');
    }
    const body = (await response.json()) as Row;
    if (Number(body?.code) !== 0 || !body?.data) {
      throw new BadRequestException('JustLend 实时参数返回异常');
    }
    return body.data as Row;
  }

  private async estimateCatFeePackage(
    config: Row | null,
    data: { energyAmount: number; durationHours: number; salePriceTrx: number },
  ) {
    if (data.durationHours !== 1) {
      throw new BadRequestException('CatFee 目前只支持 1 小时能量租赁');
    }
    const catFee = activeCatFeeConfig(config);
    if (!hasValue(catFee.apiKey) || !hasValue(catFee.apiSecret)) {
      throw new BadRequestException('当前 CatFee 环境未配置 API Key / Secret');
    }

    const query = new URLSearchParams();
    query.set('duration', `${data.durationHours}h`);
    query.set('quantity', String(data.energyAmount));
    const requestPath = `/v1/estimate?${query.toString()}`;
    const timestamp = new Date().toISOString();
    const response = await fetch(`${catFee.apiBaseUrl}${requestPath}`, {
      headers: catFeeHeaders({
        apiKey: catFee.apiKey,
        apiSecret: catFee.apiSecret,
        method: 'GET',
        requestPath,
        timestamp,
      }),
    });
    if (!response.ok) {
      throw new BadRequestException(`CatFee 预估价格获取失败：${response.status}`);
    }
    const body = (await response.json()) as Row;
    if (catFeeCode(body.code) !== 0) {
      throw new BadRequestException(
        body.sub_msg || body.msg || 'CatFee 预估价格返回异常',
      );
    }
    const costSun = Number(body.data ?? 0);
    if (!Number.isFinite(costSun) || costSun < 0) {
      throw new BadRequestException('CatFee 预估价格返回异常');
    }

    const rentFeeTrx = costSun / 1_000_000;
    const profitTrx = data.salePriceTrx - rentFeeTrx;
    return {
      energyAmount: data.energyAmount,
      durationHours: data.durationHours,
      minEnergyAmount: MIN_CATFEE_ENERGY_AMOUNT,
      energyRentPerTrx: 0,
      energyStakePerTrx: 0,
      unitDailyPriceTrx: 0,
      rentFeeTrx: roundTrx(rentFeeTrx),
      securityDepositTrx: 0,
      liquidationReserveTrx: 0,
      totalPrepayTrx: roundTrx(rentFeeTrx),
      platformCapitalTrx: roundTrx(rentFeeTrx),
      delegatedTrx: 0,
      salePriceTrx: roundTrx(data.salePriceTrx),
      profitTrx: roundTrx(profitTrx),
      profitRate:
        data.salePriceTrx > 0
          ? roundTrx((profitTrx / data.salePriceTrx) * 100)
          : 0,
      provider: 'catfee',
      providerLabel: 'CatFee',
      catfeeEnvironment: catFee.environment,
      catfeeAutoActivate:
        config?.catfeeAutoActivate ??
        platformConfigDefaults.catfeeAutoActivate,
      trxPriceUsd: null,
      source: `${catFee.apiBaseUrl}/v1/estimate`,
      estimatedAt: new Date().toISOString(),
    };
  }

  private async fetchCatFeeData<T>(
    catFee: ReturnType<typeof catFeeConfigFor>,
    method: string,
    requestPath: string,
  ): Promise<T> {
    const normalizedMethod = method.toUpperCase();
    const requestUrl = `${catFee.apiBaseUrl}${requestPath}`;
    const attempts =
      normalizedMethod === 'GET' ? CATFEE_GET_RETRY_ATTEMPTS : 1;
    let response: Response | undefined;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const timestamp = new Date().toISOString();
      try {
        response = await fetch(requestUrl, {
          method: normalizedMethod,
          headers: catFeeHeaders({
            apiKey: catFee.apiKey,
            apiSecret: catFee.apiSecret,
            method: normalizedMethod,
            requestPath,
            timestamp,
          }),
        });
        break;
      } catch (error) {
        if (attempt < attempts) {
          continue;
        }
        throw new Error(
          `CatFee 网络请求失败：${normalizedMethod} ${requestUrl}，${networkErrorMessage(error)}`,
        );
      }
    }

    if (!response) {
      throw new Error(`CatFee 请求失败：${normalizedMethod} ${requestUrl}`);
    }
    if (!response.ok) {
      throw new Error(`CatFee 请求失败：${response.status}`);
    }
    const body = (await response.json()) as Row;
    if (catFeeCode(body.code) !== 0) {
      throw new Error(body.sub_msg || body.msg || 'CatFee 返回异常');
    }
    return body.data as T;
  }

  private buildPlatformConfigValues(
    data: UpdatePlatformConfigDto,
    withDefaults = false,
  ) {
    const values: Row = withDefaults ? { ...platformConfigDefaults } : {};

    setTrimmed(values, 'botStatus', data.botStatus);
    setTrimmed(values, 'tronApiBaseUrl', data.tronApiBaseUrl);
    setTrimmed(values, 'justlendContractAddress', data.justlendContractAddress);
    setTrimmed(values, 'energyProvider', data.energyProvider);
    setTrimmed(values, 'catfeeEnvironment', data.catfeeEnvironment);
    setTrimmed(values, 'catfeeProdApiBaseUrl', data.catfeeProdApiBaseUrl);
    setTrimmed(values, 'catfeeNileApiBaseUrl', data.catfeeNileApiBaseUrl);
    setBoolean(values, 'catfeeAutoActivate', data.catfeeAutoActivate);
    setNumber(values, 'orderPaymentTtlMinutes', data.orderPaymentTtlMinutes);
    setNumber(
      values,
      'telegramPollingIntervalSeconds',
      data.telegramPollingIntervalSeconds,
    );
    setNumber(values, 'workerIntervalSeconds', data.workerIntervalSeconds);
    setNumericText(values, 'minTrxReserveSun', data.minTrxReserveSun);
    setTrimmed(values, 'bitcartApiBaseUrl', data.bitcartApiBaseUrl);
    setTrimmed(values, 'bitcartAdminBaseUrl', data.bitcartAdminBaseUrl);
    setTrimmed(values, 'bitcartStoreId', data.bitcartStoreId);
    setTrimmed(values, 'bitcartCurrency', data.bitcartCurrency);
    setTrimmed(values, 'bitcartWebhookBaseUrl', data.bitcartWebhookBaseUrl);

    setSecret(values, 'telegramBotToken', data.telegramBotToken);
    setSecret(values, 'tronApiKey', data.tronApiKey);
    setSecret(values, 'justlendPayerPrivateKey', data.justlendPayerPrivateKey);
    setSecret(values, 'catfeeProdApiKey', data.catfeeProdApiKey);
    setSecret(values, 'catfeeProdApiSecret', data.catfeeProdApiSecret);
    setSecret(values, 'catfeeNileApiKey', data.catfeeNileApiKey);
    setSecret(values, 'catfeeNileApiSecret', data.catfeeNileApiSecret);
    setSecret(values, 'bitcartApiToken', data.bitcartApiToken);
    setSecret(values, 'bitcartWebhookSecret', data.bitcartWebhookSecret);

    return values;
  }

  private buildPackageValues(
    data: CreateEnergyPackageDto,
    withDefaults = false,
  ) {
    const values: Row = withDefaults ? { status: 'active', sortOrder: 0 } : {};

    setTrimmed(values, 'packageName', data.packageName);
    setNumber(values, 'energyAmount', data.energyAmount);
    setNumber(values, 'durationHours', data.durationHours);
    setNumericText(values, 'priceSun', data.priceSun);
    setNumericText(values, 'idlePriceSun', data.idlePriceSun);
    setNumericText(values, 'busyPriceSun', data.busyPriceSun);
    setTrimmed(values, 'status', data.status);
    setNumber(values, 'sortOrder', data.sortOrder);
    setTrimmed(values, 'description', data.description);

    return values;
  }

  private async createAdminPackage(data: CreateEnergyPackageDto) {
    const config = await this.findPlatformConfigRow();
    this.assertPackageAmount(
      data.energyAmount,
      normalizeProvider(config?.energyProvider),
    );
    await (this.conn as any).insert(energyPackagesTable).values({
      packageKind: PACKAGE_KIND_ADMIN_PACKAGE,
      agentId: null,
      platformPackageId: null,
      ...this.buildPackageValues(data, true),
    });
    return null;
  }

  private async updateAdminPackage(data: UpdateEnergyPackageDto) {
    const rows = await this.getRows<Row>(energyPackagesTable);
    const current = rows.find(
      (item) =>
        Number(item.id) === Number(data.id) && isPlatformOwnedPackage(item),
    );
    if (!current) {
      throw new BadRequestException('套餐不存在或无权编辑');
    }
    if (data.energyAmount !== undefined && data.energyAmount !== null) {
      const config = await this.findPlatformConfigRow();
      this.assertPackageAmount(
        data.energyAmount,
        normalizeProvider(config?.energyProvider),
      );
    }
    await this.conn
      .update(energyPackagesTable)
      .set({
        ...this.buildPackageValues(data),
        packageKind: PACKAGE_KIND_ADMIN_PACKAGE,
        agentId: null,
        platformPackageId: null,
        updatedAt: new Date(),
      } as any)
      .where(eq(energyPackagesTable.id, data.id));
    return null;
  }

  private async createAgentPackage(scope: AccessScope, data: CreateEnergyPackageDto) {
    if (!scope.agentId) {
      throw new BadRequestException('当前账号没有用户账户');
    }
    const template = await this.findPlatformPackageTemplate(
      data.platformPackageId,
      true,
    );
    await (this.conn as any).insert(energyPackagesTable).values(
      this.buildUserPackageValues(data, template, scope.agentId, null, true),
    );
    return null;
  }

  private async updateAgentPackage(scope: AccessScope, data: UpdateEnergyPackageDto) {
    if (!scope.agentId) {
      throw new BadRequestException('当前账号没有用户账户');
    }
    const rows = await this.getRows<Row>(energyPackagesTable);
    const current = rows.find(
      (item) =>
        Number(item.id) === Number(data.id) &&
        Number(item.agentId) === Number(scope.agentId) &&
        isUserOwnedPackage(item, scope),
    );
    if (!current) {
      throw new BadRequestException('套餐不存在或无权编辑');
    }
    const platformPackageId = data.platformPackageId ?? current.platformPackageId;
    const template = await this.findPlatformPackageTemplate(
      platformPackageId,
      true,
    );
    await this.conn
      .update(energyPackagesTable)
      .set({
        ...this.buildUserPackageValues(data, template, scope.agentId, current),
        updatedAt: new Date(),
      } as any)
      .where(eq(energyPackagesTable.id, data.id));
    return null;
  }

  private async findPlatformPackageTemplate(
    id: unknown,
    activeOnly = false,
  ) {
    const numericId = Number(id);
    if (!Number.isFinite(numericId) || numericId <= 0) {
      throw new BadRequestException('请选择平台价格');
    }
    const rows = await this.getRows<Row>(energyPackagesTable);
    const template = rows.find(
      (item) =>
        Number(item.id) === numericId &&
        isPlatformPackageTemplate(item) &&
        !item.deletedAt,
    );
    if (
      !template ||
      (activeOnly && String(template.status ?? 'active') !== 'active')
    ) {
      throw new BadRequestException('平台价格不存在或未启用');
    }
    return template;
  }

  private buildUserPackageValues(
    data: CreateEnergyPackageDto,
    template: Row,
    agentId: number,
    current: Row | null,
    withDefaults = false,
  ) {
    const values: Row = withDefaults ? { status: 'active', sortOrder: 0 } : {};

    values.packageKind = PACKAGE_KIND_USER_PACKAGE;
    values.agentId = agentId;
    values.platformPackageId = Number(template.id);
    values.energyAmount = Number(template.energyAmount);
    values.durationHours = Number(template.durationHours);

    const idlePriceSun = data.idlePriceSun ?? data.priceSun;
    const busyPriceSun = data.busyPriceSun ?? data.priceSun;
    const basePriceSun = data.priceSun ?? data.idlePriceSun;
    if (withDefaults) {
      values.priceSun = positivePriceText(basePriceSun, '套餐售价');
      values.idlePriceSun = positivePriceText(idlePriceSun, '闲时套餐售价');
      values.busyPriceSun = positivePriceText(busyPriceSun, '忙时套餐售价');
    } else {
      if (basePriceSun !== undefined && basePriceSun !== null) {
        values.priceSun = positivePriceText(basePriceSun, '套餐售价');
      }
      if (idlePriceSun !== undefined && idlePriceSun !== null) {
        values.idlePriceSun = positivePriceText(idlePriceSun, '闲时套餐售价');
        if (data.priceSun === undefined || data.priceSun === null) {
          values.priceSun = values.idlePriceSun;
        }
      }
      if (busyPriceSun !== undefined && busyPriceSun !== null) {
        values.busyPriceSun = positivePriceText(busyPriceSun, '忙时套餐售价');
      }
      if (!values.priceSun && current?.priceSun) {
        values.priceSun = String(current.priceSun);
      }
    }

    if (withDefaults || data.packageName !== undefined) {
      const packageName = String(data.packageName ?? '').trim();
      values.packageName = packageName || String(template.packageName ?? '');
    }
    setTrimmed(values, 'status', data.status);
    setNumber(values, 'sortOrder', data.sortOrder);
    setTrimmed(values, 'description', data.description);

    return values;
  }

  private toTableData<T extends Row, F>(
    rows: T[],
    searchParam: FilterParam<F>,
    filterFn: (item: T, filters: Partial<F>) => boolean,
    sortFn: (a: T, b: T) => number = (a, b) =>
      Number(b.id ?? 0) - Number(a.id ?? 0),
  ) {
    const filters = (searchParam.filters ?? {}) as Partial<F>;
    const pageIndex = Number(searchParam.pageIndex || 1);
    const pageSize = Number(searchParam.pageSize || 10);
    const filtered = rows
      .filter((item) => filterFn(item, filters))
      .sort(sortFn);
    const start = pageSize > 0 ? (pageIndex - 1) * pageSize : 0;
    const list =
      pageSize > 0 ? filtered.slice(start, start + pageSize) : filtered;

    return TableDataInfo.result(list, pageSize, pageIndex, filtered.length);
  }
}

function matchesText(value: unknown, keyword?: string) {
  if (!keyword) return true;
  return String(value ?? '')
    .toLowerCase()
    .includes(keyword.toLowerCase());
}

function matchesExact(value: unknown, expected?: string) {
  if (!expected) return true;
  return String(value ?? '') === expected;
}

function matchesNumber(value: unknown, expected?: number) {
  if (expected === undefined || expected === null) return true;
  return Number(value) === Number(expected);
}

function normalizeBotStatus(value: unknown) {
  return String(value ?? '').trim() === 'enabled' ? 'enabled' : 'disabled';
}

function assertBotStatus(value: unknown) {
  const status = String(value ?? '').trim();
  if (status !== 'enabled' && status !== 'disabled') {
    throw new BadRequestException('机器人状态必须是启用或停用');
  }
  return status;
}

function latestBotRuntimeStatus(
  rows: Row[],
  scope: 'platform' | 'agent',
  agentId?: number | null,
) {
  return rows
    .filter((item) => String(item.botScope ?? '') === scope)
    .filter((item) =>
      scope === 'platform'
        ? !hasNumericId(item.agentId)
        : Number(item.agentId) === Number(agentId),
    )
    .sort(
      (a, b) =>
        (toDateOrNull(b.lastHeartbeatAt)?.getTime() ?? 0) -
        (toDateOrNull(a.lastHeartbeatAt)?.getTime() ?? 0),
    )[0];
}

function countActiveAgentBots(agentProfiles: Row[], agentBotConfigs: Row[]) {
  const activeAgentIds = new Set(
    agentProfiles
      .filter((item) => String(item.status ?? 'active') === 'active')
      .filter((item) => !item.deletedAt)
      .map((item) => Number(item.id)),
  );
  return agentBotConfigs.filter(
    (item) =>
      activeAgentIds.has(Number(item.agentId)) &&
      normalizeBotStatus(item.botStatus) === 'enabled' &&
      hasValue(item.telegramBotToken) &&
      !item.deletedAt,
  ).length;
}

function packageKindOf(row: Row) {
  const explicit = String(row.packageKind ?? '').trim();
  if (explicit) return explicit;
  if (hasNumericId(row.agentId)) return PACKAGE_KIND_USER_PACKAGE;
  if (hasNumericId(row.platformPackageId)) return PACKAGE_KIND_ADMIN_PACKAGE;
  return PACKAGE_KIND_PLATFORM_PRICE;
}

function isPlatformPackageTemplate(row: Row) {
  return !row.deletedAt && packageKindOf(row) === PACKAGE_KIND_PLATFORM_PRICE;
}

function isPlatformOwnedPackage(row: Row) {
  return (
    !row.deletedAt &&
    packageKindOf(row) === PACKAGE_KIND_ADMIN_PACKAGE &&
    !hasNumericId(row.agentId)
  );
}

function isUserOwnedPackage(row: Row, scope: AccessScope) {
  return (
    !row.deletedAt &&
    scope.scope === 'agent' &&
    packageKindOf(row) === PACKAGE_KIND_USER_PACKAGE &&
    Number(row.agentId) === Number(scope.agentId)
  );
}

function packageRowsForScope(
  rows: Row[],
  scope: AccessScope,
  now = new Date(),
) {
  const platformById = new Map(
    rows
      .filter((item) => isPlatformPackageTemplate(item))
      .map((item) => [Number(item.id), item]),
  );
  const visibleRows = rows
    .filter((item) => !item.deletedAt)
    .filter((item) =>
      scope.scope === 'agent'
        ? isUserOwnedPackage(item, scope)
        : isPlatformOwnedPackage(item),
    );
  return visibleRows.map((item) => {
    const row =
      scope.scope === 'agent'
        ? withPlatformPackageTemplate(item, platformById)
        : item;
    return withCurrentPackagePrice(row, now);
  });
}

function withPlatformPackageTemplate(
  row: Row,
  platformById: Map<number, Row>,
) {
  const template = platformById.get(Number(row.platformPackageId));
  if (!template) {
    return {
      ...row,
      status: 'disabled',
      platformPackageName: null,
      platformPackageStatus: 'missing',
    };
  }
  return {
    ...row,
    status:
      String(template.status ?? 'active') === 'active'
        ? row.status
        : 'disabled',
    platformPackageName: template.packageName,
    platformPackageStatus: template.status,
    platformEnergyAmount: template.energyAmount,
    platformDurationHours: template.durationHours,
    platformPriceSun: template.priceSun,
    platformIdlePriceSun: template.idlePriceSun ?? template.priceSun,
    platformBusyPriceSun: template.busyPriceSun ?? template.priceSun,
    energyAmount: template.energyAmount,
    durationHours: template.durationHours,
  };
}

function hasNumericId(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0;
}

function assertAgentRechargeOrderCanBeCreated(
  agentId: number,
  requestedAmountSun: number,
  orders: Row[],
  now = new Date(),
) {
  const activeOrders = orders.filter((item) =>
    isActiveBitcartRechargeOrderForAgent(item, agentId, now),
  );
  if (activeOrders.length >= MAX_ACTIVE_PENDING_RECHARGE_ORDERS_PER_AGENT) {
    throw new BadRequestException(
      '最多同时创建 3 个待确认充值订单，请先完成或等待已有订单过期后再创建',
    );
  }

  if (
    activeOrders.some((item) =>
      isSameRequestedRechargeAmount(item, requestedAmountSun),
    )
  ) {
    throw new BadRequestException(
      '已存在相同金额的待确认充值订单，请勿重复创建订单',
    );
  }
}

function allocateUniqueBitcartPayableAmountSun(
  requestedAmountSun: number,
  orders: Row[],
  now = new Date(),
) {
  const activePayableAmounts = new Set(
    orders
      .filter((item) => isActiveBitcartRechargeOrder(item, now))
      .map((item) => Number(item.amountSun))
      .filter((item) => Number.isSafeInteger(item) && item > 0),
  );
  for (
    let offset = 0;
    offset <= MAX_BITCART_PAYABLE_AMOUNT_OFFSET_SUN;
    offset += 1
  ) {
    const candidate = requestedAmountSun + offset;
    if (!activePayableAmounts.has(candidate)) {
      return candidate;
    }
  }
  throw new BadRequestException(
    '当前充值金额待确认订单过多，请稍后再创建订单',
  );
}

function isActiveBitcartRechargeOrderForAgent(
  order: Row,
  agentId: number,
  now: Date,
) {
  return (
    Number(order.agentId) === Number(agentId) &&
    isActiveBitcartRechargeOrder(order, now)
  );
}

function isSameRequestedRechargeAmount(order: Row, requestedAmountSun: number) {
  const storedRequestedAmount = Number(order.requestedAmountSun);
  if (
    Number.isSafeInteger(storedRequestedAmount) &&
    storedRequestedAmount > 0
  ) {
    return storedRequestedAmount === requestedAmountSun;
  }

  const payableAmount = Number(order.amountSun);
  return (
    Number.isSafeInteger(payableAmount) &&
    payableAmount === requestedAmountSun
  );
}

function isActiveBitcartRechargeOrder(order: Row, now: Date) {
  const status = String(order.status ?? '');
  if (status !== 'pending' && status !== 'creating') {
    return false;
  }
  if (order.deletedAt) {
    return false;
  }
  if (
    hasValue(order.paymentGateway) &&
    String(order.paymentGateway) !== PAYMENT_GATEWAY_BITCART
  ) {
    return false;
  }
  if (!order.expiresAt) {
    return true;
  }
  const expiresAt = new Date(order.expiresAt);
  return Number.isFinite(expiresAt.getTime()) && expiresAt > now;
}

function isRechargePaymentWithinWindow(order: Row, paidAt: Date) {
  const window = rechargePaymentWindow(order);
  return Boolean(
    window &&
      Number.isFinite(paidAt.getTime()) &&
      paidAt >= window.startsAt &&
      paidAt <= window.expiresAt,
  );
}

function rechargePaymentWindow(order: Row) {
  const expiresAt = toDateOrNull(order.expiresAt);
  if (!expiresAt) return null;
  const ttlMinutes = numberOrDefault(
    order.orderPaymentTtlMinutes,
    platformConfigDefaults.orderPaymentTtlMinutes,
  );
  return {
    startsAt: new Date(expiresAt.getTime() - ttlMinutes * 60_000),
    expiresAt,
  };
}

function trxTransferFromTransaction(value: unknown): OnChainRechargePayment | null {
  const tx = value as Row;
  const ret = Array.isArray(tx?.ret) ? tx.ret : [];
  if (
    !ret.some(
      (item) => String(item?.contractRet ?? '').toUpperCase() === 'SUCCESS',
    )
  ) {
    return null;
  }
  const contracts = Array.isArray(tx?.raw_data?.contract)
    ? tx.raw_data.contract
    : [];
  const transfer = contracts.find(
    (item) => String(item?.type ?? '') === 'TransferContract',
  );
  const amountSun = Number(transfer?.parameter?.value?.amount);
  const timestamp = Number(tx?.block_timestamp);
  const txHash = String(tx?.txID ?? '').trim();
  if (
    !hasValue(txHash) ||
    !Number.isSafeInteger(amountSun) ||
    amountSun <= 0 ||
    !Number.isFinite(timestamp)
  ) {
    return null;
  }
  return {
    txHash,
    amountSun,
    amountTrx: sunToTrxText(amountSun),
    confirmedAt: new Date(timestamp),
  };
}

function isExpiredRechargeOrder(order: Row, now: Date) {
  const status = String(order.status ?? '');
  if (status !== 'pending' && status !== 'creating') {
    return false;
  }
  if (order.deletedAt) {
    return false;
  }
  if (
    hasValue(order.paymentGateway) &&
    String(order.paymentGateway) !== PAYMENT_GATEWAY_BITCART
  ) {
    return false;
  }
  if (!order.expiresAt) {
    return false;
  }
  const expiresAt = new Date(order.expiresAt);
  return Number.isFinite(expiresAt.getTime()) && expiresAt <= now;
}

function expiredRechargeOrderView<T extends Row>(order: T): T {
  return {
    ...order,
    status: 'expired',
    bitcartInvoiceStatus: 'expired',
  };
}

function rechargeCreditAmountSun(order: Row) {
  const requestedAmountSun = Number(order.requestedAmountSun);
  if (Number.isSafeInteger(requestedAmountSun) && requestedAmountSun > 0) {
    return requestedAmountSun;
  }
  const amountSun = Number(order.amountSun);
  if (Number.isSafeInteger(amountSun) && amountSun > 0) {
    return amountSun;
  }
  return null;
}

function sumBy(rows: Row[], key: string) {
  return rows.reduce((total, item) => total + Number(item[key] ?? 0), 0);
}

function isSettledOrder(order: Row) {
  return String(order.status ?? '') === 'completed';
}

export type CatFeePricePeriod = 'idle' | 'busy';

export function resolveCatFeePricePeriod(
  date = new Date(),
  timeZone = 'Asia/Shanghai',
): CatFeePricePeriod {
  const hourText =
    new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      hour12: false,
      timeZone,
    })
      .formatToParts(date)
      .find((item) => item.type === 'hour')?.value ?? '0';
  const hour = Number(hourText) % 24;
  return hour >= 20 || hour < 10 ? 'busy' : 'idle';
}

export function resolvePackageCurrentPriceSun(
  row: Row,
  date = new Date(),
): { period: CatFeePricePeriod; priceSun: string } {
  const period = resolveCatFeePricePeriod(date);
  const periodPrice =
    period === 'busy' ? row.busyPriceSun : row.idlePriceSun;
  const fallback = row.priceSun ?? periodPrice ?? '0';
  return {
    period,
    priceSun: String(periodPrice ?? fallback),
  };
}

function withCurrentPackagePrice(row: Row, date = new Date()): Row {
  const currentPrice = resolvePackageCurrentPriceSun(row, date);
  const platformCurrentPrice =
    row.platformIdlePriceSun !== undefined ||
    row.platformBusyPriceSun !== undefined ||
    row.platformPriceSun !== undefined
      ? resolvePackageCurrentPriceSun(
          {
            priceSun: row.platformPriceSun,
            idlePriceSun: row.platformIdlePriceSun,
            busyPriceSun: row.platformBusyPriceSun,
          },
          date,
        )
      : null;
  return {
    ...row,
    pricePeriod: currentPrice.period,
    currentPriceSun: currentPrice.priceSun,
    priceSun: currentPrice.priceSun,
    basePriceSun: row.priceSun,
    ...(platformCurrentPrice
      ? {
          platformCurrentPriceSun: platformCurrentPrice.priceSun,
          platformBasePriceSun: row.platformPriceSun,
        }
      : {}),
  };
}

function sanitizeOrderForScope(row: Row, scope: AccessScope) {
  if (scope.scope !== 'agent') {
    return row;
  }
  const {
    energyProvider,
    externalOrderId,
    externalProviderEnvironment,
    externalStatus,
    externalConfirmStatus,
    providerCostSun,
    ...safe
  } = row;
  return safe;
}

function buildAddressStats(orders: Row[]) {
  const statsByAddress = new Map<string, Row>();
  for (const order of orders) {
    const key = normalizeAddressKey(order.receiverAddress);
    if (!key) continue;

    const stats = statsByAddress.get(key) ?? emptyAddressStats();
    stats.orderCount += 1;
    if (isSettledOrder(order)) {
      stats.totalEnergyAmount += Number(order.energyAmount ?? 0);
      stats.totalPaymentSun += Number(order.paymentAmountSun ?? 0);
    }

    switch (String(order.status ?? '')) {
      case 'pending':
        stats.pendingOrderCount += 1;
        break;
      case 'renting':
        stats.rentingOrderCount += 1;
        break;
      case 'completed':
        stats.completedOrderCount += 1;
        break;
      case 'failed':
        stats.failedOrderCount += 1;
        break;
      case 'cancelled':
        stats.cancelledOrderCount += 1;
        break;
      default:
        break;
    }

    const orderTime = toDateOrNull(
      order.createdAt ?? order.rentedAt ?? order.updatedAt,
    );
    if (
      orderTime &&
      (!stats.lastOrderAt || orderTime.getTime() > stats.lastOrderAt.getTime())
    ) {
      stats.lastOrderAt = orderTime;
    }

    statsByAddress.set(key, stats);
  }
  return statsByAddress;
}

function emptyAddressStats() {
  return {
    orderCount: 0,
    pendingOrderCount: 0,
    rentingOrderCount: 0,
    completedOrderCount: 0,
    failedOrderCount: 0,
    cancelledOrderCount: 0,
    totalEnergyAmount: 0,
    totalPaymentSun: 0,
    lastOrderAt: null as Date | null,
  };
}

function normalizeAddressKey(value: unknown) {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

function toDateOrNull(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function hasValue(value: unknown) {
  return String(value ?? '').trim().length > 0;
}

function bitcartConfigFor(row: Row | null): BitcartConfig {
  const config: BitcartConfig = {
    apiBaseUrl: trimTrailingSlash(row?.bitcartApiBaseUrl),
    adminBaseUrl: trimTrailingSlash(row?.bitcartAdminBaseUrl),
    apiToken: String(row?.bitcartApiToken ?? '').trim(),
    storeId: String(row?.bitcartStoreId ?? '').trim(),
    currency: String(
      row?.bitcartCurrency ?? platformConfigDefaults.bitcartCurrency,
    )
      .trim()
      .toUpperCase(),
    webhookBaseUrl: trimTrailingSlash(row?.bitcartWebhookBaseUrl),
    webhookSecret: String(row?.bitcartWebhookSecret ?? '').trim(),
  };
  const missing = [
    ['Bitcart API 地址', config.apiBaseUrl],
    ['Bitcart 管理端地址', config.adminBaseUrl],
    ['Bitcart API Token', config.apiToken],
    ['Bitcart Store ID', config.storeId],
    ['Bitcart Webhook 地址', config.webhookBaseUrl],
    ['Bitcart Webhook 密钥', config.webhookSecret],
  ].filter(([, value]) => !hasValue(value));
  if (missing.length) {
    throw new BadRequestException(
      `${missing.map(([label]) => label).join('、')}未配置`,
    );
  }
  if (config.currency !== 'TRX') {
    throw new BadRequestException('Bitcart 收款币种必须配置为 TRX');
  }
  return config;
}

function bitcartAuthorizationHeader(token: string) {
  const value = token.trim();
  return /^Bearer\s+/i.test(value) ? value : `Bearer ${value}`;
}

function buildBitcartWebhookUrl(bitcart: BitcartConfig) {
  return `${bitcart.webhookBaseUrl}/energy-rental/bitcart/webhook?secret=${encodeURIComponent(
    bitcart.webhookSecret,
  )}`;
}

function buildBitcartCheckoutUrl(bitcart: BitcartConfig, invoiceId: string) {
  return `${bitcart.adminBaseUrl}/i/${encodeURIComponent(invoiceId)}`;
}

function firstBitcartPayment(invoice: BitcartInvoice) {
  return Array.isArray(invoice.payments) ? invoice.payments[0] : undefined;
}

function normalizeBitcartInvoiceStatus(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
}

function localRechargeStatusFromBitcart(value: unknown) {
  const status = normalizeBitcartInvoiceStatus(value);
  if (status === BITCART_FINAL_PAID_STATUS) return 'confirmed';
  if (status === 'expired') return 'expired';
  if (BITCART_FAILED_STATUSES.has(status)) return 'failed';
  return 'pending';
}

function firstTxHash(invoice: BitcartInvoice) {
  return Array.isArray(invoice.tx_hashes)
    ? String(invoice.tx_hashes.find((item) => hasValue(item)) ?? '').trim()
    : '';
}

function normalizeDecimalText(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return String(value).trim();
}

function sunToTrxText(value: number) {
  return (Math.round(value) / 1_000_000).toFixed(6);
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function normalizeTronPrivateKey(value: unknown) {
  const key = String(value ?? '').replace(/\s+/g, '');
  const normalized = key.replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new BadRequestException(
      '平台付款私钥格式不正确，请填写 64 位十六进制私钥，不要填写助记词、钱包地址或 TRON API Key',
    );
  }
  return normalized;
}

function numberOrDefault(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function numberOrNull(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveNumber(value: unknown, fieldName: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new BadRequestException(`JustLend 参数异常：${fieldName}`);
  }
  return parsed;
}

function positivePriceText(value: unknown, fieldName: string) {
  const text = String(value ?? '').trim();
  const parsed = Number(text);
  if (!text || !Number.isFinite(parsed) || parsed <= 0) {
    throw new BadRequestException(`${fieldName}必须大于 0`);
  }
  return text;
}

function normalizeProvider(value: unknown) {
  const provider = String(value ?? '').trim().toLowerCase();
  return provider || platformConfigDefaults.energyProvider;
}

function normalizeCatFeeEnvironment(value: unknown) {
  const environment = String(value ?? '').trim().toLowerCase();
  if (environment === 'prod' || environment === 'production') {
    return 'prod';
  }
  return 'nile';
}

function catFeeChannelLabel(environment: string) {
  return environment === 'prod' ? '生产环境' : 'Nile 测试环境';
}

function nonNegativeNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function providerBalanceReserveSun(value: unknown) {
  return Math.max(nonNegativeNumber(value), MIN_PROVIDER_BALANCE_RESERVE_SUN);
}

function normalizeNullableSun(value: unknown) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function chainParameterValue(
  parameters: unknown,
  key: string,
  fallback: number,
) {
  const items = Array.isArray(parameters) ? parameters : [];
  const found = items.find((item: Row) => item?.key === key);
  const parsed = Number(found?.value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function activeCatFeeConfig(row: Row | null) {
  const environment = normalizeCatFeeEnvironment(
    row?.catfeeEnvironment ?? platformConfigDefaults.catfeeEnvironment,
  );
  return catFeeConfigFor(row, environment);
}

function catFeeConfigFor(row: Row | null, environmentValue: unknown) {
  const environment = normalizeCatFeeEnvironment(environmentValue);
  if (environment === 'prod') {
    return {
      environment,
      apiBaseUrl: trimTrailingSlash(
        row?.catfeeProdApiBaseUrl ??
          platformConfigDefaults.catfeeProdApiBaseUrl,
      ),
      apiKey: String(row?.catfeeProdApiKey ?? '').trim(),
      apiSecret: String(row?.catfeeProdApiSecret ?? '').trim(),
    };
  }
  return {
    environment,
    apiBaseUrl: trimTrailingSlash(
      row?.catfeeNileApiBaseUrl ??
        platformConfigDefaults.catfeeNileApiBaseUrl,
    ),
    apiKey: String(row?.catfeeNileApiKey ?? '').trim(),
    apiSecret: String(row?.catfeeNileApiSecret ?? '').trim(),
  };
}

function sanitizeCatFeeAccount(data: Row | null | undefined) {
  const balanceSun = Number(data?.balance ?? 0);
  const balanceUsdtSun = Number(data?.balance_usdt ?? 0);
  return {
    wallet: String(data?.wallet ?? ''),
    rechargeAddress: String(data?.recharge_address ?? ''),
    balanceSun: Number.isFinite(balanceSun) ? balanceSun : 0,
    balanceTrx: Number.isFinite(balanceSun) ? roundTrx(balanceSun / 1_000_000) : 0,
    balanceUsdtSun: Number.isFinite(balanceUsdtSun) ? balanceUsdtSun : 0,
    balanceUsdt: Number.isFinite(balanceUsdtSun)
      ? roundTrx(balanceUsdtSun / 1_000_000)
      : 0,
    whitelist: String(data?.whitelist ?? ''),
  };
}

function sanitizeCatFeeOrder(data: Row | null | undefined, requestPath?: string) {
  const payAmountSun = Number(data?.pay_amount_sun ?? 0);
  const activateAmountSun = Number(data?.activate_amount_sun ?? 0);
  return {
    id: String(data?.id ?? ''),
    clientOrderId: String(data?.client_order_id ?? ''),
    resourceType: String(data?.resource_type ?? ''),
    sourceType: String(data?.source_type ?? ''),
    receiver: String(data?.receiver ?? ''),
    delegateHash: String(data?.delegate_hash ?? ''),
    reclaimHash: String(data?.reclaim_hash ?? ''),
    payAmountSun: Number.isFinite(payAmountSun) ? payAmountSun : 0,
    payAmountTrx: Number.isFinite(payAmountSun)
      ? roundTrx(payAmountSun / 1_000_000)
      : 0,
    activateAmountSun: Number.isFinite(activateAmountSun)
      ? activateAmountSun
      : 0,
    activateAmountTrx: Number.isFinite(activateAmountSun)
      ? roundTrx(activateAmountSun / 1_000_000)
      : 0,
    quantity: Number(data?.quantity ?? 0),
    stakedSun: Number(data?.staked_sun ?? 0),
    duration: Number(data?.duration ?? 0),
    expiredTimestamp: Number(data?.expired_timestamp ?? 0),
    status: String(data?.status ?? ''),
    activateStatus: String(data?.activate_status ?? ''),
    confirmStatus: String(data?.confirm_status ?? ''),
    balance: Number(data?.balance ?? 0),
    requestPath: requestPath ?? '',
  };
}

function catFeeOrderFailed(order: Row) {
  const status = String(order.status ?? '').toUpperCase();
  const confirmStatus = String(order.confirmStatus ?? '').toUpperCase();
  return status.includes('FAIL') || confirmStatus.includes('FAIL');
}

function linkTestOverallStatus(steps: LinkTestStep[]) {
  if (steps.some((item) => item.status === 'failed')) {
    return 'failed';
  }
  if (steps.some((item) => item.status === 'warning')) {
    return 'warning';
  }
  return 'success';
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || '未知错误');
}

function networkErrorMessage(error: unknown) {
  const message = errorMessage(error);
  const cause = (error as { cause?: Row } | null | undefined)?.cause;
  const causeMessage = [cause?.code, cause?.message]
    .filter((item) => hasValue(item))
    .join(' / ');
  return causeMessage ? `${message}（${causeMessage}）` : message;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function newAgentRechargeOrderNo(date = new Date()) {
  const pad = (value: number, size = 2) => String(value).padStart(size, '0');
  return [
    'AR',
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
    Math.random().toString(16).slice(2, 8),
  ].join('');
}

function catFeeHeaders({
  apiKey,
  apiSecret,
  method,
  requestPath,
  timestamp,
}: {
  apiKey: string;
  apiSecret: string;
  method: string;
  requestPath: string;
  timestamp: string;
}) {
  return {
    'Content-Type': 'application/json',
    'CF-ACCESS-KEY': apiKey,
    'CF-ACCESS-SIGN': createHmac('sha256', apiSecret)
      .update(`${timestamp}${method.toUpperCase()}${requestPath}`)
      .digest('base64'),
    'CF-ACCESS-TIMESTAMP': timestamp,
  };
}

function catFeeCode(value: unknown) {
  if (typeof value === 'number') {
    return value;
  }
  const parsed = Number(String(value ?? '').trim());
  return Number.isFinite(parsed) ? parsed : -1;
}

function trimTrailingSlash(value: unknown) {
  return String(value ?? '').trim().replace(/\/+$/, '');
}

function roundTrx(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value * 1_000_000) / 1_000_000;
}

function trxToSun(value: unknown) {
  const trx = Number(value);
  if (!Number.isFinite(trx) || trx <= 0) {
    return 0;
  }
  return Math.round(trx * 1_000_000);
}

function setTrimmed(target: Row, key: string, value?: string) {
  if (value !== undefined) {
    target[key] = value.trim();
  }
}

function setSecret(target: Row, key: string, value?: string) {
  if (hasValue(value)) {
    target[key] = String(value).trim();
  }
}

function setNumber(target: Row, key: string, value?: number) {
  if (value !== undefined && value !== null) {
    target[key] = Number(value);
  }
}

function setNumericText(target: Row, key: string, value?: string | number) {
  if (value !== undefined && value !== null) {
    target[key] = String(value).trim();
  }
}

function setBoolean(target: Row, key: string, value?: boolean) {
  if (value !== undefined && value !== null) {
    target[key] = Boolean(value);
  }
}
