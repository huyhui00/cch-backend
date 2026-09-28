import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import {
  Attachment,
  Contact,
  Customer,
  Delivery,
  MaContract,
  MaPlan,
  Project,
  Warranty,
} from '../../models';
import { WarrantiesController } from './warranties.controller';
import { WarrantiesService } from './warranties.service';
import { WarrantyExpiryScheduler } from './warranty-expiry.scheduler';

/**
 * Phase 6 — การรับประกัน (โมดูล M4, BR-06)
 *
 * Delivery ถูก register ไว้เพื่ออ่านวันส่งมอบมาเป็นจุดตั้งต้นของระยะประกัน
 * ไม่ได้เรียกผ่าน DeliveriesService เพราะฝั่งนั้นเรียกโมดูลนี้อยู่แล้วตอนแก้วันส่งมอบ
 * ถ้าอ้างกันสองทางจะกลายเป็น circular dependency ที่ต้องแก้ด้วย forwardRef
 *
 * Customer อยู่ในรายการเพราะ include ซ้อนใต้ Project ตอนกรอง "ประกันใกล้หมด"
 * ตามลูกค้า ทำให้หน้าจอแสดงชื่อลูกค้าได้โดยไม่ต้องยิงถามซ้ำ
 *
 * MaContract / MaPlan เข้ามาตอน B-13 — ประกันผูกสัญญา MA ได้เพื่อ *อ้างอิง* ว่าประกันใบนี้
 * มาคู่กับแผนไหน ใช้ model ตรง ๆ ไม่ inject MaContractsService เพราะต้องการแค่ตรวจว่า
 * สัญญามีอยู่จริงและอยู่โครงการเดียวกัน ไม่ได้ใช้กติกาการคิดเงินหรือโควตาของโมดูลนั้นเลย
 * (พี่เลี้ยง: "ไม่ใช่คิดรวมนะ") การพึ่ง service จะลากกติกาที่ไม่เกี่ยวเข้ามาโดยไม่จำเป็น
 */
@Module({
  imports: [
    SequelizeModule.forFeature([
      Warranty,
      Delivery,
      Project,
      Customer,
      Contact,
      MaContract,
      MaPlan,
      Attachment,
    ]),
  ],
  controllers: [WarrantiesController],
  providers: [WarrantiesService, WarrantyExpiryScheduler],
  exports: [WarrantiesService],
})
export class WarrantiesModule {}
