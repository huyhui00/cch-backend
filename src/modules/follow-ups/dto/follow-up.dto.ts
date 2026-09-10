import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

import { PaginationDto } from '../../../common/dto/pagination.dto';
import { FollowUpStatus } from '../../../models';

const trimToNull = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

const toBoolean = ({ value }: { value: unknown }) => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return value;
};

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * งานติดตามลูกค้า (M7)
 *
 * **ไม่มีฟิลด์ `channel`** โดยเจตนา — ช่องทางการติดต่อเป็นของ `communication_logs`
 * งานติดตามคือ "เตือนว่าต้องตามลูกค้ารายนี้" ยังไม่รู้ว่าจะติดต่อทางไหน
 * ตอนติดต่อจริงค่อยบันทึกเป็นการติดต่อแยกอีกใบ ซึ่งมี `channel` ครบอยู่แล้ว (BR-02)
 */
export class CreateFollowUpDto {
  @ApiProperty({ description: 'ลูกค้าที่ต้องติดตาม', example: 1 })
  @IsInt({ message: 'customerId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'customerId ต้องมากกว่า 0' })
  customerId: number;

  @ApiProperty({
    description: 'เรื่องที่ต้องติดตาม',
    maxLength: 255,
    example: 'โทรถามความคืบหน้าการตัดสินใจต่อสัญญา MA',
  })
  @IsString({ message: 'เรื่องที่ต้องติดตามต้องเป็นข้อความ' })
  @MaxLength(255, { message: 'เรื่องที่ต้องติดตามยาวเกิน 255 ตัวอักษร' })
  @Transform(trim)
  title: string;

  @ApiPropertyOptional({
    description: 'รายละเอียดตอนวางแผน — คนละช่องกับ resultNote ที่บันทึกตอนทำเสร็จ',
    example: 'ลูกค้าขอเวลาคิดถึงสิ้นเดือน ให้ทวนราคาที่เสนอไปด้วย',
  })
  @IsOptional()
  @IsString({ message: 'รายละเอียดต้องเป็นข้อความ' })
  @Transform(trimToNull)
  detail?: string | null;

  @ApiProperty({
    description: 'วันที่ต้องติดตาม (YYYY-MM-DD) — ลงวันย้อนหลังหรือล่วงหน้าก็ได้',
    example: '2026-09-20',
  })
  @Matches(DATE_ONLY_PATTERN, { message: 'วันที่ต้องติดตามต้องอยู่ในรูปแบบ YYYY-MM-DD' })
  dueDate: string;

  @ApiPropertyOptional({
    description:
      'ผู้รับผิดชอบติดตาม ต้องเป็นพนักงานที่ยังทำงานอยู่ — ไม่ระบุ = ยังไม่มอบหมาย ' +
      'ใช้ GET /api/users/assignable เติมดรอปดาวน์',
    example: 4,
  })
  @IsOptional()
  @IsInt({ message: 'assignedUserId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'assignedUserId ต้องมากกว่า 0' })
  assignedUserId?: number | null;
}

/**
 * แก้ไขงานติดตาม
 *
 * ย้ายลูกค้าไม่ได้ (ไม่มี `customerId`) ด้วยเหตุผลเดียวกับที่ย้ายโครงการข้ามลูกค้าไม่ได้
 * ใน Phase 5 — งานติดตามที่ทำไปแล้วจะพาประวัติไปโผล่ผิดลูกค้า
 * ผูกผิดรายให้ยกเลิกแล้วสร้างใหม่
 *
 * `completedAt` ไม่ได้รับจาก client — ระบบใส่ให้เองตอนสถานะเป็น DONE
 */
export class UpdateFollowUpDto {
  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString({ message: 'เรื่องที่ต้องติดตามต้องเป็นข้อความ' })
  @MaxLength(255, { message: 'เรื่องที่ต้องติดตามยาวเกิน 255 ตัวอักษร' })
  @Transform(trim)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'รายละเอียดต้องเป็นข้อความ' })
  @Transform(trimToNull)
  detail?: string | null;

  @ApiPropertyOptional({ example: '2026-09-25' })
  @IsOptional()
  @Matches(DATE_ONLY_PATTERN, { message: 'วันที่ต้องติดตามต้องอยู่ในรูปแบบ YYYY-MM-DD' })
  dueDate?: string;

  @ApiPropertyOptional({
    description:
      'เปลี่ยนสถานะได้อิสระ ไม่บังคับลำดับ — เป็น DONE แล้วระบบใส่ completedAt ให้ ' +
      'ถอยออกจาก DONE แล้วล้างค่า **OVERDUE ตั้งเองไม่ได้** เพราะคำนวณจากวันที่',
    enum: [FollowUpStatus.PLANNED, FollowUpStatus.DONE, FollowUpStatus.CANCELLED],
  })
  @IsOptional()
  @IsEnum(FollowUpStatus, { message: 'สถานะงานติดตามไม่ถูกต้อง' })
  status?: FollowUpStatus;

  @ApiPropertyOptional({ description: 'ส่ง null เพื่อถอนการมอบหมาย', example: 4 })
  @IsOptional()
  @IsInt({ message: 'assignedUserId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'assignedUserId ต้องมากกว่า 0' })
  assignedUserId?: number | null;

  @ApiPropertyOptional({
    description: 'ผลของการติดตาม — บันทึกตอนทำเสร็จ คนละช่องกับ detail ที่เขียนตอนวางแผน',
    example: 'โทรแล้ว ลูกค้าขอเลื่อนตัดสินใจไปต้นเดือนหน้า',
  })
  @IsOptional()
  @IsString({ message: 'ผลของการติดตามต้องเป็นข้อความ' })
  @Transform(trimToNull)
  resultNote?: string | null;
}

/**
 * ปิดงานติดตาม — ทางลัดของ `PATCH /:id` ที่ส่ง `status: DONE`
 *
 * มีแยกเพราะเป็นการกระทำที่ผูกกับสิทธิ์ `followup.complete` ต่างหาก
 * ทีมที่ให้พนักงานปิดงานของตัวเองได้แต่ไม่ให้แก้เนื้อหางาน จึงกั้นได้จริง
 */
export class CompleteFollowUpDto {
  @ApiPropertyOptional({
    description: 'ผลของการติดตาม — ควรกรอกเสมอ เพราะเป็นหลักฐานว่าติดตามแล้วได้อะไร',
    example: 'โทรแล้ว ลูกค้ายืนยันต่อสัญญา รอส่งใบเสนอราคา',
  })
  @IsOptional()
  @IsString({ message: 'ผลของการติดตามต้องเป็นข้อความ' })
  @Transform(trimToNull)
  resultNote?: string | null;
}

export class QueryFollowUpsDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'กรองตามลูกค้า', example: 1 })
  @IsOptional()
  @IsInt({ message: 'customerId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'customerId ต้องมากกว่า 0' })
  customerId?: number;

  @ApiPropertyOptional({
    description: 'กรองตามผู้รับผิดชอบ — หน้าจอ "งานติดตามของฉัน"',
    example: 4,
  })
  @IsOptional()
  @IsInt({ message: 'assignedUserId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'assignedUserId ต้องมากกว่า 0' })
  assignedUserId?: number;

  @ApiPropertyOptional({ enum: FollowUpStatus, description: 'กรองตามสถานะที่บันทึกไว้' })
  @IsOptional()
  @IsEnum(FollowUpStatus, { message: 'สถานะงานติดตามไม่ถูกต้อง' })
  status?: FollowUpStatus;

  @ApiPropertyOptional({
    description:
      '`true` = เอาเฉพาะงานที่เลยกำหนดแล้ว (`dueDate < วันนี้` และยังไม่ DONE/CANCELLED) ' +
      '**คิดจากวันที่จริง ไม่ได้อ่านจากคอลัมน์ status** เพราะยังไม่มี scheduler ' +
      'มาปรับเป็น OVERDUE ให้จนกว่าจะถึง Phase 11 — `false` = เอาเฉพาะที่ยังไม่เลยกำหนด',
    example: true,
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean({ message: 'overdue ต้องเป็น true หรือ false' })
  overdue?: boolean;

  @ApiPropertyOptional({
    description: 'เอาเฉพาะงานที่ครบกำหนดตั้งแต่วันนี้เป็นต้นไป (YYYY-MM-DD)',
    example: '2026-09-01',
  })
  @IsOptional()
  @Matches(DATE_ONLY_PATTERN, { message: 'dueFrom ต้องอยู่ในรูปแบบ YYYY-MM-DD' })
  dueFrom?: string;

  @ApiPropertyOptional({
    description: 'เอาเฉพาะงานที่ครบกำหนดไม่เกินวันนี้ (YYYY-MM-DD)',
    example: '2026-09-30',
  })
  @IsOptional()
  @Matches(DATE_ONLY_PATTERN, { message: 'dueTo ต้องอยู่ในรูปแบบ YYYY-MM-DD' })
  dueTo?: string;
}
