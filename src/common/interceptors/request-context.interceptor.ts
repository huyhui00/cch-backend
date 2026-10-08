import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Observable } from 'rxjs';

import { setCurrentUserId } from '../context/request-context';
import type { AuthenticatedUser } from '../types/auth.types';

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
