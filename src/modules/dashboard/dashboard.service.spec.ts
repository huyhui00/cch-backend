/// <reference types="jest" />
import { DashboardGroupBy } from './dashboard-range';
import { DashboardService } from './dashboard.service';

describe('DashboardService.getMine', () => {
  const user = { id: 8, accountType: 'USER' } as never;
  const query = { dateFrom: '2026-09-01', dateTo: '2026-09-14', groupBy: DashboardGroupBy.WEEK };

  function setup(granted: string[]) {
    const accessControl = {
      hasPermission: jest.fn((_user: unknown, code: string) =>
        Promise.resolve(granted.includes(code)),
      ),
    };
    const projectModel = {
      findAll: jest.fn().mockResolvedValue([{ actualEndDate: '2026-09-10' }]),
      count: jest.fn().mockResolvedValue(2),
    };
    const taskModel = {
      findAll: jest
        .fn()
        .mockResolvedValue([
          { completedAt: new Date(2026, 8, 1, 9) },
          { completedAt: new Date(2026, 8, 2, 23, 30) },
          { completedAt: new Date(2026, 8, 8, 10) },
        ]),
    };
    const resolutionModel = { findAll: jest.fn().mockResolvedValue([]) };
    const followUpModel = { findAll: jest.fn().mockResolvedValue([]) };
    const communicationModel = {
      findAll: jest.fn().mockResolvedValue([{ occurredAt: new Date(2026, 8, 14, 18) }]),
    };
    const service = new DashboardService(
      accessControl as never,
      projectModel as never,
      taskModel as never,
      resolutionModel as never,
      followUpModel as never,
      communicationModel as never,
    );
    return { service, projectModel, taskModel, resolutionModel };
  }

  it('นับรวมและแบ่งช่วงตามวันที่ ช่วงที่ไม่มีข้อมูลเป็น 0', async () => {
    const { service } = setup([
      'project.view',
      'task.view',
      'ticket.view',
      'followup.view',
      'communication.view',
    ]);

    const result = await service.getMine(user, query);

    expect(result.totals).toEqual({
      projectsDelivered: 1,
      tasksCompleted: 3,
      ticketRoundsResolved: 0,
      followUpsCompleted: 0,
      communicationsLogged: 1,
    });
    expect(result.projectsInProgress).toBe(2);
    expect(result.series).toEqual([
      {
        periodStart: '2026-09-01',
        periodEnd: '2026-09-06',
        projectsDelivered: 0,
        tasksCompleted: 2,
        ticketRoundsResolved: 0,
        followUpsCompleted: 0,
        communicationsLogged: 0,
      },
      {
        periodStart: '2026-09-07',
        periodEnd: '2026-09-13',
        projectsDelivered: 1,
        tasksCompleted: 1,
        ticketRoundsResolved: 0,
        followUpsCompleted: 0,
        communicationsLogged: 0,
      },
      {
        periodStart: '2026-09-14',
        periodEnd: '2026-09-14',
        projectsDelivered: 0,
        tasksCompleted: 0,
        ticketRoundsResolved: 0,
        followUpsCompleted: 0,
        communicationsLogged: 1,
      },
    ]);
  });

  it('ทุก query กรองด้วย id ของผู้เรียกเท่านั้น', async () => {
    const { service, projectModel, taskModel, resolutionModel } = setup([
      'project.view',
      'task.view',
      'ticket.view',
    ]);

    await service.getMine(user, query);

    const [projectArgs] = projectModel.findAll.mock.calls[0] as [
      { where: { managerUserId: number } },
    ];
    const [taskArgs] = taskModel.findAll.mock.calls[0] as [{ where: { assignedUserId: number } }];
    const [resolutionArgs] = resolutionModel.findAll.mock.calls[0] as [
      { where: { resolvedByUserId: number } },
    ];
    expect(projectArgs.where.managerUserId).toBe(8);
    expect(taskArgs.where.assignedUserId).toBe(8);
    expect(resolutionArgs.where.resolvedByUserId).toBe(8);
  });

  it('ไม่มีสิทธิ์หน้าไหน ช่องนั้นเป็น null ทั้งยอดรวมและทุกช่วง และไม่ query', async () => {
    const { service, projectModel, taskModel } = setup(['task.view']);

    const result = await service.getMine(user, query);

    expect(result.totals.projectsDelivered).toBeNull();
    expect(result.totals.tasksCompleted).toBe(3);
    expect(result.projectsInProgress).toBeNull();
    expect(result.series.every((point) => point.projectsDelivered === null)).toBe(true);
    expect(projectModel.findAll).not.toHaveBeenCalled();
    expect(projectModel.count).not.toHaveBeenCalled();
    expect(taskModel.findAll).toHaveBeenCalled();
  });
});
