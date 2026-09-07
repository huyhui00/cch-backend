# Internal Management System — Backend

ระบบบริหารจัดการลูกค้า โครงการ และบริการหลังการขาย สำหรับบริษัทพัฒนา Software / Hardware / IoT ขนาดเล็ก

> **ใช้งานภายในองค์กรเท่านั้น** ลูกค้าไม่มีบัญชีผู้ใช้และไม่เข้าระบบ (BR-01)
> Repo นี้คือ **Backend เท่านั้น** ส่วน Frontend เป็น Angular แยก repo คนละ origin
> บริบทของโปรเจกต์ กฎธุรกิจ และมาตรฐานทั้งหมดอยู่ใน [CLAUDE.md](CLAUDE.md) — อ่านก่อนเริ่มเขียนโค้ด

---

## Tech Stack

| ส่วน | เทคโนโลยี |
|---|---|
| Framework | NestJS 12 (TypeScript 6) |
| ORM | Sequelize 6 ผ่าน `@nestjs/sequelize` + `sequelize-typescript` |
| Database | MySQL 8 |
| Auth | JWT (Access + Refresh) ผ่าน `Authorization: Bearer` |
| File Storage | Cloudflare R2 (S3-compatible, `@aws-sdk/client-s3`) |
| Scheduler | `@nestjs/schedule` |
| Notification | LINE Messaging API |
| API Docs | Swagger (`@nestjs/swagger`) |
| Validation | `class-validator` + `class-transformer` |

**ห้ามใช้:** Prisma, TypeORM, GraphQL, Server Actions, Next.js

---

## สิ่งที่ต้องมีก่อนติดตั้ง

- **Node.js 20 ขึ้นไป** (พัฒนาและทดสอบบน v24)
- **MySQL 8** ที่รันอยู่และเข้าถึงได้
- npm 10 ขึ้นไป

---

## ติดตั้ง

```bash
# 1. ติดตั้ง dependencies
npm install

# 2. สร้างไฟล์ .env จากตัวอย่าง แล้วแก้ค่าให้ตรงกับเครื่องของคุณ
cp .env.example .env

# 3. สร้าง database เปล่าใน MySQL
mysql -u root -p -e "CREATE DATABASE cch_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

ค่าใน `.env` ที่ **ต้องแก้ก่อนรัน** อย่างน้อยคือ `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE`
และตอนขึ้น production ต้องเปลี่ยน `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` ด้วย

สร้าง secret ใหม่:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

---

## รัน

```bash
npm run start:dev     # โหมดพัฒนา (watch, reload อัตโนมัติ)
npm run start         # รันครั้งเดียว
npm run build         # compile ลง dist/
npm run start:prod    # รันจาก dist/ (ต้อง build ก่อน)
```

เมื่อรันสำเร็จจะเห็น:

```
[cch-backend] running on http://localhost:3000/api
[cch-backend] swagger  on http://localhost:3000/api/docs
[cch-backend] CORS allowed origins: http://localhost:4200
```

> แอปจะ **ไม่ยอม start ถ้าต่อ MySQL ไม่ได้** — จะ retry 3 ครั้งแล้วจบการทำงาน
> พร้อมข้อความ `SequelizeConnectionRefusedError: connect ECONNREFUSED 127.0.0.1:3306`
> เป็นพฤติกรรมที่ตั้งใจ ไม่ให้ระบบขึ้นมาแบบครึ่ง ๆ กลาง ๆ

---

## ตรวจสอบคุณภาพโค้ด (ต้องผ่านก่อน commit)

```bash
npm run lint && npm run build
```

คำสั่งอื่น:

```bash
npm run format        # จัดรูปแบบโค้ดด้วย prettier
npm test              # รัน unit test
```

---

## Database migration

โครงสร้างตารางมาจาก **migration เท่านั้น** — `synchronize` ถูกปิดไว้ ห้ามให้ Sequelize แก้ schema เอง

```bash
npm run db:migrate         # รัน migration ทั้งหมดที่ยังไม่ได้รัน
npm run db:migrate:undo    # ย้อน migration ล่าสุด
npm run db:seed            # รัน seeder ทั้งหมด (super admin, permissions master)
npm run db:seed:undo       # ย้อน seeder ทั้งหมด
```

- migration อยู่ที่ [src/database/migrations/](src/database/migrations/)
- seeder อยู่ที่ [src/database/seeders/](src/database/seeders/)
- ตัวช่วยที่ migration ใช้ร่วมกันอยู่ที่ [src/database/migration-helpers.js](src/database/migration-helpers.js)
  (วางไว้นอกโฟลเดอร์ `migrations/` เพราะ sequelize-cli จะพยายามรันทุกไฟล์ในนั้นเป็น migration)
- config ของ sequelize-cli อยู่ที่ [src/database/config.js](src/database/config.js) ซึ่งอ่าน `.env` ตัวเดียวกับแอป

### ลำดับ migration (6 ไฟล์ ตามกลุ่ม A–F)

ต้องรันตามลำดับนี้เท่านั้น เพราะแต่ละกลุ่มอ้าง foreign key ของกลุ่มก่อนหน้า

| ลำดับ | ไฟล์ | ตาราง |
|---|---|---|
| 1 | `...01-create-group-a-auth-rbac.js` | `users`, `roles`, `permissions`, `user_roles`, `role_permissions`, `audit_logs` |
| 2 | `...02-create-group-b-customer-crm.js` | `customers`, `contacts`, `communication_logs`, `follow_ups` |
| 3 | `...03-create-group-c-project-delivery.js` | `projects`, `tasks`, `deliveries`, `warranties`, `documents` |
| 4 | `...04-create-group-d-ma.js` | `ma_plans`, `ma_plan_items`, `ma_contracts`, `ma_addons`, `ma_usages` |
| 5 | `...05-create-group-e-ticket.js` | `tickets`, `ticket_resolutions`, `attachments` |
| 6 | `...06-create-group-f-survey-notify.js` | `surveys`, `survey_questions`, `survey_assignments`, `survey_responses`, `survey_answers`, `notification_rules`, `notifications` |

**ข้อยกเว้นเรื่องลำดับ:** `ma_usages` (กลุ่ม D) ต้องชี้ไป `tickets` และ `ticket_resolutions` (กลุ่ม E)
ซึ่งยังไม่มีตอนนั้น กลุ่ม D จึงสร้าง `ticket_id` / `resolution_id` เป็นคอลัมน์เปล่าไว้ก่อน
แล้วกลุ่ม E ค่อย `addConstraint` ตอนท้าย ส่วน `down()` ของกลุ่ม E ก็ถอด constraint ก่อนลบตาราง
ทุก `down()` ลบตารางตามลำดับย้อนกลับ rollback ได้จริงทั้ง 6 ไฟล์

### Seeder (3 ไฟล์ รันตามลำดับ)

| ลำดับ | ไฟล์ | สิ่งที่ได้ |
|---|---|---|
| 1 | `...01-seed-permissions.js` | permissions 75 รายการ 19 โมดูล รูปแบบ `module.action` |
| 2 | `...02-seed-super-admin.js` | บัญชี `SUPER_ADMIN` 1 บัญชี hash ด้วย bcrypt |
| 3 | `...03-seed-ma-plans.js` | แผน MA 3 แผน (โควตา 5 / 10 / 20 ครั้งต่อเดือน) พร้อมรายการย่อย 17 รายการ |

seeder ทั้ง 3 ไฟล์ **รันซ้ำได้** — ถ้าข้อมูลมีอยู่แล้วจะข้ามไป ไม่สร้างซ้ำ

> **ก่อนรัน `db:seed` ต้องตั้ง `SUPER_ADMIN_PASSWORD` ใน `.env` ก่อน**
> ไม่มีค่า default ในโค้ดโดยเจตนา และต้องยาวอย่างน้อย 12 ตัวอักษร
> ถ้าไม่ตั้ง seeder จะหยุดพร้อมข้อความบอกเหตุผล ไม่ใช่สร้างบัญชีด้วยรหัสผ่านที่เดาได้

`SUPER_ADMIN` ไม่ต้องผูก Role เพราะ bypass permission check ทั้งหมด seeder จึงไม่แตะ `user_roles` เลย

---

## โครงสร้างโปรเจกต์

```
src/
├── main.ts                       # bootstrap: CORS, ValidationPipe, Swagger, prefix /api
├── app.module.ts                 # root module — เพิ่ม module ทางธุรกิจที่นี่
├── app.controller.ts             # GET /api/health (ชั่วคราว ไว้ตรวจ setup)
├── common/
│   ├── guards/                   # (Phase 2) jwt-auth.guard, permissions.guard
│   ├── decorators/               # (Phase 2) require-permission, current-user
│   ├── interceptors/
│   │   └── transform.interceptor.ts   # ห่อ response เป็น { success, data, message }
│   ├── filters/
│   │   └── http-exception.filter.ts   # แปลง error ทุกชนิดเป็นรูปแบบเดียวกัน ภาษาไทย
│   ├── pipes/
│   │   └── validation.pipe.ts    # ValidationPipe กลาง + ข้อความ error ภาษาไทย
│   └── dto/
│       └── pagination.dto.ts     # page, limit, search, sortBy, sortOrder
├── database/
│   ├── database.module.ts        # Sequelize + MySQL (underscored, timestamps, paranoid)
│   ├── config.js                 # config ของ sequelize-cli
│   ├── migration-helpers.js      # ตัวช่วยที่ migration ใช้ร่วมกัน
│   ├── migrations/               # 6 ไฟล์ ตามกลุ่ม A–F
│   └── seeders/                  # 3 ไฟล์
├── models/                       # sequelize-typescript models 30 ตาราง
│   ├── base.model.ts             # AuditedModel — ฟิลด์มาตรฐานข้อ 6.3 รวมไว้ที่เดียว
│   └── index.ts                  # barrel + ALL_MODELS
└── modules/                      # (Phase 2+) module ทางธุรกิจ
```

### เรื่องที่ต้องรู้เกี่ยวกับ model

- ทุกตารางหลัก `extends AuditedModel` ซึ่งให้ `id` (BIGINT UNSIGNED) และฟิลด์มาตรฐาน
  ทั้ง 6 ตัวมาเลย ไม่ต้องเขียนซ้ำ 30 รอบ
- **`AuditedModel` ไม่ใช่ตาราง** — ห้ามใส่เข้า `forFeature()` หรือ `addModels()`
  ไม่งั้นจะได้ตารางผีชื่อ `audited_models` ใช้ `ALL_MODELS` จาก `models/index.ts` แทน
- `tsconfig.json` ตั้ง `useDefineForClassFields: false` ไว้ **ห้ามเปลี่ยน** —
  ถ้าเป็น `true` (ค่า default ของ target ES2022+) class field ที่ประกาศไว้เฉย ๆ
  จะถูก define ทับ getter/setter ที่ Sequelize ใส่ให้ ทำให้ทุกฟิลด์อ่านค่าได้ `undefined`
- `created_by` / `updated_by` / `deleted_by` เป็น `BIGINT UNSIGNED` เฉย ๆ ไม่ผูก FK ไป `users`
  เพราะจะกลายเป็น ~90 constraints ทั่วทั้ง 30 ตาราง และ `users` ถูก soft delete เท่านั้น
- ตอนประกาศ `@HasMany` ให้ส่งชื่อ **property** (`'parentTaskId'`) ไม่ใช่ชื่อคอลัมน์
  (`'parent_task_id'`) ไม่งั้น Sequelize จะสร้าง attribute ซ้ำขึ้นมาอีกตัว

---

## มาตรฐานที่ตั้งไว้แล้ว

### Response format

ทุก endpoint ตอบรูปแบบเดียวกันเสมอ ผ่าน `TransformInterceptor` + `HttpExceptionFilter` ระดับ global
controller เขียน `return data` ตามปกติ ไม่ต้องห่อเอง

```jsonc
// สำเร็จ
{ "success": true,  "data": { "id": 1 }, "message": null }

// สำเร็จ แบบแบ่งหน้า
{ "success": true,  "data": { "items": [], "total": 0, "page": 1, "limit": 20 }, "message": null }

// ผิดพลาด
{ "success": false, "data": null, "message": "ไม่พบข้อมูลลูกค้า" }
```

อยากแนบข้อความเองให้ return เป็น `{ data, message }`:

```typescript
return { data: user, message: 'สร้างผู้ใช้เรียบร้อย' };
```

### ข้อความ error

ข้อความที่ส่งกลับผู้ใช้เป็น **ภาษาไทย** เสมอ — รวมถึงข้อความที่ Nest สร้างเอง
(`Not Found` → `ไม่พบข้อมูลที่ต้องการ`) และข้อความจาก `ValidationPipe`
error ระดับ 5xx จะถูก log พร้อม stack ไว้ฝั่ง server แต่ส่งออกไปแค่ `เกิดข้อผิดพลาดภายในระบบ`
ไม่รั่วรายละเอียดภายในให้ client

### Validation

`ValidationPipe` เป็น global อยู่แล้ว — `whitelist`, `forbidNonWhitelisted`, `transform`
field ที่ไม่ได้ประกาศใน DTO จะถูกปฏิเสธด้วย 400 ทุก DTO ต้องมี decorator ของ `class-validator`

### Pagination

extend `PaginationDto` แล้วใช้ `dto.offset` / `dto.limit` กับ Sequelize ได้เลย
ประกอบผลลัพธ์ด้วย `toPaginatedResult(rows, count, dto)` เพื่อให้ได้รูปแบบตามมาตรฐาน

```typescript
const { rows, count } = await this.model.findAndCountAll({
  offset: query.offset,
  limit: query.limit,
});
return toPaginatedResult(rows, count, query);
```

> `sortBy` รับชื่อฟิลด์เป็น string — **แต่ละ service ต้อง whitelist ชื่อคอลัมน์ที่ยอมให้เรียงเอง**
> ห้ามส่งค่าจาก client เข้า `order` ตรง ๆ

### ค่า default ของ Sequelize

ตั้งไว้ที่ระดับ connection แล้ว ทุก model ได้ค่านี้อัตโนมัติ:

- `underscored: true` — DB เป็น `snake_case` แต่ TypeScript เป็น `camelCase`
- `timestamps: true` — `created_at`, `updated_at`
- `paranoid: true` — soft delete ผ่าน `deleted_at` (ห้ามลบข้อมูลจริง audit ต้องอ้างย้อนหลังได้)
- charset `utf8mb4` / collation `utf8mb4_unicode_ci`

ส่วน `created_by` / `updated_by` / `deleted_by` ต้องประกาศในแต่ละ model เอง

### CORS

เปิดให้เฉพาะ origin ที่ระบุใน `FRONTEND_URL` เท่านั้น ใส่หลายค่าได้โดยคั่นด้วย comma
ถ้าเว้นว่างไว้ = ไม่อนุญาต cross-origin ใด ๆ เลย

---

## ตรวจว่า setup สำเร็จ

รัน `npm run start:dev` แล้วยิงตามนี้ (ทุกข้อควรได้ผลตามที่ระบุ)

```bash
# 1. health check — ต้องได้ database: "up"
curl http://localhost:3000/api/health
# {"success":true,"data":{"status":"ok","database":"up","timestamp":"..."},"message":null}

# 2. error format ภาษาไทย
curl -i http://localhost:3000/api/ไม่มีเส้นทางนี้
# HTTP/1.1 404
# {"success":false,"data":null,"message":"ไม่พบข้อมูลที่ต้องการ"}

# 3. Swagger เปิดได้
curl -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/docs
# 200

# 4. CORS อนุญาตเฉพาะ FRONTEND_URL
curl -s -D - -o /dev/null -H "Origin: http://localhost:4200"     http://localhost:3000/api/health | grep -i access-control-allow-origin
# access-control-allow-origin: http://localhost:4200
curl -s -D - -o /dev/null -H "Origin: http://evil.example.com"   http://localhost:3000/api/health | grep -i access-control-allow-origin
# (ไม่มี header = ถูกบล็อกถูกต้อง)
```

เปิด Swagger UI ในเบราว์เซอร์ที่ http://localhost:3000/api/docs

และตรวจว่าโค้ดผ่านมาตรฐาน:

```bash
npm run lint && npm run build
```

ถ้าทั้งหมดผ่าน = setup เรียบร้อย พร้อมเริ่ม Phase 1

---

## ลำดับการพัฒนา

ดูตารางเต็มใน [CLAUDE.md](CLAUDE.md) ข้อ 12

| Phase | Module | สถานะ |
|---|---|---|
| 0 | Setup, CORS, Swagger, Response format, Error filter | ✅ |
| 1 | Models + Migrations 30 ตาราง + Seeders | ✅ |
| 2 | Auth + Users + Roles + Permissions + Guards | ⬜ |
| 3 | Audit Log (global hook) | ⬜ |
| 4+ | Customers, Projects, Tickets, MA, ... | ⬜ |

---

## ข้อตัดสินใจเรื่อง schema ที่ควรรู้

จุดที่ CLAUDE.md ข้อ 10 ยังไม่สรุป — schema เลือกทางที่ **ไม่ปิดประตูตัวเอง** ไว้ก่อน

| ประเด็น | สิ่งที่ทำไว้ |
|---|---|
| Q1 ลูกค้ากรอกแบบประเมินยังไง | `survey_assignments` มีทั้ง `access_token` (ลิงก์สาธารณะ) และ `filled_by_user_id` (พนักงานกรอกแทน) เลือกทางไหนก็ได้โดยไม่ต้องรื้อ schema |
| Q2 โควตา MA reset เมื่อไหร่ | `ma_usages` เก็บ `period_year` / `period_month` ไว้แล้ว ส่วนกติกาการตัดรอบเป็น config `MA_QUOTA_RESET_MODE` |
| Q4 MA active หลายฉบับต่อโครงการ | ยังไม่ใส่ unique constraint ถ้าสรุปว่าได้ฉบับเดียวค่อยเพิ่ม migration ใหม่ |
| Q5 task ซ้อนกี่ระดับ | DB ไม่จำกัดความลึก ถ้ามีเพดานให้บังคับที่ service layer |

จุดอื่นที่ตัดสินใจไว้:

- **`ticket_resolutions(ticket_id, round)` เป็น UNIQUE ไม่ใช่ index ธรรมดา** —
  กันสองคนกดบันทึกผลพร้อมกันแล้วได้ `round` ชนกัน
- **`ma_usages.ticket_id` เป็น UNIQUE** แปลว่า *1 ปัญหาหักโควตาได้ครั้งเดียวไม่ว่าจะแก้กี่รอบ*
  ตอนทำ Phase 8 ต้องเขียน service ให้ไม่สร้างแถวซ้ำตอน ticket ถูก REOPENED แล้วแก้รอบที่ 2
- **`attachments.ref_type` เป็น VARCHAR ไม่ใช่ ENUM** เพราะ CLAUDE.md ข้อ 8 ไม่ได้กำหนด enum ชุดนี้ไว้
  ค่าที่ยอมรับอยู่ในค่าคงที่ `ATTACHMENT_REF_TYPES` — service ต้อง validate ด้วยค่าจากตรงนั้นเสมอ
- **junction table ไม่เปิด paranoid** — การถอด role คือการถอดจริง ร่องรอยอยู่ใน `audit_logs` แล้ว
- **`audit_logs` เป็น append-only** ไม่มี `updated_at` / `deleted_at` — audit log ที่แก้หรือลบได้ก็ไม่ใช่ audit log
- **FK ทุกตัวเป็น `ON DELETE RESTRICT`** (ยกเว้น junction ที่เป็น CASCADE และ self-reference ที่เป็น SET NULL)
  เพราะระบบนี้เป็น soft delete ทั้งหมด การลบจริงไม่ควรเกิด ถ้าเกิดก็ควรถูกกันไว้ ไม่ใช่ลบต่อเป็นทอด ๆ
- **กลุ่ม B ไม่อ้างถึงกลุ่ม C–F** เพื่อให้ลำดับ FK สะอาด ถ้าต้องผูก `follow_ups` เข้ากับ project หรือ ticket
  ให้เพิ่มเป็น migration ใหม่หลังกลุ่ม E ไม่ใช่แก้ไฟล์เดิม
