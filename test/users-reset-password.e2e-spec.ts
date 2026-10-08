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

/**
 * ผู้ดูแลตั้งรหัสใหม่ให้พนักงานที่ลืม — ไม่มีลิงก์สาธารณะ
 * SUPER_ADMIN / ADMIN ใช้ได้ตามตาราง 4.1, USER ที่ไม่มีสิทธิ์ต้องได้ 403
 */

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message: string | null;
}

const DEMO_PASSWORD = process.env.DEMO_USER_PASSWORD ?? 'Demo@1234';

describe('ตั้งรหัสผ่านใหม่ให้ผู้ใช้ (e2e)', () => {
  let app: INestApplication;
  let superToken: string;
  let adminToken: string;
  let userToken: string;
  let superAdminId: number;
  let targetUserId: number;
  const stamp = Date.now();
  const username = `e2e_reset_${stamp}`;
  const oldPassword = 'OldPassw0rd!';
  const newPassword = 'NewPassw0rd!';

  function api() {
    return request(app.getHttpServer() as Parameters<typeof request>[0]);
  }

  function login(name: string, password: string) {
    return api().post('/api/auth/login').send({ username: name, password });
  }

  async function loginToken(name: string, password: string): Promise<string> {
    const response = await login(name, password).expect(200);
    return (response.body as ApiResponse<{ accessToken: string }>).data.accessToken;
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

    superToken = await loginToken(
      process.env.SUPER_ADMIN_USERNAME ?? 'superadmin',
      process.env.SUPER_ADMIN_PASSWORD as string,
    );
    adminToken = await loginToken('somchai', DEMO_PASSWORD);
    userToken = await loginToken('pranee', DEMO_PASSWORD);

    const me = await api()
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${superToken}`)
      .expect(200);
    superAdminId = (me.body as ApiResponse<{ id: number }>).data.id;

    const created = await api()
      .post('/api/users')
      .set('Authorization', `Bearer ${superToken}`)
      .send({
        username,
        password: oldPassword,
        fullName: `ผู้ใช้ลืมรหัส ${stamp}`,
      })
      .expect(201);
    targetUserId = (created.body as ApiResponse<{ id: number }>).data.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('ยังต้องล็อกอินก่อน — ไม่มีลิงก์สาธารณะ', async () => {
    await api().post(`/api/users/${targetUserId}/reset-password`).send({ newPassword }).expect(401);
  });

  it('USER ที่ไม่มีสิทธิ์ตั้งรหัสให้คนอื่นไม่ได้', async () => {
    await api()
      .post(`/api/users/${targetUserId}/reset-password`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ newPassword })
      .expect(403);
  });

  it('ADMIN ตั้งรหัสให้ SUPER_ADMIN ไม่ได้', async () => {
    await api()
      .post(`/api/users/${superAdminId}/reset-password`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ newPassword })
      .expect(403);
  });

  it('ตั้งรหัสของตนเองผ่านเส้นนี้ไม่ได้', async () => {
    const me = await api()
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const adminId = (me.body as ApiResponse<{ id: number }>).data.id;

    await api()
      .post(`/api/users/${adminId}/reset-password`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ newPassword })
      .expect(400);
  });

  it('ADMIN ตั้งรหัสให้ USER ได้ รหัสเก่าใช้ไม่ได้ รหัสใหม่เข้าได้', async () => {
    await login(username, oldPassword).expect(200);

    const response = await api()
      .post(`/api/users/${targetUserId}/reset-password`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ newPassword })
      .expect(200);

    expect((response.body as ApiResponse<null>).data).toBeNull();
    expect((response.body as ApiResponse<null>).message).toMatch(/เข้าสู่ระบบใหม่/);

    await login(username, oldPassword).expect(401);
    await login(username, newPassword).expect(200);
  });

  it('SUPER_ADMIN แก้ชื่อ-นามสกุลของตัวเองได้ · ว่าง/null/username = 400', async () => {
    const before = await api()
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${superToken}`)
      .expect(200);
    const originalName = (before.body as ApiResponse<{ fullName: string }>).data.fullName;

    const updated = await api()
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${superToken}`)
      .send({ fullName: `  ผู้ดูแลระบบ ${stamp}  ` })
      .expect(200);
    expect((updated.body as ApiResponse<{ fullName: string }>).data.fullName).toBe(
      `ผู้ดูแลระบบ ${stamp}`,
    );

    for (const body of [{ fullName: '   ' }, { fullName: null }, { username: 'renamed' }]) {
      await api()
        .patch('/api/users/me')
        .set('Authorization', `Bearer ${superToken}`)
        .send(body)
        .expect(400);
    }

    await api()
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${superToken}`)
      .send({ fullName: originalName })
      .expect(200);
  });
});
