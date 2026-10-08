import { ApiProperty } from '@nestjs/swagger';

import { AccountType, UserStatus } from '../../../models';
import { RoleSummaryDto } from '../../roles/dto/role.response';

export class AuthProfileDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'superadmin' })
  username: string;

  @ApiProperty({ example: 'ผู้ดูแลระบบ' })
  fullName: string;

  @ApiProperty({ nullable: true, example: 'ตูน' })
  nickname: string | null;

  @ApiProperty({ nullable: true, example: 'admin@example.com' })
  email: string | null;

  @ApiProperty({ nullable: true, example: 'ผู้ดูแลระบบสูงสุด' })
  position: string | null;

  @ApiProperty({
    nullable: true,
    example: '/api/users/1/avatar?v=3f2a9c1e',
    description:
      'path ของ API — ดึงเป็น blob พร้อม Authorization header ใช้ <img src> ตรง ๆ ไม่ได้ ' +
      '· ?v= เปลี่ยนทุกครั้งที่อัปโหลดรูปใหม่',
  })
  avatarUrl: string | null;

  @ApiProperty({ enum: AccountType, example: AccountType.SUPER_ADMIN })
  accountType: AccountType;

  @ApiProperty({ enum: UserStatus, example: UserStatus.ACTIVE })
  status: UserStatus;

  @ApiProperty({
    description: 'true เมื่อ accountType = SUPER_ADMIN — ผ่านทุกสิทธิ์โดยไม่ต้องผูก role',
    example: true,
  })
  isSuperAdmin: boolean;

  @ApiProperty({
    type: [RoleSummaryDto],
    description: 'role ที่ถืออยู่ทั้งหมด (SUPER_ADMIN จะเป็น array ว่างเพราะไม่ต้องผูก role)',
  })
  roles: RoleSummaryDto[];

  @ApiProperty({
    type: [String],
    description:
      'สิทธิ์ที่ใช้ได้จริง = union ของทุก role เรียงตามตัวอักษร ' +
      'กรณี SUPER_ADMIN จะได้รายการสิทธิ์ทั้งระบบ เพื่อให้เมนูที่เห็นตรงกับสิ่งที่กดได้',
    example: ['customer.view', 'ticket.resolve'],
  })
  permissions: string[];
}

export class LoginResponseDto {
  @ApiProperty({ description: 'ใช้แนบใน header Authorization: Bearer <token>' })
  accessToken: string;

  @ApiProperty({ description: 'ใช้ขอ access token ใบใหม่ที่ POST /api/auth/refresh' })
  refreshToken: string;

  @ApiProperty({ example: 'Bearer' })
  tokenType: string;

  @ApiProperty({ type: AuthProfileDto })
  user: AuthProfileDto;
}

export class RefreshResponseDto {
  @ApiProperty()
  accessToken: string;

  @ApiProperty({ description: 'refresh token ใบใหม่ — ใบเดิมใช้ไม่ได้อีกทันที' })
  refreshToken: string;

  @ApiProperty({ example: 'Bearer' })
  tokenType: string;
}
