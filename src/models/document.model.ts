import { BelongsTo, Column, DataType, ForeignKey, Table } from 'sequelize-typescript';

import { AuditedModel } from './base.model';
import { Customer } from './customer.model';
import { Project } from './project.model';

export enum DocumentType {
  QUOTATION = 'QUOTATION',
  PO = 'PO',
  CONTRACT = 'CONTRACT',
  DELIVERY_NOTE = 'DELIVERY_NOTE',
  MA_CONTRACT = 'MA_CONTRACT',
  OTHER = 'OTHER',
}

/**
 * BR-12 — สัญญาเซ็นมือต่อหน้าแล้วสแกนเข้าระบบ
 * ไม่มี e-signature มีแต่ไฟล์ที่ upload ขึ้น Cloudflare R2
 */
@Table({ tableName: 'documents', underscored: true, timestamps: true, paranoid: true })
export class Document extends AuditedModel<Document> {
  @ForeignKey(() => Customer)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: true, field: 'customer_id' })
  customerId: number | null;

  @ForeignKey(() => Project)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: true, field: 'project_id' })
  projectId: number | null;

  @Column({
    type: DataType.ENUM(...Object.values(DocumentType)),
    allowNull: false,
    field: 'doc_type',
  })
  docType: DocumentType;

  @Column({ type: DataType.STRING(100), allowNull: true, field: 'doc_no' })
  docNo: string | null;

  @Column({ type: DataType.STRING(255), allowNull: false })
  title: string;

  @Column({ type: DataType.DATEONLY, allowNull: true, field: 'issued_date' })
  issuedDate: string | null;

  /** object key ใน R2 ไม่ใช่ URL สาธารณะ */
  @Column({ type: DataType.STRING(500), allowNull: true, field: 'file_url' })
  fileUrl: string | null;

  @Column({ type: DataType.STRING(255), allowNull: true, field: 'file_name' })
  fileName: string | null;

  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: true, field: 'file_size' })
  fileSize: number | null;

  @Column({ type: DataType.STRING(100), allowNull: true, field: 'mime_type' })
  mimeType: string | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  note: string | null;

  @BelongsTo(() => Customer)
  customer: Customer;

  @BelongsTo(() => Project)
  project: Project;
}
