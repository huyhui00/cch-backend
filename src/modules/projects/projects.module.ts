import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { Customer, Project, Task, User } from '../../models';
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
@Module({
  imports: [SequelizeModule.forFeature([Project, Task, Customer, User])],
  controllers: [ProjectsController, ProjectTasksController, TasksController],
  providers: [ProjectsService, TasksService],
  exports: [ProjectsService, TasksService],
})
export class ProjectsModule {}
