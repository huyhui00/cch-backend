import { ApiProperty } from '@nestjs/swagger';

import { AccountType, User, UserStatus } from '../../../models';
import { RoleSummaryDto, toRoleSummary } from '../../roles/dto/role.response';
import { avatarUrlFor } from '../avatar.util';

/**
 * รูปแบบข้อมูลผู้ใช้ที่ส่งออกทุกที่
 * ห้ามส่ง password_hash หรือ refresh_token_hash ออกไปเด็ดขาด
 * จึงประกอบ object ขึ้นมาเองทีละฟิลด์ ไม่ใช้ toJSON() ของ Sequelize
 */
export class UserResponseDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ nullable: true, example: 'EMP-001' })
  employeeCode: string | null;

  @ApiProperty({ example: 'somchai' })
  username: string;

  @ApiProperty({ nullable: true, example: 'somchai@example.com' })
  email: string | null;

  @ApiProperty({ example: 'สมชาย ใจดี' })
  fullName: string;

  @ApiProperty({ nullable: true, example: 'ชาย' })
  nickname: string | null;

  @ApiProperty({ nullable: true, example: '081-234-5678' })
  phone: string | null;

  @ApiProperty({ nullable: true, example: 'Support Engineer' })
  position: string | null;

  @ApiProperty({
    nullable: true,
    description: 'รูปที่อัปโหลดผ่านระบบ = /api/users/:id/avatar ต้องดึงพร้อม Authorization header',
  })
  avatarUrl: string | null;

  @ApiProperty({ nullable: true, description: 'ใช้ส่งแจ้งเตือนภายในเท่านั้น (BR-11)' })
  lineUserId: string | null;

  @ApiProperty({ enum: AccountType })
  accountType: AccountType;

  @ApiProperty({ enum: UserStatus })
  status: UserStatus;

  @ApiProperty({ nullable: true })
  lastLoginAt: Date | null;

  @ApiProperty({
    type: [RoleSummaryDto],
    description: 'role ที่ถืออยู่ จะมีค่าเฉพาะ endpoint ที่ include roles มาด้วย',
  })
  roles: RoleSummaryDto[];

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export function toUserResponse(user: User): UserResponseDto {
  return {
    id: user.id,
    employeeCode: user.employeeCode,
    username: user.username,
    email: user.email,
    fullName: user.fullName,
    nickname: user.nickname,
    phone: user.phone,
    position: user.position,
    avatarUrl: avatarUrlFor(user),
    lineUserId: user.lineUserId,
    accountType: user.accountType,
    status: user.status,
    lastLoginAt: user.lastLoginAt,
    roles: (user.roles ?? []).map(toRoleSummary),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export class AssignableUserDto {
  @ApiProperty({ example: 4 })
  id: number;

  @ApiProperty({ example: 'somchai' })
  username: string;

  @ApiProperty({ example: 'สมชาย ใจดี' })
  fullName: string;

  @ApiProperty({ nullable: true, example: 'หัวหน้าทีมพัฒนา' })
  position: string | null;
}
