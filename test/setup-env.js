/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * ทำงานก่อนไฟล์เทสต์ถูกโหลด — ชี้แอปไปที่ฐานข้อมูลทดสอบ
 *
 * ต้องตั้งที่นี่ ไม่ใช่ในไฟล์เทสต์ เพราะ import ของ AppModule ถูก hoist ขึ้นไปบนสุด
 * ถ้าไปตั้งในไฟล์เทสต์ ConfigModule จะอ่านค่าเดิมไปแล้วและวิ่งชนฐานข้อมูลจริง
 */
require('dotenv').config();

const base = process.env.DB_DATABASE || 'cch_db';

// กันเผลอต่อยอด _test ซ้ำเมื่อมีใครตั้ง DB_DATABASE เป็นชื่อฐานทดสอบมาอยู่แล้ว
process.env.DB_DATABASE = base.endsWith('_test') ? base : `${base}_test`;

// e2e ยิงหลายสิบ request ต่อไฟล์ ถ้าเปิด log ไว้จะกลบผลของเทสต์จนอ่านไม่ออก
process.env.REQUEST_LOG = 'false';
process.env.NODE_ENV = 'test';

// e2e ล็อกอินหลายบัญชีจาก IP เดียวกันหลายสิบครั้ง จะชนเพดานกันเดารหัสผ่านทั้งที่ไม่ได้ทดสอบเรื่องนั้น
process.env.THROTTLE_ENABLED = 'false';

// ตรึงโหมดรอบโควตาไว้ที่ค่าที่ตกลงกัน (Q2) ไม่ให้ผลของเทสต์เปลี่ยนตาม .env
// ของแต่ละเครื่อง — เทสต์ที่ผ่านบ้างไม่ผ่านบ้างตามเครื่องคนรันคือเทสต์ที่ไม่มีประโยชน์
process.env.MA_QUOTA_RESET_MODE = 'CONTRACT_ANNIVERSARY';

// ไฟล์ที่อัปโหลดระหว่างเทสต์ลงโฟลเดอร์ชั่วคราว ไม่ขึ้น R2 จริงแม้เครื่องนั้นจะมี key
// และไม่ปนกับโฟลเดอร์ uploads/ ที่ใช้ตอนพัฒนา
process.env.STORAGE_DRIVER = 'local';
process.env.LOCAL_STORAGE_DIR = require('node:path').join(
  require('node:os').tmpdir(),
  'cch-backend-e2e-uploads',
);
