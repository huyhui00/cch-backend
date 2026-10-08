/// <reference types="jest" />

import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Sequelize } from 'sequelize-typescript';

import type { AccessControlService } from '../../common/services/access-control.service';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { verifyPassword } from '../../common/utils/crypto.util';
import { AccountType, Role, User, UserRole, UserSession } from '../../models';
import type { StorageService } from '../files/storage.service';
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
    update: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const TX = { id: 'tx' };

function sequelizeMock() {
  return {
    transaction: jest.fn((callback: (tx: unknown) => Promise<unknown>) => callback(TX)),
  };
}

describe('UsersService.resetPassword', () => {
  let userModel: ModelMock;
  let sessionModel: { destroy: jest.Mock };
  let service: UsersService;

  beforeEach(() => {
    userModel = modelMock();
    sessionModel = { destroy: jest.fn().mockResolvedValue(2) };
    const config = {
      get: jest.fn((key: string) => (key === 'BCRYPT_SALT_ROUNDS' ? 4 : undefined)),
    };

    service = new UsersService(
      userModel as unknown as typeof User,
      modelMock() as unknown as typeof Role,
      modelMock() as unknown as typeof UserRole,
      sessionModel as unknown as typeof UserSession,
      sequelizeMock() as unknown as Sequelize,
      config as unknown as ConfigService,
      { hasPermission: jest.fn() } as unknown as AccessControlService,
      {} as unknown as StorageService,
    );
  });

  it('ตั้งรหัสใหม่ ตัด session ทุกเครื่อง และไม่เก็บรหัสเป็นข้อความล้วน', async () => {
    const row = userRow();
    userModel.findByPk.mockResolvedValue(row);

    await service.resetPassword(5, { newPassword: 'TempPassw0rd!' }, actor());

    expect(row.update).toHaveBeenCalledTimes(1);
    const [payload, options] = row.update.mock.calls[0] as [
      { passwordHash: string; updatedBy: number },
      { transaction: unknown },
    ];
    expect(options.transaction).toBe(TX);
    expect(sessionModel.destroy).toHaveBeenCalledWith({ where: { userId: 5 }, transaction: TX });
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

describe('UsersService โปรไฟล์ของตัวเอง', () => {
  let userModel: ModelMock;
  let storage: { put: jest.Mock; get: jest.Mock; delete: jest.Mock };
  let service: UsersService;

  const png = (size = 10) => ({
    originalname: 'me.png',
    mimetype: 'image/png',
    size,
    buffer: Buffer.alloc(size),
  });

  beforeEach(() => {
    userModel = modelMock();
    storage = {
      put: jest
        .fn()
        .mockResolvedValue({ key: 'local:users/5/avatar/2026/09/new.png', driver: 'local' }),
      get: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
    };

    service = new UsersService(
      userModel as unknown as typeof User,
      modelMock() as unknown as typeof Role,
      modelMock() as unknown as typeof UserRole,
      { destroy: jest.fn() } as unknown as typeof UserSession,
      sequelizeMock() as unknown as Sequelize,
      { get: jest.fn() } as unknown as ConfigService,
      { hasPermission: jest.fn() } as unknown as AccessControlService,
      storage as unknown as StorageService,
    );
  });

  it('แก้ชื่อเล่นของตัวเองและบันทึกผู้แก้', async () => {
    const row = userRow();
    userModel.findByPk.mockResolvedValue(row);

    await service.updateOwnProfile(5, { nickname: 'ปราณี' });

    expect(row.update).toHaveBeenCalledWith({ nickname: 'ปราณี', updatedBy: 5 });
  });

  it('แก้ชื่อ-นามสกุลพร้อมชื่อเล่นในครั้งเดียว', async () => {
    const row = userRow();
    userModel.findByPk.mockResolvedValue(row);

    await service.updateOwnProfile(5, { fullName: 'ปราณี ใจงาม', nickname: 'นี' });

    expect(row.update).toHaveBeenCalledWith({
      fullName: 'ปราณี ใจงาม',
      nickname: 'นี',
      updatedBy: 5,
    });
  });

  it('ส่ง null = ลบชื่อเล่น · ไม่ส่งเลย = ไม่แตะแถว', async () => {
    const row = userRow();
    userModel.findByPk.mockResolvedValue(row);

    await service.updateOwnProfile(5, { nickname: null });
    await service.updateOwnProfile(5, {});

    expect(row.update).toHaveBeenCalledTimes(1);
    expect(row.update).toHaveBeenCalledWith({ nickname: null, updatedBy: 5 });
  });

  it('อัปโหลดรูปใหม่แล้วลบรูปเดิมของตัวเอง', async () => {
    const row = userRow({ avatarUrl: 'local:users/5/avatar/2026/08/old.png' });
    userModel.findByPk.mockResolvedValue(row);

    await service.setOwnAvatar(5, png());

    const [key, , contentType] = storage.put.mock.calls[0] as [string, Buffer, string];
    expect(key).toMatch(/^users\/5\/avatar\/.+\.png$/);
    expect(contentType).toBe('image/png');
    expect(row.update).toHaveBeenCalledWith({
      avatarUrl: 'local:users/5/avatar/2026/09/new.png',
      updatedBy: 5,
    });
    expect(storage.delete).toHaveBeenCalledWith('local:users/5/avatar/2026/08/old.png');
  });

  it('ไม่ลบไฟล์ที่ไม่ใช่รูปโปรไฟล์ของตัวเอง (ค่าเก่าที่เป็นลิงก์ภายนอก)', async () => {
    const row = userRow({ avatarUrl: 'https://example.com/me.png' });
    userModel.findByPk.mockResolvedValue(row);

    await service.setOwnAvatar(5, png());

    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('ลบไฟล์เก่าไม่สำเร็จไม่ทำให้การอัปโหลดพัง', async () => {
    userModel.findByPk.mockResolvedValue(
      userRow({ avatarUrl: 'local:users/5/avatar/2026/08/old.png' }),
    );
    storage.delete.mockRejectedValue(new Error('disk busy'));

    await expect(service.setOwnAvatar(5, png())).resolves.toBeUndefined();
  });

  it('ปฏิเสธไฟล์ที่ไม่ใช่ JPG/PNG/WEBP ก่อนขึ้นที่เก็บ', async () => {
    await expect(
      service.setOwnAvatar(5, { ...png(), originalname: 'me.gif', mimetype: 'image/gif' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.setOwnAvatar(5, undefined)).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('ลบรูปโปรไฟล์ = ล้างค่าและลบไฟล์', async () => {
    const row = userRow({ avatarUrl: 'local:users/5/avatar/2026/08/old.png' });
    userModel.findByPk.mockResolvedValue(row);

    await service.removeOwnAvatar(5);

    expect(row.update).toHaveBeenCalledWith({ avatarUrl: null, updatedBy: 5 });
    expect(storage.delete).toHaveBeenCalledWith('local:users/5/avatar/2026/08/old.png');
  });

  it('ดาวน์โหลดได้เฉพาะ key ในโฟลเดอร์รูปโปรไฟล์ของคนนั้น', async () => {
    userModel.findByPk.mockResolvedValue(userRow({ avatarUrl: 'local:projects/1/2026/09/x.pdf' }));

    await expect(service.openAvatar(5)).rejects.toBeInstanceOf(NotFoundException);
    expect(storage.get).not.toHaveBeenCalled();
  });
});
