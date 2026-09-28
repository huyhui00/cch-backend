import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Op, type Transaction, type WhereOptions } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

import { getCurrentUserId } from '../../common/context/request-context';
import { type PaginatedResult, toPaginatedResult } from '../../common/dto/pagination.dto';
import { addDays, addMonths, toDateOnly, todayAsDateOnly } from '../../common/utils/date.util';
import { nextGeneratedCode } from '../../common/utils/code-sequence.util';
import {
  AcceptanceStatus,
  Attachment,
  type AttachmentRefType,
  Contact,
  Customer,
  Delivery,
  MaContract,
  MaPlan,
  Project,
  Warranty,
  WarrantyStatus,
} from '../../models';
import {
  CreateWarrantyDto,
  QueryExpiringWarrantiesDto,
  QueryWarrantiesDto,
  UpdateWarrantyDto,
} from './dto/warranty.dto';
import {
  type WarrantyPrintDto,
  type WarrantyResponseDto,
  toWarrantyPrint,
  toWarrantyResponse,
} from './dto/warranty.response';

const ATTACHMENT_REF_TYPE: AttachmentRefType = 'WARRANTY';

const SORTABLE_FIELDS = new Set(['id', 'startDate', 'endDate', 'durationMonth', 'createdAt']);

export const WARRANTY_REQUIRES_ACCEPTANCE_MESSAGE =
  'ต้องให้ลูกค้ายอมรับการส่งมอบนี้ก่อน จึงออกประกันได้ — ' +
  'ประกันเริ่มนับจากการส่งมอบครั้งที่ลูกค้ายอมรับแล้วเท่านั้น';

export const WARRANTY_REQUIRES_FINAL_DELIVERY_MESSAGE =
  'การส่งมอบนี้ไม่ใช่การส่งมอบครั้งสุดท้ายของโครงการ จึงออกประกันไม่ได้ — ' +
  'ประกันออกหลังส่งมอบงานที่ครบแล้วเท่านั้น ถ้าเป็นครั้งสุดท้ายจริงให้ยืนยันที่การตรวจรับก่อน';

export const WARRANTY_MA_CONTRACT_PROJECT_MISMATCH_MESSAGE =
  'สัญญา MA ที่เลือกไม่ใช่สัญญาของโครงการเดียวกันกับประกันใบนี้ — ' +
  'ประกันผูกกับโครงการผ่านใบส่งมอบ จึงผูกได้เฉพาะสัญญาของโครงการนั้น';

export const WARRANTY_EXPIRED_NOT_SETTABLE_MESSAGE =
  'สถานะหมดอายุตั้งเองไม่ได้ — ระบบเปลี่ยนให้เองเมื่อเลยวันสิ้นสุดประกัน ' +
  'ถ้าต้องการยกเลิกประกันให้เลือกยกเลิก (VOID)';

/** ส่งมอบวันนี้ ประกันเริ่มนับพรุ่งนี้เป็นวันที่ 1 ไม่ว่าจะส่งเวลาไหน */
export function warrantyStartDateFor(deliveredAt: Date): string {
  return addDays(toDateOnly(deliveredAt), 1);
}

/**
 * วันสุดท้ายที่ยังคุ้มครอง (นับรวม) = เริ่ม + N เดือน − 1 วัน — ครบ N เดือนพอดี สูตรเดียวกับสัญญา MA รายปี
 * addMonths หนีบวันสิ้นเดือนก่อนลบ: เริ่ม 31 ม.ค. ระยะ 1 เดือน → 27 ก.พ.
 */
export function warrantyEndDateFor(startDate: string, durationMonth: number): string {
  return addDays(addMonths(startDate, durationMonth), -1);
}

/**
 * EXPIRED ระบบตัดสินจากวันสิ้นสุด — กติกาเดียวกับสัญญา MA
 * VOID เป็นการตัดสินของคน ไม่ถูกเปลี่ยนตามวันที่
 */
export function deriveWarrantyStatus(
  status: WarrantyStatus,
  endDate: string,
  today: string,
): WarrantyStatus {
  if (status === WarrantyStatus.ACTIVE && endDate < today) {
    return WarrantyStatus.EXPIRED;
  }
  if (status === WarrantyStatus.EXPIRED && endDate >= today) {
    return WarrantyStatus.ACTIVE;
  }
  return status;
}

/** สร้างใหม่ทุกครั้ง — Sequelize แก้ object ของ include ในที่ตอน normalize ห้ามใช้ร่วมกัน */
function deliveryInclude() {
  return {
    model: Delivery,
    attributes: ['id', 'title', 'version', 'deliveredAt'],
    required: false,
    paranoid: false,
  };
}

/**
 * สัญญา MA ที่ผูกไว้ (B-13) — อ่านมาแสดงว่า "ประกันนี้รวม MA รูปแบบไหน"
 *
 * `paranoid: false` เพราะสัญญาที่ถูกลบไปแล้วยังต้องอ่านชื่อแผนได้ ไม่งั้นประกันเก่า
 * จะแสดงว่าไม่ได้ผูกอะไรเลยทั้งที่ `ma_contract_id` ยังมีค่าอยู่
 */
function maContractInclude() {
  return {
    model: MaContract,
    attributes: ['id', 'contractNo', 'status', 'planId'],
    required: false,
    paranoid: false,
    include: [
      {
        model: MaPlan,
        attributes: ['id', 'code', 'name'],
        required: false,
        paranoid: false,
      },
    ],
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
    @InjectModel(MaContract) private readonly maContractModel: typeof MaContract,
    @InjectModel(Attachment) private readonly attachmentModel: typeof Attachment,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  /**
   * ออกประกันจากใบส่งมอบ
   *
   * projectId และ startDate ไม่ได้มาจาก client ทั้งคู่ — ดึงจากใบส่งมอบที่ระบุใน path
   * นี่คือจุดที่ BR-06 ถูกบังคับจริง ถ้าย้ายไปให้ client ส่งมา กฎจะกลายเป็นแค่ข้อตกลง
   *
   * ออกได้เฉพาะ "การส่งมอบครั้งสุดท้าย" ที่ลูกค้ายอมรับแล้ว (ตกลง 11 ก.ย.) — ประกันเริ่มหลัง
   * ส่งงานที่ครบและลูกค้ายอมรับ ใบที่รอตรวจรับ ถูกตีกลับ หรือเป็นแค่เฟสระหว่างทาง ออกไม่ได้
   */
  async create(deliveryId: number, dto: CreateWarrantyDto): Promise<WarrantyResponseDto> {
    const actorId = getCurrentUserId();
    const delivery = await this.findDeliveryOrFail(deliveryId);

    // สองเงื่อนไขเดียวกับ canIssueWarranty() ที่หน้าจอใช้เปิดปุ่ม — แยกข้อความเพื่อบอกว่าขาดอะไร
    if (delivery.acceptanceStatus !== AcceptanceStatus.ACCEPTED) {
      throw new ConflictException(WARRANTY_REQUIRES_ACCEPTANCE_MESSAGE);
    }

    if (!delivery.isFinal) {
      throw new ConflictException(WARRANTY_REQUIRES_FINAL_DELIVERY_MESSAGE);
    }

    const startDate = warrantyStartDateFor(delivery.deliveredAt);
    const endDate = warrantyEndDateFor(startDate, dto.durationMonth);

    await this.assertNotDuplicate(deliveryId, dto.durationMonth);
    await this.assertMaContractMatchesProject(dto.maContractId, delivery.projectId);

    const warranty = await this.sequelize.transaction(async (transaction) => {
      const warrantyNo = await nextGeneratedCode(this.sequelize, 'WARRANTY', transaction);

      return this.warrantyModel.create(
        {
          deliveryId,
          projectId: delivery.projectId,
          warrantyNo,
          maContractId: dto.maContractId ?? null,
          durationMonth: dto.durationMonth,
          startDate,
          endDate,
          // คีย์ประกันเก่าจากกระดาษที่หมดไปแล้ว บันทึกเป็น EXPIRED ทันที
          status: deriveWarrantyStatus(WarrantyStatus.ACTIVE, endDate, todayAsDateOnly()),
          scopeNote: dto.scopeNote ?? null,
          createdBy: actorId,
          updatedBy: actorId,
        },
        { transaction },
      );
    });

    return this.findOne(warranty.id);
  }

  async findOne(id: number): Promise<WarrantyResponseDto> {
    const warranty = await this.warrantyModel.findByPk(id, {
      include: [deliveryInclude(), projectInclude(), maContractInclude()],
    });

    if (!warranty) {
      throw new NotFoundException('ไม่พบข้อมูลการรับประกัน');
    }

    const attachments = await this.attachmentModel.findAll({
      where: { refType: ATTACHMENT_REF_TYPE, refId: id },
      order: [['id', 'ASC']],
    });

    return toWarrantyResponse(warranty, todayAsDateOnly(), attachments);
  }

  /**
   * ข้อมูลใบรับประกันสำหรับพิมพ์ — คืน JSON หน้าจอจัดหน้ากระดาษเอง
   *
   * ไม่กั้นตามสถานะ: พิมพ์ใบที่หมดแล้วหรือยกเลิกแล้วเข้าแฟ้มได้ หน้าจอใช้ status ทำลายน้ำเอง
   * include ประกาศใหม่ในนี้ทั้งหมด ไม่ใช้ร่วมกับ findOne() (Sequelize แก้ object ของ include ในที่)
   */
  async getPrintData(id: number): Promise<WarrantyPrintDto> {
    const warranty = await this.warrantyModel.findByPk(id, {
      include: [
        {
          model: Delivery,
          required: false,
          paranoid: false,
          include: [{ model: Contact, as: 'acceptedByContact', required: false, paranoid: false }],
        },
        {
          model: Project,
          attributes: ['id', 'code', 'name', 'customerId'],
          required: false,
          paranoid: false,
          include: [
            {
              model: Customer,
              required: false,
              paranoid: false,
              // ผู้ติดต่อที่ถูกลบไปแล้วไม่ควรไปโผล่ในเอกสารใหม่ จึงไม่ปิด paranoid ของชั้นนี้
              include: [{ model: Contact, required: false }],
            },
          ],
        },
        maContractInclude(),
      ],
    });

    if (!warranty) {
      throw new NotFoundException('ไม่พบข้อมูลการรับประกัน');
    }

    const customer = warranty.project?.customer;
    if (!warranty.delivery || !warranty.project || !customer) {
      throw new NotFoundException(
        'ข้อมูลใบส่งมอบ โครงการ หรือลูกค้าของประกันนี้ไม่ครบ จึงพิมพ์ใบรับประกันไม่ได้',
      );
    }

    return toWarrantyPrint({ warranty, customer, onDate: todayAsDateOnly() });
  }

  /** ACTIVE ที่เลยวันสิ้นสุด → EXPIRED — เรียกจาก WarrantyExpiryScheduler */
  async expireEndedWarranties(today: string = todayAsDateOnly()): Promise<number> {
    const [affected] = await this.warrantyModel.update(
      { status: WarrantyStatus.EXPIRED },
      { where: { status: WarrantyStatus.ACTIVE, endDate: { [Op.lt]: today } } },
    );
    return affected;
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
      include: [deliveryInclude(), projectInclude(), maContractInclude()],
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
   * กรองด้วย status != VOID ไม่ใช่ status == ACTIVE เพราะ cron ปรับสถานะรายชั่วโมง
   * ค่าที่บันทึกอาจยังไม่ตรงกับวันที่ ตัดสินจากช่วงวันที่เป็นหลัก
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
      include: [deliveryInclude(), projectInclude(query.customerId), maContractInclude()],
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

    if (dto.status === WarrantyStatus.EXPIRED) {
      throw new BadRequestException(WARRANTY_EXPIRED_NOT_SETTABLE_MESSAGE);
    }

    const durationMonth = dto.durationMonth ?? warranty.durationMonth;
    const endDate =
      dto.durationMonth !== undefined
        ? warrantyEndDateFor(warranty.startDate, durationMonth)
        : warranty.endDate;
    const status = deriveWarrantyStatus(dto.status ?? warranty.status, endDate, todayAsDateOnly());

    // ส่ง null มา = ถอดการผูกออก (ผูกผิดฉบับ) ไม่ส่งมาเลย = คงค่าเดิม
    if (dto.maContractId !== undefined && dto.maContractId !== null) {
      await this.assertMaContractMatchesProject(dto.maContractId, warranty.projectId);
    }

    await warranty.update({
      ...(dto.durationMonth !== undefined ? { durationMonth, endDate } : {}),
      ...(status !== warranty.status ? { status } : {}),
      ...(dto.scopeNote !== undefined ? { scopeNote: dto.scopeNote ?? null } : {}),
      ...(dto.maContractId !== undefined ? { maContractId: dto.maContractId ?? null } : {}),
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
    const startDate = warrantyStartDateFor(delivery.deliveredAt);

    const warranties = await this.warrantyModel.findAll({
      where: { deliveryId: delivery.id },
      transaction,
    });

    const today = todayAsDateOnly();
    let shifted = 0;

    for (const warranty of warranties) {
      if (warranty.startDate === startDate) {
        continue;
      }

      const endDate = warrantyEndDateFor(startDate, warranty.durationMonth);

      // อัปเดตทีละแถวผ่าน instance เพื่อให้ audit hook บันทึก record_id ได้ (BR-09)
      await warranty.update(
        {
          startDate,
          endDate,
          status: deriveWarrantyStatus(warranty.status, endDate, today),
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
      attributes: ['id', 'projectId', 'deliveredAt', 'acceptanceStatus', 'isFinal'],
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
   * สัญญา MA ที่จะผูกต้องเป็นของโครงการเดียวกับประกัน (B-13)
   *
   * ประกันได้ `projectId` มาจากใบส่งมอบเสมอ (BR-06) ส่วนสัญญา MA ก็ผูกโครงการเสมอ (Phase 8)
   * ถ้าปล่อยให้ผูกข้ามโครงการ หน้าจอจะแสดงว่าประกันของโครงการ A รวมแผนของโครงการ B
   * ซึ่งอ่านแล้วเข้าใจผิดทันที และไม่มีทางตรวจเจอเพราะไม่มีใครไล่ดูทีละใบ
   *
   * ค้นแบบ `paranoid: false` ไม่ได้ — สัญญาที่ถูกลบไปแล้วไม่ควรถูกผูกเข้ามาใหม่
   * (การ *อ่าน* สัญญาที่ถูกลบยังทำได้ผ่าน maContractInclude() เพื่อไม่ให้ประกันเก่าแสดงผลเพี้ยน)
   */
  private async assertMaContractMatchesProject(
    maContractId: number | null | undefined,
    projectId: number,
  ): Promise<void> {
    if (maContractId === undefined || maContractId === null) {
      return;
    }

    const contract = await this.maContractModel.findByPk(maContractId, {
      attributes: ['id', 'projectId'],
    });

    if (!contract) {
      throw new NotFoundException('ไม่พบข้อมูลสัญญา MA');
    }

    if (contract.projectId !== projectId) {
      throw new BadRequestException(WARRANTY_MA_CONTRACT_PROJECT_MISMATCH_MESSAGE);
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
