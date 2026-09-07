import { ApiProperty } from '@nestjs/swagger';

import { Permission, Role } from '../../../models';
import { SUPER_ADMIN_ONLY_PERMISSIONS } from '../../../common/decorators/require-permission.decorator';

export class RoleSummaryDto {
  @ApiProperty({ example: 3 })
  id: number;

  @ApiProperty({ example: 'ฝ่ายซัพพอร์ต' })
  name: string;

  @ApiProperty({ nullable: true, example: 'ดูแลใบแจ้งปัญหาและงานติดตาม' })
  description: string | null;
}

export class PermissionItemDto {
  @ApiProperty({ example: 12 })
  id: number;

  @ApiProperty({ example: 'customer.view' })
  code: string;

  @ApiProperty({ example: 'customer' })
  module: string;

  @ApiProperty({ example: 'view' })
  action: string;

  @ApiProperty({ nullable: true, example: 'ดูลูกค้า' })
  description: string | null;

  @ApiProperty({
    description:
      'true = สิทธิ์นี้ผูกกับบัญชี SUPER_ADMIN ตาม BR-10 ติ๊กให้ role ไม่ได้ ' +
      'ให้ frontend แสดงเป็น checkbox ที่ disable ไว้',
    example: false,
  })
  superAdminOnly: boolean;
}

export class RoleDetailDto extends RoleSummaryDto {
  @ApiProperty({ description: 'role ที่ระบบสร้างให้ตอน seed — ลบไม่ได้', example: false })
  isSystem: boolean;

  @ApiProperty({ description: 'ปิดไว้ชั่วคราวได้โดยไม่ต้องลบ role ที่ปิดจะไม่ให้สิทธิ์ใด ๆ' })
  isActive: boolean;

  @ApiProperty({ description: 'จำนวนผู้ใช้ที่ถือ role นี้อยู่', example: 4 })
  userCount: number;

  @ApiProperty({ type: [PermissionItemDto], description: 'สิทธิ์ที่ติ๊กไว้กับ role นี้' })
  permissions: PermissionItemDto[];

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

/** รายการสิทธิ์ทั้งหมดจัดกลุ่มตาม module — จัดรูปมาให้พร้อมวาดหน้าติ๊กสิทธิ์แล้ว */
export class PermissionGroupDto {
  @ApiProperty({ example: 'customer' })
  module: string;

  @ApiProperty({ type: [PermissionItemDto] })
  permissions: PermissionItemDto[];
}

export function toPermissionItem(permission: Permission): PermissionItemDto {
  return {
    id: permission.id,
    code: permission.code,
    module: permission.module,
    action: permission.action,
    description: permission.description,
    superAdminOnly: SUPER_ADMIN_ONLY_PERMISSIONS.has(permission.code),
  };
}

export function toRoleSummary(role: Role): RoleSummaryDto {
  return { id: role.id, name: role.name, description: role.description };
}

export function toRoleDetail(role: Role, userCount: number): RoleDetailDto {
  return {
    ...toRoleSummary(role),
    isSystem: role.isSystem,
    isActive: role.isActive,
    userCount,
    permissions: (role.permissions ?? []).map(toPermissionItem),
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };
}
