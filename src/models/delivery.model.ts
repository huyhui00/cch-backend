import { BelongsTo, Column, DataType, ForeignKey, HasMany, Table } from 'sequelize-typescript';

import { AuditedModel } from './base.model';
import { Contact } from './contact.model';
import { Project } from './project.model';
import { User } from './user.model';
import { Warranty } from './warranty.model';

export enum AcceptanceStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
}

/** ฟิลด์ที่ส่งได้ตอน create — ดูหมายเหตุใน UserCreationAttributes */
export interface DeliveryCreationAttributes {
  projectId: number;
  deliveryNo?: string | null;
  title: string;
  version?: string | null;
  description?: string | null;
  deliveredAt: Date;
  acceptanceStatus?: AcceptanceStatus;
  acceptedAt?: Date | null;
  acceptedByContactId?: number | null;
  isFinal?: boolean;
  deliveredByUserId?: number | null;
  note?: string | null;
  createdBy?: number | null;
  updatedBy?: number | null;
}

@Table({ tableName: 'deliveries', underscored: true, timestamps: true, paranoid: true })
export class Delivery extends AuditedModel<Delivery, DeliveryCreationAttributes> {
  @ForeignKey(() => Project)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: false, field: 'project_id' })
  projectId: number;

  @Column({ type: DataType.STRING(50), allowNull: true, field: 'delivery_no' })
  deliveryNo: string | null;

  @Column({ type: DataType.STRING(255), allowNull: false })
  title: string;

  /**
   * เวอร์ชันที่ส่งมอบ เก็บเป็นข้อความเพราะบริษัทใช้รูปแบบอย่าง "v1.2.0" หรือ "รอบที่ 2"
   * การเรียงประวัติการส่งมอบจึงต้องเรียงด้วย deliveredAt เป็นหลัก ไม่ใช่เรียงด้วยค่านี้
   */
  @Column({ type: DataType.STRING(50), allowNull: true })
  version: string | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  description: string | null;

  /** BR-06 — จุดตั้งต้นของระยะประกัน warranties.start_date อ้างค่านี้ */
  @Column({ type: DataType.DATE, allowNull: false, field: 'delivered_at' })
  deliveredAt: Date;

  @Column({
    type: DataType.ENUM(...Object.values(AcceptanceStatus)),
    allowNull: false,
    defaultValue: AcceptanceStatus.PENDING,
  })
  acceptanceStatus: AcceptanceStatus;

  @Column({ type: DataType.DATE, allowNull: true, field: 'accepted_at' })
  acceptedAt: Date | null;

  /** ผู้ติดต่อฝั่งลูกค้าที่เซ็นรับมอบ — เซ็นมือแล้วสแกนเข้าระบบ (BR-12) */
  @ForeignKey(() => Contact)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: true, field: 'accepted_by_contact_id' })
  acceptedByContactId: number | null;

  /**
   * การส่งมอบครั้งสุดท้ายของโครงการหรือไม่ — คนยืนยันตอนตรวจรับ (ตกลง 11 ก.ย.)
   * ประกันออกได้จากใบที่เป็นครั้งสุดท้ายและลูกค้ายอมรับแล้วเท่านั้น
   * การส่งมอบระหว่างทาง (เฟส / เวอร์ชันทดลอง) เป็น false
   */
  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false, field: 'is_final' })
  isFinal: boolean;

  /** พนักงานผู้ส่งมอบ — คู่กับ acceptedByContactId ที่เป็นผู้รับมอบฝั่งลูกค้า */
  @ForeignKey(() => User)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: true, field: 'delivered_by_user_id' })
  deliveredByUserId: number | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  note: string | null;

  @BelongsTo(() => Project)
  project: Project;

  @BelongsTo(() => Contact)
  acceptedByContact: Contact;

  @BelongsTo(() => User)
  deliveredByUser: User;

  @HasMany(() => Warranty)
  warranties: Warranty[];
}
