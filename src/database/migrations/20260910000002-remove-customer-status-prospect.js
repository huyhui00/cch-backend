/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

/**
 * customers.status — ตัด PROSPECT (ผู้มุ่งหวัง) ออก
 *
 * ตกลงกับพี่เลี้ยง 10 ก.ย. 2026 ว่าบริษัทบันทึกเฉพาะลูกค้าที่ใช้บริการจริงแล้ว
 * ข้อมูลลูกค้าส่วนใหญ่เข้ามาพร้อมโครงการที่ได้รับมอบหมาย ไม่ได้เก็บรายชื่อผู้ที่ยังไม่จ้างงาน
 * สถานะจึงเหลือสามค่า และค่าเริ่มต้นเปลี่ยนเป็น ACTIVE
 *
 *   ACTIVE    ลูกค้าปัจจุบัน
 *   INACTIVE  ไม่ได้ใช้บริการแล้ว แต่ยังตามเสนอ MA ได้
 *   CHURNED   เลิกใช้บริการ / ไม่ติดตามต่อ
 *
 * **ลำดับใน up สำคัญ** — ต้องย้ายแถว PROSPECT ออกก่อนแก้ ENUM
 * ถ้าแก้ ENUM ก่อน MySQL จะปฏิเสธ (strict mode) หรือเขียนค่าว่างทับ (non-strict)
 * แถวที่ถูก soft delete ไปแล้วถูกย้ายด้วย เพราะคอลัมน์เป็นของทุกแถวไม่ว่าจะลบหรือไม่
 */
const NEW_STATUSES = ['ACTIVE', 'INACTIVE', 'CHURNED'];
const OLD_STATUSES = ['PROSPECT', 'ACTIVE', 'INACTIVE', 'CHURNED'];

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(
      "UPDATE customers SET status = 'ACTIVE' WHERE status = 'PROSPECT'",
    );

    await queryInterface.changeColumn('customers', 'status', {
      type: Sequelize.ENUM(...NEW_STATUSES),
      allowNull: false,
      defaultValue: 'ACTIVE',
    });
  },

  async down(queryInterface, Sequelize) {
    // คืนได้แค่โครงสร้าง — แถวที่เคยเป็น PROSPECT ถูกเปลี่ยนเป็น ACTIVE ไปแล้วใน up
    // และไม่มีร่องรอยว่าแถวไหนเคยเป็นอะไร (migration เขียนผ่าน SQL ตรง ไม่เกิด audit log)
    // จึงย้อนค่าเดิมของแต่ละแถวไม่ได้
    await queryInterface.changeColumn('customers', 'status', {
      type: Sequelize.ENUM(...OLD_STATUSES),
      allowNull: false,
      defaultValue: 'PROSPECT',
    });
  },
};
