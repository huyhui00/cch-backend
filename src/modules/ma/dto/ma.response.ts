import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { daysUntil, todayAsDateOnly } from '../../../common/utils/date.util';
import {
  MaAddon,
  MaAddonType,
  MaBillingCycle,
  MaContract,
  MaContractStatus,
  MaPlan,
  MaPlanItem,
} from '../../../models';

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

  @ApiProperty({ example: 'MA_STANDARD' })
  code: string;

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

  @ApiProperty({ example: 'MA_STANDARD' })
  code: string;

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

  @ApiProperty({ nullable: true, example: 'MA-2026-014' })
  contractNo: string | null;

  @ApiProperty({ description: 'ราคาตามสัญญา (BR-05)', example: '48000.00' })
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
      'ยังคุ้มครองอยู่จริงหรือไม่ ณ วันนี้ — คิดจากช่วงวันที่คู่กับสถานะ ไม่ได้อ่านจาก status ' +
      'อย่างเดียว เพราะยังไม่มี scheduler ปรับ EXPIRED ให้จนกว่าจะถึง Phase 11',
    example: true,
  })
  isCurrentlyActive: boolean;

  @ApiProperty({
    description: 'เหลืออีกกี่วันจะหมดอายุ ติดลบแปลว่าหมดไปแล้ว',
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
 * เหตุผลเดียวกับ `isCurrentlyActive` ของประกันใน Phase 6 — ยังไม่มี scheduler
 * มาปรับ `status` เป็น EXPIRED ให้ แถวที่หมดอายุแล้วจึงค้างเป็น ACTIVE อยู่ในฐาน
 * ทุกที่ที่ตัดสินว่า "คุ้มครองอยู่ไหม" จึงต้องเทียบช่วงวันที่ซ้ำเสมอ
 * ตรงกับเงื่อนไขที่ `MaQuotaService.findActiveContract()` ใช้ query จริง
 */
export function isContractCurrentlyActive(
  contract: MaContract,
  today = todayAsDateOnly(),
): boolean {
  return (
    contract.status === MaContractStatus.ACTIVE &&
    contract.startDate <= today &&
    contract.endDate >= today
  );
}

export function toMaContractResponse(
  contract: MaContract,
  extra: { addons?: MaAddon[]; quota?: QuotaStatusResponseDto | null } = {},
): MaContractResponseDto {
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
    isCurrentlyActive: isContractCurrentlyActive(contract),
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
