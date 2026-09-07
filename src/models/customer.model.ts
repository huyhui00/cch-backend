import { BelongsTo, Column, DataType, ForeignKey, HasMany, Table } from 'sequelize-typescript';

import { AuditedModel } from './base.model';
import { Contact } from './contact.model';
import { User } from './user.model';

export enum CustomerStatus {
  PROSPECT = 'PROSPECT',
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  CHURNED = 'CHURNED',
}

/**
 * ลูกค้าไม่มีบัญชีผู้ใช้และไม่เข้าระบบ (BR-01)
 * ตารางนี้จึงไม่มี password / login ใด ๆ ทั้งสิ้น
 */
@Table({ tableName: 'customers', underscored: true, timestamps: true, paranoid: true })
export class Customer extends AuditedModel<Customer> {
  @Column({ type: DataType.STRING(50), allowNull: true })
  code: string | null;

  @Column({ type: DataType.STRING(255), allowNull: false })
  name: string;

  @Column({ type: DataType.STRING(20), allowNull: true, field: 'tax_id' })
  taxId: string | null;

  @Column({ type: DataType.STRING(150), allowNull: true, field: 'business_type' })
  businessType: string | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  address: string | null;

  @Column({ type: DataType.STRING(100), allowNull: true })
  province: string | null;

  @Column({ type: DataType.STRING(10), allowNull: true, field: 'postal_code' })
  postalCode: string | null;

  @Column({ type: DataType.STRING(30), allowNull: true })
  phone: string | null;

  @Column({ type: DataType.STRING(255), allowNull: true })
  email: string | null;

  @Column({ type: DataType.STRING(255), allowNull: true })
  website: string | null;

  @Column({ type: DataType.STRING(100), allowNull: true, field: 'line_official_id' })
  lineOfficialId: string | null;

  @Column({ type: DataType.STRING(255), allowNull: true, field: 'facebook_url' })
  facebookUrl: string | null;

  @Column({
    type: DataType.ENUM(...Object.values(CustomerStatus)),
    allowNull: false,
    defaultValue: CustomerStatus.PROSPECT,
  })
  status: CustomerStatus;

  @Column({ type: DataType.STRING(100), allowNull: true })
  source: string | null;

  /** พนักงานที่ดูแลลูกค้ารายนี้ */
  @ForeignKey(() => User)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: true, field: 'owner_user_id' })
  ownerUserId: number | null;

  /** ใช้กับ notification rule แบบ CUSTOMER_IDLE */
  @Column({ type: DataType.DATE, allowNull: true, field: 'last_contacted_at' })
  lastContactedAt: Date | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  note: string | null;

  @BelongsTo(() => User)
  owner: User;

  @HasMany(() => Contact)
  contacts: Contact[];
}
