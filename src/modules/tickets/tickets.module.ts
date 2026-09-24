import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { Contact, Customer, Project, Ticket, TicketResolution, User } from '../../models';
import { MaModule } from '../ma/ma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WarrantiesModule } from '../warranties/warranties.module';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';

/**
 * Phase 7 — ใบแจ้งปัญหาและรอบการแก้ไข (โมดูล M5)
 *
 * WarrantiesModule ให้ `findCoveringWarranty()` ไว้ตรวจว่ายังอยู่ในระยะประกันไหม
 * MaModule ให้ตรรกะโควตาไว้หักตอนบันทึกผลการแก้ที่ billing_type = MA_QUOTA
 * NotificationsModule ให้ TicketWorkflowNotifyService สำหรับ C-3 (แจ้งในแอปตอนส่งข้ามฝ่าย)
 * ทั้งสามเป็นการพึ่งพาทางเดียว ไม่มีใครอ้างกลับมาที่โมดูลนี้
 */
@Module({
  imports: [
    SequelizeModule.forFeature([Ticket, TicketResolution, Customer, Project, Contact, User]),
    WarrantiesModule,
    MaModule,
    NotificationsModule,
  ],
  controllers: [TicketsController],
  providers: [TicketsService],
  exports: [TicketsService],
})
export class TicketsModule {}
