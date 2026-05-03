import { CustomerController } from './customer.controller';

describe('CustomerController', () => {
  let ctrl: CustomerController;
  let svc: {
    create: jest.Mock;
    list: jest.Mock;
    findById: jest.Mock;
    update: jest.Mock;
    revokeLicense: jest.Mock;
    reissueLicense: jest.Mock;
    getInstallCommand: jest.Mock;
  };

  beforeEach(() => {
    svc = {
      create: jest.fn(),
      list: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      revokeLicense: jest.fn(),
      reissueLicense: jest.fn(),
      getInstallCommand: jest.fn(),
    };
    ctrl = new CustomerController(svc as any);
  });

  it('create 传递 userId 到 service', async () => {
    svc.create.mockResolvedValue({ customerId: 1, licenseKey: 'ebt_X' });
    const res = await ctrl.create(
      { name: 'X' } as any,
      { user: { userId: 7 } },
    );
    expect(svc.create).toHaveBeenCalledWith({ name: 'X' }, 7);
    expect(res.code).toBe(200);
    expect(res.data.customerId).toBe(1);
  });

  it('create 无登录用户时 createdBy=0（兜底）', async () => {
    svc.create.mockResolvedValue({ customerId: 1 });
    await ctrl.create({ name: 'X' } as any, {} as any);
    expect(svc.create).toHaveBeenCalledWith({ name: 'X' }, 0);
  });

  it('list 透传参数', async () => {
    svc.list.mockResolvedValue({ total: 0, list: [] });
    await ctrl.list({ pageIndex: 2, pageSize: 20 } as any);
    expect(svc.list).toHaveBeenCalledWith({ pageIndex: 2, pageSize: 20 });
  });

  it('findOne 调用 service', async () => {
    svc.findById.mockResolvedValue({ id: 1 });
    const res = await ctrl.findOne(1);
    expect(svc.findById).toHaveBeenCalledWith(1);
    expect(res.data.id).toBe(1);
  });

  it('update 成功返回 null data', async () => {
    svc.update.mockResolvedValue(null);
    const res = await ctrl.update({ id: 1, name: '新' } as any);
    expect(svc.update).toHaveBeenCalledWith({ id: 1, name: '新' });
    expect(res.data).toBeNull();
  });

  it('revokeLicense 传递 reason', async () => {
    svc.revokeLicense.mockResolvedValue({ revokedCount: 1 });
    await ctrl.revokeLicense({ customerId: 5, reason: 'test' } as any);
    expect(svc.revokeLicense).toHaveBeenCalledWith(5, 'test');
  });

  it('reissueLicense 传递 userId 和 reason', async () => {
    svc.reissueLicense.mockResolvedValue({ licenseKey: 'ebt_N' });
    await ctrl.reissueLicense(
      { customerId: 5, reason: 'test' } as any,
      { user: { userId: 9 } },
    );
    expect(svc.reissueLicense).toHaveBeenCalledWith(5, 9, 'test');
  });

  it('getInstallCommand 返回命令字符串', async () => {
    svc.getInstallCommand.mockResolvedValue('curl -fsSL ...');
    const res = await ctrl.getInstallCommand(5);
    expect(svc.getInstallCommand).toHaveBeenCalledWith(5);
    expect(res.data.installCommand).toBe('curl -fsSL ...');
  });
});
