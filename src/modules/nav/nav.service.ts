import { Injectable } from '@nestjs/common';

import { AccessControlService } from '../../common/services/access-control.service';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { TasksService } from '../projects/tasks.service';
import { TicketsService } from '../tickets/tickets.service';
import type { NavCountsDto } from './dto/nav-counts.response';

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
  ) {}

  async getCounts(user: AuthenticatedUser): Promise<NavCountsDto> {
    const [canAssign, canSupportQueue, canViewTickets, canReviewTasks, canViewTasks] =
      await Promise.all(
        ['ticket.assign', 'ticket.support_queue', 'ticket.view', 'task.review', 'task.view'].map(
          (code) => this.accessControl.hasPermission(user, code),
        ),
      );

    const [
      ticketAdminQueue,
      ticketSupportQueue,
      ticketsMineOpen,
      taskReviewsPending,
      tasksMeRejected,
    ] = await Promise.all([
      canAssign ? this.ticketsService.countAdminQueue() : null,
      canSupportQueue ? this.ticketsService.countSupportQueue() : null,
      canViewTickets ? this.ticketsService.countOpenAssignedTo(user.id) : null,
      canReviewTasks ? this.tasksService.countPendingReviews(user) : null,
      canViewTasks ? this.tasksService.countRejectedMyTasks(user.id) : null,
    ]);

    return {
      ticketAdminQueue,
      ticketSupportQueue,
      ticketsMineOpen,
      taskReviewsPending,
      tasksMeRejected,
    };
  }
}
