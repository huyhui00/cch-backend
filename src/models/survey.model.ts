import { Column, DataType, HasMany, Table } from 'sequelize-typescript';

import { AuditedModel } from './base.model';
import { SurveyQuestion } from './survey-question.model';

@Table({ tableName: 'surveys', underscored: true, timestamps: true, paranoid: true })
export class Survey extends AuditedModel<Survey> {
  @Column({ type: DataType.STRING(255), allowNull: false })
  title: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  description: string | null;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true, field: 'is_active' })
  isActive: boolean;

  @Column({ type: DataType.DATEONLY, allowNull: true, field: 'valid_from' })
  validFrom: string | null;

  @Column({ type: DataType.DATEONLY, allowNull: true, field: 'valid_to' })
  validTo: string | null;

  @HasMany(() => SurveyQuestion)
  questions: SurveyQuestion[];
}
