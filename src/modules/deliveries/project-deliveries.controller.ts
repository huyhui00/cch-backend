import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { type PaginatedResult } from '../../common/dto/pagination.dto';
import { DeliveriesService } from './deliveries.service';
import { CreateDeliveryDto, QueryDeliveriesDto } from './dto/delivery.dto';
import { DeliveryResponseDto } from './dto/delivery.response';

@ApiTags('deliveries')
@ApiBearerAuth('access-token')
@Controller('projects/:projectId/deliveries')
export class ProjectDeliveriesController {
  constructor(private readonly deliveriesService: DeliveriesService) {}

  @Get()
  @RequirePermission('delivery.view')
  @ApiOperation({
    summary: 'ประวัติการส่งมอบของโครงการ',
    description:
      'เรียงจากวันที่ส่งมอบล่าสุดลงไปเป็นค่าเริ่มต้น เพราะคำถามแรกของหน้าจอคือ ' +
      '"เวอร์ชันล่าสุดคืออะไร" — ไม่เรียงด้วย version เพราะเก็บเป็นข้อความอิสระ ' +
      'เรียงแบบพจนานุกรมแล้วจะได้ v10 มาก่อน v2 ซึ่งผิดจากที่คนคาดหวัง',
  })
  @ApiParam({ name: 'projectId', description: 'id ของโครงการ', example: 1 })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: [DeliveryResponseDto] })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  @ApiResponse({ status: 404, description: 'ไม่พบข้อมูลโครงการ' })
  findAll(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Query() query: QueryDeliveriesDto,
  ): Promise<PaginatedResult<DeliveryResponseDto>> {
    return this.deliveriesService.findAllByProject(projectId, query);
  }

  @Post()
  @RequirePermission('delivery.create')
  @ApiOperation({
    summary: 'บันทึกการส่งมอบ',
    description:
      'deliveredAt เป็นจุดตั้งต้นของระยะประกันทั้งหมด (BR-06) บันทึกย้อนหลังได้ ' +
      'แต่ลงวันที่ในอนาคตไม่ได้ เพราะจะทำให้ประกันเริ่มในอนาคตตามไปด้วย ' +
      'ใบใหม่เริ่มที่สถานะ PENDING เสมอ การตรวจรับทำผ่าน PATCH /api/deliveries/:id/acceptance',
  })
  @ApiParam({ name: 'projectId', description: 'id ของโครงการ', example: 1 })
  @ApiResponse({ status: 201, description: 'บันทึกการส่งมอบเรียบร้อย', type: DeliveryResponseDto })
  @ApiResponse({
    status: 400,
    description: 'ข้อมูลไม่ถูกต้อง วันที่ส่งมอบเป็นอนาคต หรือระบุผู้รับมอบของลูกค้ารายอื่น',
  })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  @ApiResponse({ status: 404, description: 'ไม่พบข้อมูลโครงการ' })
  @ApiResponse({ status: 409, description: 'เลขที่ใบส่งมอบนี้ถูกใช้ไปแล้ว' })
  async create(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() dto: CreateDeliveryDto,
  ): Promise<{ data: DeliveryResponseDto; message: string }> {
    return {
      data: await this.deliveriesService.create(projectId, dto),
      message: 'บันทึกการส่งมอบเรียบร้อย',
    };
  }
}
