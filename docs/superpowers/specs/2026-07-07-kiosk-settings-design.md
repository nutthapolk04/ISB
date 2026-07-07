# ฟีเจอร์หน้าตั้งค่า Kiosk — Design Spec
วันที่: 2026-07-07

## ภาพรวม
เพิ่มหน้าตั้งค่าให้ kiosk เข้าถึงได้ผ่านไอคอนเฟืองเล็กๆ บนหน้า Welcome เข้าได้เฉพาะ staff ที่ใส่ credentials ถูกต้อง ใช้สำหรับตั้งชื่อเครื่อง ซึ่งแสดงบนหน้า Welcome

---

## จุดเข้าถึง

- ไอคอนเฟือง (lucide `Settings`) วางที่ **มุมซ้ายล่าง** ของหน้า Welcome
- opacity ต่ำ (~40%) เพื่อไม่ดึงดูดสายตาผู้ใช้ทั่วไป
- กดแล้ว: `router.push('/settings')`

---

## Route

- Path: `/settings`
- Component: `src/views/SettingsView.vue` (ไฟล์ใหม่)
- ไม่มี auth guard ระดับ router — ตรวจ auth ภายใน component เอง

---

## SettingsView.vue — 2 ขั้นตอน

state ภายใน: `step: Ref<'login' | 'settings'>`

### ขั้นตอนที่ 1: Login

- input 2 ช่อง: `username` และ `password` (type password)
- ปุ่ม Confirm: เทียบกับ `import.meta.env.VITE_KIOSK_USERNAME` และ `VITE_KIOSK_PASSWORD`
  - ถูกต้อง → `step.value = 'settings'`
  - ไม่ถูก → แสดง error inline ลองใหม่ได้ ไม่มี lockout
- ปุ่ม ยกเลิก → `router.push('/')`

### ขั้นตอนที่ 2: Settings

- input ชื่อเครื่อง โหลดค่าปัจจุบันจาก `store.machineName`
- ปุ่ม บันทึก → เรียก `store.setMachineName(value)` → กลับ `/`
- ปุ่ม ยกเลิก → กลับ `/` โดยไม่บันทึก

---

## Store (kioskStore.ts)

เพิ่ม:

```ts
const machineName = ref<string>(localStorage.getItem('kiosk_machine_name') ?? '')

function setMachineName(name: string) {
  machineName.value = name.trim()
  localStorage.setItem('kiosk_machine_name', machineName.value)
}
```

expose: `machineName`, `setMachineName`

---

## WelcomeView.vue

- แสดง `store.machineName` ที่มุมซ้ายล่างเมื่อมีค่า (เช่น "Kiosk 1")
- เพิ่มปุ่ม gear icon มุมซ้ายล่าง navigate ไป `/settings`
- layout: gear icon + ชื่อเครื่องอยู่ด้านซ้ายล่างในแนวนอน

---

## Security

- เทียบ credentials กับ env vars ฝั่ง client — ไม่ call API
- ไม่มี session: ทุกครั้งที่เข้า `/settings` ต้อง login ใหม่
- ไม่มี lockout (settings ไม่ใช่ security ระดับผู้ใช้)
- ชื่อเครื่องเก็บใน `localStorage` — เฉพาะเครื่อง, อยู่รอดหลัง refresh

---

## Data Flow

```
WelcomeView
  └── กด gear icon → /settings

SettingsView (step=login)
  └── username + password ตรงกับ .env → step=settings

SettingsView (step=settings)
  └── บันทึก → kioskStore.setMachineName() → localStorage → /
  └── ยกเลิก → /

WelcomeView
  └── อ่าน store.machineName → แสดงมุมซ้ายล่าง
```

---

## ไฟล์ที่เปลี่ยน

| ไฟล์ | การเปลี่ยนแปลง |
|------|---------------|
| `src/views/SettingsView.vue` | ไฟล์ใหม่ |
| `src/stores/kioskStore.ts` | เพิ่ม `machineName`, `setMachineName` |
| `src/router/index.ts` | เพิ่ม route `/settings` |
| `src/views/WelcomeView.vue` | เพิ่ม gear icon + แสดงชื่อเครื่อง |

---

## นอกขอบเขต

- Lockout / rate limiting
- ซิงค์ settings ไป backend
- ตั้งค่าอื่นนอกจากชื่อเครื่อง
- PIN-based auth
