import { ApiProperty } from '@nestjs/swagger';

import { daysUntil } from '../../../common/utils/date.util';
import { MaContractStatus, Warranty, WarrantyStatus } from '../../../models';

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

  @ApiProperty({ nullable: true, example: 'MA-2026-001' })
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

  @ApiProperty({ nullable: true, example: 'WAR-2026-001' })
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

  @ApiProperty({ nullable: true, example: 'WAR-2026-001' })
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
      'เพราะยังไม่มีตัวปรับ status เป็น EXPIRED อัตโนมัติจนกว่าจะถึง Phase 11',
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

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

/**
 * ยังอยู่ในระยะประกันจริงหรือไม่ ณ วันที่กำหนด
 *
 * ต้องดูทั้งสถานะที่บันทึกไว้และช่วงวันที่ เพราะยังไม่มี scheduler มาปรับ status
 * เป็น EXPIRED ให้อัตโนมัติ (จะมาตอน Phase 11) ถ้าเชื่อ status อย่างเดียว
 * ประกันที่หมดอายุไปแล้วจะยังขึ้นว่า ACTIVE อยู่ตลอดไป
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

export function toWarrantyResponse(warranty: Warranty, onDate: string): WarrantyResponseDto {
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
    createdAt: warranty.createdAt,
    updatedAt: warranty.updatedAt,
  };
}
