import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, type WhereOptions } from 'sequelize';

import { getCurrentUserId } from '../../common/context/request-context';
import { type PaginatedResult, toPaginatedResult } from '../../common/dto/pagination.dto';
import { Customer, Document, DocumentType, Project, User } from '../../models';
import { StorageService, type StoredFileStream } from '../files/storage.service';
import { assertUploadable, buildStorageKey, type UploadedFileLike } from '../files/upload.util';
import {
  QueryCompanyDocumentsDto,
  QueryDocumentsDto,
  UpdateDocumentDto,
  UploadDocumentDto,
} from './dto/document.dto';
import {
  type CompanyDocumentResponseDto,
  type DocumentResponseDto,
  type DocumentUploaderDto,
  toCompanyDocumentResponse,
  toDocumentResponse,
} from './dto/document.response';

const SORTABLE_FIELDS = new Set(['id', 'title', 'fileName', 'fileSize', 'createdAt', 'updatedAt']);

export interface DocumentFile extends StoredFileStream {
  fileName: string;
  mimeType: string | null;
}

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    @InjectModel(Document) private readonly documentModel: typeof Document,
    @InjectModel(Project) private readonly projectModel: typeof Project,
    @InjectModel(User) private readonly userModel: typeof User,
    private readonly storage: StorageService,
  ) {}

  async findByProject(
    projectId: number,
    query: QueryDocumentsDto,
  ): Promise<PaginatedResult<DocumentResponseDto>> {
    await this.findProjectOrFail(projectId);

    const where: WhereOptions<Document> = { projectId };

    if (query.search) {
      const like = { [Op.like]: '%' + query.search + '%' };
      Object.assign(where, { [Op.or]: [{ title: like }, { fileName: like }] });
    }

    const sortBy = SORTABLE_FIELDS.has(query.sortBy ?? '') ? (query.sortBy as string) : 'createdAt';

    const { rows, count } = await this.documentModel.findAndCountAll({
      where,
      order: [
        [sortBy, query.sortBy ? query.sortOrder : 'DESC'],
        ['id', 'DESC'],
      ],
      limit: query.limit,
      offset: query.offset,
    });

    const uploaders = await this.findUploaders(rows);

    return toPaginatedResult(
      rows.map((document) => toDocumentResponse(document, uploaders)),
      count,
      query,
    );
  }

  async findAll(
    query: QueryCompanyDocumentsDto,
  ): Promise<PaginatedResult<CompanyDocumentResponseDto>> {
    const where: WhereOptions<Document> = {};

    if (query.projectId !== undefined) {
      Object.assign(where, { projectId: query.projectId });
    }

    if (query.customerId !== undefined) {
      Object.assign(where, { customerId: query.customerId });
    }

    if (query.search) {
      const like = { [Op.like]: '%' + query.search + '%' };
      const projects = await this.projectModel.findAll({
        attributes: ['id'],
        where: { [Op.or]: [{ name: like }, { code: like }] },
        paranoid: false,
      });
      const conditions: WhereOptions<Document>[] = [{ title: like }, { fileName: like }];

      if (projects.length > 0) {
        conditions.push({ projectId: { [Op.in]: projects.map((project) => project.id) } });
      }

      Object.assign(where, { [Op.or]: conditions });
    }

    const sortBy = SORTABLE_FIELDS.has(query.sortBy ?? '') ? (query.sortBy as string) : 'createdAt';

    const { rows, count } = await this.documentModel.findAndCountAll({
      where,
      include: [
        {
          model: Project,
          attributes: ['id', 'code', 'name'],
          required: false,
          paranoid: false,
          include: [
            { model: Customer, attributes: ['id', 'name'], required: false, paranoid: false },
          ],
        },
      ],
      order: [
        [sortBy, query.sortBy ? query.sortOrder : 'DESC'],
        ['id', query.sortBy ? query.sortOrder : 'DESC'],
      ],
      limit: query.limit,
      offset: query.offset,
    });

    const uploaders = await this.findUploaders(rows);

    return toPaginatedResult(
      rows.map((document) => toCompanyDocumentResponse(document, uploaders)),
      count,
      query,
    );
  }

  async findOne(id: number): Promise<DocumentResponseDto> {
    const document = await this.findOrFail(id);
    return toDocumentResponse(document, await this.findUploaders([document]));
  }

  async upload(
    projectId: number,
    file: UploadedFileLike | undefined,
    dto: UploadDocumentDto,
  ): Promise<DocumentResponseDto> {
    const actorId = getCurrentUserId();
    const project = await this.findProjectOrFail(projectId);
    const fileName = assertUploadable(file);
    const upload = file as UploadedFileLike;
    const mimeType = upload.mimetype || null;

    const stored = await this.storage.put(
      buildStorageKey(`projects/${projectId}`, fileName),
      upload.buffer,
      mimeType,
    );

    try {
      const document = await this.documentModel.create({
        customerId: project.customerId,
        projectId,
        docType: DocumentType.OTHER,
        title: dto.title ?? fileName,
        fileUrl: stored.key,
        fileName,
        fileSize: upload.size,
        mimeType,
        note: dto.note ?? null,
        createdBy: actorId,
        updatedBy: actorId,
      });

      return this.findOne(document.id);
    } catch (error) {
      this.logger.warn(`บันทึกเอกสารไม่สำเร็จ ไฟล์ค้างในที่เก็บ key=${stored.key}`);
      throw error;
    }
  }

  async update(id: number, dto: UpdateDocumentDto): Promise<DocumentResponseDto> {
    const actorId = getCurrentUserId();
    const document = await this.findOrFail(id);

    await document.update({
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.note !== undefined ? { note: dto.note ?? null } : {}),
      updatedBy: actorId,
    });

    return this.findOne(id);
  }

  async remove(id: number): Promise<void> {
    const actorId = getCurrentUserId();
    const document = await this.findOrFail(id);

    // เขียน deleted_by ก่อน destroy เพราะ paranoid destroy แตะแค่ deleted_at (BR-09)
    await document.update({ deletedBy: actorId });
    await document.destroy();
  }

  async openFile(id: number): Promise<DocumentFile> {
    const document = await this.findOrFail(id);

    if (!document.fileUrl) {
      throw new NotFoundException('เอกสารนี้ไม่มีไฟล์แนบ');
    }

    const file = await this.storage.get(document.fileUrl);

    return {
      ...file,
      fileName: document.fileName ?? `document-${document.id}`,
      mimeType: document.mimeType,
    };
  }

  private async findOrFail(id: number): Promise<Document> {
    const document = await this.documentModel.findOne({
      where: { id, projectId: { [Op.ne]: null } },
    });

    if (!document) {
      throw new NotFoundException('ไม่พบเอกสาร');
    }

    return document;
  }

  private async findProjectOrFail(projectId: number): Promise<Project> {
    const project = await this.projectModel.findByPk(projectId, {
      attributes: ['id', 'customerId'],
    });

    if (!project) {
      throw new NotFoundException('ไม่พบข้อมูลโครงการ');
    }

    return project;
  }

  /** ชื่อผู้อัปโหลด — รวมคนที่ลาออกไปแล้ว (BR-09 ต้องรู้ย้อนหลังว่าใครเป็นคนอัปโหลด) */
  private async findUploaders(
    documents: readonly Document[],
  ): Promise<Map<number, DocumentUploaderDto>> {
    const ids = [
      ...new Set(documents.map((document) => document.createdBy).filter((id) => id !== null)),
    ] as number[];

    if (ids.length === 0) {
      return new Map();
    }

    const users = await this.userModel.findAll({
      where: { id: { [Op.in]: ids } },
      attributes: ['id', 'fullName'],
      paranoid: false,
    });

    return new Map(users.map((user) => [user.id, { id: user.id, fullName: user.fullName }]));
  }
}
