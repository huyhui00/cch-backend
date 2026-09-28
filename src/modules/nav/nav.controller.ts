import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { NavCountsDto } from './dto/nav-counts.response';
import { NavService } from './nav.service';

@ApiTags('nav')
@ApiBearerAuth('access-token')
@Controller('nav')
export class NavController {
  constructor(private readonly navService: NavService) {}

  /**
   * ไม่ติด @RequirePermission โดยเจตนา — ทุกคนที่ล็อกอินมีเมนู และแต่ละช่องตรวจสิทธิ์
   * ของหน้ารายการนั้นเองใน NavService ช่องที่ไม่มีสิทธิ์ได้ null ไม่ใช่ตัวเลข
   */
  @Get('counts')
  @ApiOperation({
    summary: 'ตัวเลข badge ของเมนูทั้งหมดในคำขอเดียว',
    description:
      'แต่ละช่องเท่ากับ total ของหน้ารายการที่เมนูนั้นเปิด · ช่องที่ผู้ใช้ไม่มีสิทธิ์เข้าหน้านั้น = null',
  })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: NavCountsDto })
  @ApiResponse({ status: 401, description: 'ยังไม่ได้เข้าสู่ระบบ' })
  getCounts(@CurrentUser() user: AuthenticatedUser): Promise<NavCountsDto> {
    return this.navService.getCounts(user);
  }
}
