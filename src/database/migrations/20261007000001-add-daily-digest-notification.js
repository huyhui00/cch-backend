'use strict';

/**
 * แจ้งเตือนเปลี่ยนเป็นสรุปภาพรวมบริษัทวันละครั้ง (7 ต.ค.)
 * - เพิ่ม event DAILY_DIGEST ให้แถว notifications ของสรุป
 * - เปลี่ยนชื่อกฎเริ่มต้นให้ตรงกับเนื้อหาใหม่ (เฉพาะแถวที่ยังใช้ชื่อเดิมจาก seeder)
 * - เพิ่มกฎ DELIVERY_DUE (โปรเจกต์ใกล้ถึงวันจบตามแผน) ถ้ายังไม่มี — ปลายทาง SUPER_ADMIN คนแรกเหมือน seeder
 */
const EVENT_TYPES_BEFORE = [
  'MA_EXPIRING',
  'WARRANTY_EXPIRING',
  'TASK_OVERDUE',
  'DELIVERY_DUE',
  'FOLLOWUP_DUE',
  'TICKET_SLA',
  'CUSTOMER_IDLE',
  'TICKET_SENT_TO_ADMIN',
  'TICKET_AWAITING_REVIEW',
  'TICKET_RETURNED_TO_SUPPORT',
  'TICKET_ASSIGNED',
  'TICKET_REVIEW_REJECTED',
];

const EVENT_TYPES = [...EVENT_TYPES_BEFORE, 'DAILY_DIGEST'];

const RENAMES = [
  ['TASK_OVERDUE', 'งานย่อยเกินกำหนด', 'งานโปรเจกต์ใกล้ครบกำหนดและเลยกำหนด'],
  ['FOLLOWUP_DUE', 'งานติดตามเลยกำหนด', 'งานติดตามที่ครบกำหนดและเลยกำหนด'],
  [
    'CUSTOMER_IDLE',
    'ลูกค้าที่ไม่ได้ติดต่อ (30 วัน)',
    'ลูกค้าที่ไม่ได้ติดต่อ (30 วัน · สรุปทุกวันจันทร์)',
  ],
];

const DELIVERY_RULE_NAME = 'โปรเจกต์ใกล้ถึงวันจบตามแผน (7 วัน)';

async function alterEventType(queryInterface, Sequelize, table, values) {
  await queryInterface.changeColumn(table, 'event_type', {
    type: Sequelize.ENUM(...values),
    allowNull: false,
  });
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await alterEventType(queryInterface, Sequelize, 'notification_rules', EVENT_TYPES);
    await alterEventType(queryInterface, Sequelize, 'notifications', EVENT_TYPES);

    for (const [eventType, from, to] of RENAMES) {
      await queryInterface.bulkUpdate(
        'notification_rules',
        { name: to },
        { event_type: eventType, name: from },
      );
    }

    const [admins] = await queryInterface.sequelize.query(
      `SELECT id FROM users WHERE account_type = 'SUPER_ADMIN' AND deleted_at IS NULL ORDER BY id ASC LIMIT 1`,
    );
    const [existing] = await queryInterface.sequelize.query(
      `SELECT id FROM notification_rules WHERE event_type = 'DELIVERY_DUE' AND deleted_at IS NULL LIMIT 1`,
    );
    if (!admins.length || existing.length) {
      return;
    }

    const now = new Date();
    const adminId = admins[0].id;
    await queryInterface.bulkInsert('notification_rules', [
      {
        name: DELIVERY_RULE_NAME,
        event_type: 'DELIVERY_DUE',
        days_before: 7,
        is_active: true,
        target_role_id: null,
        target_user_id: adminId,
        message_template: null,
        send_line: true,
        cron_expression: null,
        created_at: now,
        created_by: adminId,
        updated_at: now,
        updated_by: adminId,
        deleted_at: null,
        deleted_by: null,
      },
    ]);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('notification_rules', {
      event_type: 'DELIVERY_DUE',
      name: DELIVERY_RULE_NAME,
    });
    for (const [eventType, from, to] of RENAMES) {
      await queryInterface.bulkUpdate(
        'notification_rules',
        { name: from },
        { event_type: eventType, name: to },
      );
    }

    await queryInterface.sequelize.query(
      `DELETE FROM notifications WHERE event_type = 'DAILY_DIGEST'`,
    );
    await alterEventType(queryInterface, Sequelize, 'notifications', EVENT_TYPES_BEFORE);
    await alterEventType(queryInterface, Sequelize, 'notification_rules', EVENT_TYPES_BEFORE);
  },
};
