import { Module } from '@nestjs/common';

import { StorageService } from './storage.service';

/**
 * Phase 9 — ที่เก็บไฟล์ (Cloudflare R2)
 *
 * ตอนนี้มีแค่ StorageService ให้โมดูลอื่นเรียกใช้ เริ่มจากเอกสารโครงการ (ประชุม 11 ก.ย. — B-5)
 * ไฟล์แนบของส่วนอื่น (หลักฐานการติดต่อ BR-02, สแกนสัญญา BR-12, ใบส่งมอบ, ใบแจ้งปัญหา)
 * จะใช้ service ตัวเดียวกันนี้เมื่อทำต่อ
 */
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class FilesModule {}
