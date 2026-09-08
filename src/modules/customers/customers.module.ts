import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { CommunicationLog, Contact, Customer, Project, Ticket, User } from '../../models';
import { CommunicationLogsController } from './communication-logs.controller';
import { CommunicationLogsService } from './communication-logs.service';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

/**
 * Phase 4 — Customers + Contacts + Communication Logs
 *
 * รวมสามเรื่องไว้ในโมดูลเดียวเพราะผูกกันแน่นและอยู่ในหน้าจอเดียวกันเสมอ
 * Project กับ Ticket ถูก register ไว้ด้วยเพื่อใช้ตรวจก่อนลบลูกค้าเท่านั้น
 * โมดูลของทั้งสองตัวจะมาใน Phase 5 และ 7
 */
@Module({
  imports: [
    SequelizeModule.forFeature([Customer, Contact, CommunicationLog, User, Project, Ticket]),
  ],
  controllers: [CustomersController, ContactsController, CommunicationLogsController],
  providers: [CustomersService, ContactsService, CommunicationLogsService],
  exports: [CustomersService],
})
export class CustomersModule {}
