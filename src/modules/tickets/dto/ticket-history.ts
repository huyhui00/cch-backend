import { ApiProperty } from '@nestjs/swagger';

import { AuditAction, TicketStatus } from '../../../models';

export type TicketHistoryCode =
  | 'CREATED'
  | 'SENT_TO_ADMIN'
  | 'CLAIMED'
  | 'ASSIGNED'
  | 'REASSIGNED'
  | 'UNASSIGNED'
  | 'STARTED'
  | 'RESOLVED'
  | 'REVIEW_REJECTED'
  | 'RETURNED_TO_SUPPORT'
  | 'CUSTOMER_NOTIFIED'
  | 'CLOSED'
  | 'REOPENED'
  | 'STATUS_CHANGED';

export class TicketHistoryUserDto {
  @ApiProperty({ example: 3 })
  id: number;

  @ApiProperty({ example: 'สมชาย ใจดี' })
  fullName: string;
}

/** เหตุการณ์หนึ่งในสายงานของใบ — อ่านจาก audit_logs ไม่ได้เก็บแยก */
export class TicketHistoryEventDto {
  @ApiProperty({ example: 'REVIEW_REJECTED' })
  code: TicketHistoryCode;

  @ApiProperty({ example: 'ตรวจไม่ผ่าน ตีกลับให้ผู้แก้' })
  label: string;

  @ApiProperty()
  at: Date;

  @ApiProperty({
    type: TicketHistoryUserDto,
    nullable: true,
    description: 'ผู้กระทำ — null = ระบบทำเอง',
  })
  actor: TicketHistoryUserDto | null;

  @ApiProperty({ enum: TicketStatus, nullable: true })
  fromStatus: TicketStatus | null;

  @ApiProperty({ enum: TicketStatus, nullable: true })
  toStatus: TicketStatus | null;

  @ApiProperty({
    type: TicketHistoryUserDto,
    nullable: true,
    description: 'ผู้แก้ที่ถูกมอบหมาย (ASSIGNED / REASSIGNED)',
  })
  assignee: TicketHistoryUserDto | null;

  @ApiProperty({
    nullable: true,
    description: 'เหตุผลที่ตรวจไม่ผ่าน / หมายเหตุตอนตรวจผ่าน',
    example: 'ยอดในรายงานยังไม่ตรง',
  })
  note: string | null;
}

export interface TicketAuditRow {
  action: string;
  userId: number | null;
  oldValue: unknown;
  newValue: unknown;
  createdAt: Date;
}

export type UserNames = ReadonlyMap<number, string>;

/** id ของผู้ใช้ทุกคนที่ต้องหาชื่อ (ผู้กระทำ + ผู้ถูกมอบหมาย) */
export function collectHistoryUserIds(rows: TicketAuditRow[]): number[] {
  const ids = new Set<number>();

  for (const row of rows) {
    if (row.userId) ids.add(row.userId);
    const assignee = asRecord(row.newValue).assignedUserId;
    if (typeof assignee === 'number') ids.add(assignee);
  }

  return [...ids];
}

/**
 * แปลงประวัติของใบเป็นลำดับเหตุการณ์ของสายงาน C-1
 * เก็บเฉพาะการเปลี่ยนสถานะ / รับคิว / เปลี่ยนผู้แก้ — การแก้หัวข้อหรือรายละเอียดอยู่ในหน้าประวัติการใช้งาน
 * ตรวจไม่ผ่านกับเริ่มงานจบที่ IN_PROGRESS เหมือนกัน แยกด้วยสถานะก่อนหน้า (RESOLVED = ตีกลับ)
 */
export function buildTicketHistory(
  rows: TicketAuditRow[],
  names: UserNames,
): TicketHistoryEventDto[] {
  const events: TicketHistoryEventDto[] = [];
  const user = (id: unknown): TicketHistoryUserDto | null =>
    typeof id === 'number' ? { id, fullName: names.get(id) ?? `#${id}` } : null;

  for (const row of rows) {
    const oldValues = asRecord(row.oldValue);
    const newValues = asRecord(row.newValue);
    const base = { at: row.createdAt, actor: user(row.userId) };
    const action = row.action as AuditAction;

    if (action === AuditAction.CREATE) {
      events.push({
        ...base,
        code: 'CREATED',
        label: 'รับเรื่องและเปิดใบ',
        fromStatus: null,
        toStatus: asStatus(newValues.status),
        assignee: user(newValues.assignedUserId),
        note: null,
      });
      continue;
    }

    if (action !== AuditAction.UPDATE) {
      continue;
    }

    const from = asStatus(oldValues.status);
    const to = asStatus(newValues.status);

    if (to && to !== from) {
      const { code, label } = describeTransition(from, to);
      events.push({
        ...base,
        code,
        label,
        fromStatus: from,
        toStatus: to,
        assignee: to === TicketStatus.ASSIGNED ? user(newValues.assignedUserId) : null,
        note: noteFor(code, newValues.description),
      });
      continue;
    }

    if ('claimedByAdminUserId' in newValues && newValues.claimedByAdminUserId !== null) {
      events.push({
        ...base,
        code: 'CLAIMED',
        label: 'แอดมินรับคิว',
        fromStatus: null,
        toStatus: null,
        assignee: null,
        note: null,
      });
    }

    if ('assignedUserId' in newValues && newValues.assignedUserId !== oldValues.assignedUserId) {
      const assignee = user(newValues.assignedUserId);
      events.push({
        ...base,
        code: assignee ? 'REASSIGNED' : 'UNASSIGNED',
        label: assignee ? `เปลี่ยนผู้แก้เป็น ${assignee.fullName}` : 'ถอนผู้แก้ออก',
        fromStatus: null,
        toStatus: null,
        assignee,
        note: null,
      });
    }
  }

  return events;
}

function describeTransition(
  from: TicketStatus | null,
  to: TicketStatus,
): { code: TicketHistoryCode; label: string } {
  switch (to) {
    case TicketStatus.WAITING_ADMIN:
      return { code: 'SENT_TO_ADMIN', label: 'ซัพพอร์ตส่งให้แอดมิน' };
    case TicketStatus.ASSIGNED:
      return { code: 'ASSIGNED', label: 'มอบหมายผู้แก้' };
    case TicketStatus.IN_PROGRESS:
      return from === TicketStatus.RESOLVED
        ? { code: 'REVIEW_REJECTED', label: 'ตรวจไม่ผ่าน ตีกลับให้ผู้แก้' }
        : { code: 'STARTED', label: 'ผู้แก้เริ่มงาน' };
    case TicketStatus.RESOLVED:
      return { code: 'RESOLVED', label: 'แก้เสร็จ ส่งให้แอดมินตรวจ' };
    case TicketStatus.WAITING_SUPPORT:
      return { code: 'RETURNED_TO_SUPPORT', label: 'ตรวจผ่าน ส่งกลับซัพพอร์ต' };
    case TicketStatus.CLOSED:
      return from === TicketStatus.WAITING_SUPPORT
        ? { code: 'CUSTOMER_NOTIFIED', label: 'แจ้งลูกค้าแล้ว ปิดงาน' }
        : { code: 'CLOSED', label: 'ปิดงาน' };
    case TicketStatus.REOPENED:
      return { code: 'REOPENED', label: 'เปิดใบอีกครั้ง (ปัญหาเดิมกลับมา)' };
    default:
      return { code: 'STATUS_CHANGED', label: 'เปลี่ยนสถานะ' };
  }
}

const NOTE_LABELS: Partial<Record<TicketHistoryCode, string>> = {
  REVIEW_REJECTED: 'ตรวจไม่ผ่าน',
  RETURNED_TO_SUPPORT: 'ตรวจผ่าน',
};

/** ข้อความที่ต่อท้ายรายละเอียดใบในการกระทำครั้งนั้น (รูปแบบของ appendNote: "[label] ข้อความ") */
function noteFor(code: TicketHistoryCode, description: unknown): string | null {
  const label = NOTE_LABELS[code];

  if (!label || typeof description !== 'string') {
    return null;
  }

  const marker = `[${label}] `;
  const index = description.lastIndexOf(marker);
  return index === -1 ? null : description.slice(index + marker.length).trim() || null;
}

function asStatus(value: unknown): TicketStatus | null {
  return typeof value === 'string' && (Object.values(TicketStatus) as string[]).includes(value)
    ? (value as TicketStatus)
    : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
