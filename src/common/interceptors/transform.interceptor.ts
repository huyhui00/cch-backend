import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';

/**
 * รูปแบบ response มาตรฐานของทั้งระบบ (CLAUDE.md 6.1)
 *
 *   { "success": true,  "data": {...},              "message": null }
 *   { "success": true,  "data": { items, total, page, limit }, "message": null }
 *   { "success": false, "data": null,               "message": "ไม่พบข้อมูลลูกค้า" }
 *
 * เคสที่ success = false ถูกจัดการโดย HttpExceptionFilter
 */
export interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  message: string | null;
}

/**
 * รูปทรงที่ service ส่งกลับมาได้ ถ้าอยากแนบ message เอง
 * เช่น `return { data: user, message: 'สร้างผู้ใช้เรียบร้อย' }`
 */
interface WithMessage<T> {
  data: T;
  message: string | null;
}

function hasExplicitMessage<T>(value: unknown): value is WithMessage<T> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const keys = Object.keys(value);
  return (
    keys.length === 2 && keys.includes('data') && keys.includes('message') && !Array.isArray(value)
  );
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<ApiResponse<T>> {
    return next.handle().pipe(
      map((payload): ApiResponse<T> => {
        // ไฟล์ที่ดาวน์โหลด (Phase 9) ต้องส่งเป็นไบต์ตรง ๆ ห่อเป็น JSON ไม่ได้
        // เป็นข้อยกเว้นเดียวของรูปแบบ response มาตรฐาน — error ของเส้นเดียวกันยังเป็น JSON ตามเดิม
        if (payload instanceof StreamableFile) {
          return payload as unknown as ApiResponse<T>;
        }

        // ห่อซ้ำไม่ได้ — ถ้า handler ส่งรูปแบบสุดท้ายมาแล้วก็ปล่อยผ่าน
        if (isApiResponse<T>(payload)) {
          return payload;
        }

        if (hasExplicitMessage<T>(payload)) {
          return {
            success: true,
            data: payload.data ?? null,
            message: payload.message ?? null,
          };
        }

        return {
          success: true,
          data: payload ?? null,
          message: null,
        };
      }),
    );
  }
}

function isApiResponse<T>(value: unknown): value is ApiResponse<T> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.success === 'boolean' && 'data' in candidate && 'message' in candidate;
}
