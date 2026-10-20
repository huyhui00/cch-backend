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
  let customerId: number;
  const titles = new Map<string, number>();

  const stamp = Date.now();
  const today = todayAsDateOnly();

  function api() {
    return request(app.getHttpServer() as Parameters<typeof request>[0]);
  }

  function authed(method: 'get' | 'post' | 'patch', url: string) {
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
      .send({ name: `ลูกค้าทดสอบงาน ${stamp}`, status: 'ACTIVE' })
      .expect(201);
    customerId = (customer.body as ApiResponse<{ id: number }>).data.id;

    const project = await authed('post', '/api/projects')
      .send({
        customerId,
        name: `โครงการทดสอบงาน ${stamp}`,
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
      { title: 'เสร็จแล้วแม้เลยกำหนด', status: 'DONE', dueDate: addDays(today, -2) },
    ];

    for (const task of tasks) {
      const created = await authed('post', `/api/projects/${projectId}/tasks`)
        .send({ title: task.title, status: task.status, ...(task.dueDate ? { dueDate: task.dueDate } : {}) })
        .expect(201);
      titles.set(task.title, (created.body as ApiResponse<{ id: number }>).data.id);
    }

    // REVIEW สร้างตรง ๆ ไม่ได้ ต้องส่งรายงานแล้วส่งตรวจ เหมือนผู้ใช้จริง
    const me = await authed('get', '/api/auth/me').expect(200);
    const myId = (me.body as ApiResponse<{ id: number }>).data.id;
    const reviewTask = await authed('post', `/api/projects/${projectId}/tasks`)
      .send({ title: 'ไม่มีวันครบกำหนด', assignedUserId: myId })
      .expect(201);
    const reviewTaskId = (reviewTask.body as ApiResponse<{ id: number }>).data.id;
    await authed('post', `/api/tasks/${reviewTaskId}/submissions`)
      .field('report', 'รายงานผลทดสอบ')
      .expect(201);
    await authed('patch', `/api/tasks/${reviewTaskId}/submit-review`).expect(200);
    titles.set('ไม่มีวันครบกำหนด', reviewTaskId);
  });

  it('สร้างงานเป็น REVIEW ตรง ๆ ไม่ได้ — ต้องมีรายการส่งตรวจคู่กันเสมอ', async () => {
    await authed('post', `/api/projects/${projectId}/tasks`)
      .send({ title: `ส่งตรวจลอย ๆ ${stamp}`, status: 'REVIEW' })
      .expect(400);
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
    // งาน REVIEW ต้องมีผู้รับผิดชอบที่ส่งตรวจ ที่เหลือยังไม่มีผู้รับผิดชอบ
    expect(board.byAssignee).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ assignedUserId: null, openTasks: 4, overdueTasks: 1 }),
        expect.objectContaining({ openTasks: 1, overdueTasks: 0 }),
      ]),
    );
    expect(board.byAssignee).toHaveLength(2);
  });

  it('งานของฉันแยกแท็บได้ครบ รวมงานที่ส่งตรวจและเสร็จแล้ว และตัวเลขทุกแท็บตรงกับรายการ', async () => {
    const me = await authed('get', '/api/auth/me').expect(200);
    const myId = (me.body as ApiResponse<{ id: number }>).data.id;
    const project = await authed('post', '/api/projects')
      .send({ customerId, name: `โครงการงานของฉัน ${stamp}`, status: 'IN_PROGRESS' })
      .expect(201);
    const mineProjectId = (project.body as ApiResponse<{ id: number }>).data.id;
    const prefix = `งานของฉัน ${stamp}`;

    const seeds = [
      { title: `${prefix} ต้องทำ`, status: 'TODO' },
      { title: `${prefix} เลยกำหนด`, status: 'DOING', dueDate: addDays(today, -1) },
      { title: `${prefix} เสร็จ`, status: 'DONE' },
    ];
    for (const seed of seeds) {
      await authed('post', `/api/projects/${mineProjectId}/tasks`)
        .send({ ...seed, assignedUserId: myId })
        .expect(201);
    }
    const toReview = await authed('post', `/api/projects/${mineProjectId}/tasks`)
      .send({ title: `${prefix} ส่งตรวจ`, assignedUserId: myId })
      .expect(201);
    const toReviewId = (toReview.body as ApiResponse<{ id: number }>).data.id;
    await authed('post', `/api/tasks/${toReviewId}/submissions`).field('report', 'รายงาน').expect(201);
    await authed('patch', `/api/tasks/${toReviewId}/submit-review`).expect(200);

    const search = encodeURIComponent(prefix);
    const fetchTab = async (tab?: string) => {
      const response = await authed(
        'get',
        `/api/tasks/me?search=${search}&limit=100${tab ? `&tab=${tab}` : ''}`,
      ).expect(200);
      return (
        response.body as ApiResponse<Paginated<TaskPayload> & { counts: Record<string, number> }>
      ).data;
    };

    const open = await fetchTab();
    expect(open.counts).toEqual({
      OPEN: 2,
      TODO: 1,
      IN_PROGRESS: 1,
      REVIEW: 1,
      DONE: 1,
      OVERDUE: 1,
      ALL: 4,
    });
    expect(open.items.map((task) => task.status).sort()).toEqual(['DOING', 'TODO']);

    for (const [tab, statuses] of [
      ['TODO', ['TODO']],
      ['IN_PROGRESS', ['DOING']],
      ['REVIEW', ['REVIEW']],
      ['DONE', ['DONE']],
      ['OVERDUE', ['DOING']],
      ['ALL', ['DOING', 'DONE', 'REVIEW', 'TODO']],
    ] as const) {
      const page = await fetchTab(tab);
      expect(page.items.map((task) => task.status).sort()).toEqual([...statuses]);
      expect(page.total).toBe(open.counts[tab]);
    }

    await authed('get', '/api/tasks/me?tab=SOMETHING').expect(400);
  });

  it('SUPER_ADMIN เห็นงานที่มอบหมายให้คนอื่นใน GET /tasks/me?tab=ALL', async () => {
    const users = await authed('get', '/api/users?limit=100').expect(200);
    const other = (
      users.body as ApiResponse<{ items: { id: number; accountType: string }[] }>
    ).data.items.find((row) => row.accountType === 'USER');
    expect(other).toBeDefined();

    const prefix = `งานคนอื่น ${stamp}`;
    await authed('post', `/api/projects/${projectId}/tasks`)
      .send({ title: prefix, status: 'TODO', assignedUserId: other!.id })
      .expect(201);

    const response = await authed(
      'get',
      `/api/tasks/me?tab=ALL&search=${encodeURIComponent(prefix)}&limit=100`,
    ).expect(200);
    const page = (
      response.body as ApiResponse<Paginated<TaskPayload> & { counts: Record<string, number> }>
    ).data;

    expect(page.total).toBeGreaterThanOrEqual(1);
    expect(page.items.some((task) => task.title === prefix)).toBe(true);
  });

  it('ทุกเส้นยังต้องล็อกอินก่อน', async () => {
    await api().get('/api/tasks').expect(401);
    await api().get('/api/tasks/summary').expect(401);
    await api().get('/api/tasks/due-soon').expect(401);
  });
});
