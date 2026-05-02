import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { NZ_ICONS, NzIconModule } from 'ng-zorro-antd/icon';
import {
  BulbOutline,
  MoonOutline,
  RightOutline,
} from '@ant-design/icons-angular/icons';

import { ButtonAction, MenuButton, MenuRow } from '../../types';
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
          useValue: [BulbOutline, MoonOutline, RightOutline],
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
  it('3. $currentMenu 为空时只显示 bot 气泡，无键盘', () => {
    expect(tree.$currentMenu().length).toBe(0);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.tg-bot-bubble')).toBeTruthy();
    expect(el.querySelector('.tg-reply-keyboard')).toBeNull();
    expect(el.querySelector('.tg-inline-keyboard')).toBeNull();
    // bot 气泡应显示空态提示
    const bubbleText = el.querySelector('.tg-bot-bubble')!.textContent || '';
    expect(bubbleText).toContain('请从左侧设计菜单');
  });

  // 4
  it('4. 根菜单（breadcrumb.length=1）渲染为 Reply Keyboard', () => {
    tree.setRootMenu([row('r1', [btn('b1', '主菜单A')])]);
    fixture.detectChanges();

    expect(component.$isInline()).toBeFalse();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.tg-reply-keyboard')).toBeTruthy();
    expect(el.querySelector('.tg-inline-keyboard')).toBeNull();
    expect(el.querySelector('.tg-reply-button')!.textContent).toContain('主菜单A');
  });

  // 5
  it('5. 子菜单（breadcrumb.length>1）渲染为 Inline Keyboard', () => {
    // 构造 root 有一个 SUBMENU 按钮 + 子菜单内容
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

  // 6
  it('6. Inline Keyboard 按 row/button 二维结构渲染', () => {
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

  // 7
  it('7. 按钮 text 空时显示 "(未命名)"', () => {
    tree.setRootMenu([row('r1', [btn('b1', '')])]);
    fixture.detectChanges();

    const btnEl = fixture.nativeElement.querySelector('.tg-reply-button') as HTMLElement;
    expect(btnEl.textContent).toContain('(未命名)');
  });

  // 8
  it('8. SUBMENU 类型按钮显示下钻箭头图标（inline 语境下）', () => {
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

  // 9
  it('9. 非 SUBMENU 类型按钮不显示下钻图标', () => {
    tree.setRootMenu([
      row('r1', [
        {
          id: 'outer',
          text: '外层',
          action: ButtonAction.SUBMENU,
          submenu: [
            row('ra', [btn('plain', '普通文本按钮', ButtonAction.TEXT)]),
          ],
        },
      ]),
    ]);
    tree.enterSubmenu('outer');
    fixture.detectChanges();

    const allInlineButtons = fixture.nativeElement.querySelectorAll('.tg-inline-button');
    expect(allInlineButtons.length).toBe(1);
    const indicator = allInlineButtons[0].querySelector('.tg-inline-submenu-indicator');
    expect(indicator).toBeNull();
  });

  // 10
  it('10. darkMode 切换时 DOM class 同步切换', () => {
    const host = fixture.debugElement.query(By.css('.tg-preview'))
      .nativeElement as HTMLElement;
    expect(host.classList.contains('dark-mode')).toBeFalse();

    component.toggleDarkMode();
    fixture.detectChanges();
    expect(host.classList.contains('dark-mode')).toBeTrue();

    component.toggleDarkMode();
    fixture.detectChanges();
    expect(host.classList.contains('dark-mode')).toBeFalse();
  });

  // 11
  it('11. 面包屑展示当前层级路径', () => {
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
    // 根层时面包屑文本 = "根菜单"
    fixture.detectChanges();
    expect(component.$breadcrumbText()).toBe('根菜单');
    let text = (fixture.nativeElement as HTMLElement).querySelector(
      '.tg-breadcrumb-text',
    )!.textContent;
    expect(text).toContain('根菜单');

    // 进入子菜单后拼接
    tree.enterSubmenu('sub1');
    fixture.detectChanges();
    expect(component.$breadcrumbText()).toBe('根菜单 > 订单菜单');
    text = (fixture.nativeElement as HTMLElement).querySelector(
      '.tg-breadcrumb-text',
    )!.textContent;
    expect(text).toContain('根菜单 > 订单菜单');
  });

  // 12
  it('12. 多行按钮正确分行渲染（2 行 × 不同按钮数）', () => {
    tree.setRootMenu([
      row('r1', [btn('a', 'A1'), btn('b', 'A2'), btn('c', 'A3')]),
      row('r2', [btn('d', 'B1'), btn('e', 'B2')]),
    ]);
    fixture.detectChanges();

    const rows = fixture.debugElement.queryAll(By.css('.tg-reply-row'));
    expect(rows.length).toBe(2);
    expect(rows[0].queryAll(By.css('.tg-reply-button')).length).toBe(3);
    expect(rows[1].queryAll(By.css('.tg-reply-button')).length).toBe(2);
    expect(rows[0].nativeElement.textContent).toContain('A1');
    expect(rows[0].nativeElement.textContent).toContain('A3');
    expect(rows[1].nativeElement.textContent).toContain('B2');
  });

  // 额外：13 - trackBy 稳定引用（一次 detectChanges 不换新节点）
  it('13. trackByRowId / trackByButtonId 使用 id 稳定跟踪', () => {
    expect(component.trackByRowId(0, { id: 'r1', buttons: [] })).toBe('r1');
    expect(
      component.trackByButtonId(0, { id: 'b1', text: 'x', action: ButtonAction.TEXT }),
    ).toBe('b1');
  });

  // 额外：14 - 空菜单在子层也不渲染键盘
  it('14. 子层空菜单也不渲染 inline keyboard', () => {
    tree.setRootMenu([
      row('r1', [
        {
          id: 'sub1',
          text: '空的父',
          action: ButtonAction.SUBMENU,
          submenu: [],
        },
      ]),
    ]);
    tree.enterSubmenu('sub1');
    fixture.detectChanges();

    expect(component.$isInline()).toBeTrue();
    expect(tree.$currentMenu().length).toBe(0);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.tg-inline-keyboard')).toBeNull();
    expect(el.querySelector('.tg-reply-keyboard')).toBeNull();
    // bot 气泡仍然显示空态文案
    expect(el.querySelector('.tg-bot-bubble')!.textContent).toContain(
      '请从左侧设计菜单',
    );
  });
});
