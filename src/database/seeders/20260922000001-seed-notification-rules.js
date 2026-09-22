'use strict';

/**
 * กฎแจ้งเตือนเริ่มต้นสำหรับ Phase 11
 * ปลายทางเป็น SUPER_ADMIN คนแรกในระบบ (ถ้ามี) — ปรับ target ในหน้าจอทีหลังได้
 * ข้ามเมื่อ production ไม่มี super admin หรือมีกฎ event นั้นอยู่แล้ว
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const now = new Date();
    const [admins] = await queryInterface.sequelize.query(
      `SELECT id FROM users WHERE account_type = 'SUPER_ADMIN' AND deleted_at IS NULL ORDER BY id ASC LIMIT 1`,
    );
    if (!admins.length) {
      return;
    }
    const targetUserId = admins[0].id;

    const [existing] = await queryInterface.sequelize.query(
      `SELECT event_type FROM notification_rules WHERE deleted_at IS NULL`,
    );
    const have = new Set(existing.map((r) => r.event_type));

    const defaults = [
      {
        name: 'ประกันใกล้หมดอายุ (30 วัน)',
        event_type: 'WARRANTY_EXPIRING',
        days_before: 30,
        message_template: 'กรุณาตรวจสอบประกันที่ใกล้หมดอายุ',
      },
      {
        name: 'สัญญา MA ใกล้หมดอายุ (30 วัน)',
        event_type: 'MA_EXPIRING',
        days_before: 30,
        message_template: 'กรุณาตรวจสอบสัญญา MA ที่ใกล้หมดอายุ',
      },
      {
        name: 'งานย่อยเกินกำหนด',
        event_type: 'TASK_OVERDUE',
        days_before: null,
        message_template: 'มีงานที่เลยกำหนดแล้ว',
      },
      {
        name: 'งานติดตามเลยกำหนด',
        event_type: 'FOLLOWUP_DUE',
        days_before: null,
        message_template: 'มีงานติดตามที่เลยกำหนดแล้ว',
      },
      {
        name: 'ใบแจ้งปัญหาเลยกำหนด (SLA)',
        event_type: 'TICKET_SLA',
        days_before: null,
        message_template: 'มีใบแจ้งปัญหาที่เลยกำหนดส่ง',
      },
      {
        name: 'ลูกค้าที่ไม่ได้ติดต่อ (30 วัน)',
        event_type: 'CUSTOMER_IDLE',
        days_before: 30,
        message_template: 'มีลูกค้าที่ไม่ได้ติดต่อนาน',
      },
    ].filter((d) => !have.has(d.event_type));

    if (!defaults.length) {
      return;
    }

    await queryInterface.bulkInsert(
      'notification_rules',
      defaults.map((d) => ({
        name: d.name,
        event_type: d.event_type,
        days_before: d.days_before,
        is_active: true,
        target_role_id: null,
        target_user_id: targetUserId,
        message_template: d.message_template,
        send_line: true,
        cron_expression: null,
        created_at: now,
        created_by: targetUserId,
        updated_at: now,
        updated_by: targetUserId,
        deleted_at: null,
        deleted_by: null,
      })),
    );
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('notification_rules', {
      name: [
        'ประกันใกล้หมดอายุ (30 วัน)',
        'สัญญา MA ใกล้หมดอายุ (30 วัน)',
        'งานย่อยเกินกำหนด',
        'งานติดตามเลยกำหนด',
        'ใบแจ้งปัญหาเลยกำหนด (SLA)',
        'ลูกค้าที่ไม่ได้ติดต่อ (30 วัน)',
      ],
    });
  },
};
