import { Injectable } from '@nestjs/common';

import { AccessControlService } from '../../common/services/access-control.service';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { FollowUpsService } from '../follow-ups/follow-ups.service';
import { MaContractsService } from '../ma/ma-contracts.service';
import { TasksService } from '../projects/tasks.service';
import { TicketsService } from '../tickets/tickets.service';
import { WarrantiesService } from '../warranties/warranties.service';
import type { NavCountsDto } from './dto/nav-counts.response';

/** ช่วง "ใกล้หมด" ของ badge ประกันและสัญญา MA — ตรงกับค่าเริ่มต้นของหน้ารายการ */
export const EXPIRING_SOON_DAYS = 30;

/**
 * รวมตัวเลข badge ของเมนูไว้ในคำขอเดียว — ตัวนับทุกตัวอยู่ใน service เจ้าของหน้ารายการ
 * ใช้ where ชุดเดียวกับหน้านั้น ที่นี่มีหน้าที่แค่ตัดสินว่าผู้ใช้มีสิทธิ์เห็นช่องไหน
 * ด้วยสิทธิ์ตัวเดียวกับที่ guard ของหน้ารายการใช้
 */
@Injectable()
export class NavService {
  constructor(
    private readonly accessControl: AccessControlService,
    private readonly ticketsService: TicketsService,
    private readonly tasksService: TasksService,
    private readonly followUpsService: FollowUpsService,
    private readonly warrantiesService: WarrantiesService,
    private readonly maContractsService: MaContractsService,
  ) {}

  async getCounts(user: AuthenticatedUser): Promise<NavCountsDto> {
    const [
      canAssign,
      canSupportQueue,
      canViewTickets,
      canReviewTasks,
      canViewTasks,
      canViewFollowUps,
      canViewWarranties,
      canViewMa,
    ] = await Promise.all(
      [
        'ticket.assign',
        'ticket.support_queue',
        'ticket.view',
        'task.review',
        'task.view',
        'followup.view',
        'warranty.view',
        'ma.view',
      ].map((code) => this.accessControl.hasPermission(user, code)),
    );

    const [
      ticketAdminQueue,
      ticketSupportQueue,
      ticketsMineOpen,
      taskReviewsPending,
      tasksMeOpen,
      tasksMeRejected,
      followUpsMineDue,
      warrantiesExpiringSoon,
      maContractsExpiringSoon,
    ] = await Promise.all([
      canAssign ? this.ticketsService.countAdminQueue() : null,
      canSupportQueue ? this.ticketsService.countSupportQueue() : null,
      canViewTickets ? this.ticketsService.countOpenAssignedTo(user.id) : null,
      canReviewTasks ? this.tasksService.countPendingReviews(user) : null,
      canViewTasks ? this.tasksService.countMyOpenTasks(user.id) : null,
      canViewTasks ? this.tasksService.countRejectedMyTasks(user.id) : null,
      canViewFollowUps ? this.followUpsService.countMineDue(user.id) : null,
      canViewWarranties ? this.warrantiesService.countExpiring(EXPIRING_SOON_DAYS) : null,
      canViewMa ? this.maContractsService.countExpiring(EXPIRING_SOON_DAYS) : null,
    ]);

    return {
      ticketAdminQueue,
      ticketSupportQueue,
      ticketsMineOpen,
      taskReviewsPending,
      tasksMeOpen,
      tasksMeRejected,
      followUpsMineDue,
      warrantiesExpiringSoon,
      maContractsExpiringSoon,
    };
  }
}
