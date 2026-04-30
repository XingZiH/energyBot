import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Injectable } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { WindowService } from '@core/services/common/window.service';
import { httpInterceptorService } from '@core/services/interceptors/http-interceptor';

import { NzMessageService } from 'ng-zorro-antd/message';

import { BaseHttpService } from '../base-http.service';
import { EnergyRentalService } from './energy-rental.service';

@Injectable()
class TestBaseHttpService extends BaseHttpService {
  constructor() {
    super();
  }
}

describe('EnergyRentalService recharge HTTP options', () => {
  let service: EnergyRentalService;
  let httpTesting: HttpTestingController;
  let message: jasmine.SpyObj<Pick<NzMessageService, 'error' | 'success' | 'loading' | 'remove'>>;

  beforeEach(() => {
    message = jasmine.createSpyObj('NzMessageService', ['error', 'success', 'loading', 'remove']);
    message.loading.and.returnValue({ messageId: 'loading-id' } as never);

    TestBed.configureTestingModule({
      providers: [
        EnergyRentalService,
        { provide: BaseHttpService, useClass: TestBaseHttpService },
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

    service = TestBed.inject(EnergyRentalService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
  });

  it('does not show a generic success toast for recharge creation or unpaid sync checks', () => {
    service.createAgentRechargeOrder({ amountTrx: 1 }).subscribe();
    httpTesting.expectOne('/site/api/energy-rental/agent-recharges/create').flush({
      code: 201,
      msg: 'created',
      data: {
        id: 1,
        agentId: 7,
        orderNo: 'AR202604300001',
        amountSun: '1000000',
        paymentAddress: 'TAddress',
        status: 'pending'
      }
    });

    service.syncAgentRechargeOrder(1).subscribe();
    httpTesting.expectOne('/site/api/energy-rental/agent-recharges/1/sync').flush({
      code: 201,
      msg: 'pending',
      data: {
        credited: false,
        status: 'pending'
      }
    });

    expect(message.success).not.toHaveBeenCalledWith('操作成功');
  });
});
