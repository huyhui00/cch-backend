import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Op, type WhereOptions } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

import { getCurrentUserId } from '../../common/context/request-context';
import { type PaginatedResult, toPaginatedResult } from '../../common/dto/pagination.dto';
import { addDays, todayAsDateOnly } from '../../common/utils/date.util';
import { nextGeneratedCode } from '../../common/utils/code-sequence.util';
import {
  Contact,
  Customer,
  MaAddon,
  MaContract,
  MaContractStatus,
  MaPlan,
  MaPlanItem,
  MaUsage,
  Project,
} from '../../models';
import {
  CreateMaAddonDto,
  CreateMaContractDto,
  QueryMaContractsDto,
  RenewMaContractDto,
  UpdateMaContractDto,
} from './dto/ma-contract.dto';
import {
  type MaAddonResponseDto,
  type MaContractPrintDto,
  type MaContractResponseDto,
  type ProjectMaQuotaItemDto,
  type ProjectMaQuotaSummaryDto,
  type QuotaStatusResponseDto,
  toMaAddonResponse,
  toMaContractPrint,
  toMaContractResponse,
} from './dto/ma.response';
import { MaQuotaService } from './ma-quota.service';

const SORTABLE_FIELDS = new Set(['id', 'startDate', 'endDate', 'price', 'status', 'createdAt']);

/** สร้างใหม่ทุกครั้ง — Sequelize แก้ object ของ include ในที่ตอน normalize ห้ามใช้ร่วมกัน */
function planInclude() {
  return { model: MaPlan, required: false, paranoid: false };
}

function customerInclude() {
  return { model: Customer, attributes: ['id', 'name'], required: false, paranoid: false };
}

function projectInclude() {
  return {
    model: Project,
    attributes: ['id', 'name', 'customerId'],
    required: false,
    paranoid: false,
  };
}

/**
 * Phase 8 — สัญญา MA (โมดูล M5 ส่วนที่สอง)
 *
 * BR-05 — ที่นี่คือที่อยู่ของ **ราคา** เนื้อหาอ้างจาก `ma_plans` ผ่าน `plan_id`
 * ไม่ก๊อปมาเก็บซ้ำ สัญญาสองฉบับที่ใช้แผนเดียวกันจึงมีเนื้อหาเหมือนกันเสมอ
 * ต่อให้ราคาต่างกันคนละเท่าตัว
 *
 * สัญญาผูกกับ **โครงการ** เสมอ (`project_id` เป็น NOT NULL) ลูกค้าถูกคัดลอกมาจาก
 * โครงการ ไม่ได้รับจาก client เพื่อไม่ให้เกิดสัญญาที่ลูกค้ากับโครงการเป็นคนละราย
 */
@Injectable()
export class MaContractsService {
  constructor(
    @InjectModel(MaContract) private readonly contractModel: typeof MaContract,
    @InjectModel(MaAddon) private readonly addonModel: typeof MaAddon,
    @InjectModel(MaPlan) private readonly planModel: typeof MaPlan,
    @InjectModel(MaUsage) private readonly usageModel: typeof MaUsage,
    @InjectModel(Project) private readonly projectModel: typeof Project,
    private readonly quotaService: MaQuotaService,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async findAll(query: QueryMaContractsDto): Promise<PaginatedResult<MaContractResponseDto>> {
    const where: WhereOptions = {};

    if (query.customerId !== undefined) {
      Object.assign(where, { customerId: query.customerId });
    }

    if (query.projectId !== undefined) {
      Object.assign(where, { projectId: query.projectId });
    }

    if (query.status !== undefined) {
      Object.assign(where, { status: query.status });
    }

    if (query.expiringInDays !== undefined) {
      const today = todayAsDateOnly();

      // หน้าจอ "สัญญาใกล้หมดอายุ" — เงื่อนไขเดียวกับที่ใช้ตัดสิน isCurrentlyActive
      // คือต้องยัง ACTIVE และยังไม่เลยวันหมดอายุ ไม่งั้นจะมีฉบับที่หมดไปแล้วปนมา
      Object.assign(where, {
        status: MaContractStatus.ACTIVE,
        endDate: { [Op.between]: [today, addDays(today, query.expiringInDays)] },
      });
    }

    if (query.search) {
      Object.assign(where, { contractNo: { [Op.like]: `%${query.search}%` } });
    }

    const sortBy = query.sortBy && SORTABLE_FIELDS.has(query.sortBy) ? query.sortBy : 'endDate';

    const { rows, count } = await this.contractModel.findAndCountAll({
      where,
      include: [planInclude(), customerInclude(), projectInclude()],
      order: [
        [sortBy, query.expiringInDays !== undefined ? 'ASC' : query.sortOrder],
        ['id', 'DESC'],
      ],
      limit: query.limit,
      offset: query.offset,
      distinct: true,
    });

    return toPaginatedResult(
      rows.map((row) => toMaContractResponse(row)),
      count,
      query,
    );
  }

  /** รายละเอียดสัญญา พร้อมของเสริมและสถานะโควตาของรอบที่วันที่กำหนดตกอยู่ */
  async findOne(id: number, onDate?: Date): Promise<MaContractResponseDto> {
    const contract = await this.findOrFail(id);

    const [addons, quota] = await Promise.all([
      this.findAddons(id),
      this.buildQuotaStatus(contract, onDate ?? new Date()),
    ]);

    return toMaContractResponse(contract, { addons, quota });
  }

  /**
   * M6-08 ข้อมูลสำหรับพิมพ์ร่างสัญญา
   *
   * อ่านอย่างเดียว คืน JSON ที่ประกอบครบ ให้ frontend จัดหน้ากระดาษเอง — repo นี้
   * ไม่สร้าง PDF/HTML (CLAUDE.md ข้อ 1) เนื้อหาแผนอ่านสดจาก `ma_plans` ตาม BR-05
   * ไม่ได้ก๊อปเก็บไว้ในสัญญา จึงเป็นเนื้อหาปัจจุบันของแผนเสมอ
   *
   * **ไม่กั้นตามสถานะ** — พิมพ์ฉบับ DRAFT เพื่อไปเซ็น (BR-12) หรือพิมพ์ฉบับที่ยกเลิกแล้ว
   * เพื่อเก็บเข้าแฟ้มก็ได้ `contract.status` ถูกส่งไปให้หน้าจอตัดสินใจเรื่องลายน้ำเอง
   *
   * include ทุกตัวประกาศในนี้ใหม่ทุกครั้ง ไม่ใช้ร่วมกับ `findOrFail()`
   * เพราะ Sequelize แก้ object ของ include ในที่ตอน normalize
   */
  async getPrintData(id: number): Promise<MaContractPrintDto> {
    const contract = await this.contractModel.findByPk(id, {
      include: [
        {
          model: Customer,
          required: false,
          paranoid: false,
          // ผู้ติดต่อที่ถูกลบไปแล้วไม่ควรไปโผล่ในสัญญาใหม่ จึงไม่ปิด paranoid ของชั้นนี้
          include: [{ model: Contact, required: false }],
        },
        {
          model: Project,
          attributes: ['id', 'code', 'name'],
          required: false,
          paranoid: false,
        },
        {
          model: MaPlan,
          required: false,
          paranoid: false,
          include: [{ model: MaPlanItem, required: false }],
        },
        {
          model: MaContract,
          as: 'previousContract',
          attributes: ['id', 'contractNo', 'startDate', 'endDate'],
          required: false,
          paranoid: false,
        },
      ],
    });

    if (!contract) {
      throw new NotFoundException('ไม่พบสัญญา MA นี้');
    }

    // ทั้งสามคอลัมน์เป็น NOT NULL และ include ปิด paranoid แล้ว ถ้ายังหาไม่เจอแปลว่า
    // ข้อมูลอ้างอิงหายไปจริง พิมพ์ต่อไม่ได้ เพราะเอกสารจะขาดคู่สัญญาหรือเนื้อหาบริการ
    if (!contract.customer || !contract.project || !contract.plan) {
      throw new NotFoundException(
        'ข้อมูลลูกค้า โครงการ หรือแผน MA ของสัญญานี้ไม่ครบ จึงพิมพ์ร่างสัญญาไม่ได้',
      );
    }

    return toMaContractPrint({
      contract,
      customer: contract.customer,
      project: contract.project,
      plan: contract.plan,
      addons: await this.findAddons(id),
    });
  }

  /**
   * สร้างสัญญา
   *
   * Q4 ยังไม่ยืนยันว่า 1 โครงการมีสัญญา ACTIVE ซ้อนกันได้ไหม ระบบจึง **ไม่ปฏิเสธ**
   * แต่คืนข้อความเตือนกลับไปให้คนตัดสินใจ เพราะถ้าปฏิเสธไปเลยแล้ววันหนึ่งพบว่า
   * ธุรกิจซ้อนสัญญาจริง (เช่น แยกสัญญาฮาร์ดแวร์กับซอฟต์แวร์) จะกลายเป็นบล็อกงานจริง
   * ส่วนการเตือนแล้วปล่อยผ่านนั้นถอยหลังได้เสมอ — ดู Q4 ใน CLAUDE.md ข้อ 10
   */
  async create(
    dto: CreateMaContractDto,
  ): Promise<{ contract: MaContractResponseDto; warning: string | null }> {
    const actorId = getCurrentUserId();

    this.assertDateRange(dto.startDate, dto.endDate);

    const project = await this.findProjectOrFail(dto.projectId);
    await this.assertPlanIsUsable(dto.planId);

    const status = dto.status ?? MaContractStatus.DRAFT;
    const warning =
      status === MaContractStatus.ACTIVE
        ? await this.describeOverlap(dto.projectId, dto.startDate, dto.endDate)
        : null;

    const contract = await this.sequelize.transaction(async (transaction) => {
      const contractNo = await nextGeneratedCode(this.sequelize, 'MA_CONTRACT', transaction);

      return this.contractModel.create(
        {
          customerId: project.customerId,
          projectId: dto.projectId,
          planId: dto.planId,
          contractNo,
          price: dto.price,
          billingCycle: dto.billingCycle ?? undefined,
          startDate: dto.startDate,
          endDate: dto.endDate,
          status,
          signedDate: dto.signedDate ?? null,
          signedFileUrl: dto.signedFileUrl ?? null,
          note: dto.note ?? null,
          createdBy: actorId,
          updatedBy: actorId,
        },
        { transaction },
      );
    });

    return { contract: await this.findOne(contract.id), warning };
  }

  /**
   * แก้ไขสัญญา
   *
   * ย้ายโครงการไม่ได้โดยเจตนา (DTO ไม่มี `projectId`) และเมื่อสัญญาเริ่มหักโควตาไปแล้ว
   * จะแก้ `startDate` กับ `planId` ไม่ได้อีก เพราะทั้งสองค่าเป็นตัวกำหนดว่าแถวใน
   * `ma_usages` ตกอยู่รอบไหนและรอบนั้นมีโควตาเท่าไหร่ — แก้ทีหลังเท่ากับเขียนประวัติใหม่
   * ให้ยกเลิกฉบับนั้น (CANCELLED) แล้วทำฉบับใหม่แทน
   */
  async update(id: number, dto: UpdateMaContractDto): Promise<MaContractResponseDto> {
    const actorId = getCurrentUserId();
    const contract = await this.findOrFail(id);

    const startDate = dto.startDate ?? contract.startDate;
    const endDate = dto.endDate ?? contract.endDate;
    this.assertDateRange(startDate, endDate);

    const changesStart = dto.startDate !== undefined && dto.startDate !== contract.startDate;
    const changesPlan = dto.planId !== undefined && dto.planId !== contract.planId;

    if (changesStart || changesPlan) {
      const usageCount = await this.usageModel.count({ where: { contractId: id } });

      if (usageCount > 0) {
        throw new ConflictException(
          `สัญญานี้มีการหักโควตาไปแล้ว ${usageCount} ครั้ง จึงแก้${
            changesStart ? 'วันเริ่มสัญญา' : 'แผนที่ใช้'
          }ไม่ได้ เพราะจะทำให้ประวัติการใช้โควตาที่บันทึกไว้ตกรอบผิด — ` +
            'ให้ยกเลิกสัญญาฉบับนี้แล้วทำฉบับใหม่แทน',
        );
      }
    }

    if (changesPlan && dto.planId !== undefined) {
      await this.assertPlanIsUsable(dto.planId);
    }

    if (dto.contractNo !== undefined && dto.contractNo !== contract.contractNo && dto.contractNo) {
      await this.assertContractNoIsAvailable(dto.contractNo, id);
    }

    if (dto.status === MaContractStatus.RENEWED) {
      throw new BadRequestException(
        'สถานะ RENEWED ตั้งเองไม่ได้ — ระบบตั้งให้ฉบับเดิมอัตโนมัติตอนต่อสัญญา',
      );
    }

    await contract.update({
      ...(dto.planId !== undefined ? { planId: dto.planId } : {}),
      ...(dto.price !== undefined ? { price: dto.price } : {}),
      ...(dto.billingCycle !== undefined ? { billingCycle: dto.billingCycle } : {}),
      ...(dto.startDate !== undefined ? { startDate: dto.startDate } : {}),
      ...(dto.endDate !== undefined ? { endDate: dto.endDate } : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...(dto.contractNo !== undefined ? { contractNo: dto.contractNo } : {}),
      ...(dto.signedDate !== undefined ? { signedDate: dto.signedDate } : {}),
      ...(dto.signedFileUrl !== undefined ? { signedFileUrl: dto.signedFileUrl } : {}),
      ...(dto.note !== undefined ? { note: dto.note } : {}),
      updatedBy: actorId,
    });

    return this.findOne(id);
  }

  /**
   * ต่อสัญญา — ฉบับใหม่ + ปิดฉบับเดิมเป็น RENEWED ในทรานแซกชันเดียว
   *
   * ต้องอยู่ในทรานแซกชันเดียวเพราะถ้าสร้างฉบับใหม่สำเร็จแล้วปิดฉบับเดิมไม่สำเร็จ
   * โครงการจะมีสัญญา ACTIVE สองฉบับที่ระบบมองว่าซ้อนกัน แล้วการหักโควตาครั้งถัดไป
   * จะไปตกฉบับไหนก็ได้ — เป็นเคสที่ Q4 ยังไม่มีกติกาไว้รองรับ
   */
  async renew(id: number, dto: RenewMaContractDto): Promise<MaContractResponseDto> {
    const actorId = getCurrentUserId();
    const previous = await this.findOrFail(id);

    this.assertDateRange(dto.startDate, dto.endDate);

    if (previous.status === MaContractStatus.RENEWED) {
      throw new ConflictException('สัญญาฉบับนี้ถูกต่อไปแล้ว ไม่สามารถต่อซ้ำได้');
    }

    if (previous.status === MaContractStatus.CANCELLED) {
      throw new BadRequestException('สัญญาที่ยกเลิกแล้วต่อสัญญาไม่ได้ ให้ทำสัญญาฉบับใหม่แทน');
    }

    if (dto.startDate < previous.startDate) {
      throw new BadRequestException('สัญญาฉบับใหม่ต้องเริ่มหลังวันเริ่มของฉบับเดิม');
    }

    const planId = dto.planId ?? previous.planId;

    if (dto.planId !== undefined && dto.planId !== previous.planId) {
      await this.assertPlanIsUsable(dto.planId);
    }

    if (dto.contractNo) {
      await this.assertContractNoIsAvailable(dto.contractNo);
    }

    const created = await this.sequelize.transaction(async (transaction) => {
      const renewal = await this.contractModel.create(
        {
          customerId: previous.customerId,
          projectId: previous.projectId,
          planId,
          previousContractId: previous.id,
          contractNo: dto.contractNo ?? (await nextGeneratedCode(this.sequelize, 'MA_CONTRACT', transaction)),
          price: dto.price,
          billingCycle: dto.billingCycle ?? previous.billingCycle,
          startDate: dto.startDate,
          endDate: dto.endDate,
          // ฉบับใหม่เริ่มที่ DRAFT เสมอ เพราะยังไม่ได้เซ็น — BR-12 สัญญาเซ็นมือก่อน
          status: MaContractStatus.DRAFT,
          note: dto.note ?? null,
          createdBy: actorId,
          updatedBy: actorId,
        },
        { transaction },
      );

      await previous.update(
        { status: MaContractStatus.RENEWED, updatedBy: actorId },
        { transaction },
      );

      return renewal;
    });

    return this.findOne(created.id);
  }

  // ---- ของเสริม ------------------------------------------------------------

  async findAddons(contractId: number): Promise<MaAddon[]> {
    return this.addonModel.findAll({
      where: { contractId },
      order: [
        ['effectiveYear', 'ASC'],
        ['effectiveMonth', 'ASC'],
        ['id', 'ASC'],
      ],
    });
  }

  async listAddons(contractId: number): Promise<MaAddonResponseDto[]> {
    await this.findOrFail(contractId);

    return (await this.findAddons(contractId)).map(toMaAddonResponse);
  }

  /**
   * เพิ่มของเสริม
   *
   * `effectiveYear` กับ `effectiveMonth` ต้องมาคู่กันหรือไม่มาเลย เพราะ `resolveQuota()`
   * เทียบทั้งสองค่าพร้อมกันกับรอบที่กำลังคำนวณ ถ้ามาแค่ค่าเดียว addon นั้นจะไม่เข้า
   * เงื่อนไขไหนเลย กลายเป็นของที่ลูกค้าจ่ายแล้วแต่ระบบไม่เคยนับให้
   */
  async createAddon(contractId: number, dto: CreateMaAddonDto): Promise<MaAddonResponseDto> {
    const actorId = getCurrentUserId();
    const contract = await this.findOrFail(contractId);

    const hasYear = dto.effectiveYear !== undefined && dto.effectiveYear !== null;
    const hasMonth = dto.effectiveMonth !== undefined && dto.effectiveMonth !== null;

    if (hasYear !== hasMonth) {
      throw new BadRequestException(
        'ต้องระบุทั้งปีและเดือนที่ของเสริมมีผล หรือไม่ระบุทั้งคู่เพื่อให้มีผลตลอดอายุสัญญา',
      );
    }

    if (contract.status === MaContractStatus.CANCELLED) {
      throw new BadRequestException('สัญญาที่ยกเลิกแล้วเพิ่มของเสริมไม่ได้');
    }

    const addon = await this.addonModel.create({
      contractId,
      addonType: dto.addonType ?? undefined,
      title: dto.title,
      extraQuota: dto.extraQuota ?? 0,
      price: dto.price ?? '0',
      effectiveYear: hasYear ? dto.effectiveYear : null,
      effectiveMonth: hasMonth ? dto.effectiveMonth : null,
      note: dto.note ?? null,
      createdBy: actorId,
      updatedBy: actorId,
    });

    return toMaAddonResponse(addon);
  }

  // ---- โควตา ---------------------------------------------------------------

  /**
   * สรุปโควตาของสัญญา MA ทั้งหมดในโปรเจคหนึ่ง
   *
   * ประชุมทบทวนระบบ: การใช้โควตา/ครั้งที่เหลือให้ดูที่โปรเจค (ใหญ่ → ย่อย)
   * หน้ารายการสัญญาเป็นภาพรวมอย่างเดียว ไม่ยัดรายการใช้ทุกโปรเจคเข้าไป
   * รูปโควตาต่อฉบับใช้ `buildQuotaStatus()` ตัวเดียวกับ GET /ma-contracts/:id/quota
   */
  async listQuotaForProject(
    projectId: number,
    onDate?: Date,
  ): Promise<ProjectMaQuotaSummaryDto> {
    await this.findProjectOrFail(projectId);

    const contracts = await this.contractModel.findAll({
      where: { projectId },
      include: [planInclude(), customerInclude(), projectInclude()],
      order: [
        ['endDate', 'DESC'],
        ['id', 'DESC'],
      ],
    });

    const asOf = onDate ?? new Date();
    const items: ProjectMaQuotaItemDto[] = [];

    for (const contract of contracts) {
      items.push({
        contract: toMaContractResponse(contract),
        quota: await this.buildQuotaStatus(contract, asOf),
      });
    }

    return { projectId, items };
  }

  /** สถานะโควตาของรอบที่วันที่กำหนดตกอยู่ — ใช้โชว์บนหน้าจอสัญญาและก่อนกดบันทึกการแก้ไข */
  async getQuota(contractId: number, onDate?: Date): Promise<QuotaStatusResponseDto> {
    const contract = await this.findOrFail(contractId);

    return this.buildQuotaStatus(contract, onDate ?? new Date());
  }

  private async buildQuotaStatus(
    contract: MaContract,
    onDate: Date,
  ): Promise<QuotaStatusResponseDto> {
    const status = await this.quotaService.getQuotaStatus(contract, onDate);

    return {
      contractId: status.contractId,
      periodYear: status.periodYear,
      periodMonth: status.periodMonth,
      periodStart: status.periodStart,
      periodEnd: status.periodEnd,
      quota: status.quota,
      used: status.used,
      remaining: status.quota - status.used,
      isExhausted: status.willExceed,
    };
  }

  // ---- helpers -------------------------------------------------------------

  private assertDateRange(startDate: string, endDate: string): void {
    // เทียบสตริงได้ตรง ๆ เพราะ YYYY-MM-DD เรียงตามพจนานุกรมแล้วได้ลำดับเวลาที่ถูกต้อง
    if (endDate <= startDate) {
      throw new BadRequestException('วันสิ้นสุดสัญญาต้องอยู่หลังวันเริ่มสัญญา');
    }
  }

  private async findOrFail(id: number): Promise<MaContract> {
    const contract = await this.contractModel.findByPk(id, {
      include: [planInclude(), customerInclude(), projectInclude()],
    });

    if (!contract) {
      throw new NotFoundException('ไม่พบสัญญา MA นี้');
    }

    return contract;
  }

  private async findProjectOrFail(projectId: number): Promise<Project> {
    const project = await this.projectModel.findByPk(projectId);

    if (!project) {
      throw new NotFoundException('ไม่พบโครงการนี้');
    }

    return project;
  }

  /** แผนที่ปิดใช้งานแล้วเอามาทำสัญญาใหม่ไม่ได้ แต่สัญญาเดิมที่ใช้อยู่ไม่ถูกกระทบ */
  private async assertPlanIsUsable(planId: number): Promise<void> {
    const plan = await this.planModel.findByPk(planId);

    if (!plan) {
      throw new NotFoundException('ไม่พบแผน MA นี้');
    }

    if (!plan.isActive) {
      throw new BadRequestException(`แผน ${plan.name} ถูกปิดการใช้งานแล้ว จึงใช้ทำสัญญาใหม่ไม่ได้`);
    }
  }

  private async assertContractNoIsAvailable(contractNo: string, exceptId?: number): Promise<void> {
    const existing = await this.contractModel.findOne({
      where: exceptId === undefined ? { contractNo } : { contractNo, id: { [Op.ne]: exceptId } },
      // unique index ไม่สนใจ deleted_at เลขที่สัญญาที่ลบไปแล้วจึงยังจองอยู่
      paranoid: false,
    });

    if (existing) {
      throw new ConflictException(`เลขที่สัญญา ${contractNo} ถูกใช้ไปแล้ว`);
    }
  }

  /**
   * มีสัญญา ACTIVE ของโครงการเดียวกันที่ช่วงวันทับกันอยู่หรือไม่ (Q4)
   *
   * คืนข้อความเตือน ไม่ได้โยน error — ระบบยังไม่มีกติกาว่าห้ามซ้อน
   * ผลลัพธ์ไปโผล่ที่ `message` ของ response envelope ให้คนอ่านตัดสินเอง
   */
  private async describeOverlap(
    projectId: number,
    startDate: string,
    endDate: string,
  ): Promise<string | null> {
    const overlapping = await this.contractModel.count({
      where: {
        projectId,
        status: MaContractStatus.ACTIVE,
        startDate: { [Op.lte]: endDate },
        endDate: { [Op.gte]: startDate },
      },
    });

    if (overlapping === 0) {
      return null;
    }

    return (
      `บันทึกแล้ว แต่โครงการนี้มีสัญญา MA สถานะ ACTIVE ที่ช่วงเวลาทับกันอยู่อีก ${overlapping} ฉบับ — ` +
      'การหักโควตาจะไปตกที่ฉบับที่หมดอายุช้าที่สุด กรุณาตรวจสอบว่าตั้งใจให้ซ้อนกัน'
    );
  }
}
