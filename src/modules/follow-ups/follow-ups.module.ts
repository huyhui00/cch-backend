import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { Customer, FollowUp, Project, User } from '../../models';
import { FollowUpsController } from './follow-ups.controller';
import { FollowUpsService } from './follow-ups.service';

@Module({
  imports: [SequelizeModule.forFeature([FollowUp, Customer, Project, User])],
  controllers: [FollowUpsController],
  providers: [FollowUpsService],
  exports: [FollowUpsService],
})
export class FollowUpsModule {}
