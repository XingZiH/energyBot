import { CdkDrag } from '@angular/cdk/drag-drop';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { NZ_ICONS, NzIconModule } from 'ng-zorro-antd/icon';
import {
  AppstoreOutline,
  CodeOutline,
  EnvironmentOutline,
  FolderOutline,
  HomeOutline,
  LinkOutline,
  MessageOutline,
  OrderedListOutline,
  ThunderboltOutline,
  WalletOutline,
} from '@ant-design/icons-angular/icons';

import { ButtonAction } from '../../types';
import { ComponentPaletteComponent, PaletteItem } from './component-palette.component';

describe('ComponentPaletteComponent', () => {
  let component: ComponentPaletteComponent;
  let fixture: ComponentFixture<ComponentPaletteComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ComponentPaletteComponent, NzIconModule],
      providers: [
        {
          provide: NZ_ICONS,
          useValue: [
            AppstoreOutline,
            CodeOutline,
            EnvironmentOutline,
            FolderOutline,
            HomeOutline,
            LinkOutline,
            MessageOutline,
            OrderedListOutline,
            ThunderboltOutline,
            WalletOutline,
          ],
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ComponentPaletteComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  // ---------- 配置数据 ----------
  it('paletteItems 长度为 9', () => {
    expect(component.paletteItems.length).toBe(9);
  });

  it('覆盖 ButtonAction 枚举全部 9 个值（无缺漏、无重复）', () => {
    const enumValues = Object.values(ButtonAction);
    const paletteActions = component.paletteItems.map((i) => i.action);

    // 无重复
    expect(new Set(paletteActions).size).toBe(paletteActions.length);

    // 每个 enum 值都出现
    for (const v of enumValues) {
      expect(paletteActions).toContain(v);
    }
    // 长度相等 => 没有多余
    expect(paletteActions.length).toBe(enumValues.length);
  });

  it('所有 title 非空字符串', () => {
    for (const item of component.paletteItems) {
      expect(typeof item.title).toBe('string');
      expect(item.title.length).toBeGreaterThan(0);
    }
  });

  it('所有 description 非空字符串', () => {
    for (const item of component.paletteItems) {
      expect(typeof item.description).toBe('string');
      expect(item.description.length).toBeGreaterThan(0);
    }
  });

  it('所有 icon 非空字符串', () => {
    for (const item of component.paletteItems) {
      expect(typeof item.icon).toBe('string');
      expect(item.icon.length).toBeGreaterThan(0);
    }
  });

  // ---------- DOM 渲染 ----------
  it('渲染 9 个 cdkDrag 卡片', () => {
    const dragEls = fixture.debugElement.queryAll(By.directive(CdkDrag));
    expect(dragEls.length).toBe(9);
  });

  it('每个 cdkDrag 指令持有与 paletteItems 对应的 PaletteItem', () => {
    const dragEls = fixture.debugElement.queryAll(By.directive(CdkDrag));
    expect(dragEls.length).toBe(9);

    const datas: PaletteItem[] = dragEls.map(
      (d) => d.injector.get(CdkDrag).data as PaletteItem,
    );

    for (const d of datas) {
      expect(d).toBeTruthy();
      expect(typeof d.action).toBe('string');
      expect(typeof d.icon).toBe('string');
      expect(typeof d.title).toBe('string');
      expect(typeof d.description).toBe('string');
    }

    // 顺序应与 paletteItems 一致
    expect(datas.map((d) => d.action)).toEqual(component.paletteItems.map((i) => i.action));
    expect(datas.map((d) => d.icon)).toEqual(component.paletteItems.map((i) => i.icon));
  });
});
