/// <reference types="jest" />
// TypeScript 6 ไม่ดึง @types/jest เข้ามาให้อัตโนมัติ ต้องอ้างถึงตรงนี้เหมือน spec ตัวอื่น

import type { ConfigService } from '@nestjs/config';
import { Op } from 'sequelize';

import {
  MaAddon,
  MaContract,
  MaContractStatus,
  MaUsage,
  Ticket,
  TicketBillingType,
} from '../../models';
import { MaQuotaService, QuotaResetMode } from './ma-quota.service';

/**
 * ตรรกะโควตา MA (CLAUDE.md 9.2)
 *
 * ⚠ จุดที่ต้องระวังที่สุด — `ma_usages.ticket_id` เป็น UNIQUE index ที่ระดับฐานข้อมูล
 * แปลว่า 1 ปัญหาหักโควตาได้ครั้งเดียว ไม่ว่าจะแก้กี่รอบ ถ้าใครไปแก้ให้สร้างแถวใหม่
 * ทุกรอบตาม CLAUDE.md 9.1 แบบตรงตัว การแก้รอบที่ 2 จะพังด้วย duplicate key
 * เทสต์ในนี้ปักหมุดพฤติกรรมนั้นไว้
 */

interface ModelMock {
  findByPk: jest.Mock;
  findOne: jest.Mock;
  findAll: jest.Mock;
  create: jest.Mock;
  count: jest.Mock;
}

function modelMock(): ModelMock {
  return {
    findByPk: jest.fn(),
    findOne: jest.fn(),
    findAll: jest.fn(),
    create: jest.fn(),
    count: jest.fn(),
  };
}

const TRANSACTION = { name: 'tx' };

function contractRow(overrides: Record<string, unknown> = {}): MaContract {
  return {
    id: 2,
    projectId: 1,
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    status: MaContractStatus.ACTIVE,
    plan: { bugQuotaPerMonth: 5 },
    ...overrides,
  } as unknown as MaContract;
}

function ticketRow(overrides: Record<string, unknown> = {}): Ticket {
  return {
    id: 7,
    projectId: 1,
    billingType: TicketBillingType.MA_QUOTA,
    maContractId: null,
    ...overrides,
  } as unknown as Ticket;
}

function configWith(mode: string | undefined): ConfigService {
  return { get: jest.fn().mockReturnValue(mode) } as unknown as ConfigService;
}

describe('MaQuotaService', () => {
  let contractModel: ModelMock;
  let usageModel: ModelMock;
  let addonModel: ModelMock;

  function build(mode?: string): MaQuotaService {
    return new MaQuotaService(
      contractModel as unknown as typeof MaContract,
      usageModel as unknown as typeof MaUsage,
      addonModel as unknown as typeof MaAddon,
      configWith(mode),
    );
  }

  beforeEach(() => {
    contractModel = modelMock();
    usageModel = modelMock();
    addonModel = modelMock();

    contractModel.findAll.mockResolvedValue([]);
    contractModel.findByPk.mockResolvedValue(contractRow());
    usageModel.findOne.mockResolvedValue(null);
    usageModel.count.mockResolvedValue(0);
    usageModel.create.mockImplementation((values: Record<string, unknown>) =>
      Promise.resolve({ id: 50, ...values }),
    );
    addonModel.findAll.mockResolvedValue([]);
  });

  // -------------------------------------------------------------------------
  // 1 ปัญหา หักโควตาได้ครั้งเดียว
  // -------------------------------------------------------------------------
  describe('recordUsageForTicket', () => {
    const options = () => ({
      resolutionId: 101,
      usedAt: new Date(2026, 8, 15),
      transaction: TRANSACTION as never,
    });

    it('หักโควตาให้ในรอบแรก', async () => {
      contractModel.findAll.mockResolvedValue([contractRow()]);

      const result = await build().recordUsageForTicket(ticketRow(), options());

      expect(result.usage).not.toBeNull();
      expect(usageModel.create).toHaveBeenCalledTimes(1);
    });

    it('ไม่หักซ้ำเมื่อแก้รอบที่ 2 ของใบเดิม', async () => {
      // ma_usages.ticket_id เป็น UNIQUE — ถ้าสร้างซ้ำจะพังด้วย duplicate key
      // เป็น error ภาษาอังกฤษจาก MySQL ซึ่งขัดทั้ง BR-04 และ CLAUDE.md 6.5
      usageModel.findOne.mockResolvedValue({ id: 50, ticketId: 7 });

      const result = await build().recordUsageForTicket(ticketRow(), options());

      expect(result.usage).toBeNull();
      expect(usageModel.create).not.toHaveBeenCalled();
    });

    it('ไม่แตะโควตาเลยเมื่อ billing_type ไม่ใช่ MA_QUOTA', async () => {
      const result = await build().recordUsageForTicket(
        ticketRow({ billingType: TicketBillingType.WARRANTY }),
        options(),
      );

      expect(result.usage).toBeNull();
      expect(usageModel.findOne).not.toHaveBeenCalled();
    });

    it('ไม่หักอะไรเมื่อหาสัญญาที่คุ้มครองไม่เจอ', async () => {
      contractModel.findAll.mockResolvedValue([]);

      const result = await build().recordUsageForTicket(ticketRow(), options());

      expect(result.usage).toBeNull();
      expect(usageModel.create).not.toHaveBeenCalled();
    });

    it('ยึดสัญญาที่ผูกไว้กับใบตั้งแต่ตอนเปิด ถ้ามี', async () => {
      // เป็นสิ่งที่คนตัดสินใจไว้แล้วตอนเปิดใบ ระบบไม่ควรไปเลือกใหม่ให้
      await build().recordUsageForTicket(ticketRow({ maContractId: 9 }), options());

      expect(contractModel.findByPk).toHaveBeenCalledWith(9, expect.anything());
      expect(contractModel.findAll).not.toHaveBeenCalled();
    });

    it('ตั้งธงเกินโควตาเมื่อใช้ครบแล้ว', async () => {
      contractModel.findAll.mockResolvedValue([contractRow({ plan: { bugQuotaPerMonth: 3 } })]);
      usageModel.count.mockResolvedValue(3);

      let captured: { isOverQuota: boolean } = { isOverQuota: false };
      usageModel.create.mockImplementation((values: { isOverQuota: boolean }) => {
        captured = values;
        return Promise.resolve({ id: 50 });
      });

      await build().recordUsageForTicket(ticketRow(), options());

      expect(captured.isOverQuota).toBe(true);
    });

    it('ยังไม่เกินโควตาเมื่อใช้ไปน้อยกว่าที่มี', async () => {
      contractModel.findAll.mockResolvedValue([contractRow({ plan: { bugQuotaPerMonth: 5 } })]);
      usageModel.count.mockResolvedValue(2);

      let captured: { isOverQuota: boolean } = { isOverQuota: true };
      usageModel.create.mockImplementation((values: { isOverQuota: boolean }) => {
        captured = values;
        return Promise.resolve({ id: 50 });
      });

      await build().recordUsageForTicket(ticketRow(), options());

      expect(captured.isOverQuota).toBe(false);
    });

    it('ค่าบริการส่วนเกินเป็น 0 เมื่อไม่ได้กรอกมา ไม่ใช่ไปเดาแทน', async () => {
      // ยังไม่มีที่เก็บอัตราค่าบริการส่วนเกินในระบบ ระบบบอกได้แค่ว่าเกินโควตา
      contractModel.findAll.mockResolvedValue([contractRow()]);

      let captured: { extraCharge: string } = { extraCharge: '' };
      usageModel.create.mockImplementation((values: { extraCharge: string }) => {
        captured = values;
        return Promise.resolve({ id: 50 });
      });

      await build().recordUsageForTicket(ticketRow(), options());

      expect(captured.extraCharge).toBe('0');
    });
  });

  // -------------------------------------------------------------------------
  // Q2 — ตอบแล้ว 9 ก.ย. 2026: รอบโควตานับจากวันเริ่มสัญญา
  // -------------------------------------------------------------------------
  describe('resolvePeriod', () => {
    it('ค่าเริ่มต้นเป็น CONTRACT_ANNIVERSARY เมื่อไม่ได้ตั้ง env (Q2)', () => {
      expect(build(undefined).resetMode).toBe(QuotaResetMode.CONTRACT_ANNIVERSARY);
    });

    it('ค่า env ที่สะกดผิดตกไปที่ CONTRACT_ANNIVERSARY ไม่ใช่เงียบ ๆ ไปโหมดอื่น', () => {
      // ตั้งค่าผิดต้องได้พฤติกรรมที่ตกลงกันไว้ ไม่ใช่พฤติกรรมที่ไม่มีใครเลือก
      expect(build('CALENDER_MONTH').resetMode).toBe(QuotaResetMode.CONTRACT_ANNIVERSARY);
    });

    it('CALENDAR_MONTH ใช้ปีและเดือนของวันที่นั้น และรอบคือทั้งเดือนปฏิทิน', () => {
      const period = build(QuotaResetMode.CALENDAR_MONTH).resolvePeriod(
        contractRow({ startDate: '2026-01-15' }),
        new Date(2026, 8, 3),
      );

      expect(period).toEqual({
        periodYear: 2026,
        periodMonth: 9,
        periodStart: '2026-09-01',
        periodEnd: '2026-09-30',
      });
    });

    it('CONTRACT_ANNIVERSARY นับรอบจากวันเริ่มสัญญา', () => {
      // สัญญาเริ่ม 15 ม.ค. วันที่ 20 ก.ย. จึงอยู่ในรอบ "15 ก.ย. - 14 ต.ค." = 2026-09
      const period = build(QuotaResetMode.CONTRACT_ANNIVERSARY).resolvePeriod(
        contractRow({ startDate: '2026-01-15' }),
        new Date(2026, 8, 20),
      );

      expect(period).toEqual({
        periodYear: 2026,
        periodMonth: 9,
        periodStart: '2026-09-15',
        periodEnd: '2026-10-14',
      });
    });

    it('CONTRACT_ANNIVERSARY ถอยไปรอบก่อนหน้าเมื่อยังไม่ถึงวันครบรอบ', () => {
      // วันที่ 3 ก.ย. ยังไม่ถึงวันที่ 15 จึงยังอยู่ในรอบ "15 ส.ค. - 14 ก.ย." = 2026-08
      const period = build(QuotaResetMode.CONTRACT_ANNIVERSARY).resolvePeriod(
        contractRow({ startDate: '2026-01-15' }),
        new Date(2026, 8, 3),
      );

      expect(period).toEqual({
        periodYear: 2026,
        periodMonth: 8,
        periodStart: '2026-08-15',
        periodEnd: '2026-09-14',
      });
    });

    it('วันแรกของรอบนับเป็นรอบใหม่แล้ว ไม่ใช่วันสุดท้ายของรอบเดิม', () => {
      const period = build(QuotaResetMode.CONTRACT_ANNIVERSARY).resolvePeriod(
        contractRow({ startDate: '2026-01-15' }),
        new Date(2026, 8, 15),
      );

      expect(period.periodStart).toBe('2026-09-15');
    });

    it('CONTRACT_ANNIVERSARY ข้ามปีได้ถูกต้อง', () => {
      const period = build(QuotaResetMode.CONTRACT_ANNIVERSARY).resolvePeriod(
        contractRow({ startDate: '2026-11-10' }),
        new Date(2027, 0, 20),
      );

      expect(period).toEqual({
        periodYear: 2027,
        periodMonth: 1,
        periodStart: '2027-01-10',
        periodEnd: '2027-02-09',
      });
    });

    it('สัญญาที่เริ่มวันที่ 31 หนีบลงวันสุดท้ายของเดือนที่สั้นกว่า', () => {
      // 31 ม.ค. + 1 เดือน = 28 ก.พ. ไม่ใช่ 3 มี.ค. — สูตรเดียวกับวันหมดประกันใน Phase 6
      // เคสนี้คือจุดที่การเทียบด้วย "วันที่ >= 31" จะพัง เพราะ ก.พ. ไม่มีวันที่ 31 เลย
      const period = build(QuotaResetMode.CONTRACT_ANNIVERSARY).resolvePeriod(
        contractRow({ startDate: '2026-01-31' }),
        new Date(2026, 1, 28),
      );

      expect(period).toEqual({
        periodYear: 2026,
        periodMonth: 2,
        periodStart: '2026-02-28',
        periodEnd: '2026-03-30',
      });
    });

    it('วันก่อนวันครบรอบที่ถูกหนีบ ยังอยู่ในรอบก่อนหน้า', () => {
      const period = build(QuotaResetMode.CONTRACT_ANNIVERSARY).resolvePeriod(
        contractRow({ startDate: '2026-01-31' }),
        new Date(2026, 1, 27),
      );

      expect(period.periodStart).toBe('2026-01-31');
      expect(period.periodEnd).toBe('2026-02-27');
    });

    it('วันเริ่มสัญญาเองตกอยู่ในรอบแรก', () => {
      const period = build(QuotaResetMode.CONTRACT_ANNIVERSARY).resolvePeriod(
        contractRow({ startDate: '2026-01-15' }),
        new Date(2026, 0, 15),
      );

      expect(period.periodStart).toBe('2026-01-15');
      expect(period.periodYear).toBe(2026);
      expect(period.periodMonth).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // โควตารวม = แผน + addon
  // -------------------------------------------------------------------------
  describe('resolveQuota', () => {
    it('บวกโควตาจาก addon เข้ากับโควตาของแผน', async () => {
      addonModel.findAll.mockResolvedValue([{ extraQuota: 3 }, { extraQuota: 2 }]);

      const quota = await build().resolveQuota(contractRow({ plan: { bugQuotaPerMonth: 5 } }), {
        periodYear: 2026,
        periodMonth: 9,
      });

      expect(quota).toBe(10);
    });

    it('นับ addon ที่ไม่ระบุรอบว่ามีผลตลอดอายุสัญญา', async () => {
      let captured: { [Op.or]: unknown[] } = { [Op.or]: [] };
      addonModel.findAll.mockImplementation((options: { where: { [Op.or]: unknown[] } }) => {
        captured = options.where;
        return Promise.resolve([]);
      });

      await build().resolveQuota(contractRow(), { periodYear: 2026, periodMonth: 9 });

      expect(captured[Op.or]).toContainEqual({ effectiveYear: null, effectiveMonth: null });
      expect(captured[Op.or]).toContainEqual({ effectiveYear: 2026, effectiveMonth: 9 });
    });

    it('ได้ 0 เมื่อสัญญาไม่มีแผนผูกอยู่', async () => {
      const quota = await build().resolveQuota(contractRow({ plan: null }), {
        periodYear: 2026,
        periodMonth: 9,
      });

      expect(quota).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Q4 — โครงการมีสัญญา ACTIVE ซ้อนกันได้ไหม ยังไม่สรุป
  // -------------------------------------------------------------------------
  describe('findActiveContract', () => {
    it('ค้นสัญญา ACTIVE/EXPIRED ที่ครอบคลุมวันที่นั้น (EXPIRED = เคย ACTIVE — หักย้อนหลังต้องเจอ)', async () => {
      let captured: {
        projectId: number;
        status: Record<symbol, MaContractStatus[]>;
        startDate: Record<symbol, string>;
        endDate: Record<symbol, string>;
      } = { projectId: 0, status: {}, startDate: {}, endDate: {} };

      contractModel.findAll.mockImplementation(
        (options: {
          where: {
            projectId: number;
            status: Record<symbol, MaContractStatus[]>;
            startDate: Record<symbol, string>;
            endDate: Record<symbol, string>;
          };
        }) => {
          captured = options.where;
          return Promise.resolve([]);
        },
      );

      await build().findActiveContract(1, new Date(2026, 8, 15));

      expect(captured.projectId).toBe(1);
      expect(captured.status[Op.in]).toEqual([MaContractStatus.ACTIVE, MaContractStatus.EXPIRED]);
      expect(captured.startDate[Op.lte]).toBe('2026-09-15');
      expect(captured.endDate[Op.gte]).toBe('2026-09-15');
    });

    it('เลือกฉบับที่หมดช้าที่สุดเมื่อมีหลายฉบับซ้อนกัน', async () => {
      const longest = contractRow({ id: 3, endDate: '2027-12-31' });
      contractModel.findAll.mockResolvedValue([longest, contractRow({ id: 2 })]);

      const contract = await build().findActiveContract(1);

      expect(contract?.id).toBe(3);
    });

    it('คืน null เมื่อไม่มีสัญญาที่คุ้มครอง', async () => {
      contractModel.findAll.mockResolvedValue([]);

      await expect(build().findActiveContract(1)).resolves.toBeNull();
    });
  });
});
