'use strict';

/**
 * วันสิ้นสุดประกัน = เริ่ม + N เดือน − 1 วัน (ครบ N เดือนพอดี สูตรเดียวกับสัญญา MA รายปี)
 *
 * เดิม end_date = เริ่ม + N เดือน และนับวันสุดท้ายรวม ประกัน 12 เดือนจึงคุ้มครอง 366 วัน
 * แตะเฉพาะแถวที่ end_date ยังตรงสูตรเดิม จึงรันซ้ำได้ และไม่ทับวันที่ที่ถูกแก้ด้วยมือ
 *
 * วันที่คำนวณด้วยสูตรเดียวกับ common/utils/date.util.ts (หนีบวันสิ้นเดือน)
 */

function pad(value) {
  return String(value).padStart(2, '0');
}

function toDateOnly(value) {
  if (value instanceof Date) {
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  return String(value).slice(0, 10);
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
    `SELECT id, start_date AS startDate, end_date AS endDate, duration_month AS durationMonth
       FROM warranties`,
  );

  for (const row of rows) {
    const base = addMonths(toDateOnly(row.startDate), row.durationMonth);
    if (toDateOnly(row.endDate) !== addDays(base, fromOffset)) {
      continue;
    }

    await queryInterface.sequelize.query('UPDATE warranties SET end_date = ? WHERE id = ?', {
      replacements: [addDays(base, toOffset), row.id],
    });
  }
}

module.exports = {
  async up(queryInterface) {
    await shift(queryInterface, 0, -1);
  },

  async down(queryInterface) {
    await shift(queryInterface, -1, 0);
  },
};
