import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { BaseHttpService } from '../base-http.service';

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

  beforeEach(() => {
    httpSpy = jasmine.createSpyObj<BaseHttpService>('BaseHttpService', ['get', 'putRaw']);

    const mockConfig: UiConfig = {
      welcomeText: '',
      menuConfig: [],
      messageConfig: emptyTemplates(),
      updatedAt: '1970-01-01T00:00:00.000Z'
    };
    httpSpy.get.and.returnValue(of(mockConfig));
    httpSpy.putRaw.and.returnValue(of({ updatedAt: '2026-05-02T12:00:00.000Z' }));

    TestBed.configureTestingModule({
      providers: [UiConfigService, { provide: BaseHttpService, useValue: httpSpy }]
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
});
