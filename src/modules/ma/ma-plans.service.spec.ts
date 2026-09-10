/// <reference types="jest" />
// TypeScript 6 ไม่ดึง @types/jest เข้ามาให้อัตโนมัติ ต้องอ้างถึงตรงนี้เหมือน spec ตัวอื่น

import { ConflictException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { Sequelize } from 'sequelize-typescript';

import { MaContract, MaPlan, MaPlanItem } from '../../models';
import { CreateMaPlanDto } from './dto/ma-plan.dto';
import { MaPlansService } from './ma-plans.service';

/**
 * แผน MA (Phase 8)
 *
 * BR-05 — เนื้อหาแผนเหมือนกันทุกโครงการ ราคาต่างกัน แผนจึงไม่มีราคา
 * และแผนที่ถูกสัญญาอ้างอยู่ต้องลบไม่ได้ ไม่งั้นสัญญาเก่าจะไม่มีเนื้อหา
 */

interface ModelMock {
  findByPk: jest.Mock;
  findOne: jest.Mock;
  findAll: jest.Mock;
  findAndCountAll: jest.Mock;
  create: jest.Mock;
  bulkCreate: jest.Mock;
  update: jest.Mock;
  destroy: jest.Mock;
  count: jest.Mock;
}

function modelMock(): ModelMock {
  return {
    findByPk: jest.fn(),
    findOne: jest.fn(),
    findAll: jest.fn(),
    findAndCountAll: jest.fn(),
    create: jest.fn(),
    bulkCreate: jest.fn(),
    update: jest.fn(),
    destroy: jest.fn(),
    count: jest.fn(),
  };
}

function planRow(overrides: Record<string, unknown> = {}): MaPlan {
  return {
    id: 2,
    code: 'MA_STANDARD',
    name: 'แผนมาตรฐาน',
    description: null,
    bugQuotaPerMonth: 5,
    responseTimeHour: 24,
    onsiteQuotaPerMonth: null,
    isActive: true,
    sortOrder: 10,
    items: [],
    deletedAt: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    update: jest.fn().mockResolvedValue(undefined),
    destroy: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as MaPlan;
}

describe('MaPlansService', () => {
  let planModel: ModelMock;
  let itemModel: ModelMock;
  let contractModel: ModelMock;
  let service: MaPlansService;

  const sequelize = {
    transaction: jest.fn(<T>(fn: (t: unknown) => Promise<T>) => fn({ name: 'tx' })),
  } as unknown as Sequelize;

  beforeEach(() => {
    planModel = modelMock();
    itemModel = modelMock();
    contractModel = modelMock();

    planModel.findOne.mockResolvedValue(null);
    planModel.findByPk.mockResolvedValue(planRow());
    planModel.create.mockResolvedValue(planRow());
    planModel.findAndCountAll.mockResolvedValue({ rows: [planRow()], count: 1 });
    contractModel.count.mockResolvedValue(0);

    service = new MaPlansService(
      planModel as unknown as typeof MaPlan,
      itemModel as unknown as typeof MaPlanItem,
      contractModel as unknown as typeof MaContract,
      sequelize,
    );
  });

  // -------------------------------------------------------------------------
  // BR-05 — แผนไม่มีราคา
  // -------------------------------------------------------------------------
  it('ไม่เขียนฟิลด์ราคาลงตารางแผนเลย (BR-05)', async () => {
    // ถ้าวันหนึ่งมีใครเติม price ลง CreateMaPlanDto เทสต์นี้จะจับได้ทันที
    let captured: Record<string, unknown> = {};
    planModel.create.mockImplementation((values: Record<string, unknown>) => {
      captured = values;
      return Promise.resolve(planRow());
    });

    await service.create({ code: 'MA_BASIC', name: 'แผนพื้นฐาน' });

    expect(Object.keys(captured)).not.toContain('price');
    expect(Object.keys(captured)).not.toContain('annualFee');
  });

  // -------------------------------------------------------------------------
  // รหัสแผน
  // -------------------------------------------------------------------------
  describe('รหัสแผน', () => {
    it('รหัสซ้ำ → 409', async () => {
      planModel.findOne.mockResolvedValue(planRow());

      await expect(service.create({ code: 'MA_STANDARD', name: 'แผนซ้ำ' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('ค้นรวมแถวที่ลบไปแล้วด้วย เพราะ unique index ไม่สนใจ deleted_at', async () => {
      let captured: { paranoid: boolean } = { paranoid: true };
      planModel.findOne.mockImplementation((options: { paranoid: boolean }) => {
        captured = options;
        return Promise.resolve(null);
      });

      await service.create({ code: 'MA_BASIC', name: 'แผนพื้นฐาน' });

      expect(captured.paranoid).toBe(false);
    });

    it('ชนกับแผนที่ลบไปแล้วได้ข้อความที่บอกสาเหตุจริง', async () => {
      // ไม่งั้นผู้ใช้จะงงว่า "ก็ไม่เห็นมีแผนนี้ในระบบ"
      planModel.findOne.mockResolvedValue(planRow({ deletedAt: new Date() }));

      await expect(service.create({ code: 'MA_STANDARD', name: 'x' })).rejects.toThrow(/ลบไปแล้ว/);
    });

    it('แก้ชื่อโดยไม่แตะรหัส ไม่ต้องไปเช็ครหัสซ้ำ', async () => {
      await service.update(2, { code: 'MA_STANDARD', name: 'ชื่อใหม่' });

      expect(planModel.findOne).not.toHaveBeenCalled();
    });

    // รหัสไม่บังคับแล้ว (ตกลง 10 ก.ย.) — หน้าจอซ่อนช่องนี้ ใช้ชื่อแผนแทน
    it('สร้างแผนโดยไม่ใส่รหัสได้ บันทึกเป็น null และไม่ต้องตรวจซ้ำ', async () => {
      await service.create({ name: 'แผนไม่มีรหัส' });

      expect(planModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ code: null, name: 'แผนไม่มีรหัส' }),
        expect.anything(),
      );
      expect(planModel.findOne).not.toHaveBeenCalled();
    });

    it('สร้างแผนที่ไม่มีรหัสได้หลายแผน — NULL ไม่นับว่าซ้ำ', async () => {
      await expect(service.create({ name: 'แผน ก' })).resolves.toBeDefined();
      await expect(service.create({ name: 'แผน ข', code: null })).resolves.toBeDefined();

      expect(planModel.create).toHaveBeenCalledTimes(2);
      expect(planModel.findOne).not.toHaveBeenCalled();
    });

    it('แก้โดยส่ง code: null = ล้างรหัสออก ไม่ต้องตรวจซ้ำ', async () => {
      const update = jest.fn().mockResolvedValue(undefined);
      planModel.findByPk.mockResolvedValue(planRow({ update }));

      await service.update(2, { code: null, name: 'แผนมาตรฐาน' });

      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ code: null }),
        expect.anything(),
      );
      expect(planModel.findOne).not.toHaveBeenCalled();
    });

    it('ใส่รหัสมาแล้วยังซ้ำไม่ได้ — ทั้งตอนสร้างและตอนแก้', async () => {
      planModel.findOne.mockResolvedValue(planRow({ id: 9, code: 'MA_GOLD' }));

      await expect(service.create({ code: 'MA_GOLD', name: 'x' })).rejects.toBeInstanceOf(
        ConflictException,
      );
      await expect(service.update(2, { code: 'MA_GOLD', name: 'x' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('DTO: รหัสที่เป็นช่องว่างล้วนถูกแปลงเป็น null และผ่าน validation', async () => {
      const dto = plainToInstance(CreateMaPlanDto, { name: 'แผน', code: '   ' });

      expect(dto.code).toBeNull();
      await expect(validate(dto)).resolves.toHaveLength(0);
    });

    it('DTO: ไม่ส่งรหัสมาเลยก็ผ่าน validation', async () => {
      await expect(
        validate(plainToInstance(CreateMaPlanDto, { name: 'แผน' })),
      ).resolves.toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // รายการบริการย่อย
  // -------------------------------------------------------------------------
  describe('รายการบริการย่อย', () => {
    it('ส่ง items มาตอนแก้ = แทนที่ทั้งชุด ไม่ใช่เพิ่มต่อท้าย', async () => {
      await service.update(2, { code: 'MA_STANDARD', name: 'แผนมาตรฐาน', items: [{ title: 'ก' }] });

      expect(itemModel.destroy).toHaveBeenCalled();
      expect(itemModel.bulkCreate).toHaveBeenCalled();
    });

    it('ไม่ส่ง items มา = ไม่แตะรายการเดิม', async () => {
      await service.update(2, { code: 'MA_STANDARD', name: 'ชื่อใหม่' });

      expect(itemModel.destroy).not.toHaveBeenCalled();
    });

    it('ส่ง items เป็นอาเรย์ว่าง = ล้างรายการทั้งหมด', async () => {
      await service.update(2, { code: 'MA_STANDARD', name: 'แผนมาตรฐาน', items: [] });

      expect(itemModel.destroy).toHaveBeenCalled();
      expect(itemModel.bulkCreate).not.toHaveBeenCalled();
    });

    it('เขียน deleted_by ก่อน destroy เพราะ paranoid destroy แตะแค่ deleted_at (BR-09)', async () => {
      await service.update(2, { code: 'MA_STANDARD', name: 'แผนมาตรฐาน', items: [{ title: 'ก' }] });

      expect(itemModel.update.mock.invocationCallOrder[0]).toBeLessThan(
        itemModel.destroy.mock.invocationCallOrder[0],
      );
    });

    it('ลำดับมาจากตำแหน่งในอาเรย์ ไม่ได้รับค่าจาก client', async () => {
      // ลำดับที่ client ส่งมาเองมีโอกาสซ้ำหรือข้ามเลข ทำให้เรียงเพี้ยนหลังลากไปมา
      let captured: { sortOrder: number }[] = [];
      itemModel.bulkCreate.mockImplementation((rows: { sortOrder: number }[]) => {
        captured = rows;
        return Promise.resolve(rows);
      });

      await service.create({
        code: 'MA_BASIC',
        name: 'แผนพื้นฐาน',
        items: [{ title: 'ก' }, { title: 'ข' }, { title: 'ค' }],
      });

      expect(captured.map((row) => row.sortOrder)).toEqual([0, 1, 2]);
    });
  });

  // -------------------------------------------------------------------------
  // ลบแผน
  // -------------------------------------------------------------------------
  describe('remove', () => {
    it('ลบไม่ได้ถ้ามีสัญญาอ้างอยู่ และบอกวิธีที่ควรทำแทน', async () => {
      contractModel.count.mockResolvedValue(3);

      await expect(service.remove(2)).rejects.toBeInstanceOf(ConflictException);
      await expect(service.remove(2)).rejects.toThrow(/ปิดการใช้งาน/);
    });

    it('ลบได้เมื่อยังไม่มีสัญญาใดใช้ และลบรายการย่อยตามไปด้วย', async () => {
      const destroy = jest.fn().mockResolvedValue(undefined);
      planModel.findByPk.mockResolvedValue(planRow({ destroy }));

      await service.remove(2);

      expect(itemModel.destroy).toHaveBeenCalled();
      expect(destroy).toHaveBeenCalled();
    });

    it('ไม่พบแผน → 404', async () => {
      planModel.findByPk.mockResolvedValue(null);

      await expect(service.remove(99)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // -------------------------------------------------------------------------
  // รายการ
  // -------------------------------------------------------------------------
  describe('findAll', () => {
    it('เรียงตาม sortOrder จากน้อยไปมากเป็นค่าเริ่มต้น', async () => {
      let captured: { order: [string, string][] } = { order: [] };
      planModel.findAndCountAll.mockImplementation((options: { order: [string, string][] }) => {
        captured = options;
        return Promise.resolve({ rows: [], count: 0 });
      });

      await service.findAll({ page: 1, limit: 20, sortOrder: 'DESC' as never, offset: 0 });

      expect(captured.order[0]).toEqual(['sortOrder', 'ASC']);
    });

    it('ปฏิเสธ sortBy ที่ไม่อยู่ใน whitelist โดยตกกลับไปที่ค่าเริ่มต้น', async () => {
      // กัน SQL injection ผ่านชื่อคอลัมน์ และกัน 500 จากคอลัมน์ที่ไม่มีอยู่จริง
      let captured: { order: [string, string][] } = { order: [] };
      planModel.findAndCountAll.mockImplementation((options: { order: [string, string][] }) => {
        captured = options;
        return Promise.resolve({ rows: [], count: 0 });
      });

      await service.findAll({
        page: 1,
        limit: 20,
        sortBy: 'price',
        sortOrder: 'ASC' as never,
        offset: 0,
      });

      expect(captured.order[0][0]).toBe('sortOrder');
    });
  });
});
