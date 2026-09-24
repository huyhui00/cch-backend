/**
 * ทดลอง flow จริงผ่าน API — C-1 + ประกันหลายแบบ
 * รัน: node scripts/flow-smoke-test.js
 */
require('dotenv').config();

const BASE = process.env.APP_URL || 'http://localhost:3000';
const DEMO_PW = process.env.DEMO_USER_PASSWORD || 'Demo@1234';
const SUPER_USER = process.env.SUPER_ADMIN_USERNAME || 'SuperAdmin';
const SUPER_PW = process.env.SUPER_ADMIN_PASSWORD || '';

const findings = [];
function note(level, msg) {
  findings.push({ level, msg });
  const tag = level === 'ok' ? 'OK' : level === 'warn' ? 'WARN' : 'FAIL';
  console.log(`[${tag}] ${msg}`);
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
    json = null;
  }
  return { status: res.status, json };
}

async function login(username, password) {
  const { status, json } = await req('POST', '/api/auth/login', null, { username, password });
  if (status !== 200 || !json?.data?.accessToken) {
    throw new Error(`login ${username} failed: ${status} ${json?.message || ''}`);
  }
  return json.data.accessToken;
}

async function me(token) {
  const { json } = await req('GET', '/api/auth/me', token);
  return json.data;
}

(async () => {
  console.log('=== FLOW SMOKE TEST ===', BASE);

  // --- SuperAdmin: reset Tom password if needed ---
  const superToken = await login(SUPER_USER, SUPER_PW);
  note('ok', `SuperAdmin login`);

  // find Tom
  const usersRes = await req('GET', '/api/users?limit=100', superToken);
  const users = usersRes.json?.data?.items || usersRes.json?.data || [];
  const tom = users.find((u) => u.username === 'Tom' || u.username === 'tom');
  if (tom) {
    const reset = await req('POST', `/api/users/${tom.id}/reset-password`, superToken, {
      newPassword: DEMO_PW,
    });
    if (reset.status === 200 || reset.status === 201) {
      note('ok', `รีเซ็ตรหัส Tom เป็น Demo password`);
    } else {
      note('warn', `รีเซ็ต Tom ไม่สำเร็จ: ${reset.status} ${reset.json?.message}`);
    }
  } else {
    note('warn', 'ไม่พบบัญชี Tom — จะใช้บัญชีอื่นที่มี support_queue');
  }

  // pick accounts by permission
  async function tryLogin(name) {
    try {
      const t = await login(name, DEMO_PW);
      const m = await me(t);
      return { name, token: t, me: m, perms: new Set(m.permissions || []) };
    } catch (e) {
      note('warn', String(e.message || e));
      return null;
    }
  }

  const somchai = await tryLogin('somchai');
  const wichai = await tryLogin('wichai');
  const pranee = await tryLogin('pranee');
  let support = tom ? await tryLogin(tom.username) : null;
  if (!support || !support.perms.has('ticket.support_queue')) {
    // fallback: find any USER with support_queue via listing roles — use SuperAdmin to create temp? or pranee if has it
    for (const cand of [support, pranee, wichai]) {
      if (cand?.perms.has('ticket.support_queue')) {
        support = cand;
        break;
      }
    }
  }

  if (!somchai) throw new Error('ต้องการ somchai (ADMIN)');
  if (!wichai) throw new Error('ต้องการ wichai (พนักงาน)');
  if (!support?.perms.has('ticket.support_queue')) {
    note('fail', 'ไม่มีบัญชีซัพพอร์ตที่ login ได้พร้อม ticket.support_queue — หยุดสาย C-1');
  } else {
    note('ok', `ซัพพอร์ต = ${support.name} · staff = ${wichai.name} · admin = ${somchai.name}`);
  }

  // ========== A) C-1 ticket flow ==========
  console.log('\n--- A) C-1 ticket flow ---');
  let ticketId = null;
  let customerId = null;
  let projectId = null;

  if (support?.perms.has('ticket.support_queue')) {
    // find customer+project for ticket
    const projList = await req('GET', '/api/projects?limit=20', somchai.token);
    const projects = projList.json?.data?.items || [];
    const project = projects.find((p) => p.customerId) || projects[0];
    if (!project) {
      note('fail', 'ไม่มีโปรเจคให้เปิดใบ');
    } else {
      customerId = project.customerId;
      projectId = project.id;
      note('ok', `ใช้โปรเจค #${projectId} ลูกค้า #${customerId}`);

      const stamp = Date.now();
      const create = await req('POST', '/api/tickets', support.token, {
        customerId,
        projectId,
        title: `SMOKE C-1 ${stamp}`,
        description: 'ทดสอบสายงานซัพพอร์ต→แอดมิน→พนักงาน',
        priority: 'NORMAL',
        reportedChannel: 'PHONE',
        reportedAt: new Date().toISOString(),
      });
      if (create.status !== 201 && create.status !== 200) {
        note('fail', `เปิดใบ: ${create.status} ${create.json?.message}`);
      } else {
        ticketId = create.json.data.id;
        note('ok', `เปิดใบ #${ticketId} status=${create.json.data.status}`);

        const send = await req('PATCH', `/api/tickets/${ticketId}/send-to-admin`, support.token, {});
        if (send.status !== 200) note('fail', `ส่งหัวหน้า: ${send.status} ${send.json?.message}`);
        else note('ok', `ส่งหัวหน้า → ${send.json.data.status}`);

        // staff should NOT claim
        const staffClaim = await req('PATCH', `/api/tickets/${ticketId}/claim`, wichai.token, {});
        if (staffClaim.status === 403) note('ok', 'พนักงาน claim ไม่ได้ (403) ถูกต้อง');
        else note('warn', `พนักงาน claim ได้ status=${staffClaim.status} — ไม่ควร`);

        const claim = await req('PATCH', `/api/tickets/${ticketId}/claim`, somchai.token, {});
        if (claim.status !== 200) note('fail', `แอดมินรับคิว: ${claim.status} ${claim.json?.message}`);
        else note('ok', `แอดมินรับคิว claimedBy=${claim.json.data.claimedByAdminUserId}`);

        const assign = await req('PATCH', `/api/tickets/${ticketId}/assign`, somchai.token, {
          assignedUserId: wichai.me.id,
        });
        if (assign.status !== 200) note('fail', `มอบหมาย: ${assign.status} ${assign.json?.message}`);
        else note('ok', `มอบหมาย → ${assign.json.data.status}`);

        // staff my tickets
        const myTickets = await req(
          'GET',
          `/api/tickets?assigneeId=${wichai.me.id}&limit=50`,
          wichai.token,
        );
        const mine = (myTickets.json?.data?.items || []).some((t) => t.id === ticketId);
        if (mine) note('ok', 'พนักงานเห็นใบในรายการ assignee ของตัวเอง');
        else note('warn', 'พนักงานไม่เห็นใบใน ?assigneeId=me — FE งานของฉันอาจว่าง');

        const start = await req('PATCH', `/api/tickets/${ticketId}/start`, wichai.token, {});
        if (start.status !== 200) note('fail', `เริ่มงาน: ${start.status} ${start.json?.message}`);
        else note('ok', `เริ่มงาน → ${start.json.data.status}`);

        const resolve = await req('POST', `/api/tickets/${ticketId}/resolutions`, wichai.token, {
          result: 'SUCCESS',
          detail: 'แก้แล้วในการทดสอบ smoke',
          resolvedAt: new Date().toISOString(),
          hoursSpent: '1.00',
        });
        if (resolve.status !== 201 && resolve.status !== 200) {
          note('fail', `บันทึกรอบแก้: ${resolve.status} ${resolve.json?.message}`);
        } else note('ok', `บันทึกรอบแก้ → ticket ${resolve.json.data?.ticket?.status || resolve.json.data?.status}`);

        // staff close should 403
        const staffClose = await req('PATCH', `/api/tickets/${ticketId}/close`, wichai.token, {
          closeNote: 'ไม่ควรผ่าน',
        });
        if (staffClose.status === 403) note('ok', 'พนักงานปิดงานไม่ได้ (403) ถูกต้องตามสิทธิ์');
        else note('warn', `พนักงานปิดงานได้ ${staffClose.status}`);

        const ret = await req('PATCH', `/api/tickets/${ticketId}/return-to-support`, somchai.token, {});
        if (ret.status !== 200) note('fail', `ส่งกลับซัพพอร์ต: ${ret.status} ${ret.json?.message}`);
        else note('ok', `ส่งกลับซัพพอร์ต → ${ret.json.data.status}`);

        const notified = await req(
          'PATCH',
          `/api/tickets/${ticketId}/customer-notified`,
          support.token,
          {},
        );
        if (notified.status !== 200) {
          note('fail', `บอกลูกค้า: ${notified.status} ${notified.json?.message}`);
        } else note('ok', `บอกลูกค้า → ${notified.json.data.status}`);
      }
    }
  }

  // ========== B) Sales create project ==========
  console.log('\n--- B) ขายเปิดโปรเจค ---');
  if (pranee?.perms.has('project.create')) {
    const stamp = Date.now();
    const created = await req('POST', '/api/projects', pranee.token, {
      name: `SMOKE ขาย ${stamp}`,
      newCustomer: {
        name: `ลูกค้า SMOKE ${stamp}`,
        status: 'ACTIVE',
      },
    });
    if (created.status === 201 || created.status === 200) {
      note('ok', `ขายเปิดโปรเจค+ลูกค้าได้ #${created.json.data.id}`);
    } else if (created.status === 403) {
      note('fail', `ขายเปิดโปรเจค 403 ทั้งที่มี project.create? ${created.json?.message}`);
    } else {
      note('warn', `ขายเปิดโปรเจค: ${created.status} ${created.json?.message}`);
    }
  } else {
    note('warn', 'pranee ไม่มี project.create — ข้ามทดสอบขาย');
  }

  if (wichai && !wichai.perms.has('project.create')) {
    const deny = await req('POST', '/api/projects', wichai.token, {
      name: 'should-fail',
      customerId: customerId || 1,
    });
    if (deny.status === 403) note('ok', 'พนักงานสร้างโปรเจคไม่ได้ (403)');
    else note('warn', `พนักงานสร้างโปรเจคได้ ${deny.status}`);
  }

  // ========== C) Warranty scenarios ==========
  console.log('\n--- C) ประกันหลายแบบ ---');
  // Need a project with final ACCEPTED delivery. Use somchai to set up on an existing or new project.
  const admin = somchai.token;

  // create project for warranty tests
  const wp = await req('POST', '/api/projects', admin, {
    name: `SMOKE ประกัน ${Date.now()}`,
    newCustomer: { name: `ลูกค้าประกัน ${Date.now()}`, status: 'ACTIVE' },
  });
  if (wp.status !== 201 && wp.status !== 200) {
    note('fail', `สร้างโปรเจคสำหรับประกัน: ${wp.status} ${wp.json?.message}`);
  } else {
    const pid = wp.json.data.id;
    note('ok', `โปรเจคประกัน #${pid}`);

    // delivery not final
    const d1 = await req('POST', `/api/projects/${pid}/deliveries`, admin, {
      title: 'ส่งมอบระหว่างทาง v0.9',
      deliveredAt: new Date().toISOString(),
      version: 'v0.9-beta',
      note: 'ส่งมอบระหว่างทาง',
    });
    if (d1.status !== 201 && d1.status !== 200) {
      note('fail', `สร้างใบส่งมอบ: ${d1.status} ${d1.json?.message}`);
    } else {
      const d1id = d1.json.data.id;
      // accept but not final
      const a1 = await req('PATCH', `/api/deliveries/${d1id}/acceptance`, admin, {
        acceptanceStatus: 'ACCEPTED',
        isFinal: false,
      });
      if (a1.status === 200) note('ok', 'ส่งมอบเฟส ACCEPTED + isFinal=false');

      const wFail = await req('POST', `/api/deliveries/${d1id}/warranties`, admin, {
        durationMonth: 6,
        scopeNote: 'ไม่ควรสร้างได้จากใบไม่ใช่ครั้งสุดท้าย',
      });
      if (wFail.status === 400 || wFail.status === 409) {
        note('ok', `ออกประกันจากใบไม่ final ถูกปฏิเสธ (${wFail.status})`);
      } else {
        note('fail', `ออกประกันจากใบไม่ final ได้ ${wFail.status} — ผิดกติกา`);
      }

      // final delivery
      const d2 = await req('POST', `/api/projects/${pid}/deliveries`, admin, {
        title: 'ส่งมอบครั้งสุดท้าย v1.0',
        deliveredAt: new Date(Date.now() - 3600_000).toISOString(),
        version: 'v1.0',
        note: 'ส่งมอบครั้งสุดท้าย',
      });
      const d2id = d2.json.data.id;
      const a2 = await req('PATCH', `/api/deliveries/${d2id}/acceptance`, admin, {
        acceptanceStatus: 'ACCEPTED',
        isFinal: true,
      });
      if (a2.status !== 200) note('fail', `ตรวจรับครั้งสุดท้าย: ${a2.status} ${a2.json?.message}`);
      else note('ok', 'ตรวจรับครั้งสุดท้าย ACCEPTED + isFinal=true');

      // hardware 12m
      const wh = await req('POST', `/api/deliveries/${d2id}/warranties`, admin, {
        durationMonth: 12,
        scopeNote: 'ฮาร์ดแวร์',
      });
      if (wh.status === 201 || wh.status === 200) note('ok', `ประกันฮาร์ดแวร์ 12 ด. #${wh.json.data.id}`);
      else note('fail', `ประกันฮาร์ดแวร์: ${wh.status} ${wh.json?.message}`);

      // software 6m same delivery
      const ws = await req('POST', `/api/deliveries/${d2id}/warranties`, admin, {
        durationMonth: 6,
        scopeNote: 'ซอฟต์แวร์',
      });
      if (ws.status === 201 || ws.status === 200) note('ok', `ประกันซอฟต์แวร์ 6 ด. #${ws.json.data.id}`);
      else note('fail', `ประกันซอฟต์แวร์ (ระยะต่างกัน): ${ws.status} ${ws.json?.message}`);

      // duplicate duration should 409
      const wdup = await req('POST', `/api/deliveries/${d2id}/warranties`, admin, {
        durationMonth: 12,
        scopeNote: 'ซ้ำ',
      });
      if (wdup.status === 409) note('ok', 'ประกันระยะซ้ำถูกปฏิเสธ 409');
      else note('warn', `ประกันระยะซ้ำได้ ${wdup.status}`);

      // second final should 409
      const d3 = await req('POST', `/api/projects/${pid}/deliveries`, admin, {
        title: 'ส่งมอบซ้ำครั้งสุดท้าย',
        deliveredAt: new Date().toISOString(),
        version: 'v1.1',
      });
      if (d3.status === 201 || d3.status === 200) {
        const a3 = await req('PATCH', `/api/deliveries/${d3.json.data.id}/acceptance`, admin, {
          acceptanceStatus: 'ACCEPTED',
          isFinal: true,
        });
        if (a3.status === 409 || a3.status === 400) {
          note('ok', `ตั้งครั้งสุดท้ายซ้ำถูกปฏิเสธ (${a3.status})`);
        } else {
          note('fail', `ตั้งครั้งสุดท้ายซ้ำได้ ${a3.status}`);
        }
      }

      // link MA if any contract exists on another project — create MA plan+contract lightly
      const plans = await req('GET', '/api/ma-plans?limit=5', admin);
      const plan = (plans.json?.data?.items || plans.json?.data || [])[0];
      if (plan) {
        const start = new Date();
        const end = new Date();
        end.setMonth(end.getMonth() + 12);
        const toDate = (d) => d.toISOString().slice(0, 10);
        const contract = await req('POST', '/api/ma-contracts', admin, {
          projectId: pid,
          planId: plan.id,
          startDate: toDate(start),
          endDate: toDate(end),
          price: '12000.00',
          billingCycle: 'YEARLY',
          status: 'ACTIVE',
        });
        if (contract.status === 201 || contract.status === 200) {
          const cid = contract.json.data.id;
          note('ok', `สร้างสัญญา MA #${cid}`);
          // activate if draft
          if (contract.json.data.status === 'DRAFT') {
            await req('PATCH', `/api/ma-contracts/${cid}`, admin, { status: 'ACTIVE' });
          }
          const wid = wh.json?.data?.id;
          if (wid) {
            const link = await req('PUT', `/api/warranties/${wid}`, admin, {
              maContractId: cid,
            });
            if (link.status === 200) note('ok', 'ผูกประกันกับสัญญา MA ได้ (อ้างอิงอย่างเดียว)');
            else note('warn', `ผูก MA: ${link.status} ${link.json?.message}`);
          }
        } else {
          note('warn', `สร้างสัญญา MA: ${contract.status} ${contract.json?.message}`);
        }
      } else {
        note('warn', 'ไม่มีแผน MA — ข้ามทดสอบผูกประกัน-MA');
      }

      // billing suggestion under warranty
      const suggest = await req(
        'GET',
        `/api/tickets/billing-suggestion?projectId=${pid}&reportedAt=${encodeURIComponent(new Date().toISOString())}`,
        admin,
      );
      if (suggest.status === 200) {
        note(
          'ok',
          `billing-suggestion: ${suggest.json.data?.suggestedBillingType || JSON.stringify(suggest.json.data)}`,
        );
      } else note('warn', `billing-suggestion: ${suggest.status}`);
    }
  }

  // ========== D) Support queue visibility ==========
  console.log('\n--- D) สิทธิ์เมนู ---');
  if (wichai && !wichai.perms.has('ticket.support_queue')) {
    const q = await req('GET', '/api/tickets/support-queue?tab=AWAITING_SEND', wichai.token);
    if (q.status === 403) note('ok', 'พนักงานเข้า support-queue ไม่ได้');
    else note('warn', `พนักงานเข้า support-queue ได้ ${q.status}`);
  }
  if (support) {
    const aq = await req('GET', '/api/tickets/admin-queue?tab=AWAITING_CLAIM', support.token);
    if (aq.status === 403) note('ok', 'ซัพพอร์ตเข้า admin-queue ไม่ได้');
    else note('warn', `ซัพพอร์ตเข้า admin-queue ได้ ${aq.status}`);
  }

  // summary
  console.log('\n=== SUMMARY ===');
  const fails = findings.filter((f) => f.level === 'fail');
  const warns = findings.filter((f) => f.level === 'warn');
  console.log(`ok=${findings.filter((f) => f.level === 'ok').length} warn=${warns.length} fail=${fails.length}`);
  if (fails.length) {
    console.log('FAILURES:');
    fails.forEach((f) => console.log(' -', f.msg));
  }
  if (warns.length) {
    console.log('WARNINGS:');
    warns.forEach((f) => console.log(' -', f.msg));
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
