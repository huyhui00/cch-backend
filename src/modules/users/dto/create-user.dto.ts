import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

import { AccountType } from '../../../models';

/** ความยาวขั้นต่ำของรหัสผ่านผู้ใช้ทั่วไป (บัญชี SUPER_ADMIN บังคับ 12 ตั้งแต่ตอน seed) */
export const MIN_PASSWORD_LENGTH = 8;

/** bcrypt ตัด input ทิ้งที่ 72 ไบต์ ตัดตั้งแต่ชั้น validation จะได้ไม่เข้าใจผิดกันภายหลัง */
export const MAX_PASSWORD_LENGTH = 72;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

const trimToNull = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export class CreateUserDto {
  @ApiProperty({
    description: 'ชื่อผู้ใช้สำหรับล็อกอิน ห้ามซ้ำ',
    maxLength: 100,
    example: 'somchai',
  })
  @IsString({ message: 'ชื่อผู้ใช้ต้องเป็นข้อความ' })
  @IsNotEmpty({ message: 'กรุณากรอกชื่อผู้ใช้' })
  @MaxLength(100, { message: 'ชื่อผู้ใช้ยาวเกิน 100 ตัวอักษร' })
  @Transform(trim)
  username: string;

  @ApiProperty({
    description: 'รหัสผ่านเริ่มต้น ยาว 8-72 ตัวอักษร',
    minLength: MIN_PASSWORD_LENGTH,
    maxLength: MAX_PASSWORD_LENGTH,
    example: 'Passw0rd!2569',
  })
  @IsString({ message: 'รหัสผ่านต้องเป็นข้อความ' })
  @MinLength(MIN_PASSWORD_LENGTH, {
    message: 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร',
  })
  @MaxLength(MAX_PASSWORD_LENGTH, {
    message: 'รหัสผ่านต้องยาวไม่เกิน 72 ตัวอักษร',
  })
  password: string;

  @ApiProperty({ description: 'ชื่อ-นามสกุล', maxLength: 255, example: 'สมชาย ใจดี' })
  @IsString({ message: 'ชื่อ-นามสกุลต้องเป็นข้อความ' })
  @IsNotEmpty({ message: 'กรุณากรอกชื่อ-นามสกุล' })
  @MaxLength(255, { message: 'ชื่อ-นามสกุลยาวเกิน 255 ตัวอักษร' })
  @Transform(trim)
  fullName: string;

  @ApiPropertyOptional({ description: 'รหัสพนักงาน ห้ามซ้ำ', maxLength: 50, example: 'EMP-001' })
  @IsOptional()
  @IsString({ message: 'รหัสพนักงานต้องเป็นข้อความ' })
  @MaxLength(50, { message: 'รหัสพนักงานยาวเกิน 50 ตัวอักษร' })
  @Transform(trimToNull)
  employeeCode?: string | null;

  @ApiPropertyOptional({ description: 'อีเมล ห้ามซ้ำ', maxLength: 255 })
  @IsOptional()
  @IsEmail({}, { message: 'รูปแบบอีเมลไม่ถูกต้อง' })
  @MaxLength(255, { message: 'อีเมลยาวเกิน 255 ตัวอักษร' })
  @Transform(trimToNull)
  email?: string | null;

  @ApiPropertyOptional({ maxLength: 100, example: 'ชาย' })
  @IsOptional()
  @IsString({ message: 'ชื่อเล่นต้องเป็นข้อความ' })
  @MaxLength(100, { message: 'ชื่อเล่นยาวเกิน 100 ตัวอักษร' })
  @Transform(trimToNull)
  nickname?: string | null;

  @ApiPropertyOptional({ maxLength: 30, example: '081-234-5678' })
  @IsOptional()
  @IsString({ message: 'เบอร์โทรต้องเป็นข้อความ' })
  @MaxLength(30, { message: 'เบอร์โทรยาวเกิน 30 ตัวอักษร' })
  @Transform(trimToNull)
  phone?: string | null;

  @ApiPropertyOptional({ maxLength: 150, example: 'Support Engineer' })
  @IsOptional()
  @IsString({ message: 'ตำแหน่งต้องเป็นข้อความ' })
  @MaxLength(150, { message: 'ตำแหน่งยาวเกิน 150 ตัวอักษร' })
  @Transform(trimToNull)
  position?: string | null;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString({ message: 'avatarUrl ต้องเป็นข้อความ' })
  @MaxLength(500, { message: 'avatarUrl ยาวเกิน 500 ตัวอักษร' })
  @Transform(trimToNull)
  avatarUrl?: string | null;

  @ApiPropertyOptional({
    maxLength: 100,
    description: 'LINE user id ของพนักงาน ใช้ส่งแจ้งเตือนภายในเท่านั้น (BR-11)',
  })
  @IsOptional()
  @IsString({ message: 'lineUserId ต้องเป็นข้อความ' })
  @MaxLength(100, { message: 'lineUserId ยาวเกิน 100 ตัวอักษร' })
  @Transform(trimToNull)
  lineUserId?: string | null;

  @ApiPropertyOptional({
    enum: AccountType,
    default: AccountType.USER,
    description:
      'สร้างบัญชี ADMIN ได้เฉพาะ SUPER_ADMIN และ ADMIN ส่วน SUPER_ADMIN สร้างได้โดย SUPER_ADMIN เท่านั้น (CLAUDE.md 4.1)',
  })
  @IsOptional()
  @IsEnum(AccountType, { message: 'ระดับบัญชีต้องเป็น SUPER_ADMIN, ADMIN หรือ USER' })
  accountType?: AccountType;

  @ApiPropertyOptional({
    type: [Number],
    description: 'ผูก role ให้เลยตอนสร้างก็ได้ ถือได้หลาย role พร้อมกัน (CLAUDE.md 4.2)',
    example: [2, 3],
  })
  @IsOptional()
  @IsArray({ message: 'roleIds ต้องเป็น array' })
  @ArrayUnique({ message: 'roleIds ห้ามมีค่าซ้ำ' })
  @IsInt({ each: true, message: 'roleIds ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ each: true, message: 'roleIds ต้องมากกว่า 0' })
  roleIds?: number[];
}

/**
 * แก้ไขข้อมูลผู้ใช้ — ไม่รวม username, password และ roleIds
 *   username  เปลี่ยนไม่ได้ เพราะเป็นตัวอ้างอิงใน audit log ย้อนหลัง
 *   password  เปลี่ยนผ่าน PATCH /api/users/me/password เท่านั้น
 *   roleIds   ผูก/ถอดผ่าน PUT /api/users/:id/roles เท่านั้น
 */
export class UpdateUserDto extends PartialType(
  OmitType(CreateUserDto, ['username', 'password', 'roleIds'] as const),
) {}
