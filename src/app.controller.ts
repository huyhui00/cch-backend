import { Controller, Get } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Sequelize } from 'sequelize-typescript';

import { Public } from './common/decorators/public.decorator';

/**
 * Endpoint เดียวที่มีในเฟส Setup — ไว้ยืนยันว่า boot ขึ้นและต่อ DB ติด
 * ไม่ใช่ endpoint ทางธุรกิจ ถ้าไม่ต้องการสามารถลบไฟล์นี้และถอดออกจาก AppModule ได้
 */
// ต้องเรียกได้โดยไม่ต้องล็อกอิน เพราะ health check ของ infrastructure ไม่มี token
@Public()
@SkipThrottle()
@ApiTags('health')
@Controller('health')
export class AppController {
  constructor(@InjectConnection() private readonly sequelize: Sequelize) {}

  @Get()
  @ApiOperation({ summary: 'ตรวจสอบสถานะระบบและการเชื่อมต่อฐานข้อมูล' })
  @ApiResponse({ status: 200, description: 'ระบบพร้อมใช้งาน' })
  @ApiResponse({ status: 503, description: 'เชื่อมต่อฐานข้อมูลไม่ได้' })
  async check(): Promise<{ status: string; database: string; timestamp: string }> {
    const connected = await this.isDatabaseUp();

    return {
      status: 'ok',
      database: connected ? 'up' : 'down',
      timestamp: new Date().toISOString(),
    };
  }

  private async isDatabaseUp(): Promise<boolean> {
    try {
      await this.sequelize.authenticate();
      return true;
    } catch {
      return false;
    }
  }
}
