import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { Document, Project, User } from '../../models';
import { FilesModule } from '../files/files.module';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { ProjectDocumentsController } from './project-documents.controller';

/**
 * Phase 9 (M9) — เอกสารของโครงการ (ประชุม 11 ก.ย. — B-5)
 *
 * Project ถูก register ไว้เพื่อตรวจว่ามีโครงการจริงและคัดลอกลูกค้าเจ้าของโครงการ
 * User ใช้หาชื่อผู้อัปโหลด — ไม่ได้ inject service ของโมดูลอื่น
 */
@Module({
  imports: [SequelizeModule.forFeature([Document, Project, User]), FilesModule],
  controllers: [ProjectDocumentsController, DocumentsController],
  providers: [DocumentsService],
})
export class DocumentsModule {}
