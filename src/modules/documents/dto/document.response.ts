import { ApiProperty } from '@nestjs/swagger';

import { Document } from '../../../models';

export class DocumentUploaderDto {
  @ApiProperty({ example: 3 })
  id: number;

  @ApiProperty({ example: 'สมชาย ใจดี' })
  fullName: string;
}

export class DocumentResponseDto {
  @ApiProperty({ example: 12 })
  id: number;

  @ApiProperty({ example: 3 })
  projectId: number;

  @ApiProperty({ description: 'ลูกค้าเจ้าของโครงการ — คัดลอกจากโครงการตอนอัปโหลด', example: 1 })
  customerId: number | null;

  @ApiProperty({ example: 'ใบเสนอราคา งวดที่ 1' })
  title: string;

  @ApiProperty({ nullable: true, description: 'รายละเอียดเอกสาร' })
  note: string | null;

  @ApiProperty({ nullable: true, example: 'ใบเสนอราคา-v2.pdf' })
  fileName: string | null;

  @ApiProperty({ nullable: true, description: 'ขนาดไฟล์ (ไบต์)', example: 248311 })
  fileSize: number | null;

  @ApiProperty({ nullable: true, example: 'application/pdf' })
  mimeType: string | null;

  @ApiProperty({
    description:
      'path สำหรับดาวน์โหลด (ต่อท้าย base URL ของ API) — ต้องแนบ Authorization header ' +
      'เหมือนเส้นอื่น จึงเปิดด้วย <a href> ตรง ๆ ไม่ได้ ให้ดึงเป็น blob แล้วค่อยบันทึก/เปิด',
    example: '/api/documents/12/download',
  })
  downloadUrl: string;

  @ApiProperty({ type: DocumentUploaderDto, nullable: true, description: 'ผู้อัปโหลด' })
  uploadedBy: DocumentUploaderDto | null;

  @ApiProperty({ description: 'เวลาที่อัปโหลด' })
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class DocumentProjectSummaryDto {
  @ApiProperty({ example: 3 })
  id: number;

  @ApiProperty({ nullable: true, example: 'PRJ69-0001' })
  code: string | null;

  @ApiProperty({ example: 'ระบบจัดการคลังสินค้า' })
  name: string;

  @ApiProperty({
    nullable: true,
    description: 'ชื่อลูกค้าเจ้าของโครงการ',
    example: 'บริษัท เอ จำกัด',
  })
  customerName: string | null;
}

export class CompanyDocumentResponseDto extends DocumentResponseDto {
  @ApiProperty({ type: DocumentProjectSummaryDto, nullable: true })
  project: DocumentProjectSummaryDto | null;
}

export function toCompanyDocumentResponse(
  document: Document,
  uploaders: ReadonlyMap<number, DocumentUploaderDto>,
): CompanyDocumentResponseDto {
  const project = document.project;

  return {
    ...toDocumentResponse(document, uploaders),
    project: project
      ? {
          id: project.id,
          code: project.code,
          name: project.name,
          customerName: project.customer?.name ?? null,
        }
      : null,
  };
}

export function toDocumentResponse(
  document: Document,
  uploaders: ReadonlyMap<number, DocumentUploaderDto>,
): DocumentResponseDto {
  return {
    id: document.id,
    projectId: document.projectId as number,
    customerId: document.customerId,
    title: document.title,
    note: document.note,
    fileName: document.fileName,
    fileSize: document.fileSize === null ? null : Number(document.fileSize),
    mimeType: document.mimeType,
    downloadUrl: `/api/documents/${document.id}/download`,
    uploadedBy: document.createdBy ? (uploaders.get(document.createdBy) ?? null) : null,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}
