import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { Attachment, Contact, Delivery, Project, User, Warranty } from '../../models';
import { ProjectsModule } from '../projects/projects.module';
import { WarrantiesModule } from '../warranties/warranties.module';
import { DeliveriesController } from './deliveries.controller';
import { DeliveriesService } from './deliveries.service';
import { ProjectDeliveriesController } from './project-deliveries.controller';

/**
 * Phase 6 — การส่งมอบ (โมดูล M3)
 *
 * ProjectsModule ถูก import มาเพื่อใช้ ProjectsService.findOrFail() ซึ่งโยน 404
 * เป็นภาษาไทยให้แล้ว ไม่ต้องเขียนเงื่อนไขซ้ำ
 *
 * WarrantiesModule ถูก import มาเพื่อขยับระยะประกันตามเมื่อวันส่งมอบถูกแก้ (BR-06)
 * ทิศทางการพึ่งพาเป็นทางเดียว deliveries -> warranties เท่านั้น
 *
 * Attachment ถูก register ไว้เพื่ออ่านไฟล์แนบของใบส่งมอบ (ref_type = DELIVERY)
 * การอัปโหลดจริงเป็นของโมดูล Files ใน Phase 9
 */
@Module({
  imports: [
    SequelizeModule.forFeature([Delivery, Warranty, Contact, User, Attachment, Project]),
    ProjectsModule,
    WarrantiesModule,
  ],
  controllers: [ProjectDeliveriesController, DeliveriesController],
  providers: [DeliveriesService],
  exports: [DeliveriesService],
})
export class DeliveriesModule {}
