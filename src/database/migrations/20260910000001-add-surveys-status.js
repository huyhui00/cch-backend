/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

/**
 * surveys.status — วงจรชีวิตของแบบประเมิน (M8)
 *
 * ตารางเดิมมีแต่ `is_active` ซึ่งเป็น boolean ตอบได้แค่ "ใช้ได้/ใช้ไม่ได้"
 * แต่หน้างานต้องแยกสามสถานะ:
 *
 *   DRAFT   กำลังร่างคำถาม ยังส่งให้ลูกค้าไม่ได้ แก้คำถามได้อิสระ
 *   ACTIVE  ใช้งานจริง ส่งให้ลูกค้าได้ **แก้คำถามไม่ได้แล้ว** เพราะคำตอบที่เก็บมา
 *           อ้างถึง question_id ถ้าคำถามเปลี่ยนไป คำตอบเก่าจะสื่อความหมายผิด
 *   CLOSED  ปิดรับคำตอบแล้ว ยังเปิดดูผลย้อนหลังได้
 *
 * DRAFT กับ CLOSED เป็นคนละเรื่องกันในเชิงธุรกิจ (ยังไม่เริ่ม vs จบแล้ว)
 * แต่ `is_active = false` เหมือนกันทั้งคู่ จึงแยกไม่ออกถ้าใช้ boolean อย่างเดียว
 *
 * **ลบ `is_active` ทิ้ง** ไม่เก็บไว้คู่กัน เพราะจะกลายเป็นสองแหล่งความจริงของคำถาม
 * เดียวกัน แล้ววันหนึ่งจะมี status = ACTIVE คู่กับ is_active = false โดยไม่มีใครรู้ว่า
 * อันไหนถูก — ปัญหาแบบเดียวกับที่เลี่ยงมาตลอดโปรเจกต์นี้
 *
 * ปลอดภัยที่จะลบเพราะตารางกลุ่ม F ยังไม่เคยถูกใช้งานเลย (ทุกตารางว่าง)
 * โมดูล Surveys เพิ่งเริ่มทำที่ M8 นี้เอง
 */
const STATUSES = ['DRAFT', 'ACTIVE', 'CLOSED'];

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('surveys', 'status', {
      type: Sequelize.ENUM(...STATUSES),
      allowNull: false,
      defaultValue: 'DRAFT',
      after: 'description',
    });

    await queryInterface.addIndex('surveys', {
      name: 'idx_surveys_status',
      fields: ['status'],
    });

    await queryInterface.removeColumn('surveys', 'is_active');
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.addColumn('surveys', 'is_active', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      after: 'description',
    });

    await queryInterface.removeIndex('surveys', 'idx_surveys_status');
    await queryInterface.removeColumn('surveys', 'status');

    // MySQL เก็บชนิด ENUM ไว้เป็น type ของตาราง ลบคอลัมน์แล้วชนิดหายไปเอง
    // ไม่ต้อง DROP TYPE เหมือน PostgreSQL
  },
};
