// ══════════════════════════════════════════════════════════════════════
//  cgo-voice-db / api / save.js
//  
//  AI 판정 기반 선별적 라이트백 엔드포인트
//  (특허 #38 + #43 결합 구성의 실제 구현)
//
//  흐름:
//  1. 클라이언트 → POST /api/save { from, to, original, translated }
//  2. Groq AI에게 3축 판정 요청 (보편성·프라이버시·가치)
//  3. 점수 통과 시 → GitHub API로 dict/{from}_{to}.json 에 커밋
//  4. 점수 미달 시 → 저장하지 않고 이유 반환
//
//  환경변수 (Vercel Dashboard > Settings > Environment Variables):
//    GROQ_API_KEY      — Groq API 키
//    GITHUB_TOKEN      — GitHub Personal Access Token (repo 쓰기 권한)
//    GITHUB_OWNER      — gh951
//    GITHUB_REPO       — cgo-voice-db
//    GITHUB_BRANCH     — main (기본값)
//
//  ⚠️ 중요: 토큰은 절대 클라이언트 JS에 넣지 마세요.
//          반드시 Vercel 환경변수로만 관리하세요.
// ══════════════════════════════════════════════════════════════════════

const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

const GITHUB_API = 'https://api.github.com';

// 저장 임계값 — 이 기준이 특허 #43의 "선별 캐싱" 기준
const THRESHOLD = {
  universality: 5,   // 보편성 5점 이상
  privacy: 7,        // 프라이버시 안전 7점 이상 (엄격)
  combined: 10       // 보편성 + 가치 합이 10점 이상
};

// 지원 언어쌍 (BCP-47)
const SUPPORTED_LANGS = [
  'ko-KR', 'en-US', 'ja-JP', 'zh-CN', 'es-ES', 'fr-FR', 'de-DE',
  'it-IT', 'ru-RU', 'pt-BR', 'th-TH', 'vi-VN', 'ar-SA', 'id-ID'
];

// ── CORS 허용 오리진 ──
const ALLOWED_ORIGINS = [
  'https://www.cgo-message.com',
  'https://www.c-go-fuli.com',
  'https://cgo-message.vercel.app',
  'http://localhost:3000'
];

export default async function handler(req, res) {
  // ── CORS ──
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  try {
    // ── 1. 입력 검증 ──
    const { from, to, original, translated } = req.body || {};
    
    if (!from || !to || !original || !translated) {
      return res.status(400).json({ 
        error: 'from, to, original, translated 모두 필수' 
      });
    }

    if (!SUPPORTED_LANGS.includes(from) || !SUPPORTED_LANGS.includes(to)) {
      return res.status(400).json({ 
        error: '지원하지 않는 언어 (BCP-47 형식 필요)',
        supported: SUPPORTED_LANGS
      });
    }

    if (from === to) {
      return res.status(400).json({ error: 'from과 to가 같을 수 없음' });
    }

    // 길이 제한 (개인정보·기밀은 보통 긴 문장에 숨어있음)
    if (original.length > 300 || translated.length > 500) {
      return res.status(200).json({ 
        saved: false, 
        reason: '문장이 너무 김 (상용구 아님으로 판정)',
        score: null
      });
    }

    // ── 2. AI 3축 판정 (특허 #43 핵심) ──
    const judgment = await judgeWithGroq(original, translated);
    
    if (!judgment) {
      return res.status(502).json({ 
        error: 'AI 판정 실패',
        saved: false 
      });
    }

    const { universality, privacy, value, reason } = judgment;
    const combined = universality + value;

    const shouldSave = 
      universality >= THRESHOLD.universality &&
      privacy >= THRESHOLD.privacy &&
      combined >= THRESHOLD.combined;

    if (!shouldSave) {
      return res.status(200).json({
        saved: false,
        reason: `AI 판정 미달: ${reason}`,
        score: { universality, privacy, value, combined }
      });
    }

    // ── 3. GitHub에 라이트백 ──
    const writeResult = await writeToGitHub(from, to, original, translated, judgment);
    
    return res.status(200).json({
      saved: true,
      score: { universality, privacy, value, combined },
      reason,
      file: `dict/${from}_${to}.json`,
      commit: writeResult.commit || null
    });

  } catch (err) {
    console.error('[save error]', err);
    return res.status(500).json({
      error: '저장 중 오류',
      detail: String(err.message || err).slice(0, 300)
    });
  }
}

// ══════════════════════════════════════════════════════════════════════
//  Groq AI 3축 판정
//
//  프롬프트 설계가 특허 #43 방어의 심장입니다.
//  심사관이 "AI 판정 기준이 뭐냐"고 물으면 이 프롬프트가 답입니다.
// ══════════════════════════════════════════════════════════════════════
async function judgeWithGroq(original, translated) {
  const prompt = `당신은 다국어 번역 캐시 DB의 품질 관리자입니다.
다음 번역 쌍을 공용 캐시에 저장할지 3가지 기준으로 판정하세요.

원문: "${original}"
번역: "${translated}"

[평가 기준]

1. 보편성 (universality, 0-10점)
   다른 사용자도 같은 표현을 쓸 가능성이 높은가?
   - 10점: "안녕하세요", "감사합니다", "얼마예요" 같은 일상·여행 필수 표현
   - 5점: "회의실 예약해주세요" 같은 준보편 업무 문장
   - 0점: 고유명사, 개인 약속, 회사 내부 용어, 일회성 발화

2. 프라이버시 안전성 (privacy, 0-10점)
   개인정보·기밀이 포함되어 있지 않은가? (높을수록 안전)
   - 10점: 이름·숫자·주소·금액 없는 순수 표현
   - 5점: 일반 문장이지만 맥락상 개인적일 수 있음
   - 0점: 실명·전화번호·주소·회사 기밀·금융정보 포함 (저장 금지)

3. 언어·감정 가치 (value, 0-10점)
   다른 사용자에게 학습 가치가 있는 표현인가?
   - 10점: 관용구, 감정표현, 문화적 인사, 문법적 대표 문장
   - 5점: 일반 평서문
   - 0점: 오타·비문·잡음·불완전 문장

[응답 규칙]
- 반드시 아래 JSON 형식으로만 응답 (설명 금지)
- 모든 점수는 정수 0~10

{
  "universality": <0-10>,
  "privacy": <0-10>,
  "value": <0-10>,
  "reason": "<한 줄 판정 이유 (30자 이내)>"
}`;

  try {
    const res = await fetch(GROQ_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,       // 일관성 있는 판정
        max_tokens: 200,
        response_format: { type: 'json_object' }
      })
    });

    if (!res.ok) {
      console.error('[groq]', res.status, await res.text());
      return null;
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;

    const parsed = JSON.parse(content);
    
    // 타입 검증
    const u = parseInt(parsed.universality, 10);
    const p = parseInt(parsed.privacy, 10);
    const v = parseInt(parsed.value, 10);
    
    if (isNaN(u) || isNaN(p) || isNaN(v)) return null;
    if (u < 0 || u > 10 || p < 0 || p > 10 || v < 0 || v > 10) return null;

    return {
      universality: u,
      privacy: p,
      value: v,
      reason: String(parsed.reason || '').slice(0, 50)
    };

  } catch (err) {
    console.error('[groq judge error]', err);
    return null;
  }
}

// ══════════════════════════════════════════════════════════════════════
//  GitHub API를 통한 라이트백
//
//  토큰은 Vercel 환경변수에서만 읽음 (클라이언트 노출 없음)
// ══════════════════════════════════════════════════════════════════════
async function writeToGitHub(from, to, original, translated, judgment) {
  const owner = process.env.GITHUB_OWNER || 'gh951';
  const repo = process.env.GITHUB_REPO || 'cgo-voice-db';
  const branch = process.env.GITHUB_BRANCH || 'main';
  const token = process.env.GITHUB_TOKEN;

  if (!token) {
    throw new Error('GITHUB_TOKEN 환경변수 미설정');
  }

  const filePath = `dict/${from}_${to}.json`;
  const apiBase = `${GITHUB_API}/repos/${owner}/${repo}/contents/${filePath}`;
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };

  // 현재 파일 읽기 (SHA 필요)
  let existing = null;
  let existingSha = null;
  
  const getRes = await fetch(`${apiBase}?ref=${branch}`, { headers });
  
  if (getRes.ok) {
    const meta = await getRes.json();
    existingSha = meta.sha;
    const decoded = Buffer.from(meta.content, 'base64').toString('utf-8');
    try {
      existing = JSON.parse(decoded);
    } catch {
      existing = null;
    }
  } else if (getRes.status !== 404) {
    throw new Error(`GitHub 읽기 실패: ${getRes.status}`);
  }

  // 메타데이터 구조로 정규화
  const db = normalizeDB(existing, from, to);

  // 엔트리 추가/갱신
  const isNew = !db.entries[original];
  
  if (isNew) {
    db.entries[original] = {
      text: translated,
      hits: 1,                  // 첫 저장은 최초 조회에서 기인
      audio: null,              // TTS는 scripts/generate-tts.js에서 별도 생성
      source: 'ai',             // AI 생성임을 표시
      created: new Date().toISOString(),
      judgment: {               // 특허 #43 증거 보존
        u: judgment.universality,
        p: judgment.privacy,
        v: judgment.value
      }
    };
  } else {
    // 이미 있으면 hits만 증가 (race condition 대비)
    db.entries[original].hits = (db.entries[original].hits || 0) + 1;
  }

  db._meta.updated = new Date().toISOString();
  db._meta.count = Object.keys(db.entries).length;

  const newContent = JSON.stringify(db, null, 2);
  const encoded = Buffer.from(newContent, 'utf-8').toString('base64');

  const putRes = await fetch(apiBase, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: isNew
        ? `[ai-save] ${from}→${to}: "${original.slice(0, 30)}"`
        : `[ai-bump] ${from}→${to}: hits++ "${original.slice(0, 30)}"`,
      content: encoded,
      sha: existingSha || undefined,
      branch
    })
  });

  if (!putRes.ok) {
    const errText = await putRes.text();
    throw new Error(`GitHub 쓰기 실패: ${putRes.status} ${errText.slice(0, 200)}`);
  }

  const result = await putRes.json();
  return {
    isNew,
    commit: result.commit?.sha || null
  };
}

// ══════════════════════════════════════════════════════════════════════
//  구버전(플랫) → 신버전(메타) 구조 정규화
//
//  dict/*.json이 아직 플랫 구조({ "원문": "번역" })인 경우
//  메타데이터 보존형 구조로 변환하여 반환.
// ══════════════════════════════════════════════════════════════════════
function normalizeDB(existing, from, to) {
  const now = new Date().toISOString();
  
  // 빈 파일 또는 신규
  if (!existing || typeof existing !== 'object') {
    return {
      _meta: {
        from, to,
        version: 2,
        created: now,
        updated: now,
        count: 0
      },
      entries: {}
    };
  }

  // 이미 신구조
  if (existing._meta && existing.entries) {
    return existing;
  }

  // 플랫 → 메타 변환
  const entries = {};
  for (const [k, v] of Object.entries(existing)) {
    if (k.startsWith('_')) continue;  // 메타 키 스킵
    if (typeof v === 'string') {
      entries[k] = {
        text: v,
        hits: 0,
        audio: null,
        source: 'seed',
        created: now
      };
    } else if (typeof v === 'object' && v.text) {
      entries[k] = v;  // 이미 객체면 유지
    }
  }

  return {
    _meta: {
      from, to,
      version: 2,
      created: now,
      updated: now,
      count: Object.keys(entries).length,
      migrated: true  // 마이그레이션된 파일임을 표시
    },
    entries
  };
}
