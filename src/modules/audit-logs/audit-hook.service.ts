import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import type { Model, ModelStatic, Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

import { getRequestContext } from '../../common/context/request-context';
import { AuditAction, AuditLog } from '../../models';

/**
 * ตารางที่ไม่บันทึก audit
 *
 * audit_logs ต้องอยู่ในรายการนี้เสมอ ไม่งั้นการเขียน audit จะไปกระตุ้น hook ของตัวเอง
 * กลายเป็นลูปไม่รู้จบตั้งแต่ action แรกที่เกิดขึ้นในระบบ
 */
const EXCLUDED_TABLES: ReadonlySet<string> = new Set(['audit_logs']);

/**
 * ฟิลด์ที่ห้ามหลุดเข้า audit log
 *
 * ใส่ทั้งชื่อ attribute (camelCase) และชื่อคอลัมน์ (snake_case) เผื่อกรณีที่ Sequelize
 * ส่งค่ามาคนละรูปแบบกันระหว่าง hook รายแถวกับ hook แบบ bulk
 *
 * refreshTokenHash ถูกปิดด้วยเหตุผลเดียวกับรหัสผ่าน — มันคือกุญแจที่ต่ออายุ session ได้
 * ถ้าเก็บลง audit log คนที่อ่าน log ได้จะสวมสิทธิ์ผู้อื่นได้ทันที
 */
const REDACTED_FIELDS: ReadonlySet<string> = new Set([
  'passwordHash',
  'password_hash',
  'refreshTokenHash',
  'refresh_token_hash',
]);

const REDACTED_PLACEHOLDER = '[REDACTED]';

interface HookOptions {
  transaction?: Transaction | null;
  where?: unknown;
  attributes?: Record<string, unknown>;
  individualHooks?: boolean;
}

@Injectable()
export class AuditHookService implements OnModuleInit {
  private readonly logger = new Logger(AuditHookService.name);

  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    @InjectModel(AuditLog) private readonly auditLogModel: typeof AuditLog,
  ) {}

  onModuleInit(): void {
    this.sequelize.addHook('afterCreate', (instance: Model, options: HookOptions) =>
      this.recordSingle(AuditAction.CREATE, instance, options),
    );

    this.sequelize.addHook('afterUpdate', (instance: Model, options: HookOptions) =>
      this.recordSingle(AuditAction.UPDATE, instance, options),
    );

    this.sequelize.addHook('afterDestroy', (instance: Model, options: HookOptions) =>
      this.recordSingle(AuditAction.DELETE, instance, options),
    );

    // คำสั่งแบบหลายแถวไม่ผ่าน hook รายแถวข้างบน ต้องดักแยก
    // ไม่งั้นการผูก role ให้ผู้ใช้ (bulkCreate) จะไม่ถูกบันทึกเลย ทั้งที่เป็น action
    // ที่ BR-09 ต้องการมากที่สุดอย่างหนึ่ง
    this.sequelize.addHook('afterBulkCreate', (instances: Model[], options: HookOptions) =>
      this.recordBulkCreate(instances, options),
    );

    this.sequelize.addHook('afterBulkUpdate', (options: HookOptions) =>
      this.recordBulkStatement(AuditAction.BULK_UPDATE, options),
    );

    this.sequelize.addHook('afterBulkDestroy', (options: HookOptions) =>
      this.recordBulkStatement(AuditAction.BULK_DELETE, options),
    );

    this.logger.log('ผูก audit hook ที่ระดับ global เรียบร้อย');
  }

  private async recordSingle(
    action: AuditAction,
    instance: Model,
    options: HookOptions,
  ): Promise<void> {
    const tableName = resolveTableName(instance);

    if (EXCLUDED_TABLES.has(tableName)) {
      return;
    }

    const { oldValue, newValue } = this.buildDiff(action, instance);

    if (action === AuditAction.UPDATE && newValue === null) {
      return;
    }

    await this.write(action, tableName, resolveRecordId(instance), oldValue, newValue, options);
  }

  private buildDiff(
    action: AuditAction,
    instance: Model,
  ): { oldValue: unknown; newValue: unknown } {
    const snapshot = () => sanitize(instance.get({ plain: true }) as Record<string, unknown>);

    if (action === AuditAction.CREATE) {
      return { oldValue: null, newValue: snapshot() };
    }

    if (action === AuditAction.DELETE) {
      return { oldValue: snapshot(), newValue: null };
    }

    const changedFields = instance.changed();

    if (!changedFields || changedFields.length === 0) {
      return { oldValue: null, newValue: null };
    }

    const oldValue: Record<string, unknown> = {};
    const newValue: Record<string, unknown> = {};

    for (const field of changedFields) {
      if (REDACTED_FIELDS.has(field)) {
        oldValue[field] = REDACTED_PLACEHOLDER;
        newValue[field] = REDACTED_PLACEHOLDER;
        continue;
      }

      oldValue[field] = normalize(instance.previous(field));
      newValue[field] = normalize(instance.get(field));
    }

    return { oldValue, newValue };
  }

  private async recordBulkCreate(instances: Model[], options: HookOptions): Promise<void> {
    if (options.individualHooks || instances.length === 0) {
      return;
    }

    const tableName = resolveTableName(instances[0]);

    if (EXCLUDED_TABLES.has(tableName)) {
      return;
    }

    for (const instance of instances) {
      await this.write(
        AuditAction.BULK_CREATE,
        tableName,
        resolveRecordId(instance),
        null,
        sanitize(instance.get({ plain: true }) as Record<string, unknown>),
        options,
      );
    }
  }

  private async recordBulkStatement(action: AuditAction, options: HookOptions): Promise<void> {
    const tableName = resolveTableNameFromOptions(options);

    if (!tableName || EXCLUDED_TABLES.has(tableName) || options.individualHooks) {
      return;
    }

    await this.write(
      action,
      tableName,
      null,
      { where: normalize(options.where) },
      options.attributes ? sanitize(options.attributes) : null,
      options,
    );
  }

  /**
   * เขียนใน transaction เดียวกับ action ต้นทาง
   *
   * ผลคือถ้า business logic ถูก rollback แถว audit ก็หายไปด้วย ซึ่งถูกต้อง
   * เพราะ action นั้นไม่เคยเกิดขึ้นจริง และในทางกลับกัน ถ้าเขียน audit ไม่สำเร็จ
   * ทั้งรายการจะล้มทั้งชุด ตีความตาม BR-09 ที่ว่า "ทุก action ต้องบันทึกผู้กระทำ"
   * คือ action ที่บันทึกไม่ได้ ก็ไม่ควรถูกบันทึกลงฐานข้อมูลตั้งแต่แรก
   */
  private async write(
    action: AuditAction,
    tableName: string,
    recordId: number | null,
    oldValue: unknown,
    newValue: unknown,
    options: HookOptions,
  ): Promise<void> {
    const context = getRequestContext();

    await this.auditLogModel.create(
      {
        userId: context?.userId ?? null,
        action,
        tableName,
        recordId,
        oldValue,
        newValue,
        ipAddress: context?.ipAddress ?? null,
        userAgent: context?.userAgent ?? null,
      },
      { transaction: options.transaction ?? undefined },
    );
  }
}

/**
 * getTableName() คืน string เมื่อไม่ได้ใช้ schema แต่คืน object เมื่อใช้
 * ต้องแยกสองกรณี ไม่งั้นจะได้ชื่อตารางเป็น "[object Object]"
 */
function toTableName(model: ModelStatic<Model>): string {
  const name: string | { tableName: string } = model.getTableName();
  return typeof name === 'string' ? name : name.tableName;
}

function resolveTableName(instance: Model): string {
  return toTableName(instance.constructor as ModelStatic<Model>);
}

function resolveTableNameFromOptions(options: HookOptions): string | null {
  const model = (options as { model?: ModelStatic<Model> }).model;
  return model ? toTableName(model) : null;
}

function resolveRecordId(instance: Model): number | null {
  const id: unknown = instance.get('id');
  return typeof id === 'number' ? id : null;
}

function sanitize(values: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(values)) {
    result[key] = REDACTED_FIELDS.has(key) ? REDACTED_PLACEHOLDER : normalize(value);
  }

  return result;
}

function normalize(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'symbol' || typeof value === 'function') {
    return String(value);
  }

  return value;
}
