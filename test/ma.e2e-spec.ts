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
 * e2e ของ Phase 8 — MA
 *
 * พิสูจน์สิ่งที่ mock พิสูจน์แทนไม่ได้:
 *   - รอบโควตาที่นับจากวันเริ่มสัญญา (Q2) เดินถูกจริงเมื่อผ่าน SQL และ DATEONLY จริง
 *   - โควตาจาก addon ถูกบวกเข้ากับโควตาของแผนจริงตอน query
 *   - สายการต่อสัญญา (previous_contract_id + RENEWED) commit ครบทั้งสองแถว
 *   - GET /api/users/assignable เรียกได้โดยไม่ต้องมีสิทธิ์ user.view
 *   - GET /:id/print (M6-08) join ซ้อนสองชั้นและ self-join ของฉบับก่อนหน้ารันได้จริง
 */

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message: string | null;
}

interface QuotaPayload {
  periodYear: number;
  periodMonth: number;
  periodStart: string;
  periodEnd: string;
  quota: number;
  used: number;
  remaining: number;
  isExhausted: boolean;
}

interface ContractPayload {
  id: number;
  customerId: number;
  projectId: number;
  planId: number;
  price: string;
  status: string;
  previousContractId: number | null;
  isCurrentlyActive: boolean;
  quota?: QuotaPayload;
}

interface PlanPayload {
  id: number;
  code: string;
  items: { id: number; title: string; sortOrder: number }[];
}

describe('MA (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let customerId: number;
  let projectId: number;
  let planId: number;

  /** ทำให้ข้อมูลของแต่ละรอบการรันไม่ชนกัน ฐานทดสอบไม่ได้ถูกล้างทุกครั้ง */
  const stamp = Date.now();

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
      .send({ name: `ลูกค้าทดสอบ MA ${stamp}`, code: `E2E-MC-${stamp}`, status: 'ACTIVE' })
      .expect(201);
    customerId = (customer.body as ApiResponse<{ id: number }>).data.id;

    const project = await authed('post', '/api/projects')
      .send({
        customerId,
        name: `โครงการทดสอบ MA ${stamp}`,
        code: `E2E-MP-${stamp}`,
        status: 'IN_PROGRESS',
        priority: 'NORMAL',
      })
      .expect(201);
    projectId = (project.body as ApiResponse<{ id: number }>).data.id;

    const plan = await authed('post', '/api/ma-plans')
      .send({
        code: `E2E_PLAN_${stamp}`,
        name: `แผนทดสอบ ${stamp}`,
        bugQuotaPerMonth: 5,
        responseTimeHour: 24,
        items: [{ title: 'ตรวจสุขภาพระบบรายเดือน' }, { title: 'สำรองข้อมูลรายสัปดาห์' }],
      })
      .expect(201);
    planId = (plan.body as ApiResponse<PlanPayload>).data.id;
  });

  afterAll(async () => {
    await app.close();
  });

  function createContract(body: Record<string, unknown>) {
    return authed('post', '/api/ma-contracts').send({
      projectId,
      planId,
      price: '48000.00',
      startDate: '2026-10-15',
      endDate: '2027-10-14',
      ...body,
    });
  }

  // -------------------------------------------------------------------------
  // BR-05 — เนื้อหาอยู่ที่แผน ราคาอยู่ที่สัญญา
  // -------------------------------------------------------------------------
  it('แผน MA ไม่มีฟิลด์ราคาคืนกลับมาเลย (BR-05)', async () => {
    const response = await authed('get', `/api/ma-plans/${planId}`).expect(200);
    const plan = (response.body as ApiResponse<PlanPayload>).data;

    expect(Object.keys(plan)).not.toContain('price');
    expect(plan.items.map((item) => item.sortOrder)).toEqual([0, 1]);
  });

  it('ส่งราคาไปที่แผนถูกปฏิเสธด้วยข้อความภาษาไทย', async () => {
    const response = await authed('post', '/api/ma-plans')
      .send({ code: `E2E_BAD_${stamp}`, name: 'แผนที่มีราคา', price: '1000.00' })
      .expect(400);

    expect((response.body as ApiResponse<null>).message).toContain('ไม่รู้จักฟิลด์');
  });

  it('สัญญาสองฉบับที่ใช้แผนเดียวกันมีราคาต่างกันได้ (BR-05)', async () => {
    const cheap = await createContract({ price: '30000.00' }).expect(201);
    const pricey = await createContract({ price: '90000.00' }).expect(201);

    const a = (cheap.body as ApiResponse<ContractPayload>).data;
    const b = (pricey.body as ApiResponse<ContractPayload>).data;

    expect(a.planId).toBe(b.planId);
    expect(a.price).not.toBe(b.price);
    // ลูกค้าถูกดึงมาจากโครงการให้เอง ไม่ได้ส่งไปใน body
    expect(a.customerId).toBe(customerId);
  });

  // -------------------------------------------------------------------------
  // Q2 — รอบโควตานับจากวันเริ่มสัญญา
  // -------------------------------------------------------------------------
  it('รอบโควตาเริ่มที่วันเดียวกับวันเริ่มสัญญา ไม่ใช่วันที่ 1 ของเดือน (Q2)', async () => {
    const created = await createContract({
      status: 'ACTIVE',
      startDate: '2026-10-15',
      endDate: '2027-10-14',
    }).expect(201);
    const contractId = (created.body as ApiResponse<ContractPayload>).data.id;

    const response = await authed(
      'get',
      `/api/ma-contracts/${contractId}/quota?onDate=2026-11-20T00:00:00.000Z`,
    ).expect(200);
    const quota = (response.body as ApiResponse<QuotaPayload>).data;

    expect(quota.periodStart).toBe('2026-11-15');
    expect(quota.periodEnd).toBe('2026-12-14');
    expect(quota.quota).toBe(5);
    expect(quota.used).toBe(0);
    expect(quota.remaining).toBe(5);
    expect(quota.isExhausted).toBe(false);
  });

  it('วันก่อนวันครบรอบยังอยู่ในรอบก่อนหน้า', async () => {
    const created = await createContract({ status: 'ACTIVE' }).expect(201);
    const contractId = (created.body as ApiResponse<ContractPayload>).data.id;

    const response = await authed(
      'get',
      `/api/ma-contracts/${contractId}/quota?onDate=2026-11-14T00:00:00.000Z`,
    ).expect(200);

    expect((response.body as ApiResponse<QuotaPayload>).data.periodStart).toBe('2026-10-15');
  });

  it('ของเสริมบวกโควตาให้เฉพาะรอบที่ระบุ', async () => {
    const created = await createContract({ status: 'ACTIVE' }).expect(201);
    const contractId = (created.body as ApiResponse<ContractPayload>).data.id;

    await authed('post', `/api/ma-contracts/${contractId}/addons`)
      .send({
        title: 'ซื้อโควตาเพิ่ม 3 ครั้ง',
        extraQuota: 3,
        price: '4500.00',
        effectiveYear: 2026,
        effectiveMonth: 11,
      })
      .expect(201);

    const boosted = await authed(
      'get',
      `/api/ma-contracts/${contractId}/quota?onDate=2026-11-20T00:00:00.000Z`,
    ).expect(200);
    expect((boosted.body as ApiResponse<QuotaPayload>).data.quota).toBe(8);

    // รอบอื่นต้องไม่ได้โควตาก้อนนี้ไปด้วย
    const other = await authed(
      'get',
      `/api/ma-contracts/${contractId}/quota?onDate=2026-12-20T00:00:00.000Z`,
    ).expect(200);
    expect((other.body as ApiResponse<QuotaPayload>).data.quota).toBe(5);
  });

  it('ระบุปีของเสริมมาแต่ไม่ระบุเดือนถูกปฏิเสธ', async () => {
    const created = await createContract({}).expect(201);
    const contractId = (created.body as ApiResponse<ContractPayload>).data.id;

    await authed('post', `/api/ma-contracts/${contractId}/addons`)
      .send({ title: 'ของเสริมที่ระบุมาไม่ครบ', extraQuota: 2, effectiveYear: 2026 })
      .expect(400);
  });

  // -------------------------------------------------------------------------
  // ต่อสัญญา
  // -------------------------------------------------------------------------
  it('ต่อสัญญาแล้วฉบับเดิมกลายเป็น RENEWED และฉบับใหม่ชี้กลับไปหา', async () => {
    const created = await createContract({ status: 'ACTIVE' }).expect(201);
    const previousId = (created.body as ApiResponse<ContractPayload>).data.id;

    const renewed = await authed('post', `/api/ma-contracts/${previousId}/renew`)
      .send({ startDate: '2027-10-15', endDate: '2028-10-14', price: '52000.00' })
      .expect(201);
    const renewal = (renewed.body as ApiResponse<ContractPayload>).data;

    expect(renewal.previousContractId).toBe(previousId);
    expect(renewal.status).toBe('DRAFT');
    expect(renewal.price).toBe('52000.00');

    const previous = await authed('get', `/api/ma-contracts/${previousId}`).expect(200);
    expect((previous.body as ApiResponse<ContractPayload>).data.status).toBe('RENEWED');

    // ต่อซ้ำไม่ได้
    await authed('post', `/api/ma-contracts/${previousId}/renew`)
      .send({ startDate: '2029-01-01', endDate: '2029-12-31', price: '60000.00' })
      .expect(409);
  });

  it('ตั้งสถานะ RENEWED เองผ่าน PATCH ไม่ได้', async () => {
    const created = await createContract({}).expect(201);
    const contractId = (created.body as ApiResponse<ContractPayload>).data.id;

    const response = await authed('patch', `/api/ma-contracts/${contractId}`)
      .send({ status: 'RENEWED' })
      .expect(400);

    expect((response.body as ApiResponse<null>).message).toContain('ตั้งเองไม่ได้');
  });

  // -------------------------------------------------------------------------
  // M6-08 พิมพ์ร่างสัญญา
  // -------------------------------------------------------------------------
  it('GET /:id/print ประกอบข้อมูลครบจาก join จริง รวมผู้ติดต่อหลักและฉบับก่อนหน้า', async () => {
    // include ซ้อนสองชั้น (ลูกค้า→ผู้ติดต่อ, แผน→รายการ) และ self-join ของ previousContract
    // เป็นสิ่งที่ mock พิสูจน์แทนไม่ได้ว่า Sequelize สร้าง SQL ที่รันได้จริง
    await authed('post', '/api/contacts')
      .send({ customerId, name: `ผู้ติดต่อรอง ${stamp}`, isPrimary: false })
      .expect(201);
    await authed('post', '/api/contacts')
      .send({ customerId, name: `ผู้ติดต่อหลัก ${stamp}`, position: 'ผู้จัดการ', isPrimary: true })
      .expect(201);

    const created = await createContract({
      status: 'ACTIVE',
      contractNo: `E2E-PRINT-${stamp}`,
    }).expect(201);
    const previousId = (created.body as ApiResponse<ContractPayload>).data.id;

    const renewed = await authed('post', `/api/ma-contracts/${previousId}/renew`)
      .send({ startDate: '2027-10-15', endDate: '2028-10-14', price: '52000.00' })
      .expect(201);
    const renewalId = (renewed.body as ApiResponse<ContractPayload>).data.id;

    const response = await authed('get', `/api/ma-contracts/${renewalId}/print`).expect(200);
    const print = (
      response.body as ApiResponse<{
        contract: {
          status: string;
          price: string;
          previousContract: { id: number; contractNo: string | null } | null;
        };
        customer: { id: number };
        primaryContact: { name: string; position: string | null } | null;
        project: { id: number };
        plan: Record<string, unknown> & { items: { title: string }[] };
        addons: unknown[];
      }>
    ).data;

    expect(print.contract.status).toBe('DRAFT');
    expect(print.contract.price).toBe('52000.00');
    expect(print.contract.previousContract).toEqual({
      id: previousId,
      contractNo: `E2E-PRINT-${stamp}`,
      startDate: '2026-10-15',
      endDate: '2027-10-14',
    });
    expect(print.customer.id).toBe(customerId);
    expect(print.project.id).toBe(projectId);
    expect(print.primaryContact).toEqual({
      name: `ผู้ติดต่อหลัก ${stamp}`,
      position: 'ผู้จัดการ',
      phone: null,
      email: null,
    });
    expect(print.plan.items.map((item) => item.title)).toEqual([
      'ตรวจสุขภาพระบบรายเดือน',
      'สำรองข้อมูลรายสัปดาห์',
    ]);
    expect(Object.keys(print.plan)).not.toContain('price');
    expect(print.addons).toEqual([]);
  });

  it('GET /:id/print ของสัญญาที่ไม่มีอยู่ได้ 404', async () => {
    await authed('get', '/api/ma-contracts/999999999/print').expect(404);
  });

  it('แผนที่มีสัญญาอ้างอยู่ลบไม่ได้', async () => {
    const response = await authed('delete', `/api/ma-plans/${planId}`).expect(409);

    expect((response.body as ApiResponse<null>).message).toContain('ปิดการใช้งาน');
  });

  // -------------------------------------------------------------------------
  // การหักโควตาจาก ticket — จุดที่ Phase 7 กับ Phase 8 ต่อกัน
  // -------------------------------------------------------------------------
  it('บันทึกผลการแก้ปัญหาแล้วหักโควตา และคืนรูปเดียวกับ /ma-contracts/:id/quota', async () => {
    // สัญญาต้องคุ้มครอง "วันนี้" จริง ๆ ไม่งั้น findActiveContract หาไม่เจอแล้วไม่หักโควตา
    // คำนวณจากวันที่รันเสมอ ไม่ fix ไว้ เทสต์จะได้ไม่เน่าเมื่อเวลาผ่านไป
    const today = new Date();
    const dateOnly = (d: Date) => d.toISOString().slice(0, 10);
    const shiftMonths = (months: number) => {
      const shifted = new Date(today);
      shifted.setUTCMonth(shifted.getUTCMonth() + months);
      return dateOnly(shifted);
    };

    const created = await createContract({
      status: 'ACTIVE',
      startDate: shiftMonths(-2),
      endDate: shiftMonths(10),
    }).expect(201);
    const contractId = (created.body as ApiResponse<ContractPayload>).data.id;

    const ticket = await authed('post', '/api/tickets')
      .send({
        customerId,
        projectId,
        title: `ปัญหาที่หักโควตา MA ${stamp}`,
        reportedChannel: 'LINE',
        reportedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        billingType: 'MA_QUOTA',
      })
      .expect(201);
    const ticketId = (ticket.body as ApiResponse<{ id: number }>).data.id;

    const resolved = await authed('post', `/api/tickets/${ticketId}/resolutions`)
      .send({
        result: 'SUCCESS',
        detail: 'แก้เสร็จแล้ว หักโควตา 1 ครั้ง',
        resolvedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      })
      .expect(201);

    const quota = (resolved.body as ApiResponse<{ quota: QuotaPayload | null }>).data.quota;

    expect(quota).not.toBeNull();
    expect(quota?.used).toBe(1);
    expect(quota?.remaining).toBe(4);

    // เทียบกับ endpoint ของสัญญาโดยตรง — ฟิลด์ที่บอกว่า "รอบไหน" ต้องตรงกันเป๊ะ
    const direct = await authed('get', `/api/ma-contracts/${contractId}/quota`).expect(200);
    const fromContract = (direct.body as ApiResponse<QuotaPayload>).data;

    expect(quota?.periodStart).toBe(fromContract.periodStart);
    expect(quota?.periodEnd).toBe(fromContract.periodEnd);
    expect(quota?.periodYear).toBe(fromContract.periodYear);
    expect(quota?.periodMonth).toBe(fromContract.periodMonth);
    expect(quota?.quota).toBe(fromContract.quota);
    expect(quota?.used).toBe(fromContract.used);
    expect(quota?.remaining).toBe(fromContract.remaining);

    // แก้รอบที่ 2 ของใบเดิมต้องไม่หักซ้ำ (BR-04 + UNIQUE ที่ ma_usages.ticket_id)
    await authed('patch', `/api/tickets/${ticketId}/reopen`)
      .send({ reason: 'อาการเดิมกลับมา' })
      .expect(200);

    const second = await authed('post', `/api/tickets/${ticketId}/resolutions`)
      .send({
        result: 'SUCCESS',
        detail: 'แก้รอบสอง',
        resolvedAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
      })
      .expect(201);

    expect((second.body as ApiResponse<{ quota: QuotaPayload | null }>).data.quota).toBeNull();

    const after = await authed('get', `/api/ma-contracts/${contractId}/quota`).expect(200);
    expect((after.body as ApiResponse<QuotaPayload>).data.used).toBe(1);
  });

  // -------------------------------------------------------------------------
  // endpoint ที่เพิ่มให้ frontend ใช้เติมดรอปดาวน์
  // -------------------------------------------------------------------------
  it('GET /api/users/assignable คืนเฉพาะฟิลด์ที่จำเป็นและไม่มีข้อมูลอ่อนไหว', async () => {
    const response = await authed('get', '/api/users/assignable').expect(200);
    const users = (response.body as ApiResponse<{ id: number; fullName: string }[]>).data;

    expect(users.length).toBeGreaterThan(0);
    expect(Object.keys(users[0]).sort()).toEqual(['fullName', 'id', 'position', 'username']);
  });

  it('GET /api/users/assignable ยังต้องล็อกอินก่อน', async () => {
    await api().get('/api/users/assignable').expect(401);
  });
});
