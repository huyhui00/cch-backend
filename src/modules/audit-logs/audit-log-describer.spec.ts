/// <reference types="jest" />
import { AuditAction } from '../../models';
import {
  type AuditRefLabels,
  type DescribableAuditLog,
  describeAuditLog,
} from './audit-log-describer';

const refs: AuditRefLabels = new Map([
  ['tickets', new Map([[58, 'TK69-0058']])],
  ['ticket_resolutions', new Map([[70, 'TK69-0058 รอบที่ 2']])],
  ['users', new Map([[4, 'วิชัย ตั้งใจ']])],
  ['projects', new Map([[3, 'PRJ69-0003 Lanterns']])],
]);

function log(overrides: Partial<DescribableAuditLog>): DescribableAuditLog {
  return {
    action: AuditAction.UPDATE,
    tableName: 'tickets',
    recordId: 58,
    oldValue: null,
    newValue: null,
    ...overrides,
  };
}

describe('describeAuditLog', () => {
  it('ใบแจ้งปัญหาที่แก้เสร็จได้ประโยคตามขั้นงาน พร้อมรหัสใบ', () => {
    const result = describeAuditLog(
      log({
        oldValue: { status: 'IN_PROGRESS', resolutionCount: 0, updatedBy: 3 },
        newValue: { status: 'RESOLVED', resolutionCount: 1, updatedBy: 4 },
      }),
      refs,
    );

    expect(result.tableLabel).toBe('ใบแจ้งปัญหา');
    expect(result.summary).toBe('แก้ใบ TK69-0058 เสร็จ รอแอดมินตรวจ');
    expect(result.changes).toEqual([
      { field: 'status', label: 'สถานะ', from: 'กำลังดำเนินการ', to: 'แก้ไขแล้ว' },
      { field: 'resolutionCount', label: 'จำนวนรอบการแก้ไข', from: '0', to: '1' },
    ]);
  });

  it('แยกการตีกลับ (RESOLVED → IN_PROGRESS) ออกจากการเริ่มงาน', () => {
    const rejected = describeAuditLog(
      log({ oldValue: { status: 'RESOLVED' }, newValue: { status: 'IN_PROGRESS' } }),
      refs,
    );
    const started = describeAuditLog(
      log({ oldValue: { status: 'ASSIGNED' }, newValue: { status: 'IN_PROGRESS' } }),
      refs,
    );

    expect(rejected.summary).toBe('ตรวจไม่ผ่าน ตีกลับใบ TK69-0058 ให้ผู้แก้ทำต่อ');
    expect(started.summary).toBe('เริ่มแก้ใบ TK69-0058');
  });

  it('ตัดฟิลด์ของระบบและ where ออก และแปลงผู้ใช้เป็นชื่อ', () => {
    const result = describeAuditLog(
      log({
        oldValue: { assignedUserId: null, updatedAt: 'x', where: {} },
        newValue: { status: 'ASSIGNED', assignedUserId: 4, updatedAt: 'y', id: 1 },
      }),
      refs,
    );

    expect(result.summary).toBe('มอบหมายใบ TK69-0058 ให้ วิชัย ตั้งใจ');
    expect(result.changes.map((c) => c.field)).toEqual(['assignedUserId', 'status']);
    expect(result.changes[0].to).toBe('วิชัย ตั้งใจ');
  });

  it('id ที่หาชื่อไม่เจอแสดงเป็น #id', () => {
    const result = describeAuditLog(
      log({
        action: AuditAction.CREATE,
        tableName: 'follow_ups',
        recordId: 9,
        newValue: { customerId: 77, title: 'โทรตาม' },
      }),
      refs,
    );

    expect(result.summary).toBe('สร้างงานติดตาม โทรตาม');
    expect(result.changes.find((c) => c.field === 'customerId')?.to).toBe('#77');
  });

  it('รอบการแก้ไขใช้ป้าย "รหัสใบ รอบที่ N" และบอกผล', () => {
    const result = describeAuditLog(
      log({
        action: AuditAction.CREATE,
        tableName: 'ticket_resolutions',
        recordId: 70,
        newValue: { round: 2, result: 'SUCCESS', ticketId: 58, startedAt: null },
      }),
      refs,
    );

    expect(result.summary).toBe('บันทึกผลการแก้ไข TK69-0058 รอบที่ 2 (ผล: สำเร็จ)');
    expect(result.changes.find((c) => c.field === 'ticketId')?.to).toBe('TK69-0058');
    // ว่างทั้งก่อนและหลังไม่ใช่การเปลี่ยนแปลง
    expect(result.changes.some((c) => c.field === 'startedAt')).toBe(false);
  });

  it('ล็อกอินได้ "เข้าสู่ระบบ" และค่า token ไม่ถูกแสดง', () => {
    const result = describeAuditLog(
      log({
        tableName: 'users',
        recordId: 4,
        oldValue: { lastLoginAt: null, refreshTokenHash: '[REDACTED]' },
        newValue: { lastLoginAt: '2026-09-29T02:51:53.525Z', refreshTokenHash: '[REDACTED]' },
      }),
      refs,
    );

    expect(result.summary).toBe('เข้าสู่ระบบ');
    expect(result.changes.map((c) => c.field)).toEqual(['lastLoginAt']);
  });

  it('session: ล็อกอิน / ต่ออายุ / ออกจากระบบ / ตัดเครื่องเดิม ไม่แสดง token', () => {
    const session = (action: AuditAction, value: Record<string, unknown> | null) =>
      describeAuditLog(
        log({
          action,
          tableName: 'user_sessions',
          recordId: 12,
          oldValue: action === AuditAction.CREATE ? null : value,
          newValue: action === AuditAction.DELETE ? null : value,
        }),
        refs,
      );
    const row = {
      userId: 4,
      refreshTokenHash: '[REDACTED]',
      userAgent: 'Mozilla',
      ipAddress: '100.1.2.3',
      expiresAt: '2026-10-15T00:00:00.000Z',
    };

    const created = session(AuditAction.CREATE, row);
    expect(created.tableLabel).toBe('การเข้าสู่ระบบ');
    expect(created.summary).toBe('เข้าสู่ระบบ');
    expect(created.changes.map((c) => c.field)).toEqual(['userId']);
    expect(session(AuditAction.UPDATE, { refreshTokenHash: '[REDACTED]' }).summary).toBe(
      'ต่ออายุการเข้าสู่ระบบ',
    );
    expect(session(AuditAction.DELETE, row).summary).toBe('ออกจากระบบ');
    expect(session(AuditAction.BULK_DELETE, { where: { userId: 4 } }).summary).toBe(
      'ตัดการเข้าสู่ระบบเดิมของผู้ใช้',
    );
  });

  it('เปลี่ยนรหัสผ่านบอกว่าเปลี่ยนของใคร แต่ไม่แสดงค่า', () => {
    const result = describeAuditLog(
      log({
        tableName: 'users',
        recordId: 4,
        oldValue: { passwordHash: '[REDACTED]' },
        newValue: { passwordHash: '[REDACTED]' },
      }),
      refs,
    );

    expect(result.summary).toBe('เปลี่ยนรหัสผ่านของวิชัย ตั้งใจ');
    expect(result.changes[0]).toMatchObject({
      label: 'รหัสผ่าน',
      from: '(ซ่อนไว้)',
      to: '(ซ่อนไว้)',
    });
  });

  it('อ่านแจ้งเตือนแบบหลายรายการไม่โผล่คำว่า where', () => {
    const result = describeAuditLog(
      log({
        action: AuditAction.BULK_UPDATE,
        tableName: 'notifications',
        recordId: null,
        oldValue: { where: {} },
        newValue: { readAt: '2026-09-29T02:51:53.525Z', status: 'READ', updatedBy: 1 },
      }),
      refs,
    );

    expect(result.summary).toBe('อ่านการแจ้งเตือน');
    expect(result.changes.map((c) => c.field)).toEqual(['readAt', 'status']);
    expect(result.changes.every((c) => c.from === null)).toBe(true);
  });

  it('แถวที่บันทึกแค่ผู้ลบก่อนลบจริงบอกตรง ๆ', () => {
    const result = describeAuditLog(
      log({
        tableName: 'attachments',
        recordId: 5,
        oldValue: { deletedBy: null },
        newValue: { deletedBy: 1 },
      }),
      new Map([['attachments', new Map([[5, 'a.pdf']])]]),
    );

    expect(result.summary).toBe('บันทึกผู้ลบไฟล์แนบ a.pdf');
    expect(result.changes).toEqual([]);
  });

  it('สถานะแปลตามตาราง — ACTIVE ของลูกค้ากับของประกันไม่ใช่คำเดียวกัน', () => {
    const customer = describeAuditLog(
      log({
        tableName: 'customers',
        recordId: 1,
        oldValue: { status: 'INACTIVE' },
        newValue: { status: 'ACTIVE' },
      }),
      refs,
    );
    const warranty = describeAuditLog(
      log({
        tableName: 'warranties',
        recordId: 1,
        oldValue: { status: 'VOID' },
        newValue: { status: 'ACTIVE' },
      }),
      refs,
    );

    expect(customer.changes[0].to).toBe('ลูกค้าปัจจุบัน');
    expect(warranty.changes[0].to).toBe('ใช้งานอยู่');
  });

  it('วันที่ ราคา ไฟล์ และค่าจริง/เท็จแปลงเป็นข้อความอ่านง่าย', () => {
    const result = describeAuditLog(
      log({
        action: AuditAction.CREATE,
        tableName: 'ma_contracts',
        recordId: 14,
        newValue: {
          contractNo: 'MA69-0014',
          startDate: '2026-09-29',
          price: '12000.00',
          signedFileUrl: 'local:ma/14/x.pdf',
          isOverQuota: false,
        },
      }),
      refs,
    );
    const to = Object.fromEntries(result.changes.map((c) => [c.field, c.to]));

    expect(result.summary).toBe('สร้างสัญญา MA MA69-0014');
    expect(to.startDate).toBe('29 ก.ย. 2569');
    expect(to.price).toBe('12,000.00 บาท');
    expect(to.signedFileUrl).toBe('มีไฟล์');
    expect(to.isOverQuota).toBe('ไม่ใช่');
  });

  it('แก้หลายช่องที่ไม่ใช่สถานะสรุปชื่อช่องไม่เกินสามชื่อ', () => {
    const result = describeAuditLog(
      log({
        tableName: 'projects',
        recordId: 3,
        oldValue: { name: 'a', description: 'b', priority: 'LOW', contractValue: '1.00' },
        newValue: { name: 'c', description: 'd', priority: 'HIGH', contractValue: '2.00' },
      }),
      refs,
    );

    expect(result.summary).toBe(
      'แก้ไขโปรเจกต์ PRJ69-0003 Lanterns: ชื่อ, รายละเอียด, ความสำคัญ และอีก 1 ช่อง',
    );
  });
});
