/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const { addIndexes } = require('../migration-helpers');

/**
 * deliveries.is_final — การส่งมอบครั้งนี้เป็น "ครั้งสุดท้าย" ของโครงการหรือไม่ (ตกลง 11 ก.ย. 2026)
 *
 * ประกันออกได้หลังส่งมอบงานที่ครบและลูกค้ายอมรับแล้วเท่านั้น แต่ระหว่างทางมีการส่งมอบหลายครั้ง
 * (เฟส / เวอร์ชันทดลอง) ที่ลูกค้าก็ "ยอมรับ" ได้เหมือนกัน การดูแค่ acceptance_status จึงแยกไม่ออกว่า
 * ครั้งไหนคือการส่งมอบจริง หน้าจอถามผู้ใช้อยู่แล้วว่า "เป็นครั้งสุดท้ายไหม" แต่ไม่มีที่เก็บคำตอบ
 * คอลัมน์นี้คือที่เก็บคำตอบนั้น
 *
 * ข้อมูลเดิม: ใบส่งมอบที่มีประกัน (ที่ยังไม่ VOID) อยู่แล้ว ถูกตั้งเป็นครั้งสุดท้ายให้
 * เพื่อไม่ให้ข้อมูลเดิมขัดกับกติกาใหม่ที่ว่า "ประกันออกได้จากครั้งสุดท้ายเท่านั้น"
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('deliveries', 'is_final', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      after: 'accepted_by_contact_id',
    });

    await queryInterface.sequelize.query(
      `UPDATE deliveries d
          SET d.is_final = true
        WHERE EXISTS (
          SELECT 1 FROM warranties w
           WHERE w.delivery_id = d.id
             AND w.status <> 'VOID'
             AND w.deleted_at IS NULL
        )`,
    );

    // ใช้ตรวจ "1 โครงการมีครั้งสุดท้ายที่ยอมรับแล้วได้ใบเดียว"
    await addIndexes(queryInterface, 'deliveries', [
      {
        name: 'idx_deliveries_project_final',
        fields: ['project_id', 'is_final', 'acceptance_status'],
      },
    ]);
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('deliveries', 'idx_deliveries_project_final');
    await queryInterface.removeColumn('deliveries', 'is_final');
  },
};
