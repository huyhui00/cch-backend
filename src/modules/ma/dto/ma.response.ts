import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { daysUntil, todayAsDateOnly } from '../../../common/utils/date.util';
import {
  Customer,
  MaAddon,
  MaAddonType,
  MaBillingCycle,
  MaContract,
  MaContractStatus,
  MaPlan,
  MaPlanItem,
  Project,
} from '../../../models';
import { MA_CONTRACT_PRICE_DESCRIPTION } from './ma-contract.dto';

/**
 * สถานะการคุ้มครองจริง — แยกจาก `status` ในฐาน เพราะ ACTIVE อาจยังไม่เริ่มหรือหมดช่วงไปแล้ว
 * (ยังไม่มี scheduler ปรับเป็น EXPIRED จน Phase 11)
 *
 * หน้าจอใช้ค่านี้โชว์ป้าย: ยังไม่เริ่ม / คุ้มครองอยู่ / หมดอายุแล้ว
 * อย่าใช้ `daysUntilExpiry` อย่างเดียวตัดสินว่าหมดอายุ เพราะสัญญายังไม่เริ่มก็มีค่าบวกได้
 */
export enum MaContractCoverageState {
  /** DRAFT / CANCELLED / RENEWED / EXPIRED ในฐาน — ไม่ได้คุ้มครอง */
  INACTIVE = 'INACTIVE',
  /** ACTIVE แต่ยังไม่ถึง startDate */
  NOT_STARTED = 'NOT_STARTED',
  /** ACTIVE และวันนี้ตกในช่วง startDate..endDate */
  IN_FORCE = 'IN_FORCE',
  /** ACTIVE แต่เลย endDate แล้ว */
  ENDED = 'ENDED',
}

export class MaPlanItemResponseDto {
  @ApiProperty({ example: 7 })
  id: number;

  @ApiProperty({ example: 'ตรวจสุขภาพระบบรายเดือน' })
  title: string;

  @ApiProperty({
    nullable: true,
    example: 'ตรวจ log และพื้นที่ดิสก์ พร้อมสรุปรายงานให้ทุกสิ้นเดือน',
  })
  detail: string | null;

  @ApiProperty({ example: 0 })
  sortOrder: number;
}

/**
 * แผน MA — เนื้อหาล้วน ไม่มีราคา (BR-05)
 *
 * ถ้าเห็นฟิลด์ราคาโผล่มาที่นี่เมื่อไหร่ แปลว่ามีคนละเมิด BR-05 แล้ว
 */
export class MaPlanResponseDto {
  @ApiProperty({ example: 2 })
  id: number;

  @ApiProperty({
    nullable: true,
    example: 'MA_STANDARD',
    description: 'รหัสแผนไม่บังคับ (ตกลง 10 ก.ย.) — หน้าจอใช้ชื่อแผนแทน',
  })
  code: string | null;

  @ApiProperty({ example: 'แผนมาตรฐาน' })
  name: string;

  @ApiProperty({ nullable: true })
  description: string | null;

  @ApiProperty({ description: 'โควตาแก้บั๊กต่อเดือน', example: 5 })
  bugQuotaPerMonth: number;

  @ApiProperty({
    nullable: true,
    description: 'เวลาตอบกลับตามสัญญา (ชั่วโมง) — ฝั่งหน้าจอเรียกว่า SLA',
    example: 24,
  })
  responseTimeHour: number | null;

  @ApiProperty({ nullable: true, example: 1 })
  onsiteQuotaPerMonth: number | null;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty({ example: 10 })
  sortOrder: number;

  @ApiProperty({ type: [MaPlanItemResponseDto] })
  items: MaPlanItemResponseDto[];

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class MaAddonResponseDto {
  @ApiProperty({ example: 3 })
  id: number;

  @ApiProperty({ example: 12 })
  contractId: number;

  @ApiProperty({ enum: MaAddonType })
  addonType: MaAddonType;

  @ApiProperty({ example: 'ซื้อโควตาเพิ่ม 3 ครั้ง' })
  title: string;

  @ApiProperty({ example: 3 })
  extraQuota: number;

  @ApiProperty({ description: 'ราคาเป็นข้อความเพื่อไม่ให้ทศนิยมคลาดเคลื่อน', example: '4500.00' })
  price: string;

  @ApiProperty({
    nullable: true,
    description: 'ไม่ระบุปี/เดือน = มีผลตลอดอายุสัญญา',
    example: 2026,
  })
  effectiveYear: number | null;

  @ApiProperty({ nullable: true, example: 11 })
  effectiveMonth: number | null;

  @ApiProperty({ nullable: true })
  note: string | null;

  @ApiProperty()
  createdAt: Date;
}

/** สถานะโควตาของรอบหนึ่ง — รูปเดียวกับที่ POST /tickets/:id/resolutions พ่วงกลับมา */
export class QuotaStatusResponseDto {
  @ApiProperty({ example: 12 })
  contractId: number;

  @ApiProperty({
    description: 'ปีของรอบโควตา — รอบนับจากวันเริ่มสัญญา ไม่ใช่เดือนปฏิทิน (Q2)',
    example: 2026,
  })
  periodYear: number;

  @ApiProperty({ example: 10 })
  periodMonth: number;

  @ApiProperty({
    description: 'ช่วงวันจริงของรอบนี้ ใช้แสดงบนหน้าจอเพราะปี/เดือนอย่างเดียวสื่อไม่ครบ',
    example: '2026-10-15',
  })
  periodStart: string;

  @ApiProperty({ example: '2026-11-14' })
  periodEnd: string;

  @ApiProperty({ description: 'โควตารวมของรอบนี้ = แผน + ของเสริมที่มีผล', example: 8 })
  quota: number;

  @ApiProperty({ description: 'ใช้ไปแล้วกี่ครั้งในรอบนี้', example: 3 })
  used: number;

  @ApiProperty({
    description: 'เหลืออีกกี่ครั้ง ติดลบได้ถ้าใช้เกินไปแล้ว',
    example: 5,
  })
  remaining: number;

  @ApiProperty({
    description:
      'ใช้ครบโควตาแล้วหรือยัง — ครั้งถัดไปจะถูกทำเครื่องหมายว่าเกินโควตา ' +
      'โควตาที่เหลือไม่ยกยอดไปเดือนหน้า (Q3)',
    example: false,
  })
  isExhausted: boolean;
}

export class MaContractPlanSummaryDto {
  @ApiProperty({ example: 2 })
  id: number;

  @ApiProperty({
    nullable: true,
    example: 'MA_STANDARD',
    description: 'รหัสแผนไม่บังคับ (ตกลง 10 ก.ย.) — หน้าจอใช้ชื่อแผนแทน',
  })
  code: string | null;

  @ApiProperty({ example: 'แผนมาตรฐาน' })
  name: string;

  @ApiProperty({ example: 5 })
  bugQuotaPerMonth: number;

  @ApiProperty({ nullable: true, example: 24 })
  responseTimeHour: number | null;
}

export class MaContractResponseDto {
  @ApiProperty({ example: 12 })
  id: number;

  @ApiProperty({ example: 1 })
  customerId: number;

  @ApiProperty({ nullable: true, example: 'บริษัท ตัวอย่าง จำกัด' })
  customerName: string | null;

  @ApiProperty({ example: 3 })
  projectId: number;

  @ApiProperty({ nullable: true, example: 'ระบบจัดการคลังสินค้า' })
  projectName: string | null;

  @ApiProperty({ example: 2 })
  planId: number;

  @ApiProperty({ nullable: true, type: MaContractPlanSummaryDto })
  plan: MaContractPlanSummaryDto | null;

  @ApiProperty({ nullable: true, example: 'MA69-0014' })
  contractNo: string | null;

  @ApiProperty({ description: MA_CONTRACT_PRICE_DESCRIPTION, example: '48000.00' })
  price: string;

  @ApiProperty({ enum: MaBillingCycle })
  billingCycle: MaBillingCycle;

  @ApiProperty({ example: '2026-10-01' })
  startDate: string;

  @ApiProperty({ example: '2027-09-30' })
  endDate: string;

  @ApiProperty({ enum: MaContractStatus })
  status: MaContractStatus;

  @ApiProperty({
    description:
      'สถานะการคุ้มครองจริง ณ วันนี้ — หน้าจอต้องอ่านค่านี้ (หรือ isCurrentlyActive) ' +
      'ห้ามเดาจาก status อย่างเดียว และห้ามตีความ daysUntilExpiry < 0 เป็นหมดอายุ ' +
      'เมื่อสัญญาเพิ่งยังไม่เริ่ม (NOT_STARTED)',
    enum: MaContractCoverageState,
    example: MaContractCoverageState.IN_FORCE,
  })
  coverageState: MaContractCoverageState;

  @ApiProperty({
    description:
      'ยังคุ้มครองอยู่จริงหรือไม่ ณ วันนี้ — เทียบเท่า coverageState === IN_FORCE ' +
      'คิดจากช่วงวันที่คู่กับสถานะ ไม่ได้อ่านจาก status อย่างเดียว เพราะยังไม่มี ' +
      'scheduler ปรับ EXPIRED ให้จนกว่าจะถึง Phase 11',
    example: true,
  })
  isCurrentlyActive: boolean;

  @ApiProperty({
    description:
      'เหลืออีกกี่วันจะถึง endDate ติดลบแปลว่าเลยวันสิ้นสุดแล้ว ' +
      'ค่าบวกไม่ได้แปลว่าใช้งานอยู่ — ต้องดู coverageState / isCurrentlyActive ด้วย',
    example: 21,
  })
  daysUntilExpiry: number;

  @ApiProperty({ nullable: true, example: '2026-09-25' })
  signedDate: string | null;

  @ApiProperty({ nullable: true })
  signedFileUrl: string | null;

  @ApiProperty({
    nullable: true,
    description: 'สัญญาฉบับก่อนหน้าในสายการต่อสัญญา',
    example: 8,
  })
  previousContractId: number | null;

  @ApiProperty({ nullable: true })
  note: string | null;

  @ApiPropertyOptional({ type: [MaAddonResponseDto] })
  addons?: MaAddonResponseDto[];

  @ApiPropertyOptional({
    nullable: true,
    type: QuotaStatusResponseDto,
    description: 'สถานะโควตาของรอบปัจจุบัน คืนเฉพาะ endpoint รายละเอียด',
  })
  quota?: QuotaStatusResponseDto | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

/**
 * สรุปโควตา MA ของโปรเจคหนึ่ง — ประชุมทบทวน: ดูการใช้โควตาที่โปรเจค ไม่ยัดในหน้ารายการสัญญา
 */
export class ProjectMaQuotaItemDto {
  @ApiProperty({ type: () => MaContractResponseDto })
  contract: MaContractResponseDto;

  @ApiProperty({
    type: QuotaStatusResponseDto,
    description: 'สถานะโควตารอบปัจจุบันของสัญญานี้ (สูตรเดียวกับ GET /ma-contracts/:id/quota)',
  })
  quota: QuotaStatusResponseDto;
}

export class ProjectMaQuotaSummaryDto {
  @ApiProperty({ example: 3 })
  projectId: number;

  @ApiProperty({ type: [ProjectMaQuotaItemDto] })
  items: ProjectMaQuotaItemDto[];
}

// ---- M6-08 ข้อมูลสำหรับพิมพ์ร่างสัญญา ----------------------------------------

export class MaContractPrintCustomerDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ nullable: true, example: 'CUS69-0001' })
  code: string | null;

  @ApiProperty({ example: 'บริษัท ตัวอย่าง จำกัด' })
  name: string;

  @ApiProperty({ nullable: true, example: '0105561234567' })
  taxId: string | null;

  @ApiProperty({ nullable: true, example: '99/1 ถนนสุขุมวิท แขวงคลองเตย เขตคลองเตย' })
  address: string | null;

  @ApiProperty({ nullable: true, example: 'กรุงเทพมหานคร' })
  province: string | null;

  @ApiProperty({ nullable: true, example: '10110' })
  postalCode: string | null;

  @ApiProperty({ nullable: true, example: '02-123-4567' })
  phone: string | null;

  @ApiProperty({ nullable: true, example: 'contact@example.co.th' })
  email: string | null;
}

export class MaContractPrintContactDto {
  @ApiProperty({ example: 'คุณสมศรี ใจดี' })
  name: string;

  @ApiProperty({ nullable: true, example: 'ผู้จัดการฝ่ายไอที' })
  position: string | null;

  @ApiProperty({ nullable: true, example: '081-234-5678' })
  phone: string | null;

  @ApiProperty({ nullable: true, example: 'somsri@example.co.th' })
  email: string | null;
}

export class MaContractPrintProjectDto {
  @ApiProperty({ example: 3 })
  id: number;

  @ApiProperty({ nullable: true, example: 'PRJ69-0003' })
  code: string | null;

  @ApiProperty({ example: 'ระบบจัดการคลังสินค้า' })
  name: string;
}

/** เนื้อหาแผนเต็มชุดสำหรับพิมพ์ — ไม่มีราคาเหมือน `MaPlanResponseDto` (BR-05) */
export class MaContractPrintPlanDto {
  @ApiProperty({
    nullable: true,
    example: 'MA_STANDARD',
    description: 'รหัสแผนไม่บังคับ (ตกลง 10 ก.ย.) — หน้าจอใช้ชื่อแผนแทน',
  })
  code: string | null;

  @ApiProperty({ example: 'แผนมาตรฐาน' })
  name: string;

  @ApiProperty({ nullable: true })
  description: string | null;

  @ApiProperty({ description: 'โควตาแก้บั๊กต่อเดือน', example: 5 })
  bugQuotaPerMonth: number;

  @ApiProperty({ nullable: true, description: 'เวลาตอบกลับตามสัญญา (ชั่วโมง)', example: 24 })
  responseTimeHour: number | null;

  @ApiProperty({ nullable: true, example: 1 })
  onsiteQuotaPerMonth: number | null;

  @ApiProperty({
    type: [MaPlanItemResponseDto],
    description: 'รายการบริการในแผน เรียงตาม sortOrder แล้ว',
  })
  items: MaPlanItemResponseDto[];
}

export class MaContractPrintPreviousDto {
  @ApiProperty({ example: 8 })
  id: number;

  @ApiProperty({ nullable: true, example: 'MA-2025-009' })
  contractNo: string | null;

  @ApiProperty({ example: '2025-10-01' })
  startDate: string;

  @ApiProperty({ example: '2026-09-30' })
  endDate: string;
}

export class MaContractPrintTermsDto {
  @ApiProperty({ example: 12 })
  id: number;

  @ApiProperty({
    nullable: true,
    example: 'MA69-0014',
    description:
      'หน้าจอซ่อนช่องนี้ตอนกรอก (ตกลง 10 ก.ย.) — เป็น null ให้ซ่อนบรรทัดนี้บนหน้าพิมพ์ด้วย',
  })
  contractNo: string | null;

  @ApiProperty({
    enum: MaContractStatus,
    description:
      'ระบบไม่กั้นการพิมพ์ตามสถานะ — หน้าจอใช้ค่านี้ตัดสินเองว่าจะใส่ลายน้ำ "ร่าง" หรือ "ยกเลิก"',
  })
  status: MaContractStatus;

  @ApiProperty({ description: MA_CONTRACT_PRICE_DESCRIPTION, example: '48000.00' })
  price: string;

  @ApiProperty({ enum: MaBillingCycle })
  billingCycle: MaBillingCycle;

  @ApiProperty({ example: '2026-10-01' })
  startDate: string;

  @ApiProperty({ example: '2027-09-30' })
  endDate: string;

  @ApiProperty({
    nullable: true,
    description: 'วันที่เซ็นมือ (BR-12) — ว่างแปลว่ายังไม่ได้เซ็น เอกสารที่พิมพ์คือร่างสำหรับเซ็น',
    example: null,
  })
  signedDate: string | null;

  @ApiProperty({ nullable: true })
  note: string | null;

  @ApiProperty({
    nullable: true,
    type: MaContractPrintPreviousDto,
    description:
      'สัญญาฉบับก่อนหน้า ถ้าฉบับนี้เกิดจากการต่อสัญญา — ใช้พิมพ์ "ต่อจากสัญญาเลขที่ ..."',
  })
  previousContract: MaContractPrintPreviousDto | null;
}

/**
 * M6-08 ข้อมูลสำหรับพิมพ์ร่างสัญญา MA
 *
 * **backend คืนข้อมูลที่ประกอบเสร็จแล้ว ไม่ได้สร้างไฟล์ PDF หรือ HTML** — repo นี้ห้ามสร้าง
 * ไฟล์หน้าเว็บ (CLAUDE.md ข้อ 1) การจัดหน้ากระดาษ ข้อความข้อกำหนดของบริษัท
 * และช่องลงลายมือชื่อเป็นงานของ frontend
 *
 * ข้อมูลฝั่งบริษัทผู้ให้บริการ (ชื่อ ที่อยู่ เลขผู้เสียภาษี) **ไม่อยู่ในนี้** เพราะ schema
 * ไม่มีตารางเก็บค่าพวกนี้ และห้ามเพิ่มตารางโดยไม่จำเป็น
 */
export class MaContractPrintDto {
  @ApiProperty({ description: 'เวลาที่ดึงข้อมูลชุดนี้ — พิมพ์กำกับไว้ท้ายเอกสาร' })
  generatedAt: Date;

  @ApiProperty({ type: MaContractPrintTermsDto })
  contract: MaContractPrintTermsDto;

  @ApiProperty({ type: MaContractPrintCustomerDto })
  customer: MaContractPrintCustomerDto;

  @ApiProperty({
    nullable: true,
    type: MaContractPrintContactDto,
    description: 'ผู้ติดต่อหลักของลูกค้า — ไม่มีผู้ติดต่อหลักได้ null ไม่ได้หยิบคนแรกมาแทน',
  })
  primaryContact: MaContractPrintContactDto | null;

  @ApiProperty({ type: MaContractPrintProjectDto })
  project: MaContractPrintProjectDto;

  @ApiProperty({ type: MaContractPrintPlanDto })
  plan: MaContractPrintPlanDto;

  @ApiProperty({
    type: [MaAddonResponseDto],
    description: 'ของเสริมของสัญญานี้ แสดงแยกรายการ — ระบบไม่รวมเป็นยอดเดียวให้',
  })
  addons: MaAddonResponseDto[];
}

export function toMaPlanItemResponse(item: MaPlanItem): MaPlanItemResponseDto {
  return {
    id: item.id,
    title: item.title,
    detail: item.detail,
    sortOrder: item.sortOrder,
  };
}

export function toMaPlanResponse(plan: MaPlan): MaPlanResponseDto {
  return {
    id: plan.id,
    code: plan.code,
    name: plan.name,
    description: plan.description,
    bugQuotaPerMonth: plan.bugQuotaPerMonth,
    responseTimeHour: plan.responseTimeHour,
    onsiteQuotaPerMonth: plan.onsiteQuotaPerMonth,
    isActive: plan.isActive,
    sortOrder: plan.sortOrder,
    items: (plan.items ?? []).map(toMaPlanItemResponse),
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}

export function toMaAddonResponse(addon: MaAddon): MaAddonResponseDto {
  return {
    id: addon.id,
    contractId: addon.contractId,
    addonType: addon.addonType,
    title: addon.title,
    extraQuota: addon.extraQuota,
    price: addon.price,
    effectiveYear: addon.effectiveYear,
    effectiveMonth: addon.effectiveMonth,
    note: addon.note,
    createdAt: addon.createdAt,
  };
}

/**
 * สัญญายังคุ้มครองอยู่จริงหรือไม่
 *
 * cron ปรับ ACTIVE ที่เลยวันสิ้นสุดเป็น EXPIRED รายชั่วโมง ระหว่างรอบแถวจึงยังค้างเป็น ACTIVE ได้
 * ทุกที่ที่ตัดสินว่า "คุ้มครองอยู่ไหม" จึงต้องเทียบช่วงวันที่ซ้ำเสมอ
 */
export function isContractCurrentlyActive(
  contract: MaContract,
  today = todayAsDateOnly(),
): boolean {
  return resolveContractCoverageState(contract, today) === MaContractCoverageState.IN_FORCE;
}

export function resolveContractCoverageState(
  contract: Pick<MaContract, 'status' | 'startDate' | 'endDate'>,
  today = todayAsDateOnly(),
): MaContractCoverageState {
  if (contract.status === MaContractStatus.EXPIRED) {
    return MaContractCoverageState.ENDED;
  }

  if (contract.status !== MaContractStatus.ACTIVE) {
    return MaContractCoverageState.INACTIVE;
  }

  if (contract.startDate > today) {
    return MaContractCoverageState.NOT_STARTED;
  }

  if (contract.endDate < today) {
    return MaContractCoverageState.ENDED;
  }

  return MaContractCoverageState.IN_FORCE;
}

export function toMaContractResponse(
  contract: MaContract,
  extra: { addons?: MaAddon[]; quota?: QuotaStatusResponseDto | null } = {},
): MaContractResponseDto {
  const coverageState = resolveContractCoverageState(contract);

  const response: MaContractResponseDto = {
    id: contract.id,
    customerId: contract.customerId,
    customerName: contract.customer ? contract.customer.name : null,
    projectId: contract.projectId,
    projectName: contract.project ? contract.project.name : null,
    planId: contract.planId,
    plan: contract.plan
      ? {
          id: contract.plan.id,
          code: contract.plan.code,
          name: contract.plan.name,
          bugQuotaPerMonth: contract.plan.bugQuotaPerMonth,
          responseTimeHour: contract.plan.responseTimeHour,
        }
      : null,
    contractNo: contract.contractNo,
    price: contract.price,
    billingCycle: contract.billingCycle,
    startDate: contract.startDate,
    endDate: contract.endDate,
    status: contract.status,
    coverageState,
    isCurrentlyActive: coverageState === MaContractCoverageState.IN_FORCE,
    daysUntilExpiry: daysUntil(contract.endDate),
    signedDate: contract.signedDate,
    signedFileUrl: contract.signedFileUrl,
    previousContractId: contract.previousContractId,
    note: contract.note,
    createdAt: contract.createdAt,
    updatedAt: contract.updatedAt,
  };

  if (extra.addons) {
    response.addons = extra.addons.map(toMaAddonResponse);
  }

  if (extra.quota !== undefined) {
    response.quota = extra.quota;
  }

  return response;
}

/**
 * ประกอบข้อมูลพิมพ์ร่างสัญญา (M6-08)
 *
 * รับลูกค้า/โครงการ/แผนแยกเข้ามา แทนที่จะอ่านจาก `contract.customer` ตรง ๆ
 * เพื่อให้ service เป็นคนตัดสินว่าข้อมูลขาดแล้วต้องทำยังไง ฟังก์ชันนี้แค่จัดรูป
 */
export function toMaContractPrint(input: {
  contract: MaContract;
  customer: Customer;
  project: Project;
  plan: MaPlan;
  addons: MaAddon[];
  generatedAt?: Date;
}): MaContractPrintDto {
  const { contract, customer, project, plan, addons } = input;

  // ไม่มีผู้ติดต่อหลัก = null ไม่หยิบคนแรกมาแทน เพราะคนที่ถูกพิมพ์ลงสัญญาต้องเป็นคนที่
  // ลูกค้าตั้งเป็นผู้ติดต่อหลักจริง ๆ ถ้าเดาให้ อาจพิมพ์ชื่อคนที่ไม่มีอำนาจลงนามลงไป
  const primary = (customer.contacts ?? []).find((contact) => contact.isPrimary) ?? null;

  const items = [...(plan.items ?? [])].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);

  const previous = contract.previousContract ?? null;

  return {
    generatedAt: input.generatedAt ?? new Date(),
    contract: {
      id: contract.id,
      contractNo: contract.contractNo,
      status: contract.status,
      price: contract.price,
      billingCycle: contract.billingCycle,
      startDate: contract.startDate,
      endDate: contract.endDate,
      signedDate: contract.signedDate,
      note: contract.note,
      previousContract: previous
        ? {
            id: previous.id,
            contractNo: previous.contractNo,
            startDate: previous.startDate,
            endDate: previous.endDate,
          }
        : null,
    },
    customer: {
      id: customer.id,
      code: customer.code,
      name: customer.name,
      taxId: customer.taxId,
      address: customer.address,
      province: customer.province,
      postalCode: customer.postalCode,
      phone: customer.phone,
      email: customer.email,
    },
    primaryContact: primary
      ? {
          name: primary.name,
          position: primary.position,
          phone: primary.phone,
          email: primary.email,
        }
      : null,
    project: { id: project.id, code: project.code, name: project.name },
    plan: {
      code: plan.code,
      name: plan.name,
      description: plan.description,
      bugQuotaPerMonth: plan.bugQuotaPerMonth,
      responseTimeHour: plan.responseTimeHour,
      onsiteQuotaPerMonth: plan.onsiteQuotaPerMonth,
      items: items.map(toMaPlanItemResponse),
    },
    addons: addons.map(toMaAddonResponse),
  };
}
