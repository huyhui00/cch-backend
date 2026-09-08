import { ApiProperty } from '@nestjs/swagger';

import {
  CommunicationChannel,
  CommunicationLog,
  Contact,
  Customer,
  CustomerStatus,
} from '../../../models';

/** ผู้ใช้แบบย่อ — ใช้แสดงชื่อผู้ดูแลหรือผู้ที่คุยกับลูกค้า โดยไม่ต้องยิงถามตาราง users ซ้ำ */
export class UserSummaryDto {
  @ApiProperty({ example: 3 })
  id: number;

  @ApiProperty({ example: 'somchai' })
  username: string;

  @ApiProperty({ example: 'สมชาย ใจดี' })
  fullName: string;
}

export class ContactResponseDto {
  @ApiProperty({ example: 2 })
  id: number;

  @ApiProperty({ example: 1 })
  customerId: number;

  @ApiProperty({ example: 'คุณสมศรี จัดซื้อ' })
  name: string;

  @ApiProperty({ nullable: true, example: 'ศรี' })
  nickname: string | null;

  @ApiProperty({ nullable: true, example: 'ผู้จัดการฝ่ายจัดซื้อ' })
  position: string | null;

  @ApiProperty({ nullable: true, example: '081-234-5678' })
  phone: string | null;

  @ApiProperty({ nullable: true })
  email: string | null;

  @ApiProperty({ nullable: true })
  lineId: string | null;

  @ApiProperty({ description: 'ผู้ติดต่อหลัก มีได้คนเดียวต่อลูกค้า 1 ราย', example: true })
  isPrimary: boolean;

  @ApiProperty({ nullable: true })
  note: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class CustomerResponseDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ nullable: true, example: 'CUS-001' })
  code: string | null;

  @ApiProperty({ example: 'บริษัท ตัวอย่าง จำกัด' })
  name: string;

  @ApiProperty({ nullable: true, example: '0105558000000' })
  taxId: string | null;

  @ApiProperty({ nullable: true, example: 'โรงงานผลิตชิ้นส่วน' })
  businessType: string | null;

  @ApiProperty({ nullable: true })
  address: string | null;

  @ApiProperty({ nullable: true, example: 'ชลบุรี' })
  province: string | null;

  @ApiProperty({ nullable: true, example: '20000' })
  postalCode: string | null;

  @ApiProperty({ nullable: true })
  phone: string | null;

  @ApiProperty({ nullable: true })
  email: string | null;

  @ApiProperty({ nullable: true })
  website: string | null;

  @ApiProperty({ nullable: true })
  lineOfficialId: string | null;

  @ApiProperty({ nullable: true })
  facebookUrl: string | null;

  @ApiProperty({ enum: CustomerStatus })
  status: CustomerStatus;

  @ApiProperty({ nullable: true, example: 'งานแสดงสินค้า' })
  source: string | null;

  @ApiProperty({ nullable: true, example: 3 })
  ownerUserId: number | null;

  @ApiProperty({ type: UserSummaryDto, nullable: true, description: 'พนักงานที่ดูแลลูกค้ารายนี้' })
  owner: UserSummaryDto | null;

  @ApiProperty({
    nullable: true,
    description: 'ระบบอัปเดตให้เองเมื่อบันทึกการติดต่อ ไม่ใช่ค่าที่กรอกเอง',
  })
  lastContactedAt: Date | null;

  @ApiProperty({
    nullable: true,
    description: 'จำนวนวันที่ไม่ได้ติดต่อ — null เมื่อยังไม่เคยติดต่อเลย',
    example: 12,
  })
  daysSinceLastContact: number | null;

  @ApiProperty({ nullable: true })
  note: string | null;

  @ApiProperty({
    type: [ContactResponseDto],
    description: 'ผู้ติดต่อทั้งหมด จะมีค่าเฉพาะ endpoint ที่ include มาให้',
  })
  contacts: ContactResponseDto[];

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class CommunicationLogResponseDto {
  @ApiProperty({ example: 10 })
  id: number;

  @ApiProperty({ example: 1 })
  customerId: number;

  @ApiProperty({ nullable: true, example: 2 })
  contactId: number | null;

  @ApiProperty({ enum: CommunicationChannel })
  channel: CommunicationChannel;

  @ApiProperty({ description: 'เวลาที่คุยกันจริง' })
  occurredAt: Date;

  @ApiProperty({ nullable: true, example: 'แจ้งปัญหาหน้าจอรายงานช้า' })
  subject: string | null;

  @ApiProperty({ nullable: true })
  content: string | null;

  @ApiProperty({ nullable: true, example: 3 })
  handledByUserId: number | null;

  @ApiProperty({ type: UserSummaryDto, nullable: true, description: 'พนักงานที่เป็นคนคุย' })
  handledBy: UserSummaryDto | null;

  @ApiProperty({ nullable: true, description: 'ผู้ติดต่อฝั่งลูกค้าที่คุยด้วย' })
  contactName: string | null;

  @ApiProperty({ description: 'เวลาที่กดบันทึกเข้าระบบ ซึ่งมักช้ากว่า occurredAt (BR-02)' })
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** วันที่ไม่ได้ติดต่อ — คืน null เมื่อยังไม่เคยติดต่อเลย เพื่อแยกจากค่า 0 ที่แปลว่าติดต่อวันนี้ */
function daysSince(date: Date | null): number | null {
  if (!date) {
    return null;
  }
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / MS_PER_DAY));
}

function toUserSummary(
  user: { id: number; username: string; fullName: string } | null | undefined,
) {
  return user ? { id: user.id, username: user.username, fullName: user.fullName } : null;
}

export function toContactResponse(contact: Contact): ContactResponseDto {
  return {
    id: contact.id,
    customerId: contact.customerId,
    name: contact.name,
    nickname: contact.nickname,
    position: contact.position,
    phone: contact.phone,
    email: contact.email,
    lineId: contact.lineId,
    isPrimary: contact.isPrimary,
    note: contact.note,
    createdAt: contact.createdAt,
    updatedAt: contact.updatedAt,
  };
}

export function toCustomerResponse(customer: Customer): CustomerResponseDto {
  return {
    id: customer.id,
    code: customer.code,
    name: customer.name,
    taxId: customer.taxId,
    businessType: customer.businessType,
    address: customer.address,
    province: customer.province,
    postalCode: customer.postalCode,
    phone: customer.phone,
    email: customer.email,
    website: customer.website,
    lineOfficialId: customer.lineOfficialId,
    facebookUrl: customer.facebookUrl,
    status: customer.status,
    source: customer.source,
    ownerUserId: customer.ownerUserId,
    owner: toUserSummary(customer.owner),
    lastContactedAt: customer.lastContactedAt,
    daysSinceLastContact: daysSince(customer.lastContactedAt),
    note: customer.note,
    contacts: (customer.contacts ?? []).map(toContactResponse),
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
  };
}

export function toCommunicationLogResponse(log: CommunicationLog): CommunicationLogResponseDto {
  return {
    id: log.id,
    customerId: log.customerId,
    contactId: log.contactId,
    channel: log.channel,
    occurredAt: log.occurredAt,
    subject: log.subject,
    content: log.content,
    handledByUserId: log.handledByUserId,
    handledBy: toUserSummary(log.handledBy),
    contactName: log.contact ? log.contact.name : null,
    createdAt: log.createdAt,
    updatedAt: log.updatedAt,
  };
}
