/// <reference types="jest" />
// TypeScript 6 ไม่ดึง @types/jest เข้ามาให้อัตโนมัติ ต้องอ้างถึงตรงนี้เหมือน spec ตัวอื่น

import { NotFoundException } from '@nestjs/common';
import { Op } from 'sequelize';

import {
  Customer,
  FollowUp,
  MaAddon,
  MaContract,
  MaContractStatus,
  Project,
  ProjectStatus,
  Ticket,
  TicketBillingType,
  TicketResolution,
  Warranty,
} from '../../models';
import { ReportsService } from './reports.service';

/**
 * M10 รายงาน + M1-05/M1-06 (ทำ 10 ก.ย. 2026)
 *
 * กฎที่เทสต์ชุดนี้ปักหมุดไว้ — ทั้งหมดเป็นเรื่อง "ความหมายของตัวเลข" ไม่ใช่เรื่องสูตร
 *
 *   1. ทุกตัวเลขเงินคือ **มูลค่าตามสัญญา** ไม่ใช่เงินที่ได้รับจริง (ต้องมี disclaimer เสมอ)
 *   2. รายการที่ CANCELLED ถูกตัดจากยอดหลัก แต่ยกมาแสดงแยกให้ตรวจย้อนหลังได้
 *   3. ของเสริมถูกตัดตามสถานะของสัญญาแม่ เพราะ ma_addons ไม่มีคอลัมน์ status
 *   4. **ค่าว่างของ hours_spent และ extra_charge ห้ามนับเป็น 0** ต้องกันออกแล้วรายงาน
 *      ความครบถ้วนแทน — ถ้านับเป็น 0 ตัวเลขจะต่ำกว่าความจริงโดยไม่มีใครรู้
 *   5. สัญญาซ้อนทับ — ตรวจจับและรายงานเท่านั้น ไม่แก้ ไม่ลบ ไม่รวม ไม่เลือกแทน (Q4)
 *   6. "ยังคุ้มครองอยู่ไหม" ต้องเทียบช่วงวันซ้ำ ไม่เชื่อ status อย่างเดียว
 */

interface ModelMock {
  findAll: jest.Mock;
  findByPk: jest.Mock;
}

function modelMock(rows: unknown[] = []): ModelMock {
  return {
    findAll: jest.fn().mockResolvedValue(rows),
    findByPk: jest.fn().mockResolvedValue(null),
  };
}

const TODAY = new Date();
const dateOnly = (offsetDays: number): string => {
  const d = new Date(TODAY);
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function projectRow(o: Record<string, unknown> = {}): Project {
  return {
    id: 1,
    customerId: 1,
    name: 'โครงการทดสอบ',
    code: 'PRJ-1',
    status: ProjectStatus.IN_PROGRESS,
    contractValue: '100000.00',
    targetEndDate: null,
    ...o,
  } as unknown as Project;
}

function contractRow(o: Record<string, unknown> = {}): MaContract {
  return {
    id: 10,
    customerId: 1,
    projectId: 1,
    contractNo: 'MA-1',
    status: MaContractStatus.ACTIVE,
    price: '50000.00',
    startDate: dateOnly(-30),
    endDate: dateOnly(330),
    customer: { id: 1, name: 'ลูกค้าทดสอบ' },
    project: { id: 1, name: 'โครงการทดสอบ' },
    ...o,
  } as unknown as MaContract;
}

function addonRow(o: Record<string, unknown> = {}): MaAddon {
  return { id: 100, contractId: 10, price: '5000.00', ...o } as unknown as MaAddon;
}

function ticketRow(o: Record<string, unknown> = {}): Ticket {
  return {
    id: 7,
    customerId: 1,
    billingType: TicketBillingType.ONE_TIME,
    extraCharge: '3000.00',
    customer: { id: 1, name: 'ลูกค้าทดสอบ' },
    ...o,
  } as unknown as Ticket;
}

function resolutionRow(o: Record<string, unknown> = {}): TicketResolution {
  return { id: 1, ticketId: 7, hoursSpent: '4.00', ...o } as unknown as TicketResolution;
}

describe('ReportsService', () => {
  const build = (models: {
    customers?: unknown[];
    projects?: unknown[];
    contracts?: unknown[];
    addons?: unknown[];
    tickets?: unknown[];
    resolutions?: unknown[];
    warranties?: unknown[];
    followUps?: unknown[];
  }) => {
    const customerModel = modelMock(
      models.customers ?? [{ id: 1, name: 'ลูกค้าทดสอบ', code: 'C1' }],
    );
    const projectModel = modelMock(models.projects ?? []);
    const contractModel = modelMock(models.contracts ?? []);
    const addonModel = modelMock(models.addons ?? []);
    const ticketModel = modelMock(models.tickets ?? []);
    const resolutionModel = modelMock(models.resolutions ?? []);
    const warrantyModel = modelMock(models.warranties ?? []);
    const followUpModel = modelMock(models.followUps ?? []);

    const service = new ReportsService(
      customerModel as unknown as typeof Customer,
      projectModel as unknown as typeof Project,
      contractModel as unknown as typeof MaContract,
      addonModel as unknown as typeof MaAddon,
      ticketModel as unknown as typeof Ticket,
      resolutionModel as unknown as typeof TicketResolution,
      warrantyModel as unknown as typeof Warranty,
      followUpModel as unknown as typeof FollowUp,
    );

    return { service, customerModel, contractModel };
  };

  // =========================================================================
  // ความหมายของตัวเลข — มูลค่าตามสัญญา ไม่ใช่เงินที่ได้รับจริง
  // =========================================================================
  describe('ความหมายของตัวเลขเงิน', () => {
    it('ทุกรายงานแนบคำเตือนว่าเป็นมูลค่าตามสัญญา ไม่ใช่เงินที่ได้รับจริง', async () => {
      const { service } = build({ projects: [projectRow()] });

      for (const report of [
        await service.contractValueByCustomer({}),
        await service.contractValueByType({}),
        await service.upcomingContractValue(),
      ]) {
        expect(report.disclaimer).toContain('มูลค่าตามสัญญา');
        expect(report.disclaimer).toContain('ไม่ใช่เงินที่ได้รับจริง');
      }
    });

    it('ไม่มีฟิลด์ที่สื่อว่าเป็นเงินที่รับมาจริงหลุดออกไป', async () => {
      // ระบบนี้ไม่ใช่ระบบบัญชี (SC-3, OS-03) ถ้าวันหนึ่งมีใครเติมฟิลด์พวกนี้เข้ามา
      // แปลว่าขอบเขตถูกขยายโดยไม่ได้ตั้งใจ
      const { service } = build({ projects: [projectRow()] });
      const report = await service.contractValueByType({});
      const keys = Object.keys(report).join(' ').toLowerCase();

      for (const forbidden of ['paid', 'payment', 'received', 'revenue', 'invoice', 'cash']) {
        expect(keys).not.toContain(forbidden);
      }
    });
  });

  // =========================================================================
  // CANCELLED — ตัดจากยอดหลัก แต่ยกมาแสดงแยก
  // =========================================================================
  describe('รายการที่ยกเลิก', () => {
    it('โครงการที่ยกเลิกไม่ถูกนับในยอดหลัก แต่แสดงแยกให้ตรวจได้', async () => {
      const { service } = build({
        projects: [
          projectRow({ id: 1, contractValue: '100000.00' }),
          projectRow({ id: 2, status: ProjectStatus.CANCELLED, contractValue: '70000.00' }),
        ],
      });

      const report = await service.contractValueByType({});

      expect(report.projectContractValue).toBe('100000.00');
      expect(report.projectCount).toBe(1);
      expect(report.excludedCancelledValue).toBe('70000.00');
      expect(report.excludedCancelledCount).toBe(1);
    });

    it('สัญญาที่ยกเลิกถูกตัด และของเสริมของสัญญานั้นถูกตัดตามไปด้วย', async () => {
      // ma_addons ไม่มีคอลัมน์ status ของตัวเอง จึงต้องดูสถานะของสัญญาแม่
      const { service } = build({
        contracts: [
          contractRow({ id: 10, price: '50000.00' }),
          contractRow({ id: 11, status: MaContractStatus.CANCELLED, price: '30000.00' }),
        ],
        addons: [
          addonRow({ id: 100, contractId: 10, price: '5000.00' }),
          addonRow({ id: 101, contractId: 11, price: '2000.00' }),
        ],
      });

      const report = await service.contractValueByType({});

      expect(report.maContractValue).toBe('50000.00');
      expect(report.maAddonValue).toBe('5000.00');
      // 30000 ของสัญญา + 2000 ของ addon ที่ผูกอยู่ใต้สัญญานั้น
      expect(report.excludedCancelledValue).toBe('32000.00');
      expect(report.excludedCancelledCount).toBe(2);
    });

    it('สัญญาที่ถูกต่อไปแล้ว (RENEWED) ยังถูกนับ เพราะเคยมีมูลค่าจริง', async () => {
      // ตัดเฉพาะ CANCELLED ตามที่ตกลงไว้ ไม่เพิ่มกฎเอง
      const { service } = build({
        contracts: [contractRow({ status: MaContractStatus.RENEWED, price: '40000.00' })],
      });

      const report = await service.contractValueByType({});

      expect(report.maContractValue).toBe('40000.00');
      expect(report.excludedCancelledCount).toBe(0);
    });
  });

  // =========================================================================
  // ค่าว่างห้ามนับเป็น 0
  // =========================================================================
  describe('ความครบถ้วนของข้อมูล', () => {
    it('ใบรายครั้งที่ยังไม่กรอกค่าบริการไม่ถูกนับเป็น 0 แต่รายงานความครบถ้วนแทน', async () => {
      const { service } = build({
        tickets: [
          ticketRow({ id: 1, extraCharge: '3000.00' }),
          ticketRow({ id: 2, extraCharge: null }),
          ticketRow({ id: 3, extraCharge: null }),
          ticketRow({ id: 4, extraCharge: null }),
        ],
      });

      const report = await service.contractValueByType({});

      expect(report.oneTimeChargeValue).toBe('3000.00');
      expect(report.oneTimeCompleteness).toEqual({
        total: 4,
        withData: 1,
        withoutData: 3,
        completeness: 25,
      });
    });

    it('รอบการแก้ไขที่ไม่ได้กรอกเวลาไม่ถูกนับเป็น 0 ชั่วโมง (M10-05)', async () => {
      const { service } = build({
        tickets: [ticketRow({ id: 7 })],
        resolutions: [
          resolutionRow({ id: 1, hoursSpent: '4.00' }),
          resolutionRow({ id: 2, hoursSpent: '8.00' }),
          resolutionRow({ id: 3, hoursSpent: null }),
          resolutionRow({ id: 4, hoursSpent: null }),
        ],
      });

      const report = await service.serviceCost({});

      expect(report.totalHours).toBe('12.00');
      expect(report.completeness).toEqual({
        total: 4,
        withData: 2,
        withoutData: 2,
        completeness: 50,
      });
    });

    it('ไม่มีข้อมูลเลย → ความครบถ้วนเป็น 0 ไม่ใช่หารด้วยศูนย์', async () => {
      const { service } = build({});
      const report = await service.serviceCost({});

      expect(report.completeness.completeness).toBe(0);
      expect(report.totalHours).toBe('0.00');
    });

    it('คำเตือนของ M10-05 บอกชัดว่าไม่ได้นับค่าว่างเป็นศูนย์', async () => {
      const { service } = build({});
      const report = await service.serviceCost({});

      expect(report.disclaimer).toContain('ไม่ได้ถูกนับเป็น 0');
    });
  });

  // =========================================================================
  // M10-04 — ไม่เชื่อ status อย่างเดียว
  // =========================================================================
  describe('สัญญาที่ยังไม่หมดอายุ (M10-04)', () => {
    it('query เทียบช่วงวันซ้ำ ไม่ได้กรองด้วย status อย่างเดียว', async () => {
      // ยังไม่มี scheduler ปรับเป็น EXPIRED สัญญาที่หมดอายุแล้วจึงค้างเป็น ACTIVE
      // ถ้ากรองด้วย status อย่างเดียว ยอดคาดการณ์จะเกินจริง
      let captured: Record<string, unknown> = {};
      const { service, contractModel } = build({ contracts: [] });
      contractModel.findAll.mockImplementation((options: { where: Record<string, unknown> }) => {
        captured = options.where;
        return Promise.resolve([]);
      });

      await service.upcomingContractValue();

      const where = captured;

      expect(where.status).toBe(MaContractStatus.ACTIVE);
      expect(Object.keys(where)).toContain('startDate');
      expect(Object.keys(where)).toContain('endDate');
    });
  });

  // =========================================================================
  // สัญญาซ้อนทับ — ตรวจจับและรายงานเท่านั้น
  // =========================================================================
  describe('การตรวจสัญญาซ้อนทับ', () => {
    it('รายงานคู่ที่ซ้อนกันพร้อมช่วงวันของแต่ละฉบับ', async () => {
      const { service } = build({
        contracts: [
          contractRow({ id: 1, startDate: '2026-01-01', endDate: '2026-12-31' }),
          contractRow({ id: 2, startDate: '2026-07-01', endDate: '2027-06-30' }),
        ],
      });

      const report = await service.contractOverlaps({});

      expect(report.customerCount).toBe(1);
      expect(report.items[0].overlappingContractCount).toBe(2);
      expect(report.items[0].overlappingPairs).toEqual([[1, 2]]);
      expect(report.items[0].contracts[0].startDate).toBe('2026-01-01');
      expect(report.items[0].contracts[1].endDate).toBe('2027-06-30');
    });

    it('ช่วงที่ไม่คาบเกี่ยวกันไม่ถูกรายงาน', async () => {
      const { service } = build({
        contracts: [
          contractRow({ id: 1, startDate: '2026-01-01', endDate: '2026-06-30' }),
          contractRow({ id: 2, startDate: '2026-07-01', endDate: '2026-12-31' }),
        ],
      });

      expect((await service.contractOverlaps({})).customerCount).toBe(0);
    });

    it('ต่อกันพอดีวันเดียวถือว่าซ้อน เพราะวันนั้นมีสองสัญญาคุ้มครองพร้อมกัน', async () => {
      const { service } = build({
        contracts: [
          contractRow({ id: 1, startDate: '2026-01-01', endDate: '2026-06-30' }),
          contractRow({ id: 2, startDate: '2026-06-30', endDate: '2026-12-31' }),
        ],
      });

      expect((await service.contractOverlaps({})).customerCount).toBe(1);
    });

    it('สัญญาคนละลูกค้าไม่นับว่าซ้อนกัน', async () => {
      const { service } = build({
        contracts: [
          contractRow({ id: 1, customerId: 1, startDate: '2026-01-01', endDate: '2026-12-31' }),
          contractRow({ id: 2, customerId: 2, startDate: '2026-01-01', endDate: '2026-12-31' }),
        ],
      });

      expect((await service.contractOverlaps({})).customerCount).toBe(0);
    });

    it('สัญญาที่ยกเลิกหรือถูกต่อไปแล้วไม่ถูกนับว่าซ้อน', async () => {
      // ไม่มีผลกับยอดรวมอยู่แล้ว จึงไม่ควรไปสร้างสัญญาณเตือนหลอก
      const { service, contractModel } = build({ contracts: [] });

      // Op.notIn เป็น Symbol — JSON.stringify มองไม่เห็น ต้องอ่านผ่านตัว symbol ตรง ๆ
      let captured: { status: { [Op.notIn]: MaContractStatus[] } } = {
        status: { [Op.notIn]: [] },
      };
      contractModel.findAll.mockImplementation(
        (options: { where: { status: { [Op.notIn]: MaContractStatus[] } } }) => {
          captured = options.where;
          return Promise.resolve([]);
        },
      );

      await service.contractOverlaps({});

      expect(captured.status[Op.notIn]).toEqual([
        MaContractStatus.CANCELLED,
        MaContractStatus.RENEWED,
      ]);
    });

    it('รายงานบอกชัดว่าเป็นการตรวจจับเท่านั้น ไม่ได้แก้ข้อมูล', async () => {
      const { service } = build({ contracts: [] });
      const report = await service.contractOverlaps({});

      expect(report.disclaimer).toContain('ไม่แก้');
      expect(report.disclaimer).toContain('ไม่ลบ');
    });
  });

  // =========================================================================
  // M10-01 / M10-03
  // =========================================================================
  describe('มูลค่าแยกรายลูกค้าและจัดอันดับ', () => {
    it('เรียงจากมากไปน้อย และ limit ตัดเฉพาะหัวตาราง', async () => {
      const { service } = build({
        customers: [
          { id: 1, name: 'ลูกค้าเล็ก', code: null },
          { id: 2, name: 'ลูกค้าใหญ่', code: null },
        ],
        projects: [
          projectRow({ id: 1, customerId: 1, contractValue: '10000.00' }),
          projectRow({ id: 2, customerId: 2, contractValue: '900000.00' }),
        ],
      });

      const all = await service.contractValueByCustomer({});
      expect(all.items.map((item) => item.customerId)).toEqual([2, 1]);
      expect(all.grandTotalContractValue).toBe('910000.00');

      const top = await service.contractValueByCustomer({ limit: 1 });
      expect(top.items).toHaveLength(1);
      expect(top.items[0].customerId).toBe(2);
      // ยอดรวมยังเป็นของทุกราย ไม่ใช่เฉพาะที่ตัดมา
      expect(top.grandTotalContractValue).toBe('910000.00');
    });

    it('ลูกค้าที่ยังไม่มีมูลค่าเลยไม่ขึ้นในรายการ', async () => {
      const { service } = build({
        customers: [{ id: 1, name: 'ลูกค้าที่ยังไม่มีอะไร', code: null }],
        projects: [],
      });

      expect((await service.contractValueByCustomer({})).items).toHaveLength(0);
    });

    it('ติดธงเตือนเมื่อลูกค้ามีสัญญาซ้อนกัน เพราะยอดรวมอาจนับซ้ำ', async () => {
      const { service } = build({
        customers: [{ id: 1, name: 'ลูกค้าทดสอบ', code: null }],
        contracts: [
          contractRow({ id: 1, startDate: '2026-01-01', endDate: '2026-12-31' }),
          contractRow({ id: 2, startDate: '2026-07-01', endDate: '2027-06-30' }),
        ],
      });

      expect((await service.contractValueByCustomer({})).items[0].overlappingContractCount).toBe(2);
    });
  });

  // =========================================================================
  // M1-05 / M1-06
  // =========================================================================
  describe('มุมมองลูกค้า 360 องศา', () => {
    it('ไม่พบลูกค้า → 404', async () => {
      const { service } = build({});

      await expect(service.customerOverview(99)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('รวมครบทั้ง 5 อย่างตามเอกสาร และไม่เพิ่มประเภทข้อมูลใหม่', async () => {
      const { service, customerModel } = build({});
      customerModel.findByPk.mockResolvedValue({
        id: 1,
        name: 'ลูกค้าทดสอบ',
        code: 'C1',
        status: 'ACTIVE',
        lastContactedAt: null,
      });

      const overview = await service.customerOverview(1);

      // M1-05 ระบุไว้ 5 อย่าง: โครงการ ประกัน สัญญา ปัญหา การติดตาม
      expect(Object.keys(overview)).toEqual(
        expect.arrayContaining([
          'projects',
          'warranties',
          'maContracts',
          'tickets',
          'followUps',
          'lifetimeValue',
        ]),
      );
      // ยังไม่เคยติดต่อ = null ไม่ใช่ 0 (0 แปลว่าเพิ่งติดต่อวันนี้)
      expect(overview.idleDays).toBeNull();
    });

    it('M1-06 ตัดรายการที่ยกเลิกออกจากยอดหลัก แต่แสดงแยกให้ตรวจได้', async () => {
      const { service, customerModel } = build({
        projects: [
          projectRow({ id: 1, contractValue: '100000.00' }),
          projectRow({ id: 2, status: ProjectStatus.CANCELLED, contractValue: '40000.00' }),
        ],
        contracts: [contractRow({ id: 10, price: '20000.00' })],
        addons: [addonRow({ contractId: 10, price: '5000.00' })],
      });
      customerModel.findByPk.mockResolvedValue({
        id: 1,
        name: 'ลูกค้าทดสอบ',
        code: null,
        status: 'ACTIVE',
        lastContactedAt: null,
      });

      const { lifetimeValue } = await service.customerOverview(1);

      expect(lifetimeValue.totalContractValue).toBe('125000.00');
      expect(lifetimeValue.excludedCancelledValue).toBe('40000.00');
      expect(lifetimeValue.excludedCancelledCount).toBe(1);
      expect(lifetimeValue.disclaimer).toContain('ไม่ใช่เงินที่ได้รับจริง');
    });
  });
});
