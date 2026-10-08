import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { Document, Project, User } from '../../models';
import { FilesModule } from '../files/files.module';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { ProjectDocumentsController } from './project-documents.controller';

@Module({
  imports: [SequelizeModule.forFeature([Document, Project, User]), FilesModule],
  controllers: [ProjectDocumentsController, DocumentsController],
  providers: [DocumentsService],
})
export class DocumentsModule {}
