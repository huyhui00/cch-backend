import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';

export interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  message: string | null;
}

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
        if (payload instanceof StreamableFile) {
          return payload as unknown as ApiResponse<T>;
        }

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
