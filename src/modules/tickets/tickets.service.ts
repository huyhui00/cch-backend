import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Op, type Transaction, type WhereOptions } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

import { getCurrentUserId } from '../../common/context/request-context';
import { type PaginatedResult, toPaginatedResult } from '../../common/dto/pagination.dto';
import {
  Contact,
  Customer,
  Project,
  Ticket,
  TicketBillingType,
  TicketResolution,
  TicketStatus,
  User,
  UserStatus,
} from '../../models';
import { MaQuotaService } from '../ma/ma-quota.service';
import { WarrantiesService } from '../warranties/warranties.service';
import { CreateResolutionDto } from './dto/resolution.dto';
import {
  AssignTicketDto,
  CloseTicketDto,
  CreateTicketDto,
  QueryPendingTicketsDto,
  UpdateTicketDto,
  QueryTicketsDto,
  ReopenTicketDto,
} from './dto/ticket.dto';
import {
  type BillingSuggestionDto,
  PENDING_TICKET_STATUSES,
  type ResolutionCreatedDto,
  type TicketResponseDto,
  toTicketResponse,
} from './dto/ticket.response';

/**
 * สถานะที่การมอบหมายจะพาไป IN_PROGRESS ให้เอง — ใบที่ยังไม่มีใครลงมือ
 * RECEIVED = เพิ่งรับเรื่อง, REOPENED = ปัญหาเดิมกลับมาและยังไม่มีใครหยิบรอบใหม่ (BR-04)
 */
export const CLOSED_TICKET_RESOLUTION_MESSAGE =
  'ปัญหานี้ปิดงานแล้ว ถ้าอาการเดิมกลับมาให้กด "ปัญหาเดิมกลับมา" เพื่อเปิดใบนี้ก่อน ' +
  'แล้วจึงบันทึกการแก้ไขรอบถัดไป';

const STARTABLE_TICKET_STATUSES: readonly TicketStatus[] = [
  TicketStatus.RECEIVED,
  TicketStatus.REOPENED,
];

const SORTABLE_FIELDS = new Set([
  'id',
  'ticketNo',
  'status',
  'priority',
  'reportedAt',
  'dueAt',
  'resolvedAt',
  'createdAt',
]);

/** สร้างใหม่ทุกครั้ง — Sequelize แก้ object ของ include ในที่ตอน normalize ห้ามใช้ร่วมกัน */
function customerInclude() {
  return { model: Customer, attributes: ['id', 'name'], required: false, paranoid: false };
}

function projectInclude() {
  return { model: Project, attributes: ['id', 'name'], required: false, paranoid: false };
}

function reportedByContactInclude() {
  return {
    model: Contact,
    as: 'reportedByContact',
    attributes: ['id', 'name'],
    required: false,
    paranoid: false,
  };
}

function assignedUserInclude() {
  return {
    model: User,
    as: 'assignedUser',
    attributes: ['id', 'username', 'fullName'],
    required: false,
    // พนักงานที่ลาออกไปแล้วยังต้องเห็นชื่อในประวัติ (BR-09)
    paranoid: false,
  };
}

function receivedByUserInclude() {
  return {
    model: User,
    as: 'receivedByUser',
    attributes: ['id', 'username', 'fullName'],
    required: false,
    paranoid: false,
  };
}

function listIncludes() {
  return [
    customerInclude(),
    projectInclude(),
    assignedUserInclude(),
    receivedByUserInclude(),
    reportedByContactInclude(),
  ];
}

/**
 * Phase 7 — ใบแจ้งปัญหาและรอบการแก้ไข (โมดูล M5)
 *
 * ---------------------------------------------------------------------------
 * กฎที่ต้องไม่พัง
 * ---------------------------------------------------------------------------
 * BR-03  1 ปัญหา แก้ได้หลายรอบ — `tickets` 1:N `ticket_resolutions`
 * BR-04  ปัญหาเดิมกลับมา = เพิ่มรอบในใบเดิม **ห้ามเปิดใบใหม่**
 *        โมดูลนี้จึงไม่มี endpoint ที่ "เปิด ticket ใหม่จากใบเดิม" เลย
 *        มีแต่ `reopen` ที่พาใบเดิมกลับเข้าสถานะ REOPENED
 * BR-07  ประกันครอบคลุมเฉพาะ bug ในขอบเขตเดิม ระบบจึงได้แค่ *เสนอ* billing_type
 *        การตัดสินเป็นของคน ผู้ใช้ส่งค่ามาเองได้เสมอและระบบไม่เถียง
 * BR-08  บั๊กเล็กทำฟรีได้แต่ต้องบันทึก — billing_type จึงบังคับให้เลือก FREE
 *        ไม่ใช่ปล่อยว่าง คอลัมน์เป็น NOT NULL อยู่แล้วที่ระดับฐานข้อมูล
 */
@Injectable()
export class TicketsService {
  constructor(
    @InjectModel(Ticket) private readonly ticketModel: typeof Ticket,
    @InjectModel(TicketResolution) private readonly resolutionModel: typeof TicketResolution,
    @InjectModel(Customer) private readonly customerModel: typeof Customer,
    @InjectModel(Project) private readonly projectModel: typeof Project,
    @InjectModel(Contact) private readonly contactModel: typeof Contact,
    @InjectModel(User) private readonly userModel: typeof User,
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly warrantiesService: WarrantiesService,
    private readonly maQuotaService: MaQuotaService,
  ) {}

  async findAll(query: QueryTicketsDto): Promise<PaginatedResult<TicketResponseDto>> {
    const where: WhereOptions<Ticket> = {};

    if (query.status) {
      Object.assign(where, { status: query.status });
    }

    if (query.customerId !== undefined) {
      Object.assign(where, { customerId: query.customerId });
    }

    if (query.projectId !== undefined) {
      Object.assign(where, { projectId: query.projectId });
    }

    if (query.priority) {
      Object.assign(where, { priority: query.priority });
    }

    if (query.assigneeId !== undefined) {
      Object.assign(where, { assignedUserId: query.assigneeId });
    }

    if (query.billingType) {
      Object.assign(where, { billingType: query.billingType });
    }

    if (query.search) {
      Object.assign(
        where,
        await this.searchCondition(query.search, ['title', 'description', 'ticketNo']),
      );
    }

    const sortBy = SORTABLE_FIELDS.has(query.sortBy ?? '')
      ? (query.sortBy as string)
      : 'reportedAt';

    const { rows, count } = await this.ticketModel.findAndCountAll({
      where,
      include: listIncludes(),
      distinct: true,
      order: [
        [sortBy, query.sortOrder],
        ['id', query.sortOrder],
      ],
      limit: query.limit,
      offset: query.offset,
    });

    return toPaginatedResult(
      rows.map((ticket) => toTicketResponse(ticket)),
      count,
      query,
    );
  }

  /**
   * หน้าจอ "รอรับการแก้ไข" (CLAUDE.md 9.1)
   *
   * ชุดสถานะถูกกำหนดตายตัวที่ PENDING_TICKET_STATUSES ไม่เปิดให้กรองด้วย status
   * เพราะถ้าเปิด หน้าจอจะเรียกด้วยสถานะ CLOSED ได้ ซึ่งขัดกับความหมายของหน้าจอนี้
   *
   * เรียงงานด่วนขึ้นก่อน แล้วค้างนานสุดขึ้นก่อนในระดับความสำคัญเดียวกัน
   */
  async findPending(query: QueryPendingTicketsDto): Promise<PaginatedResult<TicketResponseDto>> {
    const where: WhereOptions<Ticket> = {
      status: { [Op.in]: PENDING_TICKET_STATUSES },
    };

    if (query.customerId !== undefined) {
      Object.assign(where, { customerId: query.customerId });
    }

    if (query.assigneeId !== undefined) {
      Object.assign(where, { assignedUserId: query.assigneeId });
    }

    if (query.priority) {
      Object.assign(where, { priority: query.priority });
    }

    if (query.search) {
      Object.assign(where, await this.searchCondition(query.search, ['title', 'ticketNo']));
    }

    const { rows, count } = await this.ticketModel.findAndCountAll({
      where,
      include: listIncludes(),
      distinct: true,
      order: [
        ['priority', 'DESC'],
        ['reportedAt', 'ASC'],
        ['id', 'ASC'],
      ],
      limit: query.limit,
      offset: query.offset,
    });

    return toPaginatedResult(
      rows.map((ticket) => toTicketResponse(ticket)),
      count,
      query,
    );
  }

  /** รายละเอียดปัญหา พร้อมทุกรอบที่ลงมือแก้ เรียงตาม round (BR-03) */
  async findOne(id: number): Promise<TicketResponseDto> {
    const ticket = await this.ticketModel.findByPk(id, { include: listIncludes() });

    if (!ticket) {
      throw new NotFoundException('ไม่พบรายการปัญหานี้');
    }

    return toTicketResponse(ticket, await this.findResolutions(id));
  }

  /**
   * เปิดใบแจ้งปัญหา — พนักงานเป็นคนเปิดเสมอ (BR-01 ลูกค้าไม่มีบัญชีผู้ใช้)
   *
   * ถ้าไม่ส่ง `billingType` มา ระบบเลือกให้จากประกันและสัญญา MA ที่ยังคุ้มครองอยู่
   * ถ้าส่งมา ระบบใช้ค่าที่ส่งเสมอ — เพราะประกันครอบคลุมเฉพาะ bug ในขอบเขตเดิม
   * งานที่ลูกค้าขอเพิ่มใหม่ต้องคิดเงินแม้จะอยู่ในระยะประกัน ซึ่งระบบตัดสินแทนคนไม่ได้ (BR-07)
   */
  async create(dto: CreateTicketDto): Promise<TicketResponseDto> {
    const actorId = getCurrentUserId();

    await this.assertCustomerExists(dto.customerId);

    if (dto.projectId) {
      await this.assertProjectBelongsToCustomer(dto.projectId, dto.customerId);
    }

    if (dto.reportedByContactId) {
      await this.assertContactBelongsToCustomer(dto.reportedByContactId, dto.customerId);
    }

    for (const userId of [dto.assignedUserId, dto.receivedByUserId]) {
      if (userId) {
        await this.assertUserExists(userId);
      }
    }

    if (dto.ticketNo) {
      await this.assertTicketNoIsAvailable(dto.ticketNo);
    }

    const reportedAt = new Date(dto.reportedAt);
    this.assertNotInFuture(reportedAt, 'เวลาที่ลูกค้าแจ้งต้องไม่เป็นเวลาในอนาคต');

    const suggestion = await this.suggestBilling(dto.projectId ?? null, reportedAt);

    const ticket = await this.ticketModel.create({
      customerId: dto.customerId,
      projectId: dto.projectId ?? null,
      ticketNo: dto.ticketNo ?? null,
      title: dto.title,
      description: dto.description ?? null,
      status: TicketStatus.RECEIVED,
      priority: dto.priority,
      // ผู้ใช้ชนะเสมอ ระบบเติมให้เฉพาะตอนที่ไม่ได้เลือกมา
      // ไม่เจอทั้งประกันและ MA แล้วผู้ใช้ก็ไม่เลือก = ONE_TIME (งานที่ต้องคิดเงิน)
      billingType: dto.billingType ?? suggestion.suggested ?? TicketBillingType.ONE_TIME,
      // ผูกหลักฐานที่ระบบใช้เสนอไว้ด้วย จะได้ตรวจย้อนหลังได้ว่าตอนนั้นเห็นอะไร
      warrantyId: suggestion.warrantyId,
      maContractId: suggestion.maContractId,
      reportedChannel: dto.reportedChannel,
      reportedAt,
      reportedByContactId: dto.reportedByContactId ?? null,
      assignedUserId: dto.assignedUserId ?? null,
      // ไม่ระบุผู้รับเรื่อง = คนที่กดบันทึกคือคนรับเรื่อง
      receivedByUserId: dto.receivedByUserId ?? actorId,
      dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
      resolutionCount: 0,
      createdBy: actorId,
      updatedBy: actorId,
    });

    return this.findOne(ticket.id);
  }

  /**
   * แก้ไขใบแจ้งปัญหา — สำหรับกรณีคีย์ผิดตอนเปิดใบ
   *
   * **ไม่ให้แก้ `status` ที่นี่** เพราะสถานะมีเจ้าของอยู่แล้วคือ assign / resolutions /
   * reopen / close ถ้าแก้ตรง ๆ ได้ จะข้ามกฎ BR-04 ทั้งหมด — ตั้งเป็น CLOSED
   * โดยไม่เคยมีรอบการแก้ไขเลยก็ได้ แล้วประวัติการให้บริการจะเชื่อไม่ได้อีกต่อไป
   * ด้วยเหตุผลเดียวกัน `resolutionCount` และเวลาต่าง ๆ ก็ไม่รับจาก client
   *
   * ใบที่ปิดงานแล้วยังแก้ได้ เพราะการพิมพ์หัวข้อผิดต้องแก้ได้เสมอ ไม่ว่าใบจะอยู่สถานะไหน
   * — ต่างจากการ *เพิ่มรอบการแก้ไข* ที่ต้อง reopen ก่อน
   */
  async update(id: number, dto: UpdateTicketDto): Promise<TicketResponseDto> {
    const actorId = getCurrentUserId();
    const ticket = await this.findOrFail(id);

    // ย้ายข้ามลูกค้าไม่ได้ — โครงการใหม่ต้องเป็นของลูกค้าเจ้าของใบเดิมเท่านั้น
    if (dto.projectId) {
      await this.assertProjectBelongsToCustomer(dto.projectId, ticket.customerId);
    }

    if (dto.reportedByContactId) {
      await this.assertContactBelongsToCustomer(dto.reportedByContactId, ticket.customerId);
    }

    if (dto.receivedByUserId) {
      await this.assertUserExists(dto.receivedByUserId);
    }

    if (dto.ticketNo && dto.ticketNo !== ticket.ticketNo) {
      await this.assertTicketNoIsAvailable(dto.ticketNo);
    }

    let reportedAt: Date | undefined;

    if (dto.reportedAt !== undefined) {
      reportedAt = new Date(dto.reportedAt);
      this.assertNotInFuture(reportedAt, 'เวลาที่ลูกค้าแจ้งต้องไม่เป็นเวลาในอนาคต');
    }

    await ticket.update({
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
      ...(dto.billingType !== undefined ? { billingType: dto.billingType } : {}),
      ...(dto.reportedChannel !== undefined ? { reportedChannel: dto.reportedChannel } : {}),
      ...(reportedAt !== undefined ? { reportedAt } : {}),
      ...(dto.projectId !== undefined ? { projectId: dto.projectId } : {}),
      ...(dto.reportedByContactId !== undefined
        ? { reportedByContactId: dto.reportedByContactId }
        : {}),
      ...(dto.receivedByUserId !== undefined ? { receivedByUserId: dto.receivedByUserId } : {}),
      ...(dto.dueAt !== undefined
        ? { dueAt: dto.dueAt === null ? null : new Date(dto.dueAt) }
        : {}),
      ...(dto.ticketNo !== undefined ? { ticketNo: dto.ticketNo } : {}),
      updatedBy: actorId,
    });

    return this.findOne(id);
  }

  /**
   * มอบหมายผู้รับผิดชอบแก้ไข — แยกจากผู้รับเรื่องที่บันทึกไว้ตอนเปิดใบ (A-3)
   *
   * ใบที่เป็น RECEIVED หรือ REOPENED จะถูกเลื่อนเป็น IN_PROGRESS ให้อัตโนมัติ เพราะการมอบหมาย
   * คือจุดที่งานเริ่มเดินจริงในทีมขนาดนี้ ส่วนใบที่อยู่สถานะอื่นแล้วไม่ถูกแตะสถานะ
   * — ถอนการมอบหมาย (ส่ง null) ก็ไม่ย้อนสถานะกลับ เพราะงานที่เริ่มไปแล้วยังเริ่มไปแล้ว
   *
   * REOPENED ต้องอยู่ในนี้ด้วย ไม่งั้นใบที่ปัญหาเดิมกลับมาจะไม่มีทางไป IN_PROGRESS เลย
   * ขัดกับ BR-04 (`RESOLVED → REOPENED → IN_PROGRESS`) หยิบงานรอบใหม่จึงทำด้วยการ
   * มอบหมายซ้ำ แม้จะเป็นคนเดิมก็ตาม
   */
  async assign(id: number, dto: AssignTicketDto): Promise<TicketResponseDto> {
    const actorId = getCurrentUserId();
    const ticket = await this.findOrFail(id);

    if (ticket.status === TicketStatus.CLOSED) {
      throw new BadRequestException('ปัญหานี้ปิดงานแล้ว ไม่สามารถมอบหมายผู้รับผิดชอบได้');
    }

    if (dto.assignedUserId) {
      await this.assertUserIsAssignable(dto.assignedUserId);
    }

    const shouldStart =
      dto.assignedUserId !== null && STARTABLE_TICKET_STATUSES.includes(ticket.status);

    await ticket.update({
      assignedUserId: dto.assignedUserId,
      ...(shouldStart ? { status: TicketStatus.IN_PROGRESS } : {}),
      ...(dto.dueAt !== undefined ? { dueAt: dto.dueAt ? new Date(dto.dueAt) : null } : {}),
      updatedBy: actorId,
    });

    return this.findOne(id);
  }

  /**
   * บันทึกผลการแก้หนึ่งรอบ — จุดที่ซับซ้อนที่สุดของทั้งระบบ (CLAUDE.md 9.1)
   *
   * ทุกอย่างอยู่ในทรานแซกชันเดียว ถ้าขั้นไหนล้ม ต้องไม่เหลือร่องรอยครึ่ง ๆ กลาง ๆ
   * เช่นมีรอบการแก้แต่ยอด resolution_count ไม่ขยับ หรือหักโควตาไปแล้วแต่ไม่มีรอบการแก้
   *
   * ใบถูกล็อกด้วย SELECT ... FOR UPDATE ตั้งแต่ต้น เพราะเลข round มาจากการนับ
   * ถ้าสองคนกดพร้อมกันโดยไม่ล็อก ทั้งคู่จะนับได้เลขเดียวกัน แล้วไปชน unique index
   * (ticket_id, round) จนคนหลังได้ error ภาษาอังกฤษจาก MySQL
   */
  async addResolution(id: number, dto: CreateResolutionDto): Promise<ResolutionCreatedDto> {
    const actorId = getCurrentUserId();

    const resolvedAt = new Date(dto.resolvedAt);
    this.assertNotInFuture(resolvedAt, 'เวลาที่แก้เสร็จต้องไม่เป็นเวลาในอนาคต');

    if (dto.startedAt && new Date(dto.startedAt) > resolvedAt) {
      throw new BadRequestException('เวลาที่เริ่มแก้ต้องไม่อยู่หลังเวลาที่แก้เสร็จ');
    }

    if (dto.resolvedByUserId) {
      await this.assertUserExists(dto.resolvedByUserId);
    }

    const outcome = await this.sequelize.transaction(async (transaction) => {
      const ticket = await this.ticketModel.findByPk(id, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      if (!ticket) {
        throw new NotFoundException('ไม่พบรายการปัญหานี้');
      }

      if (ticket.status === TicketStatus.CLOSED) {
        // ชี้ทางที่ถูกให้เลย — ปัญหาเดิมกลับมาต้องเปิดใบเดิมกลับมาก่อน ไม่ใช่เปิดใบใหม่ (BR-04)
        throw new BadRequestException(CLOSED_TICKET_RESOLUTION_MESSAGE);
      }

      const round =
        (await this.resolutionModel.count({ where: { ticketId: id }, transaction })) + 1;

      const resolution = await this.resolutionModel.create(
        {
          ticketId: id,
          round,
          result: dto.result,
          detail: dto.detail,
          rootCause: dto.rootCause ?? null,
          // ไม่ระบุคนแก้ = คนที่กดบันทึกคือคนแก้
          resolvedByUserId: dto.resolvedByUserId ?? actorId,
          startedAt: dto.startedAt ? new Date(dto.startedAt) : null,
          resolvedAt,
          hoursSpent: dto.hoursSpent ?? null,
          createdBy: actorId,
          updatedBy: actorId,
        },
        { transaction },
      );

      await ticket.update(
        {
          status: TicketStatus.RESOLVED,
          resolutionCount: round,
          resolvedAt,
          // เวลาตอบกลับครั้งแรกบันทึกครั้งเดียว ใช้วัด SLA ย้อนหลังได้ (Phase 11)
          ...(ticket.firstResponseAt === null ? { firstResponseAt: resolvedAt } : {}),
          ...(dto.extraCharge !== undefined ? { extraCharge: dto.extraCharge ?? null } : {}),
          updatedBy: actorId,
        },
        { transaction },
      );

      // หักโควตา MA — service จัดการเองว่าใบนี้เคยหักไปแล้วหรือยัง
      const { status } = await this.maQuotaService.recordUsageForTicket(ticket, {
        resolutionId: resolution.id,
        usedAt: resolvedAt,
        extraCharge: dto.extraCharge ?? null,
        transaction,
      });

      return {
        resolutionId: resolution.id,
        quota: status
          ? {
              contractId: status.contractId,
              periodYear: status.periodYear,
              periodMonth: status.periodMonth,
              // ช่วงวันจริงของรอบ — ต้องมีให้ตรงกับ GET /api/ma-contracts/:id/quota
              // ไม่งั้นหน้าจอ ticket บอกผู้ใช้ไม่ได้ว่าโควตารอบนี้หมดวันไหน
              periodStart: status.periodStart,
              periodEnd: status.periodEnd,
              quota: status.quota,
              // status.used คือยอดก่อนหักครั้งนี้ — บวกกลับให้เป็นยอดหลังหักที่คนอ่านคาดหวัง
              used: status.used + 1,
              remaining: status.quota - (status.used + 1),
              isOverQuota: status.willExceed,
            }
          : null,
      };
    });

    const ticket = await this.findOne(id);
    const resolution = ticket.resolutions.find((item) => item.id === outcome.resolutionId);

    if (!resolution) {
      throw new NotFoundException('ไม่พบรอบการแก้ไขที่เพิ่งบันทึก');
    }

    return { ticket, resolution, quota: outcome.quota };
  }

  /**
   * ปัญหาเดิมกลับมา — เพิ่มรอบในใบเดิม ห้ามเปิดใบใหม่ (BR-04)
   *
   * endpoint นี้พาใบเดิมกลับเข้าสถานะ REOPENED เพื่อให้เข้าหน้าจอ "รอรับการแก้ไข" อีกครั้ง
   * แล้วรอบถัดไปค่อยบันทึกผ่าน POST /resolutions ตามปกติ ซึ่งจะได้ round ต่อจากเดิม
   *
   * ไม่ล้าง `resolvedAt` และ `resolutionCount` ทิ้ง เพราะเป็นประวัติที่เกิดขึ้นจริง
   * ค่าจะถูกเขียนทับเองเมื่อมีการแก้รอบใหม่
   *
   * **ใบที่ปิดงานแล้วก็เปิดกลับมาได้** (ตัดสิน 11 ก.ย. — Q9) ปัญหาเดิมที่กลับมาหลังปิดงาน
   * ยังเป็นปัญหาเดิม ต้องเพิ่มรอบในใบเดิม ห้ามบอกให้เปิดใบใหม่ ไม่จำกัดว่าปิดมานานเท่าไร
   * เพราะคนเป็นผู้ตัดสินว่าเป็นปัญหาเดิมหรือไม่ — `closedAt` ถูกล้างเพราะใบไม่ได้ปิดแล้ว
   * ประวัติการปิดครั้งก่อนยังอยู่ใน audit log และหมายเหตุที่ต่อท้ายรายละเอียดไว้
   */
  async reopen(id: number, dto: ReopenTicketDto): Promise<TicketResponseDto> {
    const actorId = getCurrentUserId();
    const ticket = await this.findOrFail(id);

    if (ticket.status === TicketStatus.REOPENED) {
      throw new ConflictException('ปัญหานี้ถูกเปิดกลับมาอยู่แล้ว');
    }

    await ticket.update({
      status: TicketStatus.REOPENED,
      ...(ticket.status === TicketStatus.CLOSED ? { closedAt: null } : {}),
      description: this.appendNote(ticket.description, dto.reason, 'เปิดกลับมาอีกครั้ง'),
      updatedBy: actorId,
    });

    return this.findOne(id);
  }

  /**
   * ปิดงาน
   *
   * ปิดได้จากทุกสถานะที่ยังไม่ปิด ไม่บังคับว่าต้อง RESOLVED ก่อน เพราะมีเคสจริงที่
   * ตรวจแล้วไม่ใช่ปัญหาของเรา หรือลูกค้าถอนเรื่องไปเอง ซึ่งไม่มีรอบการแก้ให้บันทึก
   * แต่ก็ยังต้องปิดใบให้เรียบร้อยและมีร่องรอยว่าใครปิด (BR-09)
   */
  async close(id: number, dto: CloseTicketDto): Promise<TicketResponseDto> {
    const actorId = getCurrentUserId();
    const ticket = await this.findOrFail(id);

    if (ticket.status === TicketStatus.CLOSED) {
      throw new ConflictException('ปัญหานี้ปิดงานแล้ว');
    }

    await ticket.update({
      status: TicketStatus.CLOSED,
      closedAt: new Date(),
      description: this.appendNote(ticket.description, dto.note, 'ปิดงาน'),
      ...(dto.extraCharge !== undefined ? { extraCharge: dto.extraCharge ?? null } : {}),
      updatedBy: actorId,
    });

    return this.findOne(id);
  }

  // ---- helpers -------------------------------------------------------------

  /**
   * เงื่อนไขค้นหาใบแจ้งปัญหา — ค้นจากฟิลด์ของใบ **และ** ชื่อ/รหัสของลูกค้าและโครงการ
   *
   * ประชุม 11 ก.ย. (B-10): ลูกค้าโทรมาบอกว่า "ปัญหาเดิมกลับมา" เขาจำได้แค่ว่าเป็นบริษัทไหน
   * โครงการอะไร จำวิธีแก้หรือเลขใบไม่ได้ ถ้าค้นได้แค่หัวข้อ พอข้อมูลเป็นร้อยใบพนักงานจะหาไม่เจอ
   * แล้วเปิดใบใหม่แทน ซึ่งขัด BR-04 ตรง ๆ
   *
   * หา id ของลูกค้า/โครงการที่ตรงก่อน แล้วค่อยกรองด้วย IN แทนการค้นผ่าน `$customer.name$`
   * เพราะ findAndCountAll ที่มี limit + include อาจถูก Sequelize ห่อเป็น subquery
   * แล้วคอลัมน์ของตารางที่ join มาหายจาก scope ของ WHERE — แบบนี้ SQL ตรงไปตรงมาเสมอ
   * ลูกค้า/โครงการที่ถูก soft delete ยังค้นเจอ เพราะใบแจ้งปัญหาเก่ายังชี้ไปหาอยู่
   */
  private async searchCondition(
    search: string,
    ticketFields: readonly ('title' | 'description' | 'ticketNo')[],
  ): Promise<WhereOptions<Ticket>> {
    const like = { [Op.like]: '%' + search + '%' };
    const nameOrCode = { [Op.or]: [{ name: like }, { code: like }] };

    const [customers, projects] = await Promise.all([
      this.customerModel.findAll({ where: nameOrCode, attributes: ['id'], paranoid: false }),
      this.projectModel.findAll({ where: nameOrCode, attributes: ['id'], paranoid: false }),
    ]);

    const conditions: WhereOptions<Ticket>[] = ticketFields.map((field) => ({ [field]: like }));

    if (customers.length > 0) {
      conditions.push({ customerId: { [Op.in]: customers.map((customer) => customer.id) } });
    }

    if (projects.length > 0) {
      conditions.push({ projectId: { [Op.in]: projects.map((project) => project.id) } });
    }

    return { [Op.or]: conditions };
  }

  /**
   * ระบบเห็นอะไรบ้างตอนเปิดใบ — ใช้ *เสนอ* ประเภทการคิดเงิน (CLAUDE.md 9.3)
   *
   * ลำดับความสำคัญ: ประกันมาก่อนสัญญา MA เพราะประกันคือสิ่งที่ลูกค้าได้มาแล้ว
   * โดยไม่ต้องจ่ายเพิ่ม การไปหักโควตา MA ทั้งที่ยังอยู่ในประกันเท่ากับให้ลูกค้า
   * เสียของที่ซื้อไว้โดยไม่จำเป็น
   */
  async suggestBilling(projectId: number | null, onDate: Date): Promise<BillingSuggestionDto> {
    if (projectId === null) {
      return {
        suggested: null,
        warrantyId: null,
        maContractId: null,
        reason: 'ไม่ได้ระบุโครงการ จึงตรวจประกันและสัญญา MA ให้ไม่ได้',
      };
    }

    const [warranty, contract] = await Promise.all([
      this.warrantiesService.findCoveringWarranty(projectId, onDate),
      this.maQuotaService.findActiveContract(projectId, onDate),
    ]);

    if (warranty) {
      return {
        suggested: TicketBillingType.WARRANTY,
        warrantyId: warranty.id,
        maContractId: contract ? contract.id : null,
        reason:
          `อยู่ในระยะประกันถึง ${warranty.endDate} — ` +
          'ครอบคลุมเฉพาะ bug ในขอบเขตเดิม ถ้าเป็นงานที่ขอเพิ่มใหม่ต้องเปลี่ยนเป็น ONE_TIME (BR-07)',
      };
    }

    if (contract) {
      return {
        suggested: TicketBillingType.MA_QUOTA,
        warrantyId: null,
        maContractId: contract.id,
        reason: `มีสัญญา MA ที่ยังใช้งานอยู่ถึง ${contract.endDate}`,
      };
    }

    return {
      suggested: null,
      warrantyId: null,
      maContractId: null,
      reason: 'ไม่พบประกันหรือสัญญา MA ที่ยังคุ้มครองโครงการนี้ ณ วันที่แจ้ง',
    };
  }

  private async findOrFail(id: number, transaction?: Transaction): Promise<Ticket> {
    const ticket = await this.ticketModel.findByPk(id, { transaction });

    if (!ticket) {
      throw new NotFoundException('ไม่พบรายการปัญหานี้');
    }

    return ticket;
  }

  /** ทุกรอบที่ลงมือแก้ เรียงตาม round จากน้อยไปมาก (BR-03) */
  private async findResolutions(ticketId: number): Promise<TicketResolution[]> {
    return this.resolutionModel.findAll({
      where: { ticketId },
      include: [
        {
          model: User,
          as: 'resolvedBy',
          attributes: ['id', 'username', 'fullName'],
          required: false,
          paranoid: false,
        },
      ],
      order: [['round', 'ASC']],
    });
  }

  /** ต่อหมายเหตุท้ายรายละเอียดเดิม ไม่เขียนทับของเก่า (BR-09 ต้องตามรอยย้อนหลังได้) */
  private appendNote(
    current: string | null,
    note: string | null | undefined,
    label: string,
  ): string | null {
    if (!note) {
      return current;
    }

    const line = `[${label}] ${note}`;
    return current ? `${current}\n\n${line}` : line;
  }

  private async assertCustomerExists(customerId: number): Promise<void> {
    const customer = await this.customerModel.findByPk(customerId, { attributes: ['id'] });

    if (!customer) {
      throw new BadRequestException('ไม่พบข้อมูลลูกค้าที่ระบุ');
    }
  }

  /** กันการผูกปัญหาเข้ากับโครงการของลูกค้าคนอื่น ซึ่งทำให้ประวัติปนข้ามราย */
  private async assertProjectBelongsToCustomer(
    projectId: number,
    customerId: number,
  ): Promise<void> {
    const project = await this.projectModel.findByPk(projectId, {
      attributes: ['id', 'customerId'],
    });

    if (!project) {
      throw new BadRequestException('ไม่พบข้อมูลโครงการที่ระบุ');
    }

    if (project.customerId !== customerId) {
      throw new BadRequestException('โครงการที่ระบุไม่ได้เป็นของลูกค้ารายนี้');
    }
  }

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

  /**
   * ผู้ที่ถูกอ้างถึงต้องมีตัวตน แต่ไม่บังคับว่าต้อง ACTIVE
   * เพราะ BR-02 ให้บันทึกย้อนหลังได้ คนที่รับเรื่องหรือลงมือแก้เมื่อปีที่แล้วอาจลาออกไปแล้ว
   */
  private async assertUserExists(userId: number): Promise<void> {
    const user = await this.userModel.findByPk(userId, { attributes: ['id'], paranoid: false });

    if (!user) {
      throw new BadRequestException('ไม่พบพนักงานที่ระบุ');
    }
  }

  /**
   * ต่างจาก assertUserExists — การ *มอบหมายงานใหม่* ต้องเป็นคนที่ยังทำงานอยู่
   * เหมือนกับการมอบหมาย task ใน Phase 5 มอบงานให้คนที่ลาออกไปแล้วไม่มีความหมาย
   */
  private async assertUserIsAssignable(userId: number): Promise<void> {
    const user = await this.userModel.findByPk(userId, { attributes: ['id', 'status'] });

    if (!user) {
      throw new BadRequestException('ไม่พบพนักงานที่ระบุเป็นผู้รับผิดชอบ');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new BadRequestException('พนักงานที่ระบุไม่ได้อยู่ในสถานะใช้งาน จึงมอบหมายงานให้ไม่ได้');
    }
  }

  /** เลขที่ใบต้องไม่ซ้ำ — ตรวจรวมรายการที่ถูก soft delete ไปแล้ว */
  private async assertTicketNoIsAvailable(ticketNo: string): Promise<void> {
    const existing = await this.ticketModel.findOne({ where: { ticketNo }, paranoid: false });

    if (existing) {
      throw new ConflictException('เลขที่ใบแจ้งปัญหานี้ถูกใช้ไปแล้ว');
    }
  }

  /** บันทึกย้อนหลังได้ตาม BR-02 แต่ล่วงหน้าไม่ได้ (เผื่อนาฬิกาคลาดเคลื่อน 5 นาที) */
  private assertNotInFuture(value: Date, message: string): void {
    const CLOCK_SKEW_MS = 5 * 60 * 1000;

    if (value.getTime() > Date.now() + CLOCK_SKEW_MS) {
      throw new BadRequestException(message);
    }
  }
}
