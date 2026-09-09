/// <reference types="jest" />
// TypeScript 6 ไม่ดึง @types/jest เข้ามาให้อัตโนมัติ ต้องอ้างถึงตรงนี้เหมือน spec ตัวอื่น

import { ConflictException, NotFoundException } from '@nestjs/common';
import { Op } from 'sequelize';

import { runWithRequestContext } from '../../common/context/request-context';
import { todayAsDateOnly, toDateOnly } from '../../common/utils/date.util';
import { Delivery, Project, Warranty, WarrantyStatus } from '../../models';
import { WarrantiesService } from './warranties.service';
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
  create: jest.Mock;
}

function modelMock(): ModelMock {
  return {
    findByPk: jest.fn(),
    findOne: jest.fn(),
    findAll: jest.fn(),
    findAndCountAll: jest.fn(),
    create: jest.fn(),
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

function deliveryRow(deliveredAt: Date, projectId = 1) {
  return { id: 5, projectId, deliveredAt };
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
  let service: WarrantiesService;

  beforeEach(() => {
    warrantyModel = modelMock();
    deliveryModel = modelMock();
    projectModel = modelMock();

    warrantyModel.findOne.mockResolvedValue(null);
    warrantyModel.findAll.mockResolvedValue([]);
    warrantyModel.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });
    warrantyModel.findByPk.mockResolvedValue(warrantyRow());
    warrantyModel.create.mockResolvedValue(warrantyRow());
    deliveryModel.findByPk.mockResolvedValue(deliveryRow(new Date('2026-09-08T10:30:00Z')));
    projectModel.findByPk.mockResolvedValue({ id: 1 });

    service = new WarrantiesService(
      warrantyModel as unknown as typeof Warranty,
      deliveryModel as unknown as typeof Delivery,
      projectModel as unknown as typeof Project,
    );
  });

  // -------------------------------------------------------------------------
  // BR-06 — วันเริ่มประกันมาจากวันส่งมอบเท่านั้น
  // -------------------------------------------------------------------------
  describe('create', () => {
    it('ใช้วันส่งมอบเป็นวันเริ่มประกัน ไม่ได้รับค่าจากผู้ใช้', async () => {
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

      expect(captured.startDate).toBe(toDateOnly(deliveredAt));
      expect(captured.endDate).toBe('2027-09-08');
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
      deliveryModel.findByPk.mockResolvedValue(deliveryRow(new Date(2026, 0, 31, 9, 0)));

      let captured: { endDate: string } = { endDate: '' };
      warrantyModel.create.mockImplementation((values: { endDate: string }) => {
        captured = values;
        return Promise.resolve(warrantyRow());
      });

      await service.create(5, { durationMonth: 1 });

      expect(captured.endDate).toBe('2026-02-28');
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
  // แก้ไขประกัน — endDate ต้องคำนวณใหม่เสมอ
  // -------------------------------------------------------------------------
  describe('update', () => {
    it('คำนวณวันหมดประกันใหม่จากวันเริ่มเดิมเมื่อเปลี่ยนระยะ', async () => {
      const warranty = warrantyRow({ startDate: '2026-09-08', durationMonth: 12 });
      warrantyModel.findByPk.mockResolvedValue(warranty);

      await service.update(4, { durationMonth: 6 });

      expect(warranty.update).toHaveBeenCalledWith(
        expect.objectContaining({ durationMonth: 6, endDate: '2027-03-08' }),
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
        expect.objectContaining({ startDate: '2026-10-01', endDate: '2027-10-01' }),
        { transaction: undefined },
      );
    });

    it('ไม่เขียนอะไรเลยเมื่อวันส่งมอบไม่ได้เปลี่ยนจริง', async () => {
      const warranty = warrantyRow({ startDate: '2026-09-08' });
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
      // ยังไม่มี scheduler ปรับสถานะ ค่าที่ค้างอยู่จึงเชื่อไม่ได้ ต้องตัดสินด้วยวันที่
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
});
