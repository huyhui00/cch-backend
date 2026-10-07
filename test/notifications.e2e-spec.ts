/// <reference types="jest" />

import type { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/sequelize';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { requestContextMiddleware } from '../src/common/context/request-context';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { RequestContextInterceptor } from '../src/common/interceptors/request-context.interceptor';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';
import { createValidationPipe } from '../src/common/pipes/validation.pipe';
import { addDays, todayAsDateOnly } from '../src/common/utils/date.util';
import { Notification } from '../src/models';

/**
 * แจ้งกำหนดส่ง — SQL ของทุกหัวข้อรันได้จริง แจ้งครั้งเดียวต่อขั้น และเลื่อนเป็นเลยกำหนดแล้วแจ้งใหม่
 * กฎเริ่มต้นชี้ไปที่ SUPER_ADMIN (seeder) งานโปรเจกต์แจ้งล่วงหน้า 3 วัน
 */

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message: string | null;
}

interface RunResult {
  rulesProcessed: number;
  created: number;
  lineSent: number;
  lineFailed: number;
  skippedDuplicate: number;
}

describe('แจ้งกำหนดส่ง (e2e)', () => {
  let app: INestApplication;
  let superToken: string;
  let notifications: typeof Notification;
  const stamp = Date.now();
  const today = todayAsDateOnly();

  function api() {
    return request(app.getHttpServer() as Parameters<typeof request>[0]);
  }

  function authed(method: 'get' | 'post' | 'put', url: string) {
    return api()[method](url).set('Authorization', `Bearer ${superToken}`);
  }

  async function run(): Promise<RunResult> {
    const res = await authed('post', '/api/notifications/run').expect(201);
    return (res.body as ApiResponse<RunResult>).data;
  }

  function rowsFor(taskId: number) {
    return notifications.findAll({
      where: { refType: 'TASK', refId: taskId },
      order: [['id', 'ASC']],
    });
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
    notifications = app.get<typeof Notification>(getModelToken(Notification));

    const login = await api()
      .post('/api/auth/login')
      .send({
        username: process.env.SUPER_ADMIN_USERNAME ?? 'superadmin',
        password: process.env.SUPER_ADMIN_PASSWORD,
      })
      .expect(200);
    superToken = (login.body as ApiResponse<{ accessToken: string }>).data.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('แจ้งตอนใกล้ครบครั้งเดียว และแจ้งอีกครั้งเมื่อเลยกำหนด', async () => {
    const customer = await authed('post', '/api/customers')
      .send({ name: `ลูกค้าแจ้งเตือน ${stamp}`, status: 'ACTIVE' })
      .expect(201);
    const project = await authed('post', '/api/projects')
      .send({
        customerId: (customer.body as ApiResponse<{ id: number }>).data.id,
        name: `โปรเจกต์แจ้งเตือน ${stamp}`,
        status: 'IN_PROGRESS',
        priority: 'NORMAL',
      })
      .expect(201);
    const projectId = (project.body as ApiResponse<{ id: number }>).data.id;
    const title = `งานแจ้งเตือน ${stamp}`;
    const task = await authed('post', `/api/projects/${projectId}/tasks`)
      .send({ title, status: 'TODO', dueDate: addDays(today, 1) })
      .expect(201);
    const taskId = (task.body as ApiResponse<{ id: number }>).data.id;

    const first = await run();
    expect(first.rulesProcessed).toBeGreaterThan(0);
    const upcoming = await rowsFor(taskId);
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0].title).toBe('งานโปรเจกต์ใกล้ครบกำหนด · ภายใน 3 วัน');
    expect(upcoming[0].message).toContain(`งาน: ${title}`);
    expect(upcoming[0].message).toContain(`ลูกค้า: ลูกค้าแจ้งเตือน ${stamp}`);
    expect(upcoming[0].message).not.toContain('(');

    const second = await run();
    expect(second.skippedDuplicate).toBeGreaterThanOrEqual(1);
    expect(await rowsFor(taskId)).toHaveLength(1);

    await authed('put', `/api/projects/${projectId}/tasks/${taskId}`)
      .send({ dueDate: addDays(today, -2) })
      .expect(200);
    await run();

    const rows = await rowsFor(taskId);
    expect(rows).toHaveLength(2);
    expect(rows[1].title).toBe('เลยกำหนดแล้ว · งาน');
    expect(rows[1].message).toContain('(เลยมา 2 วัน)');
  });

  it('สร้างกฎเป็น DAILY_DIGEST ไม่ได้', async () => {
    const me = await authed('get', '/api/auth/me').expect(200);

    const res = await authed('post', '/api/notification-rules')
      .send({
        name: 'e2e digest',
        eventType: 'DAILY_DIGEST',
        targetUserId: (me.body as ApiResponse<{ id: number }>).data.id,
      })
      .expect(400);

    expect((res.body as ApiResponse<null>).success).toBe(false);
  });
});
