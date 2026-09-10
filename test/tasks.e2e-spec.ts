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
import { addDays, todayAsDateOnly } from '../src/common/utils/date.util';

/**
 * e2e ของ M2-06 / M2-07 — มุมมองงานข้ามโครงการ
 *
 * พิสูจน์สิ่งที่ mock พิสูจน์แทนไม่ได้:
 *   - ช่วงวันที่ของ "ใกล้ครบกำหนด" กับ "เกินกำหนด" ต่อกันพอดีเมื่อผ่าน DATEONLY จริง
 *   - ORDER BY ISNULL(due_date) รันได้จริงกับ MySQL และดันงานที่ไม่มีวันครบกำหนดไปท้าย
 *   - สรุปภาพรวมนับตรงกับข้อมูลในฐานจริง
 */

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message: string | null;
}

interface TaskPayload {
  id: number;
  title: string;
  status: string;
  dueDate: string | null;
  isOverdue: boolean;
  project?: { id: number; name: string; status: string } | null;
}

interface Paginated<T> {
  items: T[];
  total: number;
}

interface BoardPayload {
  totalTasks: number;
  openTasks: number;
  overdueTasks: number;
  byStatus: Record<string, number>;
  overdueByStatus: Record<string, number>;
  byAssignee: { assignedUserId: number | null; openTasks: number; overdueTasks: number }[];
}

describe('Tasks across projects (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let projectId: number;
  const titles = new Map<string, number>();

  const stamp = Date.now();
  const today = todayAsDateOnly();

  function api() {
    return request(app.getHttpServer() as Parameters<typeof request>[0]);
  }

  function authed(method: 'get' | 'post', url: string) {
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
      .send({ name: `ลูกค้าทดสอบงาน ${stamp}`, code: `E2E-TK-${stamp}`, status: 'ACTIVE' })
      .expect(201);
    const customerId = (customer.body as ApiResponse<{ id: number }>).data.id;

    const project = await authed('post', '/api/projects')
      .send({
        customerId,
        name: `โครงการทดสอบงาน ${stamp}`,
        code: `E2E-TP-${stamp}`,
        status: 'IN_PROGRESS',
        priority: 'NORMAL',
      })
      .expect(201);
    projectId = (project.body as ApiResponse<{ id: number }>).data.id;

    // ชุดข้อมูลเดียวใช้ทุกเคส — วันที่คำนวณจากวันที่รันเสมอ
    const tasks: { title: string; status: string; dueDate: string | null }[] = [
      { title: 'เกินกำหนด', status: 'WAITING', dueDate: addDays(today, -1) },
      { title: 'ครบกำหนดวันนี้', status: 'DOING', dueDate: today },
      { title: 'อีกสามวัน', status: 'TODO', dueDate: addDays(today, 3) },
      { title: 'อีกสามสิบวัน', status: 'TODO', dueDate: addDays(today, 30) },
      { title: 'ไม่มีวันครบกำหนด', status: 'REVIEW', dueDate: null },
      { title: 'เสร็จแล้วแม้เลยกำหนด', status: 'DONE', dueDate: addDays(today, -2) },
    ];

    for (const task of tasks) {
      const created = await authed('post', `/api/projects/${projectId}/tasks`)
        .send({ title: task.title, status: task.status, ...(task.dueDate ? { dueDate: task.dueDate } : {}) })
        .expect(201);
      titles.set(task.title, (created.body as ApiResponse<{ id: number }>).data.id);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  async function list(url: string): Promise<TaskPayload[]> {
    const response = await authed('get', url).expect(200);
    return (response.body as ApiResponse<Paginated<TaskPayload>>).data.items;
  }

  // -------------------------------------------------------------------------
  // M2-06
  // -------------------------------------------------------------------------
  it('ใกล้ครบกำหนด (ค่าเริ่มต้น 7 วัน) รวมงานที่ครบกำหนดวันนี้ ไม่รวมงานที่เกินแล้วหรือเสร็จแล้ว', async () => {
    const items = await list(`/api/tasks/due-soon?projectId=${projectId}`);

    expect(items.map((task) => task.title)).toEqual(['ครบกำหนดวันนี้', 'อีกสามวัน']);
  });

  it('ใกล้ครบกำหนดกับเกินกำหนดต่อกันพอดี ไม่ซ้อนและไม่เว้น', async () => {
    const dueSoon = await list(`/api/tasks/due-soon?projectId=${projectId}&withinDays=30`);
    const overdue = await list(`/api/tasks/overdue?projectId=${projectId}`);

    const soonIds = dueSoon.map((task) => task.id);
    const overdueIds = overdue.map((task) => task.id);

    expect(soonIds.filter((id) => overdueIds.includes(id))).toEqual([]);
    expect([...overdueIds, ...soonIds].sort()).toEqual(
      ['เกินกำหนด', 'ครบกำหนดวันนี้', 'อีกสามวัน', 'อีกสามสิบวัน']
        .map((title) => titles.get(title) as number)
        .sort(),
    );
  });

  it('withinDays เกิน 90 ถูกปฏิเสธด้วยข้อความภาษาไทย', async () => {
    const response = await authed('get', '/api/tasks/due-soon?withinDays=91').expect(400);

    expect((response.body as ApiResponse<null>).message).toContain('withinDays');
  });

  // -------------------------------------------------------------------------
  // M2-07
  // -------------------------------------------------------------------------
  it('รายการทั้งบริษัทพ่วงโครงการมาด้วย และงานที่ไม่มีวันครบกำหนดอยู่ท้ายสุด', async () => {
    const items = await list(`/api/tasks?projectId=${projectId}&limit=100`);

    expect(items).toHaveLength(6);
    expect(items[items.length - 1].title).toBe('ไม่มีวันครบกำหนด');
    expect(items[0].project).toMatchObject({ id: projectId, status: 'IN_PROGRESS' });
  });

  it('กรองรายการทั้งบริษัทตามสถานะได้', async () => {
    const items = await list(`/api/tasks?projectId=${projectId}&status=WAITING`);

    expect(items.map((task) => task.title)).toEqual(['เกินกำหนด']);
    expect(items[0].isOverdue).toBe(true);
  });

  it('ภาพรวมนับตรงกับข้อมูลจริง และงานเกินกำหนดแยกตามสถานะชี้ว่าติดอยู่ที่ไหน', async () => {
    const response = await authed('get', `/api/tasks/summary?projectId=${projectId}`).expect(200);
    const board = (response.body as ApiResponse<BoardPayload>).data;

    expect(board.totalTasks).toBe(6);
    expect(board.openTasks).toBe(5);
    expect(board.byStatus).toEqual({ TODO: 2, DOING: 1, WAITING: 1, REVIEW: 1, DONE: 1 });
    // งานที่เสร็จแล้วแม้เลยกำหนดไม่นับ ครบกำหนดวันนี้ก็ยังไม่นับ
    expect(board.overdueTasks).toBe(1);
    expect(board.overdueByStatus).toEqual({ TODO: 0, DOING: 0, WAITING: 1, REVIEW: 0 });
    // ทุกงานในชุดนี้ยังไม่มีผู้รับผิดชอบ
    expect(board.byAssignee).toEqual([
      expect.objectContaining({ assignedUserId: null, openTasks: 5, overdueTasks: 1 }),
    ]);
  });

  it('ทุกเส้นยังต้องล็อกอินก่อน', async () => {
    await api().get('/api/tasks').expect(401);
    await api().get('/api/tasks/summary').expect(401);
    await api().get('/api/tasks/due-soon').expect(401);
  });
});
