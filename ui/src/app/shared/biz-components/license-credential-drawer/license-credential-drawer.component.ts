import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { LicenseCredential } from '@services/system/customer.service';

import { Clipboard } from '@angular/cdk/clipboard';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCheckboxModule } from 'ng-zorro-antd/checkbox';
import { NzDescriptionsModule } from 'ng-zorro-antd/descriptions';
import { NzDividerModule } from 'ng-zorro-antd/divider';
import { NzDrawerModule } from 'ng-zorro-antd/drawer';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';
import { NzSpaceModule } from 'ng-zorro-antd/space';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzTypographyModule } from 'ng-zorro-antd/typography';

/**
 * License 凭据抽屉（一次性展示）。
 *
 * 使用场景：
 * - 创建客户成功后展示 licenseKey + secret + installCommand
 * - 重新颁发 license 后同上
 * - reveal 权限用户点击"查看 install 命令"（当前版本 installCommand-only，不回显 secret）
 *
 * 设计约束：
 * - secret 是敏感信息，抽屉关闭后不再能拿回，必须在抽屉内提供拷贝与确认保存机制
 * - 用户必须勾选"我已安全保存"才能关闭（防误关导致客户丢凭据）
 * - 提供 docker 脚本命令块，并支持整行一键复制
 *
 * 组件对外 API：
 * - visible (input signal，双向驱动 nz-drawer)
 * - credential (input) 传入一次性凭据；为 null 时抽屉内容隐藏
 * - visibleChange (output)：抽屉关闭事件
 */
@Component({
  selector: 'app-license-credential-drawer',
  templateUrl: './license-credential-drawer.component.html',
  styleUrl: './license-credential-drawer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    NzDrawerModule,
    NzAlertModule,
    NzButtonModule,
    NzCheckboxModule,
    NzDescriptionsModule,
    NzDividerModule,
    NzIconModule,
    NzSpaceModule,
    NzTagModule,
    NzTypographyModule,
  ],
})
export class LicenseCredentialDrawerComponent {
  readonly visible = input.required<boolean>();
  readonly credential = input<LicenseCredential | null>(null);
  /**
   * 抽屉标题（默认"License 凭据"）；reveal 场景调用方可传"install 命令"。
   */
  readonly title = input<string>('License 凭据');
  /**
   * 是否在抽屉中展示 secret；reveal 场景（后端没有下发 licenseSecret 字段时）可传 false。
   */
  readonly showSecret = input<boolean>(true);

  readonly visibleChange = output<boolean>();

  /** 用户确认已保存的勾选状态；未勾选时禁止关闭。 */
  readonly confirmed = signal(false);

  private clipboard = inject(Clipboard);
  private message = inject(NzMessageService);
  private modal = inject(NzModalService);

  readonly canClose = computed(() => this.confirmed());

  copy(text: string | undefined | null, label: string): void {
    if (!text) {
      this.message.warning('暂无可复制的内容');
      return;
    }
    if (this.clipboard.copy(text)) {
      this.message.success(`${label} 已复制到剪贴板`);
    } else {
      this.message.error(`${label} 复制失败，请手动选中`);
    }
  }

  onClose(): void {
    if (!this.canClose()) {
      this.modal.warning({
        nzTitle: '确认保存凭据',
        nzContent:
          '关闭后将无法再次查看 licenseSecret，请先勾选"我已安全保存凭据"再关闭抽屉。',
      });
      return;
    }
    this.visibleChange.emit(false);
    // 重置状态，下次打开时需要重新勾选
    this.confirmed.set(false);
  }
}
