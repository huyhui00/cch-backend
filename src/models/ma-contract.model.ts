import { BelongsTo, Column, DataType, ForeignKey, HasMany, Table } from 'sequelize-typescript';

import { AuditedModel } from './base.model';
import { Customer } from './customer.model';
import { MaAddon } from './ma-addon.model';
import { MaPlan } from './ma-plan.model';
import { Project } from './project.model';

export enum MaBillingCycle {
  MONTHLY = 'MONTHLY',
  YEARLY = 'YEARLY',
}

export enum MaContractStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
  RENEWED = 'RENEWED',
}

/**
 * BR-05 — สัญญาจริงรายลูกค้า/รายโครงการ ที่นี่คือที่อยู่ของ "ราคา"
 * เนื้อหาแผนอ้างจาก ma_plans ผ่าน plan_id ไม่ก๊อปมาเก็บซ้ำ
 *
 * previous_contract_id เป็น self-reference สำหรับสายการต่อสัญญา
 * ฉบับเก่าเปลี่ยน status เป็น RENEWED แล้วฉบับใหม่ชี้กลับไปหาฉบับเก่า
 *
 * หมายเหตุ: CLAUDE.md ข้อ 10 (Q4) ยังไม่สรุปว่า 1 โครงการมี MA active
 * พร้อมกันหลายฉบับได้ไหม — ระดับฐานข้อมูลจึงยังไม่ใส่ unique constraint
 * ถ้าสรุปว่าได้ฉบับเดียว ให้เพิ่ม partial unique ที่ (project_id) where status='ACTIVE'
 * ผ่าน migration ใหม่ ไม่ต้องแก้ตารางนี้
 */
@Table({ tableName: 'ma_contracts', underscored: true, timestamps: true, paranoid: true })
export class MaContract extends AuditedModel<MaContract> {
  @ForeignKey(() => Customer)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: false, field: 'customer_id' })
  customerId: number;

  @ForeignKey(() => Project)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: false, field: 'project_id' })
  projectId: number;

  @ForeignKey(() => MaPlan)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: false, field: 'plan_id' })
  planId: number;

  @ForeignKey(() => MaContract)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: true, field: 'previous_contract_id' })
  previousContractId: number | null;

  @Column({ type: DataType.STRING(100), allowNull: true, field: 'contract_no' })
  contractNo: string | null;

  /** ราคาอยู่ที่นี่ ไม่ใช่ที่ ma_plans (BR-05) */
  @Column({ type: DataType.DECIMAL(15, 2), allowNull: false })
  price: string;

  @Column({
    type: DataType.ENUM(...Object.values(MaBillingCycle)),
    allowNull: false,
    defaultValue: MaBillingCycle.YEARLY,
    field: 'billing_cycle',
  })
  billingCycle: MaBillingCycle;

  @Column({ type: DataType.DATEONLY, allowNull: false, field: 'start_date' })
  startDate: string;

  @Column({ type: DataType.DATEONLY, allowNull: false, field: 'end_date' })
  endDate: string;

  @Column({
    type: DataType.ENUM(...Object.values(MaContractStatus)),
    allowNull: false,
    defaultValue: MaContractStatus.DRAFT,
  })
  status: MaContractStatus;

  @Column({ type: DataType.DATEONLY, allowNull: true, field: 'signed_date' })
  signedDate: string | null;

  /** ไฟล์สัญญาที่เซ็นมือแล้วสแกนขึ้น R2 (BR-12) */
  @Column({ type: DataType.STRING(500), allowNull: true, field: 'signed_file_url' })
  signedFileUrl: string | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  note: string | null;

  @BelongsTo(() => Customer)
  customer: Customer;

  @BelongsTo(() => Project)
  project: Project;

  @BelongsTo(() => MaPlan)
  plan: MaPlan;

  @BelongsTo(() => MaContract)
  previousContract: MaContract;

  @HasMany(() => MaAddon)
  addons: MaAddon[];
}
