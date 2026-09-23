/// <reference types="jest" />
// TypeScript 6 ไม่ดึง @types/jest เข้ามาให้อัตโนมัติ ต้องอ้างถึงตรงนี้เหมือน spec ตัวอื่น

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
 * ตรึงตาราง CLAUDE.md 4.1 ด้วยของจริง — ยิงผ่าน HTTP ด้วยบัญชีจริงทั้งสามระดับ
 *
 * `permissions.guard.spec.ts` คุมลำดับการตรวจไว้แล้วในระดับ unit แต่พิสูจน์ไม่ได้ว่า
 * endpoint จริงติด decorator ถูกตัว เคสนี้จึงมีไว้ตอบคำถามแบบที่ frontend ถามได้ว่า
 * "บัญชีระดับนี้เรียกเส้นนี้ได้จริงไหม" โดยไม่ต้องเดาจากโค้ด
 *
 * ใช้บัญชีตัวอย่างจาก seeder `20260908000004-seed-demo-data.js`
 *   somchai = ADMIN (ไม่ถือ role ใด ๆ)   pranee = USER (ถือ role จริง)
 */

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message: string | null;
}

const DEMO_PASSWORD = process.env.DEMO_USER_PASSWORD ?? 'Demo@1234';

describe('Permissions (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let userToken: string;

  function api() {
    return request(app.getHttpServer() as Parameters<typeof request>[0]);
  }

  async function login(username: string, password: string): Promise<string> {
    const response = await api().post('/api/auth/login').send({ username, password }).expect(200);

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

    adminToken = await login('somchai', DEMO_PASSWORD);
    userToken = await login('pranee', DEMO_PASSWORD);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('ADMIN', () => {
    it('เรียก GET /api/users ได้โดยไม่ต้องถือ role ใด ๆ (CLAUDE.md 4.1)', async () => {
      const me = await api()
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const profile = (
        me.body as ApiResponse<{ accountType: string; roles: unknown[]; permissions: string[] }>
      ).data;

      // ถ้าบัญชีทดสอบไม่ใช่ ADMIN จริง เคสข้างล่างจะไม่ได้พิสูจน์อะไรเลย
      expect(profile.accountType).toBe('ADMIN');
      expect(profile.roles).toHaveLength(0);
      expect(profile.permissions).toContain('user.view');

      await api().get('/api/users').set('Authorization', `Bearer ${adminToken}`).expect(200);
    });

    it('จัดการบทบาทไม่ได้ ต่อให้ bypass เมนูอื่นได้หมด (BR-10)', async () => {
      await api().get('/api/roles').set('Authorization', `Bearer ${adminToken}`).expect(403);
      await api().get('/api/permissions').set('Authorization', `Bearer ${adminToken}`).expect(403);
    });

    it('เห็นรายชื่อบทบาทผ่าน /roles/assignable ได้ เพื่อมอบบทบาทให้ผู้ใช้ (CLAUDE.md 4.1)', async () => {
      // ADMIN มีสิทธิ์มอบบทบาท แต่เข้า GET /api/roles ไม่ได้ ถ้าไม่มีเส้นนี้
      // สิทธิ์ที่ให้ไว้จะใช้ไม่ได้จริงเพราะดรอปดาวน์จะว่างเปล่า
      const response = await api()
        .get('/api/roles/assignable')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const roles = (
        response.body as ApiResponse<{ id: number; name: string; description: string | null }[]>
      ).data;

      expect(roles.length).toBeGreaterThan(0);
      // ห้ามมีรายการสิทธิ์ติดมาด้วย ไม่งั้นเส้นนี้จะกลายเป็นช่องข้าม BR-10
      expect(Object.keys(roles[0]).sort()).toEqual(['description', 'id', 'name']);
    });

    it('รายการสิทธิ์ที่ /auth/me คืน ต้องไม่มีสิทธิ์ที่สงวนให้ SUPER_ADMIN', async () => {
      const me = await api()
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const permissions = (me.body as ApiResponse<{ permissions: string[] }>).data.permissions;

      for (const reserved of ['role.manage', 'role.view', 'permission.view']) {
        expect(permissions).not.toContain(reserved);
      }
    });
  });

  describe('USER', () => {
    it('เข้าได้เฉพาะเมนูตาม role ที่ได้รับ ไม่ใช่ทุกเมนู', async () => {
      const me = await api()
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      const profile = (
        me.body as ApiResponse<{ accountType: string; permissions: string[] }>
      ).data;

      expect(profile.accountType).toBe('USER');

      // เส้นที่ตัดสินผลต้องสอดคล้องกับสิทธิ์ที่ /auth/me คืนมาจริง
      // ไม่ hardcode ว่าเป็น 200 หรือ 403 เพราะ role ตัวอย่างแก้ได้ที่ seeder
      const expected = profile.permissions.includes('user.view') ? 200 : 403;
      await api().get('/api/users').set('Authorization', `Bearer ${userToken}`).expect(expected);
    });

    it('จัดการบทบาทไม่ได้เช่นกัน', async () => {
      await api().get('/api/roles').set('Authorization', `Bearer ${userToken}`).expect(403);
    });

    it('/roles/assignable ยังกั้นด้วย user.update ไม่ได้เปิดให้ทุกคนที่ล็อกอิน', async () => {
      const me = await api()
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      const permissions = (me.body as ApiResponse<{ permissions: string[] }>).data.permissions;
      const expected = permissions.includes('user.update') ? 200 : 403;

      await api()
        .get('/api/roles/assignable')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(expected);
    });

    it('คิวซัพพอร์ตแยกจากเปิดใบ — มี ticket.support_queue ถึงเข้าได้ (C-1)', async () => {
      // pranee = บทบาทซัพพอร์ตตัวอย่าง ต้องได้สิทธิ์คิวหลัง migration/seed
      const me = await api()
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      const permissions = (me.body as ApiResponse<{ permissions: string[] }>).data.permissions;
      expect(permissions).toContain('ticket.support_queue');

      await api()
        .get('/api/tickets/support-queue?tab=AWAITING_SEND')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);
    });
  });

  describe('ticket.support_queue แยกจาก ticket.create', () => {
    let superToken: string;
    const stamp = Date.now();

    beforeAll(async () => {
      superToken = await login(
        process.env.SUPER_ADMIN_USERNAME ?? 'superadmin',
        process.env.SUPER_ADMIN_PASSWORD ?? '',
      );
    });

    it('บัญชีมีแค่ ticket.view + ticket.create เข้าปัญหาได้แต่คิวซัพพอร์ตได้ 403', async () => {
      const catalog = await api()
        .get('/api/permissions')
        .set('Authorization', `Bearer ${superToken}`)
        .expect(200);

      const groups = (
        catalog.body as ApiResponse<{ module: string; permissions: { id: number; code: string }[] }[]>
      ).data;
      const allPerms = groups.flatMap((group) => group.permissions);
      expect(allPerms.some((item) => item.code === 'ticket.support_queue')).toBe(true);

      const viewId = allPerms.find((item) => item.code === 'ticket.view')?.id;
      const createId = allPerms.find((item) => item.code === 'ticket.create')?.id;
      expect(viewId).toBeDefined();
      expect(createId).toBeDefined();

      const roleRes = await api()
        .post('/api/roles')
        .set('Authorization', `Bearer ${superToken}`)
        .send({
          name: `เปิดใบอย่างเดียว ${stamp}`,
          description: 'Developer แบบมีแค่ view+create',
          permissionIds: [viewId, createId],
        })
        .expect(201);

      const roleId = (roleRes.body as ApiResponse<{ id: number }>).data.id;

      const username = `dev_open_${stamp}`;
      const password = 'DevOpen@1234';
      await api()
        .post('/api/users')
        .set('Authorization', `Bearer ${superToken}`)
        .send({
          username,
          password,
          fullName: 'Developer เปิดใบอย่างเดียว',
          accountType: 'USER',
          roleIds: [roleId],
        })
        .expect(201);

      const token = await login(username, password);

      const me = await api().get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(200);
      const permissions = (me.body as ApiResponse<{ permissions: string[] }>).data.permissions;
      expect(permissions).toContain('ticket.view');
      expect(permissions).toContain('ticket.create');
      expect(permissions).not.toContain('ticket.support_queue');

      await api().get('/api/tickets?limit=1').set('Authorization', `Bearer ${token}`).expect(200);

      await api()
        .get('/api/tickets/support-queue?tab=AWAITING_SEND')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      await api()
        .get('/api/tickets/admin-queue?tab=AWAITING_CLAIM')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });
  });
});
