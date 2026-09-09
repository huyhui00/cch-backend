import { BelongsTo, Column, DataType, ForeignKey, Table } from 'sequelize-typescript';

import { AuditedModel } from './base.model';
import { Ticket } from './ticket.model';
import { User } from './user.model';

export enum ResolutionResult {
  SUCCESS = 'SUCCESS',
  PARTIAL = 'PARTIAL',
  FAILED = 'FAILED',
}

/**
 * BR-03 — 1 ปัญหา แก้ไขได้หลายรอบ ตารางนี้คือ "แต่ละรอบที่ลงมือแก้"
 *
 * round = จำนวน resolution เดิมของ ticket นั้น + 1 (CLAUDE.md 9.1)
 * ทั้งหมดทำใน transaction เดียวกับการ update tickets.status และ resolution_count
 *
 * (ticket_id, round) เป็น UNIQUE ไม่ใช่แค่ index ธรรมดา
 * เพื่อกันการกดบันทึกซ้อนกันสองครั้งพร้อมกันแล้วได้ round ชนกัน
 */
/** ฟิลด์ที่ส่งได้ตอน create — `round` service คำนวณให้ ไม่ได้รับมาจากผู้ใช้ */
export interface TicketResolutionCreationAttributes {
  ticketId: number;
  round: number;
  result: ResolutionResult;
  detail: string;
  rootCause?: string | null;
  resolvedByUserId?: number | null;
  startedAt?: Date | null;
  resolvedAt: Date;
  hoursSpent?: string | null;
  createdBy?: number | null;
  updatedBy?: number | null;
}

@Table({ tableName: 'ticket_resolutions', underscored: true, timestamps: true, paranoid: true })
export class TicketResolution extends AuditedModel<
  TicketResolution,
  TicketResolutionCreationAttributes
> {
  @ForeignKey(() => Ticket)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: false, field: 'ticket_id' })
  ticketId: number;

  /** รอบที่เท่าไหร่ เริ่มที่ 1 */
  @Column({ type: DataType.INTEGER, allowNull: false })
  round: number;

  @Column({ type: DataType.ENUM(...Object.values(ResolutionResult)), allowNull: false })
  result: ResolutionResult;

  @Column({ type: DataType.TEXT, allowNull: false })
  detail: string;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'root_cause' })
  rootCause: string | null;

  @ForeignKey(() => User)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: true, field: 'resolved_by_user_id' })
  resolvedByUserId: number | null;

  @Column({ type: DataType.DATE, allowNull: true, field: 'started_at' })
  startedAt: Date | null;

  @Column({ type: DataType.DATE, allowNull: false, field: 'resolved_at' })
  resolvedAt: Date;

  @Column({ type: DataType.DECIMAL(6, 2), allowNull: true, field: 'hours_spent' })
  hoursSpent: string | null;

  @BelongsTo(() => Ticket)
  ticket: Ticket;

  @BelongsTo(() => User)
  resolvedBy: User;
}
