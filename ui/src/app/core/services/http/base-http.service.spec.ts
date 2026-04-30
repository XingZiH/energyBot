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
});
