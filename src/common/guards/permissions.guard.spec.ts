/// <reference types="jest" />
// TypeScript 6 ไม่ดึง @types/jest เข้ามาให้อัตโนมัติเหมือนรุ่นก่อน และ tsconfig.json
// ไม่ได้ระบุ types ไว้ จึงอ้างถึงตรงนี้แทนการไปแก้ config ทั้งโปรเจกต์

import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AccountType } from '../../models';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PERMISSION_KEY } from '../decorators/require-permission.decorator';
import type { AccessControlService } from '../services/access-control.service';
import type { AuthenticatedUser } from '../types/auth.types';
import { PermissionsGuard } from './permissions.guard';

/**
 * ทดสอบตรรกะการตัดสินใจล้วน ๆ ตาม CLAUDE.md 9.4
 * ไม่แตะฐานข้อมูล — AccessControlService ถูกแทนด้วย mock ที่คืนสิทธิ์ตามที่กำหนดไว้
 */

/** จำลอง handler ที่ประกาศ @RequirePermission(...) ไว้ */
function createContext(user?: AuthenticatedUser): ExecutionContext {
  const request: { user?: AuthenticatedUser } = user ? { user } : {};

  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
  } as unknown as ExecutionContext;
}

/**
 * Reflector ตัวจริงอ่าน metadata จาก decorator ซึ่งผูกกับ handler จริง
 * ในเทสต์เราสนใจแค่ "guard ทำอะไรเมื่อได้ค่านี้มา" จึงป้อนค่าตรง ๆ ตาม key ที่ถูกถาม
 */
function createReflectorFor(required: string[] | undefined, isPublic = false): Reflector {
  const values: Record<string, unknown> = {
    [IS_PUBLIC_KEY]: isPublic,
    [PERMISSION_KEY]: required,
  };

  return {
    getAllAndOverride: jest.fn((key: string) => values[key]),
  } as unknown as Reflector;
}

/** AccessControlService ปลอมที่คืน union ของสิทธิ์จากทุก role ตามที่กำหนดให้ */
function createAccessControl(rolePermissions: string[][]): {
  service: AccessControlService;
  findPermissionCodes: jest.Mock;
} {
  const union = new Set(rolePermissions.flat());
  const findPermissionCodes = jest.fn().mockResolvedValue(union);

  return {
    service: { findPermissionCodes } as unknown as AccessControlService,
    findPermissionCodes,
  };
}

function createGuard(
  required: string[] | undefined,
  rolePermissions: string[][] = [],
  isPublic = false,
) {
  const { service, findPermissionCodes } = createAccessControl(rolePermissions);
  const guard = new PermissionsGuard(createReflectorFor(required, isPublic), service);

  return { guard, findPermissionCodes };
}

const superAdmin: AuthenticatedUser = {
  id: 1,
  username: 'superadmin',
  accountType: AccountType.SUPER_ADMIN,
};

const admin: AuthenticatedUser = { id: 2, username: 'admin', accountType: AccountType.ADMIN };

const staff: AuthenticatedUser = { id: 3, username: 'somchai', accountType: AccountType.USER };

describe('PermissionsGuard', () => {
  describe('1. SUPER_ADMIN เข้าได้ทุกอย่าง', () => {
    it('ผ่านสิทธิ์ทั่วไปโดยไม่ต้องผูก role', async () => {
      const { guard, findPermissionCodes } = createGuard(['customer.view']);

      await expect(guard.canActivate(createContext(superAdmin))).resolves.toBe(true);

      // bypass ตั้งแต่ต้น ไม่ต้องแตะฐานข้อมูลเลย (CLAUDE.md 4.1)
      expect(findPermissionCodes).not.toHaveBeenCalled();
    });

    it('ผ่าน role.manage ซึ่งเป็นสิทธิ์ที่สงวนไว้ให้ระดับนี้เท่านั้น', async () => {
      const { guard } = createGuard(['role.manage']);

      await expect(guard.canActivate(createContext(superAdmin))).resolves.toBe(true);
    });

    it('ผ่านแม้ไม่มี role ใดให้สิทธิ์นั้นเลย', async () => {
      const { guard } = createGuard(['ticket.resolve'], [[]]);

      await expect(guard.canActivate(createContext(superAdmin))).resolves.toBe(true);
    });
  });

  describe('2. ADMIN เข้า role.manage ไม่ได้', () => {
    it('ถูกปฏิเสธแม้เป็น ADMIN (BR-10)', async () => {
      const { guard } = createGuard(['role.manage']);

      await expect(guard.canActivate(createContext(admin))).rejects.toThrow(ForbiddenException);
    });

    it('ถูกปฏิเสธแม้มี role ที่ถูกติ๊ก role.manage ไว้', async () => {
      const { guard, findPermissionCodes } = createGuard(['role.manage'], [['role.manage']]);

      await expect(guard.canActivate(createContext(admin))).rejects.toThrow(
        'เฉพาะผู้ดูแลระบบสูงสุดเท่านั้นที่จัดการส่วนนี้ได้',
      );

      // ตัดสินได้โดยไม่ต้องดูสิทธิ์ที่ถืออยู่ เพราะสิทธิ์นี้ผูกกับ account_type
      expect(findPermissionCodes).not.toHaveBeenCalled();
    });

    it('USER ที่มี role ติ๊ก role.manage ไว้ก็ยังไม่ผ่านเช่นกัน', async () => {
      const { guard } = createGuard(['role.manage'], [['role.manage', 'user.view']]);

      await expect(guard.canActivate(createContext(staff))).rejects.toThrow(ForbiddenException);
    });

    it('ADMIN ยังใช้สิทธิ์ปกติได้ตามที่ role กำหนด', async () => {
      const { guard } = createGuard(['user.view'], [['user.view']]);

      await expect(guard.canActivate(createContext(admin))).resolves.toBe(true);
    });
  });

  describe('3. USER ที่มี 2 roles ได้สิทธิ์ union', () => {
    // เคสจริงตาม CLAUDE.md 4.2 — พนักงานคนหนึ่งทำทั้ง Support และ Marketing
    const supportRole = ['ticket.view', 'ticket.resolve'];
    const marketingRole = ['customer.view', 'customer.create'];

    it('ผ่านสิทธิ์ที่มาจาก role แรก', async () => {
      const { guard } = createGuard(['ticket.resolve'], [supportRole, marketingRole]);

      await expect(guard.canActivate(createContext(staff))).resolves.toBe(true);
    });

    it('ผ่านสิทธิ์ที่มาจาก role ที่สอง', async () => {
      const { guard } = createGuard(['customer.create'], [supportRole, marketingRole]);

      await expect(guard.canActivate(createContext(staff))).resolves.toBe(true);
    });

    it('ถูกปฏิเสธสิทธิ์ที่ไม่มีอยู่ในทั้งสอง role', async () => {
      const { guard } = createGuard(['ma.create'], [supportRole, marketingRole]);

      await expect(guard.canActivate(createContext(staff))).rejects.toThrow(ForbiddenException);
    });

    it('มีสิทธิ์อย่างน้อยหนึ่งตัวจากที่ระบุไว้ก็ผ่าน', async () => {
      const { guard } = createGuard(['ma.create', 'customer.view'], [supportRole, marketingRole]);

      await expect(guard.canActivate(createContext(staff))).resolves.toBe(true);
    });
  });

  describe('4. USER ที่ไม่มีสิทธิ์ถูกปฏิเสธ', () => {
    it('ไม่มี role เลย', async () => {
      const { guard } = createGuard(['customer.view'], []);

      await expect(guard.canActivate(createContext(staff))).rejects.toThrow(
        'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้',
      );
    });

    it('มี role แต่ไม่มีสิทธิ์ที่ต้องการ', async () => {
      const { guard } = createGuard(['customer.delete'], [['customer.view']]);

      await expect(guard.canActivate(createContext(staff))).rejects.toThrow(ForbiddenException);
    });

    it('สิทธิ์ที่ใกล้เคียงกันไม่ถือว่าผ่าน', async () => {
      const { guard } = createGuard(['customer.view'], [['customer.viewer']]);

      await expect(guard.canActivate(createContext(staff))).rejects.toThrow(ForbiddenException);
    });
  });

  describe('กรณีอื่นที่ guard ต้องจัดการ', () => {
    it('endpoint ที่ไม่ได้ประกาศ @RequirePermission ผ่านได้เมื่อล็อกอินแล้ว', async () => {
      const { guard, findPermissionCodes } = createGuard(undefined);

      await expect(guard.canActivate(createContext(staff))).resolves.toBe(true);
      expect(findPermissionCodes).not.toHaveBeenCalled();
    });

    it('ประกาศ @RequirePermission ไว้แต่ไม่ใส่ค่าใด ๆ ก็ผ่าน', async () => {
      const { guard } = createGuard([]);

      await expect(guard.canActivate(createContext(staff))).resolves.toBe(true);
    });

    it('endpoint ที่ติด @Public() ผ่านโดยไม่ต้องมีผู้ใช้', async () => {
      const { guard } = createGuard(['customer.view'], [], true);

      await expect(guard.canActivate(createContext())).resolves.toBe(true);
    });

    it('ไม่มีผู้ใช้ใน request แต่ต้องการสิทธิ์ ตอบ 401 ไม่ใช่ 403', async () => {
      const { guard } = createGuard(['customer.view']);

      await expect(guard.canActivate(createContext())).rejects.toThrow(UnauthorizedException);
    });
  });
});
