import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import {
  Customer,
  FollowUp,
  MaAddon,
  MaContract,
  Project,
  Ticket,
  TicketResolution,
  Warranty,
} from '../../models';
import { CustomerOverviewController, ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

/**
 * M10 — รายงานและการวิเคราะห์ + M1-05 / M1-06
 *
 * โมดูลนี้ **อ่านอย่างเดียว** ไม่มี POST/PATCH/DELETE แม้แต่เส้นเดียว
 * และไม่ inject service ของโมดูลอื่นเข้ามา ใช้ model ตรง ๆ เพราะเป็นการรวมข้อมูล
 * ข้ามโมดูล ถ้าไปเรียก service ของแต่ละโมดูลจะเกิดการพึ่งพากันเป็นวงและ query ซ้ำซ้อน
 *
 * **ห้ามเพิ่มตาราง/คอลัมน์เกี่ยวกับการรับเงินเข้ามาที่นี่** — ระบบนี้ไม่ใช่ระบบบัญชี
 * (SC-3, OS-03, OS-06) ตัวเลขทุกตัวคือมูลค่าตามสัญญาเท่านั้น
 */
@Module({
  imports: [
    SequelizeModule.forFeature([
      Customer,
      Project,
      MaContract,
      MaAddon,
      Ticket,
      TicketResolution,
      Warranty,
      FollowUp,
    ]),
  ],
  controllers: [ReportsController, CustomerOverviewController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
