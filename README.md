# 하다 (hada2) — 할 일 & 메모 데스크톱 앱

매일 쓰기 좋은 가볍고 예쁜 **할 일(To-do) + 메모** 관리 데스크톱 앱입니다.
Electron 기반이라 Windows · macOS · Linux 어디서나 실행됩니다.

## 주요 기능

- ✅ **할 일 추가/완료/수정/삭제** — 인라인 편집 지원
- 📅 **마감일** — 오늘/지난 마감을 색으로 강조
- 🏷️ **태그** — 쉼표로 여러 태그 지정, 태그별 필터
- 📝 **메모** — 각 할 일에 긴 메모 첨부 (펼침/접힘)
- 🔍 **검색** — 제목·메모 텍스트 검색
- 🔎 **필터** — 전체 / 진행중 / 완료
- ⏰ **마감일 알림** — 오늘/지난 마감 항목을 네이티브 알림으로
- 🌙 **라이트/다크 모드**
- 💾 **로컬 저장** — 데이터는 내 컴퓨터에만 저장 (외부 서버 없음)

## 실행 방법

Node.js(18 이상)가 설치돼 있어야 합니다.

```bash
npm install     # 의존성(electron) 설치
npm start       # 앱 실행
```

## 데이터 저장 위치

할 일 데이터는 OS별 사용자 데이터 폴더의 `data.json`에 저장됩니다.

- **Windows**: `%APPDATA%/hada2/data.json`
- **macOS**: `~/Library/Application Support/hada2/data.json`
- **Linux**: `~/.config/hada2/data.json`

저장은 임시 파일에 쓴 뒤 교체하는 **원자적 방식**이라, 쓰는 도중 앱이 꺼져도
기존 데이터가 손상되지 않습니다.

## 프로젝트 구조

```
package.json      # electron 의존성, start 스크립트
src/
  main.js         # 메인 프로세스: 창 생성, 파일 저장/로드, 알림
  preload.js      # contextBridge 로 안전한 API(window.api) 노출
  index.html      # 화면 마크업
  renderer.js     # UI 로직 (CRUD, 필터, 검색, 알림)
  styles.css      # 스타일 (라이트/다크)
```

## 보안

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
- 렌더러는 preload가 노출한 `load / save / notify` 함수 외 시스템 접근 불가
- CSP(Content-Security-Policy)로 외부 리소스 로드 차단

## 향후 확장 아이디어

반복 일정, 우선순위, 정렬, 데이터 내보내기(JSON/CSV), 시스템 트레이 상주, 단축키
