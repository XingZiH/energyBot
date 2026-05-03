import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs/operators';

import {
  MyLicenseService,
  MyLicenseView,
} from '@services/account/my-license.service';
import { PageHeaderType, PageHeaderComponent } from '@shared/components/page-header/page-header.component';

import { Clipboard } from '@angular/cdk/clipboard';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzDescriptionsModule } from 'ng-zorro-antd/descriptions';
import { NzDividerModule } from 'ng-zorro-antd/divider';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzSpaceModule } from 'ng-zorro-antd/space';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzTypographyModule } from 'ng-zorro-antd/typography';

/**
 * 终端客户自助「我的 License」页面。
 *
 * 交互：
 * - 进入页面即 findMine()；根据 licenseStatus 分三路展示
 *   - none：提示未颁发，引导联系管理员
 *   - active：大号绿色 key + 最近心跳；按钮"查看安装命令"展开命令（需 reveal 权限）
 *   - revoked：红色徽章 + 吊销时间 + 原因；按钮"查看安装命令"按钮隐藏（吊销后没必要展示）
 * - 安装命令一键复制
 *
 * 权限兜底：
 * - 路由菜单 code = default:account:my-license，由后端按 role 下发
 * - 即使管理员账号进入此页也能正常工作（后端会返回 404"当前账号未绑定客户"，页面展示相应空状态）
 */
@Component({
  selector: 'app-my-license',
  templateUrl: './my-license.component.html',
  styleUrl: './my-license.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    PageHeaderComponent,
    NzAlertModule,
    NzButtonModule,
    NzCardModule,
    NzDescriptionsModule,
    NzDividerModule,
    NzEmptyModule,
    NzIconModule,
    NzSpaceModule,
    NzSpinModule,
    NzTagModule,
    NzTypographyModule,
  ],
})
export class MyLicenseComponent implements OnInit {
  readonly pageHeaderInfo: Partial<PageHeaderType> = {
    title: '我的 License',
    breadcrumb: ['首页', '我的 License'],
    desc: '查看自己账号下的 license 状态与一键部署命令。凭据仅本人可见。',
  };

  readonly loading = signal(false);
  readonly loadingInstall = signal(false);
  readonly view = signal<MyLicenseView | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly installCommand = signal<string | null>(null);

  private destroyRef = inject(DestroyRef);
  private dataService = inject(MyLicenseService);
  private message = inject(NzMessageService);
  private clipboard = inject(Clipboard);

  ngOnInit(): void {
    this.loadView();
  }

  loadView(): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    this.dataService
      .findMine()
      .pipe(
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: v => this.view.set(v),
        error: err => {
          // 后端 404（未绑定客户）在本页属于"空状态"，不是 toast 报错
          const msg = err?.error?.msg || err?.message || '加载失败';
          this.errorMessage.set(msg);
        },
      });
  }

  revealInstallCommand(): void {
    this.loadingInstall.set(true);
    this.dataService
      .getInstallCommand()
      .pipe(
        finalize(() => this.loadingInstall.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ installCommand }) => this.installCommand.set(installCommand),
        error: err => {
          const msg = err?.error?.msg || err?.message || '获取安装命令失败';
          this.message.error(msg);
        },
      });
  }

  hideInstallCommand(): void {
    this.installCommand.set(null);
  }

  copy(text: string | null | undefined, label: string): void {
    if (!text) {
      this.message.warning('暂无可复制内容');
      return;
    }
    if (this.clipboard.copy(text)) {
      this.message.success(`${label} 已复制到剪贴板`);
    } else {
      this.message.error(`${label} 复制失败，请手动选中`);
    }
  }
}
