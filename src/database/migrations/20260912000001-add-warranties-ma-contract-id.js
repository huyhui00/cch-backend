/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const { addIndexes, fk } = require('../migration-helpers');

/**
 * warranties.ma_contract_id — ประกันผูกสัญญา MA (ประชุมครั้งที่ 3, 11 ก.ย. 2026 — B-13)
 *
 * พี่เลี้ยง (นาที 38:27–41:00): "การรับประกัน ขอบเขต เราดึงสัญญาบำรุงรักษา MA เข้าไปด้วยนะ
 * ... จะได้รู้ว่าประกันตัวนี้มันรวม MA ตัวไหน ผูกรูปแบบไหน Standard/Basic"
 *
 * **เป็นการอ้างอิงอย่างเดียว** ตอนทีมถามว่า "คิดรวมกับ MA?" พี่เลี้ยงตอบว่า "ไม่ใช่คิดรวมนะ"
 * และย้ำว่าประกัน "นอกเหนือและพิเศษกว่า MA" จึงไม่มีการรวมโควตาหรือรวมราคาใด ๆ
 * ลำดับการเสนอ billing_type ใน Phase 7 (ประกันมาก่อนสัญญา) ไม่เปลี่ยน
 *
 * NULL ได้ — ประกันเดิมไม่มีค่านี้ และลูกค้าที่ไม่ได้ทำ MA ก็ยังออกประกันได้ตามปกติ
 * ไม่แก้ไฟล์ group C เดิมที่รันไปแล้ว (ma_contracts อยู่กลุ่ม D ที่สร้างทีหลัง จึงต้องเป็นไฟล์ใหม่อยู่ดี)
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('warranties', 'ma_contract_id', {
      ...fk(Sequelize, 'ma_contracts', { allowNull: true }),
      after: 'project_id',
    });

    await addIndexes(queryInterface, 'warranties', [
      { name: 'idx_warranties_ma_contract_id', fields: ['ma_contract_id'] },
    ]);
  },

  async down(queryInterface) {
    // MySQL ไม่ยอมลบ index ที่ foreign key ใช้อยู่ ต้องลบคอลัมน์ (พร้อม constraint) ก่อน
    await queryInterface.removeColumn('warranties', 'ma_contract_id');
  },
};
