/**
 * 从 TRON 私钥派生钱包地址。
 *
 * 与 energy-rental.service.ts 里 private 方法 `deriveTronAddressFromPrivateKey`
 * 职责等同——独立提取以便 agent 模块在构造 applyConfig payload 时复用，
 * 不耦合庞大的 EnergyRentalService（3700 行）。
 *
 * 设计决策：
 * - 动态 import('tronweb') —— nest 启动慢，静态 import 会拉长 cold start；
 *   agent 模块不是每次请求都走这条路径（仅 bot.start 前调一次）
 * - 私钥校验复用同样的 64 位 hex 约束——不要在这里重写，免得两处发散
 * - 不 throw NestJS HttpException——这是 util 不是 service；调用方负责包装
 *   成 BadRequest / InternalServerError
 */

/**
 * normalizeTronPrivateKey 把用户输入的私钥规范化为 64 位 hex（无 0x 前缀）。
 *
 * 拒绝条件：非 64 位 hex / 助记词 / 地址 / API key。
 * 返回规范化后的字符串（调用 tronWeb 时用它）。
 */
export function normalizeTronPrivateKey(value: unknown): string {
  const raw = typeof value === 'string' ? value : '';
  const key = raw.replace(/\s+/g, '');
  const normalized = key.replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error('tron private key format invalid');
  }
  return normalized;
}

/**
 * deriveTronAddress 私钥 → base58 地址。
 *
 * 失败统一抛 Error，调用方按场景包 NestJS 异常。
 */
export async function deriveTronAddress(params: {
  privateKey: string;
  tronApiBaseUrl: string;
  tronApiKey?: string;
}): Promise<string> {
  const normalizedPrivateKey = normalizeTronPrivateKey(params.privateKey);

  // 动态 import 避免 cold start 成本；tronweb 自身没有完整类型，所以下面
  // 的 tronWeb 实例只能按 any 操作（用 disable 块限定范围）
  /* eslint-disable @typescript-eslint/no-unsafe-assignment,
                    @typescript-eslint/no-unsafe-call,
                    @typescript-eslint/no-unsafe-member-access */
  const tronWebModule = (await import('tronweb')) as Record<string, unknown>;
  const TronWebCtor =
    tronWebModule.TronWeb ?? tronWebModule.default ?? tronWebModule;

  if (typeof TronWebCtor !== 'function') {
    throw new Error('tronweb module does not export a constructor');
  }

  // eslint 在本项目配置里 no-explicit-any 是 off/warn，这里 `: any` 合法
  const tronWeb: any = new (TronWebCtor as new (cfg: unknown) => unknown)({
    fullHost: params.tronApiBaseUrl.replace(/\/+$/, ''),
    headers: params.tronApiKey
      ? { 'TRON-PRO-API-KEY': params.tronApiKey.trim() }
      : undefined,
    privateKey: normalizedPrivateKey,
  });

  const address = tronWeb.address.fromPrivateKey(normalizedPrivateKey);
  if (typeof address !== 'string' || !tronWeb.isAddress(address)) {
    throw new Error('tron derived address invalid');
  }
  return address;
  /* eslint-enable @typescript-eslint/no-unsafe-assignment,
                   @typescript-eslint/no-unsafe-call,
                   @typescript-eslint/no-unsafe-member-access */
}
