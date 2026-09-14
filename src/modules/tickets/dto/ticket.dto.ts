import { ApiHideProperty, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

import { PaginationDto } from '../../../common/dto/pagination.dto';
import {
  TicketBillingType,
  TicketPriority,
  TicketReportedChannel,
  TicketStatus,
} from '../../../models';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

const trimToNull = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/**
 * เปิดใบแจ้งปัญหา
 *
 * BR-01 — ลูกค้าไม่มีบัญชีผู้ใช้ พนักงานเป็นคนเปิดใบเสมอ ไม่มีทางที่ลูกค้ายิงเข้ามาเอง
 * BR-02 — ลูกค้าแจ้งมาทาง LINE/โทร แล้วพนักงานมาบันทึกย้อนหลัง จึงต้องระบุ
 *         `reportedChannel` และ `reportedAt` ที่เป็นเวลาที่ลูกค้าแจ้งจริง
 */
export class CreateTicketDto {
  /** รับไว้เพื่อให้โค้ดเก่าคอมไพล์ได้ แต่ ValidationPipe จะปฏิเสธฟิลด์นี้ */
  @ApiHideProperty()
  ticketNo?: unknown;

  @ApiProperty({ description: 'ลูกค้าที่แจ้งปัญหา', example: 1 })
  @IsInt({ message: 'customerId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'customerId ต้องมากกว่า 0' })
  customerId: number;

  @ApiProperty({
    description: 'หัวข้อปัญหา',
    maxLength: 255,
    example: 'หน้าจอรายงานสรุปยอดขายโหลดไม่ขึ้น',
  })
  @IsString({ message: 'หัวข้อปัญหาต้องเป็นข้อความ' })
  @IsNotEmpty({ message: 'กรุณากรอกหัวข้อปัญหา' })
  @MaxLength(255, { message: 'หัวข้อปัญหายาวเกิน 255 ตัวอักษร' })
  @Transform(trim)
  title: string;

  @ApiProperty({
    enum: TicketReportedChannel,
    description: 'ลูกค้าแจ้งมาทางไหน (BR-02)',
    example: TicketReportedChannel.LINE,
  })
  @IsEnum(TicketReportedChannel, {
    message: 'ช่องทางที่แจ้งต้องเป็น LINE, PHONE, EMAIL, FACEBOOK หรือ OTHER',
  })
  reportedChannel: TicketReportedChannel;

  @ApiProperty({
    description: 'เวลาที่ลูกค้าแจ้งจริง ไม่ใช่เวลาที่กดบันทึก บันทึกล่วงหน้าไม่ได้ (BR-02)',
    example: '2026-09-09T02:15:00.000Z',
  })
  @IsISO8601({ strict: false }, { message: 'reportedAt ต้องเป็นวันที่เวลาตามรูปแบบ ISO 8601' })
  reportedAt: string;

  @ApiPropertyOptional({
    description:
      'โครงการที่เกิดปัญหา ต้องเป็นโครงการของลูกค้ารายนี้ — ' +
      'จำเป็นถ้าต้องการให้ระบบเสนอ billingType จากประกันหรือสัญญา MA',
    example: 1,
  })
  @IsOptional()
  @IsInt({ message: 'projectId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'projectId ต้องมากกว่า 0' })
  projectId?: number | null;

  @ApiPropertyOptional({
    enum: TicketBillingType,
    description:
      'ไม่ส่งมา = ให้ระบบเลือกให้จากประกันและสัญญา MA ที่ยังคุ้มครองอยู่ ' +
      'ส่งมา = ใช้ค่าที่ส่งเสมอ ระบบไม่เถียง เพราะประกันครอบคลุมเฉพาะ bug ในขอบเขตเดิม ' +
      'งานที่ขอเพิ่มใหม่ต้องคิดเงินแม้อยู่ในระยะประกัน (BR-07) ซึ่งเป็นดุลพินิจของคน',
    example: TicketBillingType.WARRANTY,
  })
  @IsOptional()
  @IsEnum(TicketBillingType, {
    message: 'ประเภทการคิดเงินต้องเป็น WARRANTY, MA_QUOTA, ADDON, ONE_TIME หรือ FREE',
  })
  billingType?: TicketBillingType;

  @ApiPropertyOptional({ description: 'รายละเอียดปัญหา' })
  @IsOptional()
  @IsString({ message: 'รายละเอียดต้องเป็นข้อความ' })
  @Transform(trimToNull)
  description?: string | null;

  @ApiPropertyOptional({ enum: TicketPriority, default: TicketPriority.NORMAL })
  @IsOptional()
  @IsEnum(TicketPriority, { message: 'ความสำคัญต้องเป็น LOW, NORMAL, HIGH หรือ URGENT' })
  priority?: TicketPriority;

  @ApiPropertyOptional({
    description: 'ผู้ติดต่อฝั่งลูกค้าที่เป็นคนแจ้ง ต้องอยู่ภายใต้ลูกค้ารายนี้',
    example: 2,
  })
  @IsOptional()
  @IsInt({ message: 'reportedByContactId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'reportedByContactId ต้องมากกว่า 0' })
  reportedByContactId?: number | null;

  @ApiPropertyOptional({
    description:
      'พนักงานที่รับเรื่องไว้ — แยกจากผู้รับผิดชอบแก้ไข ไม่ส่งมาถือว่าคนบันทึกเป็นคนรับเรื่อง',
    example: 3,
  })
  @IsOptional()
  @IsInt({ message: 'receivedByUserId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'receivedByUserId ต้องมากกว่า 0' })
  receivedByUserId?: number | null;

  @ApiPropertyOptional({ description: 'พนักงานที่รับผิดชอบแก้ไข มอบหมายทีหลังได้', example: 4 })
  @IsOptional()
  @IsInt({ message: 'assignedUserId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'assignedUserId ต้องมากกว่า 0' })
  assignedUserId?: number | null;

  @ApiPropertyOptional({
    description: 'กำหนดเวลาที่ต้องแก้ให้เสร็จ ใช้กับ notification rule แบบ TICKET_SLA',
    example: '2026-09-12T10:00:00.000Z',
  })
  @IsOptional()
  @IsISO8601({ strict: false }, { message: 'dueAt ต้องเป็นวันที่เวลาตามรูปแบบ ISO 8601' })
  dueAt?: string | null;
}

/** ข้อมูลที่ใช้ตรวจหลักฐาน Warranty/MA ก่อนเปิดใบแจ้งปัญหา */
export class BillingSuggestionQueryDto {
  @ApiProperty({ description: 'โครงการที่เกิดปัญหา', example: 1 })
  @IsInt({ message: 'projectId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'projectId ต้องมากกว่า 0' })
  projectId: number;

  @ApiProperty({
    description: 'วันที่เวลาที่ลูกค้าแจ้งปัญหาจริง ใช้ตรวจช่วง Warranty/MA',
    example: '2026-09-14T09:00:00.000Z',
  })
  @IsISO8601({ strict: false }, { message: 'reportedAt ต้องเป็นวันที่เวลาตามรูปแบบ ISO 8601' })
  reportedAt: string;
}

/**
 * แก้ไขใบแจ้งปัญหา — สำหรับกรณีคีย์ผิดตอนเปิดใบ
 *
 * **ฟิลด์ที่จงใจไม่ให้แก้ที่นี่ และห้ามเพิ่มเข้ามาทีหลัง**
 *
 *   `status`           มีเจ้าของคือ assign / resolutions / reopen / close
 *                      ถ้าแก้ตรง ๆ ได้ จะข้ามกฎ BR-04 ทั้งหมด เช่นตั้งเป็น CLOSED
 *                      โดยไม่เคยมีรอบการแก้ไขเลย
 *   `resolutionCount`  นับจากจำนวนแถวจริงใน ticket_resolutions ไม่ใช่ค่าที่ตั้งเอง
 *   `resolvedAt` / `firstResponseAt` / `closedAt`  ระบบใส่ให้ตามเหตุการณ์จริง
 *   `customerId`       ย้ายลูกค้าไม่ได้ ด้วยเหตุผลเดียวกับโครงการใน Phase 5 —
 *                      ใบที่หักโควตาหรือผูกประกันไปแล้วจะพาประวัติไปโผล่ผิดราย
 *   `warrantyId` / `maContractId`  เป็นหลักฐานว่าตอนเปิดใบระบบเห็นอะไร
 *                      ต้องคงไว้ตามที่บันทึกจริง
 *
 * ส่วน `projectId` แก้ได้ แต่ต้องเป็นโครงการของลูกค้ารายเดิมเท่านั้น
 */
export class UpdateTicketDto {
  @ApiPropertyOptional({ description: 'หัวข้อปัญหา', maxLength: 255 })
  @IsOptional()
  @IsString({ message: 'หัวข้อปัญหาต้องเป็นข้อความ' })
  @MaxLength(255, { message: 'หัวข้อปัญหายาวเกิน 255 ตัวอักษร' })
  @Transform(trim)
  title?: string;

  @ApiPropertyOptional({ description: 'รายละเอียดปัญหา' })
  @IsOptional()
  @IsString({ message: 'รายละเอียดต้องเป็นข้อความ' })
  @Transform(trimToNull)
  description?: string | null;

  @ApiPropertyOptional({ enum: TicketPriority })
  @IsOptional()
  @IsEnum(TicketPriority, { message: 'ระดับความสำคัญไม่ถูกต้อง' })
  priority?: TicketPriority;

  @ApiPropertyOptional({
    description:
      'แก้ประเภทการคิดเงินได้ตลอด เพราะ BR-07 ให้คนเป็นผู้ตัดสิน ไม่ใช่ระบบ — ' +
      'งานที่ตอนแรกคิดว่าเป็น bug ในประกัน พอดูจริงแล้วเป็นของขอเพิ่มใหม่ ต้องแก้เป็น ONE_TIME ได้',
    enum: TicketBillingType,
  })
  @IsOptional()
  @IsEnum(TicketBillingType, {
    message: 'ประเภทการคิดเงินต้องเป็น WARRANTY, MA_QUOTA, ADDON, ONE_TIME หรือ FREE',
  })
  billingType?: TicketBillingType;

  @ApiPropertyOptional({ enum: TicketReportedChannel, description: 'ช่องทางที่ลูกค้าแจ้งมา' })
  @IsOptional()
  @IsEnum(TicketReportedChannel, {
    message: 'ช่องทางที่แจ้งต้องเป็น LINE, PHONE, EMAIL, FACEBOOK หรือ OTHER',
  })
  reportedChannel?: TicketReportedChannel;

  @ApiPropertyOptional({
    description: 'เวลาที่ลูกค้าแจ้งจริง — บันทึกล่วงหน้าไม่ได้เหมือนตอนเปิดใบ (BR-02)',
  })
  @IsOptional()
  @IsISO8601({ strict: false }, { message: 'reportedAt ต้องเป็นวันที่เวลาตามรูปแบบ ISO 8601' })
  reportedAt?: string;

  @ApiPropertyOptional({
    description: 'ย้ายไปโครงการอื่นของลูกค้ารายเดิมได้ ส่ง null เพื่อถอดโครงการออก',
  })
  @IsOptional()
  @IsInt({ message: 'projectId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'projectId ต้องมากกว่า 0' })
  projectId?: number | null;

  @ApiPropertyOptional({ description: 'ผู้ติดต่อฝั่งลูกค้าที่เป็นคนแจ้ง ต้องอยู่ใต้ลูกค้ารายเดิม' })
  @IsOptional()
  @IsInt({ message: 'reportedByContactId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'reportedByContactId ต้องมากกว่า 0' })
  reportedByContactId?: number | null;

  @ApiPropertyOptional({ description: 'พนักงานที่รับเรื่อง (A-3) แยกจากผู้รับผิดชอบแก้ไข' })
  @IsOptional()
  @IsInt({ message: 'receivedByUserId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'receivedByUserId ต้องมากกว่า 0' })
  receivedByUserId?: number | null;

  @ApiPropertyOptional({ description: 'กำหนดเวลาที่ต้องแก้ให้เสร็จ' })
  @IsOptional()
  @IsISO8601({ strict: false }, { message: 'dueAt ต้องเป็นวันที่เวลาตามรูปแบบ ISO 8601' })
  dueAt?: string | null;

  @ApiPropertyOptional({ description: 'เลขที่ใบแจ้งปัญหา ห้ามซ้ำ', maxLength: 50 })
  @IsOptional()
  @IsString({ message: 'เลขที่ใบแจ้งปัญหาต้องเป็นข้อความ' })
  @MaxLength(50, { message: 'เลขที่ใบแจ้งปัญหายาวเกิน 50 ตัวอักษร' })
  @Transform(trimToNull)
  ticketNo?: string | null;
}

/** มอบหมายผู้รับผิดชอบแก้ไข */
export class AssignTicketDto {
  @ApiProperty({
    nullable: true,
    description: 'พนักงานที่รับผิดชอบแก้ไข ส่ง null เพื่อถอนการมอบหมาย',
    example: 4,
  })
  @IsOptional()
  @IsInt({ message: 'assignedUserId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'assignedUserId ต้องมากกว่า 0' })
  assignedUserId: number | null;

  @ApiPropertyOptional({
    description: 'กำหนดเวลาที่ต้องแก้ให้เสร็จ ตั้งพร้อมกับการมอบหมายได้',
    example: '2026-09-12T10:00:00.000Z',
  })
  @IsOptional()
  @IsISO8601({ strict: false }, { message: 'dueAt ต้องเป็นวันที่เวลาตามรูปแบบ ISO 8601' })
  dueAt?: string | null;
}

/**
 * เปิดปัญหาเดิมขึ้นมาใหม่ (BR-04)
 *
 * นี่คือทางเดียวที่จะไปถึงสถานะ REOPENED — และเป็นทางเดียวที่ถูกต้องเมื่อปัญหาเดิมกลับมา
 * ห้ามเปิดใบใหม่เด็ดขาด เพราะประวัติการแก้ทั้งหมดต้องอยู่ในใบเดียวกัน
 */
export class ReopenTicketDto {
  @ApiPropertyOptional({
    description: 'เหตุผลที่ปัญหากลับมา จะถูกต่อท้ายรายละเอียดของใบเดิม',
    example: 'ลูกค้าแจ้งว่าอาการเดิมกลับมาอีกหลังใช้งานได้ 3 วัน',
  })
  @IsOptional()
  @IsString({ message: 'เหตุผลต้องเป็นข้อความ' })
  @Transform(trimToNull)
  reason?: string | null;
}

/** ปิดงาน */
export class CloseTicketDto {
  @ApiPropertyOptional({
    description: 'หมายเหตุตอนปิดงาน จะถูกต่อท้ายรายละเอียดของใบเดิม',
    example: 'ลูกค้ายืนยันว่าใช้งานได้ปกติแล้ว',
  })
  @IsOptional()
  @IsString({ message: 'หมายเหตุต้องเป็นข้อความ' })
  @Transform(trimToNull)
  note?: string | null;

  @ApiPropertyOptional({
    description: 'ค่าใช้จ่ายเพิ่มที่สรุปได้ตอนปิดงาน ส่งเป็นสตริงตัวเลข',
    example: '3500.00',
  })
  @IsOptional()
  @IsNumberString({ no_symbols: false }, { message: 'ค่าใช้จ่ายเพิ่มต้องเป็นตัวเลข' })
  extraCharge?: string | null;
}

/** `search` ที่สืบมาจาก PaginationDto ค้นจากหัวข้อ รายละเอียด และเลขที่ใบ */
export class QueryTicketsDto extends PaginationDto {
  @ApiPropertyOptional({ enum: TicketStatus, description: 'กรองตามสถานะ' })
  @IsOptional()
  @IsEnum(TicketStatus, {
    message: 'สถานะต้องเป็น RECEIVED, IN_PROGRESS, RESOLVED, REOPENED หรือ CLOSED',
  })
  status?: TicketStatus;

  @ApiPropertyOptional({ description: 'กรองเฉพาะปัญหาของลูกค้ารายนี้', example: 1 })
  @IsOptional()
  @IsInt({ message: 'customerId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'customerId ต้องมากกว่า 0' })
  customerId?: number;

  @ApiPropertyOptional({ description: 'กรองเฉพาะปัญหาของโครงการนี้', example: 1 })
  @IsOptional()
  @IsInt({ message: 'projectId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'projectId ต้องมากกว่า 0' })
  projectId?: number;

  @ApiPropertyOptional({ enum: TicketPriority, description: 'กรองตามความสำคัญ' })
  @IsOptional()
  @IsEnum(TicketPriority, { message: 'ความสำคัญต้องเป็น LOW, NORMAL, HIGH หรือ URGENT' })
  priority?: TicketPriority;

  @ApiPropertyOptional({ description: 'กรองเฉพาะปัญหาที่พนักงานคนนี้รับผิดชอบแก้ไข', example: 4 })
  @IsOptional()
  @IsInt({ message: 'assigneeId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'assigneeId ต้องมากกว่า 0' })
  assigneeId?: number;

  @ApiPropertyOptional({ enum: TicketBillingType, description: 'กรองตามประเภทการคิดเงิน' })
  @IsOptional()
  @IsEnum(TicketBillingType, {
    message: 'ประเภทการคิดเงินต้องเป็น WARRANTY, MA_QUOTA, ADDON, ONE_TIME หรือ FREE',
  })
  billingType?: TicketBillingType;
}

/** หน้าจอ "รอรับการแก้ไข" — ไม่มีตัวกรอง status เพราะชุดสถานะถูกกำหนดตายตัวแล้ว */
export class QueryPendingTicketsDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'กรองเฉพาะปัญหาของลูกค้ารายนี้', example: 1 })
  @IsOptional()
  @IsInt({ message: 'customerId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'customerId ต้องมากกว่า 0' })
  customerId?: number;

  @ApiPropertyOptional({ description: 'กรองเฉพาะปัญหาที่พนักงานคนนี้รับผิดชอบแก้ไข', example: 4 })
  @IsOptional()
  @IsInt({ message: 'assigneeId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'assigneeId ต้องมากกว่า 0' })
  assigneeId?: number;

  @ApiPropertyOptional({ enum: TicketPriority, description: 'กรองตามความสำคัญ' })
  @IsOptional()
  @IsEnum(TicketPriority, { message: 'ความสำคัญต้องเป็น LOW, NORMAL, HIGH หรือ URGENT' })
  priority?: TicketPriority;
}
