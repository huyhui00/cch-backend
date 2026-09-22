/// <reference types="jest" />

import { ForbiddenException } from '@nestjs/common';

import { AccessControlService } from '../../common/services/access-control.service';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { AccountType, Notification, NotificationStatus, User } from '../../models';
import { LineMessagingService } from './line-messaging.service';
import { NotificationsService } from './notifications.service';

function modelMock() {
  return {
    findByPk: jest.fn(),
    findAndCountAll: jest.fn(),
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
    expect(notificationModel.findAndCountAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ targetUserId: 5 }),
      }),
    );
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
});
