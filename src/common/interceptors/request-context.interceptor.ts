import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Observable } from 'rxjs';

import { setCurrentUserId } from '../context/request-context';
import type { AuthenticatedUser } from '../types/auth.types';

/**
 * เติม userId ลง request context หลัง guard ยืนยันตัวตนเสร็จแล้ว
 *
 * ลำดับการทำงานของ NestJS คือ middleware -> guard -> interceptor -> handler
 * ตอน middleware เปิด context นั้นยังไม่มี request.user เพราะ guard ยังไม่ทำงาน
 * interceptor จึงเป็นจุดแรกที่รู้ว่าใครล็อกอินอยู่ และยังเร็วพอที่จะเติมค่าให้ทัน
 * ก่อน service เริ่มเขียนฐานข้อมูล
 *
 * endpoint ที่ติด @Public() จะไม่มี request.user — userId คงเป็น null
 * ซึ่งถูกต้องแล้ว เพราะไม่มีผู้กระทำที่ระบุตัวได้
 */
@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();

    if (request.user) {
      setCurrentUserId(request.user.id);
    }

    return next.handle();
  }
}
