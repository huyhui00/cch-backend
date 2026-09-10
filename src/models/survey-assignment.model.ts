import { BelongsTo, Column, DataType, ForeignKey, Table } from 'sequelize-typescript';

import { AuditedModel } from './base.model';
import { Contact } from './contact.model';
import { Customer } from './customer.model';
import { Project } from './project.model';
import { Survey } from './survey.model';
import { User } from './user.model';

export enum SurveyAssignmentStatus {
  PENDING = 'PENDING',
  SENT = 'SENT',
  ANSWERED = 'ANSWERED',
  EXPIRED = 'EXPIRED',
}

/**
 * การส่งแบบประเมินให้ลูกค้า 1 ครั้ง
 *
 * CLAUDE.md ข้อ 10 (Q1) ยังไม่สรุปว่าลูกค้ากรอกยังไงในเมื่อไม่มี login
 * ตารางนี้จึงเปิดทางไว้ทั้งสองแบบโดยไม่ผูกมัด:
 *   - ลิงก์ token สาธารณะ -> access_token + token_expires_at
 *   - พนักงานกรอกแทน      -> filled_by_user_id
 * เมื่อผู้บริหารสรุปแล้วค่อยตัดทางที่ไม่ใช้ทิ้ง ไม่ต้องรื้อ schema
 *
 * ไม่ว่าทางไหน ลูกค้าก็ยังไม่มีบัญชีผู้ใช้ (BR-01)
 */
export interface SurveyAssignmentCreationAttributes {
  surveyId: number;
  customerId: number;
  contactId?: number | null;
  projectId?: number | null;
  status?: SurveyAssignmentStatus;
  accessToken?: string | null;
  tokenExpiresAt?: Date | null;
  filledByUserId?: number | null;
  sentAt?: Date | null;
  answeredAt?: Date | null;
  createdBy?: number | null;
  updatedBy?: number | null;
}

@Table({ tableName: 'survey_assignments', underscored: true, timestamps: true, paranoid: true })
export class SurveyAssignment extends AuditedModel<
  SurveyAssignment,
  SurveyAssignmentCreationAttributes
> {
  @ForeignKey(() => Survey)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: false, field: 'survey_id' })
  surveyId: number;

  @ForeignKey(() => Customer)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: false, field: 'customer_id' })
  customerId: number;

  @ForeignKey(() => Contact)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: true, field: 'contact_id' })
  contactId: number | null;

  @ForeignKey(() => Project)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: true, field: 'project_id' })
  projectId: number | null;

  @Column({
    type: DataType.ENUM(...Object.values(SurveyAssignmentStatus)),
    allowNull: false,
    defaultValue: SurveyAssignmentStatus.PENDING,
  })
  status: SurveyAssignmentStatus;

  /** ทางเลือกที่ 1 ของ Q1 — ลิงก์สาธารณะที่เดาไม่ได้ */
  @Column({ type: DataType.STRING(100), allowNull: true, field: 'access_token' })
  accessToken: string | null;

  @Column({ type: DataType.DATE, allowNull: true, field: 'token_expires_at' })
  tokenExpiresAt: Date | null;

  /** ทางเลือกที่ 2 ของ Q1 — พนักงานกรอกแทนหลังโทรถาม */
  @ForeignKey(() => User)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: true, field: 'filled_by_user_id' })
  filledByUserId: number | null;

  @Column({ type: DataType.DATE, allowNull: true, field: 'sent_at' })
  sentAt: Date | null;

  @Column({ type: DataType.DATE, allowNull: true, field: 'answered_at' })
  answeredAt: Date | null;

  @BelongsTo(() => Survey)
  survey: Survey;

  @BelongsTo(() => Customer)
  customer: Customer;

  @BelongsTo(() => Contact)
  contact: Contact;

  @BelongsTo(() => Project)
  project: Project;

  @BelongsTo(() => User)
  filledBy: User;
}
