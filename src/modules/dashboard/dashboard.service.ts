import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, type WhereOptions } from 'sequelize';

import { AccessControlService } from '../../common/services/access-control.service';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { addDays, toDateOnly } from '../../common/utils/date.util';
import { CommunicationLog } from '../../models/communication-log.model';
import { FollowUp, FollowUpStatus } from '../../models/follow-up.model';
import { Project, ProjectStatus } from '../../models/project.model';
import { Task, TaskStatus } from '../../models/task.model';
import { TicketResolution } from '../../models/ticket-resolution.model';
import {
  bucketStartOf,
  buildBuckets,
  type DashboardRange,
  resolveDashboardRange,
} from './dashboard-range';
import type { QueryMyDashboardDto } from './dto/dashboard.dto';
import type { DashboardMetricsDto, MyDashboardDto } from './dto/dashboard.response';

type MetricKey = keyof DashboardMetricsDto;

const METRIC_KEYS: MetricKey[] = [
  'projectsDelivered',
  'tasksCompleted',
  'ticketRoundsResolved',
  'followUpsCompleted',
  'communicationsLogged',
];

const METRIC_PERMISSIONS: Record<MetricKey, string> = {
  projectsDelivered: 'project.view',
  tasksCompleted: 'task.view',
  ticketRoundsResolved: 'ticket.view',
  followUpsCompleted: 'followup.view',
  communicationsLogged: 'communication.view',
};

/**
 * แดชบอร์ดรายคน (Q21) — ข้อมูลของผู้เรียกเท่านั้น ไม่มีทางระบุคนอื่น แม้เป็น SUPER_ADMIN
 * นับเฉพาะสิ่งที่ทำไปแล้ว ไม่ประเมิน ไม่เทียบกับใคร (ระบบนี้ไม่ใช่ระบบ HR)
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly accessControl: AccessControlService,
    @InjectModel(Project) private readonly projectModel: typeof Project,
    @InjectModel(Task) private readonly taskModel: typeof Task,
    @InjectModel(TicketResolution) private readonly resolutionModel: typeof TicketResolution,
    @InjectModel(FollowUp) private readonly followUpModel: typeof FollowUp,
    @InjectModel(CommunicationLog) private readonly communicationModel: typeof CommunicationLog,
  ) {}

  async getMine(user: AuthenticatedUser, query: QueryMyDashboardDto): Promise<MyDashboardDto> {
    const range = resolveDashboardRange(query);

    const allowed = new Map<MetricKey, boolean>();
    await Promise.all(
      METRIC_KEYS.map(async (key) => {
        allowed.set(key, await this.accessControl.hasPermission(user, METRIC_PERMISSIONS[key]));
      }),
    );

    const dates = new Map<MetricKey, string[] | null>();
    await Promise.all(
      METRIC_KEYS.map(async (key) => {
        dates.set(key, allowed.get(key) ? await this.loadDates(key, user.id, range) : null);
      }),
    );

    const buckets = buildBuckets(range);
    const series = buckets.map((bucket) => ({ ...bucket, ...this.emptyMetrics(dates) }));
    const indexByStart = new Map(series.map((point, index) => [point.periodStart, index]));

    for (const key of METRIC_KEYS) {
      for (const date of dates.get(key) ?? []) {
        const start = bucketStartOf(date, range.groupBy);
        const index = indexByStart.get(start < range.dateFrom ? range.dateFrom : start);
        if (index !== undefined) {
          (series[index][key] as number) += 1;
        }
      }
    }

    const totals = this.emptyMetrics(dates);
    for (const key of METRIC_KEYS) {
      const rows = dates.get(key);
      totals[key] = rows ? rows.length : null;
    }

    const projectsInProgress = allowed.get('projectsDelivered')
      ? await this.projectModel.count({
          where: {
            managerUserId: user.id,
            status: { [Op.in]: [ProjectStatus.DRAFT, ProjectStatus.IN_PROGRESS] },
          },
        })
      : null;

    return {
      period: range.period,
      dateFrom: range.dateFrom,
      dateTo: range.dateTo,
      groupBy: range.groupBy,
      totals,
      projectsInProgress,
      series,
    };
  }

  private emptyMetrics(dates: Map<MetricKey, string[] | null>): DashboardMetricsDto {
    const metrics = {} as DashboardMetricsDto;
    for (const key of METRIC_KEYS) {
      metrics[key] = dates.get(key) === null ? null : 0;
    }
    return metrics;
  }

  private async loadDates(
    key: MetricKey,
    userId: number,
    range: DashboardRange,
  ): Promise<string[]> {
    const timeRange = {
      [Op.gte]: this.startOfLocalDay(range.dateFrom),
      [Op.lt]: this.startOfLocalDay(addDays(range.dateTo, 1)),
    };

    switch (key) {
      case 'projectsDelivered': {
        const rows = await this.projectModel.findAll({
          attributes: ['id', 'actualEndDate'],
          where: {
            managerUserId: userId,
            status: { [Op.ne]: ProjectStatus.CANCELLED },
            actualEndDate: { [Op.between]: [range.dateFrom, range.dateTo] },
          } as WhereOptions<Project>,
        });
        return rows.map((row) => row.actualEndDate as string);
      }
      case 'tasksCompleted': {
        const rows = await this.taskModel.findAll({
          attributes: ['id', 'completedAt'],
          where: { assignedUserId: userId, status: TaskStatus.DONE, completedAt: timeRange },
        });
        return rows.map((row) => toDateOnly(row.completedAt as Date));
      }
      case 'ticketRoundsResolved': {
        const rows = await this.resolutionModel.findAll({
          attributes: ['id', 'resolvedAt'],
          where: { resolvedByUserId: userId, resolvedAt: timeRange },
        });
        return rows.map((row) => toDateOnly(row.resolvedAt));
      }
      case 'followUpsCompleted': {
        const rows = await this.followUpModel.findAll({
          attributes: ['id', 'completedAt'],
          where: { assignedUserId: userId, status: FollowUpStatus.DONE, completedAt: timeRange },
        });
        return rows.map((row) => toDateOnly(row.completedAt as Date));
      }
      case 'communicationsLogged': {
        const rows = await this.communicationModel.findAll({
          attributes: ['id', 'occurredAt'],
          where: { handledByUserId: userId, occurredAt: timeRange },
        });
        return rows.map((row) => toDateOnly(row.occurredAt));
      }
    }
  }

  private startOfLocalDay(dateOnly: string): Date {
    const [year, month, day] = dateOnly.split('-').map(Number);
    return new Date(year, month - 1, day);
  }
}
