import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { type Observable, tap } from 'rxjs';

import { getElapsedMs } from '../context/request-context';
import type { AuthenticatedUser } from '../types/auth.types';

const SKIPPED_PATHS: ReadonlySet<string> = new Set(['/api/health']);

const MAX_URL_LENGTH = 120;

export const URL_COLUMN_WIDTH = 44;

/**
 * พิมพ์ทุก request ที่สำเร็จลง terminal ระหว่างพัฒนา
 *
 *   [Request] POST   /api/auth/login                 200   187ms  superadmin
 *   [Request] GET    /api/customers?limit=20         200    34ms  superadmin
 *
 * ครอบคลุมเฉพาะ request ที่ทำงานจบโดยไม่ throw — ส่วนที่ล้มเหลวถูก log โดย
 * HttpExceptionFilter อยู่แล้ว และต้องเป็นแบบนั้นเพราะ guard ทำงาน "ก่อน" interceptor
 * เมื่อ guard ปฏิเสธ (401 หรือ 403) interceptor นี้จะไม่ถูกเรียกเลย ถ้ามา log ที่นี่
 * ด้วยจะได้ภาพไม่ครบและซ้ำซ้อนกัน แบ่งกันแบบนี้จึงได้บรรทัดละหนึ่ง request พอดี
 *
 * ไม่พิมพ์เนื้อหา body ของ request โดยเจตนา เพราะมีรหัสผ่านปนอยู่ในบางเส้น
 * ข้อมูลที่เปลี่ยนแปลงจริงถูกเก็บไว้ใน audit_logs พร้อมค่าก่อนและหลังอยู่แล้ว
 */
@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Request');

  constructor(private readonly enabled: boolean) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.enabled) {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<Request & { user?: AuthenticatedUser }>();

    if (SKIPPED_PATHS.has(request.path)) {
      return next.handle();
    }

    return next.handle().pipe(
      tap(() => {
        const response = http.getResponse<Response>();
        const method = request.method.padEnd(6);
        const url = truncate(request.originalUrl, MAX_URL_LENGTH).padEnd(URL_COLUMN_WIDTH);
        const elapsed = String(getElapsedMs() ?? 0).padStart(5);
        const actor = request.user ? request.user.username : 'ไม่ระบุตัวตน';

        this.logger.log(`${method} ${url} ${response.statusCode} ${elapsed}ms  ${actor}`);
      }),
    );
  }
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) + '…' : value;
}
