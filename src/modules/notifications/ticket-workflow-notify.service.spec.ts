/// <reference types="jest" />

import { Op } from 'sequelize';

import {
  Notification,
  NotificationEventType,
  NotificationStatus,
  Permission,
  Role,
  RolePermission,
  User,
  UserRole,
  UserStatus,
} from '../../models';
import { TicketWorkflowNotifyService } from './ticket-workflow-notify.service';

function modelMock() {
  return {
    findAll: jest.fn(),
    findOne: jest.fn(),
    findByPk: jest.fn(),
    create: jest.fn(),
  };
}

describe('TicketWorkflowNotifyService', () => {
  const notificationModel = modelMock();
  const userModel = modelMock();
  const userRoleModel = modelMock();
  const permissionModel = modelMock();
  const rolePermissionModel = modelMock();
  const roleModel = modelMock();

  const service = new TicketWorkflowNotifyService(
    notificationModel as unknown as typeof Notification,
    userModel as unknown as typeof User,
    userRoleModel as unknown as typeof UserRole,
    permissionModel as unknown as typeof Permission,
    rolePermissionModel as unknown as typeof RolePermission,
    roleModel as unknown as typeof Role,
  );

  const ticket = {
    id: 42,
    ticketNo: 'TK69-0042',
    title: 'ระบบค้างตอนสแกน',
    claimedByAdminUserId: 2,
    receivedByUserId: 5,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    userModel.findAll.mockResolvedValue([{ id: 2 }, { id: 1 }]);
    permissionModel.findOne.mockResolvedValue(null);
    notificationModel.findOne.mockResolvedValue(null);
    userModel.findByPk.mockImplementation((id: number) =>
      Promise.resolve({ id, status: UserStatus.ACTIVE }),
    );
    notificationModel.create.mockResolvedValue({});
  });

  it('notifySentToAdmin สร้างแจ้งเตือนให้คนที่จัดแจงได้ ยกเว้นคนกดเอง', async () => {
    await service.notifySentToAdmin(ticket, 2);

    expect(notificationModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        targetUserId: 1,
        eventType: NotificationEventType.TICKET_SENT_TO_ADMIN,
        refType: 'TICKET',
        refId: 42,
        status: NotificationStatus.SENT,
        ruleId: null,
      }),
    );
    expect(notificationModel.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ targetUserId: 2 }),
    );
  });

  it('notifyAwaitingReview ส่งให้แอดมินผู้รับคิวเป็นหลัก', async () => {
    await service.notifyAwaitingReview(ticket, 4);

    expect(notificationModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        targetUserId: 2,
        eventType: NotificationEventType.TICKET_AWAITING_REVIEW,
        refId: 42,
      }),
    );
  });

  it('notifyReturnedToSupport ส่งให้ผู้รับเรื่อง', async () => {
    await service.notifyReturnedToSupport(ticket, 2);

    expect(notificationModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        targetUserId: 5,
        eventType: NotificationEventType.TICKET_RETURNED_TO_SUPPORT,
        refId: 42,
      }),
    );
  });

  it('notifyAssigned ส่งให้พนักงานที่ถูกมอบหมาย', async () => {
    await service.notifyAssigned({ ...ticket, assignedUserId: 9 }, 2);

    expect(notificationModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        targetUserId: 9,
        eventType: NotificationEventType.TICKET_ASSIGNED,
        refId: 42,
        status: NotificationStatus.SENT,
        ruleId: null,
      }),
    );
  });

  it('notifyAssigned ไม่สร้างเมื่อถอนการมอบหมาย', async () => {
    await service.notifyAssigned({ ...ticket, assignedUserId: null }, 2);

    expect(notificationModel.create).not.toHaveBeenCalled();
  });

  it('ไม่สร้างซ้ำถ้ายังมีแจ้งเตือนเดิมของใบนี้ที่ยังไม่อ่าน', async () => {
    notificationModel.findOne.mockResolvedValue({ id: 99 });

    await service.notifySentToAdmin(ticket, null);

    expect(notificationModel.create).not.toHaveBeenCalled();
  });

  it('กันซ้ำด้วย "ยังไม่อ่าน" ไม่ใช่วันเดียวกัน — ตีกลับแล้วส่งตรวจใหม่ในวันเดียวต้องแจ้งอีกรอบ', async () => {
    await service.notifyAwaitingReview(ticket, 4);

    const [[query]] = notificationModel.findOne.mock.calls as [
      [{ where: Record<string, unknown> }],
    ];
    expect(query.where).not.toHaveProperty('createdAt');
    expect(query.where.status).toEqual({ [Op.ne]: NotificationStatus.READ });
  });

  it('notifyReviewRejected ส่งให้ผู้แก้พร้อมเหตุผล', async () => {
    await service.notifyReviewRejected({ ...ticket, assignedUserId: 9 }, 2, 'หน้ารายงานยังค้าง');

    const [[created]] = notificationModel.create.mock.calls as [[Record<string, unknown>]];
    expect(created).toMatchObject({
      targetUserId: 9,
      eventType: NotificationEventType.TICKET_REVIEW_REJECTED,
      refId: 42,
    });
    expect(created.message).toContain('หน้ารายงานยังค้าง');
  });

  it('notifyReviewRejected ไม่สร้างเมื่อใบไม่มีผู้แก้', async () => {
    await service.notifyReviewRejected({ ...ticket, assignedUserId: null }, 2, 'x');

    expect(notificationModel.create).not.toHaveBeenCalled();
  });

  it('findTicketAssignUserIds รวม USER ที่ถือ ticket.assign', async () => {
    userModel.findAll.mockResolvedValueOnce([{ id: 2 }]).mockResolvedValueOnce([{ id: 9 }]);
    permissionModel.findOne.mockResolvedValue({ id: 77 });
    rolePermissionModel.findAll.mockResolvedValue([{ roleId: 3 }]);
    roleModel.findAll.mockResolvedValue([{ id: 3 }]);
    userRoleModel.findAll.mockResolvedValue([{ userId: 9 }]);

    const ids = await service.findTicketAssignUserIds();

    expect(ids.sort()).toEqual([2, 9]);
    expect(permissionModel.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { code: 'ticket.assign' } }),
    );
    const [roleQuery] = roleModel.findAll.mock.calls[0] as [
      { where: { isActive: boolean; id: { [Op.in]: number[] } } },
    ];
    expect(roleQuery.where.isActive).toBe(true);
    expect(roleQuery.where.id[Op.in]).toEqual([3]);
  });
});
