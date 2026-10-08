import { AuditAction } from '../../models';

/**
 * แปลงแถว audit log ดิบเป็นข้อความภาษาไทยที่คนอ่านรู้เรื่อง
 *
 * คำนวณตอนอ่านเท่านั้น ไม่เขียนลงฐานข้อมูล — ประวัติเก่าทุกแถวจึงได้คำอธิบายไปด้วย
 * และแก้คำแปลทีหลังได้โดยไม่ต้องย้ายข้อมูล ค่าดิบ oldValue/newValue ยังคืนครบตามเดิม
 *
 * คำแปลสถานะต้องตรงกับที่หน้าจอใช้ (core/models ของ frontend) ไม่งั้นคนอ่านจะเห็นคำสองชุด
 */

export interface AuditChange {
  field: string;
  label: string;
  from: string | null;
  to: string | null;
}

export interface AuditDescription {
  tableLabel: string;
  summary: string;
  changes: AuditChange[];
}

export interface DescribableAuditLog {
  action: string;
  tableName: string;
  recordId: number | null;
  oldValue: unknown;
  newValue: unknown;
}

export type AuditRefLabels = ReadonlyMap<string, ReadonlyMap<number, string>>;

export const AUDIT_TABLE_LABELS: Readonly<Record<string, string>> = {
  users: 'ผู้ใช้',
  roles: 'บทบาท',
  permissions: 'สิทธิ์',
  user_roles: 'บทบาทของผู้ใช้',
  role_permissions: 'สิทธิ์ของบทบาท',
  customers: 'ลูกค้า',
  contacts: 'ผู้ติดต่อ',
  communication_logs: 'บันทึกการติดต่อ',
  follow_ups: 'งานติดตาม',
  projects: 'โปรเจกต์',
  tasks: 'งาน',
  task_submissions: 'การส่งงาน',
  deliveries: 'ใบส่งมอบ',
  warranties: 'ใบรับประกัน',
  documents: 'เอกสารโปรเจกต์',
  ma_plans: 'แผน MA',
  ma_plan_items: 'รายการบริการในแผน MA',
  ma_contracts: 'สัญญา MA',
  ma_addons: 'ของเสริมสัญญา MA',
  ma_usages: 'การใช้โควตา MA',
  tickets: 'ใบแจ้งปัญหา',
  ticket_resolutions: 'รอบการแก้ไข',
  attachments: 'ไฟล์แนบ',
  surveys: 'แบบประเมิน',
  survey_questions: 'คำถามแบบประเมิน',
  survey_assignments: 'การส่งแบบประเมิน',
  survey_responses: 'คำตอบแบบประเมิน',
  survey_answers: 'คำตอบรายข้อ',
  notification_rules: 'กฎการแจ้งเตือน',
  notifications: 'การแจ้งเตือน',
};

const HIDDEN_FIELDS: ReadonlySet<string> = new Set([
  'id',
  'createdAt',
  'createdBy',
  'updatedAt',
  'updatedBy',
  'deletedAt',
  'deletedBy',
  'where',
  'refreshTokenHash',
]);

const FIELD_LABELS: Readonly<Record<string, string>> = {
  status: 'สถานะ',
  title: 'หัวข้อ',
  name: 'ชื่อ',
  code: 'รหัส',
  description: 'รายละเอียด',
  detail: 'รายละเอียด',
  note: 'หมายเหตุ',
  priority: 'ความสำคัญ',
  sortOrder: 'ลำดับ',
  isActive: 'เปิดใช้งาน',
  startDate: 'วันเริ่ม',
  endDate: 'วันสิ้นสุด',
  dueDate: 'กำหนดเสร็จ',
  dueAt: 'กำหนดส่ง',
  completedAt: 'เวลาที่เสร็จ',
  price: 'ราคา',
  userId: 'ผู้ใช้',
  assignedUserId: 'ผู้รับผิดชอบ',
  assignedByUserId: 'ผู้มอบหมาย',
  receivedByUserId: 'ผู้รับเรื่อง',
  claimedByAdminUserId: 'แอดมินผู้รับคิว',
  resolvedByUserId: 'ผู้แก้ไข',
  managerUserId: 'ผู้จัดการโปรเจกต์',
  ownerUserId: 'ผู้ดูแลลูกค้า',
  handledByUserId: 'ผู้บันทึกการติดต่อ',
  deliveredByUserId: 'ผู้ส่งมอบ',
  uploadedByUserId: 'ผู้อัปโหลด',
  submittedByUserId: 'ผู้ส่งงาน',
  reviewedByUserId: 'ผู้ตรวจ',
  filledByUserId: 'ผู้คีย์คำตอบ',
  targetUserId: 'ผู้รับแจ้งเตือน',
  customerId: 'ลูกค้า',
  projectId: 'โปรเจกต์',
  contactId: 'ผู้ติดต่อ',
  reportedByContactId: 'ผู้แจ้ง',
  acceptedByContactId: 'ผู้รับมอบ',
  taskId: 'งาน',
  parentTaskId: 'งานแม่',
  ticketId: 'ใบแจ้งปัญหา',
  deliveryId: 'ใบส่งมอบ',
  warrantyId: 'ใบรับประกัน',
  maContractId: 'สัญญา MA',
  contractId: 'สัญญา MA',
  previousContractId: 'สัญญาฉบับก่อน',
  planId: 'แผน MA',
  roleId: 'บทบาท',
  permissionId: 'สิทธิ์',
  surveyId: 'แบบประเมิน',
  questionId: 'คำถาม',
  responseId: 'ชุดคำตอบ',
  assignmentId: 'การส่งแบบประเมิน',
  resolutionId: 'รอบการแก้ไข',
  ruleId: 'กฎการแจ้งเตือน',
  username: 'ชื่อผู้ใช้',
  fullName: 'ชื่อ-นามสกุล',
  nickname: 'ชื่อเล่น',
  email: 'อีเมล',
  phone: 'โทรศัพท์',
  position: 'ตำแหน่ง',
  accountType: 'ระดับบัญชี',
  employeeCode: 'รหัสพนักงาน',
  avatarUrl: 'รูปโปรไฟล์',
  lineUserId: 'LINE ของพนักงาน',
  lastLoginAt: 'เข้าสู่ระบบล่าสุด',
  passwordHash: 'รหัสผ่าน',
  taxId: 'เลขผู้เสียภาษี',
  address: 'ที่อยู่',
  province: 'จังหวัด',
  postalCode: 'รหัสไปรษณีย์',
  website: 'เว็บไซต์',
  source: 'ที่มา',
  businessType: 'ประเภทธุรกิจ',
  facebookUrl: 'Facebook',
  lineOfficialId: 'LINE OA',
  lastContactedAt: 'ติดต่อล่าสุด',
  lineId: 'LINE',
  isPrimary: 'ผู้ติดต่อหลัก',
  channel: 'ช่องทาง',
  subject: 'เรื่อง',
  content: 'เนื้อหา',
  occurredAt: 'เวลาที่ติดต่อ',
  resultNote: 'ผลการติดตาม',
  projectType: 'ประเภทโปรเจกต์',
  contractValue: 'มูลค่าสัญญา',
  functionCount: 'จำนวนฟังก์ชัน',
  targetEndDate: 'กำหนดเสร็จ',
  actualEndDate: 'วันที่เสร็จจริง',
  estimatedHours: 'ชั่วโมงที่ประเมิน',
  actualHours: 'ชั่วโมงที่ใช้จริง',
  report: 'รายงานการส่งงาน',
  reviewNote: 'ความเห็นผู้ตรวจ',
  reviewedAt: 'เวลาที่ตรวจ',
  reviewFileName: 'ไฟล์ของผู้ตรวจ',
  deliveryNo: 'เลขที่ใบส่งมอบ',
  version: 'เวอร์ชัน',
  deliveredAt: 'วันส่งมอบ',
  acceptanceStatus: 'ผลการตรวจรับ',
  acceptedAt: 'เวลาที่ตรวจรับ',
  isFinal: 'ส่งมอบครั้งสุดท้าย',
  warrantyNo: 'เลขที่ใบรับประกัน',
  durationMonth: 'ระยะประกัน (เดือน)',
  scopeNote: 'ขอบเขตการรับประกัน',
  docType: 'ประเภทเอกสาร',
  fileName: 'ชื่อไฟล์',
  fileSize: 'ขนาดไฟล์',
  mimeType: 'ชนิดไฟล์',
  fileUrl: 'ไฟล์',
  refType: 'แนบกับ',
  refId: 'รหัสอ้างอิง',
  contractNo: 'เลขที่สัญญา',
  billingCycle: 'รอบวางบิล',
  signedDate: 'วันที่เซ็น',
  signedFileUrl: 'ไฟล์สแกนสัญญา',
  bugQuotaPerMonth: 'โควตาแก้บั๊กต่อเดือน',
  onsiteQuotaPerMonth: 'โควตาออกหน้างานต่อเดือน',
  responseTimeHour: 'เวลาตอบกลับ (ชั่วโมง)',
  addonType: 'ประเภทของเสริม',
  extraQuota: 'โควตาเพิ่ม',
  effectiveYear: 'ปีที่มีผล',
  effectiveMonth: 'เดือนที่มีผล',
  usedAt: 'วันที่ใช้โควตา',
  periodYear: 'ปีของรอบ',
  periodMonth: 'เดือนของรอบ',
  isOverQuota: 'เกินโควตา',
  extraCharge: 'ค่าบริการเพิ่ม',
  ticketNo: 'เลขที่ใบ',
  billingType: 'ประเภทการคิดเงิน',
  reportedChannel: 'ช่องทางที่แจ้ง',
  reportedAt: 'เวลาที่แจ้ง',
  firstResponseAt: 'ตอบกลับครั้งแรก',
  resolvedAt: 'เวลาที่แก้เสร็จ',
  closedAt: 'เวลาที่ปิดงาน',
  resolutionCount: 'จำนวนรอบการแก้ไข',
  round: 'รอบที่',
  result: 'ผลการแก้ไข',
  rootCause: 'สาเหตุ',
  startedAt: 'เวลาที่เริ่ม',
  hoursSpent: 'ชั่วโมงที่ใช้',
  validFrom: 'เริ่มใช้',
  validTo: 'ใช้ได้ถึง',
  questionText: 'คำถาม',
  questionType: 'ชนิดคำถาม',
  options: 'ตัวเลือก',
  minValue: 'คะแนนต่ำสุด',
  maxValue: 'คะแนนสูงสุด',
  isRequired: 'บังคับตอบ',
  sentAt: 'เวลาที่ส่ง',
  answeredAt: 'เวลาที่ตอบ',
  submittedAt: 'เวลาที่ตอบ',
  overallScore: 'คะแนนรวม',
  comment: 'ความเห็น',
  answerText: 'คำตอบ',
  answerNumber: 'คะแนน',
  answerJson: 'คำตอบ',
  eventType: 'ชนิดเหตุการณ์',
  message: 'ข้อความ',
  scheduledAt: 'กำหนดส่ง',
  readAt: 'เวลาที่อ่าน',
  errorMessage: 'ข้อผิดพลาด',
};

const PRIORITY: Record<string, string> = {
  LOW: 'ต่ำ',
  NORMAL: 'ปานกลาง',
  HIGH: 'สูง',
  URGENT: 'ด่วนมาก',
};

const CHANNEL: Record<string, string> = {
  LINE: 'LINE',
  PHONE: 'โทรศัพท์',
  EMAIL: 'อีเมล',
  FACEBOOK: 'Facebook',
  MEETING: 'พบหน้า',
  OTHER: 'อื่นๆ',
};

const STATUS_BY_TABLE: Readonly<Record<string, Record<string, string>>> = {
  users: { ACTIVE: 'ปฏิบัติงาน', SUSPENDED: 'พักงาน', RESIGNED: 'สิ้นสุดการปฏิบัติงาน' },
  customers: {
    ACTIVE: 'ลูกค้าปัจจุบัน',
    INACTIVE: 'ไม่ได้ใช้บริการแล้ว',
    CHURNED: 'เลิกใช้บริการ',
  },
  projects: {
    DRAFT: 'ร่าง',
    IN_PROGRESS: 'กำลังดำเนินการ',
    DELIVERED: 'ส่งมอบแล้ว',
    CLOSED: 'ปิดโปรเจกต์',
    CANCELLED: 'ยกเลิก',
  },
  tasks: {
    TODO: 'ยังไม่ทำ',
    DOING: 'กำลังทำ',
    WAITING: 'รออยู่',
    REVIEW: 'ส่งตรวจ',
    DONE: 'เสร็จ',
  },
  task_submissions: { PENDING: 'รอตรวจ', APPROVED: 'ผ่าน', REJECTED: 'ตีกลับ' },
  warranties: { ACTIVE: 'ใช้งานอยู่', EXPIRED: 'หมดอายุ', VOID: 'ยกเลิก' },
  ma_contracts: {
    DRAFT: 'แบบร่าง',
    ACTIVE: 'ใช้งานอยู่',
    EXPIRED: 'หมดอายุ',
    CANCELLED: 'ยกเลิก',
    RENEWED: 'ต่อสัญญาแล้ว',
  },
  tickets: {
    RECEIVED: 'รับเรื่อง',
    WAITING_ADMIN: 'รอแอดมิน',
    ASSIGNED: 'ส่งงานแล้ว',
    IN_PROGRESS: 'กำลังดำเนินการ',
    RESOLVED: 'แก้ไขแล้ว',
    WAITING_SUPPORT: 'รอแจ้งลูกค้า',
    REOPENED: 'รอรับงานรอบใหม่',
    CLOSED: 'ปิดงาน',
  },
  follow_ups: {
    PLANNED: 'วางแผนไว้',
    DONE: 'ติดตามแล้ว',
    OVERDUE: 'เลยกำหนด',
    CANCELLED: 'ยกเลิก',
  },
  surveys: { DRAFT: 'แบบร่าง', ACTIVE: 'เปิดรับคำตอบ', CLOSED: 'ปิดแล้ว' },
  survey_assignments: {
    PENDING: 'รอดำเนินการ',
    SENT: 'ส่งแล้ว',
    ANSWERED: 'ได้คำตอบแล้ว',
    EXPIRED: 'หมดอายุ',
  },
  notifications: { PENDING: 'รอส่ง', SENT: 'ส่งแล้ว', FAILED: 'ส่งไม่สำเร็จ', READ: 'อ่านแล้ว' },
};

const ENUM_BY_FIELD: Readonly<Record<string, Record<string, string>>> = {
  priority: PRIORITY,
  channel: CHANNEL,
  reportedChannel: CHANNEL,
  accountType: { SUPER_ADMIN: 'ผู้ดูแลสูงสุด', ADMIN: 'ผู้ดูแลระบบ', USER: 'ผู้ใช้งาน' },
  acceptanceStatus: { PENDING: 'รอตรวจรับ', ACCEPTED: 'ยอมรับ', REJECTED: 'ตีกลับ' },
  billingType: {
    WARRANTY: 'ในประกัน',
    MA_QUOTA: 'ใช้โควตา MA',
    ADDON: 'เกี่ยวข้องกับ Add-on',
    ONE_TIME: 'คิดค่าบริการเป็นครั้ง',
    FREE: 'ช่วยฟรี (บันทึกไว้)',
  },
  result: { SUCCESS: 'สำเร็จ', PARTIAL: 'สำเร็จบางส่วน', FAILED: 'ไม่สำเร็จ' },
  billingCycle: { MONTHLY: 'วางบิลรายเดือน', YEARLY: 'วางบิลรายปี' },
  addonType: { EXTRA_QUOTA: 'โควตาเพิ่ม', OTHER: 'อื่นๆ' },
  docType: {
    QUOTATION: 'ใบเสนอราคา',
    PO: 'ใบสั่งซื้อ',
    CONTRACT: 'สัญญา',
    DELIVERY_NOTE: 'ใบส่งของ',
    MA_CONTRACT: 'สัญญา MA',
    OTHER: 'อื่นๆ',
  },
  questionType: {
    RATING: 'ให้คะแนน',
    CHOICE: 'เลือกข้อเดียว',
    MULTI_CHOICE: 'เลือกได้หลายข้อ',
    TEXT: 'ข้อความอิสระ',
  },
  refType: {
    COMMUNICATION_LOG: 'บันทึกการติดต่อ',
    DELIVERY: 'ใบส่งมอบ',
    TICKET: 'ใบแจ้งปัญหา',
    TICKET_RESOLUTION: 'รอบการแก้ไข',
    MA_CONTRACT: 'สัญญา MA',
    WARRANTY: 'ใบรับประกัน',
    PROJECT: 'โปรเจกต์',
    CUSTOMER: 'ลูกค้า',
    FOLLOW_UP: 'งานติดตาม',
  },
  eventType: {
    MA_EXPIRING: 'สัญญา MA ใกล้หมด',
    WARRANTY_EXPIRING: 'ประกันใกล้หมด',
    TASK_OVERDUE: 'งานเลยกำหนด',
    DELIVERY_DUE: 'ใกล้กำหนดส่งมอบ',
    FOLLOWUP_DUE: 'ถึงกำหนดติดตาม',
    TICKET_SLA: 'ใบแจ้งปัญหาใกล้เกินเวลา',
    CUSTOMER_IDLE: 'ลูกค้าไม่ได้ติดต่อนาน',
    TICKET_SENT_TO_ADMIN: 'ใบส่งให้แอดมิน',
    TICKET_AWAITING_REVIEW: 'ใบรอตรวจ',
    TICKET_RETURNED_TO_SUPPORT: 'ใบกลับถึงซัพพอร์ต',
    TICKET_ASSIGNED: 'ได้รับมอบหมายใบ',
    TICKET_REVIEW_REJECTED: 'ใบถูกตีกลับให้แก้ต่อ',
  },
};

export const FOREIGN_KEY_TABLES: Readonly<Record<string, string>> = {
  customerId: 'customers',
  projectId: 'projects',
  contactId: 'contacts',
  reportedByContactId: 'contacts',
  acceptedByContactId: 'contacts',
  taskId: 'tasks',
  parentTaskId: 'tasks',
  ticketId: 'tickets',
  deliveryId: 'deliveries',
  warrantyId: 'warranties',
  maContractId: 'ma_contracts',
  contractId: 'ma_contracts',
  previousContractId: 'ma_contracts',
  planId: 'ma_plans',
  roleId: 'roles',
  permissionId: 'permissions',
  surveyId: 'surveys',
};

const MONEY_FIELDS: ReadonlySet<string> = new Set(['price', 'contractValue', 'extraCharge']);

const FILE_KEY_FIELDS: ReadonlySet<string> = new Set([
  'fileUrl',
  'signedFileUrl',
  'reviewFileUrl',
  'avatarUrl',
]);

const REDACTED_PLACEHOLDER = '[REDACTED]';
const MAX_TEXT_LENGTH = 120;
const MAX_LABELS_IN_SUMMARY = 3;

const DATE_ONLY_FORMAT = new Intl.DateTimeFormat('th-TH', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

const DATE_TIME_FORMAT = new Intl.DateTimeFormat('th-TH', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Bangkok',
});

export function tableLabelOf(tableName: string): string {
  return AUDIT_TABLE_LABELS[tableName] ?? tableName;
}

export function isUserReferenceField(field: string): boolean {
  return field === 'userId' || field.endsWith('UserId');
}

export function referencedTableOf(field: string): string | null {
  if (isUserReferenceField(field)) {
    return 'users';
  }

  return FOREIGN_KEY_TABLES[field] ?? null;
}

export function describeAuditLog(log: DescribableAuditLog, refs: AuditRefLabels): AuditDescription {
  const tableLabel = tableLabelOf(log.tableName);
  const oldValues = asRecord(log.oldValue);
  const newValues = asRecord(log.newValue);
  const changes = buildChanges(log, oldValues, newValues, refs);
  const summary = buildSummary(log, tableLabel, oldValues, newValues, changes, refs);

  return { tableLabel, summary, changes };
}

function buildChanges(
  log: DescribableAuditLog,
  oldValues: Record<string, unknown>,
  newValues: Record<string, unknown>,
  refs: AuditRefLabels,
): AuditChange[] {
  const fields = new Set([...Object.keys(oldValues), ...Object.keys(newValues)]);
  const changes: AuditChange[] = [];

  for (const field of fields) {
    if (HIDDEN_FIELDS.has(field)) {
      continue;
    }

    const before = oldValues[field];
    const after = newValues[field];

    if (isPlainObject(before) || isPlainObject(after)) {
      continue;
    }

    const from = formatValue(log.tableName, field, before, refs);
    const to = formatValue(log.tableName, field, after, refs);

    if (from === null && to === null) {
      continue;
    }

    changes.push({ field, label: FIELD_LABELS[field] ?? field, from, to });
  }

  return changes;
}

function formatValue(
  tableName: string,
  field: string,
  value: unknown,
  refs: AuditRefLabels,
): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (value === REDACTED_PLACEHOLDER) {
    return '(ซ่อนไว้)';
  }

  if (FILE_KEY_FIELDS.has(field)) {
    return 'มีไฟล์';
  }

  if (typeof value === 'boolean') {
    return value ? 'ใช่' : 'ไม่ใช่';
  }

  const referencedTable = referencedTableOf(field);
  const id = referencedTable ? toId(value) : null;

  if (referencedTable && id !== null) {
    return refs.get(referencedTable)?.get(id) ?? '#' + String(id);
  }

  if (typeof value === 'string') {
    const enumLabel =
      field === 'status' ? STATUS_BY_TABLE[tableName]?.[value] : ENUM_BY_FIELD[field]?.[value];

    if (enumLabel) {
      return enumLabel;
    }

    if (MONEY_FIELDS.has(field) && /^-?\d+(\.\d+)?$/.test(value)) {
      return Number(value).toLocaleString('th-TH', { minimumFractionDigits: 2 }) + ' บาท';
    }

    const date = formatDate(value);

    if (date) {
      return date;
    }

    return truncate(value);
  }

  if (typeof value === 'number') {
    return String(value);
  }

  return truncate(JSON.stringify(value));
}

function formatDate(value: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return DATE_ONLY_FORMAT.format(new Date(value + 'T00:00:00Z'));
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : DATE_TIME_FORMAT.format(date);
  }

  return null;
}

function buildSummary(
  log: DescribableAuditLog,
  tableLabel: string,
  oldValues: Record<string, unknown>,
  newValues: Record<string, unknown>,
  changes: AuditChange[],
  refs: AuditRefLabels,
): string {
  const ref = recordRef(log, oldValues, newValues, refs);

  switch (log.action as AuditAction) {
    case AuditAction.CREATE:
    case AuditAction.BULK_CREATE:
      return summarizeCreate(log.tableName, tableLabel, ref, newValues, refs);
    case AuditAction.UPDATE:
      return summarizeUpdate(log.tableName, tableLabel, ref, oldValues, newValues, changes, refs);
    case AuditAction.DELETE:
      return summarizeDelete(log.tableName, tableLabel, ref);
    case AuditAction.BULK_UPDATE:
      return summarizeBulkUpdate(log.tableName, tableLabel, newValues, changes);
    case AuditAction.BULK_DELETE:
      return summarizeBulkDelete(log.tableName, tableLabel);
    default:
      return log.action + ' ' + tableLabel + ref;
  }
}

function recordRef(
  log: DescribableAuditLog,
  oldValues: Record<string, unknown>,
  newValues: Record<string, unknown>,
  refs: AuditRefLabels,
): string {
  const fromDb = log.recordId !== null ? refs.get(log.tableName)?.get(log.recordId) : undefined;

  if (fromDb) {
    return ' ' + fromDb;
  }

  const snapshot = { ...oldValues, ...newValues };

  for (const key of [
    'ticketNo',
    'contractNo',
    'warrantyNo',
    'deliveryNo',
    'title',
    'name',
    'fullName',
    'fileName',
    'questionText',
  ]) {
    const value = snapshot[key];

    if (typeof value === 'string' && value.trim()) {
      return ' ' + truncate(value.trim(), 60);
    }
  }

  return log.recordId !== null ? ' #' + String(log.recordId) : '';
}

function summarizeCreate(
  tableName: string,
  tableLabel: string,
  ref: string,
  values: Record<string, unknown>,
  refs: AuditRefLabels,
): string {
  switch (tableName) {
    case 'ticket_resolutions': {
      const result = enumLabel(ENUM_BY_FIELD.result, values.result);
      return 'บันทึกผลการแก้ไข' + ref + (result ? ' (ผล: ' + result + ')' : '');
    }
    case 'notifications': {
      const target = lookup(refs, 'users', values.targetUserId);
      const title = typeof values.title === 'string' ? ' "' + truncate(values.title, 60) + '"' : '';
      return 'ส่งการแจ้งเตือน' + title + (target ? ' ถึง ' + target : '');
    }
    case 'attachments':
      return 'แนบไฟล์' + ref;
    case 'documents':
      return 'อัปโหลดเอกสาร' + ref;
    case 'task_submissions':
      return 'ส่งงาน' + ref + ' ให้ตรวจ';
    case 'ma_usages':
      return 'หักโควตา MA จากใบแจ้งปัญหา' + ref;
    case 'communication_logs': {
      const channel = enumLabel(CHANNEL, values.channel);
      const customer = lookup(refs, 'customers', values.customerId);
      return (
        'บันทึกการติดต่อ' +
        (customer ? 'ลูกค้า ' + customer : '') +
        (channel ? ' ทาง ' + channel : '')
      );
    }
    case 'user_roles': {
      const role = lookup(refs, 'roles', values.roleId);
      const user = lookup(refs, 'users', values.userId);
      return 'มอบบทบาท' + (role ? ' ' + role : '') + (user ? ' ให้ ' + user : '');
    }
    case 'role_permissions': {
      const permission = lookup(refs, 'permissions', values.permissionId);
      const role = lookup(refs, 'roles', values.roleId);
      return (
        'เพิ่มสิทธิ์' + (permission ? ' ' + permission : '') + (role ? ' ให้บทบาท ' + role : '')
      );
    }
    case 'survey_responses':
      return 'บันทึกคำตอบแบบประเมิน' + ref;
    case 'survey_answers':
      return 'บันทึกคำตอบรายข้อ';
    case 'survey_assignments':
      return 'บันทึกการส่งแบบประเมิน' + ref;
    default:
      return 'สร้าง' + tableLabel + ref;
  }
}

function summarizeUpdate(
  tableName: string,
  tableLabel: string,
  ref: string,
  oldValues: Record<string, unknown>,
  newValues: Record<string, unknown>,
  changes: AuditChange[],
  refs: AuditRefLabels,
): string {
  const changed = new Set(Object.keys(newValues));
  const visible = changes.map((c) => c.field);

  if (tableName === 'users') {
    if (changed.has('passwordHash')) {
      return 'เปลี่ยนรหัสผ่านของ' + (ref ? ref.trimStart() : 'ผู้ใช้');
    }

    if (
      visible.every((f) => f === 'lastLoginAt') &&
      (changed.has('lastLoginAt') || changed.has('refreshTokenHash'))
    ) {
      return changed.has('lastLoginAt') ? 'เข้าสู่ระบบ' : 'ต่ออายุการเข้าสู่ระบบ หรือออกจากระบบ';
    }
  }

  if (visible.length === 0) {
    return changed.has('deletedBy') ? 'บันทึกผู้ลบ' + tableLabel + ref : 'แก้ไข' + tableLabel + ref;
  }

  const status = changes.find((c) => c.field === 'status');
  const special = specialUpdate(tableName, ref, status, newValues, refs);

  if (special) {
    return special;
  }

  if (tableName === 'tasks' && visible.every((f) => f === 'sortOrder')) {
    return 'จัดลำดับงาน' + ref;
  }

  if (status) {
    const others = changes.length - 1;
    return (
      'เปลี่ยนสถานะ' +
      tableLabel +
      ref +
      ' จาก ' +
      (status.from ?? '-') +
      ' เป็น ' +
      (status.to ?? '-') +
      (others > 0 ? ' (และแก้อีก ' + String(others) + ' ช่อง)' : '')
    );
  }

  return 'แก้ไข' + tableLabel + ref + ': ' + listLabels(changes);
}

function specialUpdate(
  tableName: string,
  ref: string,
  status: AuditChange | undefined,
  newValues: Record<string, unknown>,
  refs: AuditRefLabels,
): string | null {
  const next = typeof newValues.status === 'string' ? newValues.status : null;

  if (tableName === 'tickets') {
    const assignee = lookup(refs, 'users', newValues.assignedUserId);

    switch (next) {
      case 'WAITING_ADMIN':
        return 'ส่งใบ' + ref + ' ให้แอดมิน';
      case 'ASSIGNED':
        return 'มอบหมายใบ' + ref + (assignee ? ' ให้ ' + assignee : '');
      case 'IN_PROGRESS':
        return status?.from === STATUS_BY_TABLE.tickets.RESOLVED
          ? 'ตรวจไม่ผ่าน ตีกลับใบ' + ref + ' ให้ผู้แก้ทำต่อ'
          : 'เริ่มแก้ใบ' + ref;
      case 'RESOLVED':
        return 'แก้ใบ' + ref + ' เสร็จ รอแอดมินตรวจ';
      case 'WAITING_SUPPORT':
        return 'ตรวจผ่าน ส่งใบ' + ref + ' กลับซัพพอร์ต';
      case 'REOPENED':
        return 'เปิดใบ' + ref + ' อีกครั้ง (ปัญหาเดิมกลับมา)';
      case 'CLOSED':
        return 'ปิดใบ' + ref;
    }

    if (!status && 'claimedByAdminUserId' in newValues && newValues.claimedByAdminUserId) {
      return 'รับคิวใบ' + ref;
    }

    if (!status && 'assignedUserId' in newValues) {
      return assignee
        ? 'เปลี่ยนผู้รับผิดชอบใบ' + ref + ' เป็น ' + assignee
        : 'ถอนผู้รับผิดชอบใบ' + ref;
    }
  }

  if (tableName === 'notifications') {
    switch (next) {
      case 'READ':
        return 'อ่านการแจ้งเตือน' + ref;
      case 'SENT':
        return 'ส่งการแจ้งเตือน' + ref + ' สำเร็จ';
      case 'FAILED':
        return 'ส่งการแจ้งเตือน' + ref + ' ไม่สำเร็จ';
    }
  }

  if (tableName === 'task_submissions') {
    switch (next) {
      case 'APPROVED':
        return 'ตรวจผ่านงาน' + ref;
      case 'REJECTED':
        return 'ตีกลับงาน' + ref + ' ให้แก้';
    }
  }

  if (tableName === 'deliveries' && next === null && newValues.acceptanceStatus) {
    const acceptance = enumLabel(ENUM_BY_FIELD.acceptanceStatus, newValues.acceptanceStatus);
    return 'บันทึกผลการตรวจรับใบส่งมอบ' + ref + (acceptance ? ': ' + acceptance : '');
  }

  return null;
}

function summarizeDelete(tableName: string, tableLabel: string, ref: string): string {
  if (tableName === 'attachments') {
    return 'ลบไฟล์แนบ' + ref;
  }

  return 'ลบ' + tableLabel + ref;
}

function summarizeBulkUpdate(
  tableName: string,
  tableLabel: string,
  newValues: Record<string, unknown>,
  changes: AuditChange[],
): string {
  if (tableName === 'notifications' && newValues.status === 'READ') {
    return 'อ่านการแจ้งเตือน';
  }

  if (changes.length === 0) {
    return 'deletedBy' in newValues
      ? 'บันทึกผู้ลบ' + tableLabel
      : 'แก้ไข' + tableLabel + 'หลายรายการ';
  }

  if (tableName === 'ma_contracts' && 'signedFileUrl' in newValues) {
    return 'แนบสแกนสัญญา MA ที่เซ็นแล้ว';
  }

  const status = changes.find((c) => c.field === 'status');

  if (status?.to) {
    return 'ปรับสถานะ' + tableLabel + ' เป็น ' + status.to;
  }

  return 'แก้ไข' + tableLabel + ': ' + listLabels(changes);
}

function summarizeBulkDelete(tableName: string, tableLabel: string): string {
  switch (tableName) {
    case 'role_permissions':
      return 'ถอดสิทธิ์ออกจากบทบาท';
    case 'user_roles':
      return 'ถอดบทบาทเดิมของผู้ใช้';
    default:
      return 'ลบ' + tableLabel;
  }
}

function listLabels(changes: AuditChange[]): string {
  const labels = [...new Set(changes.map((c) => c.label))];
  const shown = labels.slice(0, MAX_LABELS_IN_SUMMARY).join(', ');
  const rest = labels.length - MAX_LABELS_IN_SUMMARY;
  return rest > 0 ? shown + ' และอีก ' + String(rest) + ' ช่อง' : shown;
}

function enumLabel(labels: Record<string, string>, value: unknown): string | undefined {
  return typeof value === 'string' ? labels[value] : undefined;
}

function lookup(refs: AuditRefLabels, table: string, value: unknown): string | null {
  const id = toId(value);
  return id !== null ? (refs.get(table)?.get(id) ?? null) : null;
}

export function toId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return Number(value);
  }

  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : {};
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function truncate(value: string, max = MAX_TEXT_LENGTH): string {
  return value.length > max ? value.slice(0, max - 1) + '…' : value;
}
