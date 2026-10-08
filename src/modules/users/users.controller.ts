import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { QueryAssignableUsersDto } from './dto/query-assignable-users.dto';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { type PaginatedResult } from '../../common/dto/pagination.dto';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { CreateUserDto, UpdateUserDto } from './dto/create-user.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import {
  AssignRolesDto,
  ChangePasswordDto,
  ResetPasswordDto,
  UpdateOwnProfileDto,
  UpdateUserStatusDto,
} from './dto/user-actions.dto';
import { AssignableUserDto, UserResponseDto } from './dto/user.response';
import { AuthService } from '../auth/auth.service';
import { AuthProfileDto } from '../auth/dto/auth.response';
import type { UploadedFileLike } from '../files/upload.util';
import { AVATAR_INTERCEPTOR_OPTIONS, AVATAR_MAX_MB } from './avatar.util';
import { UsersService } from './users.service';

/**
 * ไม่มี DELETE โดยเจตนา — ห้ามลบผู้ใช้ทิ้งเพราะ audit log ต้องอ้างอิงย้อนหลังได้ (BR-09)
 * พนักงานที่ออกแล้วให้เปลี่ยนสถานะเป็น RESIGNED ผ่าน PATCH /api/users/:id/status แทน
 */
@ApiTags('users')
@ApiBearerAuth('access-token')
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly authService: AuthService,
  ) {}

  @Patch('me')
  @ApiOperation({
    summary: 'แก้โปรไฟล์ของตัวเอง',
    description:
      'แก้ได้แค่ชื่อ-นามสกุล (ว่างไม่ได้) และชื่อเล่น (ส่ง null หรือ "" เพื่อลบ) ' +
      'ผู้ใช้ที่ล็อกอินทุกคนรวม SUPER_ADMIN แก้ของตัวเองได้ · ชื่อผู้ใช้ (username) แก้ไม่ได้ · ' +
      'ฟิลด์อื่นใน body = 400 · คืนโปรไฟล์รูปแบบเดียวกับ GET /api/auth/me',
  })
  @ApiResponse({ status: 200, description: 'บันทึกโปรไฟล์เรียบร้อย', type: AuthProfileDto })
  @ApiResponse({ status: 400, description: 'ชื่อเล่นยาวเกิน 50 ตัวอักษร หรือส่งฟิลด์ที่แก้ไม่ได้' })
  @ApiResponse({ status: 401, description: 'ยังไม่ได้เข้าสู่ระบบ' })
  async updateOwnProfile(
    @CurrentUser('id') userId: number,
    @Body() dto: UpdateOwnProfileDto,
  ): Promise<{ data: AuthProfileDto; message: string }> {
    await this.usersService.updateOwnProfile(userId, dto);
    return { data: await this.authService.me(userId), message: 'บันทึกโปรไฟล์เรียบร้อย' };
  }

  @Post('me/avatar')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', AVATAR_INTERCEPTOR_OPTIONS))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: `JPG / PNG / WEBP ไม่เกิน ${AVATAR_MAX_MB} MB`,
        },
      },
    },
  })
  @ApiOperation({
    summary: 'อัปโหลดรูปโปรไฟล์ของตัวเอง',
    description:
      'แทนรูปเดิม (ไฟล์เก่าถูกลบ) · avatarUrl ที่ได้คือ /api/users/:id/avatar ' +
      'ต้องดึงพร้อม Authorization header · คืนโปรไฟล์รูปแบบเดียวกับ GET /api/auth/me',
  })
  @ApiResponse({ status: 200, description: 'บันทึกรูปโปรไฟล์เรียบร้อย', type: AuthProfileDto })
  @ApiResponse({ status: 400, description: 'ไม่ได้แนบไฟล์ หรือไม่ใช่ JPG / PNG / WEBP' })
  @ApiResponse({ status: 413, description: `ไฟล์ใหญ่เกิน ${AVATAR_MAX_MB} MB` })
  async uploadOwnAvatar(
    @CurrentUser('id') userId: number,
    @UploadedFile() file?: UploadedFileLike,
  ): Promise<{ data: AuthProfileDto; message: string }> {
    await this.usersService.setOwnAvatar(userId, file);
    return { data: await this.authService.me(userId), message: 'บันทึกรูปโปรไฟล์เรียบร้อย' };
  }

  @Delete('me/avatar')
  @ApiOperation({
    summary: 'ลบรูปโปรไฟล์ของตัวเอง',
    description: 'ไม่มีรูปอยู่แล้วก็สำเร็จ · คืนโปรไฟล์รูปแบบเดียวกับ GET /api/auth/me',
  })
  @ApiResponse({ status: 200, description: 'ลบรูปโปรไฟล์เรียบร้อย', type: AuthProfileDto })
  async removeOwnAvatar(
    @CurrentUser('id') userId: number,
  ): Promise<{ data: AuthProfileDto; message: string }> {
    await this.usersService.removeOwnAvatar(userId);
    return { data: await this.authService.me(userId), message: 'ลบรูปโปรไฟล์เรียบร้อย' };
  }

  @Get(':id/avatar')
  @ApiOperation({
    summary: 'รูปโปรไฟล์ของพนักงาน',
    description: 'คืนไฟล์รูปตรง ๆ ไม่ใช่ JSON — ดึงเป็น blob พร้อม Authorization header',
  })
  @ApiParam({ name: 'id', description: 'id ของผู้ใช้', example: 5 })
  @ApiResponse({ status: 200, description: 'ไฟล์รูป' })
  @ApiResponse({ status: 404, description: 'ผู้ใช้นี้ยังไม่มีรูปโปรไฟล์' })
  async downloadAvatar(@Param('id', ParseIntPipe) id: number): Promise<StreamableFile> {
    const file = await this.usersService.openAvatar(id);

    return new StreamableFile(file.stream, {
      type: file.contentType,
      disposition: 'inline',
      length: file.contentLength ?? undefined,
    });
  }

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
  findAssignable(@Query() query: QueryAssignableUsersDto): Promise<AssignableUserDto[]> {
    return this.usersService.findAssignable(query.capability);
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

  @Post(':id/reset-password')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('user.reset_password')
  @ApiOperation({
    summary: 'ตั้งรหัสผ่านใหม่ให้ผู้ใช้ที่ลืมรหัส',
    description:
      'ผู้ดูแลตั้งรหัสชั่วคราวให้โดยไม่ต้องรู้รหัสเดิม แล้วบอกพนักงานนอกระบบ (LINE/ปากเปล่า) ' +
      'หลังสำเร็จ session ที่ค้างอยู่ถูกตัดทันที ผู้ถูกตั้งรหัสต้องเข้าสู่ระบบใหม่ ' +
      'ตั้งรหัสของตนเองไม่ได้ — ใช้ PATCH /api/users/me/password ' +
      'บัญชี SUPER_ADMIN ถูกตั้งรหัสได้โดย SUPER_ADMIN เท่านั้น',
  })
  @ApiParam({ name: 'id', description: 'id ของผู้ใช้ที่ลืมรหัส', example: 5 })
  @ApiResponse({ status: 200, description: 'ตั้งรหัสผ่านใหม่เรียบร้อย' })
  @ApiResponse({ status: 400, description: 'ตั้งรหัสผ่านของตนเอง หรือรหัสใหม่ไม่ถูกต้อง' })
  @ApiResponse({ status: 403, description: 'ไม่มีสิทธิ์ตั้งรหัสผ่านให้บัญชีนี้' })
  @ApiResponse({ status: 404, description: 'ไม่พบข้อมูลผู้ใช้' })
  async resetPassword(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ResetPasswordDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<{ data: null; message: string }> {
    await this.usersService.resetPassword(id, dto, actor);
    return {
      data: null,
      message: 'ตั้งรหัสผ่านใหม่เรียบร้อย ผู้ใช้ต้องเข้าสู่ระบบใหม่',
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
