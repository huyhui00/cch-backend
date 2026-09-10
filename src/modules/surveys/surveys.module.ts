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

/**
 * M8 — แบบประเมินความพึงพอใจ
 *
 * รวม 5 ตารางไว้ในโมดูลเดียวเพราะผูกกันแน่นและไม่มีความหมายแยกจากกัน
 * (แบบประเมิน → คำถาม → การส่งให้ลูกค้า → คำตอบ → คำตอบรายข้อ)
 *
 * Customer / Contact / Project / User ถูก register ไว้เพื่อตรวจข้อมูลอ้างอิง
 * และดึงชื่อมาแสดงเท่านั้น ไม่ได้ inject service ของโมดูลอื่นเข้ามา
 */
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
