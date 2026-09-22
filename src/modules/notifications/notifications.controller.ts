import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { PaginatedResult } from '../../common/dto/pagination.dto';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { QueryNotificationsDto, TestLinePushDto } from './dto/notification.dto';
import {
  DispatchRunResultDto,
  NotificationResponseDto,
} from './dto/notification.response';
import { NotificationDispatchService } from './notification-dispatch.service';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth('access-token')
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly dispatchService: NotificationDispatchService,
  ) {}

  @Get()
  @RequirePermission('notification.view')
  @ApiOperation({
    summary: 'รายการแจ้งเตือน',
    description:
      'ค่าเริ่มต้นคืนเฉพาะของตัวเอง · ส่ง ?all=true ได้เมื่อมี notification.manage',
  })
  @ApiResponse({ status: 200, description: 'สำเร็จ' })
  findAll(
    @Query() query: QueryNotificationsDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PaginatedResult<NotificationResponseDto>> {
    return this.notificationsService.findAll(query, user);
  }

  @Post('run')
  @RequirePermission('notification.manage')
  @ApiOperation({
    summary: 'รันตรวจแจ้งเตือนทันที',
    description: 'ใช้ทดสอบหรือให้ cron ภายนอกยิงแทน in-process scheduler (Q7)',
  })
  @ApiResponse({ status: 201, type: DispatchRunResultDto })
  async runNow(): Promise<{ data: DispatchRunResultDto; message: string }> {
    return {
      data: await this.dispatchService.runAll(),
      message: 'รันตรวจแจ้งเตือนเรียบร้อย',
    };
  }

  @Post('test-line')
  @RequirePermission('notification.manage')
  @ApiOperation({
    summary: 'ทดสอบส่งข้อความ LINE',
    description:
      'ไม่สร้างแถว notifications — ใช้ตรวจ Channel token กับ lineUserId ของพนักงาน',
  })
  async testLine(
    @Body() dto: TestLinePushDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ data: { lineUserId: string; displayHint: string }; message: string }> {
    return {
      data: await this.notificationsService.testLinePush(dto, user),
      message: 'ส่งข้อความทดสอบไป LINE แล้ว',
    };
  }

  @Get(':id')
  @RequirePermission('notification.view')
  @ApiOperation({ summary: 'รายละเอียดแจ้งเตือน' })
  @ApiParam({ name: 'id', example: 1 })
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<NotificationResponseDto> {
    return this.notificationsService.findOne(id, user);
  }

  @Patch(':id/read')
  @RequirePermission('notification.view')
  @ApiOperation({ summary: 'ทำเครื่องหมายว่าอ่านแล้ว' })
  @ApiParam({ name: 'id', example: 1 })
  async markRead(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ data: NotificationResponseDto; message: string }> {
    return {
      data: await this.notificationsService.markRead(id, user),
      message: 'อ่านการแจ้งเตือนแล้ว',
    };
  }
}
