/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const { addIndexes, fk } = require('../migration-helpers');

/**
 * follow_ups.project_id — งานติดตามผูกกับโปรเจค (ประชุมครั้งที่ 3, 11 ก.ย. 2026 — B-14)
 *
 * พี่เลี้ยง: "การติดตามลูกค้าเป็นการติดตามโปรเจค ไม่ใช่ตามลูกค้า" เพราะลูกค้ารายเดียวมีหลายโปรเจค
 * ถ้าไม่รู้ว่าตามเรื่องโปรเจคไหน งานติดตามก็อ่านแล้วไม่รู้ว่าต้องคุยเรื่องอะไร
 *
 * ยังเป็น NULL ได้ — งานเดิมก่อนวันนี้ไม่มีโปรเจค และยังไม่ตกลงว่าทุกงานต้องมีโปรเจคไหม (Q16)
 * customer_id ยังอยู่และยังบังคับ ระบบคัดลอกจากโปรเจคให้เมื่อระบุโปรเจคมา
 * รายการ "งานติดตามของลูกค้ารายนี้" จึงยังกรองด้วย customer_id ได้ตรง ๆ เหมือนเดิม
 *
 * ไฟล์ group B เดิมตั้งใจไว้แล้วว่าถ้าจะผูก follow_ups กับ project ให้เพิ่มเป็น migration ใหม่
 * ไม่ใช่แก้ไฟล์เดิม (projects อยู่กลุ่ม C ที่สร้างทีหลัง)
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('follow_ups', 'project_id', {
      ...fk(Sequelize, 'projects', { allowNull: true }),
      after: 'customer_id',
    });

    await addIndexes(queryInterface, 'follow_ups', [
      { name: 'idx_follow_ups_project_id', fields: ['project_id'] },
    ]);
  },

  async down(queryInterface) {
    // MySQL ไม่ยอมลบ index ที่ foreign key ใช้อยู่ ต้องลบคอลัมน์ (พร้อม constraint) ก่อน
    await queryInterface.removeColumn('follow_ups', 'project_id');
  },
};
