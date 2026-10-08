/**
 * ตัวช่วยเรื่องวันที่แบบ DATEONLY (YYYY-MM-DD)
 *
 * คอลัมน์อย่าง warranties.start_date / end_date และ tasks.due_date เก็บเป็น DATEONLY
 * ซึ่ง Sequelize คืนมาเป็นสตริง ไม่ใช่ Date การเทียบจึงทำด้วยการเทียบสตริงได้ตรง ๆ
 * เพราะรูปแบบ YYYY-MM-DD เรียงตามพจนานุกรมแล้วได้ลำดับเวลาที่ถูกต้องพอดี
 *
 * ห้ามแปลงกลับไปเป็น Date เพื่อเทียบ เพราะจะติดเรื่องเขตเวลาและเวลาในวัน
 * ซึ่งไม่มีความหมายกับค่าที่เก็บเป็น "วัน" ล้วน ๆ
 */

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function todayAsDateOnly(): string {
  return toDateOnly(new Date());
}

export function toDateOnly(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function addMonths(dateOnly: string, months: number): string {
  const [year, month, day] = dateOnly.split('-').map(Number);

  const totalMonths = month - 1 + months;
  const targetYear = year + Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12;

  const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();

  return `${targetYear}-${pad(targetMonth + 1)}-${pad(Math.min(day, lastDayOfTargetMonth))}`;
}

export function addDays(dateOnly: string, days: number): string {
  const [year, month, day] = dateOnly.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));

  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

export function daysUntil(dateOnly: string): number {
  const [year, month, day] = dateOnly.split('-').map(Number);
  const target = Date.UTC(year, month - 1, day);

  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());

  return Math.round((target - today) / (24 * 60 * 60 * 1000));
}
