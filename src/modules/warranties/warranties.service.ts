import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, type Transaction, type WhereOptions } from 'sequelize';

import { getCurrentUserId } from '../../common/context/request-context';
import { type PaginatedResult, toPaginatedResult } from '../../common/dto/pagination.dto';
import { addMonths, toDateOnly, todayAsDateOnly } from '../../common/utils/date.util';
import { Customer, Delivery, Project, Warranty, WarrantyStatus } from '../../models';
import {
  CreateWarrantyDto,
  QueryExpiringWarrantiesDto,
  QueryWarrantiesDto,
  UpdateWarrantyDto,
} from './dto/warranty.dto';
import { type WarrantyResponseDto, toWarrantyResponse } from './dto/warranty.response';

const SORTABLE_FIELDS = new Set(['id', 'startDate', 'endDate', 'durationMonth', 'createdAt']);

/** สร้างใหม่ทุกครั้ง — Sequelize แก้ object ของ include ในที่ตอน normalize ห้ามใช้ร่วมกัน */
function deliveryInclude() {
  return {
    model: Delivery,
    attributes: ['id', 'title', 'version', 'deliveredAt'],
    required: false,
    paranoid: false,
  };
}

function projectInclude(customerId?: number) {
  return {
    model: Project,
    attributes: ['id', 'name', 'customerId'],
    // กรองตามลูกค้าได้ต้อง join แบบบังคับ ไม่งั้นแถวที่ไม่ตรงจะหลุดมาพร้อม project เป็น null
    required: customerId !== undefined,
    ...(customerId !== undefined ? { where: { customerId } } : {}),
    paranoid: false,
    include: [
      {
        model: Customer,
        attributes: ['id', 'name'],
        required: false,
        paranoid: false,
      },
    ],
  };
}

/**
 * Phase 6 — การรับประกัน (โมดูล M4)
 *
 * BR-06 — ระยะประกันนับจาก "วันส่งมอบ" ประกันจึงผูกกับใบส่งมอบเป็นหลัก
 * `startDate` ไม่เคยรับค่าจากผู้ใช้ คำนวณจาก `deliveries.delivered_at` เสมอ
 *
 * BR-07 — ประกันครอบคลุมเฉพาะ bug ในขอบเขตเดิม ระบบเก็บขอบเขตไว้ที่ `scopeNote`
 * แต่ไม่ได้เอาไปบังคับใช้เอง หน้าที่ของระบบคือตอบว่า "อยู่ในระยะประกันหรือไม่"
 * ส่วนจะเข้าข่ายประกันหรือคิดเงินใหม่เป็นดุลพินิจของคนพิจารณา
 *
 * ไม่ inject DeliveriesService เข้ามาโดยเจตนา ใช้ Delivery model ตรง ๆ แทน
 * เพราะฝั่ง deliveries เรียก service ตัวนี้อยู่แล้วตอนแก้วันส่งมอบ ถ้าอ้างกันสองทาง
 * จะกลายเป็น circular dependency ที่ต้องแก้ด้วย forwardRef โดยไม่จำเป็น
 */
@Injectable()
export class WarrantiesService {
  constructor(
    @InjectModel(Warranty) private readonly warrantyModel: typeof Warranty,
    @InjectModel(Delivery) private readonly deliveryModel: typeof Delivery,
    @InjectModel(Project) private readonly projectModel: typeof Project,
  ) {}

  /**
   * ออกประกันจากใบส่งมอบ
   *
   * projectId และ startDate ไม่ได้มาจาก client ทั้งคู่ — ดึงจากใบส่งมอบที่ระบุใน path
   * นี่คือจุดที่ BR-06 ถูกบังคับจริง ถ้าย้ายไปให้ client ส่งมา กฎจะกลายเป็นแค่ข้อตกลง
   */
  async create(deliveryId: number, dto: CreateWarrantyDto): Promise<WarrantyResponseDto> {
    const actorId = getCurrentUserId();
    const delivery = await this.findDeliveryOrFail(deliveryId);

    const startDate = toDateOnly(delivery.deliveredAt);
    const endDate = addMonths(startDate, dto.durationMonth);

    await this.assertNotDuplicate(deliveryId, dto.durationMonth);

    const warranty = await this.warrantyModel.create({
      deliveryId,
      projectId: delivery.projectId,
      durationMonth: dto.durationMonth,
      startDate,
      endDate,
      status: WarrantyStatus.ACTIVE,
      scopeNote: dto.scopeNote ?? null,
      createdBy: actorId,
      updatedBy: actorId,
    });

    return this.findOne(warranty.id);
  }

  async findOne(id: number): Promise<WarrantyResponseDto> {
    const warranty = await this.warrantyModel.findByPk(id, {
      include: [deliveryInclude(), projectInclude()],
    });

    if (!warranty) {
      throw new NotFoundException('ไม่พบข้อมูลการรับประกัน');
    }

    return toWarrantyResponse(warranty, todayAsDateOnly());
  }

  async findAllByProject(
    projectId: number,
    query: QueryWarrantiesDto,
  ): Promise<PaginatedResult<WarrantyResponseDto>> {
    await this.assertProjectExists(projectId);

    const where: WhereOptions<Warranty> = { projectId };

    if (query.status) {
      Object.assign(where, { status: query.status });
    }

    if (query.deliveryId !== undefined) {
      Object.assign(where, { deliveryId: query.deliveryId });
    }

    const sortBy = SORTABLE_FIELDS.has(query.sortBy ?? '') ? (query.sortBy as string) : 'endDate';

    const { rows, count } = await this.warrantyModel.findAndCountAll({
      where,
      include: [deliveryInclude(), projectInclude()],
      distinct: true,
      order: [
        [sortBy, query.sortOrder],
        ['id', query.sortOrder],
      ],
      limit: query.limit,
      offset: query.offset,
    });

    const onDate = todayAsDateOnly();

    return toPaginatedResult(
      rows.map((warranty) => toWarrantyResponse(warranty, onDate)),
      count,
      query,
    );
  }

  /**
   * หน้าจอ "ประกันใกล้หมด" — ตัวป้อนให้ notification rule แบบ WARRANTY_EXPIRING (Phase 11)
   *
   * ไม่รวมประกันที่หมดอายุไปแล้ว เพราะหน้าจอนี้มีไว้ให้ไล่ต่อสัญญาทัน
   * ของที่สายไปแล้วต้องไปดูที่รายการประกันของโครงการแทน
   *
   * กรองด้วย status != VOID ไม่ใช่ status == ACTIVE เพราะยังไม่มีตัวปรับสถานะ
   * เป็น EXPIRED อัตโนมัติ แถวที่ค้างเป็น EXPIRED จากการแก้มือจึงยังต้องนับด้วย
   * ถ้าวันที่ยังอยู่ในช่วง
   */
  async findExpiring(
    query: QueryExpiringWarrantiesDto,
  ): Promise<PaginatedResult<WarrantyResponseDto>> {
    const today = todayAsDateOnly();
    const until = toDateOnly(new Date(Date.now() + query.days * 24 * 60 * 60 * 1000));

    const { rows, count } = await this.warrantyModel.findAndCountAll({
      where: {
        status: { [Op.ne]: WarrantyStatus.VOID },
        endDate: { [Op.between]: [today, until] },
      },
      include: [deliveryInclude(), projectInclude(query.customerId)],
      distinct: true,
      // ใกล้หมดที่สุดขึ้นก่อนเสมอ ไม่สนใจ sortOrder ที่ส่งมา เพราะหน้าจอนี้มีความหมายเดียว
      order: [
        ['endDate', 'ASC'],
        ['id', 'ASC'],
      ],
      limit: query.limit,
      offset: query.offset,
    });

    return toPaginatedResult(
      rows.map((warranty) => toWarrantyResponse(warranty, today)),
      count,
      query,
    );
  }

  /**
   * แก้ไขประกัน
   *
   * `startDate` แก้ที่นี่ไม่ได้ตาม BR-06 — ถ้าวันส่งมอบผิด ให้ไปแก้ที่ใบส่งมอบ
   * แล้ว resyncByDelivery() จะขยับ startDate กับ endDate ของประกันตามให้เอง
   * ส่วนการแก้ durationMonth ที่นี่จะคำนวณ endDate ใหม่จาก startDate เดิมเสมอ
   */
  async update(id: number, dto: UpdateWarrantyDto): Promise<WarrantyResponseDto> {
    const actorId = getCurrentUserId();
    const warranty = await this.findOrFail(id);

    const durationMonth = dto.durationMonth ?? warranty.durationMonth;

    await warranty.update({
      ...(dto.durationMonth !== undefined
        ? { durationMonth, endDate: addMonths(warranty.startDate, durationMonth) }
        : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...(dto.scopeNote !== undefined ? { scopeNote: dto.scopeNote ?? null } : {}),
      updatedBy: actorId,
    });

    return this.findOne(id);
  }

  // ---- ตัวช่วยที่ Phase 7 (Tickets) จะเรียกใช้ -------------------------------

  /**
   * โครงการนี้ยังอยู่ในระยะประกันไหม ณ วันที่กำหนด
   *
   * Phase 7 เรียกตัวนี้ตอนเปิด ticket เพื่อ suggest ว่า billing_type ควรเป็น WARRANTY
   * หรือไม่ — เป็นแค่ข้อเสนอ ไม่ได้ตั้งค่าให้เอง เพราะประกันครอบคลุมเฉพาะ bug
   * ในขอบเขตเดิม ส่วนงานที่ขอเพิ่มใหม่ต้องคิดเงินแม้จะอยู่ในระยะประกัน (BR-07)
   * การตัดสินว่าเข้าข่ายไหนเป็นดุลพินิจของคน ระบบตอบได้แค่เรื่องช่วงเวลา
   */
  async isUnderWarranty(projectId: number, date: Date | string = new Date()): Promise<boolean> {
    return (await this.findCoveringWarranty(projectId, date)) !== null;
  }

  /**
   * ใบประกันที่ครอบคลุมวันที่กำหนด — คืน null เมื่อไม่มี
   *
   * โครงการหนึ่งมีประกันได้หลายใบ (ส่งมอบหลายรอบ หรือแยกฮาร์ดแวร์กับซอฟต์แวร์)
   * ถ้าครอบคลุมพร้อมกันหลายใบ คืนใบที่หมดช้าที่สุด เพราะเป็นใบที่ให้ความคุ้มครอง
   * ยาวที่สุดและเป็นคำตอบที่เป็นประโยชน์กับคนตัดสินใจมากที่สุด
   *
   * ⚠ เงื่อนไขด้านล่างเป็นเวอร์ชัน SQL ของ `isWarrantyCurrentlyActive()` ใน
   * dto/warranty.response.ts ที่ใช้คำนวณค่าโชว์บนหน้าจอ **แก้ที่นี่ต้องแก้ที่นั่นด้วย**
   * ไม่งั้นหน้าจอกับผลการตรวจตอนเปิด ticket จะตอบไม่ตรงกัน
   */
  async findCoveringWarranty(
    projectId: number,
    date: Date | string = new Date(),
  ): Promise<Warranty | null> {
    const onDate = typeof date === 'string' ? date : toDateOnly(date);

    return this.warrantyModel.findOne({
      where: {
        projectId,
        // VOID คือยกเลิกด้วยมือ ตัดทิ้งเสมอ ส่วน EXPIRED ยังต้องเทียบวันที่อยู่ดี
        // เพราะไม่มีอะไรรับประกันว่าค่านั้นถูกปรับให้ตรงกับความจริงแล้ว
        status: { [Op.ne]: WarrantyStatus.VOID },
        startDate: { [Op.lte]: onDate },
        endDate: { [Op.gte]: onDate },
      },
      include: [deliveryInclude()],
      order: [['endDate', 'DESC']],
    });
  }

  /**
   * ขยับระยะประกันตามวันส่งมอบที่ถูกแก้ — เรียกจาก DeliveriesService.update()
   *
   * ถ้าไม่ทำ ประกันที่ออกไปแล้วจะยังอ้างวันส่งมอบเดิมที่รู้แล้วว่าผิด ซึ่งขัด BR-06
   * โดยตรงและตรวจไม่เจอจนกว่าจะมีคนไล่ดูทีละใบ
   *
   * ทำงานในทรานแซกชันเดียวกับการแก้ใบส่งมอบ ถ้าขยับไม่สำเร็จ การแก้วันส่งมอบ
   * ต้องถูกยกเลิกไปด้วย ไม่ปล่อยให้ค้างอยู่ในสภาพที่ไม่ตรงกัน
   */
  async resyncByDelivery(delivery: Delivery, transaction?: Transaction): Promise<number> {
    const actorId = getCurrentUserId();
    const startDate = toDateOnly(delivery.deliveredAt);

    const warranties = await this.warrantyModel.findAll({
      where: { deliveryId: delivery.id },
      transaction,
    });

    let shifted = 0;

    for (const warranty of warranties) {
      if (warranty.startDate === startDate) {
        continue;
      }

      // อัปเดตทีละแถวผ่าน instance เพื่อให้ audit hook บันทึก record_id ได้ (BR-09)
      await warranty.update(
        {
          startDate,
          endDate: addMonths(startDate, warranty.durationMonth),
          updatedBy: actorId,
        },
        { transaction },
      );

      shifted += 1;
    }

    return shifted;
  }

  // ---- helpers -------------------------------------------------------------

  private async findOrFail(id: number): Promise<Warranty> {
    const warranty = await this.warrantyModel.findByPk(id);

    if (!warranty) {
      throw new NotFoundException('ไม่พบข้อมูลการรับประกัน');
    }

    return warranty;
  }

  private async findDeliveryOrFail(deliveryId: number): Promise<Delivery> {
    const delivery = await this.deliveryModel.findByPk(deliveryId, {
      attributes: ['id', 'projectId', 'deliveredAt'],
    });

    if (!delivery) {
      throw new NotFoundException('ไม่พบข้อมูลการส่งมอบ');
    }

    return delivery;
  }

  private async assertProjectExists(projectId: number): Promise<void> {
    const project = await this.projectModel.findByPk(projectId, { attributes: ['id'] });

    if (!project) {
      throw new NotFoundException('ไม่พบข้อมูลโครงการ');
    }
  }

  /**
   * กันการกดสร้างซ้ำ
   *
   * ห้ามเฉพาะใบที่ระยะเท่ากันเป๊ะบนใบส่งมอบเดียวกันและยังไม่ถูกยกเลิก ซึ่งแทบจะเป็น
   * การกดซ้ำเสมอ ส่วนการออกหลายใบด้วยระยะต่างกันบนใบส่งมอบเดียวยังทำได้
   * เพราะเป็นเคสจริง — ฮาร์ดแวร์รับประกัน 12 เดือน ซอฟต์แวร์ 6 เดือน ส่งมอบพร้อมกัน
   */
  private async assertNotDuplicate(deliveryId: number, durationMonth: number): Promise<void> {
    const existing = await this.warrantyModel.findOne({
      where: {
        deliveryId,
        durationMonth,
        status: { [Op.ne]: WarrantyStatus.VOID },
      },
    });

    if (existing) {
      throw new ConflictException(
        'การส่งมอบนี้มีประกันระยะ ' +
          durationMonth +
          ' เดือนอยู่แล้ว ถ้าต้องการออกใบใหม่ให้ยกเลิกใบเดิมเป็น VOID ก่อน',
      );
    }
  }
}
