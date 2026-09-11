import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

import { PaginationDto } from '../../../common/dto/pagination.dto';

const trimToNull = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/**
 * ช่องข้อความที่ส่งมาพร้อมไฟล์ (multipart/form-data) — ตัวไฟล์อยู่ในฟิลด์ `file` แยกต่างหาก
 *
 * ประชุม 11 ก.ย. (B-5): "ตั้งชื่อเอกสาร แนบไฟล์ แล้วก็รายละเอียด" ไม่ต้องแยกประเภท
 * ไม่ส่งชื่อมา = ใช้ชื่อไฟล์ ผู้ใช้จะได้ไม่ต้องพิมพ์ซ้ำเมื่อชื่อไฟล์บอกอยู่แล้ว
 */
export class UploadDocumentDto {
  @ApiPropertyOptional({
    description: 'ชื่อเอกสาร เช่น "ใบเสนอราคา งวดที่ 1" — ไม่ส่งมาใช้ชื่อไฟล์',
    maxLength: 255,
  })
  @IsOptional()
  @IsString({ message: 'ชื่อเอกสารต้องเป็นข้อความ' })
  @MaxLength(255, { message: 'ชื่อเอกสารยาวเกิน 255 ตัวอักษร' })
  @Transform(trimToNull)
  title?: string | null;

  @ApiPropertyOptional({ description: 'รายละเอียดเอกสาร' })
  @IsOptional()
  @IsString({ message: 'รายละเอียดต้องเป็นข้อความ' })
  @Transform(trimToNull)
  note?: string | null;
}

/** แก้ได้เฉพาะชื่อและรายละเอียด — เปลี่ยนไฟล์ = อัปโหลดเป็นเอกสารใหม่ ไฟล์เดิมยังเก็บเป็นประวัติ */
export class UpdateDocumentDto {
  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString({ message: 'ชื่อเอกสารต้องเป็นข้อความ' })
  @IsNotEmpty({ message: 'ชื่อเอกสารต้องไม่ว่าง' })
  @MaxLength(255, { message: 'ชื่อเอกสารยาวเกิน 255 ตัวอักษร' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  title?: string;

  @ApiPropertyOptional({ description: 'ส่ง null เพื่อล้างรายละเอียด' })
  @IsOptional()
  @IsString({ message: 'รายละเอียดต้องเป็นข้อความ' })
  @Transform(trimToNull)
  note?: string | null;
}

/** `search` ค้นจากชื่อเอกสารและชื่อไฟล์ */
export class QueryDocumentsDto extends PaginationDto {}
