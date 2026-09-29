import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { CommunicationLog } from '../../models/communication-log.model';
import { FollowUp } from '../../models/follow-up.model';
import { Project } from '../../models/project.model';
import { Task } from '../../models/task.model';
import { TicketResolution } from '../../models/ticket-resolution.model';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [
    SequelizeModule.forFeature([Project, Task, TicketResolution, FollowUp, CommunicationLog]),
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
