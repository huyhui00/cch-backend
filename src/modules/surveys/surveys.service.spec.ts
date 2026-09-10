/// <reference types="jest" />
// TypeScript 6 ไม่ดึง @types/jest เข้ามาให้อัตโนมัติ ต้องอ้างถึงตรงนี้เหมือน spec ตัวอื่น

import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Op } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';

import {
  Contact,
  Customer,
  Project,
  Survey,
  SurveyAnswer,
  SurveyAssignment,
  SurveyAssignmentStatus,
  SurveyQuestion,
  SurveyQuestionType,
  SurveyResponse,
  SurveyStatus,
} from '../../models';
import { SurveysService } from './surveys.service';

/**
 * แบบประเมิน (M8)
 *
 * Q1 ตอบแล้ว — พนักงานบันทึกคำตอบแทนลูกค้า ไม่มี endpoint สาธารณะ
 *
 * กฎที่เทสต์ชุดนี้ปักหมุดไว้
 *   1. คำตอบต้องตรงชนิดของคำถาม และคำถามที่บังคับต้องมีคำตอบ
 *      — จุดนี้คือที่เดียวที่กันข้อมูลขยะไม่ให้เข้ารายงานสรุป
 *   2. แก้คำถามได้เฉพาะตอน DRAFT เพราะคำตอบอ้างถึง question_id
 *   3. overall_score ระบบคำนวณเอง ไม่รับจาก client
 *   4. 1 การส่ง ตอบได้ครั้งเดียว (assignment_id เป็น UNIQUE)
 */

interface ModelMock {
  findByPk: jest.Mock;
  findOne: jest.Mock;
  findAll: jest.Mock;
  findAndCountAll: jest.Mock;
  create: jest.Mock;
  bulkCreate: jest.Mock;
  update: jest.Mock;
  destroy: jest.Mock;
  count: jest.Mock;
}

function modelMock(): ModelMock {
  return {
    findByPk: jest.fn(),
    findOne: jest.fn(),
    findAll: jest.fn(),
    findAndCountAll: jest.fn(),
    create: jest.fn(),
    bulkCreate: jest.fn(),
    update: jest.fn(),
    destroy: jest.fn(),
    count: jest.fn(),
  };
}

function questionRow(overrides: Record<string, unknown> = {}): SurveyQuestion {
  return {
    id: 7,
    surveyId: 3,
    questionText: 'ความพึงพอใจโดยรวม',
    questionType: SurveyQuestionType.RATING,
    isRequired: true,
    options: null,
    minValue: 1,
    maxValue: 5,
    sortOrder: 0,
    ...overrides,
  } as unknown as SurveyQuestion;
}

function surveyRow(overrides: Record<string, unknown> = {}): Survey {
  return {
    id: 3,
    title: 'แบบประเมินความพึงพอใจ',
    description: null,
    status: SurveyStatus.DRAFT,
    validFrom: null,
    validTo: null,
    questions: [questionRow()],
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    update: jest.fn().mockResolvedValue(undefined),
    destroy: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as Survey;
}

function assignmentRow(overrides: Record<string, unknown> = {}): SurveyAssignment {
  return {
    id: 15,
    surveyId: 3,
    customerId: 1,
    contactId: null,
    projectId: null,
    status: SurveyAssignmentStatus.SENT,
    sentAt: new Date('2026-09-05T00:00:00.000Z'),
    answeredAt: null,
    filledByUserId: null,
    customer: { id: 1, name: 'บริษัท ตัวอย่าง จำกัด' },
    contact: null,
    project: null,
    filledBy: null,
    createdAt: new Date('2026-09-05T00:00:00.000Z'),
    update: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as SurveyAssignment;
}

describe('SurveysService', () => {
  let surveyModel: ModelMock;
  let questionModel: ModelMock;
  let assignmentModel: ModelMock;
  let responseModel: ModelMock;
  let answerModel: ModelMock;
  let customerModel: ModelMock;
  let contactModel: ModelMock;
  let projectModel: ModelMock;
  let service: SurveysService;

  const runTransaction = jest.fn(<T>(fn: (t: unknown) => Promise<T>) => fn({ name: 'tx' }));
  const sequelize = { transaction: runTransaction } as unknown as Sequelize;

  beforeEach(() => {
    surveyModel = modelMock();
    questionModel = modelMock();
    assignmentModel = modelMock();
    responseModel = modelMock();
    answerModel = modelMock();
    customerModel = modelMock();
    contactModel = modelMock();
    projectModel = modelMock();

    surveyModel.findByPk.mockResolvedValue(surveyRow());
    surveyModel.create.mockResolvedValue(surveyRow());
    surveyModel.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });
    questionModel.findAll.mockResolvedValue([questionRow()]);
    assignmentModel.findByPk.mockResolvedValue(assignmentRow());
    assignmentModel.count.mockResolvedValue(0);
    responseModel.findOne.mockResolvedValue(null);
    responseModel.count.mockResolvedValue(0);
    responseModel.findAll.mockResolvedValue([]);
    responseModel.create.mockResolvedValue({ id: 9 });
    responseModel.findByPk.mockResolvedValue({
      id: 9,
      assignmentId: 15,
      surveyId: 3,
      customerId: 1,
      submittedAt: new Date('2026-09-08T00:00:00.000Z'),
      overallScore: '4.00',
      comment: null,
      answers: [],
      customer: { id: 1, name: 'บริษัท ตัวอย่าง จำกัด' },
      createdAt: new Date('2026-09-08T00:00:00.000Z'),
    });
    customerModel.findByPk.mockResolvedValue({ id: 1 });

    service = new SurveysService(
      surveyModel as unknown as typeof Survey,
      questionModel as unknown as typeof SurveyQuestion,
      assignmentModel as unknown as typeof SurveyAssignment,
      responseModel as unknown as typeof SurveyResponse,
      answerModel as unknown as typeof SurveyAnswer,
      customerModel as unknown as typeof Customer,
      contactModel as unknown as typeof Contact,
      projectModel as unknown as typeof Project,
      sequelize,
    );
  });

  // -------------------------------------------------------------------------
  // Q1 — พนักงานบันทึกแทน ไม่มีลิงก์สาธารณะ
  // -------------------------------------------------------------------------
  it('ไม่สร้าง access token ให้การส่งแบบประเมิน (Q1 — พนักงานกรอกแทน)', async () => {
    // คอลัมน์ access_token เตรียมไว้ตอนออกแบบ schema แต่เฟสนี้ไม่ใช้
    // ถ้าวันหนึ่งมีใครเผลอเปิดใช้ เทสต์นี้จะจับได้ว่ามีการออก token โดยไม่ได้ตั้งใจ
    surveyModel.findByPk.mockResolvedValue(surveyRow({ status: SurveyStatus.ACTIVE }));

    let captured: Record<string, unknown> = {};
    assignmentModel.create.mockImplementation((values: Record<string, unknown>) => {
      captured = values;
      return Promise.resolve(assignmentRow());
    });

    await service.createAssignment(3, { customerId: 1 });

    expect(captured.accessToken).toBeUndefined();
    expect(captured.tokenExpiresAt).toBeUndefined();
  });

  it('บันทึกว่าใครเป็นคนคีย์คำตอบแทนลูกค้า', async () => {
    let captured: { filledByUserId?: number | null } = {};
    const update = jest.fn((values: { filledByUserId?: number | null }) => {
      captured = values;
      return Promise.resolve(undefined);
    });
    assignmentModel.findByPk.mockResolvedValue(assignmentRow({ update }));

    await service.createResponse(15, { answers: [{ questionId: 7, answerNumber: 4 }] });

    // getCurrentUserId() คืน null นอก request context แต่ฟิลด์ต้องถูกเขียนเสมอ
    expect(Object.keys(captured)).toContain('filledByUserId');
  });

  // -------------------------------------------------------------------------
  // ตรวจคำตอบให้ตรงชนิดคำถาม — จุดที่กันข้อมูลขยะ
  // -------------------------------------------------------------------------
  describe('การตรวจคำตอบ', () => {
    it('RATING ที่ตอบเป็นข้อความถูกปฏิเสธ', async () => {
      await expect(
        service.createResponse(15, { answers: [{ questionId: 7, answerText: 'ดีมาก' }] }),
      ).rejects.toThrow('ต้องตอบเป็นคะแนน');
    });

    it('คะแนนนอกช่วงที่กำหนดถูกปฏิเสธ', async () => {
      await expect(
        service.createResponse(15, { answers: [{ questionId: 7, answerNumber: 9 }] }),
      ).rejects.toThrow('ต้องอยู่ระหว่าง 1 ถึง 5');
    });

    it('CHOICE ที่ตอบค่านอกตัวเลือกถูกปฏิเสธ', async () => {
      questionModel.findAll.mockResolvedValue([
        questionRow({
          questionType: SurveyQuestionType.CHOICE,
          options: ['ดีมาก', 'ดี'],
          minValue: null,
          maxValue: null,
        }),
      ]);

      await expect(
        service.createResponse(15, { answers: [{ questionId: 7, answerText: 'แย่มาก' }] }),
      ).rejects.toThrow('ไม่อยู่ในตัวเลือกที่กำหนดไว้');
    });

    it('MULTI_CHOICE ที่มีค่านอกตัวเลือกถูกปฏิเสธ พร้อมบอกว่าค่าไหนผิด', async () => {
      questionModel.findAll.mockResolvedValue([
        questionRow({
          questionType: SurveyQuestionType.MULTI_CHOICE,
          options: ['ตอบเร็ว', 'แก้ตรงจุด'],
          minValue: null,
          maxValue: null,
        }),
      ]);

      await expect(
        service.createResponse(15, {
          answers: [{ questionId: 7, answerChoices: ['ตอบเร็ว', 'ไม่มีในตัวเลือก'] }],
        }),
      ).rejects.toThrow('ไม่มีในตัวเลือก');
    });

    it('MULTI_CHOICE ที่เลือกซ้ำถูกปฏิเสธ', async () => {
      questionModel.findAll.mockResolvedValue([
        questionRow({
          questionType: SurveyQuestionType.MULTI_CHOICE,
          options: ['ตอบเร็ว', 'แก้ตรงจุด'],
          minValue: null,
          maxValue: null,
        }),
      ]);

      await expect(
        service.createResponse(15, {
          answers: [{ questionId: 7, answerChoices: ['ตอบเร็ว', 'ตอบเร็ว'] }],
        }),
      ).rejects.toThrow('เลือกซ้ำกัน');
    });

    it('ไม่ตอบคำถามที่บังคับถูกปฏิเสธ', async () => {
      questionModel.findAll.mockResolvedValue([
        questionRow({ id: 7 }),
        questionRow({ id: 8, questionText: 'ข้อที่บังคับ', isRequired: true }),
      ]);

      await expect(
        service.createResponse(15, { answers: [{ questionId: 7, answerNumber: 4 }] }),
      ).rejects.toThrow('เป็นคำถามที่ต้องตอบ');
    });

    it('ไม่ตอบคำถามที่ไม่บังคับได้', async () => {
      questionModel.findAll.mockResolvedValue([
        questionRow({ id: 7 }),
        questionRow({ id: 8, isRequired: false }),
      ]);

      await expect(
        service.createResponse(15, { answers: [{ questionId: 7, answerNumber: 4 }] }),
      ).resolves.toBeDefined();
    });

    it('ตอบคำถามข้อเดียวกันซ้ำถูกปฏิเสธ', async () => {
      await expect(
        service.createResponse(15, {
          answers: [
            { questionId: 7, answerNumber: 4 },
            { questionId: 7, answerNumber: 5 },
          ],
        }),
      ).rejects.toThrow('ซ้ำมากกว่าหนึ่งครั้ง');
    });

    it('ตอบคำถามที่ไม่ได้อยู่ในแบบประเมินฉบับนี้ถูกปฏิเสธ', async () => {
      await expect(
        service.createResponse(15, { answers: [{ questionId: 999, answerNumber: 4 }] }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('บันทึกเวลาที่ลูกค้าตอบล่วงหน้าไม่ได้', async () => {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      await expect(
        service.createResponse(15, {
          answers: [{ questionId: 7, answerNumber: 4 }],
          submittedAt: tomorrow,
        }),
      ).rejects.toThrow('ต้องไม่เป็นเวลาในอนาคต');
    });
  });

  // -------------------------------------------------------------------------
  // คะแนนเฉลี่ย
  // -------------------------------------------------------------------------
  describe('คะแนนเฉลี่ย', () => {
    it('คำนวณจากคำถามแบบ RATING ที่ตอบมาจริง ไม่รับจาก client', async () => {
      questionModel.findAll.mockResolvedValue([
        questionRow({ id: 7 }),
        questionRow({ id: 8 }),
        questionRow({
          id: 9,
          questionType: SurveyQuestionType.TEXT,
          minValue: null,
          maxValue: null,
        }),
      ]);

      let captured: { overallScore: string | null } = { overallScore: null };
      responseModel.create.mockImplementation((values: { overallScore: string | null }) => {
        captured = values;
        return Promise.resolve({ id: 9 });
      });

      await service.createResponse(15, {
        answers: [
          { questionId: 7, answerNumber: 5 },
          { questionId: 8, answerNumber: 4 },
          { questionId: 9, answerText: 'ข้อความไม่ถูกนับเป็นคะแนน' },
        ],
      });

      expect(captured.overallScore).toBe('4.50');
    });

    it('ไม่มีคำถามให้คะแนนเลย → overallScore เป็น null ไม่ใช่ 0', async () => {
      // 0 แปลว่า "ให้คะแนนศูนย์" ซึ่งคนละความหมายกับ "ไม่มีคะแนนให้คิด"
      questionModel.findAll.mockResolvedValue([
        questionRow({ questionType: SurveyQuestionType.TEXT, minValue: null, maxValue: null }),
      ]);

      let captured: { overallScore: string | null } = { overallScore: '0' };
      responseModel.create.mockImplementation((values: { overallScore: string | null }) => {
        captured = values;
        return Promise.resolve({ id: 9 });
      });

      await service.createResponse(15, { answers: [{ questionId: 7, answerText: 'ดีครับ' }] });

      expect(captured.overallScore).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 1 การส่ง ตอบได้ครั้งเดียว
  // -------------------------------------------------------------------------
  it('การส่งที่บันทึกคำตอบไปแล้วบันทึกซ้ำไม่ได้', async () => {
    // assignment_id เป็น UNIQUE ที่ฐานข้อมูล — ดักเองเพื่อให้ได้ข้อความไทย
    // แทน error ดิบของ MySQL
    responseModel.findOne.mockResolvedValue({ id: 9 });

    await expect(
      service.createResponse(15, { answers: [{ questionId: 7, answerNumber: 4 }] }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('ทุกอย่างของการบันทึกคำตอบอยู่ในทรานแซกชันเดียว', async () => {
    // ถ้าแยกกัน แล้วคำตอบรายข้อพัง จะเหลือคำตอบเปล่าที่นับเป็นหนึ่งชุดในรายงาน
    // แต่ไม่มีเนื้อหาอะไรเลย
    await service.createResponse(15, { answers: [{ questionId: 7, answerNumber: 4 }] });

    expect(runTransaction).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // สถานะและการแก้คำถาม
  // -------------------------------------------------------------------------
  describe('สถานะ', () => {
    it('สร้างแล้วเริ่มที่ DRAFT เสมอ', async () => {
      let captured: { status: SurveyStatus } = { status: SurveyStatus.ACTIVE };
      surveyModel.create.mockImplementation((values: { status: SurveyStatus }) => {
        captured = values;
        return Promise.resolve(surveyRow());
      });

      await service.create({ title: 'แบบประเมินใหม่' });

      expect(captured.status).toBe(SurveyStatus.DRAFT);
    });

    it('เปลี่ยนเป็น ACTIVE ทั้งที่ยังไม่มีคำถามไม่ได้', async () => {
      surveyModel.findByPk.mockResolvedValue(surveyRow({ questions: [] }));

      await expect(service.updateStatus(3, SurveyStatus.ACTIVE)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('ย้อนกลับเป็น DRAFT ไม่ได้เมื่อมีคำตอบแล้ว', async () => {
      // DRAFT แก้คำถามได้ ถ้าย้อนได้ทั้งที่มีคำตอบ คำตอบเก่าจะสื่อความหมายผิด
      surveyModel.findByPk.mockResolvedValue(surveyRow({ status: SurveyStatus.CLOSED }));
      responseModel.count.mockResolvedValue(4);

      await expect(service.updateStatus(3, SurveyStatus.DRAFT)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('ย้อนกลับเป็น DRAFT ได้ถ้ายังไม่มีคำตอบ', async () => {
      const update = jest.fn().mockResolvedValue(undefined);
      surveyModel.findByPk.mockResolvedValue(surveyRow({ status: SurveyStatus.ACTIVE, update }));

      await service.updateStatus(3, SurveyStatus.DRAFT);

      expect(update).toHaveBeenCalled();
    });

    it('ส่งให้ลูกค้าได้เฉพาะแบบประเมินที่ ACTIVE', async () => {
      surveyModel.findByPk.mockResolvedValue(surveyRow({ status: SurveyStatus.DRAFT }));

      await expect(service.createAssignment(3, { customerId: 1 })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('การแก้คำถาม', () => {
    it('แก้คำถามของแบบประเมินที่ ACTIVE ไม่ได้', async () => {
      surveyModel.findByPk.mockResolvedValue(surveyRow({ status: SurveyStatus.ACTIVE }));

      await expect(
        service.update(3, {
          questions: [{ questionText: 'ข้อใหม่', questionType: SurveyQuestionType.TEXT }],
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('แก้ชื่อของแบบประเมินที่ ACTIVE ได้ เพราะไม่กระทบความหมายของคำตอบ', async () => {
      const update = jest.fn().mockResolvedValue(undefined);
      surveyModel.findByPk.mockResolvedValue(surveyRow({ status: SurveyStatus.ACTIVE, update }));

      await service.update(3, { title: 'ชื่อใหม่' });

      expect(update).toHaveBeenCalled();
      expect(questionModel.destroy).not.toHaveBeenCalled();
    });

    it('ลำดับคำถามมาจากตำแหน่งในอาเรย์ ไม่ได้รับจาก client', async () => {
      let captured: { sortOrder: number }[] = [];
      questionModel.bulkCreate.mockImplementation((rows: { sortOrder: number }[]) => {
        captured = rows;
        return Promise.resolve(rows);
      });

      await service.create({
        title: 'แบบประเมิน',
        questions: [
          { questionText: 'ข้อ 1', questionType: SurveyQuestionType.TEXT },
          { questionText: 'ข้อ 2', questionType: SurveyQuestionType.TEXT },
        ],
      });

      expect(captured.map((row) => row.sortOrder)).toEqual([0, 1]);
    });
  });

  // -------------------------------------------------------------------------
  // ตรวจรูปคำถามตอนสร้าง
  // -------------------------------------------------------------------------
  describe('รูปแบบคำถาม', () => {
    it('CHOICE ที่มีตัวเลือกน้อยกว่า 2 ข้อถูกปฏิเสธ', async () => {
      await expect(
        service.create({
          title: 'x',
          questions: [
            {
              questionText: 'เลือกได้ข้อเดียว',
              questionType: SurveyQuestionType.CHOICE,
              options: ['ดี'],
            },
          ],
        }),
      ).rejects.toThrow('ต้องมีตัวเลือกอย่างน้อย 2 ข้อ');
    });

    it('CHOICE ที่มีตัวเลือกซ้ำถูกปฏิเสธ', async () => {
      await expect(
        service.create({
          title: 'x',
          questions: [
            {
              questionText: 'เลือกได้ข้อเดียว',
              questionType: SurveyQuestionType.CHOICE,
              options: ['ดี', 'ดี'],
            },
          ],
        }),
      ).rejects.toThrow('มีตัวเลือกซ้ำกัน');
    });

    it('TEXT ที่ใส่ตัวเลือกมาถูกปฏิเสธ', async () => {
      await expect(
        service.create({
          title: 'x',
          questions: [
            {
              questionText: 'พิมพ์ตอบ',
              questionType: SurveyQuestionType.TEXT,
              options: ['ก', 'ข'],
            },
          ],
        }),
      ).rejects.toThrow('จึงใส่ตัวเลือกไม่ได้');
    });

    it('RATING ที่คะแนนต่ำสุดไม่น้อยกว่าสูงสุดถูกปฏิเสธ', async () => {
      await expect(
        service.create({
          title: 'x',
          questions: [
            {
              questionText: 'ให้คะแนน',
              questionType: SurveyQuestionType.RATING,
              minValue: 5,
              maxValue: 5,
            },
          ],
        }),
      ).rejects.toThrow('ต้องน้อยกว่าคะแนนสูงสุด');
    });

    it('TEXT ที่กำหนดช่วงคะแนนมาถูกปฏิเสธ', async () => {
      await expect(
        service.create({
          title: 'x',
          questions: [
            { questionText: 'พิมพ์ตอบ', questionType: SurveyQuestionType.TEXT, maxValue: 5 },
          ],
        }),
      ).rejects.toThrow('จึงกำหนดช่วงคะแนนไม่ได้');
    });
  });

  // -------------------------------------------------------------------------
  // ลบ
  // -------------------------------------------------------------------------
  describe('remove', () => {
    it('ลบไม่ได้ถ้าเคยส่งให้ลูกค้าแล้ว และบอกวิธีที่ควรทำแทน', async () => {
      assignmentModel.count.mockResolvedValue(3);

      await expect(service.remove(3)).rejects.toBeInstanceOf(ConflictException);
      await expect(service.remove(3)).rejects.toThrow('CLOSED');
    });

    it('ไม่พบแบบประเมิน → 404', async () => {
      surveyModel.findByPk.mockResolvedValue(null);

      await expect(service.remove(99)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // -------------------------------------------------------------------------
  // สรุปผล
  // -------------------------------------------------------------------------
  describe('summarize', () => {
    it('อัตราการตอบกลับเป็น 0 เมื่อยังไม่เคยส่งให้ใคร ไม่ใช่หารด้วยศูนย์', async () => {
      assignmentModel.count.mockResolvedValue(0);

      const summary = await service.summarize(3);

      expect(summary.responseRate).toBe(0);
      expect(summary.averageScore).toBeNull();
    });

    it('คิดอัตราการตอบกลับเป็นเปอร์เซ็นต์ทศนิยม 2 ตำแหน่ง', async () => {
      assignmentModel.count.mockResolvedValue(3);
      responseModel.findAll.mockResolvedValue([
        { answers: [{ questionId: 7, answerNumber: '4.00', answerText: null, answerJson: null }] },
        { answers: [{ questionId: 7, answerNumber: '5.00', answerText: null, answerJson: null }] },
      ]);

      const summary = await service.summarize(3);

      expect(summary.responseRate).toBe(66.67);
      expect(summary.averageScore).toBe(4.5);
    });

    it('ตัวเลือกที่ยังไม่มีใครเลือกก็ยังคืนมาพร้อมเลข 0', async () => {
      // ไม่งั้นกราฟจะดูเหมือนไม่เคยมีตัวเลือกนั้นอยู่ในแบบประเมินเลย
      surveyModel.findByPk.mockResolvedValue(
        surveyRow({
          questions: [
            questionRow({
              questionType: SurveyQuestionType.CHOICE,
              options: ['ดีมาก', 'ดี', 'แย่'],
              minValue: null,
              maxValue: null,
            }),
          ],
        }),
      );
      assignmentModel.count.mockResolvedValue(1);
      responseModel.findAll.mockResolvedValue([
        { answers: [{ questionId: 7, answerText: 'ดีมาก', answerNumber: null, answerJson: null }] },
      ]);

      const summary = await service.summarize(3);

      expect(summary.questions[0].choiceCounts).toEqual({ ดีมาก: 1, ดี: 0, แย่: 0 });
    });
  });

  // -------------------------------------------------------------------------
  // M8-06 สรุปคะแนนแยกตามลูกค้าและตามเดือน
  // -------------------------------------------------------------------------
  describe('scoreBreakdown', () => {
    /** ใช้เวลาท้องถิ่นเสมอ ผลการจัดกลุ่มรายเดือนจะได้ไม่เปลี่ยนตามเขตเวลาของเครื่องที่รันเทสต์ */
    function response(
      customerId: number,
      customerName: string,
      submittedAt: Date,
      overallScore: string | null,
    ) {
      return {
        customerId,
        customer: { id: customerId, name: customerName },
        submittedAt,
        overallScore,
      };
    }

    it('คำตอบที่ไม่มีคะแนนรวมไม่ถูกนับเป็น 0 แต่แยกนับไว้ใน scoredCount', async () => {
      responseModel.findAll.mockResolvedValue([
        response(1, 'ลูกค้า ก', new Date(2026, 0, 5), '4.00'),
        response(1, 'ลูกค้า ก', new Date(2026, 0, 6), null),
        response(1, 'ลูกค้า ก', new Date(2026, 0, 7), '5.00'),
      ]);

      const result = await service.scoreBreakdown(3, {});

      // ถ้านับ null เป็น 0 จะได้ 3.00 ซึ่งต่ำกว่าความจริงโดยไม่มีใครรู้
      expect(result.overall).toEqual({ responseCount: 3, scoredCount: 2, averageScore: 4.5 });
    });

    it('แยกรายลูกค้า เรียงตามชื่อ พร้อมวันที่ตอบล่าสุด', async () => {
      const latest = new Date(2026, 1, 20);
      responseModel.findAll.mockResolvedValue([
        response(2, 'ลูกค้า ข', new Date(2026, 0, 3), '3.00'),
        response(1, 'ลูกค้า ก', new Date(2026, 0, 4), '5.00'),
        response(2, 'ลูกค้า ข', latest, '4.00'),
      ]);

      const result = await service.scoreBreakdown(3, {});

      expect(result.byCustomer.map((row) => row.customerName)).toEqual(['ลูกค้า ก', 'ลูกค้า ข']);
      expect(result.byCustomer[1]).toMatchObject({
        customerId: 2,
        responseCount: 2,
        averageScore: 3.5,
        lastSubmittedAt: latest,
      });
    });

    it('เดือนที่ไม่มีคำตอบคืนมาด้วยพร้อม 0 และคะแนน null — กราฟจะไม่ข้ามเดือน', async () => {
      responseModel.findAll.mockResolvedValue([
        response(1, 'ลูกค้า ก', new Date(2026, 0, 15), '4.00'),
        response(1, 'ลูกค้า ก', new Date(2026, 2, 15), '2.00'),
      ]);

      const result = await service.scoreBreakdown(3, {});

      expect(result.byMonth).toEqual([
        { month: '2026-01', responseCount: 1, scoredCount: 1, averageScore: 4 },
        { month: '2026-02', responseCount: 0, scoredCount: 0, averageScore: null },
        { month: '2026-03', responseCount: 1, scoredCount: 1, averageScore: 2 },
      ]);
    });

    it('กรองด้วยวันที่ลูกค้าตอบ รวมทั้งวันของ dateTo และคืนทุกเดือนในช่วงที่ขอ', async () => {
      let where: { submittedAt?: Record<symbol, Date> } = {};
      responseModel.findAll.mockImplementation((options: { where: typeof where }) => {
        where = options.where;
        return Promise.resolve([]);
      });

      const result = await service.scoreBreakdown(3, {
        dateFrom: '2026-01-10',
        dateTo: '2026-03-31',
      });

      expect(where.submittedAt?.[Op.gte]).toEqual(new Date(2026, 0, 10));
      // ตัดที่เที่ยงคืนของวันถัดไป — คำตอบตอนบ่ายของวันที่ 31 ต้องยังถูกนับ
      expect(where.submittedAt?.[Op.lt]).toEqual(new Date(2026, 3, 1));
      expect(result.byMonth.map((row) => row.month)).toEqual(['2026-01', '2026-02', '2026-03']);
      expect(result.overall.averageScore).toBeNull();
    });

    it('ไม่มีคำตอบและไม่ระบุช่วง = ไม่มีเดือนให้แสดง', async () => {
      const result = await service.scoreBreakdown(3, {});

      expect(result.byMonth).toEqual([]);
      expect(result.byCustomer).toEqual([]);
      expect(result.overall).toEqual({ responseCount: 0, scoredCount: 0, averageScore: null });
    });

    it('dateTo อยู่ก่อน dateFrom → 400', async () => {
      await expect(
        service.scoreBreakdown(3, { dateFrom: '2026-05-01', dateTo: '2026-04-01' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('ช่วงเวลากว้างเกิน 120 เดือน → 400 กันคำขอที่พิมพ์ปีผิด', async () => {
      await expect(
        service.scoreBreakdown(3, { dateFrom: '2000-01-01', dateTo: '2026-12-31' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('ไม่พบแบบประเมิน → 404', async () => {
      surveyModel.findByPk.mockResolvedValue(null);

      await expect(service.scoreBreakdown(99, {})).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
