import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';

import { PaginationDto } from '../../../common/dto/pagination.dto';

const trimToNull = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

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

export class QueryDocumentsDto extends PaginationDto {}

export class QueryCompanyDocumentsDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'กรองเฉพาะเอกสารของโครงการนี้', example: 3 })
  @IsOptional()
  @IsInt({ message: 'projectId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'projectId ต้องมากกว่า 0' })
  projectId?: number;

  @ApiPropertyOptional({ description: 'กรองเฉพาะเอกสารของลูกค้ารายนี้', example: 1 })
  @IsOptional()
  @IsInt({ message: 'customerId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'customerId ต้องมากกว่า 0' })
  customerId?: number;
}
