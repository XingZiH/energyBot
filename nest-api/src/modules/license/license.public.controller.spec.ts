import { LicensePublicController } from './license.public.controller';

describe('LicensePublicController', () => {
  let controller: LicensePublicController;
  let svc: { verifyPrecheck: jest.Mock };

  beforeEach(() => {
    svc = { verifyPrecheck: jest.fn() };
    controller = new LicensePublicController(svc as any);
  });

  function mockReq(overrides: Partial<{ method: string; originalUrl: string }> = {}) {
    return {
      method: overrides.method ?? 'POST',
      originalUrl: overrides.originalUrl ?? '/api/v1/license/precheck',
    } as any;
  }

  it('headers 中的字段传给 service', async () => {
    svc.verifyPrecheck.mockResolvedValue({ customerName: 'A', serverTime: 123 });
    const res = await controller.precheck(
      'ebt_xxx',
      '1700000000000',
      'abcd1234'.repeat(4),
      'e'.repeat(64),
      mockReq(),
      {} as any,
    );
    expect(svc.verifyPrecheck).toHaveBeenCalledWith(
      expect.objectContaining({
        licenseKey: 'ebt_xxx',
        timestamp: '1700000000000',
        nonce: 'abcd1234'.repeat(4),
        signature: 'e'.repeat(64),
        method: 'POST',
        path: '/api/v1/license/precheck',
        body: '',
      }),
    );
    expect(res.code).toBe(200);
    expect(res.data.customerName).toBe('A');
  });

  it('自动 trim 输入 header', async () => {
    svc.verifyPrecheck.mockResolvedValue({ customerName: 'A', serverTime: 1 });
    await controller.precheck(
      '  ebt_xxx  ',
      ' 123 ',
      ' abc ',
      ' sig ',
      mockReq(),
      {} as any,
    );
    expect(svc.verifyPrecheck).toHaveBeenCalledWith(
      expect.objectContaining({
        licenseKey: 'ebt_xxx',
        timestamp: '123',
        nonce: 'abc',
        signature: 'sig',
      }),
    );
  });

  it('空 header 转为空串传给 service（由 service 统一处理格式错误）', async () => {
    svc.verifyPrecheck.mockResolvedValue({ customerName: 'A', serverTime: 1 });
    await controller.precheck(
      undefined as any,
      undefined as any,
      undefined as any,
      undefined as any,
      mockReq(),
      {} as any,
    );
    expect(svc.verifyPrecheck).toHaveBeenCalledWith(
      expect.objectContaining({
        licenseKey: '',
        timestamp: '',
        nonce: '',
        signature: '',
      }),
    );
  });

  it('取 originalUrl 中的 path 部分（忽略 query）', async () => {
    svc.verifyPrecheck.mockResolvedValue({ customerName: 'A', serverTime: 1 });
    await controller.precheck(
      'ebt_xxx',
      '1',
      'n',
      's',
      mockReq({ originalUrl: '/api/v1/license/precheck?debug=1' }),
      {} as any,
    );
    expect(svc.verifyPrecheck).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/api/v1/license/precheck' }),
    );
  });

  it('service 抛异常时直接冒泡（由 nest 统一错误过滤器处理）', async () => {
    svc.verifyPrecheck.mockRejectedValue(new Error('boom'));
    await expect(
      controller.precheck('ebt_x', '1', 'n', 's', mockReq(), {} as any),
    ).rejects.toThrow('boom');
  });
});
