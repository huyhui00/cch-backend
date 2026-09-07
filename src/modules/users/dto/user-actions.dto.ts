import { ApiProperty } from '@nestjs/swagger';
import {
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
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from './create-user.dto';

/** ผูก role ทั้งชุด ส่ง array ว่าง = ถอด role ทั้งหมดออก */
export class AssignRolesDto {
  @ApiProperty({
    type: [Number],
    description: 'id ของ role ทั้งหมดที่ผู้ใช้คนนี้ควรถือ (ค่าที่ส่งมาคือผลลัพธ์สุดท้าย)',
    example: [2, 3],
  })
  @IsArray({ message: 'roleIds ต้องเป็น array' })
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
