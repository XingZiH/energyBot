/**
 * UiConfigController 单测：覆盖权限/并发/校验链路。
 *
 * 策略：纯单元测试，mock 掉 UiConfigService 和 EnergyRentalService，
 * 不起 NestJS TestingModule，因为 Guard 装饰器在直接实例化时不会触发。
 * Guard 和 Permission 装饰器的功能由框架层保证，这里只验证 controller
 * 自己的编排逻辑（agentId 解析 → validate → dryRun/并发判断 → save）。
 */
import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { UiConfigController } from './ui-config.controller';

describe('UiConfigController', () => {
  const mockUiConfigService = {
    loadUiConfig: jest.fn(),
    saveUiConfig: jest.fn(),
    validate: jest.fn(),
    checkConcurrency: jest.fn(),
  };
  const mockEnergyRentalService = {
    resolveAgentId: jest.fn(),
  };
  let controller: UiConfigController;

  beforeEach(() => {
    jest.resetAllMocks();
    controller = new UiConfigController(
      mockUiConfigService as any,
      mockEnergyRentalService as any,
    );
  });

  const validDto = {
    welcomeText: '欢迎',
    menuConfig: [],
    messageConfig: {
      welcome: 'hi',
      orderCreated: '',
      payPending: '',
      paySuccess: '',
      payFailed: '',
      addressInvalid: '',
      unknownCommand: '',
      packageUnavailable: '',
      walletQueryResult: '',
    },
  };

  describe('GET /ui-config', () => {
    it('返回 agent 的 UI 配置', async () => {
      mockEnergyRentalService.resolveAgentId.mockResolvedValue(100);
      mockUiConfigService.loadUiConfig.mockResolvedValue({
        welcomeText: '欢迎',
        menuConfig: [],
        messageConfig: {},
        updatedAt: '2026-01-01T00:00:00.000Z',
      });

      const res = await controller.getUiConfig({ user: { userId: 1 } });

      expect(mockEnergyRentalService.resolveAgentId).toHaveBeenCalledWith(1);
      expect(mockUiConfigService.loadUiConfig).toHaveBeenCalledWith(100);
      expect(res.code).toBe(200);
      expect(res.data.welcomeText).toBe('欢迎');
      expect(res.data.updatedAt).toBe('2026-01-01T00:00:00.000Z');
    });

    it('userId 无对应 agent 时 resolveAgentId 抛 BadRequestException', async () => {
      mockEnergyRentalService.resolveAgentId.mockRejectedValue(
        new BadRequestException('当前账号没有用户账户'),
      );
      await expect(
        controller.getUiConfig({ user: { userId: 9999 } }),
      ).rejects.toThrow(BadRequestException);
      expect(mockUiConfigService.loadUiConfig).not.toHaveBeenCalled();
    });
  });

  describe('PUT /ui-config', () => {
    it('dryRun=true 时跑 validate 但不调用 saveUiConfig', async () => {
      mockEnergyRentalService.resolveAgentId.mockResolvedValue(100);
      mockUiConfigService.validate.mockResolvedValue(undefined);

      const res = await controller.updateUiConfig(
        { user: { userId: 1 } },
        validDto as any,
        'true',
        undefined,
      );

      expect(mockUiConfigService.validate).toHaveBeenCalledWith(validDto, 100);
      expect(mockUiConfigService.checkConcurrency).not.toHaveBeenCalled();
      expect(mockUiConfigService.saveUiConfig).not.toHaveBeenCalled();
      expect(res.code).toBe(200);
      expect(res.data.valid).toBe(true);
    });

    it('validate 失败时抛出异常，不会继续保存', async () => {
      mockEnergyRentalService.resolveAgentId.mockResolvedValue(100);
      mockUiConfigService.validate.mockRejectedValue(
        new BadRequestException('菜单嵌套深度不能超过 3 层'),
      );

      await expect(
        controller.updateUiConfig(
          { user: { userId: 1 } },
          validDto as any,
          'false',
          undefined,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(mockUiConfigService.checkConcurrency).not.toHaveBeenCalled();
      expect(mockUiConfigService.saveUiConfig).not.toHaveBeenCalled();
    });

    it('If-Unmodified-Since 不匹配时返回 409 Conflict', async () => {
      mockEnergyRentalService.resolveAgentId.mockResolvedValue(100);
      mockUiConfigService.validate.mockResolvedValue(undefined);
      mockUiConfigService.checkConcurrency.mockResolvedValue(false);

      let thrown: any = null;
      try {
        await controller.updateUiConfig(
          { user: { userId: 1 } },
          validDto as any,
          'false',
          '2026-01-01T00:00:00.000Z',
        );
      } catch (e) {
        thrown = e;
      }

      expect(thrown).toBeInstanceOf(HttpException);
      expect(thrown.getStatus()).toBe(HttpStatus.CONFLICT);
      expect(mockUiConfigService.saveUiConfig).not.toHaveBeenCalled();
    });

    it('If-Unmodified-Since 匹配时正常保存并返回新 updatedAt', async () => {
      mockEnergyRentalService.resolveAgentId.mockResolvedValue(100);
      mockUiConfigService.validate.mockResolvedValue(undefined);
      mockUiConfigService.checkConcurrency.mockResolvedValue(true);
      mockUiConfigService.saveUiConfig.mockResolvedValue({
        updatedAt: '2026-05-02T00:00:00.000Z',
      });

      const res = await controller.updateUiConfig(
        { user: { userId: 1 } },
        validDto as any,
        'false',
        '2026-01-01T00:00:00.000Z',
      );

      expect(mockUiConfigService.checkConcurrency).toHaveBeenCalledWith(
        100,
        '2026-01-01T00:00:00.000Z',
      );
      expect(mockUiConfigService.saveUiConfig).toHaveBeenCalledWith(
        100,
        validDto,
      );
      expect(res.code).toBe(200);
      expect(res.data.updatedAt).toBe('2026-05-02T00:00:00.000Z');
    });

    it('无 If-Unmodified-Since header 也能保存（新建场景）', async () => {
      mockEnergyRentalService.resolveAgentId.mockResolvedValue(100);
      mockUiConfigService.validate.mockResolvedValue(undefined);
      mockUiConfigService.checkConcurrency.mockResolvedValue(true);
      mockUiConfigService.saveUiConfig.mockResolvedValue({
        updatedAt: '2026-05-02T00:00:00.000Z',
      });

      await controller.updateUiConfig(
        { user: { userId: 1 } },
        validDto as any,
        'false',
        undefined,
      );

      expect(mockUiConfigService.checkConcurrency).toHaveBeenCalledWith(
        100,
        undefined,
      );
      expect(mockUiConfigService.saveUiConfig).toHaveBeenCalled();
    });

    it('agentId 始终从 JWT userId 解析，不读取任何客户端传参', async () => {
      mockEnergyRentalService.resolveAgentId.mockResolvedValue(100);
      mockUiConfigService.validate.mockResolvedValue(undefined);
      mockUiConfigService.checkConcurrency.mockResolvedValue(true);
      mockUiConfigService.saveUiConfig.mockResolvedValue({
        updatedAt: 'x',
      });

      await controller.updateUiConfig(
        { user: { userId: 42 } },
        validDto as any,
        'false',
        undefined,
      );

      expect(mockEnergyRentalService.resolveAgentId).toHaveBeenCalledWith(42);
      // 关键：validate 与 saveUiConfig 都用 resolveAgentId 返回的 100，
      // 而不是 dto 里可能掺入的任何 agentId
      expect(mockUiConfigService.validate).toHaveBeenCalledWith(validDto, 100);
      expect(mockUiConfigService.saveUiConfig).toHaveBeenCalledWith(
        100,
        validDto,
      );
    });

    it('PUT: userId 无对应 agent 时抛 BadRequestException', async () => {
      mockEnergyRentalService.resolveAgentId.mockRejectedValue(
        new BadRequestException('当前账号没有用户账户'),
      );
      await expect(
        controller.updateUiConfig(
          { user: { userId: 9999 } },
          validDto as any,
          'false',
          undefined,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockUiConfigService.validate).not.toHaveBeenCalled();
      expect(mockUiConfigService.saveUiConfig).not.toHaveBeenCalled();
    });
  });
});
