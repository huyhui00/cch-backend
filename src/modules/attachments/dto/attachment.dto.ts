import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';

import { ATTACHMENT_REF_TYPES, type AttachmentRefType } from '../../../models';

/** ประเภทปลายทางที่เปิดให้อัปโหลดในเฟสนี้ (เอกสารโปรเจคใช้ /documents อยู่แล้ว) */
export const UPLOADABLE_ATTACHMENT_REF_TYPES = [
  'TICKET',
  'TICKET_RESOLUTION',
  'COMMUNICATION_LOG',
  'DELIVERY',
  'MA_CONTRACT',
] as const satisfies readonly AttachmentRefType[];

export type UploadableAttachmentRefType = (typeof UPLOADABLE_ATTACHMENT_REF_TYPES)[number];

function toInt({ value }: { value: unknown }): unknown {
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return value;
}

/** query รายการไฟล์แนบของต้นทางหนึ่งรายการ */
export class QueryAttachmentsDto {
  @ApiProperty({
    enum: ATTACHMENT_REF_TYPES,
    description: 'ประเภทต้นทางที่ไฟล์ผูกอยู่',
    example: 'COMMUNICATION_LOG',
  })
  @IsIn([...ATTACHMENT_REF_TYPES], { message: 'refType ไม่ถูกต้อง' })
  refType: AttachmentRefType;

  @ApiProperty({ description: 'id ของต้นทาง', example: 12 })
  @Transform(toInt)
  @IsInt({ message: 'refId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'refId ต้องมากกว่า 0' })
  refId: number;
}

/**
 * อัปโหลดไฟล์แนบ — ส่งเป็น multipart/form-data
 * ฟิลด์ file บังคับ ส่วน refType/refId ส่งใน body คู่กับไฟล์ได้ (string จาก form)
 */
export class UploadAttachmentDto {
  @ApiProperty({
    enum: UPLOADABLE_ATTACHMENT_REF_TYPES,
    description: 'ประเภทต้นทาง — เอกสารโปรเจคใช้ POST /projects/:id/documents',
    example: 'COMMUNICATION_LOG',
  })
  @IsIn([...UPLOADABLE_ATTACHMENT_REF_TYPES], {
    message:
      'refType นี้ยังไม่อนุญาตให้อัปโหลดผ่านเส้นไฟล์แนบ — เอกสารโปรเจคใช้ /api/projects/:id/documents',
  })
  refType: UploadableAttachmentRefType;

  @ApiProperty({ description: 'id ของต้นทาง', example: 12 })
  @Transform(toInt)
  @IsInt({ message: 'refId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'refId ต้องมากกว่า 0' })
  refId: number;

  @ApiPropertyOptional({ description: 'หมายเหตุประกอบไฟล์', maxLength: 2000 })
  @IsOptional()
  @IsString({ message: 'หมายเหตุต้องเป็นข้อความ' })
  @MaxLength(2000, { message: 'หมายเหตุยาวเกิน 2000 ตัวอักษร' })
  note?: string | null;
}

export class UpdateAttachmentDto {
  @ApiPropertyOptional({ description: 'หมายเหตุประกอบไฟล์', maxLength: 2000, nullable: true })
  @IsOptional()
  @IsString({ message: 'หมายเหตุต้องเป็นข้อความ' })
  @MaxLength(2000, { message: 'หมายเหตุยาวเกิน 2000 ตัวอักษร' })
  note?: string | null;
}
