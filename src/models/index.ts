import { Attachment } from './attachment.model';
import { AuditLog } from './audit-log.model';
import { CommunicationLog } from './communication-log.model';
import { Contact } from './contact.model';
import { Customer } from './customer.model';
import { Delivery } from './delivery.model';
import { Document } from './document.model';
import { FollowUp } from './follow-up.model';
import { MaAddon } from './ma-addon.model';
import { MaContract } from './ma-contract.model';
import { MaPlanItem } from './ma-plan-item.model';
import { MaPlan } from './ma-plan.model';
import { MaUsage } from './ma-usage.model';
import { NotificationRule } from './notification-rule.model';
import { Notification } from './notification.model';
import { Permission } from './permission.model';
import { RolePermission } from './role-permission.model';
import { Role } from './role.model';
import { Project } from './project.model';
import { SurveyAnswer } from './survey-answer.model';
import { SurveyAssignment } from './survey-assignment.model';
import { SurveyQuestion } from './survey-question.model';
import { SurveyResponse } from './survey-response.model';
import { Survey } from './survey.model';
import { Task } from './task.model';
import { TaskSubmission } from './task-submission.model';
import { TicketResolution } from './ticket-resolution.model';
import { Ticket } from './ticket.model';
import { UserRole } from './user-role.model';
import { User } from './user.model';
import { Warranty } from './warranty.model';

export * from './base.model';
export * from './attachment.model';
export * from './audit-log.model';
export * from './communication-log.model';
export * from './contact.model';
export * from './customer.model';
export * from './delivery.model';
export * from './document.model';
export * from './follow-up.model';
export * from './ma-addon.model';
export * from './ma-contract.model';
export * from './ma-plan-item.model';
export * from './ma-plan.model';
export * from './ma-usage.model';
export * from './notification-rule.model';
export * from './notification.model';
export * from './permission.model';
export * from './project.model';
export * from './role-permission.model';
export * from './role.model';
export * from './survey-answer.model';
export * from './survey-assignment.model';
export * from './survey-question.model';
export * from './survey-response.model';
export * from './survey.model';
export * from './task.model';
export * from './task-submission.model';
export * from './ticket-resolution.model';
export * from './ticket.model';
export * from './user-role.model';
export * from './user.model';
export * from './warranty.model';

export const ALL_MODELS = [
  User,
  Role,
  Permission,
  UserRole,
  RolePermission,
  AuditLog,
  Customer,
  Contact,
  CommunicationLog,
  FollowUp,
  Project,
  Task,
  TaskSubmission,
  Delivery,
  Warranty,
  Document,
  MaPlan,
  MaPlanItem,
  MaContract,
  MaAddon,
  MaUsage,
  Ticket,
  TicketResolution,
  Attachment,
  Survey,
  SurveyQuestion,
  SurveyAssignment,
  SurveyResponse,
  SurveyAnswer,
  NotificationRule,
  Notification,
];
