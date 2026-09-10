/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

/**
 * ma_plans.code — เปลี่ยนเป็นไม่บังคับ
 *
 * ตกลงกับพี่เลี้ยง 10 ก.ย. 2026 ว่าหน้าจอจะซ่อนรหัสที่คนต้องตั้งเองทุกชนิด
 * (ระบบภายในทีมเล็ก ใช้ชื่อกับ id ของระบบก็พอ) ma_plans.code เป็นรหัสเดียวที่ยัง
 * บังคับกรอก ถ้าไม่เปลี่ยน หน้าสร้างแผน MA จะซ่อนช่องนี้ไม่ได้
 *
 * unique index `uq_ma_plans_code` คงไว้ตามเดิม — MySQL ยอมให้ NULL ซ้ำได้หลายแถว
 * แผนที่ไม่ใส่รหัสจึงอยู่ร่วมกันได้ ส่วนแผนที่ใส่รหัสยังห้ามซ้ำเหมือนเดิม
 * แผนตั้งต้นจาก seeder `20260907000003` ยังมีรหัสอยู่ เพราะ seeder ใช้รหัสเป็นกุญแจค้นหา
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('ma_plans', 'code', {
      type: Sequelize.STRING(50),
      allowNull: true,
    });
  },

  async down(queryInterface, Sequelize) {
    // ต้องเติมรหัสให้แถวที่ว่างก่อน ไม่งั้นเปลี่ยนกลับเป็น NOT NULL ไม่ได้
    // ใช้ id ต่อท้ายจึงไม่ชนกันเองและไม่ชนกับรหัสที่ผู้ใช้ตั้ง (ซึ่งใช้ได้แค่ A-Z 0-9 _)
    await queryInterface.sequelize.query(
      "UPDATE ma_plans SET code = CONCAT('PLAN-', id) WHERE code IS NULL",
    );

    await queryInterface.changeColumn('ma_plans', 'code', {
      type: Sequelize.STRING(50),
      allowNull: false,
    });
  },
};
