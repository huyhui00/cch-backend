/**
 * Soft-delete ข้อมูลที่สคริปต์ flow-*-test สร้างไว้ (ไม่แตะ demo seed)
 * รัน: node scripts/cleanup-flow-test-data.js
 */
require('dotenv').config();
const { Sequelize } = require('sequelize');

const s = new Sequelize(process.env.DB_DATABASE, process.env.DB_USERNAME, process.env.DB_PASSWORD, {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  dialect: 'mysql',
  logging: false,
  timezone: process.env.DB_TIMEZONE || '+07:00',
});

const now = new Date();

async function softDelete(table, whereSql, params = {}) {
  const [result] = await s.query(
    `UPDATE \`${table}\` SET deleted_at = :now, updated_at = :now
     WHERE deleted_at IS NULL AND (${whereSql})`,
    { replacements: { now, ...params } },
  );
  const n = result?.affectedRows ?? 0;
  if (n > 0) console.log(`  ${table}: soft-deleted ${n}`);
  return n;
}

(async () => {
  console.log('=== CLEANUP FLOW TEST DATA ===', process.env.DB_DATABASE);
  await s.authenticate();

  // หา id ลูกค้า/โปรเจคที่เป็นของเทสก่อน เพื่อ cascade ตาม FK
  const [custRows] = await s.query(`
    SELECT id FROM customers WHERE deleted_at IS NULL AND (
      name LIKE '%SMOKE%' OR name LIKE 'ลูกค้า MA %' OR name LIKE 'ลูกค้า WAR %'
      OR name LIKE 'ลูกค้า CRM %' OR name LIKE 'ลูกค้า SMOKE%'
      OR name LIKE 'ลูกค้าประกัน %'
    )
  `);
  const customerIds = custRows.map((r) => r.id);

  const [projRows] = await s.query(`
    SELECT id FROM projects WHERE deleted_at IS NULL AND (
      name LIKE 'FULL %' OR name LIKE 'SMOKE%'
      ${customerIds.length ? `OR customer_id IN (${customerIds.join(',')})` : ''}
    )
  `);
  const projectIds = projRows.map((r) => r.id);

  const [ticketRows] = await s.query(`
    SELECT id FROM tickets WHERE deleted_at IS NULL AND (
      title LIKE 'SMOKE%' OR title LIKE 'MA quota%' OR title LIKE 'MA over%'
      OR title LIKE 'FREE %' OR title LIKE 'unassign %' OR title LIKE 'no-claim %'
      OR title LIKE 'reopen-resolved %' OR title LIKE 'TEST assign %'
      ${projectIds.length ? `OR project_id IN (${projectIds.join(',')})` : ''}
      ${customerIds.length ? `OR customer_id IN (${customerIds.join(',')})` : ''}
    )
  `);
  const ticketIds = ticketRows.map((r) => r.id);

  const [planRows] = await s.query(`
    SELECT id FROM ma_plans WHERE deleted_at IS NULL AND name LIKE 'แผน smoke%'
  `);
  const planIds = planRows.map((r) => r.id);

  const [contractRows] = await s.query(`
    SELECT id FROM ma_contracts WHERE deleted_at IS NULL AND (
      ${planIds.length ? `plan_id IN (${planIds.join(',')})` : '0'}
      ${projectIds.length ? `OR project_id IN (${projectIds.join(',')})` : ''}
    )
  `);
  const contractIds = contractRows.map((r) => r.id);

  const [surveyRows] = await s.query(`
    SELECT id FROM surveys WHERE deleted_at IS NULL AND title LIKE 'แบบประเมิน %'
      AND title REGEXP '[0-9]{10,}'
  `);
  const surveyIds = surveyRows.map((r) => r.id);

  console.log('targets:', {
    customers: customerIds,
    projects: projectIds,
    tickets: ticketIds,
    plans: planIds,
    contracts: contractIds,
    surveys: surveyIds,
  });

  await s.transaction(async (t) => {
    const q = (sql, replacements = {}) =>
      s.query(sql, { replacements: { now, ...replacements }, transaction: t });

    const del = async (table, whereSql) => {
      const [result] = await q(
        `UPDATE \`${table}\` SET deleted_at = :now, updated_at = :now
         WHERE deleted_at IS NULL AND (${whereSql})`,
      );
      const n = result?.affectedRows ?? 0;
      if (n > 0) console.log(`  ${table}: ${n}`);
      return n;
    };

    // ลูกหลานของ ticket
    if (ticketIds.length) {
      const ids = ticketIds.join(',');
      await del('ticket_resolutions', `ticket_id IN (${ids})`);
      await del('ma_usages', `ticket_id IN (${ids})`);
      await del('attachments', `ref_type = 'TICKET' AND ref_id IN (${ids})`);
      await del('tickets', `id IN (${ids})`);
    }

    // delivery / warranty ของโปรเจคเทส
    if (projectIds.length) {
      const pids = projectIds.join(',');
      const [dels] = await q(
        `SELECT id FROM deliveries WHERE deleted_at IS NULL AND project_id IN (${pids})`,
      );
      const deliveryIds = dels.map((r) => r.id);
      if (deliveryIds.length) {
        const dids = deliveryIds.join(',');
        await del('warranties', `delivery_id IN (${dids}) OR project_id IN (${pids})`);
        await del('attachments', `ref_type = 'DELIVERY' AND ref_id IN (${dids})`);
        await del('deliveries', `id IN (${dids})`);
      } else {
        await del('warranties', `project_id IN (${pids})`);
      }
      await del('documents', `project_id IN (${pids})`);
      await del('tasks', `project_id IN (${pids})`);
    }

    // MA
    if (contractIds.length) {
      const cids = contractIds.join(',');
      await del('ma_addons', `contract_id IN (${cids})`);
      await del('ma_usages', `contract_id IN (${cids})`);
      await del('attachments', `ref_type = 'MA_CONTRACT' AND ref_id IN (${cids})`);
      await del('ma_contracts', `id IN (${cids})`);
    }
    if (planIds.length) {
      const pids = planIds.join(',');
      await del('ma_plan_items', `plan_id IN (${pids})`);
      await del('ma_plans', `id IN (${pids})`);
    }

    // survey
    if (surveyIds.length) {
      const sids = surveyIds.join(',');
      const [asg] = await q(
        `SELECT id FROM survey_assignments WHERE deleted_at IS NULL AND survey_id IN (${sids})`,
      );
      const aids = asg.map((r) => r.id);
      if (aids.length) {
        const a = aids.join(',');
        const [resp] = await q(
          `SELECT id FROM survey_responses WHERE deleted_at IS NULL AND assignment_id IN (${a})`,
        );
        const rids = resp.map((r) => r.id);
        if (rids.length) {
          await del('survey_answers', `response_id IN (${rids.join(',')})`);
          await del('survey_responses', `id IN (${rids.join(',')})`);
        }
        await del('survey_assignments', `id IN (${a})`);
      }
      await del('survey_questions', `survey_id IN (${sids})`);
      await del('surveys', `id IN (${sids})`);
    }

    // CRM ของลูกค้าเทส
    if (customerIds.length) {
      const cids = customerIds.join(',');
      await del('communication_logs', `customer_id IN (${cids})`);
      await del('follow_ups', `customer_id IN (${cids})`);
      await del('contacts', `customer_id IN (${cids})`);
    }

    // โปรเจค / ลูกค้า
    if (projectIds.length) await del('projects', `id IN (${projectIds.join(',')})`);
    if (customerIds.length) await del('customers', `id IN (${customerIds.join(',')})`);

    // user ชั่วคราวจาก full-system test
    await del('users', `username LIKE 'smoke_%'`);

    // เอกสารชื่อมี timestamp ที่อาจค้างนอกโปรเจคเทส
    await del('documents', `title LIKE 'เอกสาร %' AND title REGEXP '[0-9]{10,}'`);
  });

  console.log('done');
  await s.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
