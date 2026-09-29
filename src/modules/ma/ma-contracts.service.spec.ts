/// <reference types="jest" />
// TypeScript 6 ไม่ดึง @types/jest เข้ามาให้อัตโนมัติ ต้องอ้างถึงตรงนี้เหมือน spec ตัวอื่น

import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Op } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';

import { MaAddon, MaContract, MaContractStatus, MaPlan, MaUsage, Project } from '../../models';
import { MaContractsService } from './ma-contracts.service';
import type { MaQuotaService } from './ma-quota.service';

/**
 * สัญญา MA — กฎที่เทสต์ชุดนี้ปักหมุดไว้ (Phase 8)
 *
 * 1. BR-05 — ราคาอยู่ที่สัญญา ไม่ใช่ที่แผน และลูกค้าคัดลอกมาจากโครงการเสมอ
 * 2. แก้วันเริ่มสัญญาหรือแผนหลังหักโควตาไปแล้วไม่ได้ เพราะประวัติจะตกรอบผิด
 * 3. ต่อสัญญาแล้วฉบับเดิมต้องกลายเป็น RENEWED ในทรานแซกชันเดียวกัน
 * 4. Q4 — สัญญาซ้อนกันไม่ถูกปฏิเสธ แต่ต้องได้ข้อความเตือนกลับไป
 */

interface ModelMock {
  findByPk: jest.Mock;
  findOne: jest.Mock;
  findAll: jest.Mock;
  findAndCountAll: jest.Mock;
  create: jest.Mock;
  count: jest.Mock;
  update: jest.Mock;
}

function modelMock(): ModelMock {
  return {
    findByPk: jest.fn(),
    findOne: jest.fn(),
    findAll: jest.fn(),
    findAndCountAll: jest.fn(),
    create: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  };
}

const QUOTA_STATUS = {
  contractId: 12,
  periodYear: 2026,
  periodMonth: 10,
  periodStart: '2026-10-15',
  periodEnd: '2026-11-14',
  quota: 5,
  used: 2,
  willExceed: false,
};

function contractRow(overrides: Record<string, unknown> = {}): MaContract {
  return {
    id: 12,
    customerId: 1,
    projectId: 3,
    planId: 2,
    previousContractId: null,
    contractNo: 'MA-2026-014',
    price: '48000.00',
    billingCycle: 'YEARLY',
    startDate: '2026-10-01',
    endDate: '2027-09-30',
    status: MaContractStatus.ACTIVE,
    signedDate: null,
    signedFileUrl: null,
    note: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    update: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as MaContract;
}

function planRow(overrides: Record<string, unknown> = {}): MaPlan {
  return { id: 2, name: 'แผนมาตรฐาน', isActive: true, ...overrides } as unknown as MaPlan;
}

describe('MaContractsService', () => {
  let contractModel: ModelMock;
  let addonModel: ModelMock;
  let planModel: ModelMock;
  let usageModel: ModelMock;
  let projectModel: ModelMock;
  let quotaService: { getQuotaStatus: jest.Mock };
  let service: MaContractsService;

  /**
   * ทรานแซกชันปลอมที่รัน callback ทันที — เราสนใจว่าอะไรถูกเรียกในนั้น ไม่ใช่ตัว SQL
   *
   * เก็บ mock ไว้เป็นตัวแปรแยกเพื่อให้ assert ได้โดยไม่ต้องหยิบเมท็อดออกจาก object
   * ที่ประกาศชนิดเป็น Sequelize ซึ่ง eslint จะเตือนว่าเป็นการเรียกแบบหลุด this
   */
  const runTransaction = jest.fn(<T>(fn: (t: unknown) => Promise<T>) => fn({ name: 'tx' }));
  const sequelize = {
    transaction: runTransaction,
    query: jest.fn((sql: string) =>
      sql.includes('SELECT') ? Promise.resolve([{ nextValue: 1 }]) : Promise.resolve([]),
    ),
  } as unknown as Sequelize;

  beforeEach(() => {
    contractModel = modelMock();
    addonModel = modelMock();
    planModel = modelMock();
    usageModel = modelMock();
    projectModel = modelMock();
    quotaService = { getQuotaStatus: jest.fn().mockResolvedValue(QUOTA_STATUS) };

    addonModel.findAll.mockResolvedValue([]);
    planModel.findByPk.mockResolvedValue(planRow());
    projectModel.findByPk.mockResolvedValue({ id: 3, customerId: 1 });
    usageModel.count.mockResolvedValue(0);
    contractModel.count.mockResolvedValue(0);
    contractModel.create.mockResolvedValue(contractRow());
    contractModel.findByPk.mockResolvedValue(contractRow());

    service = new MaContractsService(
      contractModel as unknown as typeof MaContract,
      addonModel as unknown as typeof MaAddon,
      planModel as unknown as typeof MaPlan,
      usageModel as unknown as typeof MaUsage,
      projectModel as unknown as typeof Project,
      quotaService as unknown as MaQuotaService,
      sequelize,
    );
  });

  // -------------------------------------------------------------------------
  // สร้างสัญญา
  // -------------------------------------------------------------------------
  describe('create', () => {
    const baseDto = {
      projectId: 3,
      planId: 2,
      price: '48000.00',
      startDate: '2026-10-01',
      endDate: '2027-09-30',
    };

    it('คัดลอกลูกค้ามาจากโครงการ ไม่รับจาก client', async () => {
      // กันสัญญาที่ลูกค้ากับโครงการเป็นคนละราย ซึ่งจะทำให้รายงานรายลูกค้าผิดทั้งหมด
      projectModel.findByPk.mockResolvedValue({ id: 3, customerId: 77 });

      let captured: { customerId: number } = { customerId: 0 };
      contractModel.create.mockImplementation((values: { customerId: number }) => {
        captured = values;
        return Promise.resolve(contractRow());
      });

      await service.create(baseDto);

      expect(captured.customerId).toBe(77);
    });

    it('เริ่มที่ DRAFT เมื่อไม่ได้ระบุสถานะ', async () => {
      let captured: { status: MaContractStatus } = { status: MaContractStatus.ACTIVE };
      contractModel.create.mockImplementation((values: { status: MaContractStatus }) => {
        captured = values;
        return Promise.resolve(contractRow());
      });

      await service.create(baseDto);

      expect(captured.status).toBe(MaContractStatus.DRAFT);
    });

    it('ไม่พบโครงการ → 404', async () => {
      projectModel.findByPk.mockResolvedValue(null);

      await expect(service.create(baseDto)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('แผนที่ปิดใช้งานแล้วทำสัญญาใหม่ไม่ได้', async () => {
      planModel.findByPk.mockResolvedValue(planRow({ isActive: false }));

      await expect(service.create(baseDto)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('วันสิ้นสุดต้องอยู่หลังวันเริ่ม', async () => {
      await expect(
        service.create({ ...baseDto, startDate: '2027-01-01', endDate: '2026-01-01' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('วันเริ่มกับวันสิ้นสุดเป็นวันเดียวกันไม่ได้', async () => {
      await expect(
        service.create({ ...baseDto, startDate: '2026-10-01', endDate: '2026-10-01' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('สร้างเลขที่สัญญาเองโดยไม่รับรหัสจาก client', async () => {
      await expect(
        service.create({ ...baseDto, contractNo: 'MA-2026-014' }),
      ).resolves.toBeDefined();
      expect(contractModel.findOne).not.toHaveBeenCalled();
    });

    it('สัญญา ACTIVE ที่ช่วงเวลาทับกันได้คำเตือน แต่ไม่ถูกปฏิเสธ (Q4)', async () => {
      contractModel.count.mockResolvedValue(1);

      const result = await service.create({ ...baseDto, status: MaContractStatus.ACTIVE });

      expect(result.warning).toContain('ทับกัน');
      expect(contractModel.create).toHaveBeenCalled();
    });

    it('ไม่มีสัญญาทับกัน = ไม่มีคำเตือน', async () => {
      const result = await service.create({ ...baseDto, status: MaContractStatus.ACTIVE });

      expect(result.warning).toBeNull();
    });

    it('สัญญาที่ยังเป็น DRAFT ไม่ต้องเช็คการทับกัน เพราะยังไม่คุ้มครองใคร', async () => {
      await service.create(baseDto);

      expect(contractModel.count).not.toHaveBeenCalled();
    });

    it('ตั้ง EXPIRED เองไม่ได้ — ระบบตัดสินจากวันสิ้นสุด', async () => {
      await expect(
        service.create({ ...baseDto, status: MaContractStatus.EXPIRED }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(contractModel.create).not.toHaveBeenCalled();
    });

    it('คีย์สัญญาเก่าเป็น ACTIVE ที่วันสิ้นสุดผ่านไปแล้ว → บันทึกเป็น EXPIRED', async () => {
      let captured: { status: MaContractStatus } = { status: MaContractStatus.DRAFT };
      contractModel.create.mockImplementation((values: { status: MaContractStatus }) => {
        captured = values;
        return Promise.resolve(contractRow());
      });

      await service.create({
        ...baseDto,
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        status: MaContractStatus.ACTIVE,
      });

      expect(captured.status).toBe(MaContractStatus.EXPIRED);
    });
  });

  // -------------------------------------------------------------------------
  // แก้ไข — จุดที่กระทบประวัติการหักโควตา
  // -------------------------------------------------------------------------
  describe('update', () => {
    it('แก้วันเริ่มสัญญาไม่ได้เมื่อหักโควตาไปแล้ว', async () => {
      // วันเริ่มสัญญาเป็นตัวกำหนดว่าแถวใน ma_usages ตกรอบไหน (Q2)
      // แก้ทีหลังเท่ากับย้ายประวัติที่บันทึกไว้ไปอยู่รอบอื่นโดยไม่มีใครรู้
      usageModel.count.mockResolvedValue(2);

      await expect(service.update(12, { startDate: '2026-11-01' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('แก้แผนไม่ได้เมื่อหักโควตาไปแล้ว', async () => {
      usageModel.count.mockResolvedValue(1);

      await expect(service.update(12, { planId: 5 })).rejects.toBeInstanceOf(ConflictException);
    });

    it('แก้วันเริ่มสัญญาได้ถ้ายังไม่เคยหักโควตา', async () => {
      // เก็บ mock ไว้เป็นตัวแปรแทนการอ่านเมท็อดออกจาก object ที่ประกาศชนิดเป็น MaContract
      // ไม่งั้น eslint จะมองว่าเป็นการหยิบเมท็อดออกมาโดยหลุด this (unbound-method)
      const update = jest.fn().mockResolvedValue(undefined);
      contractModel.findByPk.mockResolvedValue(contractRow({ update }));

      await service.update(12, { startDate: '2026-11-01' });

      expect(update).toHaveBeenCalled();
    });

    it('ส่งวันเริ่มเดิมมาไม่นับว่าเป็นการแก้ จึงไม่ต้องไปนับโควตา', async () => {
      await service.update(12, { startDate: '2026-10-01', note: 'แก้แค่หมายเหตุ' });

      expect(usageModel.count).not.toHaveBeenCalled();
    });

    it('ตั้งสถานะ RENEWED เองไม่ได้', async () => {
      // RENEWED สื่อว่ามีฉบับใหม่มาแทนแล้ว ถ้าตั้งเองได้จะเกิดสัญญาที่อ้างว่าถูกต่อ
      // ทั้งที่ไม่มีฉบับใหม่อยู่จริง
      await expect(service.update(12, { status: MaContractStatus.RENEWED })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('ฉบับที่ต่อแล้ว (RENEWED) ถูกเปลี่ยนกลับเป็น ACTIVE ไม่ได้', async () => {
      // ถ้าถอยได้ ฉบับเดิมกับฉบับใหม่จะ ACTIVE ซ้อนกัน แล้วการหักโควตาเลือกสัญญาผิด
      contractModel.findByPk.mockResolvedValue(contractRow({ status: MaContractStatus.RENEWED }));

      await expect(service.update(12, { status: MaContractStatus.ACTIVE })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('ฉบับที่ต่อแล้วยังแก้หมายเหตุได้ และสถานะคงเป็น RENEWED แม้เลยวันสิ้นสุด', async () => {
      const update = jest.fn().mockResolvedValue(undefined);
      contractModel.findByPk.mockResolvedValue(
        contractRow({
          status: MaContractStatus.RENEWED,
          startDate: '2020-01-01',
          endDate: '2020-12-31',
          update,
        }),
      );

      await service.update(12, { note: 'แก้หมายเหตุ' });

      const [changes] = update.mock.calls[0] as [Record<string, unknown>];
      expect(changes).not.toHaveProperty('status');
    });

    it('ตั้งสถานะ EXPIRED เองไม่ได้', async () => {
      await expect(service.update(12, { status: MaContractStatus.EXPIRED })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('ขยายวันสิ้นสุดของฉบับ EXPIRED → กลับเป็น ACTIVE เอง', async () => {
      const update = jest.fn().mockResolvedValue(undefined);
      contractModel.findByPk.mockResolvedValue(
        contractRow({
          update,
          startDate: '2025-01-01',
          endDate: '2025-12-31',
          status: MaContractStatus.EXPIRED,
        }),
      );

      await service.update(12, { endDate: '2099-12-31' });

      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ status: MaContractStatus.ACTIVE, endDate: '2099-12-31' }),
      );
    });

    it('แก้ฉบับ ACTIVE ให้วันสิ้นสุดผ่านไปแล้ว → EXPIRED', async () => {
      const update = jest.fn().mockResolvedValue(undefined);
      contractModel.findByPk.mockResolvedValue(contractRow({ update, startDate: '2024-01-01' }));

      await service.update(12, { endDate: '2024-12-31' });

      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ status: MaContractStatus.EXPIRED }),
      );
    });

    it('ไม่ส่งสถานะและไม่เปลี่ยนผล = ไม่เขียน status ทับ', async () => {
      const update = jest.fn().mockResolvedValue(undefined);
      contractModel.findByPk.mockResolvedValue(contractRow({ update }));

      await service.update(12, { note: 'x' });

      const [values] = update.mock.calls[0] as [Record<string, unknown>];
      expect(values).not.toHaveProperty('status');
    });

    it('เปลี่ยนเป็น CANCELLED ได้ตามปกติ', async () => {
      const update = jest.fn().mockResolvedValue(undefined);
      contractModel.findByPk.mockResolvedValue(contractRow({ update }));

      await service.update(12, { status: MaContractStatus.CANCELLED });

      expect(update).toHaveBeenCalled();
    });

    it('ไม่พบสัญญา → 404', async () => {
      contractModel.findByPk.mockResolvedValue(null);

      await expect(service.update(99, { note: 'x' })).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('expireEndedContracts', () => {
    it('เปลี่ยนเฉพาะ ACTIVE ที่วันสิ้นสุดก่อนวันนี้เป็น EXPIRED', async () => {
      contractModel.update.mockResolvedValue([2]);

      const affected = await service.expireEndedContracts('2026-09-28');

      expect(affected).toBe(2);
      expect(contractModel.update).toHaveBeenCalledWith(
        { status: MaContractStatus.EXPIRED },
        {
          where: {
            status: MaContractStatus.ACTIVE,
            endDate: { [Op.lt]: '2026-09-28' },
          },
          individualHooks: true,
        },
      );
    });
  });

  // -------------------------------------------------------------------------
  // ต่อสัญญา
  // -------------------------------------------------------------------------
  describe('renew', () => {
    const renewDto = { startDate: '2027-10-01', endDate: '2028-09-30', price: '52000.00' };

    it('ฉบับใหม่ชี้กลับไปหาฉบับเดิม และฉบับเดิมกลายเป็น RENEWED', async () => {
      const update = jest.fn().mockResolvedValue(undefined);
      contractModel.findByPk.mockResolvedValue(contractRow({ update }));

      let captured: { previousContractId: number; status: MaContractStatus } = {
        previousContractId: 0,
        status: MaContractStatus.ACTIVE,
      };
      contractModel.create.mockImplementation(
        (values: { previousContractId: number; status: MaContractStatus }) => {
          captured = values;
          return Promise.resolve(contractRow({ id: 20 }));
        },
      );

      await service.renew(12, renewDto);

      expect(captured.previousContractId).toBe(12);
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ status: MaContractStatus.RENEWED }),
        expect.anything(),
      );
    });

    it('ทั้งสองอย่างอยู่ในทรานแซกชันเดียวกัน', async () => {
      // ถ้าแยกกัน แล้วปิดฉบับเดิมไม่สำเร็จ โครงการจะมี ACTIVE สองฉบับซ้อนกัน
      // แล้วการหักโควตาครั้งถัดไปจะไปตกฉบับไหนก็ได้
      await service.renew(12, renewDto);

      expect(runTransaction).toHaveBeenCalled();
    });

    it('ฉบับใหม่เริ่มที่ DRAFT เพราะยังไม่ได้เซ็น (BR-12)', async () => {
      let captured: { status: MaContractStatus } = { status: MaContractStatus.ACTIVE };
      contractModel.create.mockImplementation((values: { status: MaContractStatus }) => {
        captured = values;
        return Promise.resolve(contractRow({ id: 20 }));
      });

      await service.renew(12, renewDto);

      expect(captured.status).toBe(MaContractStatus.DRAFT);
    });

    it('ใช้แผนเดิมเมื่อไม่ได้ระบุแผนใหม่', async () => {
      let captured: { planId: number } = { planId: 0 };
      contractModel.create.mockImplementation((values: { planId: number }) => {
        captured = values;
        return Promise.resolve(contractRow({ id: 20 }));
      });

      await service.renew(12, renewDto);

      expect(captured.planId).toBe(2);
    });

    it('ต่อสัญญาซ้ำไม่ได้', async () => {
      contractModel.findByPk.mockResolvedValue(contractRow({ status: MaContractStatus.RENEWED }));

      await expect(service.renew(12, renewDto)).rejects.toBeInstanceOf(ConflictException);
    });

    it('สัญญาที่ยกเลิกแล้วต่อไม่ได้', async () => {
      contractModel.findByPk.mockResolvedValue(contractRow({ status: MaContractStatus.CANCELLED }));

      await expect(service.renew(12, renewDto)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('ฉบับใหม่เริ่มก่อนฉบับเดิมไม่ได้', async () => {
      await expect(
        service.renew(12, { ...renewDto, startDate: '2020-01-01', endDate: '2021-01-01' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // -------------------------------------------------------------------------
  // ของเสริม
  // -------------------------------------------------------------------------
  describe('createAddon', () => {
    it('ระบุปีมาแต่ไม่ระบุเดือน → 400', async () => {
      // resolveQuota() เทียบทั้งสองค่าพร้อมกัน ถ้ามาแค่ค่าเดียว addon นั้นจะไม่เข้า
      // เงื่อนไขไหนเลย กลายเป็นของที่ลูกค้าจ่ายแล้วแต่ระบบไม่เคยนับให้
      await expect(
        service.createAddon(12, { title: 'ซื้อโควตาเพิ่ม', effectiveYear: 2026 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('ระบุเดือนมาแต่ไม่ระบุปี → 400', async () => {
      await expect(
        service.createAddon(12, { title: 'ซื้อโควตาเพิ่ม', effectiveMonth: 11 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('ไม่ระบุทั้งคู่ = มีผลตลอดอายุสัญญา', async () => {
      let captured: { effectiveYear: number | null; effectiveMonth: number | null } = {
        effectiveYear: 0,
        effectiveMonth: 0,
      };
      addonModel.create.mockImplementation(
        (values: { effectiveYear: number | null; effectiveMonth: number | null }) => {
          captured = values;
          return Promise.resolve({ id: 1, ...values });
        },
      );

      await service.createAddon(12, { title: 'ซื้อโควตาเพิ่ม', extraQuota: 3 });

      expect(captured.effectiveYear).toBeNull();
      expect(captured.effectiveMonth).toBeNull();
    });

    it('สัญญาที่ยกเลิกแล้วเพิ่มของเสริมไม่ได้', async () => {
      contractModel.findByPk.mockResolvedValue(contractRow({ status: MaContractStatus.CANCELLED }));

      await expect(service.createAddon(12, { title: 'ซื้อโควตาเพิ่ม' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // โควตา
  // -------------------------------------------------------------------------
  describe('getQuota', () => {
    it('คืนจำนวนที่เหลือและช่วงวันของรอบให้หน้าจอใช้ได้ตรง ๆ', async () => {
      const quota = await service.getQuota(12);

      expect(quota.remaining).toBe(3);
      expect(quota.periodStart).toBe('2026-10-15');
      expect(quota.periodEnd).toBe('2026-11-14');
    });

    it('เหลือติดลบได้เมื่อใช้เกินโควตาไปแล้ว', async () => {
      quotaService.getQuotaStatus.mockResolvedValue({
        ...QUOTA_STATUS,
        quota: 3,
        used: 5,
        willExceed: true,
      });

      const quota = await service.getQuota(12);

      expect(quota.remaining).toBe(-2);
      expect(quota.isExhausted).toBe(true);
    });

    it('ไม่พบสัญญา → 404', async () => {
      contractModel.findByPk.mockResolvedValue(null);

      await expect(service.getQuota(99)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('listQuotaForProject', () => {
    it('คืนโควตาทุกสัญญาของโปรเจคด้วยสูตรเดียวกับ getQuota', async () => {
      contractModel.findAll.mockResolvedValue([
        contractRow({ id: 12 }),
        contractRow({ id: 13, contractNo: 'MA-2026-015' }),
      ]);
      quotaService.getQuotaStatus
        .mockResolvedValueOnce(QUOTA_STATUS)
        .mockResolvedValueOnce({ ...QUOTA_STATUS, contractId: 13, used: 0, willExceed: false });

      const summary = await service.listQuotaForProject(3);

      expect(summary.projectId).toBe(3);
      expect(summary.items).toHaveLength(2);
      expect(summary.items[0].contract.id).toBe(12);
      expect(summary.items[0].quota.remaining).toBe(3);
      expect(summary.items[1].quota.contractId).toBe(13);
      expect(summary.items[1].quota.remaining).toBe(5);
      expect(contractModel.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ where: { projectId: 3 } }),
      );
    });

    it('โปรเจคไม่มีสัญญา → items ว่าง', async () => {
      contractModel.findAll.mockResolvedValue([]);

      const summary = await service.listQuotaForProject(3);

      expect(summary).toEqual({ projectId: 3, items: [] });
    });

    it('ไม่พบโปรเจค → 404', async () => {
      projectModel.findByPk.mockResolvedValue(null);

      await expect(service.listQuotaForProject(99)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // -------------------------------------------------------------------------
  // M6-08 ข้อมูลสำหรับพิมพ์ร่างสัญญา
  // -------------------------------------------------------------------------
  describe('getPrintData', () => {
    function printableContract(overrides: Record<string, unknown> = {}): MaContract {
      return contractRow({
        status: MaContractStatus.DRAFT,
        customer: {
          id: 1,
          code: 'CUS-001',
          name: 'บริษัท ตัวอย่าง จำกัด',
          taxId: '0105561234567',
          address: '99/1 ถนนสุขุมวิท',
          province: 'กรุงเทพมหานคร',
          postalCode: '10110',
          phone: '02-123-4567',
          email: 'contact@example.co.th',
          contacts: [
            { name: 'คุณเอ', position: 'พนักงาน', phone: null, email: null, isPrimary: false },
            {
              name: 'คุณสมศรี',
              position: 'ผู้จัดการฝ่ายไอที',
              phone: '081-234-5678',
              email: null,
              isPrimary: true,
            },
          ],
        },
        project: { id: 3, code: 'PRJ-003', name: 'ระบบคลังสินค้า' },
        plan: {
          id: 2,
          code: 'MA_STANDARD',
          name: 'แผนมาตรฐาน',
          description: null,
          bugQuotaPerMonth: 5,
          responseTimeHour: 24,
          onsiteQuotaPerMonth: 1,
          items: [
            { id: 9, title: 'สำรองข้อมูล', detail: null, sortOrder: 1 },
            { id: 7, title: 'ตรวจสุขภาพระบบ', detail: null, sortOrder: 0 },
          ],
        },
        previousContract: null,
        ...overrides,
      });
    }

    beforeEach(() => {
      contractModel.findByPk.mockResolvedValue(printableContract());
    });

    it('ประกอบคู่สัญญา โครงการ เนื้อหาแผน และราคาไว้ในชุดเดียว', async () => {
      const print = await service.getPrintData(12);

      expect(print.contract.contractNo).toBe('MA-2026-014');
      expect(print.contract.price).toBe('48000.00');
      expect(print.customer.name).toBe('บริษัท ตัวอย่าง จำกัด');
      expect(print.customer.taxId).toBe('0105561234567');
      expect(print.project.name).toBe('ระบบคลังสินค้า');
      expect(print.plan.bugQuotaPerMonth).toBe(5);
    });

    it('รายการบริการในแผนเรียงตาม sortOrder ไม่ใช่ตามที่ฐานข้อมูลคืนมา', async () => {
      const print = await service.getPrintData(12);

      expect(print.plan.items.map((item) => item.title)).toEqual(['ตรวจสุขภาพระบบ', 'สำรองข้อมูล']);
    });

    it('หยิบผู้ติดต่อหลักตัวจริง ไม่ใช่คนแรกในรายการ', async () => {
      const print = await service.getPrintData(12);

      expect(print.primaryContact).toEqual({
        name: 'คุณสมศรี',
        position: 'ผู้จัดการฝ่ายไอที',
        phone: '081-234-5678',
        email: null,
      });
    });

    it('ไม่มีผู้ติดต่อหลักได้ null — ไม่เดาเอาคนแรกมาใส่แทน', async () => {
      // คนที่ถูกพิมพ์ลงสัญญาต้องเป็นคนที่ลูกค้าตั้งไว้จริง ถ้าเดาอาจได้คนที่ไม่มีอำนาจลงนาม
      const base = printableContract();
      contractModel.findByPk.mockResolvedValue(
        printableContract({
          customer: {
            ...(base.customer as unknown as Record<string, unknown>),
            contacts: [{ name: 'คุณเอ', isPrimary: false }],
          },
        }),
      );

      const print = await service.getPrintData(12);

      expect(print.primaryContact).toBeNull();
    });

    it('เนื้อหาแผนไม่มีฟิลด์ราคา ราคาอยู่ที่สัญญาที่เดียว (BR-05)', async () => {
      const print = await service.getPrintData(12);

      expect(Object.keys(print.plan)).not.toContain('price');
      expect(JSON.stringify(print.plan)).not.toMatch(/price/i);
    });

    it('แนบของเสริมเป็นรายการแยก ไม่รวมเป็นยอดเดียวให้', async () => {
      addonModel.findAll.mockResolvedValue([
        { id: 3, contractId: 12, title: 'โควตาเพิ่ม 3 ครั้ง', price: '4500.00', extraQuota: 3 },
      ]);

      const print = await service.getPrintData(12);

      expect(print.addons).toHaveLength(1);
      expect(print.addons[0].price).toBe('4500.00');
      // ราคาหลักต้องไม่ถูกบวกของเสริมเข้าไปเงียบ ๆ
      expect(print.contract.price).toBe('48000.00');
    });

    it('สัญญาที่เกิดจากการต่อ พ่วงเลขที่ฉบับก่อนหน้ามาให้พิมพ์อ้างอิง', async () => {
      contractModel.findByPk.mockResolvedValue(
        printableContract({
          previousContractId: 8,
          previousContract: {
            id: 8,
            contractNo: 'MA-2025-009',
            startDate: '2025-10-01',
            endDate: '2026-09-30',
          },
        }),
      );

      const print = await service.getPrintData(12);

      expect(print.contract.previousContract?.contractNo).toBe('MA-2025-009');
    });

    it('ไม่กั้นตามสถานะ — ฉบับที่ยกเลิกแล้วยังพิมพ์ได้ และส่งสถานะไปให้หน้าจอตัดสินเอง', async () => {
      contractModel.findByPk.mockResolvedValue(
        printableContract({ status: MaContractStatus.CANCELLED }),
      );

      const print = await service.getPrintData(12);

      expect(print.contract.status).toBe(MaContractStatus.CANCELLED);
    });

    it('อ่านอย่างเดียว ไม่เขียนอะไรลงฐานข้อมูล', async () => {
      const row = printableContract();
      const update = jest.fn();
      contractModel.findByPk.mockResolvedValue({ ...row, update });

      await service.getPrintData(12);

      expect(update).not.toHaveBeenCalled();
      expect(contractModel.create).not.toHaveBeenCalled();
    });

    it('ไม่พบสัญญา → 404', async () => {
      contractModel.findByPk.mockResolvedValue(null);

      await expect(service.getPrintData(99)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('ข้อมูลอ้างอิงหาย → 404 แทนที่จะพิมพ์เอกสารที่ขาดคู่สัญญา', async () => {
      contractModel.findByPk.mockResolvedValue(printableContract({ customer: null }));

      await expect(service.getPrintData(12)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
