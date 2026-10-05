# FaultWitness

เมื่อ "เน็ตเสีย" FaultWitness บอกได้ว่าเสีย**ที่ไหน** Probe สองตัว (A และ B) ทดสอบ Internal Service และ External Site สองแห่งด้วย HTTP, DNS และ TCP แล้ว Collector จะเทียบ Result ของทั้งสองตัวทุก 10 วินาที และอธิบายเป็นภาษาไทยว่าปัญหาอยู่ตรงไหน ทำไมจึงคิดเช่นนั้น อะไรที่ยังไม่รู้ และควรตรวจอะไรต่อ เมื่อหลักฐานไม่ครบ ระบบจะตอบว่า **ข้อมูลยังไม่พอ** แทนการเดา

- Spec: [issue #2](https://github.com/Lnwpoom/cloud_Developer2/issues/2) คำศัพท์: [`GLOSSARY.md`](GLOSSARY.md) การตัดสินใจด้านการออกแบบ: [`docs/adr/`](docs/adr/)
- ความแม่นยำที่วัดได้: [`results/`](results/) (เขียนโดย `lab experiment`)
- Prototype ต้นแบบ: [`prototypes/network-projects/PROTOTYPE-faultwitness.html`](prototypes/network-projects/PROTOTYPE-faultwitness.html)

## สิ่งที่ต้องมี

- Node.js 22.18 ขึ้นไป (รันไฟล์ TypeScript ได้โดยตรง)
- Docker พร้อม Compose v2 สำหรับ Lab

```
npm ci
npm run typecheck && npm run lint && npm test
```

## วิธีเดโม

1. **เปิด Lab** (Probe สองตัว, Collector, Internal Service, Site X, Site Y, resolver และ gateway ทั้งหมดอยู่ในเครื่องนี้ ไม่ต้องใช้ Wi-Fi):
   ```
   npm run lab -- up
   ```
2. **เปิด dashboard** ที่ <http://localhost:8080/> บนจอใหญ่ หน้าจะรีเฟรชเองทุก 2 วินาที ปุ่ม **ตรวจเดี๋ยวนี้** สั่งให้รัน Round ทันที ภายในไม่กี่วินาทีจะขึ้นว่า **ปกติ** และ Probe ทั้งสองตัวรายงานผล
3. **ทำให้เสีย แล้วแก้คืน:**
   ```
   npm run lab -- faults          # Fault ทั้ง 11 แบบ พร้อมคำอธิบายภาษาไทยและ Diagnosis ที่คาดหวัง
   npm run lab -- fault certX     # เช่น ใบรับรองของ Site X หมดอายุ
   npm run lab -- status          # container และ Fault ที่เปิดอยู่ตอนนี้
   npm run lab -- clear           # กลับเป็นปกติ
   ```
   Round แรกหลังเกิด Fault จะแสดง Finding ระดับ **เบื้องต้น** โดยยังไม่แจ้งเตือน Round ที่สองจึงขึ้น **🔔 แจ้งเตือน** ตัวอย่างที่ควรโชว์กรรมการ: `dnsA` (ปัญหาที่ DNS ไม่ใช่เครือข่าย), `certX` (ปัญหาที่เซิร์ฟเวอร์ ไม่ใช่เครือข่าย), `clockA` (นาฬิกาของ Probe ตัวเดียวผิด), `egress` (ทางออกร่วมเสีย โดยไม่โทษ ISP), `blipA` (สะดุดแค่ Round เดียวจะไม่แจ้งเตือน), `cutA` (Probe ที่เงียบไปทำให้ได้ "ข้อมูลไม่พอ" ไม่ใช่การเดา)
4. **วัดความแม่นยำสำหรับสไลด์** (ประมาณ 14 นาทีที่ cadence จริง 10 วินาที):
   ```
   npm run lab -- experiment            # ตารางหลัก (5 Scenario × 5 Round) และตารางขยาย
   npm run lab -- experiment --main     # เฉพาะตารางหลัก
   npm run lab -- experiment --scenario dnsA
   ```
   จะเขียน `results/experiment-<timestamp>.md` (ตาราง) และ `.jsonl` (ทุก Result) กด Ctrl-C เพื่อหยุดได้ และ Lab จะถูกคืนค่าเป็นปกติ ถ้า Docker หรือ Lab ไม่ได้เปิดอยู่ คำสั่งจะหยุดพร้อมบอกสาเหตุ และไม่เขียนไฟล์ผล
5. `npm run lab -- down` ลบทุกอย่างออก

**`slowA` ต้องใช้ netem** Fault "เครื่อง A ช้าแต่ยังใช้ได้" หน่วง packet ของ Probe A ด้วย `tc qdisc … netem` ซึ่งต้องมี kernel module `sch_netem` Docker Desktop และโน้ตบุ๊ก Linux ส่วนใหญ่มี แต่ sandbox บน cloud ที่ใช้วัดผลชุดที่ commit ไว้ไม่มี จึงรายงาน `slowA` ว่า *ไม่ได้รัน* ภายหลังได้วัดแยกบนโน้ตบุ๊กที่ใช้ Docker Desktop: [`results/experiment-2026-10-05T13-32-34.md`](results/experiment-2026-10-05T13-32-34.md)

ดู [`lab/README.md`](lab/README.md) สำหรับ topology ของ Lab และการแก้ปัญหา

## แผนทดสอบจริงก่อนนำเสนอ

ผลการทดลองหลัก (55/55) วัดใน sandbox บน cloud ก่อนนำเสนอควรทดสอบซ้ำบน**โน้ตบุ๊กเครื่องที่จะใช้นำเสนอจริง** ตามขั้นตอนนี้

### 1. เตรียมโค้ด
```bash
git checkout main && git pull
npm ci
npm run typecheck && npm run lint && npm test     # ต้องผ่านทั้งหมด
```

### 2. เปิด Lab และตรวจความพร้อม
```bash
open -a Docker && docker info          # macOS: เปิด Docker Desktop แล้วตรวจว่าไม่มี error
npm run lab -- down                    # ล้างของเก่าให้สะอาดก่อน
npm run lab -- up
npm run lab -- selfcheck               # ต้องขึ้น PASS ครบทุกข้อ
```
เปิด <http://localhost:8080/> แล้วดูว่าภายในไม่กี่วินาทีขึ้น **ปกติ** และ Probe A กับ B รายงานผลทั้งคู่

ถ้าขึ้น `Cannot connect to the Docker daemon` แปลว่า Docker Desktop ยังไม่ได้เปิด ให้เปิดแล้วรอจนขึ้นว่า running หรือตรวจด้วย `docker context ls` ว่า context ที่ใช้อยู่คือ `desktop-linux`

### 3. ซ้อมเดโมทีละ Fault
ทำทีละ Fault: `npm run lab -- fault <ชื่อ>` → ดู dashboard → `npm run lab -- clear` → รอจนกลับเป็น **ปกติ** ก่อนทำ Fault ถัดไป

| Fault | สิ่งที่ต้องเห็นบน dashboard |
|---|---|
| `dnsA` / `dnsB` | DNS ของ A (หรือ B) เสีย ไม่ใช่เครือข่ายเสีย |
| `siteXDown` | ปลายทาง Site X เสีย ส่วนที่อื่นปกติ |
| `routeA` | ปัญหาอยู่ที่เครื่อง A |
| `egress` | ทางออกภายนอกร่วมเสีย และไม่โทษ ISP |
| `certX` | เซิร์ฟเวอร์ตอบ แต่ใบรับรองหมดอายุ เครือข่ายปกติ |
| `clockA` | ปัญหาอยู่ที่เครื่อง A (นาฬิกาผิด) |
| `localDown` | Internal Service เสีย ส่วน External Site ใช้ได้ |
| `slowA` | **ปกติ** แต่มี Observation ว่า A ช้า และไม่แจ้งเตือน |
| `blipA` | ระดับเบื้องต้น 1 Round ไม่แจ้งเตือน แล้วกลับปกติ |
| `cutA` | ข้อมูลยังไม่พอ (ไม่มี Result ล่าสุดจาก A) |

สำหรับ Fault ที่ควรแจ้งเตือน: Round แรกขึ้น **เบื้องต้น** โดยยังไม่แจ้งเตือน Round ที่สองขึ้น **🔔 แจ้งเตือน** ภายในประมาณ 30 วินาที

ควรลองเพิ่ม:
- กดปุ่ม **ตรวจเดี๋ยวนี้** แล้วดูว่ามี Round ใหม่ทันที
- ระหว่างเปิด Fault อยู่ รัน `npm run lab -- status` แล้วดูว่าแสดง Fault ที่เปิดอยู่ถูกต้อง
- เปิดสอง Fault พร้อมกัน (เช่น `dnsA` กับ `siteXDown`) ต้องได้ 2 Finding หรือ "ข้อมูลยังไม่พอ"
- เปิด dashboard บนโปรเจกเตอร์หรือจอใหญ่ ทั้งโหมดสว่างและมืด แล้วดูว่าอ่านออก

### 4. รันการทดลองเต็มชุด (ประมาณ 15 นาที)
```bash
npm run lab -- experiment
```
ห้ามให้เครื่องเข้าโหมดพักระหว่างรัน เกณฑ์ผ่าน:
- ตารางหลัก 25/25 และตารางขยาย 35/35 (รวม 60 Round บนเครื่องที่มี netem)
- ผิด 0 และแจ้งเตือนผิด 0
- เวลาตรวจพบต่ำกว่า 30 วินาทีทุก Fault (ผลใน sandbox อยู่ที่ 20–26 วินาที)

ถ้าผ่าน ให้ commit ไฟล์ `.md` และ `.jsonl` ใหม่ แล้วแก้ [`results/README.md`](results/README.md) ให้ชี้ไปที่ผลชุดนี้ เพื่อใช้ตัวเลขจากเครื่องที่นำเสนอจริงบนสไลด์ ถ้ามี Fault ไหนไม่ผ่าน ให้ตรวจสาเหตุก่อน commit

### 5. ตรวจว่าไม่เขียนผลเมื่อ Lab ไม่พร้อม
ปิด Docker Desktop แล้วรัน `npm run lab -- experiment --scenario normal` ต้องขึ้นว่า "ติดต่อ Docker ไม่ได้ … ไม่ได้เขียนไฟล์ผล" และใน `results/` ต้องไม่มีไฟล์ใหม่

### 6. ก่อนวันงานและวันงาน
- **ก่อนวันงาน:** รัน `npm run lab -- up` ล่วงหน้าหนึ่งครั้ง (ต้องใช้อินเทอร์เน็ตตอน build image) จากนั้นปิด Wi-Fi แล้วรัน `down` / `up` / `selfcheck` อีกรอบ เพื่อยืนยันว่าไม่ต้องพึ่งเน็ตของสถานที่
- **ตั้งค่าเครื่อง:** ปิดโหมดพักเครื่องและพักหน้าจอ เสียบสายชาร์จ ปิดการแจ้งเตือน
- **เตรียมสำรอง:** ภาพหน้าจอ dashboard ใน `results/`, ไฟล์ตารางผล และถ้าทำได้ ให้อัดวิดีโอเดโมไว้เผื่อ Docker มีปัญหาหน้างาน
- **เช้าวันงาน:** เปิด Docker Desktop → `npm run lab -- up` → `npm run lab -- selfcheck` → เปิด dashboard แล้วรอจนขึ้น **ปกติ**
- **ระหว่างเดโม:** จบแต่ละ Fault ให้รัน `npm run lab -- clear` ถ้าสับสนว่าเปิด Fault ไหนอยู่ ให้ใช้ `npm run lab -- status`
- **หลังงาน:** `npm run lab -- down`

### เช็กลิสต์: พร้อมนำเสนอเมื่อ
- [ ] `main` ล่าสุดอยู่บนโน้ตบุ๊ก และ typecheck / lint / test ผ่าน
- [ ] `selfcheck` ขึ้น PASS ครบบนโน้ตบุ๊ก
- [ ] ซ้อมเดโมครบทุก Fault ในตารางข้อ 3 และผลตรงตามตาราง
- [ ] การทดลองเต็มชุดบนโน้ตบุ๊กได้ 60/60 แจ้งเตือนผิด 0 ตรวจพบภายใน 30 วินาที และ commit ผลแล้ว
- [ ] ทดสอบแบบไม่ใช้เน็ตผ่าน และเตรียมสำรอง (ภาพหน้าจอหรือวิดีโอ) ไว้แล้ว

## การรันนอก Lab

ทุกอย่าง (ที่อยู่ของ Probe และ Collector, Target, fixed IP, cadence, Stale limit, timeout) อยู่ใน config JSON ไฟล์เดียว ตัวอย่างคือ [`config/local.json`](config/local.json)

การลองบนเครื่องเดียวด้วย [`config/local.json`](config/local.json): config นี้ต้องมี Internal Service ที่ `127.0.0.1:7200` และใช้เว็บ HTTPS สาธารณะสองแห่ง (`one.one.one.one` ที่ 1.1.1.1 และ `dns.google` ที่ 8.8.8.8) เป็น External Site จึงต้องต่ออินเทอร์เน็ต ให้เปิด Internal Service จำลอง แล้วเปิด Probe ทั้งสองตัวและ Collector โดยแต่ละตัวอยู่ใน terminal ของตัวเอง:

```
node -e "require('node:http').createServer((q, r) => r.end('ok')).listen(7200, '127.0.0.1')"
PROBE_ID=A npm run probe
PROBE_ID=B npm run probe
npm run collector               # dashboard ที่ http://localhost:8080/
```

บนเครื่องจริง ให้ใส่ที่อยู่ของแต่ละ Probe และ Collector ใน config แล้วรัน:

```
PROBE_ID=A npm run probe        # บนเครื่องของ Probe A
PROBE_ID=B npm run probe        # บนเครื่องของ Probe B
npm run collector               # บนเครื่อง Collector; dashboard อยู่ที่ collector.port
```

ใช้ `FAULTWITNESS_CONFIG=<path>` เพื่อเลือก config อื่น API ของ Probe และ Collector ไม่มี authentication ให้ใช้เฉพาะในเครือข่ายที่เชื่อถือได้ (Probe จะปฏิเสธการทดสอบไปยังสิ่งที่ไม่อยู่ใน config ของตัวเอง)
