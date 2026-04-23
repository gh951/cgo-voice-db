// ══════════════════════════════════════════════════════════════════════
//  cgo-voice-db / scripts / generate-tts.js
//  
//  dict/*.json의 번역문에 대해 MP3 음성 일괄 생성 (OpenAI TTS)
//  콘텐츠 해시 기반 중복 제거 — 같은 번역문은 1개 MP3만 존재
//
//  실행:
//    OPENAI_API_KEY=sk-... node scripts/generate-tts.js
//    OPENAI_API_KEY=sk-... node scripts/generate-tts.js en-US
//    (특정 목표 언어만 처리 — 출력 언어 기준)
//
//  특허 #40 (SHA-256 음성 CDN) 구현:
//  - 번역문 텍스트를 SHA-256으로 해시 → 해시값을 파일명으로 사용
//  - audio/{to-lang}/{hash}.mp3 구조
//  - 여러 언어쌍에서 같은 번역문 나오면 파일 1개 공유
//    예: ko→en "Hello", ja→en "Hello" — 둘 다 같은 abc123.mp3 참조
// ══════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DICT_DIR = path.join(ROOT, 'dict');
const AUDIO_DIR = path.join(ROOT, 'audio');

const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) {
  console.error('❌ OPENAI_API_KEY 환경변수 필수');
  console.error('   실행: OPENAI_API_KEY=sk-... node scripts/generate-tts.js');
  process.exit(1);
}

const targetToLang = process.argv[2];  // 선택적: 목표 언어 필터

// BCP-47 → OpenAI TTS voice 매핑
// (OpenAI tts-1은 alloy가 가장 다국어 친화적)
const VOICE = 'alloy';

// SHA-256 앞 16자리를 파일명으로 사용 (충돌 확률 ~0%)
function hashContent(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
}

async function generateTTS(text) {
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'tts-1',           // $0.015/1000자 (tts-1-hd는 2배)
      voice: VOICE,
      input: text,
      response_format: 'mp3'
    })
  });

  if (!res.ok) {
    throw new Error(`TTS API ${res.status}: ${(await res.text()).slice(0, 150)}`);
  }

  return Buffer.from(await res.arrayBuffer());
}

async function processFile(filename) {
  const filePath = path.join(DICT_DIR, filename);
  const raw = fs.readFileSync(filePath, 'utf-8');
  const db = JSON.parse(raw);

  // 신구조만 처리 (구조 마이그레이션 먼저 돌려야 함)
  if (!db._meta || !db.entries) {
    console.log(`  ⚠ ${filename} 플랫 구조 — migrate-dict.js 먼저 실행 필요`);
    return { generated: 0, skipped: 0, failed: 0 };
  }

  const toLang = db._meta.to;

  // 특정 목표 언어 필터
  if (targetToLang && toLang !== targetToLang) {
    return { generated: 0, skipped: 0, failed: 0 };
  }

  const audioLangDir = path.join(AUDIO_DIR, toLang);
  if (!fs.existsSync(audioLangDir)) {
    fs.mkdirSync(audioLangDir, { recursive: true });
  }

  let generated = 0, skipped = 0, failed = 0;
  const entries = Object.entries(db.entries);

  console.log(`\n🎵 ${filename} (→ ${toLang}, ${entries.length}개)`);

  for (const [original, entry] of entries) {
    const text = entry.text;
    if (!text) { skipped++; continue; }

    const hash = hashContent(text);
    const audioFilename = `${hash}.mp3`;
    const audioPath = path.join(audioLangDir, audioFilename);

    // 이미 파일 존재 → JSON에만 기록
    if (fs.existsSync(audioPath)) {
      if (entry.audio !== audioFilename) {
        entry.audio = audioFilename;
      }
      skipped++;
      continue;
    }

    // 생성
    try {
      process.stdout.write(`  🔊 ${text.slice(0, 30)}... `);
      const buf = await generateTTS(text);
      fs.writeFileSync(audioPath, buf);
      entry.audio = audioFilename;
      generated++;
      console.log('✓');

      // Rate limit 방어
      await new Promise(r => setTimeout(r, 400));

    } catch (err) {
      console.log(`✗ ${err.message}`);
      failed++;
    }
  }

  // JSON 업데이트
  if (generated > 0 || skipped > 0) {
    db._meta.updated = new Date().toISOString();
    fs.writeFileSync(filePath, JSON.stringify(db, null, 2));
  }

  return { generated, skipped, failed };
}

async function main() {
  if (!fs.existsSync(DICT_DIR)) {
    console.error(`❌ dict/ 폴더 없음`);
    process.exit(1);
  }

  const files = fs.readdirSync(DICT_DIR).filter(f => f.endsWith('.json'));
  
  console.log(`🌍 cgo-voice-db TTS 생성`);
  console.log(`   대상: ${files.length}개 파일`);
  if (targetToLang) console.log(`   필터: → ${targetToLang} 만`);

  let totalGen = 0, totalSkip = 0, totalFail = 0;

  for (const file of files) {
    try {
      const r = await processFile(file);
      totalGen += r.generated;
      totalSkip += r.skipped;
      totalFail += r.failed;
    } catch (err) {
      console.error(`❌ ${file}: ${err.message}`);
    }
  }

  const estCost = (totalGen * 15 * 0.015 / 1000).toFixed(4);
  console.log(`\n🎉 완료`);
  console.log(`   생성: ${totalGen}개`);
  console.log(`   건너뜀: ${totalSkip}개 (이미 있음)`);
  console.log(`   실패: ${totalFail}개`);
  console.log(`   예상 비용: ~$${estCost}`);
}

main().catch(err => {
  console.error('❌ 치명적 오류:', err);
  process.exit(1);
});
