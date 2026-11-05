# Herdr Desktop App Mods 개발 자료

## 1. herdr란?

Herdr은 macOS/Windows/Linux용 코드 에이전트/터미널 관리 데스크톱 앱입니다.  
터미널과 에이전트를 `herdr-core(`hc`)`에서 관리하고, 앱 창에서 공간(spaces)·탭(tabs)·펜(Panes)으로 구조화합니다.

## 2. 핵심 컴포넌트

### 2.1 herdr-core (`hc`)
- 터미널 및 에이전트 실행/관리 (별도 프로세스)
- `hc run`, `hc exec`, `hc send`, `hc read`, `hc wait` 등의 명령 제공
- `hc machine ls`로 원격 머신 관리

### 2.2 herdr-app
- UI 창 (터미널/에이전트 표시)
- `herdr-app do <command>`로 구조 변경
- `herdr-app ls`, `status`, `commands`로 조회

## 3. 모듈(mod) 구조

```
~/.config/herdr-app/mods/<name>/
  main.js       # 필수: View 클래스 내보내기
  mod.json      # { "place": "none" } 또는 { "place": "right|left|top|bottom", "size": 320 }
  *.js          # 모듈 파일 ("./ui.js" 등)
  *.svg         # 아이콘
```

### 3.1 mod.json 의 `place` 값
- `"none"`: 레이아웃이나 다른 모드가 배치할 때만 표시
- `"right"` / `"left"` / `"top"` / `"bottom"`: 사이드바 혹은 상단/하단 고정

### 3.2 View 클래스 구조

```js
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, spaces, theme, run } from "herdr";

export default class MyMod extends View {
  init(_props, cx) {
    // 모드 초기화: 타이머, 스폰, 키 핸들링
    cx.timer.every(1000, cx => this.refresh(cx));
    cx.spawn(async cx => {
      for (;;) {
        const c = await nextCommand();  // 키 명령 대기
        this.handleCommand(c, cx);
      }
    });
  }
  
  async close(cx) {
    // 모드 닫힘 시 정리 (옵션)
  }
  
  render(cx) {
    const t = theme();
    return div()
      .bg(t.surface)
      .p(10)
      .child(/* 구조 */);
  }
}
```

## 4. 핵심 API (herdr 모듈)

### 4.1 Live Data 함수
| 함수 | 설명 |
|------|------|
| `spaces()` | 모든 공간: id, name, named, folder, machine, tabs, branch |
| `agents()` | 실행 중인 에이전트: status, app, space, tab, pinned, focused |
| `terminals()` | 모든 core 터미널 |
| `panes()` | 모델 팬들 (모드 팬 포함) |
| `machines()` | 연결된 머신: name, layout (loading/ready/unavailable) |
| `focused()` | 현재 포커스: space, tab, pane, terminal, agent |
| `layout()` | 현재 레이아웃 트리 |
| `theme()` | 색상: background, surface, canvas, chrome, accent, border, ansi0..15 등 |
| `settings()` | zoom, sounds, dark, font 등 사용자 설정 |
| `keys()` | 모든 키 바인딩 |
| `commands()` | 모든 앱 명령어 |
| `layouts()` | 레이아웃 이름 목록 |

### 4.2 Act 함수
| 함수 | 설명 |
|------|------|
| `run(name, args)` | 앱 명령 실행 (space.new, tab.new, pane.split, agent.focus 등) |
| `exec(cmd, args, options)` | 프로그램 실행 (30s 제한, 8MiB 출력) `on`으로 머신 지정 |
| `hc(args)` | herdr-core 명령 실행 |
| `openOverlay(spec)` | 오버레이/다이얼로그/윈도우 표시 |
| `closeOverlay(id)` | 오버레이 닫기 |
| `notify({title, body, level})` | 네이티브 알림 |

### 4.3 상태 관리
| 함수 | 설명 |
|------|------|
| `shared(key)` | 모든 모드가 읽는 공유 상태 |
| `setShared(key, value)` | 공유 상태 설정 (재렌더 유발) |
| `props()` | 모드에 전달된 프로퍼티 |
| `nextCommand()` | 키 명령 대기 (async) |

## 5. UI 컴포넌트 (gpui-kit)

### 5.1 요소 빌더
```js
import { View, div, h_flex, v_flex } from "gpui-kit";
```

### 5.2 주요 스타일링 메서드 체인
```
div()
  .id("unique")           // 식별자
  .bg(color)             // 배경색
  .text_color(color)     // 텍스트 색상
  .w(n) / .h(n)          // 너비/높이 (px)
  .p(n) / .px(n) / .py(n) // 패딩
  .gap(n)                // 자식 간 간격
  .rounded(n)            // 라운드
  .border(1)             // 테두리
  .cursor_pointer()      // 커서 스타일
  .on_click(fn)          // 클릭 핸들러
  .on_key_down(fn)       // 키 핸들러
  .tooltip(text)         // 툴팁
  .when(cond, fn)        // 조건부 렌더링
  .child(el)             // 단일 자식
  .children([...])       // 다중 자식
```

### 5.3 자주 쓰는 패턴
```js
// 수직 레이아웃
v_flex()
  .size_full()
  .gap(8)
  .p(12)

// 수평 레이아웃
h_flex()
  .gap(8)
  .items_center()
  .justify_between()

// 클릭 가능한 요소
div()
  .cursor_pointer()
  .on_click(() => run("pane.split", { direction: "right" }))
  .bg(t.accent)
  .rounded(6)
```

## 6. 레이아웃 (layouts/)

### 6.1 레이아웃 JSON 구조
```json
{
  "id": "root",
  "type": "row",
  "children": [
    {
      "id": "sidebar",
      "type": "column",
      "size": { "px": 240 },
      "children": [
        { "id": "spaces", "type": "block", "content": { "mod": "spaces" } },
        { "id": "agents", "type": "block", "content": { "mod": "agents" } }
      ]
    },
    {
      "id": "work",
      "type": "column",
      "children": [
        { "id": "tabs", "type": "block", "size": { "px": 30 }, "content": { "mod": "tabs" } },
        { "id": "main", "type": "block", "content": { "tab": "active" } }
      ]
    }
  ]
}
```

### 6.2 노드 타입
- `block`: 콘텐츠 표시 (`{ mod, props }` 또는 `{ terminal }` 또는 `{ tab: "active" }`)
- `row` / `column`: 자식 수평/수직 배치
- `stack`: 하나의 자식만 표시 (header으로 탭 스트립 가능)

## 7. 예시: 실제 mod 들 보기

### 7.1 herdr-quota (상태표시줄 쿼터 모니터링)
- `mod.json`: `{ "place": "none" }` (상태줄에 자동 추가됨)
- `main.js`: `exec`로 `quota-axi --json` 호출, `shared()`로 상태 저장, `theme()` 색상 사용
- 오버레이 팝업: `openOverlay({ kind: "popup", width: 300, height: …, props: { menu: true } })`

### 7.2 agent-limits (에이전트 사용량 표시)
- 사이드바의 Agents 목록 하단에 배치
- `exec()`로 쉘 스크립트 실행 (`limits.sh`)
- `agents()`와 `theme()`로 렌더링

## 8. 개발 작업 흐름

### 8.1 체크 명령어
```bash
herdr-app check ~/.config/herdr-app/mods/<name>
```
수동으로 체크한 후 모드를 시험해보기.

### 8.2 레이아웃/모드 복사 (클론)
```bash
herdr-app do mod.clone '{"name":"files","as":"my-files"}'
herdr-app do layout.clone '{"name":"main","as":"my-layout"}'
```
`.d.ts` 파일은 앱 시작 시 덮어씌우므로 절대 수정하지 말 것.

## 9. 주의사항

1. **모든 콜백은 독립적인 cx를 받음**: `cx`를 보관하지 말 것
2. **setTimeout/Interval 대신 cx.timer 사용**
3. **긴 작업은 exec 또는 cx.spawn 사용**
4. **테마는 theme() 함수로 가져옴**: light/dark 모두 지원
5. **상태는 shared() 사용**: 모든 모드가 읽을 수 있음
6. **네트워크/파일 작업은 부담스럽게**: 폴더 변경 감지는 `watchFolder()` 사용

## 10. 핵심 파일

| 파일 | 설명 |
|------|------|
| `AGENTS.md` | 전체 문서 (여기서 참고) |
| `herdr.d.ts` | herdr 모듈 API 타입 정의 |
| `gpui-kit.d.ts` | GPUI 컴포넌트 타입 정의 |
| `layouts/main.json` | 기본 레이아웃 구조 |
| `mods/spaces/main.js` | 공간 사이드바 구현 |
| `mods/agents/main.js` | 에이전트 리스트 구현 |
| `mods/pane/main.js` | 팬 헤더 예시 |
| `mods/toast/main.js` | 알림 토스트 구현 |
## 11. 앱 명령어 (herdr-app commands)

### 공간(Space) 관리
| 명령 | 설명 |
|------|------|
| `space.new` | 새 공간 생성 (`{name, folder, tab, argv, task, machine}`) |
| `space.close` | 공간 닫기 |
| `space.rename` | 공간 이름 변경 |
| `space.move` | 공간 이동 (`{id, index}`) |
| `space.select` | 공간 선택 (`{index or id}`) |
| `space.next` / `space.prev` | 공간 순환 |

### 탭(Tab) 관리
| 명령 | 설명 |
|------|------|
| `tab.new` | 새 탭 생성 (`{name, space, folder, argv, task, mod, props}`) |
| `tab.close` | 탭 닫기 |
| `tab.rename` | 탭 이름 변경 |
| `tab.move` | 탭 이동 |
| `tab.select` | 탭 선택 |
| `tab.settle` / `tab.unsettle` | 탭 숨기기/보이기 |
| `tab.next` / `tab.prev` | 탭 순환 |

### 펜(Pane) 관리
| 명령 | 설명 |
|------|------|
| `pane.split` | 펜 분할 (`{direction: "right"\|"down", pane, argv, mod, props}`) |
| `pane.close` | 펜 닫기 |
| `pane.zoom` | 펜 확대/축소 |
| `pane.focus` | 펜 포커스 |
| `pane.go` | 방향으로 포커스 이동 |
| `pane.swap` | 인접 펜 교환 |

### 터미널 관리
| 명령 | 설명 |
|------|------|
| `terminal.open` | 터미널 열기 |
| `terminal.kill` | 터미널 종료 |
| `terminal.keep` / `terminal.park` | 터미널 유지 |
| `terminal.peek` | 터미널 미리보기 |
| `terminal.show` | 터미널 표시 |
| `terminal.copy` / `terminal.paste` | 클립보드 |
| `terminal.pin` | 에이전트 고정 |

### 에이전트 관리
| 명령 | 설명 |
|------|------|
| `agent.focus` | 에이전트 포커스 |
| `agent.next` / `agent.prev` | 에이전트 순환 |

### 레이아웃/모드
| 명령 | 설명 |
|------|------|
| `layout.switch` | 레이아웃 전환 |
| `layout.clone` | 레이아웃 복사 |
| `mod.clone` | 모드 복사 |
| `mod.open` | 모드 토글 |
| `overlay.close` | 오버레이 닫기 |

### 앱/윈도우
| 명령 | 설명 |
|------|------|
| `app.settings` | 설정 열기 |
| `app.palette` | 명령어 팔레트 |
| `app.theme` | 테마 변경 |
| `app.zoom_in/out/reset` | 확대/축소 |
| `window.close/minimize/maximize` | 윈도우 제어 |

## 12. 테스트 환경 (test/fake)

모드 테스트를 위한 가짜 환경 (`/Users/jwseo/.config/herdr-app/mods/relevo/test/fake/`):

```js
// test/fake/herdr.mjs - 핵심 가짜 함수들
export const agents = () => fake.agents;
export const exec = async (cmd, args) => { fake.execs.push([...args].join(" ")); };
export const run = (name, args) => { fake.runs.push([name, args]); };
export const shared = (key) => fake.stored[key];
export const setShared = (key, value) => { fake.stored[key] = value; };
```

테스트용 `fakeCx()` 함수로 컨텍스트 모킹:
```js
import { fakeCx, click, flush } from "./test/fake/ui.mjs";

export async function test_example() {
  const cx = fakeCx();
  const mod = new MyMod();
  mod.init({}, cx);
  await flush();
  const el = mod.render(cx);
  click(el.on_click_handlers, cx);
}
```

## 13. 참고: 실제 샘플 코드

### 사이드바 모드 예시 (`mods/spaces/main.js`)
- `spaces()`로 공간 목록 가져오기
- `exec("git", ["branch", "--show-current"], { cwd, on })`로 원격 Git 상태 조회
- `v_flex()`, `h_flex()`로 레이아웃 구성
- `cx.spawn(async (cx) => ...)`로 비동기 작동

### 상태표시줄에 모드 추가하기
`layout.json`의 root 아래에 추가:
```json
{
  "id": "status",
  "type": "block",
  "content": { "mod": "herdr-quota" }
}
```

## 14. 신규 커스텀 모드: OpenUsage (`openusage`)

[OpenUsage](https://github.com/robinebers/openusage) 스타일로 다양한 AI 코딩 에이전트(Claude Code, OpenAI Codex, Google Antigravity, OpenCode Go)의 실시간 쿼터·사용량·리셋 타이머를 한눈에 볼 수 있는 커스텀 Herdr 모드입니다.

### 14.1 주요 기능
- **4대 AI 프로바이더 쿼터 통합 모니터링**:
  - **Claude Code**: Keychain OAuth 토큰 기반 5시간 세션 및 7일 주간 한도/리셋 시각 조회
  - **OpenAI Codex**: `~/.codex/auth.json` ChatGPT 토큰 기반 5시간 세션 및 7일 주간 한도/플랜(Plus/Pro) 조회
  - **Google Antigravity**: `agy -p /usage` 연동 (Gemini Models 및 Claude/GPT models 서브 버킷 쿼터 분리 표시)
  - **OpenCode Go**: `opencode api` 기반 Rolling, Weekly, Monthly 한도 조회
- **Herdr 실행 중인 에이전트 실시간 연동**:
  - `agents()` API를 통해 현재 활성화된 에이전트(예: Antigravity t5 working)를 프로바이더 카드에 표시하고 클릭 한 번으로 포커스 이동 (`Focus →`)
- **다중 계정(Multi-Account) 지원**:
  - 서비스별 단일 계정 제한 없이 여러 프로필/계정을 등록하여 동시에 모니터링 가능 (예: `Claude (Work)`, `Claude (Personal)`, `Codex (Team)`, `Antigravity (Profile 2)` 등)
  - 계정별 인증 소스(Keychain Service 명칭, 커스텀 `auth.json` 경로, CLI 등)를 독립적으로 지정
- **왼쪽 사이드바(Sidebar) 너비 반응형(Responsive) 레이아웃**:
  - Herdr의 기본 `main` 레이아웃 왼쪽 사이드바(`sidebar-lists`)의 `usages` 블록에서 사이드바 가로 폭(`sidebar.size.px`)에 맞춰 4단계 반응형 레이아웃 자동 전환:
    - **레일 모드 (Rail, < 140px)**: 좁은 폭(44px~76px)에서 **iPhone Duo 스타일 원형 위젯(Circular Dual-Arc Widget)**으로 혁신적 시각화:
      - **상단 숫자**: 5시간 쿼터 잔여 퍼센트 숫자(예: `50`, `16`)를 굵은 폰트로 선명하게 표시
      - **중앙 로고**: 프로바이더 공식 벡터 아이콘 (LobeHub 공식 OpenAI ChatGPT 로고, Claude, Antigravity, OpenCode) 배치
      - **좌측 호 (Left Arc)**: 5시간 잔여량 게이지 (소진율과 권장 페이스에 따라 🟢녹색/🟡주황/🔴빨강 매끄러운 곡선 차오름)
      - **우측 호 (Right Arc)**: 주간 잔여량 게이지 (7일 잔여 쿼터에 따라 🔵시안/🟡주황/🔴빨강 대칭 곡선 차오름)
      - **하단 도트 4개 (Pace Dots)**: iPhone Duo 스타일의 4개 점(`••••`)을 통해 소비 페이스(여유/적정/조기소진 위험) 상태를 직관적으로 점등
      - 마우스 호버 시 5시간·주간 상세 잔여량 및 타이머 툴팁 제공, 클릭 시 대시보드 팝업
    - **슬림 모드 (Narrow, 140px ~ 230px)**: 축약 라벨(`5h`, `7d`, `24h`)과 컴팩트 게이지 바를 상하 2줄로 배치하여 가로 잘림 없이 표시
    - **표준 모드 (Standard, 230px ~ 320px, 기본값 268px)**: `5시간`, `주간` 표준 라벨과 5px 잔여량 바, 선형 페이스 기준선(`|`), 리셋 카운트다운 타이머를 상하 2줄로 정렬
    - **와이드 모드 (Wide, >= 320px)**: 사이드바를 넓혔을 때 공간을 극대화하여 **`5시간`과 `주간` 게이지를 한 줄에 나란히 좌우 2열 컬럼(Dual Columns)**으로 동시 배치 (세로 공간 50% 절약)
- **OpenAI ChatGPT 공식 아이콘 적용**:
  - `https://lobehub.com/icons` 기준 공식 OpenAI ChatGPT 기하학적 심볼(꽃/매듭 로고) 벡터를 채택하여 `openusage/icons/codex.svg` 및 시스템 전역 아이콘 디렉토리에 완벽 반영
- **Open 시 자동 새로고침 비활성화 및 수동 강제 갱신 구조**:
  - `shared("openusage.accounts_cache")`를 통해 사이드바, 탭, 오버레이 팝업 인스턴스 간 쿼터 데이터를 실시간 공유
  - 사이드바에서 `Open`을 누르거나 대시보드 창을 열 때 **자동으로 백엔드 API/CLI 재호출을 하지 않고**, 기존에 폴링·캐시된 데이터를 딜레이 없이 즉시 화면에 렌더링
  - 백그라운드 주기적 폴링(2~5분)이 조용히 최신 상태를 유지하며, 사용자가 즉시 최신 데이터를 받아보고 싶을 때만 상단 `Refresh ↻` 버튼을 눌러 수동 강제 갱신(Force Refresh) 수행
- **설정 및 계정 관리 화면 (`⚙ Settings / Accounts`)**:
  - 대시보드 상단 ⚙️ 버튼을 통해 GUI 상에서 등록된 계정 활성화/비활성화 토글, 삭제 및 프리셋 계정 추가 가능
  - 영구 설정 파일: `~/.config/herdr-app/openusage-accounts.json`을 통해 텍스트 에디터로 직접 계정 목록 및 옵션 편집 가능
- **글랜서블(Glanceable) 대시보드 UI**:
  - **잔여량(Remaining) 중심 게이지**: 사용량이 아닌 잔여 쿼터(`% remaining`)를 기준으로 게이지 바가 차오르며, 소진될수록 줄어드는 직관적 시각화
  - **OpenUsage 페이스 가이드(Pacing Guide)**:
    - 각 윈도우 기간(5시간, 7일, 30일 등) 동안 일정하게 소비했을 때 시점별 예상 잔여 기준선(`|`)을 게이지 트랙 위에 마커로 표시
    - **가이드 초과 여부 기반 색상 및 상태 판정**:
      - 🟢 **Ahead (여유)**: 잔여량이 가이드선보다 많음 (`~X% left at reset`, 소비 속도가 안정적)
      - 🟡 **On Track (적정)**: 가이드선 부근 (`~X% used at reset`, 90~100% 예상)
      - 🔴 **Burning Fast (조기 소진 위험)**: 소비 속도가 빨라 잔여량이 가이드선에 미달 (`~X% over limit at reset`, 리셋 전 조기 소진 위험)
  - 상단 요약 바: 전체 페이스 요약(Overall Pacing), 활성 에이전트 수, 가장 빠른 리셋 타이머 카운트다운
  - 개별 및 전체 새로고침(Spin 애니메이션) 및 비동기 캐싱 지원

### 14.2 파일 구조
```
openusage/
├── mod.json          # 모드 설정 (다이얼로그 크기 및 타이틀 정의)
├── main.js           # GPUI 컴포넌트 뷰 (사이드바 4단계 반응형 / 대시보드 / 설정 화면)
├── cache/            # 레일 뷰용 iPhone Duo 스타일 원형 게이지 SVG 캐시
│   ├── duo-default.svg
│   ├── duo-codex-default.svg
│   ├── duo-claude-default.svg
│   ├── duo-antigravity-default.svg
│   └── duo-opencode-default.svg
├── helpers/          # 프로바이더별 CLI/API 데이터 수집기 및 위젯 생성기
│   ├── accounts.py   # 다중 계정 설정(~/.config/herdr-app/openusage-accounts.json) CRUD
│   ├── duo_svg.py    # iPhone Duo 스타일 원형 듀얼 아크 SVG 생성기
│   ├── antigravity.py
│   ├── claude.py     # 커스텀 Keychain Service 명칭 지원
│   ├── codex.py      # 커스텀 auth.json 경로 지원
│   └── opencode.py
└── icons/            # SVG 아이콘
    ├── openusage.svg
    ├── refresh.svg
    ├── openai.svg    # LobeHub 공식 OpenAI ChatGPT 심볼 (@lobehub/icons Mono)
    ├── codex.svg     # LobeHub 공식 OpenAI ChatGPT 심볼
    ├── claude.svg
    ├── antigravity.svg
    └── opencode.svg
```

### 14.3 실행 및 배치 방법
- **왼쪽 사이드바(Spaces/Agents 아래) 배치**:
  `~/.config/herdr-app/layouts/main.json`의 `sidebar-lists`에 자동 추가되어 실시간 연동됩니다.
- **다이얼로그 오버레이로 열기**:
  ```bash
  herdr-app do mod.open '{"name":"openusage"}'
  ```
- **새 탭으로 열기**:
  ```bash
  herdr-app do tab.new '{"name":"OpenUsage","mod":"openusage"}'
  ```
- **현재 펜 분할하여 나란히 열기**:
  ```bash
  herdr-app do pane.split '{"direction":"right","mod":"openusage"}'
  ```
- **모드 검증 (GPUI 테스트)**:
  ```bash
  herdr-app check ~/.config/herdr-app/mods/openusage
  ```

