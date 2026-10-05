// Thai labels shown to users, carried over verbatim from the prototype's `<script id="logic">`.

import type { ErrorType, EvidenceLevel, FindingCode, ProbeState, TargetId } from '../shared/types.ts';

export const STATUS: Record<Exclude<FindingCode, 'nodata'>, string> = {
  normal: 'ปกติ',
  probe: 'ปัญหาเฉพาะเครื่องหรือเส้นทางของจุดหนึ่ง',
  dns: 'DNS ผิดปกติ',
  shared: 'ปัญหาการเข้าถึงปลายทางภายนอกร่วมกัน',
  dest: 'ปลายทางหนึ่งผิดปกติ',
  insufficient: 'ข้อมูลยังไม่พอ',
};

export const LEVEL: Record<EvidenceLevel, string> = {
  initial: 'เบื้องต้น',
  repeated: 'พบซ้ำ',
  confirmed: 'ยืนยันจากหลายจุด',
};

/** Target names as shown on screen. */
export const TN: Record<TargetId, string> = {
  'local-service': 'บริการภายใน',
  'site-x': 'เว็บไซต์ X',
  'site-y': 'เว็บไซต์ Y',
};

/** Error-type labels; `http_status` is new in the build (the prototype had no such error). */
export const ERR: Record<ErrorType, string> = {
  timeout: 'หมดเวลา',
  refused: 'ถูกปฏิเสธการเชื่อมต่อ',
  dns_timeout: 'DNS ไม่ตอบ',
  dns_error: 'แปลงชื่อไม่ได้',
  tls_cert: 'ใบรับรองไม่ผ่าน',
  http_status: 'ตอบสถานะผิดปกติ',
};

export const PROBE_STATE: Record<ProbeState, string> = {
  reported: 'ส่งผลรอบล่าสุด',
  silent: 'ไม่ส่งผลรอบล่าสุด',
  lost: 'ขาดการติดต่อ',
};
