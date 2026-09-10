import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { Customer, FollowUp, User } from '../../models';
import { FollowUpsController } from './follow-ups.controller';
import { FollowUpsService } from './follow-ups.service';

/**
 * M7 — งานติดตามลูกค้า
 *
 * Customer กับ User ถูก register ไว้เพื่อตรวจว่ามีอยู่จริงก่อนผูกเท่านั้น
 * ไม่ได้ inject CustomersService เข้ามาเพราะต้องการแค่เช็คว่าลูกค้ามีจริง
 * ไม่ได้ใช้ตรรกะอื่นของโมดูลลูกค้าเลย — ผูกกันน้อยที่สุดเท่าที่จำเป็น
 */
@Module({
  imports: [SequelizeModule.forFeature([FollowUp, Customer, User])],
  controllers: [FollowUpsController],
  providers: [FollowUpsService],
  exports: [FollowUpsService],
})
export class FollowUpsModule {}
