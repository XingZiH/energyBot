import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { NZ_ICONS, NzIconModule } from 'ng-zorro-antd/icon';
import {
  BgColorsOutline,
  CodeOutline,
  DownOutline,
  EnvironmentOutline,
  FolderOutline,
  FontColorsOutline,
  HomeOutline,
  LinkOutline,
  MessageOutline,
  OrderedListOutline,
  RightOutline,
  ThunderboltOutline,
  WalletOutline,
} from '@ant-design/icons-angular/icons';

import { ButtonAction, MAX_BUTTON_TEXT_LEN, MenuButton } from '../../types';
import { MenuTreeService } from '../menu-tree.service';
import { PropertyPanelComponent } from './property-panel.component';

/** 在根菜单添加一行一按钮并选中，返回该按钮 id。 */
function seedButton(tree: MenuTreeService, button: MenuButton): string {
  tree.addRow();
  tree.addButton(0, button);
  tree.$selectedButtonId.set(button.id);
  return button.id;
}

describe('PropertyPanelComponent', () => {
  let component: PropertyPanelComponent;
  let fixture: ComponentFixture<PropertyPanelComponent>;
  let tree: MenuTreeService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PropertyPanelComponent, NzIconModule],
      providers: [
        MenuTreeService,
        {
          provide: NZ_ICONS,
          useValue: [
            BgColorsOutline,
            CodeOutline,
            DownOutline,
            EnvironmentOutline,
            FolderOutline,
            FontColorsOutline,
            HomeOutline,
            LinkOutline,
            MessageOutline,
            OrderedListOutline,
            RightOutline,
            ThunderboltOutline,
            WalletOutline,
          ],
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PropertyPanelComponent);
    component = fixture.componentInstance;
    tree = TestBed.inject(MenuTreeService);
    fixture.detectChanges();
  });

  // ---------- 空状态 / 基础渲染 ----------

  it('1. 未选中按钮时显示 nz-empty', () => {
    expect(component.$selectedButton()).toBeNull();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('nz-empty')).toBeTruthy();
    expect(el.querySelector('.property-form')).toBeNull();
  });

  it('2. 选中按钮后显示属性编辑表单（隐藏 nz-empty）', () => {
    seedButton(tree, { id: 'b1', text: '按钮A', action: ButtonAction.TEXT, message: 'hi' });
    fixture.detectChanges();

    expect(component.$selectedButton()?.id).toBe('b1');
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('nz-empty')).toBeNull();
    expect(el.querySelector('.property-form')).toBeTruthy();
  });

  // ---------- 按钮文本 ----------

  it('3. updateText 调用 tree.updateButton 传 {text: newValue}', () => {
    const id = seedButton(tree, { id: 'b1', text: '原文本', action: ButtonAction.TEXT, message: '' });
    fixture.detectChanges();

    const spy = spyOn(tree, 'updateButton').and.callThrough();
    component.updateText('新文本');

    expect(spy).toHaveBeenCalledWith(id, { text: '新文本' });
  });

  it('4. 文本超 64 字符时 UI 显示错误提示，但仍会调用 updateButton（即时编辑）', () => {
    const id = seedButton(tree, { id: 'b1', text: '短', action: ButtonAction.TEXT, message: '' });
    fixture.detectChanges();

    const tooLong = 'a'.repeat(MAX_BUTTON_TEXT_LEN + 1);
    const spy = spyOn(tree, 'updateButton').and.callThrough();
    component.updateText(tooLong);
    expect(spy).toHaveBeenCalledWith(id, { text: tooLong });

    expect(component.$textError()).toBeTruthy();
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('64');
  });

  it('4b. 文本空白时 $textError 非空', () => {
    seedButton(tree, { id: 'b1', text: '有内容', action: ButtonAction.TEXT, message: '' });
    fixture.detectChanges();

    component.updateText('   ');
    expect(component.$textError()).toBeTruthy();
  });

  // ---------- action 切换清理 ----------

  it('5. 切换 action：URL → TEXT，patch 包含 url: undefined, message: ""', () => {
    const id = seedButton(tree, {
      id: 'b1',
      text: 'x',
      action: ButtonAction.URL,
      url: 'https://a',
    });
    fixture.detectChanges();

    const spy = spyOn(tree, 'updateButton').and.callThrough();
    component.updateAction(ButtonAction.TEXT);

    expect(spy).toHaveBeenCalledTimes(1);
    const [btnId, patch] = spy.calls.mostRecent().args as [string, Partial<MenuButton>];
    expect(btnId).toBe(id);
    expect(patch.action).toBe(ButtonAction.TEXT);
    expect('url' in patch).toBeTrue();
    expect(patch.url).toBeUndefined();
    expect(patch.message).toBe('');
    // 最终写入 store 后 url 字段应被移除/为 undefined
    const after = tree.$currentMenu()[0].buttons[0];
    expect(after.action).toBe(ButtonAction.TEXT);
    expect(after.url).toBeUndefined();
    expect(after.message).toBe('');
  });

  it('6. 切换 action：TEXT → SUBMENU，patch 包含 message: undefined, submenu: []', () => {
    seedButton(tree, {
      id: 'b1',
      text: 'x',
      action: ButtonAction.TEXT,
      message: '你好',
    });
    fixture.detectChanges();

    const spy = spyOn(tree, 'updateButton').and.callThrough();
    component.updateAction(ButtonAction.SUBMENU);

    const patch = spy.calls.mostRecent().args[1] as Partial<MenuButton>;
    expect(patch.action).toBe(ButtonAction.SUBMENU);
    expect('message' in patch).toBeTrue();
    expect(patch.message).toBeUndefined();
    expect(patch.submenu).toEqual([]);
  });

  it('7. 切换 action：SUBMENU → ENERGY_PACKAGE_GROUP，patch 包含 packageGroup 默认值', () => {
    seedButton(tree, {
      id: 'b1',
      text: 'x',
      action: ButtonAction.SUBMENU,
      submenu: [],
    });
    fixture.detectChanges();

    const spy = spyOn(tree, 'updateButton').and.callThrough();
    component.updateAction(ButtonAction.ENERGY_PACKAGE_GROUP);

    const patch = spy.calls.mostRecent().args[1] as Partial<MenuButton>;
    expect(patch.action).toBe(ButtonAction.ENERGY_PACKAGE_GROUP);
    expect('submenu' in patch).toBeTrue();
    expect(patch.submenu).toBeUndefined();
    expect(patch.packageGroup).toEqual({ packageIds: [], sortBy: 'price_asc', textTemplate: '' });
  });

  it('7b. 切换相同 action 到自身：保留现有字段（不重置）', () => {
    seedButton(tree, {
      id: 'b1',
      text: 'x',
      action: ButtonAction.URL,
      url: 'https://keep.me',
    });
    fixture.detectChanges();

    const spy = spyOn(tree, 'updateButton').and.callThrough();
    component.updateAction(ButtonAction.URL);

    const patch = spy.calls.mostRecent().args[1] as Partial<MenuButton>;
    expect(patch.url).toBe('https://keep.me');
  });

  // ---------- action 下字段编辑 ----------

  it('8. URL action 下，updateURL 调 tree.updateButton 传 {url: newValue}', () => {
    const id = seedButton(tree, {
      id: 'b1',
      text: 'x',
      action: ButtonAction.URL,
      url: '',
    });
    fixture.detectChanges();

    const spy = spyOn(tree, 'updateButton').and.callThrough();
    component.updateURL('https://example.com');

    expect(spy).toHaveBeenCalledWith(id, { url: 'https://example.com' });
  });

  it('9. TEXT action 下，updateMessage 调 tree.updateButton', () => {
    const id = seedButton(tree, {
      id: 'b1',
      text: 'x',
      action: ButtonAction.TEXT,
      message: '',
    });
    fixture.detectChanges();

    const spy = spyOn(tree, 'updateButton').and.callThrough();
    component.updateMessage('欢迎光临');

    expect(spy).toHaveBeenCalledWith(id, { message: '欢迎光临' });
  });

  it('10. COMMAND action 下，updateCommand 调 tree.updateButton', () => {
    const id = seedButton(tree, {
      id: 'b1',
      text: 'x',
      action: ButtonAction.COMMAND,
      command: '/start',
    });
    fixture.detectChanges();

    const spy = spyOn(tree, 'updateButton').and.callThrough();
    component.updateCommand('/help');

    expect(spy).toHaveBeenCalledWith(id, { command: '/help' });
  });

  // ---------- START/ADDRESS_MANAGE/WALLET_QUERY/ORDERS ----------

  it('11. START 等无配置 action 显示"无需额外配置"提示', () => {
    const noConfigActions = [
      ButtonAction.START,
      ButtonAction.ADDRESS_MANAGE,
      ButtonAction.WALLET_QUERY,
      ButtonAction.ORDERS,
    ];
    for (const action of noConfigActions) {
      tree.setRootMenu([]);
      seedButton(tree, { id: 'b1', text: 'x', action });
      fixture.detectChanges();
      const text = fixture.nativeElement.textContent as string;
      expect(text).withContext(`action=${action}`).toContain('无需额外配置');
    }
  });

  // ---------- SUBMENU ----------

  it('12. SUBMENU action 下显示"进入子菜单"按钮，点击调 tree.enterSubmenu', () => {
    const id = seedButton(tree, {
      id: 'b1',
      text: '子菜单按钮',
      action: ButtonAction.SUBMENU,
      submenu: [],
    });
    fixture.detectChanges();

    const spy = spyOn(tree, 'enterSubmenu').and.callThrough();
    const btnEl = fixture.debugElement.query(By.css('.property-enter-submenu'));
    expect(btnEl)
      .withContext('期望存在 class=property-enter-submenu 的按钮')
      .toBeTruthy();
    (btnEl.nativeElement as HTMLButtonElement).click();

    expect(spy).toHaveBeenCalledWith(id);
  });

  // ---------- ENERGY_PACKAGE_GROUP ----------

  it('13. ENERGY_PACKAGE_GROUP 的 packageIds CSV 输入解析为 number[]', () => {
    const id = seedButton(tree, {
      id: 'b1',
      text: 'x',
      action: ButtonAction.ENERGY_PACKAGE_GROUP,
      packageGroup: { packageIds: [], sortBy: 'price_asc', textTemplate: '' },
    });
    fixture.detectChanges();

    const spy = spyOn(tree, 'updateButton').and.callThrough();
    component.updatePackageGroupIdsCsv('1,2,3');

    expect(spy).toHaveBeenCalled();
    const patch = spy.calls.mostRecent().args[1] as Partial<MenuButton>;
    expect(patch.packageGroup?.packageIds).toEqual([1, 2, 3]);
    expect(patch.packageGroup?.sortBy).toBe('price_asc');
    expect(patch.packageGroup?.textTemplate).toBe('');
    // 实际写入也验证
    const after = tree.$currentMenu()[0].buttons[0];
    expect(after.packageGroup?.packageIds).toEqual([1, 2, 3]);
    expect(after.id).toBe(id);
  });

  it('13b. packageIds CSV 含非数字时过滤掉（"1, a, 2, ,3" → [1,2,3])', () => {
    seedButton(tree, {
      id: 'b1',
      text: 'x',
      action: ButtonAction.ENERGY_PACKAGE_GROUP,
      packageGroup: { packageIds: [], sortBy: 'price_asc', textTemplate: '' },
    });
    fixture.detectChanges();

    component.updatePackageGroupIdsCsv('1, a, 2, ,3');
    const after = tree.$currentMenu()[0].buttons[0];
    expect(after.packageGroup?.packageIds).toEqual([1, 2, 3]);
  });

  it('14. ENERGY_PACKAGE_GROUP 的 sortBy select 更新调 updateButton', () => {
    seedButton(tree, {
      id: 'b1',
      text: 'x',
      action: ButtonAction.ENERGY_PACKAGE_GROUP,
      packageGroup: { packageIds: [1, 2], sortBy: 'price_asc', textTemplate: '模板' },
    });
    fixture.detectChanges();

    component.updatePackageGroupSortBy('price_desc');

    const after = tree.$currentMenu()[0].buttons[0];
    expect(after.packageGroup?.sortBy).toBe('price_desc');
    // 其他字段保留
    expect(after.packageGroup?.packageIds).toEqual([1, 2]);
    expect(after.packageGroup?.textTemplate).toBe('模板');
  });

  it('14b. ENERGY_PACKAGE_GROUP 的 textTemplate 输入调 updateButton，packageIds 保留', () => {
    seedButton(tree, {
      id: 'b1',
      text: 'x',
      action: ButtonAction.ENERGY_PACKAGE_GROUP,
      packageGroup: { packageIds: [7], sortBy: 'manual', textTemplate: '' },
    });
    fixture.detectChanges();

    component.updatePackageGroupTemplate('新模板 {price}');

    const after = tree.$currentMenu()[0].buttons[0];
    expect(after.packageGroup?.textTemplate).toBe('新模板 {price}');
    expect(after.packageGroup?.packageIds).toEqual([7]);
    expect(after.packageGroup?.sortBy).toBe('manual');
  });

  // ---------- 按钮样式 ----------

  it('15. 样式颜色修改：updateStyle 调 tree.updateButton，bgColor 写入 style', () => {
    seedButton(tree, {
      id: 'b1',
      text: 'x',
      action: ButtonAction.TEXT,
      message: '',
    });
    fixture.detectChanges();

    component.updateStyle({ bgColor: '#ff0000' });

    const after = tree.$currentMenu()[0].buttons[0];
    expect(after.style?.bgColor).toBe('#ff0000');
  });

  it('15b. 样式 textColor 修改不影响已存在的 bgColor', () => {
    seedButton(tree, {
      id: 'b1',
      text: 'x',
      action: ButtonAction.TEXT,
      message: '',
      style: { bgColor: '#ff0000' },
    });
    fixture.detectChanges();

    component.updateStyle({ textColor: '#00ff00' });

    const after = tree.$currentMenu()[0].buttons[0];
    expect(after.style?.bgColor).toBe('#ff0000');
    expect(after.style?.textColor).toBe('#00ff00');
  });

  // ---------- 附加：$selectedButton 深度搜索 ----------

  it('16. $selectedButton 能从深层 submenu 中找到按钮', () => {
    tree.setRootMenu([
      {
        id: 'r1',
        buttons: [
          {
            id: 'sub1',
            text: '子菜单',
            action: ButtonAction.SUBMENU,
            submenu: [
              {
                id: 'r2',
                buttons: [
                  {
                    id: 'deep',
                    text: '深层按钮',
                    action: ButtonAction.TEXT,
                    message: 'deep',
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);
    tree.$selectedButtonId.set('deep');
    fixture.detectChanges();

    expect(component.$selectedButton()?.id).toBe('deep');
    expect(component.$selectedButton()?.text).toBe('深层按钮');
  });
});
