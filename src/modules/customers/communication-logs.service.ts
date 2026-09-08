import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, type WhereOptions } from 'sequelize';

import { type PaginatedResult, toPaginatedResult } from '../../common/dto/pagination.dto';
import { CommunicationLog, Contact, User } from '../../models';
import { CustomersService } from './customers.service';
import {
  CreateCommunicationLogDto,
  QueryCommunicationLogsDto,
  UpdateCommunicationLogDto,
} from './dto/communication-log.dto';
import {
  type CommunicationLogResponseDto,
  toCommunicationLogResponse,
} from './dto/customer.response';

const SORTABLE_FIELDS = new Set(['id', 'occurredAt', 'channel', 'createdAt', 'updatedAt']);

const DETAIL_INCLUDE = [
  {
    model: User,
    as: 'handledBy',
    attributes: ['id', 'username', 'fullName'],
    required: false,
    // ยังต้องเห็นชื่อคนที่คุยแม้พนักงานคนนั้นลาออกไปแล้ว (BR-09)
    paranoid: false,
  },
  {
    model: Contact,
    attributes: ['id', 'name'],
    required: false,
    paranoid: false,
  },
];

/**
 * BR-02 — การสื่อสารเกิดนอกระบบ (LINE/โทร) แล้วมาบันทึกย้อนหลัง
 * ระบบนี้ไม่ได้ส่งข้อความหาลูกค้า ทำหน้าที่แค่บันทึกว่าเคยคุยอะไรกันไว้
 */
@Injectable()
export class CommunicationLogsService {
  constructor(
    @InjectModel(CommunicationLog) private readonly logModel: typeof CommunicationLog,
    @InjectModel(Contact) private readonly contactModel: typeof Contact,
    @InjectModel(User) private readonly userModel: typeof User,
    private readonly customersService: CustomersService,
  ) {}

  async findAll(
    query: QueryCommunicationLogsDto,
  ): Promise<PaginatedResult<CommunicationLogResponseDto>> {
    const where: WhereOptions<CommunicationLog> = {};

    if (query.customerId !== undefined) {
      Object.assign(where, { customerId: query.customerId });
    }

    if (query.contactId !== undefined) {
      Object.assign(where, { contactId: query.contactId });
    }

    if (query.channel) {
      Object.assign(where, { channel: query.channel });
    }

    if (query.handledByUserId !== undefined) {
      Object.assign(where, { handledByUserId: query.handledByUserId });
    }

    const occurredAt = this.buildDateRange(query);

    if (occurredAt) {
      Object.assign(where, { occurredAt });
    }

    if (query.search) {
      const like = '%' + query.search + '%';
      Object.assign(where, {
        [Op.or]: [{ subject: { [Op.like]: like } }, { content: { [Op.like]: like } }],
      });
    }

    const sortBy = SORTABLE_FIELDS.has(query.sortBy ?? '')
      ? (query.sortBy as string)
      : 'occurredAt';

    const { rows, count } = await this.logModel.findAndCountAll({
      where,
      include: DETAIL_INCLUDE,
      distinct: true,
      order: [[sortBy, query.sortOrder]],
      limit: query.limit,
      offset: query.offset,
    });

    return toPaginatedResult(rows.map(toCommunicationLogResponse), count, query);
  }

  async create(
    dto: CreateCommunicationLogDto,
    actorId: number,
  ): Promise<CommunicationLogResponseDto> {
    await this.customersService.findOrFail(dto.customerId);

    if (dto.contactId) {
      await this.assertContactBelongsToCustomer(dto.contactId, dto.customerId);
    }

    if (dto.handledByUserId) {
      await this.assertUserExists(dto.handledByUserId);
    }

    const occurredAt = new Date(dto.occurredAt);
    this.assertNotInFuture(occurredAt);

    const log = await this.logModel.create({
      customerId: dto.customerId,
      contactId: dto.contactId ?? null,
      channel: dto.channel,
      occurredAt,
      subject: dto.subject ?? null,
      content: dto.content ?? null,
      // ถ้าไม่ระบุว่าใครเป็นคนคุย ถือว่าคนที่บันทึกเป็นคนคุยเอง
      handledByUserId: dto.handledByUserId ?? actorId,
      createdBy: actorId,
      updatedBy: actorId,
    });

    // อัปเดตวันที่ติดต่อล่าสุดของลูกค้า — เป็นตัวป้อนให้หน้าจอ "ลูกค้าที่ถูกลืม"
    // และ notification rule แบบ CUSTOMER_IDLE ใน Phase 11
    await this.customersService.touchLastContactedAt(dto.customerId, occurredAt);

    return this.findOne(log.id);
  }

  async findOne(id: number): Promise<CommunicationLogResponseDto> {
    const log = await this.logModel.findByPk(id, { include: DETAIL_INCLUDE });

    if (!log) {
      throw new NotFoundException('ไม่พบบันทึกการติดต่อ');
    }

    return toCommunicationLogResponse(log);
  }

  async update(
    id: number,
    dto: UpdateCommunicationLogDto,
    actorId: number,
  ): Promise<CommunicationLogResponseDto> {
    const log = await this.findOrFail(id);

    if (dto.contactId) {
      await this.assertContactBelongsToCustomer(dto.contactId, log.customerId);
    }

    if (dto.handledByUserId) {
      await this.assertUserExists(dto.handledByUserId);
    }

    let occurredAt: Date | undefined;

    if (dto.occurredAt !== undefined) {
      occurredAt = new Date(dto.occurredAt);
      this.assertNotInFuture(occurredAt);
    }

    await log.update({
      ...(dto.contactId !== undefined ? { contactId: dto.contactId ?? null } : {}),
      ...(dto.channel !== undefined ? { channel: dto.channel } : {}),
      ...(occurredAt !== undefined ? { occurredAt } : {}),
      ...(dto.subject !== undefined ? { subject: dto.subject ?? null } : {}),
      ...(dto.content !== undefined ? { content: dto.content ?? null } : {}),
      ...(dto.handledByUserId !== undefined
        ? { handledByUserId: dto.handledByUserId ?? null }
        : {}),
      updatedBy: actorId,
    });

    if (occurredAt) {
      await this.customersService.touchLastContactedAt(log.customerId, occurredAt);
    }

    return this.findOne(id);
  }

  async remove(id: number, actorId: number): Promise<void> {
    const log = await this.findOrFail(id);

    await log.update({ deletedBy: actorId });
    await log.destroy();

    // ไม่ย้อน lastContactedAt กลับให้โดยอัตโนมัติ เพราะการคำนวณใหม่ต้องไล่หา
    // บันทึกที่ใหม่รองลงมา ซึ่งอาจถูกลบไปด้วยเช่นกัน ปล่อยให้ค่าคงเดิมปลอดภัยกว่า
    // ในแง่ธุรกิจ — ผิดพลาดไปทางเตือนช้า ดีกว่าเตือนพร่ำเพรื่อจนคนเลิกสนใจ
  }

  // ---- helpers -------------------------------------------------------------

  private async findOrFail(id: number): Promise<CommunicationLog> {
    const log = await this.logModel.findByPk(id);

    if (!log) {
      throw new NotFoundException('ไม่พบบันทึกการติดต่อ');
    }

    return log;
  }

  /** กันบันทึกที่ระบุผู้ติดต่อของลูกค้าคนอื่น ซึ่งทำให้ประวัติปนกันข้ามราย */
  private async assertContactBelongsToCustomer(
    contactId: number,
    customerId: number,
  ): Promise<void> {
    const contact = await this.contactModel.findByPk(contactId, {
      attributes: ['id', 'customerId'],
    });

    if (!contact) {
      throw new BadRequestException('ไม่พบผู้ติดต่อที่ระบุ');
    }

    if (contact.customerId !== customerId) {
      throw new BadRequestException('ผู้ติดต่อที่ระบุไม่ได้อยู่ภายใต้ลูกค้ารายนี้');
    }
  }

  private async assertUserExists(userId: number): Promise<void> {
    const user = await this.userModel.findByPk(userId, { attributes: ['id'] });

    if (!user) {
      throw new BadRequestException('ไม่พบพนักงานที่ระบุว่าเป็นผู้ติดต่อ');
    }
  }

  /**
   * บันทึกย้อนหลังได้ตาม BR-02 แต่บันทึกล่วงหน้าไม่ได้
   * เผื่อความคลาดเคลื่อนของนาฬิกาเครื่อง client ไว้ 5 นาที
   */
  private assertNotInFuture(occurredAt: Date): void {
    const CLOCK_SKEW_MS = 5 * 60 * 1000;

    if (occurredAt.getTime() > Date.now() + CLOCK_SKEW_MS) {
      throw new BadRequestException('เวลาที่ติดต่อต้องไม่เป็นเวลาในอนาคต');
    }
  }

  private buildDateRange(query: QueryCommunicationLogsDto): Record<symbol, Date> | null {
    const range: Record<symbol, Date> = {};

    if (query.dateFrom) {
      range[Op.gte] = new Date(query.dateFrom);
    }

    if (query.dateTo) {
      // วันที่เปล่า ๆ ให้หมายถึงสิ้นวันนั้น ไม่งั้นการค้น "ถึงวันที่ 30" จะไม่เห็นรายการในวันนั้น
      range[Op.lte] = /^\d{4}-\d{2}-\d{2}$/.test(query.dateTo)
        ? new Date(query.dateTo + 'T23:59:59.999')
        : new Date(query.dateTo);
    }

    const from = range[Op.gte];
    const to = range[Op.lte];

    if (from && to && from > to) {
      throw new BadRequestException('dateFrom ต้องไม่มากกว่า dateTo');
    }

    return from || to ? range : null;
  }
}
