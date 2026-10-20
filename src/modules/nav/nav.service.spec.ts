/// <reference types="jest" />
import { EXPIRING_SOON_DAYS, NavService } from './nav.service';

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
      countMyOpenTasks: jest.fn().mockResolvedValue(3),
      countRejectedMyTasks: jest.fn().mockResolvedValue(1),
    };
    const followUpsService = { countMineDue: jest.fn().mockResolvedValue(6) };
    const warrantiesService = { countExpiring: jest.fn().mockResolvedValue(7) };
    const maContractsService = { countExpiring: jest.fn().mockResolvedValue(9) };
    const service = new NavService(
      accessControl as never,
      ticketsService as never,
      tasksService as never,
      followUpsService as never,
      warrantiesService as never,
      maContractsService as never,
    );
    return {
      service,
      ticketsService,
      tasksService,
      followUpsService,
      warrantiesService,
      maContractsService,
    };
  }

  it('มีสิทธิ์ครบ = ได้ตัวเลขทุกช่อง', async () => {
    const { service } = setup([
      'ticket.assign',
      'ticket.support_queue',
      'ticket.view',
      'task.review',
      'task.view',
      'followup.view',
      'warranty.view',
      'ma.view',
    ]);

    await expect(service.getCounts(user)).resolves.toEqual({
      ticketAdminQueue: { AWAITING_CLAIM: 2, CLAIMED: 1, AWAITING_REVIEW: 0, WITH_SUPPORT: 3 },
      ticketSupportQueue: { AWAITING_SEND: 1, RETURNED: 0 },
      ticketsMineOpen: 4,
      taskReviewsPending: 5,
      tasksMeOpen: 3,
      tasksMeRejected: 1,
      followUpsMineDue: 6,
      warrantiesExpiringSoon: 7,
      maContractsExpiringSoon: 9,
    });
  });

  it('ไม่มีสิทธิ์ = null ไม่ใช่ 0 และไม่ query ช่องนั้นเลย', async () => {
    const {
      service,
      ticketsService,
      tasksService,
      followUpsService,
      warrantiesService,
      maContractsService,
    } = setup(['ticket.view']);

    await expect(service.getCounts(user)).resolves.toEqual({
      ticketAdminQueue: null,
      ticketSupportQueue: null,
      ticketsMineOpen: 4,
      taskReviewsPending: null,
      tasksMeOpen: null,
      tasksMeRejected: null,
      followUpsMineDue: null,
      warrantiesExpiringSoon: null,
      maContractsExpiringSoon: null,
    });
    expect(ticketsService.countAdminQueue).not.toHaveBeenCalled();
    expect(ticketsService.countSupportQueue).not.toHaveBeenCalled();
    expect(tasksService.countPendingReviews).not.toHaveBeenCalled();
    expect(tasksService.countMyOpenTasks).not.toHaveBeenCalled();
    expect(followUpsService.countMineDue).not.toHaveBeenCalled();
    expect(warrantiesService.countExpiring).not.toHaveBeenCalled();
    expect(maContractsService.countExpiring).not.toHaveBeenCalled();
  });

  it('นับของผู้เรียกเอง และช่วงใกล้หมดเท่ากับค่าเริ่มต้นของหน้ารายการ', async () => {
    const {
      service,
      ticketsService,
      tasksService,
      followUpsService,
      warrantiesService,
      maContractsService,
    } = setup(['ticket.view', 'task.view', 'followup.view', 'warranty.view', 'ma.view']);

    await service.getCounts(user);

    expect(ticketsService.countOpenAssignedTo).toHaveBeenCalledWith(8);
    expect(tasksService.countMyOpenTasks).toHaveBeenCalledWith(user);
    expect(tasksService.countRejectedMyTasks).toHaveBeenCalledWith(user);
    expect(followUpsService.countMineDue).toHaveBeenCalledWith(8);
    expect(EXPIRING_SOON_DAYS).toBe(30);
    expect(warrantiesService.countExpiring).toHaveBeenCalledWith(30);
    expect(maContractsService.countExpiring).toHaveBeenCalledWith(30);
  });
});
