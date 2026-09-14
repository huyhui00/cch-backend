/// <reference types="jest" />
// TypeScript 6 ไม่ดึง @types/jest เข้ามาให้อัตโนมัติ ต้องอ้างถึงตรงนี้เหมือน spec ตัวอื่น

import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Op } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';

import { runWithRequestContext } from '../../common/context/request-context';
import {
  AcceptanceStatus,
  Attachment,
  Contact,
  Delivery,
  ProjectStatus,
  User,
  Warranty,
  WarrantyStatus,
} from '../../models';
import { DeliveriesService } from './deliveries.service';
import type { ProjectsService } from '../projects/projects.service';
import type { WarrantiesService } from '../warranties/warranties.service';
import type { QueryDeliveriesDto } from './dto/delivery.dto';

/**
 * เทสต์กฎของ Phase 6 ฝั่งใบส่งมอบ
 *
 * จุดที่ต้องกันแน่นที่สุดคือวันส่งมอบ เพราะมันเป็นจุดตั้งต้นของระยะประกันทั้งระบบ
 * (BR-06) ผิดที่นี่ที่เดียว ประกันทุกใบที่ออกจากใบนี้ผิดตามทันที
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

const TRANSACTION = { name: 'tx' };

function baseDeliveryRow() {
  return {
    id: 5,
    projectId: 1,
    project: null,
    deliveryNo: 'DN-2026-001' as string | null,
    title: 'ส่งมอบระบบเฟสที่ 1',
    version: 'v1.0.0' as string | null,
    description: null as string | null,
    deliveredAt: new Date('2026-09-08T10:30:00Z'),
    acceptanceStatus: AcceptanceStatus.PENDING,
    acceptedAt: null as Date | null,
    acceptedByContactId: null as number | null,
    acceptedByContact: null,
    isFinal: false,
    deliveredByUserId: null as number | null,
    deliveredByUser: null,
    note: null as string | null,
    createdAt: new Date('2026-09-08T10:35:00Z'),
    updatedAt: new Date('2026-09-08T10:35:00Z'),
    update: jest.fn(),
  };
}

type DeliveryRow = ReturnType<typeof baseDeliveryRow>;

function deliveryRow(overrides: Partial<DeliveryRow> = {}): DeliveryRow {
  return { ...baseDeliveryRow(), ...overrides };
}

function projectRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    customerId: 1,
    status: ProjectStatus.IN_PROGRESS,
    actualEndDate: null as string | null,
    update: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function queryDto(overrides: Record<string, unknown> = {}): QueryDeliveriesDto {
  return {
    page: 1,
    limit: 20,
    offset: 0,
    sortOrder: 'DESC',
    ...overrides,
  } as unknown as QueryDeliveriesDto;
}

/** เวลาที่แน่นอนว่าเป็นอดีต ใช้กับเทสต์ที่ไม่ได้ทดสอบเรื่องเวลา */
function pastIso(minutesAgo = 60): string {
  return new Date(Date.now() - minutesAgo * 60 * 1000).toISOString();
}

describe('DeliveriesService', () => {
  let deliveryModel: ModelMock;
  let warrantyModel: ModelMock;
  let contactModel: ModelMock;
  let userModel: ModelMock;
  let attachmentModel: ModelMock;
  let sequelize: { transaction: jest.Mock; query: jest.Mock };
  let projectsService: { findOrFail: jest.Mock };
  let warrantiesService: { resyncByDelivery: jest.Mock };
  let service: DeliveriesService;

  beforeEach(() => {
    deliveryModel = modelMock();
    warrantyModel = modelMock();
    contactModel = modelMock();
    userModel = modelMock();
    attachmentModel = modelMock();
    sequelize = {
      transaction: jest.fn((callback: (t: unknown) => Promise<unknown>) => callback(TRANSACTION)),
      query: jest.fn((sql: string) =>
        sql.includes('SELECT') ? Promise.resolve([{ nextValue: 1 }]) : Promise.resolve([]),
      ),
    };
    projectsService = { findOrFail: jest.fn().mockResolvedValue(projectRow()) };
    warrantiesService = { resyncByDelivery: jest.fn().mockResolvedValue(0) };

    deliveryModel.findByPk.mockResolvedValue(deliveryRow());
    deliveryModel.findOne.mockResolvedValue(null);
    deliveryModel.create.mockResolvedValue(deliveryRow());
    deliveryModel.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });
    warrantyModel.findAll.mockResolvedValue([]);
    warrantyModel.count.mockResolvedValue(0);
    attachmentModel.findAll.mockResolvedValue([]);
    contactModel.findByPk.mockResolvedValue({ id: 2, customerId: 1 });
    userModel.findByPk.mockResolvedValue({ id: 3 });

    service = new DeliveriesService(
      deliveryModel as unknown as typeof Delivery,
      warrantyModel as unknown as typeof Warranty,
      contactModel as unknown as typeof Contact,
      userModel as unknown as typeof User,
      attachmentModel as unknown as typeof Attachment,
      sequelize as unknown as Sequelize,
      projectsService as unknown as ProjectsService,
      warrantiesService as unknown as WarrantiesService,
    );
  });

  // -------------------------------------------------------------------------
  // วันส่งมอบ — จุดตั้งต้นของระยะประกัน (BR-06)
  // -------------------------------------------------------------------------
  describe('วันที่ส่งมอบ', () => {
    it('บันทึกย้อนหลังได้ เพราะบริษัทต้องคีย์ของเก่าเข้าระบบ', async () => {
      await service.create(1, {
        title: 'ส่งมอบเฟสที่ 1',
        deliveredAt: new Date('2026-01-15T09:00:00Z').toISOString(),
      });

      expect(deliveryModel.create).toHaveBeenCalledTimes(1);
    });

    it('ลงวันที่ในอนาคตไม่ได้', async () => {
      // ถ้าปล่อยผ่าน ประกันจะเริ่มในอนาคต แล้ว isUnderWarranty จะตอบว่า
      // "ไม่อยู่ในประกัน" สำหรับ ticket ที่เปิดวันนี้ ทั้งที่หน้าจอบอกว่ามีประกัน
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      await expect(
        service.create(1, { title: 'ส่งมอบ', deliveredAt: tomorrow }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(deliveryModel.create).not.toHaveBeenCalled();
    });

    it('ยอมให้นาฬิกาเครื่อง client คลาดเคลื่อนไปข้างหน้าได้ 5 นาที', async () => {
      const slightlyAhead = new Date(Date.now() + 2 * 60 * 1000).toISOString();

      await service.create(1, { title: 'ส่งมอบ', deliveredAt: slightlyAhead });

      expect(deliveryModel.create).toHaveBeenCalledTimes(1);
    });

    it('ตรวจวันที่ตอนแก้ไขด้วย ไม่ใช่แค่ตอนสร้าง', async () => {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      await expect(service.update(5, { deliveredAt: tomorrow })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(sequelize.transaction).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // แก้วันส่งมอบแล้วประกันต้องขยับตาม
  // -------------------------------------------------------------------------
  describe('update', () => {
    it('สั่งขยับประกันเมื่อวันส่งมอบถูกแก้ และทำในทรานแซกชันเดียวกัน', async () => {
      await service.update(5, { deliveredAt: pastIso() });

      expect(sequelize.transaction).toHaveBeenCalledTimes(1);
      expect(warrantiesService.resyncByDelivery).toHaveBeenCalledWith(
        expect.anything(),
        TRANSACTION,
      );
    });

    it('ไม่ไปยุ่งกับประกันเมื่อแก้เรื่องอื่นที่ไม่ใช่วันส่งมอบ', async () => {
      await service.update(5, { title: 'แก้หัวข้อ' });

      expect(warrantiesService.resyncByDelivery).not.toHaveBeenCalled();
    });

    it('แก้ใบส่งมอบพร้อมกันกับประกันในทรานแซกชันเดียว', async () => {
      const delivery = deliveryRow();
      deliveryModel.findByPk.mockResolvedValue(delivery);

      await service.update(5, { deliveredAt: pastIso() });

      expect(delivery.update).toHaveBeenCalledWith(expect.anything(), {
        transaction: TRANSACTION,
      });
    });

    it('โยน 404 เมื่อไม่พบใบส่งมอบ', async () => {
      deliveryModel.findByPk.mockResolvedValue(null);

      await expect(service.update(999, { title: 'x' })).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // -------------------------------------------------------------------------
  // ผลการตรวจรับ
  // -------------------------------------------------------------------------
  describe('updateAcceptance', () => {
    it('บันทึกเวลาที่รับมอบให้เองเมื่อเปลี่ยนเป็น ACCEPTED', async () => {
      const delivery = deliveryRow({
        acceptanceStatus: AcceptanceStatus.PENDING,
        acceptedAt: null,
      });
      deliveryModel.findByPk.mockResolvedValue(delivery);

      let captured: { acceptanceStatus: AcceptanceStatus; acceptedAt: Date | null } = {
        acceptanceStatus: AcceptanceStatus.PENDING,
        acceptedAt: null,
      };
      delivery.update.mockImplementation(
        (values: { acceptanceStatus: AcceptanceStatus; acceptedAt: Date | null }) => {
          captured = values;
          return Promise.resolve(delivery);
        },
      );

      await service.updateAcceptance(5, { acceptanceStatus: AcceptanceStatus.ACCEPTED });

      expect(captured.acceptanceStatus).toBe(AcceptanceStatus.ACCEPTED);
      expect(captured.acceptedAt).toBeInstanceOf(Date);
    });

    it('ไม่ทับเวลาเดิมเมื่อสั่ง ACCEPTED ซ้ำ', async () => {
      // ไม่งั้นการกดซ้ำจะทำให้ไม่รู้ว่าลูกค้ารับมอบจริงเมื่อไร
      const acceptedAt = new Date('2026-09-10T04:00:00Z');
      const delivery = deliveryRow({ acceptanceStatus: AcceptanceStatus.ACCEPTED, acceptedAt });
      deliveryModel.findByPk.mockResolvedValue(delivery);

      await service.updateAcceptance(5, { acceptanceStatus: AcceptanceStatus.ACCEPTED });

      expect(delivery.update).toHaveBeenCalledWith(
        expect.objectContaining({ acceptedAt }),
        expect.anything(),
      );
    });

    it('ล้างเวลาที่รับมอบเมื่อถอยกลับเป็น REJECTED', async () => {
      // ตรวจรับไปแล้วเพิ่งพบว่าใช้งานไม่ได้จริง ต้องไม่เหลือเวลารับมอบค้างไว้
      const delivery = deliveryRow({
        acceptanceStatus: AcceptanceStatus.ACCEPTED,
        acceptedAt: new Date('2026-09-10T04:00:00Z'),
      });
      deliveryModel.findByPk.mockResolvedValue(delivery);

      await service.updateAcceptance(5, { acceptanceStatus: AcceptanceStatus.REJECTED });

      expect(delivery.update).toHaveBeenCalledWith(
        expect.objectContaining({
          acceptanceStatus: AcceptanceStatus.REJECTED,
          acceptedAt: null,
        }),
        { transaction: TRANSACTION },
      );
    });

    // ตกลง 11 ก.ย. — ใบที่ออกประกันแล้ว (ครั้งสุดท้าย + ยอมรับ) ถอยไม่ได้จนกว่าประกันจะถูก VOID
    it('ใบที่ออกประกันแล้ว ถอยออกจาก ACCEPTED ไม่ได้ และบอกให้ VOID ประกันก่อน', async () => {
      const delivery = deliveryRow({ acceptanceStatus: AcceptanceStatus.ACCEPTED, isFinal: true });
      deliveryModel.findByPk.mockResolvedValue(delivery);
      warrantyModel.count.mockResolvedValue(1);

      for (const next of [AcceptanceStatus.REJECTED, AcceptanceStatus.PENDING]) {
        await expect(
          service.updateAcceptance(5, { acceptanceStatus: next }),
        ).rejects.toBeInstanceOf(ConflictException);
      }
      await expect(
        service.updateAcceptance(5, { acceptanceStatus: AcceptanceStatus.REJECTED }),
      ).rejects.toThrow(/VOID/);
      expect(delivery.update).not.toHaveBeenCalled();
    });

    it('ใบที่ออกประกันแล้ว เอาเครื่องหมายครั้งสุดท้ายออกไม่ได้', async () => {
      const delivery = deliveryRow({ acceptanceStatus: AcceptanceStatus.ACCEPTED, isFinal: true });
      deliveryModel.findByPk.mockResolvedValue(delivery);
      warrantyModel.count.mockResolvedValue(1);

      await expect(
        service.updateAcceptance(5, {
          acceptanceStatus: AcceptanceStatus.ACCEPTED,
          isFinal: false,
        }),
      ).rejects.toThrow(/VOID/);
      expect(delivery.update).not.toHaveBeenCalled();
    });

    it('นับเฉพาะประกันที่ยังไม่ VOID', async () => {
      deliveryModel.findByPk.mockResolvedValue(
        deliveryRow({ acceptanceStatus: AcceptanceStatus.ACCEPTED, isFinal: true }),
      );

      let captured: { where: Record<string, unknown> } = { where: {} };
      warrantyModel.count.mockImplementation((options: { where: Record<string, unknown> }) => {
        captured = options;
        return Promise.resolve(0);
      });

      await service.updateAcceptance(5, { acceptanceStatus: AcceptanceStatus.REJECTED });

      expect(captured.where.deliveryId).toBe(5);
      expect(captured.where.status).toEqual({ [Op.ne]: WarrantyStatus.VOID });
    });

    it('แก้ข้อมูลอื่นของใบที่ยัง ACCEPTED อยู่ได้ แม้มีประกันแล้ว', async () => {
      // ACCEPTED → ACCEPTED (เช่นแก้ผู้รับมอบ) ไม่ใช่การถอยสถานะ ต้องไม่ถูกกั้น
      deliveryModel.findByPk.mockResolvedValue(
        deliveryRow({ acceptanceStatus: AcceptanceStatus.ACCEPTED }),
      );
      warrantyModel.count.mockResolvedValue(2);

      await expect(
        service.updateAcceptance(5, { acceptanceStatus: AcceptanceStatus.ACCEPTED }),
      ).resolves.toBeDefined();
      expect(warrantyModel.count).not.toHaveBeenCalled();
    });

    // ---- การส่งมอบครั้งสุดท้าย (ตกลง 11 ก.ย.) -----------------------------------
    it('ยอมรับ + ครั้งสุดท้าย → โครงการเป็น DELIVERED และวันปิดจริง = วันส่งมอบ ในทรานแซกชันเดียว', async () => {
      const delivery = deliveryRow({ deliveredAt: new Date(2026, 8, 8, 10, 30) });
      deliveryModel.findByPk.mockResolvedValue(delivery);
      const project = projectRow({ status: ProjectStatus.IN_PROGRESS });
      projectsService.findOrFail.mockResolvedValue(project);

      await service.updateAcceptance(5, {
        acceptanceStatus: AcceptanceStatus.ACCEPTED,
        isFinal: true,
      });

      expect(delivery.update).toHaveBeenCalledWith(
        expect.objectContaining({ acceptanceStatus: AcceptanceStatus.ACCEPTED, isFinal: true }),
        { transaction: TRANSACTION },
      );
      expect(project.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: ProjectStatus.DELIVERED, actualEndDate: '2026-09-08' }),
        { transaction: TRANSACTION },
      );
    });

    it('ยอมรับแต่ไม่ใช่ครั้งสุดท้าย (ส่งเป็นเฟส) → โครงการไม่ถูกแตะ', async () => {
      const delivery = deliveryRow();
      deliveryModel.findByPk.mockResolvedValue(delivery);
      const project = projectRow({ status: ProjectStatus.IN_PROGRESS });
      projectsService.findOrFail.mockResolvedValue(project);

      await service.updateAcceptance(5, {
        acceptanceStatus: AcceptanceStatus.ACCEPTED,
        isFinal: false,
      });

      expect(delivery.update).toHaveBeenCalledWith(
        expect.objectContaining({ isFinal: false }),
        expect.anything(),
      );
      expect(project.update).not.toHaveBeenCalled();
    });

    it('ไม่ส่ง isFinal มา = คงค่าเดิม', async () => {
      const delivery = deliveryRow({ acceptanceStatus: AcceptanceStatus.ACCEPTED, isFinal: true });
      deliveryModel.findByPk.mockResolvedValue(delivery);

      await service.updateAcceptance(5, { acceptanceStatus: AcceptanceStatus.ACCEPTED });

      expect(delivery.update).toHaveBeenCalledWith(
        expect.objectContaining({ isFinal: true }),
        expect.anything(),
      );
    });

    it.each([ProjectStatus.CLOSED, ProjectStatus.CANCELLED, ProjectStatus.DELIVERED])(
      'โครงการที่เป็น %s แล้ว ไม่ถูกเปลี่ยนสถานะ',
      async (status) => {
        deliveryModel.findByPk.mockResolvedValue(deliveryRow());
        const project = projectRow({ status });
        projectsService.findOrFail.mockResolvedValue(project);

        await service.updateAcceptance(5, {
          acceptanceStatus: AcceptanceStatus.ACCEPTED,
          isFinal: true,
        });

        expect(project.update).not.toHaveBeenCalled();
      },
    );

    it('1 โครงการมีครั้งสุดท้ายที่ยอมรับแล้วได้ใบเดียว', async () => {
      const delivery = deliveryRow();
      deliveryModel.findByPk.mockResolvedValue(delivery);
      deliveryModel.findOne.mockResolvedValue({ id: 3, title: 'ส่งงานรอบที่ 2', version: '1.0' });

      await expect(
        service.updateAcceptance(5, { acceptanceStatus: AcceptanceStatus.ACCEPTED, isFinal: true }),
      ).rejects.toThrow(/ส่งมอบ #3/);
      expect(delivery.update).not.toHaveBeenCalled();
    });

    it('ตรวจหาครั้งสุดท้ายซ้ำเฉพาะในโครงการเดียวกัน ไม่นับใบตัวเอง', async () => {
      deliveryModel.findByPk.mockResolvedValue(deliveryRow({ projectId: 7 }));
      projectsService.findOrFail.mockResolvedValue(projectRow({ id: 7 }));

      let captured: { where: Record<string, unknown> } = { where: {} };
      deliveryModel.findOne.mockImplementation((options: { where: Record<string, unknown> }) => {
        captured = options;
        return Promise.resolve(null);
      });

      await service.updateAcceptance(5, {
        acceptanceStatus: AcceptanceStatus.ACCEPTED,
        isFinal: true,
      });

      expect(captured.where).toEqual(
        expect.objectContaining({
          projectId: 7,
          isFinal: true,
          acceptanceStatus: AcceptanceStatus.ACCEPTED,
          id: { [Op.ne]: 5 },
        }),
      );
    });

    it('ถอยการส่งมอบครั้งสุดท้าย (ยังไม่ออกประกัน) → โครงการที่เป็น DELIVERED กลับเป็น IN_PROGRESS', async () => {
      deliveryModel.findByPk.mockResolvedValue(
        deliveryRow({ acceptanceStatus: AcceptanceStatus.ACCEPTED, isFinal: true }),
      );
      const project = projectRow({ status: ProjectStatus.DELIVERED });
      projectsService.findOrFail.mockResolvedValue(project);

      await service.updateAcceptance(5, { acceptanceStatus: AcceptanceStatus.REJECTED });

      expect(project.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: ProjectStatus.IN_PROGRESS, actualEndDate: null }),
        { transaction: TRANSACTION },
      );
    });

    it('ถอยกลับเป็น PENDING ได้ ไม่บังคับลำดับ', async () => {
      const delivery = deliveryRow({ acceptanceStatus: AcceptanceStatus.REJECTED });
      deliveryModel.findByPk.mockResolvedValue(delivery);

      await expect(
        service.updateAcceptance(5, { acceptanceStatus: AcceptanceStatus.PENDING }),
      ).resolves.toBeDefined();
    });

    it('ระบุผู้รับมอบที่เป็นคนของลูกค้ารายอื่นไม่ได้', async () => {
      contactModel.findByPk.mockResolvedValue({ id: 2, customerId: 99 });

      await expect(
        service.updateAcceptance(5, {
          acceptanceStatus: AcceptanceStatus.ACCEPTED,
          acceptedByContactId: 2,
        }),
      ).rejects.toThrow('ผู้ติดต่อที่ระบุไม่ได้อยู่ภายใต้ลูกค้าเจ้าของโครงการนี้');
    });
  });

  // -------------------------------------------------------------------------
  // การสร้างใบส่งมอบ
  // -------------------------------------------------------------------------
  describe('create', () => {
    it('เริ่มที่สถานะ PENDING เสมอ แม้จะเป็นการคีย์ย้อนหลัง', async () => {
      // การตรวจรับเป็นคนละเหตุการณ์และใช้สิทธิ์คนละตัว (delivery.accept)
      let captured: { acceptanceStatus: AcceptanceStatus; acceptedAt: Date | null } = {
        acceptanceStatus: AcceptanceStatus.ACCEPTED,
        acceptedAt: new Date(),
      };
      deliveryModel.create.mockImplementation(
        (values: { acceptanceStatus: AcceptanceStatus; acceptedAt: Date | null }) => {
          captured = values;
          return Promise.resolve(deliveryRow());
        },
      );

      await service.create(1, { title: 'ส่งมอบ', deliveredAt: pastIso() });

      expect(captured.acceptanceStatus).toBe(AcceptanceStatus.PENDING);
      expect(captured.acceptedAt).toBeNull();
    });

    it('สร้างเลขที่ใบส่งมอบเองโดยไม่รับรหัสจาก client', async () => {
      deliveryModel.findOne.mockResolvedValue(deliveryRow());

      await expect(
        service.create(1, { title: 'ส่งมอบ', deliveredAt: pastIso(), deliveryNo: 'DN-2026-001' }),
      ).resolves.toBeDefined();
      expect(deliveryModel.findOne).not.toHaveBeenCalled();
    });

    it('ระบุผู้รับมอบที่เป็นคนของลูกค้ารายอื่นไม่ได้', async () => {
      contactModel.findByPk.mockResolvedValue({ id: 2, customerId: 99 });

      await expect(
        service.create(1, {
          title: 'ส่งมอบ',
          deliveredAt: pastIso(),
          acceptedByContactId: 2,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('ระบุพนักงานที่ลาออกแล้วเป็นผู้ส่งมอบได้', async () => {
      // ต่างจากการมอบหมายงาน — นี่คือการบันทึกข้อเท็จจริงในอดีต ไม่ใช่การมอบหมายงานใหม่
      // จึงค้นแบบ paranoid: false และไม่เช็คสถานะพนักงาน
      let captured: { paranoid: boolean } = { paranoid: true };
      userModel.findByPk.mockImplementation((_id: number, options: { paranoid: boolean }) => {
        captured = options;
        return Promise.resolve({ id: 3 });
      });

      await service.create(1, {
        title: 'ส่งมอบ',
        deliveredAt: pastIso(),
        deliveredByUserId: 3,
      });

      expect(captured.paranoid).toBe(false);
      expect(deliveryModel.create).toHaveBeenCalledTimes(1);
    });

    it('โยน 404 ต่อจาก ProjectsService เมื่อโครงการไม่มีอยู่', async () => {
      projectsService.findOrFail.mockRejectedValue(new NotFoundException('ไม่พบข้อมูลโครงการ'));

      await expect(
        service.create(999, { title: 'ส่งมอบ', deliveredAt: pastIso() }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('บันทึกผู้สร้างจาก request context', async () => {
      let captured: { createdBy: number | null } = { createdBy: null };
      deliveryModel.create.mockImplementation((values: { createdBy: number | null }) => {
        captured = values;
        return Promise.resolve(deliveryRow());
      });

      await runWithRequestContext(
        { userId: 42, ipAddress: null, userAgent: null, startedAt: Date.now() },
        () => service.create(1, { title: 'ส่งมอบ', deliveredAt: pastIso() }),
      );

      expect(captured.createdBy).toBe(42);
    });
  });

  // -------------------------------------------------------------------------
  // การเรียงประวัติการส่งมอบ
  // -------------------------------------------------------------------------
  describe('findAllByProject', () => {
    it('เรียงด้วยวันที่ส่งมอบเป็นค่าเริ่มต้น', async () => {
      let captured: unknown[][] = [];
      deliveryModel.findAndCountAll.mockImplementation((options: { order: unknown[][] }) => {
        captured = options.order;
        return Promise.resolve({ rows: [], count: 0 });
      });

      await service.findAllByProject(1, queryDto());

      expect(captured[0][0]).toBe('deliveredAt');
    });

    it('ปฏิเสธการเรียงด้วย version แล้วถอยไปใช้วันที่ส่งมอบ', async () => {
      // version เป็นข้อความอิสระ เรียงแบบพจนานุกรมจะได้ v10 มาก่อน v2
      let captured: unknown[][] = [];
      deliveryModel.findAndCountAll.mockImplementation((options: { order: unknown[][] }) => {
        captured = options.order;
        return Promise.resolve({ rows: [], count: 0 });
      });

      await service.findAllByProject(1, queryDto({ sortBy: 'version' }));

      expect(captured[0][0]).toBe('deliveredAt');
    });

    it('มีตัวตัดสินลำดับรอง เผื่อส่งมอบหลายรอบในวันเดียวกัน', async () => {
      let captured: unknown[][] = [];
      deliveryModel.findAndCountAll.mockImplementation((options: { order: unknown[][] }) => {
        captured = options.order;
        return Promise.resolve({ rows: [], count: 0 });
      });

      await service.findAllByProject(1, queryDto());

      expect(captured[1][0]).toBe('id');
    });
  });

  it('โยน 404 เมื่อดูรายละเอียดใบส่งมอบที่ไม่มีอยู่', async () => {
    deliveryModel.findByPk.mockResolvedValue(null);

    await expect(service.findOne(999)).rejects.toBeInstanceOf(NotFoundException);
  });
});
