import { Global, Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { Permission, Role, User } from '../models';
import { AccessControlService } from './services/access-control.service';

/**
 * ประกาศเป็น @Global เพราะ PermissionsGuard ถูกผูกไว้ที่ระดับ APP_GUARD
 * จึงต้องหา AccessControlService เจอโดยที่ทุก module ไม่ต้อง import ซ้ำเอง
 */
@Global()
@Module({
  imports: [SequelizeModule.forFeature([User, Role, Permission])],
  providers: [AccessControlService],
  exports: [AccessControlService, SequelizeModule],
})
export class AccessControlModule {}
