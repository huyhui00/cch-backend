import { ApiHideProperty, ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';

import { CustomerStatus } from '../../../models';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

const trimToNull = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export class CreateCustomerDto {
  /** รับไว้เพื่อให้โค้ดเก่าคอมไพล์ได้ แต่ ValidationPipe จะปฏิเสธฟิลด์นี้ */
  @ApiHideProperty()
  code?: unknown;

  @ApiProperty({
    description: 'ชื่อบริษัทหรือชื่อลูกค้า',
    maxLength: 255,
    example: 'บริษัท ตัวอย่าง จำกัด',
  })
  @IsString({ message: 'ชื่อลูกค้าต้องเป็นข้อความ' })
  @IsNotEmpty({ message: 'กรุณากรอกชื่อลูกค้า' })
  @MaxLength(255, { message: 'ชื่อลูกค้ายาวเกิน 255 ตัวอักษร' })
  @Transform(trim)
  name: string;

  @ApiPropertyOptional({
    description: 'เลขประจำตัวผู้เสียภาษี',
    maxLength: 20,
    example: '0105558000000',
  })
  @IsOptional()
  @IsString({ message: 'เลขผู้เสียภาษีต้องเป็นข้อความ' })
  @MaxLength(20, { message: 'เลขผู้เสียภาษียาวเกิน 20 ตัวอักษร' })
  @Transform(trimToNull)
  taxId?: string | null;

  @ApiPropertyOptional({
    description: 'ประเภทธุรกิจ',
    maxLength: 150,
    example: 'โรงงานผลิตชิ้นส่วน',
  })
  @IsOptional()
  @IsString({ message: 'ประเภทธุรกิจต้องเป็นข้อความ' })
  @MaxLength(150, { message: 'ประเภทธุรกิจยาวเกิน 150 ตัวอักษร' })
  @Transform(trimToNull)
  businessType?: string | null;

  @ApiPropertyOptional({ description: 'ที่อยู่' })
  @IsOptional()
  @IsString({ message: 'ที่อยู่ต้องเป็นข้อความ' })
  @Transform(trimToNull)
  address?: string | null;

  @ApiPropertyOptional({ maxLength: 100, example: 'ชลบุรี' })
  @IsOptional()
  @IsString({ message: 'จังหวัดต้องเป็นข้อความ' })
  @MaxLength(100, { message: 'จังหวัดยาวเกิน 100 ตัวอักษร' })
  @Transform(trimToNull)
  province?: string | null;

  @ApiPropertyOptional({ maxLength: 10, example: '20000' })
  @IsOptional()
  @IsString({ message: 'รหัสไปรษณีย์ต้องเป็นข้อความ' })
  @MaxLength(10, { message: 'รหัสไปรษณีย์ยาวเกิน 10 ตัวอักษร' })
  @Transform(trimToNull)
  postalCode?: string | null;

  @ApiPropertyOptional({ maxLength: 30, example: '038-123-456' })
  @IsOptional()
  @IsString({ message: 'เบอร์โทรต้องเป็นข้อความ' })
  @MaxLength(30, { message: 'เบอร์โทรยาวเกิน 30 ตัวอักษร' })
  @Transform(trimToNull)
  phone?: string | null;

  @ApiPropertyOptional({ maxLength: 255, example: 'contact@example.co.th' })
  @IsOptional()
  @IsEmail({}, { message: 'รูปแบบอีเมลไม่ถูกต้อง' })
  @MaxLength(255, { message: 'อีเมลยาวเกิน 255 ตัวอักษร' })
  @Transform(trimToNull)
  email?: string | null;

  @ApiPropertyOptional({ maxLength: 255, example: 'https://example.co.th' })
  @IsOptional()
  @IsUrl({ require_tld: false }, { message: 'รูปแบบเว็บไซต์ไม่ถูกต้อง' })
  @MaxLength(255, { message: 'เว็บไซต์ยาวเกิน 255 ตัวอักษร' })
  @Transform(trimToNull)
  website?: string | null;

  @ApiPropertyOptional({ description: 'LINE Official ID ของลูกค้า', maxLength: 100 })
  @IsOptional()
  @IsString({ message: 'LINE Official ID ต้องเป็นข้อความ' })
  @MaxLength(100, { message: 'LINE Official ID ยาวเกิน 100 ตัวอักษร' })
  @Transform(trimToNull)
  lineOfficialId?: string | null;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString({ message: 'Facebook URL ต้องเป็นข้อความ' })
  @MaxLength(255, { message: 'Facebook URL ยาวเกิน 255 ตัวอักษร' })
  @Transform(trimToNull)
  facebookUrl?: string | null;

  @ApiPropertyOptional({
    enum: CustomerStatus,
    default: CustomerStatus.ACTIVE,
    description:
      'ACTIVE = ลูกค้าปัจจุบัน, INACTIVE = ไม่ได้ใช้บริการแล้ว (ยังตามเสนอ MA ได้), ' +
      'CHURNED = เลิกใช้บริการ / ไม่ติดตามต่อ — ไม่มีสถานะผู้มุ่งหวัง เพราะบันทึกเฉพาะ' +
      'ลูกค้าที่ใช้บริการจริงแล้ว',
  })
  @IsOptional()
  @IsEnum(CustomerStatus, {
    message: 'สถานะลูกค้าต้องเป็น ACTIVE, INACTIVE หรือ CHURNED',
  })
  status?: CustomerStatus;

  @ApiPropertyOptional({
    description: 'รู้จักลูกค้ารายนี้มาจากไหน',
    maxLength: 100,
    example: 'งานแสดงสินค้า',
  })
  @IsOptional()
  @IsString({ message: 'แหล่งที่มาต้องเป็นข้อความ' })
  @MaxLength(100, { message: 'แหล่งที่มายาวเกิน 100 ตัวอักษร' })
  @Transform(trimToNull)
  source?: string | null;

  @ApiPropertyOptional({
    description:
      'พนักงานที่ดูแลลูกค้ารายนี้ — เปลี่ยนคนดูแลได้โดยประวัติทั้งหมดยังอยู่ครบ ' +
      'ซึ่งเป็นปัญหาที่ระบบนี้ตั้งใจแก้ (ข้อมูลลูกค้าผูกติดกับตัวบุคคล)',
    example: 3,
  })
  @IsOptional()
  @IsInt({ message: 'ownerUserId ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ message: 'ownerUserId ต้องมากกว่า 0' })
  ownerUserId?: number | null;

  @ApiPropertyOptional({ description: 'บันทึกเพิ่มเติม' })
  @IsOptional()
  @IsString({ message: 'บันทึกต้องเป็นข้อความ' })
  @Transform(trimToNull)
  note?: string | null;
}

/**
 * แก้ไขลูกค้า — ทุกฟิลด์เป็น optional
 * `lastContactedAt` ไม่อยู่ในนี้โดยเจตนา เพราะระบบอัปเดตให้เองตอนบันทึกการติดต่อ
 * ไม่ใช่ค่าที่ผู้ใช้กรอกเอง
 */
export class UpdateCustomerDto extends PartialType(CreateCustomerDto) {}
