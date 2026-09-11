import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { Customer, FollowUp, Project, User } from '../../models';
import { FollowUpsController } from './follow-ups.controller';
import { FollowUpsService } from './follow-ups.service';

/**
 * M7 — งานติดตามลูกค้า
 *
 * Customer, Project กับ User ถูก register ไว้เพื่อตรวจว่ามีอยู่จริงก่อนผูกเท่านั้น
 * ไม่ได้ inject service ของโมดูลอื่นเข้ามาเพราะต้องการแค่เช็คว่ามีจริง (และเจ้าของโปรเจคคือใคร)
 * ไม่ได้ใช้ตรรกะอื่นของโมดูลเหล่านั้นเลย — ผูกกันน้อยที่สุดเท่าที่จำเป็น
 */
@Module({
  imports: [SequelizeModule.forFeature([FollowUp, Customer, Project, User])],
  controllers: [FollowUpsController],
  providers: [FollowUpsService],
  exports: [FollowUpsService],
})
export class FollowUpsModule {}
