import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { AuditLog, User } from '../../models';
import { AuditHookService } from './audit-hook.service';
import { AuditLogsController } from './audit-logs.controller';
import { AuditLogsService } from './audit-logs.service';

@Module({
  imports: [SequelizeModule.forFeature([AuditLog, User])],
  controllers: [AuditLogsController],
  providers: [AuditLogsService, AuditHookService],
  exports: [AuditLogsService],
})
export class AuditLogsModule {}
