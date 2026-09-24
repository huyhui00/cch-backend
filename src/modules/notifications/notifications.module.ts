import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import {
  Customer,
  FollowUp,
  MaContract,
  Notification,
  NotificationRule,
  Permission,
  Role,
  RolePermission,
  Task,
  Ticket,
  User,
  UserRole,
  Warranty,
} from '../../models';
import { LineMessagingService } from './line-messaging.service';
import { NotificationDispatchService } from './notification-dispatch.service';
import { NotificationRulesController } from './notification-rules.controller';
import { NotificationRulesService } from './notification-rules.service';
import { NotificationSchedulerService } from './notification-scheduler.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { TicketWorkflowNotifyService } from './ticket-workflow-notify.service';

/**
 * Phase 11 — แจ้งเตือนภายในบริษัท + LINE (BR-11)
 *
 * อ่าน model ข้ามโมดูลตรง ๆ เหมือน Reports ไม่ inject service ของ Phase อื่น
 * เพื่อเลี่ยงวงพึ่งพา และให้ scheduler ทำงานได้แม้ FE ยังไม่เรียกเส้นอื่น
 *
 * TicketWorkflowNotifyService ถูก export ให้ TicketsModule เรียกตอน C-3
 * (ส่งข้ามฝ่าย → inbox ในแอป ไม่ยิง LINE)
 */
@Module({
  imports: [
    SequelizeModule.forFeature([
      Notification,
      NotificationRule,
      User,
      UserRole,
      Role,
      RolePermission,
      Permission,
      Warranty,
      MaContract,
      Task,
      FollowUp,
      Ticket,
      Customer,
    ]),
  ],
  controllers: [NotificationsController, NotificationRulesController],
  providers: [
    LineMessagingService,
    NotificationsService,
    NotificationRulesService,
    NotificationDispatchService,
    NotificationSchedulerService,
    TicketWorkflowNotifyService,
  ],
  exports: [
    LineMessagingService,
    NotificationDispatchService,
    NotificationsService,
    TicketWorkflowNotifyService,
  ],
})
export class NotificationsModule {}
