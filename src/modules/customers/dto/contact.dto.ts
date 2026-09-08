import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

import { PaginationDto } from '../../../common/dto/pagination.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

const trimToNull = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export class CreateContactDto {
  @ApiProperty({ description: 'ลูกค้าที่ผู้ติดต่อคนนี้สังกัด', example: 1 })
  @IsInt({ message: 'customerId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'customerId ต้องมากกว่า 0' })
  customerId: number;

  @ApiProperty({ description: 'ชื่อผู้ติดต่อ', maxLength: 255, example: 'คุณสมศรี จัดซื้อ' })
  @IsString({ message: 'ชื่อผู้ติดต่อต้องเป็นข้อความ' })
  @IsNotEmpty({ message: 'กรุณากรอกชื่อผู้ติดต่อ' })
  @MaxLength(255, { message: 'ชื่อผู้ติดต่อยาวเกิน 255 ตัวอักษร' })
  @Transform(trim)
  name: string;

  @ApiPropertyOptional({ maxLength: 100, example: 'ศรี' })
  @IsOptional()
  @IsString({ message: 'ชื่อเล่นต้องเป็นข้อความ' })
  @MaxLength(100, { message: 'ชื่อเล่นยาวเกิน 100 ตัวอักษร' })
  @Transform(trimToNull)
  nickname?: string | null;

  @ApiPropertyOptional({ maxLength: 150, example: 'ผู้จัดการฝ่ายจัดซื้อ' })
  @IsOptional()
  @IsString({ message: 'ตำแหน่งต้องเป็นข้อความ' })
  @MaxLength(150, { message: 'ตำแหน่งยาวเกิน 150 ตัวอักษร' })
  @Transform(trimToNull)
  position?: string | null;

  @ApiPropertyOptional({ maxLength: 30, example: '081-234-5678' })
  @IsOptional()
  @IsString({ message: 'เบอร์โทรต้องเป็นข้อความ' })
  @MaxLength(30, { message: 'เบอร์โทรยาวเกิน 30 ตัวอักษร' })
  @Transform(trimToNull)
  phone?: string | null;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsEmail({}, { message: 'รูปแบบอีเมลไม่ถูกต้อง' })
  @MaxLength(255, { message: 'อีเมลยาวเกิน 255 ตัวอักษร' })
  @Transform(trimToNull)
  email?: string | null;

  @ApiPropertyOptional({
    description:
      'LINE ID ของผู้ติดต่อ — ใช้บันทึกช่องทางเท่านั้น ระบบไม่ยิงข้อความหาลูกค้า (BR-11)',
    maxLength: 100,
  })
  @IsOptional()
  @IsString({ message: 'LINE ID ต้องเป็นข้อความ' })
  @MaxLength(100, { message: 'LINE ID ยาวเกิน 100 ตัวอักษร' })
  @Transform(trimToNull)
  lineId?: string | null;

  @ApiPropertyOptional({
    default: false,
    description:
      'ผู้ติดต่อหลักของลูกค้ารายนี้ — มีได้คนเดียวต่อลูกค้า 1 ราย ' +
      'ถ้าตั้งคนใหม่เป็นหลัก ระบบจะถอดคนเดิมออกให้อัตโนมัติ',
  })
  @IsOptional()
  @IsBoolean({ message: 'isPrimary ต้องเป็น true หรือ false' })
  isPrimary?: boolean;

  @ApiPropertyOptional({ description: 'บันทึกเพิ่มเติม' })
  @IsOptional()
  @IsString({ message: 'บันทึกต้องเป็นข้อความ' })
  @Transform(trimToNull)
  note?: string | null;
}

/** ย้ายผู้ติดต่อข้ามลูกค้าไม่ได้ — ถ้าคนเดิมย้ายบริษัทให้สร้างรายการใหม่ ของเดิมเก็บไว้เป็นประวัติ */
export class UpdateContactDto extends PartialType(
  OmitType(CreateContactDto, ['customerId'] as const),
) {}

export class QueryContactsDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'กรองเฉพาะผู้ติดต่อของลูกค้ารายนี้', example: 1 })
  @IsOptional()
  @IsInt({ message: 'customerId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'customerId ต้องมากกว่า 0' })
  customerId?: number;

  @ApiPropertyOptional({ description: 'กรองเฉพาะผู้ติดต่อหลัก' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  })
  @IsBoolean({ message: 'isPrimary ต้องเป็น true หรือ false' })
  isPrimary?: boolean;
}
