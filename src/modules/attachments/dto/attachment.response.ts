import { ApiProperty } from '@nestjs/swagger';

import { Attachment } from '../../../models';

export class AttachmentUploaderDto {
  @ApiProperty({ example: 3 })
  id: number;

  @ApiProperty({ example: 'สมชาย ใจดี' })
  fullName: string;
}

export class AttachmentResponseDto {
  @ApiProperty({ example: 12 })
  id: number;

  @ApiProperty({ example: 'COMMUNICATION_LOG' })
  refType: string;

  @ApiProperty({ example: 5 })
  refId: number;

  @ApiProperty({ example: 'หลักฐานแชท LINE.png' })
  fileName: string;

  @ApiProperty({ nullable: true, example: 248311 })
  fileSize: number | null;

  @ApiProperty({ nullable: true, example: 'image/png' })
  mimeType: string | null;

  @ApiProperty({ nullable: true, description: 'หมายเหตุประกอบไฟล์' })
  note: string | null;

  @ApiProperty({
    description:
      'path สำหรับดาวน์โหลด (ต่อท้าย base URL ของ API) — ต้องแนบ Authorization ' +
      'เปิดด้วย <a href> ตรง ๆ ไม่ได้ ให้ดึงเป็น blob',
    example: '/api/attachments/12/download',
  })
  downloadUrl: string;

  @ApiProperty({ type: AttachmentUploaderDto, nullable: true })
  uploadedBy: AttachmentUploaderDto | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

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

export function toAttachmentResponse(
  attachment: Attachment,
  uploaders: ReadonlyMap<number, AttachmentUploaderDto> = new Map(),
): AttachmentResponseDto {
  const uploaderId = attachment.uploadedByUserId ?? attachment.createdBy;

  return {
    id: attachment.id,
    refType: attachment.refType,
    refId: attachment.refId,
    fileName: attachment.fileName,
    fileSize: attachment.fileSize === null ? null : Number(attachment.fileSize),
    mimeType: attachment.mimeType,
    note: attachment.note,
    downloadUrl: `/api/attachments/${attachment.id}/download`,
    uploadedBy: uploaderId ? (uploaders.get(uploaderId) ?? null) : null,
    createdAt: attachment.createdAt,
    updatedAt: attachment.updatedAt,
  };
}
