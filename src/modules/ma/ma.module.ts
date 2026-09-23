import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { Customer, MaAddon, MaContract, MaPlan, MaPlanItem, MaUsage, Project } from '../../models';
import { MaContractsController } from './ma-contracts.controller';
import { MaContractsService } from './ma-contracts.service';
import { MaPlansController } from './ma-plans.controller';
import { MaPlansService } from './ma-plans.service';
import { MaQuotaService } from './ma-quota.service';

/**
 * โมดูล MA — แผน สัญญา ของเสริม และตรรกะโควตา (Phase 8)
 *
 * `MaQuotaService` ถูกสร้างมาก่อนตั้งแต่ Phase 7 เพราะการบันทึกผลการแก้ปัญหา
 * ต้องหักโควตาในทรานแซกชันเดียวกัน (CLAUDE.md 9.1) จึง export ออกไปให้ TicketsModule
 * ส่วน `MaContractsService` และ `MaPlansService` เป็นของ Phase 8 ล้วน ไม่มีใครนอกโมดูลใช้
 */
@Module({
  imports: [
    SequelizeModule.forFeature([
      MaContract,
      MaPlan,
      MaPlanItem,
      MaAddon,
      MaUsage,
      Project,
      Customer,
    ]),
  ],
  controllers: [MaPlansController, MaContractsController],
  providers: [MaQuotaService, MaPlansService, MaContractsService],
  exports: [MaQuotaService, MaContractsService],
})
export class MaModule {}
