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
import { CreateRoleDto, UpdateRoleDto } from './dto/create-role.dto';
import { QueryRolesDto } from './dto/query-roles.dto';
import { RoleDetailDto } from './dto/role.response';
import { SetRolePermissionsDto } from './dto/set-role-permissions.dto';
import { RolesService } from './roles.service';

/**
 * ทุก endpoint ในนี้ต้องเป็น SUPER_ADMIN เท่านั้น (BR-10)
 *
 * ประกาศ RequirePermission('role.manage') ไว้ที่ระดับ class — PermissionsGuard
 * ตัดทุกคนที่ไม่ใช่ SUPER_ADMIN ทิ้งเมื่อเจอ code นี้ ต่อให้เป็น ADMIN
 * หรือมีบทบาทที่ถูกติ๊ก role.manage ไว้ก็ไม่ผ่าน
 */
@ApiTags('roles')
@ApiBearerAuth('access-token')
@RequirePermission('role.manage')
@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  @ApiOperation({
    summary: 'รายการบทบาททั้งหมด',
    description: 'คืนสิทธิ์ที่ติ๊กไว้และจำนวนผู้ใช้ที่ถือบทบาทนั้นมาพร้อมกันในแต่ละรายการ',
  })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: [RoleDetailDto] })
  @ApiResponse({ status: 403, description: 'เฉพาะผู้ดูแลระบบสูงสุดเท่านั้นที่จัดการส่วนนี้ได้' })
  findAll(@Query() query: QueryRolesDto): Promise<PaginatedResult<RoleDetailDto>> {
    return this.rolesService.findAll(query);
  }

  @Post()
  @ApiOperation({
    summary: 'สร้างบทบาทใหม่',
    description: 'ส่ง permissionIds มาด้วยเพื่อติ๊กสิทธิ์ตั้งแต่ตอนสร้าง',
  })
  @ApiResponse({ status: 201, description: 'สร้างบทบาทเรียบร้อย', type: RoleDetailDto })
  @ApiResponse({ status: 400, description: 'ข้อมูลไม่ถูกต้อง หรือระบุสิทธิ์ที่ไม่มีอยู่จริง' })
  @ApiResponse({ status: 403, description: 'เฉพาะผู้ดูแลระบบสูงสุดเท่านั้นที่จัดการส่วนนี้ได้' })
  @ApiResponse({ status: 409, description: 'มีบทบาทชื่อนี้อยู่แล้ว' })
  async create(
    @Body() dto: CreateRoleDto,
    @CurrentUser('id') actorId: number,
  ): Promise<{ data: RoleDetailDto; message: string }> {
    return { data: await this.rolesService.create(dto, actorId), message: 'สร้างบทบาทเรียบร้อย' };
  }

  @Put(':id')
  @ApiOperation({ summary: 'แก้ไขบทบาท' })
  @ApiParam({ name: 'id', description: 'id ของบทบาท', example: 3 })
  @ApiResponse({ status: 200, description: 'บันทึกการแก้ไขเรียบร้อย', type: RoleDetailDto })
  @ApiResponse({ status: 403, description: 'เฉพาะผู้ดูแลระบบสูงสุดเท่านั้นที่จัดการส่วนนี้ได้' })
  @ApiResponse({ status: 404, description: 'ไม่พบข้อมูลบทบาท' })
  @ApiResponse({ status: 409, description: 'มีบทบาทชื่อนี้อยู่แล้ว' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateRoleDto,
    @CurrentUser('id') actorId: number,
  ): Promise<{ data: RoleDetailDto; message: string }> {
    return {
      data: await this.rolesService.update(id, dto, actorId),
      message: 'บันทึกการแก้ไขเรียบร้อย',
    };
  }

  @Put(':id/permissions')
  @ApiOperation({
    summary: 'ติ๊กสิทธิ์ให้บทบาท',
    description:
      'permissionIds ที่ส่งมาแทนที่สิทธิ์เดิมทั้งชุด ส่ง array ว่างเพื่อถอดสิทธิ์ออกทั้งหมด ' +
      'สิทธิ์ role.manage ติ๊กไม่ได้เพราะผูกกับระดับบัญชี ไม่ใช่บทบาท (BR-10)',
  })
  @ApiParam({ name: 'id', description: 'id ของบทบาท', example: 3 })
  @ApiResponse({ status: 200, description: 'บันทึกสิทธิ์เรียบร้อย', type: RoleDetailDto })
  @ApiResponse({
    status: 400,
    description: 'ระบุสิทธิ์ที่ไม่มีอยู่จริง หรือสิทธิ์ที่ติ๊กให้บทบาทไม่ได้',
  })
  @ApiResponse({ status: 403, description: 'เฉพาะผู้ดูแลระบบสูงสุดเท่านั้นที่จัดการส่วนนี้ได้' })
  @ApiResponse({ status: 404, description: 'ไม่พบข้อมูลบทบาท' })
  async setPermissions(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetRolePermissionsDto,
    @CurrentUser('id') actorId: number,
  ): Promise<{ data: RoleDetailDto; message: string }> {
    return {
      data: await this.rolesService.setPermissions(id, dto, actorId),
      message: 'บันทึกสิทธิ์เรียบร้อย',
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'ลบบทบาท',
    description:
      'เป็น soft delete ลบไม่ได้ถ้าเป็นบทบาทของระบบ หรือยังมีผู้ใช้ถืออยู่ ' +
      'การลบบทบาทไม่กระทบสถานะของผู้ใช้ (CLAUDE.md 4.3)',
  })
  @ApiParam({ name: 'id', description: 'id ของบทบาท', example: 3 })
  @ApiResponse({ status: 200, description: 'ลบบทบาทเรียบร้อย' })
  @ApiResponse({ status: 400, description: 'เป็นบทบาทของระบบ หรือยังมีผู้ใช้ถือบทบาทนี้อยู่' })
  @ApiResponse({ status: 403, description: 'เฉพาะผู้ดูแลระบบสูงสุดเท่านั้นที่จัดการส่วนนี้ได้' })
  @ApiResponse({ status: 404, description: 'ไม่พบข้อมูลบทบาท' })
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('id') actorId: number,
  ): Promise<{ data: null; message: string }> {
    await this.rolesService.remove(id, actorId);
    return { data: null, message: 'ลบบทบาทเรียบร้อย' };
  }
}
