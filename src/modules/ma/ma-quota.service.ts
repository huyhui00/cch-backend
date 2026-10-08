import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/sequelize';
import { Op, type Transaction } from 'sequelize';

import { getCurrentUserId } from '../../common/context/request-context';
import { addDays, addMonths, toDateOnly } from '../../common/utils/date.util';
import {
  MaAddon,
  MaContract,
  MaPlan,
  MaPlanItem,
  MaUsage,
  Ticket,
  TicketBillingType,
} from '../../models';
import { COVERING_CONTRACT_STATUSES } from './contract-status.util';

/**
 * โหมดการนับรอบโควตา
 *
 * Q2 ตอบแล้ว 9 ก.ย. 2026 — **นับจากวันเริ่มสัญญา** ค่าเริ่มต้นจึงเป็น
 * CONTRACT_ANNIVERSARY ส่วน CALENDAR_MONTH ยังเก็บไว้เผื่อลูกค้าบางรายตกลงกันคนละแบบ
 * สลับด้วย `MA_QUOTA_RESET_MODE` ใน .env
 */
export enum QuotaResetMode {
  CALENDAR_MONTH = 'CALENDAR_MONTH',
  CONTRACT_ANNIVERSARY = 'CONTRACT_ANNIVERSARY',
}

/**
 * รอบโควตาที่การใช้งานครั้งหนึ่งตกอยู่
 *
 * `periodYear`/`periodMonth` คือสิ่งที่เก็บลง `ma_usages` (คอลัมน์เก็บได้แค่ปี/เดือน)
 * ส่วน `periodStart`/`periodEnd` คือช่วงวันจริงของรอบนั้น ซึ่งไม่ตรงกับต้น-สิ้นเดือน
 * เมื่อใช้โหมด CONTRACT_ANNIVERSARY จึงต้องคืนไปด้วย ไม่งั้นหน้าจอบอกผู้ใช้ไม่ได้ว่า
 * "โควตารอบนี้หมดวันไหน"
 */
export interface QuotaPeriod {
  periodYear: number;
  periodMonth: number;
  periodStart: string;
  periodEnd: string;
}

export type QuotaPeriodKey = Pick<QuotaPeriod, 'periodYear' | 'periodMonth'>;

export interface QuotaStatus extends QuotaPeriod {
  contractId: number;
  quota: number;
  used: number;
  willExceed: boolean;
}

/**
 * ตรรกะโควตา MA (CLAUDE.md 9.2)
 *
 * โมดูลนี้ **ยังไม่มี controller** โดยเจตนา — CRUD ของแผน สัญญา และ addon
 * เป็นของ Phase 8 ที่นี่มีแค่ตรรกะที่ Phase 7 ต้องใช้ตอนบันทึกผลการแก้ปัญหา
 * ให้ Phase 8 มาเพิ่ม controller ในโมดูลนี้ต่อ ไม่ต้องย้ายไฟล์
 *
 * ---------------------------------------------------------------------------
 * กติกาโควตาที่ยืนยันแล้ว 9 ก.ย. 2026 (CLAUDE.md ข้อ 10)
 * ---------------------------------------------------------------------------
 * Q2  ✅ รอบโควตา **นับจากวันเริ่มสัญญา** ไม่ใช่วันที่ 1 ของเดือนปฏิทิน
 *     สัญญาที่เริ่ม 15 ต.ค. จะได้รอบ 15 ต.ค. ถึง 14 พ.ย. แล้วรีเซ็ตใหม่
 * Q3  ✅ **ไม่ยกยอด** โควตาที่ใช้ไม่หมดในรอบหนึ่งหายไปเมื่อขึ้นรอบใหม่
 *     `countUsed()` จึงนับเฉพาะรอบเดียว ไม่ต้องไล่สะสมย้อนหลัง
 * Q4  🟡 อนุญาตให้ 1 โครงการมี ACTIVE ซ้อนกันได้เมื่อ Scope of Work และวัตถุประสงค์ไม่ซ้ำกัน
 *     แต่ `findActiveContract()` เลือกฉบับที่หมดช้าที่สุดแล้ว log warning ไว้
 *     ปัจจุบันยังไม่มีฟิลด์ Scope/Objective จึงเลือกฉบับที่หมดช้าที่สุดเป็น fallback ชั่วคราว
 */
@Injectable()
export class MaQuotaService {
  private readonly logger = new Logger(MaQuotaService.name);

  constructor(
    @InjectModel(MaContract) private readonly contractModel: typeof MaContract,
    @InjectModel(MaUsage) private readonly usageModel: typeof MaUsage,
    @InjectModel(MaAddon) private readonly addonModel: typeof MaAddon,
    private readonly config: ConfigService,
  ) {}

  get resetMode(): QuotaResetMode {
    const raw = this.config.get<string>('MA_QUOTA_RESET_MODE');

    // ค่าเริ่มต้นคือ CONTRACT_ANNIVERSARY ตามคำตอบ Q2 — ตั้งค่าผิดหรือไม่ได้ตั้ง
    // ต้องได้พฤติกรรมที่ตกลงกันไว้ ไม่ใช่ตกไปโหมดอื่นเงียบ ๆ
    return raw === QuotaResetMode.CALENDAR_MONTH
      ? QuotaResetMode.CALENDAR_MONTH
      : QuotaResetMode.CONTRACT_ANNIVERSARY;
  }

  /**
   * สัญญา MA ที่ยังคุ้มครองโครงการนี้อยู่ ณ วันที่กำหนด
   *
   * ใช้ทั้งตอน suggest billing_type ให้ ticket ใหม่ และตอนหักโควตาจริง
   *
   * Q4 ยังไม่สรุปว่า 1 โครงการมี ACTIVE พร้อมกันหลายฉบับได้ไหม ตอนนี้เลือกฉบับที่
   * หมดช้าที่สุด เพราะเป็นฉบับที่ให้ความคุ้มครองยาวที่สุด และถ้าวันหนึ่งสรุปว่าห้ามซ้อน
   * พฤติกรรมนี้ก็ยังถูกอยู่ดี (เพราะจะมีให้เลือกฉบับเดียว) — เลือกทางที่ไม่ต้องแก้ทีหลัง
   */
  async findActiveContract(
    projectId: number,
    onDate: Date | string = new Date(),
    transaction?: Transaction,
  ): Promise<MaContract | null> {
    const date = typeof onDate === 'string' ? onDate : toDateOnly(onDate);

    const contracts = await this.contractModel.findAll({
      where: {
        projectId,
        status: { [Op.in]: COVERING_CONTRACT_STATUSES },
        startDate: { [Op.lte]: date },
        endDate: { [Op.gte]: date },
      },
      include: [
        {
          model: MaPlan,
          required: false,
          include: [
            { model: MaPlanItem, required: false, separate: true, order: [['sortOrder', 'ASC']] },
          ],
        },
      ],
      order: [['endDate', 'DESC']],
      transaction,
    });

    if (contracts.length > 1) {
      // ไม่ได้โยน error เพราะยังไม่มีกติกาว่าห้ามซ้อน แต่ต้องเห็นใน log
      // ว่าเคสนี้เกิดขึ้นจริงหรือไม่ ก่อนจะไปสรุป Q4 กับผู้บริหาร
      this.logger.warn(
        `โครงการ ${projectId} มีสัญญา MA สถานะ ACTIVE ซ้อนกัน ${contracts.length} ฉบับ ` +
          `ณ วันที่ ${date} — เลือกฉบับที่หมดช้าที่สุด (id ${contracts[0].id}) ดู Q4 ใน CLAUDE.md`,
      );
    }

    return contracts[0] ?? null;
  }

  /**
   * รอบโควตาที่วันที่หนึ่งตกอยู่
   *
   * CALENDAR_MONTH — ตรงไปตรงมา ใช้ปี/เดือนของวันที่นั้น รอบคือทั้งเดือนปฏิทิน
   *
   * CONTRACT_ANNIVERSARY (ค่าเริ่มต้นตามคำตอบ Q2) — ไล่หาช่วง
   *   [เริ่ม + k เดือน, เริ่ม + (k+1) เดือน) ที่ครอบวันนั้น แล้วเก็บปี/เดือนของ
   *   "วันเริ่มช่วง" เป็นตัวแทนของรอบ เพราะ `ma_usages` มีแค่คอลัมน์ปีกับเดือน
   *   ค่านี้ยังแทนรอบได้ครบถ้วน เพราะเดือนของ `เริ่ม + k เดือน` เดินทีละหนึ่งเสมอ
   *   ปี/เดือนกับ k จึงจับคู่กันหนึ่งต่อหนึ่ง ไม่มีทางซ้ำ
   *
   * ขอบรอบคำนวณด้วย `addMonths()` ตัวเดียวกับที่ Phase 6 ใช้คิดวันหมดประกัน
   * จึง **หนีบวันสิ้นเดือน** เหมือนกัน — สัญญาที่เริ่ม 31 ม.ค. ได้รอบถัดไป
   * เริ่ม 28 ก.พ. ไม่ใช่ 3 มี.ค. ห้ามกลับไปเทียบด้วย `usedAt.getDate() >= วันเริ่ม`
   * เพราะเดือนที่สั้นกว่าวันเริ่มจะถูกนับเป็นรอบก่อนหน้าทั้งเดือน
   */
  resolvePeriod(contract: MaContract, usedAt: Date): QuotaPeriod {
    const usedDate = toDateOnly(usedAt);

    if (this.resetMode === QuotaResetMode.CALENDAR_MONTH) {
      const year = usedAt.getFullYear();
      const month = usedAt.getMonth() + 1;
      const periodStart = `${year}-${String(month).padStart(2, '0')}-01`;

      return {
        periodYear: year,
        periodMonth: month,
        periodStart,
        periodEnd: addDays(addMonths(periodStart, 1), -1),
      };
    }

    const start = contract.startDate;
    const [startYear, startMonth] = start.split('-').map(Number);

    let index = (usedAt.getFullYear() - startYear) * 12 + (usedAt.getMonth() + 1 - startMonth);

    while (index > 0 && addMonths(start, index) > usedDate) {
      index -= 1;
    }
    while (addMonths(start, index + 1) <= usedDate) {
      index += 1;
    }

    if (index < 0) {
      index = 0;
    }

    const periodStart = addMonths(start, index);
    const [periodYear, periodMonth] = periodStart.split('-').map(Number);

    return {
      periodYear,
      periodMonth,
      periodStart,
      periodEnd: addDays(addMonths(start, index + 1), -1),
    };
  }

  async resolveQuota(
    contract: MaContract,
    period: QuotaPeriodKey,
    transaction?: Transaction,
  ): Promise<number> {
    const planQuota = contract.plan ? contract.plan.bugQuotaPerMonth : 0;

    const addons = await this.addonModel.findAll({
      where: {
        contractId: contract.id,
        [Op.or]: [
          { effectiveYear: null, effectiveMonth: null },
          { effectiveYear: period.periodYear, effectiveMonth: period.periodMonth },
        ],
      },
      transaction,
    });

    return addons.reduce((sum, addon) => sum + addon.extraQuota, planQuota);
  }

  async countUsed(
    contractId: number,
    period: QuotaPeriodKey,
    transaction?: Transaction,
  ): Promise<number> {
    return this.usageModel.count({
      where: {
        contractId,
        periodYear: period.periodYear,
        periodMonth: period.periodMonth,
      },
      transaction,
    });
  }

  async getQuotaStatus(
    contract: MaContract,
    usedAt: Date,
    transaction?: Transaction,
  ): Promise<QuotaStatus> {
    const period = this.resolvePeriod(contract, usedAt);

    const [quota, used] = await Promise.all([
      this.resolveQuota(contract, period, transaction),
      this.countUsed(contract.id, period, transaction),
    ]);

    return { contractId: contract.id, ...period, quota, used, willExceed: used >= quota };
  }

  /**
   * หักโควตาให้ ticket หนึ่งใบ — เรียกจาก TicketsService ในทรานแซกชันเดียวกับ resolution
   *
   * ---------------------------------------------------------------------------
   * ⚠ หักได้ครั้งเดียวต่อ ticket ไม่ว่าจะแก้กี่รอบ
   * ---------------------------------------------------------------------------
   * `ma_usages.ticket_id` เป็น UNIQUE index (`uq_ma_usages_ticket_id`) ที่ระดับฐานข้อมูล
   * ถ้าสร้างแถวใหม่ทุกรอบตาม CLAUDE.md 9.1 แบบตรงตัว การแก้รอบที่ 2 ของใบเดิม
   * จะชนคีย์ซ้ำแล้วพังเป็น error ภาษาอังกฤษจาก MySQL ซึ่งขัดทั้ง BR-04 (ปัญหาเดิม
   * กลับมาให้เพิ่มรอบในใบเดิม) และ CLAUDE.md 6.5 (ข้อความต้องเป็นไทย)
   *
   * ในแง่ธุรกิจการหักครั้งเดียวก็ถูกกว่า — ลูกค้าแจ้งปัญหาหนึ่งเรื่อง ถ้าเราแก้ไม่จบ
   * ในรอบเดียวแล้วต้องกลับไปแก้อีก นั่นเป็นความบกพร่องของเรา ไม่ใช่โควตาของลูกค้า
   *
   * คืน null เมื่อใบนี้เคยหักโควตาไปแล้ว เพื่อให้ผู้เรียกแยกได้ว่าหักใหม่หรือใช้ของเดิม
   */
  async recordUsageForTicket(
    ticket: Ticket,
    options: {
      resolutionId: number;
      usedAt: Date;
      extraCharge?: string | null;
      note?: string | null;
      transaction: Transaction;
    },
  ): Promise<{ usage: MaUsage | null; status: QuotaStatus | null }> {
    if (ticket.billingType !== TicketBillingType.MA_QUOTA) {
      return { usage: null, status: null };
    }

    const existing = await this.usageModel.findOne({
      where: { ticketId: ticket.id },
      transaction: options.transaction,
    });

    if (existing) {
      return { usage: null, status: null };
    }

    const contract = await this.resolveContractForTicket(
      ticket,
      options.usedAt,
      options.transaction,
    );

    if (!contract) {
      return { usage: null, status: null };
    }

    const status = await this.getQuotaStatus(contract, options.usedAt, options.transaction);
    const actorId = getCurrentUserId();

    const usage = await this.usageModel.create(
      {
        contractId: contract.id,
        ticketId: ticket.id,
        resolutionId: options.resolutionId,
        periodYear: status.periodYear,
        periodMonth: status.periodMonth,
        usedAt: options.usedAt,
        isOverQuota: status.willExceed,
        extraCharge: options.extraCharge ?? '0',
        note: options.note ?? null,
        createdBy: actorId,
        updatedBy: actorId,
      },
      { transaction: options.transaction },
    );

    return { usage, status };
  }

  private async resolveContractForTicket(
    ticket: Ticket,
    usedAt: Date,
    transaction: Transaction,
  ): Promise<MaContract | null> {
    if (ticket.maContractId) {
      return this.contractModel.findByPk(ticket.maContractId, {
        include: [{ model: MaPlan, required: false }],
        transaction,
      });
    }

    if (ticket.projectId === null) {
      return null;
    }

    return this.findActiveContract(ticket.projectId, usedAt, transaction);
  }
}
