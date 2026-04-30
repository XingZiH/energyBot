import { buildProviderPriceRequest } from './provider-price-summary';

describe('provider price summary', () => {
  it('uses CatFee minimum energy for a one-hour provider cost quote', () => {
    expect(buildProviderPriceRequest('catfee')).toEqual({
      energyAmount: 65000,
      durationHours: 1,
      priceTrx: 0
    });
  });

  it('uses JustLend minimum energy for a one-hour provider cost quote', () => {
    expect(buildProviderPriceRequest('justlend')).toEqual({
      energyAmount: 100000,
      durationHours: 1,
      priceTrx: 0
    });
  });

  it('falls back to a generic minimum for unknown future providers', () => {
    expect(buildProviderPriceRequest('future-provider')).toEqual({
      energyAmount: 1,
      durationHours: 1,
      priceTrx: 0
    });
  });
});
