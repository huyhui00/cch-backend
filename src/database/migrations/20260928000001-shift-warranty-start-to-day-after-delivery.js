'use strict';

/**
 * ประกันเริ่มนับวันถัดจากวันส่งมอบ (ประชุมทบทวน 22–23 ก.ย. นาที 25:36:
 * "มันไม่ได้นับวันนั้นนะ มันจะไปนับอีกวันนึงเป็นวันที่ 1 ... ไปเริ่มนับพรุ่งนี้")
 *
 * เดิม start_date = วันส่งมอบ — เลื่อนประกันที่ออกไปแล้วให้ตรงกติกาใหม่
 * แตะเฉพาะแถวที่ start_date ยังเท่ากับวันส่งมอบ (สูตรเดิม) จึงรันซ้ำได้โดยไม่เลื่อนซ้ำ
 *
 * วันที่คำนวณด้วยสูตรเดียวกับ common/utils/date.util.ts (เขตเวลาเครื่อง + หนีบวันสิ้นเดือน)
 * เพื่อให้ได้ค่าตรงกับที่ WarrantiesService คำนวณให้ประกันใบใหม่
 */

function pad(value) {
  return String(value).padStart(2, '0');
}

function toDateOnly(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addDays(dateOnly, days) {
  const [year, month, day] = dateOnly.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

function addMonths(dateOnly, months) {
  const [year, month, day] = dateOnly.split('-').map(Number);
  const totalMonths = month - 1 + months;
  const targetYear = year + Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return `${targetYear}-${pad(targetMonth + 1)}-${pad(Math.min(day, lastDay))}`;
}

async function shift(queryInterface, fromOffset, toOffset) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT w.id, w.start_date AS startDate, w.duration_month AS durationMonth,
            d.delivered_at AS deliveredAt
       FROM warranties w
       JOIN deliveries d ON d.id = w.delivery_id`,
  );

  for (const row of rows) {
    const deliveryDate = toDateOnly(new Date(row.deliveredAt));
    const current =
      row.startDate instanceof Date
        ? toDateOnly(row.startDate)
        : String(row.startDate).slice(0, 10);
    if (current !== addDays(deliveryDate, fromOffset)) {
      continue;
    }

    const startDate = addDays(deliveryDate, toOffset);
    await queryInterface.sequelize.query(
      'UPDATE warranties SET start_date = ?, end_date = ? WHERE id = ?',
      { replacements: [startDate, addMonths(startDate, row.durationMonth), row.id] },
    );
  }
}

module.exports = {
  async up(queryInterface) {
    await shift(queryInterface, 0, 1);
  },

  async down(queryInterface) {
    await shift(queryInterface, 1, 0);
  },
};
