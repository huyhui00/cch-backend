import { BelongsTo, Column, DataType, ForeignKey, Table } from 'sequelize-typescript';

import { AuditedModel } from './base.model';
import { SurveyQuestion } from './survey-question.model';
import { SurveyResponse } from './survey-response.model';

/**
 * คำตอบราย 1 คำถาม เก็บแยกคอลัมน์ตามชนิดของคำถาม
 *   RATING       -> answer_number
 *   TEXT         -> answer_text
 *   CHOICE       -> answer_text
 *   MULTI_CHOICE -> answer_json
 */
export interface SurveyAnswerCreationAttributes {
  responseId: number;
  questionId: number;
  answerText?: string | null;
  answerNumber?: string | null;
  answerJson?: unknown;
  createdBy?: number | null;
  updatedBy?: number | null;
}

@Table({ tableName: 'survey_answers', underscored: true, timestamps: true, paranoid: true })
export class SurveyAnswer extends AuditedModel<SurveyAnswer, SurveyAnswerCreationAttributes> {
  @ForeignKey(() => SurveyResponse)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: false, field: 'response_id' })
  responseId: number;

  @ForeignKey(() => SurveyQuestion)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: false, field: 'question_id' })
  questionId: number;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'answer_text' })
  answerText: string | null;

  @Column({ type: DataType.DECIMAL(10, 2), allowNull: true, field: 'answer_number' })
  answerNumber: string | null;

  @Column({ type: DataType.JSON, allowNull: true, field: 'answer_json' })
  answerJson: unknown;

  @BelongsTo(() => SurveyResponse)
  response: SurveyResponse;

  @BelongsTo(() => SurveyQuestion)
  question: SurveyQuestion;
}
