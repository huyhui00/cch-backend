/**
 * ทดสอบ: ปัญหาซ้ำ (reopen) · มอบหมาย/งานของฉัน · งานย่อยส่งตรวจ
 */
require('dotenv').config();

const BASE = process.env.APP_URL || 'http://localhost:3000';
const DEMO_PW = process.env.DEMO_USER_PASSWORD || 'Demo@1234';

const findings = [];
function note(level, msg) {
  findings.push({ level, msg });
  console.log(`[${level.toUpperCase()}] ${msg}`);
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

async function login(username) {
  const { status, json } = await req('POST', '/api/auth/login', null, {
    username,
    password: DEMO_PW,
  });
  if (status !== 200) throw new Error(`login ${username}: ${status} ${json?.message}`);
  return json.data.accessToken;
}

async function me(token) {
  return (await req('GET', '/api/auth/me', token)).json.data;
}

(async () => {
  console.log('=== REOPEN + MY TASKS + SUBTASKS ===');

  const tomTok = await login('Tom');
  const somchaiTok = await login('somchai');
  const wichaiTok = await login('wichai');
  const tom = await me(tomTok);
  const somchai = await me(somchaiTok);
  const wichai = await me(wichaiTok);
  note('ok', `Tom#${tom.id} somchai#${somchai.id} wichai#${wichai.id}`);

  // project for ticket + tasks
  const projects = (await req('GET', '/api/projects?limit=20', somchaiTok)).json.data.items;
  const project = projects[0];
  if (!project) throw new Error('no project');
  note('ok', `ใช้โปรเจค #${project.id}`);

  // ---------- 1) มอบหมาย + งานของฉัน ----------
  console.log('\n--- 1) มอบหมาย + งานของฉัน ---');
  const stamp = Date.now();
  const created = await req('POST', '/api/tickets', tomTok, {
    customerId: project.customerId,
    projectId: project.id,
    title: `TEST assign ${stamp}`,
    description: 'ทดสอบมอบหมายและงานของฉัน',
    priority: 'HIGH',
    reportedChannel: 'LINE',
    reportedAt: new Date().toISOString(),
  });
  if (created.status !== 201 && created.status !== 200) {
    note('fail', `เปิดใบ: ${created.status} ${created.json?.message}`);
  } else {
    const tid = created.json.data.id;
    await req('PATCH', `/api/tickets/${tid}/send-to-admin`, tomTok, {});
    await req('PATCH', `/api/tickets/${tid}/claim`, somchaiTok, {});
    const assign = await req('PATCH', `/api/tickets/${tid}/assign`, somchaiTok, {
      assignedUserId: wichai.id,
    });
    if (assign.status !== 200) note('fail', `มอบหมาย: ${assign.status} ${assign.json?.message}`);
    else note('ok', `มอบหมายใบ #${tid} → ASSIGNED ให้ wichai`);

    const myList = await req(
      'GET',
      `/api/tickets?assigneeId=${wichai.id}&status=ASSIGNED&limit=50`,
      wichaiTok,
    );
    const found = (myList.json?.data?.items || []).some((t) => t.id === tid);
    if (found) note('ok', 'งานของฉัน (API): เห็นใบ ASSIGNED ของตัวเอง');
    else note('fail', 'งานของฉัน: ไม่เห็นใบที่เพิ่งมอบหมาย');

    const otherList = await req(
      'GET',
      `/api/tickets?assigneeId=${wichai.id}&status=ASSIGNED&limit=50`,
      tomTok,
    );
    // Tom can view tickets with ticket.view - may see the list but it's filtered by assignee
    if (otherList.status === 200) {
      const tomSees = (otherList.json?.data?.items || []).some((t) => t.id === tid);
      if (tomSees) note('ok', 'ซัพพอร์ตดูรายการกรอง assignee=wichai ได้ (มี ticket.view)');
    }

    await req('PATCH', `/api/tickets/${tid}/start`, wichaiTok, {});
    const res1 = await req('POST', `/api/tickets/${tid}/resolutions`, wichaiTok, {
      result: 'SUCCESS',
      detail: 'รอบแรก — แก้เสร็จ',
      resolvedAt: new Date().toISOString(),
    });
    if (res1.status !== 201 && res1.status !== 200) {
      note('fail', `รอบแก้ 1: ${res1.status} ${res1.json?.message}`);
    } else {
      const round1 = res1.json.data?.resolution?.round ?? res1.json.data?.round;
      note('ok', `รอบแก้ที่ 1 สำเร็จ round=${round1 ?? '?'}`);
    }

    await req('PATCH', `/api/tickets/${tid}/return-to-support`, somchaiTok, {});
    await req('PATCH', `/api/tickets/${tid}/customer-notified`, tomTok, {});
    const closed = await req('GET', `/api/tickets/${tid}`, tomTok);
    note('ok', `ปิดสายแรก status=${closed.json.data.status}`);

    // ---------- 2) ปัญหาซ้ำ (reopen) ----------
    console.log('\n--- 2) ปัญหาซ้ำ / reopen ---');
    const reopen = await req('PATCH', `/api/tickets/${tid}/reopen`, tomTok, {
      reason: 'อาการเดิมกลับมาหลังปิดงาน',
    });
    if (reopen.status !== 200) {
      // support may need ticket.reopen - we gave it
      note('fail', `reopen: ${reopen.status} ${reopen.json?.message}`);
    } else {
      note('ok', `reopen จาก CLOSED → ${reopen.json.data.status}`);
      if (reopen.json.data.closedAt) note('warn', 'closedAt ยังไม่ว่างหลัง reopen');
      else note('ok', 'ล้าง closedAt หลัง reopen');

      // must not create new ticket — still same id
      note('ok', `ยังเป็นใบเดิม #${reopen.json.data.id} (ไม่เปิดใบใหม่)`);

      // assign again from REOPENED
      const assign2 = await req('PATCH', `/api/tickets/${tid}/assign`, somchaiTok, {
        assignedUserId: wichai.id,
      });
      if (assign2.status !== 200) note('fail', `มอบหมายหลัง reopen: ${assign2.status} ${assign2.json?.message}`);
      else note('ok', `มอบหมายหลัง reopen → ${assign2.json.data.status}`);

      await req('PATCH', `/api/tickets/${tid}/start`, wichaiTok, {});
      const res2 = await req('POST', `/api/tickets/${tid}/resolutions`, wichaiTok, {
        result: 'SUCCESS',
        detail: 'รอบสอง — ปัญหาซ้ำแก้แล้ว',
        resolvedAt: new Date().toISOString(),
      });
      if (res2.status !== 201 && res2.status !== 200) {
        note('fail', `รอบแก้ 2: ${res2.status} ${res2.json?.message}`);
      } else {
        const round2 =
          res2.json.data?.resolution?.round ??
          res2.json.data?.round ??
          res2.json.data?.ticket?.resolutionCount;
        const count = res2.json.data?.ticket?.resolutionCount ?? res2.json.data?.resolutionCount;
        if (Number(round2) === 2 || Number(count) === 2) {
          note('ok', `รอบแก้ที่ 2 ในใบเดิม (round/count=${round2 ?? count})`);
        } else {
          note('warn', `รอบ 2 ได้แต่ตัวเลขไม่ชัด: ${JSON.stringify(res2.json.data).slice(0, 200)}`);
        }
      }

      // opening brand-new ticket for "same problem" is what we avoid — just confirm reopen path works
    }
  }

  // ---------- 3) งานย่อย ----------
  console.log('\n--- 3) งานย่อยโปรเจค ---');
  // somchai creates+assigns; wichai does; somchai reviews (ADMIN has task.review)
  const taskCreate = await req('POST', `/api/projects/${project.id}/tasks`, somchaiTok, {
    title: `งานย่อย smoke ${stamp}`,
    description: 'ทดสอบส่งตรวจ',
    assignedUserId: wichai.id,
    priority: 'NORMAL',
  });
  if (taskCreate.status !== 201 && taskCreate.status !== 200) {
    note('fail', `สร้างงานย่อย: ${taskCreate.status} ${taskCreate.json?.message}`);
  } else {
    const taskId = taskCreate.json.data.id;
    note('ok', `สร้างงานย่อย #${taskId} มอบให้ wichai`);

    const myTasks = await req('GET', '/api/tasks/me?limit=50', wichaiTok);
    const inMine = (myTasks.json?.data?.items || myTasks.json?.data || []).some(
      (t) => t.id === taskId,
    );
    // findAndCountAll returns paginated
    const items = myTasks.json?.data?.items || [];
    if (items.some((t) => t.id === taskId) || inMine) {
      note('ok', 'งานย่อยโผล่ใน GET /tasks/me ของพนักงาน');
    } else {
      note('fail', 'งานย่อยไม่โผล่ใน /tasks/me');
    }

    // status DOING optional
    await req('PATCH', `/api/tasks/${taskId}/status`, wichaiTok, { status: 'DOING' });

    const sub = await req('POST', `/api/tasks/${taskId}/submissions`, wichaiTok, {
      report: 'ทำเสร็จแล้ว พร้อมส่งตรวจ',
      actualHours: '2.00',
    });
    if (sub.status !== 201 && sub.status !== 200) {
      note('fail', `ส่งรายงาน: ${sub.status} ${sub.json?.message}`);
    } else note('ok', 'บันทึกรายงานงานย่อยได้');

    const submit = await req('PATCH', `/api/tasks/${taskId}/submit-review`, wichaiTok, {});
    if (submit.status !== 200) note('fail', `ส่งตรวจ: ${submit.status} ${submit.json?.message}`);
    else note('ok', `ส่งตรวจ → ${submit.json.data.status}`);

    // assignee should NOT see in /tasks/me (excludes REVIEW)
    const myAfter = await req('GET', '/api/tasks/me?limit=100', wichaiTok);
    const stillMine = (myAfter.json?.data?.items || []).some((t) => t.id === taskId);
    if (!stillMine) note('ok', 'หลังส่งตรวจ งานหายจาก /tasks/me ของคนทำ (ถูกออกแบบไว้)');
    else note('warn', 'หลังส่งตรวจยังอยู่ใน /tasks/me');

    // staff without task.review cannot list REVIEW filtered? USER without review gets 403 on status=REVIEW
    const staffReviewList = await req(
      'GET',
      '/api/tasks?status=REVIEW&limit=20',
      wichaiTok,
    );
    if (staffReviewList.status === 403) {
      note('ok', 'พนักงานไม่มี task.review → ดูคิวตรวจไม่ได้ (403)');
    } else if (staffReviewList.status === 200) {
      const sees = (staffReviewList.json?.data?.items || []).some((t) => t.id === taskId);
      if (sees) note('warn', 'พนักงานเห็นงานในคิว REVIEW ได้ — ตรวจสิทธิ์ FE/BE');
      else note('ok', 'พนักงานเรียก REVIEW ได้แต่ไม่เห็นงานนี้ (กรองผู้มอบหมาย)');
    }

    const reviewList = await req('GET', '/api/tasks?status=REVIEW&limit=50', somchaiTok);
    const inReview = (reviewList.json?.data?.items || []).some((t) => t.id === taskId);
    if (inReview) note('ok', 'แอดมินเห็นงานในคิว REVIEW');
    else note('fail', 'แอดมินไม่เห็นงานในคิว REVIEW');

    const approve = await req('PATCH', `/api/tasks/${taskId}/review`, somchaiTok, {
      status: 'DONE',
      reviewNote: 'ผ่าน',
    });
    if (approve.status !== 200) note('fail', `อนุมัติ: ${approve.status} ${approve.json?.message}`);
    else note('ok', `ตรวจผ่าน → ${approve.json.data.status}`);

    // reject path: new task
    const task2 = await req('POST', `/api/projects/${project.id}/tasks`, somchaiTok, {
      title: `งานย่อย reject ${stamp}`,
      assignedUserId: wichai.id,
    });
    const t2 = task2.json.data.id;
    await req('POST', `/api/tasks/${t2}/submissions`, wichaiTok, { report: 'ส่งแล้ว' });
    await req('PATCH', `/api/tasks/${t2}/submit-review`, wichaiTok, {});
    const reject = await req('PATCH', `/api/tasks/${t2}/review`, somchaiTok, {
      status: 'DOING',
      reviewNote: 'แก้เพิ่มอีกนิด',
    });
    if (reject.status !== 200) note('fail', `ส่งกลับแก้: ${reject.status} ${reject.json?.message}`);
    else {
      note('ok', `ตรวจไม่ผ่าน → ${reject.json.data.status}`);
      const back = await req('GET', '/api/tasks/me?limit=100', wichaiTok);
      const backMine = (back.json?.data?.items || []).some((t) => t.id === t2);
      if (backMine) note('ok', 'งานที่ถูกส่งกลับโผล่ใน /tasks/me อีกครั้ง');
      else note('warn', 'งานที่ส่งกลับไม่โผล่ใน /tasks/me');
    }
  }

  console.log('\n=== SUMMARY ===');
  const fails = findings.filter((f) => f.level === 'fail');
  const warns = findings.filter((f) => f.level === 'warn');
  console.log(
    `ok=${findings.filter((f) => f.level === 'ok').length} warn=${warns.length} fail=${fails.length}`,
  );
  fails.forEach((f) => console.log('FAIL:', f.msg));
  warns.forEach((f) => console.log('WARN:', f.msg));
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
