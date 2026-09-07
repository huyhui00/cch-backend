import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { InjectModel } from '@nestjs/sequelize';
import { ExtractJwt, Strategy } from 'passport-jwt';

import type { AuthenticatedUser, JwtPayload } from '../../../common/types/auth.types';
import { User, UserStatus } from '../../../models';

/**
 * ตรวจ access token แล้วโหลดผู้ใช้จาก DB ทุกครั้ง ไม่เชื่อข้อมูลใน token ตรง ๆ
 *
 * เหตุผลที่ต้อง query: token มีอายุ 15 นาที ถ้าเชื่อ payload อย่างเดียว
 * คนที่เพิ่งถูกเปลี่ยนสถานะเป็น SUSPENDED หรือ RESIGNED จะยังใช้งานต่อได้
 * จนกว่า token จะหมดอายุ ซึ่งขัดกับ CLAUDE.md 4.3 ที่ว่าสถานะไม่ ACTIVE ต้องใช้งานไม่ได้
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    @InjectModel(User) private readonly userModel: typeof User,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.userModel.findByPk(payload.sub, {
      attributes: ['id', 'username', 'accountType', 'status'],
    });

    if (!user) {
      throw new UnauthorizedException('ไม่พบบัญชีผู้ใช้นี้ในระบบ');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('บัญชีนี้ถูกระงับการใช้งาน');
    }

    // อ่าน accountType จาก DB ไม่ใช่จาก payload — ถ้าถูกลดระดับบัญชีต้องมีผลทันที
    return { id: user.id, username: user.username, accountType: user.accountType };
  }
}
