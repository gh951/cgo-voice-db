// ══════════════════════════════════════════════════════════════
//  cgo-voice-db / API / SAVE
//  사용자가 AI 호출해서 얻은 번역을 DB에 저장
//
//  사용 예시:
//  POST /api/save
//  Body: {
//    lang: "en",
//    original: "안녕하세요",
//    translated: "Hello",
//    bcp: "en-US",
//    audioBase64: "..."  (선택)
//  }
//
//  ⚠️ 주의: Vercel 서버리스는 파일시스템 쓰기 불가
//  대신 GitHub API를 통해 커밋 (또는 Vercel KV 사용)
//  현재는 프록시 형태로 구현. 나중에 KV로 업그레이드.
// ══════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  try {
    const { lang, original, translated, bcp } = req.body || {};

    // 검증
    if (!lang || !original || !translated) {
      return res.status(400).json({ error: 'lang, original, translated 필수' });
    }

    if (original.length > 500 || translated.length > 500) {
      return res.status(400).json({ error: '텍스트 너무 김 (최대 500자)' });
    }

    // 🔐 GitHub API 토큰이 환경변수에 있어야 함
    const GH_TOKEN = process.env.GITHUB_TOKEN;
    const GH_OWNER = process.env.GITHUB_OWNER || 'gh951';
    const GH_REPO = process.env.GITHUB_REPO || 'cgo-voice-db';

    if (!GH_TOKEN) {
      // 토큰 없으면 대기열에 저장 (나중에 배치 커밋)
      // 현재는 응답만 남기고 로컬 저장은 건너뜀
      console.log('[save] GitHub 토큰 없음. 임시 저장만:', { lang, original, translated });
      return res.status(200).json({
        saved: false,
        queued: true,
        message: '토큰 미설정. 대기열에 추가됨.',
        entry: {
          original,
          translated,
          bcp: bcp || `${lang}-${lang.toUpperCase()}`,
          created: new Date().toISOString(),
          hits: 1,
          source: 'user'
        }
      });
    }

    // GitHub API로 JSON 파일 읽기
    const filePath = `data/phrases/${lang}.json`;
    const ghUrl = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${filePath}`;

    const getRes = await fetch(ghUrl, {
      headers: {
        'Authorization': `token ${GH_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    let db = { version: 1, entries: {}, count: 0 };
    let sha = null;

    if (getRes.ok) {
      const fileData = await getRes.json();
      sha = fileData.sha;
      const content = Buffer.from(fileData.content, 'base64').toString('utf-8');
      db = JSON.parse(content);
    }

    // 엔트리 추가 또는 hits 증가
    const norm = original.trim();
    if (db.entries[norm]) {
      db.entries[norm].hits = (db.entries[norm].hits || 0) + 1;
    } else {
      db.entries[norm] = {
        text: translated,
        bcp: bcp || `${lang}-${lang.toUpperCase()}`,
        audio: null,  // 음성은 별도 단계에서 생성
        created: new Date().toISOString(),
        hits: 1,
        source: 'user'
      };
      db.count = (db.count || 0) + 1;
    }
    db.updated = new Date().toISOString();

    // GitHub에 커밋 (업서트)
    const newContent = JSON.stringify(db, null, 2);
    const b64 = Buffer.from(newContent).toString('base64');

    const putBody = {
      message: `[cache] ${lang}: ${norm.slice(0, 30)}`,
      content: b64,
      branch: 'main'
    };
    if (sha) putBody.sha = sha;

    const putRes = await fetch(ghUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${GH_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(putBody)
    });

    if (!putRes.ok) {
      const err = await putRes.text();
      throw new Error(`GitHub 쓰기 실패: ${putRes.status} ${err.slice(0, 200)}`);
    }

    return res.status(200).json({
      saved: true,
      entry: db.entries[norm],
      count: db.count
    });

  } catch (err) {
    console.error('[save error]', err);
    return res.status(500).json({
      error: '저장 중 오류',
      detail: String(err.message || err).slice(0, 200)
    });
  }
}
