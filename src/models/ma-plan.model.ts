import { Column, DataType, HasMany, Table } from 'sequelize-typescript';

import { AuditedModel } from './base.model';
import { MaPlanItem } from './ma-plan-item.model';

/**
 * BR-05 — เนื้อหาแผน MA เหมือนกันทุกโครงการ แต่ราคาต่างกัน
 *
 * ตารางนี้เก็บ "เนื้อหา" ของแผนเท่านั้น ใช้ซ้ำได้ทุกโครงการ
 * ห้ามมีคอลัมน์ราคาที่นี่เด็ดขาด — ราคาอยู่ที่ ma_contracts.price
 * เพราะถ้าเก็บราคาที่นี่ จะต้องก๊อปแผนใหม่ทุกครั้งที่ต่อรองราคาได้ไม่เท่ากัน
 */
export interface MaPlanCreationAttributes {
  code?: string | null;
  name: string;
  description?: string | null;
  bugQuotaPerMonth?: number;
  responseTimeHour?: number | null;
  onsiteQuotaPerMonth?: number | null;
  isActive?: boolean;
  sortOrder?: number;
  createdBy?: number | null;
  updatedBy?: number | null;
}

@Table({ tableName: 'ma_plans', underscored: true, timestamps: true, paranoid: true })
export class MaPlan extends AuditedModel<MaPlan, MaPlanCreationAttributes> {
  /**
   * ไม่บังคับ (ตกลง 10 ก.ย. 2026) — หน้าจอซ่อนช่องนี้ ใช้ชื่อแผนแทน
   * ถ้าใส่มายังห้ามซ้ำ ส่วน NULL ซ้ำกันได้หลายแถว
   */
  @Column({ type: DataType.STRING(50), allowNull: true })
  code: string | null;

  @Column({ type: DataType.STRING(150), allowNull: false })
  name: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  description: string | null;

  @Column({
    type: DataType.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'bug_quota_per_month',
  })
  bugQuotaPerMonth: number;

  @Column({ type: DataType.INTEGER, allowNull: true, field: 'response_time_hour' })
  responseTimeHour: number | null;

  @Column({ type: DataType.INTEGER, allowNull: true, field: 'onsite_quota_per_month' })
  onsiteQuotaPerMonth: number | null;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true, field: 'is_active' })
  isActive: boolean;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0, field: 'sort_order' })
  sortOrder: number;

  @HasMany(() => MaPlanItem)
  items: MaPlanItem[];
}
