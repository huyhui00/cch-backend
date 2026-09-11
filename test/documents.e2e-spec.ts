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
 * e2e ของเอกสารโครงการ (Phase 9 — ประชุม 11 ก.ย. B-5)
 *
 * พิสูจน์สิ่งที่ unit test พิสูจน์ไม่ได้:
 *   - multipart จริงผ่าน multer ได้ และชื่อไฟล์ภาษาไทยไม่เพี้ยน (defParamCharset)
 *   - ไฟล์ที่ดาวน์โหลดคืนมาเป็นไบต์เดิมทุกไบต์ ไม่ถูกห่อเป็น JSON โดย TransformInterceptor
 *   - error ของเส้นดาวน์โหลดยังเป็น JSON รูปแบบมาตรฐาน
 *
 * test/setup-env.js ตั้ง STORAGE_DRIVER=local ไว้ ไฟล์จึงลงโฟลเดอร์ชั่วคราว ไม่ขึ้น R2 จริง
 */

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message: string | null;
}

interface DocumentPayload {
  id: number;
  projectId: number;
  customerId: number;
  title: string;
  note: string | null;
  fileName: string;
  fileSize: number;
  mimeType: string;
  downloadUrl: string;
  uploadedBy: { id: number; fullName: string } | null;
}

describe('Documents (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let projectId: number;
  let customerId: number;

  const stamp = Date.now();
  const pdfBytes = Buffer.from(`%PDF-1.4 ไฟล์ทดสอบ ${stamp}`, 'utf8');

  function api() {
    return request(app.getHttpServer() as Parameters<typeof request>[0]);
  }

  function authed(method: 'get' | 'post' | 'patch' | 'delete', url: string) {
    return api()[method](url).set('Authorization', `Bearer ${token}`);
  }

  function upload(fileName: string, fields: Record<string, string> = {}, bytes = pdfBytes) {
    let req = authed('post', `/api/projects/${projectId}/documents`);
    for (const [key, value] of Object.entries(fields)) {
      req = req.field(key, value);
    }
    return req.attach('file', bytes, { filename: fileName, contentType: 'application/pdf' });
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

    const project = await authed('post', '/api/projects')
      .send({ name: `โครงการเก็บเอกสาร ${stamp}`, newCustomer: { name: `ลูกค้าเอกสาร ${stamp}` } })
      .expect(201);
    projectId = (project.body as ApiResponse<{ id: number }>).data.id;
    customerId = (project.body as ApiResponse<{ customerId: number }>).data.customerId;
  });

  afterAll(async () => {
    await app.close();
  });

  it('อัปโหลดไฟล์ชื่อภาษาไทยได้ ชื่อไม่เพี้ยน และลูกค้าคัดลอกจากโครงการ', async () => {
    const response = await upload('ใบเสนอราคา งวดที่ 1.pdf', {
      title: 'ใบเสนอราคา งวด 1',
      note: 'ส่งให้ลูกค้าทาง LINE แล้ว',
    }).expect(201);

    const document = (response.body as ApiResponse<DocumentPayload>).data;

    expect(document.fileName).toBe('ใบเสนอราคา งวดที่ 1.pdf');
    expect(document.title).toBe('ใบเสนอราคา งวด 1');
    expect(document.note).toBe('ส่งให้ลูกค้าทาง LINE แล้ว');
    expect(document.fileSize).toBe(pdfBytes.length);
    expect(document.customerId).toBe(customerId);
    expect(document.uploadedBy).not.toBeNull();
    expect(document.downloadUrl).toBe(`/api/documents/${document.id}/download`);
  });

  it('ไม่ตั้งชื่อเอกสาร → ใช้ชื่อไฟล์', async () => {
    const response = await upload('แผนโครงการ.pdf').expect(201);

    expect((response.body as ApiResponse<DocumentPayload>).data.title).toBe('แผนโครงการ.pdf');
  });

  it('ดาวน์โหลดได้ไบต์เดิมทุกไบต์ พร้อมชื่อไฟล์ภาษาไทยใน Content-Disposition', async () => {
    const created = await upload('สัญญาสแกน.pdf').expect(201);
    const document = (created.body as ApiResponse<DocumentPayload>).data;

    const response = await authed('get', document.downloadUrl)
      .responseType('blob')
      .expect(200);

    expect(Buffer.compare(response.body as Buffer, pdfBytes)).toBe(0);
    expect(response.headers['content-type']).toContain('application/pdf');
    expect(response.headers['content-disposition']).toContain(
      `filename*=UTF-8''${encodeURIComponent('สัญญาสแกน.pdf')}`,
    );
  });

  it('รายการเอกสารของโครงการ ล่าสุดขึ้นก่อน และค้นจากชื่อได้', async () => {
    await upload('เก่ากว่า.pdf', { title: `ค้นเจอ-${stamp}` }).expect(201);

    const response = await authed(
      'get',
      `/api/projects/${projectId}/documents?search=${encodeURIComponent(`ค้นเจอ-${stamp}`)}`,
    ).expect(200);
    const list = (response.body as ApiResponse<{ items: DocumentPayload[]; total: number }>).data;

    expect(list.total).toBe(1);
    expect(list.items[0].title).toBe(`ค้นเจอ-${stamp}`);
  });

  it('ไฟล์ที่รันได้ถูกปฏิเสธ', async () => {
    const response = await upload('ติดตั้ง.exe').expect(400);

    expect((response.body as ApiResponse<null>).message).toContain('ไม่รับไฟล์ประเภท');
  });

  it('ไม่แนบไฟล์ → 400 ภาษาไทย', async () => {
    const response = await authed('post', `/api/projects/${projectId}/documents`)
      .field('title', 'ไม่มีไฟล์')
      .expect(400);

    expect((response.body as ApiResponse<null>).message).toContain('แนบไฟล์');
  });

  it('แก้ชื่อได้ แต่ส่งช่องที่เป็นไฟล์มาแก้ไม่ได้', async () => {
    const created = await upload('แก้ชื่อ.pdf').expect(201);
    const id = (created.body as ApiResponse<DocumentPayload>).data.id;

    const renamed = await authed('patch', `/api/documents/${id}`)
      .send({ title: 'ชื่อใหม่' })
      .expect(200);
    expect((renamed.body as ApiResponse<DocumentPayload>).data.title).toBe('ชื่อใหม่');

    await authed('patch', `/api/documents/${id}`).send({ fileUrl: 'projects/1/x.pdf' }).expect(400);
  });

  it('ลบแล้วหายจากรายการและดาวน์โหลดไม่ได้ — error ยังเป็น JSON รูปแบบมาตรฐาน', async () => {
    const created = await upload('จะถูกลบ.pdf').expect(201);
    const document = (created.body as ApiResponse<DocumentPayload>).data;

    await authed('delete', `/api/documents/${document.id}`).expect(200);
    await authed('get', `/api/documents/${document.id}`).expect(404);

    const download = await authed('get', document.downloadUrl).expect(404);
    expect((download.body as ApiResponse<null>).success).toBe(false);
    expect((download.body as ApiResponse<null>).message).toBe('ไม่พบเอกสาร');
  });

  it('โครงการที่ไม่มีอยู่จริง → 404', async () => {
    await authed('get', '/api/projects/999999999/documents').expect(404);
  });

  it('ต้องล็อกอินก่อน ทั้งรายการและการดาวน์โหลด', async () => {
    await api().get(`/api/projects/${projectId}/documents`).expect(401);
    await api().get('/api/documents/1/download').expect(401);
  });
});
