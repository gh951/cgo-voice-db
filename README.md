# 🌍 cgo-voice-db

**CGO-FULI 생태계의 공용 다국어 음성 번역 캐시 DB**

> 이주원 대장님 × C-19 · 2026-04-21
> 특허 10-2026-0060113 연계

---

## 🎯 목적

CGO-FULI와 CGO MESSAGE 앱이 공유하는 **자기 학습형 번역 캐시**입니다.

### 핵심 아이디어 (이주원 대장님 발명)

```
사용자 1이 "안녕하세요" 번역
    ↓ (AI 호출)
결과 저장 → cgo-voice-db
    ↓
사용자 2가 "안녕하세요" 번역
    ↓ (캐시 적중!)
AI 호출 0번 + 즉시 반환 ⚡
    ↓
시간이 지날수록 AI 비용 0에 수렴 💰
```

---

## 🏗️ 구조

```
cgo-voice-db/
├── api/              # Vercel 서버리스 함수
│   ├── get.js        # 번역 조회 (캐시)
│   ├── save.js       # 번역 저장
│   ├── list.js       # 언어별 목록
│   └── stats.js      # 통계
│
├── data/             # 번역 사전 (JSON)
│   ├── phrases/
│   │   ├── en.json   # 영어
│   │   ├── zh.json   # 중국어
│   │   ├── ja.json   # 일본어
│   │   └── ...       # 14개국
│   └── seed.json     # 초기 상용구 500개
│
├── audio/            # 음성 파일 (MP3)
│   ├── en/
│   │   └── {hash}.mp3
│   └── ...
│
└── scripts/          # 관리 도구
    ├── generate-tts.js  # 음성 일괄 생성
    └── import-seed.js   # 초기 데이터 가져오기
```

---

## 🚀 배포

### Vercel 자동 배포

```bash
# 1. Vercel에 연결
vercel

# 2. 환경변수 설정
vercel env add GROQ_API_KEY
vercel env add OPENAI_API_KEY

# 3. 배포
vercel --prod
```

### 도메인 설정

```
https://voice.cgo-fuli.com  (권장)
https://cgo-voice-db.vercel.app  (기본)
```

---

## 📡 API 사용법

### 1. 번역 조회 (`/api/get`)

```javascript
// 캐시에서 찾기
fetch('/api/get?lang=en&text=' + encodeURIComponent('안녕하세요'))
  .then(r => r.json())
  .then(data => {
    if (data.hit) {
      console.log('번역:', data.text);
      console.log('음성:', data.audio);
    } else {
      console.log('캐시 없음, AI 호출 필요');
    }
  });
```

### 2. 새 번역 저장 (`/api/save`)

```javascript
fetch('/api/save', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    lang: 'en',
    original: '안녕하세요',
    translated: 'Hello',
    bcp: 'en-US'
  })
});
```

---

## 🎵 지원 언어 (14개국)

| 코드 | 국가 | 깃발 |
|---|---|---|
| en | English | 🇺🇸 |
| zh | 中文 (简体) | 🇨🇳 |
| ja | 日本語 | 🇯🇵 |
| vi | Tiếng Việt | 🇻🇳 |
| es | Español | 🇪🇸 |
| fr | Français | 🇫🇷 |
| de | Deutsch | 🇩🇪 |
| ar | العربية | 🇸🇦 |
| ru | Русский | 🇷🇺 |
| pt | Português | 🇵🇹 |
| it | Italiano | 🇮🇹 |
| id | Indonesia | 🇮🇩 |
| th | ไทย | 🇹🇭 |
| hi | हिन्दी | 🇮🇳 |

---

## 💰 비용 구조

| 항목 | 비용 |
|---|---|
| GitHub Repository | 무료 |
| Vercel 호스팅 | 무료 (월 100GB) |
| 초기 음성 생성 (OpenAI TTS) | 약 3,000원 (1회) |
| 사용자 기여 캐시 | 자동 증가, 무료 |

---

## 📜 라이선스

© 2026 이주원 · CGO-FULI
특허 10-2026-0060113 보호
