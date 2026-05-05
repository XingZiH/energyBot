import { MyBotActionController } from './my-bot-action.controller';

/**
 * MyBotActionController 轻量测试：
 * - 不启 Nest App（避免拉起整模块），直接 new controller 注入 mock service
 * - 断言 userId 从 req.user.userId 取，licenseId 从 param 取，method 委派正确
 * - 错误路径由 service 层 throw → controller 直接冒泡给全局异常过滤器，不在此覆盖
 *
 * 权限装饰器（@Permission / @UseGuards）的生效由 Nest 运行时保证，属集成测试范围，
 * 此处只验控制流。
 */
describe('MyBotActionController', () => {
  function setup() {
    const actionSvc = {
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      reload: jest.fn().mockResolvedValue(undefined),
    };
    const ctrl = new MyBotActionController(actionSvc as any);
    return { ctrl, actionSvc };
  }

  const req = { user: { userId: 77 } };

  it('start → actionSvc.start(userId, licenseId)', async () => {
    const { ctrl, actionSvc } = setup();
    await ctrl.start(req, 42);
    expect(actionSvc.start).toHaveBeenCalledWith(77, 42);
  });

  it('stop → actionSvc.stop(userId, licenseId)', async () => {
    const { ctrl, actionSvc } = setup();
    await ctrl.stop(req, 42);
    expect(actionSvc.stop).toHaveBeenCalledWith(77, 42);
  });

  it('reload → actionSvc.reload(userId, licenseId)', async () => {
    const { ctrl, actionSvc } = setup();
    await ctrl.reload(req, 42);
    expect(actionSvc.reload).toHaveBeenCalledWith(77, 42);
  });

  it('req.user 缺失时 userId 兜底为 0（后续 service 会抛 NotFound）', async () => {
    const { ctrl, actionSvc } = setup();
    await ctrl.start({}, 42);
    expect(actionSvc.start).toHaveBeenCalledWith(0, 42);
  });
});
