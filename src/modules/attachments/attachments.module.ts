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
  Warranty,
} from '../../models';
import { FilesModule } from '../files/files.module';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';

@Module({
  imports: [
    SequelizeModule.forFeature([
      Attachment,
      CommunicationLog,
      Delivery,
      Ticket,
      TicketResolution,
      MaContract,
      Warranty,
      User,
    ]),
    FilesModule,
  ],
  controllers: [AttachmentsController],
  providers: [AttachmentsService],
  exports: [AttachmentsService],
})
export class AttachmentsModule {}
