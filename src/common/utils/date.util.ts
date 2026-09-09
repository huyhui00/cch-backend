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

/** วันที่วันนี้ตามเวลาเครื่องเซิร์ฟเวอร์ (ตั้ง TZ ไทยไว้ที่ระดับ DB แล้ว) */
export function todayAsDateOnly(): string {
  return toDateOnly(new Date());
}

/** ตัดส่วนเวลาทิ้ง เหลือแค่วันตามเขตเวลาเครื่อง */
export function toDateOnly(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * บวกเดือนแบบหนีบวันสิ้นเดือน
 *
 * ใช้ Date.setMonth() ตรง ๆ ไม่ได้ เพราะ 31 ม.ค. + 1 เดือน จะกลายเป็น 3 มี.ค.
 * (ล้นจาก 31 ก.พ. ที่ไม่มีอยู่จริง) ซึ่งทำให้ระยะประกันยาวเกินจริงไปสองวัน
 * ที่ถูกคือหนีบลงมาเป็นวันสุดท้ายของเดือนปลายทาง — 31 ม.ค. + 1 เดือน = 28 ก.พ.
 */
export function addMonths(dateOnly: string, months: number): string {
  const [year, month, day] = dateOnly.split('-').map(Number);

  // นับเดือนแบบต่อเนื่องตั้งแต่เดือนแรกของปี ค.ศ. แล้วค่อยแตกกลับเป็นปี/เดือน
  const totalMonths = month - 1 + months;
  const targetYear = year + Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12;

  // วันที่ 0 ของเดือนถัดไป = วันสุดท้ายของเดือนนี้ ใช้ UTC เพื่อไม่ให้เขตเวลามาขยับวัน
  const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();

  return `${targetYear}-${pad(targetMonth + 1)}-${pad(Math.min(day, lastDayOfTargetMonth))}`;
}

/** จำนวนวันจากวันนี้ถึงวันที่กำหนด — ติดลบเมื่อวันนั้นผ่านไปแล้ว */
export function daysUntil(dateOnly: string): number {
  const [year, month, day] = dateOnly.split('-').map(Number);
  const target = Date.UTC(year, month - 1, day);

  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());

  return Math.round((target - today) / (24 * 60 * 60 * 1000));
}
