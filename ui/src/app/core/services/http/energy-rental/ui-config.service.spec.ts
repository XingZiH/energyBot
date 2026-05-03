import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { NzMessageService } from 'ng-zorro-antd/message';

import { BaseHttpService, HttpBusinessError } from '../base-http.service';

import type { MenuRow, MessageTemplates } from '../../../../pages/energy-rental/agent-bot-config/designer/types';
import { UiConfig, UiConfigPayload, UiConfigService } from './ui-config.service';

/**
 * 构造 9 字段全空串的 MessageTemplates，对齐后端 emptyTemplates()。
 */
function emptyTemplates(): MessageTemplates {
  return {
    welcome: '',
    orderCreated: '',
    payPending: '',
    paySuccess: '',
    payFailed: '',
    addressInvalid: '',
    unknownCommand: '',
    packageUnavailable: '',
    walletQueryResult: ''
  };
}

function samplePayload(): UiConfigPayload {
  const menuConfig: MenuRow[] = [];
  return {
    welcomeText: 'hi',
    menuConfig,
    messageConfig: emptyTemplates()
  };
}

describe('UiConfigService', () => {
  let service: UiConfigService;
  let httpSpy: jasmine.SpyObj<Pick<BaseHttpService, 'get' | 'putRaw'>>;
  let message: jasmine.SpyObj<Pick<NzMessageService, 'error' | 'success'>>;

  beforeEach(() => {
    httpSpy = jasmine.createSpyObj<BaseHttpService>('BaseHttpService', ['get', 'putRaw']);
    message = jasmine.createSpyObj<NzMessageService>('NzMessageService', ['error', 'success']);

    const mockConfig: UiConfig = {
      welcomeText: '',
      menuConfig: [],
      messageConfig: emptyTemplates(),
      updatedAt: '1970-01-01T00:00:00.000Z'
    };
    httpSpy.get.and.returnValue(of(mockConfig));
    httpSpy.putRaw.and.returnValue(of({ updatedAt: '2026-05-02T12:00:00.000Z' }));

    TestBed.configureTestingModule({
      providers: [
        UiConfigService,
        { provide: BaseHttpService, useValue: httpSpy },
        { provide: NzMessageService, useValue: message }
      ]
    });

    service = TestBed.inject(UiConfigService);
  });

  it('getUiConfig() calls http.get with the ui-config path', () => {
    service.getUiConfig().subscribe();
    expect(httpSpy.get).toHaveBeenCalledWith('/energy-rental/ui-config');
  });

  it('getUiConfig() returns a UiConfig with welcomeText/menu/message/updatedAt', done => {
    service.getUiConfig().subscribe(cfg => {
      expect(cfg.welcomeText).toBe('');
      expect(cfg.menuConfig).toEqual([]);
      expect(cfg.messageConfig).toEqual(emptyTemplates());
      expect(cfg.updatedAt).toBe('1970-01-01T00:00:00.000Z');
      done();
    });
  });

  it('saveUiConfig() without ifUnmodifiedSince does not send If-Unmodified-Since header', () => {
    service.saveUiConfig(samplePayload()).subscribe();
    expect(httpSpy.putRaw).toHaveBeenCalledTimes(1);
    const [path, body, cfg] = httpSpy.putRaw.calls.mostRecent().args as [string, unknown, { headers?: Record<string, string> }];
    expect(path).toBe('/energy-rental/ui-config');
    expect(body).toEqual(samplePayload());
    expect(cfg.headers).toBeUndefined();
  });

  it('saveUiConfig(..., ISO_STRING) sets If-Unmodified-Since header', () => {
    service.saveUiConfig(samplePayload(), '2026-05-02T12:00:00.000Z').subscribe();
    const [, , cfg] = httpSpy.putRaw.calls.mostRecent().args as [string, unknown, { headers?: Record<string, string> }];
    expect(cfg.headers).toEqual({ 'If-Unmodified-Since': '2026-05-02T12:00:00.000Z' });
  });

  it('saveUiConfig(..., "") and saveUiConfig(..., null) do not send the header', () => {
    service.saveUiConfig(samplePayload(), '').subscribe();
    let cfg = httpSpy.putRaw.calls.mostRecent().args[2] as { headers?: Record<string, string> };
    expect(cfg.headers).toBeUndefined();

    httpSpy.putRaw.calls.reset();
    service.saveUiConfig(samplePayload(), null).subscribe();
    cfg = httpSpy.putRaw.calls.mostRecent().args[2] as { headers?: Record<string, string> };
    expect(cfg.headers).toBeUndefined();
  });

  it('saveUiConfig() sets needSuccessInfo=true so the save shows a success toast', () => {
    service.saveUiConfig(samplePayload()).subscribe();
    const cfg = httpSpy.putRaw.calls.mostRecent().args[2] as { needSuccessInfo?: boolean };
    expect(cfg.needSuccessInfo).toBeTrue();
  });

  it('dryRunValidate() calls putRaw with dryRun=true query param', () => {
    service.dryRunValidate(samplePayload()).subscribe();
    const [path, , cfg] = httpSpy.putRaw.calls.mostRecent().args as [
      string,
      unknown,
      { query?: Record<string, unknown> }
    ];
    expect(path).toBe('/energy-rental/ui-config');
    expect(cfg.query).toEqual({ dryRun: 'true' });
  });

  it('dryRunValidate() does not set needSuccessInfo (no success toast for validation)', () => {
    service.dryRunValidate(samplePayload()).subscribe();
    const cfg = httpSpy.putRaw.calls.mostRecent().args[2] as { needSuccessInfo?: boolean };
    expect(cfg.needSuccessInfo).toBeFalsy();
  });

  describe('saveUiConfig 409 自动重试', () => {
    it('409 时用最新 updatedAt 重试，整条链路只对外发一次成功信号', done => {
      // 第一次 putRaw 返回 409，第二次成功
      const conflictErr = new HttpBusinessError('配置已被他人修改，请刷新后重试', 409);
      httpSpy.putRaw.and.returnValues(
        throwError(() => conflictErr),
        of({ updatedAt: '2026-05-02T13:00:00.000Z' })
      );
      httpSpy.get.and.returnValue(
        of({
          welcomeText: '',
          menuConfig: [],
          messageConfig: emptyTemplates(),
          updatedAt: '2026-05-02T12:30:00.000Z'
        })
      );

      service.saveUiConfig(samplePayload(), '2026-05-02T10:00:00.000Z').subscribe({
        next: result => {
          expect(result.updatedAt).toBe('2026-05-02T13:00:00.000Z');
          expect(httpSpy.putRaw).toHaveBeenCalledTimes(2);
          expect(httpSpy.get).toHaveBeenCalledTimes(1);

          const firstCfg = httpSpy.putRaw.calls.argsFor(0)[2] as {
            headers?: Record<string, string>;
            suppressErrorToast?: boolean;
          };
          expect(firstCfg.headers?.['If-Unmodified-Since']).toBe('2026-05-02T10:00:00.000Z');
          expect(firstCfg.suppressErrorToast).toBeTrue();

          const retryCfg = httpSpy.putRaw.calls.argsFor(1)[2] as {
            headers?: Record<string, string>;
            suppressErrorToast?: boolean;
          };
          expect(retryCfg.headers?.['If-Unmodified-Since']).toBe('2026-05-02T12:30:00.000Z');
          expect(retryCfg.suppressErrorToast).toBeFalse();

          // 首轮 409 的 toast 被抑制，不应弹出"配置已被他人修改"
          expect(message.error).not.toHaveBeenCalled();
          done();
        },
        error: () => done.fail('expected retry to succeed')
      });
    });

    it('409 重试依然 409 时，错误向下游抛出（此时 BaseHttpService 的 toast 由重试轮负责弹）', done => {
      const conflictErr = new HttpBusinessError('配置已被他人修改，请刷新后重试', 409);
      httpSpy.putRaw.and.returnValues(
        throwError(() => conflictErr),
        throwError(() => conflictErr) // 重试也失败
      );

      service.saveUiConfig(samplePayload(), '2026-05-02T10:00:00.000Z').subscribe({
        next: () => done.fail('expected error'),
        error: (err: HttpBusinessError) => {
          expect(err.status).toBe(409);
          expect(httpSpy.putRaw).toHaveBeenCalledTimes(2);
          // UiConfigService 自己不再补 toast——重试轮的 putRaw 已经走正常 toast 路径
          // （本 spec 中 putRaw 是 jasmine spy 不走真实 BaseHttpService，故 message.error 未被调用）
          expect(message.error).not.toHaveBeenCalled();
          done();
        }
      });
    });

    it('非 409 错误：不重试，由 UiConfigService 补一次 toast 再抛', done => {
      const serverErr = new HttpBusinessError('服务器内部错误', 500);
      httpSpy.putRaw.and.returnValue(throwError(() => serverErr));

      service.saveUiConfig(samplePayload(), '2026-05-02T10:00:00.000Z').subscribe({
        next: () => done.fail('expected error'),
        error: (err: HttpBusinessError) => {
          expect(err.status).toBe(500);
          expect(httpSpy.putRaw).toHaveBeenCalledTimes(1); // 不重试
          expect(httpSpy.get).not.toHaveBeenCalled();
          expect(message.error).toHaveBeenCalledWith('服务器内部错误');
          done();
        }
      });
    });

    it('409 后 getUiConfig 失败，错误向下游抛出', done => {
      const conflictErr = new HttpBusinessError('配置已被他人修改，请刷新后重试', 409);
      const loadErr = new HttpBusinessError('网络错误', 0);
      httpSpy.putRaw.and.returnValue(throwError(() => conflictErr));
      httpSpy.get.and.returnValue(throwError(() => loadErr));

      service.saveUiConfig(samplePayload(), '2026-05-02T10:00:00.000Z').subscribe({
        next: () => done.fail('expected error'),
        error: (err: HttpBusinessError) => {
          expect(err.status).toBe(0);
          expect(httpSpy.putRaw).toHaveBeenCalledTimes(1);
          done();
        }
      });
    });
  });
});
