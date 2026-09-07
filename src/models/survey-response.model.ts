import { BelongsTo, Column, DataType, ForeignKey, HasMany, Table } from 'sequelize-typescript';

import { AuditedModel } from './base.model';
import { Customer } from './customer.model';
import { SurveyAnswer } from './survey-answer.model';
import { SurveyAssignment } from './survey-assignment.model';
import { Survey } from './survey.model';

/** 1 assignment ตอบได้ครั้งเดียว — assignment_id เป็น UNIQUE */
@Table({ tableName: 'survey_responses', underscored: true, timestamps: true, paranoid: true })
export class SurveyResponse extends AuditedModel<SurveyResponse> {
  @ForeignKey(() => SurveyAssignment)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: false, field: 'assignment_id' })
  assignmentId: number;

  @ForeignKey(() => Survey)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: false, field: 'survey_id' })
  surveyId: number;

  @ForeignKey(() => Customer)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: false, field: 'customer_id' })
  customerId: number;

  @Column({ type: DataType.DATE, allowNull: false, field: 'submitted_at' })
  submittedAt: Date;

  /** คะแนนรวมที่คำนวณจากคำถามแบบ RATING ไว้ทำรายงาน */
  @Column({ type: DataType.DECIMAL(5, 2), allowNull: true, field: 'overall_score' })
  overallScore: string | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  comment: string | null;

  @BelongsTo(() => SurveyAssignment)
  assignment: SurveyAssignment;

  @BelongsTo(() => Survey)
  survey: Survey;

  @BelongsTo(() => Customer)
  customer: Customer;

  @HasMany(() => SurveyAnswer)
  answers: SurveyAnswer[];
}
