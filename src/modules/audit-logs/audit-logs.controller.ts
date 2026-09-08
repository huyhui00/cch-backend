import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { RequireAccountType } from '../../common/decorators/require-account-type.decorator';
import { type PaginatedResult } from '../../common/dto/pagination.dto';
import { AccountType } from '../../models';
import { AuditLogsService } from './audit-logs.service';
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
      'ค่าในช่องรหัสผ่านถูกแทนที่ด้วย [REDACTED] เสมอ',
  })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: [AuditLogResponseDto] })
  @ApiResponse({ status: 400, description: 'พารามิเตอร์ค้นหาไม่ถูกต้อง' })
  @ApiResponse({ status: 401, description: 'ยังไม่ได้เข้าสู่ระบบ' })
  @ApiResponse({ status: 403, description: 'เฉพาะผู้ดูแลระบบเท่านั้นที่เข้าถึงส่วนนี้ได้' })
  findAll(@Query() query: QueryAuditLogsDto): Promise<PaginatedResult<AuditLogResponseDto>> {
    return this.auditLogsService.findAll(query);
  }
}
