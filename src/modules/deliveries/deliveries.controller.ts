import { Body, Controller, Get, Param, ParseIntPipe, Patch, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { DeliveriesService } from './deliveries.service';
import { UpdateAcceptanceDto, UpdateDeliveryDto } from './dto/delivery.dto';
import { DeliveryResponseDto } from './dto/delivery.response';

/**
 * ใบส่งมอบรายใบ — ดู แก้ไข และบันทึกผลการตรวจรับ
 *
 * ไม่มี DELETE โดยเจตนา ด้วยเหตุผลเดียวกับโครงการ — ใบส่งมอบเป็นจุดตั้งต้นของประกัน
 * ถ้าลบได้ ประกันที่ออกไปแล้วจะไร้ที่มา ใบที่บันทึกผิดให้แก้ไขหรือใส่หมายเหตุแทน
 */
@ApiTags('deliveries')
@ApiBearerAuth('access-token')
@Controller('deliveries')
export class DeliveriesController {
  constructor(private readonly deliveriesService: DeliveriesService) {}

  @Get(':id')
  @RequirePermission('delivery.view')
  @ApiOperation({
    summary: 'รายละเอียดการส่งมอบ',
    description:
      'คืนประกันที่ออกจากใบนี้และไฟล์แนบ (ref_type = DELIVERY) มาด้วย — ' +
      'การอัปโหลดไฟล์เป็นของโมดูล Files ใน Phase 9 ตอนนี้จึงอ่านได้อย่างเดียว',
  })
  @ApiParam({ name: 'id', description: 'id ของใบส่งมอบ', example: 5 })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: DeliveryResponseDto })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  @ApiResponse({ status: 404, description: 'ไม่พบข้อมูลการส่งมอบ' })
  findOne(@Param('id', ParseIntPipe) id: number): Promise<DeliveryResponseDto> {
    return this.deliveriesService.findOne(id);
  }

  @Put(':id')
  @RequirePermission('delivery.update')
  @ApiOperation({
    summary: 'แก้ไขรายละเอียดการส่งมอบ',
    description:
      'แก้ deliveredAt แล้วประกันทุกใบที่ออกจากใบส่งมอบนี้จะถูกขยับวันเริ่มและวันสิ้นสุด ' +
      'ตามให้อัตโนมัติในทรานแซกชันเดียวกัน เพราะระยะประกันนับจากวันส่งมอบ (BR-06) ' +
      'ย้ายใบส่งมอบข้ามโครงการไม่ได้ และเปลี่ยนสถานะการตรวจรับที่นี่ไม่ได้',
  })
  @ApiParam({ name: 'id', description: 'id ของใบส่งมอบ', example: 5 })
  @ApiResponse({ status: 200, description: 'บันทึกการแก้ไขเรียบร้อย', type: DeliveryResponseDto })
  @ApiResponse({ status: 400, description: 'ข้อมูลไม่ถูกต้อง หรือวันที่ส่งมอบเป็นอนาคต' })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  @ApiResponse({ status: 404, description: 'ไม่พบข้อมูลการส่งมอบ' })
  @ApiResponse({ status: 409, description: 'เลขที่ใบส่งมอบนี้ถูกใช้ไปแล้ว' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDeliveryDto,
  ): Promise<{ data: DeliveryResponseDto; message: string }> {
    return {
      data: await this.deliveriesService.update(id, dto),
      message: 'บันทึกการแก้ไขเรียบร้อย',
    };
  }

  @Patch(':id/acceptance')
  @RequirePermission('delivery.accept')
  @ApiOperation({
    summary: 'บันทึกผลการตรวจรับ',
    description:
      'PENDING -> ACCEPTED หรือ REJECTED และถอยกลับได้ ไม่บังคับลำดับ ' +
      'เพราะของจริงถอยได้ เช่นตรวจรับไปแล้วเพิ่งพบว่าใช้งานไม่ได้ ' +
      'เป็น ACCEPTED แล้วระบบใส่ acceptedAt ให้เอง ถอยออกแล้วล้างค่า ' +
      'และตรวจรับซ้ำไม่ทับเวลาเดิม สัญญาที่เซ็นมือแล้วให้สแกนแนบเป็นไฟล์ (BR-12)',
  })
  @ApiParam({ name: 'id', description: 'id ของใบส่งมอบ', example: 5 })
  @ApiResponse({
    status: 200,
    description: 'บันทึกผลการตรวจรับเรียบร้อย',
    type: DeliveryResponseDto,
  })
  @ApiResponse({ status: 400, description: 'ระบุผู้รับมอบที่ไม่ได้อยู่ใต้ลูกค้าเจ้าของโครงการ' })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  @ApiResponse({ status: 404, description: 'ไม่พบข้อมูลการส่งมอบ' })
  async updateAcceptance(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAcceptanceDto,
  ): Promise<{ data: DeliveryResponseDto; message: string }> {
    return {
      data: await this.deliveriesService.updateAcceptance(id, dto),
      message: 'บันทึกผลการตรวจรับเรียบร้อย',
    };
  }
}
