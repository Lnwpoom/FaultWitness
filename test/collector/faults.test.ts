import { describe, expect, it } from 'vitest';
import { createSimLab, observeFaults } from '../support/sim-lab.ts';
import { expectedKeys, type FaultName } from '../support/simulated-probes.ts';

describe('Collector Diagnosis with simulated Probes', () => {
  it('reports normal with no alert when no Fault is active', async () => {
    const lab = createSimLab();
    const [, , report] = await lab.rounds(3);
    expect(report?.overall).toBe('ปกติ');
    expect(report?.keys).toEqual([]);
    expect(report?.alert).toBe(false);
    expect(report?.findings).toEqual([]);
    expect(report?.stale).toBe(false);
    expect(report?.tests_this_round).toBe(6);
    expect(report?.tests_if_full_sweep).toBe(14);
  });

  describe.each<[FaultName, string[]]>([
    ['dnsA', ['dns|A']],
    ['dnsB', ['dns|B']],
    ['routeA', ['probe|A']],
    ['localDown', ['dest|local-service']],
    ['siteXDown', ['dest|site-x']],
    ['certX', ['dest|site-x']],
    ['egress', ['shared']],
    ['clockA', ['probe|A']],
    ['cutA', ['insufficient']],
  ])('Fault %s', (fault, keys) => {
    it(`is diagnosed as ${keys.join(' + ')} with an alert from the second Round`, async () => {
      expect(expectedKeys([fault])).toEqual(keys);
      const { reports } = await observeFaults([fault], 3);
      expect(reports.map((r) => r.keys)).toEqual([keys, keys, keys]);
      expect(reports.map((r) => r.alert)).toEqual([false, true, true]);
    });
  });

  it('diagnoses an expired certificate on Site X as that site answering with a bad certificate', async () => {
    const { reports } = await observeFaults(['certX'], 1);
    const [finding] = reports[0]?.findings ?? [];
    expect(finding?.title).toBe('เว็บไซต์ X ตอบกลับ แต่ใบรับรองไม่ผ่าน');
    expect(finding?.supporting).toContain('TCP ไป เว็บไซต์ X สำเร็จและแปลงชื่อได้ — เซิร์ฟเวอร์ตอบ แต่ใบรับรอง HTTPS ไม่ผ่าน: เน็ตไม่ได้เสีย');
  });

  it('diagnoses a skewed clock on A as A failing HTTPS while B passes', async () => {
    const { reports } = await observeFaults(['clockA'], 1);
    const [finding] = reports[0]?.findings ?? [];
    expect(finding?.title).toBe('A ผ่าน HTTPS ไม่ได้ ขณะที่ B ผ่านได้');
    expect(finding?.next_steps).toContain('ตรวจนาฬิกาของเครื่อง A และโปรแกรมที่ดักใบรับรอง (proxy/แอนตี้ไวรัส)');
  });

  it('reports a slow but working Probe A as an Observation, not a Finding', async () => {
    const { reports } = await observeFaults(['slowA'], 3);
    expect(expectedKeys(['slowA'])).toEqual([]);
    for (const r of reports) {
      expect(r.keys).toEqual([]);
      expect(r.alert).toBe(false);
      expect(r.overall).toBe('ปกติ');
      expect(r.observations).toEqual([
        {
          probe_id: 'A',
          peer: 'B',
          ratio: 8,
          text: 'A ตอบช้ากว่า B ราว 8 เท่า รวมถึงบริการภายใน แต่ทุกการทดสอบยังผ่าน — สาเหตุอาจอยู่ที่ตัวเครื่อง สาย/สัญญาณ หรือซอฟต์แวร์บน A: ยังไม่สรุปว่า Wi-Fi เสีย',
          next_steps: ['ดู CPU/โปรแกรมเบื้องหลังบน A', 'สลับ A ไปใช้สาย LAN หรือย้ายตำแหน่ง แล้วเทียบเวลาอีกครั้ง'],
        },
      ]);
    }
  });

  it('keeps a one-Round blip on A at the initial level without an alert, then returns to normal', async () => {
    const { reports } = await observeFaults(['blipA'], 3);
    const [blip, after, later] = reports;
    expect(blip?.keys).toEqual(['probe|A']);
    expect(blip?.findings.map((f) => f.evidence_level)).toEqual(['initial']);
    expect(blip?.alert).toBe(false);
    expect(blip?.findings[0]?.missing).toContain('ยังไม่พบซ้ำ — อาจเป็นการสะดุดชั่วคราว รอรอบถัดไปก่อนแจ้งเตือน');
    for (const r of [after, later]) {
      expect(r?.keys).toEqual([]);
      expect(r?.alert).toBe(false);
    }
  });
});
