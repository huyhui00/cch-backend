import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import {
  Contact,
  Customer,
  Project,
  Survey,
  SurveyAnswer,
  SurveyAssignment,
  SurveyQuestion,
  SurveyResponse,
  User,
} from '../../models';
import { SurveyAssignmentsController, SurveysController } from './surveys.controller';
import { SurveysService } from './surveys.service';

@Module({
  imports: [
    SequelizeModule.forFeature([
      Survey,
      SurveyQuestion,
      SurveyAssignment,
      SurveyResponse,
      SurveyAnswer,
      Customer,
      Contact,
      Project,
      User,
    ]),
  ],
  controllers: [SurveysController, SurveyAssignmentsController],
  providers: [SurveysService],
  exports: [SurveysService],
})
export class SurveysModule {}
