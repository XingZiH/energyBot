import type { Data } from '@angular/router';

export const SKIP_MENU_AUTH = 'skipMenuAuth' as const;

export function shouldSkipMenuAuth(data: Data | null | undefined): boolean {
  return data?.[SKIP_MENU_AUTH] === true;
}
