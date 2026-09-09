# CLAUDE.md — Internal Management System (Backend)

> ไฟล์นี้คือบริบทถาวรของโปรเจกต์ Claude Code จะอ่านทุกครั้งที่เริ่มงาน
> วางไว้ที่ root ของ repo backend

---

## 1. ภาพรวมโปรเจกต์

ระบบบริหารจัดการลูกค้า โครงการ และบริการหลังการขาย สำหรับบริษัทพัฒนา Software / Hardware / IoT ขนาดเล็ก (พนักงาน 2–20 คน)

**สิ่งที่ระบบนี้เป็น:** ระบบบันทึกข้อมูลภายในองค์กร + ระบบแจ้งเตือนเชิงรุก
**สิ่งที่ระบบนี้ไม่ใช่:** ระบบสื่อสาร, ระบบบัญชี, ระบบชำระเงิน, ระบบ HR

Repo นี้คือ **Backend เท่านั้น** ส่วน Frontend เป็น Angular แยก repo คนละ origin

**ขอบเขตของ repo นี้ (ห้ามข้าม):**
- ทำเฉพาะ REST API, business logic, ฐานข้อมูล, การเชื่อมต่อบริการภายนอก (R2, LINE)
- **ห้ามสร้างไฟล์ frontend ใดๆ** ไม่มี HTML, CSS, Angular component, view template หรือหน้าเว็บ ยกเว้นหน้า Swagger ที่ NestJS สร้างให้อัตโนมัติ
- เมื่อ prompt พูดถึง "หน้าจอ" หรือ "การแสดงผล" ให้เข้าใจว่าเป็น **บริบทว่าข้อมูลจะถูกนำไปใช้ที่ไหน** หน้าที่ของ repo นี้คือคืนข้อมูลที่ถูกต้องและจัดรูปพร้อมใช้ ไม่ใช่ไปวาด UI
- ถ้า prompt ใดสั่งให้สร้าง UI ให้ทักท้วงก่อน เพราะอยู่นอกขอบเขต repo นี้

---

## 2. Tech Stack (ห้ามเปลี่ยนโดยไม่ถาม)

| ส่วน | เทคโนโลยี |
|---|---|
| Framework | **NestJS** (TypeScript) |
| ORM | **Sequelize** ผ่าน `@nestjs/sequelize` + `sequelize-typescript` |
| Database | **MySQL 8** |
| Auth | JWT (Access + Refresh) ผ่าน `Authorization: Bearer` header |
| File Storage | **Cloudflare R2** (S3-compatible, ใช้ `@aws-sdk/client-s3`) |
| Scheduler | `@nestjs/schedule` |
| Notification | LINE Messaging API |
| API Docs | Swagger ผ่าน `@nestjs/swagger` |
| Validation | `class-validator` + `class-transformer` |

**ห้ามใช้:** Prisma, TypeORM, GraphQL, Server Actions, Next.js

---

## 3. กฎเหล็ก 12 ข้อ (Business Rules)

กฎเหล่านี้มาจากการประชุมกับผู้บริหาร **ห้ามละเมิด** ถ้าโค้ดที่จะเขียนขัดกับข้อใด ให้หยุดถามก่อน

| # | กฎ | ผลต่อโค้ด |
|---|---|---|
| BR-01 | **ลูกค้าไม่มีบัญชีผู้ใช้ ไม่เข้าระบบ** | ห้ามสร้าง customer login / customer portal |
| BR-02 | การสื่อสารเกิดนอกระบบ (LINE/โทร) แล้วมาบันทึกย้อนหลัง | ทุกบันทึกต้องมี `channel` + แนบไฟล์หลักฐานได้ |
| BR-03 | **1 ปัญหา แก้ไขได้หลายรอบ** | `tickets` 1:N `ticket_resolutions` ห้ามรวมเป็นตารางเดียว |
| BR-04 | ปัญหาเดิมกลับมา = เพิ่มรอบในใบเดิม ห้ามเปิดใบใหม่ | status ต้องวนกลับได้ `RESOLVED → REOPENED → IN_PROGRESS` |
| BR-05 | **เนื้อหาแผน MA เหมือนกันทุกโครงการ แต่ราคาต่างกัน** | เนื้อหาอยู่ `ma_plans` / ราคาอยู่ `ma_contracts.price` |
| BR-06 | ระยะประกันนับจาก**วันส่งมอบ** | `warranties.delivery_id` ไม่ใช่ `project_id` อย่างเดียว |
| BR-07 | ประกันครอบคลุมเฉพาะ bug ในขอบเขตเดิม เพิ่มฟีเจอร์ = คิดเงินใหม่ | `tickets.billing_type` |
| BR-08 | บั๊กเล็กทำฟรีได้ **แต่ต้องบันทึก** | `billing_type` ต้องมีค่า `FREE` |
| BR-09 | **ทุก action ต้องบันทึกผู้กระทำ** | ทุกตารางมี `created_by`/`updated_by` + ตาราง `audit_logs` แยก |
| BR-10 | **Super Admin เท่านั้นที่สร้าง/แก้บทบาทได้** | ไม่ใช่ permission ที่ติ๊กได้ ผูกกับ `users.account_type` |
| BR-11 | แจ้งเตือน**ภายในบริษัทเท่านั้น** ไม่ยิงหาลูกค้า | `notifications.target_user_id` → users เท่านั้น |
| BR-12 | สัญญาเซ็นมือต่อหน้า แล้วสแกนเข้าระบบ | ไม่มี e-signature มีแต่ upload ไฟล์ |

---

## 4. ระบบสิทธิ์ (สำคัญมาก — ผู้บริหารเน้นเป็นพิเศษ)

### 4.1 ระดับบัญชี 3 ระดับ

```
users.account_type: 'SUPER_ADMIN' | 'ADMIN' | 'USER'
```

| ระดับ | ทำอะไรได้ |
|---|---|
| `SUPER_ADMIN` | ทุกอย่าง **+ สร้าง/แก้/ลบ Role** (ระดับเดียวที่ทำได้) |
| `ADMIN` | ทุกเมนู + เพิ่ม User และ Admin ได้ **แต่แก้ Role ไม่ได้** |
| `USER` | เฉพาะเมนูตาม Role ที่ได้รับ |

- `SUPER_ADMIN` **ไม่ต้องผูก Role** — bypass permission check ทั้งหมด
- `ADMIN` **ไม่ต้องผูก Role เช่นกัน** — bypass ทุกเมนู ยกเว้นสิ่งที่สงวนให้ SUPER_ADMIN
- Seeder ต้องสร้าง SUPER_ADMIN 1 บัญชีตอน setup ระบบ

**กฎละเอียด (ยืนยันจากผู้บริหาร 8 ก.ย. 2026):**

| การกระทำ | SUPER_ADMIN | ADMIN | USER |
|---|---|---|---|
| สร้าง / แก้ / ลบ Role | ✅ | ❌ | ❌ |
| กำหนดว่า Role นั้นทำอะไรได้ (ติ๊กสิทธิ์) | ✅ | ❌ | ❌ |
| ดูรายการสิทธิ์ทั้งหมด (`GET /api/permissions`) | ✅ | ❌ | ❌ |
| **มอบ Role ให้ user** | ✅ | ✅ | ตามสิทธิ์ |
| เข้าเมนูทั่วไปโดยไม่ต้องมี Role | ✅ | ✅ | ❌ ต้องรอรับ Role |
| สร้าง / เลื่อนใครเป็น SUPER_ADMIN | ✅ | ❌ | ❌ |
| **เลื่อนตัวเองเป็น SUPER_ADMIN** | — | ❌ | ❌ |
| แก้ไขบัญชีที่เป็น SUPER_ADMIN | ✅ | ❌ | ❌ |

- ADMIN เลือกได้เฉพาะ Role ที่ SUPER_ADMIN สร้างไว้ — เป็นจริงโดยอัตโนมัติ เพราะมีแต่
  SUPER_ADMIN ที่สร้าง Role ได้ ไม่ต้องเขียนโค้ดบังคับเพิ่ม
- ข้อจำกัดเรื่อง SUPER_ADMIN ถูกบังคับที่ `UsersService.assertCanGrantAccountType()`
  ส่วนข้อจำกัดเรื่อง Role ถูกบังคับที่ `PermissionsGuard` (ดู 9.4)

**`GET /api/auth/me` คืน `permissions` ให้ตรงกับสิ่งที่ guard ปล่อยผ่านจริง**

| ระดับ | `roles` | `permissions` |
|---|---|---|
| `SUPER_ADMIN` | `[]` | ทั้งระบบ (75 รายการ) |
| `ADMIN` | role ที่ถืออยู่ (ปกติ `[]`) | ทั้งระบบ **ยกเว้น** `SUPER_ADMIN_ONLY_PERMISSIONS` (72 รายการ) |
| `USER` | role ที่ได้รับมอบหมาย | union ของทุก role |

- **frontend ต้องกั้นเมนูด้วย `permissions` เท่านั้น ห้ามใช้ `roles`** เพราะ SUPER_ADMIN
  กับ ADMIN มี `roles` ว่างโดยการออกแบบ ใช้ `roles.length` ตัดสินจะได้ผลผิดทั้งสองระดับ
  ถ้าต้องรู้ระดับบัญชีให้อ่าน `accountType` ตรง ๆ
- ADMIN ไม่ได้ `role.manage`, `role.view`, `permission.view` เมนูจัดการบทบาทจึงหายไป
  จากหน้าจอเองโดยไม่ต้องเขียนเงื่อนไขพิเศษ ตรงกับที่ guard ปฏิเสธจริง

### 4.2 Role เป็นแบบ Dynamic M:N

```
users ──< user_roles >── roles ──< role_permissions >── permissions
```

- **1 user ถือได้หลาย role พร้อมกัน** สิทธิ์ = union ของทุก role
  (เคสจริง: พนักงานคนหนึ่งทำทั้ง Support และ Marketing)
- Role ไม่ hardcode ในโค้ด Super Admin สร้างเองผ่านหน้าจอ
- `permissions.code` รูปแบบ `module.action` เช่น `customer.view`, `ma.create`, `ticket.resolve`

### 4.3 สถานะพนักงาน (แยกจาก account_type)

```
users.status: 'ACTIVE' | 'SUSPENDED' | 'RESIGNED'
```

- **ห้ามลบ user ทิ้ง** เพราะ audit log ต้องอ้างอิงย้อนหลังได้
- `status !== 'ACTIVE'` → login ไม่ได้ (เช็คใน AuthService)
- เปลี่ยน status **ไม่กระทบ role** role ยังอยู่ในระบบ เอาไปใช้กับคนถัดไปได้

---

## 5. โครงสร้างโปรเจกต์

```
src/
├── main.ts                      # bootstrap, CORS, Swagger, ValidationPipe
├── app.module.ts
├── common/
│   ├── access-control.module.ts       # @Global — ให้ guard หา AccessControlService เจอ
│   ├── guards/
│   │   ├── jwt-auth.guard.ts
│   │   └── permissions.guard.ts       # ตรวจสิทธิ์ตาม 9.4
│   ├── decorators/
│   │   ├── require-permission.decorator.ts
│   │   ├── require-account-type.decorator.ts  # จำกัดด้วย account_type ไม่ใช่ permission
│   │   ├── public.decorator.ts        # ยกเว้น endpoint จาก JwtAuthGuard ที่เป็น global
│   │   └── current-user.decorator.ts
│   ├── interceptors/
│   │   ├── transform.interceptor.ts   # ห่อ response format
│   │   └── request-context.interceptor.ts  # เติม userId ลง context หลัง guard ผ่าน
│   ├── context/
│   │   └── request-context.ts         # AsyncLocalStorage — ที่มาของ user_id ใน audit hook
│   ├── services/
│   │   └── access-control.service.ts  # union สิทธิ์จากทุก Role ของผู้ใช้
│   ├── types/
│   │   └── auth.types.ts              # AuthenticatedUser, JwtPayload
│   ├── utils/
│   │   └── crypto.util.ts             # bcrypt + hash ของ refresh token
│   ├── filters/
│   │   └── http-exception.filter.ts
│   ├── pipes/
│   │   └── validation.pipe.ts
│   └── dto/
│       └── pagination.dto.ts
├── database/
│   ├── database.module.ts
│   ├── migrations/              # sequelize-cli migrations
│   └── seeders/                 # super admin, permissions master
├── models/                      # sequelize-typescript models (30 ตาราง)
└── modules/
    ├── auth/
    ├── users/
    ├── roles/
    ├── customers/
    ├── projects/
    ├── deliveries/
    ├── warranties/
    ├── tickets/
    ├── ma/
    ├── follow-ups/
    ├── surveys/
    ├── documents/
    ├── files/
    ├── reports/
    ├── notifications/
    └── audit-logs/
```

แต่ละ module มี: `*.module.ts`, `*.controller.ts`, `*.service.ts`, `dto/`

---

## 6. มาตรฐานที่ต้องทำตาม

### 6.1 Response Format (ทุก endpoint ต้องเหมือนกัน)

```json
{ "success": true,  "data": { }, "message": null }
{ "success": true,  "data": { "items": [], "total": 0, "page": 1, "limit": 20 }, "message": null }
{ "success": false, "data": null, "message": "ไม่พบข้อมูลลูกค้า" }
```

ทำผ่าน `TransformInterceptor` + `HttpExceptionFilter` ที่ระดับ global

### 6.2 Naming Convention

| รายการ | รูปแบบ | ตัวอย่าง |
|---|---|---|
| ตาราง | snake_case พหูพจน์ | `ma_contracts` |
| คอลัมน์ | snake_case | `customer_id` |
| Model class | PascalCase เอกพจน์ | `MaContract` |
| JSON field | camelCase | `customerId` |
| Endpoint | kebab-case พหูพจน์ | `/api/ma-contracts` |
| Enum value | UPPER_SNAKE | `IN_PROGRESS` |

> ใช้ `underscored: true` + `sequelize.define` mapping เพื่อให้ DB เป็น snake_case แต่ TS เป็น camelCase

### 6.3 ฟิลด์มาตรฐาน (ทุกตารางหลักต้องมี)

```
created_at, created_by, updated_at, updated_by, deleted_at, deleted_by
```

ใช้ `paranoid: true` ของ Sequelize สำหรับ soft delete

### 6.4 Audit Log

เขียน **ครั้งเดียวที่ระดับ global hook** ห้ามเขียนซ้ำในแต่ละ service

```typescript
// afterCreate / afterUpdate / afterDestroy hooks
audit_logs: { user_id, action, table_name, record_id, old_value, new_value, ip_address, created_at }
```

### 6.5 ภาษาใน Error Message

ข้อความที่ส่งกลับผู้ใช้ให้เป็น **ภาษาไทย** เช่น `"ไม่พบข้อมูลลูกค้า"`, `"คุณไม่มีสิทธิ์เข้าถึงส่วนนี้"`

---

## 7. รายการตารางทั้งหมด (30 ตาราง)

| กลุ่ม | ตาราง |
|---|---|
| **A. Auth & RBAC** | `users`, `roles`, `permissions`, `user_roles`, `role_permissions`, `audit_logs` |
| **B. Customer & CRM** | `customers`, `contacts`, `communication_logs`, `follow_ups` |
| **C. Project & Delivery** | `projects`, `tasks`, `deliveries`, `warranties`, `documents` |
| **D. MA** | `ma_plans`, `ma_plan_items`, `ma_contracts`, `ma_addons`, `ma_usages` |
| **E. Ticket** | `tickets`, `ticket_resolutions`, `attachments` |
| **F. Survey & Notify** | `surveys`, `survey_questions`, `survey_assignments`, `survey_responses`, `survey_answers`, `notification_rules`, `notifications` |

---

## 8. Enum ทั้งหมด

```
users.account_type      SUPER_ADMIN | ADMIN | USER
users.status            ACTIVE | SUSPENDED | RESIGNED

customers.status        PROSPECT | ACTIVE | INACTIVE | CHURNED
communication_logs.channel  LINE | PHONE | EMAIL | FACEBOOK | MEETING | OTHER

projects.status         DRAFT | IN_PROGRESS | DELIVERED | CLOSED | CANCELLED
projects.priority       LOW | NORMAL | HIGH | URGENT
tasks.status            TODO | DOING | WAITING | REVIEW | DONE
tasks.priority          LOW | NORMAL | HIGH | URGENT
deliveries.acceptance_status  PENDING | ACCEPTED | REJECTED
warranties.status       ACTIVE | EXPIRED | VOID
documents.doc_type      QUOTATION | PO | CONTRACT | DELIVERY_NOTE | MA_CONTRACT | OTHER

ma_contracts.billing_cycle    MONTHLY | YEARLY
ma_contracts.status     DRAFT | ACTIVE | EXPIRED | CANCELLED | RENEWED
ma_addons.addon_type    EXTRA_QUOTA | OTHER

tickets.status          RECEIVED | IN_PROGRESS | RESOLVED | REOPENED | CLOSED
tickets.billing_type    WARRANTY | MA_QUOTA | ADDON | ONE_TIME | FREE
tickets.reported_channel  LINE | PHONE | EMAIL | FACEBOOK | OTHER
ticket_resolutions.result  SUCCESS | PARTIAL | FAILED

follow_ups.status       PLANNED | DONE | OVERDUE | CANCELLED
survey_questions.question_type  RATING | CHOICE | MULTI_CHOICE | TEXT
survey_assignments.status  PENDING | SENT | ANSWERED | EXPIRED
notification_rules.event_type  MA_EXPIRING | WARRANTY_EXPIRING | TASK_OVERDUE |
                               DELIVERY_DUE | FOLLOWUP_DUE | TICKET_SLA | CUSTOMER_IDLE
notifications.status    PENDING | SENT | FAILED | READ
```

---

## 9. Logic เฉพาะที่ต้องระวัง

### 9.1 Ticket Resolution (จุดที่ซับซ้อนที่สุด)

```
POST /api/tickets/:id/resolutions
  → นับ resolution เดิม แล้ว round = count + 1
  → สร้าง ticket_resolutions
  → update tickets.status = 'RESOLVED', resolution_count++
  → ถ้า billing_type = 'MA_QUOTA' → สร้าง ma_usages 1 แถว
  → ทั้งหมดอยู่ใน transaction เดียว
```

**หน้าจอ "รอรับการแก้ไข"** = `WHERE status IN ('RECEIVED','REOPENED','IN_PROGRESS')`

### 9.2 MA Quota

- นับต่อเดือน: `COUNT(ma_usages) WHERE contract_id=? AND period_year=? AND period_month=?`
- เทียบกับ `ma_plans.bug_quota_per_month` + โควตาจาก `ma_addons`
- เกินโควตา → set `ma_usages.is_over_quota = true` และคำนวณ `extra_charge`
- **ยังไม่สรุปว่า reset ทุกวันที่ 1 หรือนับจากวันเริ่มสัญญา** → ทำเป็น config ไว้ก่อน

### 9.3 Warranty

- `start_date` = `deliveries.delivered_at`
- `end_date` = `start_date + duration_month`
- ตอนเปิด ticket ให้เช็คว่าอยู่ในประกันไหม เพื่อ suggest `billing_type`

### 9.4 Permission Check

**ลำดับการตรวจสำคัญมาก** — `role.manage` ต้องถูกตรวจ *ก่อน* ที่ ADMIN จะได้ bypass
ไม่งั้น ADMIN จะหลุดเข้าไปจัดการ Role ได้ ซึ่งขัด BR-10 โดยตรง

```typescript
// PermissionsGuard — src/common/guards/permissions.guard.ts
if (isPublic) return true;                              // endpoint ที่ติด @Public()
if (!required.permissions && !required.accountTypes) return true;
if (!user) throw Unauthorized;

// 1. SUPER_ADMIN ผ่านทุกอย่าง ไม่มีข้อยกเว้น
if (user.accountType === 'SUPER_ADMIN') return true;

// 2. สิทธิ์ที่ผูกกับ account_type — ติ๊กให้ Role ยังไงก็ไม่ผ่าน (BR-10)
//    ต้องอยู่เหนือ ADMIN bypass
if (required.permissions.some(c => SUPER_ADMIN_ONLY.has(c))) throw Forbidden;

// 3. ข้อจำกัดที่ endpoint ระบุเอง ผ่าน @RequireAccountType(...)
if (required.accountTypes.length && !required.accountTypes.includes(user.accountType))
  throw Forbidden;

// 4. ADMIN เข้าได้ทุกเมนูโดยไม่ต้องผูก Role (ดู 4.1)
if (user.accountType === 'ADMIN') return true;

// 5. USER — union ของทุก Role ที่ได้รับมอบหมาย (ดู 4.2)
const perms = union(user.roles.map(r => r.permissions));   // query สดทุกครั้ง ไม่ยัดลง token
if (!required.permissions.some(c => perms.has(c))) throw Forbidden;
return true;
```

- `SUPER_ADMIN_ONLY` มี 3 ค่า — `role.manage`, `role.view`, `permission.view`
  ชุดนี้ถูกใช้สองที่: กันที่ guard และตัดออกจาก `permissions` ที่ `/auth/me` คืนให้ ADMIN
  ถ้าเพิ่มค่าใหม่ ต้องแน่ใจว่า ADMIN ไม่ควรเห็นเมนูนั้นด้วย
- ไม่ยัด permissions ลง JWT payload โดยเจตนา — เพื่อให้การถอด Role มีผลทันที
  ไม่ต้องรอ token หมดอายุ
- ครอบคลุมด้วย unit test 27 เคสที่ `permissions.guard.spec.ts` — ถ้าเผลอย้ายลำดับ
  ข้อ 2 กับ 4 สลับกัน เทสต์จะแดงทันที

---

## 10. สิ่งที่ยังไม่ได้ข้อสรุป (ห้ามเดาเอง ให้ถามก่อน)

| # | ประเด็น | สถานะ | ต้องรู้คำตอบก่อน Phase |
|---|---|---|---|
| Q1 | ลูกค้ากรอกแบบประเมินยังไง ในเมื่อไม่มี login (ลิงก์ token สาธารณะ / พนักงานกรอกแทน) | ⬜ ยังไม่สรุป | 13 |
| Q2 | โควตา MA reset ทุกวันที่ 1 หรือนับจากวันเริ่มสัญญา | ⬜ ยังไม่สรุป (ทำเป็น config `MA_QUOTA_RESET_MODE` ไว้ก่อน) | 8 |
| Q3 | MA รายปี นับโควตารายเดือน หรือรวมทั้งปียกยอดได้ | ⬜ ยังไม่สรุป | 8 |
| Q4 | 1 โครงการมี MA active พร้อมกันหลายฉบับได้ไหม | ⬜ ยังไม่สรุป | 8 |
| Q5 | Task ซ้อนกันได้กี่ระดับ + "ลำดับก่อนหลัง" คือ sort order หรือ dependency จริง | ✅ **ตอบแล้ว 8 ก.ย.** — เป็นแค่ sort order ใช้ `tasks.sort_order` ที่มีอยู่แล้ว งานที่ต้องทำก่อนให้ผู้ใช้ตั้ง `tasks.priority` เอง **ไม่ต้องมีตาราง dependency** (เป็นข้อสรุปชั่วคราว ทบทวนได้ถ้าหน้างานจริงไม่พอ) | — |
| Q6 | ต้อง migrate ข้อมูลเก่าไหม | ✅ **ตอบแล้ว** — บริษัทเปิดมา 4 ปี เก็บเป็นเอกสารกระดาษล้วน ไม่มีฐานข้อมูลเดิม จึงไม่ต้องเขียน migration script มีแต่การคีย์มือ (ยังไม่สรุปว่าต้องมี import CSV ไหม) | — |

> ยังไม่มีข้อสรุปว่า task ซ้อนกันได้กี่ระดับ — `parent_task_id` รองรับได้ไม่จำกัดชั้นในเชิงโครงสร้าง
> ถ้าต้องจำกัดจริงให้ตรวจที่ service ตอน Phase 5

---

## 11. วิธีทำงานกับ repo นี้

- **ทำทีละ module ให้จบ** (model → migration → dto → service → controller → swagger) แล้วค่อยขึ้นตัวถัดไป
- ทุก endpoint ต้องมี `@ApiTags`, `@ApiOperation`, `@ApiResponse`
- ทุก DTO ต้องมี `class-validator` decorator
- เขียน migration แยกไฟล์ต่อกลุ่มตาราง อย่ารวมทั้ง 30 ตารางในไฟล์เดียว
- ก่อน commit: `npm run lint && npm run build && npm test` ต้องผ่านทั้งสามคำสั่ง
- **อย่าสร้าง endpoint ที่ไม่มีใน scope** ถ้าคิดว่าจำเป็นให้เสนอก่อน
- **เมื่อกฎธุรกิจเปลี่ยน ให้อัปเดตไฟล์นี้ก่อนเขียนโค้ด** ไม่ใช่ตามเก็บทีหลัง
  เพราะไฟล์นี้ถูกอ่านทุกครั้งที่เริ่มงานใหม่ ถ้าปล่อยให้ขัดกับโค้ด งานรอบหน้าจะผิดตามเอกสาร

**หมายเหตุด้านเทคนิคที่เจอระหว่างทาง:**
- `@nestjs/common` v12 เป็น ESM ล้วน Jest จึงต้องรันด้วย `--experimental-vm-modules`
  script `test` ใน package.json เรียก jest ผ่าน node โดยตรงด้วยเหตุผลนี้
- TypeScript 6 ไม่ดึง `@types/jest` เข้ามาอัตโนมัติ ไฟล์ `*.spec.ts` ต้องมี
  `/// <reference types="jest" />` ที่บรรทัดแรก
- Model ที่ต้องเขียนลง DB ต้องประกาศ creation-attributes interface แล้วส่งเป็น generic
  ตัวที่สองของ `AuditedModel<T, TCreation>` ไม่งั้น `create()` จะบังคับให้ส่ง method ของ
  Model มาด้วยทุกครั้ง (ทำแล้วกับ User, Role, UserRole, RolePermission, AuditLog)

---

## 12. ลำดับการพัฒนา (Phase)

> **กำหนดส่ง 22 ตุลาคม 2026 — เกณฑ์ผ่านคือความคืบหน้าเกิน 80% หรือเสร็จ**
> (จากประชุมครั้งแรก) ทีม 2 คน อาจมีงานอื่นแทรกได้แต่โปรเจกต์นี้เป็นงานหลัก

| Phase | Module | สถานะ |
|---|---|---|
| 0 | Setup, CORS, Swagger, Response format, Error filter | ✅ เสร็จ |
| 1 | Models + Migrations 30 ตาราง + Seeders | ✅ เสร็จ |
| 2 | Auth + Users + Roles + Permissions + Guards | ✅ เสร็จ |
| 3 | Audit Log (global hook) | ✅ เสร็จ |
| 4 | Customers + Contacts + Communication Logs | ✅ เสร็จ |
| 5 | Projects + Tasks | ✅ เสร็จ |
| 6 | Deliveries + Warranties | ✅ เสร็จ |
| 7 | **Tickets + Resolutions** | ✅ เสร็จ |
| 8 | MA (Plans, Contracts, Usages, Addons) | ⬜ **ถัดไป** — ติด Q2–Q4 |
| 9 | Documents + Files (R2) | ⬜ |
| 10 | Reports + Analytics | ⬜ |
| 11 | Notifications + Scheduler + LINE | ⬜ |
| 12 | Follow-ups | ⬜ |
| 13 | Surveys | ⬜ ติด Q1 — **ตัวที่ตัดทิ้งก่อนถ้าเวลาไม่พอ** |

**ข้อเสนอปรับลำดับ (ยังไม่ยืนยัน):** เลื่อน Phase 12 (Follow-ups) ขึ้นมาก่อน Phase 9–11
เพราะตอบ pain point ที่ผู้บริหารบ่นหนักที่สุด — "ลืมติดตามลูกค้า เลยไปเป็นเดือนสองเดือน"
และเป็น module เล็ก ทำเสร็จเร็ว

---

## 13. สิ่งที่ตกลงเพิ่มจากประชุม แต่ยังไม่ได้ทำ

รายการนี้มาจาก transcript ประชุม 2 ครั้ง ไม่ได้อยู่ในหัวข้อ 1–12 เดิม
**ต้องเคลียร์ให้หมดก่อนถือว่าโปรเจกต์เสร็จ**

| # | สิ่งที่ต้องเพิ่ม | ผลต่อโครงสร้าง | ทำตอน Phase |
|---|---|---|---|
| A-1 | `POST /api/auth/logout` — เคลียร์ `refresh_token_hash` | endpoint ใหม่ | ✅ **เสร็จ 8 ก.ย.** |
| A-2 | `deliveries.version` + `delivered_by_user_id` (ผู้ส่งมอบที่เป็นพนักงาน) | +2 คอลัมน์ | ✅ **เสร็จ 8 ก.ย.** |
| A-3 | `tickets.received_by_user_id` — ผู้รับเรื่อง **แยกจาก** ผู้รับผิดชอบแก้ไข | +1 คอลัมน์ | ✅ **เสร็จ 8 ก.ย.** |
| A-4 | `tasks.priority` — ระดับความสำคัญของงานย่อย | +1 คอลัมน์ | ✅ **เสร็จ 8 ก.ย.** |
| A-5 | ลำดับก่อนหลังของ task | ✅ **ปิดแล้ว** — ใช้ `sort_order` + `priority` ที่มีอยู่ ไม่เพิ่มตาราง | — |
| A-6 | `GET /api/customers/:id/overview` — มุมมองลูกค้า 360 องศา รวมโครงการ ประกัน สัญญา ปัญหา การติดตาม ในครั้งเดียว | endpoint ใหม่ | 10 (ต้องรอโมดูลอื่นเสร็จก่อน) |
| A-7 | Customer Lifetime Value — ค่ารวมตลอดอายุการใช้บริการต่อลูกค้า 1 ราย คำนวณจาก `projects.contract_value` + `ma_contracts.price` + `ma_addons` | คำนวณสด ไม่เพิ่มคอลัมน์ | 10 |
| A-8 | import ข้อมูลเก่าจาก Excel/CSV (ต่อเนื่องจาก Q6) | ยังไม่สรุปว่าต้องมีไหม | — |
| A-9 | `projects.function_count` — จำนวนฟังก์ชันของโครงการ ใช้เป็นตัวตั้งคิดราคา MA คู่กับ `contract_value` (BR-05 เนื้อหาแผนเหมือนกัน ราคาต่างกัน) | +1 คอลัมน์ | ✅ **เสร็จ 8 ก.ย.** (migration `20260908000003`) |

> A-2 ถึง A-4 ทำเป็น migration ไฟล์ใหม่แล้ว ไม่ได้แก้ไฟล์เดิมที่รันไปแล้ว
> `20260908000001-add-group-c-meeting-columns.js` และ `20260908000002-add-group-e-meeting-columns.js`
>
> คอลัมน์ที่เพิ่มถูกเปิดใช้แล้วที่ Phase 5 (`tasks.priority`) และ Phase 6
> (`deliveries.version`, `deliveries.delivered_by_user_id`)
> `tickets.received_by_user_id` (A-3) ถูกเปิดใช้แล้วที่ Phase 7 — ผู้รับเรื่องถูกเติม
> จากผู้ที่กดสร้างใบโดยอัตโนมัติ แยกจาก `assigned_user_id` ที่ต้องมอบหมายทีหลัง
> คอลัมน์ที่ตกลงกันในที่ประชุมจึงถูกใช้งานจริงครบทุกตัวแล้ว

---

## 14. สิ่งที่ระบบทำได้แล้ว ณ สิ้น Phase 7

ใช้อ้างอิงเวลาต่อยอด จะได้ไม่เขียนซ้ำ

- **Guard ระดับ global** — ทุก endpoint ต้องล็อกอินโดยอัตโนมัติ endpoint ที่เปิดสาธารณะ
  ต้องประกาศ `@Public()` ออกมาให้ชัด (ปัจจุบันมี 3 เส้น: login, refresh, health)
- **Audit log อัตโนมัติทุกตาราง** — เขียนที่ Sequelize global hook ที่เดียว
  module ใหม่ไม่ต้องเขียนโค้ด audit เพิ่มเลย ครอบคลุมทั้ง create/update/destroy และ bulk
  ค่าในช่องรหัสผ่านถูกแทนที่ด้วย `[REDACTED]` เสมอ
- **ผู้กระทำถูกดึงผ่าน AsyncLocalStorage** — ดู `common/context/request-context.ts`
  ถ้าเขียน DB จาก scheduler ที่ไม่มี request จะได้ `user_id = null` ซึ่งถูกต้องแล้ว
- **Endpoint ที่มีแล้ว** — auth (login/refresh/logout/me), users (list/create/update/roles/status/
  me-password), roles (CRUD + permissions), permissions (list), audit-logs (list), health,
  customers (CRUD + detail), contacts (CRUD), communication-logs (CRUD + detail),
  projects (list/detail/create/update), projects/:id/tasks (CRUD),
  tasks (overdue, status, order),
  projects/:id/deliveries (list/create), deliveries (detail/update/acceptance),
  deliveries/:id/warranties (create), warranties (expiring/detail/update),
  projects/:id/warranties (list),
  tickets (list/pending/detail/create/assign/reopen/close),
  tickets/:id/resolutions (create)
  — รวม 61 เส้น
- **เทสต์คุมกฎธุรกิจ 250 เคส 11 ไฟล์** — guard สิทธิ์, สูตรวันที่, และ service ของ Phase 4–7
  ทั้งหมดเป็น unit test ที่ mock model ไม่แตะฐานข้อมูลจริง รันจบใน ~19 วินาที
  **ถ้าจะแก้กฎธุรกิจข้อไหน ให้แก้เทสต์ที่คุมข้อนั้นไปพร้อมกัน** ไม่ใช่ลบทิ้งให้ผ่าน
- **e2e 6 เคสที่ `test/tickets.e2e-spec.ts`** — รันด้วย `npm run test:e2e` แยกจาก `npm test`
  เพราะต้องมี MySQL จริง ใช้ฐาน `<DB_DATABASE>_test` ที่ `test/global-setup.js`
  สร้าง+migrate+seed ให้เอง จึงไม่มีทางเขียนทับฐานที่ใช้พัฒนา
  มีไว้พิสูจน์สิ่งที่ mock พิสูจน์แทนไม่ได้ — SQL ที่ Sequelize สร้างรันได้จริง,
  unique index `(ticket_id, round)` ไม่ถูกละเมิดตอนแก้หลายรอบ, transaction commit จริง

**กฎธุรกิจที่ Phase 4 บังคับไว้ อย่าเขียนทับตอนต่อยอด**
- ผู้ติดต่อหลักมีได้คนเดียวต่อลูกค้า 1 ราย — ตั้งคนใหม่แล้วระบบถอดคนเดิมให้เองในทรานแซกชันเดียว
- `customers.last_contacted_at` ถูกอัปเดตอัตโนมัติตอนบันทึกการติดต่อ และ**ไม่ถอยหลัง**
  เมื่อบันทึกย้อนหลัง (BR-02 อนุญาตให้บันทึกย้อนหลัง แต่ห้ามทำให้ลูกค้าดูเหมือนเพิ่งติดต่อไป)
- บันทึกการติดต่อล่วงหน้าไม่ได้ (เผื่อนาฬิกาคลาดเคลื่อน 5 นาที) และผู้ติดต่อที่ระบุ
  ต้องอยู่ภายใต้ลูกค้ารายเดียวกัน
- ลบลูกค้าไม่ได้ถ้ามีโครงการหรือใบแจ้งปัญหาผูกอยู่ → ให้เปลี่ยนสถานะเป็น CHURNED แทน
  ถ้าลบได้ ผู้ติดต่อและบันทึกการติดต่อจะถูก soft delete ตามไปด้วยในทรานแซกชันเดียว
- ลบผู้ติดต่อไม่ได้ถ้ายังถูกอ้างอิงในบันทึกการติดต่อ
- `GET /api/customers?idleDays=N` = หน้าจอ "ลูกค้าที่ถูกลืม" นับคนที่ยังไม่เคยติดต่อเลยรวมด้วย

**กฎธุรกิจที่ Phase 5 บังคับไว้**
- ความคืบหน้าโครงการ = (task ที่ DONE / task ทั้งหมด) x 100 นับ task ทุกชั้นแบบแบน
  ไม่ถ่วงน้ำหนักด้วย estimated_hours เพราะไม่ได้กรอกกันทุกงาน โครงการที่ยังไม่มี task ได้ 0%
- **สถานะงานเปลี่ยนไปไหนก็ได้ ไม่บังคับลำดับ** เพราะงานจริงถอยกลับได้ (REVIEW ไม่ผ่าน -> DOING)
  เป็น DONE แล้วระบบใส่ `completed_at` ให้ ถอยออกจาก DONE แล้วล้างค่า และเป็น DONE ซ้ำไม่ทับเวลาเดิม
- **จัดลำดับ** ส่งตำแหน่งปลายทาง ระบบเรียงพี่น้องทั้งกลุ่มใหม่เป็น 0,1,2,... ไม่ใช่แก้ค่าตัวเดียว
  ไม่งั้นลำดับจะเพี้ยนหลังลากไปมาหลายรอบ — ค่านี้ใช้แสดงผลเท่านั้น ไม่ได้บังคับลำดับการทำงาน (Q5)
- งานย่อยซ้อนได้ไม่จำกัดชั้นในฐานข้อมูล แต่ API คืนโครงสร้างซ้อน **2 ระดับ** เป็นค่าเริ่มต้น
  ชั้นที่ 3 ขึ้นไปเจาะดูด้วย `?parentTaskId=` ระบบตรวจไม่ให้เกิดวงกลมตอนย้ายงานแม่
- งานเกินกำหนด = `due_date < วันนี้` และสถานะไม่ใช่ DONE — งานที่ครบกำหนดวันนี้ยังไม่นับว่าเกิน
- ย้ายโครงการข้ามลูกค้าไม่ได้ ย้ายงานข้ามโครงการไม่ได้ ลบงานแม่แล้วงานย่อยทุกชั้นถูกลบตาม
- โครงการไม่มี DELETE — ที่ยกเลิกให้เปลี่ยนสถานะเป็น CANCELLED

**กฎธุรกิจที่ Phase 6 บังคับไว้**
- **`warranties.start_date` ไม่เคยรับค่าจาก client** — คำนวณจาก `deliveries.delivered_at`
  ของใบส่งมอบที่ระบุใน URL เสมอ (BR-06) `project_id` ก็คัดลอกมาจากใบส่งมอบเช่นกัน
  นี่คือจุดเดียวที่ BR-06 ถูกบังคับจริง ถ้าย้ายไปให้ client ส่งมา กฎจะเหลือแค่ข้อตกลง
- **แก้วันส่งมอบแล้วประกันทุกใบของใบนั้นถูกขยับตามอัตโนมัติ** ทั้ง `start_date` และ
  `end_date` ในทรานแซกชันเดียวกับการแก้ใบส่งมอบ (`WarrantiesService.resyncByDelivery()`)
  ถ้าไม่ทำ ประกันจะอ้างวันที่รู้แล้วว่าผิด และตรวจไม่เจอจนกว่าจะมีคนไล่ดูทีละใบ
- `end_date` = `start_date + duration_month` แบบ**หนีบวันสิ้นเดือน** — 31 ม.ค. + 1 เดือน
  = 28 ก.พ. ไม่ใช่ 3 มี.ค. สูตรอยู่ที่ `common/utils/date.util.ts` ห้ามใช้ `Date.setMonth()`
  ตรง ๆ เพราะมันล้นเดือน วันสุดท้ายนับรวมอยู่ในประกัน (`start <= วันที่ <= end`)
- **หน้าจอต้องอ่าน `isCurrentlyActive` ไม่ใช่ `status`** — ยังไม่มี scheduler ปรับ `status`
  เป็น EXPIRED ให้อัตโนมัติจนกว่าจะถึง Phase 11 แถวที่หมดอายุไปแล้วจึงยังค้างเป็น ACTIVE
  ทุกที่ที่ตัดสินว่า "อยู่ในประกันไหม" จึงกรองด้วย `status != VOID` **แล้วเทียบช่วงวันที่ซ้ำ**
- **`WarrantiesService.isUnderWarranty(projectId, date)` คือของที่ Phase 7 ต้องเรียก**
  ตอนเปิด ticket เพื่อ *เสนอ* `billing_type` เท่านั้น ไม่ใช่ตั้งค่าให้เอง เพราะประกันครอบคลุม
  เฉพาะ bug ในขอบเขตเดิม งานที่ขอเพิ่มใหม่คิดเงินแม้อยู่ในระยะประกัน (BR-07)
  ขอบเขตอยู่ที่ `warranties.scope_note` เป็นข้อความให้คนอ่าน ระบบไม่บังคับใช้เอง
  ถ้าครอบคลุมพร้อมกันหลายใบ `findCoveringWarranty()` คืนใบที่หมดช้าที่สุด
- **วันส่งมอบลงล่วงหน้าไม่ได้** (เผื่อนาฬิกาคลาดเคลื่อน 5 นาที) เพราะจะทำให้ประกัน
  เริ่มในอนาคต แล้ว `isUnderWarranty` ตอบว่าไม่คุ้มครองทั้งที่หน้าจอบอกว่ามีประกัน
  — บันทึกย้อนหลังยังทำได้ตามปกติ
- **ประวัติการส่งมอบเรียงด้วย `delivered_at` ไม่ใช่ `version`** — `version` เป็นข้อความอิสระ
  ("v1.2.0", "รอบที่ 2") เรียงแบบพจนานุกรมจะได้ v10 มาก่อน v2 `version` จึงไม่อยู่ใน
  `SORTABLE_FIELDS` และมีการเรียงด้วย `id` เป็นตัวตัดสินรอง เผื่อส่งมอบหลายรอบในวันเดียว
- ออกประกันหลายใบต่อการส่งมอบครั้งเดียวได้ถ้า **ระยะต่างกัน** (ฮาร์ดแวร์ 12 เดือน
  ซอฟต์แวร์ 6 เดือน) แต่ระยะซ้ำบนใบเดิมที่ยังไม่ VOID จะถูกปฏิเสธด้วย 409 เพื่อกันการกดซ้ำ
- **ผู้ส่งมอบระบุพนักงานที่ลาออกแล้วได้** (ค้นแบบ `paranoid: false` ไม่เช็คสถานะ)
  ต่างจากการมอบหมายงานหรือตั้งผู้จัดการโครงการที่ต้อง ACTIVE — เพราะนี่คือการบันทึก
  ข้อเท็จจริงในอดีต ไม่ใช่การมอบหมายงานใหม่ ส่วนผู้รับมอบต้องอยู่ใต้ลูกค้าเจ้าของโครงการ
- สถานะการตรวจรับเปลี่ยนไปมาได้ไม่บังคับลำดับ (เหตุผลเดียวกับสถานะงานใน Phase 5)
  เป็น ACCEPTED แล้วระบบใส่ `accepted_at` ให้ ถอยออกแล้วล้าง และ ACCEPTED ซ้ำไม่ทับเวลาเดิม
- ใบส่งมอบและใบประกัน **ไม่มี DELETE** — ใบส่งมอบเป็นจุดตั้งต้นของประกัน ถ้าลบได้
  ประกันจะไร้ที่มา ประกันที่ยกเลิกให้เปลี่ยน `status` เป็น VOID แทน
- ไฟล์แนบของใบส่งมอบ (`attachments.ref_type = 'DELIVERY'`) **อ่านได้อย่างเดียวตอนนี้**
  คืนมาใน endpoint รายละเอียด ส่วนการอัปโหลดจริงเป็นของโมดูล Files ใน Phase 9

**กฎธุรกิจที่ Phase 7 บังคับไว้ (โมดูลที่ห้ามแตะโดยไม่อ่านก่อน)**
- **ไม่มี endpoint สำหรับ "เปิดใบใหม่จากปัญหาเดิม" และห้ามเพิ่มทีหลัง (BR-03, BR-04)**
  ปัญหาเดิมกลับมา = `PATCH /api/tickets/:id/reopen` แล้ว `POST /api/tickets/:id/resolutions`
  ในใบเดิม `round` คิดจาก `COUNT(resolutions ของใบนี้) + 1` เสมอ ไม่ได้รับค่าจาก client
  (`CreateResolutionDto` จึงไม่มีฟิลด์ `round` โดยเจตนา)
- **ทุกอย่างของ `POST /resolutions` อยู่ในทรานแซกชันเดียว** และล็อกแถวใบด้วย
  `lock: transaction.LOCK.UPDATE` ก่อนนับรอบ ถ้าไม่ล็อก การกดบันทึกสองครั้งพร้อมกัน
  จะได้ `round` ซ้ำแล้วชน unique index `(ticket_id, round)` เป็น error ดิบของ MySQL
- **ใบที่ CLOSED แล้วเพิ่มรอบไม่ได้** — ต้อง reopen ก่อน สถานะที่เหลือวนกลับได้อิสระ
  `RESOLVED → REOPENED → IN_PROGRESS` ตาม BR-04
- **หักโควตา MA ครั้งเดียวต่อใบ ไม่ใช่ต่อรอบการแก้ไข** — `ma_usages.ticket_id` มี UNIQUE
  index ตั้งแต่ migration Phase 1 การสร้างแถวใหม่ทุกรอบจึงเป็นไปไม่ได้ทางโครงสร้าง
  และตรงกับ BR-04 ที่ถือว่า "หลายรอบ = ปัญหาเดียว" — ลูกค้าไม่ควรถูกหักโควตาสองครั้ง
  เพราะเราแก้ไม่จบในรอบแรก `MaQuotaService.recordUsageForTicket()` เช็คแถวเดิมแล้วข้ามเอง
- **ระบบ *เสนอ* `billing_type` ไม่ได้ *ตัดสิน*** — ค่าที่ผู้ใช้ส่งมาชนะเสมอ
  ไม่ส่งมาจึงใช้ที่ระบบเสนอ ไม่มีอะไรเลยได้ `ONE_TIME` ลำดับการเสนอคือ
  **ประกันมาก่อนสัญญา MA** เพราะประกันคือของที่ลูกค้าจ่ายไปแล้ว การไปหักโควตา MA
  ทั้งที่ยังอยู่ในประกันเท่ากับให้ลูกค้าเสียของฟรี ส่วน BR-07 (งานที่ขอเพิ่มใหม่ต้องคิดเงิน
  แม้อยู่ในประกัน) ระบบตัดสินแทนคนไม่ได้ จึงเป็นหน้าที่คนเปลี่ยนเป็น `ONE_TIME` เอง
- `warranty_id` / `ma_contract_id` ถูกบันทึกไว้ตอนเปิดใบ**เสมอ แม้ผู้ใช้เลือกเป็นอย่างอื่น**
  เพื่อให้ตรวจย้อนหลังได้ว่าตอนนั้นระบบเห็นหลักฐานอะไร
- **มอบหมายผู้รับผิดชอบแล้วใบที่ยัง RECEIVED เลื่อนเป็น IN_PROGRESS ให้เอง** เพราะทีมขนาดนี้
  การมอบหมายคือจุดที่งานเริ่มเดินจริง — ถอนการมอบหมายไม่ย้อนสถานะกลับ
  `received_by_user_id` (A-3) คือผู้รับเรื่อง เติมจากคนที่กดสร้างใบ **คนละคนกับ**
  `assigned_user_id` ที่มอบหมายทีหลังได้
- **หน้าจอ "รอรับการแก้ไข"** = `GET /api/tickets/pending` → `status IN
  ('RECEIVED','REOPENED','IN_PROGRESS')` ค่าคงที่อยู่ที่ `PENDING_TICKET_STATUSES`
  ที่เดียว ทั้ง query และ flag `isPending` ในผลลัพธ์อ่านจากค่าเดียวกัน
- **ใบแจ้งปัญหาและรอบการแก้ไขไม่มี DELETE** — เป็นประวัติการให้บริการที่ต้องอ้างอิงได้
  ใบที่ไม่เอาแล้วให้ปิดงาน (`PATCH /:id/close`)
- `extra_charge` **ยังต้องกรอกมือ** — ทั้ง schema ไม่มีที่เก็บ "อัตราค่าบริการเมื่อเกินโควตา"
  ระบบจึงบอกได้แค่ว่า *เกินโควตาแล้ว* (`is_over_quota`) คิดเป็นเงินเท่าไหร่ยังเป็นคนตัดสิน
- **`MaQuotaService` ถูกสร้างที่ Phase 7 แต่ยังไม่มี controller** — Phase 8 เป็นเจ้าของ
  CRUD ของ MA ทั้งหมด ที่ทำไว้ก่อนคือเฉพาะส่วนที่ ticket ต้องเรียกใช้ (หาสัญญาที่ยังใช้อยู่,
  คิดช่วงโควตา, นับที่ใช้ไป, หักโควตา)
- **ข้อสมมติที่ค้าง Q2–Q4 ถูกเขียนไว้เป็น config ไม่ได้เดาแล้ว hardcode**
  `MA_QUOTA_RESET_MODE` = `CALENDAR_MONTH` (ค่าเริ่มต้น) หรือ `CONTRACT_ANNIVERSARY` (Q2)
  โควตานับเป็นรายเดือนเสมอ **ยังไม่ยกยอดข้ามเดือน** (Q3 — ถ้าผู้บริหารตอบว่ายกยอดได้
  ต้องแก้ `resolvePeriod()` + `countUsed()`) และถ้าเจอสัญญา active ซ้อนกันหลายฉบับ
  ระบบเลือกฉบับที่หมดช้าที่สุดแล้ว **log warning ไว้** (Q4) ไม่ปฏิเสธคำขอ

**ข้อมูลตัวอย่างสำหรับทดสอบ**
- `20260908000004-seed-demo-data.js` สร้างลูกค้า 3 ราย ผู้ติดต่อ 5 ราย บันทึกการติดต่อ 5 รายการ
  โครงการ 3 โครงการ งาน 19 รายการ (ซ้อน 2 ชั้น) พนักงาน 3 บัญชี และบทบาท 2 บทบาท
- **ข้ามตัวเองเมื่อ `NODE_ENV=production`** เพราะเป็นข้อมูลสมมติ ไม่ใช่ master data
  เหมือน seeder อีกสามตัวที่ระบบจริงต้องมี
- วันที่ทุกค่าคำนวณจากวันที่รัน ไม่ได้ fix ไว้ — งานที่ตั้งใจให้เกินกำหนดจึงเกินกำหนดเสมอ
- เขียนผ่าน `queryInterface` ตรง ๆ จึง **ไม่เกิด audit log** ตามมา ซึ่งถูกต้องแล้ว
  เพราะไม่มีผู้กระทำจริง ถ้าต้องการข้อมูลไว้ทดสอบหน้าประวัติ ให้แก้ข้อมูลผ่าน API สักครั้ง
- บัญชีตัวอย่างใช้รหัสผ่าน `Demo@1234` (เปลี่ยนได้ด้วย `DEMO_USER_PASSWORD` ใน `.env`)
  — somchai เป็น ADMIN, pranee/wichai เป็น USER ที่ถือบทบาทจริง ใช้ทดสอบการกั้นสิทธิ์ได้

**การ log ระหว่างพัฒนา**
- ทุก request ขึ้น terminal บรรทัดละหนึ่งรายการ — method, url, status, เวลาที่ใช้, ผู้เรียก
  เปิด/ปิดด้วย `REQUEST_LOG` ใน `.env` (ค่าเริ่มต้นเปิดเมื่อไม่ใช่ production)
- **แบ่งหน้าที่กันสองที่โดยเจตนา** — `RequestLoggingInterceptor` log เฉพาะที่สำเร็จ
  ส่วนที่ล้มเหลว `HttpExceptionFilter` เป็นคน log เพราะ guard ทำงาน *ก่อน* interceptor
  เมื่อ guard ปฏิเสธ (401/403) interceptor จะไม่ถูกเรียกเลย ถ้าย้ายไป log ที่เดียว
  จะได้ภาพไม่ครบหรือได้บรรทัดซ้ำ ทั้งสองที่ใช้รูปแบบเดียวกันและ `URL_COLUMN_WIDTH` ร่วมกัน
- request ที่ล้มเหลวถูก log เสมอไม่ว่า `REQUEST_LOG` เป็นอะไร
- ไม่ log body ของ request เพราะมีรหัสผ่านปนในบางเส้น — ข้อมูลที่เปลี่ยนจริงอยู่ใน `audit_logs`
- `/api/health` ถูกข้ามไม่ log เพราะถูกยิงถี่จนกลบบรรทัดอื่น

**กับดักทางเทคนิคที่เจอและต้องระวังตลอดไป**
- **ห้ามใช้ include object ตัวเดียวกันซ้ำ** ทั้งที่ระดับบนและซ้อนใต้ include อื่น
  Sequelize แก้ object นั้นในที่ตอน normalize ทำให้ association ปนกันจน join ผิดคอลัมน์
  (อาการ: `Unknown column 'assignedUser.id' in 'field list'`) ให้ประกาศเป็นฟังก์ชัน
  ที่คืน object ใหม่ทุกครั้งแทน ดูตัวอย่างที่ `tasks.service.ts`
- **logout ล้างเฉพาะ refresh token** — access token ใบเดิมยังใช้ได้จนหมดอายุ (15 นาที)
  ถ้าต้องการตัดสิทธิ์ทันที ให้เปลี่ยนสถานะบัญชีเป็น SUSPENDED ซึ่ง JwtStrategy เช็คทุก request
