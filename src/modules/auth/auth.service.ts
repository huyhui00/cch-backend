import { randomBytes, randomUUID } from 'node:crypto';

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import type { SignOptions } from 'jsonwebtoken';
import { Sequelize } from 'sequelize-typescript';

import { getRequestContext, setCurrentUserId } from '../../common/context/request-context';
import { SUPER_ADMIN_ONLY_PERMISSIONS } from '../../common/decorators/require-permission.decorator';
import { AccessControlService } from '../../common/services/access-control.service';
import type { AuthenticatedUser, JwtPayload } from '../../common/types/auth.types';
import { hashRefreshToken, safeCompareHex, verifyPassword } from '../../common/utils/crypto.util';
import { AccountType, Permission, User, UserSession, UserStatus } from '../../models';
import { toRoleSummary } from '../roles/dto/role.response';
import { avatarUrlFor } from '../users/avatar.util';
import { AuthProfileDto, LoginResponseDto, RefreshResponseDto } from './dto/auth.response';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

const INVALID_CREDENTIALS = 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';
const INVALID_REFRESH_TOKEN = 'การเข้าสู่ระบบหมดอายุแล้ว กรุณาเข้าสู่ระบบใหม่';
const ACCOUNT_NOT_ACTIVE = 'บัญชีนี้ถูกระงับการใช้งาน';
export const SESSION_REPLACED =
  'บัญชีนี้ถูกเข้าสู่ระบบจากเครื่องอื่น หรือออกจากระบบแล้ว กรุณาเข้าสู่ระบบใหม่';

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User) private readonly userModel: typeof User,
    @InjectModel(Permission) private readonly permissionModel: typeof Permission,
    @InjectModel(UserSession) private readonly sessionModel: typeof UserSession,
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly accessControl: AccessControlService,
  ) {}

  async login(dto: LoginDto): Promise<LoginResponseDto> {
    const user = await this.userModel.findOne({ where: { username: dto.username } });

    if (!user) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    const passwordMatched = await verifyPassword(dto.password, user.passwordHash);

    if (!passwordMatched) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException(ACCOUNT_NOT_ACTIVE);
    }

    // ระบุผู้กระทำให้ audit hook ก่อนเขียนอะไรลงฐานข้อมูล
    //
    // endpoint นี้ติด @Public() จึงไม่มี guard มาเติม userId ให้เหมือน endpoint อื่น
    // ถ้าไม่ตั้งเอง การล็อกอินจะถูกบันทึกเป็น "ระบบเป็นผู้กระทำ" ทั้งที่รู้อยู่แล้วว่าใคร
    // และคำถามที่ audit log ต้องตอบได้ที่สุดข้อหนึ่งคือใครล็อกอินเมื่อไรจาก IP ไหน (BR-09)
    setCurrentUserId(user.id);

    const now = new Date();
    const context = getRequestContext();

    const tokens = await this.sequelize.transaction(async (transaction) => {
      // บัญชีละหนึ่งเครื่อง (CLAUDE.md 4.4) — นับก่อน ไม่งั้นได้แถว BULK_DELETE ว่างทุกครั้งที่ล็อกอิน
      if ((await this.sessionModel.count({ where: { userId: user.id }, transaction })) > 0) {
        await this.sessionModel.destroy({ where: { userId: user.id }, transaction });
      }

      const session = await this.sessionModel.create(
        {
          userId: user.id,
          refreshTokenHash: hashRefreshToken(randomBytes(32).toString('hex')),
          userAgent: context?.userAgent ?? null,
          ipAddress: context?.ipAddress ?? null,
          lastUsedAt: now,
          expiresAt: now,
        },
        { transaction },
      );

      const issued = await this.issueTokens(user, session.id);

      // เติม hash จริงหลังรู้ sid — แถว CREATE ข้างบนคือหลักฐานการล็อกอินแล้ว ไม่ต้องบันทึกซ้ำ
      await session.update(
        {
          refreshTokenHash: hashRefreshToken(issued.refreshToken),
          expiresAt: this.expiryOf(issued.refreshToken),
        },
        { transaction, hooks: false },
      );

      user.lastLoginAt = now;
      await user.save({ transaction, hooks: false });

      return issued;
    });

    return {
      ...tokens,
      tokenType: 'Bearer',
      user: await this.buildProfile(user),
    };
  }

  async refresh(dto: RefreshTokenDto): Promise<RefreshResponseDto> {
    const payload = await this.verifyRefreshToken(dto.refreshToken);
    const user = await this.userModel.findByPk(payload.sub);

    if (!user) {
      throw new UnauthorizedException(INVALID_REFRESH_TOKEN);
    }

    if (
      payload.sid !== undefined &&
      (await this.sessionModel.count({ where: { id: payload.sid, userId: user.id } })) === 0
    ) {
      throw new UnauthorizedException(SESSION_REPLACED);
    }

    const session = await this.findSession(user.id, payload.sid, dto.refreshToken);

    if (!session || session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException(INVALID_REFRESH_TOKEN);
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException(ACCOUNT_NOT_ACTIVE);
    }

    setCurrentUserId(user.id);

    const tokens = await this.issueTokens(user, session.id);
    const context = getRequestContext();

    await session.update({
      refreshTokenHash: hashRefreshToken(tokens.refreshToken),
      expiresAt: this.expiryOf(tokens.refreshToken),
      lastUsedAt: new Date(),
      userAgent: context?.userAgent ?? session.userAgent,
      ipAddress: context?.ipAddress ?? session.ipAddress,
    });

    return { ...tokens, tokenType: 'Bearer' };
  }

  async logout(user: AuthenticatedUser): Promise<void> {
    if (!user.sessionId) {
      return;
    }

    const session = await this.sessionModel.findOne({
      where: { id: user.sessionId, userId: user.id },
    });

    // ลบผ่าน instance เพื่อให้ audit ได้ DELETE พร้อม record_id ของ session (BR-09)
    await session?.destroy();
  }

  async me(userId: number): Promise<AuthProfileDto> {
    const user = await this.userModel.findByPk(userId);

    if (!user) {
      throw new UnauthorizedException('ไม่พบบัญชีผู้ใช้นี้ในระบบ');
    }

    return this.buildProfile(user);
  }

  private async buildProfile(user: User): Promise<AuthProfileDto> {
    const isSuperAdmin = user.accountType === AccountType.SUPER_ADMIN;
    const isAdmin = user.accountType === AccountType.ADMIN;
    const roles = isSuperAdmin ? [] : await this.accessControl.findRolesWithPermissions(user.id);

    // SUPER_ADMIN และ ADMIN ไม่ต้องผูก role แต่ bypass permission check ได้ (CLAUDE.md 4.1)
    // จึงต้องคืนรายการสิทธิ์ให้ตรงกับสิ่งที่ PermissionsGuard ปล่อยผ่านจริง ไม่งั้น
    // frontend ที่กั้นเมนูด้วย permissions จะซ่อนเมนูที่คนเหล่านี้กดเข้าไปได้อยู่ดี
    //
    // ต่างกันตรง ADMIN ไม่ได้ role.manage เพราะสิทธิ์นั้นผูกกับระดับบัญชี ติ๊กให้ไม่ได้ (BR-10)
    // ผลพลอยได้คือเมนูจัดการบทบาทหายจากหน้าจอ ADMIN เองโดยไม่ต้องเขียนเงื่อนไขเพิ่ม
    const permissions =
      isSuperAdmin || isAdmin
        ? await this.findAllPermissionCodes(isAdmin)
        : this.unionPermissionCodes(roles);

    return {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      nickname: user.nickname,
      email: user.email,
      position: user.position,
      avatarUrl: avatarUrlFor(user),
      accountType: user.accountType,
      status: user.status,
      isSuperAdmin,
      roles: roles.map(toRoleSummary),
      permissions,
    };
  }

  private unionPermissionCodes(roles: { permissions?: Permission[] }[]): string[] {
    const codes = new Set<string>();

    for (const role of roles) {
      for (const permission of role.permissions ?? []) {
        codes.add(permission.code);
      }
    }

    return [...codes].sort();
  }

  private async findAllPermissionCodes(excludeSuperAdminOnly = false): Promise<string[]> {
    const permissions = await this.permissionModel.findAll({
      attributes: ['code'],
      order: [['code', 'ASC']],
    });

    const codes = permissions.map((permission) => permission.code);

    return excludeSuperAdminOnly
      ? codes.filter((code) => !SUPER_ADMIN_ONLY_PERMISSIONS.has(code))
      : codes;
  }

  /** token รุ่นก่อน 8 ต.ค. ไม่มี sid — หาจาก hash ในบรรดา session ของคนนั้นแทน */
  private async findSession(
    userId: number,
    sid: number | undefined,
    refreshToken: string,
  ): Promise<UserSession | null> {
    const hash = hashRefreshToken(refreshToken);
    const candidates = await this.sessionModel.findAll({
      where: sid === undefined ? { userId } : { id: sid, userId },
    });

    return candidates.find((session) => safeCompareHex(session.refreshTokenHash, hash)) ?? null;
  }

  private expiryOf(token: string): Date {
    const { exp } = this.jwtService.decode<{ exp: number }>(token);
    return new Date(exp * 1000);
  }

  private async issueTokens(user: User, sessionId: number): Promise<TokenPair> {
    const payload: JwtPayload = {
      sub: user.id,
      username: user.username,
      accountType: user.accountType,
      sid: sessionId,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.expiresIn('JWT_ACCESS_EXPIRES_IN', '15m'),
      }),
      this.jwtService.signAsync(payload, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.expiresIn('JWT_REFRESH_EXPIRES_IN', '7d'),
        // ไม่งั้นต่ออายุภายในวินาทีเดียวกันได้ token ใบเดิม แล้วใบเก่ายังใช้ซ้ำได้
        jwtid: randomUUID(),
      }),
    ]);

    return { accessToken, refreshToken };
  }

  private expiresIn(key: string, fallback: string): SignOptions['expiresIn'] {
    return this.config.get<string>(key, fallback) as SignOptions['expiresIn'];
  }

  private async verifyRefreshToken(token: string): Promise<JwtPayload> {
    try {
      return await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException(INVALID_REFRESH_TOKEN);
    }
  }
}
