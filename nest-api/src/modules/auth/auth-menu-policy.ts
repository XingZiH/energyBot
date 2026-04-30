const PLATFORM_ADMIN_MARKER_CODE = 'default:energy-rental:platform-config';
const USER_RECHARGE_MENU_CODE = 'default:energy-rental:agent-recharge';

export function normalizeMenuAuthCodes(authCode: string[]) {
  if (!authCode.includes(PLATFORM_ADMIN_MARKER_CODE)) {
    return authCode;
  }
  return authCode.filter((code) => code !== USER_RECHARGE_MENU_CODE);
}
