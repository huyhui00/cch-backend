import { BelongsTo, Column, DataType, ForeignKey, Table } from 'sequelize-typescript';

import { AuditedModel } from './base.model';
import { MaContract } from './ma-contract.model';
import { TicketResolution } from './ticket-resolution.model';
import { Ticket } from './ticket.model';

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
