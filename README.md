# 접사 탐정 (Affix Splitter) — 배포 안내

학생이 영어 단어를 입력하면 Claude가 접두사 · 어근 · 접미사로 나눠 주고, 학생이 뜻을 **먼저 추측한 뒤** 정답을 확인하는 웹 앱입니다.

```
학생 브라우저 ── GitHub Pages (docs/)        화면만 제공, 비밀 정보 없음
      │
      └─ 구글 로그인 토큰 ─▶ Cloudflare Worker (worker/)   API 키 보관, 로그인 검증,
                                  │                          하루 20회 제한, 예산 가드
                                  ├─ D1 데이터베이스          단어 캐시 · 난이도(하/중/상) · 사용 로그
                                  └─ Claude API (Haiku 5.5)
```

GitHub Pages는 정적 호스팅이라 서버 코드를 돌릴 수 없습니다. 그래서 API 키는 반드시 Worker 쪽 비밀 변수에만 두고, 화면 코드(`docs/`)에는 넣지 마세요.

## 폴더 구성

| 경로 | 내용 |
|---|---|
| `docs/` | GitHub Pages로 올릴 화면 (`index.html`, `app.js`, `style.css`, `config.js`) |
| `worker/src/index.js` | API 서버 코드 |
| `worker/schema.sql` | D1 테이블 정의 |
| `worker/wrangler.toml` | 설정값 (도메인, 한도, 모델 등) |
| `worker/test/` | 로직 테스트 (모의 DB, 모의 Claude) |

## 1. Google 로그인 설정 (약 10분)

1. [Google Cloud Console](https://console.cloud.google.com) → 프로젝트 만들기 → **API 및 서비스 → OAuth 동의 화면**. 학교가 Google Workspace라면 사용자 유형을 **내부**로 하면 학교 계정만 로그인할 수 있어요.
2. **사용자 인증 정보 → OAuth 클라이언트 ID 만들기 → 웹 애플리케이션.**
3. **승인된 JavaScript 원본**에 GitHub Pages 주소를 넣습니다. 예: `https://내아이디.github.io` (경로 없이, 끝에 `/` 없이)
4. 발급된 **클라이언트 ID**(`...apps.googleusercontent.com`)를 복사해 둡니다.

## 2. Anthropic 콘솔

1. 선불 크레딧 **$10**만 충전하고 **자동 충전(auto-reload)은 끕니다.** 이것이 가장 확실한 예산 상한이에요.
2. API 키를 새로 만들고, 정확한 **Haiku 5.5 모델 ID**를 확인합니다. `wrangler.toml`의 `MODEL` 값이 이 ID와 다르면 고쳐 주세요.

## 3. Cloudflare Worker 배포

Node.js가 설치된 컴퓨터에서 터미널로 진행합니다.

```bash
cd worker
npx wrangler login                          # 브라우저에서 Cloudflare 로그인 (무료 계정)
npx wrangler d1 create affix-db             # 출력된 database_id를 wrangler.toml에 붙여넣기
```

`wrangler.toml`에서 아래 값을 고칩니다.

- `database_id` — 위에서 출력된 값
- `GOOGLE_CLIENT_ID` — 1번에서 복사한 클라이언트 ID
- `ALLOWED_DOMAIN` — 학교 이메일 도메인 (예: `school.ac.kr`)
- `ALLOWED_ORIGIN` — GitHub Pages 주소 (예: `https://내아이디.github.io`)
- `ADMIN_EMAILS` — 교수자 계정 (여러 명이면 쉼표로 구분)

```bash
npx wrangler d1 execute affix-db --remote --file=schema.sql   # 테이블 생성
npx wrangler secret put ANTHROPIC_API_KEY                     # 프롬프트에 API 키 붙여넣기
npx wrangler secret put ID_SALT                               # 아무 긴 임의 문자열 (학생 ID 익명화용)
npx wrangler deploy                                           # 완료되면 https://affix-api.○○○.workers.dev 주소 출력
```

`ID_SALT`는 한 번 정한 뒤 바꾸지 마세요. 바꾸면 학생별 하루 한도와 통계가 초기화돼요.

## 4. GitHub Pages 배포

1. `docs/config.js`를 열어 `GOOGLE_CLIENT_ID`, `API_BASE`(3번에서 나온 Worker 주소), `ALLOWED_DOMAIN`을 채웁니다.
2. 이 폴더를 GitHub 저장소에 올립니다.
3. 저장소 **Settings → Pages → Branch: `main`, 폴더: `/docs`** 로 설정하면 `https://내아이디.github.io/저장소이름/` 에 공개돼요.
4. `ALLOWED_ORIGIN`에는 경로를 뺀 `https://내아이디.github.io` 만 넣으면 됩니다.

## 5. 동작 확인 체크리스트

- 학교 계정으로 로그인되고, 다른 도메인 계정은 거절된다.
- 단어를 조회하면 접사 분해가 나오고, **추측을 적기 전에는 정답이 열리지 않는다.**
- 같은 단어를 다시 조회하면 Claude 호출 없이 바로 나온다. (교수자 화면의 *Claude 호출* 수가 늘지 않으면 정상)
- `incorect` 같은 오타는 not_a_word로 표시되고 `incorrect`가 제안된다.
- 21번째 조회에서 한도 안내가 나온다.
- 교수자 계정에만 **교수자** 탭이 보인다.

## 슬라이드 계획이 구현된 방식

| 발표 자료 | 구현 |
|---|---|
| 예산 하드캡 | Anthropic 선불 크레딧(1차) + Worker의 예산 가드(2차, `BUDGET_USD` 도달 시 새 단어 분석 중단, 이미 저장된 단어는 계속 제공) |
| 결과 재사용 | `words` 테이블 캐시. 한 번 분석한 단어는 Claude에 다시 보내지 않음 |
| 학생당 하루 20회 | `usage_log` 기준 (한국 시간 하루), `DAILY_LIMIT`으로 조정 |
| 짧은 출력 | 단어 1개 입력 검증(영문자만, 40자), `max_tokens` 500 |
| 가벼운 모델 | `MODEL` 변수 |
| 오타/비단어 처리 | 형식이 틀린 입력은 API 호출 없이 거절(횟수 차감 없음), 오타는 프롬프트가 `not_a_word` + 가장 가까운 단어 제안 |
| 추측 먼저 | 조회 응답에는 접사 조각과 접사별 의미만 포함, 단어 뜻·예문은 추측 제출 후 `/api/reveal`에서만 전달 |
| 개인정보 | 이메일은 저장하지 않고 솔트 해시 12자리만 저장, 교수자 화면에는 익명 ID만 표시 |
| 교수자 점검 | 표본 30개 점검(맞음/오류), 오류 표시 단어는 다음 조회 때 재분석 |
| 게임 대비 데이터 | 단어, 접사, 의미, **난이도(하/중/상)** 를 CSV/JSON으로 내보내기 |

## 알아 둘 점

- **예산 가드는 추정치**입니다. 토큰 단가(`INPUT_USD_PER_MTOK`, `OUTPUT_USD_PER_MTOK`)가 바뀌면 `wrangler.toml`을 고쳐 주세요. 실제 상한은 선불 크레딧이에요.
- 한도는 **캐시에서 가져온 조회도 1회로 계산**합니다. 발표 자료의 "학생당 하루 20회"와 같은 기준이에요. 캐시 조회는 세지 않게 바꾸려면 `handleLookup`의 `usedToday` 계산에서 `cached=0` 조건을 추가하면 됩니다.
- 로그인 토큰(Google ID 토큰)은 약 1시간 뒤 만료되어, 만료되면 로그인 화면으로 돌아가요.
- 로그인 검증은 Google `tokeninfo` 엔드포인트를 씁니다. 학생이 수백 명 규모로 늘면 JWKS 서명 검증 방식으로 바꾸는 것을 권장해요.
- 난이도(하/중/상)는 AI가 판정한 값이라, 게임에 쓰기 전에 교수자 점검이나 일부 수동 확인을 거치는 것이 좋아요.
- 로컬 테스트: `cd worker/test && node test.mjs` (Node 22 이상, 모의 DB·모의 Claude 사용, 실제 API 비용 없음)
