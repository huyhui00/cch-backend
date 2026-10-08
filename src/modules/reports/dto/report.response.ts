import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { MaContractStatus, ProjectStatus } from '../../../models';

export const CONTRACT_VALUE_DISCLAIMER =
  'ตัวเลขทั้งหมดเป็นมูลค่าตามสัญญา ไม่ใช่เงินที่ได้รับจริง — ' +
  'ระบบนี้ไม่ใช่ระบบบัญชีและไม่มีข้อมูลการรับชำระเงิน';

export class DataCompletenessDto {
  @ApiProperty({ description: 'จำนวนรายการทั้งหมดที่เข้าเงื่อนไขรายงาน', example: 20 })
  total: number;

  @ApiProperty({ description: 'จำนวนรายการที่มีข้อมูลกรอกไว้จริง', example: 6 })
  withData: number;

  @ApiProperty({ description: 'จำนวนรายการที่ยังไม่ได้กรอก', example: 14 })
  withoutData: number;

  @ApiProperty({
    description:
      'อัตราความครบถ้วนเป็นเปอร์เซ็นต์ ทศนิยม 2 ตำแหน่ง — ' +
      'ยิ่งต่ำแปลว่าตัวเลขที่คำนวณได้ยิ่งไม่ควรเชื่อ',
    example: 30,
  })
  completeness: number;
}

export class CustomerContractValueDto {
  @ApiProperty({ example: 1 })
  customerId: number;

  @ApiProperty({ example: 'บริษัท ตัวอย่าง จำกัด' })
  customerName: string;

  @ApiProperty({ nullable: true, example: 'CUS69-0001' })
  customerCode: string | null;

  @ApiProperty({ description: 'มูลค่าตามสัญญาจากโครงการ', example: '1850000.00' })
  projectContractValue: string;

  @ApiProperty({ description: 'มูลค่าตามสัญญาจากสัญญา MA', example: '96000.00' })
  maContractValue: string;

  @ApiProperty({ description: 'มูลค่าตามสัญญาจากของเสริมของสัญญา MA', example: '4500.00' })
  maAddonValue: string;

  @ApiProperty({
    description: 'ค่าบริการรายครั้งที่กรอกไว้ — ดูความครบถ้วนที่ oneTimeCompleteness',
    example: '3000.00',
  })
  oneTimeChargeValue: string;

  @ApiProperty({ description: 'มูลค่าตามสัญญารวมทุกทาง', example: '1953500.00' })
  totalContractValue: string;

  @ApiProperty({
    description:
      'จำนวนสัญญา MA ที่ช่วงเวลาซ้อนทับกันของลูกค้ารายนี้ — มากกว่า 0 แปลว่ายอดรวม ' +
      'อาจนับซ้ำ ให้ตรวจที่ GET /api/reports/ma-contract-overlaps ก่อนใช้ตัวเลข (Q4)',
    example: 0,
  })
  overlappingContractCount: number;
}

export class ContractValueByCustomerDto {
  @ApiProperty({ description: CONTRACT_VALUE_DISCLAIMER })
  disclaimer: string;

  @ApiProperty({ nullable: true, example: '2026-01-01' })
  dateFrom: string | null;

  @ApiProperty({ nullable: true, example: '2026-12-31' })
  dateTo: string | null;

  @ApiProperty({ description: 'มูลค่าตามสัญญารวมทุกลูกค้าในรายการนี้', example: '5400000.00' })
  grandTotalContractValue: string;

  @ApiProperty({
    description: 'เรียงจากมูลค่าตามสัญญามากไปน้อย — ใส่ ?limit=10 เพื่อทำหน้าจอจัดอันดับ',
    type: [CustomerContractValueDto],
  })
  items: CustomerContractValueDto[];

  @ApiProperty({
    description: 'ความครบถ้วนของค่าบริการรายครั้ง (tickets.extra_charge ว่างได้)',
    type: DataCompletenessDto,
  })
  oneTimeCompleteness: DataCompletenessDto;

  @ApiProperty({
    description: 'มูลค่าตามสัญญาที่ถูกตัดออกเพราะรายการถูกยกเลิก',
    example: '250000.00',
  })
  excludedCancelledValue: string;

  @ApiProperty({ description: 'จำนวนรายการที่ถูกตัดออกเพราะยกเลิก', example: 2 })
  excludedCancelledCount: number;
}

export class ContractValueByTypeDto {
  @ApiProperty({ description: CONTRACT_VALUE_DISCLAIMER })
  disclaimer: string;

  @ApiProperty({ nullable: true })
  dateFrom: string | null;

  @ApiProperty({ nullable: true })
  dateTo: string | null;

  @ApiProperty({ description: 'มูลค่าตามสัญญาจากโครงการ', example: '4800000.00' })
  projectContractValue: string;

  @ApiProperty({ description: 'จำนวนโครงการที่นับ', example: 12 })
  projectCount: number;

  @ApiProperty({ description: 'มูลค่าตามสัญญาจากสัญญา MA', example: '480000.00' })
  maContractValue: string;

  @ApiProperty({ example: 8 })
  maContractCount: number;

  @ApiProperty({ description: 'มูลค่าตามสัญญาจากของเสริม', example: '18000.00' })
  maAddonValue: string;

  @ApiProperty({ example: 4 })
  maAddonCount: number;

  @ApiProperty({
    description: 'ค่าบริการรายครั้งที่กรอกไว้จริง — ดูความครบถ้วนที่ oneTimeCompleteness',
    example: '15000.00',
  })
  oneTimeChargeValue: string;

  @ApiProperty({
    description:
      'ความครบถ้วนของค่าบริการรายครั้ง — ใบที่ยังไม่กรอกค่าบริการ **ไม่ได้ถูกนับเป็น 0** ' +
      'แต่ถูกกันออกจากยอดรวมและรายงานไว้ที่นี่แทน',
    type: DataCompletenessDto,
  })
  oneTimeCompleteness: DataCompletenessDto;

  @ApiProperty({ example: '5313000.00' })
  totalContractValue: string;

  @ApiProperty({ example: '250000.00' })
  excludedCancelledValue: string;

  @ApiProperty({ example: 2 })
  excludedCancelledCount: number;
}

export class UpcomingContractItemDto {
  @ApiProperty({ example: 12 })
  contractId: number;

  @ApiProperty({ nullable: true, example: 'MA69-0014' })
  contractNo: string | null;

  @ApiProperty({ example: 1 })
  customerId: number;

  @ApiProperty({ example: 'บริษัท ตัวอย่าง จำกัด' })
  customerName: string;

  @ApiProperty({ example: 3 })
  projectId: number;

  @ApiProperty({ example: '48000.00' })
  contractValue: string;

  @ApiProperty({ example: '2026-10-01' })
  startDate: string;

  @ApiProperty({ example: '2027-09-30' })
  endDate: string;

  @ApiProperty({ description: 'เหลืออีกกี่วันจะหมดอายุ', example: 200 })
  daysUntilExpiry: number;
}

export class UpcomingContractValueDto {
  @ApiProperty({ description: CONTRACT_VALUE_DISCLAIMER })
  disclaimer: string;

  @ApiProperty({
    description:
      'นับเฉพาะสัญญาที่ยังคุ้มครองอยู่จริง ณ วันนี้ — สถานะ ACTIVE **และ** วันนี้ยังอยู่ใน ' +
      'ช่วง start_date..end_date เพราะยังไม่มี scheduler ปรับสถานะเป็น EXPIRED ให้ ' +
      'สัญญาที่หมดอายุไปแล้วจึงยังค้างเป็น ACTIVE อยู่ในฐานข้อมูล (จะมีตอน M11)',
    example: '480000.00',
  })
  totalContractValue: string;

  @ApiProperty({ example: 8 })
  contractCount: number;

  @ApiProperty({
    description: 'จำนวนสัญญาที่ช่วงเวลาซ้อนทับกัน — มากกว่า 0 แปลว่ายอดรวมอาจนับซ้ำ (Q4)',
    example: 0,
  })
  overlappingContractCount: number;

  @ApiProperty({ type: [UpcomingContractItemDto] })
  items: UpcomingContractItemDto[];
}

export class CustomerServiceCostDto {
  @ApiProperty({ example: 1 })
  customerId: number;

  @ApiProperty({ example: 'บริษัท ตัวอย่าง จำกัด' })
  customerName: string;

  @ApiProperty({ description: 'จำนวนใบแจ้งปัญหาที่นับ', example: 20 })
  ticketCount: number;

  @ApiProperty({ description: 'จำนวนรอบการแก้ไขทั้งหมด', example: 26 })
  resolutionCount: number;

  @ApiProperty({
    description: 'ชั่วโมงรวมจากรอบที่กรอกเวลาไว้จริงเท่านั้น',
    example: '12.00',
  })
  totalHours: string;

  @ApiProperty({
    description: 'ความครบถ้วนของเวลาที่กรอก นับเป็นรายรอบการแก้ไข',
    type: DataCompletenessDto,
  })
  completeness: DataCompletenessDto;
}

export class ServiceCostReportDto {
  @ApiProperty({
    description:
      'ต้นทุนคิดจาก ticket_resolutions.hours_spent ซึ่ง **กรอกหรือไม่กรอกก็ได้** — ' +
      'รอบที่ไม่ได้กรอกเวลาไม่ได้ถูกนับเป็น 0 ชั่วโมง แต่ถูกกันออกจากยอดรวมและรายงาน ' +
      'ไว้ที่ completeness แทน ให้อ่านตัวเลขคู่กับความครบถ้วนเสมอ',
  })
  disclaimer: string;

  @ApiProperty({ nullable: true })
  dateFrom: string | null;

  @ApiProperty({ nullable: true })
  dateTo: string | null;

  @ApiProperty({ description: 'ชั่วโมงรวมทุกลูกค้าจากรอบที่กรอกเวลาไว้', example: '48.50' })
  totalHours: string;

  @ApiProperty({ description: 'ความครบถ้วนรวมทุกลูกค้า', type: DataCompletenessDto })
  completeness: DataCompletenessDto;

  @ApiProperty({ type: [CustomerServiceCostDto] })
  items: CustomerServiceCostDto[];
}

export class OverlappingContractDto {
  @ApiProperty({ example: 12 })
  contractId: number;

  @ApiProperty({ nullable: true, example: 'MA69-0014' })
  contractNo: string | null;

  @ApiProperty({ example: 3 })
  projectId: number;

  @ApiProperty({ nullable: true, example: 'ระบบจัดการคลังสินค้า' })
  projectName: string | null;

  @ApiProperty({ example: '2026-01-01' })
  startDate: string;

  @ApiProperty({ example: '2026-12-31' })
  endDate: string;

  @ApiProperty({ enum: MaContractStatus })
  status: MaContractStatus;

  @ApiProperty({ description: 'มูลค่าตามสัญญาของฉบับนี้', example: '48000.00' })
  contractValue: string;
}

export class CustomerOverlapDto {
  @ApiProperty({ example: 1 })
  customerId: number;

  @ApiProperty({ example: 'บริษัท ตัวอย่าง จำกัด' })
  customerName: string;

  @ApiProperty({ description: 'จำนวนสัญญาที่พบว่าซ้อนทับกันของลูกค้ารายนี้', example: 2 })
  overlappingContractCount: number;

  @ApiProperty({
    description: 'คู่สัญญาที่ช่วงเวลาทับกัน อ้างด้วย contractId',
    example: [[12, 15]],
  })
  overlappingPairs: [number, number][];

  @ApiProperty({ type: [OverlappingContractDto] })
  contracts: OverlappingContractDto[];
}

export class ContractOverlapReportDto {
  @ApiProperty({
    description:
      '**ตรวจจับและรายงานเท่านั้น** — ระบบไม่แก้ ไม่ลบ ไม่รวม และไม่เลือกสัญญาใดแทน ' +
      'เพราะ Q4 (1 โครงการ/ลูกค้ามีสัญญาซ้อนกันได้ไหม) ยังไม่มีข้อสรุปจากผู้บริหาร',
  })
  disclaimer: string;

  @ApiProperty({ description: 'จำนวนลูกค้าที่พบสัญญาซ้อนทับ', example: 1 })
  customerCount: number;

  @ApiProperty({ description: 'จำนวนสัญญาที่เกี่ยวข้องทั้งหมด', example: 2 })
  contractCount: number;

  @ApiProperty({ type: [CustomerOverlapDto] })
  items: CustomerOverlapDto[];
}

export class OverviewProjectDto {
  @ApiProperty({ example: 3 })
  id: number;

  @ApiProperty({ example: 'ระบบจัดการคลังสินค้า' })
  name: string;

  @ApiProperty({ nullable: true, example: 'PRJ-DEMO-001' })
  code: string | null;

  @ApiProperty({ enum: ProjectStatus })
  status: ProjectStatus;

  @ApiProperty({ nullable: true, description: 'มูลค่าตามสัญญาของโครงการ', example: '1850000.00' })
  contractValue: string | null;

  @ApiProperty({ nullable: true, description: 'กำหนดส่งมอบตามแผน', example: '2026-09-30' })
  targetEndDate: string | null;
}

export class OverviewWarrantyDto {
  @ApiProperty({ example: 4 })
  id: number;

  @ApiProperty({ example: 3 })
  projectId: number;

  @ApiProperty({ example: '2026-09-08' })
  startDate: string;

  @ApiProperty({ example: '2027-09-08' })
  endDate: string;

  @ApiProperty({
    description: 'ยังอยู่ในระยะประกันจริงไหม — คิดจากวันที่ ไม่ได้อ่านจาก status',
    example: true,
  })
  isCurrentlyActive: boolean;
}

export class OverviewContractDto {
  @ApiProperty({ example: 12 })
  id: number;

  @ApiProperty({ nullable: true, example: 'MA69-0014' })
  contractNo: string | null;

  @ApiProperty({ example: 3 })
  projectId: number;

  @ApiProperty({ enum: MaContractStatus })
  status: MaContractStatus;

  @ApiProperty({ description: 'มูลค่าตามสัญญา', example: '48000.00' })
  contractValue: string;

  @ApiProperty({ example: '2026-10-01' })
  startDate: string;

  @ApiProperty({ example: '2027-09-30' })
  endDate: string;

  @ApiProperty({ description: 'ยังคุ้มครองอยู่จริงไหม ณ วันนี้', example: true })
  isCurrentlyActive: boolean;
}

export class OverviewTicketDto {
  @ApiProperty({ example: 7 })
  id: number;

  @ApiProperty({ nullable: true, example: 'TK69-0006' })
  ticketNo: string | null;

  @ApiProperty({ example: 'หน้าจอรายงานโหลดไม่ขึ้น' })
  title: string;

  @ApiProperty({ example: 'RESOLVED' })
  status: string;

  @ApiProperty({ example: 'WARRANTY' })
  billingType: string;

  @ApiProperty({ description: 'แก้ไปแล้วกี่รอบ', example: 2 })
  resolutionCount: number;

  @ApiProperty()
  reportedAt: Date;
}

export class OverviewFollowUpDto {
  @ApiProperty({ example: 12 })
  id: number;

  @ApiProperty({ example: 'โทรถามความคืบหน้าการต่อสัญญา' })
  title: string;

  @ApiProperty({ example: '2026-09-20' })
  dueDate: string;

  @ApiProperty({ example: 'PLANNED' })
  status: string;

  @ApiProperty({ description: 'เลยกำหนดแล้วไหม — คิดจากวันที่ ไม่ได้อ่านจาก status' })
  isOverdue: boolean;
}

export class CustomerLifetimeValueDto {
  @ApiProperty({ description: CONTRACT_VALUE_DISCLAIMER })
  disclaimer: string;

  @ApiProperty({ description: 'มูลค่าตามสัญญาจากโครงการ (ไม่รวมที่ยกเลิก)', example: '1850000.00' })
  projectContractValue: string;

  @ApiProperty({ description: 'มูลค่าตามสัญญาจากสัญญา MA (ไม่รวมที่ยกเลิก)', example: '96000.00' })
  maContractValue: string;

  @ApiProperty({
    description: 'มูลค่าจากของเสริม — ของเสริมของสัญญาที่ยกเลิกถูกตัดตามสัญญาแม่ไปด้วย',
    example: '4500.00',
  })
  maAddonValue: string;

  @ApiProperty({
    description: 'ค่าบริการรายครั้งที่กรอกไว้จริง — ดูความครบถ้วนที่ oneTimeCompleteness',
    example: '3000.00',
  })
  oneTimeChargeValue: string;

  @ApiProperty({ description: 'มูลค่าตามสัญญารวมที่นำมาคำนวณจริง', example: '1953500.00' })
  totalContractValue: string;

  @ApiProperty({
    description: 'มูลค่าตามสัญญาที่ถูกตัดออกเพราะสถานะเป็น CANCELLED',
    example: '250000.00',
  })
  excludedCancelledValue: string;

  @ApiProperty({ description: 'จำนวนรายการที่ถูกตัดออกเพราะยกเลิก', example: 2 })
  excludedCancelledCount: number;

  @ApiProperty({ type: DataCompletenessDto })
  oneTimeCompleteness: DataCompletenessDto;

  @ApiProperty({
    description: 'จำนวนสัญญา MA ที่ซ้อนทับกัน — มากกว่า 0 แปลว่ายอดนี้อาจนับซ้ำ (Q4)',
    example: 0,
  })
  overlappingContractCount: number;
}

export class CustomerOverviewDto {
  @ApiProperty({ example: 1 })
  customerId: number;

  @ApiProperty({ example: 'บริษัท ตัวอย่าง จำกัด' })
  customerName: string;

  @ApiProperty({ nullable: true, example: 'CUS69-0001' })
  customerCode: string | null;

  @ApiProperty({ example: 'ACTIVE' })
  customerStatus: string;

  @ApiProperty({ nullable: true, description: 'ติดต่อครั้งล่าสุดเมื่อไหร่' })
  lastContactedAt: Date | null;

  @ApiProperty({
    nullable: true,
    description: 'ไม่ได้ติดต่อมากี่วันแล้ว — null แปลว่ายังไม่เคยติดต่อเลย',
    example: 45,
  })
  idleDays: number | null;

  @ApiProperty({ type: [OverviewProjectDto] })
  projects: OverviewProjectDto[];

  @ApiProperty({ type: [OverviewWarrantyDto] })
  warranties: OverviewWarrantyDto[];

  @ApiProperty({ type: [OverviewContractDto] })
  maContracts: OverviewContractDto[];

  @ApiProperty({ description: 'ใบแจ้งปัญหาล่าสุด เรียงจากใหม่ไปเก่า', type: [OverviewTicketDto] })
  tickets: OverviewTicketDto[];

  @ApiProperty({ type: [OverviewFollowUpDto] })
  followUps: OverviewFollowUpDto[];

  @ApiPropertyOptional({
    description: 'M1-06 มูลค่ารวมตามสัญญาตลอดอายุการใช้บริการ',
    type: CustomerLifetimeValueDto,
  })
  lifetimeValue: CustomerLifetimeValueDto;
}
