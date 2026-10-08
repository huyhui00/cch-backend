import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/sequelize';
import type { SignOptions } from 'jsonwebtoken';

import { setCurrentUserId } from '../../common/context/request-context';
import { SUPER_ADMIN_ONLY_PERMISSIONS } from '../../common/decorators/require-permission.decorator';
import { AccessControlService } from '../../common/services/access-control.service';
import type { JwtPayload } from '../../common/types/auth.types';
import { hashRefreshToken, safeCompareHex, verifyPassword } from '../../common/utils/crypto.util';
import { AccountType, Permission, User, UserStatus } from '../../models';
import { toRoleSummary } from '../roles/dto/role.response';
import { avatarUrlFor } from '../users/avatar.util';
import { AuthProfileDto, LoginResponseDto, RefreshResponseDto } from './dto/auth.response';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

const INVALID_CREDENTIALS = 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';
const INVALID_REFRESH_TOKEN = 'Refresh token ไม่ถูกต้องหรือหมดอายุแล้ว';
const ACCOUNT_NOT_ACTIVE = 'บัญชีนี้ถูกระงับการใช้งาน';

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User) private readonly userModel: typeof User,
    @InjectModel(Permission) private readonly permissionModel: typeof Permission,
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

    const tokens = await this.issueTokens(user);

    user.refreshTokenHash = hashRefreshToken(tokens.refreshToken);
    user.lastLoginAt = new Date();
    await user.save();

    return {
      ...tokens,
      tokenType: 'Bearer',
      user: await this.buildProfile(user),
    };
  }

  async refresh(dto: RefreshTokenDto): Promise<RefreshResponseDto> {
    const payload = await this.verifyRefreshToken(dto.refreshToken);
    const user = await this.userModel.findByPk(payload.sub);

    if (!user || !user.refreshTokenHash) {
      throw new UnauthorizedException(INVALID_REFRESH_TOKEN);
    }

    if (!safeCompareHex(user.refreshTokenHash, hashRefreshToken(dto.refreshToken))) {
      throw new UnauthorizedException(INVALID_REFRESH_TOKEN);
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException(ACCOUNT_NOT_ACTIVE);
    }

    setCurrentUserId(user.id);

    const tokens = await this.issueTokens(user);

    user.refreshTokenHash = hashRefreshToken(tokens.refreshToken);
    await user.save();

    return { ...tokens, tokenType: 'Bearer' };
  }

  async logout(userId: number): Promise<void> {
    const user = await this.userModel.findByPk(userId);

    if (!user || user.refreshTokenHash === null) {
      return;
    }

    // อัปเดตผ่าน instance ไม่ใช่ update({ where }) เพื่อให้ audit hook บันทึกเป็น UPDATE
    // พร้อม record_id ของผู้ใช้ ถ้าใช้แบบ where จะได้ BULK_UPDATE ที่ไม่มี record_id
    // ทำให้ตามรอยว่าใครออกจากระบบเมื่อไรได้ยากกว่าที่ควร (BR-09)
    user.refreshTokenHash = null;
    await user.save();
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

  private async issueTokens(user: User): Promise<TokenPair> {
    const payload: JwtPayload = {
      sub: user.id,
      username: user.username,
      accountType: user.accountType,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.expiresIn('JWT_ACCESS_EXPIRES_IN', '15m'),
      }),
      this.jwtService.signAsync(payload, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.expiresIn('JWT_REFRESH_EXPIRES_IN', '7d'),
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
