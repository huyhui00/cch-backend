import { ApiProperty } from '@nestjs/swagger';

import { daysUntil } from '../../../common/utils/date.util';
import {
  type Attachment,
  type Customer,
  MaContractStatus,
  Warranty,
  WarrantyStatus,
} from '../../../models';
import {
  AttachmentSummaryDto,
  toAttachmentSummary,
} from '../../attachments/dto/attachment.response';

/**
 * ใบส่งมอบต้นทางแบบย่อ
 *
 * ประกาศไว้ที่นี่เอง ไม่ได้ import จาก dto ของ deliveries เพื่อไม่ให้สอง module
 * import วนกัน — ฝั่ง deliveries เป็นคนดึงของจากไฟล์นี้ไปใช้ทางเดียว
 */
export class DeliverySummaryDto {
  @ApiProperty({ example: 5 })
  id: number;

  @ApiProperty({ example: 'ส่งมอบระบบเฟสที่ 1 พร้อมคู่มือการใช้งาน' })
  title: string;

  @ApiProperty({ nullable: true, example: 'v1.2.0' })
  version: string | null;

  @ApiProperty({ description: 'จุดตั้งต้นของระยะประกัน (BR-06)' })
  deliveredAt: Date;
}

/**
 * สัญญา MA ที่ประกันใบนี้มาคู่กัน (B-13)
 *
 * มีเท่าที่ต้องใช้ตอบคำถามของพี่เลี้ยงว่า "ประกันนี้รวม MA ตัวไหน รูปแบบไหน" เท่านั้น
 * **ห้ามเพิ่มราคาหรือโควตาลงในนี้** — พี่เลี้ยงปฏิเสธการคิดรวมไว้ชัด ถ้าเอาตัวเลขพวกนั้นมาแปะ
 * หน้าจอจะเริ่มเอาไปบวกกับประกันเอง ซึ่งเป็นสิ่งที่ตกลงกันว่าจะไม่ทำ
 * รายละเอียดเต็มของสัญญาอยู่ที่ /api/ma-contracts/:id ตามเดิม
 */
export class WarrantyMaContractSummaryDto {
  @ApiProperty({ example: 3 })
  id: number;

  @ApiProperty({ nullable: true, example: 'MA69-0001' })
  contractNo: string | null;

  @ApiProperty({ enum: MaContractStatus, description: 'สถานะที่บันทึกไว้ของสัญญา' })
  status: MaContractStatus;

  @ApiProperty({ nullable: true, example: 'MA-STD', description: 'รหัสแผนที่สัญญาฉบับนี้ใช้' })
  planCode: string | null;

  @ApiProperty({
    nullable: true,
    example: 'Standard',
    description: 'ชื่อแผน — "รูปแบบ" ที่พี่เลี้ยงถามถึง',
  })
  planName: string | null;
}

export class WarrantyProjectSummaryDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'ระบบจัดการคลังสินค้า' })
  name: string;

  @ApiProperty({ example: 1 })
  customerId: number;

  @ApiProperty({ nullable: true, example: 'บริษัท ตัวอย่าง จำกัด' })
  customerName: string | null;
}

/** รูปย่อของประกัน ใช้ฝังในใบส่งมอบ รายละเอียดเต็มอยู่ที่ /api/warranties */
export class WarrantySummaryDto {
  @ApiProperty({ example: 4 })
  id: number;

  @ApiProperty({ nullable: true, example: 'WAR69-0008' })
  warrantyNo: string | null;

  @ApiProperty({ example: 12 })
  durationMonth: number;

  @ApiProperty({ example: '2026-09-08' })
  startDate: string;

  @ApiProperty({ example: '2027-09-08' })
  endDate: string;

  @ApiProperty({ enum: WarrantyStatus })
  status: WarrantyStatus;

  @ApiProperty({
    description: 'ยังอยู่ในระยะประกันจริงหรือไม่ — คิดจากวันที่ปัจจุบัน ไม่ได้อ่านจาก status',
    example: true,
  })
  isCurrentlyActive: boolean;
}

export class WarrantyResponseDto {
  @ApiProperty({ example: 4 })
  id: number;

  @ApiProperty({ nullable: true, example: 'WAR69-0008' })
  warrantyNo: string | null;

  @ApiProperty({
    description: 'ประกันผูกกับการส่งมอบ ไม่ใช่ผูกกับโครงการเฉย ๆ (BR-06)',
    example: 5,
  })
  deliveryId: number;

  @ApiProperty({ type: DeliverySummaryDto, nullable: true })
  delivery: DeliverySummaryDto | null;

  @ApiProperty({ description: 'คัดลอกมาจากใบส่งมอบเพื่อให้ query ตามโครงการได้เร็ว', example: 1 })
  projectId: number;

  @ApiProperty({ type: WarrantyProjectSummaryDto, nullable: true })
  project: WarrantyProjectSummaryDto | null;

  @ApiProperty({
    nullable: true,
    description: 'สัญญา MA ที่ประกันใบนี้มาคู่กัน — null เมื่อไม่ได้ผูก (B-13)',
    example: 3,
  })
  maContractId: number | null;

  @ApiProperty({
    type: WarrantyMaContractSummaryDto,
    nullable: true,
    description:
      'ข้อมูลย่อของสัญญาที่ผูกไว้ ใช้แสดงว่า "ประกันนี้รวม MA รูปแบบไหน" — ' +
      'อ้างอิงอย่างเดียว ห้ามเอาโควตาหรือราคาของสัญญามารวมกับประกัน',
  })
  maContract: WarrantyMaContractSummaryDto | null;

  @ApiProperty({ example: 12 })
  durationMonth: number;

  @ApiProperty({ description: 'เท่ากับวันส่งมอบเสมอ กรอกเองไม่ได้ (BR-06)', example: '2026-09-08' })
  startDate: string;

  @ApiProperty({
    description: 'วันสุดท้ายที่ยังอยู่ในประกัน (นับรวมวันนี้) = startDate + durationMonth',
    example: '2027-09-08',
  })
  endDate: string;

  @ApiProperty({ enum: WarrantyStatus, description: 'สถานะที่บันทึกไว้ในฐานข้อมูล' })
  status: WarrantyStatus;

  @ApiProperty({
    description:
      'ยังอยู่ในระยะประกันจริงหรือไม่ ณ วันนี้ — ให้หน้าจอใช้ค่านี้ ไม่ใช่ status ' +
      'เพราะ cron ปรับ status เป็น EXPIRED รายชั่วโมง ระหว่างรอบอาจยังค้างเป็น ACTIVE',
    example: true,
  })
  isCurrentlyActive: boolean;

  @ApiProperty({
    description: 'จำนวนวันที่เหลือก่อนประกันหมด ติดลบเมื่อหมดไปแล้ว',
    example: 364,
  })
  daysRemaining: number;

  @ApiProperty({
    nullable: true,
    description:
      'ขอบเขตที่ประกันครอบคลุม — ประกันครอบคลุมเฉพาะ bug ในขอบเขตเดิม ' +
      'เพิ่มฟีเจอร์ใหม่คิดเงินใหม่ (BR-07) ระบบเก็บไว้ให้คนอ่านประกอบการตัดสินใจเท่านั้น',
  })
  scopeNote: string | null;

  @ApiProperty({
    type: [AttachmentSummaryDto],
    description:
      'เอกสารแนบของใบประกัน (ref_type = WARRANTY) เช่นใบรับประกันที่ลูกค้าเซ็นแล้ว — ' +
      'มีค่าเฉพาะ endpoint รายละเอียด รายการอื่นคืนเป็นอาเรย์ว่าง · อัปโหลดด้วย POST /api/attachments',
  })
  attachments: AttachmentSummaryDto[];

  @ApiProperty({
    description:
      'จำนวนเอกสารแนบของใบประกัน (ref_type = WARRANTY) มีค่าจริงทุก endpoint รวมรายการ — ' +
      'หน้าจอใช้เตือน "ยังไม่แนบใบที่ลูกค้าเซ็น" เมื่อเป็น 0 (BR-12)',
    example: 1,
  })
  attachmentCount: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

/**
 * ยังอยู่ในระยะประกันจริงหรือไม่ ณ วันที่กำหนด
 *
 * ต้องดูทั้งสถานะที่บันทึกไว้และช่วงวันที่ เพราะ WarrantyExpiryScheduler ปรับ status
 * เป็นรอบรายชั่วโมง ถ้าเชื่อ status อย่างเดียว ระหว่างรอบจะตอบผิด
 *
 * VOID คือการยกเลิกด้วยมือ จึงตัดออกทันทีไม่ว่าวันที่จะอยู่ในช่วงหรือไม่
 * ส่วน EXPIRED ที่ถูกบันทึกไว้แล้วยังต้องเทียบวันที่อยู่ดี เผื่อกรณีที่ระยะประกัน
 * ถูกขยายภายหลังแต่ยังไม่ได้แก้ status กลับ
 *
 * ⚠ เงื่อนไขชุดนี้ถูกเขียนไว้สองที่โดยจำเป็น — ที่นี่เป็นเวอร์ชัน JS ใช้กับแถวที่โหลดมาแล้ว
 * ส่วนอีกที่เป็นเวอร์ชัน SQL ใน `WarrantiesService.findCoveringWarranty()` ซึ่งต้องค้น
 * ในฐานข้อมูลจึงเอา predicate ตัวนี้ไปใช้ซ้ำไม่ได้ **แก้ที่ไหนต้องแก้อีกที่ด้วยเสมอ**
 * ไม่งั้นหน้าจอจะบอกว่าคุ้มครอง แต่ตอนเปิด ticket ระบบตอบว่าไม่คุ้มครอง
 */
export function isWarrantyCurrentlyActive(
  warranty: Pick<Warranty, 'status' | 'startDate' | 'endDate'>,
  onDate: string,
): boolean {
  if (warranty.status === WarrantyStatus.VOID) {
    return false;
  }

  return warranty.startDate <= onDate && onDate <= warranty.endDate;
}

export function toWarrantySummary(warranty: Warranty, onDate: string): WarrantySummaryDto {
  return {
    id: warranty.id,
    warrantyNo: warranty.warrantyNo,
    durationMonth: warranty.durationMonth,
    startDate: warranty.startDate,
    endDate: warranty.endDate,
    status: warranty.status,
    isCurrentlyActive: isWarrantyCurrentlyActive(warranty, onDate),
  };
}

export function toWarrantyResponse(
  warranty: Warranty,
  onDate: string,
  attachments: Attachment[] = [],
  attachmentCount: number = attachments.length,
): WarrantyResponseDto {
  return {
    id: warranty.id,
    warrantyNo: warranty.warrantyNo,
    deliveryId: warranty.deliveryId,
    delivery: warranty.delivery
      ? {
          id: warranty.delivery.id,
          title: warranty.delivery.title,
          version: warranty.delivery.version,
          deliveredAt: warranty.delivery.deliveredAt,
        }
      : null,
    projectId: warranty.projectId,
    project: warranty.project
      ? {
          id: warranty.project.id,
          name: warranty.project.name,
          customerId: warranty.project.customerId,
          customerName: warranty.project.customer ? warranty.project.customer.name : null,
        }
      : null,
    maContractId: warranty.maContractId ?? null,
    maContract: warranty.maContract
      ? {
          id: warranty.maContract.id,
          contractNo: warranty.maContract.contractNo,
          status: warranty.maContract.status,
          planCode: warranty.maContract.plan ? warranty.maContract.plan.code : null,
          planName: warranty.maContract.plan ? warranty.maContract.plan.name : null,
        }
      : null,
    durationMonth: warranty.durationMonth,
    startDate: warranty.startDate,
    endDate: warranty.endDate,
    status: warranty.status,
    isCurrentlyActive: isWarrantyCurrentlyActive(warranty, onDate),
    daysRemaining: daysUntil(warranty.endDate),
    scopeNote: warranty.scopeNote,
    attachments: attachments.map(toAttachmentSummary),
    attachmentCount,
    createdAt: warranty.createdAt,
    updatedAt: warranty.updatedAt,
  };
}

// ---- ข้อมูลสำหรับพิมพ์ใบรับประกัน ------------------------------------------------

export class WarrantyPrintWarrantyDto {
  @ApiProperty({ example: 4 })
  id: number;

  @ApiProperty({ nullable: true, example: 'WAR69-0008' })
  warrantyNo: string | null;

  @ApiProperty({ enum: WarrantyStatus })
  status: WarrantyStatus;

  @ApiProperty({ example: 12 })
  durationMonth: number;

  @ApiProperty({ description: 'วันถัดจากวันส่งมอบ', example: '2026-09-24' })
  startDate: string;

  @ApiProperty({ description: 'วันสุดท้ายที่ยังคุ้มครอง (นับรวม)', example: '2027-09-24' })
  endDate: string;

  @ApiProperty({ nullable: true, description: 'ขอบเขตที่คุ้มครอง (BR-07)' })
  scopeNote: string | null;

  @ApiProperty({ description: 'คุ้มครองอยู่ ณ วันที่พิมพ์ไหม — หน้าจอใช้ตัดสินลายน้ำ' })
  isCurrentlyActive: boolean;
}

export class WarrantyPrintDeliveryDto {
  @ApiProperty({ example: 5 })
  id: number;

  @ApiProperty({ nullable: true, example: 'DLV69-0003' })
  deliveryNo: string | null;

  @ApiProperty({ example: 'ส่งมอบระบบครบตามขอบเขต' })
  title: string;

  @ApiProperty({ nullable: true, example: 'v1.2.0' })
  version: string | null;

  @ApiProperty()
  deliveredAt: Date;

  @ApiProperty({ nullable: true })
  acceptedAt: Date | null;

  @ApiProperty({ nullable: true, example: 'คุณสมศรี ใจดี', description: 'ผู้รับมอบฝั่งลูกค้า' })
  acceptedByContactName: string | null;
}

export class WarrantyPrintProjectDto {
  @ApiProperty({ example: 3 })
  id: number;

  @ApiProperty({ nullable: true, example: 'PRJ69-0003' })
  code: string | null;

  @ApiProperty({ example: 'ระบบจัดการคลังสินค้า' })
  name: string;
}

export class WarrantyPrintCustomerDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ nullable: true, example: 'CUS69-0001' })
  code: string | null;

  @ApiProperty({ example: 'บริษัท ตัวอย่าง จำกัด' })
  name: string;

  @ApiProperty({ nullable: true })
  taxId: string | null;

  @ApiProperty({ nullable: true })
  address: string | null;

  @ApiProperty({ nullable: true })
  province: string | null;

  @ApiProperty({ nullable: true })
  postalCode: string | null;

  @ApiProperty({ nullable: true })
  phone: string | null;

  @ApiProperty({ nullable: true })
  email: string | null;
}

export class WarrantyPrintContactDto {
  @ApiProperty({ example: 'คุณสมศรี ใจดี' })
  name: string;

  @ApiProperty({ nullable: true })
  position: string | null;

  @ApiProperty({ nullable: true })
  phone: string | null;

  @ApiProperty({ nullable: true })
  email: string | null;
}

export class WarrantyPrintAttachHintDto {
  @ApiProperty({ example: 'WARRANTY' })
  refType: 'WARRANTY';

  @ApiProperty({ example: 4 })
  refId: number;

  @ApiProperty({ example: 'ใบรับประกัน WAR69-0008 ลูกค้าเซ็นแล้ว' })
  noteSuggestion: string;
}

/**
 * ใบรับประกันสำหรับพิมพ์ ("เหมือนซื้อตู้เย็นแล้วได้ใบประกัน" — ประชุมทบทวน 22–23 ก.ย.)
 *
 * backend ประกอบข้อมูล หน้าจอจัดหน้ากระดาษเอง (ข้อ 1 ของ CLAUDE.md — ไม่สร้าง HTML/PDF)
 * สัญญา MA ที่ผูกไว้เป็นการอ้างอิงเท่านั้น (Q14) จึงไม่มีราคาหรือโควตา
 */
export class WarrantyPrintDto {
  @ApiProperty()
  generatedAt: Date;

  @ApiProperty({ type: WarrantyPrintWarrantyDto })
  warranty: WarrantyPrintWarrantyDto;

  @ApiProperty({ type: WarrantyPrintDeliveryDto })
  delivery: WarrantyPrintDeliveryDto;

  @ApiProperty({ type: WarrantyPrintProjectDto })
  project: WarrantyPrintProjectDto;

  @ApiProperty({ type: WarrantyPrintCustomerDto })
  customer: WarrantyPrintCustomerDto;

  @ApiProperty({
    type: WarrantyPrintContactDto,
    nullable: true,
    description: 'ผู้ติดต่อหลักของลูกค้า — ไม่มีผู้ติดต่อหลักคืน null ไม่หยิบคนแรกมาแทน',
  })
  primaryContact: WarrantyPrintContactDto | null;

  @ApiProperty({ type: WarrantyMaContractSummaryDto, nullable: true })
  maContract: WarrantyMaContractSummaryDto | null;

  @ApiProperty({
    type: WarrantyPrintAttachHintDto,
    description: 'หลังลูกค้าเซ็น สแกนแนบกลับด้วย POST /api/attachments ตามค่านี้',
  })
  attachScanHint: WarrantyPrintAttachHintDto;
}

export function toWarrantyPrint(input: {
  warranty: Warranty;
  customer: Customer;
  onDate: string;
  generatedAt?: Date;
}): WarrantyPrintDto {
  const { warranty, customer, onDate } = input;
  const delivery = warranty.delivery;
  const project = warranty.project;
  const response = toWarrantyResponse(warranty, onDate);
  const primary = (customer.contacts ?? []).find((contact) => contact.isPrimary) ?? null;
  const label = warranty.warrantyNo ?? `#${warranty.id}`;

  return {
    generatedAt: input.generatedAt ?? new Date(),
    warranty: {
      id: warranty.id,
      warrantyNo: warranty.warrantyNo,
      status: warranty.status,
      durationMonth: warranty.durationMonth,
      startDate: warranty.startDate,
      endDate: warranty.endDate,
      scopeNote: warranty.scopeNote,
      isCurrentlyActive: response.isCurrentlyActive,
    },
    delivery: {
      id: delivery.id,
      deliveryNo: delivery.deliveryNo,
      title: delivery.title,
      version: delivery.version,
      deliveredAt: delivery.deliveredAt,
      acceptedAt: delivery.acceptedAt,
      acceptedByContactName: delivery.acceptedByContact ? delivery.acceptedByContact.name : null,
    },
    project: { id: project.id, code: project.code, name: project.name },
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
    maContract: response.maContract,
    attachScanHint: {
      refType: 'WARRANTY',
      refId: warranty.id,
      noteSuggestion: `ใบรับประกัน ${label} ลูกค้าเซ็นแล้ว`,
    },
  };
}
