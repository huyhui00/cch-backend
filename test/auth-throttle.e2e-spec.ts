/// <reference types="jest" />

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { requestContextMiddleware } from '../src/common/context/request-context';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { RequestContextInterceptor } from '../src/common/interceptors/request-context.interceptor';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';
import { createValidationPipe } from '../src/common/pipes/validation.pipe';
import { LOGIN_THROTTLE } from '../src/modules/auth/auth.controller';

/**
 * จำกัดจำนวนคำขอ — ล็อกอินนับต่อ IP (ถังแยก) · คำขอที่ล็อกอินแล้วนับต่อผู้ใช้รวมทุกเส้น
 * ไฟล์อื่นปิดการจำกัดไว้ใน setup-env.js ไฟล์นี้เปิดเองแล้วคืนค่าตอนจบ
 * เทสต์ในไฟล์นี้ต่อเนื่องกัน (ตัวนับอยู่ในหน่วยความจำของแอปตัวเดียว) ห้ามสลับลำดับ
 */

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message: string | null;
}

const GLOBAL_LIMIT = 300;
const THROTTLED_MESSAGE = 'มีคำขอมากเกินไป กรุณารอสักครู่แล้วลองใหม่';
const DEMO_PASSWORD = process.env.DEMO_USER_PASSWORD ?? 'Demo@1234';

describe('จำกัดจำนวนคำขอ (e2e)', () => {
  let app: INestApplication;
  let superToken: string;
  let adminToken: string;
  let loginsUsed = 0;
  const previous = process.env.THROTTLE_ENABLED;

  function api() {
    return request(app.getHttpServer() as Parameters<typeof request>[0]);
  }

  function wrongLogin() {
    return api()
      .post('/api/auth/login')
      .send({ username: `e2e_throttle_${Date.now()}`, password: 'WrongPassw0rd!' });
  }

  async function loginToken(username: string, password: string): Promise<string> {
    loginsUsed += 1;
    const res = await api().post('/api/auth/login').send({ username, password }).expect(200);
    return (res.body as ApiResponse<{ accessToken: string }>).data.accessToken;
  }

  function me(token: string) {
    return api().get('/api/auth/me').set('Authorization', `Bearer ${token}`);
  }

  beforeAll(async () => {
    process.env.THROTTLE_ENABLED = 'true';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.use(requestContextMiddleware);
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createValidationPipe());
    app.useGlobalInterceptors(new RequestContextInterceptor(), new TransformInterceptor());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    superToken = await loginToken(
      process.env.SUPER_ADMIN_USERNAME ?? 'superadmin',
      process.env.SUPER_ADMIN_PASSWORD as string,
    );
    adminToken = await loginToken('somchai', DEMO_PASSWORD);
  });

  afterAll(async () => {
    if (previous === undefined) {
      delete process.env.THROTTLE_ENABLED;
    } else {
      process.env.THROTTLE_ENABLED = previous;
    }
    await app.close();
  });

  it('ลองล็อกอินผิดได้ตามเพดาน ครั้งถัดไปได้ 429 และ health ยังเรียกได้', async () => {
    for (let attempt = loginsUsed; attempt < LOGIN_THROTTLE.limit; attempt += 1) {
      await wrongLogin().expect(401);
    }

    const blocked = await wrongLogin().expect(429);
    const body = blocked.body as ApiResponse<null>;

    expect(body.success).toBe(false);
    expect(body.message).toBe(THROTTLED_MESSAGE);
    expect(blocked.headers['retry-after']).toBeDefined();

    await api().get('/api/health').expect(200);
  });

  it('IP ถูกบล็อกล็อกอินแล้ว ผู้ใช้ที่ล็อกอินอยู่จาก IP เดียวกันยังใช้งานได้', async () => {
    await me(superToken).expect(200);
    await me(adminToken).expect(200);
  });

  it('เพดานรวมนับต่อผู้ใช้ — คนหนึ่งเกินแล้ว อีกคนจาก IP เดียวกันไม่โดนด้วย', async () => {
    // ข้อก่อนหน้าใช้ไปแล้ว 1 ครั้ง
    for (let hit = 1; hit < GLOBAL_LIMIT; hit += 1) {
      await me(adminToken).expect(200);
    }

    const blocked = await me(adminToken).expect(429);
    expect((blocked.body as ApiResponse<null>).message).toBe(THROTTLED_MESSAGE);

    await me(superToken).expect(200);
  }, 120_000);
});
