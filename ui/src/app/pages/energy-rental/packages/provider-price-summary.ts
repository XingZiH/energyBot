// T12：catfee 是唯一 provider；函数签名保留以最小化改动调用点，
// 但所有输入统一返回 catfee 对应值。未来若需要支持更多 provider，扩展这些函数即可。
export interface ProviderPriceRequest {
  energyAmount: number;
  durationHours: number;
  priceTrx: number;
}

const MIN_CATFEE_ENERGY_AMOUNT = 65000;

export function normalizeEnergyProvider(_provider?: string | null): string {
  return 'catfee';
}

export function providerMinEnergyAmount(_provider?: string | null): number {
  return MIN_CATFEE_ENERGY_AMOUNT;
}

export function providerLabel(_provider?: string | null): string {
  return 'CatFee';
}

export function buildProviderPriceRequest(provider?: string | null): ProviderPriceRequest {
  return {
    energyAmount: providerMinEnergyAmount(provider),
    durationHours: 1,
    priceTrx: 0
  };
}
