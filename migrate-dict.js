// ══════════════════════════════════════════════════════════════════════
//  cgo-voice-db / scripts / migrate-dict.js
//  
//  dict/*.json 파일들을 플랫 구조 → 메타데이터 구조로 마이그레이션
//
//  변환 전 (플랫):
//    { "안녕": "Hello", "감사": "Thanks" }
//
//  변환 후 (메타):
//    {
//      "_meta": { from, to, version, created, updated, count },
//      "entries": {
//        "안녕": { text: "Hello", hits: 0, audio: null, source: "seed", created: "..." }
//      }
//    }
//
//  실행:
//    node scripts/migrate-dict.js          (드라이런 — 변경 전 미리보기)
//    node scripts/migrate-dict.js --apply  (실제 적용)
//
//  왜 필요한가:
//  - 특허 #43(역규모 캐시)의 hits 필드 보존
//  - 특허 #40(SHA-256 음성 CDN)의 audio 필드 보존
//  - 특허 #38(감정 가치)의 source/judgment 필드 보존
// ══════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DICT_DIR = path.join(__dirname, '..', 'dict');

const APPLY = process.argv.includes('--apply');

function detectStructure(obj) {
  if (!obj || typeof obj !== 'object') return 'invalid';
  if (obj._meta && obj.entries) return 'meta';
  
  // 플랫 판정: 모든 값이 문자열이면 플랫
  const values = Object.values(obj);
  if (values.length === 0) return 'empty';
  if (values.every(v => typeof v === 'string')) return 'flat';
  
  return 'mixed';
}

function parseLangPair(filename) {
  // ko-KR_en-US.json → { from: "ko-KR", to: "en-US" }
  const match = filename.match(/^([a-z]{2,3}-[A-Z]{2})_([a-z]{2,3}-[A-Z]{2})\.json$/);
  if (!match) return null;
  return { from: match[1], to: match[2] };
}

function migrate(oldDb, filename) {
  const pair = parseLangPair(filename);
  if (!pair) {
    throw new Error(`파일명이 {from}_{to}.json 형식이 아님: ${filename}`);
  }

  const now = new Date().toISOString();
  const entries = {};

  for (const [k, v] of Object.entries(oldDb)) {
    if (k.startsWith('_')) continue;
    entries[k] = {
      text: v,
      hits: 0,
      audio: null,
      source: 'seed',
      created: now
    };
  }

  return {
    _meta: {
      from: pair.from,
      to: pair.to,
      version: 2,
      created: now,
      updated: now,
      count: Object.keys(entries).length,
      migrated: true,
      migratedFrom: 'flat-v1'
    },
    entries
  };
}

function main() {
  if (!fs.existsSync(DICT_DIR)) {
    console.error(`❌ dict/ 폴더 없음: ${DICT_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(DICT_DIR).filter(f => f.endsWith('.json'));
  
  console.log(`\n🌍 cgo-voice-db dict/ 마이그레이션`);
  console.log(`   모드: ${APPLY ? '✅ 실제 적용' : '🔍 드라이런 (미리보기)'}`);
  console.log(`   대상: ${files.length}개 파일\n`);

  let flat = 0, meta = 0, empty = 0, mixed = 0, invalid = 0, errors = 0;

  for (const file of files) {
    const filePath = path.join(DICT_DIR, file);
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const db = JSON.parse(raw);
      const structure = detectStructure(db);

      switch (structure) {
        case 'meta':
          meta++;
          console.log(`  ✓ [meta] ${file}`);
          break;

        case 'empty':
          empty++;
          console.log(`  ○ [empty] ${file} (건너뜀)`);
          break;

        case 'flat':
          flat++;
          const migrated = migrate(db, file);
          console.log(`  → [flat→meta] ${file} (${Object.keys(migrated.entries).length}개 엔트리)`);
          if (APPLY) {
            fs.writeFileSync(filePath, JSON.stringify(migrated, null, 2));
          }
          break;

        case 'mixed':
          mixed++;
          console.log(`  ⚠ [mixed] ${file} — 수동 확인 필요`);
          break;

        default:
          invalid++;
          console.log(`  ❌ [invalid] ${file}`);
      }
    } catch (err) {
      errors++;
      console.log(`  ❌ [error] ${file}: ${err.message}`);
    }
  }

  console.log(`\n📊 요약`);
  console.log(`   flat(변환 대상): ${flat}개`);
  console.log(`   meta(이미 신구조): ${meta}개`);
  console.log(`   empty(빈 파일): ${empty}개`);
  console.log(`   mixed(수동 확인): ${mixed}개`);
  console.log(`   invalid(오류): ${invalid}개`);
  console.log(`   error(읽기 실패): ${errors}개`);

  if (!APPLY && flat > 0) {
    console.log(`\n💡 실제 적용하려면:`);
    console.log(`   node scripts/migrate-dict.js --apply`);
  }

  if (APPLY) {
    console.log(`\n✅ 완료`);
  }
}

main();
