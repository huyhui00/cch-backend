import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { RequireAccountType } from '../../common/decorators/require-account-type.decorator';
import { AccountType } from '../../models';
import { type AuditLogPage, AuditLogsService } from './audit-logs.service';
import { AuditLogResponseDto } from './dto/audit-log.response';
import { QueryAuditLogsDto } from './dto/query-audit-logs.dto';

/**
 * อ่านอย่างเดียว ไม่มี POST / PUT / DELETE โดยเจตนา
 * audit log ที่แก้ไขหรือลบได้ก็ไม่ใช่ audit log
 *
 * จำกัดที่ระดับบัญชี ไม่ใช่ที่สิทธิ์ที่ติ๊กได้ — ผู้ใช้ระดับ USER จึงเข้าไม่ได้
 * ไม่ว่าจะถูกติ๊กสิทธิ์อะไรให้ก็ตาม
 */
@ApiTags('audit-logs')
@ApiBearerAuth('access-token')
@RequireAccountType(AccountType.ADMIN)
@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  @Get()
  @ApiOperation({
    summary: 'ประวัติการใช้งานระบบ',
    description:
      'บันทึกทุก action ที่เขียนลงฐานข้อมูล พร้อมผู้กระทำ ค่าก่อนและหลังแก้ไข (BR-09) ' +
      'ดูประวัติของข้อมูลชิ้นเดียวได้โดยส่ง tableName คู่กับ recordId ' +
      'ค่าในช่องรหัสผ่านถูกแทนที่ด้วย [REDACTED] เสมอ · ' +
      'แต่ละแถวมี `summary` (ประโยคภาษาไทย) และ `changes` (ฟิลด์ที่เปลี่ยนพร้อมชื่อ/ค่าภาษาไทย) ให้แสดงแทนค่าดิบ ' +
      '`summary` ขึ้นต้นด้วยกริยาเสมอ หน้าจอวางชื่อผู้กระทำไว้ข้างหน้าได้เลย ' +
      'ซ่อนการล็อกอินด้วย `hideSessionEvents=true` ซ่อนงานอัตโนมัติของระบบด้วย `hideSystemEvents=true` ' +
      'และซ่อนตารางด้วย `excludeTableNames=notifications` · ' +
      'เลื่อนแล้วโหลดต่อ: หน้าแรกขอแบบปกติ แล้วส่ง `cursor=<nextCursor>` ไปเรื่อย ๆ จน `hasMore=false` ' +
      '(แบบ cursor ไม่นับ total จึงเร็วคงที่แม้ประวัติมีเป็นล้านแถว และไม่ซ้ำ/ไม่หลุดเมื่อมีประวัติใหม่เข้ามาระหว่างเลื่อน)',
  })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: [AuditLogResponseDto] })
  @ApiResponse({ status: 400, description: 'พารามิเตอร์ค้นหาไม่ถูกต้อง' })
  @ApiResponse({ status: 401, description: 'ยังไม่ได้เข้าสู่ระบบ' })
  @ApiResponse({ status: 403, description: 'เฉพาะผู้ดูแลระบบเท่านั้นที่เข้าถึงส่วนนี้ได้' })
  findAll(@Query() query: QueryAuditLogsDto): Promise<AuditLogPage> {
    return this.auditLogsService.findAll(query);
  }
}
