import { normalizeMenuAuthCodes } from './auth-menu-policy';

describe('normalizeMenuAuthCodes', () => {
  it('hides the user recharge page from platform administrators', () => {
    const codes = normalizeMenuAuthCodes([
      'default:energy-rental',
      'default:energy-rental:dashboard',
      'default:energy-rental:bot-config',
      'default:energy-rental:agent-recharge',
      'default:energy-rental:platform-config',
    ]);

    expect(codes).not.toContain('default:energy-rental:agent-recharge');
    expect(codes).toContain('default:energy-rental:platform-config');
  });

  it('keeps the user recharge page for normal users', () => {
    const codes = normalizeMenuAuthCodes([
      'default:energy-rental',
      'default:energy-rental:dashboard',
      'default:energy-rental:bot-config',
      'default:energy-rental:agent-recharge',
    ]);

    expect(codes).toContain('default:energy-rental:agent-recharge');
  });
});
