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
import { ContactsService } from './contacts.service';
import { CreateContactDto, QueryContactsDto, UpdateContactDto } from './dto/contact.dto';
import { ContactResponseDto } from './dto/customer.response';

/**
 * ผู้ติดต่อฝั่งลูกค้า — 1 ลูกค้ามีได้หลายคน แต่ผู้ติดต่อหลักมีได้คนเดียว
 * เป็นแค่ข้อมูลติดต่อ ไม่ใช่บัญชีผู้ใช้ ลูกค้าเข้าระบบไม่ได้ (BR-01)
 */
@ApiTags('contacts')
@ApiBearerAuth('access-token')
@Controller('contacts')
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Get()
  @RequirePermission('contact.view')
  @ApiOperation({
    summary: 'รายการผู้ติดต่อ',
    description:
      'ส่ง customerId เพื่อดูเฉพาะผู้ติดต่อของลูกค้ารายนั้น ' +
      'ผลลัพธ์เรียงผู้ติดต่อหลักขึ้นก่อนเสมอ',
  })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: [ContactResponseDto] })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  findAll(@Query() query: QueryContactsDto): Promise<PaginatedResult<ContactResponseDto>> {
    return this.contactsService.findAll(query);
  }

  @Post()
  @RequirePermission('contact.create')
  @ApiOperation({
    summary: 'เพิ่มผู้ติดต่อ',
    description: 'ถ้าตั้ง isPrimary เป็น true ระบบจะถอดผู้ติดต่อหลักคนเดิมออกให้อัตโนมัติ',
  })
  @ApiResponse({ status: 201, description: 'เพิ่มผู้ติดต่อเรียบร้อย', type: ContactResponseDto })
  @ApiResponse({ status: 400, description: 'ข้อมูลไม่ถูกต้อง' })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  @ApiResponse({ status: 404, description: 'ไม่พบข้อมูลลูกค้า' })
  async create(
    @Body() dto: CreateContactDto,
    @CurrentUser('id') actorId: number,
  ): Promise<{ data: ContactResponseDto; message: string }> {
    return {
      data: await this.contactsService.create(dto, actorId),
      message: 'เพิ่มผู้ติดต่อเรียบร้อย',
    };
  }

  @Put(':id')
  @RequirePermission('contact.update')
  @ApiOperation({
    summary: 'แก้ไขผู้ติดต่อ',
    description: 'ย้ายผู้ติดต่อไปลูกค้ารายอื่นไม่ได้ ถ้าคนเดิมย้ายบริษัทให้สร้างรายการใหม่',
  })
  @ApiParam({ name: 'id', description: 'id ของผู้ติดต่อ', example: 2 })
  @ApiResponse({ status: 200, description: 'บันทึกการแก้ไขเรียบร้อย', type: ContactResponseDto })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  @ApiResponse({ status: 404, description: 'ไม่พบข้อมูลผู้ติดต่อ' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateContactDto,
    @CurrentUser('id') actorId: number,
  ): Promise<{ data: ContactResponseDto; message: string }> {
    return {
      data: await this.contactsService.update(id, dto, actorId),
      message: 'บันทึกการแก้ไขเรียบร้อย',
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('contact.delete')
  @ApiOperation({
    summary: 'ลบผู้ติดต่อ',
    description: 'เป็น soft delete ลบไม่ได้ถ้ายังถูกอ้างอิงอยู่ในบันทึกการติดต่อ',
  })
  @ApiParam({ name: 'id', description: 'id ของผู้ติดต่อ', example: 2 })
  @ApiResponse({ status: 200, description: 'ลบผู้ติดต่อเรียบร้อย' })
  @ApiResponse({ status: 400, description: 'ยังถูกอ้างอิงในบันทึกการติดต่อ จึงลบไม่ได้' })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  @ApiResponse({ status: 404, description: 'ไม่พบข้อมูลผู้ติดต่อ' })
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('id') actorId: number,
  ): Promise<{ data: null; message: string }> {
    await this.contactsService.remove(id, actorId);
    return { data: null, message: 'ลบผู้ติดต่อเรียบร้อย' };
  }
}
