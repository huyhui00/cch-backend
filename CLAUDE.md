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
| ดูรายละเอียด Role ว่าติ๊กสิทธิ์อะไรไว้ (`GET /api/roles`) | ✅ | ❌ | ❌ |
| **ดูรายชื่อ Role เพื่อเลือกมอบ** (`GET /api/roles/assignable`) | ✅ | ✅ | ต้องมี `user.update` |
| **มอบ Role ให้ user** | ✅ | ✅ | ตามสิทธิ์ |
| เข้าเมนูทั่วไปโดยไม่ต้องมี Role | ✅ | ✅ | ❌ ต้องรอรับ Role |
| สร้าง / เลื่อนใครเป็น SUPER_ADMIN | ✅ | ❌ | ❌ |
| **เลื่อนตัวเองเป็น SUPER_ADMIN** | — | ❌ | ❌ |
| แก้ไขบัญชีที่เป็น SUPER_ADMIN | ✅ | ❌ | ❌ |

- ADMIN เลือกได้เฉพาะ Role ที่ SUPER_ADMIN สร้างไว้ — เป็นจริงโดยอัตโนมัติ เพราะมีแต่
  SUPER_ADMIN ที่สร้าง Role ได้ ไม่ต้องเขียนโค้ดบังคับเพิ่ม
- **สองแถวเรื่อง Role ข้างบนต้องอ่านคู่กัน** — "มอบ Role ได้" ไม่มีความหมายเลยถ้ามองไม่เห็นว่า
  มี Role อะไรให้เลือก `GET /api/roles` สงวนให้ SUPER_ADMIN ตาม BR-10 จึงต้องมี
  `GET /api/roles/assignable` แยกออกมา คืนแค่ id/ชื่อ/คำอธิบายของ Role ที่ยังเปิดใช้งาน
  ใช้สิทธิ์ `user.update` ตัวเดียวกับ `PUT /api/users/:id/roles` ที่มอบบทบาทจริง
  **ห้ามเพิ่มรายการสิทธิ์ที่ติ๊กไว้ลงในเส้นนี้** ไม่งั้นจะกลายเป็นช่องข้าม BR-10
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

customers.status        ACTIVE | INACTIVE | CHURNED   (ตัด PROSPECT ออก 10 ก.ย. — ดูกฎ Phase 4)
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
surveys.status          DRAFT | ACTIVE | CLOSED   (เพิ่ม 10 ก.ย. แทน is_active เดิม)
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
| Q1 | ลูกค้ากรอกแบบประเมินยังไง ในเมื่อไม่มี login (ลิงก์ token สาธารณะ / พนักงานกรอกแทน) | ✅ **ตอบแล้ว 10 ก.ย.** — **ทำฟอร์มคำถามในระบบ → ส่งให้ลูกค้ารีวิวนอกระบบ → พนักงานคีย์คำตอบกลับเข้ามาเอง** ไม่มีลิงก์ token สาธารณะและไม่มี endpoint `@Public()` เพิ่มเลย คอลัมน์ `access_token`/`token_expires_at` ที่เตรียมไว้ไม่ถูกใช้ ถ้าวันหนึ่งอยากได้ลิงก์ให้ลูกค้ากรอกเอง จะเป็นการ *เพิ่ม* ไม่ใช่รื้อ | — |
| Q2 | โควตา MA reset ทุกวันที่ 1 หรือนับจากวันเริ่มสัญญา | ✅ **ตอบแล้ว 9 ก.ย.** — **นับจากวันเริ่มสัญญา** `MA_QUOTA_RESET_MODE=CONTRACT_ANNIVERSARY` เป็นค่าเริ่มต้นแล้ว โหมด `CALENDAR_MONTH` ยังเก็บไว้เผื่อดีลที่ตกลงกันคนละแบบ | — |
| Q3 | MA รายปี นับโควตารายเดือน หรือรวมทั้งปียกยอดได้ | ✅ **ตอบแล้ว 9 ก.ย.** — **ไม่ยกยอด** ใช้ไม่หมดในรอบไหนคือหมดไป `billing_cycle` เป็นรอบวางบิลเท่านั้น ไม่เกี่ยวกับรอบโควตา | — |
| Q4 | 1 โครงการมี MA active พร้อมกันหลายฉบับได้ไหม | ⬜ **ยังไม่ยืนยัน (ถามแล้ว 9 ก.ย. — ตอบว่ายังไม่มั่นใจ)** ระบบจึงยังไม่ปฏิเสธ แต่เตือนใน `message` ตอนสร้าง และ `findActiveContract()` เลือกฉบับที่หมดช้าที่สุด ถ้าสรุปว่าห้ามซ้อน ให้เปลี่ยน `describeOverlap()` เป็นโยน 409 แล้วเพิ่ม partial unique index — **มีเครื่องมือดูของจริงแล้วที่ `GET /api/reports/ma-contract-overlaps`** (ตรวจจับและรายงานเท่านั้น ไม่แก้ข้อมูล) | 11 |
| Q5 | Task ซ้อนกันได้กี่ระดับ + "ลำดับก่อนหลัง" คือ sort order หรือ dependency จริง | ✅ **ตอบแล้ว 8 ก.ย.** — เป็นแค่ sort order ใช้ `tasks.sort_order` ที่มีอยู่แล้ว งานที่ต้องทำก่อนให้ผู้ใช้ตั้ง `tasks.priority` เอง **ไม่ต้องมีตาราง dependency** (เป็นข้อสรุปชั่วคราว ทบทวนได้ถ้าหน้างานจริงไม่พอ) | — |
| Q6 | ต้อง migrate ข้อมูลเก่าไหม | ✅ **ตอบแล้ว** — บริษัทเปิดมา 4 ปี เก็บเป็นเอกสารกระดาษล้วน ไม่มีฐานข้อมูลเดิม จึงไม่ต้องเขียน migration script มีแต่การคีย์มือ (ยังไม่สรุปว่าต้องมี import CSV ไหม) | — |
| Q7 | ระบบจะติดตั้งใช้งานที่ไหน (มาจากเอกสารออกแบบข้อ 9) | ⬜ **ยังไม่ได้ถาม** — ตัดสินว่า M11 ใช้ `@nestjs/schedule` ในโปรเซสได้ (เซิร์ฟเวอร์เปิดตลอด) หรือต้องให้ cron ภายนอกยิง `POST /api/jobs/notify` และใครดูแลสำรองข้อมูลรายวันตาม NFR | 11 |
| Q8 | บัญชี LINE OA / Messaging API พร้อมหรือยัง ใครเป็นเจ้าของบัญชี | ⬜ **ยังไม่ได้ถาม** — เอกสารข้อ 8.1 R5 ให้ตรวจตั้งแต่ต้น และต้องมีวิธีได้ `users.line_user_id` ของพนักงาน (แอดบัญชี OA) | 11 |
| Q9 | ปัญหาเดิมกลับมา *หลังปิดงาน (CLOSED) แล้ว* ให้ทำอย่างไร | ✅ **ตัดสินแล้ว 11 ก.ย.** — **reopen ในใบเดิมได้** ตาม BR-04 และคำพี่เลี้ยงในประชุม (พี่เลี้ยงให้ทีมออกแบบสถานะเอง) ไม่ห้ามเพราะปิดมานาน ดูกฎ Phase 7 | — |
| Q10 | "1 ฟังก์ชัน" ของ `projects.function_count` นับอย่างไร | ⬜ **ยังไม่ได้ถาม** — ประชุมพูดแค่หลักการ ไม่มีสูตร ถ้าไม่ใช้จริงให้ซ่อนช่อง | — |
| Q11 | ประเภทปัญหา (M5-10 "ปัญหาประเภทใดเกิดบ่อยที่สุด") มีรายการอะไรบ้าง | ⬜ **ยังไม่ได้ถาม** — `tickets` ยังไม่มีคอลัมน์ `category` (เอกสาร 6.3 มี) ต้องรู้ว่าเป็นรายการตายตัวหรือพิมพ์อิสระ | 7 |
| Q12 | กระดานงานทั้งบริษัท (M2-07) ต้องตัดงานของโครงการที่ปิด/ยกเลิกแล้วไหม และเก็บ `tasks.status = WAITING` ไว้ไหม (ประชุมพูด 4 ขั้น ระบบมี 5) | ⬜ **ยังไม่ได้ถาม** — ดูหมายเหตุ M2-07 ในกฎ Phase 5 | 5 |
| Q13 | ความหมายของ INACTIVE กับ CHURNED ตามที่เขียนในกฎ Phase 4 ถูกต้องไหม | ⬜ **ยังไม่ได้ยืนยัน** — PROSPECT ตัดแล้ว (10 ก.ย.) | — |

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
| 8 | MA (Plans, Contracts, Usages, Addons) | ✅ เสร็จ |
| 12 | **Follow-ups (M7)** | ✅ เสร็จ 10 ก.ย. |
| 13 | **Surveys (M8)** | ✅ เสร็จ 10 ก.ย. |
| 10 | **Reports + Analytics (M10) + M1-05/M1-06** | ✅ เสร็จ 10 ก.ย. |
| 9 | Documents + Files (R2, M9) | ⬜ **ถัดไป** — เลื่อนมาจากลำดับเดิม ยังอยู่ในขอบเขต |
| 11 | Notifications + Scheduler + LINE (M11) | ⬜ เลื่อนไปหลัง — FE ใช้ mock ไปก่อนได้ |

**✅ ปรับลำดับแล้ว 10 ก.ย. 2026 (ทีม frontend ยืนยัน)** — ตารางข้างบนเรียงตามลำดับที่ทำจริง
ไม่ใช่ตามเลข Phase เดิม เหตุผล:
- **Follow-ups ขึ้นมาก่อน** ตามข้อเสนอเดิม เพราะตอบ pain point ที่ผู้บริหารบ่นหนักที่สุด
  ("ลืมติดตามลูกค้า เลยไปเป็นเดือนสองเดือน") และเป็นโมดูลเล็ก ทำเสร็จเร็ว
- **Files (Phase 9) กับ Notifications (Phase 11) เลื่อนไปท้าย** เพราะ frontend ใช้ mock
  ไปก่อนได้ ไม่บล็อกงานอื่น ต่างจาก Follow-ups/Surveys ที่ FE รอต่อ API ทันที
- ลำดับที่เหลือ: Surveys → Reports → Files → Notifications

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
| A-6 | `GET /api/customers/:id/overview` — มุมมองลูกค้า 360 องศา รวมโครงการ ประกัน สัญญา ปัญหา การติดตาม ในครั้งเดียว | endpoint ใหม่ | ✅ **เสร็จ 10 ก.ย.** |
| A-7 | Customer Lifetime Value — **มูลค่ารวมตามสัญญา**ตลอดอายุการใช้บริการ คำนวณจาก `projects.contract_value` + `ma_contracts.price` + `ma_addons` | คำนวณสด ไม่เพิ่มคอลัมน์ | ✅ **เสร็จ 10 ก.ย.** — อยู่ใน `lifetimeValue` ของเส้น overview |
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

## 14. สิ่งที่ระบบทำได้แล้ว ณ สิ้น M10 (Reports)

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
  tasks (company list/summary/due-soon/overdue, status, order),
  projects/:id/deliveries (list/create), deliveries (detail/update/acceptance),
  deliveries/:id/warranties (create), warranties (expiring/detail/update),
  projects/:id/warranties (list),
  tickets (list/pending/detail/create/update/assign/reopen/close),
  tickets/:id/resolutions (create),
  ma-plans (CRUD), ma-contracts (list/detail/create/update/renew),
  ma-contracts/:id (quota/addons list/addons create/print),
  users/assignable, roles/assignable,
  follow-ups (list/detail/create/update/complete/delete),
  surveys (list/detail/create/update/status/delete + summary/score-breakdown/assignments/responses),
  survey-assignments/:id/response,
  reports (contract-value by-customer/by-type/upcoming, service-cost, ma-contract-overlaps),
  customers/:id/overview
  — รวม 105 เส้น (นับรวม `/api/health`)
- **เทสต์คุมกฎธุรกิจ 432 เคส 17 ไฟล์** — guard สิทธิ์, สูตรวันที่, และ service ของ Phase 4–8 + M7, M8, M10
  ทั้งหมดเป็น unit test ที่ mock model ไม่แตะฐานข้อมูลจริง รันจบใน ~19 วินาที
  **ถ้าจะแก้กฎธุรกิจข้อไหน ให้แก้เทสต์ที่คุมข้อนั้นไปพร้อมกัน** ไม่ใช่ลบทิ้งให้ผ่าน
- **e2e 75 เคส 7 ไฟล์** (`tickets`, `ma`, `permissions`, `follow-ups`, `surveys`, `reports`, `tasks`) — รันด้วย `npm run test:e2e`
  แยกจาก `npm test` เพราะต้องมี MySQL จริง ใช้ฐาน `<DB_DATABASE>_test` ที่
  `test/global-setup.js` สร้าง+migrate+seed ให้เอง จึงไม่มีทางเขียนทับฐานที่ใช้พัฒนา
  มีไว้พิสูจน์สิ่งที่ mock พิสูจน์แทนไม่ได้ — SQL ที่ Sequelize สร้างรันได้จริง,
  unique index `(ticket_id, round)` ไม่ถูกละเมิดตอนแก้หลายรอบ, transaction commit จริง,
  และ **ตาราง 4.1 เป็นจริงกับบัญชีจริงทั้งสามระดับ** (`permissions.e2e-spec.ts`)
  `test/setup-env.js` ตรึง `MA_QUOTA_RESET_MODE` ไว้ ไม่ให้ผลเทสต์เปลี่ยนตาม `.env` ของแต่ละเครื่อง

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
- **สถานะลูกค้ามี 3 ค่า ไม่มี `PROSPECT` (ผู้มุ่งหวัง)** — ตกลงกับพี่เลี้ยง 10 ก.ย. ว่าบริษัท
  บันทึกเฉพาะลูกค้าที่ใช้บริการจริงแล้ว ข้อมูลส่วนใหญ่เข้ามาพร้อมโครงการที่ได้รับมอบหมาย
  ไม่ได้เก็บรายชื่อผู้ที่ยังไม่จ้างงาน **ค่าเริ่มต้นจึงเป็น `ACTIVE`**
  (migration `20260910000002` เปลี่ยนแถว PROSPECT เดิมเป็น ACTIVE ให้แล้ว)
  - `ACTIVE` = ลูกค้าปัจจุบัน
  - `INACTIVE` = ไม่ได้ใช้บริการแล้ว แต่ความสัมพันธ์ยังดี — กลุ่มที่ควรตามเสนอ MA
  - `CHURNED` = เลิกใช้บริการ / ไม่ติดตามต่อ
  - สถานะเป็นป้ายที่คนตั้งเอง ยังไม่มีโค้ดส่วนไหนตัดสินจากค่านี้ ถ้าวันหนึ่งจะให้ระบบ
    คำนวณ ACTIVE/INACTIVE เองจากโครงการ ประกัน และ MA ต้องตกลงเป็นกติกาใหม่ก่อน

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
- **M2-06 งานใกล้ครบกำหนด = `GET /api/tasks/due-soon?withinDays=N`** (เพิ่ม 10 ก.ย.
  ค่าเริ่มต้น 7 สูงสุด 90) ช่วงคือ `วันนี้ <= due_date <= วันนี้ + N` และไม่ใช่ DONE —
  **ขอบล่างต้องเป็นวันนี้เสมอ** เพื่อต่อกับ `/tasks/overdue` (`due_date < วันนี้`) พอดี
  ถ้าเลื่อนเป็นพรุ่งนี้ งานที่ครบกำหนดวันนี้จะหายจากทั้งสองรายการ มี e2e ตรึงว่าสองรายการ
  ไม่ซ้อนและไม่เว้น
- **M2-07 ภาพรวมงานทั้งบริษัท = `GET /api/tasks` (รายการ) + `GET /api/tasks/summary` (ตัวเลข)**
  รายการเป็นแบบ **แบน** นับงานย่อยทุกชั้นเป็นหนึ่งงาน ต่างจาก `/projects/:id/tasks` ที่ซ้อน
  เพราะหน้าจอนี้ใช้ดูว่าอะไรติดอยู่ที่ไหน ถ้าซ้อน งานย่อยที่ค้างจะถูกซ่อนใต้งานแม่
  - แต่ละแถวพ่วง `project` (id, code, name, status) มาด้วย ผ่าน `CompanyTaskResponseDto`
    ที่แยกคลาสออกมา **ไม่ได้เพิ่มฟิลด์ลง `TaskResponseDto`** เพื่อไม่เปลี่ยนสัญญาของเส้นเดิม
  - เรียงด้วย `ISNULL(due_date)` ก่อน งานที่ไม่มีวันครบกำหนดจึงไปอยู่ท้าย (MySQL เรียง NULL ขึ้นก่อน)
  - `summary` นับ "เกินกำหนด" ด้วย `isTaskOverdue()` ตัวเดียวกับ flag `isOverdue` ทั้งระบบ
    รวมใน JavaScript ไม่ใช่ GROUP BY เพื่อไม่ให้มีสูตรสองชุด คืนครบทุกสถานะแม้เป็น 0
    `byAssignee` นับเฉพาะงานที่ยังไม่เสร็จ รวมงานที่ยังไม่มีผู้รับผิดชอบ (`assignedUserId: null`)
    และหาชื่อคนที่ลาออกไปแล้วด้วย (`paranoid: false`) เพื่อให้รู้ว่างานค้างต้องส่งต่อจากใคร
  - **ยังไม่กรองตามสถานะโครงการ** งานของโครงการที่ปิด/ยกเลิกไปแล้วยังถูกนับ (กติกาเดียวกับ
    `/tasks/overdue` เดิม) หน้าจอแยกได้จาก `project.status` — ถ้าผู้บริหารต้องการให้ตัดทิ้ง
    ต้องตัดสินใจก่อน เพราะเป็นกติกาใหม่

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
- **ใบที่ CLOSED แล้วเพิ่มรอบตรง ๆ ไม่ได้ ต้อง reopen ก่อน — และ reopen จาก CLOSED ได้**
  (ตัดสิน 11 ก.ย. — Q9) ปัญหาเดิมกลับมาหลังปิดงานแล้วก็ยังเป็น "ปัญหาเดิม" ต้องเพิ่มรอบ
  ในใบเดิมตาม BR-04 และคำพี่เลี้ยง ("ไม่ใช่ว่าปัญหาเดิมให้ไปเพิ่มใหม่ มันก็ยังอยู่เดิม")
  **ห้ามกลับไปบอกให้เปิดใบใหม่** — เดิมโค้ดปฏิเสธ CLOSED แล้วบอกให้เปิดใบใหม่ ซึ่งขัด BR-04
  - reopen ได้จากทุกสถานะยกเว้น REOPENED (409) — CLOSED ไปเป็น REOPENED เหมือน RESOLVED
  - reopen จาก CLOSED **ล้าง `closed_at`** เพราะใบไม่ได้ปิดแล้ว ปิดครั้งใหม่ได้เวลาใหม่
    ประวัติการปิดครั้งก่อนอยู่ใน audit log และหมายเหตุ "ปิดงาน" ที่ต่อท้ายรายละเอียดไว้แล้ว
    `resolved_at` กับ `resolution_count` ไม่ถูกล้าง (เป็นประวัติจริง เหมือน reopen จาก RESOLVED)
  - **ไม่ห้ามเพราะปิดมานาน** คนเป็นผู้ตัดสินว่าเป็นปัญหาเดิม หน้าจอแค่เตือนถ้าปิดไปเกิน ~3 เดือน
  - โควตา MA ไม่ถูกหักซ้ำ (หักครั้งเดียวต่อใบ) และ `billing_type` ไม่เปลี่ยนเอง
  - หน้าจอรวมเป็นกดครั้งเดียว: `PATCH /:id/reopen` แล้ว `PATCH /:id/assign` ต่อทันที
    → IN_PROGRESS ต้องมีทั้งสิทธิ์ `ticket.reopen` และ `ticket.assign`
  สถานะวนกลับได้ตาม BR-04 `RESOLVED/CLOSED → REOPENED → IN_PROGRESS`
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
- **มอบหมายผู้รับผิดชอบแล้วใบที่เป็น RECEIVED หรือ REOPENED เลื่อนเป็น IN_PROGRESS ให้เอง**
  เพราะทีมขนาดนี้การมอบหมายคือจุดที่งานเริ่มเดินจริง — ถอนการมอบหมายไม่ย้อนสถานะกลับ
  **REOPENED เพิ่มเข้ามา 11 ก.ย.** เดิมไม่มีทางไป IN_PROGRESS เลย ใบที่กลับมาเป็นซ้ำจึงค้าง
  REOPENED จนบันทึกรอบถัดไป ขัดกับ BR-04 และภาพ 6.4 (`REOPENED → IN_PROGRESS` "แก้ไขรอบที่ N+1")
  หน้าจอ "รอรับการแก้ไข" ก็แยกไม่ออกว่า "กลับมาแล้วยังไม่มีใครหยิบ" กับ "กำลังแก้รอบใหม่"
  **หยิบงานรอบใหม่ = `PATCH /:id/assign` ซ้ำ** แม้จะเป็นคนเดิมก็ตาม (ไม่เพิ่ม endpoint ใหม่)
  ส่วนการบันทึกรอบถัดไปตรงจาก REOPENED โดยไม่ผ่าน IN_PROGRESS ยังทำได้ตามเดิม
  `received_by_user_id` (A-3) คือผู้รับเรื่อง เติมจากคนที่กดสร้างใบ **คนละคนกับ**
  `assigned_user_id` ที่มอบหมายทีหลังได้
- **หน้าจอ "รอรับการแก้ไข"** = `GET /api/tickets/pending` → `status IN
  ('RECEIVED','REOPENED','IN_PROGRESS')` ค่าคงที่อยู่ที่ `PENDING_TICKET_STATUSES`
  ที่เดียว ทั้ง query และ flag `isPending` ในผลลัพธ์อ่านจากค่าเดียวกัน
- **ใบแจ้งปัญหาและรอบการแก้ไขไม่มี DELETE** — เป็นประวัติการให้บริการที่ต้องอ้างอิงได้
  ใบที่ไม่เอาแล้วให้ปิดงาน (`PATCH /:id/close`)
- **`PATCH /api/tickets/:id` มีไว้แก้ของที่คีย์ผิดตอนเปิดใบเท่านั้น** (เพิ่ม 10 ก.ย. —
  เดิมตกหล่นไป ทั้งที่สิทธิ์ `ticket.update` มีอยู่ใน seeder แล้ว) แก้ได้เฉพาะ
  หัวข้อ รายละเอียด ความสำคัญ ประเภทการคิดเงิน ช่องทาง/เวลาที่แจ้ง โครงการ ผู้แจ้ง
  ผู้รับเรื่อง กำหนดส่ง และเลขที่ใบ
  **ห้ามให้แก้ `status`, `resolution_count`, เวลาต่าง ๆ, `customer_id`,
  `warranty_id`, `ma_contract_id` เด็ดขาด** — สถานะมีเจ้าของอยู่แล้วคือ assign /
  resolutions / reopen / close ถ้าเส้นนี้แก้ได้ด้วย จะตั้งเป็น CLOSED โดยไม่เคยมี
  รอบการแก้ไขเลยก็ได้ ซึ่งข้ามกฎ BR-04 ทั้งหมด `UpdateTicketDto` จึงไม่มีฟิลด์พวกนี้
  และ `forbidNonWhitelisted` ปฏิเสธให้เองถ้าใครส่งมา — มีเทสต์ตรึงไว้ทั้ง unit และ e2e
- **ใบที่ปิดงานแล้วยังแก้ข้อมูลได้** เพราะการพิมพ์หัวข้อผิดต้องแก้ได้เสมอไม่ว่าใบจะอยู่
  สถานะไหน ต่างจากการ *เพิ่มรอบการแก้ไข* ที่ต้อง reopen ก่อน
- **เปลี่ยน `billing_type` ได้ตลอด** เพราะ BR-07 ให้คนเป็นผู้ตัดสิน ไม่ใช่ระบบ —
  งานที่ตอนแรกคิดว่าเป็น bug ในประกัน พอดูจริงแล้วเป็นของขอเพิ่มใหม่ ต้องแก้เป็น
  ONE_TIME ได้ (การหักโควตาที่เกิดไปแล้วไม่ย้อนกลับ เพราะเป็นเหตุการณ์ที่เกิดจริง)
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

**กฎธุรกิจที่ Phase 8 บังคับไว้**
- **`ma_plans` ไม่มีคอลัมน์ราคา และห้ามเพิ่ม (BR-05)** ราคาอยู่ที่ `ma_contracts.price`
  ที่เดียว ถ้าเอาราคาไปไว้ที่แผน จะต้องก๊อปแผนใหม่ทุกครั้งที่ต่อรองราคาได้ไม่เท่ากัน
  แล้ว "เนื้อหาเหมือนกันทุกโครงการ" จะเป็นไปไม่ได้ตั้งแต่ต้น — มีเทสต์ปักหมุดไว้ทั้ง
  ระดับ unit และ e2e ว่าไม่มีฟิลด์ราคาหลุดเข้าไป
- **สัญญาผูกกับโครงการเสมอ และ `customer_id` คัดลอกมาจากโครงการ ไม่รับจาก client**
  ไม่งั้นจะเกิดสัญญาที่ลูกค้ากับโครงการเป็นคนละราย แล้วรายงานรายลูกค้าผิดทั้งชุด
  ด้วยเหตุผลเดียวกัน **ย้ายโครงการทีหลังไม่ได้** (`UpdateMaContractDto` ไม่มี `projectId`)
- **รอบโควตานับจากวันเริ่มสัญญา (Q2)** สัญญาที่เริ่ม 15 ต.ค. ได้รอบ 15 ต.ค. – 14 พ.ย.
  `ma_usages.period_year/period_month` เก็บปี/เดือนของ **วันเริ่มรอบ** ซึ่งแทนรอบได้ครบ
  เพราะเดือนของ `เริ่ม + k เดือน` เดินทีละหนึ่งเสมอ ปี/เดือนกับ k จึงจับคู่กันหนึ่งต่อหนึ่ง
  หน้าจอต้องอ่าน `quota.periodStart` / `quota.periodEnd` ไม่ใช่เดาจากปี/เดือน
- ขอบรอบใช้ `addMonths()` ตัวเดียวกับวันหมดประกัน จึง **หนีบวันสิ้นเดือน** —
  สัญญาที่เริ่ม 31 ม.ค. ได้รอบถัดไปเริ่ม 28 ก.พ. **ห้ามกลับไปเทียบด้วย
  `usedAt.getDate() >= วันเริ่ม`** เพราะเดือนที่สั้นกว่าวันเริ่มจะถูกนับเป็นรอบก่อนหน้าทั้งเดือน
- **สถานะโควตาถูกคืนสองที่ ต้องมีฟิลด์ตรงกันเสมอ** — `POST /api/tickets/:id/resolutions`
  (พ่วงมาใน `quota`) กับ `GET /api/ma-contracts/:id/quota` พูดเรื่องเดียวกัน
  ถ้าฟิลด์ไม่ตรง frontend ต้องเขียนโค้ดอ่านสองแบบ และหน้าจอ ticket จะบอกผู้ใช้ไม่ได้ว่า
  โควตารอบนี้หมดวันไหน มีเทสต์ตรึงไว้ทั้ง unit และ e2e (e2e เทียบสองเส้นกันตรง ๆ)
  **ยกเว้นฟิลด์สุดท้ายที่ตั้งใจใช้คนละชื่อ เพราะความหมายต่างกันจริงตามบริบท**
  ฝั่ง resolutions `isOverQuota` = *ครั้งนี้* ที่เพิ่งหักไปเกินโควตาไหม
  ฝั่ง ma-contracts `isExhausted` = โควตาเต็มแล้วหรือยัง ครั้ง*ถัดไป*จะเกิน
  ทั้งคู่มาจาก `willExceed` ตัวเดียวกัน ต่างกันแค่หักไปแล้วหรือยัง — อย่ารวบเป็นชื่อเดียว
- **โควตาไม่ยกยอด (Q3)** ใช้ไม่หมดในรอบไหนคือหมดไป `countUsed()` จึงนับรอบเดียว
  ไม่ต้องไล่สะสมย้อนหลัง — `billing_cycle` (MONTHLY/YEARLY) เป็น **รอบวางบิล** เท่านั้น
  ไม่เกี่ยวกับรอบโควตา สัญญารายปีก็ยังนับโควตาเป็นรายเดือน
- **โควตารวมของรอบ = แผน + addon ที่มีผลกับรอบนั้น** addon ที่ไม่ระบุปี/เดือน
  มีผลตลอดอายุสัญญา และ **ต้องระบุปีกับเดือนมาคู่กันหรือไม่มาเลย** ถ้ามาค่าเดียว
  addon นั้นจะไม่เข้าเงื่อนไขไหนเลย กลายเป็นของที่ลูกค้าจ่ายแล้วแต่ระบบไม่เคยนับให้
- **แก้ `start_date` หรือ `plan_id` ไม่ได้เมื่อสัญญาหักโควตาไปแล้ว** ทั้งสองค่าเป็นตัวกำหนดว่า
  แถวใน `ma_usages` ตกรอบไหนและรอบนั้นมีโควตาเท่าไหร่ แก้ทีหลังเท่ากับเขียนประวัติใหม่
  ให้เปลี่ยนสถานะเป็น CANCELLED แล้วทำฉบับใหม่แทน
- **สถานะ RENEWED ตั้งเองไม่ได้** ระบบตั้งให้ฉบับเดิมตอน `POST /:id/renew` เท่านั้น
  ฉบับใหม่ชี้กลับด้วย `previous_contract_id` และ **เริ่มที่ DRAFT เสมอ** เพราะยังไม่ได้เซ็น (BR-12)
  ทั้งสองแถวเขียนในทรานแซกชันเดียว ไม่งั้นจะได้ ACTIVE ซ้อนกันเมื่อขั้นที่สองพัง
- **สัญญาไม่มี DELETE** ที่ไม่เอาแล้วให้เปลี่ยนเป็น CANCELLED (เหตุผลเดียวกับโครงการและใบส่งมอบ)
  ส่วน **แผนลบได้เฉพาะที่ยังไม่มีสัญญาอ้างอยู่** แผนที่ถูกใช้แล้วให้ปิดด้วย `is_active = false`
  ซึ่งซ่อนจากตัวเลือกตอนทำสัญญาใหม่ แต่สัญญาเดิมยังอ่านเนื้อหาได้
- **หน้าจอต้องอ่าน `isCurrentlyActive` ไม่ใช่ `status`** เหมือนกับประกันใน Phase 6 —
  ยังไม่มี scheduler ปรับเป็น EXPIRED จนกว่าจะถึง Phase 11 แถวที่หมดอายุจึงค้างเป็น ACTIVE
- **ราคาเป็น `string` ตลอดสาย ไม่ใช่ `number`** `DECIMAL(15,2)` ละเอียดกว่า `number`
  ของ JavaScript ถ้ารับเป็น number ค่าจะถูกปัดตั้งแต่ยังไม่ถึงฐานข้อมูล และ Sequelize
  ก็คืน DECIMAL มาเป็น string อยู่แล้ว รับเป็น string ตั้งแต่ต้นทางจึงไม่มีจุดแปลงชนิดเลย
- **`ma_contracts.price` = มูลค่ารวมตลอดอายุสัญญา (`start_date` ถึง `end_date`)**
  ไม่ใช่ราคาต่อเดือนหรือต่อรอบบิล — ตกลงกับพี่เลี้ยง 10 ก.ย. ส่วน `billing_cycle` บอกแค่
  ว่าวางบิลแบบไหน ไม่ได้เปลี่ยนความหมายของราคา ตัวอย่าง: รายเดือน 500 x 12 เดือน = `'6000.00'`
  เหตุผล: รายงาน M10 รวม `price` ตรง ๆ โดยไม่ดูรอบบิล ถ้ากรอกเป็นราคาต่อเดือน
  มูลค่าตามสัญญาจะต่ำกว่าจริงตามจำนวนเดือนโดยไม่มีใครรู้ — **ห้ามแก้สูตรรายงานไปคูณเอง**
  เพราะจะนับซ้ำกับสัญญาที่กรอกถูกอยู่แล้ว
- **มี endpoint แบบ "picker" สองเส้น ที่แยกสิทธิ์ *ใช้งาน* ออกจากสิทธิ์ *จัดการ*** —
  ทั้งสองเส้นเกิดจากปัญหาเดียวกัน คือสิทธิ์ที่ตาราง 4.1 ให้ไว้ ใช้จริงไม่ได้เพราะดรอปดาวน์ว่าง
  - `GET /api/users/assignable` **ไม่ติด `@RequirePermission` โดยเจตนา** คนที่มีสิทธิ์
    มอบหมายงานมักไม่มี `user.view` ข้อมูลที่คืนคือชื่อเพื่อนร่วมงานซึ่งเห็นได้อยู่แล้วทั่วระบบ
    และลูกค้าไม่มีบัญชี (BR-01) คนที่ล็อกอินได้จึงเป็นพนักงานเสมอ
  - `GET /api/roles/assignable` ใช้ `user.update` **override `role.manage` ที่ประกาศไว้
    ระดับ class** ของ `RolesController` — เป็นข้อยกเว้นเส้นเดียวของ controller นั้น
    `getAllAndOverride` อ่าน handler ก่อน class สิทธิ์ที่ประกาศบน method จึงชนะ
    ถ้ามีคนลบ decorator บน method ทิ้ง เส้นนี้จะตกกลับไปใช้ `role.manage` คือ**แน่นขึ้น
    ไม่ใช่หลวมลง** ซึ่งเป็นทางที่ปลอดภัยกว่า
  - **ห้ามเพิ่มฟิลด์ลงใน `AssignableUserDto` และ `RoleSummaryDto` ของสองเส้นนี้**
    ไม่งั้นจะกลายเป็น `GET /api/users` และ `GET /api/roles` ฉบับไม่มีสิทธิ์กั้น
    โดยเฉพาะ **รายการสิทธิ์ที่ติ๊กไว้ห้ามหลุดออกมาเด็ดขาด** เพราะเป็นช่องข้าม BR-10 ตรง ๆ
- **M6-08 พิมพ์ร่างสัญญา = `GET /api/ma-contracts/:id/print` คืน JSON ไม่ใช่ไฟล์**
  (เพิ่ม 10 ก.ย. — ตกหล่นไปตอนปิด Phase 8) backend ประกอบข้อมูลครบชุด ได้แก่
  เงื่อนไขสัญญา ลูกค้า ผู้ติดต่อหลัก โครงการ เนื้อหาแผนพร้อมรายการบริการ และของเสริม
  ส่วนการจัดหน้ากระดาษ ข้อความข้อกำหนด และช่องลงลายมือชื่อเป็นงานของ frontend
  **ห้ามเปลี่ยนไปสร้าง HTML/PDF ใน repo นี้** (ข้อ 1) ถ้าวันหนึ่งต้องการ PDF จาก
  server จริง ให้เสนอก่อนเพราะต้องเพิ่ม dependency
  - **ไม่กั้นตามสถานะ** พิมพ์ฉบับ DRAFT ไปเซ็น (BR-12) หรือฉบับที่ยกเลิกแล้วเพื่อเข้าแฟ้มได้
    หน้าจอใช้ `contract.status` ตัดสินเรื่องลายน้ำเอง
  - **ไม่มีผู้ติดต่อหลัก = `primaryContact: null` ห้ามหยิบคนแรกมาแทน** เพราะอาจพิมพ์
    ชื่อคนที่ไม่มีอำนาจลงนามลงสัญญา
  - **ของเสริมแสดงแยกรายการ ไม่รวมกับ `price` เป็นยอดเดียว** — ไม่มีกติกาว่ายอดในสัญญา
    ต้องรวมของเสริมไหม จึงไม่สร้างขึ้นเอง
  - เนื้อหาแผนอ่านสดจาก `ma_plans` (BR-05 ไม่ก๊อปเก็บ) ถ้าแก้แผนทีหลัง
    พิมพ์ใหม่จะได้เนื้อหาใหม่ — ฉบับที่เซ็นแล้วของจริงอยู่ที่ไฟล์สแกน `signed_file_url`
  - **ข้อมูลฝั่งบริษัทผู้ให้บริการไม่อยู่ในผลลัพธ์** เพราะ schema ไม่มีที่เก็บ
    frontend ใส่ในแม่แบบเอง ถ้าต้องแก้ได้จากหน้าจอ ให้เสนอเพิ่มตารางก่อน
- โมดูลนี้ **ไม่มี endpoint สำหรับแก้หรือลบ `ma_usages`** โดยเจตนา — การหักโควตาเกิดจาก
  การบันทึกผลการแก้ปัญหาเท่านั้น (Phase 7) ถ้าเปิดให้แก้มือได้ ตัวเลขโควตากับประวัติ
  การแก้ปัญหาจะไม่ตรงกันโดยไม่มีใครรู้

**กฎธุรกิจที่ M7 (Follow-ups) บังคับไว้**
- **`follow_ups` ไม่มีคอลัมน์ `channel` และห้ามเพิ่ม** — ช่องทางการติดต่อเป็นของ
  `communication_logs` (BR-02) งานติดตามคือ "เตือนว่าต้องตามลูกค้ารายนี้"
  ตอนสร้างยังไม่รู้ด้วยซ้ำว่าจะติดต่อทางไหน ติดต่อจริงแล้วค่อยบันทึกเป็นการติดต่ออีกใบ
- **สถานะ `OVERDUE` เป็นค่าที่ *คำนวณ* ไม่ใช่ค่าที่ตั้ง** — `PATCH` ที่ส่ง `OVERDUE` มา
  ถูกปฏิเสธด้วย 400 และงานที่สร้างด้วยวันย้อนหลังก็ยังเริ่มที่ `PLANNED`
  **หน้าจอต้องอ่าน `isOverdue` ไม่ใช่ `status`** เหตุผลเดียวกับ `isCurrentlyActive`
  ของประกัน (Phase 6) และสัญญา MA (Phase 8) — ยังไม่มี scheduler มาปรับ `status` ให้
  จนกว่าจะถึง Phase 11 แถวที่เลยกำหนดแล้วจึงค้างเป็น `PLANNED` อยู่ในฐานข้อมูล
- **เงื่อนไขของ `?overdue=true` ต้องตรงกับ `isFollowUpOverdue()` เป๊ะ ๆ** —
  `status IN (PLANNED, OVERDUE)` และ `due_date < วันนี้` ถ้าสองที่นี้หลุดจากกัน
  จะได้รายการที่กรองมาว่า "เลยกำหนด" แต่แต่ละแถวแสดง `isOverdue: false` ซึ่งดูเหมือนระบบพัง
  มีเทสต์ตรึงไว้ทั้ง unit (เทียบ query กับฟังก์ชันตรง ๆ) และ e2e
- งานที่ครบกำหนด **วันนี้** ยังไม่นับว่าเลยกำหนด — กติกาเดียวกับงานย่อยใน Phase 5
- **`completed_at` ระบบใส่ให้เอง** ตอนสถานะเป็น DONE ถอยออกแล้วล้าง เป็น DONE ซ้ำ
  ไม่ทับเวลาเดิม (เหมือน `tasks.completed_at` และ `deliveries.accepted_at`)
  client ส่งค่านี้มาเองไม่ได้
- **`PATCH /:id/complete` แยกจาก `PATCH /:id` เพราะใช้สิทธิ์ `followup.complete` คนละตัว**
  ทีมที่อยากให้พนักงานปิดงานของตัวเองได้แต่ไม่ให้แก้เนื้อหางาน จึงกั้นได้จริง
- **ปิดงานติดตาม *ไม่* ไปอัปเดต `customers.last_contacted_at`** — ค่านั้นมีเจ้าของอยู่แล้ว
  คือการบันทึกการติดต่อ ซึ่งมีหลักฐานครบ (ช่องทาง เนื้อหา ผู้ติดต่อ) ถ้าที่นี่เขียนด้วย
  จะมีสองทางเขียนค่าเดียวกันโดยทางหนึ่งไม่มีหลักฐานอะไรเลย แล้วหน้าจอ "ลูกค้าที่ถูกลืม"
  จะเงียบไปทั้งที่ยังไม่มีใครคุยกับลูกค้าจริง — **หน้าจอควรชวนผู้ใช้บันทึกการติดต่อต่อ
  ทันทีหลังปิดงานติดตาม** มีเทสต์ตรึงไว้ทั้ง unit และ e2e ว่าค่านี้ไม่ขยับ
- **`detail` กับ `result_note` เป็นคนละช่องโดยเจตนา** — `detail` เขียนตอนวางแผน
  ("ลูกค้าขอเวลาคิดถึงสิ้นเดือน") `result_note` เขียนตอนทำเสร็จ ("โทรแล้ว ขอเลื่อน")
  รวมเป็นช่องเดียวจะเสียประวัติว่าตั้งใจไว้ยังไงกับได้ผลยังไง
- **ย้ายลูกค้าไม่ได้** (`UpdateFollowUpDto` ไม่มี `customerId`) เหตุผลเดียวกับที่ย้ายโครงการ
  ข้ามลูกค้าไม่ได้ใน Phase 5 — ผูกผิดรายให้ยกเลิกแล้วสร้างใหม่
- **มี DELETE** ต่างจากสัญญา/ใบส่งมอบ/ใบแจ้งปัญหา เพราะงานติดตามเป็นรายการงาน
  ไม่ใช่เอกสารที่เกิดขึ้นจริง (เหมือน `tasks` ที่ลบได้) — แต่งานที่ตัดสินใจว่าไม่ทำแล้ว
  ให้เปลี่ยนเป็น `CANCELLED` ลบไว้ใช้เฉพาะกรณีสร้างผิดจริง ๆ
- เรียงตาม `due_date` จากเก่าไปใหม่เป็นค่าเริ่มต้น — ของที่ค้างนานที่สุดต้องอยู่บนสุด
  ไม่งั้นหน้าจอ "งานที่ต้องทำ" ไร้ประโยชน์

**กฎธุรกิจที่ M8 (Surveys) บังคับไว้**
- **Q1 ถูกบังคับด้วยโครงสร้าง ไม่ใช่แค่ข้อตกลง** — โมดูลนี้ **ไม่มี endpoint ที่ติด
  `@Public()` เลยแม้แต่เส้นเดียว** ทุกเส้นอยู่หลัง JwtAuthGuard เหมือนโมดูลอื่น
  ระบบทำฟอร์มคำถาม → ส่งให้ลูกค้ารีวิวนอกระบบ → พนักงานคีย์คำตอบกลับเข้ามา
  ลูกค้าไม่มีบัญชีและไม่ได้เข้าระบบเลย (BR-01) มีเทสต์ e2e ยิงทุกเส้นแบบไม่มี token
  แล้วต้องได้ 401 ครบ
- คอลัมน์ `survey_assignments.access_token` / `token_expires_at` **มีอยู่แต่ไม่ถูกใช้**
  ปล่อยเป็น null เสมอ ถ้าวันหนึ่งผู้บริหารอยากได้ลิงก์ให้ลูกค้ากรอกเอง ให้เพิ่ม
  controller ใหม่ที่ติด `@Public()` — เป็นการ *เพิ่ม* ไม่ใช่รื้อของเดิม
  มีเทสต์ปักหมุดว่าไม่มีการออก token โดยไม่ได้ตั้งใจ
- **`surveys.status` แทน `is_active` เดิม** (migration `20260910000001`) เพราะ boolean
  แยก "ยังไม่เริ่มร่าง" กับ "จบแล้ว" ไม่ออก ทั้งที่เป็นคนละเรื่องกันในเชิงธุรกิจ
  **ลบ `is_active` ทิ้งไปเลย ไม่เก็บคู่กัน** เพราะจะกลายเป็นสองแหล่งความจริงของคำถามเดียวกัน
- **แก้คำถามได้เฉพาะตอน DRAFT** (409 ถ้าไม่ใช่) เพราะ `survey_answers.question_id`
  ชี้ไปที่คำถาม ถ้าแทนที่คำถามหลังเริ่มเก็บคำตอบแล้ว คำตอบเก่าจะกลายเป็นคำตอบของ
  คำถามที่ไม่เคยถูกถาม แล้วรายงานสรุปอ่านไม่ได้ทั้งชุด — ส่วนชื่อ คำอธิบาย
  และช่วงวันที่ แก้ได้ตลอดเพราะไม่กระทบความหมายของคำตอบ
- **ย้อนกลับเป็น DRAFT ได้เฉพาะที่ยังไม่มีคำตอบเลย** ด้วยเหตุผลเดียวกัน — DRAFT แก้คำถามได้
- **DRAFT → ACTIVE ต้องมีคำถามอย่างน้อย 1 ข้อ** ไม่งั้นจะส่งฟอร์มเปล่าให้ลูกค้า
- **หน้าจอต้องอ่าน `isCurrentlyUsable` ไม่ใช่ `status`** — ต้อง ACTIVE **และ** อยู่ในช่วง
  `valid_from`..`valid_to` เหตุผลเดียวกับประกัน (Phase 6) สัญญา MA (Phase 8)
  และงานติดตาม (M7) ยังไม่มี scheduler ปิดให้อัตโนมัติจนกว่าจะถึง Phase 11
- **การ "ส่งแบบประเมิน" คือการบันทึกว่าส่งไปแล้ว ระบบไม่ได้ส่งอะไรออกไปจริง** (BR-11)
  แถว `survey_assignments` คือหลักฐานว่าส่งให้ใคร เมื่อไหร่ และเป็นที่ผูกคำตอบกลับมา
  สถานะเริ่มที่ SENT เลยไม่ใช่ PENDING เพราะการกดปุ่มแปลว่าส่งไปแล้ว
- **1 การส่ง ตอบได้ครั้งเดียว** (`survey_responses.assignment_id` เป็น UNIQUE)
  ดักเองก่อนเพื่อให้ได้ 409 พร้อมข้อความไทย ไม่ใช่ error ดิบของ MySQL
  ลูกค้าตอบใหม่ = บันทึกการส่งครั้งใหม่
- **คำตอบถูกตรวจให้ตรงชนิดของคำถามที่ `validateAnswers()`** — RATING ต้องเป็นตัวเลข
  ในช่วงที่กำหนด, CHOICE/MULTI_CHOICE ต้องเป็นค่าที่มีในตัวเลือกจริง, TEXT ต้องมีข้อความ,
  ตอบซ้ำข้อเดิมไม่ได้, คำถามที่ `is_required` ต้องมีคำตอบ
  **นี่คือจุดเดียวที่กันข้อมูลขยะไม่ให้เข้ารายงาน** ถ้าปล่อยผ่าน รายงานจะคำนวณไม่ได้
  และไม่มีใครรู้จนกว่าจะเปิดดู
- **`overall_score` ระบบเฉลี่ยจากคำถาม RATING ที่ตอบมาจริง ไม่รับจาก client**
  ไม่มี RATING เลยได้ `null` **ไม่ใช่ 0** เพราะ 0 แปลว่า "ให้คะแนนศูนย์"
  ซึ่งคนละความหมายกับ "ไม่มีคะแนนให้คิด" — เก็บเป็น string ตลอดสายเหมือนราคาใน Phase 8
- **สรุปผลคำนวณที่ backend ไม่ให้ frontend นับเอง** เพราะสูตรต้องเหมือนกันทุกที่ที่แสดง
  ถ้าแต่ละหน้าจอนับเอง วันหนึ่งตัวเลขจะไม่ตรงกันแล้วไม่มีใครรู้ว่าอันไหนถูก
  ตัวเลือกที่ยังไม่มีใครเลือกถูกคืนมาพร้อมเลข 0 ด้วย ไม่งั้นกราฟจะดูเหมือนไม่เคยมี
  ตัวเลือกนั้นอยู่ในแบบประเมินเลย
- **M8-06 สรุปคะแนนแยกตามลูกค้าและตามเดือน = `GET /api/surveys/:id/score-breakdown`**
  (เพิ่ม 10 ก.ย.) **ผูกกับแบบประเมินฉบับเดียวโดยเจตนา** เพราะแต่ละฉบับตั้งช่วงคะแนนเองได้
  (1–5 หรือ 1–10) เฉลี่ยข้ามฉบับแล้วตัวเลขไม่มีความหมาย — ห้ามเปลี่ยนเป็นเส้นรวมทุกฉบับ
  โดยไม่มีกติกาแปลงสเกลที่ผู้บริหารยืนยัน
  - ค่าเฉลี่ยมาจาก `overall_score` ของแต่ละคำตอบ **คำตอบที่ไม่มีคะแนนรวมไม่ถูกนับเป็น 0**
    คืน `responseCount` กับ `scoredCount` คู่กันเสมอ (หลักเดียวกับค่าว่างใน M10)
  - กรองด้วย `submitted_at` (วันที่ลูกค้าตอบ) ไม่ใช่ `created_at` เพราะพนักงานคีย์ย้อนหลังได้
    `dateTo` รวมทั้งวัน และจัดกลุ่มเดือนตามเขตเวลาเครื่องด้วยหลักเดียวกับ `toDateOnly()`
  - เดือนที่ไม่มีคำตอบคืนมาด้วยพร้อม 0 และ `averageScore: null` ช่วงกว้างสุด 120 เดือน
  - **ยังไม่มี M8-07 (ลูกค้าคะแนนต่ำต่อเนื่อง)** ต้องรอผู้บริหารกำหนดเกณฑ์ "ต่ำ" และ "ต่อเนื่อง" ก่อน
- **ลบแบบประเมินได้เฉพาะฉบับที่ยังไม่เคยส่งให้ลูกค้า** ฉบับที่ส่งไปแล้วให้เปลี่ยนเป็น CLOSED
- ลำดับคำถามมาจากตำแหน่งในอาเรย์ ไม่รับจาก client (กติกาเดียวกับรายการย่อยของแผน MA)

**กฎธุรกิจที่ M10 (Reports) บังคับไว้ — เรื่องความหมายของตัวเลข ไม่ใช่เรื่องสูตร**
- **ทุกตัวเลขเงินในโมดูลนี้คือ "มูลค่าตามสัญญา" ไม่ใช่ "เงินที่ได้รับจริง"**
  ระบบนี้ไม่ใช่ระบบบัญชีและไม่มีระบบรับชำระเงิน (SC-3, OS-03, OS-06 — บริษัทมี
  โปรแกรมบัญชีแยกอยู่แล้ว) ที่มาของตัวเลขมีแค่ `projects.contract_value`,
  `ma_contracts.price` และ `ma_addons.price` ระบบไม่รู้เลยว่าเก็บเงินได้แล้วหรือยัง
  **ห้ามใช้คำว่า "รายได้" / "revenue" / "เงินที่ได้รับ" ที่ไหนทั้งสิ้น** และ
  **ห้ามเพิ่มตาราง/คอลัมน์/endpoint เกี่ยวกับการรับเงิน ใบเสร็จ หรือ payment**
  ทุก response แนบ `disclaimer` กลับไปให้หน้าจอแสดงกำกับตัวเลข — มีเทสต์ทั้ง unit
  และ e2e ไล่หาคำต้องห้ามในผลลัพธ์ ถ้าวันหนึ่งมีคนเติมเข้ามาจะแดงทันที
- **รายการที่สถานะ CANCELLED ไม่ถูกนับในมูลค่าหลัก** แต่ยกมาแสดงแยกที่
  `excludedCancelledValue` / `excludedCancelledCount` เสมอ เพื่อให้ตรวจย้อนหลังได้ว่า
  ตัดอะไรออกไปเท่าไหร่ — ตัดเฉพาะ CANCELLED เท่านั้น **RENEWED ยังถูกนับ**
  เพราะสัญญาที่ถูกต่อไปแล้วเคยมีมูลค่าจริงในช่วงที่มันมีผล
- **`ma_addons` ไม่มีคอลัมน์ status** ของเสริมจึงถูกตัดออก **ตามสถานะของสัญญาแม่**
  (addon มี `contract_id` ชี้ไปหาสัญญาเสมอ อยู่เองไม่ได้) — ยืนยันกติกานี้กับเจ้าของ
  โปรเจกต์แล้ว 10 ก.ย. ไม่ใช่การเดา
- **ค่าว่างของ `ticket_resolutions.hours_spent` และ `tickets.extra_charge`
  ห้ามนับเป็น 0 เด็ดขาด** ค่าว่างแปลว่า "ยังไม่ได้กรอก" ไม่ใช่ "ใช้เวลาศูนย์ชั่วโมง"
  หรือ "ไม่คิดเงิน" (ไม่คิดเงินจริงต้องเลือก `billing_type = FREE` ตาม BR-08)
  ถ้านับเป็น 0 ตัวเลขจะต่ำกว่าความจริงโดยไม่มีใครรู้ — ต้องกันออกจากยอดรวมแล้วคืน
  `{ total, withData, withoutData, completeness }` กลับไปคู่กันเสมอ
  หน้าจอต้องแสดงความครบถ้วนควบคู่ตัวเลข ไม่ใช่โชว์ยอดลอย ๆ ที่ดูน่าเชื่อถือ
- **"ยังคุ้มครองอยู่ไหม" ต้องเทียบช่วงวันซ้ำ ไม่เชื่อ `status` อย่างเดียว**
  ยังไม่มี scheduler ปรับเป็น EXPIRED ให้ (มาตอน M11) สัญญาที่หมดอายุแล้วจึงค้างเป็น
  ACTIVE อยู่ในฐาน ถ้า M10-04 นับจาก `status = 'ACTIVE'` ตรง ๆ ยอดคาดการณ์จะเกินจริง
  กติกาเดียวกับ `isCurrentlyActive` ของ Phase 6 และ Phase 8
- **สัญญา MA ที่ช่วงเวลาซ้อนทับกัน — ตรวจจับและรายงานเท่านั้น (Q4)**
  `GET /api/reports/ma-contract-overlaps` คืนคู่ที่ซ้อน พร้อมช่วงวันของแต่ละฉบับ
  **ไม่แก้ ไม่ลบ ไม่รวม และไม่เลือกฉบับใดแทน** เพราะยังไม่มีข้อสรุปจากผู้บริหาร
  ยอดรวมรายลูกค้าและ `lifetimeValue` แนบ `overlappingContractCount` ไปด้วย
  ให้คนอ่านรู้ว่ายอดนั้นอาจนับซ้ำ — สัญญาที่ CANCELLED และ RENEWED ไม่ถูกนับว่าซ้อน
  เพราะไม่มีผลกับยอดรวมตั้งแต่แรก
- **โมดูลนี้อ่านอย่างเดียว** ไม่มี POST/PATCH/DELETE แม้แต่เส้นเดียว และไม่ inject
  service ของโมดูลอื่น ใช้ model ตรง ๆ เพราะเป็นการรวมข้อมูลข้ามโมดูล
- **M10-01 กับ M10-03 ใช้ endpoint เดียวกัน** ต่างกันแค่ `?limit=` เพราะเป็นข้อมูล
  ชุดเดียวกัน — จัดอันดับคือการเอาเฉพาะหัวตาราง ไม่ต้องมีสองเส้นที่คืนของเหมือนกัน
  `grandTotalContractValue` ยังเป็นยอดของทุกราย ไม่ใช่เฉพาะที่ตัดมาแสดง
- **กรองช่วงเวลาด้วยวันที่เริ่มของรายการ ไม่ใช่ `created_at`** เพราะข้อมูลย้อนหลัง
  ถูกคีย์เข้ามาทีหลัง (บริษัทเก็บเป็นกระดาษมา 4 ปี) ถ้ากรองด้วยวันที่บันทึก
  ตัวเลขจะกองอยู่ที่วันคีย์ข้อมูล ไม่ใช่วันที่เกิดจริง

**ฟิลด์ที่ frontend ซ่อนโดยตกลงกันแล้ว (10 ก.ย.)**
ระบบภายในทีม 2–20 คน เน้นเข้าใจง่าย กรอกเฉพาะที่จำเป็น ใช้ id ของระบบอ้างอิงแทนรหัสที่คนตั้งเอง
ฟิลด์ต่อไปนี้หน้าจอไม่แสดง แต่ฐานข้อมูลยังเก็บได้และ API ยังรับ-คืนตามเดิม
**ห้ามเปลี่ยนเป็นบังคับกรอก และห้ามตัดออกจาก API response** — ถ้าวันหนึ่งอยากใช้ แค่เปิดช่องที่หน้าจอ
- ลูกค้า: `code`, `business_type`, `province`, `postal_code`, `website`, `source`
  (`tax_id` กับ `address` **พับไว้ ไม่ได้ซ่อน** เพราะหน้าพิมพ์สัญญา MA ใช้)
- พนักงาน: `employee_code`, `avatar_url`, `position`, `line_user_id`
  (`line_user_id` ต้องใช้ใน Phase 11 — ได้มาจากการผูกบัญชี LINE OA ไม่ได้ให้คนพิมพ์เอง)
- โครงการ: `code` (`function_count` พับไว้ รอพี่เลี้ยงบอกว่า "1 ฟังก์ชัน" นับอย่างไร —
  ในประชุมพูดแค่หลักการว่าฟังก์ชันเยอะค่า MA ก็เยอะ ไม่ได้ให้สูตร)
- `tickets.ticket_no`, `deliveries.delivery_no`, `ma_contracts.contract_no`, `ma_plans.code`
- **`ma_plans.code` เปลี่ยนเป็นไม่บังคับแล้ว** (migration `20260910000003`) เพราะเป็นรหัสเดียว
  ที่เคยบังคับกรอก ถ้าไม่เปลี่ยน หน้าสร้างแผน MA จะซ่อนช่องนี้ไม่ได้ ยังห้ามซ้ำเมื่อมีค่า
  (unique index ของ MySQL ยอมให้ NULL ซ้ำได้หลายแถว)

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
