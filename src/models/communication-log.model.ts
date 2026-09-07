import { BelongsTo, Column, DataType, ForeignKey, Table } from 'sequelize-typescript';

import { AuditedModel } from './base.model';
import { Contact } from './contact.model';
import { Customer } from './customer.model';
import { User } from './user.model';

export enum CommunicationChannel {
  LINE = 'LINE',
  PHONE = 'PHONE',
  EMAIL = 'EMAIL',
  FACEBOOK = 'FACEBOOK',
  MEETING = 'MEETING',
  OTHER = 'OTHER',
}

/**
 * BR-02 — การสื่อสารเกิดนอกระบบ (LINE/โทร) แล้วมาบันทึกย้อนหลัง
 * ทุกบันทึกจึงต้องระบุ channel ได้เสมอ และแนบไฟล์หลักฐานผ่านตาราง attachments
 * (ref_type = 'COMMUNICATION_LOG')
 */
@Table({ tableName: 'communication_logs', underscored: true, timestamps: true, paranoid: true })
export class CommunicationLog extends AuditedModel<CommunicationLog> {
  @ForeignKey(() => Customer)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: false, field: 'customer_id' })
  customerId: number;

  @ForeignKey(() => Contact)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: true, field: 'contact_id' })
  contactId: number | null;

  @Column({
    type: DataType.ENUM(...Object.values(CommunicationChannel)),
    allowNull: false,
  })
  channel: CommunicationChannel;

  /** เวลาที่คุยกันจริง ไม่ใช่เวลาที่มาบันทึก (created_at คือเวลาที่บันทึก) */
  @Column({ type: DataType.DATE, allowNull: false, field: 'occurred_at' })
  occurredAt: Date;

  @Column({ type: DataType.STRING(255), allowNull: true })
  subject: string | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  content: string | null;

  /** พนักงานที่เป็นคนคุย ซึ่งอาจไม่ใช่คนเดียวกับ created_by ที่มาบันทึกให้ */
  @ForeignKey(() => User)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: true, field: 'handled_by_user_id' })
  handledByUserId: number | null;

  @BelongsTo(() => Customer)
  customer: Customer;

  @BelongsTo(() => Contact)
  contact: Contact;

  @BelongsTo(() => User)
  handledBy: User;
}
