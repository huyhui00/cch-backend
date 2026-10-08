import { Global, Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { Permission, Role, User } from '../models';
import { AccessControlService } from './services/access-control.service';

@Global()
@Module({
  imports: [SequelizeModule.forFeature([User, Role, Permission])],
  providers: [AccessControlService],
  exports: [AccessControlService, SequelizeModule],
})
export class AccessControlModule {}
