import { AgentRechargeOrder } from '@services/energy-rental/energy-rental.service';

import { buildAgentRechargeQrValue, formatTrxAmount } from './agent-recharge-payment';

describe('agent recharge payment helpers', () => {
  it('formats SUN as an exact six-decimal TRX amount', () => {
    expect(formatTrxAmount('1000001')).toBe('1.000001');
    expect(formatTrxAmount(10_000_000)).toBe('10.000000');
    expect(formatTrxAmount(null)).toBe('0.000000');
  });

  it('uses the plain payment address as the QR value when a gateway URL exists', () => {
    const order = {
      bitcartPaymentUrl: 'tron:TGatewayAddress?amount=1.000001',
      amountSun: '1000001',
      paymentAddress: 'TFallbackAddress'
    } as AgentRechargeOrder;

    expect(buildAgentRechargeQrValue(order)).toBe('TFallbackAddress');
  });

  it('uses the plain payment address as the QR value without a protocol prefix', () => {
    const order = {
      amountSun: '1000001',
      paymentAddress: 'TFallbackAddress'
    } as AgentRechargeOrder;

    expect(buildAgentRechargeQrValue(order)).toBe('TFallbackAddress');
  });
});
