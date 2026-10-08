import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import {
  AuditLog,
  Contact,
  Customer,
  Project,
  Ticket,
  TicketResolution,
  User,
  Attachment,
} from '../../models';
import { MaModule } from '../ma/ma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WarrantiesModule } from '../warranties/warranties.module';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';

@Module({
  imports: [
    SequelizeModule.forFeature([
      Ticket,
      TicketResolution,
      Customer,
      Project,
      Contact,
      User,
      Attachment,
      AuditLog,
    ]),
    WarrantiesModule,
    MaModule,
    NotificationsModule,
  ],
  controllers: [TicketsController],
  providers: [TicketsService],
  exports: [TicketsService],
})
export class TicketsModule {}
