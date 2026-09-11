import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { type PaginatedResult } from '../../common/dto/pagination.dto';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { CreateUserDto, UpdateUserDto } from './dto/create-user.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import { AssignRolesDto, ChangePasswordDto, UpdateUserStatusDto } from './dto/user-actions.dto';
import { AssignableUserDto, UserResponseDto } from './dto/user.response';
import { UsersService } from './users.service';

/**
 * ไม่มี DELETE โดยเจตนา — ห้ามลบผู้ใช้ทิ้งเพราะ audit log ต้องอ้างอิงย้อนหลังได้ (BR-09)
 * พนักงานที่ออกแล้วให้เปลี่ยนสถานะเป็น RESIGNED ผ่าน PATCH /api/users/:id/status แทน
 */
@ApiTags('users')
@ApiBearerAuth('access-token')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * ประกาศไว้ก่อน :id ทุกเส้น เพื่อไม่ให้คำว่า "me" ถูกจับเป็นค่าของ :id
   * ในกรณีที่มีการเพิ่ม endpoint อื่นใต้ /users/:id ภายหลัง
   */
  @Patch('me/password')
  @ApiOperation({
    summary: 'เปลี่ยนรหัสผ่านของตนเอง',
    description:
      'ต้องยืนยันรหัสผ่านปัจจุบันก่อนเสมอ เมื่อเปลี่ยนสำเร็จ refresh token ทุกอุปกรณ์จะถูกยกเลิก ' +
      'ผู้ใช้ต้องเข้าสู่ระบบใหม่',
  })
  @ApiResponse({ status: 200, description: 'เปลี่ยนรหัสผ่านเรียบร้อย' })
  @ApiResponse({
    status: 400,
    description: 'รหัสผ่านปัจจุบันไม่ถูกต้อง หรือรหัสผ่านใหม่ซ้ำกับเดิม',
  })
  @ApiResponse({ status: 401, description: 'ยังไม่ได้เข้าสู่ระบบ' })
  async changeOwnPassword(
    @CurrentUser('id') userId: number,
    @Body() dto: ChangePasswordDto,
  ): Promise<{ data: null; message: string }> {
    await this.usersService.changeOwnPassword(userId, dto);
    return { data: null, message: 'เปลี่ยนรหัสผ่านเรียบร้อย กรุณาเข้าสู่ระบบใหม่' };
  }

  /**
   * ไม่ติด @RequirePermission โดยเจตนา — ล็อกอินแล้วเรียกได้ทุกคน
   *
   * คนที่มีสิทธิ์มอบหมายงาน (ticket.assign, task.assign) มักไม่มี user.view
   * ถ้ากั้นด้วย user.view ดรอปดาวน์ "มอบหมายให้ใคร" จะว่างเปล่าสำหรับพนักงาน support
   * ทั้งทีม ข้อมูลที่คืนคือชื่อเพื่อนร่วมงานซึ่งเห็นได้อยู่แล้วทั่วทั้งระบบ
   * (ชื่อผู้รับผิดชอบบนใบงาน ใบแจ้งปัญหา โครงการ) จึงไม่ได้เปิดเผยอะไรใหม่
   * และลูกค้าไม่มีบัญชีผู้ใช้อยู่แล้ว (BR-01) คนที่ล็อกอินได้จึงเป็นพนักงานเสมอ
   */
  @Get('assignable')
  @ApiOperation({
    summary: 'รายชื่อพนักงานสำหรับดรอปดาวน์มอบหมายงาน',
    description:
      'คืนเฉพาะพนักงานที่สถานะ ACTIVE พร้อม id ชื่อ ชื่อผู้ใช้ และตำแหน่ง ไม่แบ่งหน้า ' +
      'ใช้กับช่องเลือกผู้รับผิดชอบของงานย่อยและใบแจ้งปัญหา — ' +
      'ถ้าต้องการข้อมูลผู้ใช้เต็มให้เรียก GET /api/users ซึ่งต้องมีสิทธิ์ user.view',
  })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: [AssignableUserDto] })
  @ApiResponse({ status: 401, description: 'ยังไม่ได้เข้าสู่ระบบ' })
  findAssignable(): Promise<AssignableUserDto[]> {
    return this.usersService.findAssignable();
  }

  @Get()
  @RequirePermission('user.view')
  @ApiOperation({
    summary: 'รายการผู้ใช้',
    description: 'กรองตามสถานะ ระดับบัญชี หรือบทบาทได้ และคืนบทบาทที่แต่ละคนถืออยู่มาด้วย',
  })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: [UserResponseDto] })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  findAll(@Query() query: QueryUsersDto): Promise<PaginatedResult<UserResponseDto>> {
    return this.usersService.findAll(query);
  }

  @Post()
  @RequirePermission('user.create')
  @ApiOperation({
    summary: 'เพิ่มผู้ใช้',
    description:
      'สร้างบัญชีระดับ ADMIN ได้เฉพาะ SUPER_ADMIN และ ADMIN ส่วนบัญชี SUPER_ADMIN ' +
      'สร้างได้โดย SUPER_ADMIN เท่านั้น (CLAUDE.md 4.1)',
  })
  @ApiResponse({ status: 201, description: 'เพิ่มผู้ใช้เรียบร้อย', type: UserResponseDto })
  @ApiResponse({ status: 400, description: 'ข้อมูลไม่ถูกต้อง หรือระบุบทบาทที่ใช้ไม่ได้' })
  @ApiResponse({ status: 403, description: 'ไม่มีสิทธิ์สร้างบัญชีระดับที่ระบุ' })
  @ApiResponse({ status: 409, description: 'ชื่อผู้ใช้ อีเมล หรือรหัสพนักงานซ้ำกับที่มีอยู่' })
  async create(
    @Body() dto: CreateUserDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<{ data: UserResponseDto; message: string }> {
    return { data: await this.usersService.create(dto, actor), message: 'เพิ่มผู้ใช้เรียบร้อย' };
  }

  @Put(':id')
  @RequirePermission('user.update')
  @ApiOperation({
    summary: 'แก้ไขข้อมูลผู้ใช้',
    description:
      'เปลี่ยน username และรหัสผ่านผ่าน endpoint นี้ไม่ได้ ' +
      'ส่วนบทบาทให้ใช้ PUT /api/users/:id/roles',
  })
  @ApiParam({ name: 'id', description: 'id ของผู้ใช้', example: 5 })
  @ApiResponse({ status: 200, description: 'บันทึกการแก้ไขเรียบร้อย', type: UserResponseDto })
  @ApiResponse({ status: 403, description: 'ไม่มีสิทธิ์แก้ไขบัญชีนี้' })
  @ApiResponse({ status: 404, description: 'ไม่พบข้อมูลผู้ใช้' })
  @ApiResponse({ status: 409, description: 'อีเมลหรือรหัสพนักงานซ้ำกับที่มีอยู่' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<{ data: UserResponseDto; message: string }> {
    return {
      data: await this.usersService.update(id, dto, actor),
      message: 'บันทึกการแก้ไขเรียบร้อย',
    };
  }

  @Put(':id/roles')
  @RequirePermission('user.update')
  @ApiOperation({
    summary: 'ผูกบทบาทให้ผู้ใช้',
    description:
      'ถือได้บทบาทเดียว (CLAUDE.md 4.2) — คนที่ทำหลายหน้าที่ให้สร้างบทบาทใหม่ที่รวมสิทธิ์ไว้ ' +
      'ยังส่งเป็น array เพื่อไม่เปลี่ยนสัญญา: roleIds ที่ส่งมาแทนที่ของเดิม ส่ง [] เพื่อถอดบทบาทออก',
  })
  @ApiParam({ name: 'id', description: 'id ของผู้ใช้', example: 5 })
  @ApiResponse({ status: 200, description: 'บันทึกบทบาทเรียบร้อย', type: UserResponseDto })
  @ApiResponse({
    status: 400,
    description: 'ส่งมาเกิน 1 บทบาท หรือระบุบทบาทที่ไม่มีอยู่จริง ปิดใช้งานอยู่ หรือผูกไม่ได้',
  })
  @ApiResponse({ status: 403, description: 'ไม่มีสิทธิ์แก้ไขบัญชีนี้' })
  @ApiResponse({ status: 404, description: 'ไม่พบข้อมูลผู้ใช้' })
  async assignRoles(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignRolesDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<{ data: UserResponseDto; message: string }> {
    return {
      data: await this.usersService.assignRoles(id, dto, actor),
      message: 'บันทึกบทบาทเรียบร้อย',
    };
  }

  @Patch(':id/status')
  @RequirePermission('user.update')
  @ApiOperation({
    summary: 'เปลี่ยนสถานะพนักงาน',
    description:
      'ใช้แทนการลบผู้ใช้ (BR-09) สถานะที่ไม่ใช่ ACTIVE จะเข้าสู่ระบบไม่ได้ ' +
      'และ session ที่ค้างอยู่ถูกตัดทันที การเปลี่ยนสถานะไม่กระทบบทบาทที่ผูกไว้ (CLAUDE.md 4.3)',
  })
  @ApiParam({ name: 'id', description: 'id ของผู้ใช้', example: 5 })
  @ApiResponse({ status: 200, description: 'เปลี่ยนสถานะเรียบร้อย', type: UserResponseDto })
  @ApiResponse({
    status: 400,
    description: 'เปลี่ยนสถานะบัญชีตนเอง หรือบัญชีผู้ดูแลระบบสูงสุดคนสุดท้ายไม่ได้',
  })
  @ApiResponse({ status: 403, description: 'ไม่มีสิทธิ์แก้ไขบัญชีนี้' })
  @ApiResponse({ status: 404, description: 'ไม่พบข้อมูลผู้ใช้' })
  async updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUserStatusDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<{ data: UserResponseDto; message: string }> {
    return {
      data: await this.usersService.updateStatus(id, dto, actor),
      message: 'เปลี่ยนสถานะเรียบร้อย',
    };
  }
}
