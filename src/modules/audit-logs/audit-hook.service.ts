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

/** ค่าที่ Sequelize ส่งเข้า hook มาพร้อมกับ instance */
interface HookOptions {
  transaction?: Transaction | null;
  where?: unknown;
  attributes?: Record<string, unknown>;
  individualHooks?: boolean;
}

/**
 * บันทึก audit log ครั้งเดียวที่ระดับ global hook ของ Sequelize (CLAUDE.md 6.4)
 *
 * ไม่มี service ไหนต้องเรียกอะไรเพิ่มเลย ทุก model ที่ผูกกับ connection นี้ถูกดักครบ
 * รวมถึง model ที่จะเพิ่มใน phase ถัด ๆ ไปด้วย ไม่ต้องมาแก้ไฟล์นี้อีก
 *
 * ---------------------------------------------------------------------------
 * ผู้กระทำมาจากไหน — hook ไม่รู้จัก HTTP request เลย
 * ---------------------------------------------------------------------------
 * Sequelize hook ถูกเรียกลึกอยู่ในชั้น ORM ไม่มีทางเข้าถึง req ได้ และจะส่ง userId
 * ผ่านพารามิเตอร์ก็ไม่ได้ เพราะนั่นเท่ากับต้องไปแก้ทุก service ซึ่งขัดกับ CLAUDE.md 6.4
 *
 * ทางออกคือ AsyncLocalStorage ใน common/context/request-context.ts
 * middleware เปิด context ครอบไว้ตั้งแต่ต้น request แล้วทุกอย่างที่ทำงานต่อจากนั้น
 * ไม่ว่าจะลึกกี่ชั้นหรือผ่าน await กี่ครั้ง ก็อ่าน context เดียวกันได้ผ่าน
 * getRequestContext() โดยไม่ต้องมีใครส่งค่าให้
 */
@Injectable()
export class AuditHookService implements OnModuleInit {
  private readonly logger = new Logger(AuditHookService.name);

  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    @InjectModel(AuditLog) private readonly auditLogModel: typeof AuditLog,
  ) {}

  /**
   * ผูก hook ที่ระดับ connection ครั้งเดียวตอน boot
   * hook ที่ผูกตรงนี้มีผลกับทุก model ที่ลงทะเบียนไว้กับ Sequelize instance นี้
   */
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

  // ---- hook รายแถว --------------------------------------------------------

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

    // แก้ไขแล้วไม่มีฟิลด์ไหนเปลี่ยนจริง ไม่ต้องเปลืองแถวใน audit log
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

    // UPDATE — เก็บเฉพาะฟิลด์ที่เปลี่ยนจริง ไม่เก็บทั้งแถว
    // ทำให้อ่าน log รู้เรื่องทันทีว่าอะไรถูกแก้ และ JSON ไม่บวมโดยไม่จำเป็น
    const changedFields = instance.changed();

    if (!changedFields || changedFields.length === 0) {
      return { oldValue: null, newValue: null };
    }

    const oldValue: Record<string, unknown> = {};
    const newValue: Record<string, unknown> = {};

    for (const field of changedFields) {
      if (REDACTED_FIELDS.has(field)) {
        // ยังบันทึกว่าฟิลด์นี้ถูกแก้ แต่ไม่บันทึกค่า — สำคัญกับการสืบสวนว่าใครเปลี่ยนรหัสผ่านใคร
        oldValue[field] = REDACTED_PLACEHOLDER;
        newValue[field] = REDACTED_PLACEHOLDER;
        continue;
      }

      oldValue[field] = normalize(instance.previous(field));
      newValue[field] = normalize(instance.get(field));
    }

    return { oldValue, newValue };
  }

  // ---- hook แบบหลายแถว ----------------------------------------------------

  private async recordBulkCreate(instances: Model[], options: HookOptions): Promise<void> {
    // ถ้าเปิด individualHooks ไว้ hook รายแถวจะทำงานไปแล้ว บันทึกซ้ำไม่ได้
    if (options.individualHooks || instances.length === 0) {
      return;
    }

    const tableName = resolveTableName(instances[0]);

    if (EXCLUDED_TABLES.has(tableName)) {
      return;
    }

    // bulkCreate ให้ instance ครบทุกแถว จึงบันทึกแยกรายแถวได้เหมือน create ปกติ
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

  /**
   * update / destroy ที่สั่งด้วย where โดยไม่ผ่าน instance
   *
   * ข้อจำกัดที่ต้องรู้: Sequelize ไม่ส่งข้อมูลรายแถวมาให้ในกรณีนี้ จึงบันทึกได้แค่
   * ระดับคำสั่ง (แก้ตารางไหน ด้วยเงื่อนไขอะไร เป็นค่าอะไร) ไม่มีค่าเดิมรายแถว
   * ถ้าตารางไหนต้องการ audit ละเอียดกว่านี้ ให้ service นั้นส่ง individualHooks: true
   * ไปกับคำสั่ง แล้ว hook รายแถวจะทำงานแทน
   */
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

  // ---- การเขียนจริง -------------------------------------------------------

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
      // options.transaction เป็น null ได้ตามชนิดของ Sequelize แต่ create() รับแค่ undefined
      { transaction: options.transaction ?? undefined },
    );
  }
}

// ---- helpers --------------------------------------------------------------

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

/** ตารางเชื่อม (user_roles, role_permissions) ใช้ composite key จึงไม่มีคอลัมน์ id */
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

/** คอลัมน์ JSON ของ MySQL รับ Date ตรง ๆ ไม่ได้ ต้องแปลงเป็น ISO string ก่อน */
function normalize(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'symbol' || typeof value === 'function') {
    return String(value);
  }

  return value;
}
