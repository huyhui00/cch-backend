import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import {
  Attachment,
  CommunicationLog,
  Delivery,
  MaContract,
  Ticket,
  TicketResolution,
  User,
} from '../../models';
import { FilesModule } from '../files/files.module';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';

/**
 * Phase 9 ส่วนที่เหลือ — ไฟล์แนบ polymorphic
 *
 * ใช้ StorageService ร่วมกับเอกสารโปรเจค
 * สิทธิ์: file.view / file.upload / file.download / file.delete
 */
@Module({
  imports: [
    SequelizeModule.forFeature([
      Attachment,
      CommunicationLog,
      Delivery,
      Ticket,
      TicketResolution,
      MaContract,
      User,
    ]),
    FilesModule,
  ],
  controllers: [AttachmentsController],
  providers: [AttachmentsService],
  exports: [AttachmentsService],
})
export class AttachmentsModule {}
