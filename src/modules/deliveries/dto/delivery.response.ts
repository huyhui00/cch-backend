import { ApiProperty } from '@nestjs/swagger';

import { AcceptanceStatus, Attachment, Delivery, Warranty } from '../../../models';
import {
  AttachmentSummaryDto,
  toAttachmentSummary,
} from '../../attachments/dto/attachment.response';
import { WarrantySummaryDto, toWarrantySummary } from '../../warranties/dto/warranty.response';

export { AttachmentSummaryDto, toAttachmentSummary };

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
