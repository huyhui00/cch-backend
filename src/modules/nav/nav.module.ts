import { Module } from '@nestjs/common';

import { FollowUpsModule } from '../follow-ups/follow-ups.module';
import { MaModule } from '../ma/ma.module';
import { ProjectsModule } from '../projects/projects.module';
import { TicketsModule } from '../tickets/tickets.module';
import { WarrantiesModule } from '../warranties/warranties.module';
import { NavController } from './nav.controller';
import { NavService } from './nav.service';

@Module({
  imports: [TicketsModule, ProjectsModule, FollowUpsModule, WarrantiesModule, MaModule],
  controllers: [NavController],
  providers: [NavService],
})
export class NavModule {}
