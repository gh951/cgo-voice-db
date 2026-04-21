// ══════════════════════════════════════════════════════════════
//  cgo-voice-db / API / LIST
//  언어별 전체 번역 목록 (페이징)
//
//  사용 예시:
//  GET /api/list?lang=en&limit=100&offset=0&sort=hits
// ══════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data', 'phrases');

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'GET only' });
  }

  try {
    const { lang = 'en', limit = '100', offset = '0', sort = 'hits' } = req.query;
    const lim = Math.min(parseInt(limit, 10) || 100, 1000);
    const off = Math.max(parseInt(offset, 10) || 0, 0);

    const filePath = path.join(DATA_DIR, `${lang}.json`);

    if (!fs.existsSync(filePath)) {
      return res.status(200).json({
        lang,
        total: 0,
        entries: [],
        message: '해당 언어 DB 없음'
      });
    }

    const raw = fs.readFileSync(filePath, 'utf-8');
    const db = JSON.parse(raw);

    // 배열로 변환
    const arr = Object.entries(db.entries).map(([original, data]) => ({
      original,
      ...data
    }));

    // 정렬
    if (sort === 'hits') {
      arr.sort((a, b) => (b.hits || 0) - (a.hits || 0));
    } else if (sort === 'recent') {
      arr.sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime());
    }

    // 페이징
    const paged = arr.slice(off, off + lim);

    return res.status(200).json({
      lang,
      total: arr.length,
      offset: off,
      limit: lim,
      entries: paged
    });

  } catch (err) {
    console.error('[list error]', err);
    return res.status(500).json({
      error: '목록 조회 오류',
      detail: String(err.message || err).slice(0, 200)
    });
  }
}
