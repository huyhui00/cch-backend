/// <reference types="jest" />
// TypeScript 6 ไม่ดึง @types/jest เข้ามาให้อัตโนมัติ ต้องอ้างถึงตรงนี้เหมือน spec ตัวอื่น

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Op } from 'sequelize';

import { Customer, FollowUp, FollowUpStatus, User, UserStatus } from '../../models';
import { todayAsDateOnly } from '../../common/utils/date.util';
import { FollowUpsService } from './follow-ups.service';
import { isFollowUpOverdue } from './dto/follow-up.response';

/**
 * งานติดตามลูกค้า (M7)
 *
 * กฎที่เทสต์ชุดนี้ปักหมุดไว้
 *   1. OVERDUE เป็นค่าที่ *คำนวณ* ไม่ใช่ค่าที่ตั้ง — และเงื่อนไขตอนกรองต้องตรงกับ
 *      ตอนคิดธงบนแต่ละแถว ไม่งั้นรายการที่กรองมากับสิ่งที่แสดงจะขัดกันเอง
 *   2. completed_at ระบบใส่ให้เอง ถอยออกจาก DONE แล้วล้าง เป็น DONE ซ้ำไม่ทับเวลาเดิม
 *   3. ปิดงานติดตาม **ไม่ไปแตะ** customers.last_contacted_at
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

function followUpRow(overrides: Record<string, unknown> = {}): FollowUp {
  return {
    id: 12,
    customerId: 1,
    title: 'โทรถามความคืบหน้า',
    detail: null,
    dueDate: '2026-09-20',
    status: FollowUpStatus.PLANNED,
    assignedUserId: 4,
    completedAt: null,
    resultNote: null,
    customer: { id: 1, name: 'บริษัท ตัวอย่าง จำกัด', code: 'CUS-0001' },
    assignedUser: { id: 4, username: 'somchai', fullName: 'สมชาย ใจดี' },
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    update: jest.fn().mockResolvedValue(undefined),
    destroy: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as FollowUp;
}

describe('FollowUpsService', () => {
  let followUpModel: ModelMock;
  let customerModel: ModelMock;
  let userModel: ModelMock;
  let service: FollowUpsService;

  beforeEach(() => {
    followUpModel = modelMock();
    customerModel = modelMock();
    userModel = modelMock();

    followUpModel.findByPk.mockResolvedValue(followUpRow());
    followUpModel.create.mockResolvedValue(followUpRow());
    followUpModel.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });
    customerModel.findByPk.mockResolvedValue({ id: 1 });
    userModel.findByPk.mockResolvedValue({ id: 4, status: UserStatus.ACTIVE });

    service = new FollowUpsService(
      followUpModel as unknown as typeof FollowUp,
      customerModel as unknown as typeof Customer,
      userModel as unknown as typeof User,
    );
  });

  // -------------------------------------------------------------------------
  // ไม่มี channel — ช่องทางเป็นของบันทึกการติดต่อ (BR-02)
  // -------------------------------------------------------------------------
  it('ไม่เขียนฟิลด์ channel ลงตารางงานติดตาม', async () => {
    // ถ้าวันหนึ่งมีใครเติม channel ลง DTO เทสต์นี้จะจับได้ทันที
    let captured: Record<string, unknown> = {};
    followUpModel.create.mockImplementation((values: Record<string, unknown>) => {
      captured = values;
      return Promise.resolve(followUpRow());
    });

    await service.create({ customerId: 1, title: 'โทรถาม', dueDate: '2026-09-20' });

    expect(Object.keys(captured)).not.toContain('channel');
  });

  // -------------------------------------------------------------------------
  // OVERDUE เป็นค่าที่คำนวณ
  // -------------------------------------------------------------------------
  describe('สถานะเลยกำหนด', () => {
    it('สร้างงานด้วยวันย้อนหลังก็ยังเริ่มที่ PLANNED ไม่ใช่ OVERDUE', async () => {
      let captured: { status: FollowUpStatus } = { status: FollowUpStatus.DONE };
      followUpModel.create.mockImplementation((values: { status: FollowUpStatus }) => {
        captured = values;
        return Promise.resolve(followUpRow());
      });

      await service.create({ customerId: 1, title: 'ตามงานเก่า', dueDate: '2020-01-01' });

      expect(captured.status).toBe(FollowUpStatus.PLANNED);
    });

    it('ตั้งสถานะ OVERDUE เองไม่ได้', async () => {
      await expect(service.update(12, { status: FollowUpStatus.OVERDUE })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('เงื่อนไขตอนกรอง ?overdue=true ตรงกับตอนคิดธงบนแต่ละแถว', async () => {
      // ถ้าสองที่นี้ไม่ตรงกัน จะได้รายการที่กรองมาว่า "เลยกำหนด"
      // แต่แต่ละแถวกลับแสดง isOverdue = false ซึ่งดูเหมือนระบบพัง
      let captured: { status: { [Op.in]: FollowUpStatus[] }; dueDate: { [Op.lt]: string } } = {
        status: { [Op.in]: [] },
        dueDate: { [Op.lt]: '' },
      };
      followUpModel.findAndCountAll.mockImplementation(
        (options: {
          where: { status: { [Op.in]: FollowUpStatus[] }; dueDate: { [Op.lt]: string } };
        }) => {
          captured = options.where;
          return Promise.resolve({ rows: [], count: 0 });
        },
      );

      await service.findAll({
        page: 1,
        limit: 20,
        sortOrder: 'ASC' as never,
        offset: 0,
        overdue: true,
      });

      const today = todayAsDateOnly();

      expect(captured.status[Op.in]).toEqual([FollowUpStatus.PLANNED, FollowUpStatus.OVERDUE]);
      expect(captured.dueDate[Op.lt]).toBe(today);

      // แถวที่เข้าเงื่อนไข query ต้องได้ธง true จากฟังก์ชันที่หน้าจออ่านด้วย
      const row = followUpRow({ dueDate: '2020-01-01', status: FollowUpStatus.PLANNED });
      expect(isFollowUpOverdue(row, today)).toBe(true);
    });

    it('งานที่ปิดไปแล้วไม่นับว่าเลยกำหนด แม้วันครบกำหนดจะผ่านมานานแล้ว', () => {
      const row = followUpRow({ dueDate: '2020-01-01', status: FollowUpStatus.DONE });

      expect(isFollowUpOverdue(row, '2026-09-10')).toBe(false);
    });

    it('งานที่ยกเลิกแล้วไม่นับว่าเลยกำหนด', () => {
      const row = followUpRow({ dueDate: '2020-01-01', status: FollowUpStatus.CANCELLED });

      expect(isFollowUpOverdue(row, '2026-09-10')).toBe(false);
    });

    it('งานที่ครบกำหนดวันนี้ยังไม่นับว่าเลยกำหนด', () => {
      // กติกาเดียวกับงานย่อยใน Phase 5 — ยังมีเวลาทั้งวันให้ทำ
      const row = followUpRow({ dueDate: '2026-09-10' });

      expect(isFollowUpOverdue(row, '2026-09-10')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // completed_at
  // -------------------------------------------------------------------------
  describe('เวลาที่ปิดงาน', () => {
    it('เป็น DONE แล้วระบบใส่ completedAt ให้เอง', async () => {
      let captured: { completedAt?: Date | null } = {};
      const update = jest.fn((values: { completedAt?: Date | null }) => {
        captured = values;
        return Promise.resolve(undefined);
      });
      followUpModel.findByPk.mockResolvedValue(followUpRow({ update }));

      await service.update(12, { status: FollowUpStatus.DONE });

      expect(captured.completedAt).toBeInstanceOf(Date);
    });

    it('เป็น DONE ซ้ำไม่ทับเวลาเดิม', async () => {
      const original = new Date('2026-09-05T10:00:00.000Z');
      let captured: { completedAt?: Date | null } = { completedAt: new Date() };
      const update = jest.fn((values: { completedAt?: Date | null }) => {
        captured = values;
        return Promise.resolve(undefined);
      });
      followUpModel.findByPk.mockResolvedValue(
        followUpRow({ status: FollowUpStatus.DONE, completedAt: original, update }),
      );

      await service.update(12, { status: FollowUpStatus.DONE });

      expect(captured.completedAt).toBeUndefined();
    });

    it('ถอยออกจาก DONE แล้วล้างเวลาทิ้ง', async () => {
      let captured: { completedAt?: Date | null } = {};
      const update = jest.fn((values: { completedAt?: Date | null }) => {
        captured = values;
        return Promise.resolve(undefined);
      });
      followUpModel.findByPk.mockResolvedValue(
        followUpRow({ status: FollowUpStatus.DONE, completedAt: new Date(), update }),
      );

      await service.update(12, { status: FollowUpStatus.PLANNED });

      expect(captured.completedAt).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // ปิดงาน
  // -------------------------------------------------------------------------
  describe('complete', () => {
    it('ไม่ไปแตะ customers.last_contacted_at', async () => {
      // ค่านั้นมีเจ้าของอยู่แล้วคือการบันทึกการติดต่อ ซึ่งมีหลักฐานครบ
      // ถ้าที่นี่เขียนด้วย หน้าจอ "ลูกค้าที่ถูกลืม" จะเงียบทั้งที่ยังไม่มีใครคุยกับลูกค้าจริง
      await service.complete(12, { resultNote: 'โทรแล้ว' });

      expect(customerModel.findByPk).not.toHaveBeenCalled();
    });

    it('งานที่ยกเลิกแล้วปิดงานไม่ได้', async () => {
      followUpModel.findByPk.mockResolvedValue(followUpRow({ status: FollowUpStatus.CANCELLED }));

      await expect(service.complete(12, {})).rejects.toBeInstanceOf(BadRequestException);
    });

    it('ไม่ส่ง resultNote มาก็ไม่ล้างของเดิมทิ้ง', async () => {
      let captured: { resultNote?: string | null } = { resultNote: 'ยังไม่ถูกเขียนทับ' };
      const update = jest.fn((values: { resultNote?: string | null }) => {
        captured = values;
        return Promise.resolve(undefined);
      });
      followUpModel.findByPk.mockResolvedValue(followUpRow({ resultNote: 'ของเดิม', update }));

      await service.complete(12, {});

      expect(captured.resultNote).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // การมอบหมายและการตรวจข้อมูลอ้างอิง
  // -------------------------------------------------------------------------
  describe('การตรวจข้อมูลอ้างอิง', () => {
    it('ไม่พบลูกค้า → 404', async () => {
      customerModel.findByPk.mockResolvedValue(null);

      await expect(
        service.create({ customerId: 99, title: 'x', dueDate: '2026-09-20' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('มอบหมายให้พนักงานที่ลาออกแล้วไม่ได้', async () => {
      userModel.findByPk.mockResolvedValue({
        id: 5,
        status: UserStatus.RESIGNED,
      });

      await expect(
        service.create({ customerId: 1, title: 'x', dueDate: '2026-09-20', assignedUserId: 5 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('ไม่มอบหมายก็สร้างได้ ไม่ต้องไปเช็คพนักงาน', async () => {
      await service.create({ customerId: 1, title: 'x', dueDate: '2026-09-20' });

      expect(userModel.findByPk).not.toHaveBeenCalled();
    });

    it('ไม่พบงานติดตาม → 404', async () => {
      followUpModel.findByPk.mockResolvedValue(null);

      await expect(service.findOne(99)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // -------------------------------------------------------------------------
  // รายการ
  // -------------------------------------------------------------------------
  describe('findAll', () => {
    it('เรียงวันครบกำหนดจากเก่าไปใหม่เป็นค่าเริ่มต้น', async () => {
      // ของที่ค้างนานที่สุดต้องอยู่บนสุด ไม่งั้นหน้าจอ "งานที่ต้องทำ" จะไร้ประโยชน์
      let captured: { order: [string, string][] } = { order: [] };
      followUpModel.findAndCountAll.mockImplementation((options: { order: [string, string][] }) => {
        captured = options;
        return Promise.resolve({ rows: [], count: 0 });
      });

      await service.findAll({ page: 1, limit: 20, sortOrder: 'DESC' as never, offset: 0 });

      expect(captured.order[0]).toEqual(['dueDate', 'ASC']);
    });

    it('ปฏิเสธ sortBy ที่ไม่อยู่ใน whitelist โดยตกกลับไปที่ค่าเริ่มต้น', async () => {
      let captured: { order: [string, string][] } = { order: [] };
      followUpModel.findAndCountAll.mockImplementation((options: { order: [string, string][] }) => {
        captured = options;
        return Promise.resolve({ rows: [], count: 0 });
      });

      await service.findAll({
        page: 1,
        limit: 20,
        sortBy: 'resultNote',
        sortOrder: 'ASC' as never,
        offset: 0,
      });

      expect(captured.order[0][0]).toBe('dueDate');
    });

    it('?overdue=false เอาเฉพาะงานที่ยังไม่ถึงกำหนด', async () => {
      let captured: { dueDate: { [Op.gte]: string } } = { dueDate: { [Op.gte]: '' } };
      followUpModel.findAndCountAll.mockImplementation(
        (options: { where: { dueDate: { [Op.gte]: string } } }) => {
          captured = options.where;
          return Promise.resolve({ rows: [], count: 0 });
        },
      );

      await service.findAll({
        page: 1,
        limit: 20,
        sortOrder: 'ASC' as never,
        offset: 0,
        overdue: false,
      });

      expect(captured.dueDate[Op.gte]).toBe(todayAsDateOnly());
    });
  });
});
