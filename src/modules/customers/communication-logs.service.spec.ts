/// <reference types="jest" />
// TypeScript 6 ไม่ดึง @types/jest เข้ามาให้อัตโนมัติ ต้องอ้างถึงตรงนี้เหมือน spec ตัวอื่น

import { BadRequestException } from '@nestjs/common';
import { Op } from 'sequelize';

import { CommunicationChannel, CommunicationLog, Contact, User } from '../../models';
import { CommunicationLogsService } from './communication-logs.service';
import type { CustomersService } from './customers.service';
import type { QueryCommunicationLogsDto } from './dto/communication-log.dto';

/**
 * เทสต์กฎของ BR-02 ที่ Phase 4 บังคับไว้ (CLAUDE.md 14)
 *
 * บันทึกย้อนหลังได้ แต่บันทึกล่วงหน้าไม่ได้ และผู้ติดต่อที่ระบุต้องอยู่ใต้ลูกค้ารายเดียวกัน
 */

interface ModelMock {
  findByPk: jest.Mock;
  findAndCountAll: jest.Mock;
  create: jest.Mock;
}

function modelMock(): ModelMock {
  return {
    findByPk: jest.fn(),
    findAndCountAll: jest.fn(),
    create: jest.fn(),
  };
}

function baseLogRow() {
  return {
    id: 10,
    customerId: 1,
    contactId: null as number | null,
    channel: CommunicationChannel.LINE,
    occurredAt: new Date('2026-09-01T10:00:00Z'),
    subject: null as string | null,
    content: null as string | null,
    handledByUserId: 9 as number | null,
    handledBy: null,
    contact: null,
    createdAt: new Date('2026-09-01T10:05:00Z'),
    updatedAt: new Date('2026-09-01T10:05:00Z'),
    update: jest.fn(),
    destroy: jest.fn(),
  };
}

type LogRow = ReturnType<typeof baseLogRow>;

function logRow(overrides: Partial<LogRow> = {}): LogRow {
  return { ...baseLogRow(), ...overrides };
}

function queryDto(overrides: Record<string, unknown> = {}): QueryCommunicationLogsDto {
  return {
    page: 1,
    limit: 20,
    offset: 0,
    sortOrder: 'DESC',
    ...overrides,
  } as unknown as QueryCommunicationLogsDto;
}

/** เวลาที่แน่นอนว่าเป็นอดีต ใช้เป็นค่าเริ่มต้นของ dto ที่ไม่ได้ทดสอบเรื่องเวลา */
function pastIso(minutesAgo = 60): string {
  return new Date(Date.now() - minutesAgo * 60 * 1000).toISOString();
}

describe('CommunicationLogsService', () => {
  let logModel: ModelMock;
  let contactModel: ModelMock;
  let userModel: ModelMock;
  let customersService: { findOrFail: jest.Mock; touchLastContactedAt: jest.Mock };
  let service: CommunicationLogsService;

  beforeEach(() => {
    logModel = modelMock();
    contactModel = modelMock();
    userModel = modelMock();
    customersService = {
      findOrFail: jest.fn().mockResolvedValue({ id: 1 }),
      touchLastContactedAt: jest.fn().mockResolvedValue(undefined),
    };

    logModel.create.mockResolvedValue({ id: 10 });
    logModel.findByPk.mockResolvedValue(logRow());
    contactModel.findByPk.mockResolvedValue({ id: 2, customerId: 1 });
    userModel.findByPk.mockResolvedValue({ id: 3 });

    service = new CommunicationLogsService(
      logModel as unknown as typeof CommunicationLog,
      contactModel as unknown as typeof Contact,
      userModel as unknown as typeof User,
      customersService as unknown as CustomersService,
    );
  });

  // -------------------------------------------------------------------------
  // บันทึกย้อนหลังได้ ล่วงหน้าไม่ได้
  // -------------------------------------------------------------------------
  describe('เวลาที่ติดต่อ', () => {
    it('บันทึกย้อนหลังได้ตาม BR-02', async () => {
      const occurredAt = new Date('2026-08-01T09:00:00Z').toISOString();

      await service.create({ customerId: 1, channel: CommunicationChannel.PHONE, occurredAt }, 9);

      expect(logModel.create).toHaveBeenCalledTimes(1);
    });

    it('บันทึกล่วงหน้าไม่ได้', async () => {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      await expect(
        service.create(
          { customerId: 1, channel: CommunicationChannel.PHONE, occurredAt: tomorrow },
          9,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(logModel.create).not.toHaveBeenCalled();
    });

    it('ยอมให้นาฬิกาเครื่อง client คลาดเคลื่อนไปข้างหน้าได้ 5 นาที', async () => {
      // ถ้าไม่เผื่อไว้ ผู้ใช้ที่นาฬิกาเร็วไปนิดเดียวจะบันทึกไม่ได้เลยโดยไม่รู้สาเหตุ
      const slightlyAhead = new Date(Date.now() + 2 * 60 * 1000).toISOString();

      await service.create(
        { customerId: 1, channel: CommunicationChannel.LINE, occurredAt: slightlyAhead },
        9,
      );

      expect(logModel.create).toHaveBeenCalledTimes(1);
    });

    it('ปฏิเสธเวลาที่เกินขอบเขตคลาดเคลื่อนไปแล้ว', async () => {
      const tooFarAhead = new Date(Date.now() + 10 * 60 * 1000).toISOString();

      await expect(
        service.create(
          { customerId: 1, channel: CommunicationChannel.LINE, occurredAt: tooFarAhead },
          9,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('ตรวจเวลาก่อนแก้ไขด้วย ไม่ใช่แค่ตอนสร้าง', async () => {
      logModel.findByPk.mockResolvedValue(logRow());
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      await expect(service.update(10, { occurredAt: tomorrow }, 9)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // ผู้ติดต่อต้องอยู่ใต้ลูกค้ารายเดียวกัน
  // -------------------------------------------------------------------------
  describe('ผู้ติดต่อที่ระบุ', () => {
    it('ระบุผู้ติดต่อของลูกค้ารายอื่นไม่ได้', async () => {
      // ถ้าปล่อยผ่าน ประวัติการคุยจะปนข้ามลูกค้าโดยไม่มีใครสังเกต
      contactModel.findByPk.mockResolvedValue({ id: 2, customerId: 99 });

      await expect(
        service.create(
          {
            customerId: 1,
            contactId: 2,
            channel: CommunicationChannel.LINE,
            occurredAt: pastIso(),
          },
          9,
        ),
      ).rejects.toThrow('ผู้ติดต่อที่ระบุไม่ได้อยู่ภายใต้ลูกค้ารายนี้');
    });

    it('ระบุผู้ติดต่อที่ไม่มีในระบบไม่ได้', async () => {
      contactModel.findByPk.mockResolvedValue(null);

      await expect(
        service.create(
          {
            customerId: 1,
            contactId: 999,
            channel: CommunicationChannel.LINE,
            occurredAt: pastIso(),
          },
          9,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('ตรวจกับลูกค้าเจ้าของบันทึกเดิมตอนแก้ไข ไม่ใช่ค่าที่ส่งมาใหม่', async () => {
      logModel.findByPk.mockResolvedValue(logRow({ customerId: 1 }));
      contactModel.findByPk.mockResolvedValue({ id: 2, customerId: 99 });

      await expect(service.update(10, { contactId: 2 }, 9)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // ผู้ที่คุยกับลูกค้า
  // -------------------------------------------------------------------------
  describe('ผู้บันทึกและผู้ที่คุย', () => {
    it('ถือว่าคนที่บันทึกเป็นคนคุยเอง เมื่อไม่ได้ระบุมา', async () => {
      let captured: { handledByUserId: number | null } = { handledByUserId: null };
      logModel.create.mockImplementation((values: { handledByUserId: number | null }) => {
        captured = values;
        return Promise.resolve({ id: 10 });
      });

      await service.create(
        { customerId: 1, channel: CommunicationChannel.PHONE, occurredAt: pastIso() },
        9,
      );

      expect(captured.handledByUserId).toBe(9);
    });

    it('ใช้ค่าที่ระบุมาเมื่อคนคุยกับคนบันทึกเป็นคนละคน', async () => {
      let captured: { handledByUserId: number | null } = { handledByUserId: null };
      logModel.create.mockImplementation((values: { handledByUserId: number | null }) => {
        captured = values;
        return Promise.resolve({ id: 10 });
      });

      await service.create(
        {
          customerId: 1,
          channel: CommunicationChannel.PHONE,
          occurredAt: pastIso(),
          handledByUserId: 3,
        },
        9,
      );

      expect(captured.handledByUserId).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // ผลต่อ lastContactedAt ของลูกค้า
  // -------------------------------------------------------------------------
  describe('การอัปเดตวันที่ติดต่อล่าสุด', () => {
    it('ส่งเวลาที่คุยจริงไปให้ CustomersService ไม่ใช่เวลาที่กดบันทึก', async () => {
      const occurredAt = new Date('2026-08-15T03:00:00Z');

      await service.create(
        {
          customerId: 1,
          channel: CommunicationChannel.MEETING,
          occurredAt: occurredAt.toISOString(),
        },
        9,
      );

      expect(customersService.touchLastContactedAt).toHaveBeenCalledWith(1, occurredAt);
    });

    it('อัปเดตให้เมื่อแก้ไขเวลาที่คุย', async () => {
      logModel.findByPk.mockResolvedValue(logRow());

      await service.update(10, { occurredAt: '2026-08-20T03:00:00Z' }, 9);

      expect(customersService.touchLastContactedAt).toHaveBeenCalledTimes(1);
    });

    it('ไม่ไปแตะเมื่อแก้ไขเรื่องอื่นที่ไม่ใช่เวลา', async () => {
      logModel.findByPk.mockResolvedValue(logRow());

      await service.update(10, { subject: 'แก้หัวข้อ' }, 9);

      expect(customersService.touchLastContactedAt).not.toHaveBeenCalled();
    });

    it('ไม่ย้อนค่ากลับเมื่อลบบันทึกทิ้ง', async () => {
      // ตั้งใจให้ผิดไปทางเตือนช้า ดีกว่าคำนวณใหม่แล้วเตือนพร่ำเพรื่อจนคนเลิกสนใจ
      const log = logRow();
      logModel.findByPk.mockResolvedValue(log);

      await service.remove(10, 9);

      expect(customersService.touchLastContactedAt).not.toHaveBeenCalled();
      expect(log.update).toHaveBeenCalledWith({ deletedBy: 9 });
      expect(log.destroy).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // ช่วงวันที่ในการค้นหา
  // -------------------------------------------------------------------------
  describe('findAll ด้วยช่วงวันที่', () => {
    beforeEach(() => {
      logModel.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });
    });

    it('ปฏิเสธเมื่อ dateFrom มากกว่า dateTo', async () => {
      await expect(
        service.findAll(queryDto({ dateFrom: '2026-09-30', dateTo: '2026-09-01' })),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('ตีความ dateTo แบบวันที่เปล่าว่าเป็นสิ้นวันนั้น', async () => {
      // ไม่งั้นการค้น "ถึงวันที่ 30" จะไม่เห็นรายการที่เกิดขึ้นในวันที่ 30 เลย
      let captured: Record<symbol, Date> = {};
      logModel.findAndCountAll.mockImplementation(
        (options: { where: { occurredAt: Record<symbol, Date> } }) => {
          captured = options.where.occurredAt;
          return Promise.resolve({ rows: [], count: 0 });
        },
      );

      await service.findAll(queryDto({ dateTo: '2026-09-30' }));

      const to = captured[Op.lte];
      expect(to.getFullYear()).toBe(2026);
      expect(to.getMonth()).toBe(8);
      expect(to.getDate()).toBe(30);
      expect(to.getHours()).toBe(23);
      expect(to.getMinutes()).toBe(59);
    });
  });
});
