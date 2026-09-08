/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const { fk, addIndexes } = require('../migration-helpers');

/**
 * กลุ่ม C — คอลัมน์ที่ตกหล่นจากการประชุม (CLAUDE.md 13 : A-2, A-4)
 *
 *   tasks.priority                  "กำหนดผู้รับผิดชอบ ระดับความสำคัญ และวันครบกำหนด
 *                                    ของแต่ละงานย่อย" (ประชุมครั้งที่ 2 นาที 07:31)
 *   deliveries.version              "ระบุเวอร์ชั่นล่าสุดและวันเวลาที่ส่ง" +
 *                                   "แสดงประวัติการส่งมอบเรียงตามเวอร์ชั่น" (นาที 08:03)
 *   deliveries.delivered_by_user_id "ระบุผู้ส่งมอบที่เป็นพนักงาน และผู้รับมอบที่เป็น
 *                                    ผู้ติดต่อฝั่งลูกค้า" — ของเดิมมีแต่ฝั่งผู้รับมอบ
 *
 * เขียนเป็นไฟล์ใหม่ ไม่แก้ migration เดิมที่รันไปแล้ว
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    // ---- tasks.priority ---------------------------------------------------
    // ใช้ชุดค่าเดียวกับ projects.priority เพื่อให้หน้าจอกรองข้ามระดับได้
    await queryInterface.addColumn('tasks', 'priority', {
      type: Sequelize.ENUM('LOW', 'NORMAL', 'HIGH', 'URGENT'),
      allowNull: false,
      defaultValue: 'NORMAL',
      after: 'status',
    });

    await addIndexes(queryInterface, 'tasks', [
      { name: 'idx_tasks_priority', fields: ['priority'] },
    ]);

    // ---- deliveries.version ----------------------------------------------
    // เก็บเป็นข้อความ ไม่ใช่ตัวเลข เพราะบริษัทใช้รูปแบบอย่าง "v1.2.0" หรือ "รอบที่ 2"
    // การเรียงลำดับประวัติจึงต้องเรียงด้วย delivered_at เป็นหลัก ไม่ใช่เรียงด้วย version
    await queryInterface.addColumn('deliveries', 'version', {
      type: Sequelize.STRING(50),
      allowNull: true,
      after: 'title',
    });

    // ---- deliveries.delivered_by_user_id ---------------------------------
    await queryInterface.addColumn(
      'deliveries',
      'delivered_by_user_id',
      fk(Sequelize, 'users', { allowNull: true }),
    );

    await addIndexes(queryInterface, 'deliveries', [
      { name: 'idx_deliveries_delivered_by', fields: ['delivered_by_user_id'] },
      { name: 'idx_deliveries_version', fields: ['version'] },
    ]);
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('deliveries', 'idx_deliveries_version');
    await queryInterface.removeIndex('deliveries', 'idx_deliveries_delivered_by');
    await queryInterface.removeColumn('deliveries', 'delivered_by_user_id');
    await queryInterface.removeColumn('deliveries', 'version');

    await queryInterface.removeIndex('tasks', 'idx_tasks_priority');
    await queryInterface.removeColumn('tasks', 'priority');

    // MySQL เก็บ ENUM เป็น type ผูกกับคอลัมน์ พอลบคอลัมน์แล้วก็หายไปเอง
    // ไม่ต้องลบ type แยกเหมือน PostgreSQL
  },
};
