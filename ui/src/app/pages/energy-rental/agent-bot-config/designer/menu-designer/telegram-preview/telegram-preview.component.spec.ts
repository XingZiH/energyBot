import { CdkDragDrop } from '@angular/cdk/drag-drop';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { NZ_ICONS, NzIconModule } from 'ng-zorro-antd/icon';
import {
  BulbOutline,
  CheckOutline,
  CloseOutline,
  ExportOutline,
  MehOutline,
  MessageOutline,
  MoonOutline,
  MoreOutline,
  PaperClipOutline,
  PlusOutline,
  RightOutline,
  SearchOutline,
  SoundOutline,
  UnorderedListOutline,
} from '@ant-design/icons-angular/icons';

import { ButtonAction, MenuButton, MenuRow } from '../../types';
import { PaletteItem } from '../component-palette/component-palette.component';
import { MenuTreeService } from '../menu-tree.service';
import { TelegramPreviewComponent } from './telegram-preview.component';

/** 生成一条只有 text+action 的最小按钮 */
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

/**
 * 手工构造最小 CdkDragDrop 事件——preview 组件的 drop handler 只读
 * previousContainer.id / currentIndex / previousIndex / item.data 几个字段。
 */
function makeDropEvent(opts: {
  previousContainerId: string;
  currentContainerId: string;
  data: PaletteItem | MenuButton | null;
  previousIndex?: number;
  currentIndex?: number;
}): CdkDragDrop<MenuButton[]> {
  const {
    previousContainerId,
    currentContainerId,
    data,
    previousIndex = 0,
    currentIndex = 0,
  } = opts;
  const previousContainer = { id: previousContainerId, data: [] } as unknown;
  const currentContainer = { id: currentContainerId, data: [] } as unknown;
  const item = { data } as unknown;
  return {
    previousIndex,
    currentIndex,
    item,
    container: currentContainer,
    previousContainer,
    isPointerOverContainer: true,
    distance: { x: 0, y: 0 },
    dropPoint: { x: 0, y: 0 },
    event: new MouseEvent('mouseup'),
  } as unknown as CdkDragDrop<MenuButton[]>;
}

function palItem(action: ButtonAction, title = '测试'): PaletteItem {
  return { action, icon: 'link', title, description: '描述' };
}

describe('TelegramPreviewComponent', () => {
  let component: TelegramPreviewComponent;
  let fixture: ComponentFixture<TelegramPreviewComponent>;
  let tree: MenuTreeService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TelegramPreviewComponent, NzIconModule],
      providers: [
        MenuTreeService,
        {
          provide: NZ_ICONS,
          useValue: [
            BulbOutline,
            CheckOutline,
            CloseOutline,
            ExportOutline,
            MehOutline,
            MessageOutline,
            MoonOutline,
            MoreOutline,
            PaperClipOutline,
            PlusOutline,
            RightOutline,
            SearchOutline,
            SoundOutline,
            UnorderedListOutline,
          ],
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TelegramPreviewComponent);
    component = fixture.componentInstance;
    tree = TestBed.inject(MenuTreeService);
    fixture.detectChanges();
  });

  // 1
  it('1. 初始 darkMode 为 false', () => {
    expect(component.$darkMode()).toBeFalse();
    const host = fixture.debugElement.query(By.css('.tg-preview'));
    expect(host.nativeElement.classList.contains('dark-mode')).toBeFalse();
  });

  // 2
  it('2. toggleDarkMode 切换 signal', () => {
    component.toggleDarkMode();
    expect(component.$darkMode()).toBeTrue();
    component.toggleDarkMode();
    expect(component.$darkMode()).toBeFalse();
  });

  // 3
  it('3. 空菜单 + 空 welcomeText → 气泡显示 fallback 引导文案', () => {
    expect(tree.$currentMenu().length).toBe(0);
    expect(component.$bubbleText()).toBe(TelegramPreviewComponent.WELCOME_TEXT_FALLBACK);
    const bubble = fixture.nativeElement.querySelector('.tg-bot-bubble') as HTMLElement;
    expect(bubble.textContent).toContain('欢迎语');
    expect(bubble.textContent).toContain('/start');
  });

  // 4
  it('4. 有 welcomeText 时气泡显示用户文本', () => {
    tree.setWelcomeText('欢迎来到能量租赁');
    fixture.detectChanges();
    const bubble = fixture.nativeElement.querySelector('.tg-bot-bubble') as HTMLElement;
    expect(bubble.textContent).toContain('欢迎来到能量租赁');
  });

  // 5
  it('5. 有按钮但无 welcomeText → 气泡仍显示 fallback（不再是"请选择："）', () => {
    tree.setRootMenu([row('r1', [btn('b1', 'A')])]);
    fixture.detectChanges();
    expect(component.$bubbleText()).toBe(TelegramPreviewComponent.WELCOME_TEXT_FALLBACK);
  });

  // 6
  it('6. 根菜单（breadcrumb.length=1）也用 Inline Keyboard（v3：全部 inline）', () => {
    tree.setRootMenu([row('r1', [btn('b1', '主菜单A')])]);
    fixture.detectChanges();

    expect(component.$isInline()).toBeTrue();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.tg-inline-keyboard')).toBeTruthy();
    expect(el.querySelector('.tg-reply-keyboard')).toBeNull();
    expect(el.querySelector('.tg-inline-button')!.textContent).toContain('主菜单A');
  });

  // 7
  it('7. 子菜单（breadcrumb.length>1）同样渲染为 Inline Keyboard', () => {
    tree.setRootMenu([
      row('r1', [
        {
          id: 'sub1',
          text: '父按钮',
          action: ButtonAction.SUBMENU,
          submenu: [row('r2', [btn('c1', '子按钮X')])],
        },
      ]),
    ]);
    tree.enterSubmenu('sub1');
    fixture.detectChanges();

    expect(component.$isInline()).toBeTrue();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.tg-inline-keyboard')).toBeTruthy();
    expect(el.querySelector('.tg-reply-keyboard')).toBeNull();
    expect(el.querySelector('.tg-inline-button')!.textContent).toContain('子按钮X');
  });

  // 8
  it('8. Inline Keyboard 按 row/button 二维结构渲染', () => {
    tree.setRootMenu([
      row('r1', [
        {
          id: 'sub1',
          text: '父',
          action: ButtonAction.SUBMENU,
          submenu: [
            row('ra', [btn('a1', 'A1'), btn('a2', 'A2')]),
            row('rb', [btn('b1', 'B1'), btn('b2', 'B2'), btn('b3', 'B3')]),
          ],
        },
      ]),
    ]);
    tree.enterSubmenu('sub1');
    fixture.detectChanges();

    const rows = fixture.debugElement.queryAll(By.css('.tg-inline-row'));
    expect(rows.length).toBe(2);
    const firstRowButtons = rows[0].queryAll(By.css('.tg-inline-button'));
    const secondRowButtons = rows[1].queryAll(By.css('.tg-inline-button'));
    expect(firstRowButtons.length).toBe(2);
    expect(secondRowButtons.length).toBe(3);
    expect(firstRowButtons[0].nativeElement.textContent).toContain('A1');
    expect(secondRowButtons[2].nativeElement.textContent).toContain('B3');
  });

  // 9
  it('9. 按钮 text 空时显示 "(未命名)"', () => {
    tree.setRootMenu([row('r1', [btn('b1', '')])]);
    fixture.detectChanges();
    const btnEl = fixture.nativeElement.querySelector('.tg-inline-button') as HTMLElement;
    expect(btnEl.textContent).toContain('(未命名)');
  });

  // 10
  it('10. SUBMENU 按钮（inline 语境下）显示下钻箭头', () => {
    tree.setRootMenu([
      row('r1', [
        {
          id: 'outer',
          text: '外层',
          action: ButtonAction.SUBMENU,
          submenu: [
            row('ra', [
              {
                id: 'inner',
                text: '里层子菜单',
                action: ButtonAction.SUBMENU,
                submenu: [],
              },
            ]),
          ],
        },
      ]),
    ]);
    tree.enterSubmenu('outer');
    fixture.detectChanges();

    const indicator = fixture.nativeElement.querySelector(
      '.tg-inline-button .tg-inline-submenu-indicator',
    );
    expect(indicator).toBeTruthy();
  });

  // 11
  it('11. darkMode 切换时 DOM class 同步', () => {
    const host = fixture.debugElement.query(By.css('.tg-preview'))
      .nativeElement as HTMLElement;
    expect(host.classList.contains('dark-mode')).toBeFalse();

    component.toggleDarkMode();
    fixture.detectChanges();
    expect(host.classList.contains('dark-mode')).toBeTrue();
  });

  // 12
  it('12. 面包屑渲染到 header 内，末项不带 <a>', () => {
    tree.setRootMenu([
      row('r1', [
        {
          id: 'sub1',
          text: '订单菜单',
          action: ButtonAction.SUBMENU,
          submenu: [row('r2', [btn('x', 'X')])],
        },
      ]),
    ]);
    tree.enterSubmenu('sub1');
    fixture.detectChanges();

    const crumbEl = fixture.debugElement.query(By.css('.tg-header .tg-breadcrumb'));
    expect(crumbEl).toBeTruthy();
    const items = crumbEl.queryAll(By.css('nz-breadcrumb-item'));
    expect(items.length).toBe(2);
    expect((items[0].nativeElement as HTMLElement).querySelector('a')).toBeTruthy();
    expect((items[items.length - 1].nativeElement as HTMLElement).querySelector('a')).toBeNull();
  });

  // 13
  it('13. 点击面包屑非末项触发 navigateTo', () => {
    tree.setRootMenu([
      row('r1', [
        {
          id: 'sub1',
          text: 'S',
          action: ButtonAction.SUBMENU,
          submenu: [row('r2', [btn('x', 'X')])],
        },
      ]),
    ]);
    tree.enterSubmenu('sub1');
    fixture.detectChanges();

    const spy = spyOn(tree, 'navigateTo').and.callThrough();
    component.navigateCrumb(0);
    expect(spy).toHaveBeenCalledWith(0);
  });

  // 14: selectButton / removeButton / enterButtonSubmenu
  it('14. selectButton 更新 $selectedButtonId', () => {
    component.selectButton('b1');
    expect(tree.$selectedButtonId()).toBe('b1');
  });

  it('15. selectButton 空字符串时清空选中', () => {
    tree.$selectedButtonId.set('x');
    component.selectButton('');
    expect(tree.$selectedButtonId()).toBe('');
  });

  it('16. removeButton 调用 tree.removeButton', () => {
    tree.setRootMenu([row('r1', [btn('b1', 'A')])]);
    const spy = spyOn(tree, 'removeButton').and.callThrough();
    component.removeButton('b1');
    expect(spy).toHaveBeenCalledWith('b1');
  });

  it('17. 双击 SUBMENU 按钮调 enterSubmenu', () => {
    const submenuBtn: MenuButton = {
      id: 'sub1',
      text: 'S',
      action: ButtonAction.SUBMENU,
      submenu: [],
    };
    const spy = spyOn(tree, 'enterSubmenu').and.callThrough();
    component.enterButtonSubmenu(submenuBtn);
    expect(spy).toHaveBeenCalledWith('sub1');
  });

  it('18. 双击非 SUBMENU 按钮不调 enterSubmenu', () => {
    const urlBtn: MenuButton = { id: 'u', text: 'U', action: ButtonAction.URL, url: 'x' };
    const spy = spyOn(tree, 'enterSubmenu');
    component.enterButtonSubmenu(urlBtn);
    expect(spy).not.toHaveBeenCalled();
  });

  // ---------- 拖拽 ----------
  it('19. 从 palette 拖到已有行：addButton 调用 + 结构含 url: ""', () => {
    tree.setRootMenu([row('r1', [btn('b1', 'A')])]);
    const spy = spyOn(tree, 'addButton').and.callThrough();

    const ev = makeDropEvent({
      previousContainerId: 'palette-source',
      currentContainerId: 'preview-row-0',
      data: palItem(ButtonAction.URL, '网址'),
    });
    component.onDropToRow(ev, 0);

    expect(spy).toHaveBeenCalledTimes(1);
    const [rowIdx, createdBtn] = spy.calls.mostRecent().args as [number, MenuButton];
    expect(rowIdx).toBe(0);
    expect(createdBtn.action).toBe(ButtonAction.URL);
    expect(createdBtn.url).toBe('');
    expect(createdBtn.text).toBe('网址');
  });

  it('20. palette 拖入已满行（4 按钮）拒绝', () => {
    tree.addRow();
    for (let i = 0; i < 4; i++) {
      tree.addButton(0, { id: `b${i}`, text: `b${i}`, action: ButtonAction.TEXT, message: '' });
    }
    const spy = spyOn(tree, 'addButton').and.callThrough();
    component.onDropToRow(
      makeDropEvent({
        previousContainerId: 'palette-source',
        currentContainerId: 'preview-row-0',
        data: palItem(ButtonAction.URL),
      }),
      0,
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it('21. 同行内拖拽（previousContainer === current）→ reorderButtonInRow', () => {
    tree.setRootMenu([row('r1', [btn('a', 'A'), btn('b', 'B')])]);
    const spy = spyOn(tree, 'reorderButtonInRow').and.callThrough();
    component.onDropToRow(
      makeDropEvent({
        previousContainerId: 'preview-row-0',
        currentContainerId: 'preview-row-0',
        // 同行场景 data 是 MenuButton（带 id）——避免被误判为 palette
        data: btn('a', 'A'),
        previousIndex: 0,
        currentIndex: 1,
      }),
      0,
    );
    expect(spy).toHaveBeenCalledWith(0, 0, 1);
  });

  it('22. 跨行拖拽 → moveButton', () => {
    tree.setRootMenu([row('r1', [btn('a', 'A')]), row('r2', [btn('b', 'B')])]);
    const spy = spyOn(tree, 'moveButton').and.callThrough();
    component.onDropToRow(
      makeDropEvent({
        previousContainerId: 'preview-row-0',
        currentContainerId: 'preview-row-1',
        data: btn('a', 'A'),
        previousIndex: 0,
        currentIndex: 0,
      }),
      1,
    );
    expect(spy).toHaveBeenCalledWith(0, 0, 1, 0);
  });

  it('23. 拖到新行：palette 来源 → addRow + addButton', () => {
    const addRowSpy = spyOn(tree, 'addRow').and.callThrough();
    const addBtnSpy = spyOn(tree, 'addButton').and.callThrough();
    component.onDropToNewRow(
      makeDropEvent({
        previousContainerId: 'palette-source',
        currentContainerId: 'preview-new-row',
        data: palItem(ButtonAction.SUBMENU),
      }),
    );
    expect(addRowSpy).toHaveBeenCalledTimes(1);
    expect(addBtnSpy).toHaveBeenCalledTimes(1);
  });

  it('24. 拖到新行：已有按钮来源 → moveButtonToNewRow', () => {
    tree.setRootMenu([row('r1', [btn('a', 'A'), btn('b', 'B')])]);
    const spy = spyOn(tree, 'moveButtonToNewRow').and.callThrough();
    component.onDropToNewRow(
      makeDropEvent({
        previousContainerId: 'preview-row-0',
        currentContainerId: 'preview-new-row',
        data: btn('a', 'A'),
        previousIndex: 0,
      }),
    );
    expect(spy).toHaveBeenCalledWith(0, 0);
  });

  it('25. 行数达上限时 palette 拖到新行被拒绝', () => {
    for (let i = 0; i < 8; i++) tree.addRow();
    const addRowSpy = spyOn(tree, 'addRow');
    const addBtnSpy = spyOn(tree, 'addButton');
    component.onDropToNewRow(
      makeDropEvent({
        previousContainerId: 'palette-source',
        currentContainerId: 'preview-new-row',
        data: palItem(ButtonAction.TEXT),
      }),
    );
    expect(addRowSpy).not.toHaveBeenCalled();
    expect(addBtnSpy).not.toHaveBeenCalled();
  });

  // ---------- palette 默认字段填充（原 MenuCanvas 的 createButtonFromPalette 用例迁移） ----------
  it('26. palette 创建各类按钮默认字段正确', () => {
    tree.addRow();
    const spy = spyOn(tree, 'addButton').and.callThrough();

    function drop(action: ButtonAction): MenuButton {
      component.onDropToRow(
        makeDropEvent({
          previousContainerId: 'palette-source',
          currentContainerId: 'preview-row-0',
          data: palItem(action, '测试'),
        }),
        0,
      );
      return spy.calls.mostRecent().args[1] as MenuButton;
    }

    // 每轮调用前清空行（避免累积超 4 个拒绝）
    function resetRow(): void {
      tree.setRootMenu([row('r', [])]);
    }

    resetRow();
    expect(drop(ButtonAction.URL).url).toBe('');
    resetRow();
    expect(drop(ButtonAction.TEXT).message).toBe('');
    resetRow();
    expect(drop(ButtonAction.COMMAND).command).toBe('/start');
    resetRow();
    expect(drop(ButtonAction.SUBMENU).submenu).toEqual([]);
    resetRow();
    expect(drop(ButtonAction.ENERGY_PACKAGE_GROUP).packageGroup).toEqual({
      packageIds: [],
      sortBy: 'price_asc',
      textTemplate: '',
    });
    // START/ADDRESS_MANAGE/WALLET_QUERY/ORDERS 无额外字段
    resetRow();
    for (const action of [
      ButtonAction.START,
      ButtonAction.ADDRESS_MANAGE,
      ButtonAction.WALLET_QUERY,
      ButtonAction.ORDERS,
    ]) {
      resetRow();
      const created = drop(action);
      expect(created.url).toBeUndefined();
      expect(created.message).toBeUndefined();
      expect(created.command).toBeUndefined();
      expect(created.submenu).toBeUndefined();
      expect(created.packageGroup).toBeUndefined();
    }
  });

  // ---------- trackBy ----------
  it('27. trackByRowId / trackByButtonId 使用 id', () => {
    expect(component.trackByRowId(0, { id: 'r1', buttons: [] })).toBe('r1');
    expect(
      component.trackByButtonId(0, { id: 'b1', text: 'x', action: ButtonAction.TEXT }),
    ).toBe('b1');
  });

  // ---------- 选中样式反映 ----------
  it('28. 选中按钮后 DOM 带 is-selected class', () => {
    tree.setRootMenu([row('r1', [btn('b1', 'A')])]);
    fixture.detectChanges();
    component.selectButton('b1');
    fixture.detectChanges();
    const btnEl = fixture.nativeElement.querySelector('.tg-inline-button') as HTMLElement;
    expect(btnEl.classList.contains('is-selected')).toBeTrue();
  });

  // ---------- 空菜单子层仍可接收 palette（通过 tg-empty-row 落点） ----------
  it('29. 子层空菜单渲染 empty-row 落点', () => {
    tree.setRootMenu([
      row('r1', [
        {
          id: 'sub1',
          text: 'S',
          action: ButtonAction.SUBMENU,
          submenu: [],
        },
      ]),
    ]);
    tree.enterSubmenu('sub1');
    fixture.detectChanges();

    const empty = fixture.nativeElement.querySelector('.tg-empty-row');
    expect(empty).toBeTruthy();
  });

  // ---------- v3：URL 按钮视觉区分 ----------
  it('30. URL 按钮带 data-action="URL" 属性 + url-indicator 箭头 icon', () => {
    tree.setRootMenu([
      row('r1', [
        {
          id: 'u1',
          text: '官网',
          action: ButtonAction.URL,
          url: 'https://example.com',
        },
      ]),
    ]);
    fixture.detectChanges();

    const btnEl = fixture.nativeElement.querySelector('.tg-inline-button') as HTMLElement;
    expect(btnEl.getAttribute('data-action')).toBe(ButtonAction.URL);
    // URL 按钮右上角出框箭头
    expect(btnEl.querySelector('.tg-inline-url-indicator')).toBeTruthy();
    // SUBMENU 箭头不应该出现
    expect(btnEl.querySelector('.tg-inline-submenu-indicator')).toBeNull();
  });

  it('31. SUBMENU 按钮 data-action="SUBMENU" + submenu-indicator，无 url-indicator', () => {
    tree.setRootMenu([
      row('r1', [
        {
          id: 's1',
          text: '分组',
          action: ButtonAction.SUBMENU,
          submenu: [],
        },
      ]),
    ]);
    fixture.detectChanges();

    const btnEl = fixture.nativeElement.querySelector('.tg-inline-button') as HTMLElement;
    expect(btnEl.getAttribute('data-action')).toBe(ButtonAction.SUBMENU);
    expect(btnEl.querySelector('.tg-inline-submenu-indicator')).toBeTruthy();
    expect(btnEl.querySelector('.tg-inline-url-indicator')).toBeNull();
  });
});
