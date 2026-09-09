import { BelongsTo, Column, DataType, ForeignKey, HasMany, Table } from 'sequelize-typescript';

import { AuditedModel } from './base.model';
import { Contact } from './contact.model';
import { Customer } from './customer.model';
import { MaContract } from './ma-contract.model';
import { Project } from './project.model';
import { TicketResolution } from './ticket-resolution.model';
import { User } from './user.model';
import { Warranty } from './warranty.model';

/**
 * BR-04 — สถานะต้องวนกลับได้ RESOLVED -> REOPENED -> IN_PROGRESS
 * ปัญหาเดิมกลับมา = เพิ่มรอบในใบเดิม ห้ามเปิดใบใหม่
 */
export enum TicketStatus {
  RECEIVED = 'RECEIVED',
  IN_PROGRESS = 'IN_PROGRESS',
  RESOLVED = 'RESOLVED',
  REOPENED = 'REOPENED',
  CLOSED = 'CLOSED',
}

/**
 * BR-07 — ประกันครอบคลุมเฉพาะ bug ในขอบเขตเดิม เพิ่มฟีเจอร์ = คิดเงินใหม่
 * BR-08 — บั๊กเล็กทำฟรีได้ แต่ต้องบันทึก จึงต้องมีค่า FREE ห้ามปล่อยว่าง
 */
export enum TicketBillingType {
  WARRANTY = 'WARRANTY',
  MA_QUOTA = 'MA_QUOTA',
  ADDON = 'ADDON',
  ONE_TIME = 'ONE_TIME',
  FREE = 'FREE',
}

/** BR-02 — ลูกค้าแจ้งมาทางไหน ต้องบันทึกได้เสมอ */
export enum TicketReportedChannel {
  LINE = 'LINE',
  PHONE = 'PHONE',
  EMAIL = 'EMAIL',
  FACEBOOK = 'FACEBOOK',
  OTHER = 'OTHER',
}

export enum TicketPriority {
  LOW = 'LOW',
  NORMAL = 'NORMAL',
  HIGH = 'HIGH',
  URGENT = 'URGENT',
}

/**
 * BR-03 — 1 ปัญหา แก้ไขได้หลายรอบ
 * ตารางนี้เก็บ "ตัวปัญหา" ส่วนแต่ละรอบที่ลงมือแก้อยู่ที่ ticket_resolutions
 * ห้ามยุบสองตารางนี้เข้าด้วยกัน เพราะรอบที่ 2 จะทับประวัติของรอบที่ 1
 *
 * หน้าจอ "รอรับการแก้ไข" = WHERE status IN ('RECEIVED','REOPENED','IN_PROGRESS')
 */
/** ฟิลด์ที่ส่งได้ตอน create — ดูหมายเหตุใน UserCreationAttributes */
export interface TicketCreationAttributes {
  ticketNo?: string | null;
  customerId: number;
  projectId?: number | null;
  warrantyId?: number | null;
  maContractId?: number | null;
  title: string;
  description?: string | null;
  status?: TicketStatus;
  priority?: TicketPriority;
  billingType: TicketBillingType;
  reportedChannel: TicketReportedChannel;
  reportedAt: Date;
  reportedByContactId?: number | null;
  assignedUserId?: number | null;
  receivedByUserId?: number | null;
  resolutionCount?: number;
  firstResponseAt?: Date | null;
  resolvedAt?: Date | null;
  closedAt?: Date | null;
  dueAt?: Date | null;
  extraCharge?: string | null;
  createdBy?: number | null;
  updatedBy?: number | null;
}

@Table({ tableName: 'tickets', underscored: true, timestamps: true, paranoid: true })
export class Ticket extends AuditedModel<Ticket, TicketCreationAttributes> {
  @Column({ type: DataType.STRING(50), allowNull: true, field: 'ticket_no' })
  ticketNo: string | null;

  @ForeignKey(() => Customer)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: false, field: 'customer_id' })
  customerId: number;

  @ForeignKey(() => Project)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: true, field: 'project_id' })
  projectId: number | null;

  /** ประกันที่ครอบคลุมใบนี้ ใช้ suggest billing_type ตอนเปิด ticket (CLAUDE.md 9.3) */
  @ForeignKey(() => Warranty)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: true, field: 'warranty_id' })
  warrantyId: number | null;

  /** สัญญา MA ที่ใบนี้ไปหักโควตา */
  @ForeignKey(() => MaContract)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: true, field: 'ma_contract_id' })
  maContractId: number | null;

  @Column({ type: DataType.STRING(255), allowNull: false })
  title: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  description: string | null;

  @Column({
    type: DataType.ENUM(...Object.values(TicketStatus)),
    allowNull: false,
    defaultValue: TicketStatus.RECEIVED,
  })
  status: TicketStatus;

  @Column({
    type: DataType.ENUM(...Object.values(TicketPriority)),
    allowNull: false,
    defaultValue: TicketPriority.NORMAL,
  })
  priority: TicketPriority;

  @Column({
    type: DataType.ENUM(...Object.values(TicketBillingType)),
    allowNull: false,
    field: 'billing_type',
  })
  billingType: TicketBillingType;

  @Column({
    type: DataType.ENUM(...Object.values(TicketReportedChannel)),
    allowNull: false,
    field: 'reported_channel',
  })
  reportedChannel: TicketReportedChannel;

  /** เวลาที่ลูกค้าแจ้งจริง ไม่ใช่เวลาที่พนักงานมาบันทึก (BR-02) */
  @Column({ type: DataType.DATE, allowNull: false, field: 'reported_at' })
  reportedAt: Date;

  @ForeignKey(() => Contact)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: true, field: 'reported_by_contact_id' })
  reportedByContactId: number | null;

  @ForeignKey(() => User)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: true, field: 'assigned_user_id' })
  assignedUserId: number | null;

  /**
   * พนักงานที่ "รับเรื่อง" ไว้ แยกจาก assignedUserId ที่เป็นคน "แก้ไข"
   * (ประชุมครั้งที่ 2 นาที 09:33) ตาม BR-02 คนที่รับ LINE จากลูกค้ากับคนที่ลงมือแก้
   * มักเป็นคนละคน และต้องตามรอยได้ทั้งคู่ (BR-09)
   */
  @ForeignKey(() => User)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: true, field: 'received_by_user_id' })
  receivedByUserId: number | null;

  /** จำนวนรอบที่แก้ไปแล้ว เพิ่มขึ้นทุกครั้งที่สร้าง resolution (CLAUDE.md 9.1) */
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'resolution_count',
  })
  resolutionCount: number;

  @Column({ type: DataType.DATE, allowNull: true, field: 'first_response_at' })
  firstResponseAt: Date | null;

  @Column({ type: DataType.DATE, allowNull: true, field: 'resolved_at' })
  resolvedAt: Date | null;

  @Column({ type: DataType.DATE, allowNull: true, field: 'closed_at' })
  closedAt: Date | null;

  /** ใช้กับ notification rule แบบ TICKET_SLA */
  @Column({ type: DataType.DATE, allowNull: true, field: 'due_at' })
  dueAt: Date | null;

  /** ค่าใช้จ่ายเพิ่มกรณีอยู่นอกขอบเขตประกัน (BR-07) */
  @Column({ type: DataType.DECIMAL(15, 2), allowNull: true, field: 'extra_charge' })
  extraCharge: string | null;

  @BelongsTo(() => Customer)
  customer: Customer;

  @BelongsTo(() => Project)
  project: Project;

  @BelongsTo(() => Warranty)
  warranty: Warranty;

  @BelongsTo(() => MaContract)
  maContract: MaContract;

  @BelongsTo(() => Contact)
  reportedByContact: Contact;

  // มี FK ไป users สองตัวในตารางเดียวกัน จึงต้องระบุชื่อ FK ให้ชัดทั้งคู่
  // ถ้าปล่อยให้ Sequelize เดาเอง มันจะผูกทั้งสอง association เข้ากับคอลัมน์เดียวกัน
  @BelongsTo(() => User, 'assignedUserId')
  assignedUser: User;

  @BelongsTo(() => User, 'receivedByUserId')
  receivedByUser: User;

  @HasMany(() => TicketResolution)
  resolutions: TicketResolution[];
}
