import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';

import { getCurrentUserId } from '../../common/context/request-context';
import {
  Attachment,
  CommunicationLog,
  Delivery,
  MaContract,
  Ticket,
  TicketResolution,
  User,
  type AttachmentRefType,
} from '../../models';
import { StorageService, type StoredFileStream } from '../files/storage.service';
import { assertUploadable, buildStorageKey, type UploadedFileLike } from '../files/upload.util';
import {
  QueryAttachmentsDto,
  UpdateAttachmentDto,
  UPLOADABLE_ATTACHMENT_REF_TYPES,
  UploadAttachmentDto,
  type UploadableAttachmentRefType,
} from './dto/attachment.dto';
import {
  type AttachmentResponseDto,
  type AttachmentUploaderDto,
  toAttachmentResponse,
} from './dto/attachment.response';

export interface AttachmentFile extends StoredFileStream {
  fileName: string;
  mimeType: string | null;
}

const SCOPE_PREFIX: Record<UploadableAttachmentRefType, string> = {
  COMMUNICATION_LOG: 'communication-logs',
  DELIVERY: 'deliveries',
  TICKET: 'tickets',
  TICKET_RESOLUTION: 'ticket-resolutions',
  MA_CONTRACT: 'ma-contracts',
};

/**
 * ไฟล์แนบ polymorphic (Phase 9 ส่วนที่เหลือ)
 *
 * BR-02 บันทึกการติดต่อ · BR-12 สแกนสัญญา MA · ใบส่งมอบ · ใบแจ้งปัญหา / รอบแก้
 * ใช้ StorageService ตัวเดียวกับเอกสารโปรเจค — ห้ามต่อ S3 เอง
 *
 * ลบ = soft delete แถวอย่างเดียว ไฟล์ในที่เก็บยังอยู่เป็นหลักฐาน
 */
@Injectable()
export class AttachmentsService {
  private readonly logger = new Logger(AttachmentsService.name);

  constructor(
    @InjectModel(Attachment) private readonly attachmentModel: typeof Attachment,
    @InjectModel(CommunicationLog) private readonly communicationLogModel: typeof CommunicationLog,
    @InjectModel(Delivery) private readonly deliveryModel: typeof Delivery,
    @InjectModel(Ticket) private readonly ticketModel: typeof Ticket,
    @InjectModel(TicketResolution) private readonly ticketResolutionModel: typeof TicketResolution,
    @InjectModel(MaContract) private readonly maContractModel: typeof MaContract,
    @InjectModel(User) private readonly userModel: typeof User,
    private readonly storage: StorageService,
  ) {}

  async findAll(query: QueryAttachmentsDto): Promise<AttachmentResponseDto[]> {
    await this.assertParentExists(query.refType, query.refId);

    const rows = await this.attachmentModel.findAll({
      where: { refType: query.refType, refId: query.refId },
      order: [
        ['createdAt', 'DESC'],
        ['id', 'DESC'],
      ],
    });

    const uploaders = await this.findUploaders(rows);
    return rows.map((row) => toAttachmentResponse(row, uploaders));
  }

  async findOne(id: number): Promise<AttachmentResponseDto> {
    const attachment = await this.findOrFail(id);
    return toAttachmentResponse(attachment, await this.findUploaders([attachment]));
  }

  async upload(
    file: UploadedFileLike | undefined,
    dto: UploadAttachmentDto,
  ): Promise<AttachmentResponseDto> {
    const actorId = getCurrentUserId();
    await this.assertParentExists(dto.refType, dto.refId);

    const fileName = assertUploadable(file);
    const upload = file as UploadedFileLike;
    const mimeType = upload.mimetype || null;
    const scope = `${SCOPE_PREFIX[dto.refType]}/${dto.refId}`;

    const stored = await this.storage.put(
      buildStorageKey(scope, fileName),
      upload.buffer,
      mimeType,
    );

    try {
      const attachment = await this.attachmentModel.create({
        refType: dto.refType,
        refId: dto.refId,
        fileUrl: stored.key,
        fileName,
        fileSize: upload.size,
        mimeType,
        note: dto.note ?? null,
        uploadedByUserId: actorId,
        createdBy: actorId,
        updatedBy: actorId,
      });

      if (dto.refType === 'MA_CONTRACT') {
        // BR-12 — สแกนสัญญาที่เซ็นแล้ว เก็บ key ไว้ที่สัญญาด้วยเพื่อรู้ว่ามีไฟล์เซ็นแล้ว
        await this.maContractModel.update(
          { signedFileUrl: stored.key, updatedBy: actorId },
          { where: { id: dto.refId } },
        );
      }

      return toAttachmentResponse(attachment, await this.findUploaders([attachment]));
    } catch (error) {
      this.logger.warn(
        `อัปโหลดไฟล์สำเร็จแล้วแต่บันทึกแถว attachments ไม่ได้ (key=${stored.key}) — ไฟล์อาจค้างในที่เก็บ`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  async update(id: number, dto: UpdateAttachmentDto): Promise<AttachmentResponseDto> {
    const actorId = getCurrentUserId();
    const attachment = await this.findOrFail(id);

    await attachment.update({
      ...(dto.note !== undefined ? { note: dto.note } : {}),
      updatedBy: actorId,
    });

    return toAttachmentResponse(attachment, await this.findUploaders([attachment]));
  }

  async remove(id: number): Promise<void> {
    const actorId = getCurrentUserId();
    const attachment = await this.findOrFail(id);

    await attachment.update({ deletedBy: actorId, updatedBy: actorId });
    await attachment.destroy();
  }

  async openFile(id: number): Promise<AttachmentFile> {
    const attachment = await this.findOrFail(id);
    const stored = await this.storage.get(attachment.fileUrl);

    return {
      ...stored,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
    };
  }

  /** ใช้จากโมดูลอื่นที่อยากพ่วงรายการไฟล์ในรายละเอียด */
  async listByRef(refType: AttachmentRefType, refId: number): Promise<Attachment[]> {
    return this.attachmentModel.findAll({
      where: { refType, refId },
      order: [
        ['createdAt', 'DESC'],
        ['id', 'DESC'],
      ],
    });
  }

  private async findOrFail(id: number): Promise<Attachment> {
    const attachment = await this.attachmentModel.findByPk(id);
    if (!attachment) {
      throw new NotFoundException('ไม่พบไฟล์แนบ');
    }
    return attachment;
  }

  private async assertParentExists(refType: string, refId: number): Promise<void> {
    if (
      !(UPLOADABLE_ATTACHMENT_REF_TYPES as readonly string[]).includes(refType) &&
      refType !== 'PROJECT' &&
      refType !== 'CUSTOMER' &&
      refType !== 'FOLLOW_UP'
    ) {
      throw new BadRequestException('refType ไม่ถูกต้อง');
    }

    let exists = false;

    switch (refType as AttachmentRefType) {
      case 'COMMUNICATION_LOG':
        exists = !!(await this.communicationLogModel.findByPk(refId, { attributes: ['id'] }));
        break;
      case 'DELIVERY':
        exists = !!(await this.deliveryModel.findByPk(refId, { attributes: ['id'] }));
        break;
      case 'TICKET':
        exists = !!(await this.ticketModel.findByPk(refId, { attributes: ['id'] }));
        break;
      case 'TICKET_RESOLUTION':
        exists = !!(await this.ticketResolutionModel.findByPk(refId, { attributes: ['id'] }));
        break;
      case 'MA_CONTRACT':
        exists = !!(await this.maContractModel.findByPk(refId, { attributes: ['id'] }));
        break;
      default:
        throw new BadRequestException(
          'ประเภทนี้ยังไม่อนุญาตให้อัปโหลดผ่านเส้นไฟล์แนบ — เอกสารโปรเจคใช้ /api/projects/:id/documents',
        );
    }

    if (!exists) {
      throw new NotFoundException(this.parentNotFoundMessage(refType));
    }
  }

  private parentNotFoundMessage(refType: string): string {
    switch (refType) {
      case 'COMMUNICATION_LOG':
        return 'ไม่พบบันทึกการติดต่อ';
      case 'DELIVERY':
        return 'ไม่พบใบส่งมอบ';
      case 'TICKET':
        return 'ไม่พบรายการปัญหานี้';
      case 'TICKET_RESOLUTION':
        return 'ไม่พบรอบการแก้ไข';
      case 'MA_CONTRACT':
        return 'ไม่พบสัญญาบำรุงรักษา';
      default:
        return 'ไม่พบข้อมูลต้นทางของไฟล์แนบ';
    }
  }

  private async findUploaders(
    rows: Attachment[],
  ): Promise<Map<number, AttachmentUploaderDto>> {
    const ids = [
      ...new Set(
        rows
          .map((row) => row.uploadedByUserId ?? row.createdBy)
          .filter((id): id is number => id != null),
      ),
    ];

    if (ids.length === 0) {
      return new Map();
    }

    const users = await this.userModel.findAll({
      where: { id: ids },
      attributes: ['id', 'fullName'],
      paranoid: false,
    });

    return new Map(users.map((user) => [user.id, { id: user.id, fullName: user.fullName }]));
  }
}
