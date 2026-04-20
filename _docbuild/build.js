const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, PageOrientation, LevelFormat,
  HeadingLevel, BorderStyle, WidthType, ShadingType, VerticalAlign,
  PageNumber, PageBreak, TabStopType, TabStopPosition,
  TableOfContents, StyleLevel,
} = require('docx');

// ─────────────────────────────────────────────────────────
// Styling primitives
// ─────────────────────────────────────────────────────────
const KR_FONT = 'Malgun Gothic';
const MONO_FONT = 'Consolas';
const BRAND = '1B36B0';   // navy
const ACCENT = '0891B2';  // teal
const GREY = '64748B';

const border = { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' };
const tableBorders = { top: border, bottom: border, left: border, right: border,
  insideHorizontal: border, insideVertical: border };
const headerShade = { fill: 'E0E7FF', type: ShadingType.CLEAR };
const cellMargins = { top: 80, bottom: 80, left: 120, right: 120 };
const TABLE_WIDTH = 9360;

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────
const p = (text, opts = {}) =>
  new Paragraph({
    ...opts,
    children: Array.isArray(text)
      ? text
      : [new TextRun({ text, font: KR_FONT, size: opts.size ?? 22 })],
  });

const h1 = (t, opts = {}) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 180 },
    ...opts,
    children: [new TextRun({ text: t, font: KR_FONT, size: 36, bold: true, color: BRAND })],
  });
const h2 = (t) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 280, after: 140 },
    children: [new TextRun({ text: t, font: KR_FONT, size: 28, bold: true, color: BRAND })],
  });
const h3 = (t) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 200, after: 100 },
    children: [new TextRun({ text: t, font: KR_FONT, size: 24, bold: true, color: ACCENT })],
  });

const body = (t, extra = {}) =>
  new Paragraph({
    spacing: { line: 320, after: 120 },
    children: [new TextRun({ text: t, font: KR_FONT, size: 22, ...extra })],
  });

const bullet = (t, level = 0) =>
  new Paragraph({
    numbering: { reference: 'bullets', level },
    spacing: { line: 300, after: 80 },
    children: Array.isArray(t)
      ? t
      : [new TextRun({ text: t, font: KR_FONT, size: 22 })],
  });

const mono = (text) =>
  new Paragraph({
    spacing: { line: 300, before: 120, after: 120 },
    shading: { fill: 'F1F5F9', type: ShadingType.CLEAR },
    border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
      left: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
      right: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' } },
    children: text.split('\n').flatMap((line, i) => {
      const runs = [new TextRun({ text: line, font: MONO_FONT, size: 18 })];
      if (i < text.split('\n').length - 1) runs.push(new TextRun({ break: 1 }));
      return runs;
    }),
  });

function hr() {
  return new Paragraph({
    spacing: { before: 120, after: 240 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: BRAND } },
    children: [new TextRun('')],
  });
}

// Table builder
function tbl(headers, rows, colWidths) {
  colWidths = colWidths || headers.map(() => Math.floor(TABLE_WIDTH / headers.length));
  const sum = colWidths.reduce((a, b) => a + b, 0);
  // Ensure sum matches
  if (sum !== TABLE_WIDTH) {
    const diff = TABLE_WIDTH - sum;
    colWidths[colWidths.length - 1] += diff;
  }

  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((h, i) =>
      new TableCell({
        borders: tableBorders,
        shading: headerShade,
        width: { size: colWidths[i], type: WidthType.DXA },
        margins: cellMargins,
        children: [new Paragraph({
          children: [new TextRun({ text: h, font: KR_FONT, size: 20, bold: true, color: BRAND })],
        })],
      })
    ),
  });

  const bodyRows = rows.map(r =>
    new TableRow({
      children: r.map((cell, i) =>
        new TableCell({
          borders: tableBorders,
          width: { size: colWidths[i], type: WidthType.DXA },
          margins: cellMargins,
          children: [new Paragraph({
            children: [new TextRun({
              text: String(cell),
              font: typeof cell === 'string' && /^[\x20-\x7e]+$/.test(cell) && cell.length < 30 ? MONO_FONT : KR_FONT,
              size: 20,
            })],
          })],
        })
      ),
    })
  );

  return new Table({
    width: { size: TABLE_WIDTH, type: WidthType.DXA },
    columnWidths: colWidths,
    rows: [headerRow, ...bodyRows],
  });
}

// ─────────────────────────────────────────────────────────
// CONTENT
// ─────────────────────────────────────────────────────────

const content = [
  // ===== COVER =====
  new Paragraph({
    spacing: { before: 2400, after: 240 },
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'BizMech', font: KR_FONT, size: 96, bold: true, color: BRAND })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
    children: [new TextRun({ text: '비즈맥 웹 애플리케이션 개발', font: KR_FONT, size: 40, color: ACCENT })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 2000 },
    children: [new TextRun({ text: '개발 진행 보고서', font: KR_FONT, size: 32, color: GREY })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
    children: [new TextRun({ text: '기계부품 브라우저 · 2D/3D 프리뷰 · CAD 다운로드', font: KR_FONT, size: 24, italics: true, color: GREY })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 3600 },
    children: [new TextRun({ text: '작성일: 2026년 4월 16일', font: KR_FONT, size: 22, color: GREY })],
  }),
  new Paragraph({ children: [new PageBreak()] }),

  // ===== TABLE OF CONTENTS =====
  new Paragraph({
    spacing: { before: 240, after: 360 },
    children: [new TextRun({ text: '목  차', font: KR_FONT, size: 44, bold: true, color: BRAND })],
    alignment: AlignmentType.CENTER,
  }),
  new Paragraph({
    spacing: { after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: BRAND } },
    children: [new TextRun('')],
  }),
  new Paragraph({
    spacing: { before: 160, after: 240 },
    alignment: AlignmentType.CENTER,
    children: [new TextRun({
      text: '※ 워드에서 처음 열 때 "필드 업데이트" 를 묻거나, 마우스 우클릭 → "필드 업데이트" (또는 F9) 로 페이지 번호를 채워 주세요.',
      font: KR_FONT, size: 18, color: GREY, italics: true,
    })],
  }),
  new TableOfContents('목차', {
    hyperlink: true,
    headingStyleRange: '1-3',
    rightTabStop: 9000,
    captionLabel: '목차',
  }),
  new Paragraph({ children: [new PageBreak()] }),

  // ===== SECTION 1: 프로젝트 개요 =====
  h1('1. 프로젝트 개요'),
  h2('1.1 배경 및 목표'),
  body('BizMech 는 기존 데스크탑 CAD 플러그인 "PartManager" 의 기능을 웹 기반으로 이식하여, 브라우저에서 기계부품을 카테고리별로 탐색하고, 스펙 옵션을 선택한 뒤 2D/3D 프리뷰로 확인하고 STEP/DWG 등의 CAD 파일을 다운로드할 수 있도록 하는 것이 목표입니다.'),
  body('사용자가 공유한 개발 컨셉 문서(비즈맥(BizMech)개발컨셉.pptx)를 기반으로 다음 요구사항을 도출하였습니다:'),
  bullet('프론트엔드: React 기반, 모바일 대응 필수'),
  bullet('백엔드: 추후 Java 로 구축 예정 — 프론트엔드 기준으로 개발하되 교체 가능한 구조'),
  bullet('DB: PostgreSQL (사내 Spec 서버 192.168.0.17 활용)'),
  bullet('2D/3D 뷰어: PartManager 의 three.js 렌더러 재사용'),
  bullet('다국어 지원 (한/영/일/중)'),
  bullet('성능·메모리 관리 고려'),
  bullet('주문코드 기반 조회 기능'),
  bullet('세련된 UI/UX (Figma 수준)'),

  h2('1.2 참조 자료'),
  tbl(
    ['자료', '내용'],
    [
      ['비즈맥(BizMech)개발컨셉.pptx', '요구사항 문서'],
      ['PartManager.Core.Zip', 'WPF 기반 CAD 플러그인 소스 (C#)'],
      ['Standard_Core.db', '표준부품 SQLite 스키마 (34 MB)'],
      ['Motor_Core.db', '모터 SQLite 스키마 (1.8 MB)'],
      ['partRenderer2D.js / partRenderer.js', '재사용 대상 2D/3D 렌더러 (~5900 LOC)'],
    ],
    [3600, 5760],
  ),

  // ===== SECTION 2: 아키텍처 =====
  h1('2. 아키텍처 설계'),
  h2('2.1 3-Tier 구조'),
  body('Java 백엔드가 아직 구축되지 않은 상태에서 개발 진행을 위해, 다음과 같은 3-Tier 아키텍처를 채택했습니다.'),
  mono(
`┌──────────────────────────────────────────────────────────┐
│  Tier 1: React Frontend (BizMech-web)                     │
│  · Vite + TypeScript + Tailwind + shadcn-style UI         │
│  · Zustand 상태 관리 · i18n 4개 언어                        │
│  · 2D/3D 뷰어 iframe (partRenderer.js 재사용)              │
└───────────────────────┬──────────────────────────────────┘
                        │ HTTP/JSON (IPartApi)
┌───────────────────────▼──────────────────────────────────┐
│  Tier 2: Node.js REST Proxy (bizmech-proxy)              │
│  · Express + pg · TypeScript · 13개 엔드포인트              │
│  · Standard_Core / Motor_Core 듀얼 풀 + PartCode 라우팅    │
│  · JSONB/TEXT 겸용 파서 · 스코어링 기반 매칭                │
└───────────────────────┬──────────────────────────────────┘
                        │ PostgreSQL 프로토콜
┌───────────────────────▼──────────────────────────────────┐
│  Tier 3: PostgreSQL 10.19 @ 192.168.0.17:5432            │
│  · Standard_Core DB: 카테고리·표준부품                      │
│  · Motor_Core DB: 모터 파트                                 │
└──────────────────────────────────────────────────────────┘`
  ),

  h2('2.2 설계 원칙'),
  tbl(
    ['원칙', '구현'],
    [
      ['인터페이스 기반 추상화', 'IPartApi 인터페이스로 Mock/Http 구현체 교체 가능'],
      ['환경변수 전환', 'VITE_API_MODE=mock|http 한 줄로 모드 전환'],
      ['렌더러 무수정 재사용', 'partRenderer.js 원본 유지, bridge.js 로 postMessage 호환'],
      ['Java 백엔드 준비', 'OpenAPI 3.0 명세서로 API 계약 선행 정의'],
      ['타입 안전성', 'TypeScript strict + 공통 타입 (src/types/index.ts)'],
      ['보안', '자격증명 .env (gitignore) + CORS origin 제한'],
    ],
    [3600, 5760],
  ),

  h2('2.3 기술 스택'),
  tbl(
    ['계층', '기술', '선정 근거'],
    [
      ['UI', 'React 18 + TypeScript', '요구사항 명시'],
      ['빌드', 'Vite 5', '빠른 HMR, 경량'],
      ['스타일', 'Tailwind CSS 3 + shadcn 스타일', 'Figma 친화적, 커스텀 용이'],
      ['상태', 'Zustand', 'Redux 대비 경량, 속도 우선'],
      ['데이터 페칭', 'TanStack Query', '캐싱·로딩 상태 관리'],
      ['라우팅', 'React Router v6', '표준'],
      ['i18n', 'react-i18next', '표준, 4개 언어'],
      ['2D/3D', 'iframe + three.js (재사용)', 'PartManager 자산 최대 활용'],
      ['Mock DB', 'sql.js (WASM)', '백엔드 없이 실 데이터 개발'],
      ['HTTP', 'Axios', '표준 클라이언트'],
      ['프록시 서버', 'Node.js + Express + pg', 'Java 대기 기간 브릿지'],
      ['DB', 'PostgreSQL 10.19', '서버 환경'],
    ],
    [1800, 2880, 4680],
  ),

  // ===== SECTION 3: 프로젝트 구조 =====
  h1('3. 프로젝트 구조'),
  h2('3.1 디렉토리 레이아웃'),
  mono(
`D:\\Work\\pgm\\New_Wizard_Pgms\\BizMech개발\\
│
├── BizMech-web/           프론트엔드 (React + TypeScript)
│   ├── public/
│   │   ├── viewers/       ← 2D/3D 뷰어 재사용 자산
│   │   │   ├── viewer2D.html / viewer.html
│   │   │   ├── js/
│   │   │   │   ├── bridge.js          ← postMessage 어댑터
│   │   │   │   ├── partRenderer2D.js  ← 원본 (2857 줄)
│   │   │   │   ├── partRenderer.js    ← 원본 (3008 줄)
│   │   │   │   └── lib/three.module.js, addons/...
│   │   │   └── css/
│   │   └── data/          ← Mock 모드용 SQLite
│   │       ├── Standard_Core.db
│   │       └── Motor_Core.db
│   ├── src/
│   │   ├── components/
│   │   │   ├── category/CategorySidebar.tsx
│   │   │   ├── spec/DynamicSpecForm.tsx / SpecTabs.tsx
│   │   │   ├── preview/PreviewPanel.tsx / PreviewFrame.tsx
│   │   │   ├── download/DownloadBar.tsx
│   │   │   ├── layout/AppLayout.tsx / TopBar.tsx / ...
│   │   │   └── ui/ (Button / Card / Input / Select / Spinner)
│   │   ├── pages/
│   │   │   ├── LoginPage.tsx
│   │   │   ├── MainPage.tsx
│   │   │   └── OrderCodeSearchPage.tsx
│   │   ├── services/api/
│   │   │   ├── IPartApi.ts          ← 인터페이스 (백엔드 계약)
│   │   │   ├── MockPartApi.ts       ← sql.js 구현
│   │   │   ├── HttpPartApi.ts       ← Axios 구현
│   │   │   └── factory.ts           ← 팩토리 스위치
│   │   ├── store/
│   │   │   ├── authStore.ts
│   │   │   ├── selectionStore.ts
│   │   │   └── uiStore.ts
│   │   ├── utils/
│   │   │   ├── specFilter.ts        ← filter/filter_Values 로직
│   │   │   ├── linkedParts.ts       ← 연결부품 파싱
│   │   │   ├── keyFieldMatcher.ts   ← 키 필드 매칭
│   │   │   ├── dimensionMap.ts      ← DB→렌더러 키 변환
│   │   │   └── controlType.ts       ← COMBOBOX/EDITBOX 등
│   │   ├── types/index.ts           ← 공용 도메인 타입
│   │   ├── i18n/locales/ (ko/en/ja/zh.json)
│   │   └── main.tsx / App.tsx / index.css
│   ├── .env.example / .env.local
│   └── package.json
│
├── bizmech-proxy/         Node.js REST 프록시 서버
│   ├── src/
│   │   ├── index.ts                 ← Express 엔트리
│   │   ├── db.ts                    ← pg 듀얼 풀 + partCode 인덱스
│   │   ├── util/json.ts             ← JSONB/TEXT 겸용 파서
│   │   └── routes/
│   │       ├── auth.ts              ← 로그인/로그아웃
│   │       ├── categories.ts        ← 카테고리 + motor parts
│   │       ├── parts.ts             ← 스펙/치수 엔드포인트
│   │       ├── search.ts            ← 주문코드 조회
│   │       ├── download.ts          ← CAD 다운로드 placeholder
│   │       └── diag.ts              ← 진단 엔드포인트
│   ├── openapi.yaml                 ← Java 개발자용 API 명세
│   ├── .env.example / .env
│   ├── README.md
│   └── package.json
│
├── 참조용/                 원본 자산 (수정 금지)
│   ├── PartManager.Core.Zip
│   ├── Standard_Core.db
│   └── Motor_Core.db
│
├── dev-all.bat            두 서버 동시 실행
└── 비즈맥(BizMech)개발컨셉.pptx`
  ),

  // ===== SECTION 4: 주요 기능 =====
  h1('4. 주요 기능 구현'),

  h2('4.1 인증'),
  body('현재는 목업 인증 - 아무 ID/비밀번호로 로그인 가능. Zustand persist 미들웨어로 토큰을 localStorage (bizmech.auth) 에 저장. 추후 Java 백엔드 도입 시 JWT 검증으로 교체 예정.'),

  h2('4.2 좌측 카테고리 트리'),
  body('PartManager 의 4단계 계층 (대분류 → 중분류 → 소분류 → 부품종류) 을 좌측 사이드바에 트리 구조로 렌더링. 각 노드는 lazy load (TanStack Query).'),
  bullet('표준부품: 일반 트리 경로 (main → sub → mid → partType)'),
  bullet('모터: mid 레벨 스킵 → sub 에서 바로 partspec 조회 (Motor_Core DB)'),
  bullet('정렬: parttype.sort_order 가 전부 0 인 경우 part_type_id 로 2차 정렬 (PartManager 삽입 순서 재현)'),
  bullet('유틸리티·공학계산·BOM: 웹에서 숨김 (WEB_VISIBLE 필터)'),

  h2('4.3 동적 스펙 폼'),
  body('partspec.spec_data JSON 의 option[] 배열을 읽어 6가지 컨트롤 타입별로 자동 dispatch:'),
  tbl(
    ['type', '렌더링', '예시 옵션'],
    [
      ['COMBOBOX', '드롭다운', '국제산업표준, 재질, 머리형식'],
      ['LISTBOX', '스크롤 리스트 (size=5~7)', '사이즈 (71개 값)'],
      ['EDITBOX', '숫자 입력 필드', '전체길이, 유효길이, 탭길이'],
      ['R_EDITBOX', '읽기 전용 입력 (회색)', '계산식 결과'],
      ['CHECKBOX', '체크박스 카드', '탭표시'],
      ['RADIO', '세그먼트 컨트롤', '(라디오 버튼) 접미사 옵션'],
    ],
    [1800, 3600, 3960],
  ),

  h2('4.4 옵션 필터 로직'),
  body('PartManager 의 JsonParserService.GetFilteredValues (C# JsonParserService.cs 73줄) 를 1:1 TypeScript 로 포팅. OptionValue 의 filter 배열과 filter_Values 배열을 부모 옵션 선택값과 대조하여 표시/숨김을 결정.'),
  bullet('filter 첫 위치는 "라디오" 위치로 정확 일치 요구'),
  bullet('-1 는 와일드카드'),
  bullet('단일 와일드카드 / 위치 매칭 / 허용값 리스트 세 가지 케이스'),
  bullet('isOptionVisible() 이 false 면 해당 옵션 자체를 숨김'),

  h2('4.5 연결부품 및 영향받는 옵션'),
  body('PartManager 의 특수 옵션 "연결부품명" / "영향받는 옵션" 을 파싱하여 주 부품의 탭 옆에 연결부품 탭을 렌더링.'),
  bullet('연결부품명: "|" 로 복수 연결부품 파싱 (예: "축 그리기|오일 씰")'),
  bullet('영향받는 옵션: "@" 로 쌍 분리, "|" 로 주/연결 분리 (예: "내경|축 지름@내경|내경")'),
  bullet('★ Positional 매핑: names[i] ↔ pairs[i] 로 1:1 대응'),
  bullet('각 연결부품 탭에 "작도" 체크박스 (기본 OFF, 체크 시 프리뷰 포함)'),
  bullet('잠금 (Lock) UI: 영향받는 옵션은 read-only 로 렌더 + 🔒 배지 + "주 부품의 X 값 Y 으로 고정" 힌트'),
  bullet('SyncLinkedPartOption: 주 부품 옵션 변경 시 연결부품의 해당 필드 자동 동기화'),

  h2('4.6 2D/3D 프리뷰'),
  body('PartManager 의 partRenderer.js (5865 줄) 를 수정 없이 재사용. WebView2 API 를 bridge.js 가 shim 하여 postMessage 기반으로 변환.'),
  mono(
`React → iframe:
  { type:'setModel', partCode, dimensions, linkedParts, viewType }
iframe → React:
  { type:'ready' }
  { type:'log', message }`
  ),
  bullet('mode ("2d" | "3d") 변경 시 iframe 강제 리마운트 (key={mode:partCode})'),
  bullet('dimensions dict 생성: applyDimensionKeyMapping → mergeOptions → resolveLengthAndThread 3단계'),
  bullet('DB 키 (M, H, B1(일반)) → 렌더러 키 (d, k, s) 매핑 (ParseAndMapDimensionJson 포팅)'),
  bullet('옵션 값 (사이즈="M10") 의 한↔영 alias 제공 (내경→d1, 전체길이→L)'),

  h2('4.7 주문코드 조회'),
  body('상단 메뉴 "주문코드 조회" 페이지에서 "HBOLT|KS B 1002|M10" 형식 입력 시 partdimension.key_composite 매칭 → 메인으로 이동해 즉시 해당 부품 로드.'),

  h2('4.8 다운로드'),
  body('우측 하단 다운로드 바에 STEP / DWG / IGES / STL 4개 버튼. 현재는 placeholder 텍스트 파일 반환 (실 CAD 생성은 Java 백엔드의 책임).'),

  h2('4.9 다국어 지원'),
  body('react-i18next 로 ko/en/ja/zh 4개 언어 지원. 상단바 LangSwitcher 에서 전환, localStorage 저장.'),

  h2('4.10 폰트 크기 조절'),
  body('상단바의 A A A A 토글로 4단계 폰트 크기 조절 (14/16/17/18px). uiStore 에 persist 저장, CSS 변수로 전역 적용.'),

  h2('4.11 반응형 레이아웃'),
  body('데스크탑 ≥lg: 좌측 사이드바 + 2컬럼 콘텐츠. 모바일: 햄버거 메뉴로 드로어 사이드바. vite 의 host:true 설정으로 LAN 접근 가능 (휴대폰 테스트).'),

  // ===== SECTION 5: 백엔드 프록시 =====
  h1('5. Node.js REST 프록시'),
  h2('5.1 구축 목적'),
  body('브라우저는 보안상 PostgreSQL 에 직접 연결할 수 없으므로 중간 HTTP 서버가 필수. Java 백엔드 완성까지의 공백을 메우는 동시에, Java 팀에게 전달할 REST 엔드포인트 계약의 레퍼런스 구현 역할을 합니다.'),

  h2('5.2 엔드포인트 목록'),
  tbl(
    ['Method', 'Path', '용도'],
    [
      ['POST', '/api/auth/login', '로그인 (placeholder)'],
      ['GET', '/api/auth/me', '현재 사용자'],
      ['POST', '/api/auth/logout', '로그아웃'],
      ['GET', '/api/categories/main', '대분류'],
      ['GET', '/api/categories/sub', '중분류'],
      ['GET', '/api/categories/mid', '소분류'],
      ['GET', '/api/parttypes', '부품 종류'],
      ['GET', '/api/motor/parts', '모터 파트 (Motor_Core)'],
      ['GET', '/api/parts/:code/spec', '부품 스펙 JSON'],
      ['GET', '/api/parts/:code/dimension-meta', '치수 메타'],
      ['GET', '/api/parts/:code/dimension-keys', '치수 키 옵션'],
      ['POST', '/api/parts/:code/dimension/find', '치수 행 조회'],
      ['GET', '/api/parts/find', '부품명/코드 검색 (연결부품용)'],
      ['GET', '/api/search', '주문코드 조회'],
      ['POST', '/api/download', 'CAD 다운로드 (placeholder)'],
      ['GET', '/health', '헬스체크 + DB 연결 상태'],
      ['GET', '/diag/*', '진단용 (스키마/테이블/컬럼)'],
    ],
    [1200, 3200, 4960],
  ),

  h2('5.3 듀얼 데이터베이스 라우팅'),
  body('PostgreSQL 서버 내에 Standard_Core 와 Motor_Core 두 개의 DB 가 있어서, node-postgres 의 Pool 두 개를 생성하고 부품 코드에 따라 자동 라우팅합니다.'),
  mono(
`// db.ts 의 핵심 로직
export const stdPool   = new pg.Pool({ ..., database: 'Standard_Core' });
export const motorPool = new pg.Pool({ ..., database: 'Motor_Core' });

// 앱 시작 시 partspec.part_code 를 양쪽 DB 에서 스캔해 인덱스 빌드
async function buildPartIndex(): Promise<Map<string, DbKind>> { ... }

// 런타임에는 Map 조회로 O(1)
export async function poolForPartCode(partCode: string): Promise<pg.Pool> {
  const idx = await getPartIndex();
  return idx.get(partCode) === 'motor' ? motorPool : stdPool;
}`
  ),

  h2('5.4 JSONB 자동 파싱 대응'),
  body('partdimension.key_values 와 dimension_data 가 PostgreSQL 에서 JSONB 타입이라, node-postgres 가 자동으로 JS 객체로 파싱합니다. 이미 객체인 것을 JSON.parse 하면 SyntaxError — 방어적 파서로 해결.'),
  mono(
`// util/json.ts
export function jsonCell<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === 'object') return value as T;  // JSONB: already parsed
  if (typeof value !== 'string') return fallback;
  try {
    const parsed = JSON.parse(value.trim());
    if (typeof parsed === 'string') return JSON.parse(parsed) as T; // double-encoded
    return parsed as T;
  } catch { return fallback; }
}`
  ),

  h2('5.5 스코어링 기반 findDimension'),
  body('SQLite 의 완전 일치 매칭 대신, 필드별 유사도 점수로 가장 가까운 row 선택. partdimension.key_values 와 스펙 옵션의 value.name 이 미묘하게 달라도 (예: "기계" ↔ "기계용") 올바른 행을 찾음.'),
  bullet('정확 일치: +3 (사이즈 키는 ×2)'),
  bullet('prefix: +2'),
  bullet('수치 동치: +1'),
  bullet('사이즈 필드 (List/사이즈/호칭) 가중치 2배 — 프리뷰 핵심 식별자'),

  // ===== SECTION 6: OpenAPI =====
  h1('6. OpenAPI 명세서'),
  body('bizmech-proxy/openapi.yaml 파일에 OpenAPI 3.0 형식으로 모든 엔드포인트의 요청/응답 스키마를 정의했습니다. Java 개발자는 이 파일만 받아서 Spring Boot 서버 스텁을 자동 생성할 수 있습니다.'),
  mono(
`# Spring 서버 자동 생성
npm install -g @openapitools/openapi-generator-cli
openapi-generator-cli generate \\
  -i bizmech-proxy/openapi.yaml \\
  -g spring \\
  -o java-backend`
  ),
  body('Java 백엔드 준비되면 프론트엔드에서는 .env.local 의 VITE_API_BASE_URL 을 Java 서버 주소로 변경하는 것만으로 전환 완료 — 코드 변경 없음.'),

  // ===== SECTION 7: 문제 해결 히스토리 =====
  h1('7. 주요 이슈 해결 내역'),
  tbl(
    ['No', '증상', '원인', '해결'],
    [
      ['1', '부품 그림 전체가 안 뜸 (blank)', 'sql.js browser 빌드 default export 없음', 'dist/sql-wasm.js 명시 import + optimizeDeps.include'],
      ['2', '카테고리 크롤링 실패', 'Vite 가 public/ 의 viewer.html 까지 스캔', 'optimizeDeps.entries=[index.html] 로 제한'],
      ['3', '사이즈 M3→M10 시각 변화 없음 (1)', '옵션값 "M10" 이 numeric alias d 덮어씀', 'parseFloat 실패 시 alias skip'],
      ['4', '사이즈 M3→M10 시각 변화 없음 (2)', 'findDimension 이 완전일치 실패 → rows[0] (M3) 반환', '스코어링 기반 매칭 + 사이즈 가중치'],
      ['5', '베어링 DGBB 가 앵글러 뒤에 표시', 'parttype.sort_order=0 → 알파벳 2차 정렬', 'ORDER BY sort_order, part_type_id'],
      ['6', '연결부품 1개만 동기화', 'pair 전체를 모든 linked 에 적용', 'getPairsForLinkedName 으로 positional 매핑'],
      ['7', '로그인 후 자동 로그아웃', 'HttpPartApi 가 잘못된 localStorage 키 사용', 'bizmech.auth JSON 파싱으로 수정'],
      ['8', 'PG "boolean = integer" 에러', 'SQLite is_active INT 0/1 → PG BOOLEAN', '모든 쿼리 = 1 → = TRUE 치환'],
      ['9', 'DB 이름 연결 실패', 'spec DB 추측 → 실제는 Standard_Core / Motor_Core', '듀얼 풀 구조로 재설계'],
      ['10', 'dimension 데이터 빈 배열', 'JSONB 를 JSON.parse → SyntaxError', 'jsonCell() 헬퍼 도입'],
      ['11', '연결부품 전체 옵션 폼 미구현', 'LinkedTabBody 간략 뷰', 'PartManager BuildLinkedPartUI 완전 포팅'],
      ['12', 'EDITBOX/CHECKBOX 가 드롭다운으로 표시', 'type 무시하고 Select 로 렌더', 'determineControlType 으로 dispatch'],
    ],
    [600, 2700, 3000, 3060],
  ),

  // ===== SECTION 8: 운영 가이드 =====
  h1('8. 운영 가이드'),

  h2('8.1 개발 환경 실행'),
  body('두 개의 터미널 창이 필요합니다. dev-all.bat 을 더블클릭하면 자동으로 두 창이 열립니다.'),
  mono(
`# 방법 1: 편의 스크립트
D:\\Work\\pgm\\New_Wizard_Pgms\\BizMech개발\\dev-all.bat

# 방법 2: 수동 (두 개의 PowerShell 창)
# 창 1: 프록시
cd bizmech-proxy
npm install
npm run dev     # http://localhost:8080

# 창 2: React dev server
cd BizMech-web
npm install
npm run dev     # http://localhost:5173`
  ),

  h2('8.2 환경 변수'),
  body('각 프로젝트의 .env 파일 (gitignore 처리됨) 에 설정.'),
  body('bizmech-proxy/.env (★ 12장 동적 레지스트리 적용 후):'),
  mono(
`PORT=8080
CORS_ORIGIN=http://localhost:5173
PG_HOST=192.168.0.17
PG_PORT=5432
PG_USER=clickinfo
PG_PASSWORD=<비밀번호>

# ★ 새 카테고리 DB 추가는 여기에 콤마로 이어 붙이기
#   예: Standard_Core,Motor_Core,Cylinder_Core,LmGuide_Core
PG_DATABASES=Standard_Core,Motor_Core
PG_PRIMARY_DB=Standard_Core
PG_DB_ALIASES=std:Standard_Core,motor:Motor_Core`
  ),
  body('BizMech-web/.env.local:'),
  mono(
`# HTTP 모드 (프록시 사용, 실 DB)
VITE_API_MODE=http
VITE_API_BASE_URL=http://localhost:8080/api
VITE_DEFAULT_LANG=ko

# Mock 모드 (sql.js, 오프라인)
# VITE_API_MODE=mock`
  ),

  h2('8.3 헬스체크'),
  mono(
`curl http://localhost:8080/health

{
  "service": "bizmech-proxy",
  "version": "0.2.0",
  "db": {
    "ok": true,
    "std": "OK — Standard_Core — PostgreSQL 10.19 ...",
    "motor": "OK — Motor_Core — PostgreSQL 10.19 ..."
  }
}`
  ),

  h2('8.4 모드 전환'),
  body('Mock 모드 (sql.js 기반, 오프라인 가능) 와 HTTP 모드 (프록시 경유 실 DB) 를 환경변수 한 줄로 전환합니다. 프록시 미실행 시 Mock 모드 권장.'),

  // ===== SECTION 9: 보안 =====
  h1('9. 보안'),
  bullet('자격증명 (.env / .env.local) 은 gitignore 처리 — 커밋 금지'),
  bullet('CORS origin 은 http://localhost:5173 으로 제한'),
  bullet('프록시 /download 는 현재 placeholder — 프로덕션 배포 전 실제 파일 생성 로직 필요'),
  bullet('TLS 없이 LAN 배포 금지 — nginx/Caddy 리버스 프록시 필요'),
  bullet('★ 중요: 대화 중 노출된 Postgres 비밀번호 로테이션 필수'),

  // ===== SECTION 10: 향후 작업 =====
  h1('10. 향후 작업'),
  h2('10.1 Java 백엔드 인수인계'),
  body('Java 팀에게 bizmech-proxy/openapi.yaml 파일을 전달하면 Spring Boot 서버 스텁을 자동 생성할 수 있습니다. 구현 완료 후 BizMech-web/.env.local 의 VITE_API_BASE_URL 을 Java 서버 주소로 변경.'),

  h2('10.2 개선 아이디어'),
  tbl(
    ['카테고리', '내용'],
    [
      ['UX', '즐겨찾기 부품, 최근 본 부품, 다크모드'],
      ['성능', 'Redis 캐싱 (프록시), IndexedDB 오프라인 모드'],
      ['품질', 'Playwright E2E 테스트, Vitest 단위 테스트'],
      ['배포', 'Docker 컨테이너화, CI/CD 파이프라인'],
      ['인증', 'JWT 실인증, SSO (OAuth2/OIDC)'],
      ['실 CAD 생성', 'Java 백엔드 + OpenCascade/FreeCAD'],
      ['3D 공유', '주문코드 URL 딥링크, 스크린샷 내보내기'],
    ],
    [2400, 6960],
  ),

  // ===== SECTION 11: 산출물 =====
  h1('11. 산출물'),
  tbl(
    ['경로', '설명'],
    [
      ['BizMech-web/', 'React 프론트엔드 (30+ 소스 파일, 5개 페이지)'],
      ['BizMech-web/public/viewers/', '2D/3D 뷰어 재사용 자산'],
      ['BizMech-web/public/data/', 'Mock 모드용 SQLite (34MB + 1.8MB)'],
      ['bizmech-proxy/', 'Node.js REST 프록시 서버'],
      ['bizmech-proxy/openapi.yaml', '★ Java 팀 전달용 API 명세서'],
      ['bizmech-proxy/README.md', '운영 가이드'],
      ['dev-all.bat', '두 서버 동시 실행 편의 스크립트'],
    ],
    [4000, 5360],
  ),

  h2('11.1 코드 규모'),
  tbl(
    ['컴포넌트', '파일 수', '주요 LOC'],
    [
      ['프론트엔드 소스', '30+', '~3,500 LOC'],
      ['프록시 소스', '10', '~1,200 LOC'],
      ['재사용 뷰어 JS (원본 유지)', '3', '~5,900 LOC'],
      ['OpenAPI 명세', '1', '~400 LOC'],
    ],
    [4000, 2000, 3360],
  ),

  // ===== SECTION 12: 카테고리 DB 동적 레지스트리 (추가 작업) =====
  h1('12. 카테고리 DB 동적 레지스트리 (추가 작업)'),

  h2('12.1 배경'),
  body('PartManager 가 카테고리별로 SQLite 파일을 별도 관리하는 구조 (Standard_Core.db / Motor_Core.db / Cylinder_Core.db / LmGuide_Core.db …) 와의 호환을 위해, PostgreSQL 측도 카테고리당 별도 DB 로 분리되어 있습니다.'),
  body('이 분리 전략의 가치:'),
  bullet('SQLite 파일 ↔ Postgres DB 의 1:1 대응 — 변환·동기화·증분 백업이 단순'),
  bullet('카테고리별 팀 운영 — 모터팀이 모터 DB만 만지면 표준부품팀과 충돌 없음'),
  bullet('마이그레이션 격리 — 모터 DB 스키마 변경이 표준부품 서비스 다운타임 없이 가능'),
  bullet('★ 구독 모델 친화 — DB 별 PostgreSQL ROLE 권한 분리로 라이선스 위반을 물리적으로 차단'),

  h2('12.2 리팩터 — Before / After'),
  body('초기 구현은 Standard_Core / Motor_Core 가 코드에 하드코딩 되어 있어 새 카테고리 추가 시 소스 수정이 필요했습니다. 환경변수 기반 동적 레지스트리로 개편.'),
  body('Before (❌ 하드코딩):'),
  mono(
`export const stdPool   = new pg.Pool({ ..., database: 'Standard_Core' });
export const motorPool = new pg.Pool({ ..., database: 'Motor_Core'    });
type DbKind = 'std' | 'motor';   // ← 새 DB 추가 시 enum + 코드 수정`
  ),
  body('After (✅ 동적):'),
  mono(
`const pools = new Map<string, pg.Pool>();
export function getPool(dbName: string): pg.Pool {
  if (!pools.has(dbName)) {
    pools.set(dbName, new pg.Pool({ ...baseConfig, database: dbName }));
  }
  return pools.get(dbName)!;
}
export const REGISTERED_DBS = process.env.PG_DATABASES.split(',');`
  ),

  h2('12.3 신규 공개 API'),
  tbl(
    ['함수', '용도'],
    [
      ['getPool(dbName)', 'DB 이름으로 풀 lazy-init + 캐시 반환'],
      ['primaryPool() / primaryDbName()', '카테고리 메타가 있는 주 DB'],
      ['listDatabases()', '등록된 DB 이름 배열'],
      ['query(pool, sql, params)', '풀 + 파라미터 쿼리'],
      ['queryPrimary(sql, params)', '주 DB 쿼리 단축'],
      ['poolForPartCode(code)', 'partCode → DB 자동 라우팅 (인덱스 캐시)'],
      ['poolForSubCategory(code)', 'subCatCode → DB (maincategory.db_file_name 기반)'],
      ['resolveDbAlias("std")', '별칭 → 실 DB 이름'],
      ['ping()', '모든 등록 DB 헬스체크'],
      ['shutdown()', 'SIGTERM/SIGINT 시 모든 풀 종료'],
      ['resetPartIndex() / resetSubDbIndex()', '메모리 인덱스 무효화 (DB 갱신 후)'],
    ],
    [3600, 5760],
  ),

  h2('12.4 신규 진단 엔드포인트'),
  tbl(
    ['Method', 'Path', '용도'],
    [
      ['GET', '/diag/dbs', '등록 DB 목록 + 헬스 + 주 DB'],
      ['GET', '/diag/sub-index', 'subCatCode → DB 매핑 (maincategory.db_file_name 기반)'],
      ['GET', '/diag/index', 'partCode → DB 인덱스 통계 (DB 별 부품 수)'],
      ['POST', '/diag/reset', '양쪽 메모리 인덱스 클리어 (데이터 갱신 후 호출)'],
      ['GET', '/diag/* (기존)', '?db=std (별칭) 또는 ?db=Cylinder_Core (실명) 모두 가능'],
    ],
    [1200, 3000, 5160],
  ),

  h2('12.5 새 카테고리 DB 추가 절차 — 5단계'),
  body('상세 가이드: bizmech-proxy/docs/ADD_NEW_DATABASE.md'),
  body('예시: Cylinder_Core 추가:'),

  h3('1단계 — PostgreSQL 에 새 DB 생성'),
  mono(
`CREATE DATABASE "Cylinder_Core"
  WITH OWNER = clickinfo
       ENCODING = 'UTF8'
       TEMPLATE = template0;`
  ),

  h3('2단계 — 스키마 마이그레이션'),
  mono(
`pg_dump -h 192.168.0.17 -U clickinfo -d Standard_Core \\
        --schema-only \\
        --table=partspec --table=partdimension \\
        --table=dimensionmeta --table=dimensionkeyoption \\
  | psql -h 192.168.0.17 -U clickinfo -d Cylinder_Core`
  ),

  h3('3단계 — 데이터 적재'),
  body('PartManager 가 만든 Cylinder_Core.db 를 pgloader 로 한 번에 이관:'),
  mono(
`pgloader Cylinder_Core.db pgsql://clickinfo:****@192.168.0.17/Cylinder_Core`
  ),

  h3('4단계 — Standard_Core 에 카테고리 메타 등록'),
  mono(
`-- ★ db_file_name 의 값은 정확히 '<DB이름>.db' 형식
INSERT INTO maincategory
  (main_cat_code, main_cat_name_kr, is_standard, sort_order,
   is_active, db_file_name, color_code)
VALUES
  ('CYLINDER', '공압 실린더', false, 6,
   true, 'Cylinder_Core.db', '#06B6D4');

INSERT INTO subcategory
  (sub_cat_code, sub_cat_name_kr, main_cat_code,
   sort_order, is_active, is_vendor)
VALUES
  ('CYLINDER_AIR', '에어 실린더', 'CYLINDER', 1, true, false),
  ('CYLINDER_GUIDE', '가이드 실린더', 'CYLINDER', 2, true, false);`
  ),

  h3('5단계 — 환경변수 한 줄 수정'),
  mono(
`# bizmech-proxy/.env
- PG_DATABASES=Standard_Core,Motor_Core
+ PG_DATABASES=Standard_Core,Motor_Core,Cylinder_Core

# (선택) 친근한 alias
- PG_DB_ALIASES=std:Standard_Core,motor:Motor_Core
+ PG_DB_ALIASES=std:Standard_Core,motor:Motor_Core,cyl:Cylinder_Core`
  ),
  body('프론트엔드의 WEB_VISIBLE 화이트리스트에 main_cat_code 추가 (한 줄씩 두 곳):'),
  mono(
`// BizMech-web/src/services/api/MockPartApi.ts
const WEB_VISIBLE = new Set(['STANDARD', 'MOTOR', 'CYLINDER']);
// bizmech-proxy/src/routes/categories.ts (동일)
const WEB_VISIBLE = new Set(['STANDARD', 'MOTOR', 'CYLINDER']);`
  ),

  h2('12.6 검증 명령'),
  mono(
`# 등록된 DB 모두 확인
curl http://localhost:8080/diag/dbs

# subCategory → DB 매핑 (maincategory.db_file_name 기반)
curl http://localhost:8080/diag/sub-index

# 부품 코드 → DB 인덱스
curl http://localhost:8080/diag/index

# 메모리 인덱스 무효화 (Postgres 데이터 갱신 후)
curl -X POST http://localhost:8080/diag/reset`
  ),
  body('성공 시 시작 로그:'),
  mono(
`  Registered DBs (3): Standard_Core, Motor_Core, Cylinder_Core  [primary=Standard_Core]
  Postgres [Standard_Core]   OK — Standard_Core — PostgreSQL 10.19 ...
  Postgres [Motor_Core]      OK — Motor_Core    — PostgreSQL 10.19 ...
  Postgres [Cylinder_Core]   OK — Cylinder_Core — PostgreSQL 10.19 ...`
  ),

  h2('12.7 향후 — 구독 모델 적용 힌트'),
  body('분리 DB 전략의 진정한 가치는 구독 모델에서 발휘됩니다:'),
  mono(
`-- 표준 부품 전용 ROLE
CREATE ROLE bizmech_basic LOGIN PASSWORD '...';
GRANT CONNECT ON DATABASE "Standard_Core" TO bizmech_basic;

-- 프리미엄 ROLE (실린더·LM가이드 등 추가)
CREATE ROLE bizmech_premium LOGIN PASSWORD '...';
GRANT CONNECT ON DATABASE "Standard_Core" TO bizmech_premium;
GRANT CONNECT ON DATABASE "Motor_Core"    TO bizmech_premium;
GRANT CONNECT ON DATABASE "Cylinder_Core" TO bizmech_premium;`
  ),
  bullet('JWT 의 allowedDbs claim 으로 프록시 미들웨어에서 접근 차단'),
  bullet('카테고리 조회 응답을 allowedDbs 로 필터링'),
  bullet('구독 만료 시 GRANT REVOKE 한 줄로 차단 — 행 단위 권한 (RLS) 보다 단순·안전'),

  h2('12.8 신규 산출물'),
  tbl(
    ['파일', '설명'],
    [
      ['bizmech-proxy/docs/ADD_NEW_DATABASE.md', '새 DB 추가 5단계 가이드 (검증·트러블슈팅 포함)'],
      ['bizmech-proxy/src/db.ts', '동적 레지스트리 패턴 + Map<string, Pool> + 11개 공개 API'],
      ['bizmech-proxy/src/routes/diag.ts', '/diag/dbs, /diag/sub-index, /diag/reset 추가'],
      ['bizmech-proxy/src/index.ts', 'Graceful shutdown (SIGTERM/SIGINT) + 등록 DB 시작 로그'],
      ['bizmech-proxy/.env / .env.example', 'PG_DATABASES, PG_PRIMARY_DB, PG_DB_ALIASES 추가'],
    ],
    [4500, 4860],
  ),

  hr(),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 400 },
    children: [new TextRun({ text: '— END OF REPORT —', font: KR_FONT, size: 20, italics: true, color: GREY })],
  }),
];

// ─────────────────────────────────────────────────────────
// Build
// ─────────────────────────────────────────────────────────
const doc = new Document({
  creator: 'Claude',
  title: 'BizMech 개발 진행 보고서',
  description: 'BizMech 웹 애플리케이션 개발 완료 보고서',
  // ★ Tell Word to recompute all fields (TOC, page numbers) when the file
  //   is first opened — otherwise the user has to press F9 manually.
  features: { updateFields: true },
  styles: {
    default: { document: { run: { font: KR_FONT, size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { font: KR_FONT, size: 36, bold: true, color: BRAND },
        paragraph: { spacing: { before: 360, after: 180 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { font: KR_FONT, size: 28, bold: true, color: BRAND },
        paragraph: { spacing: { before: 280, after: 140 }, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { font: KR_FONT, size: 24, bold: true, color: ACCENT },
        paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 2 } },
    ],
  },
  numbering: {
    config: [
      { reference: 'bullets',
        levels: [
          { level: 0, format: LevelFormat.BULLET, text: '\u2022', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
          { level: 1, format: LevelFormat.BULLET, text: '\u25E6', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 1440, hanging: 360 } } } },
        ],
      },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      },
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [new TextRun({ text: 'BizMech 개발 진행 보고서', font: KR_FONT, size: 18, color: GREY })],
        })],
      }),
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: '- ', font: KR_FONT, size: 18, color: GREY }),
            new TextRun({ children: [PageNumber.CURRENT], font: KR_FONT, size: 18, color: GREY }),
            new TextRun({ text: ' -', font: KR_FONT, size: 18, color: GREY }),
          ],
        })],
      }),
    },
    children: content,
  }],
});

Packer.toBuffer(doc).then(buf => {
  const outPath = 'D:/Work/pgm/New_Wizard_Pgms/BizMech개발/BizMech_개발진행보고서.docx';
  fs.writeFileSync(outPath, buf);
  console.log('created:', outPath, '(', buf.length, 'bytes )');
});
