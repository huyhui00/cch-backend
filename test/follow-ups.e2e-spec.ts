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
 * e2e ของ M7 — งานติดตามลูกค้า
 *
 * พิสูจน์สิ่งที่ mock พิสูจน์แทนไม่ได้:
 *   - การกรอง ?overdue=true ทำงานจริงบน DATEONLY ของ MySQL
 *   - ธง isOverdue ของแต่ละแถวตรงกับผลของการกรอง (ไม่ขัดกันเอง)
 *   - ปิดงานติดตามแล้ว customers.lastContactedAt ไม่ขยับ
 *   - ผูกโปรเจคแล้ว customer_id มาจากโปรเจค และคอลัมน์ project_id ใหม่ใช้งานได้จริง (B-14)
 */

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message: string | null;
}

interface FollowUpPayload {
  id: number;
  customerId: number;
  projectId: number | null;
  project: { id: number; name: string } | null;
  title: string;
  dueDate: string;
  status: string;
  isOverdue: boolean;
  daysUntilDue: number;
  assignedUserId: number | null;
  completedAt: string | null;
  resultNote: string | null;
}

interface ListPayload<T> {
  items: T[];
  total: number;
}

describe('Follow-ups (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let customerId: number;
  let projectId: number;
  let otherCustomerProjectId: number;

  const stamp = Date.now();

  /** วันที่คำนวณจากวันที่รันเสมอ ไม่ fix ไว้ เทสต์จะได้ไม่เน่าเมื่อเวลาผ่านไป */
  const shiftDays = (days: number): string => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  function api() {
    return request(app.getHttpServer() as Parameters<typeof request>[0]);
  }

  function authed(method: 'get' | 'post' | 'patch' | 'delete', url: string) {
    return api()[method](url).set('Authorization', `Bearer ${token}`);
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

    const login = await api()
      .post('/api/auth/login')
      .send({
        username: process.env.SUPER_ADMIN_USERNAME ?? 'superadmin',
        password: process.env.SUPER_ADMIN_PASSWORD,
      })
      .expect(200);
    token = (login.body as ApiResponse<{ accessToken: string }>).data.accessToken;

    const customer = await authed('post', '/api/customers')
      .send({ name: `ลูกค้าทดสอบงานติดตาม ${stamp}`, code: `E2E-FU-${stamp}`, status: 'ACTIVE' })
      .expect(201);
    customerId = (customer.body as ApiResponse<{ id: number }>).data.id;

    const project = await authed('post', '/api/projects')
      .send({ customerId, name: `โปรเจคที่ติดตาม ${stamp}` })
      .expect(201);
    projectId = (project.body as ApiResponse<{ id: number }>).data.id;

    const otherCustomer = await authed('post', '/api/customers')
      .send({ name: `ลูกค้าอีกราย ${stamp}`, status: 'ACTIVE' })
      .expect(201);
    const otherProject = await authed('post', '/api/projects')
      .send({
        customerId: (otherCustomer.body as ApiResponse<{ id: number }>).data.id,
        name: `โปรเจคของลูกค้าอีกราย ${stamp}`,
      })
      .expect(201);
    otherCustomerProjectId = (otherProject.body as ApiResponse<{ id: number }>).data.id;
  });

  afterAll(async () => {
    await app.close();
  });

  function createFollowUp(body: Record<string, unknown>) {
    return authed('post', '/api/follow-ups').send({
      customerId,
      title: `งานติดตาม ${stamp}`,
      dueDate: shiftDays(7),
      ...body,
    });
  }

  // -------------------------------------------------------------------------
  // OVERDUE เป็นค่าที่คำนวณ ไม่ใช่ค่าที่เก็บ
  // -------------------------------------------------------------------------
  it('สร้างด้วยวันย้อนหลังได้ status PLANNED แต่ isOverdue เป็น true', async () => {
    // นี่คือหัวใจของโมดูลนี้ — ยังไม่มี scheduler ปรับ status เป็น OVERDUE
    // จนกว่าจะถึง Phase 11 หน้าจอจึงต้องอ่าน isOverdue ไม่ใช่ status
    const response = await createFollowUp({
      title: `งานที่เลยกำหนด ${stamp}`,
      dueDate: shiftDays(-5),
    }).expect(201);

    const followUp = (response.body as ApiResponse<FollowUpPayload>).data;

    expect(followUp.status).toBe('PLANNED');
    expect(followUp.isOverdue).toBe(true);
    expect(followUp.daysUntilDue).toBe(-5);
  });

  it('งานที่ครบกำหนดวันนี้ยังไม่นับว่าเลยกำหนด', async () => {
    const response = await createFollowUp({
      title: `งานครบกำหนดวันนี้ ${stamp}`,
      dueDate: shiftDays(0),
    }).expect(201);

    const followUp = (response.body as ApiResponse<FollowUpPayload>).data;

    expect(followUp.isOverdue).toBe(false);
    expect(followUp.daysUntilDue).toBe(0);
  });

  it('ตั้งสถานะ OVERDUE เองไม่ได้', async () => {
    const created = await createFollowUp({}).expect(201);
    const id = (created.body as ApiResponse<FollowUpPayload>).data.id;

    const response = await authed('patch', `/api/follow-ups/${id}`)
      .send({ status: 'OVERDUE' })
      .expect(400);

    expect((response.body as ApiResponse<null>).message).toContain('ตั้งเองไม่ได้');
  });

  it('?overdue=true คืนเฉพาะงานที่เลยกำหนด และทุกแถวต้องมีธงตรงกัน', async () => {
    const overdue = await createFollowUp({
      title: `ค้างมานาน ${stamp}`,
      dueDate: shiftDays(-30),
    }).expect(201);
    const future = await createFollowUp({
      title: `ยังไม่ถึงกำหนด ${stamp}`,
      dueDate: shiftDays(30),
    }).expect(201);

    const overdueId = (overdue.body as ApiResponse<FollowUpPayload>).data.id;
    const futureId = (future.body as ApiResponse<FollowUpPayload>).data.id;

    const response = await authed(
      'get',
      `/api/follow-ups?overdue=true&customerId=${customerId}&limit=100`,
    ).expect(200);
    const items = (response.body as ApiResponse<ListPayload<FollowUpPayload>>).data.items;

    expect(items.map((item) => item.id)).toContain(overdueId);
    expect(items.map((item) => item.id)).not.toContain(futureId);

    // ผลของ query กับธงที่แสดงต้องไม่ขัดกันเอง
    for (const item of items) {
      expect(item.isOverdue).toBe(true);
      expect(['PLANNED', 'OVERDUE']).toContain(item.status);
    }
  });

  it('ปิดงานแล้วหลุดออกจากรายการเลยกำหนดทันที', async () => {
    const created = await createFollowUp({
      title: `ปิดแล้วต้องหาย ${stamp}`,
      dueDate: shiftDays(-10),
    }).expect(201);
    const id = (created.body as ApiResponse<FollowUpPayload>).data.id;

    await authed('patch', `/api/follow-ups/${id}/complete`)
      .send({ resultNote: 'โทรแล้ว ลูกค้ารับทราบ' })
      .expect(200);

    const response = await authed(
      'get',
      `/api/follow-ups?overdue=true&customerId=${customerId}&limit=100`,
    ).expect(200);
    const ids = (response.body as ApiResponse<ListPayload<FollowUpPayload>>).data.items.map(
      (item) => item.id,
    );

    expect(ids).not.toContain(id);
  });

  // -------------------------------------------------------------------------
  // ปิดงาน
  // -------------------------------------------------------------------------
  it('ปิดงานแล้วระบบใส่ completedAt ให้เอง และเก็บผลการติดตาม', async () => {
    const created = await createFollowUp({}).expect(201);
    const id = (created.body as ApiResponse<FollowUpPayload>).data.id;

    const response = await authed('patch', `/api/follow-ups/${id}/complete`)
      .send({ resultNote: 'โทรแล้ว ลูกค้ายืนยันต่อสัญญา' })
      .expect(200);

    const followUp = (response.body as ApiResponse<FollowUpPayload>).data;

    expect(followUp.status).toBe('DONE');
    expect(followUp.completedAt).not.toBeNull();
    expect(followUp.resultNote).toBe('โทรแล้ว ลูกค้ายืนยันต่อสัญญา');
  });

  it('ถอยออกจาก DONE แล้ว completedAt ถูกล้าง', async () => {
    const created = await createFollowUp({}).expect(201);
    const id = (created.body as ApiResponse<FollowUpPayload>).data.id;

    await authed('patch', `/api/follow-ups/${id}/complete`).send({}).expect(200);

    const response = await authed('patch', `/api/follow-ups/${id}`)
      .send({ status: 'PLANNED' })
      .expect(200);

    expect((response.body as ApiResponse<FollowUpPayload>).data.completedAt).toBeNull();
  });

  it('ปิดงานติดตามไม่ไปขยับ customers.lastContactedAt', async () => {
    // ค่านั้นมีเจ้าของคือการบันทึกการติดต่อ ซึ่งมีหลักฐานครบ (ช่องทาง เนื้อหา)
    // ถ้าที่นี่เขียนด้วย หน้าจอ "ลูกค้าที่ถูกลืม" จะเงียบทั้งที่ยังไม่มีใครคุยกับลูกค้าจริง
    const before = await authed('get', `/api/customers/${customerId}`).expect(200);
    const lastContactedBefore = (
      before.body as ApiResponse<{ lastContactedAt: string | null }>
    ).data.lastContactedAt;

    const created = await createFollowUp({}).expect(201);
    const id = (created.body as ApiResponse<FollowUpPayload>).data.id;
    await authed('patch', `/api/follow-ups/${id}/complete`)
      .send({ resultNote: 'ติดตามแล้ว' })
      .expect(200);

    const after = await authed('get', `/api/customers/${customerId}`).expect(200);
    const lastContactedAfter = (
      after.body as ApiResponse<{ lastContactedAt: string | null }>
    ).data.lastContactedAt;

    expect(lastContactedAfter).toBe(lastContactedBefore);
  });

  // -------------------------------------------------------------------------
  // ผูกกับโปรเจค (ประชุม 11 ก.ย. — "ติดตามโปรเจค ไม่ใช่ตามลูกค้า")
  // -------------------------------------------------------------------------
  it('ส่งแค่ projectId → ได้ลูกค้าของโปรเจคมาเอง พร้อมข้อมูลโปรเจคในผลลัพธ์', async () => {
    const response = await authed('post', '/api/follow-ups')
      .send({ projectId, title: `ตามเรื่องโปรเจค ${stamp}`, dueDate: shiftDays(3) })
      .expect(201);

    const followUp = (response.body as ApiResponse<FollowUpPayload>).data;

    expect(followUp.customerId).toBe(customerId);
    expect(followUp.projectId).toBe(projectId);
    expect(followUp.project?.id).toBe(projectId);
  });

  it('ส่ง customerId ที่ไม่ใช่เจ้าของโปรเจค → 400', async () => {
    await createFollowUp({ projectId: otherCustomerProjectId }).expect(400);
  });

  it('ไม่ส่งทั้งโปรเจคและลูกค้า → 400', async () => {
    await authed('post', '/api/follow-ups')
      .send({ title: `ไม่มีเจ้าของ ${stamp}`, dueDate: shiftDays(3) })
      .expect(400);
  });

  it('?projectId= กรองเฉพาะงานของโปรเจคนั้น', async () => {
    const withProject = await createFollowUp({ projectId }).expect(201);
    const withoutProject = await createFollowUp({}).expect(201);

    const response = await authed('get', `/api/follow-ups?projectId=${projectId}&limit=100`).expect(
      200,
    );
    const ids = (response.body as ApiResponse<ListPayload<FollowUpPayload>>).data.items.map(
      (item) => item.id,
    );

    expect(ids).toContain((withProject.body as ApiResponse<FollowUpPayload>).data.id);
    expect(ids).not.toContain((withoutProject.body as ApiResponse<FollowUpPayload>).data.id);
  });

  it('เปลี่ยนไปโปรเจคของลูกค้ารายอื่นไม่ได้ แต่ถอดโปรเจคออกได้', async () => {
    const created = await createFollowUp({ projectId }).expect(201);
    const id = (created.body as ApiResponse<FollowUpPayload>).data.id;

    await authed('patch', `/api/follow-ups/${id}`)
      .send({ projectId: otherCustomerProjectId })
      .expect(400);

    const cleared = await authed('patch', `/api/follow-ups/${id}`)
      .send({ projectId: null })
      .expect(200);

    expect((cleared.body as ApiResponse<FollowUpPayload>).data.projectId).toBeNull();
    expect((cleared.body as ApiResponse<FollowUpPayload>).data.customerId).toBe(customerId);
  });

  // -------------------------------------------------------------------------
  // ข้อจำกัดอื่น
  // -------------------------------------------------------------------------
  it('ไม่มีฟิลด์ channel — ส่งมาถูกปฏิเสธด้วยข้อความภาษาไทย', async () => {
    const response = await createFollowUp({ channel: 'LINE' }).expect(400);

    expect((response.body as ApiResponse<null>).message).toContain('ไม่รู้จักฟิลด์');
  });

  it('ย้ายลูกค้าไม่ได้ — ส่ง customerId มาตอนแก้ถูกปฏิเสธ', async () => {
    const created = await createFollowUp({}).expect(201);
    const id = (created.body as ApiResponse<FollowUpPayload>).data.id;

    await authed('patch', `/api/follow-ups/${id}`).send({ customerId: 1 }).expect(400);
  });

  it('มอบหมายให้พนักงานที่ไม่มีอยู่จริงไม่ได้', async () => {
    await createFollowUp({ assignedUserId: 999999 }).expect(400);
  });

  it('ต้องล็อกอินก่อนถึงจะเรียกได้', async () => {
    await api().get('/api/follow-ups').expect(401);
  });
});
