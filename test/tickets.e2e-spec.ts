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
 * e2e ของ Phase 7 — ยิงผ่าน HTTP จริงลงฐานข้อมูลจริง (ฐานทดสอบแยกต่างหาก)
 *
 * ต่างจาก unit test ตรงที่ตัวนี้พิสูจน์ของที่ mock พิสูจน์แทนไม่ได้:
 *   - SQL ที่ Sequelize สร้างออกมาทำงานได้จริงกับ MySQL
 *   - unique index (ticket_id, round) ไม่ถูกละเมิดเมื่อแก้หลายรอบ
 *   - guard, validation pipe, interceptor และ exception filter ทำงานครบสาย
 *   - transaction commit จริงและอ่านกลับมาได้
 *
 * ไม่รวมอยู่ใน `npm test` โดยเจตนา เพราะต้องมี MySQL — รันด้วย `npm run test:e2e`
 */

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message: string | null;
}

interface TicketPayload {
  id: number;
  status: string;
  closedAt: string | null;
  isPending: boolean;
  resolutionCount: number;
  billingType: string;
  claimedByAdminUserId: number | null;
  claimedByAdminUser: { id: number; fullName: string } | null;
  assignedUserId: number | null;
  receivedByUserId: number | null;
  resolutions: { id: number; round: number; detail: string }[];
}

interface ListPayload<T> {
  items: T[];
  total: number;
}

describe('Tickets (e2e)', () => {
  let app: INestApplication;
  let token: string;
  /** id ของบัญชีที่ล็อกอิน — ใช้เป็นผู้รับผิดชอบตอนทดสอบการมอบหมาย */
  let actorId: number;
  let customerId: number;
  let customerCode: string;
  let projectId: number;

  /** ทำให้ข้อมูลของแต่ละรอบการรันไม่ชนกัน ฐานทดสอบไม่ได้ถูกล้างทุกครั้ง */
  const stamp = Date.now();

  function api() {
    return request(app.getHttpServer() as Parameters<typeof request>[0]);
  }

  function authed(method: 'get' | 'post' | 'patch', url: string) {
    return api()[method](url).set('Authorization', `Bearer ${token}`);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();

    // ประกอบสายเดียวกับ main.ts — ถ้าประกอบไม่เหมือน เทสต์จะผ่านบนแอปที่ไม่มีอยู่จริง
    app.use(requestContextMiddleware);
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createValidationPipe());
    app.useGlobalInterceptors(new RequestContextInterceptor(), new TransformInterceptor());
    app.useGlobalFilters(new HttpExceptionFilter());

    await app.init();

    // ---- ล็อกอินด้วยบัญชี SUPER_ADMIN ที่ seeder สร้างไว้ ----------------------
    const login = await api()
      .post('/api/auth/login')
      .send({
        username: process.env.SUPER_ADMIN_USERNAME ?? 'superadmin',
        password: process.env.SUPER_ADMIN_PASSWORD,
      })
      .expect(200);

    const loginBody = login.body as ApiResponse<{ accessToken: string; user: { id: number } }>;
    token = loginBody.data.accessToken;
    actorId = loginBody.data.user.id;
    expect(token).toBeTruthy();

    // ---- เตรียมลูกค้าและโครงการของรอบนี้ ------------------------------------
    const customer = await authed('post', '/api/customers')
      .send({ name: `ลูกค้าทดสอบ e2e ${stamp}`, status: 'ACTIVE' })
      .expect(201);
    const customerData = (customer.body as ApiResponse<{ id: number; code: string }>).data;
    customerId = customerData.id;
    customerCode = customerData.code;

    const project = await authed('post', '/api/projects')
      .send({
        customerId,
        name: `โครงการทดสอบ e2e ${stamp}`,
        status: 'IN_PROGRESS',
        priority: 'NORMAL',
      })
      .expect(201);
    projectId = (project.body as ApiResponse<{ id: number }>).data.id;
  });

  afterAll(async () => {
    await app.close();
  });

  /** เปิดใบใหม่หนึ่งใบ คืน id */
  async function openTicket(title: string): Promise<number> {
    const response = await authed('post', '/api/tickets')
      .send({
        customerId,
        projectId,
        title,
        reportedChannel: 'LINE',
        reportedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        billingType: 'ONE_TIME',
      })
      .expect(201);

    return (response.body as ApiResponse<{ id: number }>).data.id;
  }

  /** ห้ามประกาศเป็น async — ต้องคืน object ของ supertest ตรง ๆ เพื่อให้ต่อ .expect() ได้ */
  function addResolution(ticketId: number, detail: string) {
    return authed('post', `/api/tickets/${ticketId}/resolutions`).send({
      result: 'SUCCESS',
      detail,
      resolvedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    });
  }

  // -------------------------------------------------------------------------
  // 1. เปิด ticket -> เพิ่ม resolution 3 รอบ -> round ต้องเป็น 1, 2, 3 ในใบเดียวกัน
  // -------------------------------------------------------------------------
  it('แก้ปัญหาเดิม 3 รอบแล้วได้ round 1, 2, 3 ในใบเดียวกัน (BR-03, BR-04)', async () => {
    const ticketId = await openTicket(`ปัญหาที่ต้องแก้หลายรอบ ${stamp}`);

    const rounds: number[] = [];

    for (const detail of ['แก้รอบแรก', 'อาการกลับมา แก้รอบสอง', 'แก้รอบสามจนจบ']) {
      const response = await addResolution(ticketId, detail).expect(201);
      const body = response.body as ApiResponse<{
        resolution: { round: number; ticketId: number };
        ticket: TicketPayload;
      }>;

      expect(body.data.resolution.ticketId).toBe(ticketId);
      rounds.push(body.data.resolution.round);
    }

    expect(rounds).toEqual([1, 2, 3]);

    // ทุกรอบต้องอยู่ในใบเดียวกัน ไม่ใช่กระจายไปหลายใบ — นี่คือหัวใจของ BR-04
    const detail = await authed('get', `/api/tickets/${ticketId}`).expect(200);
    const ticket = (detail.body as ApiResponse<TicketPayload>).data;

    expect(ticket.resolutions).toHaveLength(3);
    expect(ticket.resolutions.map((item) => item.round)).toEqual([1, 2, 3]);
    expect(ticket.resolutionCount).toBe(3);
    expect(ticket.status).toBe('RESOLVED');
  });

  // -------------------------------------------------------------------------
  // 2. ticket ที่ CLOSED แล้วเพิ่ม resolution ไม่ได้
  // -------------------------------------------------------------------------
  it('ใบที่ปิดงานแล้วเพิ่มการแก้ไขตรง ๆ ไม่ได้ ต้องเปิดใบเดิมกลับมาก่อน', async () => {
    const ticketId = await openTicket(`ปัญหาที่จะปิดงาน ${stamp}`);

    await addResolution(ticketId, 'แก้เสร็จแล้ว').expect(201);
    await authed('patch', `/api/tickets/${ticketId}/close`)
      .send({ note: 'ลูกค้ายืนยันว่าใช้งานได้' })
      .expect(200);

    const rejected = await addResolution(ticketId, 'พยายามเพิ่มหลังปิดงาน').expect(400);
    const body = rejected.body as ApiResponse<null>;

    expect(body.success).toBe(false);
    // ชี้ให้เปิดใบเดิมกลับมา ห้ามบอกให้เปิดใบใหม่ (BR-04, Q9)
    expect(body.message).toContain('ปัญหาเดิมกลับมา');
    expect(body.message).not.toContain('เปิดใบใหม่');

    // ต้องไม่มีรอบที่ 2 หลุดเข้าไป
    const detail = await authed('get', `/api/tickets/${ticketId}`).expect(200);
    expect((detail.body as ApiResponse<TicketPayload>).data.resolutions).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // 3. GET /pending ต้องไม่แสดง ticket ที่ CLOSED
  // -------------------------------------------------------------------------
  it('หน้าจอรอรับการแก้ไขไม่แสดงใบที่ปิดงานแล้ว', async () => {
    const openId = await openTicket(`ปัญหาที่ยังค้าง ${stamp}`);
    const closedId = await openTicket(`ปัญหาที่ปิดไปแล้ว ${stamp}`);

    await authed('patch', `/api/tickets/${closedId}/close`).send({}).expect(200);

    // กรองด้วย stamp ของรอบนี้ ไม่ใช่ดึงร้อยแถวแรกมาหา — ฐานทดสอบไม่ถูกล้างระหว่างรอบ
    // ใบที่ค้างจึงสะสมขึ้นเรื่อย ๆ จนใบใหม่หลุดออกนอกหน้าแรกแล้วเทสต์แดงโดยที่โค้ดไม่ได้พัง
    const pending = await authed('get', `/api/tickets/pending?limit=100&search=${stamp}`).expect(
      200,
    );
    const items = (pending.body as ApiResponse<ListPayload<TicketPayload>>).data.items;
    const ids = items.map((item) => item.id);

    expect(ids).toContain(openId);
    expect(ids).not.toContain(closedId);

    // ทุกแถวที่คืนมาต้องอยู่ในสถานะที่ยังไม่จบเท่านั้น
    for (const item of items) {
      expect([
        'RECEIVED',
        'WAITING_ADMIN',
        'ASSIGNED',
        'REOPENED',
        'IN_PROGRESS',
      ]).toContain(item.status);
      expect(item.isPending).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // เพิ่มเติม — พิสูจน์ของที่ mock พิสูจน์แทนไม่ได้
  // -------------------------------------------------------------------------
  it('ปัญหาเดิมกลับมาแล้ว reopen กลับเข้าหน้าจอรอรับการแก้ไข แล้วแก้ต่อได้ในใบเดิม (BR-04)', async () => {
    const ticketId = await openTicket(`ปัญหาที่จะกลับมา ${stamp}`);

    await addResolution(ticketId, 'แก้รอบแรก').expect(201);

    const reopened = await authed('patch', `/api/tickets/${ticketId}/reopen`)
      .send({ reason: 'อาการเดิมกลับมาหลังใช้งาน 3 วัน' })
      .expect(200);
    expect((reopened.body as ApiResponse<TicketPayload>).data.status).toBe('REOPENED');

    const pending = await authed('get', `/api/tickets/pending?limit=100&search=${stamp}`).expect(
      200,
    );
    const ids = (pending.body as ApiResponse<ListPayload<TicketPayload>>).data.items.map(
      (item) => item.id,
    );
    expect(ids).toContain(ticketId);

    // รอบถัดไปต่อจากเดิม ไม่ได้เริ่มนับหนึ่งใหม่
    const second = await addResolution(ticketId, 'แก้รอบสองหลังกลับมา').expect(201);
    expect(
      (second.body as ApiResponse<{ resolution: { round: number } }>).data.resolution.round,
    ).toBe(2);
  });

  it('ใบที่กลับมาเป็นซ้ำ มอบหมายแล้วให้ผู้รับผิดชอบกดเริ่มงาน ครบวงจร BR-04', async () => {
    // RECEIVED → send/claim → ASSIGNED → IN_PROGRESS → RESOLVED → REOPENED → ASSIGNED → …
    const ticketId = await openTicket(`ปัญหาที่กลับมาแล้วต้องมีคนหยิบ ${stamp}`);

    await authed('patch', `/api/tickets/${ticketId}/send-to-admin`).send({}).expect(200);
    await authed('patch', `/api/tickets/${ticketId}/claim`).send({}).expect(200);

    const assignTo = () =>
      authed('patch', `/api/tickets/${ticketId}/assign`).send({ assignedUserId: actorId });

    const assigned = await assignTo().expect(200);
    expect((assigned.body as ApiResponse<TicketPayload>).data.status).toBe('ASSIGNED');
    const started = await authed('patch', `/api/tickets/${ticketId}/start`).send({}).expect(200);
    expect((started.body as ApiResponse<TicketPayload>).data.status).toBe('IN_PROGRESS');

    await addResolution(ticketId, 'แก้รอบแรก').expect(201);
    await authed('patch', `/api/tickets/${ticketId}/reopen`)
      .send({ reason: 'อาการเดิมกลับมา' })
      .expect(200);

    // ส่งงานรอบใหม่ แล้วผู้รับผิดชอบกดเริ่มเอง (จาก REOPENED ไม่ต้อง claim ซ้ำ)
    const restarted = await assignTo().expect(200);
    const ticket = (restarted.body as ApiResponse<TicketPayload>).data;
    expect(ticket.status).toBe('ASSIGNED');
    expect(ticket.isPending).toBe(true);
    await authed('patch', `/api/tickets/${ticketId}/start`).send({}).expect(200);

    const second = await addResolution(ticketId, 'แก้รอบสองด้วยวิธีใหม่').expect(201);
    const body = second.body as ApiResponse<{
      resolution: { round: number };
      ticket: TicketPayload;
    }>;
    expect(body.data.resolution.round).toBe(2);
    expect(body.data.ticket.status).toBe('RESOLVED');
  });

  it('ปัญหาเดิมกลับมาหลังปิดงานแล้ว เปิดใบเดิมกลับมาแก้รอบถัดไปได้ (BR-04, Q9)', async () => {
    // CLOSED → REOPENED → ASSIGNED → IN_PROGRESS → RESOLVED → CLOSED อีกครั้ง
    const ticketId = await openTicket(`ปัญหาที่กลับมาหลังปิดงาน ${stamp}`);

    await addResolution(ticketId, 'แก้รอบแรก').expect(201);
    const closed = await authed('patch', `/api/tickets/${ticketId}/close`).send({}).expect(200);
    const firstClosedAt = (closed.body as ApiResponse<TicketPayload>).data.closedAt;
    expect(firstClosedAt).not.toBeNull();

    // หน้าจอ reopen แล้ว assign ต่อ จากนั้นผู้รับผิดชอบกดเริ่มงาน
    const reopened = await authed('patch', `/api/tickets/${ticketId}/reopen`)
      .send({ reason: 'อาการเดิมกลับมาหลังปิดงาน' })
      .expect(200);
    const afterReopen = (reopened.body as ApiResponse<TicketPayload>).data;
    expect(afterReopen.status).toBe('REOPENED');
    expect(afterReopen.closedAt).toBeNull();

    const assigned = await authed('patch', `/api/tickets/${ticketId}/assign`)
      .send({ assignedUserId: actorId })
      .expect(200);
    expect((assigned.body as ApiResponse<TicketPayload>).data.status).toBe('ASSIGNED');
    const started = await authed('patch', `/api/tickets/${ticketId}/start`).send({}).expect(200);
    expect((started.body as ApiResponse<TicketPayload>).data.status).toBe('IN_PROGRESS');

    const second = await addResolution(ticketId, 'แก้รอบสองหลังเปิดใบเดิมกลับมา').expect(201);
    expect(
      (second.body as ApiResponse<{ resolution: { round: number } }>).data.resolution.round,
    ).toBe(2);

    // ปิดใหม่ได้ และทุกรอบยังอยู่ในใบเดิม
    const reclosed = await authed('patch', `/api/tickets/${ticketId}/close`).send({}).expect(200);
    const ticket = (reclosed.body as ApiResponse<TicketPayload>).data;
    expect(ticket.status).toBe('CLOSED');
    expect(ticket.closedAt).not.toBeNull();
    expect(ticket.resolutions.map((item) => item.round)).toEqual([1, 2]);
  });

  // -------------------------------------------------------------------------
  // แก้ไขใบ — ต้องแก้ข้อมูลที่คีย์ผิดได้ แต่ห้ามข้ามกฎสถานะ
  // -------------------------------------------------------------------------
  it('แก้หัวข้อและประเภทการคิดเงินที่คีย์ผิดตอนเปิดใบได้', async () => {
    const ticketId = await openTicket(`ปัญหาที่พิมพ์หัวข้อผิด ${stamp}`);

    const response = await authed('patch', `/api/tickets/${ticketId}`)
      .send({ title: 'หัวข้อที่แก้ให้ถูกแล้ว', billingType: 'FREE', priority: 'HIGH' })
      .expect(200);

    const ticket = (response.body as ApiResponse<TicketPayload & { title: string }>).data;

    expect(ticket.title).toBe('หัวข้อที่แก้ให้ถูกแล้ว');
    expect(ticket.billingType).toBe('FREE');
    // สถานะต้องไม่ขยับจากการแก้ข้อมูล
    expect(ticket.status).toBe('RECEIVED');
  });

  it('แก้สถานะผ่านเส้นแก้ไขไม่ได้ — ต้องใช้ assign / resolutions / reopen / close เท่านั้น', async () => {
    // ถ้าเส้นนี้แก้สถานะได้ จะตั้งเป็น CLOSED โดยไม่เคยมีรอบการแก้ไขเลยก็ได้ ซึ่งขัด BR-04
    const ticketId = await openTicket(`ปัญหาที่จะลองข้ามกฎ ${stamp}`);

    const response = await authed('patch', `/api/tickets/${ticketId}`)
      .send({ status: 'CLOSED' })
      .expect(400);

    expect((response.body as ApiResponse<null>).message).toContain('ไม่รู้จักฟิลด์');

    const detail = await authed('get', `/api/tickets/${ticketId}`).expect(200);
    expect((detail.body as ApiResponse<TicketPayload>).data.status).toBe('RECEIVED');
  });

  it('แก้จำนวนรอบการแก้ไขเองไม่ได้', async () => {
    const ticketId = await openTicket(`ปัญหาที่จะลองแก้จำนวนรอบ ${stamp}`);

    await authed('patch', `/api/tickets/${ticketId}`).send({ resolutionCount: 99 }).expect(400);
  });

  it('ย้ายลูกค้าไม่ได้', async () => {
    const ticketId = await openTicket(`ปัญหาที่จะลองย้ายลูกค้า ${stamp}`);

    await authed('patch', `/api/tickets/${ticketId}`).send({ customerId: 1 }).expect(400);
  });

  it('ใบที่ปิดงานแล้วยังแก้ข้อมูลได้ แม้เพิ่มรอบการแก้ไขไม่ได้แล้ว', async () => {
    // การพิมพ์ผิดต้องแก้ได้เสมอ ต่างจากการเพิ่มรอบ ซึ่งใบที่ปิดแล้วต้อง reopen ก่อน
    const ticketId = await openTicket(`ปัญหาที่ปิดแล้วแต่ต้องแก้คำผิด ${stamp}`);

    await addResolution(ticketId, 'แก้เสร็จแล้ว').expect(201);
    await authed('patch', `/api/tickets/${ticketId}/close`).send({}).expect(200);

    const response = await authed('patch', `/api/tickets/${ticketId}`)
      .send({ title: 'แก้คำผิดหลังปิดงาน' })
      .expect(200);

    expect((response.body as ApiResponse<TicketPayload & { title: string }>).data.title).toBe(
      'แก้คำผิดหลังปิดงาน',
    );

    // แต่เพิ่มรอบยังไม่ได้เหมือนเดิม
    await addResolution(ticketId, 'พยายามเพิ่มหลังปิดงาน').expect(400);
  });

  it('ต้องล็อกอินก่อนถึงจะเรียกได้', async () => {
    await api().get('/api/tickets').expect(401);
  });

  it('ปฏิเสธ field แปลกปลอมด้วยข้อความภาษาไทย', async () => {
    const response = await authed('post', '/api/tickets')
      .send({
        customerId,
        title: 'ทดสอบ field แปลกปลอม',
        reportedChannel: 'LINE',
        reportedAt: new Date().toISOString(),
        round: 5,
      })
      .expect(400);

    expect((response.body as ApiResponse<null>).message).toContain('ไม่รู้จักฟิลด์');
  });

  // -------------------------------------------------------------------------
  // ค้นปัญหาเก่าด้วยชื่อลูกค้า/โครงการ (ประชุม 11 ก.ย. — B-10)
  // ลูกค้าจำได้แค่บริษัท/โครงการ ถ้าค้นไม่เจอพนักงานจะเปิดใบใหม่แทน ซึ่งขัด BR-04
  // -------------------------------------------------------------------------
  it('ค้นด้วยชื่อลูกค้าหรือชื่อโครงการเจอใบที่หัวข้อไม่มีคำนั้นเลย ทั้งรายการทั้งหมดและหน้ารอรับการแก้ไข', async () => {
    const ticketId = await openTicket(`ระบบล็อกอินไม่ได้ ${stamp}`);

    for (const search of [`ลูกค้าทดสอบ e2e ${stamp}`, `โครงการทดสอบ e2e ${stamp}`]) {
      const all = await authed('get', `/api/tickets?search=${encodeURIComponent(search)}&limit=100`)
        .expect(200);
      const pending = await authed(
        'get',
        `/api/tickets/pending?search=${encodeURIComponent(search)}&limit=100`,
      ).expect(200);

      const ids = (body: unknown) =>
        (body as ApiResponse<ListPayload<TicketPayload>>).data.items.map((item) => item.id);

      expect(ids(all.body)).toContain(ticketId);
      expect(ids(pending.body)).toContain(ticketId);
    }
  });

  it('ค้นด้วยรหัสลูกค้าได้ และคำที่ไม่ตรงอะไรเลยไม่ทำให้ SQL พัง', async () => {
    const ticketId = await openTicket(`ค้นด้วยรหัส ${stamp}`);

    const byCode = await authed('get', `/api/tickets?search=${customerCode}&limit=100`).expect(200);
    expect(
      (byCode.body as ApiResponse<ListPayload<TicketPayload>>).data.items.map((item) => item.id),
    ).toContain(ticketId);

    const none = await authed('get', `/api/tickets?search=ไม่มีทางตรงแน่นอน-${stamp}`).expect(200);
    expect((none.body as ApiResponse<ListPayload<TicketPayload>>).data.total).toBe(0);
  });

  // -------------------------------------------------------------------------
  // C-1 คิวดึง: ซัพพอร์ตส่ง → แอดมินรับ → มอบหมาย → แก้ → ส่งกลับ → บอกลูกค้า
  // -------------------------------------------------------------------------
  it('คิวดึงซัพพอร์ต–แอดมินครบวงจร และแยกผู้รับเรื่อง / ผู้รับคิว / ผู้แก้', async () => {
    const ticketId = await openTicket(`คิวดึง C-1 ${stamp}`);

    const supportQueue = await authed(
      'get',
      `/api/tickets/support-queue?tab=AWAITING_SEND&search=${stamp}`,
    ).expect(200);
    expect(
      (supportQueue.body as ApiResponse<ListPayload<TicketPayload>>).data.items.map((i) => i.id),
    ).toContain(ticketId);

    const sent = await authed('patch', `/api/tickets/${ticketId}/send-to-admin`).send({}).expect(200);
    expect((sent.body as ApiResponse<TicketPayload>).data.status).toBe('WAITING_ADMIN');
    expect((sent.body as ApiResponse<TicketPayload>).data.claimedByAdminUserId).toBeNull();

    const adminWaiting = await authed(
      'get',
      `/api/tickets/admin-queue?tab=AWAITING_CLAIM&search=${stamp}`,
    ).expect(200);
    expect(
      (adminWaiting.body as ApiResponse<ListPayload<TicketPayload>>).data.items.map((i) => i.id),
    ).toContain(ticketId);

    // มอบหมายก่อนรับคิวไม่ได้
    await authed('patch', `/api/tickets/${ticketId}/assign`)
      .send({ assignedUserId: actorId })
      .expect(400);

    const claimed = await authed('patch', `/api/tickets/${ticketId}/claim`).send({}).expect(200);
    const afterClaim = (claimed.body as ApiResponse<TicketPayload>).data;
    expect(afterClaim.claimedByAdminUserId).toBe(actorId);
    expect(afterClaim.claimedByAdminUser?.id).toBe(actorId);

    // รับซ้ำไม่ได้
    await authed('patch', `/api/tickets/${ticketId}/claim`).send({}).expect(409);

    await authed('patch', `/api/tickets/${ticketId}/assign`)
      .send({ assignedUserId: actorId })
      .expect(200);
    await authed('patch', `/api/tickets/${ticketId}/start`).send({}).expect(200);
    await addResolution(ticketId, 'แก้จากคิวดึง').expect(201);

    const returned = await authed('patch', `/api/tickets/${ticketId}/return-to-support`)
      .send({})
      .expect(200);
    expect((returned.body as ApiResponse<TicketPayload>).data.status).toBe('WAITING_SUPPORT');

    const supportReturned = await authed(
      'get',
      `/api/tickets/support-queue?tab=RETURNED&search=${stamp}`,
    ).expect(200);
    expect(
      (supportReturned.body as ApiResponse<ListPayload<TicketPayload>>).data.items.map((i) => i.id),
    ).toContain(ticketId);

    const notified = await authed('patch', `/api/tickets/${ticketId}/customer-notified`)
      .send({ note: 'แจ้งลูกค้าทาง LINE แล้ว' })
      .expect(200);
    const closed = (notified.body as ApiResponse<TicketPayload>).data;
    expect(closed.status).toBe('CLOSED');
    expect(closed.claimedByAdminUserId).toBe(actorId);
    expect(closed.assignedUserId).toBe(actorId);
    expect(closed.receivedByUserId).toBe(actorId);
  });
});
