/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

/**
 * ข้อมูลตัวอย่างชุดที่ 2 — เติมโมดูลที่ยังว่างอยู่ เพื่อให้เดโมได้ทั้งเส้นทาง (12 ก.ย. 2026)
 *
 * ทำไมต้องมีไฟล์นี้ ทั้งที่มี `20260908000004-seed-demo-data.js` อยู่แล้ว:
 * ตัวนั้นหยุดที่ลูกค้า/โครงการ/งานย่อย ส่วนใบแจ้งปัญหา การส่งมอบ ประกัน สัญญา MA
 * งานติดตาม และแบบประเมิน ยังไม่มีข้อมูลเลย หน้าจอครึ่งระบบจึงว่างเปล่า
 * และฟีเจอร์ที่ frontend ทำเสร็จแล้ว (แถบโควตา MA ตอนเปิดใบ) ไม่มีอะไรให้แสดง
 *
 * **ไม่แก้ไฟล์เดิมที่รันไปแล้ว** ตามกติกาเดียวกับ migration — ฐานของคนที่ migrate ไปแล้ว
 * จะไม่ได้รับการแก้ย้อนหลัง ต้องเป็นไฟล์ใหม่เท่านั้น
 *
 * บทบาทในไฟล์นี้ตั้งตามหลักที่พี่เลี้ยงให้ไว้ในประชุมครั้งที่ 3 (นาที 12:30–17:20):
 *   - 1 ผู้ใช้ ถือได้ 1 บทบาท
 *   - บทบาทยึดที่ "ทำอะไรได้" ไม่ใช่ "อยู่ฝ่ายไหน"
 *   - คนที่ทำหลายหน้าที่ ให้ "สร้างบทบาทใหม่ที่รวมสิทธิ์" ไม่ใช่ให้ถือหลายบทบาท
 * บทบาทที่สามจึงมีไว้เป็นตัวอย่างของกติกาข้อสุดท้ายโดยเฉพาะ
 *
 * เขียนผ่าน queryInterface ตรง ๆ จึงไม่เกิด audit log ซึ่งถูกต้องแล้ว (ไม่มีผู้กระทำจริง)
 * วันที่คำนวณจากวันที่รันเสมอ ของที่ตั้งใจให้เลยกำหนดจึงเลยกำหนดอยู่เสมอ
 *
 * **ไม่มีเอกสารแนบในชุดนี้โดยเจตนา** — แถว documents ต้องมีไฟล์จริงอยู่ในที่เก็บคู่กัน
 * ถ้า seed แต่แถว ปุ่มดาวน์โหลดจะ 404 ตอนเดโมซึ่งแย่กว่าไม่มีข้อมูล
 * ให้อัปโหลดสดผ่านหน้าจอตอนสาธิตแทน (ใช้เวลาไม่ถึงนาทีและได้โชว์ฟีเจอร์จริง)
 */

const MARKER_TICKET_NO = 'TK-DEMO-001';

const ROLE_SUPPORT = 'ซัพพอร์ตรับเรื่อง';
const ROLE_SALES = 'ดูแลลูกค้าและงานขาย';
const ROLE_STAFF = 'พนักงานแก้ใบ';

/**
 * สิทธิ์ของแต่ละบทบาท — ตรงสาย C-1
 *
 * **ห้ามใส่สิทธิ์ที่ยังไม่มี endpoint รองรับ** (`customer.delete`, `file.*`, `task.assign`,
 * `audit.view`, `*.export`) เพราะจะกลายเป็นช่องติ๊กที่ติ๊กแล้วไม่มีผล ซึ่งคนเดโมจะงง
 *
 * `ticket.assign` ไม่อยู่ในบทบาทซัพพอร์ตโดยเจตนา — พี่เลี้ยง: "รับเรื่องไม่ต้องระบุผู้รับผิดชอบ
 * หัวหน้ามอบหมายทีหลัง" และ "ใครเป็นคนรับเรื่อง ใครเป็นคนโยนงาน มันอยู่ที่บทบาท" (นาที 54:10)
 * ในเดโมให้ใช้บัญชี somchai (ADMIN) เป็นหัวหน้าที่มอบหมายงาน
 *
 * `ticket.support_queue` **ต้องมี** ในบทบาทซัพพอร์ต — แยกจาก ticket.view/create ของหน้าปัญหา
 *
 * `ticket.resolve` อยู่ที่พนักงานแก้ใบ ไม่ใช่ซัพพอร์ต
 *
 * `project.create` ไม่อยู่ในบทบาทซัพพอร์ตเช่นกัน — การเปิดโปรเจคใหม่ไม่ใช่หน้าที่ของ
 * คนดูแลใบแจ้งปัญหา ถ้าใส่เข้าไปก็เท่ากับกลับไปเป็น "บทบาทเดียวทำได้ทุกอย่าง"
 *
 * `ma.view` **ต้องมี** ในซัพพอร์ต ไม่งั้นแถบโควตา MA ตอนเปิดใบจะได้ 403 แล้วหายไปเงียบ ๆ
 */
const SUPPORT_CODES = [
  'ticket.view',
  'ticket.create',
  'ticket.update',
  'ticket.reopen',
  'ticket.close',
  'ticket.support_queue',
  'ma.view',
  'customer.view',
  'contact.view',
  'project.view',
  'communication.view',
  'communication.create',
  'followup.view',
  'followup.create',
  'followup.update',
  'followup.complete',
  'document.view',
  'delivery.view',
  'warranty.view',
  'notification.view',
];

const STAFF_CODES = [
  'ticket.view',
  'ticket.update',
  'ticket.resolve',
  'ticket.reopen',
  'project.view',
  'task.view',
  'task.create',
  'task.update',
  'delivery.view',
  'document.view',
  'notification.view',
];

const SALES_CODES = [
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
  'project.create',
  'project.update',
  'followup.view',
  'followup.create',
  'followup.update',
  'followup.complete',
  'document.view',
  'document.create',
  'survey.view',
  'survey.send',
  'report.view',
  'ma.view',
  'notification.view',
];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysAgo(n) {
  return new Date(Date.now() - n * MS_PER_DAY);
}

function daysAhead(n) {
  return new Date(Date.now() + n * MS_PER_DAY);
}

function dateOnly(d) {
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/** วันที่ 1 ของเดือนปัจจุบัน + offset เดือน — ใช้ตรึงรอบโควตาให้ตรงกับเดือนปฏิทินพอดี */
function monthStart(offsetMonths) {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + offsetMonths, 1);
}

/**
 * บวกเดือนแบบหนีบวันสิ้นเดือน — ต้องให้ผลตรงกับ `addMonths()` ใน common/utils/date.util.ts
 * ไม่งั้นวันหมดประกันในข้อมูลตัวอย่างจะไม่ตรงกับที่ระบบคำนวณเองเวลาแก้ระยะประกัน
 */
function addMonths(dateStr, months) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const target = new Date(y, m - 1 + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d, lastDay));
  return dateOnly(target);
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

/** ดึง id แถวเดียวด้วยเงื่อนไขอิสระ — ใช้กับตารางที่ไม่มีคอลัมน์รหัสให้ map */
async function idOf(queryInterface, sql, replacements) {
  const [rows] = await queryInterface.sequelize.query(sql, { replacements });
  return rows.length > 0 ? Number(rows[0].id) : null;
}

module.exports = {
  async up(queryInterface) {
    if (process.env.NODE_ENV === 'production') {
      console.log('demo phase 3: ข้ามเพราะรันอยู่บน production');
      return;
    }

    const [marker] = await queryInterface.sequelize.query(
      'SELECT id FROM tickets WHERE ticket_no = :no LIMIT 1',
      { replacements: { no: MARKER_TICKET_NO } },
    );

    if (marker.length > 0) {
      console.log('demo phase 3: มีข้อมูลชุดนี้อยู่แล้ว ข้ามการเพิ่ม');
      return;
    }

    const customerIds = await mapIdsBy(queryInterface, 'customers', 'code', [
      'CUS-DEMO-001',
      'CUS-DEMO-002',
    ]);
    const projectIds = await mapIdsBy(queryInterface, 'projects', 'code', [
      'PRJ-DEMO-001',
      'PRJ-DEMO-002',
    ]);
    const userIds = await mapIdsBy(queryInterface, 'users', 'username', [
      'somchai',
      'Tom',
      'pranee',
      'wichai',
    ]);

    if (projectIds.size < 2 || !userIds.has('somchai') || !userIds.has('pranee') || !userIds.has('wichai')) {
      console.log('demo phase 3: ยังไม่มีข้อมูลตัวอย่างชุดแรก ข้าม — รัน seeder ตัวก่อนหน้าให้ครบก่อน');
      return;
    }

    const [admins] = await queryInterface.sequelize.query(
      "SELECT id FROM users WHERE account_type = 'SUPER_ADMIN' ORDER BY id LIMIT 1",
    );

    if (admins.length === 0) {
      throw new Error('demo phase 3: ยังไม่มีบัญชี SUPER_ADMIN');
    }

    const actorId = Number(admins[0].id);
    const now = new Date();
    const audit = auditValues(now, actorId);
    const junctionAudit = { created_at: now, created_by: actorId };

    const customerA = customerIds.get('CUS-DEMO-001');
    const customerB = customerIds.get('CUS-DEMO-002');
    const projectA = projectIds.get('PRJ-DEMO-001');
    const projectB = projectIds.get('PRJ-DEMO-002');
    const somchaiId = userIds.get('somchai');
    let tomId = userIds.get('Tom');
    const praneeId = userIds.get('pranee');
    const wichaiId = userIds.get('wichai');

    // ฐานเก่าที่ seed ชุดแรกยังไม่มี Tom — สร้างให้ตรง C-1 (ซัพพอร์ตคนละคนจากขาย)
    if (!tomId) {
      const bcrypt = require('bcrypt');
      const passwordHash = await bcrypt.hash(
        process.env.DEMO_USER_PASSWORD || 'Demo@1234',
        Number(process.env.BCRYPT_SALT_ROUNDS || 10),
      );
      await queryInterface.bulkInsert('users', [
        {
          employee_code: 'EMP-104',
          username: 'Tom',
          email: 'tom@example.com',
          password_hash: passwordHash,
          full_name: 'รัชชานนท์ สว่างศรี',
          nickname: 'ต้อม',
          phone: '081-444-4444',
          position: 'เจ้าหน้าที่ซัพพอร์ต',
          avatar_url: null,
          line_user_id: null,
          account_type: 'USER',
          status: 'ACTIVE',
          last_login_at: null,
          refresh_token_hash: null,
          ...audit,
        },
      ]);
      tomId = (
        await mapIdsBy(queryInterface, 'users', 'username', ['Tom'])
      ).get('Tom');
    }

    // จัด position ให้ตรง Role — กันชื่อปนจนจำสลับ (ประชุม C-1)
    await queryInterface.sequelize.query(
      `UPDATE users SET position = :pos, updated_at = :now, updated_by = :actor WHERE username = :u`,
      { replacements: { pos: 'เจ้าหน้าที่ซัพพอร์ต', now, actor: actorId, u: 'Tom' } },
    );
    await queryInterface.sequelize.query(
      `UPDATE users SET position = :pos, updated_at = :now, updated_by = :actor WHERE username = :u`,
      { replacements: { pos: 'เจ้าหน้าที่ฝ่ายขาย', now, actor: actorId, u: 'pranee' } },
    );
    await queryInterface.sequelize.query(
      `UPDATE users SET position = :pos, updated_at = :now, updated_by = :actor WHERE username = :u`,
      { replacements: { pos: 'พนักงานแก้ใบ', now, actor: actorId, u: 'wichai' } },
    );

    const contactA = await idOf(
      queryInterface,
      'SELECT id FROM contacts WHERE customer_id = :c ORDER BY is_primary DESC, id LIMIT 1',
      { c: customerA },
    );
    const contactB = await idOf(
      queryInterface,
      'SELECT id FROM contacts WHERE customer_id = :c ORDER BY is_primary DESC, id LIMIT 1',
      { c: customerB },
    );

    // ---- บทบาทตามสาย C-1 (ชื่อเดียวกับ seed ชุดแรก — อัปเดตสิทธิ์/มอบหมาย ไม่สร้างซ้ำ) ----
    const roleNames = [ROLE_SUPPORT, ROLE_SALES, ROLE_STAFF];
    const roleIds = await mapIdsBy(queryInterface, 'roles', 'name', roleNames);

    for (const [name, description] of [
      [ROLE_SUPPORT, 'รับเรื่องลูกค้า เปิดใบ ส่งหัวหน้า และบอกลูกค้า — ไม่มอบหมายและไม่ลงมือแก้'],
      [ROLE_SALES, 'ดูแลลูกค้า เปิดโปรเจค ติดตาม และรายงาน — ไม่เข้าคิวใบปัญหา'],
      [ROLE_STAFF, 'รับใบที่แอดมินมอบหมาย เริ่มงาน บันทึกรอบแก้ และทำงานย่อยในโปรเจค'],
    ]) {
      if (!roleIds.has(name)) {
        await queryInterface.bulkInsert('roles', [
          {
            name,
            description,
            is_system: false,
            is_active: true,
            ...audit,
          },
        ]);
      } else {
        await queryInterface.sequelize.query(
          'UPDATE roles SET description = :description, is_active = 1, updated_at = :now WHERE id = :id',
          { replacements: { description, now, id: roleIds.get(name) } },
        );
      }
    }

    const roleIdsFresh = await mapIdsBy(queryInterface, 'roles', 'name', roleNames);
    const allCodes = Array.from(new Set([...SUPPORT_CODES, ...SALES_CODES, ...STAFF_CODES]));
    const permissionIds = await mapIdsBy(queryInterface, 'permissions', 'code', allCodes);

    for (const roleName of roleNames) {
      const roleId = roleIdsFresh.get(roleName);
      if (roleId) {
        await queryInterface.sequelize.query('DELETE FROM role_permissions WHERE role_id = :id', {
          replacements: { id: roleId },
        });
      }
    }

    const rolePermissionRows = [];
    for (const [roleName, codes] of [
      [ROLE_SUPPORT, SUPPORT_CODES],
      [ROLE_SALES, SALES_CODES],
      [ROLE_STAFF, STAFF_CODES],
    ]) {
      for (const code of codes) {
        const permissionId = permissionIds.get(code);
        if (permissionId) {
          rolePermissionRows.push({
            role_id: roleIdsFresh.get(roleName),
            permission_id: permissionId,
            ...junctionAudit,
          });
        }
      }
    }

    await queryInterface.bulkInsert('role_permissions', rolePermissionRows);

    // Tom = ซัพพอร์ต · pranee = ขาย · wichai = พนักงานแก้ใบ
    // somchai = ADMIN ไม่ผูก Role
    await queryInterface.sequelize.query(
      'DELETE FROM user_roles WHERE user_id IN (:ids)',
      { replacements: { ids: [tomId, praneeId, wichaiId] } },
    );

    await queryInterface.bulkInsert('user_roles', [
      { user_id: tomId, role_id: roleIdsFresh.get(ROLE_SUPPORT), ...junctionAudit },
      { user_id: praneeId, role_id: roleIdsFresh.get(ROLE_SALES), ...junctionAudit },
      { user_id: wichaiId, role_id: roleIdsFresh.get(ROLE_STAFF), ...junctionAudit },
    ]);

    // ---- การส่งมอบ 2 รอบ + ประกัน (BR-06) ----------------------------------
    // รอบแรกเป็นเฟสระหว่างทาง (is_final = false) ออกประกันไม่ได้
    // รอบสองเป็นครั้งสุดท้ายที่ลูกค้ายอมรับแล้ว จึงออกประกันได้ — ตรงกับกฎ Phase 6
    //
    // **ต้องเช็คก่อนว่าโปรเจคนี้มีการส่งมอบครั้งสุดท้ายอยู่แล้วหรือยัง** — กฎ Phase 6 บังคับว่า
    // 1 โครงการมีได้ใบเดียว แต่ seeder เขียนลงตารางตรง ๆ จึงไม่ผ่าน service ที่บังคับกฎนั้นให้
    // ถ้าฐานเคยถูกคีย์ด้วยมือผ่านหน้าจอมาก่อน (ซึ่งเกิดขึ้นจริงตอนทดสอบ) การใส่เพิ่มดื้อ ๆ
    // จะได้โปรเจคที่มีครั้งสุดท้าย 2 ใบ ซึ่งเป็นสถานะที่ API ไม่มีทางสร้างได้เอง
    const existingFinalDelivery = await idOf(
      queryInterface,
      "SELECT id FROM deliveries WHERE project_id = :p AND is_final = 1 " +
        "AND acceptance_status = 'ACCEPTED' AND deleted_at IS NULL LIMIT 1",
      { p: projectA },
    );

    const phaseDeliveredAt = daysAgo(120);
    const finalDeliveredAt = daysAgo(60);

    const demoDeliveries = [
      {
        project_id: projectA,
        delivery_no: 'DL-DEMO-001',
        title: 'ส่งมอบเฟสที่ 1 — โมดูลรับเข้าและจ่ายออก',
        version: 'v0.9.0',
        description: 'ส่งให้ทดลองใช้ก่อน ยังไม่ครบขอบเขต',
        delivered_at: phaseDeliveredAt,
        acceptance_status: 'ACCEPTED',
        accepted_at: daysAgo(118),
        accepted_by_contact_id: contactA,
        is_final: false,
        note: null,
        delivered_by_user_id: somchaiId,
        ...audit,
      },
      {
        project_id: projectA,
        delivery_no: 'DL-DEMO-002',
        title: 'ส่งมอบงานครบตามขอบเขต พร้อมคู่มือและอบรมผู้ใช้',
        version: 'v1.0.0',
        description: 'ส่งมอบครั้งสุดท้าย ลูกค้าตรวจรับแล้ว',
        delivered_at: finalDeliveredAt,
        acceptance_status: 'ACCEPTED',
        accepted_at: daysAgo(58),
        accepted_by_contact_id: contactA,
        is_final: true,
        note: null,
        delivered_by_user_id: somchaiId,
        ...audit,
      },
    ];

    let finalDeliveryId = existingFinalDelivery;

    if (existingFinalDelivery) {
      console.log(
        'demo phase 3: โปรเจคนี้มีการส่งมอบครั้งสุดท้ายอยู่แล้ว — ใช้ใบเดิมต่อ ไม่เพิ่มใบใหม่ ' +
          '(กฎ Phase 6: 1 โครงการมีครั้งสุดท้ายที่ยอมรับแล้วได้ใบเดียว)',
      );
    } else {
      await queryInterface.bulkInsert('deliveries', demoDeliveries);
      finalDeliveryId = await idOf(
        queryInterface,
        'SELECT id FROM deliveries WHERE delivery_no = :no LIMIT 1',
        { no: 'DL-DEMO-002' },
      );
    }

    // ---- สัญญา MA -----------------------------------------------------------
    // เริ่มวันที่ 1 ของเดือนย้อนหลัง 2 เดือน เพื่อให้รอบโควตาตรงกับเดือนปฏิทินพอดี
    // (โหมดเริ่มต้นคือ CONTRACT_ANNIVERSARY — เริ่มวันที่ 1 จึงได้รอบ 1 ถึงสิ้นเดือน)
    // หน้าจอจะอ่าน periodStart/periodEnd จาก API อยู่แล้ว ไม่ได้เดาจากปี/เดือน
    const contractStart = dateOnly(monthStart(-2));
    const contractEnd = addMonths(contractStart, 12);
    const planId = await idOf(queryInterface, 'SELECT id FROM ma_plans WHERE code = :c LIMIT 1', {
      c: 'MA-STANDARD',
    });

    await queryInterface.bulkInsert('ma_contracts', [
      {
        customer_id: customerA,
        project_id: projectA,
        plan_id: planId,
        previous_contract_id: null,
        contract_no: 'MA-DEMO-001',
        // มูลค่ารวมตลอดอายุสัญญา ไม่ใช่ราคาต่อเดือน (กฎ Phase 8)
        price: '60000.00',
        billing_cycle: 'YEARLY',
        start_date: contractStart,
        end_date: contractEnd,
        status: 'ACTIVE',
        signed_date: contractStart,
        signed_file_url: null,
        note: 'สัญญาตัวอย่างสำหรับเดโม',
        ...audit,
      },
    ]);

    const contractId = await idOf(
      queryInterface,
      'SELECT id FROM ma_contracts WHERE contract_no = :no LIMIT 1',
      { no: 'MA-DEMO-001' },
    );

    // ประกัน 12 เดือนจากการส่งมอบครั้งสุดท้าย + ผูกสัญญา MA (B-13)
    // การผูกเป็นการ *อ้างอิง* ให้รู้ว่าประกันใบนี้มาคู่กับแผนไหน ไม่มีการคิดรวมใด ๆ
    //
    // ถ้าใบส่งมอบนั้นมีประกันอยู่แล้ว (ฐานที่เคยคีย์ด้วยมือ) ให้ *ผูกสัญญาเข้ากับใบเดิม*
    // แทนการออกใบใหม่ — กฎ Phase 6 ห้ามประกันระยะซ้ำบนใบส่งมอบเดียวกันอยู่แล้ว
    // และการมีประกัน 2 ใบบนงานเดียวกันทำให้ตอนเดโมอธิบายไม่ได้ว่าใบไหนของจริง
    const existingWarrantyId = await idOf(
      queryInterface,
      "SELECT id FROM warranties WHERE delivery_id = :d AND status <> 'VOID' " +
        'AND deleted_at IS NULL LIMIT 1',
      { d: finalDeliveryId },
    );

    const [deliveredRows] = await queryInterface.sequelize.query(
      'SELECT delivered_at FROM deliveries WHERE id = :d LIMIT 1',
      { replacements: { d: finalDeliveryId } },
    );
    // วันเริ่มประกันต้องเท่ากับวันส่งมอบของใบที่ใช้จริงเสมอ (BR-06) ไม่ใช่วันที่ seeder ตั้งไว้
    const warrantyStart = dateOnly(new Date(deliveredRows[0].delivered_at));

    let warrantyId = existingWarrantyId;

    if (existingWarrantyId) {
      await queryInterface.sequelize.query(
        'UPDATE warranties SET ma_contract_id = :c, updated_at = :now, updated_by = :actor WHERE id = :id',
        { replacements: { c: contractId, now, actor: actorId, id: existingWarrantyId } },
      );
      console.log('demo phase 3: ผูกสัญญา MA เข้ากับประกันใบที่มีอยู่แล้ว (B-13)');
    } else {
      await queryInterface.bulkInsert('warranties', [
        {
          delivery_id: finalDeliveryId,
          project_id: projectA,
          ma_contract_id: contractId,
          duration_month: 12,
          start_date: warrantyStart,
          end_date: addMonths(warrantyStart, 12),
          status: 'ACTIVE',
          scope_note:
            'ครอบคลุมข้อผิดพลาดของฟังก์ชันตามเอกสารข้อกำหนด v1.0 ' +
            'ไม่รวมการเพิ่มรายงานใหม่หรือเปลี่ยนขั้นตอนการทำงาน',
          ...audit,
        },
      ]);

      warrantyId = await idOf(
        queryInterface,
        'SELECT id FROM warranties WHERE delivery_id = :d ORDER BY id DESC LIMIT 1',
        { d: finalDeliveryId },
      );
    }

    // โครงการที่ส่งมอบครั้งสุดท้ายแล้วต้องเป็น DELIVERED พร้อมวันปิดจริง (กฎ Phase 5)
    // ปกติระบบตั้งให้เองตอนตรวจรับ แต่ seeder เขียนลงตารางตรง ๆ จึงต้องตั้งให้ตรงกันเอง
    await queryInterface.sequelize.query(
      "UPDATE projects SET status = 'DELIVERED', actual_end_date = :d WHERE id = :id",
      { replacements: { d: warrantyStart, id: projectA } },
    );

    // ---- ใบแจ้งปัญหา 5 ใบ ---------------------------------------------------
    await queryInterface.bulkInsert('tickets', [
      {
        ticket_no: MARKER_TICKET_NO,
        customer_id: customerA,
        project_id: projectA,
        warranty_id: warrantyId,
        ma_contract_id: contractId,
        title: 'สแกนบาร์โค้ดรับสินค้าแล้วระบบค้าง',
        description: 'พนักงานคลังแจ้งว่าสแกนรับของเข้าคลังแล้วหน้าจอค้างประมาณ 10 วินาที',
        status: 'RECEIVED',
        priority: 'HIGH',
        billing_type: 'WARRANTY',
        reported_channel: 'PHONE',
        reported_at: daysAgo(1),
        reported_by_contact_id: contactA,
        // ยังไม่มอบหมาย — โชว์คิว "รับเรื่องแล้วรอหัวหน้าส่งงาน" ตามที่พี่เลี้ยงอธิบาย
        assigned_user_id: null,
        received_by_user_id: tomId,
        resolution_count: 0,
        first_response_at: null,
        resolved_at: null,
        closed_at: null,
        due_at: daysAhead(2),
        extra_charge: null,
        ...audit,
      },
      {
        ticket_no: 'TK-DEMO-002',
        customer_id: customerA,
        project_id: projectA,
        warranty_id: warrantyId,
        ma_contract_id: contractId,
        title: 'ขอเพิ่มรายงานสรุปยอดคงเหลือรายเดือน',
        description: 'ลูกค้าขอรายงานใหม่ที่ไม่ได้อยู่ในขอบเขตเดิม ตกลงหักโควตา MA',
        status: 'IN_PROGRESS',
        priority: 'NORMAL',
        // อยู่ในระยะประกันแต่เป็นงานขอเพิ่มใหม่ จึงไม่ใช่ WARRANTY (BR-07)
        billing_type: 'MA_QUOTA',
        reported_channel: 'LINE',
        reported_at: daysAgo(5),
        reported_by_contact_id: contactA,
        assigned_user_id: wichaiId,
        received_by_user_id: tomId,
        resolution_count: 0,
        first_response_at: daysAgo(5),
        resolved_at: null,
        closed_at: null,
        due_at: daysAhead(5),
        extra_charge: null,
        ...audit,
      },
      {
        ticket_no: 'TK-DEMO-003',
        customer_id: customerA,
        project_id: projectA,
        warranty_id: warrantyId,
        ma_contract_id: contractId,
        title: 'ยอดสินค้าคงเหลือไม่ตรงหลังจ่ายออกหลายรายการพร้อมกัน',
        description: 'แก้ไปแล้วรอบหนึ่งแต่ยังเจอซ้ำ จึงแก้เพิ่มอีกรอบในใบเดิม (BR-04)',
        status: 'RESOLVED',
        priority: 'URGENT',
        billing_type: 'WARRANTY',
        reported_channel: 'PHONE',
        reported_at: daysAgo(30),
        reported_by_contact_id: contactA,
        assigned_user_id: wichaiId,
        received_by_user_id: tomId,
        resolution_count: 2,
        first_response_at: daysAgo(30),
        resolved_at: daysAgo(12),
        closed_at: null,
        due_at: daysAgo(25),
        extra_charge: null,
        ...audit,
      },
      {
        ticket_no: 'TK-DEMO-004',
        customer_id: customerB,
        project_id: projectB,
        warranty_id: null,
        ma_contract_id: null,
        title: 'เซ็นเซอร์อุณหภูมิโรงเรือนที่ 2 ส่งค่าไม่ครบ',
        description: 'ปิดงานไปแล้ว เก็บไว้สาธิตการเปิดรอบใหม่ในใบเดิมเมื่อปัญหาเดิมกลับมา',
        status: 'CLOSED',
        priority: 'NORMAL',
        billing_type: 'ONE_TIME',
        reported_channel: 'LINE',
        reported_at: daysAgo(75),
        reported_by_contact_id: contactB,
        assigned_user_id: wichaiId,
        received_by_user_id: tomId,
        resolution_count: 1,
        first_response_at: daysAgo(75),
        resolved_at: daysAgo(70),
        closed_at: daysAgo(68),
        due_at: daysAgo(72),
        extra_charge: null,
        ...audit,
      },
      {
        ticket_no: 'TK-DEMO-005',
        customer_id: customerB,
        project_id: projectB,
        warranty_id: null,
        ma_contract_id: null,
        title: 'แอปมือถือแจ้งเตือนอุณหภูมิช้ากว่าที่ตกลงไว้',
        description: 'เคยแก้แล้วแต่กลับมาเป็นซ้ำ เปิดรอบใหม่ในใบเดิม ยังไม่มีคนรับงานรอบนี้',
        status: 'REOPENED',
        priority: 'HIGH',
        billing_type: 'FREE',
        reported_channel: 'LINE',
        reported_at: daysAgo(45),
        reported_by_contact_id: contactB,
        // REOPENED + ยังไม่มอบหมาย = คิว "กลับมาแล้วยังไม่มีใครหยิบ" ที่กฎ Phase 7 พูดถึง
        assigned_user_id: null,
        received_by_user_id: tomId,
        resolution_count: 1,
        first_response_at: daysAgo(45),
        resolved_at: daysAgo(40),
        closed_at: null,
        due_at: daysAgo(2),
        extra_charge: null,
        ...audit,
      },
    ]);

    const ticketIds = await mapIdsBy(queryInterface, 'tickets', 'ticket_no', [
      MARKER_TICKET_NO,
      'TK-DEMO-002',
      'TK-DEMO-003',
      'TK-DEMO-004',
      'TK-DEMO-005',
    ]);

    // ---- รอบการแก้ไข (BR-03 — 1 ปัญหาแก้ได้หลายรอบ) -------------------------
    await queryInterface.bulkInsert('ticket_resolutions', [
      {
        ticket_id: ticketIds.get('TK-DEMO-003'),
        round: 1,
        result: 'PARTIAL',
        detail: 'ปรับการล็อกแถวตอนตัดสต็อก ทดสอบแล้วดีขึ้นแต่ยังเจอในกรณีจ่ายออกพร้อมกันเกิน 5 รายการ',
        root_cause: 'ไม่ได้ล็อกแถวก่อนอ่านยอดคงเหลือ ทำให้สองคำสั่งอ่านค่าเดียวกัน',
        resolved_by_user_id: wichaiId,
        started_at: daysAgo(28),
        resolved_at: daysAgo(27),
        hours_spent: '3.50',
        ...audit,
      },
      {
        ticket_id: ticketIds.get('TK-DEMO-003'),
        round: 2,
        result: 'SUCCESS',
        detail: 'เปลี่ยนไปใช้ทรานแซกชันเดียวตลอดการตัดสต็อก ทดสอบพร้อมกัน 20 รายการแล้วยอดตรง',
        root_cause: 'รอบแรกแก้ไม่ครบ ยังมีอีกเส้นทางที่ไม่ได้อยู่ในทรานแซกชัน',
        resolved_by_user_id: wichaiId,
        started_at: daysAgo(13),
        resolved_at: daysAgo(12),
        hours_spent: '5.00',
        ...audit,
      },
      {
        ticket_id: ticketIds.get('TK-DEMO-004'),
        round: 1,
        result: 'SUCCESS',
        detail: 'เปลี่ยนสายสัญญาณเซ็นเซอร์ตัวที่ 2 และปรับรอบการส่งค่าเป็นทุก 5 นาที',
        root_cause: 'สายสัญญาณเสื่อมจากความชื้นในโรงเรือน',
        resolved_by_user_id: wichaiId,
        started_at: daysAgo(73),
        resolved_at: daysAgo(70),
        hours_spent: '4.00',
        ...audit,
      },
      {
        ticket_id: ticketIds.get('TK-DEMO-005'),
        round: 1,
        result: 'PARTIAL',
        detail: 'ปรับรอบ polling ของแอปให้ถี่ขึ้น ลูกค้าแจ้งว่ายังช้าอยู่ในช่วงกลางคืน',
        root_cause: 'แอปดึงข้อมูลตามรอบ ไม่ได้รับ push จากเซิร์ฟเวอร์',
        resolved_by_user_id: wichaiId,
        started_at: daysAgo(42),
        resolved_at: daysAgo(40),
        hours_spent: null,
        ...audit,
      },
    ]);

    // ---- การหักโควตา MA -----------------------------------------------------
    // หักครั้งเดียวต่อใบ ไม่ใช่ต่อรอบ (ma_usages.ticket_id เป็น UNIQUE ตาม Phase 1)
    const usageAt = new Date();
    await queryInterface.bulkInsert('ma_usages', [
      {
        contract_id: contractId,
        ticket_id: ticketIds.get('TK-DEMO-002'),
        resolution_id: null,
        period_year: usageAt.getFullYear(),
        period_month: usageAt.getMonth() + 1,
        used_at: usageAt,
        is_over_quota: false,
        extra_charge: '0.00',
        note: null,
        ...audit,
      },
    ]);

    // ---- งานติดตาม (B-14 — ผูกกับโปรเจค) ------------------------------------
    await queryInterface.bulkInsert('follow_ups', [
      {
        customer_id: customerA,
        project_id: projectA,
        title: 'ตามผลหลังแก้ปัญหายอดสินค้าไม่ตรง',
        detail: 'โทรถามว่าหลังแก้รอบที่ 2 แล้วยังเจอปัญหาอีกไหม',
        due_date: dateOnly(daysAgo(5)),
        // สถานะยังเป็น PLANNED โดยเจตนา — OVERDUE เป็นค่าที่ระบบ *คำนวณ* ไม่ใช่ค่าที่ตั้ง
        // หน้าจอต้องอ่าน isOverdue ไม่ใช่ status (กฎ M7) แถวนี้จึงเป็นตัวพิสูจน์
        status: 'PLANNED',
        assigned_user_id: tomId,
        completed_at: null,
        result_note: null,
        ...audit,
      },
      {
        customer_id: customerA,
        project_id: projectA,
        title: 'นัดทบทวนการใช้งานก่อนหมดประกัน',
        detail: 'ประกันหมดปีหน้า นัดคุยเรื่องต่อสัญญา MA ล่วงหน้า',
        due_date: dateOnly(daysAhead(3)),
        status: 'PLANNED',
        assigned_user_id: praneeId,
        completed_at: null,
        result_note: null,
        ...audit,
      },
      {
        customer_id: customerB,
        project_id: projectB,
        title: 'ตามผลการเปลี่ยนเซ็นเซอร์โรงเรือนที่ 2',
        detail: 'เช็กว่าค่าที่ส่งมาครบแล้วจริงหลังเปลี่ยนสาย',
        due_date: dateOnly(daysAgo(20)),
        status: 'DONE',
        assigned_user_id: wichaiId,
        completed_at: daysAgo(19),
        result_note: 'โทรแล้ว ลูกค้าแจ้งว่าค่าครบปกติตลอด 2 สัปดาห์',
        ...audit,
      },
    ]);

    // ---- แบบประเมิน (Q1 — พนักงานคีย์คำตอบแทนลูกค้า) -------------------------
    await queryInterface.bulkInsert('surveys', [
      {
        title: 'แบบประเมินความพึงพอใจหลังส่งมอบงาน',
        description: 'ใช้สอบถามลูกค้าหลังปิดโปรเจคหรือหลังแก้ปัญหาสำคัญ',
        status: 'ACTIVE',
        valid_from: dateOnly(daysAgo(90)),
        valid_to: dateOnly(daysAhead(180)),
        ...audit,
      },
    ]);

    const surveyId = await idOf(
      queryInterface,
      'SELECT id FROM surveys WHERE title = :t ORDER BY id DESC LIMIT 1',
      { t: 'แบบประเมินความพึงพอใจหลังส่งมอบงาน' },
    );

    await queryInterface.bulkInsert('survey_questions', [
      {
        survey_id: surveyId,
        question_text: 'ความพึงพอใจโดยรวมต่อระบบที่ส่งมอบ',
        question_type: 'RATING',
        is_required: true,
        options: null,
        min_value: 1,
        max_value: 5,
        sort_order: 0,
        ...audit,
      },
      {
        survey_id: surveyId,
        question_text: 'ความรวดเร็วในการแก้ปัญหา',
        question_type: 'RATING',
        is_required: true,
        options: null,
        min_value: 1,
        max_value: 5,
        sort_order: 1,
        ...audit,
      },
      {
        survey_id: surveyId,
        question_text: 'ช่องทางที่สะดวกที่สุดในการติดต่อทีมงาน',
        question_type: 'CHOICE',
        is_required: true,
        options: JSON.stringify(['LINE', 'โทรศัพท์', 'อีเมล', 'เข้าพบ']),
        min_value: null,
        max_value: null,
        sort_order: 2,
        ...audit,
      },
      {
        survey_id: surveyId,
        question_text: 'สิ่งที่อยากให้ปรับปรุงเพิ่มเติม',
        question_type: 'TEXT',
        is_required: false,
        options: null,
        min_value: null,
        max_value: null,
        sort_order: 3,
        ...audit,
      },
    ]);

    const [questions] = await queryInterface.sequelize.query(
      'SELECT id, sort_order FROM survey_questions WHERE survey_id = :s ORDER BY sort_order',
      { replacements: { s: surveyId } },
    );
    const questionId = (order) => Number(questions.find((q) => q.sort_order === order).id);

    await queryInterface.bulkInsert('survey_assignments', [
      {
        survey_id: surveyId,
        customer_id: customerA,
        contact_id: contactA,
        project_id: projectA,
        status: 'ANSWERED',
        // access_token ไม่ถูกใช้โดยเจตนา — ลูกค้าไม่มีบัญชีและไม่มีลิงก์สาธารณะ (BR-01, Q1)
        access_token: null,
        token_expires_at: null,
        filled_by_user_id: praneeId,
        sent_at: daysAgo(50),
        answered_at: daysAgo(44),
        ...audit,
      },
    ]);

    const assignmentId = await idOf(
      queryInterface,
      'SELECT id FROM survey_assignments WHERE survey_id = :s ORDER BY id DESC LIMIT 1',
      { s: surveyId },
    );

    await queryInterface.bulkInsert('survey_responses', [
      {
        assignment_id: assignmentId,
        survey_id: surveyId,
        customer_id: customerA,
        submitted_at: daysAgo(44),
        // เฉลี่ยจากคำถาม RATING ที่ตอบจริงเท่านั้น (4 กับ 5) — ไม่นับข้อที่ไม่ใช่คะแนน
        overall_score: '4.50',
        comment: 'ทีมงานตอบไว ระบบใช้งานง่ายกว่าที่คาดไว้',
        ...audit,
      },
    ]);

    const responseId = await idOf(
      queryInterface,
      'SELECT id FROM survey_responses WHERE assignment_id = :a LIMIT 1',
      { a: assignmentId },
    );

    await queryInterface.bulkInsert('survey_answers', [
      {
        response_id: responseId,
        question_id: questionId(0),
        answer_text: null,
        answer_number: '5.00',
        answer_json: null,
        ...audit,
      },
      {
        response_id: responseId,
        question_id: questionId(1),
        answer_text: null,
        answer_number: '4.00',
        answer_json: null,
        ...audit,
      },
      {
        response_id: responseId,
        question_id: questionId(2),
        answer_text: 'LINE',
        answer_number: null,
        answer_json: null,
        ...audit,
      },
      {
        response_id: responseId,
        question_id: questionId(3),
        answer_text: 'อยากให้มีรายงานสรุปรายเดือนส่งอัตโนมัติ',
        answer_number: null,
        answer_json: null,
        ...audit,
      },
    ]);

    console.log(
      'demo phase 3: เพิ่มบทบาท 3 อัน, ส่งมอบ 2 รอบ + ประกันผูกสัญญา MA, ใบแจ้งปัญหา 5 ใบ ' +
        '(มีใบที่แก้ 2 รอบ), สัญญา MA ที่ใช้งานอยู่ + หักโควตา 1 ครั้ง, งานติดตาม 3 งาน, ' +
        'แบบประเมิน 1 ฉบับพร้อมคำตอบ — เอกสารแนบให้อัปโหลดสดผ่านหน้าจอ',
    );
  },

  async down(queryInterface) {
    const [tickets] = await queryInterface.sequelize.query(
      "SELECT id FROM tickets WHERE ticket_no LIKE 'TK-DEMO-%'",
    );
    const ticketIds = tickets.map((t) => Number(t.id));

    if (ticketIds.length > 0) {
      await queryInterface.sequelize.query(
        'DELETE FROM ma_usages WHERE ticket_id IN (:ids)',
        { replacements: { ids: ticketIds } },
      );
      await queryInterface.sequelize.query(
        'DELETE FROM ticket_resolutions WHERE ticket_id IN (:ids)',
        { replacements: { ids: ticketIds } },
      );
      await queryInterface.sequelize.query('DELETE FROM tickets WHERE id IN (:ids)', {
        replacements: { ids: ticketIds },
      });
    }

    // ลำดับการลบต้องไล่จากลูกไปหาแม่ ไม่งั้นชน foreign key
    await queryInterface.sequelize.query(
      "DELETE sa FROM survey_answers sa JOIN survey_responses sr ON sr.id = sa.response_id " +
        "JOIN surveys s ON s.id = sr.survey_id WHERE s.title = 'แบบประเมินความพึงพอใจหลังส่งมอบงาน'",
    );
    await queryInterface.sequelize.query(
      "DELETE sr FROM survey_responses sr JOIN surveys s ON s.id = sr.survey_id " +
        "WHERE s.title = 'แบบประเมินความพึงพอใจหลังส่งมอบงาน'",
    );
    await queryInterface.sequelize.query(
      "DELETE sa FROM survey_assignments sa JOIN surveys s ON s.id = sa.survey_id " +
        "WHERE s.title = 'แบบประเมินความพึงพอใจหลังส่งมอบงาน'",
    );
    await queryInterface.sequelize.query(
      "DELETE sq FROM survey_questions sq JOIN surveys s ON s.id = sq.survey_id " +
        "WHERE s.title = 'แบบประเมินความพึงพอใจหลังส่งมอบงาน'",
    );
    await queryInterface.bulkDelete('surveys', {
      title: 'แบบประเมินความพึงพอใจหลังส่งมอบงาน',
    });

    await queryInterface.sequelize.query(
      "DELETE FROM warranties WHERE delivery_id IN (SELECT id FROM deliveries WHERE delivery_no LIKE 'DL-DEMO-%')",
    );
    // ประกันที่เป็นของเดิม (ไม่ได้ถูกสร้างโดย seeder นี้) แค่ถอดการผูกออก ห้ามลบทิ้ง
    // และต้องถอดก่อนลบสัญญา ไม่งั้นชน foreign key
    await queryInterface.sequelize.query(
      "UPDATE warranties SET ma_contract_id = NULL WHERE ma_contract_id IN " +
        "(SELECT id FROM ma_contracts WHERE contract_no = 'MA-DEMO-001')",
    );
    await queryInterface.bulkDelete('ma_contracts', { contract_no: 'MA-DEMO-001' });
    await queryInterface.sequelize.query(
      "DELETE FROM deliveries WHERE delivery_no LIKE 'DL-DEMO-%'",
    );
    await queryInterface.sequelize.query(
      "DELETE FROM follow_ups WHERE title IN ('ตามผลหลังแก้ปัญหายอดสินค้าไม่ตรง', 'นัดทบทวนการใช้งานก่อนหมดประกัน', 'ตามผลการเปลี่ยนเซ็นเซอร์โรงเรือนที่ 2')",
    );

    await queryInterface.sequelize.query(
      'DELETE rp FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.name IN (:names)',
      { replacements: { names: [ROLE_SUPPORT, ROLE_SALES, ROLE_STAFF] } },
    );
    await queryInterface.sequelize.query(
      'DELETE ur FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE r.name IN (:names)',
      { replacements: { names: [ROLE_SUPPORT, ROLE_SALES, ROLE_STAFF] } },
    );
    await queryInterface.bulkDelete('roles', { name: [ROLE_SUPPORT, ROLE_SALES, ROLE_STAFF] });
  },
};
