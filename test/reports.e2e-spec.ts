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
 * e2e ของ M10 + M1-05/M1-06
 *
 * พิสูจน์สิ่งที่ mock พิสูจน์แทนไม่ได้:
 *   - SQL ที่รวมข้อมูลข้ามหลายตารางทำงานได้จริงกับ MySQL
 *   - DECIMAL ถูกอ่านกลับมาเป็น string และบวกกันได้ถูกต้อง
 *   - ธงเตือนสัญญาซ้อนตรงกับที่ endpoint ตรวจสัญญาซ้อนรายงานจริง
 *   - **ไม่มีฟิลด์ที่สื่อว่าเป็นเงินที่รับจริงหลุดออกไปทาง HTTP**
 */

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message: string | null;
}

interface Completeness {
  total: number;
  withData: number;
  withoutData: number;
  completeness: number;
}

interface ByTypePayload {
  disclaimer: string;
  projectContractValue: string;
  projectCount: number;
  maContractValue: string;
  maAddonValue: string;
  oneTimeChargeValue: string;
  oneTimeCompleteness: Completeness;
  totalContractValue: string;
  excludedCancelledValue: string;
  excludedCancelledCount: number;
}

interface OverviewPayload {
  customerId: number;
  customerName: string;
  idleDays: number | null;
  projects: { id: number; contractValue: string | null; status: string }[];
  warranties: { id: number; isCurrentlyActive: boolean }[];
  maContracts: { id: number; isCurrentlyActive: boolean; status: string }[];
  tickets: { id: number }[];
  followUps: { id: number; isOverdue: boolean }[];
  lifetimeValue: {
    disclaimer: string;
    projectContractValue: string;
    totalContractValue: string;
    excludedCancelledValue: string;
    excludedCancelledCount: number;
    overlappingContractCount: number;
  };
}

describe('Reports (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let customerId: number;

  const stamp = Date.now();

  const shiftDays = (days: number): string => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  function api() {
    return request(app.getHttpServer() as Parameters<typeof request>[0]);
  }

  function authed(method: 'get' | 'post' | 'patch' | 'put', url: string) {
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
      .send({ name: `ลูกค้าทดสอบรายงาน ${stamp}`, status: 'ACTIVE' })
      .expect(201);
    customerId = (customer.body as ApiResponse<{ id: number }>).data.id;
  });

  afterAll(async () => {
    await app.close();
  });

  // -------------------------------------------------------------------------
  // ความหมายของตัวเลข
  // -------------------------------------------------------------------------
  it('ทุกรายงานแนบคำเตือนว่าเป็นมูลค่าตามสัญญา ไม่ใช่เงินที่ได้รับจริง', async () => {
    for (const path of [
      '/api/reports/contract-value/by-customer',
      '/api/reports/contract-value/by-type',
      '/api/reports/contract-value/upcoming',
      '/api/reports/ma-contract-overlaps',
      '/api/reports/service-cost',
    ]) {
      const response = await authed('get', path).expect(200);
      expect((response.body as ApiResponse<{ disclaimer: string }>).data.disclaimer).toBeTruthy();
    }
  });

  it('ไม่มีฟิลด์ที่สื่อว่าเป็นเงินที่รับจริงหลุดออกไปทาง HTTP', async () => {
    // ระบบนี้ไม่ใช่ระบบบัญชี (SC-3, OS-03, OS-06) — ถ้าคำพวกนี้โผล่มาแปลว่า
    // มีคนขยายขอบเขตเข้าไปโดยไม่ได้ตั้งใจ
    const response = await authed('get', '/api/reports/contract-value/by-type').expect(200);
    const raw = JSON.stringify((response.body as ApiResponse<ByTypePayload>).data).toLowerCase();

    for (const forbidden of ['"paid', '"payment', '"received', '"revenue', '"invoice', '"cash']) {
      expect(raw).not.toContain(forbidden);
    }
  });

  // -------------------------------------------------------------------------
  // CANCELLED ถูกตัดจากยอดหลัก แต่แสดงแยก
  // -------------------------------------------------------------------------
  it('โครงการที่ยกเลิกไม่ถูกนับในยอดหลัก แต่แสดงแยกให้ตรวจย้อนหลังได้', async () => {
    const before = await authed('get', '/api/reports/contract-value/by-type').expect(200);
    const start = (before.body as ApiResponse<ByTypePayload>).data;

    const created = await authed('post', '/api/projects')
      .send({
        customerId,
        name: `โครงการที่จะยกเลิก ${stamp}`,
        status: 'IN_PROGRESS',
        priority: 'NORMAL',
        contractValue: '70000.00',
      })
      .expect(201);
    const projectId = (created.body as ApiResponse<{ id: number }>).data.id;

    const withProject = await authed('get', '/api/reports/contract-value/by-type').expect(200);
    const added = (withProject.body as ApiResponse<ByTypePayload>).data;
    expect(Number(added.projectContractValue) - Number(start.projectContractValue)).toBe(70000);

    await authed('put', `/api/projects/${projectId}`).send({ status: 'CANCELLED' }).expect(200);

    const after = await authed('get', '/api/reports/contract-value/by-type').expect(200);
    const done = (after.body as ApiResponse<ByTypePayload>).data;

    // ยอดหลักกลับไปเท่าเดิม
    expect(done.projectContractValue).toBe(start.projectContractValue);
    // แต่มูลค่าที่ตัดออกเพิ่มขึ้นเท่ากับที่ยกเลิก
    expect(
      Number(done.excludedCancelledValue) - Number(start.excludedCancelledValue),
    ).toBe(70000);
    expect(done.excludedCancelledCount).toBe(start.excludedCancelledCount + 1);
  });

  // -------------------------------------------------------------------------
  // M10-05 ความครบถ้วนของเวลา
  // -------------------------------------------------------------------------
  it('รอบการแก้ไขที่ไม่ได้กรอกเวลาไม่ถูกนับเป็น 0 ชั่วโมง และรายงานความครบถ้วน', async () => {
    const project = await authed('post', '/api/projects')
      .send({
        customerId,
        name: `โครงการทดสอบต้นทุน ${stamp}`,
        status: 'IN_PROGRESS',
        priority: 'NORMAL',
      })
      .expect(201);
    const projectId = (project.body as ApiResponse<{ id: number }>).data.id;

    const openTicket = async (title: string): Promise<number> => {
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
    };

    const withHours = await openTicket(`ใบที่กรอกเวลา ${stamp}`);
    const withoutHours = await openTicket(`ใบที่ไม่กรอกเวลา ${stamp}`);

    await authed('post', `/api/tickets/${withHours}/resolutions`)
      .send({
        result: 'SUCCESS',
        detail: 'แก้เสร็จ กรอกเวลาไว้',
        resolvedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        hoursSpent: '4.00',
      })
      .expect(201);

    await authed('post', `/api/tickets/${withoutHours}/resolutions`)
      .send({
        result: 'SUCCESS',
        detail: 'แก้เสร็จ แต่ไม่ได้กรอกเวลา',
        resolvedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      })
      .expect(201);

    const response = await authed(
      'get',
      `/api/reports/service-cost?customerId=${customerId}`,
    ).expect(200);
    const report = (
      response.body as ApiResponse<{ totalHours: string; completeness: Completeness }>
    ).data;

    // 4 ชั่วโมงจากใบเดียว — อีกใบไม่ถูกนับเป็น 0
    expect(Number(report.totalHours)).toBe(4);
    expect(report.completeness.total).toBe(2);
    expect(report.completeness.withData).toBe(1);
    expect(report.completeness.withoutData).toBe(1);
    expect(report.completeness.completeness).toBe(50);
  });

  // -------------------------------------------------------------------------
  // สัญญาซ้อนทับ — ตรวจจับและรายงานเท่านั้น
  // -------------------------------------------------------------------------
  it('ตรวจจับสัญญาที่ช่วงเวลาซ้อนทับกัน โดยไม่แก้ข้อมูลใด ๆ', async () => {
    const project = await authed('post', '/api/projects')
      .send({
        customerId,
        name: `โครงการทดสอบสัญญาซ้อน ${stamp}`,
        status: 'IN_PROGRESS',
        priority: 'NORMAL',
      })
      .expect(201);
    const projectId = (project.body as ApiResponse<{ id: number }>).data.id;

    const plan = await authed('post', '/api/ma-plans')
      .send({ code: `E2E_RP_${stamp}`, name: `แผนทดสอบรายงาน ${stamp}`, bugQuotaPerMonth: 5 })
      .expect(201);
    const planId = (plan.body as ApiResponse<{ id: number }>).data.id;

    const makeContract = (startDate: string, endDate: string, price: string) =>
      authed('post', '/api/ma-contracts')
        .send({ projectId, planId, price, startDate, endDate, status: 'ACTIVE' })
        .expect(201);

    const first = await makeContract(shiftDays(-60), shiftDays(120), '20000.00');
    const second = await makeContract(shiftDays(30), shiftDays(300), '30000.00');

    const firstId = (first.body as ApiResponse<{ id: number }>).data.id;
    const secondId = (second.body as ApiResponse<{ id: number }>).data.id;

    const response = await authed(
      'get',
      `/api/reports/ma-contract-overlaps?customerId=${customerId}`,
    ).expect(200);
    const report = (
      response.body as ApiResponse<{
        customerCount: number;
        items: {
          customerId: number;
          overlappingContractCount: number;
          overlappingPairs: [number, number][];
          contracts: { contractId: number; startDate: string; endDate: string }[];
        }[];
      }>
    ).data;

    expect(report.customerCount).toBe(1);

    const item = report.items[0];
    expect(item.customerId).toBe(customerId);
    expect(item.overlappingContractCount).toBe(2);
    expect(item.overlappingPairs).toContainEqual([firstId, secondId]);
    // ต้องคืนช่วงวันของแต่ละฉบับมาให้คนอ่านตัดสินเอง
    expect(item.contracts.map((row) => row.contractId).sort()).toEqual(
      [firstId, secondId].sort(),
    );
    for (const contract of item.contracts) {
      expect(contract.startDate).toBeTruthy();
      expect(contract.endDate).toBeTruthy();
    }

    // ข้อมูลต้องไม่ถูกแตะเลย — ทั้งสองฉบับยังอยู่ครบและสถานะเดิม
    for (const id of [firstId, secondId]) {
      const detail = await authed('get', `/api/ma-contracts/${id}`).expect(200);
      expect((detail.body as ApiResponse<{ status: string }>).data.status).toBe('ACTIVE');
    }
  });

  // -------------------------------------------------------------------------
  // M1-05 / M1-06
  // -------------------------------------------------------------------------
  it('มุมมองลูกค้า 360 องศา รวมครบ 5 อย่าง พร้อมมูลค่ารวมตามสัญญา', async () => {
    const response = await authed('get', `/api/customers/${customerId}/overview`).expect(200);
    const overview = (response.body as ApiResponse<OverviewPayload>).data;

    expect(overview.customerId).toBe(customerId);
    expect(Array.isArray(overview.projects)).toBe(true);
    expect(Array.isArray(overview.warranties)).toBe(true);
    expect(Array.isArray(overview.maContracts)).toBe(true);
    expect(Array.isArray(overview.tickets)).toBe(true);
    expect(Array.isArray(overview.followUps)).toBe(true);

    // M1-06 — มูลค่ารวมตามสัญญา ไม่ใช่เงินที่รับจริง
    expect(overview.lifetimeValue.disclaimer).toContain('ไม่ใช่เงินที่ได้รับจริง');
    // โครงการที่ยกเลิกไปก่อนหน้าต้องถูกตัดออกและนับไว้
    expect(overview.lifetimeValue.excludedCancelledCount).toBeGreaterThan(0);
    expect(Number(overview.lifetimeValue.excludedCancelledValue)).toBeGreaterThan(0);
    // สัญญาที่สร้างซ้อนกันไว้ต้องถูกติดธงเตือน
    expect(overview.lifetimeValue.overlappingContractCount).toBe(2);
  });

  it('ลูกค้าที่ไม่มีอยู่จริง → 404', async () => {
    await authed('get', '/api/customers/99999999/overview').expect(404);
  });

  it('ต้องล็อกอินก่อนถึงจะเรียกรายงานได้', async () => {
    await api().get('/api/reports/contract-value/by-type').expect(401);
    await api().get(`/api/customers/${customerId}/overview`).expect(401);
  });
});
