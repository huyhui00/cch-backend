/// <reference types="jest" />

import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Sequelize } from 'sequelize-typescript';

import type { AccessControlService } from '../../common/services/access-control.service';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { verifyPassword } from '../../common/utils/crypto.util';
import { AccountType, Role, User, UserRole } from '../../models';
import { UsersService } from './users.service';

interface ModelMock {
  findByPk: jest.Mock;
  findOne: jest.Mock;
  findAll: jest.Mock;
  findAndCountAll: jest.Mock;
  create: jest.Mock;
  count: jest.Mock;
}

function modelMock(): ModelMock {
  return {
    findByPk: jest.fn(),
    findOne: jest.fn(),
    findAll: jest.fn(),
    findAndCountAll: jest.fn(),
    create: jest.fn(),
    count: jest.fn().mockResolvedValue(0),
  };
}

function actor(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: 1,
    username: 'superadmin',
    accountType: AccountType.SUPER_ADMIN,
    ...overrides,
  };
}

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 5,
    username: 'pranee',
    accountType: AccountType.USER,
    passwordHash: 'old-hash',
    refreshTokenHash: 'session-hash',
    update: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('UsersService.resetPassword', () => {
  let userModel: ModelMock;
  let service: UsersService;

  beforeEach(() => {
    userModel = modelMock();
    const config = {
      get: jest.fn((key: string) => (key === 'BCRYPT_SALT_ROUNDS' ? 4 : undefined)),
    };

    service = new UsersService(
      userModel as unknown as typeof User,
      modelMock() as unknown as typeof Role,
      modelMock() as unknown as typeof UserRole,
      { transaction: jest.fn() } as unknown as Sequelize,
      config as unknown as ConfigService,
      { hasPermission: jest.fn() } as unknown as AccessControlService,
    );
  });

  it('ตั้งรหัสใหม่ ตัด session และไม่เก็บรหัสเป็นข้อความล้วน', async () => {
    const row = userRow();
    userModel.findByPk.mockResolvedValue(row);

    await service.resetPassword(5, { newPassword: 'TempPassw0rd!' }, actor());

    expect(row.update).toHaveBeenCalledTimes(1);
    const payload = row.update.mock.calls[0][0] as {
      passwordHash: string;
      refreshTokenHash: null;
      updatedBy: number;
    };
    expect(payload.refreshTokenHash).toBeNull();
    expect(payload.updatedBy).toBe(1);
    expect(payload.passwordHash).not.toBe('TempPassw0rd!');
    await expect(verifyPassword('TempPassw0rd!', payload.passwordHash)).resolves.toBe(true);
  });

  it('ตั้งรหัสของตนเองไม่ได้', async () => {
    await expect(
      service.resetPassword(1, { newPassword: 'TempPassw0rd!' }, actor({ id: 1 })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(userModel.findByPk).not.toHaveBeenCalled();
  });

  it('ADMIN ตั้งรหัสให้ SUPER_ADMIN ไม่ได้', async () => {
    userModel.findByPk.mockResolvedValue(userRow({ id: 9, accountType: AccountType.SUPER_ADMIN }));

    await expect(
      service.resetPassword(
        9,
        { newPassword: 'TempPassw0rd!' },
        actor({ id: 2, username: 'somchai', accountType: AccountType.ADMIN }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('โยน 404 เมื่อไม่พบผู้ใช้', async () => {
    userModel.findByPk.mockResolvedValue(null);

    await expect(
      service.resetPassword(999, { newPassword: 'TempPassw0rd!' }, actor()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
