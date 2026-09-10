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
 * e2e ของ M8 — แบบประเมิน
 *
 * พิสูจน์สิ่งที่ mock พิสูจน์แทนไม่ได้:
 *   - ครบวงจรจริง สร้าง → เปิดใช้ → ส่งให้ลูกค้า → พนักงานคีย์คำตอบ → สรุปผล
 *   - คอลัมน์ JSON (options / answer_json) เขียนและอ่านกลับได้จริงบน MySQL
 *   - unique index ของ assignment_id ไม่ถูกละเมิด
 *   - **ไม่มี endpoint สาธารณะเลย** ทุกเส้นต้องล็อกอิน (Q1)
 */

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message: string | null;
}

interface SurveyPayload {
  id: number;
  title: string;
  status: string;
  isCurrentlyUsable: boolean;
  assignmentCount: number;
  responseCount: number;
  questions: {
    id: number;
    questionText: string;
    questionType: string;
    options: string[] | null;
    minValue: number | null;
    maxValue: number | null;
    sortOrder: number;
  }[];
}

interface AssignmentPayload {
  id: number;
  status: string;
  filledByUserId: number | null;
  responseId: number | null;
}

interface ResponsePayload {
  id: number;
  overallScore: number | null;
  comment: string | null;
  answers: {
    questionId: number;
    answerText: string | null;
    answerNumber: number | null;
    answerChoices: string[] | null;
  }[];
}

interface SummaryPayload {
  assignmentCount: number;
  responseCount: number;
  responseRate: number;
  averageScore: number | null;
  questions: {
    questionId: number;
    questionType: string;
    answeredCount: number;
    averageScore?: number | null;
    choiceCounts?: Record<string, number>;
    textAnswers?: string[];
  }[];
}

describe('Surveys (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let customerId: number;

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
      .send({ name: `ลูกค้าทดสอบแบบประเมิน ${stamp}`, code: `E2E-SV-${stamp}`, status: 'ACTIVE' })
      .expect(201);
    customerId = (customer.body as ApiResponse<{ id: number }>).data.id;
  });

  afterAll(async () => {
    await app.close();
  });

  /** แบบประเมินที่มีครบทั้ง 4 ชนิดคำถาม */
  function createSurvey(title: string) {
    return authed('post', '/api/surveys').send({
      title,
      description: 'ใช้ทดสอบครบทั้งสี่ชนิดคำถาม',
      questions: [
        { questionText: 'ความพึงพอใจโดยรวม', questionType: 'RATING', minValue: 1, maxValue: 5 },
        { questionText: 'ความรวดเร็ว', questionType: 'RATING', minValue: 1, maxValue: 5 },
        {
          questionText: 'ช่องทางที่สะดวกที่สุด',
          questionType: 'CHOICE',
          options: ['LINE', 'โทรศัพท์', 'อีเมล'],
        },
        {
          questionText: 'สิ่งที่ประทับใจ',
          questionType: 'MULTI_CHOICE',
          options: ['ตอบเร็ว', 'แก้ตรงจุด', 'ราคาเหมาะสม'],
        },
        { questionText: 'ข้อเสนอแนะ', questionType: 'TEXT', isRequired: false },
      ],
    });
  }

  /** สร้าง เปิดใช้ และส่งให้ลูกค้า คืน id ของแบบประเมินกับการส่ง */
  async function readyToAnswer(title: string): Promise<{ surveyId: number; assignmentId: number }> {
    const created = await createSurvey(title).expect(201);
    const survey = (created.body as ApiResponse<SurveyPayload>).data;

    await authed('patch', `/api/surveys/${survey.id}/status`).send({ status: 'ACTIVE' }).expect(200);

    const assignment = await authed('post', `/api/surveys/${survey.id}/assignments`)
      .send({ customerId })
      .expect(201);

    return {
      surveyId: survey.id,
      assignmentId: (assignment.body as ApiResponse<AssignmentPayload>).data.id,
    };
  }

  // -------------------------------------------------------------------------
  // Q1 — ไม่มี endpoint สาธารณะเลย
  // -------------------------------------------------------------------------
  it('ทุกเส้นของแบบประเมินต้องล็อกอินก่อน (Q1 — พนักงานกรอกแทน ไม่มีลิงก์สาธารณะ)', async () => {
    await api().get('/api/surveys').expect(401);
    await api().get('/api/surveys/1').expect(401);
    await api().get('/api/surveys/1/summary').expect(401);
    await api().post('/api/survey-assignments/1/response').send({ answers: [] }).expect(401);
  });

  // -------------------------------------------------------------------------
  // ครบวงจร
  // -------------------------------------------------------------------------
  it('สร้าง → เปิดใช้ → ส่ง → คีย์คำตอบ → สรุปผล ครบวงจร', async () => {
    const created = await createSurvey(`แบบประเมินครบวงจร ${stamp}`).expect(201);
    const survey = (created.body as ApiResponse<SurveyPayload>).data;

    // เริ่มที่ DRAFT เสมอ และยังส่งให้ลูกค้าไม่ได้
    expect(survey.status).toBe('DRAFT');
    expect(survey.isCurrentlyUsable).toBe(false);
    expect(survey.questions).toHaveLength(5);
    expect(survey.questions.map((q) => q.sortOrder)).toEqual([0, 1, 2, 3, 4]);
    // ตัวเลือกถูกเก็บเป็น JSON — ต้องอ่านกลับมาได้เหมือนเดิม
    expect(survey.questions[2].options).toEqual(['LINE', 'โทรศัพท์', 'อีเมล']);
    // RATING เท่านั้นที่มีช่วงคะแนน
    expect(survey.questions[4].minValue).toBeNull();

    await authed('post', `/api/surveys/${survey.id}/assignments`)
      .send({ customerId })
      .expect(400);

    const activated = await authed('patch', `/api/surveys/${survey.id}/status`)
      .send({ status: 'ACTIVE' })
      .expect(200);
    expect((activated.body as ApiResponse<SurveyPayload>).data.isCurrentlyUsable).toBe(true);

    const assignment = await authed('post', `/api/surveys/${survey.id}/assignments`)
      .send({ customerId })
      .expect(201);
    const assignmentId = (assignment.body as ApiResponse<AssignmentPayload>).data.id;
    expect((assignment.body as ApiResponse<AssignmentPayload>).data.status).toBe('SENT');

    const answered = await authed('post', `/api/survey-assignments/${assignmentId}/response`)
      .send({
        answers: [
          { questionId: survey.questions[0].id, answerNumber: 5 },
          { questionId: survey.questions[1].id, answerNumber: 4 },
          { questionId: survey.questions[2].id, answerText: 'LINE' },
          { questionId: survey.questions[3].id, answerChoices: ['ตอบเร็ว', 'แก้ตรงจุด'] },
          { questionId: survey.questions[4].id, answerText: 'อยากให้ตอบไลน์เร็วขึ้นช่วงเย็น' },
        ],
        comment: 'โดยรวมพอใจมาก',
      })
      .expect(201);

    const response = (answered.body as ApiResponse<ResponsePayload>).data;

    // คะแนนเฉลี่ยคำนวณจาก RATING สองข้อ = (5 + 4) / 2
    expect(response.overallScore).toBe(4.5);
    expect(response.answers).toHaveLength(5);
    // answer_json เขียนและอ่านกลับได้จริง
    const multi = response.answers.find((a) => a.questionId === survey.questions[3].id);
    expect(multi?.answerChoices).toEqual(['ตอบเร็ว', 'แก้ตรงจุด']);

    // การส่งเปลี่ยนเป็น ANSWERED และบันทึกว่าใครคีย์แทน
    const assignments = await authed('get', `/api/surveys/${survey.id}/assignments`).expect(200);
    const row = (assignments.body as ApiResponse<{ items: AssignmentPayload[] }>).data.items[0];
    expect(row.status).toBe('ANSWERED');
    expect(row.filledByUserId).not.toBeNull();
    expect(row.responseId).toBe(response.id);

    const summary = await authed('get', `/api/surveys/${survey.id}/summary`).expect(200);
    const data = (summary.body as ApiResponse<SummaryPayload>).data;

    expect(data.assignmentCount).toBe(1);
    expect(data.responseCount).toBe(1);
    expect(data.responseRate).toBe(100);
    expect(data.averageScore).toBe(4.5);

    // ตัวเลือกที่ไม่มีใครเลือกยังต้องโผล่พร้อมเลข 0
    const choiceSummary = data.questions.find((q) => q.questionType === 'CHOICE');
    expect(choiceSummary?.choiceCounts).toEqual({ LINE: 1, โทรศัพท์: 0, อีเมล: 0 });

    const textSummary = data.questions.find((q) => q.questionType === 'TEXT');
    expect(textSummary?.textAnswers).toEqual(['อยากให้ตอบไลน์เร็วขึ้นช่วงเย็น']);
  });

  // -------------------------------------------------------------------------
  // ตรวจคำตอบให้ตรงชนิดคำถาม
  // -------------------------------------------------------------------------
  it('คะแนนนอกช่วงถูกปฏิเสธด้วยข้อความภาษาไทย', async () => {
    const { surveyId, assignmentId } = await readyToAnswer(`ตรวจคะแนนนอกช่วง ${stamp}`);
    const detail = await authed('get', `/api/surveys/${surveyId}`).expect(200);
    const questions = (detail.body as ApiResponse<SurveyPayload>).data.questions;

    const response = await authed('post', `/api/survey-assignments/${assignmentId}/response`)
      .send({
        answers: [
          { questionId: questions[0].id, answerNumber: 99 },
          { questionId: questions[1].id, answerNumber: 4 },
          { questionId: questions[2].id, answerText: 'LINE' },
          { questionId: questions[3].id, answerChoices: ['ตอบเร็ว'] },
        ],
      })
      .expect(400);

    expect((response.body as ApiResponse<null>).message).toContain('ต้องอยู่ระหว่าง 1 ถึง 5');
  });

  it('เลือกตัวเลือกที่ไม่มีอยู่จริงถูกปฏิเสธ', async () => {
    const { surveyId, assignmentId } = await readyToAnswer(`ตรวจตัวเลือกผิด ${stamp}`);
    const detail = await authed('get', `/api/surveys/${surveyId}`).expect(200);
    const questions = (detail.body as ApiResponse<SurveyPayload>).data.questions;

    await authed('post', `/api/survey-assignments/${assignmentId}/response`)
      .send({
        answers: [
          { questionId: questions[0].id, answerNumber: 4 },
          { questionId: questions[1].id, answerNumber: 4 },
          { questionId: questions[2].id, answerText: 'ส่งนกพิราบ' },
          { questionId: questions[3].id, answerChoices: ['ตอบเร็ว'] },
        ],
      })
      .expect(400);
  });

  it('ไม่ตอบคำถามที่บังคับถูกปฏิเสธ', async () => {
    const { surveyId, assignmentId } = await readyToAnswer(`ตรวจข้อบังคับ ${stamp}`);
    const detail = await authed('get', `/api/surveys/${surveyId}`).expect(200);
    const questions = (detail.body as ApiResponse<SurveyPayload>).data.questions;

    const response = await authed('post', `/api/survey-assignments/${assignmentId}/response`)
      .send({ answers: [{ questionId: questions[0].id, answerNumber: 4 }] })
      .expect(400);

    expect((response.body as ApiResponse<null>).message).toContain('ต้องตอบ');
  });

  it('การส่งครั้งเดียวบันทึกคำตอบซ้ำไม่ได้', async () => {
    const { surveyId, assignmentId } = await readyToAnswer(`ตรวจตอบซ้ำ ${stamp}`);
    const detail = await authed('get', `/api/surveys/${surveyId}`).expect(200);
    const questions = (detail.body as ApiResponse<SurveyPayload>).data.questions;

    const answers = [
      { questionId: questions[0].id, answerNumber: 4 },
      { questionId: questions[1].id, answerNumber: 4 },
      { questionId: questions[2].id, answerText: 'LINE' },
      { questionId: questions[3].id, answerChoices: ['ตอบเร็ว'] },
    ];

    await authed('post', `/api/survey-assignments/${assignmentId}/response`)
      .send({ answers })
      .expect(201);

    const second = await authed('post', `/api/survey-assignments/${assignmentId}/response`)
      .send({ answers })
      .expect(409);

    expect((second.body as ApiResponse<null>).message).toContain('ตอบได้ครั้งเดียว');
  });

  // -------------------------------------------------------------------------
  // แก้คำถามหลังเริ่มใช้
  // -------------------------------------------------------------------------
  it('แก้คำถามของแบบประเมินที่ ACTIVE ไม่ได้ แต่แก้ชื่อได้', async () => {
    const { surveyId } = await readyToAnswer(`ตรวจการแก้คำถาม ${stamp}`);

    const rejected = await authed('patch', `/api/surveys/${surveyId}`)
      .send({ questions: [{ questionText: 'ข้อใหม่', questionType: 'TEXT' }] })
      .expect(409);
    expect((rejected.body as ApiResponse<null>).message).toContain('ฉบับร่าง');

    await authed('patch', `/api/surveys/${surveyId}`)
      .send({ title: `ชื่อที่แก้แล้ว ${stamp}` })
      .expect(200);
  });

  it('เปลี่ยนเป็น ACTIVE ทั้งที่ยังไม่มีคำถามไม่ได้', async () => {
    const created = await authed('post', '/api/surveys')
      .send({ title: `แบบประเมินเปล่า ${stamp}` })
      .expect(201);
    const surveyId = (created.body as ApiResponse<SurveyPayload>).data.id;

    const response = await authed('patch', `/api/surveys/${surveyId}/status`)
      .send({ status: 'ACTIVE' })
      .expect(400);

    expect((response.body as ApiResponse<null>).message).toContain('ยังไม่มีคำถาม');
  });

  it('แบบประเมินที่ส่งให้ลูกค้าไปแล้วลบไม่ได้', async () => {
    const { surveyId } = await readyToAnswer(`ตรวจการลบ ${stamp}`);

    const response = await authed('delete', `/api/surveys/${surveyId}`).expect(409);

    expect((response.body as ApiResponse<null>).message).toContain('CLOSED');
  });

  it('แบบประเมินที่ยังไม่เคยส่งลบได้', async () => {
    const created = await createSurvey(`แบบประเมินที่จะลบ ${stamp}`).expect(201);
    const surveyId = (created.body as ApiResponse<SurveyPayload>).data.id;

    await authed('delete', `/api/surveys/${surveyId}`).expect(200);
    await authed('get', `/api/surveys/${surveyId}`).expect(404);
  });

  it('ส่งฟิลด์แปลกปลอมถูกปฏิเสธด้วยข้อความภาษาไทย', async () => {
    const response = await authed('post', '/api/surveys')
      .send({ title: `แบบประเมิน ${stamp}`, accessToken: 'ไม่ควรรับค่านี้' })
      .expect(400);

    expect((response.body as ApiResponse<null>).message).toContain('ไม่รู้จักฟิลด์');
  });
});
