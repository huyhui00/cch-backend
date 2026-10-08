import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { SequelizeModule } from '@nestjs/sequelize';

import { Permission, User, UserSession } from '../../models';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';

/**
 * ค่า default ใน .env.example เป็นคำว่า change-me เพื่อบังคับให้ตั้งเอง
 * ถ้าหลุดขึ้น production ทั้งระบบจะปลอม token ได้ทันที จึงหยุดตั้งแต่ตอน bootstrap
 */
function assertSecretsAreSet(config: ConfigService): void {
  if (config.get<string>('NODE_ENV') !== 'production') {
    return;
  }

  for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
    if (config.getOrThrow<string>(key).startsWith('change-me')) {
      throw new Error(
        `${key} ยังเป็นค่า default จาก .env.example — ต้องตั้งค่าใหม่ก่อนขึ้น production`,
      );
    }
  }
}

@Module({
  imports: [
    SequelizeModule.forFeature([User, Permission, UserSession]),
    PassportModule.register({ defaultStrategy: 'jwt', session: false }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        assertSecretsAreSet(config);
        return {};
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
