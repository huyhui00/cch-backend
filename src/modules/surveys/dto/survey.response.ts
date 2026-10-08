import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import {
  Survey,
  SurveyAnswer,
  SurveyAssignment,
  SurveyAssignmentStatus,
  SurveyQuestion,
  SurveyQuestionType,
  SurveyResponse,
  SurveyStatus,
} from '../../../models';

export class SurveyQuestionResponseDto {
  @ApiProperty({ example: 7 })
  id: number;

  @ApiProperty({ example: 'ความพึงพอใจต่อความรวดเร็วในการแก้ปัญหา' })
  questionText: string;

  @ApiProperty({ enum: SurveyQuestionType })
  questionType: SurveyQuestionType;

  @ApiProperty({ example: true })
  isRequired: boolean;

  @ApiProperty({
    nullable: true,
    type: [String],
    description: 'มีค่าเฉพาะ CHOICE และ MULTI_CHOICE',
    example: ['ดีมาก', 'ดี', 'พอใช้'],
  })
  options: string[] | null;

  @ApiProperty({ nullable: true, description: 'มีค่าเฉพาะ RATING', example: 1 })
  minValue: number | null;

  @ApiProperty({ nullable: true, example: 5 })
  maxValue: number | null;

  @ApiProperty({ example: 0 })
  sortOrder: number;
}

export class SurveyResponseDto {
  @ApiProperty({ example: 3 })
  id: number;

  @ApiProperty({ example: 'แบบประเมินความพึงพอใจหลังส่งมอบโครงการ' })
  title: string;

  @ApiProperty({ nullable: true })
  description: string | null;

  @ApiProperty({ enum: SurveyStatus })
  status: SurveyStatus;

  @ApiProperty({
    description:
      'ส่งให้ลูกค้าได้จริงตอนนี้ไหม — ต้อง ACTIVE **และ** อยู่ในช่วงวันที่ใช้งาน ' +
      'ยังไม่มี scheduler ปิดให้อัตโนมัติจนกว่าจะถึง Phase 11 หน้าจอจึงต้องอ่านค่านี้ ' +
      'ไม่ใช่ดู status อย่างเดียว',
    example: true,
  })
  isCurrentlyUsable: boolean;

  @ApiProperty({ nullable: true, example: '2026-10-01' })
  validFrom: string | null;

  @ApiProperty({ nullable: true, example: '2026-12-31' })
  validTo: string | null;

  @ApiProperty({ type: [SurveyQuestionResponseDto] })
  questions: SurveyQuestionResponseDto[];

  @ApiProperty({ description: 'จำนวนครั้งที่ส่งให้ลูกค้า', example: 12 })
  assignmentCount: number;

  @ApiProperty({ description: 'จำนวนที่ได้คำตอบกลับมาแล้ว', example: 8 })
  responseCount: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class AssignmentResponseDto {
  @ApiProperty({ example: 15 })
  id: number;

  @ApiProperty({ example: 3 })
  surveyId: number;

  @ApiProperty({ example: 1 })
  customerId: number;

  @ApiProperty({ nullable: true, example: 'บริษัท ตัวอย่าง จำกัด' })
  customerName: string | null;

  @ApiProperty({ nullable: true, example: 2 })
  contactId: number | null;

  @ApiProperty({ nullable: true, example: 'คุณสมหญิง' })
  contactName: string | null;

  @ApiProperty({ nullable: true, example: 3 })
  projectId: number | null;

  @ApiProperty({ nullable: true, example: 'ระบบจัดการคลังสินค้า' })
  projectName: string | null;

  @ApiProperty({
    enum: SurveyAssignmentStatus,
    description: 'SENT ตอนบันทึกว่าส่งแล้ว → ANSWERED เมื่อบันทึกคำตอบกลับมา',
  })
  status: SurveyAssignmentStatus;

  @ApiProperty({ nullable: true, description: 'เวลาที่ส่งให้ลูกค้าจริง' })
  sentAt: Date | null;

  @ApiProperty({ nullable: true })
  answeredAt: Date | null;

  @ApiProperty({
    nullable: true,
    description: 'พนักงานที่บันทึกคำตอบแทนลูกค้า (Q1) — ลูกค้าไม่มีบัญชีผู้ใช้ (BR-01)',
    example: 4,
  })
  filledByUserId: number | null;

  @ApiProperty({ nullable: true, example: 'สมชาย ใจดี' })
  filledByName: string | null;

  @ApiProperty({ nullable: true, description: 'id ของคำตอบ ถ้าบันทึกแล้ว', example: 9 })
  responseId: number | null;

  @ApiProperty()
  createdAt: Date;
}

export class AnswerResponseDto {
  @ApiProperty({ example: 21 })
  id: number;

  @ApiProperty({ example: 7 })
  questionId: number;

  @ApiProperty({ nullable: true, example: 'ความพึงพอใจต่อความรวดเร็ว' })
  questionText: string | null;

  @ApiProperty({ nullable: true, enum: SurveyQuestionType })
  questionType: SurveyQuestionType | null;

  @ApiProperty({ nullable: true, description: 'คำตอบของ TEXT และ CHOICE' })
  answerText: string | null;

  @ApiProperty({ nullable: true, description: 'คำตอบของ RATING', example: 4 })
  answerNumber: number | null;

  @ApiProperty({ nullable: true, type: [String], description: 'คำตอบของ MULTI_CHOICE' })
  answerChoices: string[] | null;
}

export class ResponseDetailDto {
  @ApiProperty({ example: 9 })
  id: number;

  @ApiProperty({ example: 15 })
  assignmentId: number;

  @ApiProperty({ example: 3 })
  surveyId: number;

  @ApiProperty({ example: 1 })
  customerId: number;

  @ApiProperty({ nullable: true, example: 'บริษัท ตัวอย่าง จำกัด' })
  customerName: string | null;

  @ApiProperty({ description: 'เวลาที่ลูกค้าตอบจริง ไม่ใช่เวลาที่พนักงานคีย์เข้าระบบ' })
  submittedAt: Date;

  @ApiProperty({
    nullable: true,
    description: 'คะแนนเฉลี่ยของคำถามแบบ RATING — ระบบคำนวณให้ ไม่ได้รับจาก client',
    example: 4.33,
  })
  overallScore: number | null;

  @ApiProperty({ nullable: true })
  comment: string | null;

  @ApiProperty({ type: [AnswerResponseDto] })
  answers: AnswerResponseDto[];

  @ApiProperty()
  createdAt: Date;
}

export class QuestionSummaryDto {
  @ApiProperty({ example: 7 })
  questionId: number;

  @ApiProperty({ example: 'ความพึงพอใจต่อความรวดเร็วในการแก้ปัญหา' })
  questionText: string;

  @ApiProperty({ enum: SurveyQuestionType })
  questionType: SurveyQuestionType;

  @ApiProperty({ description: 'จำนวนคนที่ตอบข้อนี้', example: 8 })
  answeredCount: number;

  @ApiPropertyOptional({
    nullable: true,
    description: 'คะแนนเฉลี่ยของข้อนี้ — มีเฉพาะคำถามแบบ RATING',
    example: 4.25,
  })
  averageScore?: number | null;

  @ApiPropertyOptional({
    description:
      'จำนวนคนที่เลือกแต่ละตัวเลือก — มีเฉพาะ CHOICE และ MULTI_CHOICE ' +
      'ตัวเลือกที่ไม่มีใครเลือกก็คืนมาด้วยพร้อมเลข 0',
    example: { ดีมาก: 5, ดี: 2, พอใช้: 1 },
  })
  choiceCounts?: Record<string, number>;

  @ApiPropertyOptional({
    type: [String],
    description: 'คำตอบทั้งหมด — มีเฉพาะคำถามแบบ TEXT เพราะสรุปเป็นตัวเลขไม่ได้',
  })
  textAnswers?: string[];
}

export class SurveySummaryDto {
  @ApiProperty({ example: 3 })
  surveyId: number;

  @ApiProperty({ example: 'แบบประเมินความพึงพอใจหลังส่งมอบโครงการ' })
  title: string;

  @ApiProperty({ description: 'ส่งให้ลูกค้าไปแล้วกี่ครั้ง', example: 12 })
  assignmentCount: number;

  @ApiProperty({ description: 'ได้คำตอบกลับมากี่ชุด', example: 8 })
  responseCount: number;

  @ApiProperty({
    description: 'อัตราการตอบกลับเป็นเปอร์เซ็นต์ ทศนิยม 2 ตำแหน่ง',
    example: 66.67,
  })
  responseRate: number;

  @ApiProperty({
    nullable: true,
    description: 'คะแนนเฉลี่ยรวมทุกคำตอบ — null เมื่อยังไม่มีคำถามแบบ RATING ที่ถูกตอบ',
    example: 4.31,
  })
  averageScore: number | null;

  @ApiProperty({ type: [QuestionSummaryDto] })
  questions: QuestionSummaryDto[];
}

export class ScoreGroupDto {
  @ApiProperty({ description: 'จำนวนคำตอบในกลุ่มนี้', example: 4 })
  responseCount: number;

  @ApiProperty({
    description: 'จำนวนคำตอบที่มีคะแนนรวม — คำตอบที่ไม่มีคำถามแบบให้คะแนนเลยไม่ถูกนับ',
    example: 3,
  })
  scoredCount: number;

  @ApiProperty({
    nullable: true,
    description:
      'ค่าเฉลี่ยของคะแนนรวม (overallScore) ทศนิยม 2 ตำแหน่ง — null เมื่อไม่มีคำตอบที่มีคะแนน ' +
      'ไม่ใช่ 0 เพราะ 0 แปลว่าลูกค้าให้คะแนนต่ำสุด',
    example: 4.33,
  })
  averageScore: number | null;
}

export class CustomerScoreDto extends ScoreGroupDto {
  @ApiProperty({ example: 1 })
  customerId: number;

  @ApiProperty({ nullable: true, example: 'บริษัท ตัวอย่าง จำกัด' })
  customerName: string | null;

  @ApiProperty({ description: 'ลูกค้ารายนี้ตอบล่าสุดเมื่อไร' })
  lastSubmittedAt: Date;
}

export class MonthScoreDto extends ScoreGroupDto {
  @ApiProperty({ description: 'เดือนที่ลูกค้าตอบ (YYYY-MM)', example: '2026-09' })
  month: string;
}

/**
 * M8-06 สรุปคะแนนความพึงพอใจของแบบประเมินหนึ่งฉบับ แยกตามลูกค้าและตามเดือน
 *
 * ผูกกับแบบประเมินฉบับเดียวโดยเจตนา เพราะแต่ละฉบับตั้งช่วงคะแนนเองได้ (1–5 หรือ 1–10)
 * ถ้าเอาหลายฉบับมาเฉลี่ยรวมกัน ตัวเลขจะไม่มีความหมาย
 */
export class SurveyScoreBreakdownDto {
  @ApiProperty({ example: 3 })
  surveyId: number;

  @ApiProperty({ example: 'แบบประเมินความพึงพอใจหลังส่งมอบโครงการ' })
  title: string;

  @ApiProperty({ nullable: true, example: '2026-01-01' })
  dateFrom: string | null;

  @ApiProperty({ nullable: true, example: '2026-12-31' })
  dateTo: string | null;

  @ApiProperty({ type: ScoreGroupDto, description: 'รวมทุกคำตอบในช่วงเวลาที่เลือก' })
  overall: ScoreGroupDto;

  @ApiProperty({ type: [CustomerScoreDto], description: 'แยกรายลูกค้า เรียงตามชื่อลูกค้า' })
  byCustomer: CustomerScoreDto[];

  @ApiProperty({
    type: [MonthScoreDto],
    description:
      'แยกรายเดือนเรียงจากเก่าไปใหม่ — เดือนที่ไม่มีคำตอบคืนมาด้วยพร้อม 0 ' +
      'กราฟจะได้ไม่ข้ามเดือนจนดูเหมือนคะแนนต่อเนื่อง',
  })
  byMonth: MonthScoreDto[];
}

export function toOptionList(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) {
    return null;
  }

  return raw.filter((item): item is string => typeof item === 'string');
}

export function toSurveyQuestionResponse(question: SurveyQuestion): SurveyQuestionResponseDto {
  return {
    id: question.id,
    questionText: question.questionText,
    questionType: question.questionType,
    isRequired: question.isRequired,
    options: toOptionList(question.options),
    minValue: question.minValue,
    maxValue: question.maxValue,
    sortOrder: question.sortOrder,
  };
}

export function isSurveyCurrentlyUsable(survey: Survey, today: string): boolean {
  if (survey.status !== SurveyStatus.ACTIVE) {
    return false;
  }

  if (survey.validFrom !== null && today < survey.validFrom) {
    return false;
  }

  return survey.validTo === null || today <= survey.validTo;
}

export function toSurveyResponse(
  survey: Survey,
  today: string,
  counts: { assignmentCount: number; responseCount: number },
): SurveyResponseDto {
  return {
    id: survey.id,
    title: survey.title,
    description: survey.description,
    status: survey.status,
    isCurrentlyUsable: isSurveyCurrentlyUsable(survey, today),
    validFrom: survey.validFrom,
    validTo: survey.validTo,
    questions: (survey.questions ?? []).map(toSurveyQuestionResponse),
    assignmentCount: counts.assignmentCount,
    responseCount: counts.responseCount,
    createdAt: survey.createdAt,
    updatedAt: survey.updatedAt,
  };
}

export function toAssignmentResponse(
  assignment: SurveyAssignment,
  responseId: number | null,
): AssignmentResponseDto {
  return {
    id: assignment.id,
    surveyId: assignment.surveyId,
    customerId: assignment.customerId,
    customerName: assignment.customer ? assignment.customer.name : null,
    contactId: assignment.contactId,
    contactName: assignment.contact ? assignment.contact.name : null,
    projectId: assignment.projectId,
    projectName: assignment.project ? assignment.project.name : null,
    status: assignment.status,
    sentAt: assignment.sentAt,
    answeredAt: assignment.answeredAt,
    filledByUserId: assignment.filledByUserId,
    filledByName: assignment.filledBy ? assignment.filledBy.fullName : null,
    responseId,
    createdAt: assignment.createdAt,
  };
}

function toNumberOrNull(value: string | null): number | null {
  return value === null ? null : Number(value);
}

export function toAnswerResponse(answer: SurveyAnswer): AnswerResponseDto {
  return {
    id: answer.id,
    questionId: answer.questionId,
    questionText: answer.question ? answer.question.questionText : null,
    questionType: answer.question ? answer.question.questionType : null,
    answerText: answer.answerText,
    answerNumber: toNumberOrNull(answer.answerNumber),
    answerChoices: toOptionList(answer.answerJson),
  };
}

export function toResponseDetail(response: SurveyResponse): ResponseDetailDto {
  return {
    id: response.id,
    assignmentId: response.assignmentId,
    surveyId: response.surveyId,
    customerId: response.customerId,
    customerName: response.customer ? response.customer.name : null,
    submittedAt: response.submittedAt,
    overallScore: toNumberOrNull(response.overallScore),
    comment: response.comment,
    answers: (response.answers ?? []).map(toAnswerResponse),
    createdAt: response.createdAt,
  };
}
