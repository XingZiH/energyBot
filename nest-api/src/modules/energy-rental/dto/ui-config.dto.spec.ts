import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  UiConfigDto,
  MenuRowDto,
  MenuButtonDto,
  MessageTemplatesDto,
} from './ui-config.dto';

describe('UiConfigDto', () => {
  it('接受合法的嵌套菜单', async () => {
    const dto = plainToInstance(UiConfigDto, {
      welcomeText: '欢迎',
      menuConfig: [
        {
          id: 'r1',
          buttons: [
            {
              id: 'b1',
              text: '购买',
              action: 'submenu',
              submenu: [
                {
                  id: 'r2',
                  buttons: [
                    { id: 'b2', text: '套餐A', action: 'orders' },
                  ],
                },
              ],
            },
          ],
        },
      ],
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
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('拒绝未知 action', async () => {
    const dto = plainToInstance(MenuRowDto, {
      id: 'r1',
      buttons: [{ id: 'b1', text: 'x', action: 'invalid_action' }],
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('拒绝每行超过 4 个按钮', async () => {
    const buttons = Array.from({ length: 5 }, (_, i) => ({
      id: `b${i}`,
      text: `按钮${i}`,
      action: 'text',
      message: 'x',
    }));
    const dto = plainToInstance(MenuRowDto, { id: 'r', buttons });
    const errors = await validate(dto);
    expect(
      errors.some(
        (e) => e.property === 'buttons' && e.constraints?.arrayMaxSize,
      ),
    ).toBe(true);
  });

  it('拒绝按钮文本超过 64 字符', async () => {
    const dto = plainToInstance(MenuButtonDto, {
      id: 'b1',
      text: 'x'.repeat(65),
      action: 'orders',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'text')).toBe(true);
  });

  it('action=url 时 url 字段必填', async () => {
    const dto = plainToInstance(MenuButtonDto, {
      id: 'b1',
      text: '外链',
      action: 'url',
      // 故意不提供 url 字段
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'url')).toBe(true);
  });

  it('action=text 时 message 字段必填', async () => {
    const dto = plainToInstance(MenuButtonDto, {
      id: 'b1',
      text: '提示',
      action: 'text',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'message')).toBe(true);
  });

  it('action=energy_package_group 时 packageGroup 对象必填且校验字段', async () => {
    const dto = plainToInstance(MenuButtonDto, {
      id: 'b1',
      text: '套餐',
      action: 'energy_package_group',
      packageGroup: {
        packageIds: [1, 2, 3],
        sortBy: 'invalid_sort', // 非法
        textTemplate: '{name}',
      },
    });
    const errors = await validate(dto, { whitelist: true });
    expect(
      errors.some(
        (e) =>
          e.property === 'packageGroup' &&
          e.children?.some((c) => c.property === 'sortBy'),
      ),
    ).toBe(true);
  });

  // ========== 追加的边界测试 ==========

  it('接受 text 正好 64 字符的按钮', async () => {
    const dto = plainToInstance(MenuButtonDto, {
      id: 'b1',
      text: 'x'.repeat(64),
      action: 'orders',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('接受每行正好 4 个按钮', async () => {
    const buttons = Array.from({ length: 4 }, (_, i) => ({
      id: `b${i}`,
      text: `按钮${i}`,
      action: 'orders',
    }));
    const dto = plainToInstance(MenuRowDto, { id: 'r', buttons });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('action=submenu 时必须提供 submenu 数组', async () => {
    const dto = plainToInstance(MenuButtonDto, {
      id: 'b1',
      text: '下钻',
      action: 'submenu',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'submenu')).toBe(true);
  });

  it('action=energy_package_group 但完全不提供 packageGroup 被拒绝', async () => {
    const dto = plainToInstance(MenuButtonDto, {
      id: 'b1',
      text: '套餐',
      action: 'energy_package_group',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'packageGroup')).toBe(true);
  });

  it('action=url 时拒绝空字符串 url', async () => {
    const dto = plainToInstance(MenuButtonDto, {
      id: 'b1',
      text: '外链',
      action: 'url',
      url: '',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'url')).toBe(true);
  });

  it('action=url 时拒绝格式非法 url', async () => {
    const dto = plainToInstance(MenuButtonDto, {
      id: 'b1',
      text: '外链',
      action: 'url',
      url: 'not a url',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'url')).toBe(true);
  });

  it('action=command 时拒绝不符合 /xxx 格式的命令', async () => {
    const dto = plainToInstance(MenuButtonDto, {
      id: 'b1',
      text: '命令',
      action: 'command',
      command: 'start', // 缺 /
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'command')).toBe(true);
  });

  it('messageConfig 缺少 welcome 字段被拒绝', async () => {
    const dto = plainToInstance(MessageTemplatesDto, {
      orderCreated: 'a',
      payPending: 'a',
      paySuccess: 'a',
      payFailed: 'a',
      addressInvalid: 'a',
      unknownCommand: 'a',
      packageUnavailable: 'a',
      walletQueryResult: 'a',
      // 故意缺 welcome
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'welcome')).toBe(true);
  });
});
