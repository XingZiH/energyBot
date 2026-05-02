import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Observable, of, throwError } from 'rxjs';

import { NZ_ICONS, NzIconModule } from 'ng-zorro-antd/icon';
import {
  CloseOutline,
  CloseCircleOutline,
  DragOutline,
} from '@ant-design/icons-angular/icons';

import {
  EnergyPackage,
  EnergyPackageService,
} from '../../services/energy-package.service';
import { PackageGroupSelectorComponent } from './package-group-selector.component';

const MOCK_PACKAGES: EnergyPackage[] = [
  { id: 1, name: '套餐A', priceTRX: 10, energy: 32000, durationHours: 1, enabled: true },
  { id: 2, name: '套餐B', priceTRX: 20, energy: 65000, durationHours: 1, enabled: true },
  { id: 3, name: '套餐C', priceTRX: 30, energy: 100000, durationHours: 1, enabled: false },
  { id: 4, name: '套餐D', priceTRX: 40, energy: 130000, durationHours: 1, enabled: true },
];

class MockPackageService {
  listPackages = jasmine
    .createSpy('listPackages')
    .and.callFake(
      (_id: number): Observable<EnergyPackage[]> => of(MOCK_PACKAGES.slice()),
    );
}

describe('PackageGroupSelectorComponent', () => {
  let component: PackageGroupSelectorComponent;
  let fixture: ComponentFixture<PackageGroupSelectorComponent>;
  let svc: MockPackageService;

  beforeEach(async () => {
    svc = new MockPackageService();

    await TestBed.configureTestingModule({
      imports: [PackageGroupSelectorComponent, NzIconModule],
      providers: [
        { provide: EnergyPackageService, useValue: svc },
        {
          provide: NZ_ICONS,
          useValue: [CloseOutline, CloseCircleOutline, DragOutline],
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PackageGroupSelectorComponent);
    component = fixture.componentInstance;
  });

  /** 用 setInput 触发 agentId effect，并运行 change detection 让 mock service 生效。 */
  function setInputs(packageIds: number[], agentId: number | null): void {
    fixture.componentRef.setInput('packageIds', packageIds);
    fixture.componentRef.setInput('agentId', agentId);
    fixture.detectChanges();
  }

  // ---------- 空状态 ----------

  it('1. 无 packageIds 时显示 nz-empty 空提示', () => {
    setInputs([], 100);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('nz-empty')).toBeTruthy();
    expect(el.querySelector('.selected-list')).toBeNull();
  });

  // ---------- 渲染 ----------

  it('2. 有 packageIds 时渲染选中列表', () => {
    setInputs([1, 2], 100);

    const items = fixture.debugElement.queryAll(By.css('.selected-item'));
    expect(items.length).toBe(2);
    // 第一项名字为 套餐A
    const firstName = items[0].query(By.css('.package-name')).nativeElement as HTMLElement;
    expect(firstName.textContent).toContain('套餐A');
  });

  // ---------- 顺序 ----------

  it('3. selectedPackages 按 packageIds 顺序（不按 allPackages 原始顺序）', () => {
    setInputs([2, 1], 100);

    const selected = component.selectedPackages();
    expect(selected.map((p) => p.id)).toEqual([2, 1]);
    // 渲染顺序同步
    const names = fixture.debugElement
      .queryAll(By.css('.package-name'))
      .map((d) => (d.nativeElement as HTMLElement).textContent?.trim());
    expect(names).toEqual(['套餐B', '套餐A']);
  });

  // ---------- availablePackages 过滤 ----------

  it('4. availablePackages 排除已选 & 排除禁用套餐', () => {
    setInputs([1], 100);

    const available = component.availablePackages();
    // 原列表：1(启用),2(启用),3(禁用),4(启用) — 已选1 + 禁用3 排除 → 剩 2,4
    expect(available.map((p) => p.id)).toEqual([2, 4]);
  });

  // ---------- 添加 ----------

  it('5. 添加套餐：emit 新 packageIds（原 + 新 id 追加末尾）', () => {
    setInputs([1], 100);

    let emitted: number[] | undefined;
    component.packageIdsChange.subscribe((v) => (emitted = v));

    component.addPackage(2);
    expect(emitted).toEqual([1, 2]);
  });

  it('5b. addPackage(null) 被忽略（nzAllowClear 触发）', () => {
    setInputs([1], 100);
    const spy = jasmine.createSpy('emit');
    component.packageIdsChange.subscribe(spy);

    component.addPackage(null);
    expect(spy).not.toHaveBeenCalled();
  });

  it('5c. addPackage(重复id) 不重复添加', () => {
    setInputs([1, 2], 100);
    const spy = jasmine.createSpy('emit');
    component.packageIdsChange.subscribe(spy);

    component.addPackage(1);
    expect(spy).not.toHaveBeenCalled();
  });

  // ---------- 移除 ----------

  it('6. 移除套餐：emit 新 packageIds（少一个）', () => {
    setInputs([1, 2, 4], 100);

    let emitted: number[] | undefined;
    component.packageIdsChange.subscribe((v) => (emitted = v));

    component.removePackage(2);
    expect(emitted).toEqual([1, 4]);
  });

  // ---------- 拖拽排序 ----------

  it('7. 拖拽排序：emit 重新排列的 packageIds', () => {
    setInputs([1, 2, 4], 100);

    let emitted: number[] | undefined;
    component.packageIdsChange.subscribe((v) => (emitted = v));

    // 把第 0 位（id=1）移到第 2 位
    component.onDrop({
      previousIndex: 0,
      currentIndex: 2,
      item: {} as never,
      container: {} as never,
      previousContainer: {} as never,
      isPointerOverContainer: true,
      distance: { x: 0, y: 0 },
      dropPoint: { x: 0, y: 0 },
      event: {} as never,
    });
    expect(emitted).toEqual([2, 4, 1]);
  });

  it('7b. 拖拽到相同位置不 emit', () => {
    setInputs([1, 2], 100);
    const spy = jasmine.createSpy('emit');
    component.packageIdsChange.subscribe(spy);

    component.onDrop({
      previousIndex: 1,
      currentIndex: 1,
      item: {} as never,
      container: {} as never,
      previousContainer: {} as never,
      isPointerOverContainer: true,
      distance: { x: 0, y: 0 },
      dropPoint: { x: 0, y: 0 },
      event: {} as never,
    });
    expect(spy).not.toHaveBeenCalled();
  });

  // ---------- loading ----------

  it('8. loading 状态显示 nz-spin', () => {
    // agentId 设置会立即 loading=true 再 next 结束 loading；手动设置验证渲染。
    setInputs([], 100);
    component.$loading.set(true);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('nz-spin')).toBeTruthy();
  });

  // ---------- error ----------

  it('9. 错误状态显示错误文案', () => {
    svc.listPackages.and.returnValue(throwError(() => new Error('boom')));
    setInputs([], 100);

    expect(component.$error()).toBe('加载套餐失败');
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('加载套餐失败');
  });

  // ---------- agentId effect ----------

  it('10. agentId 变化触发重新加载（effect）', () => {
    setInputs([], 100);
    expect(svc.listPackages).toHaveBeenCalledWith(100);

    fixture.componentRef.setInput('agentId', 200);
    fixture.detectChanges();
    expect(svc.listPackages).toHaveBeenCalledWith(200);
    expect(svc.listPackages).toHaveBeenCalledTimes(2);
  });

  it('10b. agentId=null 时清空套餐，不调 service', () => {
    setInputs([], 100);
    svc.listPackages.calls.reset();

    fixture.componentRef.setInput('agentId', null);
    fixture.detectChanges();

    expect(svc.listPackages).not.toHaveBeenCalled();
    expect(component.$allPackages()).toEqual([]);
  });

  // ---------- 缺失 packageId 容错 ----------

  it('11. packageIds 中缺失的 id（allPackages 没有）被过滤，不崩溃', () => {
    setInputs([1, 999, 2], 100);

    // 999 不存在，应被过滤，列表只有 2 个
    expect(component.selectedPackages().map((p) => p.id)).toEqual([1, 2]);
    const items = fixture.debugElement.queryAll(By.css('.selected-item'));
    expect(items.length).toBe(2);
  });

  // ---------- 可用下拉禁用态 ----------

  it('12. 无可用套餐时下拉禁用（已选完 + 全禁用）', () => {
    // 只有 3 个启用套餐（1,2,4），全部选完
    setInputs([1, 2, 4], 100);

    expect(component.availablePackages().length).toBe(0);
    const selectEl = fixture.debugElement.query(By.css('nz-select'));
    expect(selectEl).toBeTruthy();
    // nz-select 接收了 nzDisabled=true；验证属性已绑定
    expect(selectEl.componentInstance.nzDisabled).toBe(true);
  });
});
