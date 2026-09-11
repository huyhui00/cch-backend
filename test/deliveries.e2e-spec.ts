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
 * e2e ของการส่งมอบ → ประกัน (ตกลง 11 ก.ย. 2026)
 *
 * พิสูจน์สิ่งที่ mock พิสูจน์แทนไม่ได้:
 *   - migration 20260911000001 เพิ่ม deliveries.is_final ได้จริง
 *   - การตรวจรับครั้งสุดท้ายกับการเปลี่ยนสถานะโครงการ commit ในทรานแซกชันเดียวกันจริง
 *   - ประกันออกได้เฉพาะการส่งมอบครั้งสุดท้ายที่ลูกค้ายอมรับแล้ว ตลอดทั้งสาย HTTP
 */

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message: string | null;
}

interface DeliveryPayload {
  id: number;
  acceptanceStatus: string;
  isFinal: boolean;
  canIssueWarranty: boolean;
}

interface ProjectPayload {
  id: number;
  status: string;
  actualEndDate: string | null;
}

describe('Deliveries → Warranties (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let projectId: number;

  const stamp = Date.now();

  function api() {
    return request(app.getHttpServer() as Parameters<typeof request>[0]);
  }

  function authed(method: 'get' | 'post' | 'patch', url: string) {
    return api()[method](url).set('Authorization', `Bearer ${token}`);
  }

  async function deliver(title: string, deliveredAt: string): Promise<number> {
    const response = await authed('post', `/api/projects/${projectId}/deliveries`)
      .send({ title, deliveredAt })
      .expect(201);
    return (response.body as ApiResponse<{ id: number }>).data.id;
  }

  function accept(deliveryId: number, body: Record<string, unknown>) {
    return authed('patch', `/api/deliveries/${deliveryId}/acceptance`).send(body);
  }

  function issueWarranty(deliveryId: number, durationMonth = 6) {
    return authed('post', `/api/deliveries/${deliveryId}/warranties`).send({ durationMonth });
  }

  async function project(): Promise<ProjectPayload> {
    const response = await authed('get', `/api/projects/${projectId}`).expect(200);
    return (response.body as ApiResponse<ProjectPayload>).data;
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
      .send({ name: `ลูกค้าทดสอบส่งมอบ ${stamp}` })
      .expect(201);
    const customerId = (customer.body as ApiResponse<{ id: number }>).data.id;

    const created = await authed('post', '/api/projects')
      .send({ customerId, name: `โครงการทดสอบส่งมอบ ${stamp}`, status: 'IN_PROGRESS' })
      .expect(201);
    projectId = (created.body as ApiResponse<{ id: number }>).data.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('ครบวงจร: เฟส → ครั้งสุดท้าย → โครงการส่งมอบแล้ว → ออกประกัน → ถอยไม่ได้', async () => {
    // 1. ส่งมอบเฟสแรก (v0.5) ลูกค้ายอมรับ แต่ไม่ใช่ครั้งสุดท้าย
    const phaseId = await deliver('ส่งงานรอบที่ 1 v0.5', '2026-08-01T10:00:00+07:00');

    await issueWarranty(phaseId).expect(409); // ยังรอตรวจรับ

    const phase = await accept(phaseId, { acceptanceStatus: 'ACCEPTED', isFinal: false }).expect(
      200,
    );
    const phaseData = (phase.body as ApiResponse<DeliveryPayload>).data;
    expect(phaseData.isFinal).toBe(false);
    expect(phaseData.canIssueWarranty).toBe(false);

    const rejectedWarranty = await issueWarranty(phaseId).expect(409);
    expect((rejectedWarranty.body as ApiResponse<null>).message).toContain('ครั้งสุดท้าย');
    expect((await project()).status).toBe('IN_PROGRESS'); // เฟสไม่ทำให้โครงการเป็นส่งมอบแล้ว

    // 2. ส่งมอบครั้งสุดท้าย (v1.0) ลูกค้ายอมรับ → โครงการเป็นส่งมอบแล้วให้เอง
    const finalId = await deliver('ส่งงานรอบที่ 2 v1.0', '2026-09-01T10:00:00+07:00');
    const final = await accept(finalId, { acceptanceStatus: 'ACCEPTED', isFinal: true }).expect(
      200,
    );
    expect((final.body as ApiResponse<DeliveryPayload>).data.canIssueWarranty).toBe(true);

    const delivered = await project();
    expect(delivered.status).toBe('DELIVERED');
    expect(delivered.actualEndDate).toBe('2026-09-01');

    // 3. ครั้งสุดท้ายที่ยอมรับแล้วมีได้ใบเดียวต่อโครงการ
    await accept(phaseId, { acceptanceStatus: 'ACCEPTED', isFinal: true }).expect(409);

    // 4. ออกประกันจากครั้งสุดท้ายได้ วันเริ่ม = วันส่งมอบ v1.0
    const warranty = await issueWarranty(finalId, 6).expect(201);
    expect((warranty.body as ApiResponse<{ startDate: string }>).data.startDate).toBe(
      '2026-09-01',
    );

    // 5. ออกประกันแล้ว ถอยการตรวจรับหรือเอาเครื่องหมายครั้งสุดท้ายออกไม่ได้
    await accept(finalId, { acceptanceStatus: 'REJECTED' }).expect(409);
    await accept(finalId, { acceptanceStatus: 'ACCEPTED', isFinal: false }).expect(409);
    expect((await project()).status).toBe('DELIVERED');
  });

  it('ถอยครั้งสุดท้ายก่อนออกประกัน → โครงการกลับเป็นกำลังดำเนินการ', async () => {
    // ใช้โครงการใหม่ เพราะโครงการของเทสต์ก่อนหน้ามีครั้งสุดท้ายที่ออกประกันไปแล้ว
    const customer = await authed('post', '/api/customers')
      .send({ name: `ลูกค้าทดสอบถอยส่งมอบ ${stamp}` })
      .expect(201);
    const created = await authed('post', '/api/projects')
      .send({
        customerId: (customer.body as ApiResponse<{ id: number }>).data.id,
        name: `โครงการถอยส่งมอบ ${stamp}`,
        status: 'IN_PROGRESS',
      })
      .expect(201);
    projectId = (created.body as ApiResponse<{ id: number }>).data.id;

    const finalId = await deliver('ส่งงานครั้งสุดท้าย', '2026-09-05T10:00:00+07:00');
    await accept(finalId, { acceptanceStatus: 'ACCEPTED', isFinal: true }).expect(200);
    expect((await project()).status).toBe('DELIVERED');

    // ลูกค้าเพิ่งพบปัญหา ตีกลับก่อนออกประกัน — สถานะโครงการต้องไม่ค้างเป็นส่งมอบแล้ว
    await accept(finalId, { acceptanceStatus: 'REJECTED' }).expect(200);

    const reverted = await project();
    expect(reverted.status).toBe('IN_PROGRESS');
    expect(reverted.actualEndDate).toBeNull();
  });
});
