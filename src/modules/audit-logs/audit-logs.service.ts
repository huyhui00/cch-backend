import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { literal, Op, type Order, type WhereOptions } from 'sequelize';

import {
  type PaginatedResult,
  SortOrder,
  toPaginatedResult,
} from '../../common/dto/pagination.dto';
import {
  type CursorPaginatedResult,
  decodeCursor,
  encodeCursor,
  olderThan,
  toCursorResult,
} from '../../common/utils/cursor.util';
import { AuditLog, User } from '../../models';
import { loadAuditRefLabels } from './audit-ref-loader';
import { type AuditLogResponseDto, toAuditLogResponse } from './dto/audit-log.response';
import { QueryAuditLogsDto } from './dto/query-audit-logs.dto';

/** ฟิลด์ที่ยอมให้เรียงลำดับได้ — กันค่าแปลกปลอมจาก query string sortBy หลุดเข้า ORDER BY */
const SORTABLE_FIELDS = new Set(['id', 'createdAt', 'action', 'tableName']);

const NEWEST_FIRST: Order = [
  ['createdAt', 'DESC'],
  ['id', 'DESC'],
];

export type AuditLogPage =
  | (PaginatedResult<AuditLogResponseDto> & { nextCursor: string | null; hasMore: boolean })
  | CursorPaginatedResult<AuditLogResponseDto>;

const SESSION_EVENT_EXCLUSION = literal(
  "NOT (`AuditLog`.`table_name` = 'users' AND `AuditLog`.`action` = 'UPDATE' AND " +
    "COALESCE(JSON_LENGTH(JSON_REMOVE(`AuditLog`.`new_value`, '$.lastLoginAt', '$.refreshTokenHash', " +
    "'$.updatedAt', '$.updatedBy')), 1) = 0)",
);

@Injectable()
export class AuditLogsService {
  constructor(@InjectModel(AuditLog) private readonly auditLogModel: typeof AuditLog) {}

  async findAll(query: QueryAuditLogsDto): Promise<AuditLogPage> {
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

    if (query.excludeTableNames?.length) {
      Object.assign(where, {
        tableName: query.tableName ?? { [Op.notIn]: query.excludeTableNames },
      });
    }

    if (query.hideSessionEvents) {
      Object.assign(where, { [Op.and]: [SESSION_EVENT_EXCLUSION] });
    }

    if (query.hideSystemEvents && query.userId === undefined) {
      Object.assign(where, { userId: { [Op.ne]: null } });
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
    const newestFirst =
      (sortBy === 'createdAt' || sortBy === 'id') && query.sortOrder === SortOrder.DESC;

    const include = [
      {
        model: User,
        attributes: ['id', 'username', 'fullName'],
        required: false,
        // ต้องเห็นชื่อผู้กระทำแม้บัญชีนั้นถูก soft delete ไปแล้ว
        // ซึ่งคือเหตุผลที่ CLAUDE.md 4.3 ห้ามลบ user ทิ้งตั้งแต่แรก
        paranoid: false,
      },
    ];

    if (query.cursor !== undefined) {
      if (!newestFirst) {
        throw new BadRequestException('cursor ใช้ได้เฉพาะการเรียงจากใหม่ไปเก่า');
      }

      const rows = await this.auditLogModel.findAll({
        where: { [Op.and]: [where, olderThan(decodeCursor(query.cursor))] },
        include,
        order: NEWEST_FIRST,
        limit: query.limit + 1,
      });
      const refs = await loadAuditRefLabels(rows.slice(0, query.limit));

      return toCursorResult(rows, query.limit, (row) => toAuditLogResponse(row, refs));
    }

    const { rows, count } = await this.auditLogModel.findAndCountAll({
      where,
      include,
      order: newestFirst
        ? NEWEST_FIRST
        : [
            [sortBy, query.sortOrder],
            ['id', query.sortOrder],
          ],
      limit: query.limit,
      offset: query.offset,
    });

    const refs = await loadAuditRefLabels(rows);
    const hasMore = query.offset + rows.length < count;
    const last = rows[rows.length - 1];

    return {
      ...toPaginatedResult(
        rows.map((row) => toAuditLogResponse(row, refs)),
        count,
        query,
      ),
      nextCursor: newestFirst && hasMore && last ? encodeCursor(last) : null,
      hasMore,
    };
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
