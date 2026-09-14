import { ApiHideProperty, ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

import { PaginationDto } from '../../../common/dto/pagination.dto';
import { AcceptanceStatus } from '../../../models';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

const trimToNull = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export class CreateDeliveryDto {
  /** รับไว้เพื่อให้โค้ดเก่าคอมไพล์ได้ แต่ ValidationPipe จะปฏิเสธฟิลด์นี้ */
  @ApiHideProperty()
  deliveryNo?: unknown;

  @ApiProperty({
    description: 'หัวข้อการส่งมอบ',
    maxLength: 255,
    example: 'ส่งมอบระบบเฟสที่ 1 พร้อมคู่มือการใช้งาน',
  })
  @IsString({ message: 'หัวข้อการส่งมอบต้องเป็นข้อความ' })
  @IsNotEmpty({ message: 'กรุณากรอกหัวข้อการส่งมอบ' })
  @MaxLength(255, { message: 'หัวข้อการส่งมอบยาวเกิน 255 ตัวอักษร' })
  @Transform(trim)
  title: string;

  @ApiProperty({
    description:
      'วันเวลาที่ส่งมอบจริง — เป็นจุดตั้งต้นของระยะประกันทั้งหมด (BR-06) ' +
      'บันทึกย้อนหลังได้ แต่บันทึกล่วงหน้าไม่ได้',
    example: '2026-09-08T10:30:00.000Z',
  })
  @IsISO8601({ strict: false }, { message: 'deliveredAt ต้องเป็นวันที่เวลาตามรูปแบบ ISO 8601' })
  deliveredAt: string;

  @ApiPropertyOptional({
    description:
      'เวอร์ชันที่ส่งมอบ เก็บเป็นข้อความเพราะบริษัทใช้ได้ทั้ง "v1.2.0" และ "รอบที่ 2" ' +
      'การเรียงประวัติจึงเรียงด้วย deliveredAt เป็นหลัก ไม่ใช่ค่านี้',
    maxLength: 50,
    example: 'v1.2.0',
  })
  @IsOptional()
  @IsString({ message: 'เวอร์ชันต้องเป็นข้อความ' })
  @MaxLength(50, { message: 'เวอร์ชันยาวเกิน 50 ตัวอักษร' })
  @Transform(trimToNull)
  version?: string | null;

  @ApiPropertyOptional({ description: 'รายละเอียดสิ่งที่ส่งมอบ' })
  @IsOptional()
  @IsString({ message: 'รายละเอียดต้องเป็นข้อความ' })
  @Transform(trimToNull)
  description?: string | null;

  @ApiPropertyOptional({
    description:
      'พนักงานผู้ส่งมอบ — ระบุพนักงานที่ลาออกแล้วได้ เพราะการบันทึกย้อนหลัง ' +
      'ต้องบันทึกได้ตามความจริง ไม่ใช่ตามสถานะปัจจุบันของคนนั้น',
    example: 3,
  })
  @IsOptional()
  @IsInt({ message: 'deliveredByUserId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'deliveredByUserId ต้องมากกว่า 0' })
  deliveredByUserId?: number | null;

  @ApiPropertyOptional({
    description: 'ผู้ติดต่อฝั่งลูกค้าที่รับมอบ ต้องอยู่ภายใต้ลูกค้าเจ้าของโครงการนี้',
    example: 2,
  })
  @IsOptional()
  @IsInt({ message: 'acceptedByContactId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'acceptedByContactId ต้องมากกว่า 0' })
  acceptedByContactId?: number | null;

  @ApiPropertyOptional({ description: 'หมายเหตุ' })
  @IsOptional()
  @IsString({ message: 'หมายเหตุต้องเป็นข้อความ' })
  @Transform(trimToNull)
  note?: string | null;
}

/**
 * แก้ไขรายละเอียดการส่งมอบ
 *
 * ไม่รับ acceptanceStatus ที่นี่โดยเจตนา — การรับมอบเป็นเหตุการณ์ทางธุรกิจที่มีผลต่อ
 * acceptedAt และเป็นสิทธิ์คนละตัว (delivery.accept) จึงแยกไปที่ PATCH /acceptance
 */
export class UpdateDeliveryDto extends PartialType(CreateDeliveryDto) {}

/** ผลการตรวจรับ — แยกจากการแก้ไขรายละเอียดเพราะใช้สิทธิ์ `delivery.accept` */
export class UpdateAcceptanceDto {
  @ApiProperty({
    enum: AcceptanceStatus,
    description:
      'สถานะการตรวจรับ เปลี่ยนไปมาได้ไม่บังคับลำดับ เพราะงานจริงถอยกลับได้ ' +
      'เช่นตรวจรับแล้วพบปัญหาภายหลังจึงถอยกลับเป็น REJECTED',
    example: AcceptanceStatus.ACCEPTED,
  })
  @IsEnum(AcceptanceStatus, {
    message: 'สถานะการตรวจรับต้องเป็น PENDING, ACCEPTED หรือ REJECTED',
  })
  acceptanceStatus: AcceptanceStatus;

  @ApiPropertyOptional({
    description:
      'ผู้ติดต่อฝั่งลูกค้าที่เซ็นรับมอบ — เซ็นมือต่อหน้าแล้วสแกนแนบเข้าระบบ (BR-12) ' +
      'ต้องอยู่ภายใต้ลูกค้าเจ้าของโครงการนี้',
    example: 2,
  })
  @IsOptional()
  @IsInt({ message: 'acceptedByContactId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'acceptedByContactId ต้องมากกว่า 0' })
  acceptedByContactId?: number | null;

  @ApiPropertyOptional({ description: 'หมายเหตุการตรวจรับ เช่น เหตุผลที่ไม่รับมอบ' })
  @IsOptional()
  @IsString({ message: 'หมายเหตุต้องเป็นข้อความ' })
  @Transform(trimToNull)
  note?: string | null;

  @ApiPropertyOptional({
    description:
      'เป็นการส่งมอบครั้งสุดท้ายของโครงการหรือไม่ (คำตอบของ "ส่งมอบครั้งสุดท้าย?" ตอนตรวจรับ) — ' +
      'ไม่ส่ง = คงค่าเดิม ประกันออกได้จากใบที่เป็นครั้งสุดท้ายและยอมรับแล้วเท่านั้น ' +
      'และเมื่อยอมรับครั้งสุดท้าย โครงการที่ยังเป็นร่าง/กำลังดำเนินการจะเป็น "ส่งมอบแล้ว" ให้เอง',
    example: true,
  })
  @IsOptional()
  @IsBoolean({ message: 'isFinal ต้องเป็น true หรือ false' })
  isFinal?: boolean;
}

/** `search` ที่สืบมาจาก PaginationDto ค้นจากหัวข้อและเลขที่ใบส่งมอบ */
export class QueryDeliveriesDto extends PaginationDto {
  @ApiPropertyOptional({ enum: AcceptanceStatus, description: 'กรองตามสถานะการตรวจรับ' })
  @IsOptional()
  @IsEnum(AcceptanceStatus, {
    message: 'สถานะการตรวจรับต้องเป็น PENDING, ACCEPTED หรือ REJECTED',
  })
  acceptanceStatus?: AcceptanceStatus;

  @ApiPropertyOptional({ description: 'กรองเฉพาะเวอร์ชันนี้', example: 'v1.2.0' })
  @IsOptional()
  @IsString({ message: 'เวอร์ชันต้องเป็นข้อความ' })
  @MaxLength(50, { message: 'เวอร์ชันยาวเกิน 50 ตัวอักษร' })
  @Transform(trimToNull)
  version?: string;
}
