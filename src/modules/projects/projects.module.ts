import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { Customer, Project, Task, TaskSubmission, User } from '../../models';
import { CustomersModule } from '../customers/customers.module';
import { FilesModule } from '../files/files.module';
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
 */
// CustomersModule ถูก import เพื่อสร้างลูกค้าใหม่พร้อมโครงการ (ประชุม 11 ก.ย. — B-3)
// ใช้ CustomersService.createRecord() ตัวเดียวกับ POST /api/customers กติกาการสร้างลูกค้าจะได้อยู่ที่เดียว
@Module({
  imports: [
    SequelizeModule.forFeature([Project, Task, TaskSubmission, Customer, User]),
    CustomersModule,
    FilesModule,
  ],
  controllers: [ProjectsController, ProjectTasksController, TasksController],
  providers: [ProjectsService, TasksService],
  exports: [ProjectsService, TasksService],
})
export class ProjectsModule {}
