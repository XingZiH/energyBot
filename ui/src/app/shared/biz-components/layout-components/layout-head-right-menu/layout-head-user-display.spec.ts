import { getHeaderUserDisplayName } from './layout-head-user-display';

describe('header user display name', () => {
  it('uses the current logged-in user name', () => {
    expect(getHeaderUserDisplayName({ userId: 12, userName: 'maer-user', authCode: [] })).toBe('maer-user');
  });

  it('falls back to a neutral Chinese label when the token has no user name', () => {
    expect(getHeaderUserDisplayName({ userId: -1, userName: '  ', authCode: [] })).toBe('用户');
  });
});
