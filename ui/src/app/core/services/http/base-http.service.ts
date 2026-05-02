import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable, throwError } from 'rxjs';
import { catchError, filter, map, finalize } from 'rxjs/operators';

import { environment } from '@env/environment';
import { localUrl } from '@env/environment.prod';
import * as qs from 'qs';

import { NzSafeAny } from 'ng-zorro-antd/core/types';
import { NzMessageService } from 'ng-zorro-antd/message';

export interface HttpCustomConfig {
  needSuccessInfo?: boolean; // 是否需要"操作成功"提示
  showLoading?: boolean; // 是否需要loading
  otherUrl?: boolean; // 是否是第三方接口
  loadingText?: string; // 可选：自定义Loading文案
}

/**
 * 扩展 config：仅供 putRaw / postRaw 使用，支持自定义请求头和查询串。
 *
 * 典型场景：
 * - 乐观锁（If-Unmodified-Since）
 * - dryRun / 幂等键等无法放进 body 的查询参数
 */
export interface HttpRawConfig extends HttpCustomConfig {
  /** 附加请求头（例如乐观锁的 If-Unmodified-Since）。 */
  headers?: Record<string, string>;
  /** URL query 参数；null/undefined 值会被自动过滤。 */
  query?: Record<string, string | number | boolean | null | undefined>;
}

export interface ActionResult<T> {
  code: number;
  msg: string;
  data: T;
}

/**
 * HTTP 基础服务。
 *
 * 方法分层：
 * - get/post/put/delete：常规业务 API（90% 场景），签名稳定，不支持自定义头/query
 * - putRaw/postRaw：支持自定义 headers 和 query 参数
 *   （用于乐观锁 If-Unmodified-Since、dryRun 查询串等场景）
 * - downLoadWithBlob：二进制下载
 *
 * 所有方法共享同一套 ResultData 拆包（resultHandle）、错误 toast 和 loading 逻辑。
 */
@Injectable({
  providedIn: 'root'
})
export class BaseHttpService {
  uri: string;
  http = inject(HttpClient);
  message = inject(NzMessageService);

  protected constructor() {
    this.uri = environment.production ? localUrl : '/site/api';
  }

  get<T>(path: string, param?: NzSafeAny, config?: HttpCustomConfig): Observable<T> {
    config = config || { needSuccessInfo: false };
    const reqPath = this.getUrl(path, config);
    const params = new HttpParams({ fromString: qs.stringify(param) });

    // 获取关闭loading的回调函数
    const closeLoading = this.handleLoading(config);

    return this.http.get<ActionResult<T>>(reqPath, { params }).pipe(
      finalize(closeLoading), // 无论成功失败，接口结束时立即调用关闭逻辑
      this.resultHandle<T>(config)
    );
  }

  delete<T>(path: string, param?: NzSafeAny, config?: HttpCustomConfig): Observable<T> {
    config = config || { needSuccessInfo: false };
    const reqPath = this.getUrl(path, config);
    const params = new HttpParams({ fromString: qs.stringify(param) });

    const closeLoading = this.handleLoading(config);

    return this.http.delete<ActionResult<T>>(reqPath, { params }).pipe(
      finalize(closeLoading), // 无论成功失败，接口结束时立即调用关闭逻辑
      this.resultHandle<T>(config)
    );
  }

  post<T>(path: string, param?: NzSafeAny, config?: HttpCustomConfig): Observable<T> {
    config = config || { needSuccessInfo: false };
    const reqPath = this.getUrl(path, config);

    const closeLoading = this.handleLoading(config);

    return this.http.post<ActionResult<T>>(reqPath, param).pipe(
      finalize(closeLoading), // 无论成功失败，接口结束时立即调用关闭逻辑
      this.resultHandle<T>(config)
    );
  }

  put<T>(path: string, param?: NzSafeAny, config?: HttpCustomConfig): Observable<T> {
    config = config || { needSuccessInfo: false };
    const reqPath = this.getUrl(path, config);

    const closeLoading = this.handleLoading(config);

    return this.http.put<ActionResult<T>>(reqPath, param).pipe(
      finalize(closeLoading), // 无论成功失败，接口结束时立即调用关闭逻辑
      this.resultHandle<T>(config)
    );
  }

  /**
   * PUT 扩展版：支持自定义请求头和 query 参数。
   * 与 put() 共享 ResultData 拆包和错误/成功 toast 逻辑。
   */
  putRaw<T>(path: string, body?: NzSafeAny, config?: HttpRawConfig): Observable<T> {
    config = config || { needSuccessInfo: false };
    const reqPath = this.getUrl(path, config);
    const httpHeaders = config.headers ? new HttpHeaders(config.headers) : undefined;
    const httpParams = config.query
      ? new HttpParams({ fromString: qs.stringify(this.cleanQuery(config.query)) })
      : undefined;

    const closeLoading = this.handleLoading(config);

    return this.http
      .put<ActionResult<T>>(reqPath, body, {
        headers: httpHeaders,
        params: httpParams
      })
      .pipe(finalize(closeLoading), this.resultHandle<T>(config));
  }

  /**
   * POST 扩展版：支持自定义请求头和 query 参数。
   * 与 post() 共享 ResultData 拆包和错误/成功 toast 逻辑。
   */
  postRaw<T>(path: string, body?: NzSafeAny, config?: HttpRawConfig): Observable<T> {
    config = config || { needSuccessInfo: false };
    const reqPath = this.getUrl(path, config);
    const httpHeaders = config.headers ? new HttpHeaders(config.headers) : undefined;
    const httpParams = config.query
      ? new HttpParams({ fromString: qs.stringify(this.cleanQuery(config.query)) })
      : undefined;

    const closeLoading = this.handleLoading(config);

    return this.http
      .post<ActionResult<T>>(reqPath, body, {
        headers: httpHeaders,
        params: httpParams
      })
      .pipe(finalize(closeLoading), this.resultHandle<T>(config));
  }

  /**
   * 剔除 null/undefined 的查询参数，避免序列化成 `?key=null` 或 `?key=undefined`。
   */
  private cleanQuery(query: Record<string, unknown>): Record<string, unknown> {
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(query)) {
      if (v !== null && v !== undefined) cleaned[k] = v;
    }
    return cleaned;
  }

  downLoadWithBlob(path: string, param?: NzSafeAny, config?: HttpCustomConfig): Observable<NzSafeAny> {
    config = config || { needSuccessInfo: false };
    const reqPath = this.getUrl(path, config);

    const closeLoading = this.handleLoading(config);

    return this.http
      .post(reqPath, param, {
        responseType: 'blob',
        headers: new HttpHeaders().append('Content-Type', 'application/json')
      })
      .pipe(finalize(closeLoading));
  }

  getUrl(path: string, config: HttpCustomConfig): string {
    let reqPath = this.uri + path;
    if (config.otherUrl) {
      reqPath = path;
    }
    return reqPath;
  }

  /**
   * Loading处理逻辑
   * 即使接口瞬间返回，Loading 也会坚持展示最少 500ms
   */
  private handleLoading(config: HttpCustomConfig): () => void {
    if (config.showLoading) {
      const startTime = Date.now();
      // 注意：设置 nzDuration: 0 为手动关闭，否则会被默认的 3000ms 自动消除逻辑干扰
      const msgRef = this.message.loading(config.loadingText || '加载中...', { nzDuration: 0 });

      return () => {
        const elapsed = Date.now() - startTime;
        const minDuration = 500; // 最小展示 500ms
        const remaining = minDuration - elapsed;

        if (remaining > 0) {
          // 如果请求太快（比如 50ms），则延迟 450ms 后再移除 Loading
          // 此时数据已经返回给页面了，但 Loading 还在
          setTimeout(() => {
            this.message.remove(msgRef.messageId);
          }, remaining);
        } else {
          // 如果请求本身就很慢（超过 500ms），立即移除
          this.message.remove(msgRef.messageId);
        }
      };
    }
    return () => {};
  }

  resultHandle<T>(config: HttpCustomConfig): (observable: Observable<ActionResult<T>>) => Observable<T> {
    return (observable: Observable<ActionResult<T>>) => {
      return observable.pipe(
        catchError(error => this.handleHttpError(error)),
        filter(item => {
          return this.handleFilter(item, !!config.needSuccessInfo);
        }),
        map(item => {
          if (![200, 201].includes(item.code)) {
            throw new Error(item.msg);
          }
          return item.data;
        })
      );
    };
  }

  private handleHttpError(error: unknown): Observable<never> {
    const errorMessage = this.extractErrorMessage(error);
    this.message.error(errorMessage);
    return throwError(() => (error instanceof Error ? error : new Error(errorMessage)));
  }

  private extractErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      return this.extractBodyErrorMessage(error.error) || error.message || '请求失败，请稍后重试';
    }

    if (typeof error === 'string') {
      return error.trim() || '请求失败，请稍后重试';
    }

    if (error && typeof error === 'object') {
      const record = error as Record<string, unknown>;
      return (
        this.getMessageValue(record['message']) ||
        this.getMessageValue(record['msg']) ||
        this.getMessageValue(record['error']) ||
        '请求失败，请稍后重试'
      );
    }

    return '请求失败，请稍后重试';
  }

  private extractBodyErrorMessage(body: unknown): string | null {
    if (typeof body === 'string') {
      const trimmed = body.trim();
      if (!trimmed) {
        return null;
      }

      try {
        const parsed = JSON.parse(trimmed) as unknown;
        return this.extractBodyErrorMessage(parsed) || trimmed;
      } catch {
        return trimmed;
      }
    }

    if (body && typeof body === 'object') {
      const record = body as Record<string, unknown>;
      return this.getMessageValue(record['message']) || this.getMessageValue(record['msg']) || this.getMessageValue(record['error']);
    }

    return null;
  }

  private getMessageValue(value: unknown): string | null {
    if (Array.isArray(value)) {
      const message = value
        .map(item => this.getMessageValue(item))
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

  handleFilter<T>(item: ActionResult<T>, needSuccessInfo: boolean): boolean {
    if (![200, 201].includes(item.code)) {
      this.message.error(item.msg);
    } else if (needSuccessInfo) {
      this.message.success('操作成功');
    }
    return true;
  }
}
