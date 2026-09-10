import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { PaginationDto } from '../../../common/dto/pagination.dto';

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

/** โควตาที่สูงกว่านี้แทบจะเป็นการพิมพ์ผิดเสมอ — บริษัทขนาดนี้ไม่รับงานเดือนละพันใบ */
const MAX_QUOTA = 999;

/** เวลาตอบกลับที่นานกว่า 30 วันไม่มีความหมายในเชิงสัญญาบริการ */
const MAX_RESPONSE_HOUR = 24 * 30;

/**
 * รายการบริการย่อยในแผน (`ma_plan_items`)
 *
 * ส่งมาพร้อมแผนได้เลยตอนสร้าง เพราะแผนที่ไม่มีรายการย่อยบอกลูกค้าไม่ได้ว่าได้อะไรบ้าง
 * แยกเป็นตารางไม่ใช่ JSON เพื่อให้ค้นและแก้ทีละรายการได้ตามที่ออกแบบไว้ในกลุ่ม D
 */
export class MaPlanItemDto {
  @ApiProperty({ description: 'ชื่อบริการย่อย', maxLength: 255, example: 'ตรวจสุขภาพระบบรายเดือน' })
  @IsString({ message: 'ชื่อรายการต้องเป็นข้อความ' })
  @MaxLength(255, { message: 'ชื่อรายการยาวเกิน 255 ตัวอักษร' })
  @Transform(trim)
  title: string;

  @ApiPropertyOptional({
    description: 'รายละเอียดเพิ่มเติมของบริการย่อยนี้',
    example: 'ตรวจ log และพื้นที่ดิสก์ พร้อมสรุปรายงานให้ทุกสิ้นเดือน',
  })
  @IsOptional()
  @IsString({ message: 'รายละเอียดต้องเป็นข้อความ' })
  @Transform(trimToNull)
  detail?: string | null;
}

/**
 * BR-05 — เนื้อหาแผนเหมือนกันทุกโครงการ แต่ราคาต่างกัน
 *
 * **ห้ามเพิ่มฟิลด์ราคาลงใน DTO นี้เด็ดขาด** ราคาอยู่ที่ `ma_contracts.price`
 * ถ้าราคามาอยู่ที่แผน จะต้องก๊อปแผนใหม่ทุกครั้งที่ต่อรองราคาได้ไม่เท่ากัน
 * ซึ่งทำให้ "เนื้อหาเหมือนกันทุกโครงการ" เป็นไปไม่ได้ตั้งแต่ต้น
 */
export class CreateMaPlanDto {
  @ApiPropertyOptional({
    description:
      'รหัสแผน — **ไม่บังคับ** หน้าจอซ่อนช่องนี้โดยตกลงกันแล้ว (10 ก.ย.) ใช้ชื่อแผนแทน ' +
      'ถ้าใส่มา: ตัวพิมพ์ใหญ่ ตัวเลข และขีดล่างเท่านั้น และห้ามซ้ำ',
    maxLength: 50,
    nullable: true,
    example: 'MA_STANDARD',
  })
  @IsOptional()
  @IsString({ message: 'รหัสแผนต้องเป็นข้อความ' })
  @MaxLength(50, { message: 'รหัสแผนยาวเกิน 50 ตัวอักษร' })
  @Matches(/^[A-Z0-9_]+$/, {
    message: 'รหัสแผนใช้ได้เฉพาะตัวพิมพ์ใหญ่ ตัวเลข และขีดล่าง',
  })
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') {
      return value;
    }
    // ช่องว่างล้วน = ไม่ใส่รหัส ไม่ใช่รหัสที่เป็นสตริงว่าง (ซึ่งจะชน unique กันเอง)
    const normalized = value.trim().toUpperCase();
    return normalized.length > 0 ? normalized : null;
  })
  code?: string | null;

  @ApiProperty({ description: 'ชื่อแผนที่ใช้แสดง', maxLength: 150, example: 'แผนมาตรฐาน' })
  @IsString({ message: 'ชื่อแผนต้องเป็นข้อความ' })
  @MaxLength(150, { message: 'ชื่อแผนยาวเกิน 150 ตัวอักษร' })
  @Transform(trim)
  name: string;

  @ApiPropertyOptional({ description: 'คำอธิบายแผน' })
  @IsOptional()
  @IsString({ message: 'คำอธิบายต้องเป็นข้อความ' })
  @Transform(trimToNull)
  description?: string | null;

  @ApiPropertyOptional({
    description:
      'โควตาแก้บั๊กต่อเดือน — ฐานของการนับใน ma_usages (CLAUDE.md 9.2) ' +
      'โควตาที่ซื้อเพิ่มระหว่างสัญญาให้บันทึกเป็น addon ไม่ใช่แก้ตัวเลขนี้',
    minimum: 0,
    maximum: MAX_QUOTA,
    default: 0,
    example: 5,
  })
  @IsOptional()
  @IsInt({ message: 'โควตาต่อเดือนต้องเป็นจำนวนเต็ม' })
  @Min(0, { message: 'โควตาต่อเดือนต้องไม่ติดลบ' })
  @Max(MAX_QUOTA, { message: `โควตาต่อเดือนต้องไม่เกิน ${MAX_QUOTA}` })
  bugQuotaPerMonth?: number;

  @ApiPropertyOptional({
    description: 'เวลาตอบกลับตามสัญญา (ชั่วโมง) — ฝั่งหน้าจอเรียกว่า SLA',
    minimum: 1,
    maximum: MAX_RESPONSE_HOUR,
    example: 24,
  })
  @IsOptional()
  @IsInt({ message: 'เวลาตอบกลับต้องเป็นจำนวนเต็ม' })
  @Min(1, { message: 'เวลาตอบกลับต้องมีอย่างน้อย 1 ชั่วโมง' })
  @Max(MAX_RESPONSE_HOUR, { message: `เวลาตอบกลับต้องไม่เกิน ${MAX_RESPONSE_HOUR} ชั่วโมง` })
  responseTimeHour?: number | null;

  @ApiPropertyOptional({
    description: 'จำนวนครั้งที่เข้าไปหน้างานได้ต่อเดือน',
    minimum: 0,
    maximum: MAX_QUOTA,
    example: 1,
  })
  @IsOptional()
  @IsInt({ message: 'โควตาเข้าหน้างานต้องเป็นจำนวนเต็ม' })
  @Min(0, { message: 'โควตาเข้าหน้างานต้องไม่ติดลบ' })
  @Max(MAX_QUOTA, { message: `โควตาเข้าหน้างานต้องไม่เกิน ${MAX_QUOTA}` })
  onsiteQuotaPerMonth?: number | null;

  @ApiPropertyOptional({
    description: 'เปิดให้เลือกแผนนี้ตอนทำสัญญาใหม่หรือไม่ — ปิดแล้วสัญญาเดิมยังใช้ได้ตามปกติ',
    default: true,
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean({ message: 'สถานะเปิดใช้งานต้องเป็น true หรือ false' })
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'ลำดับการแสดงผล เลขน้อยอยู่ก่อน',
    minimum: 0,
    default: 0,
    example: 10,
  })
  @IsOptional()
  @IsInt({ message: 'ลำดับการแสดงผลต้องเป็นจำนวนเต็ม' })
  @Min(0, { message: 'ลำดับการแสดงผลต้องไม่ติดลบ' })
  sortOrder?: number;

  @ApiPropertyOptional({
    description: 'รายการบริการย่อยในแผน เรียงตามลำดับที่ส่งมา',
    type: [MaPlanItemDto],
  })
  @IsOptional()
  @IsArray({ message: 'รายการบริการย่อยต้องเป็นอาเรย์' })
  @ArrayMaxSize(50, { message: 'รายการบริการย่อยต้องไม่เกิน 50 รายการ' })
  @ValidateNested({ each: true })
  @Type(() => MaPlanItemDto)
  items?: MaPlanItemDto[];
}

/**
 * แก้ไขแผน
 *
 * ส่ง `items` มาเมื่อไหร่ = แทนที่รายการย่อยทั้งชุด ไม่ใช่การเพิ่มต่อท้าย
 * เพราะหน้าจอแก้แผนเป็นฟอร์มเดียวที่ผู้ใช้ลาก เพิ่ม ลบ แล้วกดบันทึกครั้งเดียว
 * ไม่ส่งมา = ไม่แตะรายการย่อยเดิม
 */
export class UpdateMaPlanDto extends CreateMaPlanDto {
  @ApiPropertyOptional({
    description: 'แก้รหัสแผนได้ถ้ายังไม่ซ้ำกับแผนอื่น — ส่ง null เพื่อล้างรหัสออก',
    nullable: true,
  })
  @IsOptional()
  declare code?: string | null;

  @ApiPropertyOptional({ description: 'ชื่อแผนที่ใช้แสดง' })
  @IsOptional()
  declare name: string;
}

export class QueryMaPlansDto extends PaginationDto {
  @ApiPropertyOptional({
    description: 'กรองเฉพาะแผนที่เปิด/ปิดใช้งาน — ไม่ระบุ = เอาทั้งหมด',
    example: true,
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean({ message: 'isActive ต้องเป็น true หรือ false' })
  isActive?: boolean;
}
