import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

import { PaginationDto } from '../../../common/dto/pagination.dto';
import { CommunicationChannel } from '../../../models';

const trimToNull = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/**
 * BR-02 — การสื่อสารเกิดนอกระบบแล้วมาบันทึกย้อนหลัง
 * `channel` จึงบังคับกรอกเสมอ และ `occurredAt` คือเวลาที่คุยกันจริง
 * ไม่ใช่เวลาที่กดบันทึก (เวลาที่บันทึกอยู่ใน createdAt ที่ระบบใส่ให้เอง)
 */
export class CreateCommunicationLogDto {
  @ApiProperty({ description: 'ลูกค้าที่ติดต่อด้วย', example: 1 })
  @IsInt({ message: 'customerId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'customerId ต้องมากกว่า 0' })
  customerId: number;

  @ApiProperty({
    enum: CommunicationChannel,
    description: 'ช่องทางที่ใช้ติดต่อ — บังคับกรอกตาม BR-02',
    example: CommunicationChannel.LINE,
  })
  @IsEnum(CommunicationChannel, {
    message: 'ช่องทางต้องเป็น LINE, PHONE, EMAIL, FACEBOOK, MEETING หรือ OTHER',
  })
  channel: CommunicationChannel;

  @ApiProperty({
    description: 'วันเวลาที่คุยกันจริง (ไม่ใช่เวลาที่มาบันทึก) รูปแบบ ISO 8601',
    example: '2026-09-05T14:30:00+07:00',
  })
  @IsISO8601({ strict: true }, { message: 'occurredAt ต้องเป็นวันเวลารูปแบบ ISO 8601' })
  occurredAt: string;

  @ApiPropertyOptional({ description: 'ผู้ติดต่อฝั่งลูกค้าที่คุยด้วย', example: 2 })
  @IsOptional()
  @IsInt({ message: 'contactId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'contactId ต้องมากกว่า 0' })
  contactId?: number | null;

  @ApiPropertyOptional({
    description: 'หัวข้อโดยย่อ',
    maxLength: 255,
    example: 'แจ้งปัญหาหน้าจอรายงานช้า',
  })
  @IsOptional()
  @IsString({ message: 'หัวข้อต้องเป็นข้อความ' })
  @MaxLength(255, { message: 'หัวข้อยาวเกิน 255 ตัวอักษร' })
  @Transform(trimToNull)
  subject?: string | null;

  @ApiPropertyOptional({ description: 'รายละเอียดที่คุยกัน' })
  @IsOptional()
  @IsString({ message: 'รายละเอียดต้องเป็นข้อความ' })
  @Transform(trimToNull)
  content?: string | null;

  @ApiPropertyOptional({
    description:
      'พนักงานที่เป็นคนคุย ซึ่งอาจไม่ใช่คนเดียวกับคนที่มาบันทึก ' +
      'ถ้าไม่ระบุ ระบบจะถือว่าเป็นคนที่บันทึกเอง',
    example: 3,
  })
  @IsOptional()
  @IsInt({ message: 'handledByUserId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'handledByUserId ต้องมากกว่า 0' })
  handledByUserId?: number | null;
}

/** ย้ายบันทึกข้ามลูกค้าไม่ได้ — ถ้าบันทึกผิดรายให้ลบแล้วสร้างใหม่ ร่องรอยอยู่ใน audit log */
export class UpdateCommunicationLogDto extends PartialType(
  OmitType(CreateCommunicationLogDto, ['customerId'] as const),
) {}

export class QueryCommunicationLogsDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'กรองเฉพาะการติดต่อกับลูกค้ารายนี้', example: 1 })
  @IsOptional()
  @IsInt({ message: 'customerId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'customerId ต้องมากกว่า 0' })
  customerId?: number;

  @ApiPropertyOptional({ description: 'กรองเฉพาะที่คุยกับผู้ติดต่อคนนี้', example: 2 })
  @IsOptional()
  @IsInt({ message: 'contactId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'contactId ต้องมากกว่า 0' })
  contactId?: number;

  @ApiPropertyOptional({ enum: CommunicationChannel, description: 'กรองตามช่องทาง' })
  @IsOptional()
  @IsEnum(CommunicationChannel, {
    message: 'ช่องทางต้องเป็น LINE, PHONE, EMAIL, FACEBOOK, MEETING หรือ OTHER',
  })
  channel?: CommunicationChannel;

  @ApiPropertyOptional({ description: 'กรองเฉพาะที่พนักงานคนนี้เป็นคนคุย', example: 3 })
  @IsOptional()
  @IsInt({ message: 'handledByUserId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'handledByUserId ต้องมากกว่า 0' })
  handledByUserId?: number;

  @ApiPropertyOptional({ description: 'ติดต่อตั้งแต่วันที่ (รวมวันนั้น)', example: '2026-09-01' })
  @IsOptional()
  @IsISO8601({}, { message: 'dateFrom ต้องเป็นวันที่รูปแบบ ISO 8601' })
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'ติดต่อถึงวันที่ (รวมวันนั้น)', example: '2026-09-30' })
  @IsOptional()
  @IsISO8601({}, { message: 'dateTo ต้องเป็นวันที่รูปแบบ ISO 8601' })
  dateTo?: string;
}
