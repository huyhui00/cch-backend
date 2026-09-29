import { Op } from 'sequelize';
import type { Includeable, Model, ModelStatic } from 'sequelize';

import {
  AuditLog,
  Attachment,
  Contact,
  Customer,
  Delivery,
  Document,
  FollowUp,
  MaContract,
  MaPlan,
  MaUsage,
  Notification,
  Permission,
  Project,
  Role,
  Survey,
  Task,
  TaskSubmission,
  Ticket,
  TicketResolution,
  User,
  Warranty,
} from '../../models';
import { type AuditRefLabels, referencedTableOf, toId } from './audit-log-describer';

interface RefSource {
  model: ModelStatic<Model>;
  attributes: string[];
  include?: () => Includeable[];
  label: (row: Record<string, unknown>) => string | null;
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const joined = (...values: unknown[]): string | null =>
  values.map(text).filter(Boolean).join(' ') || null;

/**
 * วิธีหาป้ายชื่อของแต่ละตาราง — ใช้รหัสที่หน้าจอแสดงก่อน (TK69-0009) เพราะคนค้นด้วยรหัส (B-10)
 * ตารางที่ไม่อยู่ในนี้แสดงเป็น #id
 */
const REF_SOURCES: Readonly<Record<string, RefSource>> = {
  users: { model: User, attributes: ['id', 'fullName'], label: (r) => text(r.fullName) },
  roles: { model: Role, attributes: ['id', 'name'], label: (r) => text(r.name) },
  permissions: {
    model: Permission,
    attributes: ['id', 'code', 'description'],
    label: (r) => text(r.description) ?? text(r.code),
  },
  customers: { model: Customer, attributes: ['id', 'name'], label: (r) => text(r.name) },
  contacts: { model: Contact, attributes: ['id', 'name'], label: (r) => text(r.name) },
  projects: {
    model: Project,
    attributes: ['id', 'code', 'name'],
    label: (r) => joined(r.code, r.name),
  },
  tasks: { model: Task, attributes: ['id', 'title'], label: (r) => text(r.title) },
  tickets: {
    model: Ticket,
    attributes: ['id', 'ticketNo', 'title'],
    label: (r) => text(r.ticketNo) ?? text(r.title),
  },
  ticket_resolutions: {
    model: TicketResolution,
    attributes: ['id', 'round', 'ticketId'],
    include: () => [{ model: Ticket, attributes: ['id', 'ticketNo'], paranoid: false }],
    label: (r) => {
      const ticket = r.ticket as Record<string, unknown> | null;
      return joined(ticket?.ticketNo, 'รอบที่ ' + String(r.round));
    },
  },
  ma_usages: {
    model: MaUsage,
    attributes: ['id', 'ticketId'],
    include: () => [{ model: Ticket, attributes: ['id', 'ticketNo'], paranoid: false }],
    label: (r) => text((r.ticket as Record<string, unknown> | null)?.ticketNo),
  },
  task_submissions: {
    model: TaskSubmission,
    attributes: ['id', 'taskId'],
    include: () => [{ model: Task, attributes: ['id', 'title'], paranoid: false }],
    label: (r) => text((r.task as Record<string, unknown> | null)?.title),
  },
  deliveries: {
    model: Delivery,
    attributes: ['id', 'deliveryNo', 'title'],
    label: (r) => text(r.deliveryNo) ?? text(r.title),
  },
  warranties: {
    model: Warranty,
    attributes: ['id', 'warrantyNo'],
    label: (r) => text(r.warrantyNo),
  },
  ma_contracts: {
    model: MaContract,
    attributes: ['id', 'contractNo'],
    label: (r) => text(r.contractNo),
  },
  ma_plans: { model: MaPlan, attributes: ['id', 'name'], label: (r) => text(r.name) },
  follow_ups: { model: FollowUp, attributes: ['id', 'title'], label: (r) => text(r.title) },
  surveys: { model: Survey, attributes: ['id', 'title'], label: (r) => text(r.title) },
  documents: { model: Document, attributes: ['id', 'title'], label: (r) => text(r.title) },
  notifications: {
    model: Notification,
    attributes: ['id', 'title'],
    label: (r) => text(r.title),
  },
  attachments: {
    model: Attachment,
    attributes: ['id', 'fileName'],
    label: (r) => text(r.fileName),
  },
};

/**
 * รวบ id ที่ต้องใช้ทั้งหน้าแล้วถามทีละตาราง ตารางละครั้ง — ไม่ถามรายแถว
 * ค้นแบบ paranoid: false เพราะประวัติอ้างถึงแถวที่ถูกลบไปแล้วได้เสมอ
 */
export async function loadAuditRefLabels(logs: AuditLog[]): Promise<AuditRefLabels> {
  const wanted = new Map<string, Set<number>>();

  const want = (table: string | null, value: unknown) => {
    const id = toId(value);

    if (!table || id === null || !REF_SOURCES[table]) {
      return;
    }

    const ids = wanted.get(table) ?? new Set<number>();
    ids.add(id);
    wanted.set(table, ids);
  };

  for (const log of logs) {
    want(log.tableName, log.recordId);

    for (const values of [log.oldValue, log.newValue]) {
      if (typeof values !== 'object' || values === null || Array.isArray(values)) {
        continue;
      }

      for (const [field, value] of Object.entries(values as Record<string, unknown>)) {
        want(referencedTableOf(field), value);
      }
    }
  }

  const result = new Map<string, Map<number, string>>();

  await Promise.all(
    [...wanted].map(async ([table, ids]) => {
      const source = REF_SOURCES[table];
      const rows = await source.model.findAll({
        where: { id: { [Op.in]: [...ids] } },
        attributes: source.attributes,
        include: source.include?.(),
        paranoid: false,
      });

      const labels = new Map<number, string>();

      for (const row of rows) {
        const plain = row.get({ plain: true }) as Record<string, unknown>;
        const id = toId(plain.id);
        const label = source.label(plain);

        if (id !== null && label) {
          labels.set(id, label);
        }
      }

      result.set(table, labels);
    }),
  );

  return result;
}
