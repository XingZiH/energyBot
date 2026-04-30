import { HttpErrorResponse, HttpHeaders, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Observable, throwError } from 'rxjs';
import { catchError, filter } from 'rxjs/operators';

import { TokenKey } from '@config/constant';
import { WindowService } from '@core/services/common/window.service';

interface CustomHttpConfig {
  headers?: HttpHeaders;
}

function handleError(error: HttpErrorResponse): Observable<never> {
  const status = error.status;
  const errMsg = getBackendErrorMessage(error) || getDefaultErrorMessage(status);

  return throwError(() => {
    return {
      code: status,
      message: errMsg,
      statusCode: status
    };
  });
}

function getBackendErrorMessage(error: HttpErrorResponse): string | null {
  const body = error.error;
  if (!body) {
    return null;
  }

  if (typeof body === 'string') {
    return parseErrorMessageFromString(body);
  }

  if (typeof body === 'object') {
    const record = body as Record<string, unknown>;
    return getMessageValue(record['message']) || getMessageValue(record['msg']) || getMessageValue(record['error']);
  }

  return null;
}

function parseErrorMessageFromString(body: string): string | null {
  const trimmed = body.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      return getMessageValue(record['message']) || getMessageValue(record['msg']) || getMessageValue(record['error']);
    }
  } catch {
    // Non-JSON HTTP error bodies can still be useful as a direct message.
  }

  return trimmed;
}

function getMessageValue(value: unknown): string | null {
  if (Array.isArray(value)) {
    const message = value
      .map(item => getMessageValue(item))
      .filter((item): item is string => !!item)
      .join('，');
    return message || null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return null;
}

function getDefaultErrorMessage(status: number): string {
  if (status === 0) {
    return '网络出现未知错误，请检查您的网络。';
  }
  if (status >= 300 && status < 400) {
    return `请求被服务器重定向，状态码为${status}`;
  }
  if (status >= 400 && status < 500) {
    return `客户端出错，可能是发送的数据有误，状态码为${status}`;
  }
  if (status >= 500) {
    return `服务器发生错误，状态码为${status}`;
  }

  return `请求失败，状态码为${status}`;
}

export const httpInterceptorService: HttpInterceptorFn = (req, next) => {
  const windowServe = inject(WindowService);
  const token = windowServe.getSessionStorage(TokenKey);
  let httpConfig: CustomHttpConfig = {};
  if (token) {
    httpConfig = { headers: req.headers.set(TokenKey, token) };
  }
  const copyReq = req.clone(httpConfig);
  return next(copyReq).pipe(
    filter(e => e.type !== 0),
    catchError(error => handleError(error))
  );
};
