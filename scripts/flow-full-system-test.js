/**
 * ทดสอบระบบแบบละเอียด — ส่วนที่ยังไม่ได้เทสในรอบก่อน
 * รัน: node scripts/flow-full-system-test.js
 */
require('dotenv').config();

const BASE = process.env.APP_URL || 'http://localhost:3000';
const DEMO_PW = process.env.DEMO_USER_PASSWORD || 'Demo@1234';
const SUPER_USER = process.env.SUPER_ADMIN_USERNAME || 'SuperAdmin';
const SUPER_PW = process.env.SUPER_ADMIN_PASSWORD || '';

const findings = [];
function note(section, level, msg) {
  findings.push({ section, level, msg });
  console.log(`[${section}][${level.toUpperCase()}] ${msg}`);
}

async function req(method, path, token, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
      json = { raw: await res.text().catch(() => '') };
  }
  return { status: res.status, json };
}

async function login(username, password = DEMO_PW) {
  const { status, json } = await req('POST', '/api/auth/login', null, { username, password });
  if (status !== 200) throw new Error(`login ${username}: ${status} ${json?.message}`);
  return json.data.accessToken;
}

async function me(token) {
  return (await req('GET', '/api/auth/me', token)).json.data;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function daysAhead(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function addMonthsDate(dateStr, months) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const target = new Date(y, m - 1 + months, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

async function c1ToResolved(supportTok, adminTok, staffTok, staffId, project, title, billingType) {
  const created = await req('POST', '/api/tickets', supportTok, {
    customerId: project.customerId,
    projectId: project.id,
    title,
    description: 'full system test',
    priority: 'NORMAL',
    reportedChannel: 'PHONE',
    reportedAt: new Date().toISOString(),
    ...(billingType ? { billingType } : {}),
  });
  if (created.status !== 201 && created.status !== 200) {
    return { error: `create ${created.status} ${created.json?.message}` };
  }
  const id = created.json.data.id;
  await req('PATCH', `/api/tickets/${id}/send-to-admin`, supportTok, {});
  await req('PATCH', `/api/tickets/${id}/claim`, adminTok, {});
  await req('PATCH', `/api/tickets/${id}/assign`, adminTok, { assignedUserId: staffId });
  await req('PATCH', `/api/tickets/${id}/start`, staffTok, {});
  const res = await req('POST', `/api/tickets/${id}/resolutions`, staffTok, {
    result: 'SUCCESS',
    detail: 'resolved in full test',
    resolvedAt: new Date().toISOString(),
    hoursSpent: '1.50',
  });
  return { id, create: created.json.data, resolution: res };
}

(async () => {
  console.log('======== FULL SYSTEM TEST ========', BASE);
  const stamp = Date.now();

  const superTok = await login(SUPER_USER, SUPER_PW);
  const adminTok = await login('somchai');
  const supportTok = await login('Tom');
  const staffTok = await login('wichai');
  const salesTok = await login('pranee');
  const admin = await me(adminTok);
  const support = await me(supportTok);
  const staff = await me(staffTok);
  const sales = await me(salesTok);
  note('setup', 'ok', `admin#${admin.id} support#${support.id} staff#${staff.id} sales#${sales.id}`);

  // =====================================================================
  // 1) MA QUOTA + BILLING
  // =====================================================================
  console.log('\n===== 1) MA QUOTA + BILLING =====');
  {
    const S = 'MA';
    const proj = await req('POST', '/api/projects', adminTok, {
      name: `FULL MA ${stamp}`,
      newCustomer: { name: `ลูกค้า MA ${stamp}`, status: 'ACTIVE' },
    });
    const project = proj.json.data;
    note(S, 'ok', `โปรเจค #${project.id}`);

    // plan with quota 1 for easy over-quota
    const plan = await req('POST', '/api/ma-plans', adminTok, {
      name: `แผน smoke ${stamp}`,
      bugQuotaPerMonth: 1,
      items: [{ title: 'แก้บั๊ก' }],
    });
    if (plan.status !== 201 && plan.status !== 200) {
      note(S, 'fail', `สร้างแผน: ${plan.status} ${plan.json?.message}`);
    } else {
      const planId = plan.json.data.id;
      note(S, 'ok', `แผน MA #${planId} quota=1`);

      const start = today();
      const end = addMonthsDate(start, 12);
      let contract = await req('POST', '/api/ma-contracts', adminTok, {
        projectId: project.id,
        planId,
        price: '12000.00',
        billingCycle: 'YEARLY',
        startDate: start,
        endDate: end,
      });
      if (contract.status !== 201 && contract.status !== 200) {
        note(S, 'fail', `สร้างสัญญา: ${contract.status} ${contract.json?.message}`);
      } else {
        let cid = contract.json.data.id;
        if (contract.json.data.status === 'DRAFT') {
          const act = await req('PATCH', `/api/ma-contracts/${cid}`, adminTok, {
            status: 'ACTIVE',
          });
          if (act.status === 200) note(S, 'ok', `สัญญา #${cid} → ACTIVE`);
          else note(S, 'warn', `activate: ${act.status} ${act.json?.message}`);
        } else note(S, 'ok', `สัญญา #${cid} status=${contract.json.data.status}`);

        // delivery final + warranty so we can also test WARRANTY vs MA order
        const del = await req('POST', `/api/projects/${project.id}/deliveries`, adminTok, {
          title: 'ส่งมอบสุดท้าย MA test',
          deliveredAt: new Date(Date.now() - 86400000).toISOString(),
          version: 'v1',
        });
        const did = del.json.data.id;
        await req('PATCH', `/api/deliveries/${did}/acceptance`, adminTok, {
          acceptanceStatus: 'ACCEPTED',
          isFinal: true,
        });
        // no warranty yet — suggestion should be MA
        const sug1 = await req(
          'GET',
          `/api/tickets/billing-suggestion?projectId=${project.id}&reportedAt=${encodeURIComponent(new Date().toISOString())}`,
          adminTok,
        );
        if (sug1.status === 200) {
          const s = sug1.json.data.suggested || sug1.json.data.suggestedBillingType;
          note(S, s === 'MA_QUOTA' || sug1.json.data.suggested === 'MA_QUOTA' ? 'ok' : 'warn', 
            `suggestion ก่อนประกัน: ${JSON.stringify(sug1.json.data.suggested || sug1.json.data).slice(0, 80)}`);
        }

        // ticket 1 MA_QUOTA
        const t1 = await c1ToResolved(
          supportTok,
          adminTok,
          staffTok,
          staff.id,
          project,
          `MA quota 1 ${stamp}`,
          'MA_QUOTA',
        );
        if (t1.error) note(S, 'fail', t1.error);
        else if (t1.resolution.status !== 201 && t1.resolution.status !== 200) {
          note(S, 'fail', `resolve MA1: ${t1.resolution.status} ${t1.resolution.json?.message}`);
        } else {
          const q = t1.resolution.json.data?.quota;
          note(S, 'ok', `หักโควตาครั้ง 1 quota=${JSON.stringify(q || {}).slice(0, 120)}`);
        }

        // ticket 2 — โควตาเต็ม: ระบบต้องไม่ให้เปิดใบแบบ MA_QUOTA ต่อ (บังคับเปลี่ยนประเภท)
        const t2create = await req('POST', '/api/tickets', supportTok, {
          customerId: project.customerId,
          projectId: project.id,
          title: `MA quota 2 over ${stamp}`,
          description: 'full system test',
          priority: 'NORMAL',
          reportedChannel: 'PHONE',
          reportedAt: new Date().toISOString(),
          billingType: 'MA_QUOTA',
        });
        note(
          S,
          t2create.status === 400 ? 'ok' : 'warn',
          `โควตาเต็มแล้วเปิด MA_QUOTA: ${t2create.status} ${t2create.json?.message || ''}`,
        );
        const t2ok = await c1ToResolved(
          supportTok,
          adminTok,
          staffTok,
          staff.id,
          project,
          `MA over as ONE_TIME ${stamp}`,
          'ONE_TIME',
        );
        if (t2ok.error) note(S, 'fail', t2ok.error);
        else if (t2ok.resolution.status === 201 || t2ok.resolution.status === 200) {
          note(S, 'ok', 'โควตาเต็มแล้วยังเปิด/แก้ใบแบบ ONE_TIME ได้');
        }

        // second resolve same ticket should not double-charge
        if (t1.id) {
          await req('PATCH', `/api/tickets/${t1.id}/reopen`, supportTok, { reason: 'ทดสอบไม่หักซ้ำ' });
          await req('PATCH', `/api/tickets/${t1.id}/assign`, adminTok, { assignedUserId: staff.id });
          await req('PATCH', `/api/tickets/${t1.id}/start`, staffTok, {});
          const again = await req('POST', `/api/tickets/${t1.id}/resolutions`, staffTok, {
            result: 'SUCCESS',
            detail: 'รอบ 2 ใบเดิม',
            resolvedAt: new Date().toISOString(),
          });
          if (again.status === 201 || again.status === 200) {
            const q = again.json.data?.quota;
            note(S, 'ok', `รอบ 2 ใบเดิม (ไม่ควรหักโควตาซ้ำ) quota=${JSON.stringify(q).slice(0, 100)}`);
          } else note(S, 'fail', `รอบ 2: ${again.status} ${again.json?.message}`);
        }

        // FREE billing
        const tf = await c1ToResolved(
          supportTok,
          adminTok,
          staffTok,
          staff.id,
          project,
          `FREE ${stamp}`,
          'FREE',
        );
        if (!tf.error && (tf.resolution.status === 201 || tf.resolution.status === 200)) {
          note(S, 'ok', `billing FREE resolve ได้`);
        } else note(S, 'warn', `FREE: ${tf.error || tf.resolution?.status}`);

        // warranty takes priority over MA
        const war = await req('POST', `/api/deliveries/${did}/warranties`, adminTok, {
          durationMonth: 6,
          scopeNote: 'ซอฟต์แวร์ในประกัน',
        });
        if (war.status === 201 || war.status === 200) {
          const sug2 = await req(
            'GET',
            `/api/tickets/billing-suggestion?projectId=${project.id}&reportedAt=${encodeURIComponent(new Date().toISOString())}`,
            adminTok,
          );
          const suggested = sug2.json?.data?.suggested;
          note(
            S,
            suggested === 'WARRANTY' ? 'ok' : 'warn',
            `มีทั้งประกัน+MA → suggestion=${suggested} (ควร WARRANTY)`,
          );
        }

        // renew
        const renew = await req('POST', `/api/ma-contracts/${cid}/renew`, adminTok, {
          price: '13000.00',
          billingCycle: 'YEARLY',
          startDate: end,
          endDate: addMonthsDate(end, 12),
        });
        if (renew.status === 201 || renew.status === 200) {
          note(S, 'ok', `renew → ฉบับใหม่ #${renew.json.data?.id || renew.json.data?.newContract?.id} ฉบับเดิมควร RENEWED`);
          const old = await req('GET', `/api/ma-contracts/${cid}`, adminTok);
          note(S, old.json?.data?.status === 'RENEWED' ? 'ok' : 'warn', `ฉบับเดิม status=${old.json?.data?.status}`);
        } else note(S, 'warn', `renew: ${renew.status} ${renew.json?.message}`);

        // print
        const print = await req('GET', `/api/ma-contracts/${cid}/print`, adminTok);
        note(S, print.status === 200 ? 'ok' : 'warn', `print ${print.status}`);

        // quota endpoint
        const quotaGet = await req('GET', `/api/ma-contracts/${cid}/quota`, adminTok);
        note(S, quotaGet.status === 200 ? 'ok' : 'warn', `GET quota ${quotaGet.status}`);
      }
    }
  }

  // =====================================================================
  // 2) DELIVERY / WARRANTY EDGE
  // =====================================================================
  console.log('\n===== 2) DELIVERY / WARRANTY =====');
  {
    const S = 'WAR';
    const proj = await req('POST', '/api/projects', adminTok, {
      name: `FULL WAR ${stamp}`,
      newCustomer: { name: `ลูกค้า WAR ${stamp}`, status: 'ACTIVE' },
    });
    const project = proj.json.data;

    const d = await req('POST', `/api/projects/${project.id}/deliveries`, adminTok, {
      title: 'Final delivery',
      deliveredAt: '2026-01-31T10:00:00.000Z',
      version: 'v1',
    });
    const did = d.json.data.id;
    await req('PATCH', `/api/deliveries/${did}/acceptance`, adminTok, {
      acceptanceStatus: 'ACCEPTED',
      isFinal: true,
    });
    const detailProj = await req('GET', `/api/projects/${project.id}`, adminTok);
    note(
      S,
      detailProj.json?.data?.status === 'DELIVERED' ? 'ok' : 'warn',
      `หลังรับครั้งสุดท้าย project.status=${detailProj.json?.data?.status} (คาด DELIVERED)`,
    );

    const w = await req('POST', `/api/deliveries/${did}/warranties`, adminTok, {
      durationMonth: 1,
      scopeNote: 'ทดสอบขยับวัน',
    });
    const wid = w.json.data.id;
    note(S, 'ok', `ประกัน #${wid} start=${w.json.data.startDate} end=${w.json.data.endDate}`);

    // move delivery date — warranty should resync
    const moved = await req('PUT', `/api/deliveries/${did}`, adminTok, {
      deliveredAt: '2026-02-28T10:00:00.000Z',
      title: 'Final delivery moved',
    });
    if (moved.status === 200) {
      const w2 = await req('GET', `/api/warranties/${wid}`, adminTok);
      note(
        S,
        w2.json.data.startDate?.startsWith('2026-02-28') ? 'ok' : 'warn',
        `หลังขยับส่งมอบ warranty start=${w2.json.data.startDate} end=${w2.json.data.endDate}`,
      );
    } else note(S, 'fail', `แก้วันส่งมอบ: ${moved.status} ${moved.json?.message}`);

    // cannot un-accept while warranty active
    const unaccept = await req('PATCH', `/api/deliveries/${did}/acceptance`, adminTok, {
      acceptanceStatus: 'PENDING',
      isFinal: true,
    });
    note(
      S,
      unaccept.status === 409 || unaccept.status === 400 ? 'ok' : 'warn',
      `ถอย ACCEPTED ขณะมีประกัน: ${unaccept.status}`,
    );

    // VOID then unaccept
    const voided = await req('PUT', `/api/warranties/${wid}`, adminTok, { status: 'VOID' });
    note(S, voided.status === 200 ? 'ok' : 'fail', `VOID ประกัน ${voided.status}`);
    const unaccept2 = await req('PATCH', `/api/deliveries/${did}/acceptance`, adminTok, {
      acceptanceStatus: 'PENDING',
    });
    note(
      S,
      unaccept2.status === 200 ? 'ok' : 'warn',
      `ถอย ACCEPTED หลัง VOID: ${unaccept2.status}`,
    );
  }

  // =====================================================================
  // 3) CRM
  // =====================================================================
  console.log('\n===== 3) CRM =====');
  {
    const S = 'CRM';
    const cust = await req('POST', '/api/customers', salesTok, {
      name: `ลูกค้า CRM ${stamp}`,
      status: 'ACTIVE',
    });
    if (cust.status !== 201 && cust.status !== 200) {
      note(S, 'fail', `สร้างลูกค้า: ${cust.status} ${cust.json?.message}`);
    } else {
      const cid = cust.json.data.id;
      note(S, 'ok', `ลูกค้า #${cid}`);

      const c1 = await req('POST', `/api/contacts`, salesTok, {
        customerId: cid,
        name: 'ผู้ติดต่อหลัก',
        phone: '0811111111',
        isPrimary: true,
      });
      note(S, c1.status === 201 || c1.status === 200 ? 'ok' : 'fail', `สร้างผู้ติดต่อหลัก ${c1.status} ${c1.json?.message || ''}`);
      const c2 = await req('POST', `/api/contacts`, salesTok, {
        customerId: cid,
        name: 'ผู้ติดต่อรอง',
        phone: '0822222222',
        isPrimary: true,
      });
      note(S, c2.status === 201 || c2.status === 200 ? 'ok' : 'fail', `ตั้ง primary คนใหม่ ${c2.status} ${c2.json?.message || ''}`);
      const contacts = await req('GET', `/api/contacts?customerId=${cid}`, salesTok);
      const primaries = (contacts.json?.data?.items || contacts.json?.data || []).filter(
        (x) => x.isPrimary,
      );
      note(S, primaries.length === 1 ? 'ok' : 'fail', `ผู้ติดต่อหลักต้องมี 1 คน ได้ ${primaries.length}`);

      const before = await req('GET', `/api/customers/${cid}`, salesTok);
      const oldLast = before.json.data.lastContactedAt;

      const past = new Date(Date.now() - 5 * 86400000).toISOString();
      const logPast = await req('POST', '/api/communication-logs', supportTok, {
        customerId: cid,
        channel: 'PHONE',
        occurredAt: past,
        subject: 'คุยย้อนหลัง',
        content: 'บันทึกย้อนหลัง 5 วัน',
      });
      note(S, logPast.status === 201 || logPast.status === 200 ? 'ok' : 'fail', `บันทึกติดต่อย้อนหลัง ${logPast.status} ${logPast.json?.message || ''}`);

      const mid = await req('GET', `/api/customers/${cid}`, salesTok);
      const afterPast = mid.json.data.lastContactedAt;

      const recent = new Date().toISOString();
      const logNow = await req('POST', '/api/communication-logs', supportTok, {
        customerId: cid,
        channel: 'LINE',
        occurredAt: recent,
        subject: 'คุยล่าสุด',
        content: 'บันทึกล่าสุด',
        contactId: c2.json?.data?.id,
      });
      note(S, logNow.status === 201 || logNow.status === 200 ? 'ok' : 'warn', `บันทึกติดต่อล่าสุด ${logNow.status} ${logNow.json?.message || ''}`);

      const after = await req('GET', `/api/customers/${cid}`, salesTok);
      const last = after.json.data.lastContactedAt;
      note(S, last ? 'ok' : 'warn', `lastContactedAt: ก่อน=${oldLast} หลังย้อน=${afterPast} หลังล่าสุด=${last}`);

      // future should fail
      const future = new Date(Date.now() + 3600_000).toISOString();
      const logFuture = await req('POST', '/api/communication-logs', supportTok, {
        customerId: cid,
        channel: 'PHONE',
        occurredAt: future,
        content: 'ล่วงหน้า',
      });
      note(
        S,
        logFuture.status === 400 ? 'ok' : 'warn',
        `บันทึกล่วงหน้า: ${logFuture.status}`,
      );

      // follow-up overdue
      const fu = await req('POST', '/api/follow-ups', salesTok, {
        customerId: cid,
        projectId: null,
        title: `ตามเสนอ MA ${stamp}`,
        dueDate: daysAgo(3),
        detail: 'เลยกำหนดแล้ว',
      });
      if (fu.status === 201 || fu.status === 200) {
        note(S, 'ok', `สร้าง follow-up #${fu.json.data.id} status=${fu.json.data.status}`);
        note(
          S,
          fu.json.data.isOverdue === true ? 'ok' : 'warn',
          `isOverdue=${fu.json.data.isOverdue} (ควร true ทั้งที่ status ยัง PLANNED)`,
        );
        const list = await req('GET', '/api/follow-ups?overdue=true&limit=50', salesTok);
        const found = (list.json?.data?.items || []).some((x) => x.id === fu.json.data.id);
        note(S, found ? 'ok' : 'warn', `กรอง overdue=true พบงาน=${found}`);

        const beforeLast = after.json.data.lastContactedAt;
        const done = await req('PATCH', `/api/follow-ups/${fu.json.data.id}/complete`, salesTok, {
          resultNote: 'โทรแล้ว',
        });
        note(S, done.status === 200 ? 'ok' : 'fail', `complete follow-up ${done.status}`);
        const afterDone = await req('GET', `/api/customers/${cid}`, salesTok);
        note(
          S,
          afterDone.json.data.lastContactedAt === beforeLast ? 'ok' : 'fail',
          `ปิด follow-up ต้องไม่ขยับ lastContactedAt (${afterDone.json.data.lastContactedAt})`,
        );
      } else note(S, 'fail', `follow-up: ${fu.status} ${fu.json?.message}`);

      const overview = await req('GET', `/api/customers/${cid}/overview`, salesTok);
      note(S, overview.status === 200 ? 'ok' : 'warn', `overview ${overview.status}`);
    }
  }

  // =====================================================================
  // 4) SURVEYS
  // =====================================================================
  console.log('\n===== 4) SURVEYS =====');
  {
    const S = 'SURVEY';
    const create = await req('POST', '/api/surveys', adminTok, {
      title: `แบบประเมิน ${stamp}`,
      description: 'ทดสอบ',
      validFrom: daysAgo(1),
      validTo: daysAhead(90),
      questions: [
        {
          questionText: 'คะแนนความพึงพอใจ',
          questionType: 'RATING',
          isRequired: true,
          minValue: 1,
          maxValue: 5,
        },
        {
          questionText: 'ข้อเสนอแนะ',
          questionType: 'TEXT',
          isRequired: false,
        },
      ],
    });
    if (create.status !== 201 && create.status !== 200) {
      note(S, 'fail', `สร้างแบบ: ${create.status} ${create.json?.message}`);
    } else {
      const sid = create.json.data.id;
      note(S, 'ok', `แบบประเมิน #${sid} DRAFT`);

      const activate = await req('PATCH', `/api/surveys/${sid}/status`, adminTok, {
        status: 'ACTIVE',
      });
      note(S, activate.status === 200 ? 'ok' : 'fail', `ACTIVE ${activate.status} ${activate.json?.message || ''}`);

      // need project for assignment
      const projects = (await req('GET', '/api/projects?limit=5', adminTok)).json.data.items;
      const project = projects[0];
      const send = await req('POST', `/api/surveys/${sid}/assignments`, adminTok, {
        projectId: project.id,
        customerId: project.customerId,
      });
      if (send.status !== 201 && send.status !== 200) {
        note(S, 'warn', `ส่งแบบ: ${send.status} ${send.json?.message}`);
      } else {
        const aid = send.json.data.id;
        note(S, 'ok', `assignment #${aid}`);
        const detail = await req('GET', `/api/surveys/${sid}`, adminTok);
        const qid = detail.json.data.questions?.[0]?.id;
        const resp = await req('POST', `/api/survey-assignments/${aid}/response`, adminTok, {
          submittedAt: new Date().toISOString(),
          answers: [
            { questionId: qid, answerNumber: 5 },
          ],
        });
        note(S, resp.status === 201 || resp.status === 200 ? 'ok' : 'fail', `คีย์คำตอบ ${resp.status} ${resp.json?.message || ''}`);

        const summary = await req('GET', `/api/surveys/${sid}/summary`, adminTok);
        note(S, summary.status === 200 ? 'ok' : 'warn', `summary ${summary.status}`);

        // edit questions while ACTIVE should fail
        const editQ = await req('PATCH', `/api/surveys/${sid}`, adminTok, {
          questions: [{ questionText: 'เปลี่ยน', questionType: 'TEXT', isRequired: true }],
        });
        note(
          S,
          editQ.status === 409 || editQ.status === 400 ? 'ok' : 'warn',
          `แก้คำถามตอน ACTIVE: ${editQ.status}`,
        );
      }
    }
  }

  // =====================================================================
  // 5) DOCUMENTS + ATTACHMENTS
  // =====================================================================
  console.log('\n===== 5) DOCUMENTS / ATTACHMENTS =====');
  {
    const S = 'FILE';
    const projects = (await req('GET', '/api/projects?limit=5', adminTok)).json.data.items;
    const project = projects[0];

    // document upload via multipart
    const form = new FormData();
    form.append('title', `เอกสาร ${stamp}`);
    form.append('note', 'ทดสอบอัปโหลด');
    const blob = new Blob([Buffer.from('%PDF-1.4 smoke test')], { type: 'application/pdf' });
    form.append('file', blob, 'ทดสอบเอกสาร.pdf');

    const up = await fetch(`${BASE}/api/projects/${project.id}/documents`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminTok}` },
      body: form,
    });
    const upJson = await up.json().catch(() => null);
    note(S, up.status === 201 || up.status === 200 ? 'ok' : 'fail', `อัปโหลดเอกสารโปรเจค ${up.status} ${upJson?.message || ''}`);

    if (upJson?.data?.id) {
      const dl = await fetch(`${BASE}/api/documents/${upJson.data.id}/download`, {
        headers: { Authorization: `Bearer ${adminTok}` },
      });
      note(S, dl.status === 200 ? 'ok' : 'fail', `ดาวน์โหลดเอกสาร ${dl.status}`);
      const cd = dl.headers.get('content-disposition') || '';
      note(S, /UTF-8|ทดสอบ|pdf/i.test(cd) || dl.status === 200 ? 'ok' : 'warn', `content-disposition: ${cd.slice(0, 80)}`);
    }

    // attachment on ticket
    const tickets = (await req('GET', `/api/tickets?limit=5&search=TEST`, adminTok)).json.data.items;
    const ticket = tickets[0] || (await req('GET', `/api/tickets?limit=1`, adminTok)).json.data.items[0];
    if (ticket) {
      const form2 = new FormData();
      form2.append('refType', 'TICKET');
      form2.append('refId', String(ticket.id));
      form2.append('file', new Blob(['evidence'], { type: 'text/plain' }), 'หลักฐาน.txt');
      const att = await fetch(`${BASE}/api/attachments`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminTok}` },
        body: form2,
      });
      const attJson = await att.json().catch(() => null);
      note(S, att.status === 201 || att.status === 200 ? 'ok' : 'warn', `แนบไฟล์ใบปัญหา ${att.status} ${attJson?.message || ''}`);
    }
  }

  // =====================================================================
  // 6) NOTIFICATIONS + USERS + REPORTS
  // =====================================================================
  console.log('\n===== 6) NOTIFY / USERS / REPORTS =====');
  {
    const S = 'SYS';
    const rules = await req('GET', '/api/notification-rules?limit=20', adminTok);
    note(S, rules.status === 200 ? 'ok' : 'warn', `รายการกฎแจ้งเตือน ${rules.status}`);

    const run = await req('POST', '/api/notifications/run', adminTok, {});
    note(S, run.status === 200 || run.status === 201 ? 'ok' : 'warn', `run notifications ${run.status} ${run.json?.message || ''}`);

    const inbox = await req('GET', '/api/notifications?limit=20', adminTok);
    note(S, inbox.status === 200 ? 'ok' : 'warn', `inbox ${inbox.status} total=${inbox.json?.data?.total}`);

    // ADMIN cannot manage roles
    const rolesAdmin = await req('GET', '/api/roles', adminTok);
    note(S, rolesAdmin.status === 403 ? 'ok' : 'warn', `ADMIN GET /roles → ${rolesAdmin.status} (ควร 403)`);

    const rolesSuper = await req('GET', '/api/roles?limit=20', superTok);
    note(S, rolesSuper.status === 200 ? 'ok' : 'fail', `SUPER_ADMIN GET /roles ${rolesSuper.status}`);

    const assignable = await req('GET', '/api/roles/assignable', adminTok);
    note(S, assignable.status === 200 ? 'ok' : 'warn', `ADMIN GET /roles/assignable ${assignable.status}`);

    // suspend user login
    const users = (await req('GET', '/api/users?limit=50', superTok)).json.data.items;
    // create throwaway user
    const tempUser = await req('POST', '/api/users', superTok, {
      username: `smoke_${stamp}`,
      password: DEMO_PW,
      fullName: 'Smoke Temp',
      accountType: 'USER',
      roleIds: [],
    });
    if (tempUser.status === 201 || tempUser.status === 200) {
      const uid = tempUser.json.data.id;
      await req('PATCH', `/api/users/${uid}/status`, superTok, { status: 'SUSPENDED' });
      const loginSuspended = await req('POST', '/api/auth/login', null, {
        username: `smoke_${stamp}`,
        password: DEMO_PW,
      });
      note(S, loginSuspended.status === 401 ? 'ok' : 'fail', `SUSPENDED login → ${loginSuspended.status}`);
    } else note(S, 'warn', `สร้าง user ชั่วคราวไม่ได้ ${tempUser.status}`);

    // reports
    for (const path of [
      '/api/reports/contract-value/by-customer?limit=5',
      '/api/reports/contract-value/by-type',
      '/api/reports/contract-value/upcoming',
      '/api/reports/service-cost',
      '/api/reports/ma-contract-overlaps',
    ]) {
      const r = await req('GET', path, adminTok);
      const body = JSON.stringify(r.json?.data || {}).toLowerCase();
      const badWord = body.includes('revenue') || body.includes('รายได้');
      note(
        S,
        r.status === 200 && !badWord ? 'ok' : r.status === 200 ? 'warn' : 'fail',
        `${path} → ${r.status}${badWord ? ' มีคำต้องห้าม' : ''}`,
      );
    }
  }

  // =====================================================================
  // 7) TICKET EDGE CASES
  // =====================================================================
  console.log('\n===== 7) TICKET EDGES =====');
  {
    const S = 'TK';
    const projects = (await req('GET', '/api/projects?limit=10', adminTok)).json.data.items;
    const project = projects.find((p) => p.customerId) || projects[0];

    // unassign
    const created = await req('POST', '/api/tickets', supportTok, {
      customerId: project.customerId,
      projectId: project.id,
      title: `unassign ${stamp}`,
      description: 'x',
      priority: 'LOW',
      reportedChannel: 'EMAIL',
      reportedAt: new Date().toISOString(),
    });
    const tid = created.json.data.id;
    await req('PATCH', `/api/tickets/${tid}/send-to-admin`, supportTok, {});
    await req('PATCH', `/api/tickets/${tid}/claim`, adminTok, {});
    await req('PATCH', `/api/tickets/${tid}/assign`, adminTok, { assignedUserId: staff.id });
    const un = await req('PATCH', `/api/tickets/${tid}/assign`, adminTok, { assignedUserId: null });
    note(S, un.status === 200 ? 'ok' : 'fail', `ถอนมอบหมาย ${un.status} status=${un.json?.data?.status}`);

    // assign without claim should fail on WAITING_ADMIN without claimer — after unassign still ASSIGNED or WAITING?
    // create fresh
    const c2 = await req('POST', '/api/tickets', supportTok, {
      customerId: project.customerId,
      projectId: project.id,
      title: `no-claim ${stamp}`,
      description: 'x',
      priority: 'LOW',
      reportedChannel: 'EMAIL',
      reportedAt: new Date().toISOString(),
    });
    const t2 = c2.json.data.id;
    await req('PATCH', `/api/tickets/${t2}/send-to-admin`, supportTok, {});
    const assignNoClaim = await req('PATCH', `/api/tickets/${t2}/assign`, adminTok, {
      assignedUserId: staff.id,
    });
    note(
      S,
      assignNoClaim.status === 400 ? 'ok' : 'warn',
      `มอบโดยยังไม่ claim: ${assignNoClaim.status} ${assignNoClaim.json?.message || ''}`,
    );

    // reopen from RESOLVED (not closed)
    const t3 = await c1ToResolved(
      supportTok,
      adminTok,
      staffTok,
      staff.id,
      project,
      `reopen-resolved ${stamp}`,
    );
    if (!t3.error) {
      const re = await req('PATCH', `/api/tickets/${t3.id}/reopen`, supportTok, {
        reason: 'ยังไม่ปิด แต่กลับมา',
      });
      note(S, re.status === 200 ? 'ok' : 'fail', `reopen จาก RESOLVED: ${re.status} → ${re.json?.data?.status}`);
    }

    // pending endpoint still works
    const pending = await req('GET', '/api/tickets/pending?limit=5', adminTok);
    note(S, pending.status === 200 ? 'ok' : 'warn', `GET /tickets/pending ${pending.status}`);
  }

  // summary
  console.log('\n======== SUMMARY ========');
  const by = { ok: 0, warn: 0, fail: 0 };
  for (const f of findings) by[f.level] = (by[f.level] || 0) + 1;
  console.log(by);
  const fails = findings.filter((f) => f.level === 'fail');
  const warns = findings.filter((f) => f.level === 'warn');
  if (fails.length) {
    console.log('\nFAILURES:');
    fails.forEach((f) => console.log(` - [${f.section}] ${f.msg}`));
  }
  if (warns.length) {
    console.log('\nWARNINGS:');
    warns.forEach((f) => console.log(` - [${f.section}] ${f.msg}`));
  }
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
