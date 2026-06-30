# Local Development Setup / การติดตั้งสำหรับพัฒนาในเครื่อง

How to run the stack locally: **Postgres in Docker** + **backend & frontend under PM2 (via Bun)**.

วิธีรันระบบในเครื่อง: **ฐานข้อมูล Postgres ผ่าน Docker** + **backend และ frontend ผ่าน PM2 (รันด้วย Bun)**

## Prerequisites / สิ่งที่ต้องมีก่อน

- Docker Desktop (running / เปิดอยู่)
- Bun `>= 1.3`
- Node + PM2 — PM2's daemon needs Node; the app itself runs on Bun.
  (PM2 ต้องใช้ Node ในการรัน daemon ส่วนตัวแอปจริงรันด้วย Bun)
  ```sh
  brew install node
  npm install -g pm2
  ```

## 1. Database (Docker) / ฐานข้อมูล

Defined in [`docker-compose.yml`](../docker-compose.yml) — Postgres 18 (matches prod 18.3),
db `ISB`, user/pass `user`/`password`, on `localhost:5432`. Data lives in the named
volume `isb_pgdata`.

กำหนดไว้ใน [`docker-compose.yml`](../docker-compose.yml) — ใช้ Postgres 18 (ตรงกับ prod 18.3),
ฐานข้อมูลชื่อ `ISB`, user/รหัสผ่าน `user`/`password`, ที่ `localhost:5432`
ข้อมูลถูกเก็บถาวรใน volume ชื่อ `isb_pgdata` (ไม่หายตอนปิด container)

> ⚠️ ข้อควรระวัง: Postgres 18 ต้อง mount volume ที่ `/var/lib/postgresql` (ไม่ใช่ `/data`)
> มิฉะนั้น container จะ restart วนไม่หยุด — ในไฟล์ตั้งไว้ถูกต้องแล้ว

```sh
docker compose up -d        # start / เปิด (รันเบื้องหลัง)
docker compose ps           # status / health — ดูสถานะ
docker compose logs -f db   # tail logs — ดู log
docker compose down         # stop (keeps data) — ปิด แต่เก็บข้อมูลไว้
docker compose down -v      # stop AND wipe data — ปิด + ลบข้อมูลทิ้ง
```

### Restore from prod / ดึงข้อมูลจาก prod มาใส่

The local DB was seeded from the Railway prod database. To re-run the restore
(prod is read-only here; `--no-owner --no-privileges`):

ฐานข้อมูล local ถูก restore มาจาก prod (Railway) — ถ้าต้องการ restore ใหม่
(อ่าน prod อย่างเดียว ไม่แก้ไข ปลอดภัย):

```sh
PROD_URL='<Railway DATABASE_PUBLIC_URL>'
LOCAL_URL='postgresql://user:password@host.docker.internal:5432/ISB'
docker run --rm -e PROD="$PROD_URL" -e LOCAL="$LOCAL_URL" postgres:18-alpine \
  sh -c 'pg_dump --no-owner --no-privileges "$PROD" | psql -q "$LOCAL"'
```

The active connection string is in [`.env`](../.env) (`DATABASE_URL`). It points at
the local DB by default; the prod URL is kept commented just below it for switching.

ค่า `DATABASE_URL` ที่ใช้งานอยู่ในไฟล์ [`.env`](../.env) ชี้ไป local เป็นค่าเริ่มต้น
ส่วน URL ของ prod ถูก comment ไว้บรรทัดถัดไปเผื่อสลับกลับ

## 2. Backend + Frontend (PM2 + Bun)

Both run via [`ecosystem.config.cjs`](../ecosystem.config.cjs) under PM2, executed by
Bun (`interpreter: none`; PM2's daemon itself is Node):

ทั้งคู่รันผ่าน [`ecosystem.config.cjs`](../ecosystem.config.cjs) ด้วย PM2 โดยตัวงานจริงรันด้วย
Bun (ใช้ `interpreter: none` ให้ PM2 เรียก bun ตรงๆ ไม่ครอบด้วย Node):

- **isb-backend** — `bun run dev` in `backend-bun/` (= `bun --hot src/index.ts`),
  serves `:3001`. Reads `backend-bun/.env` (cwd-local — note this is a **separate**
  file from the repo-root `.env`; both must point at the same DB).
  (รันที่ `backend-bun/` ให้บริการพอร์ต `:3001` และโหลด `backend-bun/.env` ซึ่งเป็น
  **คนละไฟล์** กับ `.env` ที่ root — ทั้งสองไฟล์ต้องชี้ DB เดียวกัน)
- **isb-frontend** — `bun --bun run dev` in `frontend/` (Vite), serves `:8080`
  (set in `frontend/vite.config.ts`; allowed by `CORS_ORIGINS`).
  (รันที่ `frontend/` ให้บริการพอร์ต `:8080` — ใช้ `--bun` บังคับให้ Vite รันบน runtime
  ของ Bun ไม่ fallback ไป Node)

```sh
pm2 start ecosystem.config.cjs   # start both — เปิดทั้งสอง (รันจาก root ของ repo)
pm2 list                         # status — ดูสถานะ
pm2 logs                         # tail all logs — ดู log ทั้งหมด
pm2 logs isb-backend             # tail one app — ดู log เฉพาะตัว
pm2 restart isb-backend          # restart one — รีสตาร์ทตัวเดียว
pm2 stop all                     # stop all — หยุดทั้งหมด
pm2 delete all                   # remove all from pm2 — เอาออกจาก pm2
pm2 save                         # persist process list — บันทึกรายการให้ขึ้นเองหลัง reboot
```

> Notes / หมายเหตุ:
> - Only one process can hold `:8080` / `:3001`. Bun uses `SO_REUSEPORT`, so a stray
>   manually-started `bun run dev` can silently co-bind the same port alongside the
>   PM2 one — kill the stray first (`lsof -iTCP:<port> -sTCP:LISTEN`).
>   (Bun ใช้ `SO_REUSEPORT` → ถ้ามี `bun run dev` ที่รันมือค้างอยู่ มันจะแย่งพอร์ตเดียวกัน
>   ซ้อนกับตัวของ PM2 ได้เงียบๆ ให้ kill ตัวที่ค้างก่อน)
> - `DATABASE_URL` lives in **two** files: repo-root [`.env`](../.env) and
>   [`backend-bun/.env`](../backend-bun/.env). The backend loads the latter.
>   (`DATABASE_URL` มี **2 ไฟล์** — backend ใช้ `backend-bun/.env` เป็นตัวจริง)

## Startup order / ลำดับการเปิด

Start Docker first, then PM2 — the backend needs the DB ready before it can connect.

เปิด **Docker ก่อน แล้วค่อย PM2** เพราะ backend ต้องรอให้ DB พร้อมก่อนถึงจะเชื่อมต่อได้

```sh
docker compose up -d
pm2 start ecosystem.config.cjs
```

## URLs / ที่อยู่บริการ

| Service / บริการ | URL                          |
|------------------|------------------------------|
| Frontend         | http://localhost:8080        |
| Backend          | http://localhost:3001        |
| API base         | http://localhost:3001/api/v1 |
| Postgres         | localhost:5432 (db `ISB`)    |
