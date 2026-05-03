import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { WindowService } from '@core/services/common/window.service';
import { httpInterceptorService } from '@core/services/interceptors/http-interceptor';

import { NzMessageService } from 'ng-zorro-antd/message';

import { BaseHttpService } from './base-http.service';

@Injectable()
class TestBaseHttpService extends BaseHttpService {
  constructor() {
    super();
  }
}

describe('BaseHttpService', () => {
  let service: TestBaseHttpService;
  let httpTesting: HttpTestingController;
  let message: jasmine.SpyObj<Pick<NzMessageService, 'error' | 'success' | 'loading' | 'remove'>>;

  beforeEach(() => {
    message = jasmine.createSpyObj('NzMessageService', ['error', 'success', 'loading', 'remove']);
    message.loading.and.returnValue({ messageId: 'loading-id' } as never);

    TestBed.configureTestingModule({
      providers: [
        TestBaseHttpService,
        provideHttpClient(withInterceptors([httpInterceptorService])),
        provideHttpClientTesting(),
        {
          provide: WindowService,
          useValue: {
            getSessionStorage: jasmine.createSpy('getSessionStorage').and.returnValue(null)
          }
        },
        {
          provide: NzMessageService,
          useValue: message
        }
      ]
    });

    service = TestBed.inject(TestBaseHttpService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
  });

  it('shows the backend message when login returns a raw HTTP error', done => {
    service.post('/auth/signin', { userName: 'admin', password: 'wrong' }, { needSuccessInfo: false }).subscribe({
      next: () => done.fail('expected login request to fail'),
      error: error => {
        expect(message.error).toHaveBeenCalledWith('用户名或密码错误');
        expect(error.message).toContain('用户名或密码错误');
        done();
      }
    });

    const req = httpTesting.expectOne('/site/api/auth/signin');
    req.flush(
      {
        message: '用户名或密码错误',
        error: 'Forbidden',
        statusCode: 403
      },
      {
        status: 403,
        statusText: 'Forbidden'
      }
    );
  });

  describe('putRaw', () => {
    it('attaches custom headers when provided', () => {
      service
        .putRaw<{ updatedAt: string }>('/energy-rental/ui-config', { foo: 'bar' }, {
          headers: { 'If-Unmodified-Since': '2026-05-02T12:00:00.000Z' }
        })
        .subscribe();

      const req = httpTesting.expectOne('/site/api/energy-rental/ui-config');
      expect(req.request.method).toBe('PUT');
      expect(req.request.headers.get('If-Unmodified-Since')).toBe('2026-05-02T12:00:00.000Z');
      req.flush({ code: 200, msg: 'ok', data: { updatedAt: '2026-05-02T12:00:00.000Z' } });
    });

    it('serializes query params into the URL', () => {
      service.putRaw('/energy-rental/ui-config', { foo: 'bar' }, { query: { dryRun: 'true' } }).subscribe();

      const req = httpTesting.expectOne(r => r.url === '/site/api/energy-rental/ui-config');
      expect(req.request.method).toBe('PUT');
      expect(req.request.params.get('dryRun')).toBe('true');
      req.flush({ code: 200, msg: 'ok', data: { valid: true } });
    });

    it('filters null/undefined from query params', () => {
      service
        .putRaw('/energy-rental/ui-config', { foo: 'bar' }, {
          query: { dryRun: 'true', foo: null, bar: undefined }
        })
        .subscribe();

      const req = httpTesting.expectOne(r => r.url === '/site/api/energy-rental/ui-config');
      expect(req.request.params.get('dryRun')).toBe('true');
      expect(req.request.params.has('foo')).toBeFalse();
      expect(req.request.params.has('bar')).toBeFalse();
      req.flush({ code: 200, msg: 'ok', data: { valid: true } });
    });

    it('omits headers and params when config does not specify them', () => {
      service.putRaw('/energy-rental/ui-config', { foo: 'bar' }).subscribe();

      const req = httpTesting.expectOne('/site/api/energy-rental/ui-config');
      expect(req.request.method).toBe('PUT');
      expect(req.request.headers.get('If-Unmodified-Since')).toBeNull();
      expect(req.request.params.keys().length).toBe(0);
      req.flush({ code: 200, msg: 'ok', data: null });
    });

    it('shows success toast when needSuccessInfo is true', () => {
      service
        .putRaw('/energy-rental/ui-config', { foo: 'bar' }, { needSuccessInfo: true })
        .subscribe();

      const req = httpTesting.expectOne('/site/api/energy-rental/ui-config');
      req.flush({ code: 200, msg: 'ok', data: { updatedAt: '2026-05-02T12:00:00.000Z' } });
      expect(message.success).toHaveBeenCalledWith('操作成功');
    });

    it('suppressErrorToast=true 时 409 不弹 toast，但错误仍向下游抛出并带 status', done => {
      service
        .putRaw('/energy-rental/ui-config', { foo: 'bar' }, {
          headers: { 'If-Unmodified-Since': '2026-05-02T10:00:00.000Z' },
          suppressErrorToast: true
        })
        .subscribe({
          next: () => done.fail('expected the request to error'),
          error: (err: Error & { status?: number | null }) => {
            expect(message.error).not.toHaveBeenCalled();
            expect(err.message).toContain('配置已被他人修改');
            expect(err.status).toBe(409);
            done();
          }
        });

      const req = httpTesting.expectOne('/site/api/energy-rental/ui-config');
      req.flush(
        { message: '配置已被他人修改，请刷新后重试' },
        { status: 409, statusText: 'Conflict' }
      );
    });

    it('默认（未传 suppressErrorToast）时 409 仍然弹 toast', done => {
      service
        .putRaw('/energy-rental/ui-config', { foo: 'bar' }, {
          headers: { 'If-Unmodified-Since': '2026-05-02T10:00:00.000Z' }
        })
        .subscribe({
          next: () => done.fail('expected the request to error'),
          error: () => {
            expect(message.error).toHaveBeenCalledWith('配置已被他人修改，请刷新后重试');
            done();
          }
        });

      const req = httpTesting.expectOne('/site/api/energy-rental/ui-config');
      req.flush(
        { message: '配置已被他人修改，请刷新后重试' },
        { status: 409, statusText: 'Conflict' }
      );
    });
  });

  describe('postRaw', () => {
    it('attaches custom headers and query params', () => {
      service
        .postRaw('/sample/endpoint', { foo: 'bar' }, {
          headers: { 'X-Custom': 'yes' },
          query: { page: 2 }
        })
        .subscribe();

      const req = httpTesting.expectOne(r => r.url === '/site/api/sample/endpoint');
      expect(req.request.method).toBe('POST');
      expect(req.request.headers.get('X-Custom')).toBe('yes');
      expect(req.request.params.get('page')).toBe('2');
      req.flush({ code: 200, msg: 'ok', data: null });
    });
  });
});
