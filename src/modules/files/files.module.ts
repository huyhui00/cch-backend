import { Module } from '@nestjs/common';

import { StorageService } from './storage.service';

/**
 * Phase 9 — ที่เก็บไฟล์ (Cloudflare R2 / local)
 *
 * StorageService ให้โมดูลเอกสารโปรเจคและไฟล์แนบ (attachments) เรียกใช้ร่วมกัน
 * ห้ามต่อ S3/R2 เองซ้ำในโมดูลอื่น
 */
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class FilesModule {}
