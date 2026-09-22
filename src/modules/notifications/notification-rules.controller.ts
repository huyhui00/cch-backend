import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { PaginatedResult } from '../../common/dto/pagination.dto';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import {
  CreateNotificationRuleDto,
  QueryNotificationRulesDto,
  UpdateNotificationRuleDto,
} from './dto/notification.dto';
import { NotificationRuleResponseDto } from './dto/notification.response';
import { NotificationRulesService } from './notification-rules.service';

@ApiTags('notification-rules')
@ApiBearerAuth('access-token')
@RequirePermission('notification.manage')
@Controller('notification-rules')
export class NotificationRulesController {
  constructor(private readonly rulesService: NotificationRulesService) {}

  @Get()
  @ApiOperation({ summary: 'รายการกฎการแจ้งเตือน' })
  findAll(
    @Query() query: QueryNotificationRulesDto,
  ): Promise<PaginatedResult<NotificationRuleResponseDto>> {
    return this.rulesService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'รายละเอียดกฎการแจ้งเตือน' })
  @ApiParam({ name: 'id', example: 1 })
  findOne(@Param('id', ParseIntPipe) id: number): Promise<NotificationRuleResponseDto> {
    return this.rulesService.findOne(id);
  }

  @Post()
  @ApiOperation({
    summary: 'สร้างกฎการแจ้งเตือน',
    description: 'ต้องระบุ targetRoleId หรือ targetUserId อย่างน้อยหนึ่งอย่าง (BR-11)',
  })
  @ApiResponse({ status: 201, type: NotificationRuleResponseDto })
  async create(
    @Body() dto: CreateNotificationRuleDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ data: NotificationRuleResponseDto; message: string }> {
    return {
      data: await this.rulesService.create(dto, user.id),
      message: 'สร้างกฎการแจ้งเตือนเรียบร้อย',
    };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'แก้ไขกฎการแจ้งเตือน' })
  @ApiParam({ name: 'id', example: 1 })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateNotificationRuleDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ data: NotificationRuleResponseDto; message: string }> {
    return {
      data: await this.rulesService.update(id, dto, user.id),
      message: 'แก้ไขกฎการแจ้งเตือนเรียบร้อย',
    };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'ลบกฎการแจ้งเตือน (soft delete)' })
  @ApiParam({ name: 'id', example: 1 })
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ data: null; message: string }> {
    await this.rulesService.remove(id, user.id);
    return { data: null, message: 'ลบกฎการแจ้งเตือนเรียบร้อย' };
  }
}
