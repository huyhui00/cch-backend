import { NotificationEventType } from '../../models';

/** รายการต่อกลุ่มที่แสดงในข้อความ LINE — ที่เหลืออยู่ในกระดิ่งของระบบครบทุกรายการ */
export const DIGEST_ITEM_LIMIT = 5;

/** ข้อความ LINE ยาวได้ไม่เกิน 5,000 ตัวอักษร — เผื่อหัวเรื่องที่ต่อหน้าข้อความ */
export const DIGEST_MESSAGE_LIMIT = 4_800;

/**
 * รายการที่เลยกำหนดก่อนช่วงนี้ไม่ถูกแจ้ง — ไม่ใช่เหตุการณ์ "เพิ่งเลยกำหนด" แล้ว
 * กันไม่ให้วันแรกที่เปิดใช้ยิงงานค้างเก่าทั้งหมดออกไป
 */
export const OVERDUE_LOOKBACK_DAYS = 7;

/** หัวข้อที่แจ้ง เรียงตามลำดับที่แสดง — CUSTOMER_IDLE ไม่ใช่กำหนดส่ง จึงไม่อยู่ในนี้ */
export const DIGEST_EVENT_ORDER: readonly NotificationEventType[] = [
  NotificationEventType.TASK_OVERDUE,
  NotificationEventType.DELIVERY_DUE,
  NotificationEventType.FOLLOWUP_DUE,
  NotificationEventType.TICKET_SLA,
  NotificationEventType.WARRANTY_EXPIRING,
  NotificationEventType.MA_EXPIRING,
];

/** แจ้งล่วงหน้ากี่วันเมื่อกฎไม่ได้ใส่ `daysBefore` */
export const DIGEST_DEFAULT_DAYS: Partial<Record<NotificationEventType, number>> = {
  [NotificationEventType.TASK_OVERDUE]: 3,
  [NotificationEventType.DELIVERY_DUE]: 7,
  [NotificationEventType.FOLLOWUP_DUE]: 0,
  [NotificationEventType.WARRANTY_EXPIRING]: 30,
  [NotificationEventType.MA_EXPIRING]: 30,
};

/** ใช้ในหัวเรื่องแถวกระดิ่งและบรรทัด "…xxx ที่เลยกำหนดอีก N รายการ" */
export const DIGEST_NOUN: Partial<Record<NotificationEventType, string>> = {
  [NotificationEventType.TASK_OVERDUE]: 'งาน',
  [NotificationEventType.DELIVERY_DUE]: 'โปรเจกต์',
  [NotificationEventType.FOLLOWUP_DUE]: 'งานติดตาม',
  [NotificationEventType.TICKET_SLA]: 'ใบแจ้งปัญหา',
  [NotificationEventType.WARRANTY_EXPIRING]: 'ประกัน',
  [NotificationEventType.MA_EXPIRING]: 'สัญญา MA',
};

export type DueKind = 'UPCOMING' | 'OVERDUE';

export interface DigestGroup {
  /** ใกล้ครบอยู่ใต้หัวข้อของตัวเอง · เลยกำหนดรวมเป็นก้อนเดียวท้ายข้อความ */
  kind: DueKind;
  /** จำนวนทั้งหมด ไม่ใช่แค่ที่แสดง */
  total: number;
  /** แต่ละรายการอาจมีหลายบรรทัด (จาก `digestItem()`) */
  items: string[];
}

export interface DigestSection {
  eventType: NotificationEventType;
  heading: string;
  total: number;
  groups: DigestGroup[];
  footer?: string;
}

const THAI_MONTHS = [
  'ม.ค.',
  'ก.พ.',
  'มี.ค.',
  'เม.ย.',
  'พ.ค.',
  'มิ.ย.',
  'ก.ค.',
  'ส.ค.',
  'ก.ย.',
  'ต.ค.',
  'พ.ย.',
  'ธ.ค.',
];
const THAI_WEEKDAYS = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];

function parts(dateOnly: string): [number, number, number] {
  const [year, month, day] = dateOnly.split('-').map(Number);
  return [year, month, day];
}

/** จำนวนวันจาก `from` ถึง `to` (ติดลบเมื่อ `to` อยู่ก่อน) */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = parts(from);
  const [ty, tm, td] = parts(to);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/** `2026-10-10` → `10 ต.ค.` */
export function thaiShortDate(dateOnly: string): string {
  const [, month, day] = parts(dateOnly);
  return `${day} ${THAI_MONTHS[month - 1]}`;
}

/** `2026-10-08` → `พฤ. 8 ต.ค. 69` */
export function thaiDigestDate(dateOnly: string): string {
  const [year, month, day] = parts(dateOnly);
  const weekday = THAI_WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${weekday} ${thaiShortDate(dateOnly)} ${String(year + 543).slice(-2)}`;
}

/** ระยะจากวันนี้: `เลยมา 7 วัน` / `วันนี้` / `พรุ่งนี้` / `อีก 30 วัน` */
export function relativeDays(date: string, today: string): string {
  const diff = daysBetween(today, date);
  if (diff < 0) return `เลยมา ${-diff} วัน`;
  if (diff === 0) return 'วันนี้';
  if (diff === 1) return 'พรุ่งนี้';
  return `อีก ${diff} วัน`;
}

/**
 * ยังไม่เลยกำหนด = `วันจบตามแผน 7 ต.ค.` · เลยแล้ว = `วันจบตามแผน 30 ก.ย. (เลยมา 7 วัน)`
 * `overdue` = เลยเวลาแล้วแม้เป็นวันนี้ (กำหนดส่งใบแจ้งปัญหามีเวลา)
 */
export function dateLine(prefix: string, date: string, today: string, overdue = false): string {
  const diff = daysBetween(today, date);
  const base = `${prefix} ${thaiShortDate(date)}`;
  if (diff < 0) return `${base} (${relativeDays(date, today)})`;
  if (overdue) return `${base} (เลยกำหนดวันนี้)`;
  return base;
}

/** รายการหลายบรรทัด — บรรทัดแรกคือชื่อเรื่อง บรรทัดถัดไปเป็นรายละเอียด */
export function digestItem(title: string, details: Array<string | null | undefined>): string {
  return [title, ...details.filter((d): d is string => !!d).map((d) => `   ${d}`)].join('\n');
}

export function digestHeading(eventType: NotificationEventType, days: number): string {
  switch (eventType) {
    case NotificationEventType.TASK_OVERDUE:
      return `งานโปรเจกต์ใกล้ครบกำหนด · ภายใน ${days} วัน`;
    case NotificationEventType.DELIVERY_DUE:
      return `โปรเจกต์ใกล้ถึงวันจบตามแผน · ภายใน ${days} วัน`;
    case NotificationEventType.FOLLOWUP_DUE:
      return days === 0 ? 'งานติดตามที่ครบกำหนดวันนี้' : `งานติดตาม · ภายใน ${days} วัน`;
    case NotificationEventType.TICKET_SLA:
      return 'ใบแจ้งปัญหาที่เลยกำหนดส่ง';
    case NotificationEventType.WARRANTY_EXPIRING:
      return `ประกันใกล้หมดอายุ · ภายใน ${days} วัน`;
    case NotificationEventType.MA_EXPIRING:
      return `สัญญา MA ใกล้หมดอายุ · ภายใน ${days} วัน`;
    default:
      return eventType;
  }
}

/** หัวเรื่องของแถวในกระดิ่ง (หนึ่งแถวต่อรายการ) */
export function itemTitle(
  eventType: NotificationEventType,
  kind: DueKind,
  heading: string,
): string {
  return kind === 'OVERDUE' ? `เลยกำหนดแล้ว · ${DIGEST_NOUN[eventType] ?? 'รายการ'}` : heading;
}

/** หัวข้อที่มีรายการใกล้ครบ — ไม่มี = `null` (รายการเลยกำหนดไปอยู่ก้อนท้าย) */
function renderUpcoming(section: DigestSection): string | null {
  const group = section.groups.find((g) => g.kind === 'UPCOMING');
  if (!group) {
    return null;
  }
  const rows = [`■ ${section.heading}`, ...group.items.map((item) => `• ${item}`)];
  const hidden = group.total - group.items.length;
  if (hidden > 0) {
    rows.push(`   …และอีก ${hidden} รายการ ดูในระบบ`);
  }
  if (section.footer) {
    rows.push(`→ ${section.footer}`);
  }
  return rows.join('\n');
}

/** รายการเลยกำหนดของทุกหัวข้อรวมเป็นก้อนเดียว — ไม่มี = `null` */
function renderOverdue(sections: DigestSection[]): string | null {
  const parts = sections.flatMap((section) =>
    section.groups
      .filter((g) => g.kind === 'OVERDUE')
      .map((group) => ({ group, noun: DIGEST_NOUN[section.eventType] ?? 'รายการ' })),
  );
  const total = parts.reduce((sum, { group }) => sum + group.total, 0);
  if (total === 0) {
    return null;
  }

  const rows = [`เลยกำหนดแล้ว ${total} รายการ`];
  for (const { group, noun } of parts) {
    rows.push(...group.items.map((item) => `• ${item}`));
    const hidden = group.total - group.items.length;
    if (hidden > 0) {
      rows.push(`   …${noun}ที่เลยกำหนดอีก ${hidden} รายการ ดูในระบบ`);
    }
  }
  return rows.join('\n');
}

/** ตัดที่ขึ้นบรรทัดใหม่ก่อนเกินเพดาน ไม่ให้ LINE ปฏิเสธทั้งข้อความ */
function fitMessage(message: string): string {
  if (message.length <= DIGEST_MESSAGE_LIMIT) {
    return message;
  }
  const tail = '\n…ข้อความยาวเกิน ดูรายการทั้งหมดในระบบ';
  const cut = message.lastIndexOf('\n', DIGEST_MESSAGE_LIMIT - tail.length);
  return message.slice(0, cut) + tail;
}

/**
 * ประกอบข้อความ LINE จากรายการที่เพิ่งเข้าเกณฑ์ในรอบนี้ — ไม่มีเลย = `null` (ไม่ส่ง)
 * ใกล้ครบอยู่ใต้หัวข้อของตัวเอง · เลยกำหนดของทุกหัวข้อรวมเป็นก้อนเดียวท้ายข้อความ
 */
export function buildDigest(
  today: string,
  sections: DigestSection[],
): { title: string; message: string } | null {
  const filled = sections
    .filter((s) => s.total > 0)
    .sort(
      (a, b) => DIGEST_EVENT_ORDER.indexOf(a.eventType) - DIGEST_EVENT_ORDER.indexOf(b.eventType),
    );
  if (filled.length === 0) {
    return null;
  }

  return {
    title: `แจ้งเตือนกำหนดส่ง ${thaiDigestDate(today)}`,
    message: fitMessage(
      [...filled.map(renderUpcoming), renderOverdue(filled)]
        .filter((part): part is string => !!part)
        .join('\n\n'),
    ),
  };
}

export interface ClockTime {
  hour: number;
  minute: number;
}

export const DEFAULT_NOTIFY_START: ClockTime = { hour: 8, minute: 30 };
export const DEFAULT_NOTIFY_END: ClockTime = { hour: 18, minute: 0 };

/** `"08:30"` → `{ hour: 8, minute: 30 }` · รูปแบบผิด = `null` */
export function parseClockTime(raw: string | undefined): ClockTime | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec((raw ?? '').trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/**
 * อยู่ในช่วงเวลาที่ส่งแจ้งเตือนได้ไหม (`start` ≤ ตอนนี้ < `end`) — นอกช่วงรายการจะรอไปส่งรอบแรกของช่วงถัดไป
 * วันเสาร์/อาทิตย์ไม่ส่งถ้าไม่ได้เปิด `weekends`
 */
export function isWithinNotifyHours(
  now: Date,
  start: ClockTime,
  end: ClockTime,
  weekends: boolean,
): boolean {
  const weekday = now.getDay();
  if (!weekends && (weekday === 0 || weekday === 6)) {
    return false;
  }
  const minutes = now.getHours() * 60 + now.getMinutes();
  return minutes >= start.hour * 60 + start.minute && minutes < end.hour * 60 + end.minute;
}
