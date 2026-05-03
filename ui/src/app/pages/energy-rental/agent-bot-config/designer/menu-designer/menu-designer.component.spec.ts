import { Component, ViewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { NZ_ICONS, NzIconModule } from 'ng-zorro-antd/icon';
import { NzModalService } from 'ng-zorro-antd/modal';
import {
  AppstoreOutline,
  BgColorsOutline,
  BulbOutline,
  CheckOutline,
  CloseOutline,
  CloseCircleOutline,
  CodeOutline,
  DeleteOutline,
  DownOutline,
  DragOutline,
  EnvironmentOutline,
  ExclamationCircleOutline,
  FolderOutline,
  FontColorsOutline,
  HomeOutline,
  LinkOutline,
  MehOutline,
  MessageOutline,
  MoonOutline,
  MoreOutline,
  OrderedListOutline,
  PaperClipOutline,
  PlusOutline,
  ReloadOutline,
  RightOutline,
  SaveOutline,
  SearchOutline,
  SoundOutline,
  ThunderboltOutline,
  UndoOutline,
  RedoOutline,
  UnorderedListOutline,
  WalletOutline,
} from '@ant-design/icons-angular/icons';

import { ButtonAction, MenuButton, MenuRow } from '../types';
import { DesignerChange, MenuDesignerComponent } from './menu-designer.component';
import { MenuTreeService } from './menu-tree.service';

/** 构造最小按钮 */
function btn(id: string, text: string, action: ButtonAction = ButtonAction.TEXT): MenuButton {
  const base: MenuButton = { id, text, action };
  if (action === ButtonAction.TEXT) return { ...base, message: '' };
  if (action === ButtonAction.URL) return { ...base, url: '' };
  if (action === ButtonAction.COMMAND) return { ...base, command: '/x' };
  if (action === ButtonAction.SUBMENU) return { ...base, submenu: [] };
  return base;
}

function row(id: string, buttons: MenuButton[]): MenuRow {
  return { id, buttons };
}

/** Host 组件：通过模板绑定 initialMenu / initialWelcomeText / agentId，方便测试 input 变化与 output */
@Component({
  standalone: true,
  imports: [MenuDesignerComponent],
  template: `
    <app-menu-designer
      [initialMenu]="initialMenu"
      [initialWelcomeText]="initialWelcomeText"
      [agentId]="agentId"
      (designerChange)="onDesignerChange($event)"
    ></app-menu-designer>
  `,
})
class HostComponent {
  initialMenu: MenuRow[] = [];
  initialWelcomeText = '';
  agentId: number | null = null;
  emitted: DesignerChange | null = null;

  @ViewChild(MenuDesignerComponent) designer!: MenuDesignerComponent;

  onDesignerChange(change: DesignerChange): void {
    this.emitted = change;
  }
}

describe('MenuDesignerComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let mockModal: jasmine.SpyObj<NzModalService>;

  /** 模拟 confirm：默认立即执行 onOk 回调 */
  function configureModalConfirm(executeOk = true): void {
    mockModal.confirm.and.callFake((config: any) => {
      if (executeOk) {
        config.nzOnOk?.();
      }
      return {} as any;
    });
  }

  beforeEach(async () => {
    mockModal = jasmine.createSpyObj<NzModalService>('NzModalService', ['confirm']);
    configureModalConfirm(true);

    await TestBed.configureTestingModule({
      imports: [HostComponent, NzIconModule],
      providers: [
        { provide: NzModalService, useValue: mockModal },
        {
          provide: NZ_ICONS,
          useValue: [
            AppstoreOutline,
            BgColorsOutline,
            BulbOutline,
            CheckOutline,
            CloseOutline,
            CloseCircleOutline,
            CodeOutline,
            DeleteOutline,
            DownOutline,
            DragOutline,
            EnvironmentOutline,
            ExclamationCircleOutline,
            FolderOutline,
            FontColorsOutline,
            HomeOutline,
            LinkOutline,
            MehOutline,
            MessageOutline,
            MoonOutline,
            MoreOutline,
            OrderedListOutline,
            PaperClipOutline,
            PlusOutline,
            ReloadOutline,
            RightOutline,
            SaveOutline,
            SearchOutline,
            SoundOutline,
            ThunderboltOutline,
            UndoOutline,
            RedoOutline,
            UnorderedListOutline,
            WalletOutline,
          ],
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
  });

  // 1
  it('1. initialMenu 初始化：tree.setRootMenu 接收初始值', () => {
    const initial: MenuRow[] = [row('r1', [btn('b1', 'A')])];
    host.initialMenu = initial;
    fixture.detectChanges();

    const tree = (host.designer as unknown as { tree: MenuTreeService }).tree;
    expect(tree.$rootMenu().length).toBe(1);
    expect(tree.$rootMenu()[0].buttons[0].text).toBe('A');
  });

  // 2
  it('2. $isDirty 初始为 false', () => {
    host.initialMenu = [row('r1', [btn('b1', 'A')])];
    fixture.detectChanges();
    expect(host.designer.$isDirty()).toBeFalse();
  });

  // 3
  it('3. 修改菜单后 $isDirty 变 true', () => {
    host.initialMenu = [row('r1', [btn('b1', 'A')])];
    fixture.detectChanges();

    host.designer.tree.addRow();
    fixture.detectChanges();
    expect(host.designer.$isDirty()).toBeTrue();
  });

  // 4
  it('4. save 成功：emit designerChange（含 welcomeText + menuConfig）、更新 snapshot、$isDirty 回 false', () => {
    host.initialMenu = [row('r1', [btn('b1', 'A')])];
    host.initialWelcomeText = '你好';
    fixture.detectChanges();

    host.designer.tree.addButton(0, btn('b2', 'B'));
    host.designer.tree.setWelcomeText('新问候');
    fixture.detectChanges();
    expect(host.designer.$isDirty()).toBeTrue();

    host.designer.save();
    fixture.detectChanges();

    expect(host.emitted).not.toBeNull();
    expect(host.emitted!.menuConfig[0].buttons.length).toBe(2);
    expect(host.emitted!.welcomeText).toBe('新问候');
    expect(host.designer.$validationError()).toBeNull();
    expect(host.designer.$isDirty()).toBeFalse();
  });

  // 5
  it('5. save 校验失败：不 emit 且 $validationError 非空', () => {
    host.initialMenu = [];
    fixture.detectChanges();

    // 构造超过最大深度的菜单：通过直接 set root 绕过 service 的深度限制
    // SUBMENU 嵌套 4 层（> MAX_MENU_DEPTH=3）
    const deep: MenuRow[] = [
      row('r1', [
        {
          id: 'b1',
          text: 'L1',
          action: ButtonAction.SUBMENU,
          submenu: [
            row('r2', [
              {
                id: 'b2',
                text: 'L2',
                action: ButtonAction.SUBMENU,
                submenu: [
                  row('r3', [
                    {
                      id: 'b3',
                      text: 'L3',
                      action: ButtonAction.SUBMENU,
                      submenu: [row('r4', [btn('b4', 'L4')])],
                    },
                  ]),
                ],
              },
            ]),
          ],
        },
      ]),
    ];
    host.designer.tree.$rootMenu.set(deep);
    fixture.detectChanges();

    host.emitted = null;
    host.designer.save();
    fixture.detectChanges();

    expect(host.emitted).toBeNull();
    expect(host.designer.$validationError()).toMatch(/深度/);
  });

  // 6
  it('6. undo 调 tree.undo', () => {
    host.initialMenu = [];
    fixture.detectChanges();

    const spy = spyOn(host.designer.tree, 'undo');
    host.designer.undo();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  // 7
  it('7. redo 调 tree.redo', () => {
    host.initialMenu = [];
    fixture.detectChanges();

    const spy = spyOn(host.designer.tree, 'redo');
    host.designer.redo();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  // 8
  it('8. reset modal 确认后恢复到 snapshot 且清空 error', () => {
    host.initialMenu = [row('r1', [btn('b1', 'A')])];
    fixture.detectChanges();

    // 修改 + 制造校验错误
    host.designer.tree.addRow();
    host.designer.$validationError.set('旧错误');
    fixture.detectChanges();
    expect(host.designer.$isDirty()).toBeTrue();

    host.designer.reset();
    fixture.detectChanges();

    expect(mockModal.confirm).toHaveBeenCalledTimes(1);
    expect(host.designer.tree.$rootMenu().length).toBe(1);
    expect(host.designer.$isDirty()).toBeFalse();
    expect(host.designer.$validationError()).toBeNull();
  });

  // 9
  it('9. reset modal 取消（nzOnOk 不执行）不改变状态', () => {
    configureModalConfirm(false);

    host.initialMenu = [row('r1', [btn('b1', 'A')])];
    fixture.detectChanges();

    host.designer.tree.addRow();
    fixture.detectChanges();
    const before = host.designer.tree.$rootMenu().length;
    expect(host.designer.$isDirty()).toBeTrue();

    host.designer.reset();
    fixture.detectChanges();

    expect(mockModal.confirm).toHaveBeenCalledTimes(1);
    expect(host.designer.tree.$rootMenu().length).toBe(before);
    expect(host.designer.$isDirty()).toBeTrue();
  });

  // 10
  it('10. 3 个子组件全部渲染（三栏：palette / preview / property；MenuCanvas 已移除）', () => {
    host.initialMenu = [];
    fixture.detectChanges();

    const root = fixture.debugElement;
    expect(root.query(By.css('app-component-palette'))).toBeTruthy();
    expect(root.query(By.css('app-telegram-preview'))).toBeTruthy();
    expect(root.query(By.css('app-property-panel'))).toBeTruthy();
    expect(root.query(By.css('app-menu-canvas'))).toBeNull();
  });

  // 11
  it('11. agentId 透传给 PropertyPanel', () => {
    host.initialMenu = [];
    host.agentId = 42;
    fixture.detectChanges();

    const propertyPanelDe = fixture.debugElement.query(By.css('app-property-panel'));
    const propertyPanelInst = propertyPanelDe.componentInstance as { agentId: () => number | null };
    expect(propertyPanelInst.agentId()).toBe(42);
  });

  // 12
  it('12. 根容器带 cdkDropListGroup', () => {
    host.initialMenu = [];
    fixture.detectChanges();

    const designerDe = fixture.debugElement.query(By.css('app-menu-designer'));
    // 设计器根容器或其直接子节点之一应带 cdkDropListGroup
    const group = designerDe.query(By.css('[cdkDropListGroup]'));
    expect(group).toBeTruthy();
  });

  // 13
  it('13. initialMenu 变化时重新初始化 tree 与 snapshot', () => {
    // 用独立 fixture 绕开 Host template 的 input 绑定，让 componentRef.setInput
    // 驱动 input signal 变化。这样可以精确测试 effect 的响应，同时避免
    // Host 表达式在 dev-mode checkNoChanges pass 中的误报
    // （effect 同步写入 signal 与 Host 表达式跨 CD pass 值对比冲突）。
    const designerFixture = TestBed.createComponent(MenuDesignerComponent);
    designerFixture.componentRef.setInput('initialMenu', [row('r1', [btn('b1', 'A')])]);
    designerFixture.detectChanges();
    const designer = designerFixture.componentInstance;
    expect(designer.tree.$rootMenu().length).toBe(1);

    designerFixture.componentRef.setInput('initialMenu', [
      row('r2', [btn('b2', 'B')]),
      row('r3', [btn('b3', 'C')]),
    ]);
    designerFixture.detectChanges();

    expect(designer.tree.$rootMenu().length).toBe(2);
    expect(designer.$isDirty()).toBeFalse();
  });

  // 14
  it('14. MenuTreeService 组件级 provider：子组件拿到的是同一实例', () => {
    host.initialMenu = [row('r1', [btn('b1', 'A')])];
    fixture.detectChanges();

    const designerTree = host.designer.tree;
    const previewDe = fixture.debugElement.query(By.css('app-telegram-preview'));
    const previewInst = previewDe.componentInstance as { tree: MenuTreeService };
    expect(previewInst.tree).toBe(designerTree);
  });

  // 15
  it('15. initialWelcomeText 透传到 tree.$welcomeText', () => {
    host.initialMenu = [];
    host.initialWelcomeText = '欢迎';
    fixture.detectChanges();
    expect(host.designer.tree.$welcomeText()).toBe('欢迎');
  });

  // 16
  it('16. 修改 welcomeText 后 $isDirty 变 true', () => {
    host.initialMenu = [];
    host.initialWelcomeText = '初始';
    fixture.detectChanges();
    expect(host.designer.$isDirty()).toBeFalse();

    host.designer.tree.setWelcomeText('新');
    fixture.detectChanges();
    expect(host.designer.$isDirty()).toBeTrue();
  });

  // 17
  it('17. reset 同时恢复菜单与 welcomeText', () => {
    host.initialMenu = [row('r1', [btn('b1', 'A')])];
    host.initialWelcomeText = '原';
    fixture.detectChanges();

    host.designer.tree.addRow();
    host.designer.tree.setWelcomeText('脏');
    fixture.detectChanges();
    expect(host.designer.$isDirty()).toBeTrue();

    host.designer.reset();
    fixture.detectChanges();

    expect(host.designer.tree.$rootMenu().length).toBe(1);
    expect(host.designer.tree.$welcomeText()).toBe('原');
    expect(host.designer.$isDirty()).toBeFalse();
  });
});
