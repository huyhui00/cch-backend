import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ipTracker, loginBucketKey } from '../../common/throttle/throttle-tracker';
import { Public } from '../../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import { AuthProfileDto, LoginResponseDto, RefreshResponseDto } from './dto/auth.response';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

/**
 * ลองล็อกอินได้กี่ครั้งต่อนาทีต่อ IP — กันการสุ่มเดารหัสผ่าน แต่พิมพ์ผิดไม่กี่ครั้งยังไม่โดน
 * นับต่อ IP เสมอแม้แนบ token มา ไม่งั้นคนที่มีบัญชีอยู่แล้วจะย้ายไปใช้ถังของผู้ใช้เพื่อหนีเพดานของ IP
 */
export const LOGIN_THROTTLE = {
  limit: 10,
  ttl: 60_000,
  getTracker: ipTracker,
  generateKey: loginBucketKey,
};

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle({ default: LOGIN_THROTTLE })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'เข้าสู่ระบบ',
    description:
      'ตรวจชื่อผู้ใช้และรหัสผ่าน แล้วออก access token กับ refresh token ' +
      'เข้าได้เฉพาะบัญชีที่สถานะเป็น ACTIVE เท่านั้น (CLAUDE.md 4.3)',
  })
  @ApiResponse({ status: 200, description: 'เข้าสู่ระบบสำเร็จ', type: LoginResponseDto })
  @ApiResponse({ status: 400, description: 'ข้อมูลที่ส่งมาไม่ถูกต้อง' })
  @ApiResponse({
    status: 401,
    description: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง หรือบัญชีนี้ถูกระงับการใช้งาน',
  })
  @ApiResponse({ status: 429, description: 'ลองเข้าสู่ระบบบ่อยเกินไป ต้องรอสักครู่แล้วลองใหม่' })
  login(@Body() dto: LoginDto): Promise<LoginResponseDto> {
    return this.authService.login(dto);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'ขอ access token ใบใหม่ด้วย refresh token',
    description:
      'refresh token ถูกหมุนทุกครั้งที่เรียก ใบที่ส่งมาจะใช้ไม่ได้อีกทันทีหลังเรียกสำเร็จ ' +
      'ฝั่ง client ต้องเก็บใบใหม่ทับใบเก่าเสมอ',
  })
  @ApiResponse({ status: 200, description: 'ออก token ชุดใหม่สำเร็จ', type: RefreshResponseDto })
  @ApiResponse({
    status: 401,
    description: 'refresh token ไม่ถูกต้อง หมดอายุ ถูกใช้ไปแล้ว หรือบัญชีถูกระงับ',
  })
  refresh(@Body() dto: RefreshTokenDto): Promise<RefreshResponseDto> {
    return this.authService.refresh(dto);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'ออกจากระบบ',
    description:
      'ล้าง refresh token ที่ระบบเก็บไว้ ทำให้ต่ออายุ session ไม่ได้อีก ' +
      'ส่วน access token ใบปัจจุบันยังใช้ได้จนหมดอายุตามปกติ ' +
      'ถ้าต้องการตัดสิทธิ์ทันที ให้เปลี่ยนสถานะบัญชีเป็น SUSPENDED แทน',
  })
  @ApiResponse({ status: 200, description: 'ออกจากระบบเรียบร้อย' })
  @ApiResponse({ status: 401, description: 'ยังไม่ได้เข้าสู่ระบบ หรือ token หมดอายุ' })
  async logout(@CurrentUser('id') userId: number): Promise<{ data: null; message: string }> {
    await this.authService.logout(userId);
    return { data: null, message: 'ออกจากระบบเรียบร้อย' };
  }

  @Get('me')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'ข้อมูลผู้ใช้ที่ล็อกอินอยู่ พร้อม role และสิทธิ์ที่ union แล้ว',
    description:
      'สิทธิ์ที่คืนมาคือ union ของทุก role ที่ถืออยู่ (CLAUDE.md 4.2) ' +
      'กรณี SUPER_ADMIN จะได้รายการสิทธิ์ทั้งระบบ เพราะ bypass การตรวจสิทธิ์ทั้งหมด',
  })
  @ApiResponse({ status: 200, description: 'สำเร็จ', type: AuthProfileDto })
  @ApiResponse({ status: 401, description: 'ยังไม่ได้เข้าสู่ระบบ หรือ token หมดอายุ' })
  me(@CurrentUser('id') userId: number): Promise<AuthProfileDto> {
    return this.authService.me(userId);
  }
}
