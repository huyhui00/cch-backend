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

/**
 * ระบุสิทธิ์ที่ต้องมีเพื่อเรียก endpoint นี้
 *
 *   @RequirePermission('customer.view')
 *   @RequirePermission('ticket.resolve', 'ticket.close')   // มีอย่างใดอย่างหนึ่งก็พอ
 *
 * ใส่หลายค่าได้ ความหมายคือ OR — ผู้ใช้มีสิทธิ์ตัวใดตัวหนึ่งก็ผ่าน
 * ถ้าต้องการเงื่อนไข AND ให้แยกเป็นการตรวจใน service แทน อย่าใส่รวมกันตรงนี้
 *
 * ใช้กับ class ก็ได้ ถ้าทั้ง controller ใช้สิทธิ์เดียวกัน แต่ค่าที่ประกาศ
 * ที่ระดับ method จะทับค่าที่ระดับ class เสมอ
 */
export const RequirePermission = (...permissions: string[]) =>
  SetMetadata(PERMISSION_KEY, permissions);
