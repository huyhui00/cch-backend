/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

/**
 * projects.function_count — จำนวนฟังก์ชันของโครงการ (CLAUDE.md 13 : A-9)
 *
 * ใช้เป็นตัวตั้งในการคิดราคา MA ภายหลัง (Phase 8) คู่กับ contract_value
 * โครงการที่มีฟังก์ชันเยอะย่อมมีพื้นที่ให้เกิดบั๊กเยอะกว่า ค่าดูแลรายปีจึงต่างกัน
 * ทั้งที่เนื้อหาแผน MA เหมือนกันทุกโครงการ (BR-05 — เนื้อหาอยู่ ma_plans ราคาอยู่สัญญา)
 *
 * เป็น nullable เพราะโครงการที่บันทึกย้อนหลังเข้ามาอาจนับฟังก์ชันไม่ได้แล้ว
 * และโครงการที่ยังเป็น DRAFT ก็ยังไม่รู้จำนวนที่แน่นอน
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('projects', 'function_count', {
      type: Sequelize.INTEGER.UNSIGNED,
      allowNull: true,
      after: 'contract_value',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('projects', 'function_count');
  },
};
