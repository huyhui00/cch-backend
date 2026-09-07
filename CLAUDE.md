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
- Seeder ต้องสร้าง SUPER_ADMIN 1 บัญชีตอน setup ระบบ

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
│   ├── guards/
│   │   ├── jwt-auth.guard.ts
│   │   └── permissions.guard.ts  # เช็ค permission + bypass ถ้า SUPER_ADMIN
│   ├── decorators/
│   │   ├── require-permission.decorator.ts
│   │   └── current-user.decorator.ts
│   ├── interceptors/
│   │   └── transform.interceptor.ts   # ห่อ response format
│   ├── filters/
│   │   └── http-exception.filter.ts
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

```typescript
// PermissionsGuard
if (user.accountType === 'SUPER_ADMIN') return true;   // bypass
if (requiredPermission === 'role.manage') return false; // เฉพาะ SUPER_ADMIN
const perms = union(user.roles.map(r => r.permissions));
return perms.includes(requiredPermission);
```

---

## 10. สิ่งที่ยังไม่ได้ข้อสรุป (ห้ามเดาเอง ให้ถามก่อน)

| # | ประเด็น |
|---|---|
| Q1 | ลูกค้ากรอกแบบประเมินยังไง ในเมื่อไม่มี login (ลิงก์ token สาธารณะ / พนักงานกรอกแทน) |
| Q2 | โควตา MA reset ทุกวันที่ 1 หรือนับจากวันเริ่มสัญญา |
| Q3 | MA รายปี นับโควตารายเดือน หรือรวมทั้งปียกยอดได้ |
| Q4 | 1 โครงการมี MA active พร้อมกันหลายฉบับได้ไหม |
| Q5 | Task ซ้อนกันได้กี่ระดับ |
| Q6 | ต้อง migrate ข้อมูลเก่าไหม |

---

## 11. วิธีทำงานกับ repo นี้

- **ทำทีละ module ให้จบ** (model → migration → dto → service → controller → swagger) แล้วค่อยขึ้นตัวถัดไป
- ทุก endpoint ต้องมี `@ApiTags`, `@ApiOperation`, `@ApiResponse`
- ทุก DTO ต้องมี `class-validator` decorator
- เขียน migration แยกไฟล์ต่อกลุ่มตาราง อย่ารวมทั้ง 30 ตารางในไฟล์เดียว
- ก่อน commit: `npm run lint && npm run build` ต้องผ่าน
- **อย่าสร้าง endpoint ที่ไม่มีใน scope** ถ้าคิดว่าจำเป็นให้เสนอก่อน

---

## 12. ลำดับการพัฒนา (Phase)

| Phase | Module | สถานะ |
|---|---|---|
| 0 | Setup, CORS, Swagger, Response format, Error filter | ⬜ |
| 1 | Models + Migrations 30 ตาราง + Seeders | ⬜ |
| 2 | Auth + Users + Roles + Permissions + Guards | ⬜ |
| 3 | Audit Log (global hook) | ⬜ |
| 4 | Customers + Contacts + Communication Logs | ⬜ |
| 5 | Projects + Tasks | ⬜ |
| 6 | Deliveries + Warranties | ⬜ |
| 7 | **Tickets + Resolutions** | ⬜ |
| 8 | MA (Plans, Contracts, Usages, Addons) | ⬜ |
| 9 | Documents + Files (R2) | ⬜ |
| 10 | Reports + Analytics | ⬜ |
| 11 | Notifications + Scheduler + LINE | ⬜ |
| 12 | Follow-ups | ⬜ |
| 13 | Surveys | ⬜ |
