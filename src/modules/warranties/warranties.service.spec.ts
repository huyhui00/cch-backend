/// <reference types="jest" />
// TypeScript 6 ไม่ดึง @types/jest เข้ามาให้อัตโนมัติ ต้องอ้างถึงตรงนี้เหมือน spec ตัวอื่น

import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Op } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

import { runWithRequestContext } from '../../common/context/request-context';
import { todayAsDateOnly } from '../../common/utils/date.util';
import {
  AcceptanceStatus,
  Attachment,
  Delivery,
  MaContract,
  Project,
  Warranty,
  WarrantyStatus,
} from '../../models';
import {
  WARRANTY_MA_CONTRACT_PROJECT_MISMATCH_MESSAGE,
  WARRANTY_REQUIRES_ACCEPTANCE_MESSAGE,
  WARRANTY_REQUIRES_FINAL_DELIVERY_MESSAGE,
  WarrantiesService,
  deriveWarrantyStatus,
  warrantyEndDateFor,
  warrantyStartDateFor,
} from './warranties.service';
import type { QueryExpiringWarrantiesDto, QueryWarrantiesDto } from './dto/warranty.dto';
import { isWarrantyCurrentlyActive } from './dto/warranty.response';

/**
 * BR-06 — ระยะประกันนับจาก "วันส่งมอบ"
 *
 * กฎนี้พังได้สองทาง และทั้งสองทางเงียบสนิท ไม่มี error ให้เห็น:
 *   1. ปล่อยให้ client ส่ง startDate มาเอง
 *   2. แก้วันส่งมอบแล้วประกันที่ออกไปแล้วไม่ขยับตาม
 * เทสต์ชุดนี้ยืนกันทั้งสองทาง
 */

interface ModelMock {
  findByPk: jest.Mock;
  findOne: jest.Mock;
  findAll: jest.Mock;
  findAndCountAll: jest.Mock;
  count: jest.Mock;
  create: jest.Mock;
  update: jest.Mock;
}

function modelMock(): ModelMock {
  return {
    findByPk: jest.fn(),
    findOne: jest.fn(),
    findAll: jest.fn(),
    findAndCountAll: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };
}

const TRANSACTION = { name: 'tx' };

function baseWarrantyRow() {
  return {
    id: 4,
    deliveryId: 5,
    delivery: null,
    projectId: 1,
    project: null,
    durationMonth: 12,
    startDate: '2026-09-08',
    endDate: '2027-09-08',
    status: WarrantyStatus.ACTIVE,
    scopeNote: null as string | null,
    createdAt: new Date('2026-09-08T00:00:00Z'),
    updatedAt: new Date('2026-09-08T00:00:00Z'),
    update: jest.fn(),
  };
}

type WarrantyRow = ReturnType<typeof baseWarrantyRow>;

function warrantyRow(overrides: Partial<WarrantyRow> = {}): WarrantyRow {
  return { ...baseWarrantyRow(), ...overrides };
}

/**
 * ค่าเริ่มต้นเป็น "ยอมรับแล้ว + ครั้งสุดท้าย" เพราะออกประกันได้เฉพาะใบแบบนี้ (ตกลง 11 ก.ย.)
 */
function deliveryRow(
  deliveredAt: Date,
  projectId = 1,
  acceptanceStatus: AcceptanceStatus = AcceptanceStatus.ACCEPTED,
  isFinal = true,
) {
  return { id: 5, projectId, deliveredAt, acceptanceStatus, isFinal };
}

function queryDto(overrides: Record<string, unknown> = {}): QueryWarrantiesDto {
  return {
    page: 1,
    limit: 20,
    offset: 0,
    sortOrder: 'DESC',
    ...overrides,
  } as unknown as QueryWarrantiesDto;
}

function expiringQueryDto(overrides: Record<string, unknown> = {}): QueryExpiringWarrantiesDto {
  return {
    page: 1,
    limit: 20,
    offset: 0,
    sortOrder: 'DESC',
    days: 30,
    ...overrides,
  } as unknown as QueryExpiringWarrantiesDto;
}

describe('WarrantiesService', () => {
  let warrantyModel: ModelMock;
  let deliveryModel: ModelMock;
  let projectModel: ModelMock;
  let maContractModel: ModelMock;
  let attachmentModel: ModelMock;
  const sequelize = {
    transaction: jest.fn((callback: (t: unknown) => Promise<unknown>) => callback({ name: 'tx' })),
    query: jest.fn((sql: string) =>
      sql.includes('SELECT') ? Promise.resolve([{ nextValue: 1 }]) : Promise.resolve([]),
    ),
  };
  let service: WarrantiesService;

  beforeEach(() => {
    warrantyModel = modelMock();
    deliveryModel = modelMock();
    projectModel = modelMock();
    maContractModel = modelMock();
    attachmentModel = modelMock();
    attachmentModel.findAll.mockResolvedValue([]);

    warrantyModel.findOne.mockResolvedValue(null);
    warrantyModel.findAll.mockResolvedValue([]);
    warrantyModel.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });
    warrantyModel.findByPk.mockResolvedValue(warrantyRow());
    warrantyModel.create.mockResolvedValue(warrantyRow());
    deliveryModel.findByPk.mockResolvedValue(deliveryRow(new Date('2026-09-08T10:30:00Z')));
    projectModel.findByPk.mockResolvedValue({ id: 1 });
    // สัญญาที่หาเจอเป็นของโครงการเดียวกับใบส่งมอบตัวอย่าง (projectId 1)
    maContractModel.findByPk.mockResolvedValue({ id: 3, projectId: 1 });

    service = new WarrantiesService(
      warrantyModel as unknown as typeof Warranty,
      deliveryModel as unknown as typeof Delivery,
      projectModel as unknown as typeof Project,
      maContractModel as unknown as typeof MaContract,
      attachmentModel as unknown as typeof Attachment,
      sequelize as unknown as Sequelize,
    );
  });

  // -------------------------------------------------------------------------
  // BR-06 — วันเริ่มประกันมาจากวันส่งมอบเท่านั้น
  // -------------------------------------------------------------------------
  describe('create', () => {
    it('ประกันเริ่มวันถัดจากวันส่งมอบ ไม่ได้รับค่าจากผู้ใช้', async () => {
      const deliveredAt = new Date(2026, 8, 8, 10, 30);
      deliveryModel.findByPk.mockResolvedValue(deliveryRow(deliveredAt));

      let captured: { startDate: string; endDate: string; projectId: number } = {
        startDate: '',
        endDate: '',
        projectId: 0,
      };
      warrantyModel.create.mockImplementation(
        (values: { startDate: string; endDate: string; projectId: number }) => {
          captured = values;
          return Promise.resolve(warrantyRow());
        },
      );

      await service.create(5, { durationMonth: 12 });

      expect(captured.startDate).toBe('2026-09-09');
      expect(captured.endDate).toBe('2027-09-08');
    });

    it('ส่งมอบดึกแค่ไหนก็เริ่มวันถัดไป (นับตามวันเครื่อง ไม่ใช่ +24 ชม.)', () => {
      expect(warrantyStartDateFor(new Date(2026, 8, 8, 0, 5))).toBe('2026-09-09');
      expect(warrantyStartDateFor(new Date(2026, 8, 8, 23, 55))).toBe('2026-09-09');
      expect(warrantyStartDateFor(new Date(2026, 11, 31, 12, 0))).toBe('2027-01-01');
    });

    it('ประกัน N เดือนคุ้มครองครบ N เดือนพอดี ไม่เกินวัน (เริ่ม + N เดือน − 1 วัน)', () => {
      // ส่งมอบ 28 ก.ย. 69 → เริ่ม 29 ก.ย. 69 → หมด 28 ก.ย. 70 (365 วัน)
      expect(warrantyEndDateFor('2026-09-29', 12)).toBe('2027-09-28');
      expect(warrantyEndDateFor('2026-01-01', 1)).toBe('2026-01-31');
      expect(warrantyEndDateFor('2026-03-01', 12)).toBe('2027-02-28');
    });

    it('คัดลอก projectId มาจากใบส่งมอบ ไม่ใช่รับมาจาก client', async () => {
      // ถ้ารับจาก client จะออกประกันให้โครงการอื่นได้ ทั้งที่ใบส่งมอบเป็นของอีกโครงการ
      deliveryModel.findByPk.mockResolvedValue(deliveryRow(new Date(2026, 8, 8), 77));

      let captured: { projectId: number } = { projectId: 0 };
      warrantyModel.create.mockImplementation((values: { projectId: number }) => {
        captured = values;
        return Promise.resolve(warrantyRow());
      });

      await service.create(5, { durationMonth: 6 });

      expect(captured.projectId).toBe(77);
    });

    it('หนีบวันสิ้นเดือนตอนคำนวณวันหมดประกัน', async () => {
      // ส่งมอบ 30 ม.ค. → ประกันเริ่ม 31 ม.ค. → +1 เดือน หนีบเป็น 28 ก.พ. − 1 วัน = 27 ก.พ.
      deliveryModel.findByPk.mockResolvedValue(deliveryRow(new Date(2026, 0, 30, 9, 0)));

      let captured: { endDate: string } = { endDate: '' };
      warrantyModel.create.mockImplementation((values: { endDate: string }) => {
        captured = values;
        return Promise.resolve(warrantyRow());
      });

      await service.create(5, { durationMonth: 1 });

      expect(captured.endDate).toBe('2026-02-27');
    });

    it.each([AcceptanceStatus.PENDING, AcceptanceStatus.REJECTED])(
      'ออกประกันจากใบส่งมอบที่ยังไม่ได้รับการยอมรับ (%s) ไม่ได้',
      async (acceptanceStatus) => {
        // ประกันเริ่มหลังส่งงานที่ครบและลูกค้ายอมรับแล้วเท่านั้น (ตกลง 11 ก.ย.)
        deliveryModel.findByPk.mockResolvedValue(
          deliveryRow(new Date('2026-09-08T10:30:00Z'), 1, acceptanceStatus),
        );

        await expect(service.create(5, { durationMonth: 6 })).rejects.toThrow(
          new ConflictException(WARRANTY_REQUIRES_ACCEPTANCE_MESSAGE),
        );
        expect(warrantyModel.create).not.toHaveBeenCalled();
      },
    );

    it('ออกประกันจากการส่งมอบที่ยอมรับแล้วแต่ไม่ใช่ครั้งสุดท้าย (ส่งเป็นเฟส) ไม่ได้', async () => {
      deliveryModel.findByPk.mockResolvedValue(
        deliveryRow(new Date('2026-09-08T10:30:00Z'), 1, AcceptanceStatus.ACCEPTED, false),
      );

      await expect(service.create(5, { durationMonth: 6 })).rejects.toThrow(
        new ConflictException(WARRANTY_REQUIRES_FINAL_DELIVERY_MESSAGE),
      );
      expect(warrantyModel.create).not.toHaveBeenCalled();
    });

    it('โหลดสถานะการตรวจรับและเครื่องหมายครั้งสุดท้ายมาด้วยตอนหาใบส่งมอบ', async () => {
      // ถ้า attributes ไม่มีสองค่านี้ ค่าจะเป็น undefined แล้วทุกใบจะถูกปฏิเสธ
      let captured: { attributes: string[] } = { attributes: [] };
      deliveryModel.findByPk.mockImplementation(
        (_id: number, options: { attributes: string[] }) => {
          captured = options;
          return Promise.resolve(deliveryRow(new Date('2026-09-08T10:30:00Z')));
        },
      );

      await service.create(5, { durationMonth: 6 });

      expect(captured.attributes).toEqual(expect.arrayContaining(['acceptanceStatus', 'isFinal']));
    });

    it('ออกประกันจากใบส่งมอบที่ไม่มีอยู่ไม่ได้', async () => {
      deliveryModel.findByPk.mockResolvedValue(null);

      await expect(service.create(999, { durationMonth: 12 })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(warrantyModel.create).not.toHaveBeenCalled();
    });

    it('กันการกดสร้างซ้ำด้วยระยะเท่ากันบนใบส่งมอบเดียวกัน', async () => {
      warrantyModel.findOne.mockResolvedValue(warrantyRow());

      await expect(service.create(5, { durationMonth: 12 })).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(warrantyModel.create).not.toHaveBeenCalled();
    });

    it('ไม่นับใบที่ถูกยกเลิกเป็น VOID ว่าซ้ำ', async () => {
      let captured: { deliveryId: number; durationMonth: number; status: Record<symbol, string> } =
        { deliveryId: 0, durationMonth: 0, status: {} };
      warrantyModel.findOne.mockImplementation(
        (options: {
          where: { deliveryId: number; durationMonth: number; status: Record<symbol, string> };
        }) => {
          captured = options.where;
          return Promise.resolve(null);
        },
      );

      await service.create(5, { durationMonth: 12 });

      expect(captured.status[Op.ne]).toBe(WarrantyStatus.VOID);
    });

    it('ออกหลายใบบนใบส่งมอบเดียวกันได้ถ้าระยะต่างกัน', async () => {
      // เคสจริง — ฮาร์ดแวร์รับประกัน 12 เดือน ซอฟต์แวร์ 6 เดือน ส่งมอบพร้อมกัน
      warrantyModel.findOne.mockResolvedValue(null);

      await service.create(5, { durationMonth: 6 });

      expect(warrantyModel.create).toHaveBeenCalledTimes(1);
    });

    it('บันทึกผู้สร้างจาก request context', async () => {
      let captured: { createdBy: number | null } = { createdBy: null };
      warrantyModel.create.mockImplementation((values: { createdBy: number | null }) => {
        captured = values;
        return Promise.resolve(warrantyRow());
      });

      await runWithRequestContext(
        { userId: 42, ipAddress: null, userAgent: null, startedAt: Date.now() },
        () => service.create(5, { durationMonth: 12 }),
      );

      expect(captured.createdBy).toBe(42);
    });
  });

  // -------------------------------------------------------------------------
  // B-13 — ประกันผูกสัญญา MA (อ้างอิงอย่างเดียว ไม่คิดรวม)
  //
  // พี่เลี้ยงปฏิเสธชัดตอนถูกถามว่า "คิดรวมกับ MA?" ว่า "ไม่ใช่คิดรวมนะ"
  // เทสต์ชุดนี้จึงตรึงสองอย่าง: ผูกได้จริง และการผูก *ไม่* ไปเปลี่ยนอะไรของเดิมเลย
  // -------------------------------------------------------------------------
  describe('ผูกสัญญา MA กับประกัน (B-13)', () => {
    it('บันทึก maContractId เมื่อสัญญาเป็นของโครงการเดียวกัน', async () => {
      deliveryModel.findByPk.mockResolvedValue(deliveryRow(new Date(2026, 8, 8), 7));
      maContractModel.findByPk.mockResolvedValue({ id: 3, projectId: 7 });

      let captured: { maContractId: number | null } = { maContractId: null };
      warrantyModel.create.mockImplementation((values: { maContractId: number | null }) => {
        captured = values;
        return Promise.resolve(warrantyRow());
      });

      await service.create(5, { durationMonth: 12, maContractId: 3 });

      expect(captured.maContractId).toBe(3);
    });

    it('ปฏิเสธด้วย 400 เมื่อสัญญาเป็นของคนละโครงการ และไม่สร้างประกันทิ้งไว้', async () => {
      deliveryModel.findByPk.mockResolvedValue(deliveryRow(new Date(2026, 8, 8), 7));
      maContractModel.findByPk.mockResolvedValue({ id: 3, projectId: 99 });

      await expect(service.create(5, { durationMonth: 12, maContractId: 3 })).rejects.toThrow(
        new BadRequestException(WARRANTY_MA_CONTRACT_PROJECT_MISMATCH_MESSAGE),
      );
      expect(warrantyModel.create).not.toHaveBeenCalled();
    });

    it('โยน 404 เมื่อไม่พบสัญญาที่ระบุ', async () => {
      maContractModel.findByPk.mockResolvedValue(null);

      await expect(
        service.create(5, { durationMonth: 12, maContractId: 404 }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(warrantyModel.create).not.toHaveBeenCalled();
    });

    it('ไม่ผูกสัญญาก็ออกประกันได้ตามเดิม และไม่ไปแตะตาราง ma_contracts เลย', async () => {
      let captured: { maContractId: number | null } = { maContractId: 999 };
      warrantyModel.create.mockImplementation((values: { maContractId: number | null }) => {
        captured = values;
        return Promise.resolve(warrantyRow());
      });

      await service.create(5, { durationMonth: 12 });

      expect(captured.maContractId).toBeNull();
      expect(maContractModel.findByPk).not.toHaveBeenCalled();
    });

    it('ถอดการผูกออกได้ด้วยการส่ง null และไม่ต้องไปตรวจสัญญา', async () => {
      const warranty = warrantyRow();
      warrantyModel.findByPk.mockResolvedValue(warranty);

      await service.update(4, { maContractId: null });

      expect(warranty.update).toHaveBeenCalledWith(expect.objectContaining({ maContractId: null }));
      expect(maContractModel.findByPk).not.toHaveBeenCalled();
    });

    it('ไม่ส่ง maContractId มาเลย = คงค่าเดิม ไม่ล้างทิ้ง', async () => {
      const warranty = warrantyRow();
      warrantyModel.findByPk.mockResolvedValue(warranty);

      let patch: { maContractId?: number | null } = {};
      warranty.update.mockImplementation((values: { maContractId?: number | null }) => {
        patch = values;
        return Promise.resolve(warranty);
      });

      await service.update(4, { scopeNote: 'แก้เฉพาะขอบเขต' });

      expect('maContractId' in patch).toBe(false);
    });

    it('การผูกสัญญาไม่เปลี่ยนเงื่อนไขว่าประกันคุ้มครองอยู่ไหม — "ไม่ใช่คิดรวม"', async () => {
      // ถ้าวันหนึ่งมีคนเอาสถานะหรือช่วงวันของสัญญา MA มาร่วมตัดสิน เทสต์นี้จะแดง
      warrantyModel.findOne.mockResolvedValue(warrantyRow({ maContractId: 3 } as never));

      await service.findCoveringWarranty(1, new Date('2026-10-01'));

      const [options] = warrantyModel.findOne.mock.calls[0] as [{ where: Record<string, unknown> }];
      expect(options.where).not.toHaveProperty('maContractId');
      expect(maContractModel.findByPk).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // แก้ไขประกัน — endDate ต้องคำนวณใหม่เสมอ
  // -------------------------------------------------------------------------
  describe('update', () => {
    it('คำนวณวันหมดประกันใหม่จากวันเริ่มเดิมเมื่อเปลี่ยนระยะ', async () => {
      const warranty = warrantyRow({ startDate: '2026-09-08', durationMonth: 12 });
      warrantyModel.findByPk.mockResolvedValue(warranty);

      await service.update(4, { durationMonth: 6 });

      expect(warranty.update).toHaveBeenCalledWith(
        expect.objectContaining({ durationMonth: 6, endDate: '2027-03-07' }),
      );
    });

    it('ไม่แตะวันหมดประกันเมื่อแก้เฉพาะขอบเขตความคุ้มครอง', async () => {
      const warranty = warrantyRow();
      warrantyModel.findByPk.mockResolvedValue(warranty);

      let patch: { endDate?: string; startDate?: string } = {};
      warranty.update.mockImplementation((values: { endDate?: string; startDate?: string }) => {
        patch = values;
        return Promise.resolve(warranty);
      });

      await service.update(4, { scopeNote: 'ไม่รวมรายงานใหม่' });

      expect(patch.endDate).toBeUndefined();
      expect(patch.startDate).toBeUndefined();
    });

    it('ยกเลิกประกันเป็น VOID ได้', async () => {
      const warranty = warrantyRow();
      warrantyModel.findByPk.mockResolvedValue(warranty);

      await service.update(4, { status: WarrantyStatus.VOID });

      expect(warranty.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: WarrantyStatus.VOID }),
      );
    });

    it('โยน 404 เมื่อไม่พบใบประกัน', async () => {
      warrantyModel.findByPk.mockResolvedValue(null);

      await expect(service.update(999, { durationMonth: 6 })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // แก้วันส่งมอบแล้วประกันต้องขยับตาม (BR-06)
  // -------------------------------------------------------------------------
  describe('resyncByDelivery', () => {
    it('ขยับทั้งวันเริ่มและวันหมดตามวันส่งมอบใหม่', async () => {
      const warranty = warrantyRow({ startDate: '2026-09-08', durationMonth: 12 });
      warrantyModel.findAll.mockResolvedValue([warranty]);

      const delivery = { id: 5, deliveredAt: new Date(2026, 9, 1) } as Delivery;
      const shifted = await service.resyncByDelivery(delivery);

      expect(shifted).toBe(1);
      expect(warranty.update).toHaveBeenCalledWith(
        expect.objectContaining({ startDate: '2026-10-02', endDate: '2027-10-01' }),
        { transaction: undefined },
      );
    });

    it('ไม่เขียนอะไรเลยเมื่อวันส่งมอบไม่ได้เปลี่ยนจริง', async () => {
      const warranty = warrantyRow({ startDate: '2026-09-09' });
      warrantyModel.findAll.mockResolvedValue([warranty]);

      const delivery = { id: 5, deliveredAt: new Date(2026, 8, 8, 23, 0) } as Delivery;
      const shifted = await service.resyncByDelivery(delivery);

      expect(shifted).toBe(0);
      expect(warranty.update).not.toHaveBeenCalled();
    });

    it('ขยับทุกใบที่ออกจากใบส่งมอบนั้น โดยคงระยะของแต่ละใบไว้', async () => {
      const hardware = warrantyRow({ id: 1, durationMonth: 12, startDate: '2026-09-08' });
      const software = warrantyRow({ id: 2, durationMonth: 6, startDate: '2026-09-08' });
      warrantyModel.findAll.mockResolvedValue([hardware, software]);

      const delivery = { id: 5, deliveredAt: new Date(2026, 9, 1) } as Delivery;
      await service.resyncByDelivery(delivery);

      expect(hardware.update).toHaveBeenCalledWith(
        expect.objectContaining({ endDate: '2027-10-01' }),
        expect.anything(),
      );
      expect(software.update).toHaveBeenCalledWith(
        expect.objectContaining({ endDate: '2027-04-01' }),
        expect.anything(),
      );
    });

    it('ส่งทรานแซกชันต่อไปให้ทุกแถวที่แก้', async () => {
      const warranty = warrantyRow({ startDate: '2026-09-08' });
      warrantyModel.findAll.mockResolvedValue([warranty]);

      const delivery = { id: 5, deliveredAt: new Date(2026, 9, 1) } as Delivery;
      await service.resyncByDelivery(delivery, TRANSACTION as never);

      expect(warranty.update).toHaveBeenCalledWith(expect.anything(), {
        transaction: TRANSACTION,
      });
    });
  });

  // -------------------------------------------------------------------------
  // ตัวช่วยที่ Phase 7 จะเรียกใช้
  // -------------------------------------------------------------------------
  describe('isUnderWarranty', () => {
    it('ค้นด้วยช่วงวันที่ครอบคลุม และตัดใบที่ถูกยกเลิกออก', async () => {
      let captured: {
        projectId: number;
        status: Record<symbol, string>;
        startDate: Record<symbol, string>;
        endDate: Record<symbol, string>;
      } = { projectId: 0, status: {}, startDate: {}, endDate: {} };

      warrantyModel.findOne.mockImplementation(
        (options: {
          where: {
            projectId: number;
            status: Record<symbol, string>;
            startDate: Record<symbol, string>;
            endDate: Record<symbol, string>;
          };
        }) => {
          captured = options.where;
          return Promise.resolve(warrantyRow());
        },
      );

      await service.isUnderWarranty(1, new Date(2026, 11, 25));

      expect(captured.projectId).toBe(1);
      expect(captured.status[Op.ne]).toBe(WarrantyStatus.VOID);
      // เทียบเป็นวัน ไม่ใช่เวลา เพราะ start_date / end_date เก็บเป็น DATEONLY
      expect(captured.startDate[Op.lte]).toBe('2026-12-25');
      expect(captured.endDate[Op.gte]).toBe('2026-12-25');
    });

    it('คืน true เมื่อมีใบที่ครอบคลุม', async () => {
      warrantyModel.findOne.mockResolvedValue(warrantyRow());

      await expect(service.isUnderWarranty(1)).resolves.toBe(true);
    });

    it('คืน false เมื่อไม่มีใบไหนครอบคลุม', async () => {
      warrantyModel.findOne.mockResolvedValue(null);

      await expect(service.isUnderWarranty(1)).resolves.toBe(false);
    });

    it('ใช้วันนี้เป็นค่าเริ่มต้นเมื่อไม่ระบุวันที่มา', async () => {
      let captured: { endDate: Record<symbol, string> } = { endDate: {} };
      warrantyModel.findOne.mockImplementation(
        (options: { where: { endDate: Record<symbol, string> } }) => {
          captured = options.where;
          return Promise.resolve(null);
        },
      );

      await service.isUnderWarranty(1);

      expect(captured.endDate[Op.gte]).toBe(todayAsDateOnly());
    });

    it('รับวันที่เป็นสตริง YYYY-MM-DD ได้ตรง ๆ', async () => {
      let captured: { endDate: Record<symbol, string> } = { endDate: {} };
      warrantyModel.findOne.mockImplementation(
        (options: { where: { endDate: Record<symbol, string> } }) => {
          captured = options.where;
          return Promise.resolve(null);
        },
      );

      await service.isUnderWarranty(1, '2027-01-15');

      expect(captured.endDate[Op.gte]).toBe('2027-01-15');
    });

    it('เลือกใบที่หมดช้าที่สุดเมื่อครอบคลุมพร้อมกันหลายใบ', async () => {
      let captured: unknown[][] = [];
      warrantyModel.findOne.mockImplementation((options: { order: unknown[][] }) => {
        captured = options.order;
        return Promise.resolve(warrantyRow());
      });

      await service.findCoveringWarranty(1);

      expect(captured[0]).toEqual(['endDate', 'DESC']);
    });
  });

  // -------------------------------------------------------------------------
  // หน้าจอ "ประกันใกล้หมด"
  // -------------------------------------------------------------------------
  describe('findExpiring', () => {
    it('เอาเฉพาะที่หมดภายในช่วงที่ถาม และไม่รวมที่หมดไปแล้ว', async () => {
      let captured: {
        status: Record<symbol, string>;
        endDate: Record<symbol, [string, string]>;
      } = { status: {}, endDate: {} };

      warrantyModel.findAndCountAll.mockImplementation(
        (options: {
          where: { status: Record<symbol, string>; endDate: Record<symbol, [string, string]> };
        }) => {
          captured = options.where;
          return Promise.resolve({ rows: [], count: 0 });
        },
      );

      await service.findExpiring(expiringQueryDto({ days: 30 }));

      const [from, to] = captured.endDate[Op.between];
      expect(from).toBe(todayAsDateOnly());
      expect(to > from).toBe(true);
      expect(captured.status[Op.ne]).toBe(WarrantyStatus.VOID);
    });

    it('เรียงใกล้หมดที่สุดขึ้นก่อนเสมอ ไม่สนใจ sortOrder ที่ส่งมา', async () => {
      let captured: unknown[][] = [];
      warrantyModel.findAndCountAll.mockImplementation((options: { order: unknown[][] }) => {
        captured = options.order;
        return Promise.resolve({ rows: [], count: 0 });
      });

      await service.findExpiring(expiringQueryDto({ sortOrder: 'DESC' }));

      expect(captured[0]).toEqual(['endDate', 'ASC']);
    });
  });

  describe('findAll — รายการทั้งบริษัท', () => {
    it('ค้นเลขที่ประกัน หรือโครงการที่ชื่อ/รหัส/ชื่อลูกค้าตรง และกรองลูกค้าผ่าน join โครงการ', async () => {
      projectModel.findAll.mockResolvedValue([{ id: 1 }, { id: 2 }]);

      await service.findAll(queryDto({ search: 'WAR69', customerId: 7, projectId: 1 }));

      const [options] = warrantyModel.findAndCountAll.mock.calls[0] as [
        {
          where: Record<string | symbol, unknown>;
          include: { model: unknown; required?: boolean; where?: unknown }[];
        },
      ];
      expect(options.where.projectId).toBe(1);
      expect(options.where[Op.or]).toEqual([
        { warrantyNo: { [Op.like]: '%WAR69%' } },
        { projectId: { [Op.in]: [1, 2] } },
      ]);
      const projectJoin = options.include.find((include) => include.model === Project);
      expect(projectJoin).toMatchObject({ required: true, where: { customerId: 7 } });
    });

    it('ไม่มีคำค้นและตัวกรอง = ทุกใบ เรียงตาม endDate เป็นค่าเริ่มต้น', async () => {
      await service.findAll(queryDto());

      const [options] = warrantyModel.findAndCountAll.mock.calls[0] as [
        { where: object; order: unknown[][] },
      ];
      expect(options.where).toEqual({});
      expect(options.order[0]).toEqual(['endDate', 'DESC']);
      expect(projectModel.findAll).not.toHaveBeenCalled();
    });

    it('คืน attachmentCount ของทุกใบด้วย query เดียว ใบที่ไม่มีไฟล์ได้ 0', async () => {
      warrantyModel.findAndCountAll.mockResolvedValue({
        rows: [warrantyRow({ id: 4 }), warrantyRow({ id: 9 })],
        count: 2,
      });
      attachmentModel.count.mockResolvedValue([{ refId: 4, count: 2 }]);

      const result = await service.findAll(queryDto());

      expect(attachmentModel.count).toHaveBeenCalledTimes(1);
      expect(attachmentModel.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { refType: 'WARRANTY', refId: { [Op.in]: [4, 9] } },
          group: ['refId'],
        }),
      );
      expect(result.items.map((item) => [item.id, item.attachmentCount])).toEqual([
        [4, 2],
        [9, 0],
      ]);
      expect(result.items[0].attachments).toEqual([]);
    });

    it('หน้าว่างไม่ยิง query นับไฟล์', async () => {
      await service.findAll(queryDto());

      expect(attachmentModel.count).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // ขอบเขตวันของกฎ "ยังอยู่ในประกันไหม"
  //
  // กฎนี้ถูกเขียนสองที่โดยจำเป็น — เวอร์ชัน SQL ใน findCoveringWarranty() และ
  // เวอร์ชัน JS ใน isWarrantyCurrentlyActive() ที่ใช้คำนวณค่าโชว์บนหน้าจอ
  // เทสต์ชุดนี้ปักหมุดฝั่ง JS ไว้ ถ้ามีใครไปขยับนิยามข้างใดข้างหนึ่งจะเห็นทันที
  // -------------------------------------------------------------------------
  describe('isWarrantyCurrentlyActive', () => {
    const warranty = {
      status: WarrantyStatus.ACTIVE,
      startDate: '2026-09-08',
      endDate: '2027-09-08',
    };

    it('วันแรกของประกันนับว่าคุ้มครองแล้ว', () => {
      expect(isWarrantyCurrentlyActive(warranty, '2026-09-08')).toBe(true);
    });

    it('วันสุดท้ายของประกันยังนับว่าคุ้มครองอยู่', () => {
      // ปลายทางนับรวม ถ้าตัดเป็นไม่คุ้มครอง ลูกค้าจะเสียสิทธิ์ไปหนึ่งวันเต็ม ๆ
      expect(isWarrantyCurrentlyActive(warranty, '2027-09-08')).toBe(true);
    });

    it('วันก่อนเริ่มยังไม่คุ้มครอง', () => {
      expect(isWarrantyCurrentlyActive(warranty, '2026-09-07')).toBe(false);
    });

    it('วันถัดจากวันหมดไม่คุ้มครองแล้ว', () => {
      expect(isWarrantyCurrentlyActive(warranty, '2027-09-09')).toBe(false);
    });

    it('ใบที่ถูกยกเลิกไม่คุ้มครอง แม้วันที่จะอยู่ในช่วง', () => {
      expect(
        isWarrantyCurrentlyActive({ ...warranty, status: WarrantyStatus.VOID }, '2026-12-01'),
      ).toBe(false);
    });

    it('ใบที่ค้างสถานะ EXPIRED ยังคุ้มครองถ้าวันที่ยังอยู่ในช่วง', () => {
      // cron ปรับสถานะเป็นรอบ ค่าที่บันทึกอาจตามไม่ทัน ต้องตัดสินด้วยวันที่
      expect(
        isWarrantyCurrentlyActive({ ...warranty, status: WarrantyStatus.EXPIRED }, '2026-12-01'),
      ).toBe(true);
    });
  });

  it('โยน 404 เมื่อขอรายการประกันของโครงการที่ไม่มีอยู่', async () => {
    projectModel.findByPk.mockResolvedValue(null);

    await expect(service.findAllByProject(999, queryDto())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  // -------------------------------------------------------------------------
  // เอกสารแนบ + พิมพ์ใบรับประกัน (ประชุมทบทวน 22–23 ก.ย.)
  // -------------------------------------------------------------------------
  describe('findOne — เอกสารแนบ', () => {
    it('พ่วงไฟล์แนบ ref_type = WARRANTY ของใบนี้ โดยไม่คืน object key', async () => {
      attachmentModel.findAll.mockResolvedValue([
        {
          id: 30,
          fileName: 'ใบรับประกันเซ็นแล้ว.pdf',
          fileSize: 1024,
          mimeType: 'application/pdf',
          fileUrl: 'warranties/4/2026/09/x.pdf',
          createdAt: new Date('2026-09-28T00:00:00Z'),
        },
      ]);

      const result = await service.findOne(4);

      expect(attachmentModel.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ where: { refType: 'WARRANTY', refId: 4 } }),
      );
      expect(result.attachments).toHaveLength(1);
      expect(result.attachmentCount).toBe(1);
      expect(result.attachments[0].downloadUrl).toBe('/api/attachments/30/download');
      expect(result.attachments[0]).not.toHaveProperty('fileUrl');
    });
  });

  describe('getPrintData', () => {
    function printableRow(contacts: unknown[]) {
      return warrantyRow({
        warrantyNo: 'WAR69-0008',
        delivery: {
          id: 5,
          deliveryNo: 'DLV69-0003',
          title: 'ส่งมอบระบบ',
          version: 'v1.0',
          deliveredAt: new Date('2026-09-07T03:00:00Z'),
          acceptedAt: new Date('2026-09-07T05:00:00Z'),
          acceptedByContact: { name: 'คุณสมศรี' },
        },
        project: {
          id: 1,
          code: 'PRJ69-0001',
          name: 'ระบบคลัง',
          customerId: 2,
          customer: { id: 2, code: 'CUS69-0001', name: 'บริษัท ก', contacts },
        },
      } as unknown as Partial<WarrantyRow>);
    }

    it('ประกอบข้อมูลครบ พร้อมคำแนะนำให้สแกนแนบกลับที่ใบประกัน', async () => {
      warrantyModel.findByPk.mockResolvedValue(
        printableRow([
          { name: 'คนแรก', isPrimary: false },
          { name: 'ผู้ติดต่อหลัก', isPrimary: true, position: null, phone: null, email: null },
        ]),
      );

      const print = await service.getPrintData(4);

      expect(print.warranty.warrantyNo).toBe('WAR69-0008');
      expect(print.delivery.acceptedByContactName).toBe('คุณสมศรี');
      expect(print.customer.name).toBe('บริษัท ก');
      expect(print.primaryContact?.name).toBe('ผู้ติดต่อหลัก');
      expect(print.attachScanHint).toEqual({
        refType: 'WARRANTY',
        refId: 4,
        noteSuggestion: 'ใบรับประกัน WAR69-0008 ลูกค้าเซ็นแล้ว',
      });
    });

    it('ไม่มีผู้ติดต่อหลัก = null ไม่หยิบคนแรกมาแทน', async () => {
      warrantyModel.findByPk.mockResolvedValue(printableRow([{ name: 'คนแรก', isPrimary: false }]));

      await expect(service.getPrintData(4)).resolves.toMatchObject({ primaryContact: null });
    });

    it('ไม่พบใบประกัน → 404', async () => {
      warrantyModel.findByPk.mockResolvedValue(null);

      await expect(service.getPrintData(99)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // -------------------------------------------------------------------------
  // EXPIRED ระบบตัดสินจากวันสิ้นสุด — กติกาเดียวกับสัญญา MA
  // -------------------------------------------------------------------------
  describe('สถานะหมดอายุ', () => {
    it('deriveWarrantyStatus: ACTIVE เลยวันสิ้นสุด → EXPIRED, ขยายแล้ว → ACTIVE, VOID ไม่ขยับ', () => {
      expect(deriveWarrantyStatus(WarrantyStatus.ACTIVE, '2026-09-27', '2026-09-28')).toBe(
        WarrantyStatus.EXPIRED,
      );
      expect(deriveWarrantyStatus(WarrantyStatus.ACTIVE, '2026-09-28', '2026-09-28')).toBe(
        WarrantyStatus.ACTIVE,
      );
      expect(deriveWarrantyStatus(WarrantyStatus.EXPIRED, '2027-01-01', '2026-09-28')).toBe(
        WarrantyStatus.ACTIVE,
      );
      expect(deriveWarrantyStatus(WarrantyStatus.VOID, '2020-01-01', '2026-09-28')).toBe(
        WarrantyStatus.VOID,
      );
    });

    it('ตั้ง EXPIRED เองไม่ได้ → 400', async () => {
      await expect(service.update(4, { status: WarrantyStatus.EXPIRED })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('ขยายระยะประกันที่หมดแล้วจนยังไม่ถึงวันสิ้นสุด → กลับเป็น ACTIVE เอง', async () => {
      const row = warrantyRow({
        startDate: '2020-01-01',
        endDate: '2020-07-01',
        durationMonth: 6,
        status: WarrantyStatus.EXPIRED,
      });
      warrantyModel.findByPk.mockResolvedValue(row);

      await service.update(4, { durationMonth: 120 });

      expect(row.update).toHaveBeenCalledWith(
        expect.objectContaining({ endDate: '2029-12-31', status: WarrantyStatus.ACTIVE }),
      );
    });

    it('expireEndedWarranties เปลี่ยนเฉพาะ ACTIVE ที่ endDate < วันนี้', async () => {
      warrantyModel.update.mockResolvedValue([2]);

      await expect(service.expireEndedWarranties('2026-09-28')).resolves.toBe(2);

      const [values, options] = warrantyModel.update.mock.calls[0] as [
        { status: WarrantyStatus },
        { where: { status: WarrantyStatus; endDate: Record<symbol, string> } },
      ];
      expect(values).toEqual({ status: WarrantyStatus.EXPIRED });
      expect(options.where.status).toBe(WarrantyStatus.ACTIVE);
      expect(options.where.endDate[Op.lt]).toBe('2026-09-28');
      expect(options).toMatchObject({ individualHooks: true });
    });
  });
});
