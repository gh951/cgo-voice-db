// ══════════════════════════════════════════════════════════════
//  cgo-voice-db / scripts / generate-tts.js
//  
//  JSON 사전에 있는 모든 번역에 대해 MP3 음성 생성
//  OpenAI TTS API 사용 (1만 자당 약 $0.15)
//
//  실행:
//  OPENAI_API_KEY=sk-... node scripts/generate-tts.js
//  또는
//  OPENAI_API_KEY=sk-... node scripts/generate-tts.js en
//  (특정 언어만)
// ══════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data', 'phrases');
const AUDIO_DIR = path.join(ROOT, 'audio');

const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) {
  console.error('❌ OPENAI_API_KEY 환경변수 필수');
  console.error('   실행: OPENAI_API_KEY=sk-... node scripts/generate-tts.js');
  process.exit(1);
}

// 특정 언어만 처리 (인자로)
const targetLang = process.argv[2];

const SUPPORTED_LANGS = ['en', 'zh', 'ja', 'vi', 'es', 'fr', 'de', 'ar', 'ru', 'pt', 'it', 'id', 'th', 'hi'];

// 언어별 OpenAI TTS voice
const VOICE_MAP = {
  en: 'alloy',   // 모든 언어 alloy가 자연스러움
  zh: 'alloy',
  ja: 'alloy',
  vi: 'alloy',
  es: 'alloy',
  fr: 'alloy',
  de: 'alloy',
  ar: 'alloy',
  ru: 'alloy',
  pt: 'alloy',
  it: 'alloy',
  id: 'alloy',
  th: 'alloy',
  hi: 'alloy'
};

function hashContent(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
}

async function generateTTS(text, lang) {
  const voice = VOICE_MAP[lang] || 'alloy';
  
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'tts-1',      // 저렴 ($0.015/1000자), tts-1-hd는 2배 비쌈
      voice,
      input: text,
      response_format: 'mp3'
    })
  });

  if (!res.ok) {
    throw new Error(`TTS API ${res.status}: ${await res.text()}`);
  }

  return Buffer.from(await res.arrayBuffer());
}

async function processLanguage(lang) {
  const jsonPath = path.join(DATA_DIR, `${lang}.json`);
  if (!fs.existsSync(jsonPath)) {
    console.log(`⚠️  ${lang}.json 없음, 건너뜀`);
    return;
  }

  const db = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  const audioLangDir = path.join(AUDIO_DIR, lang);
  if (!fs.existsSync(audioLangDir)) fs.mkdirSync(audioLangDir, { recursive: true });

  let generated = 0;
  let skipped = 0;
  let failed = 0;

  const entries = Object.entries(db.entries);
  console.log(`\n🎵 [${lang}] 총 ${entries.length}개 처리 시작`);

  for (const [original, data] of entries) {
    // 이미 있으면 건너뜀
    if (data.audio) {
      const existingPath = path.join(audioLangDir, data.audio);
      if (fs.existsSync(existingPath)) {
        skipped++;
        continue;
      }
    }

    try {
      const hash = hashContent(data.text);
      const filename = `${hash}.mp3`;
      const filePath = path.join(audioLangDir, filename);

      if (fs.existsSync(filePath)) {
        // 파일은 있는데 JSON에 기록이 없음 → 기록만 추가
        data.audio = filename;
        skipped++;
        continue;
      }

      console.log(`  🔊 ${data.text.slice(0, 30)}...`);
      const buf = await generateTTS(data.text, lang);
      fs.writeFileSync(filePath, buf);
      data.audio = filename;
      generated++;

      // API 호출 간격 (초당 3회 제한)
      await new Promise(r => setTimeout(r, 400));

    } catch (e) {
      console.error(`  ❌ 실패: ${data.text} — ${e.message}`);
      failed++;
    }
  }

  // JSON 업데이트 (audio 필드 기록)
  db.updated = new Date().toISOString();
  fs.writeFileSync(jsonPath, JSON.stringify(db, null, 2));

  console.log(`✅ [${lang}] 생성 ${generated}개, 건너뜀 ${skipped}개, 실패 ${failed}개`);
}

async function main() {
  const langs = targetLang ? [targetLang] : SUPPORTED_LANGS;
  
  console.log(`🌍 cgo-voice-db TTS 생성 시작`);
  console.log(`   대상 언어: ${langs.join(', ')}`);
  console.log(`   예상 비용: ~$${(langs.length * 10 * 0.015 / 1000).toFixed(4)} (최소)`);

  for (const lang of langs) {
    if (!SUPPORTED_LANGS.includes(lang)) {
      console.warn(`⚠️  지원하지 않는 언어: ${lang}`);
      continue;
    }
    await processLanguage(lang);
  }

  console.log(`\n🎉 전체 완료!`);
}

main().catch(err => {
  console.error('❌ 오류:', err);
  process.exit(1);
});
