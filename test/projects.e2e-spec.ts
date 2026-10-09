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
 * e2e ของข้อตกลงประชุมครั้งที่ 3 (11 ก.ย.) ฝั่งโครงการและผู้ใช้
 *
 *   B-3  สร้างโครงการพร้อมลูกค้าใหม่ในฟอร์มเดียว — ลูกค้าถูกบันทึกจริง และสิทธิ์ customer.create
 *        ถูกบังคับจริงกับบัญชี USER ที่มีแค่ project.create
 *   B-1  ผู้ใช้ถือบทบาทได้อันเดียว — บังคับทั้งตอนสร้างผู้ใช้และตอนมอบบทบาท
 */

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message: string | null;
}

interface ProjectPayload {
  id: number;
  customerId: number;
  name: string;
  customer: { id: number; name: string } | null;
}

interface PermissionGroup {
  module: string;
  permissions: { id: number; code: string }[];
}

describe('Projects + ผู้ใช้ — ข้อตกลงประชุม 11 ก.ย. (e2e)', () => {
  let app: INestApplication;
  let superToken: string;
  /** บัญชี USER ที่มีแค่สิทธิ์ project.view + project.create ไม่มี customer.create */
  let projectOnlyToken: string;
  let projectOnlyUserId: number;
  let projectOnlyRoleId: number;
  let otherRoleId: number;
  let existingCustomerId: number;

  const stamp = Date.now();

  function api() {
    return request(app.getHttpServer() as Parameters<typeof request>[0]);
  }

  function as(token: string, method: 'get' | 'post' | 'put', url: string) {
    return api()[method](url).set('Authorization', `Bearer ${token}`);
  }

  async function login(username: string, password: string): Promise<string> {
    const response = await api().post('/api/auth/login').send({ username, password }).expect(200);
    return (response.body as ApiResponse<{ accessToken: string }>).data.accessToken;
  }

  async function createRole(name: string, permissionIds: number[]): Promise<number> {
    const response = await as(superToken, 'post', '/api/roles')
      .send({ name, permissionIds })
      .expect(201);
    return (response.body as ApiResponse<{ id: number }>).data.id;
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

    superToken = await login(
      process.env.SUPER_ADMIN_USERNAME ?? 'superadmin',
      process.env.SUPER_ADMIN_PASSWORD as string,
    );

    const groups = await as(superToken, 'get', '/api/permissions').expect(200);
    const idOf = (code: string): number => {
      for (const group of (groups.body as ApiResponse<PermissionGroup[]>).data) {
        const found = group.permissions.find((permission) => permission.code === code);
        if (found) {
          return found.id;
        }
      }
      throw new Error(`ไม่พบสิทธิ์ ${code} ใน seeder`);
    };

    projectOnlyRoleId = await createRole(`E2E สร้างโครงการอย่างเดียว ${stamp}`, [
      idOf('project.view'),
      idOf('project.create'),
    ]);
    otherRoleId = await createRole(`E2E ดูโครงการ ${stamp}`, [idOf('project.view')]);

    const password = 'E2e@Pass1234';
    const user = await as(superToken, 'post', '/api/users')
      .send({
        username: `e2e_pm_${stamp}`,
        password,
        fullName: `ผู้จัดการโครงการ ${stamp}`,
        roleIds: [projectOnlyRoleId],
      })
      .expect(201);
    projectOnlyUserId = (user.body as ApiResponse<{ id: number }>).data.id;
    projectOnlyToken = await login(`e2e_pm_${stamp}`, password);

    const customer = await as(superToken, 'post', '/api/customers')
      .send({ name: `ลูกค้าเดิม ${stamp}` })
      .expect(201);
    existingCustomerId = (customer.body as ApiResponse<{ id: number }>).data.id;
  });

  afterAll(async () => {
    await app.close();
  });

  // -------------------------------------------------------------------------
  // B-3 สร้างโครงการพร้อมลูกค้าใหม่
  // -------------------------------------------------------------------------
  describe('สร้างโครงการพร้อมลูกค้าใหม่ (B-3)', () => {
    it('บันทึกทั้งลูกค้าและโครงการ ลูกค้าใหม่ได้สถานะ ACTIVE ตามค่าเริ่มต้น', async () => {
      const response = await as(superToken, 'post', '/api/projects')
        .send({
          name: `โครงการของลูกค้าใหม่ ${stamp}`,
          newCustomer: {
            name: `บริษัท ลูกค้าใหม่ ${stamp} จำกัด`,
            taxId: '0105561234567',
            address: '99 ถนนทดสอบ กรุงเทพฯ',
          },
        })
        .expect(201);

      const body = response.body as ApiResponse<ProjectPayload>;
      expect(body.message).toBe('สร้างโครงการพร้อมลูกค้าใหม่เรียบร้อย');
      expect(body.data.customer?.name).toBe(`บริษัท ลูกค้าใหม่ ${stamp} จำกัด`);

      const customer = await as(superToken, 'get', `/api/customers/${body.data.customerId}`).expect(
        200,
      );
      const saved = (customer.body as ApiResponse<{ taxId: string; status: string }>).data;
      expect(saved.taxId).toBe('0105561234567');
      expect(saved.status).toBe('ACTIVE');
    });

    it('ส่งมาทั้ง customerId และ newCustomer → 400', async () => {
      await as(superToken, 'post', '/api/projects')
        .send({
          name: `ส่งมาทั้งคู่ ${stamp}`,
          customerId: existingCustomerId,
          newCustomer: { name: `ไม่ควรถูกสร้าง ${stamp}` },
        })
        .expect(400);
    });

    it('ไม่ส่งลูกค้ามาเลย → 400', async () => {
      await as(superToken, 'post', '/api/projects')
        .send({ name: `ไม่มีลูกค้า ${stamp}` })
        .expect(400);
    });

    it('ข้อมูลลูกค้าใหม่ไม่ครบ (ไม่มีชื่อ) → 400 ข้อความภาษาไทย', async () => {
      const response = await as(superToken, 'post', '/api/projects')
        .send({ name: `ลูกค้าไม่มีชื่อ ${stamp}`, newCustomer: { taxId: '0105561234567' } })
        .expect(400);

      expect((response.body as ApiResponse<null>).message).toMatch(/[ก-๙]/);
    });

    it('USER ที่มีแค่ project.create สร้างลูกค้าใหม่ผ่านเส้นนี้ไม่ได้ และไม่มีลูกค้าหลุดลงฐาน', async () => {
      const customerName = `ลูกค้าที่ไม่ควรถูกสร้าง ${stamp}`;

      await as(projectOnlyToken, 'post', '/api/projects')
        .send({ name: `โครงการของคนไม่มีสิทธิ์ ${stamp}`, newCustomer: { name: customerName } })
        .expect(403);

      const search = await as(
        superToken,
        'get',
        `/api/customers?search=${encodeURIComponent(customerName)}`,
      ).expect(200);
      expect((search.body as ApiResponse<{ total: number }>).data.total).toBe(0);
    });

    it('USER คนเดียวกันยังสร้างโครงการกับลูกค้าเดิมได้ตามปกติ', async () => {
      await as(projectOnlyToken, 'post', '/api/projects')
        .send({ name: `โครงการกับลูกค้าเดิม ${stamp}`, customerId: existingCustomerId })
        .expect(201);
    });

    it('สร้างได้แค่ DRAFT / IN_PROGRESS · แก้ไขทีหลังเปลี่ยนเป็น CLOSED ได้', async () => {
      for (const status of ['DELIVERED', 'CLOSED', 'CANCELLED']) {
        const response = await as(superToken, 'post', '/api/projects')
          .send({ name: `เริ่มผิดสถานะ ${status} ${stamp}`, customerId: existingCustomerId, status })
          .expect(400);
        expect((response.body as ApiResponse<null>).message).toMatch(/ร่าง/);
      }

      const created = await as(superToken, 'post', '/api/projects')
        .send({ name: `เริ่มทำเลย ${stamp}`, customerId: existingCustomerId, status: 'IN_PROGRESS' })
        .expect(201);
      const id = (created.body as ApiResponse<ProjectPayload>).data.id;

      await as(superToken, 'put', `/api/projects/${id}`).send({ status: 'CLOSED' }).expect(200);
    });

    it('แก้ไขโครงการส่ง newCustomer มาไม่ได้ — การสร้างลูกค้าใหม่ตอนแก้ไขคือการย้ายลูกค้า', async () => {
      const created = await as(superToken, 'post', '/api/projects')
        .send({ name: `แก้ไขทีหลัง ${stamp}`, customerId: existingCustomerId })
        .expect(201);
      const id = (created.body as ApiResponse<ProjectPayload>).data.id;

      const response = await as(superToken, 'put', `/api/projects/${id}`)
        .send({ newCustomer: { name: `ลูกค้าอื่น ${stamp}` } })
        .expect(400);

      expect((response.body as ApiResponse<null>).message).toContain('ไม่รู้จักฟิลด์');
    });
  });

  // -------------------------------------------------------------------------
  // B-1 ผู้ใช้ถือบทบาทได้อันเดียว
  // -------------------------------------------------------------------------
  describe('ผู้ใช้ถือบทบาทได้อันเดียว (B-1)', () => {
    it('มอบสองบทบาทพร้อมกันไม่ได้ ข้อความบอกให้สร้างบทบาทใหม่ที่รวมสิทธิ์', async () => {
      const response = await as(superToken, 'put', `/api/users/${projectOnlyUserId}/roles`)
        .send({ roleIds: [projectOnlyRoleId, otherRoleId] })
        .expect(400);

      expect((response.body as ApiResponse<null>).message).toContain('บทบาทได้อันเดียว');
    });

    it('สร้างผู้ใช้พร้อมสองบทบาทไม่ได้เช่นกัน', async () => {
      await as(superToken, 'post', '/api/users')
        .send({
          username: `e2e_two_roles_${stamp}`,
          password: 'E2e@Pass1234',
          fullName: 'ถือสองบทบาท',
          roleIds: [projectOnlyRoleId, otherRoleId],
        })
        .expect(400);
    });

    it('เปลี่ยนเป็นบทบาทเดียวอันใหม่ และถอดบทบาทออกหมดยังทำได้', async () => {
      await as(superToken, 'put', `/api/users/${projectOnlyUserId}/roles`)
        .send({ roleIds: [otherRoleId] })
        .expect(200);

      await as(superToken, 'put', `/api/users/${projectOnlyUserId}/roles`)
        .send({ roleIds: [] })
        .expect(200);
    });
  });

  describe('B-6 — สรุปตัวเลขรายงานของโปรเจค', () => {
    it('GET /projects/:id/report คืนความคืบหน้าและตัวนับที่เกี่ยวข้อง', async () => {
      const created = await as(superToken, 'post', '/api/projects')
        .send({
          customerId: existingCustomerId,
          name: `รายงานโปรเจค ${stamp}`,
          status: 'IN_PROGRESS',
          priority: 'NORMAL',
        })
        .expect(201);

      const projectId = (created.body as ApiResponse<ProjectPayload>).data.id;

      const response = await as(superToken, 'get', `/api/projects/${projectId}/report`).expect(200);
      const report = (
        response.body as ApiResponse<{
          projectId: number;
          progress: { percent: number; totalTasks: number };
          ticketCount: number;
          deliveryCount: number;
          maContractCount: number;
        }>
      ).data;

      expect(report.projectId).toBe(projectId);
      expect(report.progress.totalTasks).toBe(0);
      expect(report.progress.percent).toBe(0);
      expect(report.ticketCount).toBe(0);
      expect(report.deliveryCount).toBe(0);
      expect(report.maContractCount).toBe(0);
    });
  });
});
