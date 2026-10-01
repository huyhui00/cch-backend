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

    // 4. ออกประกันจากครั้งสุดท้ายได้ วันเริ่ม = วันถัดจากวันส่งมอบ v1.0
    const warranty = await issueWarranty(finalId, 6).expect(201);
    expect((warranty.body as ApiResponse<{ startDate: string }>).data.startDate).toBe(
      '2026-09-02',
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

  /**
   * B-13 — ประกันผูกสัญญา MA (ประชุม 11 ก.ย., ยืนยัน Q14 12 ก.ย.)
   *
   * พี่เลี้ยง: "เราดึงสัญญาบำรุงรักษา MA เข้าไปด้วยนะ ... จะได้รู้ว่าประกันตัวนี้รวม MA ตัวไหน"
   * และปฏิเสธการคิดรวมไว้ชัด — เทสต์นี้จึงพิสูจน์ทั้งว่าผูกได้จริงตลอดสาย HTTP
   * และว่าสัญญาที่ผูกต้องเป็นของโครงการเดียวกันเท่านั้น
   */
  it('ผูกสัญญา MA กับประกันได้ และผูกข้ามโครงการไม่ได้ (B-13)', async () => {
    const customer = await authed('post', '/api/customers')
      .send({ name: `ลูกค้าทดสอบผูก MA ${stamp}` })
      .expect(201);
    const customerId = (customer.body as ApiResponse<{ id: number }>).data.id;

    const makeProject = async (name: string): Promise<number> => {
      const created = await authed('post', '/api/projects')
        .send({ customerId, name, status: 'IN_PROGRESS' })
        .expect(201);
      return (created.body as ApiResponse<{ id: number }>).data.id;
    };

    const mine = await makeProject(`โครงการผูก MA ${stamp}`);
    const other = await makeProject(`โครงการอื่นของลูกค้าเดียวกัน ${stamp}`);

    const plans = await authed('get', '/api/ma-plans?limit=1').expect(200);
    const planId = (plans.body as ApiResponse<{ items: { id: number }[] }>).data.items[0].id;

    const makeContract = async (forProject: number): Promise<number> => {
      const response = await authed('post', '/api/ma-contracts')
        .send({
          projectId: forProject,
          planId,
          price: '12000.00',
          startDate: '2026-09-01',
          endDate: '2027-08-31',
        })
        .expect(201);
      return (response.body as ApiResponse<{ id: number }>).data.id;
    };

    const myContract = await makeContract(mine);
    const otherContract = await makeContract(other);

    projectId = mine;
    const finalId = await deliver('ส่งงานครั้งสุดท้าย', '2026-09-02T10:00:00+07:00');
    await accept(finalId, { acceptanceStatus: 'ACCEPTED', isFinal: true }).expect(200);

    // สัญญาของโครงการอื่นผูกไม่ได้ แม้จะเป็นลูกค้ารายเดียวกัน
    const mismatch = await authed('post', `/api/deliveries/${finalId}/warranties`)
      .send({ durationMonth: 6, maContractId: otherContract })
      .expect(400);
    expect((mismatch.body as ApiResponse<null>).message).toContain('โครงการเดียวกัน');

    // ผูกสัญญาของโครงการตัวเองได้ และคืนชื่อแผนมาให้หน้าจอแสดง
    const created = await authed('post', `/api/deliveries/${finalId}/warranties`)
      .send({ durationMonth: 6, maContractId: myContract })
      .expect(201);
    const warranty = (
      created.body as ApiResponse<{
        id: number;
        maContractId: number | null;
        maContract: { id: number; planName: string | null } | null;
        isCurrentlyActive: boolean;
      }>
    ).data;

    expect(warranty.maContractId).toBe(myContract);
    expect(warranty.maContract?.id).toBe(myContract);
    expect(warranty.maContract?.planName).toBeTruthy();

    // ถอดการผูกออกได้เมื่อผูกผิดฉบับ — ไม่ใช่หลักฐานทางการเงิน
    const unlinked = await api()
      .put(`/api/warranties/${warranty.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ maContractId: null })
      .expect(200);
    const after = (
      unlinked.body as ApiResponse<{
        maContractId: number | null;
        maContract: unknown;
        isCurrentlyActive: boolean;
      }>
    ).data;

    expect(after.maContractId).toBeNull();
    expect(after.maContract).toBeNull();
    // "ไม่ใช่คิดรวมนะ" — การผูกหรือถอดสัญญาต้องไม่กระทบความคุ้มครองของประกันเลย
    expect(after.isCurrentlyActive).toBe(warranty.isCurrentlyActive);
  });

  it('รายการประกันคืน attachmentCount จริง — แนบใบที่ลูกค้าเซ็นแล้วนับเพิ่ม (BR-12)', async () => {
    const customer = await authed('post', '/api/customers')
      .send({ name: `ลูกค้าทดสอบไฟล์ประกัน ${stamp}` })
      .expect(201);
    const created = await authed('post', '/api/projects')
      .send({
        customerId: (customer.body as ApiResponse<{ id: number }>).data.id,
        name: `โครงการทดสอบไฟล์ประกัน ${stamp}`,
        status: 'IN_PROGRESS',
      })
      .expect(201);
    projectId = (created.body as ApiResponse<{ id: number }>).data.id;

    const finalId = await deliver('ส่งงานครั้งสุดท้าย', '2026-09-03T10:00:00+07:00');
    await accept(finalId, { acceptanceStatus: 'ACCEPTED', isFinal: true }).expect(200);
    const issued = await issueWarranty(finalId, 12).expect(201);
    const warrantyId = (issued.body as ApiResponse<{ id: number }>).data.id;

    const countOf = async (): Promise<number | undefined> => {
      const response = await authed('get', `/api/projects/${projectId}/warranties`).expect(200);
      const items = (
        response.body as ApiResponse<{ items: { id: number; attachmentCount: number }[] }>
      ).data.items;
      return items.find((item) => item.id === warrantyId)?.attachmentCount;
    };

    expect(await countOf()).toBe(0);

    await authed('post', '/api/attachments')
      .field('refType', 'WARRANTY')
      .field('refId', String(warrantyId))
      .attach('file', Buffer.from('%PDF-1.4 signed'), 'ใบรับประกันเซ็นแล้ว.pdf')
      .expect(201);

    expect(await countOf()).toBe(1);
  });
});
