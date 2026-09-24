/**
 * เทสต์สาย C-1 + แจ้งเตือน inbox (C-3 รวม TICKET_ASSIGNED)
 * รัน: node scripts/flow-c1-notify-test.js
 */
require('dotenv').config();

const BASE = process.env.APP_URL || 'http://localhost:3000';
const DEMO_PW = process.env.DEMO_USER_PASSWORD || 'Demo@1234';

const results = [];
function note(level, msg) {
  results.push({ level, msg });
  console.log(`[${level === 'ok' ? 'OK' : level === 'warn' ? 'WARN' : 'FAIL'}] ${msg}`);
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
  if (status !== 200 || !json?.data?.accessToken) {
    throw new Error(`login ${username} failed: ${status} ${json?.message || ''}`);
  }
  return { token: json.data.accessToken, user: json.data.user };
}

async function unreadEvents(token, ticketId) {
  const { status, json } = await req('GET', '/api/notifications?page=1&limit=50', token);
  if (status !== 200) return { status, items: [] };
  const items = json?.data?.items || [];
  return {
    status,
    items: items.filter((n) => n.refType === 'TICKET' && n.refId === ticketId),
    all: items,
  };
}

function hasEvent(items, eventType) {
  return items.some((n) => n.eventType === eventType);
}

(async () => {
  console.log('=== C-1 + NOTIFY FLOW ===', BASE);

  const tom = await login('Tom');
  const somchai = await login('somchai');
  const wichai = await login('wichai');
  note('ok', `login Tom#${tom.user.id} somchai#${somchai.user.id} wichai#${wichai.user.id}`);

  const projects = await req('GET', '/api/projects?limit=5', somchai.token);
  const project = projects.json?.data?.items?.[0];
  if (!project) throw new Error('ไม่มีโปรเจคสำหรับเปิดใบ');

  const create = await req('POST', '/api/tickets', tom.token, {
    customerId: project.customerId,
    projectId: project.id,
    title: `[C1-NOTIFY] ทดสอบสายงาน ${new Date().toISOString().slice(11, 19)}`,
    description: 'สคริปต์เทสต์แจ้งเตือน C-1',
    reportedChannel: 'LINE',
    reportedAt: new Date().toISOString(),
    priority: 'NORMAL',
  });
  if (create.status !== 201 && create.status !== 200) {
    throw new Error(`สร้างใบไม่ได้: ${create.status} ${create.json?.message}`);
  }
  const ticket = create.json.data;
  const tid = ticket.id;
  note('ok', `สร้างใบ ${ticket.ticketNo || '#' + tid} status=${ticket.status}`);

  // 1) send-to-admin → somchai ควรได้ TICKET_SENT_TO_ADMIN · Tom ไม่ควรได้ (คนกดเอง)
  const send = await req('PATCH', `/api/tickets/${tid}/send-to-admin`, tom.token, {});
  if (send.status !== 200) throw new Error(`send-to-admin: ${send.status} ${send.json?.message}`);
  note('ok', `send-to-admin → ${send.json.data.status}`);

  const adminAfterSend = await unreadEvents(somchai.token, tid);
  const tomAfterSend = await unreadEvents(tom.token, tid);
  if (hasEvent(adminAfterSend.items, 'TICKET_SENT_TO_ADMIN')) {
    note('ok', 'somchai ได้ TICKET_SENT_TO_ADMIN');
  } else {
    note('fail', 'somchai ไม่ได้ TICKET_SENT_TO_ADMIN');
  }
  if (hasEvent(tomAfterSend.items, 'TICKET_SENT_TO_ADMIN')) {
    note('fail', 'Tom ได้ TICKET_SENT_TO_ADMIN ทั้งที่เป็นคนกดเอง');
  } else {
    note('ok', 'Tom ไม่ได้แจ้งตอนส่งเอง (ถูกต้อง)');
  }

  // 2) claim + assign → wichai ได้ TICKET_ASSIGNED
  const claim = await req('PATCH', `/api/tickets/${tid}/claim`, somchai.token, {});
  if (claim.status !== 200) throw new Error(`claim: ${claim.status} ${claim.json?.message}`);
  note('ok', `claim โดย somchai`);

  const assign = await req('PATCH', `/api/tickets/${tid}/assign`, somchai.token, {
    assignedUserId: wichai.user.id,
  });
  if (assign.status !== 200) throw new Error(`assign: ${assign.status} ${assign.json?.message}`);
  note('ok', `assign → ${assign.json.data.status} → wichai`);

  const wichaiAfterAssign = await unreadEvents(wichai.token, tid);
  if (hasEvent(wichaiAfterAssign.items, 'TICKET_ASSIGNED')) {
    const n = wichaiAfterAssign.items.find((x) => x.eventType === 'TICKET_ASSIGNED');
    note('ok', `wichai ได้ TICKET_ASSIGNED · title="${n.title}"`);
    if (n.message && n.message.includes(ticket.title.slice(0, 20))) {
      note('ok', 'message มีหัวข้อใบ');
    } else {
      note('warn', `message="${n.message}"`);
    }
  } else {
    note('fail', 'wichai ไม่ได้ TICKET_ASSIGNED');
  }

  // 3) start + resolve → somchai ได้ TICKET_AWAITING_REVIEW
  const start = await req('PATCH', `/api/tickets/${tid}/start`, wichai.token, {});
  if (start.status !== 200) throw new Error(`start: ${start.status} ${start.json?.message}`);

  const resolve = await req('POST', `/api/tickets/${tid}/resolutions`, wichai.token, {
    result: 'SUCCESS',
    detail: 'แก้ในเทสต์ C-1 notify',
    resolvedAt: new Date().toISOString(),
    hoursSpent: '0.5',
  });
  if (resolve.status !== 201 && resolve.status !== 200) {
    throw new Error(`resolutions: ${resolve.status} ${resolve.json?.message}`);
  }
  note('ok', `resolutions → ${resolve.json.data.ticket.status}`);

  const adminAfterResolve = await unreadEvents(somchai.token, tid);
  if (hasEvent(adminAfterResolve.items, 'TICKET_AWAITING_REVIEW')) {
    note('ok', 'somchai ได้ TICKET_AWAITING_REVIEW');
  } else {
    note('fail', 'somchai ไม่ได้ TICKET_AWAITING_REVIEW');
  }

  // 4) return-to-support → Tom ได้ TICKET_RETURNED_TO_SUPPORT
  const ret = await req('PATCH', `/api/tickets/${tid}/return-to-support`, somchai.token, {});
  if (ret.status !== 200) throw new Error(`return-to-support: ${ret.status} ${ret.json?.message}`);
  note('ok', `return-to-support → ${ret.json.data.status}`);

  const tomAfterReturn = await unreadEvents(tom.token, tid);
  if (hasEvent(tomAfterReturn.items, 'TICKET_RETURNED_TO_SUPPORT')) {
    note('ok', 'Tom ได้ TICKET_RETURNED_TO_SUPPORT');
  } else {
    note('fail', 'Tom ไม่ได้ TICKET_RETURNED_TO_SUPPORT');
  }

  // 5) customer-notified → CLOSED
  const closed = await req('PATCH', `/api/tickets/${tid}/customer-notified`, tom.token, {
    note: 'บอกลูกค้าแล้ว (เทสต์)',
  });
  if (closed.status !== 200) {
    note('fail', `customer-notified: ${closed.status} ${closed.json?.message}`);
  } else {
    note('ok', `customer-notified → ${closed.json.data.status}`);
  }

  const fails = results.filter((r) => r.level === 'fail');
  const warns = results.filter((r) => r.level === 'warn');
  console.log('\n=== SUMMARY ===');
  console.log(`ok=${results.filter((r) => r.level === 'ok').length} warn=${warns.length} fail=${fails.length}`);
  console.log(`ticketId=${tid} ticketNo=${ticket.ticketNo}`);
  process.exit(fails.length ? 1 : 0);
})().catch((err) => {
  console.error('FATAL', err.message || err);
  process.exit(1);
});
