export interface ProviderPriceRequest {
  energyAmount: number;
  durationHours: number;
  priceTrx: number;
}

const MIN_PACKAGE_ENERGY_AMOUNT = 1;
const MIN_CATFEE_ENERGY_AMOUNT = 65000;
const MIN_JUSTLEND_ENERGY_AMOUNT = 100000;

export function normalizeEnergyProvider(provider?: string | null): string {
  if (provider === 'justlend') {
    return 'justlend';
  }
  if (provider === 'catfee') {
    return 'catfee';
  }
  return provider || 'unknown';
}

export function providerMinEnergyAmount(provider?: string | null): number {
  const normalizedProvider = normalizeEnergyProvider(provider);
  if (normalizedProvider === 'justlend') {
    return MIN_JUSTLEND_ENERGY_AMOUNT;
  }
  if (normalizedProvider === 'catfee') {
    return MIN_CATFEE_ENERGY_AMOUNT;
  }
  return MIN_PACKAGE_ENERGY_AMOUNT;
}

export function providerLabel(provider?: string | null): string {
  const normalizedProvider = normalizeEnergyProvider(provider);
  if (normalizedProvider === 'justlend') {
    return 'JustLend';
  }
  if (normalizedProvider === 'catfee') {
    return 'CatFee';
  }
  return '当前服务商';
}

export function buildProviderPriceRequest(provider?: string | null): ProviderPriceRequest {
  return {
    energyAmount: providerMinEnergyAmount(provider),
    durationHours: 1,
    priceTrx: 0
  };
}
