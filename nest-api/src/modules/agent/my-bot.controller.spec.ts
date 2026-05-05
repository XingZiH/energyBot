import { NotFoundException } from '@nestjs/common';
import { MyBotController } from './my-bot.controller';

/**
 * MyBotController 单元测试。
 *
 * 风格仿 customer.controller.spec.ts：手工 new + 伪造 req。
 */
describe('MyBotController', () => {
  let ctrl: MyBotController;
  let svc: { findByUserId: jest.Mock };

  beforeEach(() => {
    svc = { findByUserId: jest.fn() };
    ctrl = new MyBotController(svc as any);
  });

  it('普通调用：userId 透传，返回 ResultData.success(views)', async () => {
    const view1 = { id: 1 } as any;
    const view2 = { id: 2 } as any;
    svc.findByUserId.mockResolvedValueOnce([view1, view2]);

    const res = await ctrl.findMine({ user: { userId: 7 } } as any);

    expect(svc.findByUserId).toHaveBeenCalledWith(7);
    expect(res.code).toBe(200);
    expect(res.msg).toBe('SUCCESS');
    expect(res.data).toEqual([view1, view2]);
  });

  it('req.user 缺失时 userId 兜底 0', async () => {
    svc.findByUserId.mockResolvedValueOnce([]);

    await ctrl.findMine({} as any);

    expect(svc.findByUserId).toHaveBeenCalledWith(0);
  });

  it('service 抛 NotFoundException 时 controller 不 catch，向上抛', async () => {
    svc.findByUserId.mockRejectedValueOnce(
      new NotFoundException('当前账号未绑定客户'),
    );

    await expect(ctrl.findMine({ user: { userId: 1 } } as any)).rejects.toThrow(
      NotFoundException,
    );
  });
});
