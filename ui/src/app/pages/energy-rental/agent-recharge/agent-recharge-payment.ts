import { AgentRechargeOrder } from '@services/energy-rental/energy-rental.service';

export function formatTrxAmount(value: string | number | null | undefined): string {
  const sun = Number(value || 0);
  return `${(Number.isFinite(sun) ? sun / 1_000_000 : 0).toFixed(6)}`;
}

export function buildAgentRechargeQrValue(order: AgentRechargeOrder): string {
  return String(order.paymentAddress || '').trim();
}
