import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, type WhereOptions } from 'sequelize';

import { daysUntil, todayAsDateOnly } from '../../common/utils/date.util';
import {
  Customer,
  FollowUp,
  FollowUpStatus,
  MaAddon,
  MaContract,
  MaContractStatus,
  Project,
  ProjectStatus,
  Ticket,
  TicketBillingType,
  TicketResolution,
  Warranty,
  WarrantyStatus,
} from '../../models';
import {
  QueryContractValueDto,
  QueryOverlapDto,
  QueryServiceCostDto,
  ReportPeriodDto,
} from './dto/report.dto';
import {
  CONTRACT_VALUE_DISCLAIMER,
  type ContractOverlapReportDto,
  type ContractValueByCustomerDto,
  type ContractValueByTypeDto,
  type CustomerLifetimeValueDto,
  type CustomerOverlapDto,
  type CustomerOverviewDto,
  type DataCompletenessDto,
  type ServiceCostReportDto,
  type UpcomingContractValueDto,
} from './dto/report.response';

/**
 * M10 — รายงานและการวิเคราะห์ + M1-05/M1-06
 *
 * ---------------------------------------------------------------------------
 * ⚠ ทุกตัวเลขเงินในโมดูลนี้คือ "มูลค่าตามสัญญา" ไม่ใช่ "เงินที่ได้รับจริง"
 * ---------------------------------------------------------------------------
 * ระบบนี้ไม่ใช่ระบบบัญชีและไม่มีระบบรับชำระเงิน (SC-3, OS-03, OS-06)
 * ที่มาของตัวเลขมีแค่สามทาง — `projects.contract_value`, `ma_contracts.price`
 * และ `ma_addons.price` ทั้งหมดเป็นตัวเลขที่ตกลงกันไว้ในสัญญา ระบบไม่รู้เลยว่า
 * เก็บเงินได้แล้วหรือยัง **ห้ามเพิ่มตาราง/คอลัมน์การรับเงินเข้ามาในโมดูลนี้**
 * ถ้าต้องการตัวเลขเงินจริง ต้องไปดูที่โปรแกรมบัญชีที่บริษัทใช้อยู่แล้ว
 *
 * ---------------------------------------------------------------------------
 * กติกาที่ยืนยันแล้ว 10 ก.ย. 2026
 * ---------------------------------------------------------------------------
 * 1. รายการที่สถานะเป็น CANCELLED **ไม่ถูกนับในมูลค่าหลัก** แต่ยกมาแสดงแยกที่
 *    `excludedCancelledValue` / `excludedCancelledCount` เพื่อให้ตรวจย้อนหลังได้
 * 2. `ma_addons` ไม่มีคอลัมน์ status — ของเสริมถูกตัดออก **ตามสถานะของสัญญาแม่**
 *    เพราะ addon มี `contract_id` ชี้ไปหาสัญญาเสมอ อยู่เองไม่ได้
 * 3. `tickets.extra_charge` และ `ticket_resolutions.hours_spent` **ว่างได้**
 *    ค่าว่าง = "ยังไม่ได้กรอก" **ห้ามนับเป็น 0** ต้องกันออกจากยอดรวมแล้วรายงาน
 *    ความครบถ้วนกลับไปด้วยเสมอ
 * 4. สัญญา MA ที่ช่วงเวลาซ้อนทับกัน — **ตรวจจับและรายงานเท่านั้น**
 *    ไม่แก้ ไม่ลบ ไม่รวม ไม่เลือกฉบับใดแทน เพราะ Q4 ยังไม่มีข้อสรุป
 *
 * ---------------------------------------------------------------------------
 * ทำไมไม่เชื่อคอลัมน์ `status` อย่างเดียวเวลาถามว่า "ยังคุ้มครองอยู่ไหม"
 * ---------------------------------------------------------------------------
 * ยังไม่มี scheduler ปรับสถานะเป็น EXPIRED ให้ (จะมาตอน M11) สัญญาและประกันที่
 * หมดอายุไปแล้วจึงยังค้างเป็น ACTIVE อยู่ในฐานข้อมูล ถ้ารายงานนับจาก
 * `status = 'ACTIVE'` ตรง ๆ ยอดจะเกินจริง — ต้องเทียบช่วงวันซ้ำเสมอ
 * กติกาเดียวกับ `isCurrentlyActive` ที่ใช้อยู่ทั้ง Phase 6 และ Phase 8
 */
@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(Customer) private readonly customerModel: typeof Customer,
    @InjectModel(Project) private readonly projectModel: typeof Project,
    @InjectModel(MaContract) private readonly contractModel: typeof MaContract,
    @InjectModel(MaAddon) private readonly addonModel: typeof MaAddon,
    @InjectModel(Ticket) private readonly ticketModel: typeof Ticket,
    @InjectModel(TicketResolution) private readonly resolutionModel: typeof TicketResolution,
    @InjectModel(Warranty) private readonly warrantyModel: typeof Warranty,
    @InjectModel(FollowUp) private readonly followUpModel: typeof FollowUp,
  ) {}

  async contractValueByCustomer(query: QueryContractValueDto): Promise<ContractValueByCustomerDto> {
    const customers = await this.customerModel.findAll({ attributes: ['id', 'name', 'code'] });
    const [projects, contracts, addons, tickets] = await this.loadValueSources(query);

    const overlapByCustomer = await this.countOverlapsByCustomer();

    let excludedValue = 0;
    let excludedCount = 0;

    const buckets = new Map<
      number,
      { project: number; ma: number; addon: number; oneTime: number }
    >();
    const bucketOf = (customerId: number) => {
      const existing = buckets.get(customerId);

      if (existing) {
        return existing;
      }

      const fresh = { project: 0, ma: 0, addon: 0, oneTime: 0 };
      buckets.set(customerId, fresh);
      return fresh;
    };

    for (const project of projects) {
      if (project.status === ProjectStatus.CANCELLED) {
        excludedValue += this.toNumber(project.contractValue);
        excludedCount += 1;
        continue;
      }

      bucketOf(project.customerId).project += this.toNumber(project.contractValue);
    }

    const cancelledContractIds = new Set(
      contracts
        .filter((contract) => contract.status === MaContractStatus.CANCELLED)
        .map((contract) => contract.id),
    );

    for (const contract of contracts) {
      if (cancelledContractIds.has(contract.id)) {
        excludedValue += this.toNumber(contract.price);
        excludedCount += 1;
        continue;
      }

      bucketOf(contract.customerId).ma += this.toNumber(contract.price);
    }

    const customerOfContract = new Map(contracts.map((row) => [row.id, row.customerId]));

    for (const addon of addons) {
      if (cancelledContractIds.has(addon.contractId)) {
        excludedValue += this.toNumber(addon.price);
        excludedCount += 1;
        continue;
      }

      const customerId = customerOfContract.get(addon.contractId);

      if (customerId !== undefined) {
        bucketOf(customerId).addon += this.toNumber(addon.price);
      }
    }

    const oneTime = this.summariseOneTimeCharges(tickets);

    for (const ticket of tickets) {
      if (ticket.extraCharge !== null) {
        bucketOf(ticket.customerId).oneTime += this.toNumber(ticket.extraCharge);
      }
    }

    const items = customers
      .map((customer) => {
        const bucket = buckets.get(customer.id) ?? {
          project: 0,
          ma: 0,
          addon: 0,
          oneTime: 0,
        };
        const total = bucket.project + bucket.ma + bucket.addon + bucket.oneTime;

        return {
          customerId: customer.id,
          customerName: customer.name,
          customerCode: customer.code,
          projectContractValue: this.toMoney(bucket.project),
          maContractValue: this.toMoney(bucket.ma),
          maAddonValue: this.toMoney(bucket.addon),
          oneTimeChargeValue: this.toMoney(bucket.oneTime),
          totalContractValue: this.toMoney(total),
          overlappingContractCount: overlapByCustomer.get(customer.id) ?? 0,
          _total: total,
        };
      })
      .filter((item) => item._total > 0)
      .sort((a, b) => b._total - a._total);

    const grandTotal = items.reduce((sum, item) => sum + item._total, 0);
    const limited = query.limit === undefined ? items : items.slice(0, query.limit);

    return {
      disclaimer: CONTRACT_VALUE_DISCLAIMER,
      dateFrom: query.dateFrom ?? null,
      dateTo: query.dateTo ?? null,
      grandTotalContractValue: this.toMoney(grandTotal),
      items: limited.map(({ _total: _ignored, ...rest }) => rest),
      oneTimeCompleteness: oneTime.completeness,
      excludedCancelledValue: this.toMoney(excludedValue),
      excludedCancelledCount: excludedCount,
    };
  }

  async contractValueByType(query: ReportPeriodDto): Promise<ContractValueByTypeDto> {
    const [projects, contracts, addons, tickets] = await this.loadValueSources(query);

    let excludedValue = 0;
    let excludedCount = 0;

    const activeProjects = projects.filter((project) => {
      if (project.status !== ProjectStatus.CANCELLED) {
        return true;
      }

      excludedValue += this.toNumber(project.contractValue);
      excludedCount += 1;
      return false;
    });

    const cancelledContractIds = new Set(
      contracts
        .filter((contract) => contract.status === MaContractStatus.CANCELLED)
        .map((contract) => contract.id),
    );

    const activeContracts = contracts.filter((contract) => {
      if (!cancelledContractIds.has(contract.id)) {
        return true;
      }

      excludedValue += this.toNumber(contract.price);
      excludedCount += 1;
      return false;
    });

    const activeAddons = addons.filter((addon) => {
      if (!cancelledContractIds.has(addon.contractId)) {
        return true;
      }

      excludedValue += this.toNumber(addon.price);
      excludedCount += 1;
      return false;
    });

    const projectValue = this.sum(activeProjects.map((row) => row.contractValue));
    const maValue = this.sum(activeContracts.map((row) => row.price));
    const addonValue = this.sum(activeAddons.map((row) => row.price));
    const oneTime = this.summariseOneTimeCharges(tickets);

    return {
      disclaimer: CONTRACT_VALUE_DISCLAIMER,
      dateFrom: query.dateFrom ?? null,
      dateTo: query.dateTo ?? null,
      projectContractValue: this.toMoney(projectValue),
      projectCount: activeProjects.length,
      maContractValue: this.toMoney(maValue),
      maContractCount: activeContracts.length,
      maAddonValue: this.toMoney(addonValue),
      maAddonCount: activeAddons.length,
      oneTimeChargeValue: this.toMoney(oneTime.total),
      oneTimeCompleteness: oneTime.completeness,
      totalContractValue: this.toMoney(projectValue + maValue + addonValue + oneTime.total),
      excludedCancelledValue: this.toMoney(excludedValue),
      excludedCancelledCount: excludedCount,
    };
  }

  async upcomingContractValue(): Promise<UpcomingContractValueDto> {
    const today = todayAsDateOnly();

    const contracts = await this.contractModel.findAll({
      where: {
        status: MaContractStatus.ACTIVE,
        startDate: { [Op.lte]: today },
        endDate: { [Op.gte]: today },
      },
      include: [
        { model: Customer, attributes: ['id', 'name'], required: false, paranoid: false },
        { model: Project, attributes: ['id', 'name'], required: false, paranoid: false },
      ],
      order: [['endDate', 'ASC']],
    });

    const overlapCount = this.findOverlappingIds(contracts).size;

    return {
      disclaimer: CONTRACT_VALUE_DISCLAIMER,
      totalContractValue: this.toMoney(this.sum(contracts.map((row) => row.price))),
      contractCount: contracts.length,
      overlappingContractCount: overlapCount,
      items: contracts.map((contract) => ({
        contractId: contract.id,
        contractNo: contract.contractNo,
        customerId: contract.customerId,
        customerName: contract.customer ? contract.customer.name : '',
        projectId: contract.projectId,
        projectName: contract.project ? contract.project.name : null,
        contractValue: contract.price,
        startDate: contract.startDate,
        endDate: contract.endDate,
        daysUntilExpiry: daysUntil(contract.endDate),
      })),
    };
  }

  async serviceCost(query: QueryServiceCostDto): Promise<ServiceCostReportDto> {
    const ticketWhere: WhereOptions = {};

    if (query.customerId !== undefined) {
      Object.assign(ticketWhere, { customerId: query.customerId });
    }

    const reportedAt = this.dateRange(query);

    if (reportedAt) {
      Object.assign(ticketWhere, { reportedAt });
    }

    const tickets = await this.ticketModel.findAll({
      where: ticketWhere,
      attributes: ['id', 'customerId'],
      include: [{ model: Customer, attributes: ['id', 'name'], required: false, paranoid: false }],
    });

    const resolutions = await this.resolutionModel.findAll({
      where: { ticketId: { [Op.in]: tickets.map((row) => row.id) } },
      attributes: ['id', 'ticketId', 'hoursSpent'],
    });

    const customerOfTicket = new Map(tickets.map((row) => [row.id, row.customerId]));
    const nameOfCustomer = new Map(
      tickets
        .filter((row) => row.customer !== null && row.customer !== undefined)
        .map((row) => [row.customerId, row.customer.name]),
    );
    const ticketsByCustomer = new Map<number, Set<number>>();

    for (const ticket of tickets) {
      const bucket = ticketsByCustomer.get(ticket.customerId) ?? new Set<number>();
      bucket.add(ticket.id);
      ticketsByCustomer.set(ticket.customerId, bucket);
    }

    const stats = new Map<number, { hours: number; withData: number; total: number }>();

    for (const resolution of resolutions) {
      const customerId = customerOfTicket.get(resolution.ticketId);

      if (customerId === undefined) {
        continue;
      }

      const bucket = stats.get(customerId) ?? { hours: 0, withData: 0, total: 0 };
      bucket.total += 1;

      if (resolution.hoursSpent !== null) {
        bucket.hours += this.toNumber(resolution.hoursSpent);
        bucket.withData += 1;
      }

      stats.set(customerId, bucket);
    }

    const items = [...stats.entries()]
      .map(([customerId, bucket]) => ({
        customerId,
        customerName: nameOfCustomer.get(customerId) ?? '',
        ticketCount: ticketsByCustomer.get(customerId)?.size ?? 0,
        resolutionCount: bucket.total,
        totalHours: this.toMoney(bucket.hours),
        completeness: this.completeness(bucket.total, bucket.withData),
        _hours: bucket.hours,
      }))
      .sort((a, b) => b._hours - a._hours);

    const totalRounds = resolutions.length;
    const withHours = resolutions.filter((row) => row.hoursSpent !== null).length;

    return {
      disclaimer:
        'ต้นทุนคิดจาก "ชั่วโมงที่ใช้" ที่กรอกตอนบันทึกการแก้ไขแต่ละรอบ ซึ่งไม่บังคับกรอก — ' +
        'รอบที่ไม่ได้กรอกเวลาไม่ได้ถูกนับเป็น 0 ชั่วโมง แต่ถูกกันออกจากยอดรวม ' +
        'ให้อ่านตัวเลขคู่กับความครบถ้วนเสมอ',
      dateFrom: query.dateFrom ?? null,
      dateTo: query.dateTo ?? null,
      totalHours: this.toMoney(
        this.sum(resolutions.filter((row) => row.hoursSpent !== null).map((row) => row.hoursSpent)),
      ),
      completeness: this.completeness(totalRounds, withHours),
      items: items.map(({ _hours: _ignored, ...rest }) => rest),
    };
  }

  /**
   * **ไม่แก้ ไม่ลบ ไม่รวม และไม่เลือกสัญญาใดแทน** — Q4 ยังไม่มีข้อสรุปจากผู้บริหาร
   * ว่า 1 ลูกค้า/โครงการมีสัญญาที่ยังไม่หมดอายุพร้อมกันหลายฉบับได้ไหม
   * หน้าที่ของเส้นนี้คือทำให้เห็นด้วยตาว่าเคสนี้เกิดขึ้นจริงหรือไม่ ก่อนจะไปตัดสิน
   *
   * นับ "ซ้อนทับ" จากช่วงวัน `start_date`..`end_date` ที่คาบเกี่ยวกัน โดยไม่สนใจ
   * ว่าอยู่โครงการเดียวกันหรือไม่ เพราะยอดรวมรายลูกค้าบวกข้ามโครงการอยู่แล้ว
   * สัญญาที่ยกเลิก (CANCELLED) และที่ถูกต่อไปแล้ว (RENEWED) ไม่ถูกนับ
   * เพราะไม่มีผลกับยอดรวมตั้งแต่แรก
   */
  async contractOverlaps(query: QueryOverlapDto): Promise<ContractOverlapReportDto> {
    const where: WhereOptions = {
      status: { [Op.notIn]: [MaContractStatus.CANCELLED, MaContractStatus.RENEWED] },
    };

    if (query.customerId !== undefined) {
      Object.assign(where, { customerId: query.customerId });
    }

    const contracts = await this.contractModel.findAll({
      where,
      include: [
        { model: Customer, attributes: ['id', 'name'], required: false, paranoid: false },
        { model: Project, attributes: ['id', 'name'], required: false, paranoid: false },
      ],
      order: [
        ['customerId', 'ASC'],
        ['startDate', 'ASC'],
      ],
    });

    const byCustomer = new Map<number, MaContract[]>();

    for (const contract of contracts) {
      const bucket = byCustomer.get(contract.customerId) ?? [];
      bucket.push(contract);
      byCustomer.set(contract.customerId, bucket);
    }

    const items: CustomerOverlapDto[] = [];

    for (const [customerId, rows] of byCustomer) {
      const pairs: [number, number][] = [];
      const involved = new Set<number>();

      for (let i = 0; i < rows.length; i += 1) {
        for (let j = i + 1; j < rows.length; j += 1) {
          if (this.rangesOverlap(rows[i], rows[j])) {
            pairs.push([rows[i].id, rows[j].id]);
            involved.add(rows[i].id);
            involved.add(rows[j].id);
          }
        }
      }

      if (pairs.length === 0) {
        continue;
      }

      const first = rows[0];

      items.push({
        customerId,
        customerName: first.customer ? first.customer.name : '',
        overlappingContractCount: involved.size,
        overlappingPairs: pairs,
        contracts: rows
          .filter((row) => involved.has(row.id))
          .map((row) => ({
            contractId: row.id,
            contractNo: row.contractNo,
            projectId: row.projectId,
            projectName: row.project ? row.project.name : null,
            startDate: row.startDate,
            endDate: row.endDate,
            status: row.status,
            contractValue: row.price,
          })),
      });
    }

    return {
      disclaimer:
        'ตรวจจับและรายงานเท่านั้น — ระบบไม่แก้ ไม่ลบ ไม่รวม และไม่เลือกสัญญาใดแทน ' +
        'เพราะ Q4 ยังไม่มีข้อสรุปจากผู้บริหาร',
      customerCount: items.length,
      contractCount: items.reduce((sum, item) => sum + item.overlappingContractCount, 0),
      items,
    };
  }

  async customerOverview(customerId: number): Promise<CustomerOverviewDto> {
    const customer = await this.customerModel.findByPk(customerId);

    if (!customer) {
      throw new NotFoundException('ไม่พบข้อมูลลูกค้า');
    }

    const today = todayAsDateOnly();

    const [projects, contracts, tickets, followUps] = await Promise.all([
      this.projectModel.findAll({
        where: { customerId },
        attributes: ['id', 'name', 'code', 'status', 'contractValue', 'targetEndDate'],
        order: [['id', 'DESC']],
      }),
      this.contractModel.findAll({ where: { customerId }, order: [['endDate', 'DESC']] }),
      this.ticketModel.findAll({
        where: { customerId },
        attributes: [
          'id',
          'ticketNo',
          'title',
          'status',
          'billingType',
          'resolutionCount',
          'reportedAt',
          'extraCharge',
        ],
        order: [['reportedAt', 'DESC']],
      }),
      this.followUpModel.findAll({ where: { customerId }, order: [['dueDate', 'ASC']] }),
    ]);

    const warranties = await this.warrantyModel.findAll({
      where: { projectId: { [Op.in]: projects.map((row) => row.id) } },
      order: [['endDate', 'DESC']],
    });

    const addons = await this.addonModel.findAll({
      where: { contractId: { [Op.in]: contracts.map((row) => row.id) } },
    });

    return {
      customerId: customer.id,
      customerName: customer.name,
      customerCode: customer.code,
      customerStatus: customer.status,
      lastContactedAt: customer.lastContactedAt,
      idleDays:
        customer.lastContactedAt === null
          ? null
          : Math.floor((Date.now() - customer.lastContactedAt.getTime()) / (24 * 60 * 60 * 1000)),
      projects: projects.map((project) => ({
        id: project.id,
        name: project.name,
        code: project.code,
        status: project.status,
        contractValue: project.contractValue,
        targetEndDate: project.targetEndDate,
      })),
      warranties: warranties.map((warranty) => ({
        id: warranty.id,
        projectId: warranty.projectId,
        startDate: warranty.startDate,
        endDate: warranty.endDate,
        isCurrentlyActive:
          warranty.status !== WarrantyStatus.VOID &&
          warranty.startDate <= today &&
          warranty.endDate >= today,
      })),
      maContracts: contracts.map((contract) => ({
        id: contract.id,
        contractNo: contract.contractNo,
        projectId: contract.projectId,
        status: contract.status,
        contractValue: contract.price,
        startDate: contract.startDate,
        endDate: contract.endDate,
        isCurrentlyActive:
          contract.status === MaContractStatus.ACTIVE &&
          contract.startDate <= today &&
          contract.endDate >= today,
      })),
      tickets: tickets.map((ticket) => ({
        id: ticket.id,
        ticketNo: ticket.ticketNo,
        title: ticket.title,
        status: ticket.status,
        billingType: ticket.billingType,
        resolutionCount: ticket.resolutionCount,
        reportedAt: ticket.reportedAt,
      })),
      followUps: followUps.map((followUp) => ({
        id: followUp.id,
        title: followUp.title,
        dueDate: followUp.dueDate,
        status: followUp.status,
        isOverdue:
          (followUp.status === FollowUpStatus.PLANNED ||
            followUp.status === FollowUpStatus.OVERDUE) &&
          followUp.dueDate < today,
      })),
      lifetimeValue: this.buildLifetimeValue(projects, contracts, addons, tickets),
    };
  }

  private buildLifetimeValue(
    projects: Project[],
    contracts: MaContract[],
    addons: MaAddon[],
    tickets: Ticket[],
  ): CustomerLifetimeValueDto {
    let excludedValue = 0;
    let excludedCount = 0;

    const activeProjects = projects.filter((project) => {
      if (project.status !== ProjectStatus.CANCELLED) {
        return true;
      }

      excludedValue += this.toNumber(project.contractValue);
      excludedCount += 1;
      return false;
    });

    const cancelledContractIds = new Set(
      contracts
        .filter((contract) => contract.status === MaContractStatus.CANCELLED)
        .map((contract) => contract.id),
    );

    const activeContracts = contracts.filter((contract) => {
      if (!cancelledContractIds.has(contract.id)) {
        return true;
      }

      excludedValue += this.toNumber(contract.price);
      excludedCount += 1;
      return false;
    });

    const activeAddons = addons.filter((addon) => {
      if (!cancelledContractIds.has(addon.contractId)) {
        return true;
      }

      excludedValue += this.toNumber(addon.price);
      excludedCount += 1;
      return false;
    });

    const oneTime = this.summariseOneTimeCharges(tickets);
    const projectValue = this.sum(activeProjects.map((row) => row.contractValue));
    const maValue = this.sum(activeContracts.map((row) => row.price));
    const addonValue = this.sum(activeAddons.map((row) => row.price));

    return {
      disclaimer: CONTRACT_VALUE_DISCLAIMER,
      projectContractValue: this.toMoney(projectValue),
      maContractValue: this.toMoney(maValue),
      maAddonValue: this.toMoney(addonValue),
      oneTimeChargeValue: this.toMoney(oneTime.total),
      totalContractValue: this.toMoney(projectValue + maValue + addonValue + oneTime.total),
      excludedCancelledValue: this.toMoney(excludedValue),
      excludedCancelledCount: excludedCount,
      oneTimeCompleteness: oneTime.completeness,
      overlappingContractCount: this.findOverlappingIds(activeContracts).size,
    };
  }

  /**
   * ค่าบริการรายครั้ง — นับเฉพาะใบที่ `billing_type = ONE_TIME`
   *
   * **ใบที่ `extra_charge` ว่างไม่ถูกนับเป็น 0** เพราะค่าว่างแปลว่ายังไม่ได้กรอก
   * ไม่ใช่ "ไม่คิดเงิน" (ถ้าไม่คิดเงินจริงต้องเลือก `billing_type = FREE` ตาม BR-08)
   * จึงกันออกจากยอดรวมแล้วรายงานความครบถ้วนแทน — กติกาเดียวกับ hours_spent ใน M10-05
   */
  private summariseOneTimeCharges(tickets: Ticket[]): {
    total: number;
    completeness: DataCompletenessDto;
  } {
    const oneTimeTickets = tickets.filter(
      (ticket) => ticket.billingType === TicketBillingType.ONE_TIME,
    );
    const withCharge = oneTimeTickets.filter((ticket) => ticket.extraCharge !== null);

    return {
      total: this.sum(withCharge.map((ticket) => ticket.extraCharge)),
      completeness: this.completeness(oneTimeTickets.length, withCharge.length),
    };
  }

  private async loadValueSources(
    query: ReportPeriodDto,
  ): Promise<[Project[], MaContract[], MaAddon[], Ticket[]]> {
    const dateOnly = this.dateOnlyRange(query);
    const dateTime = this.dateRange(query);

    const projects = await this.projectModel.findAll({
      where: dateOnly ? { startDate: dateOnly } : {},
      attributes: ['id', 'customerId', 'status', 'contractValue'],
    });

    const contracts = await this.contractModel.findAll({
      where: dateOnly ? { startDate: dateOnly } : {},
      attributes: ['id', 'customerId', 'projectId', 'status', 'price'],
    });

    const addons = await this.addonModel.findAll({
      where: { contractId: { [Op.in]: contracts.map((row) => row.id) } },
      attributes: ['id', 'contractId', 'price'],
    });

    const tickets = await this.ticketModel.findAll({
      where: {
        billingType: TicketBillingType.ONE_TIME,
        ...(dateTime ? { reportedAt: dateTime } : {}),
      },
      attributes: ['id', 'customerId', 'billingType', 'extraCharge'],
    });

    return [projects, contracts, addons, tickets];
  }

  private async countOverlapsByCustomer(): Promise<Map<number, number>> {
    const report = await this.contractOverlaps({});

    return new Map(report.items.map((item) => [item.customerId, item.overlappingContractCount]));
  }

  private rangesOverlap(a: MaContract, b: MaContract): boolean {
    return a.startDate <= b.endDate && b.startDate <= a.endDate;
  }

  private findOverlappingIds(contracts: MaContract[]): Set<number> {
    const usable = contracts.filter(
      (contract) =>
        contract.status !== MaContractStatus.CANCELLED &&
        contract.status !== MaContractStatus.RENEWED,
    );
    const involved = new Set<number>();

    for (let i = 0; i < usable.length; i += 1) {
      for (let j = i + 1; j < usable.length; j += 1) {
        if (
          usable[i].customerId === usable[j].customerId &&
          this.rangesOverlap(usable[i], usable[j])
        ) {
          involved.add(usable[i].id);
          involved.add(usable[j].id);
        }
      }
    }

    return involved;
  }

  private completeness(total: number, withData: number): DataCompletenessDto {
    return {
      total,
      withData,
      withoutData: total - withData,
      completeness: total === 0 ? 0 : Math.round((withData / total) * 10000) / 100,
    };
  }

  private dateOnlyRange(query: ReportPeriodDto): Record<symbol, string> | null {
    const bounds: Record<symbol, string> = {};

    if (query.dateFrom !== undefined) {
      bounds[Op.gte] = query.dateFrom;
    }

    if (query.dateTo !== undefined) {
      bounds[Op.lte] = query.dateTo;
    }

    return Object.getOwnPropertySymbols(bounds).length > 0 ? bounds : null;
  }

  private dateRange(query: ReportPeriodDto): Record<symbol, Date> | null {
    const bounds: Record<symbol, Date> = {};

    if (query.dateFrom !== undefined) {
      bounds[Op.gte] = new Date(`${query.dateFrom}T00:00:00`);
    }

    if (query.dateTo !== undefined) {
      bounds[Op.lte] = new Date(`${query.dateTo}T23:59:59.999`);
    }

    return Object.getOwnPropertySymbols(bounds).length > 0 ? bounds : null;
  }

  private toNumber(value: string | null): number {
    return value === null ? 0 : Number(value);
  }

  private sum(values: (string | null)[]): number {
    return values.reduce((total: number, value) => total + this.toNumber(value), 0);
  }

  private toMoney(value: number): string {
    return value.toFixed(2);
  }
}
