import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { MaAddon, MaContract, MaPlan, MaUsage } from '../../models';
import { MaQuotaService } from './ma-quota.service';

/**
 * โมดูล MA — **ยังไม่มี controller ในเฟสนี้โดยเจตนา**
 *
 * CRUD ของแผน สัญญา addon และรายงานการใช้โควตา เป็นขอบเขตของ Phase 8
 * ที่มีอยู่ตอนนี้คือตรรกะโควตาที่ Phase 7 ต้องใช้ตอนบันทึกผลการแก้ปัญหา
 * (CLAUDE.md 9.1 ข้อ 6) วางไว้ที่นี่ตั้งแต่แรกเพื่อไม่ต้องย้ายไฟล์ตอน Phase 8
 * — Phase 8 แค่มาเพิ่ม controller กับ service ตัวอื่นในโมดูลนี้
 */
@Module({
  imports: [SequelizeModule.forFeature([MaContract, MaPlan, MaAddon, MaUsage])],
  providers: [MaQuotaService],
  exports: [MaQuotaService],
})
export class MaModule {}
