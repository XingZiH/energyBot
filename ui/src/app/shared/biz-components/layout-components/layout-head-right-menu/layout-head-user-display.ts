import { UserInfo } from '@store/common-store/userInfo-store.service';

export function getHeaderUserDisplayName(userInfo: UserInfo): string {
  const name = userInfo.userName.trim();
  return name || '用户';
}
