import { BelongsTo, Column, DataType, ForeignKey, Table } from 'sequelize-typescript';

import { AuditedModel } from './base.model';
import { MaContract } from './ma-contract.model';

export enum MaAddonType {
  EXTRA_QUOTA = 'EXTRA_QUOTA',
  OTHER = 'OTHER',
}

/**
 * ของเสริมที่ซื้อเพิ่มระหว่างอายุสัญญา
 * โควตาจากที่นี่ถูกนำไปบวกกับ ma_plans.bug_quota_per_month ตอนคำนวณ (CLAUDE.md 9.2)
 *
 * effective_year / effective_month = addon มีผลกับรอบเดือนไหน
 * ถ้าเว้นว่าง = มีผลตลอดอายุสัญญา
 */
export interface MaAddonCreationAttributes {
  contractId: number;
  addonType?: MaAddonType;
  title: string;
  extraQuota?: number;
  price?: string;
  effectiveYear?: number | null;
  effectiveMonth?: number | null;
  note?: string | null;
  createdBy?: number | null;
  updatedBy?: number | null;
}

@Table({ tableName: 'ma_addons', underscored: true, timestamps: true, paranoid: true })
export class MaAddon extends AuditedModel<MaAddon, MaAddonCreationAttributes> {
  @ForeignKey(() => MaContract)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: false, field: 'contract_id' })
  contractId: number;

  @Column({
    type: DataType.ENUM(...Object.values(MaAddonType)),
    allowNull: false,
    defaultValue: MaAddonType.EXTRA_QUOTA,
    field: 'addon_type',
  })
  addonType: MaAddonType;

  @Column({ type: DataType.STRING(255), allowNull: false })
  title: string;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0, field: 'extra_quota' })
  extraQuota: number;

  @Column({ type: DataType.DECIMAL(15, 2), allowNull: false, defaultValue: 0 })
  price: string;

  @Column({ type: DataType.SMALLINT, allowNull: true, field: 'effective_year' })
  effectiveYear: number | null;

  @Column({ type: DataType.TINYINT, allowNull: true, field: 'effective_month' })
  effectiveMonth: number | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  note: string | null;

  @BelongsTo(() => MaContract)
  contract: MaContract;
}
