import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { DashboardService } from './dashboard.service';
import { QueryMyDashboardDto } from './dto/dashboard.dto';
import { MyDashboardDto } from './dto/dashboard.response';

@ApiTags('dashboard')
@ApiBearerAuth('access-token')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  /**
   * ไม่ติด @RequirePermission โดยเจตนา — ทุกคนมีแดชบอร์ดของตัวเอง
   * แต่ละตัวเลขตรวจสิทธิ์ของหน้าเรื่องนั้นใน service ไม่มีสิทธิ์ = null
   */
  @Get('me')
  @ApiOperation({
    summary: 'แดชบอร์ดของฉัน — สิ่งที่ฉันทำในช่วงเวลาที่เลือก',
    description:
      'ข้อมูลของผู้ที่ล็อกอินเท่านั้น ไม่มีทางดูของคนอื่น (ทุกระดับบัญชี) · ตัวเลขดิบ ไม่มีอันดับ/ค่าเฉลี่ยทีม/คะแนน',
  })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: MyDashboardDto })
  @ApiResponse({
    status: 400,
    description: 'ช่วงเวลาไม่ถูกต้อง กว้างเกิน 120 เดือน หรือแบ่งรายวันเกิน 366 วัน',
  })
  @ApiResponse({ status: 401, description: 'ยังไม่ได้เข้าสู่ระบบ' })
  getMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryMyDashboardDto,
  ): Promise<MyDashboardDto> {
    return this.dashboardService.getMine(user, query);
  }
}
