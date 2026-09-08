import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, type WhereOptions } from 'sequelize';

import { type PaginatedResult, toPaginatedResult } from '../../common/dto/pagination.dto';
import { AuditLog, User } from '../../models';
import { type AuditLogResponseDto, toAuditLogResponse } from './dto/audit-log.response';
import { QueryAuditLogsDto } from './dto/query-audit-logs.dto';

/** ฟิลด์ที่ยอมให้เรียงลำดับได้ — กันค่าแปลกปลอมจาก query string sortBy หลุดเข้า ORDER BY */
const SORTABLE_FIELDS = new Set(['id', 'createdAt', 'action', 'tableName']);

/**
 * audit_logs เป็น append-only — service นี้จึงมีแต่การอ่าน
 * ไม่มีเมธอดสร้าง แก้ไข หรือลบ เพราะการเขียนเกิดที่ global hook ที่เดียว (CLAUDE.md 6.4)
 */
@Injectable()
export class AuditLogsService {
  constructor(@InjectModel(AuditLog) private readonly auditLogModel: typeof AuditLog) {}

  async findAll(query: QueryAuditLogsDto): Promise<PaginatedResult<AuditLogResponseDto>> {
    const where: WhereOptions<AuditLog> = {};

    if (query.userId !== undefined) {
      Object.assign(where, { userId: query.userId });
    }

    if (query.tableName) {
      Object.assign(where, { tableName: query.tableName });
    }

    if (query.recordId !== undefined) {
      Object.assign(where, { recordId: query.recordId });
    }

    if (query.action) {
      Object.assign(where, { action: query.action });
    }

    const createdAt = this.buildDateRange(query);

    if (createdAt) {
      Object.assign(where, { createdAt });
    }

    if (query.search) {
      Object.assign(where, {
        [Op.or]: [
          { tableName: { [Op.like]: '%' + query.search + '%' } },
          { action: { [Op.like]: '%' + query.search + '%' } },
        ],
      });
    }

    const sortBy = SORTABLE_FIELDS.has(query.sortBy ?? '') ? (query.sortBy as string) : 'createdAt';

    const { rows, count } = await this.auditLogModel.findAndCountAll({
      where,
      include: [
        {
          model: User,
          attributes: ['id', 'username', 'fullName'],
          required: false,
          // ต้องเห็นชื่อผู้กระทำแม้บัญชีนั้นถูก soft delete ไปแล้ว
          // ซึ่งคือเหตุผลที่ CLAUDE.md 4.3 ห้ามลบ user ทิ้งตั้งแต่แรก
          paranoid: false,
        },
      ],
      order: [[sortBy, query.sortOrder]],
      limit: query.limit,
      offset: query.offset,
    });

    return toPaginatedResult(rows.map(toAuditLogResponse), count, query);
  }

  /**
   * dateFrom / dateTo รวมวันที่ระบุด้วยเสมอ
   * ถ้าส่งมาเป็นวันที่เปล่า ๆ (2026-09-30) จะถูกตีความเป็นสิ้นวันนั้น ไม่ใช่เที่ยงคืนต้นวัน
   * ไม่งั้นการค้น "ถึงวันที่ 30" จะไม่เห็นรายการที่เกิดขึ้นระหว่างวันเลย
   */
  private buildDateRange(query: QueryAuditLogsDto): Record<symbol, Date> | null {
    const range: Record<symbol, Date> = {};

    if (query.dateFrom) {
      range[Op.gte] = new Date(query.dateFrom);
    }

    if (query.dateTo) {
      range[Op.lte] = isDateOnly(query.dateTo)
        ? new Date(query.dateTo + 'T23:59:59.999')
        : new Date(query.dateTo);
    }

    const from = range[Op.gte];
    const to = range[Op.lte];

    if (from && to && from > to) {
      throw new BadRequestException('dateFrom ต้องไม่มากกว่า dateTo');
    }

    return from || to ? range : null;
  }
}

function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}
