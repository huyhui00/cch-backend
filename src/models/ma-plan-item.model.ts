import { BelongsTo, Column, DataType, ForeignKey, Table } from 'sequelize-typescript';

import { AuditedModel } from './base.model';
import { MaPlan } from './ma-plan.model';

/** รายการบริการย่อยที่อยู่ในแผน MA — ส่วนของ "เนื้อหา" ตาม BR-05 */
@Table({ tableName: 'ma_plan_items', underscored: true, timestamps: true, paranoid: true })
export class MaPlanItem extends AuditedModel<MaPlanItem> {
  @ForeignKey(() => MaPlan)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: false, field: 'plan_id' })
  planId: number;

  @Column({ type: DataType.STRING(255), allowNull: false })
  title: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  detail: string | null;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0, field: 'sort_order' })
  sortOrder: number;

  @BelongsTo(() => MaPlan)
  plan: MaPlan;
}
