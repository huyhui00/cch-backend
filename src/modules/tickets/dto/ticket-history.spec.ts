/// <reference types="jest" />
import { AuditAction, TicketStatus } from '../../../models';
import { buildTicketHistory, collectHistoryUserIds, type TicketAuditRow } from './ticket-history';

const at = (minute: number) => new Date(`2026-09-29T03:${String(minute).padStart(2, '0')}:00Z`);

function update(
  minute: number,
  userId: number | null,
  oldValue: Record<string, unknown>,
  newValue: Record<string, unknown>,
): TicketAuditRow {
  return { action: AuditAction.UPDATE, userId, oldValue, newValue, createdAt: at(minute) };
}

const names = new Map([
  [2, 'ทอม'],
  [3, 'สมชาย'],
  [4, 'วิชัย'],
]);

describe('buildTicketHistory', () => {
  it('ไล่สายงานครบ รวมการตีกลับพร้อมเหตุผล และแยกตีกลับออกจากเริ่มงาน', () => {
    const S = TicketStatus;
    const rows: TicketAuditRow[] = [
      {
        action: AuditAction.CREATE,
        userId: 2,
        oldValue: null,
        newValue: { status: S.RECEIVED, assignedUserId: null },
        createdAt: at(0),
      },
      update(1, 2, { status: S.RECEIVED }, { status: S.WAITING_ADMIN }),
      update(2, 3, { claimedByAdminUserId: null }, { claimedByAdminUserId: 3 }),
      update(
        3,
        3,
        { status: S.WAITING_ADMIN, assignedUserId: null },
        { status: S.ASSIGNED, assignedUserId: 4 },
      ),
      update(4, 4, { status: S.ASSIGNED }, { status: S.IN_PROGRESS }),
      update(5, 4, { status: S.IN_PROGRESS }, { status: S.RESOLVED }),
      update(
        6,
        3,
        { status: S.RESOLVED, description: 'จอค้าง' },
        { status: S.IN_PROGRESS, description: 'จอค้าง\n\n[ตรวจไม่ผ่าน] ยอดยังไม่ตรง' },
      ),
      update(7, 4, { status: S.IN_PROGRESS }, { status: S.RESOLVED }),
      update(
        8,
        3,
        { status: S.RESOLVED },
        {
          status: S.WAITING_SUPPORT,
          description: 'จอค้าง\n\n[ตรวจไม่ผ่าน] ยอดยังไม่ตรง\n\n[ตรวจผ่าน] ล้างแคชก่อน',
        },
      ),
      update(9, 2, { status: S.WAITING_SUPPORT }, { status: S.CLOSED }),
    ];

    const history = buildTicketHistory(rows, names);

    expect(history.map((event) => event.code)).toEqual([
      'CREATED',
      'SENT_TO_ADMIN',
      'CLAIMED',
      'ASSIGNED',
      'STARTED',
      'RESOLVED',
      'REVIEW_REJECTED',
      'RESOLVED',
      'RETURNED_TO_SUPPORT',
      'CUSTOMER_NOTIFIED',
    ]);
    expect(history[3].assignee).toEqual({ id: 4, fullName: 'วิชัย' });
    expect(history[6]).toMatchObject({
      actor: { id: 3, fullName: 'สมชาย' },
      fromStatus: S.RESOLVED,
      toStatus: S.IN_PROGRESS,
      note: 'ยอดยังไม่ตรง',
    });
    expect(history[8].note).toBe('ล้างแคชก่อน');
  });

  it('ข้ามการแก้ข้อมูลทั่วไป และผู้กระทำเป็นระบบได้ null', () => {
    const history = buildTicketHistory(
      [
        update(1, 3, { title: 'ก' }, { title: 'ข' }),
        update(2, null, { status: TicketStatus.RESOLVED }, { status: TicketStatus.CLOSED }),
      ],
      names,
    );

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ code: 'CLOSED', actor: null });
  });

  it('เปลี่ยน/ถอนผู้แก้โดยสถานะไม่เปลี่ยน', () => {
    const history = buildTicketHistory(
      [
        update(1, 3, { assignedUserId: 4 }, { assignedUserId: 9 }),
        update(2, 3, { assignedUserId: 9 }, { assignedUserId: null }),
      ],
      names,
    );

    expect(history.map((event) => [event.code, event.label])).toEqual([
      ['REASSIGNED', 'เปลี่ยนผู้แก้เป็น #9'],
      ['UNASSIGNED', 'ถอนผู้แก้ออก'],
    ]);
  });

  it('รวบรวม id ผู้กระทำและผู้ถูกมอบหมายเพื่อหาชื่อครั้งเดียว', () => {
    expect(
      collectHistoryUserIds([
        update(1, 3, {}, { assignedUserId: 4 }),
        update(2, 3, {}, { status: TicketStatus.CLOSED }),
      ]).sort(),
    ).toEqual([3, 4]);
  });
});
