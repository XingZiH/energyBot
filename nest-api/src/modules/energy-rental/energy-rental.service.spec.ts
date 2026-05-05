import {
  EnergyRentalService,
  resolveCatFeePricePeriod,
  resolvePackageCurrentPriceSun,
} from './energy-rental.service';
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

function createReadConn(rowsByTable: Map<unknown, unknown[]>) {
  return {
    select: jest.fn(() => ({
      from: jest.fn((table: unknown) =>
        Promise.resolve(rowsByTable.get(table) ?? []),
      ),
    })),
  };
}

describe('EnergyRentalService', () => {
  const validPrivateKey =
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('aggregates dashboard metrics from packages, orders, wallet transactions, and return tasks', async () => {
    const conn = createReadConn(
      new Map<unknown, unknown[]>([
        [
          energyPackagesTable,
          [
            {
              id: 1,
              packageKind: 'platform_price',
              status: 'active',
              packageName: '平台价格',
              energyAmount: 65000,
              durationHours: 1,
              priceSun: '1755000',
            },
            { id: 2, packageKind: 'admin_package', status: 'active' },
            { id: 3, packageKind: 'admin_package', status: 'disabled' },
          ],
        ],
        [
          energyOrdersTable,
          [
            {
              id: 1,
              status: 'renting',
              energyAmount: 32000,
              paymentAmountSun: 12000000,
            },
            {
              id: 2,
              status: 'pending',
              energyAmount: 64000,
              paymentAmountSun: 0,
            },
            {
              id: 3,
              status: 'completed',
              energyAmount: 16000,
              paymentAmountSun: 7000000,
            },
            {
              id: 4,
              status: 'cancelled',
              energyAmount: 130000,
              paymentAmountSun: 2000000,
            },
          ],
        ],
        [
          energyWalletTransactionsTable,
          [
            { id: 1, direction: 'in', amountSun: 12000000 },
            { id: 2, direction: 'out', amountSun: 2000000 },
          ],
        ],
        [
          energyReturnTasksTable,
          [
            { id: 1, status: 'failed' },
            { id: 2, status: 'pending' },
          ],
        ],
      ]),
    );
    const service = new EnergyRentalService(conn as never);

    await expect(service.getDashboard()).resolves.toEqual({
      activePackageCount: 1,
      activeRentalCount: 1,
      failedReturnTaskCount: 1,
      netWalletSun: 10000000,
      overdueReturnTaskCount: 1,
      pendingOrderCount: 1,
      totalEnergyRented: 16000,
      totalOrderCount: 4,
      totalRevenueSun: 7000000,
      walletExpenseSun: 2000000,
      walletIncomeSun: 12000000,
      providerBalanceMonitors: [],
    });
  });

  it('adds provider-labelled CatFee balance monitor to dashboard', async () => {
    const fetchMock = jest.spyOn(global, 'fetch' as never).mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          wallet: 'TCatFeeWallet',
          recharge_address: 'TCatFeeRecharge',
          balance: 25_000_000,
          balance_usdt: 0,
          api_key: 'should-not-leak',
          api_secret: 'should-not-leak',
        },
      }),
    } as never);
    const conn = createReadConn(
      new Map<unknown, unknown[]>([
        [energyPackagesTable, []],
        [energyOrdersTable, []],
        [energyWalletTransactionsTable, []],
        [energyReturnTasksTable, []],
        [
          energyPlatformConfigTable,
          [
            {
              id: 1,
              energyProvider: 'catfee',
              catfeeEnvironment: 'prod',
              catfeeProdApiBaseUrl: 'https://api.catfee.io',
              catfeeProdApiKey: 'prod-key',
              catfeeProdApiSecret: 'prod-secret',
              minTrxReserveSun: '30000000',
            },
          ],
        ],
      ]),
    );
    const service = new EnergyRentalService(conn as never);

    const result = await service.getDashboard();

    expect(result.providerBalanceMonitors).toEqual([
      expect.objectContaining({
        provider: 'catfee',
        providerLabel: 'CatFee',
        channel: 'prod',
        channelLabel: '生产环境',
        status: 'warning',
        wallet: 'TCatFeeWallet',
        rechargeAddress: 'TCatFeeRecharge',
        balanceSun: 25_000_000,
        balanceTrx: 25,
        alertThresholdSun: 30_000_000,
        alertThresholdTrx: 30,
      }),
    ]);
    expect(JSON.stringify(result.providerBalanceMonitors)).not.toContain(
      'should-not-leak',
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.catfee.io/v1/account',
      expect.objectContaining({
        headers: expect.objectContaining({
          'CF-ACCESS-KEY': 'prod-key',
          'CF-ACCESS-SIGN': expect.any(String),
          'CF-ACCESS-TIMESTAMP': expect.any(String),
        }),
      }),
    );
    fetchMock.mockRestore();
  });

  it('always monitors CatFee production balance even when active rental environment is Nile', async () => {
    const fetchMock = jest.spyOn(global, 'fetch' as never).mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          wallet: 'TProdWallet',
          recharge_address: 'TProdRecharge',
          balance: 0,
        },
      }),
    } as never);
    const conn = createReadConn(
      new Map<unknown, unknown[]>([
        [energyPackagesTable, []],
        [energyOrdersTable, []],
        [energyWalletTransactionsTable, []],
        [energyReturnTasksTable, []],
        [
          energyPlatformConfigTable,
          [
            {
              id: 1,
              energyProvider: 'catfee',
              catfeeEnvironment: 'nile',
              catfeeProdApiBaseUrl: 'https://api.catfee.io',
              catfeeProdApiKey: 'prod-key',
              catfeeProdApiSecret: 'prod-secret',
              catfeeNileApiBaseUrl: 'https://nile.catfee.io',
              catfeeNileApiKey: 'nile-key',
              catfeeNileApiSecret: 'nile-secret',
            },
          ],
        ],
      ]),
    );
    const service = new EnergyRentalService(conn as never);

    const result = await service.getDashboard();

    expect(result.providerBalanceMonitors).toEqual([
      expect.objectContaining({
        provider: 'catfee',
        channel: 'prod',
        wallet: 'TProdWallet',
        rechargeAddress: 'TProdRecharge',
        balanceSun: 0,
        balanceTrx: 0,
        alertThresholdSun: 10_000_000,
        alertThresholdTrx: 10,
        status: 'warning',
      }),
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.catfee.io/v1/account',
      expect.objectContaining({
        headers: expect.objectContaining({
          'CF-ACCESS-KEY': 'prod-key',
        }),
      }),
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('nile.catfee.io'),
      expect.anything(),
    );
    fetchMock.mockRestore();
  });

  it('retries a transient CatFee production balance network failure', async () => {
    const networkError = new TypeError('fetch failed');
    (networkError as Error & { cause?: unknown }).cause = {
      code: 'UND_ERR_CONNECT_TIMEOUT',
      message: 'connect timeout',
    };
    const fetchMock = jest
      .spyOn(global, 'fetch' as never)
      .mockRejectedValueOnce(networkError as never)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          data: {
            wallet: 'TProdWallet',
            recharge_address: 'TProdRecharge',
            balance: 10_000_000,
          },
        }),
      } as never);
    const conn = createReadConn(
      new Map<unknown, unknown[]>([
        [energyPackagesTable, []],
        [energyOrdersTable, []],
        [energyWalletTransactionsTable, []],
        [energyReturnTasksTable, []],
        [
          energyPlatformConfigTable,
          [
            {
              id: 1,
              energyProvider: 'catfee',
              catfeeEnvironment: 'prod',
              catfeeProdApiBaseUrl: 'https://api.catfee.io',
              catfeeProdApiKey: 'prod-key',
              catfeeProdApiSecret: 'prod-secret',
              minTrxReserveSun: '10000000',
            },
          ],
        ],
      ]),
    );
    const service = new EnergyRentalService(conn as never);

    const result = await service.getDashboard();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.providerBalanceMonitors).toEqual([
      expect.objectContaining({
        provider: 'catfee',
        channel: 'prod',
        status: 'ok',
        rechargeAddress: 'TProdRecharge',
        balanceSun: 10_000_000,
        balanceTrx: 10,
      }),
    ]);
    fetchMock.mockRestore();
  });

  it('shows CatFee network failure details when production balance query still fails after retry', async () => {
    const networkError = new TypeError('fetch failed');
    (networkError as Error & { cause?: unknown }).cause = {
      code: 'ECONNRESET',
      message: 'socket hang up',
    };
    const fetchMock = jest
      .spyOn(global, 'fetch' as never)
      .mockRejectedValue(networkError as never);
    const conn = createReadConn(
      new Map<unknown, unknown[]>([
        [energyPackagesTable, []],
        [energyOrdersTable, []],
        [energyWalletTransactionsTable, []],
        [energyReturnTasksTable, []],
        [
          energyPlatformConfigTable,
          [
            {
              id: 1,
              energyProvider: 'catfee',
              catfeeEnvironment: 'prod',
              catfeeProdApiBaseUrl: 'https://api.catfee.io',
              catfeeProdApiKey: 'prod-key',
              catfeeProdApiSecret: 'prod-secret',
              minTrxReserveSun: '10000000',
            },
          ],
        ],
      ]),
    );
    const service = new EnergyRentalService(conn as never);

    const result = await service.getDashboard();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.providerBalanceMonitors[0]).toEqual(
      expect.objectContaining({
        provider: 'catfee',
        status: 'error',
      }),
    );
    expect(result.providerBalanceMonitors[0].message).toContain(
      'ECONNRESET',
    );
    expect(result.providerBalanceMonitors[0].message).toContain(
      'socket hang up',
    );
    fetchMock.mockRestore();
  });

  it('recharges CatFee production balance from platform wallet and records outflow', async () => {
    const fetchMock = jest.spyOn(global, 'fetch' as never).mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          wallet: 'TProdWallet',
          recharge_address: 'TProdRecharge',
          balance: 99_000_000,
        },
      }),
    } as never);
    const values = jest.fn().mockResolvedValue(null);
    const insert = jest.fn(() => ({ values }));
    const conn = {
      ...createReadConn(
        new Map<unknown, unknown[]>([
          [
            energyPlatformConfigTable,
            [
              {
                id: 1,
                energyProvider: 'catfee',
                tronApiBaseUrl: 'https://api.trongrid.io',
                tronApiKey: 'tron-key',
                justlendPayerPrivateKey: validPrivateKey,
                catfeeEnvironment: 'nile',
                catfeeProdApiBaseUrl: 'https://api.catfee.io',
                catfeeProdApiKey: 'prod-key',
                catfeeProdApiSecret: 'prod-secret',
                catfeeNileApiBaseUrl: 'https://nile.catfee.io',
                catfeeNileApiKey: 'nile-key',
                catfeeNileApiSecret: 'nile-secret',
              },
            ],
          ],
        ]),
      ),
      insert,
    };
    const service = new EnergyRentalService(conn as never);
    const deriveSpy = jest
      .spyOn(service as never, 'deriveTronAddressFromPrivateKey' as never)
      .mockResolvedValue('TPayerWallet' as never);
    const sendSpy = jest
      .spyOn(service as never, 'sendTrxTransfer' as never)
      .mockResolvedValue({
        txHash: 'tx-provider-recharge',
        fromAddress: 'TPayerWallet',
      } as never);
    const feeSpy = jest
      .spyOn(service as never, 'estimateTrxTransferFee' as never)
      .mockResolvedValue({
        estimatedFeeSun: 350_000,
        estimatedFeeTrx: 0.35,
        walletBalanceSun: 50_000_000,
        hasEnoughBalance: true,
        bandwidthBytes: 350,
        availableBandwidth: 0,
        bandwidthPriceSun: 1000,
        accountCreateFeeSun: 0,
      } as never);

    const result = await service.rechargeProviderBalance({
      provider: 'catfee',
      amountTrx: 12.5,
    });

    expect(result).toEqual(
      expect.objectContaining({
        provider: 'catfee',
        channel: 'prod',
        amountSun: 12_500_000,
        amountTrx: 12.5,
        estimatedFeeSun: 350_000,
        estimatedFeeTrx: 0.35,
        estimatedTotalSun: 12_850_000,
        estimatedTotalTrx: 12.85,
        walletBalanceSun: 50_000_000,
        walletBalanceTrx: 50,
        hasEnoughBalance: true,
        fromAddress: 'TPayerWallet',
        rechargeAddress: 'TProdRecharge',
        txHash: 'tx-provider-recharge',
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.catfee.io/v1/account',
      expect.objectContaining({
        headers: expect.objectContaining({
          'CF-ACCESS-KEY': 'prod-key',
        }),
      }),
    );
    expect(sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        privateKey: validPrivateKey,
        fromAddress: 'TPayerWallet',
        toAddress: 'TProdRecharge',
        amountSun: 12_500_000,
        tronApiBaseUrl: 'https://api.trongrid.io',
        tronApiKey: 'tron-key',
      }),
    );
    expect(insert).toHaveBeenCalledWith(energyWalletTransactionsTable);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        txHash: 'tx-provider-recharge',
        walletAddress: 'TPayerWallet',
        direction: 'out',
        transactionType: 'provider_recharge',
        amountSun: '12500000',
        status: 'confirmed',
      }),
    );
    fetchMock.mockRestore();
    deriveSpy.mockRestore();
    sendSpy.mockRestore();
    feeSpy.mockRestore();
  });

  it('rejects CatFee recharge when platform wallet cannot cover amount and fee', async () => {
    const fetchMock = jest.spyOn(global, 'fetch' as never).mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          wallet: 'TProdWallet',
          recharge_address: 'TProdRecharge',
          balance: 0,
        },
      }),
    } as never);
    const conn = createReadConn(
      new Map<unknown, unknown[]>([
        [
          energyPlatformConfigTable,
          [
            {
              id: 1,
              energyProvider: 'catfee',
              tronApiBaseUrl: 'https://api.trongrid.io',
              tronApiKey: 'tron-key',
              justlendPayerPrivateKey: validPrivateKey,
              catfeeProdApiBaseUrl: 'https://api.catfee.io',
              catfeeProdApiKey: 'prod-key',
              catfeeProdApiSecret: 'prod-secret',
            },
          ],
        ],
      ]),
    );
    const service = new EnergyRentalService(conn as never);
    const deriveSpy = jest
      .spyOn(service as never, 'deriveTronAddressFromPrivateKey' as never)
      .mockResolvedValue('TPayerWallet' as never);
    const sendSpy = jest.spyOn(service as never, 'sendTrxTransfer' as never);
    const feeSpy = jest
      .spyOn(service as never, 'estimateTrxTransferFee' as never)
      .mockResolvedValue({
        estimatedFeeSun: 500_000,
        estimatedFeeTrx: 0.5,
        walletBalanceSun: 1_000_000,
        hasEnoughBalance: false,
        bandwidthBytes: 500,
        availableBandwidth: 0,
        bandwidthPriceSun: 1000,
        accountCreateFeeSun: 0,
      } as never);

    await expect(
      service.rechargeProviderBalance({
        provider: 'catfee',
        amountTrx: 10,
      }),
    ).rejects.toThrow('平台钱包余额不足');
    expect(sendSpy).not.toHaveBeenCalled();

    fetchMock.mockRestore();
    deriveSpy.mockRestore();
    sendSpy.mockRestore();
    feeSpy.mockRestore();
  });

  it('previews CatFee provider recharge fee and total debit', async () => {
    const fetchMock = jest.spyOn(global, 'fetch' as never).mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          wallet: 'TProdWallet',
          recharge_address: 'TProdRecharge',
          balance: 0,
        },
      }),
    } as never);
    const conn = createReadConn(
      new Map<unknown, unknown[]>([
        [
          energyPlatformConfigTable,
          [
            {
              id: 1,
              energyProvider: 'catfee',
              tronApiBaseUrl: 'https://api.trongrid.io',
              tronApiKey: 'tron-key',
              justlendPayerPrivateKey: validPrivateKey,
              catfeeProdApiBaseUrl: 'https://api.catfee.io',
              catfeeProdApiKey: 'prod-key',
              catfeeProdApiSecret: 'prod-secret',
            },
          ],
        ],
      ]),
    );
    const service = new EnergyRentalService(conn as never);
    const deriveSpy = jest
      .spyOn(service as never, 'deriveTronAddressFromPrivateKey' as never)
      .mockResolvedValue('TPayerWallet' as never);
    const feeSpy = jest
      .spyOn(service as never, 'estimateTrxTransferFee' as never)
      .mockResolvedValue({
        estimatedFeeSun: 500_000,
        estimatedFeeTrx: 0.5,
        walletBalanceSun: 50_000_000,
        hasEnoughBalance: true,
        bandwidthBytes: 500,
        availableBandwidth: 0,
        bandwidthPriceSun: 1000,
        accountCreateFeeSun: 0,
      } as never);

    const result = await service.previewProviderRecharge({
      provider: 'catfee',
      amountTrx: 10,
    });

    expect(result).toEqual(
      expect.objectContaining({
        provider: 'catfee',
        channel: 'prod',
        amountSun: 10_000_000,
        amountTrx: 10,
        estimatedFeeSun: 500_000,
        estimatedFeeTrx: 0.5,
        estimatedTotalSun: 10_500_000,
        estimatedTotalTrx: 10.5,
        walletBalanceSun: 50_000_000,
        walletBalanceTrx: 50,
        hasEnoughBalance: true,
        fromAddress: 'TPayerWallet',
        rechargeAddress: 'TProdRecharge',
      }),
    );
    expect(feeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        fromAddress: 'TPayerWallet',
        toAddress: 'TProdRecharge',
        amountSun: 10_000_000,
      }),
    );
    fetchMock.mockRestore();
    deriveSpy.mockRestore();
    feeSpy.mockRestore();
  });

  it('normalizes 0x-prefixed TRON private keys before deriving payer address', async () => {
    const service = new EnergyRentalService({} as never);
    const fromPrivateKey = jest.fn(() => 'TPayerWallet');
    const isAddress = jest.fn(() => true);
    const createSpy = jest
      .spyOn(service as never, 'createTronWeb' as never)
      .mockResolvedValue({
        address: { fromPrivateKey },
        isAddress,
      } as never);

    const result = await (service as any).deriveTronAddressFromPrivateKey({
      privateKey:
        '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      tronApiBaseUrl: 'https://api.trongrid.io',
      tronApiKey: 'tron-key',
    });

    expect(result).toBe('TPayerWallet');
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        privateKey:
          '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      }),
    );
    expect(fromPrivateKey).toHaveBeenCalledWith(
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    );

    createSpy.mockRestore();
  });

  it('filters and paginates orders list', async () => {
    const conn = createReadConn(
      new Map<unknown, unknown[]>([
        [
          energyOrdersTable,
          [
            {
              id: 1,
              orderNo: 'ER202604280001',
              receiverAddress: 'TALPHA',
              status: 'pending',
            },
            {
              id: 2,
              orderNo: 'ER202604280002',
              receiverAddress: 'TBETA',
              status: 'renting',
            },
            {
              id: 3,
              orderNo: 'ER202604280003',
              receiverAddress: 'TALPHA-2',
              status: 'renting',
            },
          ],
        ],
      ]),
    );
    const service = new EnergyRentalService(conn as never);

    const result = await service.findOrders({
      pageIndex: 1,
      pageSize: 1,
      filters: {
        receiverAddress: 'alpha',
        status: 'renting',
      },
    });

    expect(result.total).toBe(1);
    expect(result.pageIndex).toBe(1);
    expect(result.pageSize).toBe(1);
    expect(result.list).toEqual([
      {
        id: 3,
        orderNo: 'ER202604280003',
        receiverAddress: 'TALPHA-2',
        status: 'renting',
      },
    ]);
  });

  it('lists user addresses with order statistics', async () => {
    const conn = createReadConn(
      new Map<unknown, unknown[]>([
        [
          energyUserAddressesTable,
          [
            {
              id: 1,
              telegramChatId: '10001',
              label: '主钱包',
              address: 'TADDRESS1',
              isDefault: true,
              status: 'active',
            },
            {
              id: 2,
              telegramChatId: '10002',
              label: '备用钱包',
              address: 'TADDRESS2',
              isDefault: false,
              status: 'active',
            },
          ],
        ],
        [
          energyOrdersTable,
          [
            {
              id: 11,
              receiverAddress: 'TADDRESS1',
              status: 'completed',
              energyAmount: 130000,
              paymentAmountSun: '2000000',
              createdAt: new Date('2026-04-28T10:00:00Z'),
            },
            {
              id: 12,
              receiverAddress: 'TADDRESS1',
              status: 'renting',
              energyAmount: 260000,
              paymentAmountSun: '4000000',
              createdAt: new Date('2026-04-28T11:00:00Z'),
            },
            {
              id: 13,
              receiverAddress: 'TADDRESS2',
              status: 'failed',
              energyAmount: 130000,
              paymentAmountSun: '2000000',
              createdAt: new Date('2026-04-28T12:00:00Z'),
            },
            {
              id: 14,
              receiverAddress: 'TADDRESS1',
              status: 'cancelled',
              energyAmount: 130000,
              paymentAmountSun: '2000000',
              createdAt: new Date('2026-04-28T13:00:00Z'),
            },
          ],
        ],
      ]),
    );
    const service = new EnergyRentalService(conn as never);

    const result = await service.findAddresses({
      pageIndex: 1,
      pageSize: 10,
      filters: { telegramChatId: '10001' },
    });

    expect(result.total).toBe(1);
    expect(result.list).toEqual([
      expect.objectContaining({
        id: 1,
        telegramChatId: '10001',
        address: 'TADDRESS1',
        orderCount: 3,
        rentingOrderCount: 1,
        completedOrderCount: 1,
        failedOrderCount: 0,
        cancelledOrderCount: 1,
        totalEnergyAmount: 130000,
        totalPaymentSun: 2000000,
        lastOrderAt: new Date('2026-04-28T13:00:00Z'),
      }),
    ]);
  });

  it('resets a failed return task for retry', async () => {
    const where = jest.fn().mockResolvedValue(null);
    const set = jest.fn(() => ({ where }));
    const update = jest.fn(() => ({ set }));
    const service = new EnergyRentalService({ update } as never);

    await expect(service.retryReturnTask(10)).resolves.toBeNull();

    expect(update).toHaveBeenCalledWith(energyReturnTasksTable);
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'pending',
        lastError: null,
        nextRetryAt: null,
      }),
    );
    expect(where).toHaveBeenCalledTimes(1);
  });

  it('creates a platform price template with normalized values', async () => {
    const values = jest.fn().mockResolvedValue(null);
    const insert = jest.fn(() => ({ values }));
    const conn = {
      ...createReadConn(new Map<unknown, unknown[]>([[energyPlatformConfigTable, []]])),
      insert,
    };
    const service = new EnergyRentalService(conn as never);

    await expect(
      (service as any).createPlatformPrice({
        packageName: '  130K 能量 / 1 小时  ',
        energyAmount: 130000,
        durationHours: 1,
        priceSun: 2000000,
        status: 'active',
        sortOrder: 5,
        description: '  快速套餐  ',
      }),
    ).resolves.toBeNull();

    expect(insert).toHaveBeenCalledWith(energyPackagesTable);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        packageKind: 'platform_price',
        agentId: null,
        platformPackageId: null,
        packageName: '130K 能量 / 1 小时',
        energyAmount: 130000,
        durationHours: 1,
        priceSun: '2000000',
        status: 'active',
        sortOrder: 5,
        description: '快速套餐',
      }),
    );
  });

  it('rejects packages below JustLend minimum energy amount', async () => {
    const values = jest.fn().mockResolvedValue(null);
    const insert = jest.fn(() => ({ values }));
    const conn = {
      ...createReadConn(new Map<unknown, unknown[]>([[energyPlatformConfigTable, []]])),
      insert,
    };
    const service = new EnergyRentalService(conn as never);

    await expect(
      (service as any).createPlatformPrice({
        packageName: '低能量测试',
        energyAmount: 99999,
        durationHours: 1,
        priceSun: 1000000,
      }),
    ).rejects.toThrow('套餐能量不能低于 100000');

    expect(insert).not.toHaveBeenCalled();
  });

  it('allows CatFee packages below JustLend minimum energy amount', async () => {
    const values = jest.fn().mockResolvedValue(null);
    const insert = jest.fn(() => ({ values }));
    const conn = {
      ...createReadConn(
        new Map<unknown, unknown[]>([
          [energyPlatformConfigTable, [{ id: 1, energyProvider: 'catfee' }]],
        ]),
      ),
      insert,
    };
    const service = new EnergyRentalService(conn as never);

    await expect(
      (service as any).createPlatformPrice({
        packageName: '65K 能量 / 1 小时',
        energyAmount: 65000,
        durationHours: 1,
        priceSun: 2000000,
      }),
    ).resolves.toBeNull();

    expect(insert).toHaveBeenCalledWith(energyPackagesTable);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        energyAmount: 65000,
      }),
    );
  });

  it('rejects CatFee packages below CatFee minimum order energy amount', async () => {
    const values = jest.fn().mockResolvedValue(null);
    const insert = jest.fn(() => ({ values }));
    const conn = {
      ...createReadConn(
        new Map<unknown, unknown[]>([
          [energyPlatformConfigTable, [{ id: 1, energyProvider: 'catfee' }]],
        ]),
      ),
      insert,
    };
    const service = new EnergyRentalService(conn as never);

    await expect(
      (service as any).createPlatformPrice({
        packageName: '低于 CatFee 最小能量',
        energyAmount: 64999,
        durationHours: 1,
        priceSun: 2000000,
      }),
    ).rejects.toThrow('CatFee 套餐能量不能低于 65000');

    expect(insert).not.toHaveBeenCalled();
  });

  it('estimates package JustLend cost, prepay and profit from dashboard data', async () => {
    const fetchMock = jest.spyOn(global, 'fetch' as never).mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          energyRentPerTrx: '20000',
          energyStakePerTrx: '10',
          trxPrice: '0.3',
        },
      }),
    } as never);
    const service = new EnergyRentalService(
      createReadConn(new Map<unknown, unknown[]>([[energyPlatformConfigTable, []]])) as never,
    );

    await expect(
      service.estimatePackage({
        energyAmount: 100000,
        durationHours: 24,
        priceTrx: 12,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        energyAmount: 100000,
        durationHours: 24,
        minEnergyAmount: 100000,
        rentFeeTrx: 5,
        securityDepositTrx: 5,
        liquidationReserveTrx: 20,
        totalPrepayTrx: 30,
        platformCapitalTrx: 25,
        delegatedTrx: 10000,
        salePriceTrx: 12,
        profitTrx: 7,
      }),
    );

    fetchMock.mockRestore();
  });

  it('deletes selected energy rental packages', async () => {
    const where = jest.fn().mockResolvedValue(null);
    const deleteFn = jest.fn(() => ({ where }));
    const service = new EnergyRentalService({
      ...createReadConn(
        new Map<unknown, unknown[]>([
          [
            energyPackagesTable,
            [
              {
                id: 10,
                packageKind: 'platform_price',
                packageName: '平台 65K / 1 小时',
                energyAmount: 65000,
                durationHours: 1,
                priceSun: '1755000',
                status: 'active',
              },
              { id: 2, packageKind: 'admin_package', agentId: null, status: 'active' },
              { id: 3, packageKind: 'admin_package', agentId: null, status: 'disabled' },
            ],
          ],
        ]),
      ),
      delete: deleteFn,
    } as never);

    await expect(service.removePackages([2, 3])).resolves.toBeNull();

    expect(deleteFn).toHaveBeenCalledWith(energyPackagesTable);
    expect(where).toHaveBeenCalledTimes(1);
  });

  it('returns platform config without exposing sensitive values', async () => {
    const conn = createReadConn(
      new Map<unknown, unknown[]>([
        [
          energyPlatformConfigTable,
          [
            {
              id: 1,
              botStatus: 'enabled',
              telegramBotToken: '123456:secret',
              tronApiBaseUrl: 'https://api.trongrid.io',
              tronApiKey: 'tron-secret',
            justlendContractAddress: 'TJustLend',
            justlendPayerPrivateKey: 'private-key',
            catfeePayerPrivateKey: 'catfee-private-key',
            energyProvider: 'catfee',
            catfeeEnvironment: 'nile',
            catfeeProdApiBaseUrl: 'https://api.catfee.io',
            catfeeProdApiKey: 'prod-key',
            catfeeProdApiSecret: 'prod-secret',
            catfeeNileApiBaseUrl: 'https://nile.catfee.io',
            catfeeNileApiKey: 'nile-key',
            catfeeNileApiSecret: 'nile-secret',
            catfeeAutoActivate: true,
            orderPaymentTtlMinutes: 10,
            energyRentalTtlMinutes: 60,
            telegramPollingIntervalSeconds: 2,
              workerIntervalSeconds: 60,
              minTrxReserveSun: '100000000',
              bitcartApiBaseUrl: 'https://bitcart.example/api',
              bitcartAdminBaseUrl: 'https://pay.example',
              bitcartApiToken: 'bitcart-token',
              bitcartStoreId: 'store-trx',
              bitcartCurrency: 'TRX',
              bitcartWebhookBaseUrl: 'https://maer.example/site/api',
              bitcartWebhookSecret: 'webhook-secret',
            },
          ],
        ],
      ]),
    );
    const service = new EnergyRentalService(conn as never);

    await expect(service.getPlatformConfig()).resolves.toEqual({
      botStatus: 'enabled',
      telegramBotToken: '',
      telegramBotTokenConfigured: true,
      tronApiBaseUrl: 'https://api.trongrid.io',
      tronApiKey: '',
      tronApiKeyConfigured: true,
      justlendContractAddress: 'TJustLend',
      justlendPayerPrivateKey: '',
      justlendPayerPrivateKeyConfigured: true,
      catfeePayerPrivateKey: '',
      catfeePayerPrivateKeyConfigured: true,
      energyProvider: 'catfee',
      catfeeEnvironment: 'nile',
      catfeeProdApiBaseUrl: 'https://api.catfee.io',
      catfeeProdApiKey: '',
      catfeeProdApiKeyConfigured: true,
      catfeeProdApiSecret: '',
      catfeeProdApiSecretConfigured: true,
      catfeeNileApiBaseUrl: 'https://nile.catfee.io',
      catfeeNileApiKey: '',
      catfeeNileApiKeyConfigured: true,
      catfeeNileApiSecret: '',
      catfeeNileApiSecretConfigured: true,
      catfeeAutoActivate: true,
      orderPaymentTtlMinutes: 10,
      telegramPollingIntervalSeconds: 2,
      workerIntervalSeconds: 60,
      minTrxReserveSun: '100000000',
      bitcartApiBaseUrl: 'https://bitcart.example/api',
      bitcartAdminBaseUrl: 'https://pay.example',
      bitcartApiToken: '',
      bitcartApiTokenConfigured: true,
      bitcartStoreId: 'store-trx',
      bitcartCurrency: 'TRX',
      bitcartWebhookBaseUrl: 'https://maer.example/site/api',
      bitcartWebhookSecret: '',
      bitcartWebhookSecretConfigured: true,
    });
  });

  it('updates platform config without clearing existing secrets when secret inputs are blank', async () => {
    const rowsByTable = new Map<unknown, unknown[]>([
      [
        energyPlatformConfigTable,
        [
          {
            id: 1,
            telegramBotToken: 'old-token',
            tronApiKey: 'old-api-key',
            justlendPayerPrivateKey: 'old-private-key',
            catfeeProdApiKey: 'old-prod-key',
            catfeeProdApiSecret: 'old-prod-secret',
            catfeeNileApiKey: 'old-nile-key',
            catfeeNileApiSecret: 'old-nile-secret',
          },
        ],
      ],
    ]);
    const where = jest.fn().mockResolvedValue(null);
    const set = jest.fn(() => ({ where }));
    const update = jest.fn(() => ({ set }));
    const conn = { ...createReadConn(rowsByTable), update };
    const service = new EnergyRentalService(conn as never);

    await expect(
      service.updatePlatformConfig({
        botStatus: 'enabled',
        telegramBotToken: '',
        tronApiBaseUrl: 'https://nile.trongrid.io',
        tronApiKey: ' new-api-key ',
        energyProvider: 'catfee',
        catfeeEnvironment: 'nile',
        catfeeProdApiBaseUrl: 'https://api.catfee.io',
        catfeeProdApiKey: '',
        catfeeProdApiSecret: '',
        catfeeNileApiBaseUrl: 'https://nile.catfee.io',
        catfeeNileApiKey: ' new-nile-key ',
        catfeeNileApiSecret: '',
        catfeeAutoActivate: true,
        justlendPayerPrivateKey: '',
        catfeePayerPrivateKey: ' new-catfee-pk ',
        orderPaymentTtlMinutes: 10,
      }),
    ).resolves.toBeNull();

    expect(update).toHaveBeenCalledWith(energyPlatformConfigTable);
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        botStatus: 'enabled',
        tronApiBaseUrl: 'https://nile.trongrid.io',
        tronApiKey: 'new-api-key',
        energyProvider: 'catfee',
        catfeeEnvironment: 'nile',
        catfeeProdApiBaseUrl: 'https://api.catfee.io',
        catfeeNileApiBaseUrl: 'https://nile.catfee.io',
        catfeeNileApiKey: 'new-nile-key',
        catfeePayerPrivateKey: 'new-catfee-pk',
        catfeeAutoActivate: true,
        orderPaymentTtlMinutes: 10,
      }),
    );
    expect(set).not.toHaveBeenCalledWith(
      expect.objectContaining({
        energyRentalTtlMinutes: expect.anything(),
      }),
    );
    expect(set).not.toHaveBeenCalledWith(
      expect.objectContaining({
        telegramBotToken: expect.anything(),
        justlendPayerPrivateKey: expect.anything(),
        catfeeProdApiKey: expect.anything(),
        catfeeProdApiSecret: expect.anything(),
        catfeeNileApiSecret: expect.anything(),
      }),
    );
  });

  it('estimates package cost from active CatFee Nile environment', async () => {
    const fetchMock = jest.spyOn(global, 'fetch' as never).mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        data: 1_200_000,
      }),
    } as never);
    const conn = createReadConn(
      new Map<unknown, unknown[]>([
        [
          energyPlatformConfigTable,
          [
            {
              id: 1,
              energyProvider: 'catfee',
              catfeeEnvironment: 'nile',
              catfeeNileApiBaseUrl: 'https://nile.catfee.io',
              catfeeNileApiKey: 'nile-key',
              catfeeNileApiSecret: 'nile-secret',
            },
          ],
        ],
      ]),
    );
    const service = new EnergyRentalService(conn as never);

    await expect(
      service.estimatePackage({
        energyAmount: 65000,
        durationHours: 1,
        priceTrx: 2,
      }),
    ).resolves.toEqual(
        expect.objectContaining({
          provider: 'catfee',
          catfeeEnvironment: 'nile',
          energyAmount: 65000,
          minEnergyAmount: 65000,
          rentFeeTrx: 1.2,
          totalPrepayTrx: 1.2,
        platformCapitalTrx: 1.2,
        profitTrx: 0.8,
        profitRate: 40,
      }),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/nile\.catfee\.io\/v1\/estimate\?/),
      expect.objectContaining({
        headers: expect.objectContaining({
          'CF-ACCESS-KEY': 'nile-key',
          'CF-ACCESS-SIGN': expect.any(String),
          'CF-ACCESS-TIMESTAMP': expect.any(String),
        }),
      }),
    );
    fetchMock.mockRestore();
  });

  it('runs a safe CatFee Nile link test without creating an order', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch' as never)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          data: {
            wallet: 'TNileWallet',
            recharge_address: 'TNileRecharge',
            balance: 25_000_000,
            balance_usdt: 0,
            api_key: 'should-not-leak',
            api_secret: 'should-not-leak',
          },
        }),
      } as never)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          data: 1_300_000,
        }),
      } as never);
    const conn = createReadConn(
      new Map<unknown, unknown[]>([
        [
          energyPlatformConfigTable,
          [
            {
              id: 1,
              energyProvider: 'justlend',
              catfeeEnvironment: 'prod',
              catfeeNileApiBaseUrl: 'https://nile.catfee.io',
              catfeeNileApiKey: 'nile-key',
              catfeeNileApiSecret: 'nile-secret',
              catfeeAutoActivate: true,
            },
          ],
        ],
      ]),
    );
    const service = new EnergyRentalService(conn as never);

    const result = await service.runLinkTest({
      energyAmount: 130000,
      durationHours: 1,
    });

    expect(result).toEqual(
      expect.objectContaining({
        provider: 'catfee',
        environment: 'nile',
        overallStatus: 'success',
        energyAmount: 130000,
        durationHours: 1,
        account: expect.objectContaining({
          wallet: 'TNileWallet',
          rechargeAddress: 'TNileRecharge',
          balanceTrx: 25,
        }),
        estimate: expect.objectContaining({
          costSun: 1_300_000,
          costTrx: 1.3,
        }),
      }),
    );
    expect(JSON.stringify(result)).not.toContain('should-not-leak');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('https://nile.catfee.io/v1/account');
    expect(fetchMock.mock.calls[1][0]).toEqual(
      expect.stringMatching(/^https:\/\/nile\.catfee\.io\/v1\/estimate\?/),
    );
    expect(fetchMock.mock.calls.map((call) => String(call[0])).join('\n')).not.toContain(
      '/v1/order',
    );
    fetchMock.mockRestore();
  });

  it('can create and confirm a CatFee Nile test order during link test', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch' as never)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          data: {
            wallet: 'TNileWallet',
            recharge_address: 'TNileRecharge',
            balance: 25_000_000,
          },
        }),
      } as never)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          data: 650_000,
        }),
      } as never)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          data: {
            id: 'catfee-test-order-1',
            client_order_id: 'link-test-order',
            status: 'DELEGATE_SUCCESS',
            confirm_status: 'UNCONFIRMED',
            receiver: 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb',
            quantity: 65000,
            pay_amount_sun: 650000,
          },
        }),
      } as never)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          data: {
            id: 'catfee-test-order-1',
            client_order_id: 'link-test-order',
            status: 'DELEGATE_SUCCESS',
            confirm_status: 'DELEGATION_CONFIRMED',
            receiver: 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb',
            quantity: 65000,
            delegate_hash: 'delegate-hash',
            pay_amount_sun: 650000,
          },
        }),
      } as never);
    const conn = createReadConn(
      new Map<unknown, unknown[]>([
        [
          energyPlatformConfigTable,
          [
            {
              id: 1,
              energyProvider: 'catfee',
              catfeeEnvironment: 'nile',
              catfeeNileApiBaseUrl: 'https://nile.catfee.io',
              catfeeNileApiKey: 'nile-key',
              catfeeNileApiSecret: 'nile-secret',
              catfeeAutoActivate: true,
            },
          ],
        ],
      ]),
    );
    const service = new EnergyRentalService(conn as never);

    const result = await service.runLinkTest({
      energyAmount: 65000,
      durationHours: 1,
      createOrder: true,
      receiverAddress: 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb',
      clientOrderId: 'link-test-order',
    });

    expect(result.overallStatus).toBe('success');
    expect(result.order).toEqual(
      expect.objectContaining({
        id: 'catfee-test-order-1',
        clientOrderId: 'link-test-order',
        status: 'DELEGATE_SUCCESS',
        confirmStatus: 'DELEGATION_CONFIRMED',
        receiver: 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb',
        quantity: 65000,
        payAmountTrx: 0.65,
      }),
    );
    expect(fetchMock.mock.calls[2][0]).toEqual(
      expect.stringContaining(
        'https://nile.catfee.io/v1/order?duration=1h&quantity=65000&receiver=T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb&activate=true&client_order_id=link-test-order',
      ),
    );
    expect(fetchMock.mock.calls[2][1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'CF-ACCESS-KEY': 'nile-key',
        }),
      }),
    );
    expect(fetchMock.mock.calls[3][0]).toBe(
      'https://nile.catfee.io/v1/order/catfee-test-order-1',
    );
    expect(fetchMock.mock.calls[3][1]).toEqual(
      expect.objectContaining({
        method: 'GET',
      }),
    );
    fetchMock.mockRestore();
  });

  it('uses CatFee busy price from 20:00 through 10:00 Asia/Shanghai time', () => {
    const idleTime = new Date('2026-04-29T11:00:00+08:00');
    const busyNight = new Date('2026-04-29T20:00:00+08:00');
    const busyMorning = new Date('2026-04-30T09:59:59+08:00');
    const idleBoundary = new Date('2026-04-30T10:00:00+08:00');

    expect(resolveCatFeePricePeriod(idleTime)).toBe('idle');
    expect(resolveCatFeePricePeriod(busyNight)).toBe('busy');
    expect(resolveCatFeePricePeriod(busyMorning)).toBe('busy');
    expect(resolveCatFeePricePeriod(idleBoundary)).toBe('idle');
  });

  it('resolves current package price from idle and busy package prices', () => {
    const pkg = {
      priceSun: '2550000',
      idlePriceSun: '1755000',
      busyPriceSun: '2405000',
    };

    expect(
      resolvePackageCurrentPriceSun(pkg, new Date('2026-04-29T15:00:00+08:00')),
    ).toEqual({ period: 'idle', priceSun: '1755000' });
    expect(
      resolvePackageCurrentPriceSun(pkg, new Date('2026-04-29T21:00:00+08:00')),
    ).toEqual({ period: 'busy', priceSun: '2405000' });
  });

  it('returns an agent dashboard scoped to the current agent without provider channel data', async () => {
    const conn = createReadConn(
      new Map<unknown, unknown[]>([
        [
          agentProfilesTable,
          [{ id: 7, userId: 22, agentName: '用户 A', status: 'active' }],
        ],
        [
          agentWalletAccountsTable,
          [{ id: 1, agentId: 7, balanceSun: '10000000' }],
        ],
        [energyPackagesTable, [{ id: 1, status: 'active' }]],
        [
          energyOrdersTable,
          [
            {
              id: 1,
              agentId: 7,
              status: 'completed',
              energyAmount: 65000,
              paymentAmountSun: '1755000',
            },
            {
              id: 2,
              agentId: 8,
              status: 'completed',
              energyAmount: 130000,
              paymentAmountSun: '4810000',
            },
          ],
        ],
        [
          energyWalletTransactionsTable,
          [
            { id: 1, agentId: 7, direction: 'in', amountSun: '10000000' },
            { id: 2, agentId: 8, direction: 'in', amountSun: '50000000' },
          ],
        ],
        [energyReturnTasksTable, []],
        [
          energyPlatformConfigTable,
          [{ id: 1, energyProvider: 'catfee', catfeeProdApiKey: 'secret-key' }],
        ],
      ]),
    );
    const service = new EnergyRentalService(conn as never);

    const result = await service.getDashboard(22);

    expect(result.scope).toBe('agent');
    expect(result.agentWalletBalanceSun).toBe(10_000_000);
    expect(result.totalOrderCount).toBe(1);
    expect(result.totalRevenueSun).toBe(1_755_000);
    expect(result.totalEnergyRented).toBe(65_000);
    expect(result.providerBalanceMonitors).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('catfee');
    expect(JSON.stringify(result)).not.toContain('secret-key');
  });

  it('returns only the current agent bot config without exposing the token', async () => {
    const conn = createReadConn(
      new Map<unknown, unknown[]>([
        [
          agentProfilesTable,
          [{ id: 7, userId: 22, agentName: '用户 A', status: 'active' }],
        ],
        [
          agentBotConfigsTable,
          [
            {
              id: 1,
              agentId: 7,
              botStatus: 'enabled',
              telegramBotToken: '123456:agent-secret-token',
              telegramBotUsername: 'agent_a_bot',
              remark: '用户 A',
            },
            {
              id: 2,
              agentId: 8,
              botStatus: 'enabled',
              telegramBotToken: '654321:other-agent-secret',
              telegramBotUsername: 'agent_b_bot',
              remark: '用户 B',
            },
          ],
        ],
      ]),
    );
    const service = new EnergyRentalService(conn as never);

    await expect(service.getAgentBotConfig(22)).resolves.toEqual({
      scope: 'agent',
      agentId: 7,
      botStatus: 'enabled',
      telegramBotToken: '',
      telegramBotTokenConfigured: true,
      telegramBotUsername: 'agent_a_bot',
      remark: '用户 A',
    });
  });

  it('returns platform bot config through the bot config module for an admin user', async () => {
    const conn = createReadConn(
      new Map<unknown, unknown[]>([
        [sysUserRoleTable, [{ userId: 1, roleId: 1 }]],
        [
          energyPlatformConfigTable,
          [
            {
              id: 1,
              botStatus: 'enabled',
              telegramBotToken: '123456:platform-secret-token',
            },
          ],
        ],
        [agentProfilesTable, []],
        [agentBotConfigsTable, []],
      ]),
    );
    const service = new EnergyRentalService(conn as never);

    await expect(service.getAgentBotConfig(1)).resolves.toEqual({
      scope: 'platform',
      agentId: null,
      botStatus: 'enabled',
      telegramBotToken: '',
      telegramBotTokenConfigured: true,
      telegramBotUsername: '',
      remark: '',
    });
  });

  it('updates platform bot config through the bot config module for an admin user', async () => {
    const where = jest.fn().mockResolvedValue(null);
    const set = jest.fn(() => ({ where }));
    const update = jest.fn(() => ({ set }));
    const conn = {
      ...createReadConn(
        new Map<unknown, unknown[]>([
          [sysUserRoleTable, [{ userId: 1, roleId: 1 }]],
          [
            energyPlatformConfigTable,
            [{ id: 1, botStatus: 'disabled', telegramBotToken: '' }],
          ],
          [agentProfilesTable, []],
        ]),
      ),
      update,
    };
    const service = new EnergyRentalService(conn as never);

    await expect(
      service.updateAgentBotConfig(1, {
        botStatus: 'enabled',
        telegramBotToken: ' new-token ',
      }),
    ).resolves.toBeNull();

    expect(update).toHaveBeenCalledWith(energyPlatformConfigTable);
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        botStatus: 'enabled',
        telegramBotToken: 'new-token',
      }),
    );
  });

  it('reports platform bot runtime status without exposing the token', async () => {
    const now = new Date('2026-04-29T14:00:00.000Z');
    const conn = createReadConn(
      new Map<unknown, unknown[]>([
        [
          energyPlatformConfigTable,
          [
            {
              id: 1,
              botStatus: 'enabled',
              telegramBotToken: '123456:platform-secret-token',
            },
          ],
        ],
        [
          agentProfilesTable,
          [
            { id: 7, userId: 22, agentName: '用户 A', status: 'active' },
            { id: 8, userId: 23, agentName: '用户 B', status: 'disabled' },
          ],
        ],
        [
          agentBotConfigsTable,
          [
            {
              id: 1,
              agentId: 7,
              botStatus: 'enabled',
              telegramBotToken: '123456:agent-secret-token',
            },
            {
              id: 2,
              agentId: 8,
              botStatus: 'enabled',
              telegramBotToken: '123456:disabled-agent-token',
            },
          ],
        ],
        [
          botRuntimeStatusTable,
          [
            {
              id: 1,
              botScope: 'platform',
              agentId: null,
              desiredStatus: 'enabled',
              runtimeStatus: 'running',
              pollingStatus: 'polling',
              instanceId: 'bot-host-1',
              lastHeartbeatAt: new Date('2026-04-29T13:59:30.000Z'),
              lastStartedAt: new Date('2026-04-29T13:50:00.000Z'),
              lastStoppedAt: null,
              lastError: '',
            },
          ],
        ],
      ]),
    );
    const service = new EnergyRentalService(conn as never);

    const result = await service.getBotRuntimeStatus(undefined, now);

    expect(result).toEqual(
      expect.objectContaining({
        scope: 'platform',
        agentId: null,
        desiredStatus: 'enabled',
        serviceStatus: 'online',
        runtimeStatus: 'running',
        pollingStatus: 'polling',
        telegramBotTokenConfigured: true,
        canEnable: true,
        activeAgentBotCount: 1,
        heartbeatAgeSeconds: 30,
        instanceId: 'bot-host-1',
      }),
    );
    expect(JSON.stringify(result)).not.toContain('platform-secret-token');
    expect(JSON.stringify(result)).not.toContain('agent-secret-token');
  });

  it('rejects enabling a current user bot before its token is configured', async () => {
    const where = jest.fn().mockResolvedValue(null);
    const set = jest.fn(() => ({ where }));
    const update = jest.fn(() => ({ set }));
    const conn = {
      ...createReadConn(
        new Map<unknown, unknown[]>([
          [
            agentProfilesTable,
            [{ id: 7, userId: 22, agentName: '用户 A', status: 'active' }],
          ],
          [
            agentBotConfigsTable,
            [
              {
                id: 1,
                agentId: 7,
                botStatus: 'disabled',
                telegramBotToken: '',
              },
            ],
          ],
        ]),
      ),
      update,
    };
    const service = new EnergyRentalService(conn as never);

    await expect(
      service.updateBotRuntimeStatus(22, { botStatus: 'enabled' }),
    ).rejects.toThrow('请先配置 Telegram Bot Token');
    expect(update).not.toHaveBeenCalled();
  });

  it('updates the platform desired bot status from the runtime control endpoint', async () => {
    const where = jest.fn().mockResolvedValue(null);
    const set = jest.fn(() => ({ where }));
    const update = jest.fn(() => ({ set }));
    const conn = {
      ...createReadConn(
        new Map<unknown, unknown[]>([
          [
            energyPlatformConfigTable,
            [
              {
                id: 1,
                botStatus: 'enabled',
                telegramBotToken: '123456:platform-secret-token',
              },
            ],
          ],
        ]),
      ),
      update,
    };
    const service = new EnergyRentalService(conn as never);

    await expect(
      service.updateBotRuntimeStatus(undefined, { botStatus: 'disabled' }),
    ).resolves.toBeNull();

    expect(update).toHaveBeenCalledWith(energyPlatformConfigTable);
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ botStatus: 'disabled' }),
    );
  });

  it('lists only the current user packages with own sale prices and platform cost prices', async () => {
    const conn = createReadConn(
      new Map<unknown, unknown[]>([
        [
          agentProfilesTable,
          [{ id: 7, userId: 22, agentName: '用户 A', status: 'active' }],
        ],
        [
          energyPackagesTable,
          [
            {
              id: 10,
              packageKind: 'platform_price',
              packageName: '平台 65K / 1 小时',
              energyAmount: 65000,
              durationHours: 1,
              priceSun: '1755000',
              idlePriceSun: '1755000',
              busyPriceSun: '2405000',
              status: 'active',
              sortOrder: 1,
            },
            {
              id: 21,
              packageKind: 'user_package',
              agentId: 7,
              platformPackageId: 10,
              packageName: '用户 A 特价套餐',
              energyAmount: 1,
              durationHours: 99,
              priceSun: '2100000',
              idlePriceSun: '2100000',
              busyPriceSun: '2800000',
              status: 'active',
              sortOrder: 2,
            },
            {
              id: 22,
              packageKind: 'user_package',
              agentId: 8,
              platformPackageId: 10,
              packageName: '用户 B 套餐',
              energyAmount: 65000,
              durationHours: 1,
              priceSun: '1755000',
              status: 'active',
              sortOrder: 1,
            },
          ],
        ],
      ]),
    );
    const service = new EnergyRentalService(conn as never);

    const result = await (service as any).findPackages(
      { pageIndex: 1, pageSize: 10, filters: {} },
      22,
    );

    expect(result.total).toBe(1);
    expect(result.list).toEqual([
      expect.objectContaining({
        id: 21,
        agentId: 7,
        platformPackageId: 10,
        packageName: '用户 A 特价套餐',
        energyAmount: 65000,
        durationHours: 1,
        idlePriceSun: '2100000',
        busyPriceSun: '2800000',
        currentPriceSun: expect.any(String),
        platformPackageName: '平台 65K / 1 小时',
        platformIdlePriceSun: '1755000',
        platformBusyPriceSun: '2405000',
      }),
    ]);
  });

  it('lists platform price templates separately from administrator packages', async () => {
    const conn = createReadConn(
      new Map<unknown, unknown[]>([
        [
          energyPackagesTable,
          [
            {
              id: 10,
              packageKind: 'platform_price',
              packageName: '平台 65K / 1 小时',
              energyAmount: 65000,
              durationHours: 1,
              priceSun: '1755000',
              idlePriceSun: '1755000',
              busyPriceSun: '2405000',
              status: 'active',
              sortOrder: 1,
            },
            {
              id: 20,
              packageKind: 'admin_package',
              agentId: null,
              packageName: '管理员售卖套餐',
              energyAmount: 65000,
              durationHours: 1,
              priceSun: '2400000',
              idlePriceSun: '2400000',
              busyPriceSun: '3200000',
              status: 'active',
              sortOrder: 2,
            },
            {
              id: 21,
              packageKind: 'user_package',
              agentId: 7,
              platformPackageId: 10,
              packageName: '用户套餐',
              energyAmount: 65000,
              durationHours: 1,
              priceSun: '1755000',
              status: 'active',
              sortOrder: 3,
            },
          ],
        ],
      ]),
    );
    const service = new EnergyRentalService(conn as never);

    const platformPrices = await (service as any).findPlatformPrices({
      pageIndex: 1,
      pageSize: 10,
      filters: {},
    });
    const adminPackages = await (service as any).findPackages({
      pageIndex: 1,
      pageSize: 10,
      filters: {},
    });

    expect(platformPrices.total).toBe(1);
    expect(platformPrices.list).toEqual([
      expect.objectContaining({
        id: 10,
        packageName: '平台 65K / 1 小时',
      }),
    ]);
    expect(adminPackages.total).toBe(1);
    expect(adminPackages.list).toEqual([
      expect.objectContaining({
        id: 20,
        agentId: null,
        packageKind: 'admin_package',
        packageName: '管理员售卖套餐',
        energyAmount: 65000,
        durationHours: 1,
        idlePriceSun: '2400000',
        busyPriceSun: '3200000',
      }),
    ]);
  });

  it('creates an administrator package with direct sale prices against provider cost', async () => {
    const values = jest.fn().mockResolvedValue(null);
    const insert = jest.fn(() => ({ values }));
    const conn = {
      ...createReadConn(
        new Map<unknown, unknown[]>([
          [
            energyPackagesTable,
            [
              {
                id: 10,
                packageKind: 'platform_price',
                packageName: '平台 65K / 1 小时',
                energyAmount: 65000,
                durationHours: 1,
                priceSun: '1755000',
                idlePriceSun: '1755000',
                busyPriceSun: '2405000',
                status: 'active',
                sortOrder: 1,
              },
            ],
          ],
          [energyPlatformConfigTable, [{ id: 1, energyProvider: 'catfee' }]],
        ]),
      ),
      insert,
    };
    const service = new EnergyRentalService(conn as never);

    await (service as any).createPackage(undefined, {
      packageName: '管理员售卖套餐',
      energyAmount: 65000,
      durationHours: 1,
      priceSun: '2400000',
      idlePriceSun: '2400000',
      busyPriceSun: '3200000',
      status: 'active',
      sortOrder: 2,
    });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        packageKind: 'admin_package',
        agentId: null,
        platformPackageId: null,
        packageName: '管理员售卖套餐',
        energyAmount: 65000,
        durationHours: 1,
        priceSun: '2400000',
        idlePriceSun: '2400000',
        busyPriceSun: '3200000',
        status: 'active',
        sortOrder: 2,
      }),
    );
  });

  it('prevents deleting a platform price while administrator or user packages reference it', async () => {
    const deleteFn = jest.fn();
    const conn = {
      ...createReadConn(
        new Map<unknown, unknown[]>([
          [
            energyPackagesTable,
            [
              {
                id: 10,
                packageKind: 'platform_price',
                packageName: '平台 65K / 1 小时',
                energyAmount: 65000,
                durationHours: 1,
                priceSun: '1755000',
                status: 'active',
              },
              {
                id: 20,
                packageKind: 'admin_package',
                agentId: null,
                packageName: '管理员售卖套餐',
                energyAmount: 65000,
                durationHours: 1,
                priceSun: '1755000',
                status: 'active',
              },
              {
                id: 21,
                packageKind: 'user_package',
                agentId: 7,
                platformPackageId: 10,
                packageName: '用户套餐',
                energyAmount: 65000,
                durationHours: 1,
                priceSun: '1755000',
                status: 'active',
              },
            ],
          ],
        ]),
      ),
      delete: deleteFn,
    };
    const service = new EnergyRentalService(conn as never);

    await expect((service as any).removePlatformPrices([10])).rejects.toThrow(
      '平台价格已被套餐引用',
    );
    expect(deleteFn).not.toHaveBeenCalled();
  });

  it('creates a user package from a platform price while keeping the user sale price', async () => {
    const values = jest.fn().mockResolvedValue(null);
    const insert = jest.fn(() => ({ values }));
    const conn = {
      ...createReadConn(
        new Map<unknown, unknown[]>([
          [
            agentProfilesTable,
            [{ id: 7, userId: 22, agentName: '用户 A', status: 'active' }],
          ],
          [
            energyPackagesTable,
            [
              {
                id: 10,
                packageKind: 'platform_price',
                packageName: '平台 65K / 1 小时',
                energyAmount: 65000,
                durationHours: 1,
                priceSun: '1755000',
                idlePriceSun: '1755000',
                busyPriceSun: '2405000',
                status: 'active',
                sortOrder: 1,
              },
            ],
          ],
        ]),
      ),
      insert,
    };
    const service = new EnergyRentalService(conn as never);

    await (service as any).createPackage(22, {
      platformPackageId: 10,
      packageName: '用户 A 特价套餐',
      energyAmount: 1,
      durationHours: 99,
      priceSun: '2100000',
      idlePriceSun: '2100000',
      busyPriceSun: '2800000',
      status: 'active',
      sortOrder: 2,
    });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        packageKind: 'user_package',
        agentId: 7,
        platformPackageId: 10,
        packageName: '用户 A 特价套餐',
        energyAmount: 65000,
        durationHours: 1,
        priceSun: '2100000',
        idlePriceSun: '2100000',
        busyPriceSun: '2800000',
        status: 'active',
        sortOrder: 2,
      }),
    );
  });

  it('creates a Bitcart invoice for user recharge instead of using shared collection address matching', async () => {
    const fetchMock = jest.spyOn(global, 'fetch' as never).mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'bitcart-invoice-1',
        status: 'pending',
        store_id: 'store-trx',
        order_id: 'AR20260430101010abcdef',
        currency: 'TRX',
        sent_amount: 0,
        tx_hashes: [],
        payments: [
          {
            id: 'payment-1',
            currency: 'trx',
            payment_address: 'TInvoiceAddress',
            payment_url: 'tron:TInvoiceAddress?amount=10',
            amount: '10.000000',
          },
        ],
      }),
    } as never);
    const returning = jest.fn().mockResolvedValue([
      {
        id: 99,
        orderNo: 'AR20260430101010abcdef',
        amountSun: '10000000',
        paymentAddress: '',
      },
    ]);
    const values = jest.fn(() => ({ returning }));
    const insert = jest.fn(() => ({ values }));
    const where = jest.fn().mockResolvedValue(null);
    const set = jest.fn(() => ({ where }));
    const update = jest.fn(() => ({ set }));
    const readConn = createReadConn(
      new Map<unknown, unknown[]>([
        [
          agentProfilesTable,
          [{ id: 7, userId: 22, agentName: '用户 A', status: 'active' }],
        ],
        [
          energyPlatformConfigTable,
          [
            {
              id: 1,
              bitcartApiBaseUrl: 'https://bitcart.example/api',
              bitcartAdminBaseUrl: 'https://pay.example',
              bitcartApiToken: 'bitcart-token',
              bitcartStoreId: 'store-trx',
              bitcartCurrency: 'TRX',
              bitcartWebhookBaseUrl: 'https://maer.example/site/api',
              bitcartWebhookSecret: 'webhook-secret',
              orderPaymentTtlMinutes: 10,
            },
          ],
        ],
        [agentRechargeOrdersTable, []],
      ]),
    );
    const execute = jest.fn().mockResolvedValue(null);
    const conn = {
      ...readConn,
      insert,
      update,
      transaction: jest.fn((callback) =>
        callback({ ...readConn, execute, insert, update }),
      ),
    };
    const service = new EnergyRentalService(conn as never);

    const result = await service.createAgentRechargeOrder(22, {
      amountTrx: 10,
    });

    const [bitcartUrl, bitcartRequest] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(bitcartUrl).toMatch(
      /^https:\/\/bitcart\.example\/api\/invoices\/order_id\/AR\d{14}[0-9a-f]{6}$/,
    );
    expect(bitcartRequest).toEqual(
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer bitcart-token',
        }),
      }),
    );
    expect(JSON.parse(String(bitcartRequest.body))).toEqual(
      expect.objectContaining({
        price: '10.000000',
        store_id: 'store-trx',
        currency: 'TRX',
        expiration: 10,
        notification_url:
          'https://maer.example/site/api/energy-rental/bitcart/webhook?secret=webhook-secret',
      }),
    );
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedAmountSun: '10000000',
        amountSun: '10000000',
        paymentGateway: 'bitcart',
        paymentAddress: '',
        status: 'creating',
      }),
    );
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'pending',
        bitcartInvoiceId: 'bitcart-invoice-1',
        bitcartInvoiceStatus: 'pending',
        bitcartCheckoutUrl: 'https://pay.example/i/bitcart-invoice-1',
        bitcartPaymentUrl: 'tron:TInvoiceAddress?amount=10',
        paymentAddress: 'TInvoiceAddress',
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        bitcartInvoiceId: 'bitcart-invoice-1',
        bitcartCheckoutUrl: 'https://pay.example/i/bitcart-invoice-1',
      }),
    );
  });

  it('credits a recharge when Bitcart is still pending but the exact TRX transfer is confirmed on-chain', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch' as never)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'bitcart-invoice-chain-fallback',
          status: 'pending',
          store_id: 'store-trx',
          order_id: 'AR202604300533485983c5',
          currency: 'TRX',
          sent_amount: 0,
          tx_hashes: [],
          payments: [
            {
              id: 'payment-chain-fallback',
              currency: 'trx',
              payment_address: 'TLKaA3hCcaFo27UEdNQPC8Sr3WtqkhjTJk',
              payment_url: 'tron:TLKaA3hCcaFo27UEdNQPC8Sr3WtqkhjTJk',
              amount: '1.000000',
            },
          ],
        }),
      } as never)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: [
            {
              txID: 'chain-tx-1trx',
              block_timestamp: Date.parse('2026-04-30T05:38:03.000Z'),
              ret: [{ contractRet: 'SUCCESS' }],
              raw_data: {
                contract: [
                  {
                    type: 'TransferContract',
                    parameter: {
                      value: {
                        amount: 1_000_000,
                        to_address: '41718b3c81a25a01fe7b752d7a00c2fb73f9b4cc87',
                      },
                    },
                  },
                ],
              },
            },
          ],
        }),
      } as never);
    const order = {
      id: 10,
      agentId: 1,
      orderNo: 'AR202604300533485983c5',
      requestedAmountSun: '1000000',
      amountSun: '1000000',
      paymentGateway: 'bitcart',
      paymentAddress: 'TLKaA3hCcaFo27UEdNQPC8Sr3WtqkhjTJk',
      bitcartInvoiceId: 'bitcart-invoice-chain-fallback',
      bitcartInvoiceStatus: 'pending',
      bitcartPaymentAmount: '1.000000',
      status: 'pending',
      expiresAt: new Date('2026-04-30T05:43:48.519Z'),
      createdAt: new Date('2026-04-30T05:38:38.708Z'),
    };
    const rowsByTable = new Map<unknown, unknown[]>([
      [
        energyPlatformConfigTable,
        [
          {
            id: 1,
            tronApiBaseUrl: 'https://api.trongrid.io',
            tronApiKey: 'tron-api-key',
            bitcartApiBaseUrl: 'https://bitcart.example/api',
            bitcartAdminBaseUrl: 'https://pay.example',
            bitcartApiToken: 'bitcart-token',
            bitcartStoreId: 'store-trx',
            bitcartCurrency: 'TRX',
            bitcartWebhookBaseUrl: 'https://maer.example/site/api',
            bitcartWebhookSecret: 'webhook-secret',
            orderPaymentTtlMinutes: 10,
          },
        ],
      ],
      [agentRechargeOrdersTable, [order]],
      [energyWalletTransactionsTable, []],
    ]);
    const where = jest.fn().mockResolvedValue(null);
    const set = jest.fn(() => ({ where }));
    const update = jest.fn(() => ({ set }));
    const values = jest.fn().mockResolvedValue(null);
    const insert = jest.fn(() => ({ values }));
    const execute = jest.fn().mockResolvedValue(null);
    const readConn = createReadConn(rowsByTable);
    const conn = {
      ...readConn,
      update,
      insert,
      transaction: jest.fn((callback) =>
        callback({ ...readConn, execute, update, insert }),
      ),
    };
    const service = new EnergyRentalService(conn as never);

    const result = await service.syncAgentRechargeOrder(10);

    expect(result).toEqual({ credited: true, status: 'confirmed' });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(
        /^https:\/\/api\.trongrid\.io\/v1\/accounts\/TLKaA3hCcaFo27UEdNQPC8Sr3WtqkhjTJk\/transactions\?/,
      ),
      expect.objectContaining({
        headers: expect.objectContaining({
          'TRON-PRO-API-KEY': 'tron-api-key',
        }),
      }),
    );
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'confirmed',
        paymentTxHash: 'chain-tx-1trx',
        bitcartInvoiceStatus: 'onchain_confirmed',
        bitcartSentAmount: '1.000000',
      }),
    );
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 1,
        txHash: 'chain-tx-1trx',
        transactionType: 'agent_recharge',
        amountSun: '1000000',
        status: 'confirmed',
      }),
    );
  });

  it('uses a globally unique payable amount when another active Bitcart invoice has the same amount', async () => {
    const fetchMock = jest.spyOn(global, 'fetch' as never).mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'bitcart-invoice-2',
        status: 'pending',
        store_id: 'store-trx',
        order_id: 'AR20260430101010abcdef',
        currency: 'TRX',
        sent_amount: 0,
        tx_hashes: [],
        payments: [
          {
            id: 'payment-2',
            currency: 'trx',
            payment_address: 'TInvoiceAddress',
            payment_url: 'tron:TInvoiceAddress?amount=10.000001',
            amount: '10.000001',
          },
        ],
      }),
    } as never);
    const returning = jest.fn().mockResolvedValue([
      {
        id: 100,
        orderNo: 'AR20260430101010abcdef',
        amountSun: '10000001',
        paymentAddress: '',
      },
    ]);
    const values = jest.fn(() => ({ returning }));
    const insert = jest.fn(() => ({ values }));
    const where = jest.fn().mockResolvedValue(null);
    const set = jest.fn(() => ({ where }));
    const update = jest.fn(() => ({ set }));
    const readConn = createReadConn(
      new Map<unknown, unknown[]>([
        [
          agentProfilesTable,
          [{ id: 7, userId: 22, agentName: '用户 A', status: 'active' }],
        ],
        [
          energyPlatformConfigTable,
          [
            {
              id: 1,
              bitcartApiBaseUrl: 'https://bitcart.example/api',
              bitcartAdminBaseUrl: 'https://pay.example',
              bitcartApiToken: 'bitcart-token',
              bitcartStoreId: 'store-trx',
              bitcartCurrency: 'TRX',
              bitcartWebhookBaseUrl: 'https://maer.example/site/api',
              bitcartWebhookSecret: 'webhook-secret',
              orderPaymentTtlMinutes: 10,
            },
          ],
        ],
        [
          agentRechargeOrdersTable,
          [
            {
              id: 1,
              agentId: 8,
              requestedAmountSun: '10000000',
              amountSun: '10000000',
              paymentGateway: 'bitcart',
              status: 'pending',
              expiresAt: new Date('2099-01-01T00:00:00.000Z'),
            },
          ],
        ],
      ]),
    );
    const execute = jest.fn().mockResolvedValue(null);
    const conn = {
      ...readConn,
      insert,
      update,
      transaction: jest.fn((callback) =>
        callback({ ...readConn, execute, insert, update }),
      ),
    };
    const service = new EnergyRentalService(conn as never);

    const result = await service.createAgentRechargeOrder(22, {
      amountTrx: 10,
    });
    const [, bitcartRequest] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];

    expect(JSON.parse(String(bitcartRequest.body))).toEqual(
      expect.objectContaining({
        price: '10.000001',
        store_id: 'store-trx',
      }),
    );
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedAmountSun: '10000000',
        amountSun: '10000001',
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        amountSun: '10000001',
        bitcartInvoiceId: 'bitcart-invoice-2',
      }),
    );
  });

  it('credits a Bitcart completed recharge exactly once after server-side invoice verification', async () => {
    const fetchMock = jest.spyOn(global, 'fetch' as never).mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'bitcart-invoice-1',
        status: 'complete',
        store_id: 'store-trx',
        order_id: 'AR20260430101010abcdef',
        currency: 'TRX',
        sent_amount: 10,
        paid_currency: 'TRX',
        tx_hashes: ['tx-bitcart-1'],
        payments: [
          {
            id: 'payment-1',
            currency: 'trx',
            payment_address: 'TInvoiceAddress',
            payment_url: 'tron:TInvoiceAddress?amount=10',
            amount: '10.000000',
          },
        ],
      }),
    } as never);
    const rowsByTable = new Map<unknown, unknown[]>([
      [
        energyPlatformConfigTable,
        [
          {
            id: 1,
            bitcartApiBaseUrl: 'https://bitcart.example/api',
            bitcartAdminBaseUrl: 'https://pay.example',
            bitcartApiToken: 'bitcart-token',
            bitcartStoreId: 'store-trx',
            bitcartCurrency: 'TRX',
            bitcartWebhookBaseUrl: 'https://maer.example/site/api',
            bitcartWebhookSecret: 'webhook-secret',
          },
        ],
      ],
      [
        agentRechargeOrdersTable,
        [
          {
            id: 99,
            agentId: 7,
            orderNo: 'AR20260430101010abcdef',
            amountSun: '10000000',
            paymentAddress: 'TInvoiceAddress',
            paymentGateway: 'bitcart',
            bitcartInvoiceId: 'bitcart-invoice-1',
            status: 'pending',
            expiresAt: new Date('2099-01-01T00:00:00.000Z'),
          },
        ],
      ],
    ]);
    const readConn = createReadConn(rowsByTable);
    const orderWhere = jest.fn().mockResolvedValue(null);
    const orderSet = jest.fn(() => ({ where: orderWhere }));
    const walletWhere = jest.fn().mockResolvedValue(null);
    const walletSet = jest.fn(() => ({ where: walletWhere }));
    const update = jest
      .fn()
      .mockReturnValueOnce({ set: orderSet })
      .mockReturnValueOnce({ set: walletSet });
    const walletValues = jest.fn().mockResolvedValue(null);
    const insert = jest.fn(() => ({ values: walletValues }));
    const execute = jest.fn().mockResolvedValue(null);
    const conn = {
      ...readConn,
      update,
      insert,
      transaction: jest.fn((callback) =>
        callback({ ...readConn, execute, update, insert }),
      ),
    };
    const service = new EnergyRentalService(conn as never);

    await expect(
      (service as any).handleBitcartInvoiceWebhook(
        { id: 'bitcart-invoice-1', status: 'complete' },
        'webhook-secret',
      ),
    ).resolves.toEqual(expect.objectContaining({ credited: true }));

    expect(fetchMock).toHaveBeenCalledWith(
      'https://bitcart.example/api/invoices/bitcart-invoice-1',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer bitcart-token',
        }),
      }),
    );
    expect(orderSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'confirmed',
        paymentTxHash: 'tx-bitcart-1',
        bitcartInvoiceStatus: 'complete',
        bitcartSentAmount: '10',
      }),
    );
    expect(walletSet).toHaveBeenCalledWith(
      expect.objectContaining({
        updatedAt: expect.any(Date),
      }),
    );
    expect(walletValues).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 7,
        txHash: 'tx-bitcart-1',
        transactionType: 'agent_recharge',
        amountSun: '10000000',
        relatedOrderId: 99,
        status: 'confirmed',
      }),
    );
  });

  it('credits the requested amount when Bitcart payable amount contains a uniqueness offset', async () => {
    jest.spyOn(global, 'fetch' as never).mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'bitcart-invoice-offset',
        status: 'complete',
        store_id: 'store-trx',
        order_id: 'AR20260430101010abcdef',
        currency: 'TRX',
        sent_amount: 10.000001,
        paid_currency: 'TRX',
        tx_hashes: ['tx-bitcart-offset'],
        payments: [
          {
            id: 'payment-offset',
            currency: 'trx',
            payment_address: 'TInvoiceAddress',
            payment_url: 'tron:TInvoiceAddress?amount=10.000001',
            amount: '10.000001',
          },
        ],
      }),
    } as never);
    const rowsByTable = new Map<unknown, unknown[]>([
      [
        energyPlatformConfigTable,
        [
          {
            id: 1,
            bitcartApiBaseUrl: 'https://bitcart.example/api',
            bitcartAdminBaseUrl: 'https://pay.example',
            bitcartApiToken: 'bitcart-token',
            bitcartStoreId: 'store-trx',
            bitcartCurrency: 'TRX',
            bitcartWebhookBaseUrl: 'https://maer.example/site/api',
            bitcartWebhookSecret: 'webhook-secret',
          },
        ],
      ],
      [
        agentRechargeOrdersTable,
        [
          {
            id: 100,
            agentId: 7,
            orderNo: 'AR20260430101010abcdef',
            requestedAmountSun: '10000000',
            amountSun: '10000001',
            paymentAddress: 'TInvoiceAddress',
            paymentGateway: 'bitcart',
            bitcartInvoiceId: 'bitcart-invoice-offset',
            status: 'pending',
            expiresAt: new Date('2099-01-01T00:00:00.000Z'),
          },
        ],
      ],
    ]);
    const readConn = createReadConn(rowsByTable);
    const orderWhere = jest.fn().mockResolvedValue(null);
    const orderSet = jest.fn(() => ({ where: orderWhere }));
    const walletWhere = jest.fn().mockResolvedValue(null);
    const walletSet = jest.fn(() => ({ where: walletWhere }));
    const update = jest
      .fn()
      .mockReturnValueOnce({ set: orderSet })
      .mockReturnValueOnce({ set: walletSet });
    const walletValues = jest.fn().mockResolvedValue(null);
    const insert = jest.fn(() => ({ values: walletValues }));
    const execute = jest.fn().mockResolvedValue(null);
    const conn = {
      ...readConn,
      update,
      insert,
      transaction: jest.fn((callback) =>
        callback({ ...readConn, execute, update, insert }),
      ),
    };
    const service = new EnergyRentalService(conn as never);

    await expect(
      (service as any).handleBitcartInvoiceWebhook(
        { id: 'bitcart-invoice-offset', status: 'complete' },
        'webhook-secret',
      ),
    ).resolves.toEqual(expect.objectContaining({ credited: true }));

    expect(walletSet).toHaveBeenCalledWith(
      expect.objectContaining({
        balanceSun: expect.anything(),
        totalRechargeSun: expect.anything(),
      }),
    );
    expect(walletValues).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 7,
        txHash: 'tx-bitcart-offset',
        transactionType: 'agent_recharge',
        amountSun: '10000000',
        relatedOrderId: 100,
        status: 'confirmed',
      }),
    );
  });

  it('marks expired Bitcart recharge orders as expired in the user recharge list', async () => {
    const rowsByTable = new Map<unknown, unknown[]>([
      [
        agentProfilesTable,
        [{ id: 7, userId: 22, agentName: '用户 A', status: 'active' }],
      ],
      [
        agentRechargeOrdersTable,
        [
          {
            id: 101,
            agentId: 7,
            orderNo: 'AR20260430101010expired',
            requestedAmountSun: '10000000',
            amountSun: '10000000',
            paymentGateway: 'bitcart',
            bitcartInvoiceId: 'bitcart-invoice-expired',
            bitcartInvoiceStatus: 'pending',
            status: 'pending',
            expiresAt: new Date('2020-01-01T00:00:00.000Z'),
          },
        ],
      ],
    ]);
    const readConn = createReadConn(rowsByTable);
    const orderWhere = jest.fn().mockResolvedValue(null);
    const orderSet = jest.fn(() => ({ where: orderWhere }));
    const update = jest.fn(() => ({ set: orderSet }));
    const conn = { ...readConn, update };
    const service = new EnergyRentalService(conn as never);

    const result = await service.findAgentRechargeOrders(
      { pageIndex: 1, pageSize: 10, filters: {} },
      22,
    );

    expect(result.list).toEqual([
      expect.objectContaining({
        id: 101,
        status: 'expired',
        bitcartInvoiceStatus: 'expired',
      }),
    ]);
    expect(orderSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'expired',
        bitcartInvoiceStatus: 'expired',
      }),
    );
  });

  it('does not credit a Bitcart webhook after the local recharge order expiry time', async () => {
    const fetchMock = jest.spyOn(global, 'fetch' as never);
    const rowsByTable = new Map<unknown, unknown[]>([
      [
        energyPlatformConfigTable,
        [
          {
            id: 1,
            bitcartApiBaseUrl: 'https://bitcart.example/api',
            bitcartApiToken: 'bitcart-token',
            bitcartStoreId: 'store-trx',
            bitcartWebhookSecret: 'webhook-secret',
          },
        ],
      ],
      [
        agentRechargeOrdersTable,
        [
          {
            id: 102,
            agentId: 7,
            orderNo: 'AR20260430101010latepay',
            requestedAmountSun: '10000000',
            amountSun: '10000000',
            paymentGateway: 'bitcart',
            bitcartInvoiceId: 'bitcart-invoice-latepay',
            bitcartInvoiceStatus: 'pending',
            status: 'pending',
            expiresAt: new Date('2020-01-01T00:00:00.000Z'),
          },
        ],
      ],
    ]);
    const readConn = createReadConn(rowsByTable);
    const orderWhere = jest.fn().mockResolvedValue(null);
    const orderSet = jest.fn(() => ({ where: orderWhere }));
    const update = jest.fn(() => ({ set: orderSet }));
    const insert = jest.fn();
    const conn = { ...readConn, update, insert };
    const service = new EnergyRentalService(conn as never);

    await expect(
      (service as any).handleBitcartInvoiceWebhook(
        { id: 'bitcart-invoice-latepay', status: 'complete' },
        'webhook-secret',
      ),
    ).resolves.toEqual({ credited: false, status: 'expired' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(orderSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'expired',
        bitcartInvoiceStatus: 'expired',
      }),
    );
  });

  it('does not credit a duplicate Bitcart webhook for an already confirmed recharge order', async () => {
    const fetchMock = jest.spyOn(global, 'fetch' as never);
    const readConn = createReadConn(
      new Map<unknown, unknown[]>([
        [
          energyPlatformConfigTable,
          [
            {
              id: 1,
              bitcartApiBaseUrl: 'https://bitcart.example/api',
              bitcartApiToken: 'bitcart-token',
              bitcartStoreId: 'store-trx',
              bitcartWebhookSecret: 'webhook-secret',
            },
          ],
        ],
        [
          agentRechargeOrdersTable,
          [
            {
              id: 99,
              agentId: 7,
              orderNo: 'AR20260430101010abcdef',
              amountSun: '10000000',
              paymentGateway: 'bitcart',
              bitcartInvoiceId: 'bitcart-invoice-1',
              status: 'confirmed',
              paymentTxHash: 'tx-bitcart-1',
            },
          ],
        ],
      ]),
    );
    const update = jest.fn();
    const insert = jest.fn();
    const conn = { ...readConn, update, insert };
    const service = new EnergyRentalService(conn as never);

    await expect(
      (service as any).handleBitcartInvoiceWebhook(
        { id: 'bitcart-invoice-1', status: 'complete' },
        'webhook-secret',
      ),
    ).resolves.toEqual(expect.objectContaining({ credited: false }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it('rejects Bitcart webhook requests with an invalid secret before fetching invoice data', async () => {
    const fetchMock = jest.spyOn(global, 'fetch' as never);
    const conn = createReadConn(
      new Map<unknown, unknown[]>([
        [
          energyPlatformConfigTable,
          [{ id: 1, bitcartWebhookSecret: 'webhook-secret' }],
        ],
      ]),
    );
    const service = new EnergyRentalService(conn as never);

    await expect(
      (service as any).handleBitcartInvoiceWebhook(
        { id: 'bitcart-invoice-1', status: 'complete' },
        'wrong-secret',
      ),
    ).rejects.toThrow('Bitcart 回调校验失败');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects creating a fourth active Bitcart recharge order for the same user', async () => {
    const insert = jest.fn();
    const readConn = createReadConn(
      new Map<unknown, unknown[]>([
        [
          agentProfilesTable,
          [{ id: 7, userId: 22, agentName: '用户 A', status: 'active' }],
        ],
        [
          energyPlatformConfigTable,
          [
            {
              id: 1,
              bitcartApiBaseUrl: 'https://bitcart.example/api',
              bitcartAdminBaseUrl: 'https://pay.example',
              bitcartApiToken: 'bitcart-token',
              bitcartStoreId: 'store-trx',
              bitcartWebhookBaseUrl: 'https://maer.example/site/api',
              bitcartWebhookSecret: 'webhook-secret',
            },
          ],
        ],
        [
          agentRechargeOrdersTable,
          [
            {
              id: 1,
              agentId: 7,
              requestedAmountSun: '10000000',
              amountSun: '10000000',
              paymentGateway: 'bitcart',
              status: 'pending',
              expiresAt: new Date('2099-01-01T00:00:00.000Z'),
            },
            {
              id: 2,
              agentId: 7,
              requestedAmountSun: '20000000',
              amountSun: '20000000',
              paymentGateway: 'bitcart',
              status: 'pending',
              expiresAt: new Date('2099-01-01T00:00:00.000Z'),
            },
            {
              id: 3,
              agentId: 7,
              requestedAmountSun: '30000000',
              amountSun: '30000000',
              paymentGateway: 'bitcart',
              status: 'creating',
              expiresAt: new Date('2099-01-01T00:00:00.000Z'),
            },
          ],
        ],
      ]),
    );
    const execute = jest.fn().mockResolvedValue(null);
    const conn = {
      ...readConn,
      insert,
      transaction: jest.fn((callback) =>
        callback({ ...readConn, execute, insert }),
      ),
    };
    const service = new EnergyRentalService(conn as never);

    await expect(
      service.createAgentRechargeOrder(22, { amountTrx: 40 }),
    ).rejects.toThrow('最多同时创建 3 个待确认充值订单');
    expect(insert).not.toHaveBeenCalled();
  });

  it('rejects repeated active Bitcart recharge order with the same requested amount for the same user', async () => {
    const insert = jest.fn();
    const readConn = createReadConn(
      new Map<unknown, unknown[]>([
        [
          agentProfilesTable,
          [{ id: 7, userId: 22, agentName: '用户 A', status: 'active' }],
        ],
        [
          energyPlatformConfigTable,
          [
            {
              id: 1,
              bitcartApiBaseUrl: 'https://bitcart.example/api',
              bitcartAdminBaseUrl: 'https://pay.example',
              bitcartApiToken: 'bitcart-token',
              bitcartStoreId: 'store-trx',
              bitcartWebhookBaseUrl: 'https://maer.example/site/api',
              bitcartWebhookSecret: 'webhook-secret',
            },
          ],
        ],
        [
          agentRechargeOrdersTable,
          [
            {
              id: 1,
              agentId: 7,
              requestedAmountSun: '10000000',
              amountSun: '10000000',
              paymentGateway: 'bitcart',
              status: 'pending',
              expiresAt: new Date('2099-01-01T00:00:00.000Z'),
            },
          ],
        ],
      ]),
    );
    const execute = jest.fn().mockResolvedValue(null);
    const conn = {
      ...readConn,
      insert,
      transaction: jest.fn((callback) =>
        callback({ ...readConn, execute, insert }),
      ),
    };
    const service = new EnergyRentalService(conn as never);

    await expect(
      service.createAgentRechargeOrder(22, { amountTrx: 10 }),
    ).rejects.toThrow('已存在相同金额的待确认充值订单');
    expect(insert).not.toHaveBeenCalled();
  });
});
