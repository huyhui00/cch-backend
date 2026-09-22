import { ApiProperty } from '@nestjs/swagger';

import { AcceptanceStatus, Attachment, Delivery, Warranty } from '../../../models';
import { WarrantySummaryDto, toWarrantySummary } from '../../warranties/dto/warranty.response';

export class UserSummaryDto {
  @ApiProperty({ example: 3 })
  id: number;

  @ApiProperty({ example: 'somchai' })
  username: string;

  @ApiProperty({ example: 'สมชาย ใจดี' })
  fullName: string;
}

export class ContactSummaryDto {
  @ApiProperty({ example: 2 })
  id: number;

  @ApiProperty({ example: 'คุณสมศรี จัดซื้อ' })
  name: string;
}

export class DeliveryProjectSummaryDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'ระบบจัดการคลังสินค้า' })
  name: string;

  @ApiProperty({ example: 1 })
  customerId: number;
}

/** ไฟล์แนบของใบส่งมอบ — ไม่คืน object key ให้ดาวน์โหลดผ่าน downloadUrl */
export class AttachmentSummaryDto {
  @ApiProperty({ example: 12 })
  id: number;

  @ApiProperty({ example: 'ใบส่งมอบเซ็นแล้ว.pdf' })
  fileName: string;

  @ApiProperty({ nullable: true, example: 248311 })
  fileSize: number | null;

  @ApiProperty({ nullable: true, example: 'application/pdf' })
  mimeType: string | null;

  @ApiProperty({
    description: 'path ดาวน์โหลดที่ต้องแนบ Authorization — ไม่ใช่ลิงก์สาธารณะ',
    example: '/api/attachments/12/download',
  })
  downloadUrl: string;

  @ApiProperty()
  createdAt: Date;
}

export class DeliveryResponseDto {
  @ApiProperty({ example: 5 })
  id: number;

  @ApiProperty({ example: 1 })
  projectId: number;

  @ApiProperty({ type: DeliveryProjectSummaryDto, nullable: true })
  project: DeliveryProjectSummaryDto | null;

  @ApiProperty({ nullable: true, example: 'DLV69-0003' })
  deliveryNo: string | null;

  @ApiProperty({ example: 'ส่งมอบระบบเฟสที่ 1 พร้อมคู่มือการใช้งาน' })
  title: string;

  @ApiProperty({ nullable: true, example: 'v1.2.0' })
  version: string | null;

  @ApiProperty({ nullable: true })
  description: string | null;

  @ApiProperty({ description: 'จุดตั้งต้นของระยะประกันทั้งหมด (BR-06)' })
  deliveredAt: Date;

  @ApiProperty({ enum: AcceptanceStatus })
  acceptanceStatus: AcceptanceStatus;

  @ApiProperty({ nullable: true, description: 'ระบบบันทึกให้เองเมื่อสถานะเป็น ACCEPTED' })
  acceptedAt: Date | null;

  @ApiProperty({ nullable: true, example: 2 })
  acceptedByContactId: number | null;

  @ApiProperty({ type: ContactSummaryDto, nullable: true })
  acceptedByContact: ContactSummaryDto | null;

  @ApiProperty({
    description: 'การส่งมอบครั้งสุดท้ายของโครงการ — คนยืนยันตอนตรวจรับ',
    example: true,
  })
  isFinal: boolean;

  @ApiProperty({
    description:
      'ออกประกันจากใบนี้ได้ไหม = ยอมรับแล้ว และเป็นการส่งมอบครั้งสุดท้าย — ' +
      'หน้าจอใช้ค่านี้เปิด/ปิดปุ่มออกประกัน ห้ามคำนวณเอง',
    example: true,
  })
  canIssueWarranty: boolean;

  @ApiProperty({ nullable: true, example: 3 })
  deliveredByUserId: number | null;

  @ApiProperty({ type: UserSummaryDto, nullable: true })
  deliveredByUser: UserSummaryDto | null;

  @ApiProperty({ nullable: true })
  note: string | null;

  @ApiProperty({
    type: [WarrantySummaryDto],
    description: 'ประกันที่เกิดจากใบส่งมอบนี้ มีค่าเฉพาะ endpoint รายละเอียด',
  })
  warranties: WarrantySummaryDto[];

  @ApiProperty({
    type: [AttachmentSummaryDto],
    description:
      'ไฟล์แนบ (ref_type = DELIVERY) มีค่าเฉพาะ endpoint รายละเอียด — ' +
      'การอัปโหลดไฟล์เป็นของโมดูล Files ใน Phase 9 ตอนนี้จึงอ่านได้อย่างเดียว',
  })
  attachments: AttachmentSummaryDto[];

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

function toUserSummary(
  user: { id: number; username: string; fullName: string } | null | undefined,
): UserSummaryDto | null {
  return user ? { id: user.id, username: user.username, fullName: user.fullName } : null;
}

export function toAttachmentSummary(attachment: Attachment): AttachmentSummaryDto {
  return {
    id: attachment.id,
    fileName: attachment.fileName,
    fileSize: attachment.fileSize === null ? null : Number(attachment.fileSize),
    mimeType: attachment.mimeType,
    downloadUrl: `/api/attachments/${attachment.id}/download`,
    createdAt: attachment.createdAt,
  };
}

/**
 * ออกประกันจากใบส่งมอบนี้ได้ไหม (ตกลง 11 ก.ย.) — ต้องเป็นครั้งสุดท้ายและลูกค้ายอมรับแล้ว
 * ใช้ตัวเดียวกันทั้งตอนออกประกันจริงและ flag ที่คืนให้หน้าจอ สูตรจะได้ไม่หลุดจากกัน
 */
export function canIssueWarranty(
  delivery: Pick<Delivery, 'acceptanceStatus' | 'isFinal'>,
): boolean {
  return delivery.acceptanceStatus === AcceptanceStatus.ACCEPTED && delivery.isFinal;
}

export function toDeliveryResponse(
  delivery: Delivery,
  extras: {
    warranties?: Warranty[];
    attachments?: Attachment[];
    /** วันที่ใช้ตัดสินว่าประกันยังคุ้มครองอยู่ — ส่งเข้ามาให้ทุกแถวในชุดเดียวกันใช้วันเดียวกัน */
    onDate: string;
  },
): DeliveryResponseDto {
  return {
    id: delivery.id,
    projectId: delivery.projectId,
    project: delivery.project
      ? {
          id: delivery.project.id,
          name: delivery.project.name,
          customerId: delivery.project.customerId,
        }
      : null,
    deliveryNo: delivery.deliveryNo,
    title: delivery.title,
    version: delivery.version,
    description: delivery.description,
    deliveredAt: delivery.deliveredAt,
    acceptanceStatus: delivery.acceptanceStatus,
    acceptedAt: delivery.acceptedAt,
    acceptedByContactId: delivery.acceptedByContactId,
    acceptedByContact: delivery.acceptedByContact
      ? { id: delivery.acceptedByContact.id, name: delivery.acceptedByContact.name }
      : null,
    isFinal: delivery.isFinal,
    canIssueWarranty: canIssueWarranty(delivery),
    deliveredByUserId: delivery.deliveredByUserId,
    deliveredByUser: toUserSummary(delivery.deliveredByUser),
    note: delivery.note,
    warranties: (extras.warranties ?? []).map((warranty) =>
      toWarrantySummary(warranty, extras.onDate),
    ),
    attachments: (extras.attachments ?? []).map(toAttachmentSummary),
    createdAt: delivery.createdAt,
    updatedAt: delivery.updatedAt,
  };
}
