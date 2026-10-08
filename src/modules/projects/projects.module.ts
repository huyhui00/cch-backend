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
