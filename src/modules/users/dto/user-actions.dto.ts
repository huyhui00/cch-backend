import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsPositive,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

import { UserStatus } from '../../../models';
import {
  MAX_PASSWORD_LENGTH,
  MAX_ROLES_PER_USER,
  MIN_PASSWORD_LENGTH,
  ROLE_LIMIT_MESSAGE,
} from './create-user.dto';

/**
 * ผูก role ส่ง array ว่าง = ถอด role ออก
 * ถือได้อันเดียว (CLAUDE.md 4.2) แต่ยังรับเป็น array เพื่อไม่เปลี่ยนสัญญากับ frontend
 */
export class AssignRolesDto {
  @ApiProperty({
    type: [Number],
    description:
      'id ของ role ที่ผู้ใช้คนนี้ควรถือ (ค่าที่ส่งมาคือผลลัพธ์สุดท้าย) — ส่งได้ไม่เกิน 1 ตัว',
    maxItems: MAX_ROLES_PER_USER,
    example: [2],
  })
  @IsArray({ message: 'roleIds ต้องเป็น array' })
  @ArrayMaxSize(MAX_ROLES_PER_USER, { message: ROLE_LIMIT_MESSAGE })
  @ArrayUnique({ message: 'roleIds ห้ามมีค่าซ้ำ' })
  @IsInt({ each: true, message: 'roleIds ต้องเป็นจำนวนเต็ม' })
  @IsPositive({ each: true, message: 'roleIds ต้องมากกว่า 0' })
  roleIds: number[];
}

export class UpdateUserStatusDto {
  @ApiProperty({
    enum: UserStatus,
    description:
      'ห้ามลบผู้ใช้ทิ้ง ให้เปลี่ยนเป็น RESIGNED แทน (BR-09) ' +
      'สถานะที่ไม่ใช่ ACTIVE จะล็อกอินไม่ได้ และ session ที่ค้างอยู่ถูกตัดทันที',
    example: UserStatus.RESIGNED,
  })
  @IsEnum(UserStatus, { message: 'สถานะต้องเป็น ACTIVE, SUSPENDED หรือ RESIGNED' })
  status: UserStatus;
}

export class ChangePasswordDto {
  @ApiProperty({ description: 'รหัสผ่านปัจจุบัน' })
  @IsString({ message: 'รหัสผ่านปัจจุบันต้องเป็นข้อความ' })
  @IsNotEmpty({ message: 'กรุณากรอกรหัสผ่านปัจจุบัน' })
  @MaxLength(MAX_PASSWORD_LENGTH, { message: 'รหัสผ่านยาวเกินกำหนด' })
  currentPassword: string;

  @ApiProperty({
    description: 'รหัสผ่านใหม่ ยาว 8-72 ตัวอักษร',
    minLength: MIN_PASSWORD_LENGTH,
    maxLength: MAX_PASSWORD_LENGTH,
  })
  @IsString({ message: 'รหัสผ่านใหม่ต้องเป็นข้อความ' })
  @MinLength(MIN_PASSWORD_LENGTH, { message: 'รหัสผ่านใหม่ต้องยาวอย่างน้อย 8 ตัวอักษร' })
  @MaxLength(MAX_PASSWORD_LENGTH, { message: 'รหัสผ่านใหม่ต้องยาวไม่เกิน 72 ตัวอักษร' })
  newPassword: string;
}

/**
 * ผู้ดูแลตั้งรหัสใหม่ให้พนักงานที่ลืม — ไม่ต้องรู้รหัสเดิม
 * ไม่มีลิงก์สาธารณะและไม่ส่งรหัสออกนอกระบบ (ไม่มีอีเมล)
 */
export class ResetPasswordDto {
  @ApiProperty({
    description: 'รหัสผ่านใหม่ที่ผู้ดูแลตั้งให้ ยาว 8-72 ตัวอักษร',
    minLength: MIN_PASSWORD_LENGTH,
    maxLength: MAX_PASSWORD_LENGTH,
    example: 'TempPassw0rd!',
  })
  @IsString({ message: 'รหัสผ่านใหม่ต้องเป็นข้อความ' })
  @MinLength(MIN_PASSWORD_LENGTH, { message: 'รหัสผ่านใหม่ต้องยาวอย่างน้อย 8 ตัวอักษร' })
  @MaxLength(MAX_PASSWORD_LENGTH, { message: 'รหัสผ่านใหม่ต้องยาวไม่เกิน 72 ตัวอักษร' })
  newPassword: string;
}
