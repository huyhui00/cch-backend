import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, type WhereOptions } from 'sequelize';

import { getCurrentUserId } from '../../common/context/request-context';
import { type PaginatedResult, toPaginatedResult } from '../../common/dto/pagination.dto';
import { todayAsDateOnly } from '../../common/utils/date.util';
import { Customer, FollowUp, FollowUpStatus, User, UserStatus } from '../../models';
import {
  CompleteFollowUpDto,
  CreateFollowUpDto,
  QueryFollowUpsDto,
  UpdateFollowUpDto,
} from './dto/follow-up.dto';
import {
  OPEN_FOLLOW_UP_STATUSES,
  type FollowUpResponseDto,
  toFollowUpResponse,
} from './dto/follow-up.response';

const SORTABLE_FIELDS = new Set(['id', 'dueDate', 'status', 'createdAt', 'updatedAt']);

/** สร้างใหม่ทุกครั้ง — Sequelize แก้ object ของ include ในที่ตอน normalize ห้ามใช้ร่วมกัน */
function customerInclude() {
  return {
    model: Customer,
    attributes: ['id', 'name', 'code'],
    required: false,
    paranoid: false,
  };
}

function assignedUserInclude() {
  return {
    model: User,
    attributes: ['id', 'username', 'fullName'],
    required: false,
    // ยังต้องเห็นชื่อคนที่เคยรับผิดชอบแม้ลาออกไปแล้ว (BR-09)
    paranoid: false,
  };
}

/**
 * M7 — งานติดตามลูกค้า
 *
 * ตอบ pain point ที่ผู้บริหารบ่นหนักที่สุด — "ลืมติดตามลูกค้า เลยไปเป็นเดือนสองเดือน"
 *
 * **ไม่มีฟิลด์ `channel`** เพราะช่องทางการติดต่อเป็นของ `communication_logs` (BR-02)
 * งานติดตามคือ "เตือนว่าต้องตามลูกค้ารายนี้" ตอนสร้างยังไม่รู้ด้วยซ้ำว่าจะติดต่อทางไหน
 *
 * **ปิดงานติดตามไม่ไปแตะ `customers.last_contacted_at`** โดยเจตนา — ค่านั้นมีเจ้าของ
 * อยู่แล้วคือการบันทึกการติดต่อ ซึ่งมีหลักฐานครบ (ช่องทาง เนื้อหา ผู้ติดต่อ) ถ้าให้ที่นี่
 * เขียนด้วย จะมีสองทางเขียนค่าเดียวกันโดยทางหนึ่งไม่มีหลักฐานอะไรเลย แล้วหน้าจอ
 * "ลูกค้าที่ถูกลืม" จะเงียบไปทั้งที่ยังไม่มีใครคุยกับลูกค้าจริง
 * — หน้าจอควรชวนผู้ใช้บันทึกการติดต่อต่อทันทีหลังปิดงานติดตามแทน
 */
@Injectable()
export class FollowUpsService {
  constructor(
    @InjectModel(FollowUp) private readonly followUpModel: typeof FollowUp,
    @InjectModel(Customer) private readonly customerModel: typeof Customer,
    @InjectModel(User) private readonly userModel: typeof User,
  ) {}

  async findAll(query: QueryFollowUpsDto): Promise<PaginatedResult<FollowUpResponseDto>> {
    const where: WhereOptions = {};

    if (query.customerId !== undefined) {
      Object.assign(where, { customerId: query.customerId });
    }

    if (query.assignedUserId !== undefined) {
      Object.assign(where, { assignedUserId: query.assignedUserId });
    }

    if (query.status !== undefined) {
      Object.assign(where, { status: query.status });
    }

    if (query.search) {
      Object.assign(where, { title: { [Op.like]: `%${query.search}%` } });
    }

    // ช่วงวันที่ครบกำหนด — รวมทั้งสองขอบ
    const dueBounds: Record<symbol, string> = {};

    if (query.dueFrom !== undefined) {
      dueBounds[Op.gte] = query.dueFrom;
    }

    if (query.dueTo !== undefined) {
      dueBounds[Op.lte] = query.dueTo;
    }

    if (query.overdue !== undefined) {
      const today = todayAsDateOnly();

      if (query.overdue) {
        // ต้องตรงกับ isFollowUpOverdue() ใน follow-up.response.ts เป๊ะ ๆ
        // ไม่งั้นรายการที่กรองมากับธงบนแต่ละแถวจะขัดกันเอง
        Object.assign(where, { status: { [Op.in]: OPEN_FOLLOW_UP_STATUSES } });
        dueBounds[Op.lt] = today;
      } else {
        dueBounds[Op.gte] = today;
      }
    }

    if (Object.getOwnPropertySymbols(dueBounds).length > 0) {
      Object.assign(where, { dueDate: dueBounds });
    }

    const sortBy = query.sortBy && SORTABLE_FIELDS.has(query.sortBy) ? query.sortBy : 'dueDate';

    const { rows, count } = await this.followUpModel.findAndCountAll({
      where,
      include: [customerInclude(), assignedUserInclude()],
      // ค่าเริ่มต้นเรียงวันครบกำหนดจากเก่าไปใหม่ — ของที่ค้างนานสุดต้องอยู่บนสุด
      order: [
        [sortBy, query.sortBy ? query.sortOrder : 'ASC'],
        ['id', 'ASC'],
      ],
      limit: query.limit,
      offset: query.offset,
      distinct: true,
    });

    return toPaginatedResult(rows.map(toFollowUpResponse), count, query);
  }

  async findOne(id: number): Promise<FollowUpResponseDto> {
    return toFollowUpResponse(await this.findOrFail(id));
  }

  async create(dto: CreateFollowUpDto): Promise<FollowUpResponseDto> {
    const actorId = getCurrentUserId();

    await this.assertCustomerExists(dto.customerId);

    if (dto.assignedUserId) {
      await this.assertUserIsAssignable(dto.assignedUserId);
    }

    const followUp = await this.followUpModel.create({
      customerId: dto.customerId,
      title: dto.title,
      detail: dto.detail ?? null,
      dueDate: dto.dueDate,
      // เริ่มที่ PLANNED เสมอ แม้ลงวันย้อนหลัง — OVERDUE เป็นค่าที่คำนวณ ไม่ใช่ค่าที่ตั้ง
      status: FollowUpStatus.PLANNED,
      assignedUserId: dto.assignedUserId ?? null,
      createdBy: actorId,
      updatedBy: actorId,
    });

    return this.findOne(followUp.id);
  }

  /**
   * แก้ไขงานติดตาม
   *
   * สถานะเปลี่ยนไปไหนก็ได้ไม่บังคับลำดับ (เหตุผลเดียวกับสถานะงานใน Phase 5) —
   * เป็น DONE แล้วระบบใส่ `completedAt` ให้ ถอยออกแล้วล้าง และเป็น DONE ซ้ำไม่ทับเวลาเดิม
   */
  async update(id: number, dto: UpdateFollowUpDto): Promise<FollowUpResponseDto> {
    const actorId = getCurrentUserId();
    const followUp = await this.findOrFail(id);

    if (dto.status === FollowUpStatus.OVERDUE) {
      throw new BadRequestException(
        'สถานะ OVERDUE ตั้งเองไม่ได้ — ระบบคิดจากวันที่ครบกำหนดให้เอง ดูที่ isOverdue',
      );
    }

    if (dto.assignedUserId) {
      await this.assertUserIsAssignable(dto.assignedUserId);
    }

    await followUp.update({
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.detail !== undefined ? { detail: dto.detail } : {}),
      ...(dto.dueDate !== undefined ? { dueDate: dto.dueDate } : {}),
      ...(dto.assignedUserId !== undefined ? { assignedUserId: dto.assignedUserId } : {}),
      ...(dto.resultNote !== undefined ? { resultNote: dto.resultNote } : {}),
      ...(dto.status !== undefined
        ? { status: dto.status, ...this.completedAtFor(followUp, dto.status) }
        : {}),
      updatedBy: actorId,
    });

    return this.findOne(id);
  }

  /**
   * ปิดงานติดตาม — ทางลัดของ `PATCH /:id` ที่ส่ง `status: DONE`
   *
   * แยก endpoint เพราะผูกกับสิทธิ์ `followup.complete` คนละตัวกับ `followup.update`
   * ทีมที่อยากให้พนักงานปิดงานของตัวเองได้แต่ไม่ให้แก้เนื้อหางาน จึงกั้นได้จริง
   */
  async complete(id: number, dto: CompleteFollowUpDto): Promise<FollowUpResponseDto> {
    const actorId = getCurrentUserId();
    const followUp = await this.findOrFail(id);

    if (followUp.status === FollowUpStatus.CANCELLED) {
      throw new BadRequestException('งานติดตามที่ยกเลิกแล้วปิดงานไม่ได้');
    }

    await followUp.update({
      status: FollowUpStatus.DONE,
      ...this.completedAtFor(followUp, FollowUpStatus.DONE),
      ...(dto.resultNote !== undefined ? { resultNote: dto.resultNote } : {}),
      updatedBy: actorId,
    });

    return this.findOne(id);
  }

  /**
   * ลบงานติดตาม (soft delete)
   *
   * มีไว้สำหรับงานที่สร้างผิดจริง ๆ — งานที่ตัดสินใจว่าไม่ทำแล้วให้เปลี่ยนสถานะเป็น
   * CANCELLED แทน เพราะยังเป็นข้อมูลที่บอกได้ว่าเคยตั้งใจจะตามลูกค้ารายนี้
   */
  async remove(id: number): Promise<void> {
    const actorId = getCurrentUserId();
    const followUp = await this.findOrFail(id);

    // เขียน deleted_by ก่อน destroy เพราะ paranoid destroy แตะแค่ deleted_at (BR-09)
    await followUp.update({ deletedBy: actorId });
    await followUp.destroy();
  }

  // ---- helpers -------------------------------------------------------------

  /**
   * ค่า `completed_at` ที่ควรเป็นหลังเปลี่ยนสถานะ
   *
   * เป็น DONE ครั้งแรก = ใส่เวลาให้ / เป็น DONE อยู่แล้ว = ไม่ทับของเดิม
   * ถอยออกจาก DONE = ล้างทิ้ง เพราะงานที่ยังไม่จบไม่ควรมีเวลาที่จบ
   * กติกาเดียวกับ `tasks.completed_at` (Phase 5) และ `deliveries.accepted_at` (Phase 6)
   */
  private completedAtFor(
    followUp: FollowUp,
    nextStatus: FollowUpStatus,
  ): { completedAt?: Date | null } {
    if (nextStatus === FollowUpStatus.DONE) {
      return followUp.completedAt === null ? { completedAt: new Date() } : {};
    }

    return followUp.completedAt === null ? {} : { completedAt: null };
  }

  private async findOrFail(id: number): Promise<FollowUp> {
    const followUp = await this.followUpModel.findByPk(id, {
      include: [customerInclude(), assignedUserInclude()],
    });

    if (!followUp) {
      throw new NotFoundException('ไม่พบงานติดตามนี้');
    }

    return followUp;
  }

  private async assertCustomerExists(customerId: number): Promise<void> {
    const customer = await this.customerModel.findByPk(customerId, { attributes: ['id'] });

    if (!customer) {
      throw new NotFoundException('ไม่พบข้อมูลลูกค้า');
    }
  }

  /** มอบหมายให้พนักงานที่ลาออกหรือถูกระงับไม่ได้ — กติกาเดียวกับการมอบหมายงานใน Phase 5 */
  private async assertUserIsAssignable(userId: number): Promise<void> {
    const user = await this.userModel.findByPk(userId, { attributes: ['id', 'status'] });

    if (!user) {
      throw new BadRequestException('ไม่พบพนักงานที่ระบุเป็นผู้รับผิดชอบ');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new BadRequestException('พนักงานที่ระบุไม่ได้อยู่ในสถานะใช้งาน จึงมอบหมายงานให้ไม่ได้');
    }
  }
}
