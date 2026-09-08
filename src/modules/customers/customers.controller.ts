import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { type PaginatedResult } from '../../common/dto/pagination.dto';
import { CustomersService } from './customers.service';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/create-customer.dto';
import { CustomerResponseDto } from './dto/customer.response';
import { QueryCustomersDto } from './dto/query-customers.dto';

/**
 * ฐานข้อมูลลูกค้ากลางของบริษัท — ปัญหาข้อแรกที่ผู้บริหารยกมาในการประชุม
 * "ข้อมูลลูกค้าผูกติดกับตัวบุคคล พนักงานลาออกแล้วข้อมูลสูญหาย"
 *
 * ลูกค้าไม่มีบัญชีผู้ใช้และไม่เข้าระบบ (BR-01) ทุก endpoint ในนี้จึงเป็นการใช้งาน
 * โดยพนักงานภายในเท่านั้น
 */
@ApiTags('customers')
@ApiBearerAuth('access-token')
@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  @RequirePermission('customer.view')
  @ApiOperation({
    summary: 'รายการลูกค้า',
    description:
      'กรองตามสถานะ ผู้ดูแล ประเภทธุรกิจ หรือจังหวัดได้ ' +
      'ส่ง idleDays เพื่อดูเฉพาะลูกค้าที่ไม่ได้ติดต่อมานานเกินกำหนด (รวมคนที่ยังไม่เคยติดต่อเลย) ' +
      'ทุกรายการคืน daysSinceLastContact มาให้พร้อมใช้',
  })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: [CustomerResponseDto] })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  findAll(@Query() query: QueryCustomersDto): Promise<PaginatedResult<CustomerResponseDto>> {
    return this.customersService.findAll(query);
  }

  @Get(':id')
  @RequirePermission('customer.view')
  @ApiOperation({
    summary: 'ข้อมูลลูกค้ารายเดียว',
    description: 'คืนผู้ติดต่อทั้งหมดมาด้วย โดยเรียงผู้ติดต่อหลักขึ้นก่อนเสมอ',
  })
  @ApiParam({ name: 'id', description: 'id ของลูกค้า', example: 1 })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: CustomerResponseDto })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  @ApiResponse({ status: 404, description: 'ไม่พบข้อมูลลูกค้า' })
  findOne(@Param('id', ParseIntPipe) id: number): Promise<CustomerResponseDto> {
    return this.customersService.findOne(id);
  }

  @Post()
  @RequirePermission('customer.create')
  @ApiOperation({ summary: 'เพิ่มลูกค้า' })
  @ApiResponse({ status: 201, description: 'เพิ่มลูกค้าเรียบร้อย', type: CustomerResponseDto })
  @ApiResponse({ status: 400, description: 'ข้อมูลไม่ถูกต้อง หรือระบุผู้ดูแลที่ใช้ไม่ได้' })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  @ApiResponse({ status: 409, description: 'รหัสลูกค้านี้ถูกใช้ไปแล้ว' })
  async create(
    @Body() dto: CreateCustomerDto,
    @CurrentUser('id') actorId: number,
  ): Promise<{ data: CustomerResponseDto; message: string }> {
    return {
      data: await this.customersService.create(dto, actorId),
      message: 'เพิ่มลูกค้าเรียบร้อย',
    };
  }

  @Put(':id')
  @RequirePermission('customer.update')
  @ApiOperation({
    summary: 'แก้ไขข้อมูลลูกค้า',
    description:
      'เปลี่ยนผู้ดูแลได้โดยประวัติทั้งหมดยังอยู่ครบ ' +
      'ส่วน lastContactedAt แก้ผ่าน endpoint นี้ไม่ได้ ระบบอัปเดตให้เองตอนบันทึกการติดต่อ',
  })
  @ApiParam({ name: 'id', description: 'id ของลูกค้า', example: 1 })
  @ApiResponse({ status: 200, description: 'บันทึกการแก้ไขเรียบร้อย', type: CustomerResponseDto })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  @ApiResponse({ status: 404, description: 'ไม่พบข้อมูลลูกค้า' })
  @ApiResponse({ status: 409, description: 'รหัสลูกค้านี้ถูกใช้ไปแล้ว' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCustomerDto,
    @CurrentUser('id') actorId: number,
  ): Promise<{ data: CustomerResponseDto; message: string }> {
    return {
      data: await this.customersService.update(id, dto, actorId),
      message: 'บันทึกการแก้ไขเรียบร้อย',
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('customer.delete')
  @ApiOperation({
    summary: 'ลบลูกค้า',
    description:
      'เป็น soft delete และลบผู้ติดต่อกับบันทึกการติดต่อตามไปด้วย ' +
      'ลบไม่ได้ถ้ามีโครงการหรือใบแจ้งปัญหาผูกอยู่ — กรณีนั้นให้เปลี่ยนสถานะเป็น CHURNED แทน',
  })
  @ApiParam({ name: 'id', description: 'id ของลูกค้า', example: 1 })
  @ApiResponse({ status: 200, description: 'ลบลูกค้าเรียบร้อย' })
  @ApiResponse({ status: 400, description: 'มีโครงการหรือใบแจ้งปัญหาผูกอยู่ จึงลบไม่ได้' })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  @ApiResponse({ status: 404, description: 'ไม่พบข้อมูลลูกค้า' })
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('id') actorId: number,
  ): Promise<{ data: null; message: string }> {
    await this.customersService.remove(id, actorId);
    return { data: null, message: 'ลบลูกค้าเรียบร้อย' };
  }
}
