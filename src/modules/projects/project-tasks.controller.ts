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

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { type PaginatedResult } from '../../common/dto/pagination.dto';
import { TaskResponseDto } from './dto/project.response';
import { CreateTaskDto, QueryTasksDto, UpdateTaskDto } from './dto/task.dto';
import { TasksService } from './tasks.service';

@ApiTags('tasks')
@ApiBearerAuth('access-token')
@Controller('projects/:projectId/tasks')
export class ProjectTasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get()
  @RequirePermission('task.view')
  @ApiOperation({
    summary: 'รายการงานของโครงการ',
    description:
      'คืนโครงสร้างซ้อน 2 ระดับเป็นค่าเริ่มต้น — งานระดับบนสุดพร้อมงานย่อยชั้นเดียว ' +
      'ชั้นที่ 3 ขึ้นไปมีอยู่จริงในฐานข้อมูลแต่ไม่ถูกคืนมาอัตโนมัติ ให้ส่ง parentTaskId มาเจาะดู ' +
      'เรียงตาม sortOrder จากน้อยไปมากเป็นค่าเริ่มต้น',
  })
  @ApiParam({ name: 'projectId', description: 'id ของโครงการ', example: 1 })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: [TaskResponseDto] })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  @ApiResponse({ status: 404, description: 'ไม่พบข้อมูลโครงการ' })
  findAll(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Query() query: QueryTasksDto,
  ): Promise<PaginatedResult<TaskResponseDto>> {
    return this.tasksService.findAllByProject(projectId, query);
  }

  @Post()
  @RequirePermission('task.create')
  @ApiOperation({
    summary: 'เพิ่มงานในโครงการ',
    description:
      'ส่ง parentTaskId เพื่อสร้างเป็นงานย่อย งานแม่ต้องอยู่ในโครงการเดียวกัน ' +
      'ถ้าไม่ส่ง sortOrder ระบบจะต่อท้ายกลุ่มพี่น้องให้เอง',
  })
  @ApiParam({ name: 'projectId', description: 'id ของโครงการ', example: 1 })
  @ApiResponse({ status: 201, description: 'เพิ่มงานเรียบร้อย', type: TaskResponseDto })
  @ApiResponse({
    status: 400,
    description: 'ข้อมูลไม่ถูกต้อง หรือระบุงานแม่/ผู้รับผิดชอบที่ใช้ไม่ได้',
  })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  @ApiResponse({ status: 404, description: 'ไม่พบข้อมูลโครงการ' })
  async create(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() dto: CreateTaskDto,
  ): Promise<{ data: TaskResponseDto; message: string }> {
    return { data: await this.tasksService.create(projectId, dto), message: 'เพิ่มงานเรียบร้อย' };
  }

  @Put(':taskId')
  @RequirePermission('task.update')
  @ApiOperation({
    summary: 'แก้ไขงาน',
    description: 'ย้ายงานไปอยู่ใต้งานย่อยของตัวเองไม่ได้ ระบบตรวจไม่ให้เกิดวงกลมให้',
  })
  @ApiParam({ name: 'projectId', description: 'id ของโครงการ', example: 1 })
  @ApiParam({ name: 'taskId', description: 'id ของงาน', example: 5 })
  @ApiResponse({ status: 200, description: 'บันทึกการแก้ไขเรียบร้อย', type: TaskResponseDto })
  @ApiResponse({ status: 400, description: 'ข้อมูลไม่ถูกต้อง หรือทำให้เกิดวงกลมในโครงสร้าง' })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  @ApiResponse({ status: 404, description: 'ไม่พบงานนี้ในโครงการที่ระบุ' })
  async update(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('taskId', ParseIntPipe) taskId: number,
    @Body() dto: UpdateTaskDto,
  ): Promise<{ data: TaskResponseDto; message: string }> {
    return {
      data: await this.tasksService.update(projectId, taskId, dto),
      message: 'บันทึกการแก้ไขเรียบร้อย',
    };
  }

  @Delete(':taskId')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('task.delete')
  @ApiOperation({
    summary: 'ลบงาน',
    description: 'เป็น soft delete และลบงานย่อยทุกชั้นที่อยู่ใต้มันตามไปด้วยในทรานแซกชันเดียว',
  })
  @ApiParam({ name: 'projectId', description: 'id ของโครงการ', example: 1 })
  @ApiParam({ name: 'taskId', description: 'id ของงาน', example: 5 })
  @ApiResponse({ status: 200, description: 'ลบงานเรียบร้อย' })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  @ApiResponse({ status: 404, description: 'ไม่พบงานนี้ในโครงการที่ระบุ' })
  async remove(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('taskId', ParseIntPipe) taskId: number,
  ): Promise<{ data: null; message: string }> {
    await this.tasksService.remove(projectId, taskId);
    return { data: null, message: 'ลบงานเรียบร้อย' };
  }
}
