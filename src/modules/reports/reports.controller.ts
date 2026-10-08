import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import {
  QueryContractValueDto,
  QueryOverlapDto,
  QueryServiceCostDto,
  ReportPeriodDto,
} from './dto/report.dto';
import {
  ContractOverlapReportDto,
  ContractValueByCustomerDto,
  ContractValueByTypeDto,
  CustomerOverviewDto,
  ServiceCostReportDto,
  UpcomingContractValueDto,
} from './dto/report.response';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@ApiBearerAuth('access-token')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('contract-value/by-customer')
  @RequirePermission('report.view')
  @ApiOperation({
    summary: 'M10-01 / M10-03 — มูลค่าตามสัญญาแยกรายลูกค้า และจัดอันดับ',
    description:
      'เรียงจากมูลค่ามากไปน้อย ใส่ ?limit=10 เพื่อทำหน้าจอจัดอันดับ (M10-03) — ' +
      'รายการที่ยกเลิกไม่ถูกนับในยอดหลัก แต่แยกแสดงที่ excludedCancelledValue ' +
      'และแต่ละแถวมี overlappingContractCount เตือนว่ายอดอาจนับซ้ำ (Q4)',
  })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: ContractValueByCustomerDto })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  contractValueByCustomer(
    @Query() query: QueryContractValueDto,
  ): Promise<ContractValueByCustomerDto> {
    return this.reportsService.contractValueByCustomer(query);
  }

  @Get('contract-value/by-type')
  @RequirePermission('report.view')
  @ApiOperation({
    summary: 'M10-02 — มูลค่าตามสัญญาแยกตามประเภท',
    description:
      'แยกเป็นโครงการ / สัญญา MA / ของเสริม / ค่าบริการรายครั้ง — ' +
      'ใบรายครั้งที่ยังไม่กรอกค่าบริการ **ไม่ได้ถูกนับเป็น 0** แต่กันออกจากยอดรวม ' +
      'แล้วรายงานความครบถ้วนที่ oneTimeCompleteness แทน',
  })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: ContractValueByTypeDto })
  contractValueByType(@Query() query: ReportPeriodDto): Promise<ContractValueByTypeDto> {
    return this.reportsService.contractValueByType(query);
  }

  @Get('contract-value/upcoming')
  @RequirePermission('report.view')
  @ApiOperation({
    summary: 'M10-04 — มูลค่าตามสัญญาจากสัญญาที่ยังไม่หมดอายุ',
    description:
      'นับเฉพาะสัญญาที่ยังคุ้มครองอยู่จริง ณ วันนี้ — สถานะ ACTIVE **และ** อยู่ในช่วงวันที่ ' +
      'ไม่ได้เชื่อ status อย่างเดียว เพราะยังไม่มี scheduler ปรับเป็น EXPIRED ให้ (มาตอน M11)',
  })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: UpcomingContractValueDto })
  upcomingContractValue(): Promise<UpcomingContractValueDto> {
    return this.reportsService.upcomingContractValue();
  }

  @Get('service-cost')
  @RequirePermission('report.view')
  @ApiOperation({
    summary: 'M10-05 — ต้นทุนการให้บริการต่อลูกค้า',
    description:
      'คิดจาก ticket_resolutions.hours_spent ซึ่งกรอกหรือไม่กรอกก็ได้ — ' +
      '**รอบที่ไม่ได้กรอกเวลาไม่ถูกนับเป็น 0 ชั่วโมง** แต่กันออกจากยอดรวมแล้วรายงานที่ ' +
      'completeness (total / withData / withoutData / completeness) ให้อ่านคู่กันเสมอ',
  })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: ServiceCostReportDto })
  serviceCost(@Query() query: QueryServiceCostDto): Promise<ServiceCostReportDto> {
    return this.reportsService.serviceCost(query);
  }

  @Get('ma-contract-overlaps')
  @RequirePermission('report.view')
  @ApiOperation({
    summary: 'ตรวจสัญญา MA ที่ช่วงเวลาซ้อนทับกัน (รายลูกค้า)',
    description:
      '**ตรวจจับและรายงานเท่านั้น** ระบบไม่แก้ ไม่ลบ ไม่รวม และไม่เลือกสัญญาใดแทน ' +
      'เพราะ Q4 ยังไม่มีข้อสรุปว่า 1 ลูกค้ามีสัญญาที่ยังไม่หมดอายุพร้อมกันหลายฉบับได้ไหม — ' +
      'ใช้ตรวจก่อนเชื่อยอดรวมมูลค่าตามสัญญา เพราะสัญญาซ้อนกันทำให้ยอดนับซ้ำได้',
  })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: ContractOverlapReportDto })
  contractOverlaps(@Query() query: QueryOverlapDto): Promise<ContractOverlapReportDto> {
    return this.reportsService.contractOverlaps(query);
  }
}

@ApiTags('reports')
@ApiBearerAuth('access-token')
@Controller('customers')
export class CustomerOverviewController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get(':id/overview')
  @RequirePermission('customer.view')
  @ApiOperation({
    summary: 'M1-05 — มุมมองลูกค้า 360 องศา พร้อม M1-06 มูลค่ารวมตลอดอายุ',
    description:
      'รวมโครงการ ประกัน สัญญา MA ใบแจ้งปัญหา และงานติดตามของลูกค้ารายเดียวในครั้งเดียว ' +
      'พร้อม lifetimeValue ซึ่งเป็น **มูลค่ารวมตามสัญญา ไม่ใช่เงินที่ลูกค้าจ่ายจริง** — ' +
      'รายการที่ยกเลิกถูกตัดออกจากยอดหลัก แต่แยกแสดงที่ excludedCancelledValue ' +
      'เพื่อให้ตรวจย้อนหลังได้',
  })
  @ApiParam({ name: 'id', description: 'id ของลูกค้า', example: 1 })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: CustomerOverviewDto })
  @ApiResponse({ status: 404, description: 'ไม่พบข้อมูลลูกค้า' })
  overview(@Param('id', ParseIntPipe) id: number): Promise<CustomerOverviewDto> {
    return this.reportsService.customerOverview(id);
  }
}
