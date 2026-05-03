import { TestBed } from '@angular/core/testing';

import { ButtonAction, MAX_MENU_DEPTH, MenuRow } from '../types';
import { MenuTreeService } from './menu-tree.service';

describe('MenuTreeService', () => {
  let service: MenuTreeService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [MenuTreeService] });
    service = TestBed.inject(MenuTreeService);
  });

  // ---------- 初始状态 ----------
  it('初始状态为空数组', () => {
    expect(service.$rootMenu()).toEqual([]);
  });

  it('初始 breadcrumb 仅包含根菜单', () => {
    const crumbs = service.$breadcrumb();
    expect(crumbs.length).toBe(1);
    expect(crumbs[0].buttonId).toBeNull();
    expect(crumbs[0].label).toBe('根菜单');
  });

  it('$currentMenu 初始等于 $rootMenu', () => {
    expect(service.$currentMenu()).toEqual([]);
  });

  // ---------- 增删改 ----------
  it('addRow 追加一行', () => {
    service.addRow();
    expect(service.$rootMenu()).toHaveSize(1);
    expect(service.$rootMenu()[0].buttons).toEqual([]);
  });

  it('addButton 到指定行', () => {
    service.addRow();
    service.addButton(0, {
      id: 'b1',
      text: '测试',
      action: ButtonAction.TEXT,
      message: 'x',
    });
    expect(service.$rootMenu()[0].buttons).toHaveSize(1);
    expect(service.$rootMenu()[0].buttons[0].id).toBe('b1');
  });

  it('updateButton 合并 patch 字段', () => {
    service.addRow();
    service.addButton(0, {
      id: 'b1',
      text: '旧',
      action: ButtonAction.TEXT,
      message: 'old',
    });
    service.updateButton('b1', { text: '新', message: 'new' });
    const btn = service.$rootMenu()[0].buttons[0];
    expect(btn.text).toBe('新');
    expect(btn.message).toBe('new');
    expect(btn.action).toBe(ButtonAction.TEXT); // 未 patch 的字段保留
  });

  it('removeButton 删除按钮并过滤掉空行', () => {
    service.addRow();
    service.addButton(0, { id: 'b1', text: 'a', action: ButtonAction.TEXT, message: 'x' });
    service.addRow();
    service.addButton(1, { id: 'b2', text: 'b', action: ButtonAction.TEXT, message: 'y' });
    expect(service.$rootMenu()).toHaveSize(2);

    service.removeButton('b1');

    // 第一行被清空，应被过滤
    expect(service.$rootMenu()).toHaveSize(1);
    expect(service.$rootMenu()[0].buttons[0].id).toBe('b2');
  });

  // ---------- undo/redo ----------
  it('undo 回滚最近一次写操作', () => {
    service.addRow();
    service.addRow();
    expect(service.$rootMenu()).toHaveSize(2);
    service.undo();
    expect(service.$rootMenu()).toHaveSize(1);
  });

  it('redo 恢复撤销的操作', () => {
    service.addRow();
    service.undo();
    expect(service.$rootMenu()).toHaveSize(0);
    service.redo();
    expect(service.$rootMenu()).toHaveSize(1);
  });

  it('history 为空时 undo 不报错', () => {
    expect(() => service.undo()).not.toThrow();
    expect(service.$rootMenu()).toEqual([]);
  });

  it('future 为空时 redo 不报错', () => {
    expect(() => service.redo()).not.toThrow();
    expect(service.$rootMenu()).toEqual([]);
  });

  it('新写操作会清空 future（分支切断）', () => {
    service.addRow();
    service.addRow();
    service.undo();
    // 此时 future 有 1 项
    service.addRow(); // 新分支
    // redo 不应恢复到被切断的分支
    service.redo();
    // 新分支后再 redo 无效果，长度保持 2（1 原始 + 1 新）
    expect(service.$rootMenu()).toHaveSize(2);
  });

  // ---------- breadcrumb / enterSubmenu / navigateTo ----------
  it('enterSubmenu 切换 $currentMenu 和 breadcrumb', () => {
    service.addRow();
    service.addButton(0, {
      id: 'b1',
      text: '展开',
      action: ButtonAction.SUBMENU,
      submenu: [{ id: 'sub1', buttons: [] }],
    });
    service.enterSubmenu('b1');

    expect(service.$breadcrumb().length).toBe(2);
    expect(service.$breadcrumb()[1].buttonId).toBe('b1');
    expect(service.$currentMenu()).toEqual([{ id: 'sub1', buttons: [] }]);
  });

  it('enterSubmenu 对非 SUBMENU 按钮静默忽略', () => {
    service.addRow();
    service.addButton(0, {
      id: 'b1',
      text: '文本',
      action: ButtonAction.TEXT,
      message: 'x',
    });
    service.enterSubmenu('b1');
    expect(service.$breadcrumb().length).toBe(1);
  });

  it('navigateTo(0) 回到根菜单', () => {
    service.addRow();
    service.addButton(0, {
      id: 'b1',
      text: '展开',
      action: ButtonAction.SUBMENU,
      submenu: [{ id: 'sub1', buttons: [] }],
    });
    service.enterSubmenu('b1');
    expect(service.$breadcrumb().length).toBe(2);

    service.navigateTo(0);
    expect(service.$breadcrumb().length).toBe(1);
    expect(service.$currentMenu()).toEqual(service.$rootMenu());
  });

  // ---------- 深层写操作 ----------
  it('进入 submenu 后 addRow 写入子菜单而非根', () => {
    service.addRow();
    service.addButton(0, {
      id: 'b1',
      text: '展开',
      action: ButtonAction.SUBMENU,
      submenu: [{ id: 'sub1', buttons: [] }],
    });
    service.enterSubmenu('b1');
    service.addRow();

    // 子菜单多了一行
    expect(service.$currentMenu()).toHaveSize(2);
    // 根层仍然只有一行（承载 SUBMENU 按钮）
    expect(service.$rootMenu()).toHaveSize(1);
  });

  // ---------- setRootMenu ----------
  it('setRootMenu 覆盖菜单并清空 history/future', () => {
    service.addRow();
    service.addRow();
    service.undo(); // future 有内容
    const newMenu: MenuRow[] = [{ id: 'r-new', buttons: [] }];
    service.setRootMenu(newMenu);

    expect(service.$rootMenu()).toEqual(newMenu);
    expect(service.$breadcrumb().length).toBe(1);
    // history/future 被清空：再 undo/redo 都不应改变状态
    service.undo();
    expect(service.$rootMenu()).toEqual(newMenu);
    service.redo();
    expect(service.$rootMenu()).toEqual(newMenu);
  });

  // ---------- 深度校验 ----------
  it('validateDepth 允许 3 层嵌套', () => {
    // 根 -> btn(SUBMENU) -> row -> btn(SUBMENU) -> row -> btn(SUBMENU) -> row
    // 深度 = 3（传入 depth=1，两次递归后 depth=3 刚好不抛）
    const depth3: MenuRow[] = [
      {
        id: 'r1',
        buttons: [
          {
            id: 'b1',
            text: '',
            action: ButtonAction.SUBMENU,
            submenu: [
              {
                id: 'r2',
                buttons: [
                  {
                    id: 'b2',
                    text: '',
                    action: ButtonAction.SUBMENU,
                    submenu: [{ id: 'r3', buttons: [] }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ];
    expect(() => service.validateDepth(depth3)).not.toThrow();
    expect(MAX_MENU_DEPTH).toBe(3);
  });

  // ---------- welcomeText ----------
  it('$welcomeText 初始为空字符串', () => {
    expect(service.$welcomeText()).toBe('');
  });

  it('setWelcomeText 直接写入、不进历史栈', () => {
    service.setWelcomeText('你好');
    expect(service.$welcomeText()).toBe('你好');
    // 不应 push 到 history：此刻 undo 不能把它还原
    service.undo();
    expect(service.$welcomeText()).toBe('你好');
  });

  it('setRootMenu 不清空 welcomeText（独立字段）', () => {
    service.setWelcomeText('问候');
    service.setRootMenu([{ id: 'r', buttons: [] }]);
    expect(service.$welcomeText()).toBe('问候');
  });

  it('setWelcomeTextWithHistory 进历史栈、可 undo', () => {
    service.setWelcomeText('初始');
    service.setWelcomeTextWithHistory('修改后');
    expect(service.$welcomeText()).toBe('修改后');
    service.undo();
    expect(service.$welcomeText()).toBe('初始');
    service.redo();
    expect(service.$welcomeText()).toBe('修改后');
  });

  // ---------- 拖拽：moveButton / reorderButtonInRow / moveButtonToNewRow ----------
  function seed3Rows(): void {
    service.addRow();
    service.addButton(0, { id: 'a1', text: 'A1', action: ButtonAction.TEXT, message: 'x' });
    service.addButton(0, { id: 'a2', text: 'A2', action: ButtonAction.TEXT, message: 'x' });
    service.addRow();
    service.addButton(1, { id: 'b1', text: 'B1', action: ButtonAction.TEXT, message: 'x' });
  }

  it('reorderButtonInRow 行内交换位置', () => {
    seed3Rows();
    service.reorderButtonInRow(0, 0, 1);
    expect(service.$rootMenu()[0].buttons.map((b) => b.id)).toEqual(['a2', 'a1']);
  });

  it('reorderButtonInRow fromIdx === toIdx 是 no-op', () => {
    seed3Rows();
    const before = JSON.stringify(service.$rootMenu());
    service.reorderButtonInRow(0, 1, 1);
    expect(JSON.stringify(service.$rootMenu())).toBe(before);
  });

  it('moveButton 跨行移动', () => {
    seed3Rows();
    // 把 a1 移到 row 1 的开头
    service.moveButton(0, 0, 1, 0);
    expect(service.$rootMenu()[0].buttons.map((b) => b.id)).toEqual(['a2']);
    expect(service.$rootMenu()[1].buttons.map((b) => b.id)).toEqual(['a1', 'b1']);
  });

  it('moveButton 目标行超过上限 4 时拒绝（返回 false）', () => {
    service.addRow();
    for (let i = 0; i < 4; i++) {
      service.addButton(0, {
        id: `x${i}`,
        text: `X${i}`,
        action: ButtonAction.TEXT,
        message: 'x',
      });
    }
    service.addRow();
    service.addButton(1, { id: 'y', text: 'Y', action: ButtonAction.TEXT, message: 'x' });

    const ok = service.moveButton(1, 0, 0, 0);
    expect(ok).toBe(false);
    // row 0 仍然 4 个，row 1 仍然 1 个
    expect(service.$rootMenu()[0].buttons).toHaveSize(4);
    expect(service.$rootMenu()[1].buttons).toHaveSize(1);
  });

  it('moveButton 源行被清空时自动删除行', () => {
    service.addRow();
    service.addButton(0, { id: 'only', text: 'O', action: ButtonAction.TEXT, message: 'x' });
    service.addRow();
    service.addButton(1, { id: 'other', text: 'B', action: ButtonAction.TEXT, message: 'x' });

    service.moveButton(0, 0, 1, 0);

    // row 0 被清空后应自动移除
    expect(service.$rootMenu()).toHaveSize(1);
    expect(service.$rootMenu()[0].buttons.map((b) => b.id)).toEqual(['only', 'other']);
  });

  it('moveButtonToNewRow 末尾新建一行、源行空则删除', () => {
    seed3Rows();
    // 把 b1 拆到新行
    service.moveButtonToNewRow(1, 0);
    // 原 row 1 空了被删，新行追加到末尾
    expect(service.$rootMenu()).toHaveSize(2);
    expect(service.$rootMenu()[0].buttons.map((b) => b.id)).toEqual(['a1', 'a2']);
    expect(service.$rootMenu()[1].buttons.map((b) => b.id)).toEqual(['b1']);
  });

  it('moveButtonToNewRow 已达最大行数时：源行只剩一个按钮可放行（总数不变）', () => {
    for (let r = 0; r < 8; r++) {
      service.addRow();
      service.addButton(r, {
        id: `r${r}`,
        text: `R${r}`,
        action: ButtonAction.TEXT,
        message: 'x',
      });
    }
    // 源行只有 1 个按钮，拆出后源行被删、末尾新建——总数维持 8
    const ok = service.moveButtonToNewRow(0, 0);
    expect(ok).toBe(true);
    expect(service.$rootMenu()).toHaveSize(8);
    // 原 r0 被挪到末尾
    expect(service.$rootMenu()[7].buttons.map((b) => b.id)).toEqual(['r0']);
  });

  it('moveButtonToNewRow 已达最大行数且源行非单按钮时返回 false', () => {
    for (let r = 0; r < 8; r++) {
      service.addRow();
      service.addButton(r, {
        id: `r${r}a`,
        text: `R${r}a`,
        action: ButtonAction.TEXT,
        message: 'x',
      });
    }
    // 给第 0 行补一个按钮：拆出一个后源行还剩 1 个，真的要新开一行 → 9 超限
    service.addButton(0, { id: 'extra', text: 'E', action: ButtonAction.TEXT, message: 'x' });
    expect(service.$rootMenu()[0].buttons).toHaveSize(2);

    const ok = service.moveButtonToNewRow(0, 0);
    expect(ok).toBe(false);
    expect(service.$rootMenu()).toHaveSize(8);
    expect(service.$rootMenu()[0].buttons).toHaveSize(2);
  });

  it('拖拽操作每次都进历史栈，可 undo', () => {
    seed3Rows();
    const before = JSON.stringify(service.$rootMenu());
    service.moveButton(0, 0, 1, 0);
    service.undo();
    expect(JSON.stringify(service.$rootMenu())).toBe(before);
  });

  it('validateDepth 拒绝超过 3 层嵌套（4 层抛错）', () => {
    const depth4: MenuRow = {
      id: 'r',
      buttons: [
        {
          id: 'b',
          text: '',
          action: ButtonAction.SUBMENU,
          submenu: [
            {
              id: 'r2',
              buttons: [
                {
                  id: 'b2',
                  text: '',
                  action: ButtonAction.SUBMENU,
                  submenu: [
                    {
                      id: 'r3',
                      buttons: [
                        {
                          id: 'b3',
                          text: '',
                          action: ButtonAction.SUBMENU,
                          submenu: [{ id: 'r4', buttons: [] }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(() => service.validateDepth([depth4])).toThrowError(/不能超过 3 层/);
  });
});
