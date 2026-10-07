// Rebuild the portable v0 using recorded Results and the production Diagnosis module.
// Run with Node >=22.18: node prototypes/evidence-desk/build.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { diagnose } from '../../src/diagnosis/diagnose.ts';
import { toReport } from '../../src/diagnosis/report.ts';

const here = new URL('./', import.meta.url);
const version = process.argv.includes('--v2') ? 'v2' : 'v0';
const source = '../../results/experiment-2026-10-05T17-07-03.jsonl';
const sourceText = await readFile(new URL(source, here), 'utf8');
const records = sourceText.trim().split('\n').map((line) => JSON.parse(line));
const config = JSON.parse(await readFile(new URL('../../lab/config.json', here), 'utf8'));
const fixtures = {};
for (const scenario of ['dnsA', 'certX', 'normal', 'stale']) {
  const recordedScenario = scenario === 'stale' ? 'normal' : scenario;
  const candidates = records.filter((r) => r.scenario === recordedScenario);
  const observedRounds = [...new Set(candidates.filter((r) => r.phase === 'observe').map((r) => r.round_id))].sort((a, b) => a - b);
  const throughRound = observedRounds[1];
  if (throughRound === undefined) throw new Error(`Missing observed rounds for ${scenario}`);
  const selected = candidates.filter((r) => r.round_id <= throughRound);
  const results = selected.map(({ scenario: _scenario, phase: _phase, ...result }) => result);
  const finishedAt = Math.max(...results.map((r) => r.finished_at));
  const ageOffset = scenario === 'stale' ? config.stale_after_ms + 6000 : 0;
  const now = finishedAt + ageOffset;
  const diagnosis = diagnose(results, now, { staleAfterMs: config.stale_after_ms });
  if (!diagnosis) throw new Error(`No diagnosis for ${scenario}`);
  fixtures[scenario] = {
    report: toReport(diagnosis, now),
    provenance: {
      file: source.replace('../../', ''),
      sha256: createHash('sha256').update(sourceText).digest('hex'),
      recordedScenario,
      throughRound,
      sourceRows: results.length,
      simulatedTime: scenario === 'stale',
      evaluationOffsetMs: ageOffset,
      description: scenario === 'stale'
        ? `จำลองผลเก่า: ใช้ผลตรวจปกติจริง แล้วเลื่อนเวลาประเมินเป็น ${ageOffset / 1000} วินาทีหลังรอบจบ ไม่ใช่เหตุขัดข้องที่บันทึกสด`
        : 'ผลตรวจที่บันทึกจาก Lab จริง · สร้าง Report ด้วยตัววิเคราะห์ของโปรเจกต์ ณ เวลาจบรอบ',
    },
  };
}

let page = await readFile(new URL(version === 'v2' ? 'template-v2.html' : 'template.html', here), 'utf8');
let fontCss = '';
for (const [weight, filename] of [[400, 'IBMPlexSansThai-Regular.ttf'], [600, 'IBMPlexSansThai-SemiBold.ttf']]) {
  const font = await readFile(new URL(`assets/fonts/${filename}`, here));
  fontCss += `@font-face{font-family:"IBM Plex Sans Thai";font-style:normal;font-weight:${weight};font-display:swap;src:url(data:font/ttf;base64,${font.toString('base64')}) format("truetype");}\n`;
}
if (version === 'v2') {
  const font = await readFile(new URL('assets/fonts/BlockCraft.otf', here));
  fontCss += `@font-face{font-family:"Block Craft";font-weight:500;font-style:normal;font-display:swap;src:url(data:font/otf;base64,${font.toString('base64')}) format("opentype");}\n`;
}
const license = await readFile(new URL('assets/fonts/OFL.txt', here), 'utf8');
page = page.replace('/* EMBED_FONTS */', fontCss)
  .replace('<!-- FONT_LICENSE -->', `<!-- Embedded font license\n${license.replaceAll('--', '—')}\n-->`)
  .replace('/* EMBED_FIXTURES */', JSON.stringify(fixtures).replaceAll('<', '\\u003c'));
await writeFile(new URL(`evidence-desk-${version}.html`, here), page);
console.log(`Built evidence-desk-${version}.html (${Math.round(Buffer.byteLength(page) / 1024)} KiB), ${Object.keys(fixtures).length} documented scenarios.`);
