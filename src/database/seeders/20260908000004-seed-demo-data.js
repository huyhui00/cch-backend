/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

require('dotenv').config();
const bcrypt = require('bcrypt');

/**
 * ข้อมูลตัวอย่างสำหรับทดสอบหน้าจอระหว่างพัฒนา — ไม่ใช่ master data
 *
 * ต่างจาก seeder อีกสามตัวในโฟลเดอร์นี้ตรงที่ตัวนั้นเป็นข้อมูลที่ระบบจริงต้องมี
 * (รายการสิทธิ์ บัญชีผู้ดูแลสูงสุด แผน MA) ส่วนไฟล์นี้เป็นข้อมูลสมมติล้วน
 * จึงข้ามตัวเองเมื่อ NODE_ENV เป็น production เพื่อไม่ให้ลูกค้าปลอมหลุดขึ้นระบบจริง
 *
 * ข้อมูลชุดนี้ถูกเขียนผ่าน queryInterface ตรง ๆ ไม่ผ่าน Sequelize model
 * จึง **ไม่มี audit log** ตามมา ซึ่งถูกต้องแล้ว เพราะไม่มีใครเป็นผู้กระทำจริง
 * ถ้าอยากได้ audit log ไว้ทดสอบหน้าประวัติการใช้งาน ให้กดแก้ข้อมูลผ่าน API สักครั้ง
 *
 * วันที่ทั้งหมดคำนวณจากวันที่รันโดยเจตนา ไม่ได้ fix ไว้ตายตัว
 * งานที่ตั้งใจให้เกินกำหนดจึงยังเกินกำหนดอยู่เสมอ ไม่ว่าจะรัน seed วันไหน
 */

const DEMO_CUSTOMER_CODES = ['CUS-DEMO-001', 'CUS-DEMO-002', 'CUS-DEMO-003'];
const DEMO_PROJECT_CODES = ['PRJ-DEMO-001', 'PRJ-DEMO-002', 'PRJ-DEMO-003'];
const DEMO_USERNAMES = ['somchai', 'pranee', 'wichai'];
const DEMO_ROLE_NAMES = ['ฝ่ายซัพพอร์ต', 'ฝ่ายขาย'];

/** รหัสผ่านของบัญชีตัวอย่าง — ปลอดภัยเพราะ seeder นี้ไม่ทำงานบน production */
const DEMO_PASSWORD = process.env.DEMO_USER_PASSWORD || 'Demo@1234';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** เวลาย้อนหลัง n วันจากตอนนี้ ใช้กับคอลัมน์ชนิด DATETIME */
function daysAgo(n) {
  return new Date(Date.now() - n * MS_PER_DAY);
}

/** วันที่แบบ YYYY-MM-DD ห่างจากวันนี้ n วัน (ติดลบ = อดีต) ใช้กับคอลัมน์ชนิด DATE */
function dateOnly(n) {
  const d = new Date(Date.now() + n * MS_PER_DAY);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

function auditValues(now, actorId) {
  return {
    created_at: now,
    created_by: actorId,
    updated_at: now,
    updated_by: actorId,
    deleted_at: null,
    deleted_by: null,
  };
}

/** ดึง id ที่เพิ่ง insert กลับมา — MySQL ไม่คืน id จาก bulkInsert ให้ตรง ๆ */
async function mapIdsBy(queryInterface, table, column, values) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT id, ${column} AS key_value FROM ${table} WHERE ${column} IN (:values)`,
    { replacements: { values } },
  );

  const map = new Map();
  for (const row of rows) {
    map.set(row.key_value, Number(row.id));
  }
  return map;
}

module.exports = {
  async up(queryInterface) {
    if (process.env.NODE_ENV === 'production') {
      console.log('demo data: ข้ามเพราะรันอยู่บน production');
      return;
    }

    const [existing] = await queryInterface.sequelize.query(
      'SELECT id FROM customers WHERE code = :code LIMIT 1',
      { replacements: { code: DEMO_CUSTOMER_CODES[0] } },
    );

    if (existing.length > 0) {
      console.log('demo data: มีข้อมูลตัวอย่างอยู่แล้ว ข้ามการเพิ่ม');
      return;
    }

    const [admins] = await queryInterface.sequelize.query(
      "SELECT id FROM users WHERE account_type = 'SUPER_ADMIN' ORDER BY id LIMIT 1",
    );

    if (admins.length === 0) {
      throw new Error('demo data: ยังไม่มีบัญชี SUPER_ADMIN — รัน seeder ตัวก่อนหน้าให้ครบก่อน');
    }

    const actorId = Number(admins[0].id);
    const now = new Date();
    const audit = auditValues(now, actorId);
    const junctionAudit = { created_at: now, created_by: actorId };

    // ---- บัญชีพนักงานตัวอย่าง ---------------------------------------------
    // มีไว้ให้หน้าจอมีชื่อผู้รับผิดชอบให้เลือก และให้ทดสอบการมอบบทบาทได้จริง
    // pranee กับ wichai เป็น USER จึงเข้าเมนูได้ตามบทบาทที่ได้รับเท่านั้น (CLAUDE.md 4.1)
    const passwordHash = await bcrypt.hash(
      DEMO_PASSWORD,
      Number(process.env.BCRYPT_SALT_ROUNDS || 10),
    );

    await queryInterface.bulkInsert('users', [
      {
        employee_code: 'EMP-101',
        username: 'somchai',
        email: 'somchai@example.com',
        password_hash: passwordHash,
        full_name: 'สมชาย ใจดี',
        nickname: 'ชาย',
        phone: '081-111-1111',
        position: 'ผู้จัดการฝ่ายพัฒนา',
        avatar_url: null,
        line_user_id: null,
        account_type: 'ADMIN',
        status: 'ACTIVE',
        last_login_at: null,
        refresh_token_hash: null,
        ...audit,
      },
      {
        employee_code: 'EMP-102',
        username: 'pranee',
        email: 'pranee@example.com',
        password_hash: passwordHash,
        full_name: 'ปราณี รักงาน',
        nickname: 'นี',
        phone: '081-222-2222',
        position: 'เจ้าหน้าที่ซัพพอร์ต',
        avatar_url: null,
        line_user_id: null,
        account_type: 'USER',
        status: 'ACTIVE',
        last_login_at: null,
        refresh_token_hash: null,
        ...audit,
      },
      {
        employee_code: 'EMP-103',
        username: 'wichai',
        email: 'wichai@example.com',
        password_hash: passwordHash,
        full_name: 'วิชัย ตั้งใจ',
        nickname: 'ชัย',
        phone: '081-333-3333',
        position: 'เจ้าหน้าที่ฝ่ายขาย',
        avatar_url: null,
        line_user_id: null,
        account_type: 'USER',
        status: 'ACTIVE',
        last_login_at: null,
        refresh_token_hash: null,
        ...audit,
      },
    ]);

    const userIds = await mapIdsBy(queryInterface, 'users', 'username', DEMO_USERNAMES);
    const somchaiId = userIds.get('somchai');
    const praneeId = userIds.get('pranee');
    const wichaiId = userIds.get('wichai');

    // ---- บทบาทตัวอย่าง ----------------------------------------------------
    // is_system = false เพื่อให้ลบทิ้งได้ตอนทดสอบหน้าจัดการบทบาท
    await queryInterface.bulkInsert('roles', [
      {
        name: 'ฝ่ายซัพพอร์ต',
        description: 'ดูแลใบแจ้งปัญหาและติดตามผลการแก้ไข',
        is_system: false,
        is_active: true,
        ...audit,
      },
      {
        name: 'ฝ่ายขาย',
        description: 'ดูแลลูกค้าและบันทึกการติดต่อ',
        is_system: false,
        is_active: true,
        ...audit,
      },
    ]);

    const roleIds = await mapIdsBy(queryInterface, 'roles', 'name', DEMO_ROLE_NAMES);

    const rolePermissionCodes = {
      'ฝ่ายซัพพอร์ต': [
        'customer.view',
        'contact.view',
        'communication.view',
        'communication.create',
        'project.view',
        'task.view',
        'ticket.view',
        'ticket.create',
        'ticket.update',
        'ticket.resolve',
        'ticket.reopen',
      ],
      'ฝ่ายขาย': [
        'customer.view',
        'customer.create',
        'customer.update',
        'contact.view',
        'contact.create',
        'contact.update',
        'communication.view',
        'communication.create',
        'communication.update',
        'project.view',
        'report.view',
      ],
    };

    const allCodes = Object.values(rolePermissionCodes).flat();
    const permissionIds = await mapIdsBy(queryInterface, 'permissions', 'code', allCodes);

    const rolePermissionRows = [];
    for (const [roleName, codes] of Object.entries(rolePermissionCodes)) {
      for (const code of codes) {
        const permissionId = permissionIds.get(code);
        if (permissionId) {
          rolePermissionRows.push({
            role_id: roleIds.get(roleName),
            permission_id: permissionId,
            ...junctionAudit,
          });
        }
      }
    }

    await queryInterface.bulkInsert('role_permissions', rolePermissionRows);

    await queryInterface.bulkInsert('user_roles', [
      { user_id: praneeId, role_id: roleIds.get('ฝ่ายซัพพอร์ต'), ...junctionAudit },
      { user_id: wichaiId, role_id: roleIds.get('ฝ่ายขาย'), ...junctionAudit },
      // ถือสองบทบาทพร้อมกัน สิทธิ์ที่ได้คือ union ของทั้งคู่ (CLAUDE.md 4.2)
      { user_id: wichaiId, role_id: roleIds.get('ฝ่ายซัพพอร์ต'), ...junctionAudit },
    ]);

    // ---- ลูกค้า ------------------------------------------------------------
    // รายที่สามไม่มีประวัติการติดต่อเลย ไว้ทดสอบหน้า "ลูกค้าที่ถูกลืม"
    // ซึ่งต้องนับคนที่ยังไม่เคยติดต่อรวมด้วย ไม่ใช่ตัดทิ้งเพราะค่าเป็น null
    await queryInterface.bulkInsert('customers', [
      {
        code: 'CUS-DEMO-001',
        name: 'บริษัท ไทยเจริญ อิเล็กทรอนิกส์ จำกัด',
        tax_id: '0105558000001',
        business_type: 'โรงงานผลิตชิ้นส่วนอิเล็กทรอนิกส์',
        address: '99/1 นิคมอุตสาหกรรมอมตะซิตี้ ถนนสุขุมวิท',
        province: 'ชลบุรี',
        postal_code: '20000',
        phone: '038-100-100',
        email: 'contact@thaicharoen-demo.co.th',
        website: 'https://thaicharoen-demo.co.th',
        line_official_id: '@thaicharoen',
        facebook_url: null,
        status: 'ACTIVE',
        source: 'งานแสดงสินค้า',
        owner_user_id: wichaiId,
        last_contacted_at: daysAgo(3),
        note: 'ลูกค้าเก่าตั้งแต่ปี 2565 ต่อสัญญาดูแลระบบทุกปี',
        ...audit,
      },
      {
        code: 'CUS-DEMO-002',
        name: 'บริษัท กรีนฟาร์ม เทคโนโลยี จำกัด',
        tax_id: '0505560000002',
        business_type: 'เกษตรอัจฉริยะและโรงเรือนควบคุมอุณหภูมิ',
        address: '145 หมู่ 4 ตำบลหนองควาย อำเภอหางดง',
        province: 'เชียงใหม่',
        postal_code: '50230',
        phone: '053-200-200',
        email: 'info@greenfarm-demo.co.th',
        website: null,
        line_official_id: '@greenfarm',
        facebook_url: 'https://facebook.com/greenfarm.demo',
        status: 'ACTIVE',
        source: 'ลูกค้าเดิมแนะนำ',
        owner_user_id: wichaiId,
        last_contacted_at: daysAgo(21),
        note: 'สนใจขยายเซ็นเซอร์เพิ่มอีก 10 จุดในปีหน้า',
        ...audit,
      },
      {
        code: 'CUS-DEMO-003',
        name: 'ห้างหุ้นส่วนจำกัด รุ่งเรืองขนส่ง',
        tax_id: null,
        business_type: 'ขนส่งและโลจิสติกส์',
        address: '52/8 ถนนพระราม 2 แขวงบางมด เขตจอมทอง',
        province: 'กรุงเทพมหานคร',
        postal_code: '10150',
        phone: '02-400-4000',
        email: null,
        website: null,
        line_official_id: null,
        facebook_url: null,
        status: 'INACTIVE',
        source: 'ติดต่อเข้ามาทางเว็บไซต์',
        owner_user_id: null,
        last_contacted_at: null,
        note:
          'เคยจ้างทำระบบติดตามรถปี 2566 ข้อมูลยกมาจากเอกสารกระดาษ ' +
          'ยังไม่เคยบันทึกการติดต่อในระบบ — กลุ่มที่ควรตามเสนอ MA',
        ...audit,
      },
    ]);

    const customerIds = await mapIdsBy(queryInterface, 'customers', 'code', DEMO_CUSTOMER_CODES);
    const customer1 = customerIds.get('CUS-DEMO-001');
    const customer2 = customerIds.get('CUS-DEMO-002');
    const customer3 = customerIds.get('CUS-DEMO-003');

    // ---- ผู้ติดต่อ ----------------------------------------------------------
    // ผู้ติดต่อหลักมีได้คนเดียวต่อลูกค้า 1 ราย
    await queryInterface.bulkInsert('contacts', [
      {
        customer_id: customer1,
        name: 'คุณสมศรี วัฒนกิจ',
        nickname: 'ศรี',
        position: 'ผู้จัดการฝ่ายจัดซื้อ',
        phone: '081-234-5678',
        email: 'somsri@thaicharoen-demo.co.th',
        line_id: 'somsri.w',
        is_primary: true,
        note: 'ติดต่อได้สะดวกช่วงบ่าย',
        ...audit,
      },
      {
        customer_id: customer1,
        name: 'คุณอนุชา ตั้งมั่น',
        nickname: 'ชา',
        position: 'หัวหน้าแผนกไอที',
        phone: '089-876-5432',
        email: 'anucha@thaicharoen-demo.co.th',
        line_id: null,
        is_primary: false,
        note: 'ผู้ประสานงานด้านเทคนิค',
        ...audit,
      },
      {
        customer_id: customer2,
        name: 'คุณปรีชา ใจงาม',
        nickname: 'ชา',
        position: 'เจ้าของกิจการ',
        phone: '086-555-1212',
        email: 'preecha@greenfarm-demo.co.th',
        line_id: 'preecha.gf',
        is_primary: true,
        note: null,
        ...audit,
      },
      {
        customer_id: customer2,
        name: 'คุณมานี สุขสวัสดิ์',
        nickname: 'นี',
        position: 'ผู้จัดการฟาร์ม',
        phone: '086-555-3434',
        email: null,
        line_id: null,
        is_primary: false,
        note: 'อยู่หน้างาน โทรติดต่อได้ตลอด',
        ...audit,
      },
      {
        customer_id: customer3,
        name: 'คุณวิชัย รุ่งเรือง',
        nickname: null,
        position: 'กรรมการผู้จัดการ',
        phone: '02-400-4001',
        email: 'wichai@rungrueang-demo.co.th',
        line_id: null,
        is_primary: true,
        note: null,
        ...audit,
      },
    ]);

    const [contactRows] = await queryInterface.sequelize.query(
      'SELECT id, customer_id, is_primary FROM contacts WHERE customer_id IN (:ids) ORDER BY id',
      { replacements: { ids: [customer1, customer2, customer3] } },
    );

    const primaryContactOf = (customerId) => {
      const row = contactRows.find((c) => Number(c.customer_id) === customerId && c.is_primary);
      return row ? Number(row.id) : null;
    };

    const secondaryContactOf = (customerId) => {
      const row = contactRows.find((c) => Number(c.customer_id) === customerId && !c.is_primary);
      return row ? Number(row.id) : null;
    };

    // ---- บันทึกการติดต่อ (BR-02) -------------------------------------------
    // occurred_at คือเวลาที่คุยกันจริง ซึ่งย้อนหลังกว่า created_at เสมอ
    // last_contacted_at ของลูกค้าถูกตั้งให้ตรงกับรายการล่าสุดของแต่ละรายไว้แล้วข้างบน
    await queryInterface.bulkInsert('communication_logs', [
      {
        customer_id: customer1,
        contact_id: secondaryContactOf(customer1),
        channel: 'LINE',
        occurred_at: daysAgo(3),
        subject: 'แจ้งปัญหาหน้าจอรายงานสต๊อกโหลดช้า',
        content: 'แจ้งว่ารายงานสรุปสต๊อกรายเดือนใช้เวลาโหลดเกิน 30 วินาที ขอให้ตรวจสอบ',
        handled_by_user_id: praneeId,
        ...audit,
      },
      {
        customer_id: customer1,
        contact_id: primaryContactOf(customer1),
        channel: 'PHONE',
        occurred_at: daysAgo(12),
        subject: 'นัดหมายเข้าไปเก็บความต้องการเพิ่มเติม',
        content: 'นัดวันเข้าไปคุยเรื่องโมดูลเบิกจ่ายสินค้า ตกลงเป็นสัปดาห์หน้า',
        handled_by_user_id: somchaiId,
        ...audit,
      },
      {
        customer_id: customer1,
        contact_id: primaryContactOf(customer1),
        channel: 'MEETING',
        occurred_at: daysAgo(30),
        subject: 'ประชุมสรุปขอบเขตงานเฟสสอง',
        content: 'สรุปขอบเขตโมดูลรับสินค้าและเบิกจ่าย พร้อมกำหนดวันส่งมอบ',
        handled_by_user_id: somchaiId,
        ...audit,
      },
      {
        customer_id: customer2,
        contact_id: primaryContactOf(customer2),
        channel: 'LINE',
        occurred_at: daysAgo(21),
        subject: 'สอบถามการต่อสัญญาดูแลระบบ',
        content: 'ถามว่าสัญญาดูแลระบบปีถัดไปราคาเท่าไร ขอให้ส่งใบเสนอราคาไปให้',
        handled_by_user_id: wichaiId,
        ...audit,
      },
      {
        customer_id: customer2,
        contact_id: secondaryContactOf(customer2),
        channel: 'EMAIL',
        occurred_at: daysAgo(45),
        subject: 'ส่งใบเสนอราคาเซ็นเซอร์เพิ่ม 10 จุด',
        content: 'ส่งใบเสนอราคาการติดตั้งเซ็นเซอร์อุณหภูมิเพิ่มเติมในโรงเรือนที่ 3 และ 4',
        handled_by_user_id: wichaiId,
        ...audit,
      },
    ]);

    // ---- โครงการ ------------------------------------------------------------
    await queryInterface.bulkInsert('projects', [
      {
        customer_id: customer1,
        code: 'PRJ-DEMO-001',
        name: 'ระบบจัดการคลังสินค้า',
        description: 'ระบบรับสินค้าเข้าคลัง เบิกจ่าย และรายงานสต๊อกแบบเรียลไทม์',
        project_type: 'SOFTWARE',
        status: 'IN_PROGRESS',
        priority: 'HIGH',
        start_date: dateOnly(-60),
        target_end_date: dateOnly(22),
        actual_end_date: null,
        contract_value: '1850000.00',
        function_count: 42,
        manager_user_id: somchaiId,
        ...audit,
      },
      {
        customer_id: customer2,
        code: 'PRJ-DEMO-002',
        name: 'ระบบติดตามอุณหภูมิโรงเรือนด้วย IoT',
        description: 'เซ็นเซอร์วัดอุณหภูมิและความชื้น พร้อมแจ้งเตือนผ่าน LINE เมื่อค่าเกินกำหนด',
        project_type: 'IOT',
        status: 'IN_PROGRESS',
        priority: 'NORMAL',
        start_date: dateOnly(-35),
        target_end_date: dateOnly(45),
        actual_end_date: null,
        contract_value: '920000.00',
        function_count: 18,
        manager_user_id: somchaiId,
        ...audit,
      },
      {
        customer_id: customer1,
        code: 'PRJ-DEMO-003',
        name: 'เว็บไซต์บริษัทและระบบข่าวสาร',
        description: 'เว็บไซต์แนะนำบริษัทพร้อมระบบจัดการข่าวสารและสมัครงาน',
        project_type: 'SOFTWARE',
        status: 'DELIVERED',
        priority: 'LOW',
        start_date: dateOnly(-180),
        target_end_date: dateOnly(-30),
        actual_end_date: dateOnly(-28),
        contract_value: '250000.00',
        function_count: 9,
        manager_user_id: somchaiId,
        ...audit,
      },
    ]);

    const projectIds = await mapIdsBy(queryInterface, 'projects', 'code', DEMO_PROJECT_CODES);
    const project1 = projectIds.get('PRJ-DEMO-001');
    const project2 = projectIds.get('PRJ-DEMO-002');
    const project3 = projectIds.get('PRJ-DEMO-003');

    // ---- งานระดับบน --------------------------------------------------------
    // แยก insert สองรอบเพราะงานย่อยต้องอ้าง id ของงานแม่ที่เพิ่งเกิด
    const parentTasks = [
      {
        project_id: project1,
        title: 'วิเคราะห์ความต้องการและออกแบบระบบ',
        status: 'DONE',
        priority: 'HIGH',
        assigned_user_id: somchaiId,
        start_date: dateOnly(-60),
        due_date: dateOnly(-40),
        completed_at: daysAgo(41),
        estimated_hours: '80.00',
        actual_hours: '86.50',
        sort_order: 0,
      },
      {
        project_id: project1,
        title: 'พัฒนาโมดูลรับสินค้าเข้าคลัง',
        status: 'DOING',
        priority: 'HIGH',
        assigned_user_id: praneeId,
        start_date: dateOnly(-38),
        due_date: dateOnly(5),
        completed_at: null,
        estimated_hours: '160.00',
        actual_hours: '104.00',
        sort_order: 1,
      },
      {
        project_id: project1,
        title: 'พัฒนาโมดูลเบิกจ่ายสินค้า',
        status: 'TODO',
        priority: 'NORMAL',
        assigned_user_id: null,
        start_date: null,
        due_date: dateOnly(18),
        completed_at: null,
        estimated_hours: '120.00',
        actual_hours: null,
        sort_order: 2,
      },
      {
        // เกินกำหนดโดยตั้งใจ ไว้ทดสอบหน้า GET /api/tasks/overdue
        project_id: project1,
        title: 'ทดสอบระบบร่วมกับผู้ใช้จริง (UAT)',
        status: 'TODO',
        priority: 'URGENT',
        assigned_user_id: somchaiId,
        start_date: null,
        due_date: dateOnly(-2),
        completed_at: null,
        estimated_hours: '40.00',
        actual_hours: null,
        sort_order: 3,
      },
      {
        // เกินกำหนดโดยตั้งใจเช่นกัน และอยู่ในสถานะ WAITING เพื่อให้เห็นว่า
        // งานที่ไม่ใช่ TODO ก็นับว่าเกินกำหนดได้ ขอแค่ยังไม่ DONE
        project_id: project1,
        title: 'จัดทำคู่มือการใช้งานสำหรับพนักงานคลัง',
        status: 'WAITING',
        priority: 'LOW',
        assigned_user_id: praneeId,
        start_date: dateOnly(-20),
        due_date: dateOnly(-6),
        completed_at: null,
        estimated_hours: '24.00',
        actual_hours: '8.00',
        sort_order: 4,
      },
      {
        project_id: project2,
        title: 'ติดตั้งเซ็นเซอร์อุณหภูมิในโรงเรือน',
        status: 'DONE',
        priority: 'NORMAL',
        assigned_user_id: somchaiId,
        start_date: dateOnly(-35),
        due_date: dateOnly(-20),
        completed_at: daysAgo(19),
        estimated_hours: '48.00',
        actual_hours: '52.00',
        sort_order: 0,
      },
      {
        project_id: project2,
        title: 'พัฒนาหน้าจอแสดงผลอุณหภูมิย้อนหลัง',
        status: 'DOING',
        priority: 'HIGH',
        assigned_user_id: praneeId,
        start_date: dateOnly(-18),
        due_date: dateOnly(12),
        completed_at: null,
        estimated_hours: '90.00',
        actual_hours: '38.00',
        sort_order: 1,
      },
      {
        project_id: project2,
        title: 'ตั้งค่าการแจ้งเตือนผ่าน LINE เมื่ออุณหภูมิเกินกำหนด',
        status: 'TODO',
        priority: 'HIGH',
        assigned_user_id: null,
        start_date: null,
        due_date: dateOnly(20),
        completed_at: null,
        estimated_hours: '32.00',
        actual_hours: null,
        sort_order: 2,
      },
      {
        project_id: project3,
        title: 'ออกแบบและพัฒนาเว็บไซต์',
        status: 'DONE',
        priority: 'NORMAL',
        assigned_user_id: somchaiId,
        start_date: dateOnly(-180),
        due_date: dateOnly(-45),
        completed_at: daysAgo(46),
        estimated_hours: '200.00',
        actual_hours: '212.00',
        sort_order: 0,
      },
      {
        project_id: project3,
        title: 'ย้ายข้อมูลข่าวสารเดิมเข้าระบบใหม่',
        status: 'DONE',
        priority: 'LOW',
        assigned_user_id: praneeId,
        start_date: dateOnly(-50),
        due_date: dateOnly(-32),
        completed_at: daysAgo(30),
        estimated_hours: '24.00',
        actual_hours: '20.00',
        sort_order: 1,
      },
    ];

    await queryInterface.bulkInsert(
      'tasks',
      parentTasks.map((task) => ({ ...task, parent_task_id: null, ...audit })),
    );

    const [insertedParents] = await queryInterface.sequelize.query(
      'SELECT id, title FROM tasks WHERE project_id IN (:ids) AND parent_task_id IS NULL',
      { replacements: { ids: [project1, project2, project3] } },
    );

    const parentIdByTitle = new Map(
      insertedParents.map((row) => [row.title, Number(row.id)]),
    );

    // ---- งานย่อยชั้นที่สอง ---------------------------------------------------
    const subTasks = [
      {
        parent: 'วิเคราะห์ความต้องการและออกแบบระบบ',
        project_id: project1,
        title: 'สัมภาษณ์ผู้ใช้งานฝ่ายคลัง',
        status: 'DONE',
        priority: 'NORMAL',
        assigned_user_id: somchaiId,
        due_date: dateOnly(-52),
        completed_at: daysAgo(53),
        estimated_hours: '16.00',
        actual_hours: '18.00',
        sort_order: 0,
      },
      {
        parent: 'วิเคราะห์ความต้องการและออกแบบระบบ',
        project_id: project1,
        title: 'จัดทำเอกสารสรุปความต้องการ',
        status: 'DONE',
        priority: 'NORMAL',
        assigned_user_id: somchaiId,
        due_date: dateOnly(-44),
        completed_at: daysAgo(43),
        estimated_hours: '24.00',
        actual_hours: '26.00',
        sort_order: 1,
      },
      {
        parent: 'พัฒนาโมดูลรับสินค้าเข้าคลัง',
        project_id: project1,
        title: 'ออกแบบหน้าจอรับสินค้าเข้าคลัง',
        status: 'DONE',
        priority: 'NORMAL',
        assigned_user_id: praneeId,
        due_date: dateOnly(-25),
        completed_at: daysAgo(24),
        estimated_hours: '32.00',
        actual_hours: '30.00',
        sort_order: 0,
      },
      {
        parent: 'พัฒนาโมดูลรับสินค้าเข้าคลัง',
        project_id: project1,
        title: 'เขียน API รับสินค้าเข้าคลัง',
        status: 'DOING',
        priority: 'HIGH',
        assigned_user_id: praneeId,
        due_date: dateOnly(3),
        completed_at: null,
        estimated_hours: '64.00',
        actual_hours: '46.00',
        sort_order: 1,
      },
      {
        parent: 'พัฒนาโมดูลรับสินค้าเข้าคลัง',
        project_id: project1,
        title: 'เชื่อมต่อเครื่องอ่านบาร์โค้ด',
        status: 'TODO',
        priority: 'NORMAL',
        assigned_user_id: null,
        due_date: dateOnly(9),
        completed_at: null,
        estimated_hours: '40.00',
        actual_hours: null,
        sort_order: 2,
      },
      {
        parent: 'พัฒนาโมดูลเบิกจ่ายสินค้า',
        project_id: project1,
        title: 'ออกแบบผังการอนุมัติใบเบิก',
        status: 'TODO',
        priority: 'NORMAL',
        assigned_user_id: null,
        due_date: dateOnly(14),
        completed_at: null,
        estimated_hours: '16.00',
        actual_hours: null,
        sort_order: 0,
      },
      {
        parent: 'ติดตั้งเซ็นเซอร์อุณหภูมิในโรงเรือน',
        project_id: project2,
        title: 'สำรวจตำแหน่งติดตั้งหน้างาน',
        status: 'DONE',
        priority: 'NORMAL',
        assigned_user_id: somchaiId,
        due_date: dateOnly(-30),
        completed_at: daysAgo(31),
        estimated_hours: '8.00',
        actual_hours: '10.00',
        sort_order: 0,
      },
      {
        parent: 'ติดตั้งเซ็นเซอร์อุณหภูมิในโรงเรือน',
        project_id: project2,
        title: 'เดินสายไฟและติดตั้งอุปกรณ์',
        status: 'DONE',
        priority: 'NORMAL',
        assigned_user_id: somchaiId,
        due_date: dateOnly(-22),
        completed_at: daysAgo(20),
        estimated_hours: '40.00',
        actual_hours: '42.00',
        sort_order: 1,
      },
      {
        parent: 'พัฒนาหน้าจอแสดงผลอุณหภูมิย้อนหลัง',
        project_id: project2,
        title: 'ออกแบบกราฟแสดงผลย้อนหลัง 7 วัน',
        status: 'REVIEW',
        priority: 'NORMAL',
        assigned_user_id: praneeId,
        due_date: dateOnly(2),
        completed_at: null,
        estimated_hours: '24.00',
        actual_hours: '22.00',
        sort_order: 0,
      },
    ];

    await queryInterface.bulkInsert(
      'tasks',
      subTasks.map((task) => {
        const { parent, ...rest } = task;
        return { ...rest, parent_task_id: parentIdByTitle.get(parent), start_date: null, ...audit };
      }),
    );

    console.log(
      `demo data: เพิ่มลูกค้า 3 ราย ผู้ติดต่อ 5 ราย บันทึกการติดต่อ 5 รายการ ` +
        `โครงการ 3 โครงการ งาน ${parentTasks.length + subTasks.length} รายการ ` +
        `พนักงาน 3 บัญชี และบทบาท 2 บทบาท`,
    );
    console.log(`demo data: บัญชีตัวอย่างทั้งหมดใช้รหัสผ่าน "${DEMO_PASSWORD}"`);
  },

  async down(queryInterface) {
    const [customers] = await queryInterface.sequelize.query(
      'SELECT id FROM customers WHERE code IN (:codes)',
      { replacements: { codes: DEMO_CUSTOMER_CODES } },
    );

    const customerIds = customers.map((row) => Number(row.id));

    if (customerIds.length > 0) {
      const [projects] = await queryInterface.sequelize.query(
        'SELECT id FROM projects WHERE customer_id IN (:ids)',
        { replacements: { ids: customerIds } },
      );

      const projectIds = projects.map((row) => Number(row.id));

      if (projectIds.length > 0) {
        // งานย่อยต้องไปก่อนงานแม่ ไม่งั้นติด foreign key ที่ชี้กันเองในตาราง
        await queryInterface.sequelize.query(
          'DELETE FROM tasks WHERE project_id IN (:ids) AND parent_task_id IS NOT NULL',
          { replacements: { ids: projectIds } },
        );
        await queryInterface.sequelize.query('DELETE FROM tasks WHERE project_id IN (:ids)', {
          replacements: { ids: projectIds },
        });
        await queryInterface.sequelize.query('DELETE FROM projects WHERE id IN (:ids)', {
          replacements: { ids: projectIds },
        });
      }

      await queryInterface.sequelize.query(
        'DELETE FROM communication_logs WHERE customer_id IN (:ids)',
        { replacements: { ids: customerIds } },
      );
      await queryInterface.sequelize.query('DELETE FROM contacts WHERE customer_id IN (:ids)', {
        replacements: { ids: customerIds },
      });
      await queryInterface.sequelize.query('DELETE FROM customers WHERE id IN (:ids)', {
        replacements: { ids: customerIds },
      });
    }

    const [users] = await queryInterface.sequelize.query(
      'SELECT id FROM users WHERE username IN (:usernames)',
      { replacements: { usernames: DEMO_USERNAMES } },
    );
    const userIds = users.map((row) => Number(row.id));

    if (userIds.length > 0) {
      // audit_logs ชี้มาที่ users ด้วย FK แบบ RESTRICT ต้องเคลียร์ก่อนลบบัญชี
      await queryInterface.sequelize.query('DELETE FROM audit_logs WHERE user_id IN (:ids)', {
        replacements: { ids: userIds },
      });
      await queryInterface.sequelize.query('DELETE FROM user_roles WHERE user_id IN (:ids)', {
        replacements: { ids: userIds },
      });
      await queryInterface.sequelize.query('DELETE FROM users WHERE id IN (:ids)', {
        replacements: { ids: userIds },
      });
    }

    const [roles] = await queryInterface.sequelize.query(
      'SELECT id FROM roles WHERE name IN (:names)',
      { replacements: { names: DEMO_ROLE_NAMES } },
    );
    const roleIds = roles.map((row) => Number(row.id));

    if (roleIds.length > 0) {
      await queryInterface.sequelize.query('DELETE FROM role_permissions WHERE role_id IN (:ids)', {
        replacements: { ids: roleIds },
      });
      await queryInterface.sequelize.query('DELETE FROM user_roles WHERE role_id IN (:ids)', {
        replacements: { ids: roleIds },
      });
      await queryInterface.sequelize.query('DELETE FROM roles WHERE id IN (:ids)', {
        replacements: { ids: roleIds },
      });
    }
  },
};
