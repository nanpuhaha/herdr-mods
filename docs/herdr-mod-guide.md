# Herdr Desktop App Mods 개발 가이드 (Development Guide)

이 문서는 **Herdr 데스크톱 앱**의 커스텀 모듈(Mods) 개발, 레이아웃 커스터마이징, GPUI 기반 UI 컴포넌트 작성 및 핵심 API 레퍼런스를 다룹니다.

---

## 1. Herdr 개요

Herdr은 macOS/Windows/Linux용 코드 에이전트/터미널 관리 데스크톱 앱입니다.  
터미널과 에이전트를 `herdr-core`(`hc`)에서 관리하고, 앱 창에서 공간(Spaces)·탭(Tabs)·펜(Panes)으로 구조화합니다.

## 2. 핵심 컴포넌트

### 2.1 herdr-core (`hc`)
- 터미널 및 에이전트 실행/관리 (독립 백그라운드 프로세스)
- `hc run`, `hc exec`, `hc send`, `hc read`, `hc wait` 등의 명령 제공
- `hc machine ls`로 원격 머신 관리

### 2.2 herdr-app
- UI 창 (GPUI 기반 에이전트 및 터미널 렌더링)
- `herdr-app do <command>`로 구조 변경
- `herdr-app ls`, `status`, `commands`로 앱 상태 조회

---

## 3. 모듈(Mod) 구조

```
~/.config/herdr-app/mods/<name>/
  main.js       # 필수: View 클래스 내보내기 (export default class extends View)
  mod.json      # 모드 메타데이터 및 배치 정의
  *.js          # 헬퍼 및 서브 모듈 파일 ("./ui.js" 등)
  *.svg         # 아이콘 리소스
```

### 3.1 `mod.json` 설정
```json
{
  "title": "My Mod",
  "place": "none",
  "overlay": {
    "kind": "dialog",
    "width": 920,
    "height": 660
  }
}
```
- `place`:
  - `"none"`: 레이아웃이나 다른 모드가 동적으로 열거나 포함할 때만 표시
  - `"right"` / `"left"` / `"top"` / `"bottom"`: 사이드바 또는 상단/하단 고정 배치
- `overlay`:
  - `kind`: `"dialog"`, `"popup"` 등
  - `width`, `height`: 윈도우 크기 지정

### 3.2 View 클래스 기본 구조

```js
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, spaces, theme, run } from "herdr";

export default class MyMod extends View {
  init(_props, cx) {
    // 모드 초기화: 주기적 타이머, 비동기 스폰, 키 이벤트 리스너
    cx.timer.every(1000, cx => this.refresh(cx));
    cx.spawn(async cx => {
      for (;;) {
        const c = await nextCommand();  // 키 명령 대기
        this.handleCommand(c, cx);
      }
    });
  }
  
  async close(cx) {
    // 모드가 언마운트되거나 닫힐 때 리소스 정리 (선택 사항)
  }
  
  render(cx) {
    const t = theme();
    return div()
      .bg(t.surface)
      .p(10)
      .child(
        h_flex()
          .gap(8)
          .child("Hello from Herdr Mod")
      );
  }
}
```

---

## 4. 핵심 API (`herdr` 모듈)

### 4.1 Live Data 함수
| 함수 | 반환값 및 설명 |
| :--- | :--- |
| `spaces()` | 모든 공간: `id`, `name`, `folder`, `machine`, `tabs`, `branch` |
| `agents()` | 실행 중인 에이전트 목록: `status`, `app`, `space`, `tab`, `pinned`, `focused` |
| `terminals()` | 모든 코어 터미널 정보 |
| `panes()` | 모달 및 모드 펜을 포함한 모든 펜 정보 |
| `machines()` | 연결된 머신: `name`, `layout` (`loading`/`ready`/`unavailable`) |
| `focused()` | 현재 포커스된 컨텍스트: `space`, `tab`, `pane`, `terminal`, `agent` |
| `layout()` | 현재 렌더링 중인 전체 레이아웃 트리 |
| `theme()` | 테마 색상 팔레트: `background`, `surface`, `canvas`, `chrome`, `accent`, `border`, `ansi0`..`15` 등 |
| `settings()` | 사용자 설정: `zoom`, `sounds`, `dark`, `font` 등 |
| `keys()` | 등록된 모든 키 바인딩 맵 |
| `commands()` | 앱에서 실행 가능한 모든 명령어 목록 |
| `layouts()` | 등록된 사용 가능한 레이아웃 이름 목록 |

### 4.2 Act (실행 및 제어) 함수
| 함수 | 설명 |
| :--- | :--- |
| `run(name, args)` | 앱 명령어 실행 (`space.new`, `tab.new`, `pane.split`, `agent.focus` 등) |
| `exec(cmd, args, options)` | 외부 바이너리/스크립트 비동기 실행 (기본 30초 제한, 8MiB 출력, `on`으로 머신 지정) |
| `hc(args)` | `herdr-core` CLI 명령어 실행 |
| `openOverlay(spec)` | 오버레이 다이얼로그 또는 팝업 윈도우 생성 |
| `closeOverlay(id)` | 특정 오버레이 윈도우 닫기 |
| `notify({title, body, level})` | OS 네이티브 데스크톱 알림 발송 |

### 4.3 상태 관리 및 컨텍스트
| 함수 | 설명 |
| :--- | :--- |
| `shared(key)` | 모든 모드 인스턴스에서 공유되는 전역 상태 읽기 |
| `setShared(key, value)` | 공유 상태 저장 및 구독 컴포넌트 자동 리렌더 트리거 |
| `props()` | 상위 레이아웃/명령어에서 모드로 전달된 파라미터 |
| `nextCommand()` | 단축키 및 비동기 키 명령 수신 대기 |

---

## 5. UI 컴포넌트 (`gpui-kit`)

### 5.1 컴포넌트 임포트
```js
import { View, div, h_flex, v_flex, image, svg } from "gpui-kit";
```

### 5.2 주요 스타일링 체인 메서드
```
div()
  .id("unique-id")        // 컴포넌트 고유 ID
  .bg(color)              // 배경색
  .text_color(color)      // 글자 색상
  .w(n) / .h(n)           // 너비 / 높이 (정수 px 단위)
  .p(n) / .px(n) / .py(n) // 패딩
  .gap(n)                 // 자식 간격
  .rounded(n)             // 모서리 곡률 (Border radius)
  .border(1)              // 테두리 두께
  .border_color(color)    // 테두리 색상
  .cursor_pointer()       // 마우스 호버 시 포인터 커서
  .on_click(fn)           // 클릭 이벤트 핸들러
  .on_key_down(fn)        // 키보드 다운 이벤트 핸들러
  .tooltip(text)          // 네이티브 마우스 툴팁
  .when(cond, fn)         // 조건부 렌더링
  .child(el)              // 단일 자식 노드 추가
  .children([...])        // 다중 자식 배열 추가
```

### 5.3 반응형 및 유용한 레이아웃 패턴
```js
// 수직 컬럼 레이아웃
v_flex()
  .size_full()
  .gap(8)
  .p(12)

// 수평 정렬 헤더 바
h_flex()
  .gap(8)
  .items_center()
  .justify_between()

// 클릭 가능한 카드 버튼
div()
  .cursor_pointer()
  .hover(s => s.bg(t.hover))
  .on_click(() => run("pane.split", { direction: "right" }))
  .bg(t.surface)
  .rounded(6)
  .p(8)
```

---

## 6. 레이아웃 구조 (`layouts/`)

### 6.1 `layout.json` 구조
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

### 6.2 노드 유형
- `block`: 실제 뷰 콘텐츠 바인딩 (`{ mod, props }`, `{ terminal }`, `{ tab: "active" }`)
- `row` / `column`: 자식 컴포넌트의 수평/수직 분할 배치
- `stack`: 탭 스트립 기반의 다중 패널 단일 뷰 스택

---

## 7. 주요 앱 명령어 (`herdr-app commands`)

### 7.1 공간(Space) 관리
- `space.new`: 새 공간 생성 (`{ name, folder, tab, argv, task, machine }`)
- `space.close`: 현재 공간 닫기
- `space.rename`: 공간 이름 변경
- `space.move`: 공간 순서 변경 (`{ id, index }`)
- `space.select`: 특정 공간으로 포커스 전환 (`{ index | id }`)
- `space.next` / `space.prev`: 인접 공간 순환

### 7.2 탭(Tab) 관리
- `tab.new`: 새 탭 생성 (`{ name, space, folder, argv, task, mod, props }`)
- `tab.close`: 탭 닫기
- `tab.rename`: 탭 이름 변경
- `tab.select`: 탭 선택

### 7.3 펜(Pane) 관리
- `pane.split`: 펜 분할 (`{ direction: "right" | "down", mod, props }`)
- `pane.close`: 펜 닫기
- `pane.zoom`: 펜 최대화 토글

### 7.4 모드 및 윈도우 관리
- `mod.open`: 모달 오버레이 또는 패널 토글 (`{ name: "agent-usage" }`)
- `layout.switch`: 다른 레이아웃 파일로 전환
- `overlay.close`: 활성 오버레이 닫기

---

## 8. 모드 개발 시 권장 규칙 및 주의사항

1. **컨텍스트(`cx`) 보관 금지**: 모든 비동기 콜백은 별도의 독립적인 `cx`를 전달받으므로 인스턴스 필드에 `this.cx`를 캐싱하지 마십시오.
2. **타이머는 `cx.timer` 사용**: 일반 `setInterval`이나 `setTimeout` 대신 GPUI 라이프사이클에 안전한 `cx.timer.every()`를 사용하십시오.
3. **Rust GPUI 타입 검증**: `.w()` 또는 `.left()` 등의 수치 연산 시 문자열(`"50%"`)을 전달하면 GPUI 타입 패닉이 발생할 수 있으므로, 반드시 정수 px 또는 flex 비율을 사용하십시오.
4. **테마 호환성**: 하드코딩된 색상 대신 `theme()` 팔레트 토큰(`t.background`, `t.surface`, `t.foreground`, `t.accent`, `t.border`)을 활용하십시오.
5. **모드 검증 도구**: 코드 수정 후 항상 다음 명령어로 문법 및 런타임 바인딩을 검증하십시오.
   ```bash
   herdr-app check ~/.config/herdr-app/mods/<mod_name>
   ```
