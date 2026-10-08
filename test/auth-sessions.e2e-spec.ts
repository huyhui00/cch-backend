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
import { SESSION_REPLACED } from '../src/modules/auth/auth.service';

/** บัญชีละหนึ่งเครื่อง — ล็อกอินซ้อนแล้วเครื่องเดิมหลุดทันที (CLAUDE.md 4.4) */

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message: string | null;
}

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

describe('บัญชีละหนึ่งเครื่อง (e2e)', () => {
  let app: INestApplication;
  let superToken: string;
  let userId: number;
  const stamp = Date.now();
  const username = `e2e_sessions_${stamp}`;
  const password = 'SessPassw0rd!';

  function api() {
    return request(app.getHttpServer() as Parameters<typeof request>[0]);
  }

  async function login(name = username, pass = password): Promise<Tokens> {
    const response = await api()
      .post('/api/auth/login')
      .send({ username: name, password: pass })
      .expect(200);
    return (response.body as ApiResponse<Tokens>).data;
  }

  function refresh(refreshToken: string) {
    return api().post('/api/auth/refresh').send({ refreshToken });
  }

  async function refreshOk(refreshToken: string): Promise<Tokens> {
    const response = await refresh(refreshToken).expect(200);
    return (response.body as ApiResponse<Tokens>).data;
  }

  function me(accessToken: string) {
    return api().get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.use(requestContextMiddleware);
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createValidationPipe());
    app.useGlobalInterceptors(new RequestContextInterceptor(), new TransformInterceptor());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    superToken = (
      await login(
        process.env.SUPER_ADMIN_USERNAME ?? 'superadmin',
        process.env.SUPER_ADMIN_PASSWORD as string,
      )
    ).accessToken;

    const created = await api()
      .post('/api/users')
      .set('Authorization', `Bearer ${superToken}`)
      .send({ username, password, fullName: `ผู้ใช้ทดสอบ session ${stamp}` })
      .expect(201);
    userId = (created.body as ApiResponse<{ id: number }>).data.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('ล็อกอินซ้อน เครื่องเดิมหลุดทันทีทั้ง access และ refresh พร้อมข้อความบอกเหตุ', async () => {
    const pc = await login();
    await me(pc.accessToken).expect(200);

    const phone = await login();

    const kicked = await me(pc.accessToken).expect(401);
    expect((kicked.body as ApiResponse<null>).message).toBe(SESSION_REPLACED);
    const refreshKicked = await refresh(pc.refreshToken).expect(401);
    expect((refreshKicked.body as ApiResponse<null>).message).toBe(SESSION_REPLACED);

    await me(phone.accessToken).expect(200);
    await refreshOk(phone.refreshToken);
  });

  it('refresh token ใบเก่าใช้ซ้ำไม่ได้หลังหมุนแล้ว แม้ในวินาทีเดียวกัน', async () => {
    const device = await login();
    const rotated = await refreshOk(device.refreshToken);

    expect(rotated.refreshToken).not.toBe(device.refreshToken);
    await refresh(device.refreshToken).expect(401);
    await refreshOk(rotated.refreshToken);
  });

  it('ออกจากระบบแล้วใช้ต่อไม่ได้ทันที', async () => {
    const device = await login();

    await api()
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${device.accessToken}`)
      .expect(200);

    await me(device.accessToken).expect(401);
    await refresh(device.refreshToken).expect(401);
  });

  it('รีเซ็ตรหัสแล้วเครื่องที่ล็อกอินอยู่หลุดทันที', async () => {
    const device = await login();

    await api()
      .post(`/api/users/${userId}/reset-password`)
      .set('Authorization', `Bearer ${superToken}`)
      .send({ newPassword: password })
      .expect(200);

    await me(device.accessToken).expect(401);
    await refresh(device.refreshToken).expect(401);
  });

  it('ระงับบัญชีแล้วหลุด', async () => {
    const device = await login();

    await api()
      .patch(`/api/users/${userId}/status`)
      .set('Authorization', `Bearer ${superToken}`)
      .send({ status: 'SUSPENDED' })
      .expect(200);
    await api()
      .patch(`/api/users/${userId}/status`)
      .set('Authorization', `Bearer ${superToken}`)
      .send({ status: 'ACTIVE' })
      .expect(200);

    await refresh(device.refreshToken).expect(401);
  });

  it('ประวัติการใช้งานบันทึกล็อกอิน/ตัดเครื่องเดิม/ออกจากระบบ และซ่อนได้ด้วย hideSessionEvents', async () => {
    await login();
    const device = await login();
    await refreshOk(device.refreshToken);
    await api()
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${device.accessToken}`)
      .expect(200);

    const all = await api()
      .get(`/api/audit-logs?userId=${userId}&tableName=user_sessions&limit=100`)
      .set('Authorization', `Bearer ${superToken}`)
      .expect(200);
    const summaries = (all.body as ApiResponse<{ items: { summary: string }[] }>).data.items.map(
      (item) => item.summary,
    );

    expect(summaries).toEqual(
      expect.arrayContaining([
        'เข้าสู่ระบบ',
        'ตัดการเข้าสู่ระบบเดิมของผู้ใช้',
        'ต่ออายุการเข้าสู่ระบบ',
        'ออกจากระบบ',
      ]),
    );

    const hidden = await api()
      .get(`/api/audit-logs?userId=${userId}&tableName=user_sessions&hideSessionEvents=true`)
      .set('Authorization', `Bearer ${superToken}`)
      .expect(200);
    expect((hidden.body as ApiResponse<{ items: unknown[] }>).data.items).toHaveLength(0);
  });
});
