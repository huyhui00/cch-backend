'use strict';

/**
 * แจ้งเตือนเปลี่ยนจากสรุปวันละครั้งเป็นแจ้งตามกำหนดของแต่ละรายการ (7 ต.ค.)
 * - `notifications.dedupe_key` = รายการนี้ ขั้นนี้ (ใกล้ครบ/เลยกำหนด) ของกำหนดวันนี้ แจ้งคนนี้ไปแล้ว
 * - ปิดกฎ CUSTOMER_IDLE เพราะไม่ใช่กำหนดส่ง ไม่มีจังหวะ "ใกล้ครบ" ให้แจ้ง
 */
const IDLE_NAME_DIGEST = 'ลูกค้าที่ไม่ได้ติดต่อ (30 วัน · สรุปทุกวันจันทร์)';
const IDLE_NAME = 'ลูกค้าที่ไม่ได้ติดต่อ (30 วัน)';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('notifications', 'dedupe_key', {
      type: Sequelize.STRING(191),
      allowNull: true,
      after: 'ref_id',
    });
    await queryInterface.addIndex('notifications', ['target_user_id', 'dedupe_key'], {
      name: 'notifications_target_user_dedupe_key',
    });

    await queryInterface.bulkUpdate(
      'notification_rules',
      { name: IDLE_NAME },
      { event_type: 'CUSTOMER_IDLE', name: IDLE_NAME_DIGEST },
    );
    await queryInterface.bulkUpdate(
      'notification_rules',
      { is_active: false },
      { event_type: 'CUSTOMER_IDLE' },
    );
  },

  async down(queryInterface) {
    await queryInterface.bulkUpdate(
      'notification_rules',
      { is_active: true },
      { event_type: 'CUSTOMER_IDLE' },
    );
    await queryInterface.bulkUpdate(
      'notification_rules',
      { name: IDLE_NAME_DIGEST },
      { event_type: 'CUSTOMER_IDLE', name: IDLE_NAME },
    );
    await queryInterface.removeIndex('notifications', 'notifications_target_user_dedupe_key');
    await queryInterface.removeColumn('notifications', 'dedupe_key');
  },
};
