/// <reference types="jest" />
// TypeScript 6 ไม่ดึง @types/jest เข้ามาให้อัตโนมัติ ต้องอ้างถึงตรงนี้เหมือน spec ตัวอื่น

import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Op } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';

import { runWithRequestContext } from '../../common/context/request-context';
import {
  Contact,
  Customer,
  Project,
  ResolutionResult,
  Ticket,
  TicketBillingType,
  TicketPriority,
  TicketReportedChannel,
  TicketResolution,
  TicketStatus,
  User,
  UserStatus,
} from '../../models';
import type { MaQuotaService } from '../ma/ma-quota.service';
import type { WarrantiesService } from '../warranties/warranties.service';
import { CLOSED_TICKET_RESOLUTION_MESSAGE, TicketsService } from './tickets.service';
import type { QueryTicketsDto } from './dto/ticket.dto';

/**
 * เทสต์กฎของ Phase 7 — จุดที่ซับซ้อนที่สุดของทั้งระบบ
 *
 * BR-03 1 ปัญหา แก้ได้หลายรอบ / BR-04 ปัญหาเดิมกลับมาให้เพิ่มรอบในใบเดิม
 * BR-07 ระบบได้แค่เสนอ billing_type / BR-08 บั๊กฟรีก็ต้องบันทึก
 */

interface ModelMock {
  findByPk: jest.Mock;
  findOne: jest.Mock;
  findAll: jest.Mock;
  findAndCountAll: jest.Mock;
  create: jest.Mock;
  count: jest.Mock;
}

function modelMock(): ModelMock {
  return {
    findByPk: jest.fn(),
    findOne: jest.fn(),
    findAll: jest.fn(),
    findAndCountAll: jest.fn(),
    create: jest.fn(),
    count: jest.fn(),
  };
}

/** ตัวแทน transaction — ต้องมี LOCK เพราะ service ใช้ SELECT ... FOR UPDATE */
const TRANSACTION = { name: 'tx', LOCK: { UPDATE: 'UPDATE' } };

function baseTicketRow() {
  return {
    id: 7,
    ticketNo: 'TK-2026-001' as string | null,
    customerId: 1,
    customer: null,
    projectId: 1 as number | null,
    project: null,
    title: 'หน้าจอรายงานโหลดไม่ขึ้น',
    description: null as string | null,
    status: TicketStatus.RECEIVED,
    priority: TicketPriority.NORMAL,
    billingType: TicketBillingType.ONE_TIME,
    reportedChannel: TicketReportedChannel.LINE,
    reportedAt: new Date('2026-09-09T02:15:00Z'),
    reportedByContactId: null as number | null,
    reportedByContact: null,
    assignedUserId: null as number | null,
    assignedUser: null,
    receivedByUserId: null as number | null,
    receivedByUser: null,
    warrantyId: null as number | null,
    maContractId: null as number | null,
    resolutionCount: 0,
    firstResponseAt: null as Date | null,
    resolvedAt: null as Date | null,
    closedAt: null as Date | null,
    dueAt: null as Date | null,
    extraCharge: null as string | null,
    createdAt: new Date('2026-09-09T02:20:00Z'),
    updatedAt: new Date('2026-09-09T02:20:00Z'),
    update: jest.fn(),
  };
}

type TicketRow = ReturnType<typeof baseTicketRow>;

function ticketRow(overrides: Partial<TicketRow> = {}): TicketRow {
  return { ...baseTicketRow(), ...overrides };
}

function resolutionRow(round: number, id = 100 + round) {
  return {
    id,
    ticketId: 7,
    round,
    result: ResolutionResult.SUCCESS,
    detail: 'แก้แล้ว',
    rootCause: null,
    resolvedByUserId: 4,
    resolvedBy: null,
    startedAt: null,
    resolvedAt: new Date('2026-09-09T07:30:00Z'),
    hoursSpent: null,
    createdAt: new Date('2026-09-09T07:35:00Z'),
  };
}

function queryDto(overrides: Record<string, unknown> = {}): QueryTicketsDto {
  return {
    page: 1,
    limit: 20,
    offset: 0,
    sortOrder: 'DESC',
    ...overrides,
  } as unknown as QueryTicketsDto;
}

/** เวลาที่แน่นอนว่าเป็นอดีต */
function pastIso(minutesAgo = 60): string {
  return new Date(Date.now() - minutesAgo * 60 * 1000).toISOString();
}

describe('TicketsService', () => {
  let ticketModel: ModelMock;
  let resolutionModel: ModelMock;
  let customerModel: ModelMock;
  let projectModel: ModelMock;
  let contactModel: ModelMock;
  let userModel: ModelMock;
  let sequelize: { transaction: jest.Mock };
  let warrantiesService: { findCoveringWarranty: jest.Mock };
  let maQuotaService: { findActiveContract: jest.Mock; recordUsageForTicket: jest.Mock };
  let service: TicketsService;

  beforeEach(() => {
    ticketModel = modelMock();
    resolutionModel = modelMock();
    customerModel = modelMock();
    projectModel = modelMock();
    contactModel = modelMock();
    userModel = modelMock();
    sequelize = {
      transaction: jest.fn((callback: (t: unknown) => Promise<unknown>) => callback(TRANSACTION)),
    };
    warrantiesService = { findCoveringWarranty: jest.fn().mockResolvedValue(null) };
    maQuotaService = {
      findActiveContract: jest.fn().mockResolvedValue(null),
      recordUsageForTicket: jest.fn().mockResolvedValue({ usage: null, status: null }),
    };

    ticketModel.findByPk.mockResolvedValue(ticketRow());
    ticketModel.findOne.mockResolvedValue(null);
    ticketModel.create.mockResolvedValue(ticketRow());
    ticketModel.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });
    resolutionModel.count.mockResolvedValue(0);
    resolutionModel.findAll.mockResolvedValue([]);
    resolutionModel.create.mockImplementation((values: { round: number }) =>
      Promise.resolve(resolutionRow(values.round)),
    );
    customerModel.findByPk.mockResolvedValue({ id: 1 });
    projectModel.findByPk.mockResolvedValue({ id: 1, customerId: 1 });
    contactModel.findByPk.mockResolvedValue({ id: 2, customerId: 1 });
    userModel.findByPk.mockResolvedValue({ id: 4, status: UserStatus.ACTIVE });

    service = new TicketsService(
      ticketModel as unknown as typeof Ticket,
      resolutionModel as unknown as typeof TicketResolution,
      customerModel as unknown as typeof Customer,
      projectModel as unknown as typeof Project,
      contactModel as unknown as typeof Contact,
      userModel as unknown as typeof User,
      sequelize as unknown as Sequelize,
      warrantiesService as unknown as WarrantiesService,
      maQuotaService as unknown as MaQuotaService,
    );
  });

  /** dto ของการบันทึกผลการแก้ที่ผ่าน validation แน่นอน */
  function resolutionDto(overrides: Record<string, unknown> = {}) {
    return {
      result: ResolutionResult.SUCCESS,
      detail: 'แก้ query ที่ join ผิดตาราง',
      resolvedAt: pastIso(),
      ...overrides,
    } as never;
  }

  // -------------------------------------------------------------------------
  // POST /resolutions — หัวใจของโมดูล (CLAUDE.md 9.1)
  // -------------------------------------------------------------------------
  describe('addResolution', () => {
    it('นับ round จากรอบที่มีอยู่ + 1 ไม่ได้รับมาจากผู้ใช้', async () => {
      resolutionModel.count.mockResolvedValue(2);
      resolutionModel.findAll.mockResolvedValue([
        resolutionRow(1),
        resolutionRow(2),
        resolutionRow(3),
      ]);

      let captured: { round: number } = { round: 0 };
      resolutionModel.create.mockImplementation((values: { round: number }) => {
        captured = values;
        return Promise.resolve(resolutionRow(values.round));
      });

      await service.addResolution(7, resolutionDto());

      expect(captured.round).toBe(3);
    });

    it('รอบแรกของใบใหม่ได้ round เป็น 1', async () => {
      resolutionModel.count.mockResolvedValue(0);
      resolutionModel.findAll.mockResolvedValue([resolutionRow(1)]);

      let captured: { round: number } = { round: 0 };
      resolutionModel.create.mockImplementation((values: { round: number }) => {
        captured = values;
        return Promise.resolve(resolutionRow(values.round));
      });

      await service.addResolution(7, resolutionDto());

      expect(captured.round).toBe(1);
    });

    it('เพิ่มการแก้ในใบที่ปิดงานแล้วตรง ๆ ไม่ได้ และบอกให้เปิดใบเดิมกลับมาก่อน', async () => {
      ticketModel.findByPk.mockResolvedValue(ticketRow({ status: TicketStatus.CLOSED }));

      await expect(service.addResolution(7, resolutionDto())).rejects.toThrow(
        CLOSED_TICKET_RESOLUTION_MESSAGE,
      );
      // ห้ามชี้ให้ไปเปิดใบใหม่ — ขัด BR-04
      expect(CLOSED_TICKET_RESOLUTION_MESSAGE).not.toContain('เปิดใบใหม่');
      expect(resolutionModel.create).not.toHaveBeenCalled();
    });

    it('โยนข้อความไทยเมื่อไม่พบใบ', async () => {
      ticketModel.findByPk.mockResolvedValue(null);

      await expect(service.addResolution(999, resolutionDto())).rejects.toThrow(
        'ไม่พบรายการปัญหานี้',
      );
    });

    it('ล็อกแถวใบด้วย SELECT ... FOR UPDATE ก่อนนับ round', async () => {
      // ถ้าไม่ล็อก สองคนที่กดพร้อมกันจะนับได้เลขเดียวกันแล้วไปชน unique (ticket_id, round)
      let captured: { transaction: unknown; lock: unknown } = { transaction: null, lock: null };
      ticketModel.findByPk.mockImplementation(
        (_id: number, options?: { transaction: unknown; lock: unknown }) => {
          if (options?.lock) {
            captured = options;
          }
          return Promise.resolve(ticketRow());
        },
      );
      resolutionModel.findAll.mockResolvedValue([resolutionRow(1)]);

      await service.addResolution(7, resolutionDto());

      expect(captured.transaction).toBe(TRANSACTION);
      expect(captured.lock).toBe('UPDATE');
    });

    it('อัปเดตสถานะเป็น RESOLVED พร้อมยอดรอบ ในทรานแซกชันเดียวกัน', async () => {
      const ticket = ticketRow({ status: TicketStatus.IN_PROGRESS });
      ticketModel.findByPk.mockResolvedValue(ticket);
      resolutionModel.count.mockResolvedValue(1);
      resolutionModel.findAll.mockResolvedValue([resolutionRow(1), resolutionRow(2)]);

      await service.addResolution(7, resolutionDto());

      expect(sequelize.transaction).toHaveBeenCalledTimes(1);
      expect(ticket.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: TicketStatus.RESOLVED, resolutionCount: 2 }),
        { transaction: TRANSACTION },
      );
    });

    it('บันทึกเวลาตอบกลับครั้งแรกครั้งเดียว ไม่ทับของเดิม', async () => {
      const firstResponseAt = new Date('2026-09-09T03:00:00Z');
      const ticket = ticketRow({ firstResponseAt });
      ticketModel.findByPk.mockResolvedValue(ticket);
      resolutionModel.findAll.mockResolvedValue([resolutionRow(1)]);

      let captured: { firstResponseAt?: Date } = {};
      ticket.update.mockImplementation((values: { firstResponseAt?: Date }) => {
        captured = values;
        return Promise.resolve(ticket);
      });

      await service.addResolution(7, resolutionDto());

      expect(captured.firstResponseAt).toBeUndefined();
    });

    it('ส่งทรานแซกชันเดียวกันต่อให้การหักโควตา MA', async () => {
      // ถ้าหักโควตานอกทรานแซกชัน แล้ว rollback จะเหลือแถวโควตาค้างโดยไม่มีรอบการแก้
      resolutionModel.findAll.mockResolvedValue([resolutionRow(1)]);

      await service.addResolution(7, resolutionDto());

      expect(maQuotaService.recordUsageForTicket).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ transaction: TRANSACTION }),
      );
    });

    it('คืนสถานะโควตาหน้าตาเดียวกับ GET /api/ma-contracts/:id/quota', async () => {
      // สองเส้นนี้พูดเรื่องเดียวกัน ถ้าฟิลด์ไม่ตรงกัน frontend ต้องเขียนโค้ดอ่านสองแบบ
      // และหน้าจอ ticket จะบอกผู้ใช้ไม่ได้ว่าโควตารอบนี้หมดวันไหน
      resolutionModel.findAll.mockResolvedValue([resolutionRow(1)]);
      maQuotaService.recordUsageForTicket.mockResolvedValue({
        usage: { id: 50 },
        status: {
          contractId: 2,
          periodYear: 2026,
          periodMonth: 11,
          periodStart: '2026-11-15',
          periodEnd: '2026-12-14',
          quota: 5,
          used: 2,
          willExceed: false,
        },
      });

      const result = await service.addResolution(7, resolutionDto());

      expect(result.quota).toEqual({
        contractId: 2,
        periodYear: 2026,
        periodMonth: 11,
        periodStart: '2026-11-15',
        periodEnd: '2026-12-14',
        quota: 5,
        // status.used คือยอดก่อนหัก ที่คืนออกไปต้องเป็นยอดหลังหักแล้ว
        used: 3,
        remaining: 2,
        isOverQuota: false,
      });
    });

    it('โควตาที่เหลือติดลบได้เมื่อหักเกินไปแล้ว', async () => {
      resolutionModel.findAll.mockResolvedValue([resolutionRow(1)]);
      maQuotaService.recordUsageForTicket.mockResolvedValue({
        usage: { id: 50 },
        status: {
          contractId: 2,
          periodYear: 2026,
          periodMonth: 11,
          periodStart: '2026-11-15',
          periodEnd: '2026-12-14',
          quota: 3,
          used: 3,
          willExceed: true,
        },
      });

      const result = await service.addResolution(7, resolutionDto());

      expect(result.quota?.remaining).toBe(-1);
      expect(result.quota?.isOverQuota).toBe(true);
    });

    it('บันทึกเวลาที่แก้เสร็จเป็นอนาคตไม่ได้', async () => {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      await expect(
        service.addResolution(7, resolutionDto({ resolvedAt: tomorrow })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(sequelize.transaction).not.toHaveBeenCalled();
    });

    it('เวลาเริ่มแก้ต้องไม่อยู่หลังเวลาที่แก้เสร็จ', async () => {
      await expect(
        service.addResolution(
          7,
          resolutionDto({ startedAt: pastIso(10), resolvedAt: pastIso(60) }),
        ),
      ).rejects.toThrow('เวลาที่เริ่มแก้ต้องไม่อยู่หลังเวลาที่แก้เสร็จ');
    });

    it('ไม่ระบุคนแก้ = คนที่กดบันทึกคือคนแก้', async () => {
      resolutionModel.findAll.mockResolvedValue([resolutionRow(1)]);

      let captured: { resolvedByUserId: number | null } = { resolvedByUserId: null };
      resolutionModel.create.mockImplementation((values: { resolvedByUserId: number | null }) => {
        captured = values;
        return Promise.resolve(resolutionRow(1));
      });

      await runWithRequestContext(
        { userId: 42, ipAddress: null, userAgent: null, startedAt: Date.now() },
        () => service.addResolution(7, resolutionDto()),
      );

      expect(captured.resolvedByUserId).toBe(42);
    });
  });

  // -------------------------------------------------------------------------
  // BR-07 — ระบบเสนอได้ แต่คนตัดสิน
  // -------------------------------------------------------------------------
  describe('การเสนอประเภทการคิดเงินตอนเปิดใบ', () => {
    const dto = {
      customerId: 1,
      projectId: 1,
      title: 'ปัญหาใหม่',
      reportedChannel: TicketReportedChannel.LINE,
      reportedAt: pastIso(),
    } as never;

    it('เสนอ WARRANTY เมื่อยังอยู่ในระยะประกัน', async () => {
      warrantiesService.findCoveringWarranty.mockResolvedValue({ id: 4, endDate: '2027-09-08' });

      let captured: { billingType: TicketBillingType; warrantyId: number | null } = {
        billingType: TicketBillingType.FREE,
        warrantyId: null,
      };
      ticketModel.create.mockImplementation(
        (values: { billingType: TicketBillingType; warrantyId: number | null }) => {
          captured = values;
          return Promise.resolve(ticketRow());
        },
      );

      await service.create(dto);

      expect(captured.billingType).toBe(TicketBillingType.WARRANTY);
      expect(captured.warrantyId).toBe(4);
    });

    it('ประกันมาก่อนสัญญา MA เมื่อมีทั้งคู่', async () => {
      // หักโควตา MA ทั้งที่ยังอยู่ในประกัน = ให้ลูกค้าเสียของที่ซื้อไว้โดยไม่จำเป็น
      warrantiesService.findCoveringWarranty.mockResolvedValue({ id: 4, endDate: '2027-09-08' });
      maQuotaService.findActiveContract.mockResolvedValue({ id: 2, endDate: '2027-12-31' });

      let captured: { billingType: TicketBillingType } = { billingType: TicketBillingType.FREE };
      ticketModel.create.mockImplementation((values: { billingType: TicketBillingType }) => {
        captured = values;
        return Promise.resolve(ticketRow());
      });

      await service.create(dto);

      expect(captured.billingType).toBe(TicketBillingType.WARRANTY);
    });

    it('เสนอ MA_QUOTA เมื่อหมดประกันแล้วแต่ยังมีสัญญา MA', async () => {
      maQuotaService.findActiveContract.mockResolvedValue({ id: 2, endDate: '2027-12-31' });

      let captured: { billingType: TicketBillingType; maContractId: number | null } = {
        billingType: TicketBillingType.FREE,
        maContractId: null,
      };
      ticketModel.create.mockImplementation(
        (values: { billingType: TicketBillingType; maContractId: number | null }) => {
          captured = values;
          return Promise.resolve(ticketRow());
        },
      );

      await service.create(dto);

      expect(captured.billingType).toBe(TicketBillingType.MA_QUOTA);
      expect(captured.maContractId).toBe(2);
    });

    it('ค่าที่ผู้ใช้เลือกชนะเสมอ แม้ระบบจะเสนออย่างอื่น', async () => {
      // งานที่ลูกค้าขอเพิ่มใหม่ต้องคิดเงินแม้อยู่ในระยะประกัน — ระบบตัดสินแทนคนไม่ได้ (BR-07)
      warrantiesService.findCoveringWarranty.mockResolvedValue({ id: 4, endDate: '2027-09-08' });

      let captured: { billingType: TicketBillingType } = { billingType: TicketBillingType.FREE };
      ticketModel.create.mockImplementation((values: { billingType: TicketBillingType }) => {
        captured = values;
        return Promise.resolve(ticketRow());
      });

      await service.create({
        ...(dto as object),
        billingType: TicketBillingType.ONE_TIME,
      } as never);

      expect(captured.billingType).toBe(TicketBillingType.ONE_TIME);
    });

    it('ไม่เจออะไรเลยและผู้ใช้ไม่เลือก = ONE_TIME', async () => {
      let captured: { billingType: TicketBillingType } = { billingType: TicketBillingType.FREE };
      ticketModel.create.mockImplementation((values: { billingType: TicketBillingType }) => {
        captured = values;
        return Promise.resolve(ticketRow());
      });

      await service.create(dto);

      expect(captured.billingType).toBe(TicketBillingType.ONE_TIME);
    });

    it('เลือก FREE ได้ตาม BR-08 บั๊กเล็กทำฟรีแต่ต้องบันทึก', async () => {
      let captured: { billingType: TicketBillingType } = {
        billingType: TicketBillingType.ONE_TIME,
      };
      ticketModel.create.mockImplementation((values: { billingType: TicketBillingType }) => {
        captured = values;
        return Promise.resolve(ticketRow());
      });

      await service.create({ ...(dto as object), billingType: TicketBillingType.FREE } as never);

      expect(captured.billingType).toBe(TicketBillingType.FREE);
    });

    it('ไม่ระบุโครงการ = ตรวจประกันกับ MA ให้ไม่ได้', async () => {
      const suggestion = await service.suggestBilling(null, new Date());

      expect(suggestion.suggested).toBeNull();
      expect(warrantiesService.findCoveringWarranty).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // ความถูกต้องของข้อมูลตอนเปิดใบ
  // -------------------------------------------------------------------------
  describe('create', () => {
    const dto = {
      customerId: 1,
      title: 'ปัญหาใหม่',
      reportedChannel: TicketReportedChannel.PHONE,
      reportedAt: pastIso(),
    } as never;

    it('ผูกกับโครงการของลูกค้ารายอื่นไม่ได้', async () => {
      projectModel.findByPk.mockResolvedValue({ id: 9, customerId: 99 });

      await expect(service.create({ ...(dto as object), projectId: 9 } as never)).rejects.toThrow(
        'โครงการที่ระบุไม่ได้เป็นของลูกค้ารายนี้',
      );
    });

    it('ระบุผู้แจ้งที่เป็นคนของลูกค้ารายอื่นไม่ได้', async () => {
      contactModel.findByPk.mockResolvedValue({ id: 2, customerId: 99 });

      await expect(
        service.create({ ...(dto as object), reportedByContactId: 2 } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('เวลาที่ลูกค้าแจ้งเป็นอนาคตไม่ได้', async () => {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      await expect(
        service.create({ ...(dto as object), reportedAt: tomorrow } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('เปิดใบใหม่เริ่มที่สถานะ RECEIVED เสมอ', async () => {
      let captured: { status: TicketStatus; resolutionCount: number } = {
        status: TicketStatus.CLOSED,
        resolutionCount: 9,
      };
      ticketModel.create.mockImplementation(
        (values: { status: TicketStatus; resolutionCount: number }) => {
          captured = values;
          return Promise.resolve(ticketRow());
        },
      );

      await service.create(dto);

      expect(captured.status).toBe(TicketStatus.RECEIVED);
      expect(captured.resolutionCount).toBe(0);
    });

    it('ไม่ระบุผู้รับเรื่อง = คนที่กดบันทึกคือผู้รับเรื่อง', async () => {
      let captured: { receivedByUserId: number | null } = { receivedByUserId: null };
      ticketModel.create.mockImplementation((values: { receivedByUserId: number | null }) => {
        captured = values;
        return Promise.resolve(ticketRow());
      });

      await runWithRequestContext(
        { userId: 42, ipAddress: null, userAgent: null, startedAt: Date.now() },
        () => service.create(dto),
      );

      expect(captured.receivedByUserId).toBe(42);
    });

    it('โยน 409 เมื่อเลขที่ใบซ้ำ และตรวจรวมรายการที่ถูกลบไปแล้ว', async () => {
      ticketModel.findOne.mockResolvedValue(ticketRow());

      await expect(
        service.create({ ...(dto as object), ticketNo: 'TK-2026-001' } as never),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(ticketModel.findOne).toHaveBeenCalledWith({
        where: { ticketNo: 'TK-2026-001' },
        paranoid: false,
      });
    });
  });

  // -------------------------------------------------------------------------
  // หน้าจอรอรับการแก้ไข
  // -------------------------------------------------------------------------
  // -------------------------------------------------------------------------
  // แก้ไขใบ — สำหรับกรณีคีย์ผิดตอนเปิดใบ
  // -------------------------------------------------------------------------
  describe('update', () => {
    it('ไม่เขียนสถานะหรือจำนวนรอบลงฐานข้อมูลเลย', async () => {
      // สถานะมีเจ้าของคือ assign / resolutions / reopen / close
      // ถ้าเส้นนี้แก้ได้ด้วย จะตั้งเป็น CLOSED โดยไม่เคยมีรอบการแก้ไขเลยก็ได้ (ขัด BR-04)
      const ticket = ticketRow();
      ticketModel.findByPk.mockResolvedValue(ticket);

      let captured: Record<string, unknown> = {};
      ticket.update.mockImplementation((values: Record<string, unknown>) => {
        captured = values;
        return Promise.resolve(undefined);
      });

      await service.update(7, { title: 'หัวข้อใหม่' });

      expect(Object.keys(captured)).not.toContain('status');
      expect(Object.keys(captured)).not.toContain('resolutionCount');
      expect(Object.keys(captured)).not.toContain('resolvedAt');
      expect(Object.keys(captured)).not.toContain('closedAt');
      expect(Object.keys(captured)).not.toContain('customerId');
    });

    it('ย้ายไปโครงการของลูกค้ารายอื่นไม่ได้', async () => {
      projectModel.findByPk.mockResolvedValue({ id: 9, customerId: 99 });

      await expect(service.update(7, { projectId: 9 })).rejects.toThrow(
        'โครงการที่ระบุไม่ได้เป็นของลูกค้ารายนี้',
      );
    });

    it('แก้เวลาที่ลูกค้าแจ้งเป็นเวลาในอนาคตไม่ได้', async () => {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      await expect(service.update(7, { reportedAt: tomorrow })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('บันทึกย้อนหลังยังทำได้ตามปกติ (BR-02)', async () => {
      const ticket = ticketRow();
      ticketModel.findByPk.mockResolvedValue(ticket);

      await service.update(7, { reportedAt: pastIso() });

      expect(ticket.update).toHaveBeenCalled();
    });

    it('ใบที่ปิดงานแล้วยังแก้ข้อมูลได้', async () => {
      // การพิมพ์หัวข้อผิดต้องแก้ได้เสมอ ไม่ว่าใบจะอยู่สถานะไหน
      // ต่างจากการ *เพิ่มรอบการแก้ไข* ที่ต้อง reopen ก่อน
      const ticket = ticketRow({ status: TicketStatus.CLOSED });
      ticketModel.findByPk.mockResolvedValue(ticket);

      await service.update(7, { title: 'แก้คำผิดหลังปิดงาน' });

      expect(ticket.update).toHaveBeenCalled();
    });

    it('เปลี่ยนประเภทการคิดเงินได้ เพราะ BR-07 ให้คนเป็นผู้ตัดสิน', async () => {
      const ticket = ticketRow();
      ticketModel.findByPk.mockResolvedValue(ticket);

      let captured: { billingType?: TicketBillingType } = {};
      ticket.update.mockImplementation((values: { billingType?: TicketBillingType }) => {
        captured = values;
        return Promise.resolve(undefined);
      });

      await service.update(7, { billingType: TicketBillingType.ONE_TIME });

      expect(captured.billingType).toBe(TicketBillingType.ONE_TIME);
    });

    it('ส่งเลขที่ใบเดิมมาไม่นับว่าเป็นการเปลี่ยน จึงไม่ต้องเช็คซ้ำ', async () => {
      const ticket = ticketRow({ ticketNo: 'TK-2026-001' });
      ticketModel.findByPk.mockResolvedValue(ticket);

      await service.update(7, { ticketNo: 'TK-2026-001' });

      expect(ticketModel.findOne).not.toHaveBeenCalled();
    });

    it('ไม่พบใบ → 404', async () => {
      ticketModel.findByPk.mockResolvedValue(null);

      await expect(service.update(99, { title: 'x' })).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('findPending', () => {
    it('เอาเฉพาะสามสถานะที่ยังไม่จบ', async () => {
      let captured: { status: Record<symbol, TicketStatus[]> } = { status: {} };
      ticketModel.findAndCountAll.mockImplementation(
        (options: { where: { status: Record<symbol, TicketStatus[]> } }) => {
          captured = options.where;
          return Promise.resolve({ rows: [], count: 0 });
        },
      );

      await service.findPending(queryDto());

      expect(captured.status[Op.in]).toEqual([
        TicketStatus.RECEIVED,
        TicketStatus.REOPENED,
        TicketStatus.IN_PROGRESS,
      ]);
    });

    it('ไม่มีทางหลุด CLOSED หรือ RESOLVED เข้ามา', async () => {
      let captured: { status: Record<symbol, TicketStatus[]> } = { status: {} };
      ticketModel.findAndCountAll.mockImplementation(
        (options: { where: { status: Record<symbol, TicketStatus[]> } }) => {
          captured = options.where;
          return Promise.resolve({ rows: [], count: 0 });
        },
      );

      await service.findPending(queryDto());

      expect(captured.status[Op.in]).not.toContain(TicketStatus.CLOSED);
      expect(captured.status[Op.in]).not.toContain(TicketStatus.RESOLVED);
    });

    it('เรียงงานด่วนขึ้นก่อน แล้วค้างนานสุดขึ้นก่อน', async () => {
      let captured: unknown[][] = [];
      ticketModel.findAndCountAll.mockImplementation((options: { order: unknown[][] }) => {
        captured = options.order;
        return Promise.resolve({ rows: [], count: 0 });
      });

      await service.findPending(queryDto());

      expect(captured[0]).toEqual(['priority', 'DESC']);
      expect(captured[1]).toEqual(['reportedAt', 'ASC']);
    });
  });

  // -------------------------------------------------------------------------
  // BR-04 — ปัญหาเดิมกลับมา ต้องอยู่ในใบเดิม
  // -------------------------------------------------------------------------
  describe('reopen', () => {
    it('พาใบเดิมกลับเข้าสถานะ REOPENED', async () => {
      const ticket = ticketRow({ status: TicketStatus.RESOLVED, resolutionCount: 1 });
      ticketModel.findByPk.mockResolvedValue(ticket);

      await service.reopen(7, { reason: 'อาการเดิมกลับมา' });

      expect(ticket.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: TicketStatus.REOPENED }),
      );
    });

    it('ไม่ล้างประวัติรอบที่แก้ไปแล้ว', async () => {
      // ประวัติต้องอยู่ครบ ค่าจะถูกเขียนทับเองเมื่อมีการแก้รอบใหม่
      const ticket = ticketRow({ status: TicketStatus.RESOLVED, resolutionCount: 2 });
      ticketModel.findByPk.mockResolvedValue(ticket);

      let captured: Record<string, unknown> = {};
      ticket.update.mockImplementation((values: Record<string, unknown>) => {
        captured = values;
        return Promise.resolve(ticket);
      });

      await service.reopen(7, {});

      expect(captured.resolutionCount).toBeUndefined();
      expect(captured.resolvedAt).toBeUndefined();
    });

    it('เปิดกลับมาซ้ำไม่ได้', async () => {
      ticketModel.findByPk.mockResolvedValue(ticketRow({ status: TicketStatus.REOPENED }));

      await expect(service.reopen(7, {})).rejects.toBeInstanceOf(ConflictException);
    });

    // Q9 ตัดสิน 11 ก.ย. — ปัญหาเดิมกลับมาหลังปิดงานแล้วก็ยังต้องเพิ่มรอบในใบเดิม (BR-04)
    it('ใบที่ปิดงานแล้วเปิดกลับมาในใบเดิมได้ และล้างเวลาปิดงาน', async () => {
      const ticket = ticketRow({
        status: TicketStatus.CLOSED,
        resolutionCount: 1,
        closedAt: new Date('2026-06-01T10:00:00Z'),
      });
      ticketModel.findByPk.mockResolvedValue(ticket);

      let captured: Record<string, unknown> = {};
      ticket.update.mockImplementation((values: Record<string, unknown>) => {
        captured = values;
        return Promise.resolve(ticket);
      });

      await service.reopen(7, { reason: 'อาการเดิมกลับมาหลังปิดงาน 3 เดือน' });

      expect(captured.status).toBe(TicketStatus.REOPENED);
      expect(captured.closedAt).toBeNull();
      // ประวัติรอบเดิมยังอยู่ รอบถัดไปนับต่อจากเดิม
      expect(captured.resolutionCount).toBeUndefined();
      expect(captured.resolvedAt).toBeUndefined();
    });

    it('เปิดกลับมาจาก RESOLVED ไม่แตะเวลาปิดงาน', async () => {
      const ticket = ticketRow({ status: TicketStatus.RESOLVED });
      ticketModel.findByPk.mockResolvedValue(ticket);

      let captured: Record<string, unknown> = {};
      ticket.update.mockImplementation((values: Record<string, unknown>) => {
        captured = values;
        return Promise.resolve(ticket);
      });

      await service.reopen(7, {});

      expect(captured).not.toHaveProperty('closedAt');
    });
  });

  // -------------------------------------------------------------------------
  // ปิดงาน
  // -------------------------------------------------------------------------
  describe('close', () => {
    it('ปิดแล้วบันทึกเวลาปิดให้', async () => {
      const ticket = ticketRow({ status: TicketStatus.RESOLVED });
      ticketModel.findByPk.mockResolvedValue(ticket);

      let captured: { status: TicketStatus; closedAt: Date } = {
        status: TicketStatus.RECEIVED,
        closedAt: new Date(0),
      };
      ticket.update.mockImplementation((values: { status: TicketStatus; closedAt: Date }) => {
        captured = values;
        return Promise.resolve(ticket);
      });

      await service.close(7, {});

      expect(captured.status).toBe(TicketStatus.CLOSED);
      expect(captured.closedAt).toBeInstanceOf(Date);
    });

    it('ปิดจากสถานะที่ยังไม่ได้แก้ก็ได้ เผื่อเคสที่ไม่ใช่ปัญหาของเรา', async () => {
      ticketModel.findByPk.mockResolvedValue(ticketRow({ status: TicketStatus.RECEIVED }));

      await expect(service.close(7, {})).resolves.toBeDefined();
    });

    it('ปิดซ้ำไม่ได้', async () => {
      ticketModel.findByPk.mockResolvedValue(ticketRow({ status: TicketStatus.CLOSED }));

      await expect(service.close(7, {})).rejects.toBeInstanceOf(ConflictException);
    });
  });

  // -------------------------------------------------------------------------
  // มอบหมายผู้รับผิดชอบ
  // -------------------------------------------------------------------------
  describe('assign', () => {
    it('ใบที่ยัง RECEIVED ถูกเลื่อนเป็น IN_PROGRESS ให้เอง', async () => {
      const ticket = ticketRow({ status: TicketStatus.RECEIVED });
      ticketModel.findByPk.mockResolvedValue(ticket);

      await service.assign(7, { assignedUserId: 4 });

      expect(ticket.update).toHaveBeenCalledWith(
        expect.objectContaining({ assignedUserId: 4, status: TicketStatus.IN_PROGRESS }),
      );
    });

    it('ใบที่ปัญหาเดิมกลับมา (REOPENED) ถูกเลื่อนเป็น IN_PROGRESS เมื่อมอบหมาย (BR-04)', async () => {
      // เดิมไม่มีทางไป IN_PROGRESS เลย ใบจึงค้าง REOPENED จนบันทึกรอบถัดไป
      // หน้าจอรอรับการแก้ไขแยกไม่ออกว่า "ยังไม่มีใครหยิบ" หรือ "กำลังแก้รอบใหม่"
      const ticket = ticketRow({ status: TicketStatus.REOPENED, assignedUserId: 4 });
      ticketModel.findByPk.mockResolvedValue(ticket);

      // หยิบงานรอบใหม่ = มอบหมายซ้ำ แม้เป็นคนเดิม
      await service.assign(7, { assignedUserId: 4 });

      expect(ticket.update).toHaveBeenCalledWith(
        expect.objectContaining({ assignedUserId: 4, status: TicketStatus.IN_PROGRESS }),
      );
    });

    it('ถอนการมอบหมายใบ REOPENED ไม่ทำให้เลื่อนเป็น IN_PROGRESS', async () => {
      const ticket = ticketRow({ status: TicketStatus.REOPENED, assignedUserId: 4 });
      ticketModel.findByPk.mockResolvedValue(ticket);

      let captured: Record<string, unknown> = {};
      ticket.update.mockImplementation((values: Record<string, unknown>) => {
        captured = values;
        return Promise.resolve(ticket);
      });

      await service.assign(7, { assignedUserId: null });

      expect(captured.status).toBeUndefined();
    });

    it('ไม่ไปแตะสถานะของใบที่เดินไปไกลแล้ว', async () => {
      const ticket = ticketRow({ status: TicketStatus.RESOLVED });
      ticketModel.findByPk.mockResolvedValue(ticket);

      let captured: Record<string, unknown> = {};
      ticket.update.mockImplementation((values: Record<string, unknown>) => {
        captured = values;
        return Promise.resolve(ticket);
      });

      await service.assign(7, { assignedUserId: 4 });

      expect(captured.status).toBeUndefined();
    });

    it('ถอนการมอบหมายได้ และไม่ย้อนสถานะกลับ', async () => {
      const ticket = ticketRow({ status: TicketStatus.IN_PROGRESS, assignedUserId: 4 });
      ticketModel.findByPk.mockResolvedValue(ticket);

      let captured: Record<string, unknown> = {};
      ticket.update.mockImplementation((values: Record<string, unknown>) => {
        captured = values;
        return Promise.resolve(ticket);
      });

      await service.assign(7, { assignedUserId: null });

      expect(captured.assignedUserId).toBeNull();
      expect(captured.status).toBeUndefined();
    });

    it('มอบหมายให้พนักงานที่ลาออกแล้วไม่ได้', async () => {
      // ต่างจากการบันทึกย้อนหลัง — นี่คือการมอบงานใหม่ ต้องเป็นคนที่ยังทำงานอยู่
      userModel.findByPk.mockResolvedValue({ id: 4, status: UserStatus.RESIGNED });

      await expect(service.assign(7, { assignedUserId: 4 })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('มอบหมายใบที่ปิดงานแล้วไม่ได้', async () => {
      ticketModel.findByPk.mockResolvedValue(ticketRow({ status: TicketStatus.CLOSED }));

      await expect(service.assign(7, { assignedUserId: 4 })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  it('โยน 404 เมื่อดูรายละเอียดใบที่ไม่มีอยู่', async () => {
    ticketModel.findByPk.mockResolvedValue(null);

    await expect(service.findOne(999)).rejects.toThrow('ไม่พบรายการปัญหานี้');
  });
});
