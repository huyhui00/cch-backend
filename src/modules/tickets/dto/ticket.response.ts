import { ApiProperty } from '@nestjs/swagger';

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
  TicketStatus.REOPENED,
  TicketStatus.IN_PROGRESS,
];

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

  @ApiProperty()
  createdAt: Date;
}

/**
 * สิ่งที่ระบบตรวจเจอตอนเปิดใบ — ใช้ *เสนอ* ประเภทการคิดเงิน ไม่ใช่บังคับ (BR-07)
 */
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
    description: 'สัญญา MA ที่ยัง ACTIVE อยู่ ณ วันที่แจ้ง',
    example: 2,
  })
  maContractId: number | null;

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

  @ApiProperty({ nullable: true, example: 'TK-2026-001' })
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
    description: 'ยังรอการแก้ไขอยู่หรือไม่ = สถานะอยู่ใน RECEIVED, REOPENED, IN_PROGRESS',
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

export function toResolutionResponse(resolution: TicketResolution): ResolutionResponseDto {
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
    createdAt: resolution.createdAt,
  };
}

export function toTicketResponse(
  ticket: Ticket,
  resolutions: TicketResolution[] = [],
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
    warrantyId: ticket.warrantyId,
    maContractId: ticket.maContractId,
    resolutionCount: ticket.resolutionCount,
    firstResponseAt: ticket.firstResponseAt,
    resolvedAt: ticket.resolvedAt,
    closedAt: ticket.closedAt,
    dueAt: ticket.dueAt,
    extraCharge: ticket.extraCharge,
    resolutions: resolutions.map(toResolutionResponse),
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
  };
}
