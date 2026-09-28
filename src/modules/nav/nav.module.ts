import { Module } from '@nestjs/common';

import { ProjectsModule } from '../projects/projects.module';
import { TicketsModule } from '../tickets/tickets.module';
import { NavController } from './nav.controller';
import { NavService } from './nav.service';

@Module({
  imports: [TicketsModule, ProjectsModule],
  controllers: [NavController],
  providers: [NavService],
})
export class NavModule {}
