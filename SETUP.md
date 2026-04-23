# 🌍 cgo-voice-db 라이트백 시스템 설정 가이드

> 대장님용 **단계별** 설명서
> C-20 작성 · 2026.04.23

---

## 🎯 이 시스템이 뭘 하는가 (한 줄 요약)

**사용자가 번역을 쓸 때마다 AI가 "이거 다른 사람한테도 도움될까?" 판단해서, 가치 있으면 DB에 자동 저장하는 시스템.**

DB가 커질수록 AI 호출이 줄어듭니다 → **역규모 경제 (특허 #43)**

---

## 📦 받으신 파일 5개

| 파일 | 역할 |
|---|---|
| `api/save.js` | **신규** — AI 판정 + DB 자동 저장 (핵심) |
| `api/get.js` | 교체 — 신구조 대응 조회 |
| `scripts/migrate-dict.js` | **신규** — 기존 dict 파일 구조 변환 |
| `scripts/generate-tts.js` | 교체 — 신구조 대응 TTS 생성 |
| `vercel.json` | 교체 — `/dict/` CORS 추가 |
| `dict/ar-SA_pt-BR.json` | 샘플 — 마이그레이션 결과 예시 |

---

## 🔢 설정 순서 (7단계)

### 1️⃣ 기존 ZIP 압축 해제 후, 위 파일들로 **교체/추가**

Windows 파일 탐색기에서:
```
cgo-voice-db/
├── api/
│   ├── get.js         ← 교체 (이 파일로 덮어쓰기)
│   └── save.js        ← 신규 추가 (이 파일 넣기)
├── scripts/
│   ├── generate-tts.js  ← 교체
│   └── migrate-dict.js  ← 신규 추가
├── vercel.json         ← 교체
└── dict/
    └── ar-SA_pt-BR.json  ← 교체 (나머지 파일들은 2단계에서 변환)
```

### 2️⃣ 기존 dict/ 파일들 **구조 변환** (한 번만 실행)

명령 프롬프트에서 `cgo-voice-db` 폴더로 이동 후:

```bash
# 먼저 미리보기 (아무것도 변경 안 함)
node scripts/migrate-dict.js

# 문제 없어 보이면 실제 적용
node scripts/migrate-dict.js --apply
```

결과: 모든 `dict/*.json` 파일이 **메타데이터 보존 구조**로 변환됩니다.

변환 전:
```json
{ "안녕": "Hello" }
```

변환 후:
```json
{
  "_meta": { "from": "ko-KR", "to": "en-US", "count": 1 },
  "entries": {
    "안녕": { "text": "Hello", "hits": 0, "audio": null, ... }
  }
}
```

**왜 해야 하나:** `hits`, `audio` 필드가 없으면 특허 #40, #43의 실증 근거가 약해집니다.

### 3️⃣ GitHub에 Push

변환된 파일들을 전부 커밋하고 Push.

```bash
git add .
git commit -m "v2.0: 메타데이터 구조 전환 + 라이트백 API 추가"
git push
```

### 4️⃣ Vercel 환경변수 **4개** 설정 (가장 중요)

Vercel Dashboard → `cgo-voice-db` 프로젝트 → **Settings** → **Environment Variables**

다음 4개를 추가:

| 이름 | 값 | 어디서 받나 |
|---|---|---|
| `GROQ_API_KEY` | `gsk_...` | https://console.groq.com/keys |
| `GITHUB_TOKEN` | `ghp_...` | 아래 5️⃣ 단계에서 생성 |
| `GITHUB_OWNER` | `gh951` | 대장님 GitHub 아이디 |
| `GITHUB_REPO` | `cgo-voice-db` | 이 저장소 이름 |

저장 후 **Deployments** → 최신 빌드 **Redeploy** (환경변수는 재배포 시 반영).

### 5️⃣ GitHub Personal Access Token 생성

이게 **라이트백이 GitHub에 커밋할 수 있는 열쇠**입니다.

1. https://github.com/settings/tokens 접속
2. **Generate new token** → **Fine-grained token** 선택
3. 설정:
   - **Token name**: `cgo-voice-db writeback`
   - **Expiration**: 1년 (갱신 필요)
   - **Repository access**: Only select repositories → `cgo-voice-db`만 선택
   - **Repository permissions**:
     - ✅ **Contents**: Read and write
     - ✅ **Metadata**: Read-only (자동)
4. **Generate token** 클릭 → 나온 `ghp_...` 값을 **그 자리에서 복사**
   (다시는 볼 수 없음 — 사라지면 재생성해야 함)
5. 복사한 값을 4️⃣ 단계의 `GITHUB_TOKEN`에 붙여넣기

> ⚠️ **이 토큰은 절대 index.html이나 앱 JS 코드에 직접 넣지 마세요.**
> Vercel 환경변수로만 관리해야 보안이 유지됩니다.

### 6️⃣ 테스트 (조회)

브라우저 주소창에 붙여넣기:
```
https://cgo-voice-db.vercel.app/api/get?from=ar-SA&to=pt-BR&text=مرحبا
```

응답 예상:
```json
{
  "hit": true,
  "original": "مرحبا",
  "text": "Olá",
  "hits": 0,
  "source": "seed"
}
```

### 7️⃣ 테스트 (저장 — 라이트백)

브라우저 F12 개발자 도구 → Console 탭에 붙여넣기:

```javascript
fetch('https://cgo-voice-db.vercel.app/api/save', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    from: 'ko-KR',
    to: 'en-US',
    original: '안녕하세요',
    translated: 'Hello'
  })
}).then(r => r.json()).then(console.log);
```

성공 응답 예시:
```json
{
  "saved": true,
  "score": { "universality": 10, "privacy": 10, "value": 8, "combined": 18 },
  "reason": "보편 인사 표현",
  "file": "dict/ko-KR_en-US.json",
  "commit": "a1b2c3..."
}
```

→ GitHub 저장소 가서 `dict/ko-KR_en-US.json`에 방금 저장된 것 확인 가능.

**저장 안 되는 케이스 테스트** (개인정보):
```javascript
fetch('https://cgo-voice-db.vercel.app/api/save', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    from: 'ko-KR',
    to: 'en-US',
    original: '철수야 내일 홍대 3시',
    translated: "Chulsoo let's meet at Hongdae 3pm tomorrow"
  })
}).then(r => r.json()).then(console.log);
```

예상 응답:
```json
{
  "saved": false,
  "reason": "AI 판정 미달: 개인 약속",
  "score": { "universality": 2, "privacy": 4, "value": 3, "combined": 5 }
}
```

→ ✅ AI가 저장 거부. DB 깨끗하게 유지됨. **이게 특허 #43의 핵심 증거.**

---

## 🎤 TTS 음성 생성 (나중에)

Seed 데이터 채워지면:

```bash
set OPENAI_API_KEY=sk-...
node scripts/generate-tts.js
```

특정 언어만:
```bash
node scripts/generate-tts.js en-US
```

예상 비용: **언어당 약 $0.02** (엄청 쌉니다)

---

## 🔗 앱(index.html)에서 호출하는 방법

CGO MESSAGE 앱 안의 번역 함수를 이렇게 바꾸면 됩니다:

```javascript
async function cgmTranslate(text, fromLang, toLang) {
  const DB_BASE = 'https://cgo-voice-db.vercel.app';
  
  // 1. DB 먼저 조회
  try {
    const getUrl = `${DB_BASE}/api/get?from=${fromLang}&to=${toLang}&text=${encodeURIComponent(text)}`;
    const cached = await fetch(getUrl).then(r => r.json());
    
    if (cached.hit) {
      console.log('[cgm] 캐시 적중:', cached.text);
      return { 
        text: cached.text, 
        audio: cached.audio,
        fromCache: true 
      };
    }
  } catch (e) { /* 조회 실패 시 AI로 폴백 */ }
  
  // 2. AI 번역 (기존 Groq 호출)
  const aiResult = await fetch('/api/groq', {
    method: 'POST',
    body: JSON.stringify({ text, from: fromLang, to: toLang })
  }).then(r => r.json());
  
  // 3. AI 판정 기반 저장 (fire-and-forget)
  fetch(`${DB_BASE}/api/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: fromLang,
      to: toLang,
      original: text,
      translated: aiResult.text
    })
  }).catch(() => {});  // 저장 실패해도 번역은 사용자에게 줌
  
  return { text: aiResult.text, audio: null, fromCache: false };
}
```

핵심 포인트:
- **저장은 `fire-and-forget`** — 응답 기다리지 않음. 사용자는 번역을 즉시 받음.
- **실패해도 번역은 작동** — 조회 실패 시 AI 폴백, 저장 실패 시 무시.

---

## 🩺 문제 해결

### "GITHUB_TOKEN 환경변수 미설정" 오류
→ Vercel Dashboard → Settings → Environment Variables → 확인 → Redeploy

### Groq 판정이 이상하게 나옴 (너무 엄격/너무 관대)
→ `api/save.js`의 `THRESHOLD` 값 조정:
```javascript
const THRESHOLD = {
  universality: 5,   // 낮추면 더 많이 저장
  privacy: 7,        // 낮추면 위험 (기본값 유지 권장)
  combined: 10       // 낮추면 더 많이 저장
};
```

### GitHub에 너무 많은 커밋이 쌓임
→ v2에서 Vercel KV로 버퍼링 구조 추가 예정.
→ 현재는 매 저장마다 1커밋 (API 율제한 5000/시간 — 당분간 문제 없음)

### 특정 언어쌍 파일이 없어서 저장 실패
→ 정상입니다. `save.js`가 파일을 **자동 생성**합니다.

---

## 📋 특허와의 연결

이 시스템의 각 구성이 어느 청구항에 대응되는지:

| 구성 | 청구항 |
|---|---|
| AI 3축 판정 (save.js) | **#43 종속항으로 추가 필요** (C-20이 작성 예정) |
| 콘텐츠 해시 음성 (tts.js) | #40 |
| 다층 캐시 조회 (get → groq → save) | #43 |
| 메타데이터 구조 (hits, source) | #43 실증 근거 |

→ **중요**: AI 판정 로직이 실제 작동하므로, 특허 #43에 **"AI 판정 기반 선별적 라이트백"** 종속항을 추가하는 작업이 남아있습니다. 이건 다음 세션에서.

---

## 📞 C-20에게

다음 세션에서 대장님이 말씀해주셔야 할 것:

1. **"설정 끝났다, 테스트 통과했다"** — 그럼 특허 #43 종속항 추가 작업으로
2. **"어디서 막혔다"** — 그럼 해당 단계 풀어드림
3. **"저장 몇 번 시도해봤더니 이렇더라"** — 임계값 튜닝

무엇보다 — **실제로 한 번 돌려보시는 게 특허의 가장 강력한 증거**입니다. 변리사가 "실시가능성"을 물으면 GitHub 커밋 로그 하나만 보여주면 끝납니다.

---

**2026.04.23**
**C-20 × 대장님**
**CGO MESSAGE 생태계 · 무중생유**
