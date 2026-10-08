import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  BaseError as SequelizeBaseError,
  ForeignKeyConstraintError,
  UniqueConstraintError,
  ValidationError as SequelizeValidationError,
} from 'sequelize';

import { getElapsedMs } from '../context/request-context';
import { URL_COLUMN_WIDTH } from '../interceptors/request-logging.interceptor';
import type { ApiResponse } from '../interceptors/transform.interceptor';
import type { AuthenticatedUser } from '../types/auth.types';

const SERVER_ERROR_THRESHOLD = 500;

const DEFAULT_MESSAGES: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'ข้อมูลที่ส่งมาไม่ถูกต้อง',
  [HttpStatus.UNAUTHORIZED]: 'กรุณาเข้าสู่ระบบก่อนใช้งาน',
  [HttpStatus.FORBIDDEN]: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้',
  [HttpStatus.NOT_FOUND]: 'ไม่พบข้อมูลที่ต้องการ',
  [HttpStatus.METHOD_NOT_ALLOWED]: 'ไม่รองรับการเรียกใช้รูปแบบนี้',
  [HttpStatus.CONFLICT]: 'ข้อมูลนี้มีอยู่ในระบบแล้ว',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'ไฟล์หรือข้อมูลมีขนาดใหญ่เกินกำหนด',
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: 'ไม่รองรับชนิดไฟล์นี้',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'ข้อมูลไม่ผ่านการตรวจสอบ',
  [HttpStatus.TOO_MANY_REQUESTS]: 'เรียกใช้งานถี่เกินไป กรุณาลองใหม่อีกครั้ง',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'เกิดข้อผิดพลาดภายในระบบ',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'ระบบไม่พร้อมให้บริการชั่วคราว',
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { user?: AuthenticatedUser }>();

    const { status, message } = this.resolve(exception);

    const elapsed = String(getElapsedMs() ?? 0).padStart(5);
    const actor = request.user ? request.user.username : 'ไม่ระบุตัวตน';
    const url = request.originalUrl.padEnd(URL_COLUMN_WIDTH);
    const line = `${request.method.padEnd(6)} ${url} ${status} ${elapsed}ms  ${actor}`;

    if (status >= SERVER_ERROR_THRESHOLD) {
      this.logger.error(
        `${line} — ${exception instanceof Error ? exception.message : String(exception)}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(`${line} — ${message}`);
    }

    const body: ApiResponse<null> = {
      success: false,
      data: null,
      message,
    };

    response.status(status).json(body);
  }

  private resolve(exception: unknown): { status: number; message: string } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return { status, message: this.extractHttpMessage(exception, status) };
    }

    if (exception instanceof SequelizeBaseError) {
      return this.resolveSequelize(exception);
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: DEFAULT_MESSAGES[HttpStatus.INTERNAL_SERVER_ERROR],
    };
  }

  private extractHttpMessage(exception: HttpException, status: number): string {
    const fallback = DEFAULT_MESSAGES[status] ?? 'เกิดข้อผิดพลาดในการทำงาน';
    const payload = exception.getResponse();

    if (typeof payload === 'string') {
      return this.translate(payload, fallback);
    }

    if (payload !== null && typeof payload === 'object') {
      const raw = (payload as { message?: unknown }).message;

      if (Array.isArray(raw)) {
        const first = raw.find((item): item is string => typeof item === 'string');
        return first ?? fallback;
      }

      if (typeof raw === 'string') {
        return this.translate(raw, fallback);
      }
    }

    return fallback;
  }

  private translate(message: string, fallback: string): string {
    const known = KNOWN_ENGLISH_MESSAGES[message.toLowerCase()];

    if (known) {
      return known;
    }

    return this.isGenericEnglish(message) ? fallback : message;
  }

  private resolveSequelize(exception: SequelizeBaseError): {
    status: number;
    message: string;
  } {
    if (exception instanceof UniqueConstraintError) {
      return { status: HttpStatus.CONFLICT, message: 'ข้อมูลนี้มีอยู่ในระบบแล้ว' };
    }

    if (exception instanceof ForeignKeyConstraintError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        message: 'ข้อมูลอ้างอิงไม่ถูกต้อง หรือถูกใช้งานอยู่ ไม่สามารถดำเนินการได้',
      };
    }

    if (exception instanceof SequelizeValidationError) {
      const first = exception.errors?.[0]?.message;
      return {
        status: HttpStatus.BAD_REQUEST,
        message: first ?? 'ข้อมูลไม่ผ่านการตรวจสอบ',
      };
    }

    this.logger.error(`Sequelize error: ${exception.name} — ${exception.message}`);
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'เกิดข้อผิดพลาดในการเข้าถึงฐานข้อมูล',
    };
  }

  private isGenericEnglish(message: string): boolean {
    return /^[\x20-\x7E]+$/.test(message) && !/[ก-๙]/.test(message)
      ? GENERIC_NEST_MESSAGES.has(message.toLowerCase())
      : false;
  }
}

const KNOWN_ENGLISH_MESSAGES: Record<string, string> = {
  'file too large': 'ไฟล์มีขนาดใหญ่เกินกำหนด',
  'too many files': 'แนบไฟล์ได้ครั้งละ 1 ไฟล์',
  'unexpected field': 'ชื่อฟิลด์ของไฟล์ไม่ถูกต้อง — ต้องแนบไฟล์ในฟิลด์ชื่อ file',
  'multipart: boundary not found':
    'รูปแบบการอัปโหลดไฟล์ไม่ถูกต้อง — ต้องส่งเป็น multipart/form-data',
};

const GENERIC_NEST_MESSAGES = new Set([
  'bad request',
  'unauthorized',
  'forbidden',
  'not found',
  'method not allowed',
  'conflict',
  'payload too large',
  'unsupported media type',
  'unprocessable entity',
  'too many requests',
  'internal server error',
  'service unavailable',
]);
