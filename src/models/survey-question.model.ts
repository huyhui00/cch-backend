import { BelongsTo, Column, DataType, ForeignKey, Table } from 'sequelize-typescript';

import { AuditedModel } from './base.model';
import { Survey } from './survey.model';

export enum SurveyQuestionType {
  RATING = 'RATING',
  CHOICE = 'CHOICE',
  MULTI_CHOICE = 'MULTI_CHOICE',
  TEXT = 'TEXT',
}

export interface SurveyQuestionCreationAttributes {
  surveyId: number;
  questionText: string;
  questionType: SurveyQuestionType;
  isRequired?: boolean;
  options?: unknown;
  minValue?: number | null;
  maxValue?: number | null;
  sortOrder?: number;
  createdBy?: number | null;
  updatedBy?: number | null;
}

@Table({ tableName: 'survey_questions', underscored: true, timestamps: true, paranoid: true })
export class SurveyQuestion extends AuditedModel<SurveyQuestion, SurveyQuestionCreationAttributes> {
  @ForeignKey(() => Survey)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: false, field: 'survey_id' })
  surveyId: number;

  @Column({ type: DataType.TEXT, allowNull: false, field: 'question_text' })
  questionText: string;

  @Column({
    type: DataType.ENUM(...Object.values(SurveyQuestionType)),
    allowNull: false,
    field: 'question_type',
  })
  questionType: SurveyQuestionType;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true, field: 'is_required' })
  isRequired: boolean;

  @Column({ type: DataType.JSON, allowNull: true })
  options: unknown;

  @Column({ type: DataType.INTEGER, allowNull: true, field: 'min_value' })
  minValue: number | null;

  @Column({ type: DataType.INTEGER, allowNull: true, field: 'max_value' })
  maxValue: number | null;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0, field: 'sort_order' })
  sortOrder: number;

  @BelongsTo(() => Survey)
  survey: Survey;
}
