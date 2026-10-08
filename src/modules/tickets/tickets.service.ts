import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Op, type OrderItem, type Transaction, type WhereOptions } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

import { getCurrentUserId } from '../../common/context/request-context';
import { AccessControlService } from '../../common/services/access-control.service';
import { type PaginatedResult, toPaginatedResult } from '../../common/dto/pagination.dto';
import { nextGeneratedCode } from '../../common/utils/code-sequence.util';
import {
  AuditAction,
  AuditLog,
  Contact,
  Customer,
  Project,
  Ticket,
  TicketBillingType,
  TicketResolution,
  TicketStatus,
  User,
  UserStatus,
  Attachment,
} from '../../models';
import { MaQuotaService } from '../ma/ma-quota.service';
import { TicketWorkflowNotifyService } from '../notifications/ticket-workflow-notify.service';
import { WarrantiesService } from '../warranties/warranties.service';
import { CreateResolutionDto } from './dto/resolution.dto';
import {
  buildTicketHistory,
  collectHistoryUserIds,
  type TicketHistoryEventDto,
} from './dto/ticket-history';
import {
  AssignTicketDto,
  CloseTicketDto,
  CreateTicketDto,
  QueryAdminQueueDto,
  QueryPendingTicketsDto,
  QuerySupportQueueDto,
  UpdateTicketDto,
  QueryTicketsDto,
  RejectReviewDto,
  ReopenTicketDto,
  ReturnToSupportDto,
} from './dto/ticket.dto';
import {
  AdminQueueTab,
  ASSIGNEE_OPEN_TICKET_STATUSES,
  type BillingSuggestionDto,
  PENDING_TICKET_STATUSES,
  type ResolutionCreatedDto,
  SupportQueueTab,
  type TicketConfirmationPrintDto,
  type TicketResponseDto,
  toResolutionAttachment,
  toResolutionResponse,
  toTicketResponse,
} from './dto/ticket.response';

export const CLOSED_TICKET_RESOLUTION_MESSAGE =
  'ปัญหานี้ปิดงานแล้ว ถ้าอาการเดิมกลับมาให้กด "ปัญหาเดิมกลับมา" เพื่อเปิดใบนี้ก่อน ' +
  'แล้วจึงบันทึกการแก้ไขรอบถัดไป';

const ASSIGNABLE_TICKET_STATUSES: readonly TicketStatus[] = [
  TicketStatus.WAITING_ADMIN,
  TicketStatus.REOPENED,
];

const SEND_TO_ADMIN_STATUSES: readonly TicketStatus[] = [
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

const JOINED_SORTS = new Map<string, (dir: string) => OrderItem>([
  ['customerName', (dir) => ['customer', 'name', dir]],
  ['projectName', (dir) => ['project', 'name', dir]],
  ['assigneeName', (dir) => ['assignedUser', 'fullName', dir]],
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

function claimedByAdminUserInclude() {
  return {
    model: User,
    as: 'claimedByAdminUser',
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
    claimedByAdminUserInclude(),
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
    @InjectModel(Attachment) private readonly attachmentModel: typeof Attachment,
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly warrantiesService: WarrantiesService,
    private readonly maQuotaService: MaQuotaService,
    private readonly accessControl: AccessControlService,
    private readonly ticketWorkflowNotify: TicketWorkflowNotifyService,
    @InjectModel(AuditLog) private readonly auditLogModel: typeof AuditLog,
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

    const sortKey = query.sortBy ?? '';
    const primaryOrder: OrderItem =
      JOINED_SORTS.get(sortKey)?.(query.sortOrder) ??
      (SORTABLE_FIELDS.has(sortKey) ? [sortKey, query.sortOrder] : ['reportedAt', query.sortOrder]);

    const { rows, count } = await this.ticketModel.findAndCountAll({
      where,
      include: listIncludes(),
      distinct: true,
      order: [primaryOrder, ['id', query.sortOrder]],
      limit: query.limit,
      offset: query.offset,
    });

    return toPaginatedResult(
      rows.map((ticket) => toTicketResponse(ticket)),
      count,
      query,
    );
  }

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

  async findSupportQueue(query: QuerySupportQueueDto): Promise<PaginatedResult<TicketResponseDto>> {
    const where: WhereOptions<Ticket> = this.supportQueueWhere(query.tab);

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

  async findAdminQueue(query: QueryAdminQueueDto): Promise<PaginatedResult<TicketResponseDto>> {
    const where: WhereOptions<Ticket> = this.adminQueueWhere(query.tab);

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

  async countAdminQueue(): Promise<Record<AdminQueueTab, number>> {
    const tabs = Object.values(AdminQueueTab);
    const counts = await Promise.all(
      tabs.map((tab) => this.ticketModel.count({ where: this.adminQueueWhere(tab) })),
    );
    return Object.fromEntries(tabs.map((tab, i) => [tab, counts[i]])) as Record<
      AdminQueueTab,
      number
    >;
  }

  async countSupportQueue(): Promise<Record<SupportQueueTab, number>> {
    const tabs = Object.values(SupportQueueTab);
    const counts = await Promise.all(
      tabs.map((tab) => this.ticketModel.count({ where: this.supportQueueWhere(tab) })),
    );
    return Object.fromEntries(tabs.map((tab, i) => [tab, counts[i]])) as Record<
      SupportQueueTab,
      number
    >;
  }

  countOpenAssignedTo(userId: number): Promise<number> {
    return this.ticketModel.count({
      where: {
        assignedUserId: userId,
        status: { [Op.in]: ASSIGNEE_OPEN_TICKET_STATUSES },
      },
    });
  }

  async findOne(id: number): Promise<TicketResponseDto> {
    const ticket = await this.ticketModel.findByPk(id, { include: listIncludes() });

    if (!ticket) {
      throw new NotFoundException('ไม่พบรายการปัญหานี้');
    }

    const [resolutions, history] = await Promise.all([
      this.findResolutions(id),
      this.findHistory(id),
    ]);
    const attachmentsByResolutionId = await this.findResolutionAttachmentsMap(
      resolutions.map((item) => item.id),
    );
    return toTicketResponse(ticket, resolutions, attachmentsByResolutionId, history);
  }

  private async findHistory(ticketId: number): Promise<TicketHistoryEventDto[]> {
    const rows = await this.auditLogModel.findAll({
      where: {
        tableName: 'tickets',
        recordId: ticketId,
        action: { [Op.in]: [AuditAction.CREATE, AuditAction.UPDATE] },
      },
      attributes: ['action', 'userId', 'oldValue', 'newValue', 'createdAt'],
      order: [
        ['createdAt', 'ASC'],
        ['id', 'ASC'],
      ],
    });

    const userIds = collectHistoryUserIds(rows);
    const users = userIds.length
      ? await this.userModel.findAll({
          where: { id: { [Op.in]: userIds } },
          attributes: ['id', 'fullName'],
          paranoid: false,
        })
      : [];

    return buildTicketHistory(rows, new Map(users.map((user) => [user.id, user.fullName])));
  }

  async getConfirmationPrint(id: number, round?: number): Promise<TicketConfirmationPrintDto> {
    const ticket = await this.ticketModel.findByPk(id, {
      include: [
        {
          model: Customer,
          required: false,
          paranoid: false,
          include: [{ model: Contact, required: false }],
        },
        {
          model: Project,
          attributes: ['id', 'code', 'name'],
          required: false,
          paranoid: false,
        },
        {
          model: Contact,
          as: 'reportedByContact',
          attributes: ['id', 'name', 'phone', 'email'],
          required: false,
          paranoid: false,
        },
      ],
    });

    if (!ticket) {
      throw new NotFoundException('ไม่พบรายการปัญหานี้');
    }
    if (!ticket.customer) {
      throw new NotFoundException('ไม่พบข้อมูลลูกค้าของใบนี้ จึงพิมพ์ใบยืนยันไม่ได้');
    }

    const resolutions = await this.findResolutions(id);
    if (resolutions.length === 0) {
      throw new BadRequestException('ยังไม่มีรอบการแก้ไข จึงพิมพ์ใบยืนยันไม่ได้');
    }

    const selected =
      round !== undefined
        ? resolutions.find((item) => item.round === round)
        : resolutions[resolutions.length - 1];

    if (!selected) {
      throw new NotFoundException(`ไม่พบรอบที่ ${round} ของใบนี้`);
    }

    const attachmentsByResolutionId = await this.findResolutionAttachmentsMap(
      resolutions.map((item) => item.id),
    );
    const resolutionDto = toResolutionResponse(
      selected,
      attachmentsByResolutionId.get(selected.id) ?? [],
    );
    const allResolutionDtos = resolutions.map((item) =>
      toResolutionResponse(item, attachmentsByResolutionId.get(item.id) ?? []),
    );

    const primaryContact =
      ticket.customer.contacts?.find((contact) => contact.isPrimary) ??
      ticket.customer.contacts?.[0] ??
      null;

    return {
      documentTitle: 'ใบยืนยันการแก้ไขปัญหา',
      ticket: {
        id: ticket.id,
        ticketNo: ticket.ticketNo,
        title: ticket.title,
        description: ticket.description,
        status: ticket.status,
        priority: ticket.priority,
        billingType: ticket.billingType,
        reportedChannel: ticket.reportedChannel,
        reportedAt: ticket.reportedAt,
        resolvedAt: ticket.resolvedAt,
        closedAt: ticket.closedAt,
      },
      customer: {
        id: ticket.customer.id,
        code: ticket.customer.code,
        name: ticket.customer.name,
        taxId: ticket.customer.taxId,
        address: ticket.customer.address,
        phone: ticket.customer.phone,
      },
      project: ticket.project
        ? { id: ticket.project.id, code: ticket.project.code, name: ticket.project.name }
        : null,
      reportedByContact: ticket.reportedByContact
        ? {
            id: ticket.reportedByContact.id,
            name: ticket.reportedByContact.name,
            phone: ticket.reportedByContact.phone,
            email: ticket.reportedByContact.email,
          }
        : primaryContact
          ? {
              id: primaryContact.id,
              name: primaryContact.name,
              phone: primaryContact.phone,
              email: primaryContact.email,
            }
          : null,
      resolution: resolutionDto,
      allResolutions: allResolutionDtos,
      signatureBlocks: [
        { role: 'PROVIDER', label: 'ผู้ให้บริการ / ผู้แก้ไข' },
        { role: 'CUSTOMER', label: 'ลูกค้า / ผู้รับมอบงาน' },
      ],
      attachScanHint: {
        refType: 'TICKET_RESOLUTION',
        refId: selected.id,
        noteSuggestion: `สแกนใบยืนยันรอบที่ ${selected.round} ที่ลูกค้าเซ็นแล้ว`,
      },
    };
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

    const reportedAt = new Date(dto.reportedAt);
    this.assertNotInFuture(reportedAt, 'เวลาที่ลูกค้าแจ้งต้องไม่เป็นเวลาในอนาคต');

    const suggestion = await this.suggestBilling(dto.projectId ?? null, reportedAt);
    const billingType = dto.billingType ?? suggestion.suggested ?? TicketBillingType.ONE_TIME;

    const ticket = await this.sequelize.transaction(async (transaction) => {
      if (billingType === TicketBillingType.MA_QUOTA) {
        await this.assertMaQuotaAvailable(dto.projectId ?? null, reportedAt, transaction);
      }

      const ticketNo = await nextGeneratedCode(this.sequelize, 'TICKET', transaction);

      return this.ticketModel.create(
        {
          customerId: dto.customerId,
          projectId: dto.projectId ?? null,
          ticketNo,
          title: dto.title,
          description: dto.description ?? null,
          status: TicketStatus.RECEIVED,
          priority: dto.priority,
          billingType,
          warrantyId: suggestion.warrantyId,
          maContractId: suggestion.maContractId,
          reportedChannel: dto.reportedChannel,
          reportedAt,
          reportedByContactId: dto.reportedByContactId ?? null,
          assignedUserId: dto.assignedUserId ?? null,
          receivedByUserId: dto.receivedByUserId ?? actorId,
          dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
          resolutionCount: 0,
          createdBy: actorId,
          updatedBy: actorId,
        },
        { transaction },
      );
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
   * C-1: มอบจาก WAITING_ADMIN ได้เฉพาะหลังแอดมินกดรับคิวแล้ว · จาก REOPENED ได้ตาม BR-04
   * ไม่มอบจาก RECEIVED ตรง ๆ — ต้องส่งหัวหน้าก่อน
   * ถอนการมอบหมาย (ส่ง null) ไม่ย้อนสถานะกลับ
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

    if (dto.assignedUserId !== null) {
      if (ticket.status === TicketStatus.RECEIVED) {
        throw new BadRequestException('ต้องส่งให้หัวหน้าและให้แอดมินรับเรื่องก่อนมอบหมายพนักงาน');
      }

      if (ticket.status === TicketStatus.WAITING_ADMIN && !ticket.claimedByAdminUserId) {
        throw new BadRequestException('ต้องกดรับเรื่องก่อนมอบหมายพนักงาน');
      }
    }

    const shouldAssign =
      dto.assignedUserId !== null && ASSIGNABLE_TICKET_STATUSES.includes(ticket.status);

    await ticket.update({
      assignedUserId: dto.assignedUserId,
      ...(shouldAssign ? { status: TicketStatus.ASSIGNED } : {}),
      ...(dto.dueAt !== undefined ? { dueAt: dto.dueAt ? new Date(dto.dueAt) : null } : {}),
      updatedBy: actorId,
    });

    const result = await this.findOne(id);
    if (dto.assignedUserId !== null) {
      await this.ticketWorkflowNotify.notifyAssigned(result, actorId);
    }
    return result;
  }

  async sendToAdmin(id: number): Promise<TicketResponseDto> {
    const actorId = getCurrentUserId();
    const ticket = await this.findOrFail(id);

    if (!SEND_TO_ADMIN_STATUSES.includes(ticket.status)) {
      throw new ConflictException('ใบนี้ไม่อยู่ในสถานะที่ส่งให้หัวหน้าได้');
    }

    await ticket.update({
      status: TicketStatus.WAITING_ADMIN,
      claimedByAdminUserId: null,
      assignedUserId: null,
      updatedBy: actorId,
    });

    const result = await this.findOne(id);
    await this.ticketWorkflowNotify.notifySentToAdmin(result, actorId);
    return result;
  }

  async claim(id: number): Promise<TicketResponseDto> {
    const actorId = getCurrentUserId();
    const ticket = await this.findOrFail(id);

    if (ticket.status !== TicketStatus.WAITING_ADMIN) {
      throw new ConflictException('ใบนี้ไม่อยู่ในคิวรอแอดมินรับเรื่อง');
    }

    if (ticket.claimedByAdminUserId) {
      throw new ConflictException('ใบนี้มีแอดมินรับเรื่องไปแล้ว');
    }

    await ticket.update({
      claimedByAdminUserId: actorId,
      updatedBy: actorId,
    });

    return this.findOne(id);
  }

  async returnToSupport(id: number, dto: ReturnToSupportDto = {}): Promise<TicketResponseDto> {
    const actorId = getCurrentUserId();
    const ticket = await this.findOrFail(id);

    if (ticket.status !== TicketStatus.RESOLVED) {
      throw new ConflictException('ต้องบันทึกผลการแก้ไขให้เป็น RESOLVED ก่อนส่งกลับซัพพอร์ต');
    }

    await ticket.update({
      status: TicketStatus.WAITING_SUPPORT,
      description: this.appendNote(ticket.description, dto.note, 'ตรวจผ่าน'),
      updatedBy: actorId,
    });

    const result = await this.findOne(id);
    await this.ticketWorkflowNotify.notifyReturnedToSupport(result, actorId);
    return result;
  }

  /**
   * แอดมินตรวจไม่ผ่าน → ตีกลับให้ผู้แก้คนเดิมทำต่อ (C-1 ขั้น 4)
   * จาก RESOLVED → IN_PROGRESS · ผู้แก้และแอดมินผู้รับคิวคงเดิม
   *
   * ไม่ใช้ reopen แทน เพราะ reopen คือปัญหาเดิมที่ลูกค้าแจ้งกลับมา และล้างแอดมินผู้รับคิว
   * งานที่ส่งใหม่เป็นรอบถัดไปของใบเดิม (BR-03) โควตา MA ไม่ถูกหักซ้ำ (หักครั้งเดียวต่อใบ)
   */
  async rejectReview(id: number, dto: RejectReviewDto): Promise<TicketResponseDto> {
    const actorId = getCurrentUserId();
    const ticket = await this.findOrFail(id);

    if (ticket.status !== TicketStatus.RESOLVED) {
      throw new ConflictException('ตีกลับได้เฉพาะใบที่แก้ไขแล้วและรอแอดมินตรวจ');
    }

    if (!ticket.assignedUserId) {
      throw new ConflictException(
        'ใบนี้ไม่มีผู้รับผิดชอบให้ตีกลับ — ให้มอบหมายผู้แก้ก่อน หรือตรวจผ่านแล้วส่งซัพพอร์ต',
      );
    }

    await ticket.update({
      status: TicketStatus.IN_PROGRESS,
      description: this.appendNote(ticket.description, dto.reason, 'ตรวจไม่ผ่าน'),
      updatedBy: actorId,
    });

    const result = await this.findOne(id);
    await this.ticketWorkflowNotify.notifyReviewRejected(result, actorId, dto.reason);
    return result;
  }

  async customerNotified(id: number, dto: CloseTicketDto): Promise<TicketResponseDto> {
    const actorId = getCurrentUserId();
    const ticket = await this.findOrFail(id);

    if (ticket.status !== TicketStatus.WAITING_SUPPORT) {
      throw new ConflictException('ใบนี้ยังไม่ได้อยู่ในสถานะรอซัพพอร์ตบอกลูกค้า');
    }

    await ticket.update({
      status: TicketStatus.CLOSED,
      closedAt: new Date(),
      description: this.appendNote(ticket.description, dto.note, 'บอกลูกค้าแล้ว'),
      ...(dto.extraCharge !== undefined ? { extraCharge: dto.extraCharge ?? null } : {}),
      updatedBy: actorId,
    });

    return this.findOne(id);
  }

  async start(id: number): Promise<TicketResponseDto> {
    const actorId = getCurrentUserId();
    const ticket = await this.findOrFail(id);

    if (ticket.assignedUserId !== actorId) {
      throw new ForbiddenException('เฉพาะผู้รับผิดชอบเท่านั้นที่เริ่มงานนี้ได้');
    }

    if (ticket.status !== TicketStatus.ASSIGNED) {
      throw new ConflictException('ใบแจ้งปัญหานี้ยังไม่อยู่ในสถานะส่งงานแล้ว');
    }

    await ticket.update({ status: TicketStatus.IN_PROGRESS, updatedBy: actorId });

    return this.findOne(id);
  }

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
          ...(ticket.firstResponseAt === null ? { firstResponseAt: resolvedAt } : {}),
          ...(dto.extraCharge !== undefined ? { extraCharge: dto.extraCharge ?? null } : {}),
          updatedBy: actorId,
        },
        { transaction },
      );

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

    await this.ticketWorkflowNotify.notifyAwaitingReview(ticket, actorId);

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
      claimedByAdminUserId: null,
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

  private supportQueueWhere(tab: SupportQueueTab): WhereOptions<Ticket> {
    return tab === SupportQueueTab.AWAITING_SEND
      ? { status: TicketStatus.RECEIVED }
      : { status: TicketStatus.WAITING_SUPPORT };
  }

  private adminQueueWhere(tab: AdminQueueTab): WhereOptions<Ticket> {
    switch (tab) {
      case AdminQueueTab.AWAITING_CLAIM:
        return {
          status: TicketStatus.WAITING_ADMIN,
          claimedByAdminUserId: null,
        };
      case AdminQueueTab.CLAIMED:
        return {
          status: TicketStatus.WAITING_ADMIN,
          claimedByAdminUserId: { [Op.ne]: null },
        };
      case AdminQueueTab.AWAITING_REVIEW:
        return { status: TicketStatus.RESOLVED };
      case AdminQueueTab.WITH_SUPPORT:
        return { status: TicketStatus.WAITING_SUPPORT };
      default: {
        const _exhaustive: never = tab;
        return _exhaustive;
      }
    }
  }

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

  /** MA เต็มแล้วห้ามเปิด ticket แบบหักโควตา ตามกติกาใหม่ของการรับเรื่อง */
  private async assertMaQuotaAvailable(
    projectId: number | null,
    reportedAt: Date,
    transaction: Transaction,
  ): Promise<void> {
    if (projectId === null) {
      throw new BadRequestException('เลือกโครงการก่อนใช้โควตา MA');
    }

    const contract = await this.maQuotaService.findActiveContract(
      projectId,
      reportedAt,
      transaction,
    );

    if (!contract) {
      throw new BadRequestException('ไม่พบสัญญา MA ที่ใช้งานได้สำหรับโครงการนี้');
    }

    const quota = await this.maQuotaService.getQuotaStatus(contract, reportedAt, transaction);

    if (quota.willExceed) {
      throw new BadRequestException(
        `โควตา MA รอบนี้เต็มแล้ว (${quota.used}/${quota.quota}) กรุณาเปลี่ยนประเภทการคิดเงิน`,
      );
    }
  }

  async suggestBilling(projectId: number | null, onDate: Date): Promise<BillingSuggestionDto> {
    if (projectId === null) {
      return {
        suggested: null,
        warrantyId: null,
        warrantyEndDate: null,
        warrantyScopeNote: null,
        warrantyCoverage: null,
        maContractId: null,
        maCoverage: null,
        maRemaining: null,
        maIsExhausted: null,
        maIsReferenceOnly: false,
        reason: 'ไม่ได้ระบุโครงการ จึงตรวจประกันและสัญญา MA ให้ไม่ได้',
      };
    }

    const [warranty, contract] = await Promise.all([
      this.warrantiesService.findCoveringWarranty(projectId, onDate),
      this.maQuotaService.findActiveContract(projectId, onDate),
    ]);

    const quota = contract ? await this.maQuotaService.getQuotaStatus(contract, onDate) : null;
    const maRemaining = quota ? Math.max(quota.quota - quota.used, 0) : null;
    const maIsExhausted = quota ? quota.willExceed : null;

    if (warranty) {
      const maCoverage = contract
        ? {
            contractId: contract.id,
            planName: contract.plan?.name ?? null,
            planDescription: contract.plan?.description ?? null,
            items: (contract.plan?.items ?? []).map((item) => ({
              id: item.id,
              title: item.title,
              detail: item.detail,
            })),
            endDate: contract.endDate,
          }
        : null;

      return {
        suggested: TicketBillingType.WARRANTY,
        warrantyId: warranty.id,
        warrantyEndDate: warranty.endDate,
        warrantyScopeNote: warranty.scopeNote ?? null,
        warrantyCoverage: {
          warrantyId: warranty.id,
          endDate: warranty.endDate,
          scopeNote: warranty.scopeNote ?? null,
        },
        maContractId: contract ? contract.id : null,
        maCoverage,
        maRemaining,
        maIsExhausted,
        maIsReferenceOnly: contract !== null,
        reason:
          `อยู่ในระยะประกันถึง ${warranty.endDate} — ` +
          'ครอบคลุมเฉพาะ bug ในขอบเขตเดิม ถ้าเป็นงานที่ขอเพิ่มใหม่ต้องเปลี่ยนเป็น ONE_TIME (BR-07)',
      };
    }

    if (contract) {
      return {
        suggested: TicketBillingType.MA_QUOTA,
        warrantyId: null,
        warrantyEndDate: null,
        warrantyScopeNote: null,
        warrantyCoverage: null,
        maContractId: contract.id,
        maCoverage: {
          contractId: contract.id,
          planName: contract.plan?.name ?? null,
          planDescription: contract.plan?.description ?? null,
          items: (contract.plan?.items ?? []).map((item) => ({
            id: item.id,
            title: item.title,
            detail: item.detail,
          })),
          endDate: contract.endDate,
        },
        maRemaining,
        maIsExhausted,
        maIsReferenceOnly: false,
        reason: `มีสัญญา MA ที่ยังใช้งานอยู่ถึง ${contract.endDate}`,
      };
    }

    return {
      suggested: null,
      warrantyId: null,
      warrantyEndDate: null,
      warrantyScopeNote: null,
      warrantyCoverage: null,
      maContractId: null,
      maCoverage: null,
      maRemaining: null,
      maIsExhausted: null,
      maIsReferenceOnly: false,
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

  private async findResolutionAttachmentsMap(
    resolutionIds: number[],
  ): Promise<Map<number, ReturnType<typeof toResolutionAttachment>[]>> {
    const map = new Map<number, ReturnType<typeof toResolutionAttachment>[]>();
    if (resolutionIds.length === 0) {
      return map;
    }

    const rows = await this.attachmentModel.findAll({
      where: {
        refType: 'TICKET_RESOLUTION',
        refId: { [Op.in]: resolutionIds },
      },
      attributes: ['id', 'refId', 'fileName', 'note', 'createdAt'],
      order: [
        ['createdAt', 'ASC'],
        ['id', 'ASC'],
      ],
    });

    for (const row of rows) {
      const list = map.get(row.refId) ?? [];
      list.push(toResolutionAttachment(row));
      map.set(row.refId, list);
    }
    return map;
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

  private async assertUserIsAssignable(userId: number): Promise<void> {
    const user = await this.userModel.findByPk(userId, {
      attributes: ['id', 'username', 'fullName', 'accountType', 'status'],
    });

    if (!user) {
      throw new BadRequestException('ไม่พบพนักงานที่ระบุเป็นผู้รับผิดชอบ');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new BadRequestException('พนักงานที่ระบุไม่ได้อยู่ในสถานะใช้งาน จึงมอบหมายงานให้ไม่ได้');
    }

    const canWork = await Promise.all(
      ['ticket.view', 'ticket.update', 'ticket.resolve'].map((permission) =>
        this.accessControl.hasPermission(user, permission),
      ),
    );

    if (!canWork.every(Boolean)) {
      throw new BadRequestException('พนักงานที่ระบุไม่มีสิทธิ์ทำงานใบแจ้งปัญหาประเภทนี้');
    }
  }

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
