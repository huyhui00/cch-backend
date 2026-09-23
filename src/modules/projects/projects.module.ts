import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import {
  Customer,
  Delivery,
  Document,
  MaContract,
  Project,
  Task,
  TaskSubmission,
  Ticket,
  User,
} from '../../models';
import { CustomersModule } from '../customers/customers.module';
import { FilesModule } from '../files/files.module';
import { MaModule } from '../ma/ma.module';
import { ProjectTasksController } from './project-tasks.controller';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

/**
 * Phase 5 — Projects + Tasks (โมดูล M2)
 *
 * Customer ถูก register ไว้เพื่อตรวจว่ามีลูกค้าอยู่จริงก่อนสร้างโครงการ
 * ไม่ได้เรียกผ่าน CustomersService เพื่อไม่ให้สองโมดูลผูกกันแน่นเกินจำเป็น
 *
 * Ticket / Delivery / MaContract ใช้แค่นับสรุปใน GET /projects/:id/report (B-6)
 * ไม่เรียก service ของโมดูลอื่น เพื่อไม่ให้ผูกกันแน่นเกินจำเป็น
 *
 * MaModule ถูก import เพื่อ GET /projects/:id/ma-quota — สรุปโควตาในหน้ารายละเอียดโปรเจค
 * ตามประชุมทบทวน (ดูการใช้โควตาที่โปรเจค ไม่ยัดในหน้ารายการสัญญา)
 */
@Module({
  imports: [
    SequelizeModule.forFeature([
      Project,
      Task,
      TaskSubmission,
      Document,
      Customer,
      User,
      Ticket,
      Delivery,
      MaContract,
    ]),
    CustomersModule,
    FilesModule,
    MaModule,
  ],
  controllers: [ProjectsController, ProjectTasksController, TasksController],
  providers: [ProjectsService, TasksService],
  exports: [ProjectsService, TasksService],
})
export class ProjectsModule {}
