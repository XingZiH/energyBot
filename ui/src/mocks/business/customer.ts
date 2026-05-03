import { http, HttpResponse } from 'msw';

/**
 * Customer 与 License MSW 模拟数据。
 *
 * 目的：
 * - 在不启真实后端的情况下允许前端跑完整客户管理流程
 * - 覆盖后端 /customer/* 与公开 /license/precheck 路由
 *
 * 实现要点：
 * - 内存态 `customers` / `licenses`；重启页面后重置
 * - create 事务化地生成 customer + 初始 license + installCommand（secret 随机）
 * - precheck 简化：只做 key 存在性 + revoke 状态校验；签名时戳等不做，保持 mock 简单
 */

interface MockCustomer {
  id: number;
  name: string;
  contact: string | null;
  remark: string | null;
  status: 'active' | 'suspended';
  createdBy: number;
  createdAt: string;
  deletedAt: string | null;
}

interface MockLicense {
  id: number;
  customerId: number;
  licenseKey: string;
  licenseSecret: string; // mock 存明文（真实后端存 AES-GCM 密文）
  issuedAt: string;
  issuedBy: number;
  revokedAt: string | null;
  revokedReason: string | null;
  lastSeenAt: string | null;
}

let customers: MockCustomer[] = [
  {
    id: 1,
    name: '示例客户（Mock）',
    contact: 'tg:@demo',
    remark: '用于演示，可随意修改',
    status: 'active',
    createdBy: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
  },
];

let licenses: MockLicense[] = [
  {
    id: 1,
    customerId: 1,
    licenseKey: 'ebt_demo0000000000000000demo',
    licenseSecret: 'mock_secret_demo_base64url_32b',
    issuedAt: '2026-01-01T00:00:00.000Z',
    issuedBy: 1,
    revokedAt: null,
    revokedReason: null,
    lastSeenAt: null,
  },
];

let nextCustomerId = 2;
let nextLicenseId = 2;

/** 生成随机 base58 风格 license key（mock 用途，不保证 base58 严格）。 */
function randomLicenseKey(): string {
  const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let s = 'ebt_';
  for (let i = 0; i < 32; i += 1) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}

function randomSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function buildInstallCommand(key: string, secret: string): string {
  return `curl -sSL https://install.energybot.example/install.sh | sudo bash -s -- \\\n  --license-key=${key} \\\n  --license-secret=${secret}`;
}

function enrichForList(rows: MockCustomer[]) {
  return rows.map(c => {
    const active = licenses.find(
      l => l.customerId === c.id && l.revokedAt === null,
    );
    return {
      id: c.id,
      name: c.name,
      contact: c.contact,
      remark: c.remark,
      status: c.status,
      createdBy: c.createdBy,
      createdAt: c.createdAt,
      hasActiveLicense: !!active,
      activeLicenseKey: active?.licenseKey ?? null,
      lastSeenAt: active?.lastSeenAt ?? null,
    };
  });
}

export const customer = [
  http.post('/site/api/customer/list', async ({ request }) => {
    const body = (await request.json()) as {
      pageIndex: number;
      pageSize: number;
      filters?: { name?: string; status?: 'active' | 'suspended' | 'all' };
    };
    const pageIndex = Math.max(1, body.pageIndex ?? 1);
    const pageSize = body.pageSize > 0 ? body.pageSize : 10;

    let list = customers.filter(c => c.deletedAt === null);
    if (body.filters?.name) {
      const kw = body.filters.name.toLowerCase();
      list = list.filter(c => c.name.toLowerCase().includes(kw));
    }
    if (body.filters?.status && body.filters.status !== 'all') {
      list = list.filter(c => c.status === body.filters!.status);
    }

    const total = list.length;
    const start = (pageIndex - 1) * pageSize;
    const slice = list.slice(start, start + pageSize);
    return HttpResponse.json({
      code: 200,
      msg: 'SUCCESS',
      data: {
        total,
        pageIndex,
        pageSize,
        list: enrichForList(slice),
      },
    });
  }),

  http.get('/site/api/customer/:id', ({ params }) => {
    const id = Number(params['id']);
    const c = customers.find(x => x.id === id && x.deletedAt === null);
    if (!c) {
      return HttpResponse.json(
        { code: 404, msg: '客户不存在', data: null },
        { status: 404 },
      );
    }
    const lic = licenses
      .filter(l => l.customerId === id)
      .map(l => ({
        id: l.id,
        licenseKey: l.licenseKey,
        issuedAt: l.issuedAt,
        revokedAt: l.revokedAt,
        revokedReason: l.revokedReason,
        lastSeenAt: l.lastSeenAt,
      }));
    return HttpResponse.json({
      code: 200,
      msg: 'SUCCESS',
      data: { ...c, licenses: lic },
    });
  }),

  http.post('/site/api/customer/create', async ({ request }) => {
    const body = (await request.json()) as {
      name: string;
      contact?: string;
      remark?: string;
    };
    const now = new Date().toISOString();
    const c: MockCustomer = {
      id: nextCustomerId++,
      name: body.name,
      contact: body.contact ?? null,
      remark: body.remark ?? null,
      status: 'active',
      createdBy: 1,
      createdAt: now,
      deletedAt: null,
    };
    customers.push(c);

    const licenseKey = randomLicenseKey();
    const licenseSecret = randomSecret();
    licenses.push({
      id: nextLicenseId++,
      customerId: c.id,
      licenseKey,
      licenseSecret,
      issuedAt: now,
      issuedBy: 1,
      revokedAt: null,
      revokedReason: null,
      lastSeenAt: null,
    });

    return HttpResponse.json({
      code: 200,
      msg: 'SUCCESS',
      data: {
        customerId: c.id,
        licenseKey,
        licenseSecret,
        installCommand: buildInstallCommand(licenseKey, licenseSecret),
      },
    });
  }),

  http.put('/site/api/customer/update', async ({ request }) => {
    const body = (await request.json()) as Partial<MockCustomer> & { id: number };
    const idx = customers.findIndex(c => c.id === body.id && c.deletedAt === null);
    if (idx === -1) {
      return HttpResponse.json(
        { code: 404, msg: '客户不存在', data: null },
        { status: 404 },
      );
    }
    customers[idx] = { ...customers[idx], ...body };
    return HttpResponse.json({ code: 200, msg: 'SUCCESS', data: null });
  }),

  http.post('/site/api/customer/revoke-license', async ({ request }) => {
    const body = (await request.json()) as { customerId: number; reason?: string };
    const now = new Date().toISOString();
    let revokedCount = 0;
    licenses = licenses.map(l => {
      if (l.customerId === body.customerId && l.revokedAt === null) {
        revokedCount += 1;
        return {
          ...l,
          revokedAt: now,
          revokedReason: body.reason ?? null,
        };
      }
      return l;
    });
    return HttpResponse.json({
      code: 200,
      msg: 'SUCCESS',
      data: { revokedCount },
    });
  }),

  http.post('/site/api/customer/reissue-license', async ({ request }) => {
    const body = (await request.json()) as { customerId: number; reason?: string };
    const c = customers.find(
      x => x.id === body.customerId && x.deletedAt === null,
    );
    if (!c) {
      return HttpResponse.json(
        { code: 404, msg: '客户不存在', data: null },
        { status: 404 },
      );
    }
    const now = new Date().toISOString();
    licenses = licenses.map(l =>
      l.customerId === c.id && l.revokedAt === null
        ? { ...l, revokedAt: now, revokedReason: body.reason ?? 'reissue' }
        : l,
    );
    const licenseKey = randomLicenseKey();
    const licenseSecret = randomSecret();
    licenses.push({
      id: nextLicenseId++,
      customerId: c.id,
      licenseKey,
      licenseSecret,
      issuedAt: now,
      issuedBy: 1,
      revokedAt: null,
      revokedReason: null,
      lastSeenAt: null,
    });
    return HttpResponse.json({
      code: 200,
      msg: 'SUCCESS',
      data: {
        licenseKey,
        licenseSecret,
        installCommand: buildInstallCommand(licenseKey, licenseSecret),
      },
    });
  }),

  http.get('/site/api/customer/:id/install-command', ({ params }) => {
    const id = Number(params['id']);
    const active = licenses.find(l => l.customerId === id && l.revokedAt === null);
    if (!active) {
      return HttpResponse.json(
        { code: 404, msg: '该客户无有效 license', data: null },
        { status: 404 },
      );
    }
    return HttpResponse.json({
      code: 200,
      msg: 'SUCCESS',
      data: {
        installCommand: buildInstallCommand(active.licenseKey, active.licenseSecret),
      },
    });
  }),

  // 公开 precheck（无 /site/api 前缀，走独立 /api/v1/ 端点）
  http.post('/api/v1/license/precheck', async ({ request }) => {
    const key = request.headers.get('x-license-key') ?? '';
    const active = licenses.find(l => l.licenseKey === key);
    if (!active) {
      return HttpResponse.json(
        { code: 401, msg: 'key_not_found', data: { error: 'key_not_found' } },
        { status: 401 },
      );
    }
    if (active.revokedAt) {
      return HttpResponse.json(
        { code: 401, msg: 'license_revoked', data: { error: 'license_revoked' } },
        { status: 401 },
      );
    }
    const customer = customers.find(c => c.id === active.customerId);
    if (!customer || customer.status === 'suspended') {
      return HttpResponse.json(
        {
          code: 401,
          msg: 'customer_suspended',
          data: { error: 'customer_suspended' },
        },
        { status: 401 },
      );
    }
    active.lastSeenAt = new Date().toISOString();
    return HttpResponse.json({
      code: 200,
      msg: 'SUCCESS',
      data: { customerId: active.customerId, status: 'ok' },
    });
  }),
];
