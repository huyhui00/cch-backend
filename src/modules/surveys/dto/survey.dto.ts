import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { PaginationDto } from '../../../common/dto/pagination.dto';
import { SurveyQuestionType, SurveyStatus } from '../../../models';

const trimToNull = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** คะแนนสูงสุดที่เกินนี้ไม่มีใครใช้จริง และทำให้หน้าจอวาดปุ่มไม่ไหว */
const MAX_RATING_SCALE = 10;

export class SurveyQuestionDto {
  @ApiProperty({ description: 'ข้อความคำถาม', example: 'ความพึงพอใจต่อความรวดเร็วในการแก้ปัญหา' })
  @IsString({ message: 'ข้อความคำถามต้องเป็นข้อความ' })
  @MaxLength(1000, { message: 'ข้อความคำถามยาวเกิน 1000 ตัวอักษร' })
  @Transform(trim)
  questionText: string;

  @ApiProperty({
    enum: SurveyQuestionType,
    description:
      'RATING = ให้คะแนนตามช่วง / CHOICE = เลือกได้ข้อเดียว / ' +
      'MULTI_CHOICE = เลือกได้หลายข้อ / TEXT = พิมพ์ตอบอิสระ',
  })
  @IsEnum(SurveyQuestionType, {
    message: 'ชนิดคำถามต้องเป็น RATING, CHOICE, MULTI_CHOICE หรือ TEXT',
  })
  questionType: SurveyQuestionType;

  @ApiPropertyOptional({
    description: 'บังคับตอบหรือไม่ — คำถามที่บังคับต้องมีคำตอบตอนบันทึกผล',
    default: true,
  })
  @IsOptional()
  @IsBoolean({ message: 'isRequired ต้องเป็น true หรือ false' })
  isRequired?: boolean;

  @ApiPropertyOptional({
    description: 'ตัวเลือก — บังคับสำหรับ CHOICE และ MULTI_CHOICE ห้ามใส่กับชนิดอื่น',
    type: [String],
    example: ['ดีมาก', 'ดี', 'พอใช้', 'ควรปรับปรุง'],
  })
  @IsOptional()
  @IsArray({ message: 'ตัวเลือกต้องเป็นอาเรย์' })
  @ArrayMaxSize(20, { message: 'ตัวเลือกต้องไม่เกิน 20 ข้อ' })
  @IsString({ each: true, message: 'ตัวเลือกแต่ละข้อต้องเป็นข้อความ' })
  options?: string[];

  @ApiPropertyOptional({
    description: 'คะแนนต่ำสุดของ RATING — ไม่ระบุใช้ 1',
    minimum: 0,
    maximum: MAX_RATING_SCALE,
    example: 1,
  })
  @IsOptional()
  @IsInt({ message: 'minValue ต้องเป็นจำนวนเต็ม' })
  @Min(0, { message: 'minValue ต้องไม่ติดลบ' })
  @Max(MAX_RATING_SCALE, { message: `minValue ต้องไม่เกิน ${MAX_RATING_SCALE}` })
  minValue?: number | null;

  @ApiPropertyOptional({
    description: 'คะแนนสูงสุดของ RATING — ไม่ระบุใช้ 5',
    minimum: 1,
    maximum: MAX_RATING_SCALE,
    example: 5,
  })
  @IsOptional()
  @IsInt({ message: 'maxValue ต้องเป็นจำนวนเต็ม' })
  @Min(1, { message: 'maxValue ต้องมีค่าตั้งแต่ 1 ขึ้นไป' })
  @Max(MAX_RATING_SCALE, { message: `maxValue ต้องไม่เกิน ${MAX_RATING_SCALE}` })
  maxValue?: number | null;
}

/**
 * แบบประเมิน (M8)
 *
 * Q1 ตอบแล้ว 10 ก.ย. 2026 — **พนักงานเป็นคนบันทึกคำตอบแทนลูกค้า**
 * ระบบทำฟอร์มคำถาม → ส่งให้ลูกค้ารีวิวนอกระบบ (LINE/อีเมล/กระดาษ) → พนักงานคีย์กลับเข้ามา
 * จึง **ไม่มี endpoint สาธารณะและไม่มีลิงก์ token ในเฟสนี้** ลูกค้ายังไม่มีบัญชี (BR-01)
 */
export class CreateSurveyDto {
  @ApiProperty({
    description: 'ชื่อแบบประเมิน',
    maxLength: 255,
    example: 'แบบประเมินความพึงพอใจหลังส่งมอบโครงการ',
  })
  @IsString({ message: 'ชื่อแบบประเมินต้องเป็นข้อความ' })
  @MaxLength(255, { message: 'ชื่อแบบประเมินยาวเกิน 255 ตัวอักษร' })
  @Transform(trim)
  title: string;

  @ApiPropertyOptional({ description: 'คำอธิบายแบบประเมิน' })
  @IsOptional()
  @IsString({ message: 'คำอธิบายต้องเป็นข้อความ' })
  @Transform(trimToNull)
  description?: string | null;

  @ApiPropertyOptional({ description: 'เริ่มใช้ตั้งแต่วันที่ (YYYY-MM-DD)', example: '2026-10-01' })
  @IsOptional()
  @Matches(DATE_ONLY_PATTERN, { message: 'validFrom ต้องอยู่ในรูปแบบ YYYY-MM-DD' })
  @Transform(trimToNull)
  validFrom?: string | null;

  @ApiPropertyOptional({ description: 'ใช้ได้ถึงวันที่ (YYYY-MM-DD)', example: '2026-12-31' })
  @IsOptional()
  @Matches(DATE_ONLY_PATTERN, { message: 'validTo ต้องอยู่ในรูปแบบ YYYY-MM-DD' })
  @Transform(trimToNull)
  validTo?: string | null;

  @ApiPropertyOptional({
    description:
      'คำถามในแบบประเมิน เรียงตามลำดับที่ส่งมา — ส่งมาพร้อมตอนสร้างได้เลย ' +
      'แบบประเมินที่ไม่มีคำถามจะเปลี่ยนเป็น ACTIVE ไม่ได้',
    type: [SurveyQuestionDto],
  })
  @IsOptional()
  @IsArray({ message: 'คำถามต้องเป็นอาเรย์' })
  @ArrayMaxSize(50, { message: 'คำถามต้องไม่เกิน 50 ข้อ' })
  @ValidateNested({ each: true })
  @Type(() => SurveyQuestionDto)
  questions?: SurveyQuestionDto[];
}

/**
 * แก้ไขแบบประเมิน
 *
 * ส่ง `questions` มา = แทนที่ทั้งชุด (เหมือน `items` ของแผน MA)
 * **แต่ทำได้เฉพาะตอนยังเป็น DRAFT** เพราะคำตอบที่เก็บมาอ้างถึง `question_id`
 * ถ้าเปลี่ยนคำถามหลังเริ่มเก็บคำตอบแล้ว คำตอบเก่าจะกลายเป็นคำตอบของคำถามที่ไม่เคยถูกถาม
 *
 * `status` ไม่ได้อยู่ที่นี่ — เปลี่ยนผ่าน `PATCH /:id/status` ซึ่งตรวจเงื่อนไขก่อน
 */
export class UpdateSurveyDto {
  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString({ message: 'ชื่อแบบประเมินต้องเป็นข้อความ' })
  @MaxLength(255, { message: 'ชื่อแบบประเมินยาวเกิน 255 ตัวอักษร' })
  @Transform(trim)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'คำอธิบายต้องเป็นข้อความ' })
  @Transform(trimToNull)
  description?: string | null;

  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @Matches(DATE_ONLY_PATTERN, { message: 'validFrom ต้องอยู่ในรูปแบบ YYYY-MM-DD' })
  @Transform(trimToNull)
  validFrom?: string | null;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @Matches(DATE_ONLY_PATTERN, { message: 'validTo ต้องอยู่ในรูปแบบ YYYY-MM-DD' })
  @Transform(trimToNull)
  validTo?: string | null;

  @ApiPropertyOptional({
    description: 'แทนที่คำถามทั้งชุด — ทำได้เฉพาะตอนสถานะยังเป็น DRAFT',
    type: [SurveyQuestionDto],
  })
  @IsOptional()
  @IsArray({ message: 'คำถามต้องเป็นอาเรย์' })
  @ArrayMaxSize(50, { message: 'คำถามต้องไม่เกิน 50 ข้อ' })
  @ValidateNested({ each: true })
  @Type(() => SurveyQuestionDto)
  questions?: SurveyQuestionDto[];
}

export class UpdateSurveyStatusDto {
  @ApiProperty({
    enum: SurveyStatus,
    description:
      'DRAFT → ACTIVE ต้องมีคำถามอย่างน้อย 1 ข้อ / ACTIVE → CLOSED ปิดรับคำตอบ / ' +
      'CLOSED → ACTIVE เปิดรับใหม่ได้ / กลับไป DRAFT ได้เฉพาะที่ยังไม่มีคำตอบเลย',
  })
  @IsEnum(SurveyStatus, { message: 'สถานะแบบประเมินต้องเป็น DRAFT, ACTIVE หรือ CLOSED' })
  status: SurveyStatus;
}

export class QuerySurveysDto extends PaginationDto {
  @ApiPropertyOptional({ enum: SurveyStatus, description: 'กรองตามสถานะ' })
  @IsOptional()
  @IsEnum(SurveyStatus, { message: 'สถานะแบบประเมินต้องเป็น DRAFT, ACTIVE หรือ CLOSED' })
  status?: SurveyStatus;
}

/**
 * ส่งแบบประเมินให้ลูกค้า — บันทึกว่า "ส่งไปแล้ว" ไม่ได้ส่งจริงจากระบบ
 *
 * BR-11 ระบบไม่ยิงหาลูกค้า การส่งจริงเกิดนอกระบบ (LINE/อีเมล/พิมพ์กระดาษ)
 * แถวนี้คือหลักฐานว่าส่งให้ใคร เมื่อไหร่ และเป็นที่ผูกคำตอบกลับมา
 */
export class CreateAssignmentDto {
  @ApiProperty({ description: 'ลูกค้าที่ส่งแบบประเมินให้', example: 1 })
  @IsInt({ message: 'customerId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'customerId ต้องมากกว่า 0' })
  customerId: number;

  @ApiPropertyOptional({
    description: 'ผู้ติดต่อฝั่งลูกค้าที่เป็นคนตอบ ต้องอยู่ภายใต้ลูกค้ารายนี้',
    example: 2,
  })
  @IsOptional()
  @IsInt({ message: 'contactId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'contactId ต้องมากกว่า 0' })
  contactId?: number | null;

  @ApiPropertyOptional({
    description: 'โครงการที่ประเมินถึง ต้องเป็นโครงการของลูกค้ารายนี้',
    example: 3,
  })
  @IsOptional()
  @IsInt({ message: 'projectId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'projectId ต้องมากกว่า 0' })
  projectId?: number | null;

  @ApiPropertyOptional({
    description: 'เวลาที่ส่งให้ลูกค้าจริง — ไม่ระบุ = เวลาที่กดบันทึก บันทึกล่วงหน้าไม่ได้',
    example: '2026-10-05T03:00:00.000Z',
  })
  @IsOptional()
  @IsISO8601({ strict: false }, { message: 'sentAt ต้องเป็นวันที่เวลาตามรูปแบบ ISO 8601' })
  sentAt?: string;
}

export class SurveyAnswerDto {
  @ApiProperty({ description: 'id ของคำถามที่ตอบ', example: 7 })
  @IsInt({ message: 'questionId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'questionId ต้องมากกว่า 0' })
  questionId: number;

  @ApiPropertyOptional({
    description: 'คำตอบของ TEXT และ CHOICE — CHOICE ต้องเป็นค่าที่อยู่ในตัวเลือกของคำถาม',
    example: 'ดีมาก',
  })
  @IsOptional()
  @IsString({ message: 'คำตอบต้องเป็นข้อความ' })
  @Transform(trimToNull)
  answerText?: string | null;

  @ApiPropertyOptional({ description: 'คำตอบของ RATING — ต้องอยู่ในช่วงของคำถาม', example: 4 })
  @IsOptional()
  @IsNumber({}, { message: 'คะแนนต้องเป็นตัวเลข' })
  answerNumber?: number | null;

  @ApiPropertyOptional({
    description: 'คำตอบของ MULTI_CHOICE — ทุกค่าต้องอยู่ในตัวเลือกของคำถาม',
    type: [String],
    example: ['ดีมาก', 'ตอบเร็ว'],
  })
  @IsOptional()
  @IsArray({ message: 'คำตอบแบบเลือกหลายข้อต้องเป็นอาเรย์' })
  @ArrayMaxSize(20, { message: 'เลือกได้ไม่เกิน 20 ข้อ' })
  @IsString({ each: true, message: 'คำตอบแต่ละข้อต้องเป็นข้อความ' })
  answerChoices?: string[];
}

/**
 * บันทึกคำตอบแทนลูกค้า (Q1)
 *
 * `overallScore` ไม่ได้รับจาก client — ระบบเฉลี่ยจากคำถามแบบ RATING ให้เอง
 * ถ้าให้กรอกเอง ตัวเลขในรายงานจะไม่ตรงกับคำตอบที่บันทึกไว้จริง
 */
export class CreateResponseDto {
  @ApiProperty({ description: 'คำตอบรายข้อ', type: [SurveyAnswerDto] })
  @IsArray({ message: 'คำตอบต้องเป็นอาเรย์' })
  @ArrayMinSize(1, { message: 'ต้องมีคำตอบอย่างน้อย 1 ข้อ' })
  @ArrayMaxSize(50, { message: 'คำตอบต้องไม่เกิน 50 ข้อ' })
  @ValidateNested({ each: true })
  @Type(() => SurveyAnswerDto)
  answers: SurveyAnswerDto[];

  @ApiPropertyOptional({
    description: 'ความเห็นเพิ่มเติมของลูกค้าที่ไม่เข้าคำถามข้อไหน',
    example: 'อยากให้ตอบไลน์เร็วกว่านี้ช่วงเย็น',
  })
  @IsOptional()
  @IsString({ message: 'ความเห็นต้องเป็นข้อความ' })
  @Transform(trimToNull)
  comment?: string | null;

  @ApiPropertyOptional({
    description:
      'เวลาที่ลูกค้าตอบจริง ไม่ใช่เวลาที่พนักงานคีย์เข้าระบบ — บันทึกย้อนหลังได้ ' +
      'แต่บันทึกล่วงหน้าไม่ได้ (BR-02)',
    example: '2026-10-08T07:30:00.000Z',
  })
  @IsOptional()
  @IsISO8601({ strict: false }, { message: 'submittedAt ต้องเป็นวันที่เวลาตามรูปแบบ ISO 8601' })
  submittedAt?: string;
}

export class QueryAssignmentsDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'กรองตามลูกค้า', example: 1 })
  @IsOptional()
  @IsInt({ message: 'customerId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'customerId ต้องมากกว่า 0' })
  customerId?: number;
}

/** M8-06 ช่วงเวลาของสรุปคะแนน — กรองด้วยวันที่ลูกค้าตอบ (submitted_at) ไม่ใช่วันที่คีย์เข้าระบบ */
export class QueryScoreBreakdownDto {
  @ApiPropertyOptional({ description: 'นับตั้งแต่วันที่ (YYYY-MM-DD)', example: '2026-01-01' })
  @IsOptional()
  @Matches(DATE_ONLY_PATTERN, { message: 'dateFrom ต้องอยู่ในรูปแบบ YYYY-MM-DD' })
  dateFrom?: string;

  @ApiPropertyOptional({
    description: 'นับถึงวันที่ (YYYY-MM-DD) รวมวันนั้นด้วย',
    example: '2026-12-31',
  })
  @IsOptional()
  @Matches(DATE_ONLY_PATTERN, { message: 'dateTo ต้องอยู่ในรูปแบบ YYYY-MM-DD' })
  dateTo?: string;
}
