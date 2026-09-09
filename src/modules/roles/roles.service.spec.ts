/// <reference types="jest" />
// TypeScript 6 ไม่ดึง @types/jest เข้ามาให้อัตโนมัติ ต้องอ้างถึงตรงนี้เหมือน spec ตัวอื่น

import type { Sequelize } from 'sequelize-typescript';

import { Permission, Role, RolePermission, UserRole } from '../../models';
import { RolesService } from './roles.service';

/**
 * ดรอปดาวน์มอบบทบาท (`GET /api/roles/assignable`)
 *
 * เส้นนี้เป็นข้อยกเว้นเดียวของ RolesController ที่ ADMIN เข้าได้ ตามตาราง CLAUDE.md 4.1
 * ที่ให้ ADMIN "มอบ Role ให้ user" — จึงต้องมีเทสต์ตรึงไว้สองข้อ ไม่งั้นมันจะกลายเป็น
 * ช่องข้าม BR-10 โดยไม่มีใครสังเกต
 *
 *   1. คืนเฉพาะบทบาทที่ยังเปิดใช้งาน (ให้ตรงกับที่ UsersService.resolveRoleIds ยอมรับ)
 *   2. คืนเฉพาะ id / ชื่อ / คำอธิบาย — ห้ามมีรายการสิทธิ์ที่ติ๊กไว้หลุดออกไป
 *
 * ส่วนการพิสูจน์ว่า ADMIN ผ่าน guard จริงอยู่ที่ `test/permissions.e2e-spec.ts`
 * เพราะเป็นเรื่องของ decorator กับ guard ซึ่ง mock ระดับ service พิสูจน์แทนไม่ได้
 */

interface ModelMock {
  findAll: jest.Mock;
}

function modelMock(): ModelMock {
  return { findAll: jest.fn() };
}

function roleRow(overrides: Record<string, unknown> = {}): Role {
  return {
    id: 3,
    name: 'ฝ่ายซัพพอร์ต',
    description: 'ดูแลใบแจ้งปัญหาและงานติดตาม',
    isSystem: false,
    isActive: true,
    ...overrides,
  } as unknown as Role;
}

describe('RolesService.findAssignable', () => {
  let roleModel: ModelMock;
  let service: RolesService;

  beforeEach(() => {
    roleModel = modelMock();
    roleModel.findAll.mockResolvedValue([roleRow()]);

    service = new RolesService(
      roleModel as unknown as typeof Role,
      modelMock() as unknown as typeof Permission,
      modelMock() as unknown as typeof UserRole,
      modelMock() as unknown as typeof RolePermission,
      {} as unknown as Sequelize,
    );
  });

  it('กรองเฉพาะบทบาทที่ยังเปิดใช้งาน', async () => {
    // ถ้าคืนบทบาทที่ปิดอยู่มาด้วย ผู้ใช้จะเลือกได้แล้วโดนปฏิเสธตอนกดบันทึก
    // เพราะ UsersService.resolveRoleIds() ไม่ยอมรับบทบาทที่ isActive = false
    let captured: { where: { isActive: boolean } } = { where: { isActive: false } };
    roleModel.findAll.mockImplementation((options: { where: { isActive: boolean } }) => {
      captured = options;
      return Promise.resolve([]);
    });

    await service.findAssignable();

    expect(captured.where).toEqual({ isActive: true });
  });

  it('คืนแค่ 3 ฟิลด์ ไม่มีสิทธิ์ที่ติ๊กไว้ติดออกไปด้วย (BR-10)', async () => {
    // นี่คือเส้นแบ่งระหว่าง "เลือกบทบาทได้" กับ "ดูได้ว่าบทบาทนั้นมีสิทธิ์อะไร"
    // อย่างหลังสงวนไว้ให้ SUPER_ADMIN ที่ GET /api/roles เท่านั้น
    const roles = await service.findAssignable();

    expect(Object.keys(roles[0]).sort()).toEqual(['description', 'id', 'name']);
  });

  it('ไม่ query คอลัมน์ที่ไม่ได้ใช้ออกมาตั้งแต่แรก', async () => {
    let captured: { attributes: string[] } = { attributes: [] };
    roleModel.findAll.mockImplementation((options: { attributes: string[] }) => {
      captured = options;
      return Promise.resolve([]);
    });

    await service.findAssignable();

    expect(captured.attributes).toEqual(['id', 'name', 'description']);
  });

  it('เรียงตามชื่อ เพื่อให้ดรอปดาวน์ลำดับคงที่ทุกครั้ง', async () => {
    let captured: { order: [string, string][] } = { order: [] };
    roleModel.findAll.mockImplementation((options: { order: [string, string][] }) => {
      captured = options;
      return Promise.resolve([]);
    });

    await service.findAssignable();

    expect(captured.order[0]).toEqual(['name', 'ASC']);
  });
});
