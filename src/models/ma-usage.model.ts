import { BelongsTo, Column, DataType, ForeignKey, Table } from 'sequelize-typescript';

import { AuditedModel } from './base.model';
import { MaContract } from './ma-contract.model';
import { TicketResolution } from './ticket-resolution.model';
import { Ticket } from './ticket.model';

/**
 * การใช้โควตา MA 1 แถว = 1 ครั้งที่หักโควตา
 * สร้างตอนบันทึกผลการแก้ที่ billing_type = 'MA_QUOTA' (CLAUDE.md 9.1)
 *
 * การนับโควตาของเดือน (CLAUDE.md 9.2):
 *   COUNT(*) WHERE contract_id=? AND period_year=? AND period_month=?
 *   เทียบกับ ma_plans.bug_quota_per_month + โควตาจาก ma_addons
 *
 * ข้อควรระวัง: ticket_id เป็น UNIQUE ตามที่กำหนด แปลว่า
 * "1 ปัญหา หักโควตาได้ครั้งเดียว ไม่ว่าจะแก้กี่รอบ"
 * ดังนั้นตอน REOPENED แล้วแก้รอบที่ 2 service ต้องไม่สร้างแถวซ้ำ
 * (ดูหมายเหตุที่ส่งให้ผู้บริหารตรวจ — จุดนี้ขัดกับการอ่าน CLAUDE.md 9.1 แบบตรงตัว)
 */
/** ฟิลด์ที่ส่งได้ตอน create — ดูหมายเหตุใน UserCreationAttributes */
export interface MaUsageCreationAttributes {
  contractId: number;
  ticketId: number;
  resolutionId?: number | null;
  periodYear: number;
  periodMonth: number;
  usedAt: Date;
  isOverQuota?: boolean;
  extraCharge?: string;
  note?: string | null;
  createdBy?: number | null;
  updatedBy?: number | null;
}

@Table({ tableName: 'ma_usages', underscored: true, timestamps: true, paranoid: true })
export class MaUsage extends AuditedModel<MaUsage, MaUsageCreationAttributes> {
  @ForeignKey(() => MaContract)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: false, field: 'contract_id' })
  contractId: number;

  @ForeignKey(() => Ticket)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: false, field: 'ticket_id' })
  ticketId: number;

  /** รอบการแก้ที่เป็นตัวหักโควตา */
  @ForeignKey(() => TicketResolution)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: true, field: 'resolution_id' })
  resolutionId: number | null;

  @Column({ type: DataType.SMALLINT, allowNull: false, field: 'period_year' })
  periodYear: number;

  @Column({ type: DataType.TINYINT, allowNull: false, field: 'period_month' })
  periodMonth: number;

  @Column({ type: DataType.DATE, allowNull: false, field: 'used_at' })
  usedAt: Date;

  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    field: 'is_over_quota',
  })
  isOverQuota: boolean;

  @Column({
    type: DataType.DECIMAL(15, 2),
    allowNull: false,
    defaultValue: 0,
    field: 'extra_charge',
  })
  extraCharge: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  note: string | null;

  @BelongsTo(() => MaContract)
  contract: MaContract;

  @BelongsTo(() => Ticket)
  ticket: Ticket;

  @BelongsTo(() => TicketResolution)
  resolution: TicketResolution;
}
