import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { AuditLog, User } from '../../models';
import { AuditHookService } from './audit-hook.service';
import { AuditLogsController } from './audit-logs.controller';
import { AuditLogsService } from './audit-logs.service';

/**
 * AuditHookService ต้องถูกสร้างขึ้นเสมอ แม้ไม่มีใครเรียกใช้โดยตรง
 * เพราะการผูก hook เกิดใน onModuleInit ถ้า module นี้ไม่ถูก import
 * ระบบจะทำงานได้ตามปกติแต่ไม่มี audit log สักแถวเดียว
 */
@Module({
  imports: [SequelizeModule.forFeature([AuditLog, User])],
  controllers: [AuditLogsController],
  providers: [AuditLogsService, AuditHookService],
  exports: [AuditLogsService],
})
export class AuditLogsModule {}
