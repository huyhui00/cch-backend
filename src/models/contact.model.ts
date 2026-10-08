import { BelongsTo, Column, DataType, ForeignKey, Table } from 'sequelize-typescript';

import { AuditedModel } from './base.model';
import { Customer } from './customer.model';

export interface ContactCreationAttributes {
  customerId: number;
  name: string;
  nickname?: string | null;
  position?: string | null;
  phone?: string | null;
  email?: string | null;
  lineId?: string | null;
  isPrimary?: boolean;
  note?: string | null;
  createdBy?: number | null;
  updatedBy?: number | null;
}

/** ผู้ติดต่อฝั่งลูกค้า — เป็นแค่ข้อมูลติดต่อ ไม่ใช่บัญชีผู้ใช้ (BR-01) */
@Table({ tableName: 'contacts', underscored: true, timestamps: true, paranoid: true })
export class Contact extends AuditedModel<Contact, ContactCreationAttributes> {
  @ForeignKey(() => Customer)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: false, field: 'customer_id' })
  customerId: number;

  @Column({ type: DataType.STRING(255), allowNull: false })
  name: string;

  @Column({ type: DataType.STRING(100), allowNull: true })
  nickname: string | null;

  @Column({ type: DataType.STRING(150), allowNull: true })
  position: string | null;

  @Column({ type: DataType.STRING(30), allowNull: true })
  phone: string | null;

  @Column({ type: DataType.STRING(255), allowNull: true })
  email: string | null;

  @Column({ type: DataType.STRING(100), allowNull: true, field: 'line_id' })
  lineId: string | null;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false, field: 'is_primary' })
  isPrimary: boolean;

  @Column({ type: DataType.TEXT, allowNull: true })
  note: string | null;

  @BelongsTo(() => Customer)
  customer: Customer;
}
