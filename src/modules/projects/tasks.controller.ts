import { Body, Controller, Get, Param, ParseIntPipe, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { type PaginatedResult } from '../../common/dto/pagination.dto';
import { TaskResponseDto } from './dto/project.response';
import { QueryOverdueTasksDto, UpdateTaskOrderDto, UpdateTaskStatusDto } from './dto/task.dto';
import { TasksService } from './tasks.service';

/**
 * การทำงานกับงานที่ข้ามโครงการ — ผู้ใช้ทำจากหน้าจอรวม ไม่ได้เข้าไปทีละโครงการ
 * ส่วน CRUD ของงานอยู่ใต้ /api/projects/:projectId/tasks
 */
@ApiTags('tasks')
@ApiBearerAuth('access-token')
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  /**
   * ต้องประกาศก่อน route ที่มี :id ทุกเส้น ไม่งั้นคำว่า "overdue" จะถูกจับเป็นค่าของ :id
   */
  @Get('overdue')
  @RequirePermission('task.view')
  @ApiOperation({
    summary: 'งานที่เกินกำหนด',
    description:
      'งานที่วันครบกำหนดผ่านไปแล้วและสถานะยังไม่ใช่ DONE ' +
      'เรียงงานที่ค้างนานที่สุดขึ้นก่อน แล้วเรียงตามความสำคัญในวันเดียวกัน ' +
      'งานที่ครบกำหนดวันนี้ยังไม่ถือว่าเกิน จนกว่าจะข้ามไปวันถัดไป',
  })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: [TaskResponseDto] })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  findOverdue(@Query() query: QueryOverdueTasksDto): Promise<PaginatedResult<TaskResponseDto>> {
    return this.tasksService.findOverdue(query);
  }

  @Patch(':id/status')
  @RequirePermission('task.update')
  @ApiOperation({
    summary: 'เปลี่ยนสถานะงาน',
    description:
      'เปลี่ยนไปสถานะใดก็ได้ ระบบไม่บังคับลำดับ เพราะงานจริงถอยกลับได้ ' +
      '(ตรวจแล้วไม่ผ่านต้องกลับไป DOING) เมื่อเป็น DONE ระบบบันทึก completedAt ให้ ' +
      'และล้างค่าเมื่อถอยออกจาก DONE ส่วนการเปลี่ยนเป็น DONE ซ้ำจะไม่ทับเวลาเดิม',
  })
  @ApiParam({ name: 'id', description: 'id ของงาน', example: 5 })
  @ApiResponse({ status: 200, description: 'เปลี่ยนสถานะเรียบร้อย', type: TaskResponseDto })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  @ApiResponse({ status: 404, description: 'ไม่พบข้อมูลงาน' })
  async updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTaskStatusDto,
  ): Promise<{ data: TaskResponseDto; message: string }> {
    return {
      data: await this.tasksService.updateStatus(id, dto),
      message: 'เปลี่ยนสถานะเรียบร้อย',
    };
  }

  @Patch(':id/order')
  @RequirePermission('task.update')
  @ApiOperation({
    summary: 'จัดลำดับงาน (ลากวาง)',
    description:
      'ส่งตำแหน่งปลายทางที่ต้องการ เริ่มนับที่ 0 ระบบจะเรียงพี่น้องในกลุ่มเดียวกันใหม่ ' +
      'ให้เป็น 0, 1, 2, ... ทั้งกลุ่ม ทำให้ลำดับถูกต้องเสมอไม่ว่าลากไปมากี่รอบ ' +
      'ค่านี้ใช้เพื่อการแสดงผลเท่านั้น ระบบไม่บังคับว่างานไหนต้องเสร็จก่อนงานไหน',
  })
  @ApiParam({ name: 'id', description: 'id ของงาน', example: 5 })
  @ApiResponse({ status: 200, description: 'จัดลำดับเรียบร้อย', type: TaskResponseDto })
  @ApiResponse({ status: 403, description: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' })
  @ApiResponse({ status: 404, description: 'ไม่พบข้อมูลงาน' })
  async updateOrder(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTaskOrderDto,
  ): Promise<{ data: TaskResponseDto; message: string }> {
    return {
      data: await this.tasksService.updateOrder(id, dto),
      message: 'จัดลำดับเรียบร้อย',
    };
  }
}
