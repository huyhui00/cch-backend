import { SetMetadata } from '@nestjs/common';

export const PERMISSION_KEY = 'requiredPermissions';

/**
 * สิทธิ์ที่ผูกกับ users.account_type ไม่ใช่สิ่งที่ติ๊กให้ role ได้ (BR-10)
 *
 * PermissionsGuard ปฏิเสธทุกคนที่ไม่ใช่ SUPER_ADMIN เมื่อเจอ code ในชุดนี้
 * ต่อให้ Super Admin เผลอติ๊กให้ role ไหนไว้ก็ไม่มีผล
 *
 * ทั้งสามตัวมาจากตาราง CLAUDE.md 4.1 ที่ระบุว่า ADMIN สร้าง/แก้บทบาทไม่ได้
 * และดูรายการสิทธิ์ทั้งหมดไม่ได้ ชุดนี้ถูกใช้สองที่ — กันที่ guard และตัดออกจาก
 * รายการสิทธิ์ที่ /auth/me คืนให้ ADMIN เพื่อไม่ให้ frontend วาดเมนูที่กดแล้วเจอ 403
 */
export const SUPER_ADMIN_ONLY_PERMISSIONS: ReadonlySet<string> = new Set<string>([
  'role.manage',
  'role.view',
  'permission.view',
]);

export const RequirePermission = (...permissions: string[]) =>
  SetMetadata(PERMISSION_KEY, permissions);
