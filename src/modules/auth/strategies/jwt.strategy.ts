import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { InjectModel } from '@nestjs/sequelize';
import { ExtractJwt, Strategy } from 'passport-jwt';

import type { AuthenticatedUser, JwtPayload } from '../../../common/types/auth.types';
import { User, UserSession, UserStatus } from '../../../models';
import { SESSION_REPLACED } from '../auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    @InjectModel(User) private readonly userModel: typeof User,
    @InjectModel(UserSession) private readonly sessionModel: typeof UserSession,
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

    if (payload.sid !== undefined) {
      const session = await this.sessionModel.findOne({
        where: { id: payload.sid, userId: user.id },
        attributes: ['id'],
      });

      if (!session) {
        throw new UnauthorizedException(SESSION_REPLACED);
      }
    }

    return {
      id: user.id,
      username: user.username,
      accountType: user.accountType,
      sessionId: payload.sid ?? null,
    };
  }
}
