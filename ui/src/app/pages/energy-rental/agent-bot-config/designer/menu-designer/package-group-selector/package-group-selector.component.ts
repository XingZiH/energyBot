import {
  CdkDragDrop,
  DragDropModule,
} from '@angular/cdk/drag-drop';
import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzTagModule } from 'ng-zorro-antd/tag';

import {
  EnergyPackage,
  EnergyPackageService,
} from '../../services/energy-package.service';

/**
 * PackageGroupSelector 套餐选择器（任务 18）。
 *
 * 替代 PropertyPanel 中 ENERGY_PACKAGE_GROUP 的 CSV 文本输入，提供：
 * 1. 已选套餐列表（cdkDropList 拖拽排序 + × 移除）
 * 2. "添加套餐"下拉（nz-select）展示未选中 & 已启用的套餐
 * 3. 加载 / 错误态
 *
 * 数据流：
 * - 父组件传入 `packageIds`（`number[]`）。
 * - 用户操作（添加 / 移除 / 排序）后 emit `packageIdsChange`。
 * - 父组件负责把新的 packageIds 写回 menu tree（见 PropertyPanel）。
 *
 * 注意：本组件不自行持久化 packageIds，只做 UI 同步；避免父子双向状态。
 */
@Component({
  selector: 'app-package-group-selector',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DragDropModule,
    NzButtonModule,
    NzEmptyModule,
    NzIconModule,
    NzSelectModule,
    NzSpinModule,
    NzTagModule,
  ],
  templateUrl: './package-group-selector.component.html',
  styleUrls: ['./package-group-selector.component.less'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PackageGroupSelectorComponent {
  /** 当前已选 packageIds（顺序敏感，UI 按此顺序展示）。 */
  readonly packageIds = input<number[]>([]);

  /** 当前 agent ID，用于筛选可见套餐；为 null 时不加载列表。 */
  readonly agentId = input<number | null>(null);

  /** 用户调整后的 packageIds。 */
  readonly packageIdsChange = output<number[]>();

  /** 加载到的全量套餐（全部 enabled + disabled）。 */
  readonly $allPackages = signal<EnergyPackage[]>([]);
  readonly $loading = signal<boolean>(false);
  readonly $error = signal<string | null>(null);

  /**
   * 当前已选套餐（按 packageIds 顺序 —— 非 allPackages 原始顺序）。
   *
   * 如果某个 packageId 在 allPackages 中找不到（例如数据过期），过滤掉而非渲染
   * 占位，避免 UI 崩溃；真实调试在控制台通过 $error 提示。
   */
  readonly selectedPackages = computed<EnergyPackage[]>(() => {
    const ids = this.packageIds();
    const byId = new Map(this.$allPackages().map((p) => [p.id, p]));
    const result: EnergyPackage[] = [];
    for (const id of ids) {
      const pkg = byId.get(id);
      if (pkg) result.push(pkg);
    }
    return result;
  });

  /** 可添加的套餐：排除已选 + 排除禁用。 */
  readonly availablePackages = computed<EnergyPackage[]>(() => {
    const selected = new Set(this.packageIds());
    return this.$allPackages().filter(
      (p) => p.enabled && !selected.has(p.id),
    );
  });

  private readonly pkgService = inject(EnergyPackageService);

  constructor() {
    // agentId 变化时重新加载套餐列表。
    effect(() => {
      const id = this.agentId();
      if (id === null || id === undefined) {
        this.$allPackages.set([]);
        this.$loading.set(false);
        this.$error.set(null);
        return;
      }
      this.$loading.set(true);
      this.$error.set(null);
      this.pkgService.listPackages(id).subscribe({
        next: (packages) => {
          this.$allPackages.set(packages);
          this.$loading.set(false);
        },
        error: () => {
          this.$error.set('加载套餐失败');
          this.$loading.set(false);
        },
      });
    });
  }

  /**
   * 拖拽排序：从 previousIndex 移到 currentIndex。
   *
   * 仅修改 packageIds 顺序，不触碰 allPackages。
   */
  onDrop(event: CdkDragDrop<EnergyPackage[]>): void {
    if (event.previousIndex === event.currentIndex) return;
    const ids = [...this.packageIds()];
    const [moved] = ids.splice(event.previousIndex, 1);
    ids.splice(event.currentIndex, 0, moved);
    this.packageIdsChange.emit(ids);
  }

  /** 从列表移除某个 packageId。 */
  removePackage(id: number): void {
    const next = this.packageIds().filter((x) => x !== id);
    this.packageIdsChange.emit(next);
  }

  /**
   * 添加一个套餐到末尾。
   *
   * nz-select 会在 nzAllowClear 触发时传入 `null`，此处提前返回忽略空值。
   * 已存在的 id 不会重复添加（理论上不会发生，因为 availablePackages 已排除）。
   */
  addPackage(id: number | null): void {
    if (id === null || id === undefined) return;
    const current = this.packageIds();
    if (current.includes(id)) return;
    this.packageIdsChange.emit([...current, id]);
  }

  /** trackBy：按 packageId 追踪，避免拖拽时 DOM 重建。 */
  trackById(_: number, pkg: EnergyPackage): number {
    return pkg.id;
  }
}
