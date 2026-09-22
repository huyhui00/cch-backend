import { ApiProperty } from '@nestjs/swagger';

import { Attachment } from '../../../models';

export class AttachmentUploaderDto {
  @ApiProperty({ example: 3 })
  id: number;

  @ApiProperty({ example: 'สมชาย ใจดี' })
  fullName: string;
}

/**
 * ไฟล์แนบทั่วไป (ตาราง attachments)
 *
 * **ไม่คืน object key ของที่เก็บ** — ดาวน์โหลดผ่าน downloadUrl ที่ตรวจสิทธิ์ทุกครั้ง
 */
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
