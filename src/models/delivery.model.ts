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

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false, field: 'is_final' })
  isFinal: boolean;

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
