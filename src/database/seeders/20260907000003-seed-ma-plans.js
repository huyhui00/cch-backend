/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

/**
 * แผน MA ตัวอย่าง 3 แผน
 *
 * BR-05 — ตารางนี้เก็บ "เนื้อหา" ของแผนเท่านั้น ไม่มีราคา
 * ราคาไปอยู่ที่ ma_contracts.price ตอนทำสัญญากับลูกค้าแต่ละราย
 * แผนเดียวกันจึงขายได้หลายราคาโดยไม่ต้องก๊อปแผนใหม่
 */
const PLANS = [
  {
    code: 'MA-BASIC',
    name: 'MA Basic',
    description: 'แผนพื้นฐาน สำหรับระบบที่ใช้งานนิ่งแล้ว',
    bug_quota_per_month: 5,
    response_time_hour: 24,
    onsite_quota_per_month: 0,
    sort_order: 1,
    items: [
      'แก้ไขบั๊กในขอบเขตเดิม 5 ครั้งต่อเดือน',
      'ตอบกลับภายใน 24 ชั่วโมงทำการ',
      'สนับสนุนผ่าน LINE และโทรศัพท์ในเวลาทำการ',
      'สำรองข้อมูลรายเดือน',
    ],
  },
  {
    code: 'MA-STANDARD',
    name: 'MA Standard',
    description: 'แผนมาตรฐาน สำหรับระบบที่ยังมีการปรับปรุงต่อเนื่อง',
    bug_quota_per_month: 10,
    response_time_hour: 8,
    onsite_quota_per_month: 1,
    sort_order: 2,
    items: [
      'แก้ไขบั๊กในขอบเขตเดิม 10 ครั้งต่อเดือน',
      'ตอบกลับภายใน 8 ชั่วโมงทำการ',
      'สนับสนุนผ่าน LINE และโทรศัพท์ในเวลาทำการ',
      'เข้าหน้างานได้ 1 ครั้งต่อเดือน',
      'สำรองข้อมูลรายสัปดาห์',
      'รายงานสรุปการใช้งานรายเดือน',
    ],
  },
  {
    code: 'MA-PREMIUM',
    name: 'MA Premium',
    description: 'แผนสูงสุด สำหรับระบบที่ใช้งานหนักและหยุดไม่ได้',
    bug_quota_per_month: 20,
    response_time_hour: 4,
    onsite_quota_per_month: 2,
    sort_order: 3,
    items: [
      'แก้ไขบั๊กในขอบเขตเดิม 20 ครั้งต่อเดือน',
      'ตอบกลับภายใน 4 ชั่วโมง',
      'สนับสนุนผ่าน LINE โทรศัพท์ และช่องทางด่วนนอกเวลาทำการ',
      'เข้าหน้างานได้ 2 ครั้งต่อเดือน',
      'สำรองข้อมูลรายวัน',
      'รายงานสรุปการใช้งานรายเดือน',
      'ตรวจสุขภาพระบบทุกไตรมาส',
    ],
  },
];

module.exports = {
  async up(queryInterface) {
    const now = new Date();

    const [existing] = await queryInterface.sequelize.query('SELECT code FROM ma_plans');
    const existingCodes = new Set(existing.map((row) => row.code));
    const toInsert = PLANS.filter((plan) => !existingCodes.has(plan.code));

    if (toInsert.length === 0) {
      console.log('ma_plans: มีครบอยู่แล้ว ไม่ต้องเพิ่ม');
      return;
    }

    await queryInterface.bulkInsert(
      'ma_plans',
      toInsert.map((plan) => ({
        code: plan.code,
        name: plan.name,
        description: plan.description,
        bug_quota_per_month: plan.bug_quota_per_month,
        response_time_hour: plan.response_time_hour,
        onsite_quota_per_month: plan.onsite_quota_per_month,
        is_active: true,
        sort_order: plan.sort_order,
        created_at: now,
        created_by: null,
        updated_at: now,
        updated_by: null,
        deleted_at: null,
        deleted_by: null,
      })),
    );

    // ดึง id ที่เพิ่งสร้างเพื่อผูก ma_plan_items
    const [saved] = await queryInterface.sequelize.query(
      'SELECT id, code FROM ma_plans WHERE code IN (:codes)',
      { replacements: { codes: toInsert.map((plan) => plan.code) } },
    );
    const idByCode = Object.fromEntries(saved.map((row) => [row.code, row.id]));

    const itemRows = [];
    for (const plan of toInsert) {
      plan.items.forEach((title, index) => {
        itemRows.push({
          plan_id: idByCode[plan.code],
          title,
          detail: null,
          sort_order: index + 1,
          created_at: now,
          created_by: null,
          updated_at: now,
          updated_by: null,
          deleted_at: null,
          deleted_by: null,
        });
      });
    }

    await queryInterface.bulkInsert('ma_plan_items', itemRows);
    console.log(`ma_plans: เพิ่ม ${toInsert.length} แผน พร้อมรายการย่อย ${itemRows.length} รายการ`);
  },

  async down(queryInterface) {
    const codes = PLANS.map((plan) => plan.code);

    // ลบรายการย่อยก่อน ไม่งั้นติด foreign key
    await queryInterface.sequelize.query(
      'DELETE i FROM ma_plan_items i JOIN ma_plans p ON p.id = i.plan_id WHERE p.code IN (:codes)',
      { replacements: { codes } },
    );

    const { Op } = queryInterface.sequelize.Sequelize;
    await queryInterface.bulkDelete('ma_plans', { code: { [Op.in]: codes } });
  },
};
