import { CdkDragDrop } from '@angular/cdk/drag-drop';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { NZ_ICONS, NzIconModule } from 'ng-zorro-antd/icon';
import {
  AppstoreOutline,
  CodeOutline,
  DeleteOutline,
  DownOutline,
  EnvironmentOutline,
  FolderOutline,
  HomeOutline,
  LinkOutline,
  MessageOutline,
  OrderedListOutline,
  PlusOutline,
  RightOutline,
  ThunderboltOutline,
  WalletOutline,
} from '@ant-design/icons-angular/icons';

import {
  ButtonAction,
  MAX_BUTTONS_PER_ROW,
  MAX_ROWS_PER_MENU,
  MenuButton,
  MenuRow,
} from '../../types';
import { PaletteItem } from '../component-palette/component-palette.component';
import { MenuTreeService } from '../menu-tree.service';
import { MenuCanvasComponent } from './menu-canvas.component';

/** 手工构造最小 CdkDragDrop 事件——canvas 的 onDropToRow/onDropToNewRow 只读 data/container 几个字段 */
function makeDropEvent(opts: {
  fromPalette: boolean;
  paletteItem?: PaletteItem;
  previousIndex?: number;
  currentIndex?: number;
}): CdkDragDrop<MenuButton[]> {
  const { fromPalette, paletteItem, previousIndex = 0, currentIndex = 0 } = opts;

  // previousContainer !== container ⇒ 跨 list；反之同 list
  const containerA = { id: 'row-0', data: {} } as unknown;
  const containerB = fromPalette ? ({ id: 'palette', data: {} } as unknown) : containerA;

  const item = {
    data: fromPalette ? paletteItem : null,
  } as unknown;

  return {
    previousIndex,
    currentIndex,
    item,
    container: containerA,
    previousContainer: containerB,
    isPointerOverContainer: true,
    distance: { x: 0, y: 0 },
    dropPoint: { x: 0, y: 0 },
    event: new MouseEvent('mouseup'),
  } as unknown as CdkDragDrop<MenuButton[]>;
}

function palItem(action: ButtonAction, title = '测试'): PaletteItem {
  return { action, icon: 'link', title, description: '描述' };
}

describe('MenuCanvasComponent', () => {
  let component: MenuCanvasComponent;
  let fixture: ComponentFixture<MenuCanvasComponent>;
  let tree: MenuTreeService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MenuCanvasComponent, NzIconModule],
      providers: [
        MenuTreeService,
        {
          provide: NZ_ICONS,
          useValue: [
            AppstoreOutline,
            CodeOutline,
            DeleteOutline,
            DownOutline,
            EnvironmentOutline,
            FolderOutline,
            HomeOutline,
            LinkOutline,
            MessageOutline,
            OrderedListOutline,
            PlusOutline,
            RightOutline,
            ThunderboltOutline,
            WalletOutline,
          ],
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MenuCanvasComponent);
    component = fixture.componentInstance;
    tree = TestBed.inject(MenuTreeService);
    fixture.detectChanges();
  });

  // ---------- 面包屑 ----------
  it('1. 初始渲染显示 "根菜单" 面包屑', () => {
    const crumbs = component.$breadcrumb();
    expect(crumbs.length).toBe(1);
    expect(crumbs[0].label).toBe('根菜单');

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('根菜单');
  });

  it('4. 点击面包屑项（非末项）调用 navigateTo', () => {
    // 构造两层面包屑
    tree.addRow();
    tree.addButton(0, {
      id: 'sub1',
      text: '子菜单',
      action: ButtonAction.SUBMENU,
      submenu: [],
    });
    tree.enterSubmenu('sub1');
    fixture.detectChanges();

    expect(component.$breadcrumb().length).toBe(2);

    const navSpy = spyOn(tree, 'navigateTo').and.callThrough();
    component.navigateCrumb(0);
    expect(navSpy).toHaveBeenCalledWith(0);
  });

  // ---------- 空状态 / 按钮渲染 ----------
  it('2. $currentMenu 为空时渲染 nz-empty', () => {
    expect(component.$currentMenu().length).toBe(0);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('nz-empty')).toBeTruthy();
  });

  it('3. 有按钮时渲染按钮卡片（数量正确）', () => {
    tree.addRow();
    tree.addButton(0, { id: 'b1', text: '按钮1', action: ButtonAction.TEXT, message: 'hi' });
    tree.addButton(0, { id: 'b2', text: '按钮2', action: ButtonAction.URL, url: 'https://x' });
    tree.addRow();
    tree.addButton(1, { id: 'b3', text: '按钮3', action: ButtonAction.START });
    fixture.detectChanges();

    const cards = fixture.debugElement.queryAll(By.css('.canvas-button-card'));
    expect(cards.length).toBe(3);
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('按钮1');
    expect(text).toContain('按钮2');
    expect(text).toContain('按钮3');
  });

  // ---------- addEmptyRow / 上限 ----------
  it('5. addEmptyRow 调用 tree.addRow（当 canAddRow 为 true）', () => {
    const spy = spyOn(tree, 'addRow').and.callThrough();
    expect(component.$canAddRow()).toBeTrue();
    component.addEmptyRow();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('6. 行数达上限（MAX_ROWS_PER_MENU=8）时 $canAddRow 为 false 且 addEmptyRow 不调用 addRow', () => {
    for (let i = 0; i < MAX_ROWS_PER_MENU; i++) tree.addRow();
    fixture.detectChanges();
    expect(component.$currentMenu().length).toBe(MAX_ROWS_PER_MENU);
    expect(component.$canAddRow()).toBeFalse();

    const spy = spyOn(tree, 'addRow');
    component.addEmptyRow();
    expect(spy).not.toHaveBeenCalled();
  });

  // ---------- selectButton / removeButton / enterSubmenu ----------
  it('7. selectButton 更新 $selectedButtonId', () => {
    component.selectButton('b1');
    expect(tree.$selectedButtonId()).toBe('b1');
    expect(component.$selectedId()).toBe('b1');
  });

  it('8. removeButton 调用 tree.removeButton', () => {
    tree.addRow();
    tree.addButton(0, { id: 'b1', text: '按钮1', action: ButtonAction.TEXT, message: '' });
    const spy = spyOn(tree, 'removeButton').and.callThrough();
    component.removeButton('b1');
    expect(spy).toHaveBeenCalledWith('b1');
  });

  it('9. 双击 SUBMENU 按钮调用 enterSubmenu', () => {
    const btn: MenuButton = {
      id: 'sub1',
      text: '子菜单',
      action: ButtonAction.SUBMENU,
      submenu: [],
    };
    const spy = spyOn(tree, 'enterSubmenu').and.callThrough();
    component.enterButtonSubmenu(btn);
    expect(spy).toHaveBeenCalledWith('sub1');
  });

  it('10. 双击非 SUBMENU 按钮不调用 enterSubmenu', () => {
    const btn: MenuButton = {
      id: 'u1',
      text: '网址',
      action: ButtonAction.URL,
      url: 'https://x',
    };
    const spy = spyOn(tree, 'enterSubmenu');
    component.enterButtonSubmenu(btn);
    expect(spy).not.toHaveBeenCalled();
  });

  // ---------- 拖拽创建按钮（9 种 action 默认字段） ----------
  it('11. 从 palette 创建 URL 按钮：addButton 被调用，结构含 url: ""', () => {
    tree.addRow();
    const addSpy = spyOn(tree, 'addButton').and.callThrough();
    const ev = makeDropEvent({ fromPalette: true, paletteItem: palItem(ButtonAction.URL, '网址') });
    component.onDropToRow(ev, 0);

    expect(addSpy).toHaveBeenCalledTimes(1);
    const [rowIdx, btn] = addSpy.calls.mostRecent().args as [number, MenuButton];
    expect(rowIdx).toBe(0);
    expect(btn.action).toBe(ButtonAction.URL);
    expect(btn.url).toBe('');
    expect(btn.id).toBeTruthy();
    expect(btn.text).toBe('网址');
  });

  it('11b. TEXT 默认 message: ""', () => {
    tree.addRow();
    const addSpy = spyOn(tree, 'addButton').and.callThrough();
    component.onDropToRow(
      makeDropEvent({ fromPalette: true, paletteItem: palItem(ButtonAction.TEXT) }),
      0,
    );
    const btn = addSpy.calls.mostRecent().args[1] as MenuButton;
    expect(btn.message).toBe('');
  });

  it('11c. COMMAND 默认 command: "/start"', () => {
    tree.addRow();
    const addSpy = spyOn(tree, 'addButton').and.callThrough();
    component.onDropToRow(
      makeDropEvent({ fromPalette: true, paletteItem: palItem(ButtonAction.COMMAND) }),
      0,
    );
    const btn = addSpy.calls.mostRecent().args[1] as MenuButton;
    expect(btn.command).toBe('/start');
  });

  it('12. SUBMENU 默认 submenu: []', () => {
    tree.addRow();
    const addSpy = spyOn(tree, 'addButton').and.callThrough();
    component.onDropToRow(
      makeDropEvent({ fromPalette: true, paletteItem: palItem(ButtonAction.SUBMENU) }),
      0,
    );
    const btn = addSpy.calls.mostRecent().args[1] as MenuButton;
    expect(btn.submenu).toEqual([]);
  });

  it('13. ENERGY_PACKAGE_GROUP 默认 packageGroup 填充', () => {
    tree.addRow();
    const addSpy = spyOn(tree, 'addButton').and.callThrough();
    component.onDropToRow(
      makeDropEvent({
        fromPalette: true,
        paletteItem: palItem(ButtonAction.ENERGY_PACKAGE_GROUP),
      }),
      0,
    );
    const btn = addSpy.calls.mostRecent().args[1] as MenuButton;
    expect(btn.packageGroup).toEqual({ packageIds: [], sortBy: 'price_asc', textTemplate: '' });
  });

  it('13b. START / ADDRESS_MANAGE / WALLET_QUERY / ORDERS 不带额外字段', () => {
    tree.addRow();
    const addSpy = spyOn(tree, 'addButton').and.callThrough();
    for (const action of [
      ButtonAction.START,
      ButtonAction.ADDRESS_MANAGE,
      ButtonAction.WALLET_QUERY,
      ButtonAction.ORDERS,
    ]) {
      component.onDropToRow(
        makeDropEvent({ fromPalette: true, paletteItem: palItem(action) }),
        0,
      );
    }
    const calls = addSpy.calls.all();
    expect(calls.length).toBe(4);
    for (const call of calls) {
      const btn = call.args[1] as MenuButton;
      expect(btn.url).toBeUndefined();
      expect(btn.message).toBeUndefined();
      expect(btn.command).toBeUndefined();
      expect(btn.submenu).toBeUndefined();
      expect(btn.packageGroup).toBeUndefined();
    }
  });

  // ---------- 校验 ----------
  it('14. 行内已满（MAX_BUTTONS_PER_ROW=4）拒绝新增', () => {
    tree.addRow();
    for (let i = 0; i < MAX_BUTTONS_PER_ROW; i++) {
      tree.addButton(0, {
        id: `b${i}`,
        text: `b${i}`,
        action: ButtonAction.TEXT,
        message: '',
      });
    }
    expect(tree.$currentMenu()[0].buttons.length).toBe(MAX_BUTTONS_PER_ROW);

    const addSpy = spyOn(tree, 'addButton').and.callThrough();
    component.onDropToRow(
      makeDropEvent({ fromPalette: true, paletteItem: palItem(ButtonAction.URL) }),
      0,
    );
    expect(addSpy).not.toHaveBeenCalled();
  });

  it('14b. 行总数已达上限时，onDropToNewRow 不新增行', () => {
    for (let i = 0; i < MAX_ROWS_PER_MENU; i++) tree.addRow();

    const addRowSpy = spyOn(tree, 'addRow');
    const addBtnSpy = spyOn(tree, 'addButton');
    component.onDropToNewRow(
      makeDropEvent({ fromPalette: true, paletteItem: palItem(ButtonAction.URL) }),
    );
    expect(addRowSpy).not.toHaveBeenCalled();
    expect(addBtnSpy).not.toHaveBeenCalled();
  });

  it('14c. onDropToNewRow 正常场景：addRow 再 addButton 到末行', () => {
    const addRowSpy = spyOn(tree, 'addRow').and.callThrough();
    const addBtnSpy = spyOn(tree, 'addButton').and.callThrough();
    component.onDropToNewRow(
      makeDropEvent({ fromPalette: true, paletteItem: palItem(ButtonAction.URL) }),
    );
    expect(addRowSpy).toHaveBeenCalledTimes(1);
    expect(addBtnSpy).toHaveBeenCalledTimes(1);
    const [rowIdx] = addBtnSpy.calls.mostRecent().args as [number, MenuButton];
    expect(rowIdx).toBe(0); // 只新增一行 → 末行 index = 0
  });

  it('15. 同画布内 drop（非 palette 来源）当前不做处理（TODO：排序延后实现）', () => {
    tree.addRow();
    tree.addButton(0, { id: 'b1', text: '按钮', action: ButtonAction.TEXT, message: '' });
    const addSpy = spyOn(tree, 'addButton');
    component.onDropToRow(makeDropEvent({ fromPalette: false }), 0);
    expect(addSpy).not.toHaveBeenCalled();
  });

  // ---------- 面包屑末项 ----------
  it('16. 面包屑末项不渲染为 <a> 链接（不可点击）', () => {
    tree.addRow();
    tree.addButton(0, {
      id: 'sub1',
      text: '子菜单A',
      action: ButtonAction.SUBMENU,
      submenu: [],
    });
    tree.enterSubmenu('sub1');
    fixture.detectChanges();

    const items = fixture.debugElement.queryAll(By.css('nz-breadcrumb-item'));
    expect(items.length).toBe(2);
    // 末项内部不应有 <a>
    const last = items[items.length - 1].nativeElement as HTMLElement;
    expect(last.querySelector('a')).toBeNull();
    // 非末项应有 <a>
    const first = items[0].nativeElement as HTMLElement;
    expect(first.querySelector('a')).toBeTruthy();
  });

  it('17. 按钮选中后 selectedId 反映在 DOM 类名上', () => {
    tree.addRow();
    tree.addButton(0, { id: 'b1', text: 'x', action: ButtonAction.TEXT, message: '' });
    fixture.detectChanges();

    component.selectButton('b1');
    fixture.detectChanges();

    const card = fixture.debugElement.query(By.css('.canvas-button-card'));
    expect((card.nativeElement as HTMLElement).classList.contains('is-selected')).toBeTrue();
  });
});
