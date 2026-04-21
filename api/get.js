// ══════════════════════════════════════════════════════════════
//  cgo-voice-db / API / GET
//  번역 캐시 조회
//
//  사용 예시:
//  GET /api/get?lang=en&text=안녕하세요
//
//  응답:
//  {
//    hit: true,
//    text: "Hello",
//    audio: "https://.../audio/en/sha256abc.mp3",
//    bcp: "en-US",
//    hits: 1248
//  }
// ══════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data', 'phrases');

// 지원 언어 목록
const SUPPORTED_LANGS = ['en', 'zh', 'ja', 'vi', 'es', 'fr', 'de', 'ar', 'ru', 'pt', 'it', 'id', 'th', 'hi'];

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'GET only' });
  }

  try {
    const { lang, text } = req.query;

    if (!lang || !text) {
      return res.status(400).json({ error: 'lang과 text 파라미터 필수' });
    }

    if (!SUPPORTED_LANGS.includes(lang)) {
      return res.status(400).json({ 
        error: '지원하지 않는 언어', 
        supported: SUPPORTED_LANGS 
      });
    }

    // 언어별 JSON 파일 로드
    const filePath = path.join(DATA_DIR, `${lang}.json`);
    
    if (!fs.existsSync(filePath)) {
      return res.status(200).json({
        hit: false,
        message: '해당 언어 DB 없음 (아직 번역된 내용 없음)'
      });
    }

    const raw = fs.readFileSync(filePath, 'utf-8');
    const db = JSON.parse(raw);

    // 원문으로 조회 (정확 매칭 + 정규화)
    const normalized = text.trim();
    const entry = db.entries[normalized] || db.entries[normalized.toLowerCase()];

    if (entry) {
      // 캐시 적중! 오디오 URL 생성
      const audioUrl = entry.audio 
        ? `https://${req.headers.host}/audio/${lang}/${entry.audio}`
        : null;

      return res.status(200).json({
        hit: true,
        original: normalized,
        text: entry.text,
        bcp: entry.bcp || `${lang}-${lang.toUpperCase()}`,
        audio: audioUrl,
        hits: entry.hits || 0,
        source: entry.source || 'cache'
      });
    }

    // 부분 매칭 시도 (유사 문장)
    const keys = Object.keys(db.entries);
    const similar = keys.find(k => {
      return k.includes(normalized) || normalized.includes(k);
    });

    if (similar) {
      return res.status(200).json({
        hit: false,
        similar: {
          original: similar,
          text: db.entries[similar].text
        },
        message: '정확한 매칭은 없으나 유사 문장 있음'
      });
    }

    return res.status(200).json({
      hit: false,
      message: '캐시에 없음. AI 호출 후 /api/save로 저장해주세요.'
    });

  } catch (err) {
    console.error('[get error]', err);
    return res.status(500).json({
      error: '조회 중 오류',
      detail: String(err.message || err).slice(0, 200)
    });
  }
}
