// ══════════════════════════════════════════════════════════════════════
//  cgo-voice-db / api / get.js
//  
//  번역 캐시 조회 (신구조 dict/{from}_{to}.json 대응)
//
//  사용 예시:
//  GET /api/get?from=ko-KR&to=en-US&text=안녕하세요
//
//  응답 (적중):
//  {
//    hit: true,
//    original: "안녕하세요",
//    text: "Hello",
//    audio: "https://.../audio/en-US/abc123.mp3",
//    hits: 1248,
//    source: "ai"
//  }
//
//  응답 (미적중):
//  {
//    hit: false,
//    message: "캐시 미적중. AI 번역 후 /api/save로 저장해주세요."
//  }
// ══════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';

const DICT_DIR = path.join(process.cwd(), 'dict');

const SUPPORTED_LANGS = [
  'ko-KR', 'en-US', 'ja-JP', 'zh-CN', 'es-ES', 'fr-FR', 'de-DE',
  'it-IT', 'ru-RU', 'pt-BR', 'th-TH', 'vi-VN', 'ar-SA', 'id-ID'
];

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'GET only' });
  }

  try {
    const { from, to, text } = req.query;

    if (!from || !to || !text) {
      return res.status(400).json({ 
        error: 'from, to, text 파라미터 필수',
        example: '/api/get?from=ko-KR&to=en-US&text=안녕하세요'
      });
    }

    if (!SUPPORTED_LANGS.includes(from) || !SUPPORTED_LANGS.includes(to)) {
      return res.status(400).json({ 
        error: '지원하지 않는 언어 (BCP-47 형식 필요)',
        supported: SUPPORTED_LANGS
      });
    }

    const filePath = path.join(DICT_DIR, `${from}_${to}.json`);
    
    if (!fs.existsSync(filePath)) {
      return res.status(200).json({
        hit: false,
        message: `${from} → ${to} 언어쌍 DB 없음`
      });
    }

    const raw = fs.readFileSync(filePath, 'utf-8');
    const db = JSON.parse(raw);

    // ── 구/신 구조 동시 지원 ──
    const entries = db.entries || db;  // 신구조는 entries, 구(플랫)는 db 자체
    const normalized = text.trim();

    // 정확 매칭
    let entry = entries[normalized];
    let matchedKey = normalized;

    // 정확 매칭 실패 시 정규화 매칭 (공백·대소문자·문장부호 제거)
    if (!entry) {
      const normKey = normalize(normalized);
      for (const k of Object.keys(entries)) {
        if (k.startsWith('_')) continue;
        if (normalize(k) === normKey) {
          entry = entries[k];
          matchedKey = k;
          break;
        }
      }
    }

    if (entry) {
      // 엔트리가 플랫 구조(문자열)면 객체로 감싸서 반환
      const entryData = typeof entry === 'string' 
        ? { text: entry, hits: 0, audio: null, source: 'seed' }
        : entry;

      // 오디오 URL 생성 (있을 때만)
      const audioUrl = entryData.audio
        ? `https://${req.headers.host}/audio/${to}/${entryData.audio}`
        : null;

      return res.status(200).json({
        hit: true,
        original: matchedKey,
        text: entryData.text,
        audio: audioUrl,
        hits: entryData.hits || 0,
        source: entryData.source || 'seed'
      });
    }

    // 부분 매칭 (유사 문장 힌트)
    const keys = Object.keys(entries).filter(k => !k.startsWith('_'));
    const similar = keys.find(k => 
      k.includes(normalized) || normalized.includes(k)
    );

    if (similar) {
      const simEntry = entries[similar];
      const simText = typeof simEntry === 'string' ? simEntry : simEntry.text;
      return res.status(200).json({
        hit: false,
        similar: { original: similar, text: simText },
        message: '정확 매칭 없음, 유사 문장 있음'
      });
    }

    return res.status(200).json({
      hit: false,
      message: '캐시 미적중. AI 번역 후 /api/save로 저장해주세요.'
    });

  } catch (err) {
    console.error('[get error]', err);
    return res.status(500).json({
      error: '조회 중 오류',
      detail: String(err.message || err).slice(0, 200)
    });
  }
}

// 정규화: 공백·대소문자·문장부호 제거
function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[\s\.,!?;:'"()[\]{}。、！？]/g, '')
    .trim();
}
