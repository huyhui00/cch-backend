import { Column, DataType, HasMany, Table } from 'sequelize-typescript';

import { AuditedModel } from './base.model';
import { SurveyQuestion } from './survey-question.model';

/**
 * วงจรชีวิตของแบบประเมิน
 *
 * DRAFT  -> ACTIVE  เริ่มใช้จริง ส่งให้ลูกค้าได้ **แก้คำถามไม่ได้แล้ว**
 * ACTIVE -> CLOSED  ปิดรับคำตอบ ยังดูผลย้อนหลังได้
 *
 * ที่ห้ามแก้คำถามหลัง ACTIVE เพราะ `survey_answers.question_id` ชี้ไปที่คำถาม
 * ถ้าเปลี่ยนข้อความคำถามทีหลัง คำตอบเก่าจะกลายเป็นคำตอบของคำถามที่ไม่เคยถูกถาม
 */
export enum SurveyStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  CLOSED = 'CLOSED',
}

export interface SurveyCreationAttributes {
  title: string;
  description?: string | null;
  status?: SurveyStatus;
  validFrom?: string | null;
  validTo?: string | null;
  createdBy?: number | null;
  updatedBy?: number | null;
}

@Table({ tableName: 'surveys', underscored: true, timestamps: true, paranoid: true })
export class Survey extends AuditedModel<Survey, SurveyCreationAttributes> {
  @Column({ type: DataType.STRING(255), allowNull: false })
  title: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  description: string | null;

  @Column({
    type: DataType.ENUM(...Object.values(SurveyStatus)),
    allowNull: false,
    defaultValue: SurveyStatus.DRAFT,
  })
  status: SurveyStatus;

  @Column({ type: DataType.DATEONLY, allowNull: true, field: 'valid_from' })
  validFrom: string | null;

  @Column({ type: DataType.DATEONLY, allowNull: true, field: 'valid_to' })
  validTo: string | null;

  @HasMany(() => SurveyQuestion)
  questions: SurveyQuestion[];
}
