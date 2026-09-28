/// <reference types="jest" />
import { NavService } from './nav.service';

describe('NavService.getCounts', () => {
  const user = { id: 8, accountType: 'USER' } as never;

  function setup(granted: string[]) {
    const accessControl = {
      hasPermission: jest.fn((_user: unknown, code: string) =>
        Promise.resolve(granted.includes(code)),
      ),
    };
    const ticketsService = {
      countAdminQueue: jest.fn().mockResolvedValue({
        AWAITING_CLAIM: 2,
        CLAIMED: 1,
        AWAITING_REVIEW: 0,
        WITH_SUPPORT: 3,
      }),
      countSupportQueue: jest.fn().mockResolvedValue({ AWAITING_SEND: 1, RETURNED: 0 }),
      countOpenAssignedTo: jest.fn().mockResolvedValue(4),
    };
    const tasksService = {
      countPendingReviews: jest.fn().mockResolvedValue(5),
      countRejectedMyTasks: jest.fn().mockResolvedValue(1),
    };
    const service = new NavService(
      accessControl as never,
      ticketsService as never,
      tasksService as never,
    );
    return { service, ticketsService, tasksService };
  }

  it('มีสิทธิ์ครบ = ได้ตัวเลขทุกช่อง', async () => {
    const { service } = setup([
      'ticket.assign',
      'ticket.support_queue',
      'ticket.view',
      'task.review',
      'task.view',
    ]);

    await expect(service.getCounts(user)).resolves.toEqual({
      ticketAdminQueue: { AWAITING_CLAIM: 2, CLAIMED: 1, AWAITING_REVIEW: 0, WITH_SUPPORT: 3 },
      ticketSupportQueue: { AWAITING_SEND: 1, RETURNED: 0 },
      ticketsMineOpen: 4,
      taskReviewsPending: 5,
      tasksMeRejected: 1,
    });
  });

  it('ไม่มีสิทธิ์ = null ไม่ใช่ 0 และไม่ query ช่องนั้นเลย', async () => {
    const { service, ticketsService, tasksService } = setup(['ticket.view', 'task.view']);

    await expect(service.getCounts(user)).resolves.toEqual({
      ticketAdminQueue: null,
      ticketSupportQueue: null,
      ticketsMineOpen: 4,
      taskReviewsPending: null,
      tasksMeRejected: 1,
    });
    expect(ticketsService.countAdminQueue).not.toHaveBeenCalled();
    expect(ticketsService.countSupportQueue).not.toHaveBeenCalled();
    expect(tasksService.countPendingReviews).not.toHaveBeenCalled();
  });

  it('นับใบ/งานของผู้เรียกเอง', async () => {
    const { service, ticketsService, tasksService } = setup(['ticket.view', 'task.view']);

    await service.getCounts(user);

    expect(ticketsService.countOpenAssignedTo).toHaveBeenCalledWith(8);
    expect(tasksService.countRejectedMyTasks).toHaveBeenCalledWith(8);
  });
});
