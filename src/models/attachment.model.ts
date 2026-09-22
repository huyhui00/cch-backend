import { BelongsTo, Column, DataType, ForeignKey, Table } from 'sequelize-typescript';

import { AuditedModel } from './base.model';
import { User } from './user.model';

/**
 * ค่าที่ ref_type รับได้ — เก็บเป็น VARCHAR ไม่ใช่ ENUM เพราะ CLAUDE.md ข้อ 8
 * ยังไม่ได้กำหนด enum ชุดนี้ไว้ และรายการนี้จะยาวขึ้นเรื่อย ๆ ตาม module ที่เพิ่ม
 * service ต้อง validate ด้วยค่าจากตรงนี้เสมอ ห้ามรับ string อิสระจาก client
 */
export const ATTACHMENT_REF_TYPES = [
  'TICKET',
  'TICKET_RESOLUTION',
  'COMMUNICATION_LOG',
  'DELIVERY',
  'PROJECT',
  'CUSTOMER',
  'MA_CONTRACT',
  'FOLLOW_UP',
] as const;

export type AttachmentRefType = (typeof ATTACHMENT_REF_TYPES)[number];

export interface AttachmentCreationAttributes {
  refType: AttachmentRefType | string;
  refId: number;
  fileUrl: string;
  fileName: string;
  fileSize?: number | null;
  mimeType?: string | null;
  uploadedByUserId?: number | null;
  note?: string | null;
  createdBy?: number | null;
  updatedBy?: number | null;
}

/**
 * ไฟล์แนบแบบ polymorphic — ผูกกับตารางไหนก็ได้ผ่าน (ref_type, ref_id)
 *
 * ไม่มี FK constraint บน ref_id โดยเจตนา เพราะปลายทางเป็นได้หลายตาราง
 * การลบข้อมูลต้นทางเป็น soft delete อยู่แล้ว (paranoid) ไฟล์จึงไม่กำพร้า
 *
 * BR-02 — ทุกบันทึกต้องแนบไฟล์หลักฐานได้ ตารางนี้คือกลไกนั้น
 * ไฟล์จริงอยู่บน Cloudflare R2 ที่นี่เก็บแค่ object key
 */
@Table({ tableName: 'attachments', underscored: true, timestamps: true, paranoid: true })
export class Attachment extends AuditedModel<Attachment, AttachmentCreationAttributes> {
  @Column({ type: DataType.STRING(50), allowNull: false, field: 'ref_type' })
  refType: string;

  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: false, field: 'ref_id' })
  refId: number;

  /** object key ใน R2 ไม่ใช่ URL สาธารณะ */
  @Column({ type: DataType.STRING(500), allowNull: false, field: 'file_url' })
  fileUrl: string;

  @Column({ type: DataType.STRING(255), allowNull: false, field: 'file_name' })
  fileName: string;

  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: true, field: 'file_size' })
  fileSize: number | null;

  @Column({ type: DataType.STRING(100), allowNull: true, field: 'mime_type' })
  mimeType: string | null;

  @ForeignKey(() => User)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: true, field: 'uploaded_by_user_id' })
  uploadedByUserId: number | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  note: string | null;

  @BelongsTo(() => User)
  uploadedBy: User;
}
