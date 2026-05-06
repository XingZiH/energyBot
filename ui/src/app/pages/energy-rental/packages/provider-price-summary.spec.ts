import { buildProviderPriceRequest } from './provider-price-summary';

describe('provider price summary', () => {
  it('uses CatFee minimum energy for a one-hour provider cost quote', () => {
    expect(buildProviderPriceRequest('catfee')).toEqual({
      energyAmount: 65000,
      durationHours: 1,
      priceTrx: 0
    });
  });

  it('falls back to CatFee minimum for unknown future providers', () => {
    expect(buildProviderPriceRequest('future-provider')).toEqual({
      energyAmount: 65000,
      durationHours: 1,
      priceTrx: 0
    });
  });
});
