import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import {
  ResolutionResult,
  Ticket,
  TicketBillingType,
  TicketPriority,
  TicketReportedChannel,
  TicketResolution,
  TicketStatus,
} from '../../../models';

/**
 * สถานะที่ถือว่า "ยังไม่จบ" — หน้าจอรอรับการแก้ไข (CLAUDE.md 9.1)
 *
 * ประกาศไว้ที่เดียวแล้วใช้ร่วมกันทั้ง query ของ /pending และค่า `isPending`
 * ในแต่ละแถว ถ้าแยกกันเขียนสองที่ วันหนึ่งจะได้รายการที่ตัวเองบอกว่าไม่ pending
 */
export const PENDING_TICKET_STATUSES: readonly TicketStatus[] = [
  TicketStatus.RECEIVED,
  TicketStatus.WAITING_ADMIN,
  TicketStatus.ASSIGNED,
  TicketStatus.REOPENED,
  TicketStatus.IN_PROGRESS,
];

/** แท็บคิวซัพพอร์ต */
export enum SupportQueueTab {
  /** รับเรื่องแล้ว รอส่งหัวหน้า */
  AWAITING_SEND = 'AWAITING_SEND',
  /** แอดมินตรวจผ่านแล้ว รอบอกลูกค้า */
  RETURNED = 'RETURNED',
}

/** แท็บคิวแอดมิน */
export enum AdminQueueTab {
  /** รอแอดมินกดรับเรื่อง */
  AWAITING_CLAIM = 'AWAITING_CLAIM',
  /** รับคิวแล้ว รอจัดแจงพนักงาน */
  CLAIMED = 'CLAIMED',
  /** พนักงานแก้เสร็จ (RESOLVED) รอตรวจผ่าน */
  AWAITING_REVIEW = 'AWAITING_REVIEW',
  /** ส่งกลับซัพพอร์ตแล้ว รอบอกลูกค้า */
  WITH_SUPPORT = 'WITH_SUPPORT',
}

export class UserSummaryDto {
  @ApiProperty({ example: 3 })
  id: number;

  @ApiProperty({ example: 'somchai' })
  username: string;

  @ApiProperty({ example: 'สมชาย ใจดี' })
  fullName: string;
}

export class TicketCustomerSummaryDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'บริษัท ตัวอย่าง จำกัด' })
  name: string;
}

export class TicketProjectSummaryDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'ระบบจัดการคลังสินค้า' })
  name: string;
}

export class TicketContactSummaryDto {
  @ApiProperty({ example: 2 })
  id: number;

  @ApiProperty({ example: 'คุณสมศรี จัดซื้อ' })
  name: string;
}

/** ขั้นใน stepper ของหนึ่งรอบแก้ (B-11) */
export class ResolutionStepDto {
  @ApiProperty({ example: 'STARTED', description: 'STARTED | RECORDED' })
  code: 'STARTED' | 'RECORDED';

  @ApiProperty({ example: 'เริ่มลงมือ' })
  label: string;

  @ApiProperty()
  at: Date;

  @ApiPropertyOptional({ enum: ResolutionResult, nullable: true })
  result?: ResolutionResult | null;
}

/** ไฟล์แนบแบบย่อในรายการรอบ */
export class ResolutionAttachmentDto {
  @ApiProperty({ example: 12 })
  id: number;

  @ApiProperty({ example: 'ใบยืนยันการแก้ไข-เซ็นแล้ว.pdf' })
  fileName: string;

  @ApiProperty({ example: '/api/attachments/12/download' })
  downloadUrl: string;

  @ApiPropertyOptional({ nullable: true })
  note: string | null;

  @ApiProperty()
  createdAt: Date;
}

/** รอบการแก้หนึ่งรอบ (BR-03) */
export class ResolutionResponseDto {
  @ApiProperty({ example: 9 })
  id: number;

  @ApiProperty({ example: 7 })
  ticketId: number;

  @ApiProperty({ description: 'รอบที่เท่าไหร่ เริ่มที่ 1 ระบบนับให้เอง', example: 1 })
  round: number;

  @ApiProperty({ enum: ResolutionResult })
  result: ResolutionResult;

  @ApiProperty({ example: 'แก้ query ที่ join ผิดตาราง' })
  detail: string;

  @ApiProperty({ nullable: true })
  rootCause: string | null;

  @ApiProperty({ nullable: true, example: 4 })
  resolvedByUserId: number | null;

  @ApiProperty({ type: UserSummaryDto, nullable: true })
  resolvedBy: UserSummaryDto | null;

  @ApiProperty({ nullable: true })
  startedAt: Date | null;

  @ApiProperty()
  resolvedAt: Date;

  @ApiProperty({ nullable: true, example: '3.50' })
  hoursSpent: string | null;

  @ApiProperty({
    type: [ResolutionStepDto],
    description: 'ขั้นของรอบนี้สำหรับ stepper บนหน้ารายละเอียด (B-11)',
  })
  steps: ResolutionStepDto[];

  @ApiProperty({
    type: [ResolutionAttachmentDto],
    description: 'ไฟล์แนบของรอบนี้ (refType=TICKET_RESOLUTION) รวมสแกนใบยืนยัน B-12',
  })
  attachments: ResolutionAttachmentDto[];

  @ApiProperty()
  createdAt: Date;
}

/**
 * สิ่งที่ระบบตรวจเจอตอนเปิดใบ — ใช้ *เสนอ* ประเภทการคิดเงิน ไม่ใช่บังคับ (BR-07)
 */
export class WarrantyCoverageDto {
  @ApiProperty({ example: 4 })
  warrantyId: number;

  @ApiProperty({ example: '2027-09-08' })
  endDate: string;

  @ApiProperty({ nullable: true })
  scopeNote: string | null;
}

export class MaPlanItemCoverageDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'Remote Support' })
  title: string;

  @ApiProperty({ nullable: true })
  detail: string | null;
}

export class MaCoverageDto {
  @ApiProperty({ example: 2 })
  contractId: number;

  @ApiProperty({ nullable: true, example: 'Standard MA' })
  planName: string | null;

  @ApiProperty({ nullable: true })
  planDescription: string | null;

  @ApiProperty({ type: [MaPlanItemCoverageDto] })
  items: MaPlanItemCoverageDto[];

  @ApiProperty({ example: '2027-12-31' })
  endDate: string;
}

export class BillingSuggestionDto {
  @ApiProperty({
    enum: TicketBillingType,
    nullable: true,
    description: 'ประเภทที่ระบบเสนอ — null เมื่อไม่เจอทั้งประกันและสัญญา MA ที่ยังคุ้มครอง',
    example: TicketBillingType.WARRANTY,
  })
  suggested: TicketBillingType | null;

  @ApiProperty({ nullable: true, description: 'ประกันที่ยังคุ้มครองอยู่ ณ วันที่แจ้ง', example: 4 })
  warrantyId: number | null;

  @ApiProperty({
    nullable: true,
    description: 'วันสิ้นสุด Warranty ที่ระบบตรวจพบ ใช้ประกอบการตัดสินใจของผู้รับเรื่อง',
    example: '2027-09-08',
  })
  warrantyEndDate: string | null;

  @ApiProperty({
    nullable: true,
    description: 'ขอบเขต Warranty ที่บันทึกไว้ ใช้ให้คนตรวจว่าเป็นงานเดิมหรือคำขอใหม่',
    example: 'ครอบคลุมข้อผิดพลาดของฟังก์ชันเดิม ไม่รวมการเพิ่มรายงานใหม่',
  })
  warrantyScopeNote: string | null;

  @ApiProperty({
    nullable: true,
    description: 'สรุปขอบเขตประกันสำหรับให้เจ้าหน้าที่ตรวจประกอบการตัดสินใจ',
  })
  warrantyCoverage: WarrantyCoverageDto | null;

  @ApiProperty({
    nullable: true,
    description: 'สัญญา MA ที่ยัง ACTIVE อยู่ ณ วันที่แจ้ง',
    example: 2,
  })
  maContractId: number | null;

  @ApiProperty({
    nullable: true,
    description: 'แผน MA และรายการบริการย่อยของสัญญาที่พบ ใช้เป็นข้อมูลอ้างอิงเท่านั้น',
  })
  maCoverage: MaCoverageDto | null;

  @ApiProperty({ nullable: true, description: 'โควตา MA ที่เหลือในรอบปัจจุบัน' })
  maRemaining: number | null;

  @ApiProperty({ nullable: true, description: 'โควตา MA เต็มแล้วหรือยัง' })
  maIsExhausted: boolean | null;

  @ApiProperty({
    description:
      'เป็น true เมื่อมี Warranty และ MA พร้อมกัน โดย MA ใช้อ้างอิงเท่านั้น ไม่หักโควตา MA ในคำแนะนำนี้',
    example: true,
  })
  maIsReferenceOnly: boolean;

  @ApiProperty({
    description: 'เหตุผลที่เสนอแบบนี้ ให้คนอ่านประกอบการตัดสินใจ',
    example: 'อยู่ในระยะประกันถึง 2027-09-08',
  })
  reason: string;
}

/** สรุปโควตา MA ของรอบที่การแก้ครั้งนี้ตกอยู่ */
/**
 * สถานะโควตาที่พ่วงกลับไปตอนบันทึกผลการแก้ปัญหา
 *
 * ฟิลด์ตรงกับ `QuotaStatusResponseDto` ของ `GET /api/ma-contracts/:id/quota`
 * ทุกตัว **ยกเว้นตัวสุดท้าย** ที่ตั้งใจใช้คนละชื่อ เพราะความหมายต่างกันจริง ๆ
 * ตามบริบท — อย่า "แก้ให้เหมือนกัน" โดยไม่อ่านคำอธิบายข้างล่างก่อน
 *
 *   ที่นี่                `isOverQuota` = **ครั้งนี้** ที่เพิ่งหักไป เกินโควตาหรือไม่
 *   ฝั่ง ma-contracts     `isExhausted` = โควตาเต็มแล้วหรือยัง ครั้ง**ถัดไป**จะเกิน
 *
 * ทั้งสองค่าคำนวณจาก `willExceed` ตัวเดียวกัน (ยอดก่อนหัก >= โควตา) ต่างกันที่
 * ฝั่งนี้หักไปแล้วหนึ่งครั้ง ประโยคที่ถูกต้องจึงเป็นอดีต ส่วนอีกฝั่งยังไม่หัก เป็นอนาคต
 */
export class QuotaSummaryDto {
  @ApiProperty({ example: 2 })
  contractId: number;

  @ApiProperty({
    description: 'ปีของรอบโควตา — รอบนับจากวันเริ่มสัญญา ไม่ใช่เดือนปฏิทิน (Q2)',
    example: 2026,
  })
  periodYear: number;

  @ApiProperty({ example: 11 })
  periodMonth: number;

  @ApiProperty({
    description: 'วันแรกของรอบ — ใช้แสดงบนหน้าจอเพราะปี/เดือนอย่างเดียวสื่อไม่ครบ',
    example: '2026-11-15',
  })
  periodStart: string;

  @ApiProperty({ description: 'วันสุดท้ายของรอบ นับรวมอยู่ในรอบ', example: '2026-12-14' })
  periodEnd: string;

  @ApiProperty({ description: 'โควตารวมของรอบ = แผน + addon ที่มีผล', example: 5 })
  quota: number;

  @ApiProperty({ description: 'ใช้ไปแล้วกี่ครั้งในรอบนี้ นับรวมครั้งนี้แล้ว', example: 3 })
  used: number;

  @ApiProperty({
    description: 'เหลืออีกกี่ครั้งหลังหักครั้งนี้ ติดลบได้เมื่อใช้เกินไปแล้ว',
    example: 2,
  })
  remaining: number;

  @ApiProperty({
    description:
      'ครั้งนี้เกินโควตาหรือไม่ — ตรงกับ ma_usages.is_over_quota ที่บันทึกไว้ ' +
      'คนละความหมายกับ isExhausted ของ GET /api/ma-contracts/:id/quota',
    example: false,
  })
  isOverQuota: boolean;
}

export class TicketResponseDto {
  @ApiProperty({ example: 7 })
  id: number;

  @ApiProperty({ nullable: true, example: 'TK69-0006' })
  ticketNo: string | null;

  @ApiProperty({ example: 1 })
  customerId: number;

  @ApiProperty({ type: TicketCustomerSummaryDto, nullable: true })
  customer: TicketCustomerSummaryDto | null;

  @ApiProperty({ nullable: true, example: 1 })
  projectId: number | null;

  @ApiProperty({ type: TicketProjectSummaryDto, nullable: true })
  project: TicketProjectSummaryDto | null;

  @ApiProperty({ example: 'หน้าจอรายงานสรุปยอดขายโหลดไม่ขึ้น' })
  title: string;

  @ApiProperty({ nullable: true })
  description: string | null;

  @ApiProperty({ enum: TicketStatus })
  status: TicketStatus;

  @ApiProperty({
    description:
      'ยังรอการแก้ไขอยู่หรือไม่ = สถานะอยู่ใน RECEIVED, WAITING_ADMIN, ASSIGNED, REOPENED, IN_PROGRESS',
    example: true,
  })
  isPending: boolean;

  @ApiProperty({ enum: TicketPriority })
  priority: TicketPriority;

  @ApiProperty({
    enum: TicketBillingType,
    description: 'BR-08 บั๊กเล็กทำฟรีได้ แต่ต้องเลือก FREE ไม่ใช่เว้นว่าง',
  })
  billingType: TicketBillingType;

  @ApiProperty({ enum: TicketReportedChannel })
  reportedChannel: TicketReportedChannel;

  @ApiProperty({ description: 'เวลาที่ลูกค้าแจ้งจริง (BR-02)' })
  reportedAt: Date;

  @ApiProperty({ nullable: true, example: 2 })
  reportedByContactId: number | null;

  @ApiProperty({ type: TicketContactSummaryDto, nullable: true })
  reportedByContact: TicketContactSummaryDto | null;

  @ApiProperty({ nullable: true, example: 4 })
  assignedUserId: number | null;

  @ApiProperty({ type: UserSummaryDto, nullable: true })
  assignedUser: UserSummaryDto | null;

  @ApiProperty({ nullable: true, example: 3 })
  receivedByUserId: number | null;

  @ApiProperty({ type: UserSummaryDto, nullable: true, description: 'ผู้รับเรื่อง แยกจากผู้แก้ไข' })
  receivedByUser: UserSummaryDto | null;

  @ApiProperty({
    nullable: true,
    example: 2,
    description: 'แอดมินผู้รับคิวจากซัพพอร์ต (C-1) — คนละคนกับผู้รับเรื่องและผู้แก้',
  })
  claimedByAdminUserId: number | null;

  @ApiProperty({
    type: UserSummaryDto,
    nullable: true,
    description: 'แอดมินผู้รับคิว',
  })
  claimedByAdminUser: UserSummaryDto | null;

  @ApiProperty({ nullable: true, example: 4 })
  warrantyId: number | null;

  @ApiProperty({ nullable: true, example: 2 })
  maContractId: number | null;

  @ApiProperty({ description: 'จำนวนรอบที่แก้ไปแล้ว (BR-03)', example: 2 })
  resolutionCount: number;

  @ApiProperty({ nullable: true })
  firstResponseAt: Date | null;

  @ApiProperty({ nullable: true })
  resolvedAt: Date | null;

  @ApiProperty({ nullable: true })
  closedAt: Date | null;

  @ApiProperty({ nullable: true })
  dueAt: Date | null;

  @ApiProperty({ nullable: true, example: '1500.00' })
  extraCharge: string | null;

  @ApiProperty({
    type: [ResolutionResponseDto],
    description: 'ทุกรอบที่ลงมือแก้ เรียงตาม round จากน้อยไปมาก มีค่าเฉพาะ endpoint รายละเอียด',
  })
  resolutions: ResolutionResponseDto[];

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

/** ผลของการบันทึกการแก้หนึ่งรอบ พร้อมสถานะโควตาที่กระทบ */
export class ResolutionCreatedDto {
  @ApiProperty({ type: TicketResponseDto })
  ticket: TicketResponseDto;

  @ApiProperty({ type: ResolutionResponseDto })
  resolution: ResolutionResponseDto;

  @ApiProperty({
    type: QuotaSummaryDto,
    nullable: true,
    description:
      'มีค่าเฉพาะรอบที่หักโควตา MA จริง — รอบถัดไปของใบเดิมเป็น null ' +
      'เพราะ 1 ปัญหาหักโควตาได้ครั้งเดียว ไม่ว่าจะแก้กี่รอบ',
  })
  quota: QuotaSummaryDto | null;
}

function toUserSummary(
  user: { id: number; username: string; fullName: string } | null | undefined,
): UserSummaryDto | null {
  return user ? { id: user.id, username: user.username, fullName: user.fullName } : null;
}

export function isTicketPending(status: TicketStatus): boolean {
  return PENDING_TICKET_STATUSES.includes(status);
}

export function buildResolutionSteps(resolution: TicketResolution): ResolutionStepDto[] {
  const steps: ResolutionStepDto[] = [];
  if (resolution.startedAt) {
    steps.push({
      code: 'STARTED',
      label: 'เริ่มลงมือ',
      at: resolution.startedAt,
      result: null,
    });
  }
  steps.push({
    code: 'RECORDED',
    label: 'บันทึกผลการแก้ไข',
    at: resolution.resolvedAt,
    result: resolution.result,
  });
  return steps;
}

export function toResolutionAttachment(row: {
  id: number;
  fileName: string;
  note: string | null;
  createdAt: Date;
}): ResolutionAttachmentDto {
  return {
    id: row.id,
    fileName: row.fileName,
    downloadUrl: `/api/attachments/${row.id}/download`,
    note: row.note,
    createdAt: row.createdAt,
  };
}

export function toResolutionResponse(
  resolution: TicketResolution,
  attachments: ResolutionAttachmentDto[] = [],
): ResolutionResponseDto {
  return {
    id: resolution.id,
    ticketId: resolution.ticketId,
    round: resolution.round,
    result: resolution.result,
    detail: resolution.detail,
    rootCause: resolution.rootCause,
    resolvedByUserId: resolution.resolvedByUserId,
    resolvedBy: toUserSummary(resolution.resolvedBy),
    startedAt: resolution.startedAt,
    resolvedAt: resolution.resolvedAt,
    hoursSpent: resolution.hoursSpent,
    steps: buildResolutionSteps(resolution),
    attachments,
    createdAt: resolution.createdAt,
  };
}

export function toTicketResponse(
  ticket: Ticket,
  resolutions: TicketResolution[] = [],
  attachmentsByResolutionId: ReadonlyMap<number, ResolutionAttachmentDto[]> = new Map(),
): TicketResponseDto {
  return {
    id: ticket.id,
    ticketNo: ticket.ticketNo,
    customerId: ticket.customerId,
    customer: ticket.customer ? { id: ticket.customer.id, name: ticket.customer.name } : null,
    projectId: ticket.projectId,
    project: ticket.project ? { id: ticket.project.id, name: ticket.project.name } : null,
    title: ticket.title,
    description: ticket.description,
    status: ticket.status,
    isPending: isTicketPending(ticket.status),
    priority: ticket.priority,
    billingType: ticket.billingType,
    reportedChannel: ticket.reportedChannel,
    reportedAt: ticket.reportedAt,
    reportedByContactId: ticket.reportedByContactId,
    reportedByContact: ticket.reportedByContact
      ? { id: ticket.reportedByContact.id, name: ticket.reportedByContact.name }
      : null,
    assignedUserId: ticket.assignedUserId,
    assignedUser: toUserSummary(ticket.assignedUser),
    receivedByUserId: ticket.receivedByUserId,
    receivedByUser: toUserSummary(ticket.receivedByUser),
    claimedByAdminUserId: ticket.claimedByAdminUserId,
    claimedByAdminUser: toUserSummary(ticket.claimedByAdminUser),
    warrantyId: ticket.warrantyId,
    maContractId: ticket.maContractId,
    resolutionCount: ticket.resolutionCount,
    firstResponseAt: ticket.firstResponseAt,
    resolvedAt: ticket.resolvedAt,
    closedAt: ticket.closedAt,
    dueAt: ticket.dueAt,
    extraCharge: ticket.extraCharge,
    resolutions: resolutions.map((item) =>
      toResolutionResponse(item, attachmentsByResolutionId.get(item.id) ?? []),
    ),
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
  };
}

/**
 * B-12 — ข้อมูลสำหรับพิมพ์ใบยืนยันการแก้ไขให้ลูกค้าเซ็น
 * คืน JSON ไม่ใช่ไฟล์ (หลักเดียวกับพิมพ์ร่างสัญญา MA) · FE จัดหน้ากระดาษเอง
 */
export class TicketConfirmationPrintDto {
  @ApiProperty({ example: 'ใบยืนยันการแก้ไขปัญหา' })
  documentTitle: string;

  @ApiProperty({
    description: 'พิมพ์รอบที่ระบุ หรือรอบล่าสุดถ้าไม่ส่ง round',
  })
  ticket: {
    id: number;
    ticketNo: string | null;
    title: string;
    description: string | null;
    status: TicketStatus;
    priority: TicketPriority;
    billingType: TicketBillingType;
    reportedChannel: TicketReportedChannel;
    reportedAt: Date;
    resolvedAt: Date | null;
    closedAt: Date | null;
  };

  @ApiProperty()
  customer: {
    id: number;
    code: string | null;
    name: string;
    taxId: string | null;
    address: string | null;
    phone: string | null;
  };

  @ApiProperty({ nullable: true })
  project: { id: number; code: string | null; name: string } | null;

  @ApiProperty({ nullable: true })
  reportedByContact: {
    id: number;
    name: string;
    phone: string | null;
    email: string | null;
  } | null;

  @ApiProperty({
    description: 'รอบที่ใช้พิมพ์ — มักเป็นรอบล่าสุดที่แก้สำเร็จ',
  })
  resolution: ResolutionResponseDto;

  @ApiProperty({
    type: [ResolutionResponseDto],
    description: 'ทุกรอบของใบนี้ เผื่อหน้าพิมพ์อยากสรุปประวัติสั้น ๆ',
  })
  allResolutions: ResolutionResponseDto[];

  @ApiProperty({
    description: 'ช่องว่างสำหรับลายเซ็น — FE วาดเอง ไม่มี e-sign (BR-12)',
  })
  signatureBlocks: { role: string; label: string }[];

  @ApiProperty({
    description: 'คำแนะนำหลังพิมพ์ — สแกนแนบกลับด้วย POST /api/attachments',
  })
  attachScanHint: {
    refType: 'TICKET_RESOLUTION';
    refId: number;
    noteSuggestion: string;
  };
}
