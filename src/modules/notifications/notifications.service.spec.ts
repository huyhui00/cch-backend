/// <reference types="jest" />

import { ForbiddenException } from '@nestjs/common';
import { Op } from 'sequelize';

import { AccessControlService } from '../../common/services/access-control.service';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { AccountType, Notification, NotificationStatus, User } from '../../models';
import { LineMessagingService } from './line-messaging.service';
import { NotificationsService } from './notifications.service';

type UpdateCall = [Record<string, unknown>, { where: Record<string, unknown> }];

function modelMock() {
  return {
    findByPk: jest.fn(),
    findAndCountAll: jest.fn(),
    update: jest.fn(),
  };
}

describe('NotificationsService', () => {
  const notificationModel = modelMock();
  const userModel = modelMock();
  const lineMessaging = {
    isConfigured: jest.fn().mockReturnValue(true),
    pushText: jest.fn(),
  };
  const accessControl = {
    hasPermission: jest.fn(),
  };

  const service = new NotificationsService(
    notificationModel as unknown as typeof Notification,
    userModel as unknown as typeof User,
    lineMessaging as unknown as LineMessagingService,
    accessControl as unknown as AccessControlService,
  );

  const viewer: AuthenticatedUser = {
    id: 5,
    accountType: AccountType.USER,
    username: 'wichai',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('findAll โดยปกติกรองเฉพาะของตัวเอง', async () => {
    notificationModel.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });
    await service.findAll({ page: 1, limit: 20 } as never, viewer);
    const [options] = notificationModel.findAndCountAll.mock.calls[0] as [
      { where: { targetUserId?: number } },
    ];
    expect(options.where.targetUserId).toBe(5);
  });

  it('findAll ?all=true โดยไม่มี manage ถูกปฏิเสธ', async () => {
    accessControl.hasPermission.mockResolvedValue(false);
    await expect(
      service.findAll({ page: 1, limit: 20, all: true } as never, viewer),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('markRead ตั้งสถานะ READ และใส่ readAt', async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    notificationModel.findByPk.mockResolvedValue({
      id: 9,
      targetUserId: 5,
      status: NotificationStatus.SENT,
      readAt: null,
      update,
    });
    accessControl.hasPermission.mockResolvedValue(false);

    await service.markRead(9, viewer);

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: NotificationStatus.READ,
        updatedBy: 5,
      }),
    );
  });

  it('markAllRead แตะเฉพาะของตัวเองที่ยังไม่อ่าน แม้มี manage', async () => {
    accessControl.hasPermission.mockResolvedValue(true);
    notificationModel.update.mockResolvedValue([3]);

    const result = await service.markAllRead(viewer);

    expect(result).toEqual({ updated: 3 });
    const [values, options] = notificationModel.update.mock.calls[0] as UpdateCall;
    expect(values.status).toBe(NotificationStatus.READ);
    expect(values.updatedBy).toBe(5);
    expect(options.where.targetUserId).toBe(5);
    expect((options.where.status as Record<symbol, unknown>)[Op.ne]).toBe(NotificationStatus.READ);
    expect(options.where).not.toHaveProperty('refType');
  });

  it('markReadByRef กรองด้วย refType + refId ของตัวเอง', async () => {
    notificationModel.update.mockResolvedValue([0]);

    const result = await service.markReadByRef({ refType: 'TICKET', refId: 43 }, viewer);

    expect(result).toEqual({ updated: 0 });
    const [, options] = notificationModel.update.mock.calls[0] as UpdateCall;
    expect(options.where.refType).toBe('TICKET');
    expect(options.where.refId).toBe(43);
    expect(options.where.targetUserId).toBe(5);
  });
});
