import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { Customer, Delivery, Project, Warranty } from '../../models';
import { WarrantiesController } from './warranties.controller';
import { WarrantiesService } from './warranties.service';

/**
 * Phase 6 — การรับประกัน (โมดูล M4, BR-06)
 *
 * Delivery ถูก register ไว้เพื่ออ่านวันส่งมอบมาเป็นจุดตั้งต้นของระยะประกัน
 * ไม่ได้เรียกผ่าน DeliveriesService เพราะฝั่งนั้นเรียกโมดูลนี้อยู่แล้วตอนแก้วันส่งมอบ
 * ถ้าอ้างกันสองทางจะกลายเป็น circular dependency ที่ต้องแก้ด้วย forwardRef
 *
 * Customer อยู่ในรายการเพราะ include ซ้อนใต้ Project ตอนกรอง "ประกันใกล้หมด"
 * ตามลูกค้า ทำให้หน้าจอแสดงชื่อลูกค้าได้โดยไม่ต้องยิงถามซ้ำ
 */
@Module({
  imports: [SequelizeModule.forFeature([Warranty, Delivery, Project, Customer])],
  controllers: [WarrantiesController],
  providers: [WarrantiesService],
  exports: [WarrantiesService],
})
export class WarrantiesModule {}
