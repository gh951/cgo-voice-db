// ══════════════════════════════════════════════════════════════
//  cgo-voice-db / API / STATS
//  전체 통계 (대장님 관리자용)
//
//  사용 예시:
//  GET /api/stats
//
//  응답:
//  {
//    totalLangs: 14,
//    totalEntries: 5432,
//    totalHits: 123456,
//    byLang: { en: 523, zh: 421, ... },
//    topPhrases: [{ original, text, hits, lang }, ...]
//  }
// ══════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data', 'phrases');
const SUPPORTED_LANGS = ['en', 'zh', 'ja', 'vi', 'es', 'fr', 'de', 'ar', 'ru', 'pt', 'it', 'id', 'th', 'hi'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const stats = {
      totalLangs: 0,
      totalEntries: 0,
      totalHits: 0,
      byLang: {},
      topPhrases: []
    };

    const allPhrases = [];

    for (const lang of SUPPORTED_LANGS) {
      const filePath = path.join(DATA_DIR, `${lang}.json`);
      if (!fs.existsSync(filePath)) {
        stats.byLang[lang] = 0;
        continue;
      }

      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const db = JSON.parse(raw);
        const entries = Object.entries(db.entries || {});
        
        stats.totalLangs++;
        stats.byLang[lang] = entries.length;
        stats.totalEntries += entries.length;

        entries.forEach(([original, data]) => {
          const hits = data.hits || 0;
          stats.totalHits += hits;
          allPhrases.push({
            original,
            text: data.text,
            lang,
            hits,
            created: data.created
          });
        });
      } catch (e) {
        console.warn(`[stats] ${lang} 파싱 실패:`, e.message);
      }
    }

    // 상위 20개 인기 번역
    stats.topPhrases = allPhrases
      .sort((a, b) => b.hits - a.hits)
      .slice(0, 20);

    stats.generated = new Date().toISOString();

    return res.status(200).json(stats);

  } catch (err) {
    console.error('[stats error]', err);
    return res.status(500).json({
      error: '통계 조회 오류',
      detail: String(err.message || err).slice(0, 200)
    });
  }
}
