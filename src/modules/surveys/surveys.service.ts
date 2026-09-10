import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Op, type Order, type Transaction, type WhereOptions } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

import { getCurrentUserId } from '../../common/context/request-context';
import { type PaginatedResult, toPaginatedResult } from '../../common/dto/pagination.dto';
import { todayAsDateOnly } from '../../common/utils/date.util';
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
  User,
} from '../../models';
import {
  CreateAssignmentDto,
  CreateResponseDto,
  CreateSurveyDto,
  QueryAssignmentsDto,
  QuerySurveysDto,
  SurveyAnswerDto,
  SurveyQuestionDto,
  UpdateSurveyDto,
} from './dto/survey.dto';
import {
  type AssignmentResponseDto,
  type QuestionSummaryDto,
  type ResponseDetailDto,
  type SurveyResponseDto,
  type SurveySummaryDto,
  toAssignmentResponse,
  toOptionList,
  toResponseDetail,
  toSurveyResponse,
} from './dto/survey.response';

const SORTABLE_FIELDS = new Set(['id', 'title', 'status', 'createdAt', 'updatedAt']);

/** ค่าเริ่มต้นของช่วงคะแนนเมื่อผู้ใช้ไม่ระบุ — 1 ถึง 5 เป็นแบบที่คนไทยคุ้นที่สุด */
const DEFAULT_RATING_MIN = 1;
const DEFAULT_RATING_MAX = 5;

/** เผื่อนาฬิกาเครื่องผู้ใช้คลาดเคลื่อน — กติกาเดียวกับบันทึกการติดต่อใน Phase 4 */
const CLOCK_SKEW_MS = 5 * 60 * 1000;

/** สร้างใหม่ทุกครั้ง — Sequelize แก้ object ของ include ในที่ตอน normalize ห้ามใช้ร่วมกัน */
function questionsInclude() {
  return {
    model: SurveyQuestion,
    required: false,
    separate: true,
    order: [
      ['sortOrder', 'ASC'],
      ['id', 'ASC'],
    ] as Order,
  };
}

function assignmentDetailIncludes() {
  return [
    { model: Customer, attributes: ['id', 'name'], required: false, paranoid: false },
    { model: Contact, attributes: ['id', 'name'], required: false, paranoid: false },
    { model: Project, attributes: ['id', 'name'], required: false, paranoid: false },
    // ยังต้องเห็นชื่อคนที่คีย์คำตอบแม้ลาออกไปแล้ว (BR-09)
    { model: User, attributes: ['id', 'fullName'], required: false, paranoid: false },
  ];
}

/**
 * M8 — แบบประเมินความพึงพอใจ
 *
 * **Q1 ตอบแล้ว 10 ก.ย. 2026 — พนักงานเป็นคนบันทึกคำตอบแทนลูกค้า**
 * ระบบทำฟอร์มคำถาม → ส่งให้ลูกค้ารีวิวนอกระบบ (LINE / อีเมล / กระดาษ) →
 * พนักงานคีย์คำตอบกลับเข้ามา
 *
 * ผลที่ตามมาซึ่งต้องรักษาไว้:
 *   - **ไม่มี endpoint สาธารณะเลย** ทุกเส้นอยู่หลัง JwtAuthGuard เหมือนโมดูลอื่น
 *   - คอลัมน์ `access_token` / `token_expires_at` ที่เตรียมไว้ตอนออกแบบ schema
 *     **ไม่ถูกใช้ในเฟสนี้** ปล่อยเป็น null ไว้ ถ้าวันหนึ่งผู้บริหารอยากได้ลิงก์
 *     ให้ลูกค้ากรอกเอง จะเป็นการ *เพิ่ม* ไม่ใช่รื้อของเดิม
 *   - ลูกค้ายังไม่มีบัญชีผู้ใช้ (BR-01) ไม่ว่าทางไหน
 */
@Injectable()
export class SurveysService {
  constructor(
    @InjectModel(Survey) private readonly surveyModel: typeof Survey,
    @InjectModel(SurveyQuestion) private readonly questionModel: typeof SurveyQuestion,
    @InjectModel(SurveyAssignment) private readonly assignmentModel: typeof SurveyAssignment,
    @InjectModel(SurveyResponse) private readonly responseModel: typeof SurveyResponse,
    @InjectModel(SurveyAnswer) private readonly answerModel: typeof SurveyAnswer,
    @InjectModel(Customer) private readonly customerModel: typeof Customer,
    @InjectModel(Contact) private readonly contactModel: typeof Contact,
    @InjectModel(Project) private readonly projectModel: typeof Project,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  // ---- แบบประเมิน ----------------------------------------------------------

  async findAll(query: QuerySurveysDto): Promise<PaginatedResult<SurveyResponseDto>> {
    const where: WhereOptions = {};

    if (query.status !== undefined) {
      Object.assign(where, { status: query.status });
    }

    if (query.search) {
      Object.assign(where, { title: { [Op.like]: `%${query.search}%` } });
    }

    const sortBy = query.sortBy && SORTABLE_FIELDS.has(query.sortBy) ? query.sortBy : 'createdAt';

    const { rows, count } = await this.surveyModel.findAndCountAll({
      where,
      include: [questionsInclude()],
      order: [
        [sortBy, query.sortOrder],
        ['id', 'DESC'],
      ],
      limit: query.limit,
      offset: query.offset,
      distinct: true,
    });

    const today = todayAsDateOnly();
    const items = await Promise.all(
      rows.map(async (row) => toSurveyResponse(row, today, await this.countUsage(row.id))),
    );

    return toPaginatedResult(items, count, query);
  }

  async findOne(id: number): Promise<SurveyResponseDto> {
    const survey = await this.findOrFail(id);

    return toSurveyResponse(survey, todayAsDateOnly(), await this.countUsage(id));
  }

  async create(dto: CreateSurveyDto): Promise<SurveyResponseDto> {
    const actorId = getCurrentUserId();

    this.assertDateRange(dto.validFrom ?? null, dto.validTo ?? null);

    if (dto.questions) {
      dto.questions.forEach((question, index) => this.assertQuestionShape(question, index));
    }

    const created = await this.sequelize.transaction(async (transaction) => {
      const survey = await this.surveyModel.create(
        {
          title: dto.title,
          description: dto.description ?? null,
          // เริ่มที่ DRAFT เสมอ — ต้องกดเปลี่ยนสถานะเองเมื่อคำถามพร้อมแล้ว
          status: SurveyStatus.DRAFT,
          validFrom: dto.validFrom ?? null,
          validTo: dto.validTo ?? null,
          createdBy: actorId,
          updatedBy: actorId,
        },
        { transaction },
      );

      if (dto.questions && dto.questions.length > 0) {
        await this.replaceQuestions(survey.id, dto.questions, transaction);
      }

      return survey;
    });

    return this.findOne(created.id);
  }

  /**
   * แก้ไขแบบประเมิน
   *
   * **แก้คำถามได้เฉพาะตอนยังเป็น DRAFT** เพราะ `survey_answers.question_id` ชี้ไปที่คำถาม
   * ถ้าแทนที่คำถามหลังเริ่มเก็บคำตอบแล้ว คำตอบเก่าจะชี้ไปที่แถวที่ถูกลบ กลายเป็น
   * คำตอบของคำถามที่ไม่เคยถูกถาม แล้วรายงานสรุปจะอ่านไม่ได้ทั้งชุด
   *
   * ส่วนชื่อ คำอธิบาย และช่วงวันที่ แก้ได้ตลอดเพราะไม่กระทบความหมายของคำตอบ
   */
  async update(id: number, dto: UpdateSurveyDto): Promise<SurveyResponseDto> {
    const actorId = getCurrentUserId();
    const survey = await this.findOrFail(id);

    this.assertDateRange(
      dto.validFrom !== undefined ? dto.validFrom : survey.validFrom,
      dto.validTo !== undefined ? dto.validTo : survey.validTo,
    );

    if (dto.questions !== undefined) {
      if (survey.status !== SurveyStatus.DRAFT) {
        throw new ConflictException(
          'แก้คำถามได้เฉพาะแบบประเมินที่ยังเป็นฉบับร่าง — ' +
            'คำตอบที่เก็บมาแล้วอ้างถึงคำถามเดิม ถ้าเปลี่ยนตอนนี้รายงานสรุปจะอ่านไม่ได้ ' +
            'ถ้าต้องแก้จริงให้สร้างแบบประเมินฉบับใหม่แทน',
        );
      }

      dto.questions.forEach((question, index) => this.assertQuestionShape(question, index));
    }

    await this.sequelize.transaction(async (transaction) => {
      await survey.update(
        {
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.validFrom !== undefined ? { validFrom: dto.validFrom } : {}),
          ...(dto.validTo !== undefined ? { validTo: dto.validTo } : {}),
          updatedBy: actorId,
        },
        { transaction },
      );

      if (dto.questions !== undefined) {
        await this.replaceQuestions(id, dto.questions, transaction);
      }
    });

    return this.findOne(id);
  }

  /**
   * เปลี่ยนสถานะแบบประเมิน
   *
   * DRAFT → ACTIVE   ต้องมีคำถามอย่างน้อย 1 ข้อ ไม่งั้นส่งฟอร์มเปล่าให้ลูกค้า
   * ACTIVE → CLOSED  ปิดรับคำตอบ ยังดูผลย้อนหลังได้
   * CLOSED → ACTIVE  เปิดรับใหม่ได้ เผื่อปิดผิด
   * → DRAFT          ได้เฉพาะที่ยังไม่มีคำตอบเลย เพราะกลับไป DRAFT แล้วแก้คำถามได้
   *                  ซึ่งจะทำให้คำตอบที่เก็บมาแล้วสื่อความหมายผิด
   */
  async updateStatus(id: number, nextStatus: SurveyStatus): Promise<SurveyResponseDto> {
    const actorId = getCurrentUserId();
    const survey = await this.findOrFail(id);

    if (nextStatus === SurveyStatus.ACTIVE && (survey.questions ?? []).length === 0) {
      throw new BadRequestException(
        'แบบประเมินที่ยังไม่มีคำถามเปลี่ยนเป็นใช้งานไม่ได้ กรุณาเพิ่มคำถามอย่างน้อย 1 ข้อ',
      );
    }

    if (nextStatus === SurveyStatus.DRAFT && survey.status !== SurveyStatus.DRAFT) {
      const responseCount = await this.responseModel.count({ where: { surveyId: id } });

      if (responseCount > 0) {
        throw new ConflictException(
          `แบบประเมินนี้มีคำตอบแล้ว ${responseCount} ชุด จึงย้อนกลับเป็นฉบับร่างไม่ได้ ` +
            'เพราะฉบับร่างแก้คำถามได้ ซึ่งจะทำให้คำตอบที่เก็บมาสื่อความหมายผิด',
        );
      }
    }

    await survey.update({ status: nextStatus, updatedBy: actorId });

    return this.findOne(id);
  }

  /** ลบได้เฉพาะแบบประเมินที่ยังไม่เคยถูกส่งให้ลูกค้า */
  async remove(id: number): Promise<void> {
    const actorId = getCurrentUserId();
    const survey = await this.findOrFail(id);

    const assignmentCount = await this.assignmentModel.count({ where: { surveyId: id } });

    if (assignmentCount > 0) {
      throw new ConflictException(
        `แบบประเมินนี้ถูกส่งให้ลูกค้าไปแล้ว ${assignmentCount} ครั้ง จึงลบไม่ได้ — ` +
          'ให้เปลี่ยนสถานะเป็น CLOSED แทน ผลที่เก็บไว้จะยังดูย้อนหลังได้',
      );
    }

    await this.sequelize.transaction(async (transaction) => {
      // เขียน deleted_by ก่อน destroy เพราะ paranoid destroy แตะแค่ deleted_at (BR-09)
      await this.questionModel.update(
        { deletedBy: actorId },
        { where: { surveyId: id }, transaction },
      );
      await this.questionModel.destroy({ where: { surveyId: id }, transaction });

      await survey.update({ deletedBy: actorId }, { transaction });
      await survey.destroy({ transaction });
    });
  }

  // ---- การส่งให้ลูกค้า ------------------------------------------------------

  async findAssignments(
    surveyId: number,
    query: QueryAssignmentsDto,
  ): Promise<PaginatedResult<AssignmentResponseDto>> {
    await this.findOrFail(surveyId);

    const where: WhereOptions = { surveyId };

    if (query.customerId !== undefined) {
      Object.assign(where, { customerId: query.customerId });
    }

    const { rows, count } = await this.assignmentModel.findAndCountAll({
      where,
      include: assignmentDetailIncludes(),
      order: [['id', 'DESC']],
      limit: query.limit,
      offset: query.offset,
      distinct: true,
    });

    const responses = await this.responseModel.findAll({
      where: { assignmentId: { [Op.in]: rows.map((row) => row.id) } },
      attributes: ['id', 'assignmentId'],
    });
    const responseByAssignment = new Map(responses.map((row) => [row.assignmentId, row.id]));

    return toPaginatedResult(
      rows.map((row) => toAssignmentResponse(row, responseByAssignment.get(row.id) ?? null)),
      count,
      query,
    );
  }

  /**
   * บันทึกว่าส่งแบบประเมินให้ลูกค้าแล้ว
   *
   * **ระบบไม่ได้ส่งอะไรออกไปจริง** (BR-11 ไม่ยิงหาลูกค้า) การส่งเกิดนอกระบบ
   * แถวนี้คือหลักฐานว่าส่งให้ใคร เมื่อไหร่ และเป็นที่ผูกคำตอบกลับมา
   * สถานะเริ่มที่ SENT เลย ไม่ใช่ PENDING เพราะการกดปุ่มนี้แปลว่าส่งไปแล้ว
   */
  async createAssignment(
    surveyId: number,
    dto: CreateAssignmentDto,
  ): Promise<AssignmentResponseDto> {
    const actorId = getCurrentUserId();
    const survey = await this.findOrFail(surveyId);

    if (survey.status !== SurveyStatus.ACTIVE) {
      throw new BadRequestException(
        'ส่งได้เฉพาะแบบประเมินที่สถานะเป็นใช้งานอยู่ (ACTIVE) เท่านั้น',
      );
    }

    await this.assertCustomerExists(dto.customerId);

    if (dto.contactId) {
      await this.assertContactBelongsToCustomer(dto.contactId, dto.customerId);
    }

    if (dto.projectId) {
      await this.assertProjectBelongsToCustomer(dto.projectId, dto.customerId);
    }

    const sentAt = dto.sentAt ? new Date(dto.sentAt) : new Date();
    this.assertNotInFuture(sentAt, 'เวลาที่ส่งแบบประเมินต้องไม่เป็นเวลาในอนาคต');

    const assignment = await this.assignmentModel.create({
      surveyId,
      customerId: dto.customerId,
      contactId: dto.contactId ?? null,
      projectId: dto.projectId ?? null,
      status: SurveyAssignmentStatus.SENT,
      sentAt,
      // accessToken / tokenExpiresAt ไม่ถูกใช้ในเฟสนี้ (Q1 = พนักงานกรอกแทน)
      createdBy: actorId,
      updatedBy: actorId,
    });

    return this.findAssignmentOrFail(assignment.id).then((row) => toAssignmentResponse(row, null));
  }

  // ---- บันทึกคำตอบแทนลูกค้า -------------------------------------------------

  /**
   * บันทึกคำตอบที่ลูกค้าให้มา (Q1 — พนักงานคีย์แทน)
   *
   * ทุกอย่างอยู่ในทรานแซกชันเดียว เพราะถ้าสร้างหัวคำตอบสำเร็จแล้วคำตอบรายข้อพัง
   * จะเหลือคำตอบเปล่าที่นับเป็นหนึ่งชุดในรายงานแต่ไม่มีเนื้อหาอะไรเลย
   *
   * `overall_score` คำนวณจากคำถามแบบ RATING ที่ตอบมาจริง ไม่รับจาก client
   * ถ้าให้กรอกเอง ตัวเลขในรายงานจะไม่ตรงกับคำตอบที่บันทึกไว้
   */
  async createResponse(assignmentId: number, dto: CreateResponseDto): Promise<ResponseDetailDto> {
    const actorId = getCurrentUserId();
    const assignment = await this.findAssignmentOrFail(assignmentId);

    // assignment_id เป็น UNIQUE — ดักไว้เองก่อนเพื่อให้ได้ข้อความไทยแทน error ของ MySQL
    const existing = await this.responseModel.findOne({ where: { assignmentId } });

    if (existing) {
      throw new ConflictException(
        'การส่งครั้งนี้บันทึกคำตอบไปแล้ว — 1 ครั้งที่ส่งตอบได้ครั้งเดียว ' +
          'ถ้าลูกค้าตอบใหม่ให้บันทึกการส่งครั้งใหม่แทน',
      );
    }

    const questions = await this.questionModel.findAll({
      where: { surveyId: assignment.surveyId },
      order: [
        ['sortOrder', 'ASC'],
        ['id', 'ASC'],
      ],
    });

    const submittedAt = dto.submittedAt ? new Date(dto.submittedAt) : new Date();
    this.assertNotInFuture(submittedAt, 'เวลาที่ลูกค้าตอบต้องไม่เป็นเวลาในอนาคต');

    const prepared = this.validateAnswers(questions, dto.answers);

    const created = await this.sequelize.transaction(async (transaction) => {
      const response = await this.responseModel.create(
        {
          assignmentId,
          surveyId: assignment.surveyId,
          customerId: assignment.customerId,
          submittedAt,
          overallScore: prepared.overallScore,
          comment: dto.comment ?? null,
          createdBy: actorId,
          updatedBy: actorId,
        },
        { transaction },
      );

      await this.answerModel.bulkCreate(
        prepared.answers.map((answer) => ({
          responseId: response.id,
          questionId: answer.questionId,
          answerText: answer.answerText,
          answerNumber: answer.answerNumber,
          answerJson: answer.answerJson,
          createdBy: actorId,
          updatedBy: actorId,
        })),
        { transaction },
      );

      await assignment.update(
        {
          status: SurveyAssignmentStatus.ANSWERED,
          answeredAt: submittedAt,
          // ใครเป็นคนคีย์แทนลูกค้า — จุดที่ Q1 ถูกบันทึกไว้เป็นข้อมูล ไม่ใช่แค่ข้อตกลง
          filledByUserId: actorId,
          updatedBy: actorId,
        },
        { transaction },
      );

      return response;
    });

    return this.findResponse(created.id);
  }

  async findResponses(surveyId: number): Promise<ResponseDetailDto[]> {
    await this.findOrFail(surveyId);

    const responses = await this.responseModel.findAll({
      where: { surveyId },
      include: this.responseDetailIncludes(),
      order: [['submittedAt', 'DESC']],
    });

    return responses.map(toResponseDetail);
  }

  async findResponse(id: number): Promise<ResponseDetailDto> {
    const response = await this.responseModel.findByPk(id, {
      include: this.responseDetailIncludes(),
    });

    if (!response) {
      throw new NotFoundException('ไม่พบคำตอบแบบประเมินนี้');
    }

    return toResponseDetail(response);
  }

  // ---- สรุปผล --------------------------------------------------------------

  /**
   * สรุปผลแบบประเมิน
   *
   * รวมในฝั่ง backend ไม่ให้ frontend ไปนับเอง เพราะสูตรคะแนนเฉลี่ยต้องเหมือนกัน
   * ทุกที่ที่แสดง ถ้าแต่ละหน้าจอนับเอง วันหนึ่งตัวเลขจะไม่ตรงกันแล้วไม่มีใครรู้ว่าอันไหนถูก
   */
  async summarize(surveyId: number): Promise<SurveySummaryDto> {
    const survey = await this.findOrFail(surveyId);

    const [assignmentCount, responses] = await Promise.all([
      this.assignmentModel.count({ where: { surveyId } }),
      this.responseModel.findAll({
        where: { surveyId },
        include: [{ model: SurveyAnswer, required: false }],
      }),
    ]);

    const answersByQuestion = new Map<number, SurveyAnswer[]>();

    for (const response of responses) {
      for (const answer of response.answers ?? []) {
        const bucket = answersByQuestion.get(answer.questionId) ?? [];
        bucket.push(answer);
        answersByQuestion.set(answer.questionId, bucket);
      }
    }

    const questions = (survey.questions ?? []).map((question) =>
      this.summarizeQuestion(question, answersByQuestion.get(question.id) ?? []),
    );

    const ratingScores = questions
      .filter((item) => item.averageScore !== null && item.averageScore !== undefined)
      .map((item) => item.averageScore as number);

    return {
      surveyId,
      title: survey.title,
      assignmentCount,
      responseCount: responses.length,
      responseRate:
        assignmentCount === 0 ? 0 : this.round2((responses.length / assignmentCount) * 100),
      averageScore:
        ratingScores.length === 0
          ? null
          : this.round2(ratingScores.reduce((sum, value) => sum + value, 0) / ratingScores.length),
      questions,
    };
  }

  // ---- helpers -------------------------------------------------------------

  private summarizeQuestion(question: SurveyQuestion, answers: SurveyAnswer[]): QuestionSummaryDto {
    const base = {
      questionId: question.id,
      questionText: question.questionText,
      questionType: question.questionType,
      answeredCount: answers.length,
    };

    if (question.questionType === SurveyQuestionType.RATING) {
      const scores = answers
        .map((answer) => (answer.answerNumber === null ? null : Number(answer.answerNumber)))
        .filter((value): value is number => value !== null);

      return {
        ...base,
        averageScore:
          scores.length === 0
            ? null
            : this.round2(scores.reduce((sum, value) => sum + value, 0) / scores.length),
      };
    }

    if (question.questionType === SurveyQuestionType.TEXT) {
      return {
        ...base,
        textAnswers: answers
          .map((answer) => answer.answerText)
          .filter((value): value is string => value !== null),
      };
    }

    // CHOICE / MULTI_CHOICE — เริ่มทุกตัวเลือกที่ 0 เพื่อให้ตัวเลือกที่ไม่มีใครเลือก
    // ยังโผล่ในกราฟ ไม่งั้นหน้าจอจะดูเหมือนไม่เคยมีตัวเลือกนั้นอยู่
    const counts: Record<string, number> = {};

    for (const option of toOptionList(question.options) ?? []) {
      counts[option] = 0;
    }

    for (const answer of answers) {
      const chosen =
        question.questionType === SurveyQuestionType.MULTI_CHOICE
          ? (toOptionList(answer.answerJson) ?? [])
          : answer.answerText === null
            ? []
            : [answer.answerText];

      for (const value of chosen) {
        counts[value] = (counts[value] ?? 0) + 1;
      }
    }

    return { ...base, choiceCounts: counts };
  }

  /**
   * ตรวจคำตอบให้เข้ากับชนิดของคำถาม แล้วจัดรูปให้ตรงคอลัมน์ที่ต้องเก็บ
   *
   * นี่คือจุดที่ข้อมูลขยะถูกกันไว้ — ถ้าปล่อยให้ RATING เก็บข้อความ หรือ CHOICE
   * เก็บค่าที่ไม่มีในตัวเลือก รายงานสรุปจะคำนวณไม่ได้และไม่มีใครรู้จนกว่าจะเปิดดู
   */
  private validateAnswers(
    questions: SurveyQuestion[],
    answers: SurveyAnswerDto[],
  ): {
    answers: {
      questionId: number;
      answerText: string | null;
      answerNumber: string | null;
      answerJson: unknown;
    }[];
    overallScore: string | null;
  } {
    const questionById = new Map(questions.map((question) => [question.id, question]));
    const seen = new Set<number>();
    const prepared: {
      questionId: number;
      answerText: string | null;
      answerNumber: string | null;
      answerJson: unknown;
    }[] = [];
    const ratings: number[] = [];

    for (const answer of answers) {
      const question = questionById.get(answer.questionId);

      if (!question) {
        throw new BadRequestException(
          `คำถาม id ${answer.questionId} ไม่ได้อยู่ในแบบประเมินฉบับนี้`,
        );
      }

      if (seen.has(answer.questionId)) {
        throw new BadRequestException(`ตอบคำถาม "${question.questionText}" ซ้ำมากกว่าหนึ่งครั้ง`);
      }

      seen.add(answer.questionId);
      prepared.push(this.prepareAnswer(question, answer, ratings));
    }

    for (const question of questions) {
      if (question.isRequired && !seen.has(question.id)) {
        throw new BadRequestException(`คำถาม "${question.questionText}" เป็นคำถามที่ต้องตอบ`);
      }
    }

    return {
      answers: prepared,
      // DECIMAL เก็บเป็น string ตลอดสาย ด้วยเหตุผลเดียวกับราคาใน Phase 8
      overallScore:
        ratings.length === 0
          ? null
          : this.round2(ratings.reduce((sum, value) => sum + value, 0) / ratings.length).toFixed(2),
    };
  }

  private prepareAnswer(
    question: SurveyQuestion,
    answer: SurveyAnswerDto,
    ratings: number[],
  ): {
    questionId: number;
    answerText: string | null;
    answerNumber: string | null;
    answerJson: unknown;
  } {
    const label = question.questionText;

    if (question.questionType === SurveyQuestionType.RATING) {
      if (answer.answerNumber === undefined || answer.answerNumber === null) {
        throw new BadRequestException(`คำถาม "${label}" ต้องตอบเป็นคะแนน`);
      }

      const min = question.minValue ?? DEFAULT_RATING_MIN;
      const max = question.maxValue ?? DEFAULT_RATING_MAX;

      if (answer.answerNumber < min || answer.answerNumber > max) {
        throw new BadRequestException(`คะแนนของคำถาม "${label}" ต้องอยู่ระหว่าง ${min} ถึง ${max}`);
      }

      ratings.push(answer.answerNumber);

      return {
        questionId: question.id,
        answerText: null,
        answerNumber: answer.answerNumber.toFixed(2),
        answerJson: null,
      };
    }

    if (question.questionType === SurveyQuestionType.TEXT) {
      if (!answer.answerText) {
        throw new BadRequestException(`คำถาม "${label}" ต้องตอบเป็นข้อความ`);
      }

      return {
        questionId: question.id,
        answerText: answer.answerText,
        answerNumber: null,
        answerJson: null,
      };
    }

    const options = toOptionList(question.options) ?? [];

    if (question.questionType === SurveyQuestionType.CHOICE) {
      if (!answer.answerText) {
        throw new BadRequestException(`คำถาม "${label}" ต้องเลือกคำตอบหนึ่งข้อ`);
      }

      if (!options.includes(answer.answerText)) {
        throw new BadRequestException(`คำตอบของคำถาม "${label}" ไม่อยู่ในตัวเลือกที่กำหนดไว้`);
      }

      return {
        questionId: question.id,
        answerText: answer.answerText,
        answerNumber: null,
        answerJson: null,
      };
    }

    // MULTI_CHOICE
    const chosen = answer.answerChoices ?? [];

    if (chosen.length === 0) {
      throw new BadRequestException(`คำถาม "${label}" ต้องเลือกอย่างน้อยหนึ่งข้อ`);
    }

    if (new Set(chosen).size !== chosen.length) {
      throw new BadRequestException(`คำถาม "${label}" มีตัวเลือกที่เลือกซ้ำกัน`);
    }

    const invalid = chosen.filter((value) => !options.includes(value));

    if (invalid.length > 0) {
      throw new BadRequestException(
        `คำตอบของคำถาม "${label}" มีตัวเลือกที่ไม่ได้กำหนดไว้: ${invalid.join(', ')}`,
      );
    }

    return {
      questionId: question.id,
      answerText: null,
      answerNumber: null,
      answerJson: chosen,
    };
  }

  /** ตรวจว่าคำถามแต่ละข้อมีของครบตามชนิดของตัวเอง — กันฟอร์มที่ตอบไม่ได้ตั้งแต่ตอนสร้าง */
  private assertQuestionShape(question: SurveyQuestionDto, index: number): void {
    const at = `คำถามข้อที่ ${index + 1}`;
    const needsOptions =
      question.questionType === SurveyQuestionType.CHOICE ||
      question.questionType === SurveyQuestionType.MULTI_CHOICE;

    if (needsOptions) {
      if (!question.options || question.options.length < 2) {
        throw new BadRequestException(`${at} เป็นคำถามแบบเลือกตอบ ต้องมีตัวเลือกอย่างน้อย 2 ข้อ`);
      }

      if (new Set(question.options).size !== question.options.length) {
        throw new BadRequestException(`${at} มีตัวเลือกซ้ำกัน`);
      }
    } else if (question.options && question.options.length > 0) {
      throw new BadRequestException(`${at} ไม่ใช่คำถามแบบเลือกตอบ จึงใส่ตัวเลือกไม่ได้`);
    }

    if (question.questionType === SurveyQuestionType.RATING) {
      const min = question.minValue ?? DEFAULT_RATING_MIN;
      const max = question.maxValue ?? DEFAULT_RATING_MAX;

      if (min >= max) {
        throw new BadRequestException(`${at} คะแนนต่ำสุดต้องน้อยกว่าคะแนนสูงสุด`);
      }
    } else if (question.minValue !== undefined || question.maxValue !== undefined) {
      throw new BadRequestException(`${at} ไม่ใช่คำถามแบบให้คะแนน จึงกำหนดช่วงคะแนนไม่ได้`);
    }
  }

  /** ลบคำถามเดิมทั้งชุดแล้วเขียนใหม่ตามลำดับที่ส่งมา — อยู่ในทรานแซกชันของผู้เรียกเสมอ */
  private async replaceQuestions(
    surveyId: number,
    questions: SurveyQuestionDto[],
    transaction: Transaction,
  ): Promise<void> {
    const actorId = getCurrentUserId();

    await this.questionModel.update({ deletedBy: actorId }, { where: { surveyId }, transaction });
    await this.questionModel.destroy({ where: { surveyId }, transaction });

    if (questions.length === 0) {
      return;
    }

    const isChoice = (type: SurveyQuestionType) =>
      type === SurveyQuestionType.CHOICE || type === SurveyQuestionType.MULTI_CHOICE;

    await this.questionModel.bulkCreate(
      questions.map((question, index) => ({
        surveyId,
        questionText: question.questionText,
        questionType: question.questionType,
        isRequired: question.isRequired ?? true,
        options: isChoice(question.questionType) ? (question.options ?? []) : null,
        minValue:
          question.questionType === SurveyQuestionType.RATING
            ? (question.minValue ?? DEFAULT_RATING_MIN)
            : null,
        maxValue:
          question.questionType === SurveyQuestionType.RATING
            ? (question.maxValue ?? DEFAULT_RATING_MAX)
            : null,
        // ลำดับมาจากตำแหน่งในอาเรย์ ไม่รับจาก client — ค่าที่ส่งมาเองมีโอกาสซ้ำหรือข้ามเลข
        sortOrder: index,
        createdBy: actorId,
        updatedBy: actorId,
      })),
      { transaction },
    );
  }

  private responseDetailIncludes() {
    return [
      {
        model: SurveyAnswer,
        required: false,
        include: [{ model: SurveyQuestion, required: false, paranoid: false }],
      },
      { model: Customer, attributes: ['id', 'name'], required: false, paranoid: false },
    ];
  }

  private async countUsage(
    surveyId: number,
  ): Promise<{ assignmentCount: number; responseCount: number }> {
    const [assignmentCount, responseCount] = await Promise.all([
      this.assignmentModel.count({ where: { surveyId } }),
      this.responseModel.count({ where: { surveyId } }),
    ]);

    return { assignmentCount, responseCount };
  }

  private round2(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private assertDateRange(validFrom: string | null, validTo: string | null): void {
    // เทียบสตริงได้ตรง ๆ เพราะ YYYY-MM-DD เรียงตามพจนานุกรมแล้วได้ลำดับเวลาที่ถูกต้อง
    if (validFrom !== null && validTo !== null && validTo < validFrom) {
      throw new BadRequestException('วันสิ้นสุดการใช้งานต้องไม่อยู่ก่อนวันเริ่มใช้งาน');
    }
  }

  private assertNotInFuture(value: Date, message: string): void {
    if (value.getTime() > Date.now() + CLOCK_SKEW_MS) {
      throw new BadRequestException(message);
    }
  }

  private async findOrFail(id: number): Promise<Survey> {
    const survey = await this.surveyModel.findByPk(id, { include: [questionsInclude()] });

    if (!survey) {
      throw new NotFoundException('ไม่พบแบบประเมินนี้');
    }

    return survey;
  }

  private async findAssignmentOrFail(id: number): Promise<SurveyAssignment> {
    const assignment = await this.assignmentModel.findByPk(id, {
      include: assignmentDetailIncludes(),
    });

    if (!assignment) {
      throw new NotFoundException('ไม่พบการส่งแบบประเมินครั้งนี้');
    }

    return assignment;
  }

  private async assertCustomerExists(customerId: number): Promise<void> {
    const customer = await this.customerModel.findByPk(customerId, { attributes: ['id'] });

    if (!customer) {
      throw new NotFoundException('ไม่พบข้อมูลลูกค้า');
    }
  }

  private async assertContactBelongsToCustomer(
    contactId: number,
    customerId: number,
  ): Promise<void> {
    const contact = await this.contactModel.findByPk(contactId, {
      attributes: ['id', 'customerId'],
    });

    if (!contact) {
      throw new BadRequestException('ไม่พบผู้ติดต่อที่ระบุ');
    }

    if (contact.customerId !== customerId) {
      throw new BadRequestException('ผู้ติดต่อที่ระบุไม่ได้อยู่ภายใต้ลูกค้ารายนี้');
    }
  }

  private async assertProjectBelongsToCustomer(
    projectId: number,
    customerId: number,
  ): Promise<void> {
    const project = await this.projectModel.findByPk(projectId, {
      attributes: ['id', 'customerId'],
    });

    if (!project) {
      throw new BadRequestException('ไม่พบโครงการที่ระบุ');
    }

    if (project.customerId !== customerId) {
      throw new BadRequestException('โครงการที่ระบุไม่ได้เป็นของลูกค้ารายนี้');
    }
  }
}
