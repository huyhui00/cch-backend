import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Op, type Order, type Transaction, type WhereOptions } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

import { getCurrentUserId } from '../../common/context/request-context';
import { type PaginatedResult, toPaginatedResult } from '../../common/dto/pagination.dto';
import { MaContract, MaPlan, MaPlanItem } from '../../models';
import {
  CreateMaPlanDto,
  MaPlanItemDto,
  QueryMaPlansDto,
  UpdateMaPlanDto,
} from './dto/ma-plan.dto';
import { type MaPlanResponseDto, toMaPlanResponse } from './dto/ma.response';

const SORTABLE_FIELDS = new Set([
  'id',
  'code',
  'name',
  'sortOrder',
  'bugQuotaPerMonth',
  'createdAt',
]);

/** สร้างใหม่ทุกครั้ง — Sequelize แก้ object ของ include ในที่ตอน normalize ห้ามใช้ร่วมกัน */
function itemsInclude() {
  return {
    model: MaPlanItem,
    required: false,
    separate: true,
    order: [
      ['sortOrder', 'ASC'],
      ['id', 'ASC'],
    ] as Order,
  };
}

/**
 * Phase 8 — แผน MA (โมดูล M5 ส่วนแรก)
 *
 * BR-05 — **เนื้อหาแผนเหมือนกันทุกโครงการ แต่ราคาต่างกัน**
 * ตารางนี้จึงเก็บเฉพาะเนื้อหา ไม่มีคอลัมน์ราคาเลย ราคาอยู่ที่ `ma_contracts.price`
 * ถ้ามีใครเสนอให้เพิ่มราคาลงแผนเพราะ "จะได้ไม่ต้องกรอกทุกครั้ง" ให้ปฏิเสธ —
 * ผลคือต้องก๊อปแผนใหม่ทุกครั้งที่ต่อรองราคาได้ไม่เท่ากัน แล้วเนื้อหาจะไม่เหมือนกันอีกต่อไป
 */
@Injectable()
export class MaPlansService {
  constructor(
    @InjectModel(MaPlan) private readonly planModel: typeof MaPlan,
    @InjectModel(MaPlanItem) private readonly itemModel: typeof MaPlanItem,
    @InjectModel(MaContract) private readonly contractModel: typeof MaContract,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async findAll(query: QueryMaPlansDto): Promise<PaginatedResult<MaPlanResponseDto>> {
    const where: WhereOptions = {};

    if (query.isActive !== undefined) {
      Object.assign(where, { isActive: query.isActive });
    }

    if (query.search) {
      Object.assign(where, {
        [Op.or]: [
          { code: { [Op.like]: `%${query.search}%` } },
          { name: { [Op.like]: `%${query.search}%` } },
        ],
      });
    }

    const sortBy = query.sortBy && SORTABLE_FIELDS.has(query.sortBy) ? query.sortBy : 'sortOrder';

    const { rows, count } = await this.planModel.findAndCountAll({
      where,
      include: [itemsInclude()],
      order: [
        [sortBy, sortBy === 'sortOrder' ? 'ASC' : query.sortOrder],
        ['id', 'ASC'],
      ],
      limit: query.limit,
      offset: query.offset,
      distinct: true,
    });

    return toPaginatedResult(rows.map(toMaPlanResponse), count, query);
  }

  async findOne(id: number): Promise<MaPlanResponseDto> {
    return toMaPlanResponse(await this.findOrFail(id));
  }

  async create(dto: CreateMaPlanDto): Promise<MaPlanResponseDto> {
    const actorId = getCurrentUserId();

    if (dto.code) {
      await this.assertCodeIsAvailable(dto.code);
    }

    const created = await this.sequelize.transaction(async (transaction) => {
      const plan = await this.planModel.create(
        {
          code: dto.code ?? null,
          name: dto.name,
          description: dto.description ?? null,
          bugQuotaPerMonth: dto.bugQuotaPerMonth ?? 0,
          responseTimeHour: dto.responseTimeHour ?? null,
          onsiteQuotaPerMonth: dto.onsiteQuotaPerMonth ?? null,
          isActive: dto.isActive ?? true,
          sortOrder: dto.sortOrder ?? 0,
          createdBy: actorId,
          updatedBy: actorId,
        },
        { transaction },
      );

      if (dto.items && dto.items.length > 0) {
        await this.replaceItems(plan.id, dto.items, transaction);
      }

      return plan;
    });

    return this.findOne(created.id);
  }

  async update(id: number, dto: UpdateMaPlanDto): Promise<MaPlanResponseDto> {
    const actorId = getCurrentUserId();
    const plan = await this.findOrFail(id);

    if (dto.code && dto.code !== plan.code) {
      await this.assertCodeIsAvailable(dto.code, id);
    }

    await this.sequelize.transaction(async (transaction) => {
      await plan.update(
        {
          ...(dto.code !== undefined ? { code: dto.code } : {}),
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.bugQuotaPerMonth !== undefined ? { bugQuotaPerMonth: dto.bugQuotaPerMonth } : {}),
          ...(dto.responseTimeHour !== undefined ? { responseTimeHour: dto.responseTimeHour } : {}),
          ...(dto.onsiteQuotaPerMonth !== undefined
            ? { onsiteQuotaPerMonth: dto.onsiteQuotaPerMonth }
            : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
          updatedBy: actorId,
        },
        { transaction },
      );

      if (dto.items !== undefined) {
        await this.replaceItems(id, dto.items, transaction);
      }
    });

    return this.findOne(id);
  }

  async remove(id: number): Promise<void> {
    const actorId = getCurrentUserId();
    const plan = await this.findOrFail(id);

    const contractCount = await this.contractModel.count({ where: { planId: id } });

    if (contractCount > 0) {
      throw new ConflictException(
        `แผนนี้ถูกใช้ในสัญญา ${contractCount} ฉบับ จึงลบไม่ได้ — ` +
          'ให้ปิดการใช้งานแผนแทน สัญญาเดิมจะยังใช้งานได้ตามปกติ',
      );
    }

    await this.sequelize.transaction(async (transaction) => {
      await this.itemModel.update({ deletedBy: actorId }, { where: { planId: id }, transaction });
      await this.itemModel.destroy({ where: { planId: id }, transaction });

      await plan.update({ deletedBy: actorId }, { transaction });
      await plan.destroy({ transaction });
    });
  }

  private async replaceItems(
    planId: number,
    items: MaPlanItemDto[],
    transaction: Transaction,
  ): Promise<void> {
    const actorId = getCurrentUserId();

    // เขียน deleted_by ก่อน destroy เพราะ paranoid destroy แตะแค่ deleted_at (BR-09)
    await this.itemModel.update({ deletedBy: actorId }, { where: { planId }, transaction });
    await this.itemModel.destroy({ where: { planId }, transaction });

    if (items.length === 0) {
      return;
    }

    await this.itemModel.bulkCreate(
      items.map((item, index) => ({
        planId,
        title: item.title,
        detail: item.detail ?? null,
        sortOrder: index,
        createdBy: actorId,
        updatedBy: actorId,
      })),
      { transaction },
    );
  }

  private async findOrFail(id: number): Promise<MaPlan> {
    const plan = await this.planModel.findByPk(id, { include: [itemsInclude()] });

    if (!plan) {
      throw new NotFoundException('ไม่พบแผน MA นี้');
    }

    return plan;
  }

  /**
   * รหัสแผนห้ามซ้ำ — ค้นแบบ `paranoid: false` ด้วย
   *
   * unique index ที่ฐานข้อมูลไม่สนใจ `deleted_at` แผนที่ถูกลบไปแล้วจึงยังจองรหัสอยู่
   * ถ้าไม่ค้นรวมแถวที่ลบแล้ว ผู้ใช้จะเจอ error ดิบจาก MySQL แทนข้อความไทย
   */
  private async assertCodeIsAvailable(code: string, exceptId?: number): Promise<void> {
    const existing = await this.planModel.findOne({
      where: exceptId === undefined ? { code } : { code, id: { [Op.ne]: exceptId } },
      paranoid: false,
    });

    if (existing) {
      throw new ConflictException(
        existing.deletedAt
          ? `รหัสแผน ${code} เคยถูกใช้กับแผนที่ลบไปแล้ว กรุณาใช้รหัสอื่น`
          : `รหัสแผน ${code} ถูกใช้ไปแล้ว`,
      );
    }
  }
}
