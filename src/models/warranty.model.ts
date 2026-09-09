import { BelongsTo, Column, DataType, ForeignKey, Table } from 'sequelize-typescript';

import { AuditedModel } from './base.model';
import { Delivery } from './delivery.model';
import { Project } from './project.model';

export enum WarrantyStatus {
  ACTIVE = 'ACTIVE',
  EXPIRED = 'EXPIRED',
  VOID = 'VOID',
}

/**
 * BR-06 — ระยะประกันนับจาก "วันส่งมอบ" ไม่ใช่วันเซ็นสัญญาหรือวันปิดโครงการ
 * จึงต้องผูกกับ delivery_id เป็นหลัก (project_id เก็บไว้เพื่อ query สะดวก)
 *
 *   start_date = deliveries.delivered_at
 *   end_date   = start_date + duration_month
 *
 * BR-07 — ประกันครอบคลุมเฉพาะ bug ในขอบเขตเดิม ขอบเขตนั้นบันทึกที่ scope_note
 */
/**
 * ฟิลด์ที่ส่งได้ตอน create — ดูหมายเหตุใน UserCreationAttributes
 *
 * startDate / endDate / projectId ไม่ได้รับมาจากผู้ใช้ แต่ service คำนวณจาก delivery
 * ให้ก่อนแล้วค่อยส่งมาที่นี่ (BR-06)
 */
export interface WarrantyCreationAttributes {
  deliveryId: number;
  projectId: number;
  durationMonth: number;
  startDate: string;
  endDate: string;
  status?: WarrantyStatus;
  scopeNote?: string | null;
  createdBy?: number | null;
  updatedBy?: number | null;
}

@Table({ tableName: 'warranties', underscored: true, timestamps: true, paranoid: true })
export class Warranty extends AuditedModel<Warranty, WarrantyCreationAttributes> {
  @ForeignKey(() => Delivery)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: false, field: 'delivery_id' })
  deliveryId: number;

  @ForeignKey(() => Project)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: false, field: 'project_id' })
  projectId: number;

  @Column({ type: DataType.INTEGER, allowNull: false, field: 'duration_month' })
  durationMonth: number;

  @Column({ type: DataType.DATEONLY, allowNull: false, field: 'start_date' })
  startDate: string;

  @Column({ type: DataType.DATEONLY, allowNull: false, field: 'end_date' })
  endDate: string;

  @Column({
    type: DataType.ENUM(...Object.values(WarrantyStatus)),
    allowNull: false,
    defaultValue: WarrantyStatus.ACTIVE,
  })
  status: WarrantyStatus;

  /** ขอบเขตที่ประกันครอบคลุม ใช้ตัดสินตอนเปิด ticket ว่าคิดเงินหรือไม่ (BR-07) */
  @Column({ type: DataType.TEXT, allowNull: true, field: 'scope_note' })
  scopeNote: string | null;

  @BelongsTo(() => Delivery)
  delivery: Delivery;

  @BelongsTo(() => Project)
  project: Project;
}
