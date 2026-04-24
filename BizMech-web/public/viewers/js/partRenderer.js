/**
 * PartManager 3D Part Renderer
 * ─────────────────────────────
 * Three.js 기반 기계 부품 3D 렌더러
 * WPF WebView2와 웹 브라우저 모두에서 사용 가능
 * 
 * ★ 이 파일은 향후 웹 부품 카탈로그에서 재사용됩니다
 * 
 * 지원 부품 (13종):
 *   볼트류: HBOLT, SBOLT, SRBOLT, FBOLT, FLBOLT, STBOLT, SQBOLT
 *   모터류: SERVO_MOTOR (서보모터 SGM-7 계열, v50: Brake 옵션 지원)
 *   너트류: NUT(HNUT), FNUT
 *   와셔류: PWAS, SWAS
 *   베어링: DGBB (깊은 홈 볼 베어링)
 *
 * ═══════════════════════════════════════════════════════════════
 *  v50 변경점 (2026.04 — 1세션차: 모터 옵션 인프라 + Brake)
 * ═══════════════════════════════════════════════════════════════
 *   1. updateModel()에 motorOptions 파라미터 추가 (C# 측 SpecSelectorResponse.Options 전달)
 *   2. resolveMotorOpts() 헬퍼 — 옵션 명시 우선, 없으면 dims 기반 자동 판정
 *      (C++ MotorCreator::SetMotorOptions 로직 동일)
 *   3. buildServoMotor / buildServoMotorDimOnly에 Brake 분기:
 *      - hasBrake=true → L1/L2/L3/LX를 LO1(LLO)/LO2/LO3/LO로 자동 치환
 *      - Brake Module (steelDark, 2mm 안쪽) + Brake Cover (aluminum, 도넛 속빔) 추가
 *      - Encoder 위치를 [-(L2+SL) ~ -L1]로 자동 시프트
 *   4. Encoder connector encMidY 버그 수정 (구간 중점 사용)
 *
 * ═══════════════════════════════════════════════════════════════
 *  v50 변경점 (2026.04 — 2세션차: Gearhead 분기)
 * ═══════════════════════════════════════════════════════════════
 *   1. buildServoMotor에 hasGearhead 분기:
 *      - hasGearhead=true 시 모터 샤프트/베어링 보스 숨김 (감속기 내부로 가려짐)
 *      - Gearhead Body(G_LD 원통 or G_LC*0.95 사각 폴백) + Flange(G_LC×G_LG)
 *        + Pilot1(G_LB×G_LE) + Pilot2(G_LD×pilot2Len) 플랜지 앞쪽(+Y)에 추가
 *      - 감속기 출력축 다단 (G_B→G_C→G_S) 구현 (C++ CreateGearheadShaftPart 포팅)
 *      - PCD G_LA에 4개 × Ø G_LZ 마운팅 홀
 *   2. buildServoMotorDimOnly에 Gearhead 치수선 분기:
 *      - 길이: G_LG, G_LE, G_LL/G_LLO, G_LR (+X 방향 별도 레벨로 겹침 방지)
 *      - 지름: Ø G_S, G_LB, G_LA PCD (Y 위치 분산)
 *      - 폭: G_LC (플랜지 외곽), G_LD (바디/Pilot2)
 *
 * ═══════════════════════════════════════════════════════════════
 *  v50 변경점 (2026.04 — 3세션차: Stepper 모터 + OilSeal 인식)
 * ═══════════════════════════════════════════════════════════════
 *   1. buildStepperMotor / buildStepperMotorDimOnly 신규:
 *      - NEMA 사각 프레임 (단일 블록, 엔코더 없음)
 *      - 짧은 샤프트 (LR × S) + 리드선 출구 (MnL 길이, -Y → -Z L자 케이블)
 *      - Brake 옵션 지원 (Servo와 동일 규칙으로 SL 길이 Brake Module 추가)
 *      - 마운팅 홀 45° × 4개 (NEMA 표준 PCD)
 *   2. PART_BUILDERS에 STEPPER_MOTOR 등록 — SMOT/PKP/PKE/STEP_MOTOR 키워드로 매칭
 *   3. resolveMotorOpts에 hasOilSeal 자동 판정 추가 (LB1 > 0 || LE1 > 0)
 *      → 향후 OilSeal 커버 3단 테이퍼 구현 시 활용 예정
 *   4. partRenderer2D.js 대응 업데이트 — options 인프라, drawServoMotor_Side/Top
 *      Brake/Gearhead 분기, drawStepperMotor_* 신규 3면도
 *
 * ═══════════════════════════════════════════════════════════════
 *  v50 변경점 (2026.04 — 4세션차: 커넥터 상세화 IX40 + 본체 소켓 핀)
 * ═══════════════════════════════════════════════════════════════
 *   1. MAT에 stainlessBrush, brassGold 재질 추가
 *   2. _buildIX40Plug 헬퍼 신규 — C++ CreateDetailedIX40Part 포팅
 *      - Cable Outlet(고무 원통) + Connector Body(테이퍼) + Mating Shell(A-Key 외곽, 스테인레스)
 *        + Pin Holes 8개 작은 사각 홀
 *      - alongDir 파라미터로 임의 방향 진행 지원, scale 배율 지원
 *   3. _buildConnectorSocket 헬퍼 신규 — 본체 소켓 상세화
 *      - 검정 플라스틱 셸 + 어두운 개구부 + 4개 금색 핀(brassGold)
 *      - facing 파라미터로 핀 개구 방향 자유 설정
 *   4. _buildLCable의 endConnector를 {type:'IX40', scale} 또는 'IX40' 문자열로 지정 가능
 *      (기존 {w,h,d,material} 객체 형태도 하위 호환 유지)
 *   5. buildServoMotor의 엔코더 커넥터 섹션이 _buildConnectorSocket + IX40 플러그 사용
 *      → 이미지 2의 본체 상단 소켓 + 케이블 끝 플러그 마킹 영역 시각적으로 재현
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

// ═══════════════════════════════════════════════
// 전역 상태
// ═══════════════════════════════════════════════

let scene, camera, renderer, css2dRenderer, controls;
let modelGroup = null;
let dimGroup   = null;
let linkedGroup = null;   // ★ 연결부품 전용 Group
let gridHelper = null;

let currentPartCode = '';
let currentDimensions = {};
let currentLinkedParts = [];   // ★ 연결부품 목록 { partCode, dimensions, isDrawEnabled, ... }
let currentMotorOptions = {};  // ★ v50 모터 옵션 { hasBrake, hasGearhead, hasEncoder, hasOilSeal, hasConnector, bodyType, shaftType, flangType }

// ═══════════════════════════════════════════════
// ★ 치수 참조 패널 — 약어 ↔ 전체명 매핑
//   renderedDimensions: 실제로 addDimLabel이 호출된 치수만 수집
//   currentDimMeta: C#에서 전달된 { field_name → display_name } 매핑
// ═══════════════════════════════════════════════
let renderedDimensions = [];  // 이번 렌더링에서 실제 그려진 치수 [{ name, value }]
let currentDimMeta     = {};  // { "LX": "전체 길이", "LB": "Body 길이", ... }
// ★ 패널 UI 텍스트 (C# 에서 현재 언어에 맞게 번역해 전달)
//   __panel_title / __panel_empty / __panel_no_mapping / __panel_count_unit
//   fallback: 한국어 기본값 (C# 이 빈 dimMeta 를 보낼 경우 대비)
let currentPanelText = {
    title:       '📏 치수 정보',
    empty:       '표시된 치수가 없습니다',
    noMapping:   '매핑된 치수명 없음',
    countUnit:   '개'
};

let options = {
    dimensions: true,
    wireframe: false,
    grid: true,
    dimPanel: false           // ★ 치수 참조 패널 표시 여부 (기본 OFF)
};

// ── 재질 ──
const steelMaterial = new THREE.MeshStandardMaterial({ color: 0xB4B9BE, metalness: 0.55, roughness: 0.35 });
const darkSteelMaterial = new THREE.MeshStandardMaterial({ color: 0x69707A, metalness: 0.42, roughness: 0.50 });
const blackOxideMaterial = new THREE.MeshStandardMaterial({ color: 0x2D3436, metalness: 0.45, roughness: 0.42 });
const springMaterial = new THREE.MeshStandardMaterial({ color: 0x7D8A96, metalness: 0.52, roughness: 0.32 });

// ── 베어링 재질 ──
// v46: DoubleSide 복구.
//   이유: DGBB/ANBB/TRBR/CYLR/THRB/SRRB의 LatheGeometry 프로파일이
//   시계방향 순서로 작성되어 FrontSide에서 외부 법선이 안쪽을 향함.
//   DoubleSide로 양면 렌더링해야 외륜이 투명하게 보이지 않음.
//
//   UC 계열(buildUNIT)은 v42에서 프로파일을 반시계로 재배열해 별도의
//   outerRingMat(FrontSide)를 사용하므로 이 변경과 무관.
const bearingRingMaterial = new THREE.MeshStandardMaterial({
    color: 0xCDD0D4, metalness: 0.48, roughness: 0.28,
    side: THREE.DoubleSide
});
const bearingBallMaterial = new THREE.MeshStandardMaterial({
    color: 0xE8EAEC, metalness: 0.55, roughness: 0.14
});
const bearingSealMaterial = new THREE.MeshStandardMaterial({
    color: 0x2A2A40, metalness: 0.12, roughness: 0.82,
    side: THREE.DoubleSide
});
const bearingShieldMaterial = new THREE.MeshStandardMaterial({
    color: 0x9BA4B0, metalness: 0.42, roughness: 0.32,
    side: THREE.DoubleSide
});
const snapRingMaterial = new THREE.MeshStandardMaterial({
    color: 0x5A6068, metalness: 0.38, roughness: 0.48
});

const dimLineMaterial = new THREE.LineBasicMaterial({ color: 0x374151, linewidth: 1.5 });
const dimExtLineMaterial = new THREE.LineBasicMaterial({ color: 0x374151, linewidth: 1, opacity: 0.8, transparent: true });

// ═══════════════════════════════════════════════
// 공용 Shape 헬퍼
// ═══════════════════════════════════════════════

/** 원형 Shape (관통 구멍 포함) */
function createCircleShapeWithHole(outerR, innerR, segs = 48) {
    const s = new THREE.Shape();
    for (let i = 0; i <= segs; i++) {
        const a = (Math.PI * 2 * i) / segs;
        if (i === 0) s.moveTo(outerR * Math.cos(a), outerR * Math.sin(a));
        else s.lineTo(outerR * Math.cos(a), outerR * Math.sin(a));
    }
    if (innerR > 0) {
        const h = new THREE.Path();
        for (let i = 0; i <= segs; i++) {
            const a = (Math.PI * 2 * i) / segs;
            if (i === 0) h.moveTo(innerR * Math.cos(a), innerR * Math.sin(a));
            else h.lineTo(innerR * Math.cos(a), innerR * Math.sin(a));
        }
        s.holes.push(h);
    }
    return s;
}

/** 육각형 Shape (관통 구멍 포함) */
function createHexShapeWithHole(outerR, innerR) {
    const s = new THREE.Shape();
    for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 6;
        if (i === 0) s.moveTo(outerR * Math.cos(a), outerR * Math.sin(a));
        else s.lineTo(outerR * Math.cos(a), outerR * Math.sin(a));
    }
    s.closePath();
    if (innerR > 0) {
        const h = new THREE.Path();
        for (let i = 0; i <= 32; i++) {
            const a = (Math.PI * 2 * i) / 32;
            if (i === 0) h.moveTo(innerR * Math.cos(a), innerR * Math.sin(a));
            else h.lineTo(innerR * Math.cos(a), innerR * Math.sin(a));
        }
        s.holes.push(h);
    }
    return s;
}

// ═══════════════════════════════════════════════
// 공용 3D 헬퍼
// ═══════════════════════════════════════════════

/** 나사산 링 (볼트 공용) */
/**
 * LatheGeometry 프로파일 배열(pts)에 두 점 사이의 호(arc) 중간점들을 추가.
 *
 * C++ CreateSketchArc(center, startPt, endPt, bFlag) 이식용 헬퍼.
 *
 * @param {THREE.Vector2[]} pts   누적 포인트 배열 (시작점은 이미 push되어 있어야 함)
 * @param {number} cx, cy         호의 중심점 (Lathe 좌표: x=반경, y=축)
 * @param {number} sx, sy         시작점
 * @param {number} ex, ey         끝점
 * @param {boolean} shortArc      true → 최소 호(minor), false → 최대 호(major)
 * @param {number} segments       분할 수 (기본 16)
 *
 * 이 함수는 끝점(ex,ey)을 **포함하지 않은** 중간 점들만 추가합니다.
 * 끝점은 호출자가 별도로 push해야 합니다 (C++의 점 기반 스케치와 동일 구조).
 */
function appendLatheArc(pts, cx, cy, sx, sy, ex, ey, shortArc = true, segments = 16) {
    const r = Math.hypot(sx - cx, sy - cy);
    let a1 = Math.atan2(sy - cy, sx - cx);
    let a2 = Math.atan2(ey - cy, ex - cx);
    let delta = a2 - a1;
    // |delta| ≤ π로 정규화 → 이게 minor arc 방향
    while (delta >  Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    if (!shortArc) {
        delta = delta > 0 ? delta - Math.PI * 2 : delta + Math.PI * 2;
    }
    for (let i = 1; i < segments; i++) {
        const t = i / segments;
        const a = a1 + delta * t;
        pts.push(new THREE.Vector2(cx + r * Math.cos(a), cy + r * Math.sin(a)));
    }
}

// ══════════════════════════════════════════════════════════════════════
//  ★ 공용 빌더 헬퍼 (v48) — 모든 부품 공통
//
//  여러 부품 빌더에서 반복되던 패턴을 공통 함수로 분리.
//  재사용 대상 부품:
//   - 모터 (SERVO_MOTOR)
//   - 베어링 (DGBB, UCB, PILB 등)
//   - 샤프트, 볼트, 너트 등
//
//  네임스페이스 컨벤션:
//   - MAT : 재질 프리셋 (체이닝 가능한 팩토리)
//   - _build* : 메시 생성 헬퍼 (modelGroup에 추가)
//   - _parse* : 문자열 치수 파싱
// ══════════════════════════════════════════════════════════════════════

/** 재질 프리셋 — clone()해서 사용 권장 */
const MAT = {
    aluminum:    () => new THREE.MeshStandardMaterial({ color: 0xB8BCC2, metalness: 0.68, roughness: 0.30 }),
    aluminumDark:() => new THREE.MeshStandardMaterial({ color: 0x9CA0A6, metalness: 0.70, roughness: 0.35 }),
    steelCast:   () => new THREE.MeshStandardMaterial({ color: 0xC8CCD0, metalness: 0.55, roughness: 0.42 }),
    steelMild:   () => new THREE.MeshStandardMaterial({ color: 0xB4B9BE, metalness: 0.55, roughness: 0.35 }),
    steelDark:   () => new THREE.MeshStandardMaterial({ color: 0x69707A, metalness: 0.42, roughness: 0.50 }),
    stainlessBrush:() => new THREE.MeshStandardMaterial({ color: 0xD0D4D8, metalness: 0.65, roughness: 0.40 }),   // ★ v50 커넥터 Mating Shell용
    chrome:      () => new THREE.MeshStandardMaterial({ color: 0xC8CDD3, metalness: 0.90, roughness: 0.12 }),
    brassGold:   () => new THREE.MeshStandardMaterial({ color: 0xE2B55D, metalness: 0.85, roughness: 0.25 }),     // ★ v50 커넥터 핀용
    plasticBlack:() => new THREE.MeshStandardMaterial({ color: 0x1A1A1A, metalness: 0.25, roughness: 0.72 }),
    plasticDark: () => new THREE.MeshStandardMaterial({ color: 0x1E1E22, metalness: 0.40, roughness: 0.65 }),
    rubberBlack: () => new THREE.MeshStandardMaterial({ color: 0x2A2A2A, metalness: 0.10, roughness: 0.85 }),
    boltBlack:   () => new THREE.MeshStandardMaterial({ color: 0x2D3439, metalness: 0.55, roughness: 0.40 }),
    boltHole:    () => new THREE.MeshStandardMaterial({ color: 0x0D0D0D, metalness: 0.30, roughness: 0.90 })
};

/**
 * "M3", "M5" 등 메트릭 탭 문자열을 지름(mm)으로 파싱.
 * @param {string|undefined} str - "M3", "M5x0.5" 등
 * @param {number} fallback - 파싱 실패 시 기본 지름 (기본 3mm)
 * @returns {number} 탭 공칭 지름 mm
 */
function _parseTapSize(str, fallback = 3) {
    if (!str || typeof str !== 'string') return fallback;
    const m = /M(\d+(?:\.\d+)?)/.exec(str);
    return m ? parseFloat(m[1]) : fallback;
}

/**
 * 라운드 사각형 Shape 생성 (중앙 홀 옵션).
 * @param {number} w, h - 가로, 세로
 * @param {number} r - 모서리 라운드 반경
 * @param {number} holeR - 중앙 원형 홀 반경 (0이면 홀 없음)
 * @returns {THREE.Shape}
 */
function _roundRectShape(w, h, r, holeR = 0) {
    const hw = w / 2, hh = h / 2;
    r = Math.min(r, hw * 0.5, hh * 0.5);
    const s = new THREE.Shape();
    s.moveTo(-hw + r, -hh);
    s.lineTo( hw - r, -hh); s.quadraticCurveTo( hw, -hh,  hw, -hh + r);
    s.lineTo( hw,  hh - r); s.quadraticCurveTo( hw,  hh,  hw - r,  hh);
    s.lineTo(-hw + r,  hh); s.quadraticCurveTo(-hw,  hh, -hw,  hh - r);
    s.lineTo(-hw, -hh + r); s.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
    s.closePath();
    if (holeR > 0.01) {
        const h2 = new THREE.Path();
        for (let i = 0; i <= 32; i++) {
            const a = (Math.PI * 2 * i) / 32;
            if (i === 0) h2.moveTo(holeR * Math.cos(a), holeR * Math.sin(a));
            else h2.lineTo(holeR * Math.cos(a), holeR * Math.sin(a));
        }
        s.holes.push(h2);
    }
    return s;
}

/** 원형 Shape (도넛 옵션) */
function _circleShape(outerR, innerR = 0) {
    const s = new THREE.Shape();
    for (let i = 0; i <= 48; i++) {
        const a = (Math.PI * 2 * i) / 48;
        if (i === 0) s.moveTo(outerR * Math.cos(a), outerR * Math.sin(a));
        else         s.lineTo(outerR * Math.cos(a), outerR * Math.sin(a));
    }
    if (innerR > 0.01) {
        const h = new THREE.Path();
        for (let i = 0; i <= 32; i++) {
            const a = (Math.PI * 2 * i) / 32;
            if (i === 0) h.moveTo(innerR * Math.cos(a), innerR * Math.sin(a));
            else         h.lineTo(innerR * Math.cos(a), innerR * Math.sin(a));
        }
        s.holes.push(h);
    }
    return s;
}

/** Shape를 Y축 방향으로 돌출 (단면이 XZ평면) */
function _extrudeShapeY(shape, depth) {
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
    geo.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
    return geo;
}

/**
 * 라운드 사각형 바디 생성 + modelGroup에 추가.
 * @param {object} opts
 *   w, h      : 가로, 세로
 *   depth     : 축방향(Y) 길이
 *   posY      : 시작 Y 위치 (base of extrusion)
 *   cornerR   : 모서리 라운드
 *   holeR     : 중앙 홀 반경 (0이면 없음)
 *   material  : THREE.Material (MAT.xxx()로 생성 권장)
 *   offsetX, offsetZ : 중심 오프셋 (0, 0 기본)
 * @returns {THREE.Mesh}
 */
function _buildRoundedBox(opts) {
    const { w, h, depth, posY, cornerR = 0.6, holeR = 0, material,
            offsetX = 0, offsetZ = 0 } = opts;
    const shape = _roundRectShape(w, h, cornerR, holeR);
    const geo = _extrudeShapeY(shape, depth);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(offsetX, posY, offsetZ);
    modelGroup.add(mesh);
    return mesh;
}

/**
 * 원통형 바디 생성 + modelGroup에 추가.
 * 축은 Y방향 (CylinderGeometry 기본).
 */
function _buildCylinder(opts) {
    const { dia, length, posY, material,
            offsetX = 0, offsetZ = 0, segments = 48 } = opts;
    const geo = new THREE.CylinderGeometry(dia / 2, dia / 2, length, segments);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(offsetX, posY + length / 2, offsetZ);
    modelGroup.add(mesh);
    return mesh;
}

/**
 * 샤프트 (원기둥 + 끝 모따기) 생성.
 * @param {object} opts
 *   dia       : 샤프트 지름
 *   length    : 전체 샤프트 길이
 *   posY      : 샤프트 끝단 Y 위치 (=0이면 원점)
 *   tipTowards: 'minus' (posY에서 -Y방향으로 뻗음) | 'plus' (+Y방향)
 *   material
 *   chamferRatio : 0.08 기본 (축 끝 테이퍼 비율)
 */
function _buildShaftWithChamfer(opts) {
    const { dia, length, posY, tipTowards = 'minus', material,
            chamferRatio = 0.08, segments = 32 } = opts;
    const shR = dia / 2;
    const chamLen = Math.max(dia * chamferRatio, 0.3);
    const mainLen = Math.max(length - chamLen, length * 0.7);
    const dir = (tipTowards === 'minus') ? -1 : 1;

    // 주축
    const shaftGeo = new THREE.CylinderGeometry(shR, shR, mainLen, segments);
    const shaftMesh = new THREE.Mesh(shaftGeo, material);
    shaftMesh.position.set(0, posY + dir * (chamLen + mainLen / 2), 0);
    modelGroup.add(shaftMesh);

    // 끝 모따기 (posY 쪽에 작은 테이퍼)
    const chamGeo = new THREE.CylinderGeometry(
        dir === -1 ? shR * 0.88 : shR,
        dir === -1 ? shR : shR * 0.88,
        chamLen, segments
    );
    const chamMesh = new THREE.Mesh(chamGeo, material);
    chamMesh.position.set(0, posY + dir * chamLen / 2, 0);
    modelGroup.add(chamMesh);

    return { shaftMesh, chamMesh };
}

/**
 * PCD 원형 마운팅 홀 패턴 생성.
 * @param {object} opts
 *   count     : 홀 개수 (4 기본)
 *   pcd       : PCD 지름
 *   holeR     : 홀 반경 (=탭 지름/2)
 *   depth     : 홀 축방향 깊이
 *   posY      : 홀 시작 Y 위치
 *   startAngle: 첫 홀 각도 (라디안, π/4=45° 기본)
 *   material  : 홀 색상 (MAT.boltHole() 기본)
 */
function _buildMountingHoles(opts) {
    const { count = 4, pcd, holeR, depth, posY,
            startAngle = Math.PI / 4,
            material = MAT.boltHole(),
            segments = 12 } = opts;
    const meshes = [];
    for (let i = 0; i < count; i++) {
        const a = startAngle + (Math.PI * 2 * i / count);
        const hx = (pcd / 2) * Math.cos(a);
        const hz = (pcd / 2) * Math.sin(a);
        const g = new THREE.CylinderGeometry(holeR, holeR, depth + 0.4, segments);
        const m = new THREE.Mesh(g, material.clone());
        m.position.set(hx, posY + depth / 2, hz);
        modelGroup.add(m);
        meshes.push(m);
    }
    return meshes;
}

/**
 * L자/S자 케이블 생성 (커넥터 출구 → 꺾임 1~2회 → 끝 커넥터).
 *
 * @param {object} opts
 *   start        : THREE.Vector3 시작점 (커넥터 출구)
 *   dir1         : 1단계 방향 ('+z', '-z', '+y', '-y', '+x', '-x')
 *   len1         : 1단계 길이
 *   dir2         : 2단계 방향 (꺾임 후)
 *   len2         : 2단계 길이
 *   dir3         : (선택) 3단계 방향 — 지정 시 S자 경로
 *   len3         : (선택) 3단계 길이
 *   dia          : 케이블 지름
 *   material     : 케이블 재질 (MAT.rubberBlack() 기본)
 *   endConnector : 끝 커넥터 — null | 'IX40' | {type:'IX40',scale} | {w,h,d,material}
 */
function _buildLCable(opts) {
    const { start, dir1, len1, dir2, len2,
            dir3 = null, len3 = 0,
            dia,
            material = MAT.rubberBlack(),
            endConnector = null } = opts;

    const dirVec = (d) => ({
        '+x': [1, 0, 0], '-x': [-1, 0, 0],
        '+y': [0, 1, 0], '-y': [0, -1, 0],
        '+z': [0, 0, 1], '-z': [0, 0, -1]
    }[d]);
    const v1 = dirVec(dir1), v2 = dirVec(dir2);
    if (!v1 || !v2) return;
    const v3 = dir3 ? dirVec(dir3) : null;
    const has3rd = !!(v3 && len3 > 0);

    // 축 방향을 Y축(기본 Cylinder)에서 회전시키는 함수
    const makeAlignedCyl = (dirKey, length, mid) => {
        const g = new THREE.CylinderGeometry(dia / 2, dia / 2, length, 12);
        if (dirKey === '+x' || dirKey === '-x') g.applyMatrix4(new THREE.Matrix4().makeRotationZ(Math.PI / 2));
        else if (dirKey === '+z' || dirKey === '-z') g.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
        const m = new THREE.Mesh(g, material.clone());
        m.position.copy(mid);
        modelGroup.add(m);
        return m;
    };
    const makeElbow = (at) => {
        const eg = new THREE.SphereGeometry(dia / 2 * 1.15, 12, 8);
        const em = new THREE.Mesh(eg, material.clone());
        em.position.copy(at);
        modelGroup.add(em);
    };

    // 1단계
    const mid1 = new THREE.Vector3(
        start.x + v1[0] * len1 / 2,
        start.y + v1[1] * len1 / 2,
        start.z + v1[2] * len1 / 2
    );
    const elbow1 = new THREE.Vector3(
        start.x + v1[0] * len1,
        start.y + v1[1] * len1,
        start.z + v1[2] * len1
    );
    makeAlignedCyl(dir1, len1, mid1);
    makeElbow(elbow1);

    // 2단계
    const mid2 = new THREE.Vector3(
        elbow1.x + v2[0] * len2 / 2,
        elbow1.y + v2[1] * len2 / 2,
        elbow1.z + v2[2] * len2 / 2
    );
    const elbow2 = new THREE.Vector3(
        elbow1.x + v2[0] * len2,
        elbow1.y + v2[1] * len2,
        elbow1.z + v2[2] * len2
    );
    makeAlignedCyl(dir2, len2, mid2);

    // 3단계 (선택)
    let endPt;
    if (has3rd) {
        makeElbow(elbow2);
        const mid3 = new THREE.Vector3(
            elbow2.x + v3[0] * len3 / 2,
            elbow2.y + v3[1] * len3 / 2,
            elbow2.z + v3[2] * len3 / 2
        );
        endPt = new THREE.Vector3(
            elbow2.x + v3[0] * len3,
            elbow2.y + v3[1] * len3,
            elbow2.z + v3[2] * len3
        );
        makeAlignedCyl(dir3, len3, mid3);
    } else {
        endPt = elbow2;
    }

    // 끝 커넥터
    if (endConnector) {
        // ★ v50 커넥터 상세화: endConnector 값에 따라 분기
        //   'IX40' 문자열 : IX40 커넥터 플러그 (Yaskawa 엔코더용 표준)
        //   객체 {w,h,d,material} : 기존 간단 박스 (하위 호환)
        if (endConnector === 'IX40' || (endConnector.type === 'IX40')) {
            // IX40 플러그 — 케이블 끝단에서 케이블 진행 방향(마지막 단계)으로 이어서 붙음
            const scale = (typeof endConnector === 'object' && endConnector.scale) || 1.0;
            const finalDir = has3rd ? dir3 : dir2;
            _buildIX40Plug({
                origin: endPt,
                alongDir: finalDir,
                cableDia: dia,
                scale: scale
            });
        } else {
            // 기존 간단 박스 (하위 호환)
            const { w = dia * 2, h = dia * 2, d: ed = dia * 1.5,
                    material: endMat = MAT.plasticBlack() } = endConnector;
            const eg = new THREE.BoxGeometry(w, h, ed);
            const em = new THREE.Mesh(eg, endMat);
            em.position.copy(endPt);
            modelGroup.add(em);
        }
    }
}

/**
 * ★ v50: IX40 커넥터 플러그 (Yaskawa 엔코더 표준 커넥터, 22.9mm × 14.3mm × 8.4mm).
 *
 * C++ MotorCreator::CreateDetailedIX40Part 포팅.
 * 4개 구성:
 *   [1] Cable Outlet    — 고무 부트, Ø6.8 × 길이 3.2 (검정)
 *   [2] Connector Body  — 테이퍼 본체, 14.0(L) × 14.3(H) × 8.4(W) (검정 플라스틱)
 *                         테이퍼: 처음 3mm는 좁음(= Outlet 지름), 6mm에 걸쳐 넓어지다가 5mm 평탄
 *   [3] Mating Shell    — 전면 체결부, 5.7(L) × 7.15(H) × 4.2(W), 스테인레스 브러시 재질
 *                         A-Key 외곽(우측 하단 모따기) + 중앙 ▣ 홀
 *   [4] Pin Holes       — Mating Shell 전면 8개 작은 사각 홀 (시각적으로 2×4 격자 어두운 마크로 표현)
 *
 * C++ 좌표: X 방향이 플러그 진행 축 (케이블 끝 → 전면 체결부)
 * JS 매핑: alongDir 파라미터로 임의 방향 지정 (기본 '+y')
 *
 *  @param {object} opts
 *    origin    : THREE.Vector3 — 케이블 끝단 위치 (Outlet 후면 중심)
 *    alongDir  : 플러그 진행 방향 ('+x','-x','+y','-y','+z','-z')
 *    cableDia  : 케이블 지름 (Outlet 기본 지름으로 사용, 없으면 6.8mm)
 *    scale     : 전체 크기 배율 (기본 1.0)
 */
function _buildIX40Plug(opts) {
    const { origin, alongDir = '+y', cableDia, scale = 1.0 } = opts;

    // 치수 (C++ 원본: m_unit=1 기준 mm 단위)
    const Length_Outlet       = 3.2  * scale;
    const Length_Body         = 14.0 * scale;
    const Length_MatingShell  = 5.7  * scale;
    const Length_Total        = Length_Outlet + Length_Body + Length_MatingShell;   // 22.9
    const Dia_CableOutlet     = (cableDia || 6.8) * scale;  // 케이블 지름 있으면 우선
    const Height_Total        = 14.3 * scale;
    const Width_Body          = 8.4  * scale;
    const Height_MatingShell  = 7.15 * scale;
    const Width_MatingShell   = 4.2  * scale;

    // ─── 구성요소를 먼저 로컬 좌표(+X를 진행축)로 그린 뒤 회전/이동 ───
    const plugGroup = new THREE.Group();

    // [1] Cable Outlet (원통, 로컬 X=[0, Length_Outlet])
    const outletGeo = new THREE.CylinderGeometry(Dia_CableOutlet / 2, Dia_CableOutlet / 2, Length_Outlet, 16);
    // Cylinder는 기본 Y축 방향 → Z축 회전해서 X축으로 눕힘
    outletGeo.applyMatrix4(new THREE.Matrix4().makeRotationZ(Math.PI / 2));
    const outletMesh = new THREE.Mesh(outletGeo, MAT.rubberBlack());
    outletMesh.position.x = Length_Outlet / 2;
    plugGroup.add(outletMesh);

    // [2] Connector Body (테이퍼, Extrude XY 평면 프로파일)
    //   C++ SetSketchPoint 좌표를 Three.js Shape로 재구성
    const xStart      = Length_Outlet;         // 3.2
    const xTaperStart = xStart + 3.0 * scale;  // 6.2
    const xTaperEnd   = xTaperStart + 6.0 * scale; // 12.2
    const xBodyEnd    = xStart + Length_Body;  // 17.2

    const hSmall = Dia_CableOutlet / 2;        // 시작부는 Outlet 지름과 같게
    const hLarge = Height_Total / 2;            // 7.15

    const bodyShape = new THREE.Shape();
    bodyShape.moveTo(xStart,      hSmall);
    bodyShape.lineTo(xTaperStart, hSmall);
    bodyShape.lineTo(xTaperEnd,   hLarge);
    bodyShape.lineTo(xBodyEnd,    hLarge);
    bodyShape.lineTo(xBodyEnd,   -hLarge);
    bodyShape.lineTo(xTaperEnd,  -hLarge);
    bodyShape.lineTo(xTaperStart,-hSmall);
    bodyShape.lineTo(xStart,     -hSmall);
    bodyShape.closePath();

    const bodyGeo = new THREE.ExtrudeGeometry(bodyShape, {
        depth: Width_Body,
        bevelEnabled: false
    });
    // Extrude는 +Z 방향으로 돌출됨 → 중심이 Z=Width_Body/2. 이를 Z=0 기준 중심으로 이동
    bodyGeo.translate(0, 0, -Width_Body / 2);
    const bodyMesh = new THREE.Mesh(bodyGeo, MAT.plasticBlack());
    plugGroup.add(bodyMesh);

    // [3] Mating Shell (A-Key 외곽 + 내부 홀, xBodyEnd부터 Length_MatingShell 길이)
    //   C++ 순서: 외곽 직사각형(우측 하단 chamfer) + 내부 ▣ 홀
    //   JS: 외곽 Shape + holes로 Extrude
    const mw2 = Width_MatingShell / 2, mh2 = Height_MatingShell / 2;
    const inW = mw2 * 0.5, inH = mh2 * 0.8, chamfer = 1.0 * scale;

    // Mating Shell은 YZ 평면에서 스케치한 뒤 X 방향으로 Extrude
    //   Shape 좌표: (y, z)를 (Shape.x, Shape.y)로 매핑 → Extrude 후 회전으로 +X 진행축 만듦
    const shellShape = new THREE.Shape();
    shellShape.moveTo(-mw2, -mh2);
    shellShape.lineTo( mw2 - chamfer, -mh2);
    shellShape.lineTo( mw2, -mh2 + chamfer);
    shellShape.lineTo( mw2,  mh2);
    shellShape.lineTo(-mw2,  mh2);
    shellShape.closePath();

    // 내부 ▣ 홀 (사각)
    const shellHole = new THREE.Path();
    shellHole.moveTo(-inW, -inH);
    shellHole.lineTo( inW, -inH);
    shellHole.lineTo( inW,  inH);
    shellHole.lineTo(-inW,  inH);
    shellHole.closePath();
    shellShape.holes.push(shellHole);

    const shellGeo = new THREE.ExtrudeGeometry(shellShape, {
        depth: Length_MatingShell,
        bevelEnabled: false
    });
    // Shape의 (x,y)=(W,H) 평면을 Extrude하면 Z방향으로 뻗음 → X방향으로 정렬하기 위해 Y축 중심 -90° 회전
    shellGeo.rotateY(Math.PI / 2);
    // 회전 후 X=0 이 원점이 되도록 이동은 shellMesh.position으로 처리
    const shellMesh = new THREE.Mesh(shellGeo, MAT.stainlessBrush());
    shellMesh.position.x = xBodyEnd;   // Body 끝에서 시작
    plugGroup.add(shellMesh);

    // [4] Pin Holes — Mating Shell 전면 (xBodyEnd + Length_MatingShell) 위치에 작은 어두운 사각형 8개
    //   C++: pitchY = Height_MatingShell/5 ≈ 1.43,  cav = 0.5,  4 pitches × 2 sides = 8개 핀 홀
    //   JS: 전면 평면에 아주 얇은 BoxGeometry로 시각 표현
    const pitchY = Height_MatingShell / 5;
    const cav    = 0.5 * scale;
    const lX = -(mw2 + inW) / 2;   // 좌측 핀 Y 좌표 (Shell 로컬)
    const rX =  (mw2 + inW) / 2;   // 우측 핀 Y 좌표
    const pinFaceX = xBodyEnd + Length_MatingShell - cav * 0.5;   // 전면 살짝 안쪽

    for (let i = 0; i < 4; i++) {
        const py = (1.5 * pitchY) - (i * pitchY);
        for (const lR of [lX, rX]) {
            const pg = new THREE.BoxGeometry(cav, cav, cav);
            const pm = new THREE.Mesh(pg, MAT.plasticBlack().clone());
            // 로컬 좌표에서 핀 홀을 그대로 배치: X=전면, Y=lR(폭방향), Z=py(높이방향)
            // 단 Shell은 +X 진행이므로 lR(Y)은 Width 방향, py(Z)는 Height 방향
            pm.position.set(pinFaceX, lR, py);
            plugGroup.add(pm);
        }
    }

    // ─── 회전 & 이동: 로컬(+X) → alongDir 방향 ───
    //   기본 alongDir='+y' 면 X축을 Y축으로 회전 (Z축 중심 +90°)
    const rotMap = {
        '+x': () => {},                                      // 그대로
        '-x': () => { plugGroup.rotateZ(Math.PI); },         // 180° Z
        '+y': () => { plugGroup.rotateZ(Math.PI / 2); },     // +90° Z
        '-y': () => { plugGroup.rotateZ(-Math.PI / 2); },    // -90° Z
        '+z': () => { plugGroup.rotateY(-Math.PI / 2); },    // -90° Y
        '-z': () => { plugGroup.rotateY(Math.PI / 2); }      // +90° Y
    };
    (rotMap[alongDir] || rotMap['+y'])();
    plugGroup.position.copy(origin);

    modelGroup.add(plugGroup);
}

/**
 * ★ v50: 본체 상단 커넥터 소켓 상세화 — 박스 + 금색 핀.
 *
 * 기존 Box 커넥터(CW × CL × CH) 대신 사용.
 * 실제 엔코더 소켓은 검정 셸 위에 짧은 금색 핀 배열이 노출된 형태.
 *
 *  @param {object} opts
 *    center   : THREE.Vector3 — 박스 중심 좌표
 *    w, h, d  : 박스 폭(X), 높이(Y), 깊이(Z)
 *    facing   : 핀 돌출 방향 ('+x','-x','+y','-y','+z','-z') — 기본 '+z'(상단)
 *    pinCount : 핀 개수 (기본 4)
 */
function _buildConnectorSocket(opts) {
    const { center, w, h, d, facing = '+z', pinCount = 4 } = opts;

    // ─── [1] 외곽 셸 (검정 플라스틱 박스) ───
    const shellGeo = new THREE.BoxGeometry(w, h, d);
    const shellMesh = new THREE.Mesh(shellGeo, MAT.plasticBlack());
    shellMesh.position.copy(center);
    modelGroup.add(shellMesh);

    // ─── [2] 금색 핀 N개 — facing 방향 표면에 짧게 돌출 ───
    //   핀이 셸 밖으로 너무 길게 나오지 않도록 pinLen을 작게 유지
    //   (이미지의 "박스 위에 작은 마킹" 수준으로 표현)
    const facingVec = {
        '+x': [1, 0, 0], '-x': [-1, 0, 0],
        '+y': [0, 1, 0], '-y': [0, -1, 0],
        '+z': [0, 0, 1], '-z': [0, 0, -1]
    }[facing] || [0, 0, 1];

    // 핀 치수: 아주 작게 (이미지 마킹 크기와 비슷하도록)
    const pinDia = Math.min(0.5, Math.min(w, h, d) * 0.08);
    const pinLen = Math.min(0.8, Math.min(w, h, d) * 0.15);   // 표면 밖으로 아주 짧게

    // facing 축에 해당하는 박스 면까지의 거리
    const faceX = facing === '+x' ? w/2 : (facing === '-x' ? -w/2 : 0);
    const faceY = facing === '+y' ? h/2 : (facing === '-y' ? -h/2 : 0);
    const faceZ = facing === '+z' ? d/2 : (facing === '-z' ? -d/2 : 0);

    // 핀 중심 위치: 면에서 facing 방향으로 pinLen/2만큼 돌출
    const pinCenterX = center.x + faceX + facingVec[0] * pinLen / 2;
    const pinCenterY = center.y + faceY + facingVec[1] * pinLen / 2;
    const pinCenterZ = center.z + faceZ + facingVec[2] * pinLen / 2;

    // 핀이 배열되는 주 배열축 결정 (facing 축 제외한 2축 중 박스가 긴 쪽)
    const facingAxis = facing[1];   // 'x', 'y', 'z'
    const otherDims = [
        { axis: 'x', size: w, vec: [1, 0, 0] },
        { axis: 'y', size: h, vec: [0, 1, 0] },
        { axis: 'z', size: d, vec: [0, 0, 1] }
    ].filter(a => a.axis !== facingAxis);
    otherDims.sort((a, b) => b.size - a.size);
    const longAxis = otherDims[0];   // 주 배열축 (긴 쪽)

    // 핀 간격: 긴 축 크기의 55% 정도에 pinCount개 배치
    const pinSpan = longAxis.size * 0.55;
    const pinStep = pinCount > 1 ? pinSpan / (pinCount - 1) : 0;
    const pinStart = -pinSpan / 2;

    for (let i = 0; i < pinCount; i++) {
        const off = pinStart + i * pinStep;
        const px = pinCenterX + longAxis.vec[0] * off;
        const py = pinCenterY + longAxis.vec[1] * off;
        const pz = pinCenterZ + longAxis.vec[2] * off;

        // 핀: facing 방향으로 길쭉한 작은 실린더
        const pinGeo = new THREE.CylinderGeometry(pinDia / 2, pinDia / 2, pinLen, 8);
        // CylinderGeometry는 기본 Y축 → facing에 맞게 회전
        if (facing === '+x' || facing === '-x') pinGeo.applyMatrix4(new THREE.Matrix4().makeRotationZ(Math.PI / 2));
        else if (facing === '+z' || facing === '-z') pinGeo.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
        // y는 그대로
        const pinMesh = new THREE.Mesh(pinGeo, MAT.brassGold());
        pinMesh.position.set(px, py, pz);
        modelGroup.add(pinMesh);
    }
}

// ══════════════════════════════════════════════════════════════════════
//  공용 빌더 헬퍼 끝
// ══════════════════════════════════════════════════════════════════════

function addThreadRings(D, zStart, zEnd, P, mat) {
    const count = Math.floor((zEnd - zStart) / P);
    for (let i = 0; i < count; i++) {
        const z = zStart + i * P + P * 0.5;
        const g = new THREE.TorusGeometry(D / 2, 0.25, 8, 32);
        const m = new THREE.Mesh(g, mat.clone());
        m.position.z = z;
        modelGroup.add(m);
    }
}

/** 끝단 모따기 콘 (볼트 공용) */
function addTipChamfer(D, zPos, mat) {
    const g = new THREE.ConeGeometry(D / 2, D * 0.3, 32);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, mat.clone());
    m.position.z = zPos;
    modelGroup.add(m);
}

/** 육각 소켓 홈 (소켓/버튼/접시 볼트 공용) */
function addHexSocket(Ss, depth, zPos, mat) {
    const r = (Ss / 2) / Math.cos(Math.PI / 6);
    const g = new THREE.CylinderGeometry(r, r, depth, 6);
    g.rotateX(Math.PI / 2);
    const m = new THREE.Mesh(g, mat.clone());
    m.position.z = zPos;
    modelGroup.add(m);
}

// ═══════════════════════════════════════════════
// 초기화
// ═══════════════════════════════════════════════

function init() {
    const container = document.getElementById('viewer-container');
    scene = new THREE.Scene();
    // ★ 첨부 이미지처럼 연한 회색 톤 배경
    scene.background = new THREE.Color(0xE5E7EB);

    camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000);
    camera.position.set(80, 60, 50);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    css2dRenderer = new CSS2DRenderer();
    css2dRenderer.domElement.style.position = 'absolute';
    css2dRenderer.domElement.style.top = '0';
    css2dRenderer.domElement.style.left = '0';
    css2dRenderer.domElement.style.pointerEvents = 'none';
    container.appendChild(css2dRenderer.domElement);

    onResize();

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 10;
    controls.maxDistance = 500;
    
    // ★ 마우스 휠 줌 명시적 활성화
    controls.enableZoom = true;
    controls.zoomSpeed = 1.0;
    controls.enableRotate = true;
    controls.enablePan = true;
    
    controls.addEventListener('change', onControlsChange);

    setupLights();

    // ★ 2D 도면 스타일: 격자 완전 제거, 깔끔한 배경만
    // 격자 없이 완전히 깔끔한 배경
    // gridHelper는 생성하지 않음

    modelGroup = new THREE.Group();
    scene.add(modelGroup);
    dimGroup = new THREE.Group();
    scene.add(dimGroup);
    linkedGroup = new THREE.Group();   // ★ 연결부품 그룹
    scene.add(linkedGroup);

    window.addEventListener('resize', onResize);
    animate();

    setTimeout(() => {
        onResize();
        sendToCSharp({ type: 'ready' });
        logToCSharp('Three.js viewer initialized (12 part types)');
    }, 300);
}

function setupLights() {
    // ★ 밝은 배경에 맞춘 조명: 더 밝고 균등한 조명
    scene.add(new THREE.AmbientLight(0x808080, 1.3));

    // 주 방향광 (우상단) - 밝은 배경에 맞춰 조정
    const ml = new THREE.DirectionalLight(0xFFFFFF, 1.8);
    ml.position.set(50, 80, 60); ml.castShadow = true;
    ml.shadow.mapSize.width = 1024; ml.shadow.mapSize.height = 1024;
    scene.add(ml);

    // 전방 보조광 (좌하단 — 음영 채움)
    const fl = new THREE.DirectionalLight(0xF0F4F8, 0.9);
    fl.position.set(-40, -20, 30); scene.add(fl);

    // 하방 림광 (하단 — 바닥 반사 시뮬레이션)
    const rl = new THREE.DirectionalLight(0xFFFFFF, 0.7);
    rl.position.set(0, -50, 20); scene.add(rl);

    // ★ 추가: 카메라 방향 보조광 (ISO뷰 금속 하이라이트 보조)
    const tl = new THREE.DirectionalLight(0xFFF8F0, 0.6);
    tl.position.set(30, 25, 80);
    scene.add(tl);
}

let _lastW = 0, _lastH = 0;

function animate() {
    if (window._stopRendering) return;
    window._rafId = requestAnimationFrame(animate);
    controls.update();
    const c = document.getElementById('viewer-container');
    if (c) {
        const w = c.clientWidth, h = c.clientHeight;
        if (w > 0 && h > 0 && (w !== _lastW || h !== _lastH)) {
            _lastW = w; _lastH = h;
            renderer.setSize(w, h);
            css2dRenderer.setSize(w, h);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
        }
    }
    renderer.render(scene, camera);
    css2dRenderer.render(scene, camera);
}

function onResize() {
    if (!renderer || !camera || !css2dRenderer) return;
    const c = document.getElementById('viewer-container');
    if (!c) return;
    const w = c.clientWidth, h = c.clientHeight;
    if (w <= 0 || h <= 0) return;
    renderer.setSize(w, h);
    css2dRenderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
}

function onControlsChange() { updateViewIndicator(); }

// ═══════════════════════════════════════════════
// 뷰 제어
// ═══════════════════════════════════════════════

const VIEW_PRESETS = {
    FRONT: { pos: [0, 100, 0], target: [0, 0, 15], up: [0, 0, 1] },
    ISO:   { pos: [80, 60, 50], target: [0, 0, 15], up: [0, 0, 1] },
    TOP:   { pos: [0, 0, 120], target: [0, 0, 0], up: [0, 1, 0] },
    SIDE:  { pos: [100, 0, 15], target: [0, 0, 15], up: [0, 0, 1] }
};

function setView(viewName) {
    const preset = VIEW_PRESETS[viewName];
    if (!preset) return;
    const duration = 400;
    const sP = camera.position.clone(), eP = new THREE.Vector3(...preset.pos);
    const sT = controls.target.clone(), eT = new THREE.Vector3(...preset.target);
    const t0 = Date.now();

    if (modelGroup.children.length > 0) {
        const box = new THREE.Box3().setFromObject(modelGroup);
        const sz = box.getSize(new THREE.Vector3());
        const ctr = box.getCenter(new THREE.Vector3());
        const dist = Math.max(sz.x, sz.y, sz.z) * 2.5;
        const dir = eP.clone().sub(eT).normalize();
        eP.copy(ctr).add(dir.multiplyScalar(dist));
        eT.copy(ctr);
    }

    (function step() {
        const el = Date.now() - t0, t = Math.min(el / duration, 1);
        const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        camera.position.lerpVectors(sP, eP, e);
        controls.target.lerpVectors(sT, eT, e);
        camera.up.set(...preset.up);
        controls.update();
        if (t < 1) requestAnimationFrame(step); else updateViewIndicator();
    })();
}

function updateViewIndicator() {
    const ind = document.getElementById('view-indicator');
    const dir = camera.position.clone().sub(controls.target).normalize();
    const isFront = Math.abs(dir.y - 1) < 0.15 && Math.abs(dir.x) < 0.15 && Math.abs(dir.z) < 0.3;
    const vn = isFront ? 'FRONT' : 'ISO';
    if (ind) { ind.textContent = vn; ind.className = isFront ? 'front' : ''; }
    sendToCSharp({ type: 'viewChanged', view: vn });
    if (dimGroup) dimGroup.traverse(ch => {
        if (ch.isCSS2DObject) ch.element.style.opacity = isFront ? '1' : '0.5';
    });
}

// ═══════════════════════════════════════════════
// 모델 라우터 — partCode → 빌더 매핑
// ═══════════════════════════════════════════════

const PART_BUILDERS = {
    // ★ 베어링 — 일반
    DGBB:    { build: buildDGBB,    dimOnly: buildDGBBDimOnly    },  // 깊은 홈 볼
    ACBB:    { build: buildANBB,    dimOnly: buildANBBDimOnly    },  // 앵귤러 컨택트 볼
    STRB:    { build: buildTRBR,    dimOnly: buildTRBRDimOnly    },  // 테이퍼 롤러
    SCRB:    { build: buildCYLR,    dimOnly: buildCYLRDimOnly    },  // 원통 롤러
    STBB:    { build: buildTHRB,    dimOnly: buildTHRBDimOnly    },  // 스러스트 볼
    SARB:    { build: buildSRRB,    dimOnly: buildSRRBDimOnly    },  // 자동조심 롤러
    // ★ 베어링 — 유닛/하우징
    UCB:    { build: buildUNIT,    dimOnly: buildUNITDimOnly    },  // 인서트 베어링
    UCP:    { build: buildPILB,    dimOnly: buildPILBDimOnly    },  // 플러머블록 (UC계열)

    // ── 오일리스 베어링 (부시/슬리브 계열) ─────────────────────
    'SWURB':   { build: buildOilless,  dimOnly: buildOillessDimOnly },  // 오일리스 베어링
    'SWURFB':   { build: buildOilless,  dimOnly: buildOillessDimOnly },  // 오일리스 베어링
    'SWURW':   { build: buildOilless,  dimOnly: buildOillessDimOnly },  // 오일리스 베어링
    'SWURZB':   { build: buildOilless,  dimOnly: buildOillessDimOnly },  // 오일리스 베어링
    'SWURSP':   { build: buildOilless,  dimOnly: buildOillessDimOnly },  // 오일리스 베어링
    'SWURSL':   { build: buildOilless,  dimOnly: buildOillessDimOnly },  // 오일리스 베어링
    'SWURFF':   { build: buildOilless,  dimOnly: buildOillessDimOnly },  // 오일리스 베어링
    'SWUROB':   { build: buildOilless,  dimOnly: buildOillessDimOnly },  // 오일리스 베어링
    'SWURWP':   { build: buildOilless,  dimOnly: buildOillessDimOnly },  // 오일리스 베어링
    'SWUCBP':   { build: buildOilless,  dimOnly: buildOillessDimOnly },  // 오일리스 베어링
    'SWURSCBP':   { build: buildOilless,  dimOnly: buildOillessDimOnly },  // 오일리스 베어링
    'DRYBUSH':   { build: buildOilless,  dimOnly: buildOillessDimOnly },  // 오일리스 베어링
    'DRYFBUSH':   { build: buildOilless,  dimOnly: buildOillessDimOnly },  // 오일리스 베어링
    'DRYTWAS':   { build: buildOilless,  dimOnly: buildOillessDimOnly },  // 오일리스 베어링
    'LUBOHB':   { build: buildOilless,  dimOnly: buildOillessDimOnly },  // 오일리스 베어링
    'LUBOHBF':   { build: buildOilless,  dimOnly: buildOillessDimOnly },  // 오일리스 베어링
    'LUBOTW':   { build: buildOilless,  dimOnly: buildOillessDimOnly },  // 오일리스 베어링
    'LUBOLBGS':   { build: buildOilless,  dimOnly: buildOillessDimOnly },  // 오일리스 베어링
    'LUBOLBTB':   { build: buildOilless,  dimOnly: buildOillessDimOnly },  // 오일리스 베어링
    'LUBOGPP':   { build: buildOilless,  dimOnly: buildOillessDimOnly },  // 오일리스 베어링
    'LUBOHGB':   { build: buildOilless,  dimOnly: buildOillessDimOnly },  // 오일리스 베어링
    'LUBOHFB':   { build: buildOilless,  dimOnly: buildOillessDimOnly },  // 오일리스 베어링
    'LUBOLBG':   { build: buildOilless,  dimOnly: buildOillessDimOnly },  // 오일리스 베어링
    'LUBOLBFG':   { build: buildOilless,  dimOnly: buildOillessDimOnly },  // 오일리스 베어링
    'LUBOLEBG':   { build: buildOilless,  dimOnly: buildOillessDimOnly },  // 오일리스 베어링
    'LUBOLUBS':   { build: buildOilless,  dimOnly: buildOillessDimOnly },  // 오일리스 베어링
    SD:      { build: buildSD,      dimOnly: buildSDDimOnly      },  // 플러머블록 SD형
    SN:      { build: buildSD,      dimOnly: buildSDDimOnly      },  // 플러머블록 SN형
    UCF:    { build: buildFLBU,    dimOnly: buildFLBUDimOnly    },  // 플랜지형 유닛

    // ── 볼베어링 변형 계열 (DGBB 기반) ──────────────────────────
    MNBB:    { build: buildDGBB,    dimOnly: buildDGBBDimOnly    },  // 맥시멈형 볼베어링
    ENBB:    { build: buildDGBB,    dimOnly: buildDGBBDimOnly    },  // 매그니토 볼베어링
    MIBB:    { build: buildDGBB,    dimOnly: buildDGBBDimOnly    },  // 미니어쳐 볼베어링
    HLDTBB:    { build: buildDGBB,    dimOnly: buildDGBBDimOnly    },  // 고부하 구동용
    FPCBB:    { build: buildQPBB,    dimOnly: buildDGBBDimOnly    },  // 4점 접촉 볼베어링
    SABB:    { build: buildSRRB,    dimOnly: buildSRRBDimOnly    },  // 자동 조심 볼베어링

    // ── 앵귤러 볼베어링 변형 ─────────────────────────────────────
    DACBB:    { build: buildDANB,    dimOnly: buildANBBDimOnly    },  // 복열 앵귤러 콘텍트
    MACBB:    { build: buildDANB,    dimOnly: buildANBBDimOnly    },  // 조합 앵귤러 볼베어링
    HACCBB:    { build: buildANBB,    dimOnly: buildANBBDimOnly    },  // 고정도 앵귤러
    UHSACBB:    { build: buildANBB,    dimOnly: buildANBBDimOnly    },  // 초고속 앵귤러
    HRTBB:    { build: buildANBB,    dimOnly: buildANBBDimOnly    },  // 고강성용

    // ── 원통/테이퍼 롤러 변형 ────────────────────────────────────
    DCRB:    { build: buildDCYL,    dimOnly: buildCYLRDimOnly    },  // 복열 원통 롤러
    FDCORB:    { build: buildDCYL,    dimOnly: buildCYLRDimOnly    },  // 총형 복열 원통(시브/개방)
    FDCGRB:    { build: buildDCYL,    dimOnly: buildCYLRDimOnly    },  // 총형 복열 원통(시브/봉입)
    PSCRB:    { build: buildCYLR,    dimOnly: buildCYLRDimOnly    },  // 정밀 원통 롤러
    PDCRB:    { build: buildDCYL,    dimOnly: buildCYLRDimOnly    },  // 정밀 복열 원통
    DTRB:    { build: buildDTRB,    dimOnly: buildTRBRDimOnly    },  // 복열 테이퍼 롤러
    DRBB:    { build: buildDCYL,    dimOnly: buildCYLRDimOnly    },  // 복열 베어링

    // ── 니들 롤러 베어링 계열 ─────────────────────────────────────
    LMSNRB:    { build: buildNRBR,    dimOnly: buildNRBRDimOnly    },  // 니들 롤러 베어링
    LMSNRB:    { build: buildNRBR,    dimOnly: buildNRBRDimOnly    },  // 솔리드 니들 롤러
    CNRB:    { build: buildNRBR,    dimOnly: buildNRBRDimOnly    },  // 게이지 니들 롤러
    SHNRB:    { build: buildNRBR,    dimOnly: buildNRBRDimOnly    },  // 쉘형 니들 롤러

    // ── 트러스트 계열 ─────────────────────────────────────────────
    DTBB:    { build: buildDTHB,    dimOnly: buildTHRBDimOnly    },  // 복열 트러스트 볼
    DTABB:    { build: buildDTAB,    dimOnly: buildTHRBDimOnly    },  // 복열 트러스트 앵귤러
    TCRB:    { build: buildTHCR,    dimOnly: buildTHRBDimOnly    },  // 트러스트 원통 롤러
    TSARB:    { build: buildTHSR,    dimOnly: buildTHRBDimOnly    },  // 트러스트 자동조심 롤러
    TNRB:    { build: buildTHNR,    dimOnly: buildTHRBDimOnly    },  // 트러스트 니들 롤러
    TCNRB:    { build: buildTHRR,    dimOnly: buildTHRBDimOnly    },  // 트러스트 롤러
    HSTACBB:    { build: buildDTAB,    dimOnly: buildTHRBDimOnly    },  // 고속 트러스트 앵귤러
    TACBB:    { build: buildDTAB,    dimOnly: buildTHRBDimOnly    },  // 트러스트 앵귤러 볼
    DDTACBB:    { build: buildDTAB,    dimOnly: buildTHRBDimOnly    },  // 복식 트러스트 앵귤러

    // ── 오일씰 ────────────────────────────────────────────────────
    OSEAL:   { build: buildOSEAL,   dimOnly: buildOSEALDimOnly   },  // 오일 씰

    // ── UC/UK 인서트+하우징 계열 ──────────────────────────────────
    UKB:    { build: buildUKBB,    dimOnly: buildUNITDimOnly    },  // UK 베어링 (테이퍼 보어)
    UKP:    { build: buildPILB,    dimOnly: buildPILBDimOnly    },  // UKP 베어링
    UKF:    { build: buildFLBU,    dimOnly: buildFLBUDimOnly    },  // UKF 베어링
    UCFC:    { build: buildFCBB,    dimOnly: buildFLBUDimOnly    },  // UCFC 둥근 플랜지
    UKFC:    { build: buildFCBB,    dimOnly: buildFLBUDimOnly    },  // UKFC
    UCFL:    { build: buildFLBB,    dimOnly: buildFLBUDimOnly    },  // UCFL 마름모 플랜지
    UKFL:    { build: buildFLBB,    dimOnly: buildFLBUDimOnly    },  // UKFL
    UCFS:    { build: buildFSBB,    dimOnly: buildFLBUDimOnly    },  // UCFS 소켓 각 플랜지
    UKFS:    { build: buildFSBB,    dimOnly: buildFLBUDimOnly    },  // UKFS
    UCT:    { build: buildUCTU,    dimOnly: buildPILBDimOnly    },  // UCT 테이크업
    UKT:    { build: buildUCTU,    dimOnly: buildPILBDimOnly    },  // UKT 테이크업
    UCC:    { build: buildUCCA,    dimOnly: buildPILBDimOnly    },  // UCC 카트리지
    UKC:    { build: buildUCCA,    dimOnly: buildPILBDimOnly    },  // UKC 카트리지
    // 볼트 (실제 시스템 코드 기준)
    SBOLT:   { build: buildSocketBolt,      dimOnly: buildSocketBoltDimOnly },
    SRBOLT:  { build: buildButtonBolt,      dimOnly: buildButtonBoltDimOnly },
    FBOLT:   { build: buildCountersunkBolt, dimOnly: buildCountersunkBoltDimOnly },
    FLBOLT:  { build: buildFlangeBolt,      dimOnly: buildFlangeBoltDimOnly },
    STBOLT:  { build: buildStudBolt,        dimOnly: buildStudBoltDimOnly },
    SQBOLT:  { build: buildSquareBolt,      dimOnly: buildSquareBoltDimOnly },
    HBOLT:   { build: buildBolt,            dimOnly: buildBoltDimOnly },
    // 모터
    SERVO_MOTOR: { build: buildServoMotor,  dimOnly: buildServoMotorDimOnly },
    STEPPER_MOTOR: { build: buildStepperMotor, dimOnly: buildStepperMotorDimOnly },   // ★ v50 3세션차
    // 너트
    FNUT:    { build: buildFlangeNut,       dimOnly: buildFlangeNutDimOnly },
    HNUT:    { build: buildNut,             dimOnly: buildNutDimOnly },
    NUT:     { build: buildNut,             dimOnly: buildNutDimOnly },
    // 와셔 (★ PWAS/SWAS — 실제 시스템 코드)
    SWAS:    { build: buildSpringWasher,    dimOnly: buildSpringWasherDimOnly },
    PWAS:    { build: buildWasher,          dimOnly: buildWasherDimOnly },
};

function findBuilder(partCode) {
    const code = partCode.toUpperCase();
    // 1. 정확한 키 매칭 (순서 중요: 구체적인 것 먼저)
    for (const key of Object.keys(PART_BUILDERS)) {
        if (code === key || code.startsWith(key)) return PART_BUILDERS[key];
    }
    // 2. 베어링 포함 매칭
    if (code.includes('ANBB') || code.includes('ANGULAR'))         return PART_BUILDERS.ANBB;
    if (code.includes('TRBR') || code.includes('TAPER'))           return PART_BUILDERS.TRBR;
    if (code.includes('CYLR') || code.includes('CYLINDRICAL'))     return PART_BUILDERS.CYLR;
    if (code.includes('THRB') || code.includes('THRUST'))          return PART_BUILDERS.THRB;
    if (code.includes('SRRB') || code.includes('SELF'))            return PART_BUILDERS.SRRB;
    if (code === 'SD' || code.startsWith('SD') || code === 'SN' || code.startsWith('SN'))
                                                                    return PART_BUILDERS.SD;
    if (code.includes('PILB') || code.includes('PILLOW'))          return PART_BUILDERS.PILB;
    if (code.includes('FLBU') || code.includes('FLANGE') && code.includes('UNIT')) return PART_BUILDERS.FLBU;
    if (code.includes('UNIT') || code.includes('INSERT'))          return PART_BUILDERS.UNIT;
    if (code.includes('DGBB') || code.includes('DEEPGROOVE'))      return PART_BUILDERS.DGBB;
    // 3. 볼트 포함 매칭
    if (code.includes('SBOLT') || code.includes('SOCKET'))       return PART_BUILDERS.SBOLT;
    if (code.includes('SRBOLT') || code.includes('BUTTON'))      return PART_BUILDERS.SRBOLT;
    if (code.includes('FBOLT') || code.includes('COUNTERSUNK'))  return PART_BUILDERS.FBOLT;
    if (code.includes('FLBOLT'))                                  return PART_BUILDERS.FLBOLT;
    if (code.includes('STBOLT') || code.includes('STUD'))        return PART_BUILDERS.STBOLT;
    if (code.includes('SQBOLT') || code.includes('SQUARE'))      return PART_BUILDERS.SQBOLT;
    if (code.includes('HBOLT') || code.includes('BOLT'))         return PART_BUILDERS.HBOLT;
    if (code.includes('FNUT'))                                    return PART_BUILDERS.FNUT;
    if (code.includes('NUT'))                                     return PART_BUILDERS.NUT;
    if (code.includes('SWAS') || code.includes('SPRING'))        return PART_BUILDERS.SWAS;
    if (code.includes('PWAS') || code.includes('WASHER'))        return PART_BUILDERS.PWAS;
    // 모터
    //   ★ v50 3세션차: Stepper를 Servo보다 먼저 매칭 (SMOT/STEP 키워드 우선)
    if (code.includes('STEPPER') || code.includes('STEP_MOTOR') || code === 'SMOT' || code.startsWith('SMOT') ||
        code.includes('PKP') || code.includes('PKE'))   // 오리엔탈모터 스텝 시리즈
        return PART_BUILDERS.STEPPER_MOTOR;
    if (code.includes('SERVO') || code.includes('SGM') || code.includes('SERVO_MOTOR')) return PART_BUILDERS.SERVO_MOTOR;
    return PART_BUILDERS.HBOLT; // 기본값
}

function updateModel(partCode, dimensions, linkedParts, motorOptions) {
    currentPartCode    = partCode;
    currentDimensions  = dimensions;
    currentLinkedParts = linkedParts || [];
    currentMotorOptions = motorOptions || {};   // ★ v50 모터 옵션 저장 (빈 객체로 폴백)

    // ★ 치수 참조 패널 — 이번 렌더링 치수 수집 시작 (addDimLabel이 push)
    renderedDimensions = [];

    clearGroup(modelGroup);
    clearGroup(dimGroup);
    clearGroup(linkedGroup);   // ★ 연결부품 그룹도 클리어
    const builder = findBuilder(partCode);
    builder.build(dimensions);
    buildLinkedParts(partCode, dimensions);   // ★ 연결부품 렌더링
    
    // ★ SD/SN 전용 치수 강제 호출 (build 함수와 별도로)
    if ((partCode === 'SD' || partCode === 'SN') && options.dimensions) {
        setTimeout(() => {
            clearGroup(dimGroup);
            renderedDimensions = [];   // ★ SD/SN 재빌드 시 치수 수집 재시작
            const GS = 0.1;
            console.log('SD 전용 치수 강제 호출:', dimensions);
            buildSDDimOnly(dimensions, GS);
            
            // 추가: 치수 그룹 강제 가시성
            if (dimGroup) {
                dimGroup.visible = true;
                dimGroup.traverse(child => {
                    if (child.isCSS2DObject) {
                        child.element.style.visibility = 'visible';
                        child.element.style.display = 'block';
                        child.element.style.opacity = '1';
                    }
                });
            }
            // ★ SD/SN 치수 재생성 후 패널 업데이트
            updateDimPanel();
        }, 200);
    }
    
    fitCameraToModel();

    // ★ 렌더링 완료 → 치수 참조 패널 업데이트
    updateDimPanel();

    logToCSharp('Model: ' + partCode + ' (' + builder.build.name + ')' +
                ' linked=' + currentLinkedParts.length +
                ' dims=' + renderedDimensions.length);
}

function clearGroup(group) {
    while (group.children.length > 0) {
        const ch = group.children[0];
        if (ch.geometry) ch.geometry.dispose();
        if (ch.isCSS2DObject && ch.element.parentNode) ch.element.parentNode.removeChild(ch.element);
        group.remove(ch);
    }
}

// ═══════════════════════════════════════════════════
// ① HBOLT — 육각볼트 (KS B 1002)
// ═══════════════════════════════════════════════════

function buildBolt(dims) {
    const D = dims.D || 10, L = dims.L || 40, S = dims.S || D * 1.7, K = dims.K || D * 0.7, P = dims.P || 1.5;
    const hR = (S / 2) / Math.cos(Math.PI / 6);
    let g, m;
    // 머리 (육각기둥)
    g = new THREE.CylinderGeometry(hR, hR, K, 6); g.rotateX(Math.PI / 2);
    m = new THREE.Mesh(g, steelMaterial.clone()); m.position.z = L + K / 2; modelGroup.add(m);
    // 머리 상단 모따기
    g = new THREE.CylinderGeometry(hR * 0.92, hR, K * 0.15, 6); g.rotateX(Math.PI / 2);
    m = new THREE.Mesh(g, steelMaterial.clone()); m.position.z = L + K * 0.925; modelGroup.add(m);
    // 몸체
    g = new THREE.CylinderGeometry(D / 2, D / 2, L, 32); g.rotateX(Math.PI / 2);
    m = new THREE.Mesh(g, steelMaterial.clone()); m.position.z = L / 2; modelGroup.add(m);
    // 나사산 + 끝단
    addThreadRings(D, 0, L, P, darkSteelMaterial);
    addTipChamfer(D, -D * 0.15, steelMaterial);
    if (options.dimensions) buildBoltDimOnly(dims);
}

function buildBoltDimOnly(dims) {
    const D = dims.D || 10, L = dims.L || 40, S = dims.S || D * 1.7, K = dims.K || D * 0.7;
    addVerticalDim(-S / 2 - 12, L, L + K, 'K', K);
    addVerticalDim(-S / 2 - 8, 0, L, 'L', L);
    addVerticalDim(-S / 2 - 20, 0, L + K, 'L+K', L + K);
    addHorizontalDim(-D / 2, D / 2, L * 0.5, D / 2 + 10, 'D', D);
    addHorizontalDim(-S / 2, S / 2, L + K / 2, S / 2 + 10, 'S', S);
}

// ═══════════════════════════════════════════════════
// ② SBOLT — 소켓볼트 (KS B 1003)
//    원통형 머리 + 육각 소켓 홈
// ═══════════════════════════════════════════════════

function buildSocketBolt(dims) {
    const D = dims.D || 10, L = dims.L || 40;
    const Dk = dims.DK || D * 1.5;    // 머리 지름
    const K = dims.K || D * 1.0;       // 머리 높이
    const S = dims.S || D * 0.85;      // 소켓 대변거리
    const P = dims.P || 1.5;
    let g, m;
    // 원통 머리
    g = new THREE.CylinderGeometry(Dk / 2, Dk / 2, K, 32); g.rotateX(Math.PI / 2);
    m = new THREE.Mesh(g, blackOxideMaterial.clone()); m.position.z = L + K / 2; modelGroup.add(m);
    // 상단 모따기
    g = new THREE.CylinderGeometry(Dk / 2 * 0.95, Dk / 2, K * 0.1, 32); g.rotateX(Math.PI / 2);
    m = new THREE.Mesh(g, blackOxideMaterial.clone()); m.position.z = L + K * 0.95; modelGroup.add(m);
    // 육각 소켓 홈
    addHexSocket(S, K * 0.6, L + K * 0.7, darkSteelMaterial);
    // 몸체
    g = new THREE.CylinderGeometry(D / 2, D / 2, L, 32); g.rotateX(Math.PI / 2);
    m = new THREE.Mesh(g, blackOxideMaterial.clone()); m.position.z = L / 2; modelGroup.add(m);
    addThreadRings(D, 0, L, P, darkSteelMaterial);
    addTipChamfer(D, -D * 0.15, blackOxideMaterial);
    if (options.dimensions) buildSocketBoltDimOnly(dims);
}

function buildSocketBoltDimOnly(dims) {
    const D = dims.D || 10, L = dims.L || 40, Dk = dims.DK || D * 1.5, K = dims.K || D * 1.0, S = dims.S || D * 0.85;
    addVerticalDim(-Dk / 2 - 12, L, L + K, 'K', K);
    addVerticalDim(-Dk / 2 - 8, 0, L, 'L', L);
    addHorizontalDim(-D / 2, D / 2, L * 0.5, D / 2 + 10, 'D', D);
    addHorizontalDim(-Dk / 2, Dk / 2, L + K / 2, Dk / 2 + 10, 'Dk', Dk);
    addHorizontalDim(-S / 2, S / 2, L + K + 5, S / 2 + 8, 'S', S);
}

// ═══════════════════════════════════════════════════
// ③ BTNBOLT — 버튼볼트 (KS B 1024)
//    반구형(돔) 머리 + 육각 소켓
// ═══════════════════════════════════════════════════

function buildButtonBolt(dims) {
    const D = dims.D || 10, L = dims.L || 40;
    const Dk = dims.DK || D * 1.8;    // 머리 지름
    const K = dims.K || D * 0.55;      // 머리 높이
    const S = dims.S || D * 0.65;      // 소켓 대변거리
    const P = dims.P || 1.5;
    let g, m;
    // 반구형 돔
    g = new THREE.SphereGeometry(Dk / 2, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    g.rotateX(-Math.PI / 2);
    m = new THREE.Mesh(g, blackOxideMaterial.clone());
    m.position.z = L; m.scale.z = K / (Dk / 2); modelGroup.add(m);
    // 바닥 디스크
    g = new THREE.CylinderGeometry(Dk / 2, Dk / 2, 0.5, 32); g.rotateX(Math.PI / 2);
    m = new THREE.Mesh(g, blackOxideMaterial.clone()); m.position.z = L + 0.25; modelGroup.add(m);
    // 소켓 홈
    addHexSocket(S, K * 0.5, L + K * 0.3, darkSteelMaterial);
    // 몸체
    g = new THREE.CylinderGeometry(D / 2, D / 2, L, 32); g.rotateX(Math.PI / 2);
    m = new THREE.Mesh(g, blackOxideMaterial.clone()); m.position.z = L / 2; modelGroup.add(m);
    addThreadRings(D, 0, L, P, darkSteelMaterial);
    addTipChamfer(D, -D * 0.15, blackOxideMaterial);
    if (options.dimensions) buildButtonBoltDimOnly(dims);
}

function buildButtonBoltDimOnly(dims) {
    const D = dims.D || 10, L = dims.L || 40, Dk = dims.DK || D * 1.8, K = dims.K || D * 0.55;
    addVerticalDim(-Dk / 2 - 12, L, L + K, 'K', K);
    addVerticalDim(-Dk / 2 - 8, 0, L, 'L', L);
    addHorizontalDim(-D / 2, D / 2, L * 0.5, D / 2 + 10, 'D', D);
    addHorizontalDim(-Dk / 2, Dk / 2, L + K / 2, Dk / 2 + 10, 'Dk', Dk);
}

// ═══════════════════════════════════════════════════
// ④ CSBOLT — 접시머리볼트 (KS B 1005)
//    역원뿔(카운터싱크) 머리 + 육각 소켓
// ═══════════════════════════════════════════════════

function buildCountersunkBolt(dims) {
    const D = dims.D || 10, L = dims.L || 40;
    const Dk = dims.DK || D * 2.0;    // 머리 지름
    const K = dims.K || D * 0.6;       // 머리 높이
    const S = dims.S || D * 0.65;      // 소켓 대변거리
    const P = dims.P || 1.5;
    let g, m;
    // 역원뿔 머리 (윗면 넓음, 아래쪽 좁음)
    g = new THREE.CylinderGeometry(Dk / 2, D / 2, K, 32); g.rotateX(Math.PI / 2);
    m = new THREE.Mesh(g, steelMaterial.clone()); m.position.z = L + K / 2; modelGroup.add(m);
    // 소켓 홈
    addHexSocket(S, K * 0.5, L + K * 0.75, darkSteelMaterial);
    // 몸체
    g = new THREE.CylinderGeometry(D / 2, D / 2, L, 32); g.rotateX(Math.PI / 2);
    m = new THREE.Mesh(g, steelMaterial.clone()); m.position.z = L / 2; modelGroup.add(m);
    addThreadRings(D, 0, L, P, darkSteelMaterial);
    addTipChamfer(D, -D * 0.15, steelMaterial);
    if (options.dimensions) buildCountersunkBoltDimOnly(dims);
}

function buildCountersunkBoltDimOnly(dims) {
    const D = dims.D || 10, L = dims.L || 40, Dk = dims.DK || D * 2.0, K = dims.K || D * 0.6;
    addVerticalDim(-Dk / 2 - 12, L, L + K, 'K', K);
    addVerticalDim(-Dk / 2 - 8, 0, L, 'L', L);
    addHorizontalDim(-D / 2, D / 2, L * 0.5, D / 2 + 10, 'D', D);
    addHorizontalDim(-Dk / 2, Dk / 2, L + K + 3, Dk / 2 + 10, 'Dk', Dk);
}

// ═══════════════════════════════════════════════════
// ⑤ HFBOLT — 플랜지볼트 (KS B 1028)
//    육각머리 + 원형 플랜지
// ═══════════════════════════════════════════════════

function buildFlangeBolt(dims) {
    const D = dims.D || 10, L = dims.L || 40, S = dims.S || D * 1.7, K = dims.K || D * 0.7;
    const Df = dims.DF || D * 2.2;     // 플랜지 지름
    const Kf = dims.KF || K * 0.3;     // 플랜지 높이
    const P = dims.P || 1.5;
    const headK = K - Kf, hR = (S / 2) / Math.cos(Math.PI / 6);
    let g, m;
    // 육각 머리
    g = new THREE.CylinderGeometry(hR, hR, headK, 6); g.rotateX(Math.PI / 2);
    m = new THREE.Mesh(g, steelMaterial.clone()); m.position.z = L + Kf + headK / 2; modelGroup.add(m);
    // 모따기
    g = new THREE.CylinderGeometry(hR * 0.92, hR, headK * 0.15, 6); g.rotateX(Math.PI / 2);
    m = new THREE.Mesh(g, steelMaterial.clone()); m.position.z = L + Kf + headK * 0.925; modelGroup.add(m);
    // 플랜지 (원형 디스크)
    g = new THREE.CylinderGeometry(Df / 2, Df / 2, Kf, 32); g.rotateX(Math.PI / 2);
    m = new THREE.Mesh(g, steelMaterial.clone()); m.position.z = L + Kf / 2; modelGroup.add(m);
    // 몸체
    g = new THREE.CylinderGeometry(D / 2, D / 2, L, 32); g.rotateX(Math.PI / 2);
    m = new THREE.Mesh(g, steelMaterial.clone()); m.position.z = L / 2; modelGroup.add(m);
    addThreadRings(D, 0, L, P, darkSteelMaterial);
    addTipChamfer(D, -D * 0.15, steelMaterial);
    if (options.dimensions) buildFlangeBoltDimOnly(dims);
}

function buildFlangeBoltDimOnly(dims) {
    const D = dims.D || 10, L = dims.L || 40, S = dims.S || D * 1.7, K = dims.K || D * 0.7, Df = dims.DF || D * 2.2;
    addVerticalDim(-Df / 2 - 12, L, L + K, 'K', K);
    addVerticalDim(-Df / 2 - 8, 0, L, 'L', L);
    addHorizontalDim(-D / 2, D / 2, L * 0.5, D / 2 + 10, 'D', D);
    addHorizontalDim(-S / 2, S / 2, L + K / 2, S / 2 + 10, 'S', S);
    addHorizontalDim(-Df / 2, Df / 2, L - 3, Df / 2 + 10, 'Df', Df);
}

// ═══════════════════════════════════════════════════
// ⑥ STUD — 스터드볼트
//    머리 없음, 양쪽 나사산
// ═══════════════════════════════════════════════════

function buildStudBolt(dims) {
    const D = dims.D || 10, L = dims.L || 80;
    const B1 = dims.B1 || L * 0.3;    // 하단 나사부
    const B2 = dims.B2 || L * 0.3;    // 상단 나사부
    const P = dims.P || 1.5;
    let g, m;
    // 몸체
    g = new THREE.CylinderGeometry(D / 2, D / 2, L, 32); g.rotateX(Math.PI / 2);
    m = new THREE.Mesh(g, steelMaterial.clone()); m.position.z = L / 2; modelGroup.add(m);
    // 나사산 (상/하)
    addThreadRings(D, 0, B1, P, darkSteelMaterial);
    addThreadRings(D, L - B2, L, P, darkSteelMaterial);
    // 양쪽 끝단 모따기
    addTipChamfer(D, -D * 0.15, steelMaterial);
    g = new THREE.ConeGeometry(D / 2, D * 0.3, 32); g.rotateX(Math.PI / 2);
    m = new THREE.Mesh(g, steelMaterial.clone()); m.position.z = L + D * 0.15; modelGroup.add(m);
    // 구분 링 (나사부 경계 표시)
    for (const z of [B1, L - B2]) {
        g = new THREE.TorusGeometry(D / 2 + 0.5, 0.5, 8, 32);
        m = new THREE.Mesh(g, darkSteelMaterial.clone()); m.position.z = z; modelGroup.add(m);
    }
    if (options.dimensions) buildStudBoltDimOnly(dims);
}

function buildStudBoltDimOnly(dims) {
    const D = dims.D || 10, L = dims.L || 80, B1 = dims.B1 || L * 0.3, B2 = dims.B2 || L * 0.3;
    addVerticalDim(-D / 2 - 12, 0, L, 'L', L);
    addVerticalDim(-D / 2 - 8, 0, B1, 'B1', B1);
    addVerticalDim(D / 2 + 8, L - B2, L, 'B2', B2);
    addHorizontalDim(-D / 2, D / 2, L / 2, D / 2 + 10, 'D', D);
}

// ═══════════════════════════════════════════════════
// ⑦ SQBOLT — 사각볼트
//    사각형 머리
// ═══════════════════════════════════════════════════

function buildSquareBolt(dims) {
    const D = dims.D || 10, L = dims.L || 40, S = dims.S || D * 1.5, K = dims.K || D * 0.65, P = dims.P || 1.5;
    let g, m;
    // 사각 머리
    g = new THREE.BoxGeometry(S, S, K);
    m = new THREE.Mesh(g, steelMaterial.clone()); m.position.z = L + K / 2; modelGroup.add(m);
    // 상단 모따기
    g = new THREE.BoxGeometry(S * 0.95, S * 0.95, K * 0.12);
    m = new THREE.Mesh(g, steelMaterial.clone()); m.position.z = L + K * 0.94; modelGroup.add(m);
    // 몸체
    g = new THREE.CylinderGeometry(D / 2, D / 2, L, 32); g.rotateX(Math.PI / 2);
    m = new THREE.Mesh(g, steelMaterial.clone()); m.position.z = L / 2; modelGroup.add(m);
    addThreadRings(D, 0, L, P, darkSteelMaterial);
    addTipChamfer(D, -D * 0.15, steelMaterial);
    if (options.dimensions) buildSquareBoltDimOnly(dims);
}

function buildSquareBoltDimOnly(dims) {
    const D = dims.D || 10, L = dims.L || 40, S = dims.S || D * 1.5, K = dims.K || D * 0.65;
    addVerticalDim(-S / 2 - 12, L, L + K, 'K', K);
    addVerticalDim(-S / 2 - 8, 0, L, 'L', L);
    addHorizontalDim(-D / 2, D / 2, L * 0.5, D / 2 + 10, 'D', D);
    addHorizontalDim(-S / 2, S / 2, L + K / 2, S / 2 + 10, 'S', S);
}

// ═══════════════════════════════════════════════════
// ⑧ NUT / HNUT — 육각너트 (KS B 1012)
//    관통 구멍
// ═══════════════════════════════════════════════════

function buildNut(dims) {
    const D = dims.D || 10, S = dims.S || D * 1.7, H = dims.H || D * 0.8;
    const oR = (S / 2) / Math.cos(Math.PI / 6);
    // Shape + Extrude (관통 구멍)
    const shape = createHexShapeWithHole(oR, D / 2);
    const geom = new THREE.ExtrudeGeometry(shape, { depth: H, bevelEnabled: false });
    modelGroup.add(new THREE.Mesh(geom, steelMaterial.clone()));
    // 상하단 모따기
    for (const sign of [-1, 1]) {
        const g = new THREE.CylinderGeometry(
            oR * (sign > 0 ? 0.92 : 1), oR * (sign > 0 ? 1 : 0.92), H * 0.1, 6);
        g.rotateX(Math.PI / 2);
        const m = new THREE.Mesh(g, steelMaterial.clone());
        m.position.z = sign > 0 ? H * 0.95 : H * 0.05;
        modelGroup.add(m);
    }
    if (options.dimensions) buildNutDimOnly(dims);
}

function buildNutDimOnly(dims) {
    const D = dims.D || 10, S = dims.S || D * 1.7, H = dims.H || D * 0.8;
    addVerticalDim(-S / 2 - 10, 0, H, 'H', H);
    addHorizontalDim(-S / 2, S / 2, H / 2, S / 2 + 10, 'S', S);
    addHorizontalDim(-D / 2, D / 2, -5, D / 2 + 10, 'D', D);
}

// ═══════════════════════════════════════════════════
// ⑨ FNUT — 플랜지너트 (KS B 1015)
//    육각너트 + 원형 플랜지 (관통 구멍)
// ═══════════════════════════════════════════════════

function buildFlangeNut(dims) {
    const D = dims.D || 10, S = dims.S || D * 1.7, H = dims.H || D * 0.8;
    const Df = dims.DF || D * 2.2;     // 플랜지 지름
    const Kf = dims.KF || H * 0.25;    // 플랜지 높이
    const oR = (S / 2) / Math.cos(Math.PI / 6), nutH = H - Kf;
    let g, m;
    // 육각 너트 (관통 구멍)
    const hShape = createHexShapeWithHole(oR, D / 2);
    const nutGeom = new THREE.ExtrudeGeometry(hShape, { depth: nutH, bevelEnabled: false });
    m = new THREE.Mesh(nutGeom, steelMaterial.clone()); m.position.z = Kf; modelGroup.add(m);
    // 상단 모따기
    g = new THREE.CylinderGeometry(oR * 0.92, oR, nutH * 0.1, 6); g.rotateX(Math.PI / 2);
    m = new THREE.Mesh(g, steelMaterial.clone()); m.position.z = Kf + nutH * 0.95; modelGroup.add(m);
    // 플랜지 (관통 구멍)
    const fShape = createCircleShapeWithHole(Df / 2, D / 2);
    const fGeom = new THREE.ExtrudeGeometry(fShape, { depth: Kf, bevelEnabled: false });
    modelGroup.add(new THREE.Mesh(fGeom, steelMaterial.clone()));
    if (options.dimensions) buildFlangeNutDimOnly(dims);
}

function buildFlangeNutDimOnly(dims) {
    const D = dims.D || 10, S = dims.S || D * 1.7, H = dims.H || D * 0.8, Df = dims.DF || D * 2.2;
    addVerticalDim(-Df / 2 - 10, 0, H, 'H', H);
    addHorizontalDim(-S / 2, S / 2, H / 2, S / 2 + 10, 'S', S);
    addHorizontalDim(-D / 2, D / 2, -5, D / 2 + 10, 'D', D);
    addHorizontalDim(-Df / 2, Df / 2, -12, Df / 2 + 10, 'Df', Df);
}

// ═══════════════════════════════════════════════════
// ⑩ WASHER — 평와셔 (KS B 1326)
//    관통 구멍
// ═══════════════════════════════════════════════════

function buildWasher(dims) {
    const D = dims.D || 10, OD = dims.OD || D * 2, T = dims.T || 2;
    const shape = createCircleShapeWithHole(OD / 2, D / 2);
    const geom = new THREE.ExtrudeGeometry(shape, { depth: T, bevelEnabled: false });
    modelGroup.add(new THREE.Mesh(geom, steelMaterial.clone()));
    if (options.dimensions) buildWasherDimOnly(dims);
}

function buildWasherDimOnly(dims) {
    const D = dims.D || 10, OD = dims.OD || D * 2, T = dims.T || 2;
    addVerticalDim(-OD / 2 - 10, 0, T, 'T', T);
    addHorizontalDim(-OD / 2, OD / 2, -5, OD / 2 + 10, 'OD', OD);
    addHorizontalDim(-D / 2, D / 2, T + 5, D / 2 + 10, 'D', D);
}

// ═══════════════════════════════════════════════════
// ⑪ SWASHER — 스프링와셔 (KS B 1326)
//    절개된 나선형 링
// ═══════════════════════════════════════════════════

function buildSpringWasher(dims) {
    const D = dims.D || 10, OD = dims.OD || D * 1.8;
    const T = dims.T || D * 0.3;       // 두께(폭)
    const H = dims.H || T * 1.5;       // 자유 높이
    const midR = (D / 2 + OD / 2) / 2, wireR = (OD / 2 - D / 2) / 2;
    // 330도 토러스 (절개부 30도)
    const g = new THREE.TorusGeometry(midR, wireR, 8, 48, Math.PI * 1.83);
    const m = new THREE.Mesh(g, springMaterial.clone());
    m.position.z = H / 2; modelGroup.add(m);
    // 양 끝 캡
    const capG = new THREE.SphereGeometry(wireR, 8, 8);
    const a = Math.PI * 1.83;
    const cap1 = new THREE.Mesh(capG, springMaterial.clone());
    cap1.position.set(midR * Math.cos(a), midR * Math.sin(a), H / 2); modelGroup.add(cap1);
    const cap2 = new THREE.Mesh(capG.clone(), springMaterial.clone());
    cap2.position.set(midR, 0, H / 2); modelGroup.add(cap2);
    if (options.dimensions) buildSpringWasherDimOnly(dims);
}

function buildSpringWasherDimOnly(dims) {
    const D = dims.D || 10, OD = dims.OD || D * 1.8, T = dims.T || D * 0.3, H = dims.H || T * 1.5;
    addVerticalDim(-OD / 2 - 10, 0, H, 'H', H);
    addHorizontalDim(-OD / 2, OD / 2, -5, OD / 2 + 10, 'OD', OD);
    addHorizontalDim(-D / 2, D / 2, H + 5, D / 2 + 10, 'D', D);
}

// ═══════════════════════════════════════════════════
// ⑬ SERVO_MOTOR — 서보 모터 (야스카와 SGM-7 계열)
// ═══════════════════════════════════════════════
/**
 * C++ CreateSquareFrameBody/CreateSolidShaft/CreateSquareFlange 로직 포팅
 *
 * ★ 좌표계 (C++ Inventor 기준, JS Three.js Y-axis 방향)
 *   Y=0   : 샤프트 끝단
 *   Y=LR  : 플랜지 전면 (모터 본체 시작)
 *   Y=LR+TL  : 본체 A 구간 끝
 *   Y=LR+L2  : 본체 B 구간 끝 (엔코더 시작)
 *   Y=LR+L1  : 모터 전체 끝 = LX
 *
 * ★ DB 필드명 매핑 (Excel → JS dims 키)
 *   'L1(LL)'   = 본체 길이 (플랜지면~뒤끝)
 *   'LO1(LLO)' = 브레이크 부착 시 본체 길이
 *   'CW(MW)'   = M커넥터 폭,  'CL(ML)' = 길이,  'CH(MH)' = 높이
 *   'ES(MD)'   = E커넥터 측면 위치
 *   'PCD(LA)'  = 마운팅홀 PCD,  'M(LZ)' = 볼트규격,  'TL(LG)' = 탭 깊이
 */

// ── 모터 재질 ──
const motorFrameMat  = new THREE.MeshStandardMaterial({ color: 0x2C2C2C, metalness: 0.55, roughness: 0.45 });
const motorFlangeMat = new THREE.MeshStandardMaterial({ color: 0xA8B0BB, metalness: 0.75, roughness: 0.25 });
const motorShaftMat  = new THREE.MeshStandardMaterial({ color: 0xC8CDD3, metalness: 0.90, roughness: 0.12 });
const motorConnMat   = new THREE.MeshStandardMaterial({ color: 0x1A1A1A, metalness: 0.30, roughness: 0.70 });
const motorEncoderMat= new THREE.MeshStandardMaterial({ color: 0x22222A, metalness: 0.50, roughness: 0.60 });
const motorLabelMat  = new THREE.MeshStandardMaterial({ color: 0xF0C040, metalness: 0.00, roughness: 1.00 });

/** dims 키 안전 접근 (괄호 포함 키 처리) */
function motorDim(dims, key, fallback=0) {
    if (dims === null || dims === undefined) return fallback;
    const v = dims[key];
    if (v === null || v === undefined || v === '' || isNaN(Number(v))) return fallback;
    return Number(v);
}

/**
 * ★ v50: 모터 옵션 해석 헬퍼
 *
 *  C# SpecSelectorResponse.Options (문자열 Dictionary)에서 받은 값을 우선 사용하고,
 *  누락 시 dims 기반으로 자동 판정 (C++ SetMotorOptions 로직과 동일).
 *
 *  C++ SetMotorOptions 원본:
 *    hasGearhead <- Info.GearHead 문자열에 "H" 포함
 *    hasEncoder  <- Dim.EnH > 0 || Dim.EnL > 0
 *    hasBrake    <- Dim.SL  > 0  (또는 Attachment_Options에 "E" 또는 "C")
 *    hasConnector<- Dim.CW_MW > 0
 *    hasOilSeal  <- (엑셀 정의) Dim.LB1 > 0 || Dim.LE1 > 0  (오일씰 커버 치수 존재)
 *
 *  ★ v50 핫픽스: 실전 데이터에서 옵션 명시도 안 되고 dims에 G_*도 안 들어오는 경우
 *               (SpecWindow가 C# UpdatePreview 호출 시 SelectedData 미전달) 대응을 위해
 *               여러 경로의 자동 판정을 추가.
 *
 *  감지 우선순위:
 *    1) opts.hasGearhead가 명시적으로 지정됨 (C# options payload)
 *    2) opts의 모든 value 중 "감속기/Gearhead/Reducer/HDS" 문자열 포함
 *    3) dims에 G_S / G_LL / G_LX 중 하나라도 > 0
 *    4) dims에 G_ 접두사 키가 존재 (값 상관 없이)  ← 모터 DB가 감속기 칼럼을 가진 경우
 *    5) partCode에 감속기 패턴 존재 (YASKAWA: ...AH[C/M/B/L][숫자], 기타 제조사 대응)
 *
 *  @param {object} dims    motorDim()으로 접근 가능한 치수 객체
 *  @param {object} opts    currentMotorOptions (문자열 값 Dictionary)
 *  @param {string} partCode  currentPartCode (주문코드; 감속기 제품코드 패턴 감지용)
 *  @returns {{hasBrake:boolean, hasGearhead:boolean, hasEncoder:boolean, hasOilSeal:boolean, hasConnector:boolean, bodyType:string, shaftType:string, flangType:string}}
 */
function resolveMotorOpts(dims, opts, partCode) {
    opts = opts || {};
    partCode = partCode || '';

    // 문자열 "true"/"True"/"1" → true,  그 외(없음, "false" 등) → false
    const asBool = (v) => {
        if (v === undefined || v === null || v === '') return null;  // null = 미지정
        const s = String(v).trim().toLowerCase();
        return s === 'true' || s === '1' || s === 'yes';
    };

    // 옵션이 명시되어 있으면 그 값, 아니면 dims 기반 자동 판정
    const optBrake     = asBool(opts.hasBrake);
    const optGearhead  = asBool(opts.hasGearhead);
    const optEncoder   = asBool(opts.hasEncoder);
    const optOilSeal   = asBool(opts.hasOilSeal);
    const optConnector = asBool(opts.hasConnector);

    // ─── hasGearhead 다단계 자동 판정 ───
    const scanOpts = (keywords) => {
        // opts의 모든 value(선택 라벨 문자열)에 keyword 포함 여부 확인
        // 예: opts["감속기 종류⑧"] = "H: 정밀 감속기 HDS"
        //     opts["타입"] = "중관성 고속(감속기 일체형)"
        for (const [k, v] of Object.entries(opts)) {
            if (typeof v !== 'string') continue;
            for (const kw of keywords) {
                if (v.includes(kw)) return true;
            }
            // 키 자체에도 "감속기" 포함 가능 (예: "감속기 종류")
            if (k && typeof k === 'string') {
                for (const kw of keywords) {
                    if (k.includes(kw)) {
                        // 값이 공백/None 이 아닐 때만 감속기 있음으로 판정
                        if (v.trim() !== '' &&
                            !['없음', 'none', 'null', '0', 'no'].includes(v.trim().toLowerCase())) {
                            return true;
                        }
                    }
                }
            }
        }
        return false;
    };

    const hasGDimKey = dims ? Object.keys(dims).some(k => typeof k === 'string' && k.startsWith('G_') && motorDim(dims, k) > 0) : false;
    const hasGDimPositive = motorDim(dims, 'G_S') > 0 || motorDim(dims, 'G_LL') > 0 || motorDim(dims, 'G_LX') > 0 || motorDim(dims, 'G_LC') > 0;

    // 주문코드 패턴 감지: YASKAWA 표준은 AH[C/M/B/L/H][숫자] 형태 (예: SGM7J-A5A7AHC61)
    //   pat1: 'H' 뒤에 영문+숫자 (예: AHC6)
    //   pat2: 'H' 바로 뒤 숫자 (예: AH61)
    //   pat3: 'GH' 감속기 패턴 (예: AGHD)
    //   pat4: 'GEAR'/'REDUC' 키워드
    const pcUpper = (partCode || '').toUpperCase();
    const hasGearPartCodePattern = /[A-Z0-9]H[A-Z][0-9]/.test(pcUpper) ||     // AHC6 류
                                     /[A-Z0-9]H[0-9]/.test(pcUpper) ||          // AH61 류
                                     /[A-Z0-9]GH[A-Z0-9]/.test(pcUpper) ||      // GHD 류
                                     pcUpper.includes('GEAR') ||
                                     pcUpper.includes('REDUC');

    const autoGearhead = scanOpts(['감속기', 'Gearhead', 'GEARHEAD', 'Reducer', 'REDUCER', 'HDS']) ||
                          hasGDimPositive ||
                          hasGDimKey ||
                          hasGearPartCodePattern;

    // ─── hasBrake 자동 판정 보강 (마찬가지) ───
    const autoBrake = motorDim(dims, 'SL') > 0 ||
                       scanOpts(['브레이크', 'Brake', 'BRAKE']);

    return {
        hasBrake:     optBrake     !== null ? optBrake     : autoBrake,
        hasGearhead:  optGearhead  !== null ? optGearhead  : autoGearhead,
        hasEncoder:   optEncoder   !== null ? optEncoder   : (motorDim(dims, 'EnH') > 0 ||
                                                              motorDim(dims, 'EnL') > 0),
        hasOilSeal:   optOilSeal   !== null ? optOilSeal   : (motorDim(dims, 'LB1') > 0 ||
                                                              motorDim(dims, 'LE1') > 0),
        hasConnector: optConnector !== null ? optConnector : (motorDim(dims, 'CW(MW)') > 0 ||
                                                              motorDim(dims, 'CW') > 0),
        bodyType:  (opts.bodyType  || 'Standard'),   // Standard, Servo, Stepper, BLDC, Gearhead, ...
        shaftType: (opts.shaftType || 'Straight'),   // Straight, Keyway_WithKey, D_Cut_Single, ...
        flangType: (opts.flangType || 'Round')       // Round, Square, FootMount, FaceMount
    };
}

/** 라운드 사각형 Shape (Three.js Shape) */
function makeRoundRectShape(w, h, rad, holeR=0) {
    const s = new THREE.Shape();
    const hw = w/2, hh = h/2, r = Math.min(rad, hw*0.5, hh*0.5);
    s.moveTo(-hw+r, -hh);
    s.lineTo( hw-r, -hh);  s.quadraticCurveTo( hw, -hh,  hw, -hh+r);
    s.lineTo( hw,  hh-r);  s.quadraticCurveTo( hw,  hh,  hw-r,  hh);
    s.lineTo(-hw+r,  hh);  s.quadraticCurveTo(-hw,  hh, -hw,  hh-r);
    s.lineTo(-hw, -hh+r);  s.quadraticCurveTo(-hw, -hh, -hw+r, -hh);
    s.closePath();
    if (holeR > 0) {
        const h2 = new THREE.Path();
        for (let i=0; i<=32; i++) {
            const a = Math.PI*2*i/32;
            if (i===0) h2.moveTo(holeR*Math.cos(a), holeR*Math.sin(a));
            else h2.lineTo(holeR*Math.cos(a), holeR*Math.sin(a));
        }
        s.holes.push(h2);
    }
    return s;
}

/** 원형 Shape (도넛형 가능) */
function makeCircleShape(outerR, innerR=0) {
    const s = new THREE.Shape();
    for (let i=0; i<=48; i++) {
        const a = Math.PI*2*i/48;
        if (i===0) s.moveTo(outerR*Math.cos(a), outerR*Math.sin(a));
        else       s.lineTo(outerR*Math.cos(a), outerR*Math.sin(a));
    }
    if (innerR > 0.01) {
        const h = new THREE.Path();
        for (let i=0; i<=32; i++) {
            const a = Math.PI*2*i/32;
            if (i===0) h.moveTo(innerR*Math.cos(a), innerR*Math.sin(a));
            else       h.lineTo(innerR*Math.cos(a), innerR*Math.sin(a));
        }
        s.holes.push(h);
    }
    return s;
}

/** Shape → ExtrudeGeometry (Y축 방향 돌출, 기본은 XZ 평면 단면) */
function extrudeShapeY(shape, depth) {
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
    // ExtrudeGeometry 기본은 Z방향 → Y방향으로 회전
    geo.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI/2));
    return geo;
}

function buildServoMotor(dims) {
    // ══════════════════════════════════════════════════════════════════════
    //  서보 모터 (야스카와 SGM-7 시리즈) — v48 공용 헬퍼 기반
    //
    //  C++ CreateSquareFrameBody 구조 충실 재현 + v47 방향 문제 수정.
    //
    //  ★ 좌표계 (Three.js Y축 = 모터 회전축)
    //     v48 수정: 샤프트가 +Y 방향(카메라 가까운 쪽)이 되도록 뒤집음.
    //
    //     Y=+LR          : 샤프트 끝단 (카메라 가까운 쪽, 오른쪽)
    //     Y=0            : 플랜지 전면
    //     Y=-endbellLen  : Stator Stack 시작 (-)
    //     Y=-L2          : Encoder Cap 시작
    //     Y=-L1          : 모터 뒤끝 (-LX+LR)
    //
    //  ★ DB 필드명 매핑 (C++ ConvertToMotorPartData 기준)
    //     S         : 샤프트 직경
    //     LR        : 샤프트 돌출 길이 (플랜지~축끝)
    //     LX        : 전체 길이 (= LR + L1)
    //     L1(LL)    : 플랜지~본체 뒤끝
    //     L2        : 플랜지~엔코더 시작
    //     LC, LH    : 프레임 가로/세로
    //     LB        : 베어링 보스 OD,  LE: 보스 돌출 두께
    //     TL(LG)    : 마운팅 탭 깊이
    //     PCD(LA)   : 체결홀 PCD,  M(LZ): 탭 크기 문자열
    //     EnH, EnL  : 엔코더 높이, 길이
    //     CW(MW), CL(ML), CH(MH) : 커넥터 박스 W, L, H
    //     ES(MD)    : 엔코더 커넥터 측면 오프셋
    // ══════════════════════════════════════════════════════════════════════

    // ─── 치수 (C++ 폴백 규칙 포함) ───
    //   v50: hasBrake=true일 때 L1→LO1_LLO, L2→LO2, L3→LO3 으로 치환
    //        (C++ CreateSquareFrameBody 동일 로직. 엑셀 정의:
    //         LO1_LLO = 브레이크 부착 시 샤프트 제외 전체 길이,
    //         LO2     = 브레이크 부착 시 샤프트 및 엔코더 제외 길이,
    //         LO3     = 브레이크 부착 시 L1에서 EL을 뺀 거리)
    const LC   = motorDim(dims, 'LC',       40);
    const LH   = motorDim(dims, 'LH',       LC);
    const LR   = motorDim(dims, 'LR',       LC * 0.40);

    // ★ v50: 모터 옵션 해석
    const mOpt = resolveMotorOpts(dims, currentMotorOptions, currentPartCode);
    const hasBrake = mOpt.hasBrake;
    const hasGearhead = mOpt.hasGearhead;   // ★ v50-2세션차

    // ★ v50: 브레이크 유무에 따라 치수 키 선택
    const LX_raw   = motorDim(dims, 'LX',      0);
    const LO_raw   = motorDim(dims, 'LO',      0);  // 브레이크 부착 시 전체길이
    const LX       = hasBrake ? (LO_raw > 0 ? LO_raw : LX_raw || LC * 2.4) : (LX_raw || LC * 2.0);

    const L1_key   = hasBrake ? 'LO1(LLO)' : 'L1(LL)';
    const L2_key   = hasBrake ? 'LO2'      : 'L2';
    const L3_key   = hasBrake ? 'LO3'      : 'L3';
    const L1       = motorDim(dims, L1_key, LX - LR);
    const L2       = motorDim(dims, L2_key, hasBrake ? L1 * 0.45 : L1 * 0.55);
    const L3       = motorDim(dims, L3_key, L2 * 1.6);

    const S    = motorDim(dims, 'S',        LC * 0.20);
    const LB   = motorDim(dims, 'LB',       LC * 0.78);
    const LE   = motorDim(dims, 'LE',       LC * 0.10);
    const TL   = motorDim(dims, 'TL(LG)',   LC * 0.20);
    const PCD  = motorDim(dims, 'PCD(LA)',  LC * 1.12);
    const EnH  = motorDim(dims, 'EnH',      LH);
    const EnW  = LC;
    const EnL  = motorDim(dims, 'EnL',      Math.max(L1 - L2, LC * 0.3));
    const CW   = motorDim(dims, 'CW(MW)',   LC * 0.5);
    const CL   = motorDim(dims, 'CL(ML)',   LC * 0.35);
    const CH   = motorDim(dims, 'CH(MH)',   LC * 0.15);
    const ES   = motorDim(dims, 'ES(MD)',   0);
    const tapDia = _parseTapSize(dims['M(LZ)'], 3);

    // ★ v50: 브레이크 치수
    //   SL    = LS모터 하단부 형상 치수 (C++ CreateBrakeSection에서 brakeLen으로 사용)
    //   없으면 (L1 - L2 - EnL)로 추정 (C++ 폴백 동일)
    const SL_raw = motorDim(dims, 'SL', 0);
    const SL     = hasBrake ? (SL_raw > 0 ? SL_raw : Math.max(L1 - L2 - EnL, LC * 0.25)) : 0;

    // ═══════════════════════════════════════════════════════════════════════════
    // ★ v50 2세션차: Gearhead 치수 매핑 (C++ CreateGearheadBodyPart/ShaftPart 기준)
    // ═══════════════════════════════════════════════════════════════════════════
    //   엑셀 정의 (부품별치수명정의한_문서.xlsx 참조):
    //     G_LC  : 플랜지 외곽 폭 (정사각)
    //     G_LG  : 플랜지 파트 두께
    //     G_LA  : 체결 홀 PCD
    //     G_LZ  : 체결 홀 직경
    //     G_LB  : Pilot1 (인로우) 외경
    //     G_LE  : Pilot1 두께
    //     G_LD  : Pilot2 외경 (플랜지 뒤쪽 메인 하우징 원통부 외경과 동일 필드)
    //     G_L3  : Pilot2 포함 총 단차 길이 (Pilot1 + Pilot2)
    //     G_LL  : 브레이크 無 전체 바디 길이 (모터+감속기 바디부)
    //     G_LLO : 브레이크 有 전체 바디 길이
    //     G_LX  : 브레이크 無 감속기 포함 전체 길이 (샤프트 포함)
    //     G_LO  : 브레이크 有 감속기 포함 전체 길이
    //     G_LR  : 플랜지면 → 출력축 끝단 전체 축 돌출 길이
    //     G_S   : 감속기 출력축 메인 직경
    //     G_B   : 로드 회전부 이음 바깥 원크기 (G_S보다 큼)
    //     G_C   : 로드 회전부 이음 원크기 (G_B와 비슷 또는 작음)
    //     G_L1  : Pilot2 이후 ~ (G_B 단 끝) 길이
    //     G_L2  : G_L1 이후 ~ (G_C 단 끝) 길이 — 샤프트 전체 돌출
    //     G_L3  : (C++ 재사용) 감속기 출력축에서도 G_L3 쓰이나 GearheadBodyPart의 G_L3와 다름
    //             ShaftPart에서 length1 = G_L1 - G_L3 계산에 쓰임
    //     G_Q   : G_S 유효 돌출 길이
    //     G_W / G_T / G_QK : 감속기 축 키홈 폭/두께/길이
    //     G_TM / G_TapL : 감속기 축 끝단 탭 규격/깊이
    // ═══════════════════════════════════════════════════════════════════════════
    const G_LC = motorDim(dims, 'G_LC',  hasGearhead ? LC * 1.1 : 0);
    const G_LG = motorDim(dims, 'G_LG',  hasGearhead ? LC * 0.15 : 0);
    const G_LA = motorDim(dims, 'G_LA',  hasGearhead ? G_LC * 0.75 : 0);
    const G_LZ = motorDim(dims, 'G_LZ',  hasGearhead ? G_LC * 0.10 : 0);
    const G_LB = motorDim(dims, 'G_LB',  hasGearhead ? G_LC * 0.55 : 0);
    const G_LE = motorDim(dims, 'G_LE',  hasGearhead ? LC * 0.10 : 0);
    const G_LD = motorDim(dims, 'G_LD',  hasGearhead ? G_LC * 0.88 : 0);
    const G_LL = motorDim(dims, 'G_LL',  0);
    const G_LLO= motorDim(dims, 'G_LLO', 0);

    // 감속기 출력축 치수
    const G_S   = motorDim(dims, 'G_S',  hasGearhead ? S * 1.4 : 0);
    const G_B   = motorDim(dims, 'G_B',  0);
    const G_C   = motorDim(dims, 'G_C',  0);
    const G_L1  = motorDim(dims, 'G_L1', hasGearhead ? LC * 0.40 : 0);
    const G_L2  = motorDim(dims, 'G_L2', hasGearhead ? LC * 0.80 : 0);
    const G_L3_shaft = motorDim(dims, 'G_L3_shaft', 0);   // ★ 이름 충돌 회피: ShaftPart에서 참조하는 G_L3
    // 실제 C++은 같은 키 'G_L3'를 Body와 Shaft 양쪽에서 재사용 → dims['G_L3']로 접근
    const G_L3  = motorDim(dims, 'G_L3', hasGearhead ? LC * 0.12 : 0);
    const G_Q   = motorDim(dims, 'G_Q',  hasGearhead ? G_L2 * 0.65 : 0);
    const G_W   = motorDim(dims, 'G_W',  0);
    const G_T   = motorDim(dims, 'G_T',  G_W * 0.4);
    const G_QK  = motorDim(dims, 'G_QK', 0);
    const G_TapL = motorDim(dims, 'G_TapL', 0);

    // Gearhead 바디 파생 치수 (C++ CreateGearheadBodyPart 기준)
    //   L1_LL = 모터 본체 길이 (브레이크 없을 때 L1)
    //   G_Length = G_LL - L1_LL = 감속기 바디+플랜지 전체 길이
    //   bodyLen  = G_Length - G_LG = 순수 바디(원통) 길이
    const L1_LL_for_gear = motorDim(dims, 'L1(LL)', 0) || L1;  // 모터 본체 길이 (브레이크 무관)
    const G_LLeff = hasBrake ? (G_LLO > 0 ? G_LLO : G_LL) : G_LL;
    let gearTotalLen = G_LLeff - L1_LL_for_gear;
    // ★ v50 핫픽스: G_LL 누락 시 폴백을 HDS 감속기 실제 비율(약 LC*1.2)로 조정
    //   (기존 LC*0.4는 너무 짧아서 감속기가 안 보이는 것처럼 보임)
    if (!(gearTotalLen > 0)) {
        gearTotalLen = LC * 1.2;
        if (typeof logToCSharp === 'function') {
            logToCSharp('[Gearhead fallback] G_LL missing, using LC*1.2=' + gearTotalLen.toFixed(1) +
                        ' (partCode=' + (currentPartCode || '') + ')');
        }
    }
    let gearBodyLen = gearTotalLen - G_LG;
    if (!(gearBodyLen >= 0)) gearBodyLen = 0;

    // Pilot 길이 (C++: pilot2Len = G_L3 - G_LE)
    const pilot1Len = hasGearhead ? G_LE : 0;
    const pilot2Len = hasGearhead ? Math.max(G_L3 - G_LE, 0) : 0;

    // 파생 치수
    const cornerR    = Math.max(LC * 0.04, 0.6);
    const endbellLen = L2 * 0.15;                    // Front Endbell (알루미늄)
    const statorLen  = L2 - endbellLen;              // Stator (강철)
    const statorIndent = Math.min(1.0, LC * 0.04);   // Stator는 Endbell보다 1mm 안쪽 (C++ 동일)
    const brakeIndent  = Math.min(2.0, LC * 0.08);   // Brake는 본체보다 2mm 안쪽 (C++ CreateSquareFrameBody 동일)

    // ★ v48: 좌표계 뒤집음 — 샤프트 +Y, 엔코더 -Y
    // (v47은 샤프트 +Y=0~LR, 엔코더가 +Y 먼 곳에 있어서 카메라와 반대)
    //
    // ★ v50: 브레이크 있을 때 Z축 배치
    //   Y= +LR           : 샤프트 끝
    //   Y=  0            : 플랜지 전면
    //   Y= -endbellLen   : Stator 시작
    //   Y= -L2           : Stator 끝 (= Brake 시작)
    //   Y= -(L2+SL)      : Brake 끝 (= Encoder 시작)       [hasBrake=true일 때만]
    //   Y= -L1           : 모터 뒤끝
    //   ※ hasBrake=false일 때는 Y= -L2 에서 바로 Encoder 시작 (기존 동작 유지)
    const shaftTipY     = LR;      // 샤프트 끝 (+Y 최대)
    const flangeY       = 0;       // 플랜지 전면
    const statorStartY  = -endbellLen;
    const brakeStartY   = -L2;                       // ★ v50: 브레이크 시작 (hasBrake=true일 때만)
    const encoderStartY = hasBrake ? -(L2 + SL) : -L2;
    const motorEndY     = -L1;     // 모터 뒤끝

    // ─── 1. 샤프트 (Y=0 ~ +LR) ───
    //   ★ v50 2세션차: hasGearhead=true면 샤프트를 숨김
    //   (C++ 어셈블리에서는 모터 축이 감속기 내부에 메이트로 결합되어 시각적으로 가려짐)
    if (!hasGearhead) {
        _buildShaftWithChamfer({
            dia: S, length: LR, posY: shaftTipY, tipTowards: 'minus',
            material: MAT.chrome()
        });
    }

    // ─── 2. 베어링 보스 (Y=0 ~ -LE, 원형 LB) ───
    // 플랜지 전면에서 샤프트 쪽으로 약간 돌출된 원형 보스
    //   ★ v50 2세션차: hasGearhead=true면 보스도 숨김 (Pilot1/Pilot2가 그 역할 대신)
    if (LB > 0 && LE > 0 && !hasGearhead) {
        _buildCylinder({
            dia: LB, length: LE,
            posY: flangeY,    // 위로 LE만큼 (shaft 쪽)
            material: MAT.aluminum()
        });
    }

    // ─── 3. Front Endbell (Y=0 ~ -endbellLen, 사각 LC×LH, 알루미늄) ───
    // _extrudeShapeY는 depth만큼 +Y 방향으로 extrude.
    // endbell은 flangeY(=0)에서 시작해서 -Y 방향으로 extrude해야 함.
    // → posY = flangeY - endbellLen 으로 시작, extrude는 +Y 방향 endbellLen.
    _buildRoundedBox({
        w: LC, h: LH, depth: endbellLen,
        posY: flangeY - endbellLen,
        cornerR, holeR: S / 2 + 0.3,
        material: MAT.aluminum()
    });

    // ─── 4. Stator Stack (statorIndent만큼 안쪽 사각, 중간 회색) ───
    _buildRoundedBox({
        w: LC - statorIndent * 2, h: LH - statorIndent * 2,
        depth: statorLen,
        posY: statorStartY - statorLen,  // -endbellLen - statorLen = -L2
        cornerR: Math.max(cornerR - statorIndent, 0.3),
        holeR: S / 2 + 0.3,
        material: MAT.steelCast()
    });

    // ─── ★ v50 NEW: 4-B. Brake Module + Brake Cover (hasBrake=true일 때만) ───
    //   C++ CreateSquareFrameBody 3-1 / 3-2 단계 동일.
    //   Stator 뒤쪽 [-L2 ~ -(L2+SL)] 구간에 배치.
    //
    //   Brake Module : 본체보다 2mm 안쪽 rounded box (아연도금 재질)
    //   Brake Cover  : 프레임 외곽 크기, 중앙은 모듈과 같은 크기로 도넛형으로 속빔
    //                  (알루미늄 재질 — 전면 브라켓과 동일)
    if (hasBrake && SL > 0.01) {
        const brakeW = LC - brakeIndent * 2;
        const brakeH = LH - brakeIndent * 2;
        const brakeCornerR = Math.max(cornerR - brakeIndent, 0.3);

        // [Brake Module] 내부 블록 (본체보다 2mm 안쪽)
        _buildRoundedBox({
            w: brakeW, h: brakeH, depth: SL,
            posY: brakeStartY - SL,   // -L2 - SL = -(L2+SL) = encoderStartY
            cornerR: brakeCornerR,
            holeR: S / 2 + 0.3,
            material: MAT.steelDark()    // 강철-아연도금(C++ "Steel - Galvanized") 느낌
        });

        // [Brake Cover] 프레임 외곽 크기 + 내부 속빔 (도넛형)
        //   C++ 구현: 외곽선(LC) + 내측선(Brake Module) 동시 스케치 후 Extrude
        //   Three.js: rounded-rect shape에 홀을 rounded-rect 형태로 추가.
        //             (makeRoundRectShape는 원형 홀만 지원하므로 별도 shape 필요)
        {
            const hw = LC / 2, hh = LH / 2;
            const r  = Math.min(cornerR, hw * 0.5, hh * 0.5);
            const coverShape = new THREE.Shape();
            coverShape.moveTo(-hw + r, -hh);
            coverShape.lineTo( hw - r, -hh); coverShape.quadraticCurveTo( hw, -hh,  hw, -hh + r);
            coverShape.lineTo( hw,  hh - r); coverShape.quadraticCurveTo( hw,  hh,  hw - r,  hh);
            coverShape.lineTo(-hw + r,  hh); coverShape.quadraticCurveTo(-hw,  hh, -hw,  hh - r);
            coverShape.lineTo(-hw, -hh + r); coverShape.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
            coverShape.closePath();

            // 내측 rounded-rect 홀 (brakeW × brakeH)
            const ihw = brakeW / 2, ihh = brakeH / 2;
            const ir  = Math.min(brakeCornerR, ihw * 0.5, ihh * 0.5);
            const hole = new THREE.Path();
            // 반시계 방향 (Shape의 홀은 반시계)
            hole.moveTo(-ihw + ir, -ihh);
            hole.lineTo(-ihw, -ihh + ir); hole.quadraticCurveTo(-ihw, -ihh, -ihw + ir, -ihh);   // 순서 조정
            // 정확한 반시계 경로 — 단순 사각 근사 (rounded corner는 외곽과 동일 로직이라 괄호 혼동됨)
            // 아래처럼 시계→반시계 반전으로 재작성:
            const hole2 = new THREE.Path();
            hole2.moveTo(-ihw + ir, -ihh);
            hole2.quadraticCurveTo(-ihw, -ihh, -ihw, -ihh + ir);
            hole2.lineTo(-ihw,  ihh - ir); hole2.quadraticCurveTo(-ihw,  ihh, -ihw + ir,  ihh);
            hole2.lineTo( ihw - ir,  ihh); hole2.quadraticCurveTo( ihw,  ihh,  ihw,  ihh - ir);
            hole2.lineTo( ihw, -ihh + ir); hole2.quadraticCurveTo( ihw, -ihh,  ihw - ir, -ihh);
            hole2.lineTo(-ihw + ir, -ihh);
            coverShape.holes.push(hole2);

            const coverGeo = _extrudeShapeY(coverShape, SL);
            const coverMesh = new THREE.Mesh(coverGeo, MAT.aluminum());
            coverMesh.position.set(0, brakeStartY - SL, 0);   // Brake와 같은 구간
            modelGroup.add(coverMesh);
        }
    }

    // ─── 5. Encoder Cap (Y=-L2 ~ -L1, 검정  /  hasBrake시 Y=-(L2+SL) ~ -L1) ───
    {
        const encH = EnH > 0 ? EnH : LH;
        const encW = EnW > 0 ? EnW : LC;
        const encCornerR = Math.max(cornerR - 0.2, 0.3);
        const encCenterOffset = (encH - LH) / 2;  // 엔코더가 프레임보다 클 때 위로 오프셋

        // ★ v50: hasBrake=true이면 Encoder 길이가 자동 계산됨
        //   L1은 이미 LO1_LLO (Brake 포함 전체 길이) 값이므로
        //   encoderStartY(=-(L2+SL)) 에서 motorEndY(=-L1)까지의 거리가 실제 EnL.
        //   단, dims에 EnL이 명시돼 있으면 그 값을 우선 사용.
        const actualEnL = EnL > 0
            ? Math.min(EnL, Math.abs(motorEndY - encoderStartY))
            : Math.abs(motorEndY - encoderStartY);

        _buildRoundedBox({
            w: encW, h: encH, depth: actualEnL,
            posY: motorEndY,              // 모터 뒤끝부터 시작해서 +Y로 extrude
            cornerR: encCornerR,
            holeR: 0,  // 엔코더는 관통 없음
            material: MAT.plasticDark(),
            offsetZ: encCenterOffset
        });
    }

    // ─── 6. 마운팅 홀 (플랜지 전면 4개, 45° 시작각, C++ 동일) ───
    _buildMountingHoles({
        count: 4, pcd: PCD, holeR: tapDia / 2,
        depth: TL + LE,
        posY: flangeY - (TL + LE),  // 플랜지 안쪽으로 파고듦
        startAngle: Math.PI / 4
    });

    // ─── 7. 엔코더 커넥터 + L자 케이블 + IX40 플러그 ───
    //   ★ v50 S4-Fix6: 실제 CAD 기준으로 배치 교정
    //     [1] 케이블 인출부 (Cable Boss) — 엔코더 상단 "뒤쪽(-Y, 모터 뒤끝 쪽)"에 원통형 부트
    //         재질: rubberBlack, 케이블이 여기서 위로 나와 +Y로 꺾임
    //     [2] 신호 커넥터 소켓 (Connector Socket) — 엔코더 상단 "앞쪽(+Y, 샤프트 쪽)"에 사각 셸
    //         전면(+Y 방향)에 어두운 개구부 + 4개 금색 핀 수평 돌출
    //     [3] L자 케이블: [1] 위에서 +Z로 올라가 +Y로 꺾여 샤프트 쪽으로 진행
    //                    (소켓 위로 지나감)
    //     [4] 케이블 끝: IX40 표준 플러그
    //
    //   좌표계: Y축=모터 축방향(+Y 샤프트, -Y 엔코더), Z축=수직
    //   엔코더 상단 Y 분할:
    //     뒤쪽(-Y): 케이블 인출부 — Y = encMidY - EnL*0.27
    //     앞쪽(+Y): 커넥터 소켓    — Y = encMidY + EnL*0.25
    if (CW > 0 && CH > 0 && CL > 0) {
        const encH = EnH > 0 ? EnH : LH;
        const encCenterOffset = (encH - LH) / 2;
        const encMidY = (encoderStartY + motorEndY) / 2;
        const encTopZ = encCenterOffset + encH / 2;  // 엔코더 상단 Z

        // ─────────────────────────────────────────────────────────────
        // [1] 케이블 인출부 (Cable Boss) — 원통형 고무 부트
        //     위치: 엔코더 상단 "뒤쪽(-Y)" ← 실제 CAD 이미지와 일치
        //     형태: 하단 약간 두꺼운 어깨 + 상단 가는 원통
        //     ★ S4-Fix11: 소형(EnL<18) 대응 — 인출부를 엔코더 상단의 주요 부품으로 크게
        // ─────────────────────────────────────────────────────────────
        const EnL_actual = Math.abs(encoderStartY - motorEndY);   // 엔코더 실제 Y 길이
        // ★ 소형 판정: 본체 프레임 크기(LC)가 30mm 미만 — 15mm/25mm 모터 계열
        //   (EnL 기준은 DB 값 편차로 신뢰 불가)
        const isSmallEncoder = LC < 30;

        const bossDia = isSmallEncoder
            ? Math.min(CH * 0.95, EnL_actual * 0.50)               // 소형: 엔코더 뒤쪽에 적정 크기
            : Math.min(CH * 0.70, EnL_actual * 0.40);              // 중형: 기존 유지
        const bossShoulderH = CL * 0.18;
        const bossTopH = CL * 0.22;
        const bossX = 0;
        const bossY = isSmallEncoder
            ? encMidY - EnL_actual * 0.22                          // 소형: 엔코더 뒤쪽 22% 지점
            : encMidY - EnL_actual * 0.27;                         // 중형: 기존 유지 (뒤쪽)

        // 하단 어깨
        const bossShoulderGeo = new THREE.CylinderGeometry(
            bossDia / 2 * 1.15, bossDia / 2 * 1.15, bossShoulderH, 20
        );
        const bossShoulderMesh = new THREE.Mesh(bossShoulderGeo, MAT.rubberBlack());
        bossShoulderMesh.position.set(bossX, bossY, encTopZ + bossShoulderH / 2);
        modelGroup.add(bossShoulderMesh);

        // 상단 원통
        const bossTopGeo = new THREE.CylinderGeometry(
            bossDia / 2, bossDia / 2, bossTopH, 20
        );
        const bossTopMesh = new THREE.Mesh(bossTopGeo, MAT.rubberBlack());
        bossTopMesh.position.set(bossX, bossY, encTopZ + bossShoulderH + bossTopH / 2);
        modelGroup.add(bossTopMesh);

        const bossTopZ = encTopZ + bossShoulderH + bossTopH;

        // ─────────────────────────────────────────────────────────────
        // [2] 신호 커넥터 소켓 — 사각 셸 + 전면 개구부 + 4핀 수평 돌출
        //     위치: 엔코더 상단 "앞쪽(+Y)" ← 실제 CAD 이미지와 일치
        //     전면(개구부+핀): +Y 방향 (샤프트 쪽을 바라봄)
        //     ★ S4-Fix11: 중형/소형 분기
        //       - 중형(EnL>=18): 기존 Fix7 동작 (엔코더~본체 위 넓게 걸침)
        //       - 소형(EnL<18):  엔코더 앞쪽의 작은 독립 블록 (인출부와 분리)
        // ─────────────────────────────────────────────────────────────
        const sockW = isSmallEncoder ? (CW * 0.85) : (CW * 1.00);
        const sockD = isSmallEncoder
            ? (EnL_actual * 0.55)                                   // 소형: 엔코더 절반 이상 (중간에서 시작)
            : (EnL_actual * 0.95);                                  // 중형: 기존 유지
        const sockH = isSmallEncoder
            ? (CH * 0.65)                                            // 소형: 납작하게 (엔코더 위로 적게 솟음)
            : (CH * 0.95);                                          // 중형: 기존 유지
        const sockX = 0;
        const sockY = isSmallEncoder
            ? encMidY + EnL_actual * 0.375                          // 소형: 엔코더 중앙 앞 37.5% (엔코더 중간에서 시작, 본체 위 걸침)
            : encMidY + EnL_actual * 0.52;                          // 중형: 기존 유지
        // ★ 소켓 Z 위치:
        //   - 중형: 엔코더 상단에 얹힘 (기존)
        //   - 소형: 소켓 바닥이 본체 상단(LH/2)에 밀착 — 실제 CAD 15mm 기준
        //     (소켓 상단은 엔코더 상단을 살짝 넘길 수 있음 = 자연스러운 형태)
        const sockZ = isSmallEncoder
            ? (LH / 2 + sockH / 2)                                  // 소형: 본체 상단에 소켓 바닥 밀착
            : (encTopZ + sockH / 2);                                // 중형: 엔코더 상단 위

        // 외곽 사각 셸
        const sockGeo = new THREE.BoxGeometry(sockW, sockD, sockH);
        const sockMesh = new THREE.Mesh(sockGeo, MAT.plasticBlack());
        sockMesh.position.set(sockX, sockY, sockZ);
        modelGroup.add(sockMesh);

        // 전면 개구부 (+Y 방향 면)
        const openingW = sockW * 0.8;
        const openingH = sockH * 0.65;
        const openingD = Math.min(1.8, sockD * 0.4);
        const openingGeo = new THREE.BoxGeometry(openingW, openingD, openingH);
        const openingMat = new THREE.MeshStandardMaterial({ color: 0x080808, metalness: 0.1, roughness: 0.95 });
        const openingMesh = new THREE.Mesh(openingGeo, openingMat);
        // 셸 전면(+Y)에서 살짝 안쪽으로 파묻힘
        openingMesh.position.set(sockX, sockY + sockD / 2 - openingD / 2, sockZ);
        modelGroup.add(openingMesh);

        // 4개 금색 핀 — 개구부 안쪽에서 +Y 방향으로 수평 돌출
        //   박스가 가로로 넓어졌으므로 핀 폭 배열도 넓게, 핀 길이도 돌출감 있게
        const pinDia = Math.min(0.9, sockH * 0.20);
        const pinLen = Math.min(2.0, sockD * 0.20);
        const pinCount = 4;
        const pinSpan = openingW * 0.70;
        const pinStep = pinCount > 1 ? pinSpan / (pinCount - 1) : 0;
        const pinStart = -pinSpan / 2;

        // 핀 Y 위치: 셸 전면(+Y) 쪽 개구부에서 +Y로 살짝 노출
        const pinFaceY = sockY + sockD / 2 - openingD + pinLen / 2;

        for (let i = 0; i < pinCount; i++) {
            const offX = pinStart + i * pinStep;
            const pinGeo = new THREE.CylinderGeometry(pinDia / 2, pinDia / 2, pinLen, 8);
            // Y축 기본이므로 회전 불필요
            const pinMesh = new THREE.Mesh(pinGeo, MAT.brassGold());
            pinMesh.position.set(sockX + offX, pinFaceY, sockZ);
            modelGroup.add(pinMesh);
        }

        // ─────────────────────────────────────────────────────────────
        // [3] L자 케이블: 인출부 상단 → +Z → -X (좌우 방향으로 꺾임)
        //     ★ 실제 CAD: 케이블이 축방향이 아니라 "모터 측면"으로 꺾여 뻗음
        //     Front 뷰에서 이미지의 좌우 방향(X축)으로 케이블이 진행
        //     방향: -X (Front 뷰에서 이미지 오른쪽 → 실제 CAD 일치)
        // ─────────────────────────────────────────────────────────────
        const cableDia = Math.max(bossDia * 0.7, 1.8);
        const cableLen1 = CH * 1.6;             // +Z 수직 구간 (짧게)
        const cableLen2 = EnL_actual * 1.6;     // -X 좌우 구간 (모터 측면으로)

        // ─────────────────────────────────────────────────────────────
        // [4] 케이블 끝: IX40 플러그 (-X 방향 회전되어 붙음)
        // ─────────────────────────────────────────────────────────────
        const ix40Scale = Math.max(cableDia / 6.8, 0.75);

        _buildLCable({
            start: new THREE.Vector3(bossX, bossY, bossTopZ + 0.1),
            dir1: '+z', len1: cableLen1,
            dir2: '-x', len2: cableLen2,           // ★ +x → -x (실제 CAD 방향)
            dia: cableDia,
            endConnector: {
                type: 'IX40',
                scale: ix40Scale
            }
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ★ v50 2세션차 NEW: 9. Gearhead (감속기 일체형 파트) — hasGearhead=true일 때만
    // ═══════════════════════════════════════════════════════════════════════════
    //   C++ ExecuteGearheadAssembly: 모터 플랜지면(+Y=0)에 감속기 바디 후면을 메이트.
    //   Three.js 좌표: 감속기 바디는 flangeY(=0)에서 +Y 방향으로 뻗어나감.
    //
    //   구조 (C++ CreateGearheadBodyPart 순서 그대로):
    //     [1] Gearhead Body   : 사각 (G_LC×0.95), 길이 gearBodyLen      = Y ∈ [0, gearBodyLen]
    //     [2] Gearhead Flange : 사각 G_LC, 두께 G_LG                    = Y ∈ [gearBodyLen, gearBodyLen+G_LG]
    //     [3] Pilot 1 (인로우): 원형 G_LB, 두께 G_LE                    = Y ∈ [gearTotalLen, gearTotalLen+G_LE]
    //     [4] Pilot 2 (인로우): 원형 G_LD, 길이 pilot2Len               = Y ∈ [gearTotalLen+G_LE, gearTotalLen+G_LE+pilot2Len]
    //     [5] 마운팅 홀       : PCD G_LA, Ø G_LZ × 4개 (플랜지 컷)
    //     [6] 출력축          : 다단 (G_B → G_C → G_S) revolve
    // ═══════════════════════════════════════════════════════════════════════════
    if (hasGearhead) {
        // ─── Gearhead 재질 프리셋 ───
        const gearBodyMat   = MAT.steelCast();    // 감속기 하우징: 주철 질감
        const gearFlangeMat = MAT.aluminum();     // 플랜지: 알루미늄
        const gearPilotMat  = MAT.aluminum();     // Pilot: 알루미늄
        const gearShaftMat  = MAT.chrome();       // 출력축: 크롬

        // ─── [1] Gearhead Body (플랜지 뒤쪽 원통/사각 메인 하우징) ───
        //   엑셀 정의: G_LD = 순수 원통부 외경
        //   C++ 실제: CreateSketchRect(G_LC * 0.95, ...) → 사각 근사
        //   → 원통 우선, G_LD가 없으면 사각 G_LC*0.95로 폴백 (C++ 호환)
        let gearBodyEndY = flangeY;   // 현재 Gearhead 내 Y 커서
        if (gearBodyLen > 0.01) {
            if (G_LD > 0.01) {
                // 원통 (엑셀 정의 기준 — 더 정확한 형상)
                _buildCylinder({
                    dia: G_LD, length: gearBodyLen,
                    posY: gearBodyEndY,            // Y=0 ~ Y=gearBodyLen
                    material: gearBodyMat
                });
            } else {
                // 사각 폴백 (C++ 호환)
                const gearBodySide = G_LC * 0.95;
                const gearBodyCornerR = Math.max(cornerR, 0.6);
                _buildRoundedBox({
                    w: gearBodySide, h: gearBodySide, depth: gearBodyLen,
                    posY: gearBodyEndY, cornerR: gearBodyCornerR, holeR: 0,
                    material: gearBodyMat
                });
            }
            gearBodyEndY += gearBodyLen;
        }

        // ─── [2] Gearhead Flange (사각 G_LC, 두께 G_LG) ───
        if (G_LG > 0.01 && G_LC > 0.01) {
            const flangeCornerR = Math.max(cornerR, 0.6);
            _buildRoundedBox({
                w: G_LC, h: G_LC, depth: G_LG,
                posY: gearBodyEndY, cornerR: flangeCornerR,
                holeR: 0,        // 마운팅 홀은 별도 처리 (아래 [5])
                material: gearFlangeMat
            });
            gearBodyEndY += G_LG;   // 이제 gearBodyEndY = gearTotalLen = 플랜지 전면
        }
        const flangeFrontY = gearBodyEndY;    // 플랜지 전면 Y 좌표 (Pilot 시작)

        // ─── [3] Pilot 1 (원형 G_LB × G_LE) ───
        if (G_LB > 0.01 && pilot1Len > 0.01) {
            _buildCylinder({
                dia: G_LB, length: pilot1Len,
                posY: gearBodyEndY,
                material: gearPilotMat
            });
            gearBodyEndY += pilot1Len;
        }

        // ─── [4] Pilot 2 (원형 G_LD × pilot2Len) ───
        //   C++ 실제: Pilot2 외경은 G_LD (Body와 동일 필드 재사용)
        //   단, 바디가 이미 G_LD로 그려졌다면 Pilot2는 더 작은 축소 원통이어야 함.
        //   엑셀 정의상 Pilot1/Pilot2 관계에서 Pilot2가 더 작음이 일반적이나,
        //   C++ 구현이 G_LD를 재사용하므로 일단 C++ 동일 로직 유지.
        if (G_LD > 0.01 && pilot2Len > 0.01) {
            _buildCylinder({
                dia: G_LD, length: pilot2Len,
                posY: gearBodyEndY,
                material: gearPilotMat
            });
            gearBodyEndY += pilot2Len;
        }
        const gearOutputY = gearBodyEndY;   // 감속기 출력면 (Gear-Output-Plane)

        // ─── [5] 마운팅 홀 (플랜지 전면에 4개, 45°, G_LA PCD, Ø G_LZ) ───
        //   C++: CreateWorkPlane(YZ, G_Length - G_LG)에서 Positive 방향 G_LG 깊이로 컷
        //   Three.js: 홀은 실린더 메시를 얹어서 시각적으로 표시 (실제 boolean cut 없음)
        if (G_LA > 0.01 && G_LZ > 0.01) {
            _buildMountingHoles({
                count: 4, pcd: G_LA, holeR: G_LZ / 2,
                depth: G_LG * 1.05,                       // 플랜지를 관통하는 깊이
                posY: flangeFrontY - G_LG,                // 플랜지 후면부터 시작
                startAngle: Math.PI / 4                    // 45° (C++ halfP = PCD/2 × 0.707)
            });
        }

        // ─── [6] 감속기 출력축 (G_S → G_B → G_C 다단 혹은 단순 G_S) ───
        //   C++ CreateGearheadShaftPart 포팅:
        //     length1 = G_B > 0 ? (G_L1 - G_L3) : 0   (G_B 구간)
        //     length2 = G_C > 0 ? (G_L2 - G_Q) : 0    (G_C 구간)
        //     mainShaftLen = G_C > 0 ? G_Q : G_L2      (G_S 구간 = 최상단)
        //   Three.js: 복잡한 revolve 대신 실린더 3개를 쌓아서 근사
        if (G_S > 0.01) {
            const length1 = (G_B > 0.01) ? Math.max(G_L1 - G_L3, 0) : 0;
            const length2 = (G_C > 0.01) ? Math.max(G_L2 - G_Q, 0) : 0;
            const mainShaftLen = (G_C > 0.01) ? G_Q : G_L2;

            let shaftCursor = gearOutputY;

            // ① G_B 단 (로드 이음 바깥, 가장 굵음)
            if (length1 > 0.01 && G_B > 0.01) {
                _buildCylinder({
                    dia: G_B, length: length1,
                    posY: shaftCursor,
                    material: gearShaftMat
                });
                shaftCursor += length1;
            }

            // ② G_C 단 (로드 이음, 중간 굵기)
            if (length2 > 0.01 && G_C > 0.01) {
                _buildCylinder({
                    dia: G_C, length: length2,
                    posY: shaftCursor,
                    material: gearShaftMat
                });
                shaftCursor += length2;
            }

            // ③ G_S 단 (메인 출력축, 가장 앞쪽, 끝단 모따기 포함)
            if (mainShaftLen > 0.01) {
                _buildShaftWithChamfer({
                    dia: G_S, length: mainShaftLen,
                    posY: shaftCursor,              // 시작 Y
                    tipTowards: 'plus',              // +Y 방향으로 뻗음 (끝단이 +Y쪽)
                    material: gearShaftMat
                });
                shaftCursor += mainShaftLen;
            }

            // (키홈 G_W/G_T/G_QK, 축끝 탭 G_TM/G_TapL은 3D 프리뷰에서는
            //  표현 생략 — 실제 CAD 작도에서만 수행)
        }
    }

    // ─── 10. 치수선 ───
    if (options.dimensions) buildServoMotorDimOnly(dims);
}

function buildServoMotorDimOnly(dims) {
    // ══════════════════════════════════════════════════════════════════
    //  v49 치수 배치 전략: 겹침 방지 공간 분산
    //
    //  원칙:
    //  1) 길이 치수(Y축) → -X 방향 4단계 레벨로 분산
    //  2) 지름 치수(X축) → 치수별로 Y 위치 또는 Z 오프셋 크게 차별화
    //  3) 폭 치수(X축) → 본체 중앙, 뒤쪽 Z 충분한 오프셋
    //
    //  핵심: 라벨이 3D 공간에서 충분히 떨어져야 2D 투영시 안 겹침
    // ══════════════════════════════════════════════════════════════════
    const LC  = motorDim(dims, 'LC',       40);
    const LH  = motorDim(dims, 'LH',       LC);
    const LR  = motorDim(dims, 'LR',       LC * 0.40);

    // ★ v50: Brake 분기 — buildServoMotor와 동일한 키 치환 규칙
    const mOpt = resolveMotorOpts(dims, currentMotorOptions, currentPartCode);
    const hasBrake = mOpt.hasBrake;
    const hasGearhead = mOpt.hasGearhead;   // ★ v50-2세션차

    const LX_raw   = motorDim(dims, 'LX',  0);
    const LO_raw   = motorDim(dims, 'LO',  0);
    const LX       = hasBrake ? (LO_raw > 0 ? LO_raw : LX_raw || LC * 2.4) : (LX_raw || LC * 2.0);

    const L1_key   = hasBrake ? 'LO1(LLO)' : 'L1(LL)';
    const L2_key   = hasBrake ? 'LO2'      : 'L2';
    const L1       = motorDim(dims, L1_key, LX - LR);
    const L2       = motorDim(dims, L2_key, hasBrake ? L1 * 0.45 : L1 * 0.55);
    const L1_label = hasBrake ? 'LO1' : 'L1';
    const L2_label = hasBrake ? 'LO2' : 'L2';
    const LX_label = hasBrake ? 'LO'  : 'LX';

    // ★ v50: SL (브레이크 길이) — 치수선에 별도 표시
    const SL_raw = motorDim(dims, 'SL', 0);
    const SL     = hasBrake ? (SL_raw > 0 ? SL_raw : Math.max(L1 - L2 - motorDim(dims, 'EnL', LC * 0.3), LC * 0.25)) : 0;

    const TL  = motorDim(dims, 'TL(LG)',   LC * 0.20);
    const LB  = motorDim(dims, 'LB',       LC * 0.78);
    const LE  = motorDim(dims, 'LE',       LC * 0.10);
    const S   = motorDim(dims, 'S',        LC * 0.20);
    const EnH = motorDim(dims, 'EnH',      LH);
    const EnL = motorDim(dims, 'EnL',      Math.max(L1 - L2, LC * 0.3));
    const PCD = motorDim(dims, 'PCD(LA)',  LC * 1.12);

    const shaftTipY   = LR;
    const flangeY     = 0;
    const motorEndY   = -L1;
    // ★ v50: Brake 시 엔코더 시작 Y
    const encoderStartY = hasBrake ? -(L2 + SL) : -L2;
    const hw = LC / 2;

    // ─── 길이 치수 (Y축 방향) — -X 방향 4단계 오프셋으로 분산 ───
    // 각 레벨 사이 최소 hw*0.7 간격 확보
    const xLevel1 = -(hw + LC * 0.6);   // 가장 가까운 레벨 (LR, L2/SL 작은 것)
    const xLevel2 = -(hw + LC * 1.2);   // 중간 (L1)
    const xLevel3 = -(hw + LC * 1.8);   // 먼 (LX 전체)

    // ① LR 샤프트 돌출 — 샤프트 쪽 +Y에만 있으므로 +X 쪽에 별도 배치 (안 겹침)
    addLengthDimY(hw + LC * 0.6, flangeY, shaftTipY, 'LR', LR);

    // ② L2 (또는 LO2) 플랜지 → Stator 뒤끝 — 왼쪽 가장 가까운 레벨
    if (L2 > 1) {
        addLengthDimY(xLevel1, -L2, flangeY, L2_label, L2);
    }

    // ★ v50: ②-B. SL 브레이크 길이 — Stator 뒤끝 ~ Encoder 시작 구간
    //   xLevel1보다 약간 바깥쪽(xLevel1.5)에 배치. hasBrake일 때만 표시.
    if (hasBrake && SL > 1) {
        const xLevelBrake = -(hw + LC * 0.9);
        addLengthDimY(xLevelBrake, encoderStartY, -L2, 'SL', SL);
    }

    // ③ L1 (또는 LO1) 본체 전체 — 왼쪽 중간 레벨
    addLengthDimY(xLevel2, motorEndY, flangeY, L1_label, L1);

    // ④ LX (또는 LO) 전체 — 왼쪽 가장 먼 레벨 (가장 큰 치수)
    addLengthDimY(xLevel3, motorEndY, shaftTipY, LX_label, LX);

    // ─── 지름 치수 (축 단면 원형) — Y 위치로 분산 ───
    // 지름 치수들은 모두 X축 방향이지만 Y 위치를 **크게 다르게** 해서 겹침 방지
    // v49 핵심: LB/PCD/ØS 간 Y 간격을 최소 LR/2 이상 확보

    // ⑤ Ø S 샤프트 직경 — 샤프트 끝 근처 (+Y 가장 바깥), +Z 앞쪽
    addWidthDimXY(-S / 2, S / 2, shaftTipY + LR * 0.3, hw * 0.6, 'Ø' + S.toFixed(1), S);

    // ⑥ LB 베어링 보스 — 샤프트 중간 (Y는 샤프트 영역 절반), +Z 더 멀리
    addWidthDimXY(-LB / 2, LB / 2, shaftTipY * 0.55, hw * 1.6, 'LB', LB);

    // ⑦ PCD 마운팅홀 — 플랜지 뒤쪽 (Y=음수), +Z 더더 멀리
    addWidthDimXY(-PCD / 2, PCD / 2, flangeY - L2 * 0.25, hw * 2.8, 'PCD', PCD);

    // ─── 폭 치수 (본체) — 뒤쪽 -Z 방향 ───
    // ⑧ LC 프레임 폭 — stator 중앙, -Z 뒤쪽 충분히 밀기
    addWidthDimXY(-hw, hw, -L2 * 0.5, -hw * 2.0, 'LC', LC);

    // ⑨ EnH 엔코더 높이 — 본체보다 크면만 표시, 엔코더 중앙, -Z 더 뒤쪽
    //   ★ v50: Brake 시 엔코더 실제 중앙으로 위치 조정
    if (EnH > LH + 1) {
        const encMidY = (encoderStartY + motorEndY) / 2;
        addWidthDimXY(-EnH / 2, EnH / 2, encMidY, -hw * 2.8, 'EnH', EnH);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ★ v50 2세션차 NEW: ⑩-⑭ Gearhead 치수선 (hasGearhead=true일 때만)
    // ═══════════════════════════════════════════════════════════════════════════
    if (hasGearhead) {
        // ─── Gearhead 치수 파싱 (buildServoMotor와 동일 폴백 규칙) ───
        const G_LC_d = motorDim(dims, 'G_LC', LC * 1.1);
        const G_LG_d = motorDim(dims, 'G_LG', LC * 0.15);
        const G_LA_d = motorDim(dims, 'G_LA', G_LC_d * 0.75);
        const G_LB_d = motorDim(dims, 'G_LB', G_LC_d * 0.55);
        const G_LE_d = motorDim(dims, 'G_LE', LC * 0.10);
        const G_LD_d = motorDim(dims, 'G_LD', G_LC_d * 0.88);
        const G_LL_d = motorDim(dims, 'G_LL', 0);
        const G_LLO_d= motorDim(dims, 'G_LLO', 0);
        const G_LR_d = motorDim(dims, 'G_LR', 0);
        const G_S_d  = motorDim(dims, 'G_S',  S * 1.4);
        const G_L1_d = motorDim(dims, 'G_L1', LC * 0.40);
        const G_L2_d = motorDim(dims, 'G_L2', LC * 0.80);
        const G_L3_d = motorDim(dims, 'G_L3', LC * 0.12);

        // Gearhead 축방향 Y 좌표 계산 (buildServoMotor와 동일)
        const L1_LL_d = motorDim(dims, 'L1(LL)', 0) || L1;
        const G_LLeff_d = hasBrake ? (G_LLO_d > 0 ? G_LLO_d : G_LL_d) : G_LL_d;
        let gearTotalLen_d = G_LLeff_d - L1_LL_d;
        if (!(gearTotalLen_d > 0)) gearTotalLen_d = LC * 0.4;
        let gearBodyLen_d = gearTotalLen_d - G_LG_d;
        if (!(gearBodyLen_d >= 0)) gearBodyLen_d = 0;
        const pilot1Len_d = G_LE_d;
        const pilot2Len_d = Math.max(G_L3_d - G_LE_d, 0);
        const flangeFrontY_d = gearBodyLen_d + G_LG_d;        // = gearTotalLen_d
        const gearOutputY_d  = flangeFrontY_d + pilot1Len_d + pilot2Len_d;
        const gearShaftTipY_d = G_LR_d > 0
            ? G_LR_d                                           // G_LR 명시 시 플랜지면 기준 절대 Y
            : (gearOutputY_d + G_L2_d);                         // 폴백: 출력면 + G_L2

        // ─── 길이 치수 (+X 방향에 별도 4단계 레벨로 배치) ───
        //   기존 모터 본체 치수는 -X 쪽에 있으므로 Gearhead는 +X 쪽에 배치해서 겹침 방지
        //   (LR 치수도 +X 쪽에 있어서 Y 위치로 분리)
        const xGearLevel1 = hw + LC * 1.2;
        const xGearLevel2 = hw + LC * 1.8;

        // ⑩ G_LG 플랜지 두께 — 가장 가까운 레벨
        if (G_LG_d > 1) {
            addLengthDimY(xGearLevel1, gearBodyLen_d, flangeFrontY_d, 'G_LG', G_LG_d);
        }

        // ⑪ G_LE Pilot1 두께 — 플랜지 앞쪽
        if (G_LE_d > 1 && pilot1Len_d > 1) {
            addLengthDimY(xGearLevel1, flangeFrontY_d, flangeFrontY_d + pilot1Len_d, 'G_LE', G_LE_d);
        }

        // ⑫ G_LL (또는 G_LLO) 바디 전체 — 중간 레벨
        if (G_LLeff_d > 1) {
            const gll_label = hasBrake ? 'G_LLO' : 'G_LL';
            // 모터 뒤끝(-L1) ~ 감속기 플랜지 전면
            addLengthDimY(xGearLevel2, motorEndY, flangeFrontY_d, gll_label, G_LLeff_d);
        }

        // ⑬ G_LR 출력축 돌출 — 가장 먼 레벨, 플랜지 전면 ~ 축 끝
        if (G_LR_d > 1) {
            const xGearLevel3 = hw + LC * 2.4;
            addLengthDimY(xGearLevel3, flangeFrontY_d, gearShaftTipY_d, 'G_LR', G_LR_d);
        }

        // ─── 지름 치수 (Y 위치 분산) ───
        // ⑭ Ø G_S 출력축 직경 — 축 끝 근처, +Z 앞쪽
        if (G_S_d > 0.5) {
            addWidthDimXY(-G_S_d / 2, G_S_d / 2, gearShaftTipY_d + Math.max(G_LR_d * 0.1, 3), hw * 0.6,
                          'Ø' + G_S_d.toFixed(1), G_S_d);
        }

        // ⑮ G_LB Pilot1 외경 — 플랜지 앞쪽 중간, +Z 더 멀리
        if (G_LB_d > 0.5) {
            addWidthDimXY(-G_LB_d / 2, G_LB_d / 2, flangeFrontY_d + pilot1Len_d * 0.5, hw * 1.6,
                          'G_LB', G_LB_d);
        }

        // ⑯ G_LA 마운팅 PCD — 플랜지 중앙, +Z 더더 멀리
        if (G_LA_d > 0.5) {
            addWidthDimXY(-G_LA_d / 2, G_LA_d / 2, flangeFrontY_d - G_LG_d * 0.3, hw * 2.4,
                          'G_LA', G_LA_d);
        }

        // ⑰ G_LC 플랜지 외곽 폭 — 플랜지 중앙, -Z 뒤쪽
        if (G_LC_d > 0.5) {
            addWidthDimXY(-G_LC_d / 2, G_LC_d / 2, flangeFrontY_d - G_LG_d * 0.5, -hw * 2.0,
                          'G_LC', G_LC_d);
        }

        // ⑱ G_LD 바디/Pilot2 외경 — 바디 중앙, -Z 더 뒤쪽
        if (G_LD_d > 0.5 && gearBodyLen_d > 1) {
            addWidthDimXY(-G_LD_d / 2, G_LD_d / 2, gearBodyLen_d * 0.5, -hw * 2.6,
                          'G_LD', G_LD_d);
        }
    }
}


// ═══════════════════════════════════════════════════
// ⑬-B STEPPER_MOTOR — 스테핑 모터 (NEMA 계열) — v50 3세션차 신규
// ═══════════════════════════════════════════════════
/**
 *  C++ MotorBodyType::Stepper 흐름 기반 단순화 구현.
 *
 *  Stepper는 Servo와 달리 엔코더/브레이크/감속기가 (기본적으로) 없고
 *  NEMA 사각 프레임 + 짧은 샤프트 + 리드선(케이블 출구) 구조가 표준.
 *  dims에 G_S / SL 등이 있으면 Servo 공통 분기(Brake/Gearhead)도 적용 가능하도록
 *  옵션 기반 동작은 유지.
 *
 *  핵심 치수 (엑셀 참조):
 *    LC, LH  : 프레임 폭/높이 (NEMA 프레임 사이즈 — 예: NEMA17=42mm)
 *    LR      : 샤프트 돌출 길이
 *    LX      : 전체 길이
 *    L1(LL)  : 샤프트 제외 전체 바디 길이
 *    S       : 샤프트 직경
 *    PCD(LA) : 마운팅 홀 PCD
 *    M(LZ)   : 탭 규격 (문자열)
 *    TL(LG)  : 탭 깊이
 *    MnL     : LS모터 하단부 형상 치수 (Stepper 리드선 박스 폭으로 대용)
 *    EL      : 리드선 단자까지 거리 (케이블 시작 위치)
 *
 *  좌표계 (Three.js):
 *    +Y : 샤프트 방향 (카메라 가까움)
 *     0 : 플랜지 전면
 *    -Y : 모터 뒤끝
 */
function buildStepperMotor(dims) {
    // ─── 치수 ───
    const LC = motorDim(dims, 'LC', 42);      // NEMA17 = 42mm 기본
    const LH = motorDim(dims, 'LH', LC);
    const LR = motorDim(dims, 'LR', LC * 0.56);
    const LX = motorDim(dims, 'LX', LC * 1.0); // NEMA17/L = 40mm 정도
    const L1 = motorDim(dims, 'L1(LL)', LX - LR);
    const S  = motorDim(dims, 'S',  LC * 0.12);  // NEMA17 샤프트 = 5mm
    const PCD = motorDim(dims, 'PCD(LA)', LC * 0.741);  // NEMA17 PCD = 31mm
    const TL  = motorDim(dims, 'TL(LG)',  LC * 0.14);
    const tapDia = _parseTapSize(dims['M(LZ)'], 3);      // M3 기본

    // 리드선 박스 치수 (Servo의 CW/CL/CH 대신 Stepper는 MnL/EL/MWD 사용 가능)
    const cableDia = Math.max(motorDim(dims, 'MWD', LC * 0.08), 2.5);
    const cableLen = motorDim(dims, 'MnL', LC * 1.2);

    // ─── 옵션 해석 (Stepper도 Brake/Gearhead 옵션 지원) ───
    const mOpt = resolveMotorOpts(dims, currentMotorOptions, currentPartCode);
    const hasBrake = mOpt.hasBrake;
    const hasGearhead = mOpt.hasGearhead;

    // Brake 치환 (Servo와 동일)
    const LO_raw = motorDim(dims, 'LO', 0);
    const LX_eff = hasBrake ? (LO_raw > 0 ? LO_raw : LX * 1.2) : LX;
    const L1_key = hasBrake ? 'LO1(LLO)' : 'L1(LL)';
    const L1_eff = motorDim(dims, L1_key, LX_eff - LR);
    const SL = hasBrake ? motorDim(dims, 'SL', LC * 0.3) : 0;

    // 파생
    const cornerR = Math.max(LC * 0.04, 0.6);
    const shaftTipY = LR;
    const flangeY   = 0;
    const motorEndY = -L1_eff;

    // Stepper는 단일 바디 (Servo 3구간 분할 안 함)
    // 엔드벨도 얇게, 바디는 거의 전체 길이 차지

    // ─── 1. 샤프트 (hasGearhead=true면 숨김, Servo와 동일) ───
    if (!hasGearhead) {
        _buildShaftWithChamfer({
            dia: S, length: LR, posY: shaftTipY, tipTowards: 'minus',
            material: MAT.chrome()
        });
    }

    // ─── 2. 플랜지면 얇은 엔드벨 (알루미늄, 약 LC*0.10) ───
    const endbellLen = Math.min(LC * 0.10, L1_eff * 0.2);
    _buildRoundedBox({
        w: LC, h: LH, depth: endbellLen,
        posY: flangeY - endbellLen,
        cornerR, holeR: S / 2 + 0.3,
        material: MAT.aluminum()
    });

    // ─── 3. Stepper Body — 메인 스테이터 (Servo보다 단순하게 단일 블록) ───
    //   Brake 없을 때: [-endbellLen ~ -L1]
    //   Brake 있을 때: [-endbellLen ~ -L1-SL] (뒤로 SL 길이만큼 더 확장)
    const bodyStartY = -endbellLen;
    const bodyEndY   = hasBrake ? -(L1_eff - SL) : motorEndY;
    const bodyLen = bodyStartY - bodyEndY;
    const statorIndent = Math.min(1.0, LC * 0.04);

    _buildRoundedBox({
        w: LC - statorIndent * 2, h: LH - statorIndent * 2,
        depth: bodyLen,
        posY: bodyEndY,
        cornerR: Math.max(cornerR - statorIndent, 0.3),
        holeR: S / 2 + 0.3,
        material: MAT.steelCast()
    });

    // ─── 3-B. Brake Module (hasBrake=true일 때만) ───
    if (hasBrake && SL > 0.01) {
        const brakeIndent = Math.min(2.0, LC * 0.08);
        _buildRoundedBox({
            w: LC - brakeIndent * 2, h: LH - brakeIndent * 2,
            depth: SL,
            posY: motorEndY,               // 모터 뒤끝에서 시작
            cornerR: Math.max(cornerR - brakeIndent, 0.3),
            holeR: S / 2 + 0.3,
            material: MAT.steelDark()
        });
    }

    // ─── 4. 마운팅 홀 (플랜지 전면 4개) ───
    _buildMountingHoles({
        count: 4, pcd: PCD, holeR: tapDia / 2,
        depth: TL + endbellLen,
        posY: flangeY - (TL + endbellLen),
        startAngle: Math.PI / 4
    });

    // ─── 5. 리드선 출구 (-Y 쪽 끝에서 케이블이 뻗어나옴) ───
    //   Stepper는 커넥터 박스 대신 모터 뒤쪽에서 리드선(검정 고무)이 직접 나오는 것이 보통.
    //   케이블이 모터 후면 중앙에서 -Y 방향으로 뻗다가 꺾여 -Z로 내려감.
    if (cableDia > 0.5 && cableLen > 0.5) {
        const cableStartY = hasBrake ? (motorEndY - SL - 0.1) : (motorEndY - 0.1);
        _buildLCable({
            start: new THREE.Vector3(0, cableStartY, 0),
            dir1: '-y', len1: cableLen * 0.3,
            dir2: '-z', len2: cableLen * 0.7,
            dia: cableDia,
            endConnector: null   // 리드선은 끝 커넥터 없음 (열린 선)
        });
    }

    // ─── 6. Gearhead (hasGearhead=true일 때) ───
    //   Stepper + Gearhead 조합도 실제 제품에 존재(예: 감속 스텝모터).
    //   Servo와 동일한 방식으로 buildServoMotor의 Gearhead 로직을 재사용하고 싶지만,
    //   현재 설계상 별도 함수이므로 간단한 안내 주석만 남김.
    //   (향후 common helper로 분리하면 공유 가능)
    //   → 실무에서는 dims에 G_* 없는 경우가 대다수이므로 생략.

    // ─── 7. 치수선 ───
    if (options.dimensions) buildStepperMotorDimOnly(dims);
}

/**
 * Stepper 치수선 (buildServoMotorDimOnly 단순화 버전)
 */
function buildStepperMotorDimOnly(dims) {
    const LC = motorDim(dims, 'LC', 42);
    const LH = motorDim(dims, 'LH', LC);
    const LR = motorDim(dims, 'LR', LC * 0.56);

    const mOpt = resolveMotorOpts(dims, currentMotorOptions, currentPartCode);
    const hasBrake = mOpt.hasBrake;

    const LO_raw = motorDim(dims, 'LO', 0);
    const LX_raw = motorDim(dims, 'LX', 0);
    const LX = hasBrake ? (LO_raw > 0 ? LO_raw : LX_raw || LC * 1.2) : (LX_raw || LC * 1.0);
    const L1_key = hasBrake ? 'LO1(LLO)' : 'L1(LL)';
    const L1 = motorDim(dims, L1_key, LX - LR);
    const L1_label = hasBrake ? 'LO1' : 'L1';
    const LX_label = hasBrake ? 'LO'  : 'LX';

    const SL = hasBrake ? motorDim(dims, 'SL', LC * 0.3) : 0;

    const S  = motorDim(dims, 'S',  LC * 0.12);
    const PCD = motorDim(dims, 'PCD(LA)', LC * 0.741);

    const shaftTipY = LR;
    const flangeY   = 0;
    const motorEndY = -L1;
    const hw = LC / 2;

    const xLevel1 = -(hw + LC * 0.6);
    const xLevel2 = -(hw + LC * 1.2);

    // LR 샤프트 돌출
    addLengthDimY(hw + LC * 0.6, flangeY, shaftTipY, 'LR', LR);

    // SL 브레이크 (hasBrake일 때만)
    if (hasBrake && SL > 1) {
        addLengthDimY(-(hw + LC * 0.9), motorEndY, motorEndY + SL, 'SL', SL);
    }

    // L1/LO1 본체
    addLengthDimY(xLevel1, motorEndY, flangeY, L1_label, L1);

    // LX/LO 전체
    addLengthDimY(xLevel2, motorEndY, shaftTipY, LX_label, LX);

    // Ø S
    addWidthDimXY(-S / 2, S / 2, shaftTipY + LR * 0.3, hw * 0.6, 'Ø' + S.toFixed(1), S);

    // PCD
    addWidthDimXY(-PCD / 2, PCD / 2, flangeY - L1 * 0.2, hw * 2.0, 'PCD', PCD);

    // LC 프레임 폭
    addWidthDimXY(-hw, hw, -L1 * 0.5, -hw * 2.0, 'LC', LC);
}


// ⑫ DGBB — 깊은 홈 볼 베어링 (Deep Groove Ball Bearing)
// ═══════════════════════════════════════════════════

/**
 * LatheGeometry 프로파일 생성 헬퍼
 * points: [{r, z}] 배열 → THREE.Vector2[] (r=반경, z=축방향)
 * Three.js LatheGeometry는 Y축 회전이므로 (x=r, y=z)
 */
function makeLatheProfile(pts) {
    return pts.map(p => new THREE.Vector2(p.r, p.z));
}

function buildDGBB(dims) {
    // ─── 치수 추출 ───
    const d  = dims.d1 || dims.D1 || dims.d || 30;
    const D  = dims.D2 || dims.D  || 62;
    const B  = dims.B  || 16;

    const innerR   = d / 2;
    const outerR   = D / 2;
    const pitchDia = (d + D) / 2;
    const pitchR   = pitchDia / 2;

    // ── 볼 치수 ──
    // 0.26 비율: 실제 DGBB에 근접, 볼 사이 간격 충분히 확보
    const ballDia  = (D - d) * 0.26;
    const ballR    = ballDia / 2;

    // ── 링 경계 ──
    // 볼이 내/외륜 어깨 위로 38% 돌출되도록 설정
    // → FRONT뷰(Y축 방향)에서 볼이 뚜렷하게 보임
    const protR    = ballR * 0.38;           // 어깨 위 돌출량
    const innerOD  = pitchR - ballR + protR; // 내륜 외경(어깨 반경)
    const outerID  = pitchR + ballR - protR; // 외륜 내경(어깨 반경)

    // ── 모따기 ──
    const cham  = Math.max(Math.min(B * 0.10, (outerR - outerID) * 0.30), 0.3);
    const halfB = B / 2;
    const SEG   = 64;   // LatheGeometry 분할 수

    // ─────────────────────────────────────────────
    // ① 내륜 (Inner Ring) — 심플 링 프로파일
    //   홈(Groove) 없이 직선 어깨 → 볼이 외면 위로 돌출되어 명확히 보임
    // ─────────────────────────────────────────────
    const iPts = [
        { r: innerR,              z: -halfB + cham },   // 보어 좌
        { r: innerR + cham * 0.4, z: -halfB        },   // 모따기
        { r: innerOD - cham * 0.5, z: -halfB       },   // 좌 단면
        { r: innerOD,              z: -halfB + cham },   // 어깨 모따기
        { r: innerOD,              z:  halfB - cham },   // 어깨 (외면)
        { r: innerOD - cham * 0.5, z:  halfB       },   // 우 단면
        { r: innerR + cham * 0.4,  z:  halfB       },   // 모따기
        { r: innerR,               z:  halfB - cham },   // 보어 우
        { r: innerR,               z: -halfB + cham },   // 폐합
    ];
    modelGroup.add(new THREE.Mesh(
        new THREE.LatheGeometry(makeLatheProfile(iPts), SEG),
        bearingRingMaterial.clone()
    ));

    // ─────────────────────────────────────────────
    // ② 외륜 (Outer Ring) — 심플 링 프로파일
    //   직선 내경 어깨 → 볼이 내면 아래로 돌출
    // ─────────────────────────────────────────────
    const oPts = [
        { r: outerR,               z: -halfB + cham },
        { r: outerR - cham * 0.4,  z: -halfB        },
        { r: outerID + cham * 0.5, z: -halfB        },
        { r: outerID,              z: -halfB + cham },
        { r: outerID,              z:  halfB - cham },
        { r: outerID + cham * 0.5, z:  halfB        },
        { r: outerR - cham * 0.4,  z:  halfB        },
        { r: outerR,               z:  halfB - cham },
        { r: outerR,               z: -halfB + cham },   // 폐합
    ];
    modelGroup.add(new THREE.Mesh(
        new THREE.LatheGeometry(makeLatheProfile(oPts), SEG),
        bearingRingMaterial.clone()
    ));

    // ─────────────────────────────────────────────
    // ③ 볼 배치
    //   ★ Z(볼 개수) DB값 최우선 사용 — 없으면 기하 계산 폴백
    // ─────────────────────────────────────────────
    const Z_val = dims.Z || dims.z || dims['볼 개수'] || 0;
    const numBalls = Z_val > 0
        ? Math.round(Number(Z_val))
        : Math.max(5, Math.floor(Math.PI * pitchDia / (ballDia * 1.65)));
    logToCSharp('[DGBB] Z=' + Z_val + ' → numBalls=' + numBalls);
    const ballGeom = new THREE.SphereGeometry(ballR, 32, 32);
    for (let i = 0; i < numBalls; i++) {
        const a   = (2 * Math.PI * i) / numBalls;
        const bm  = new THREE.Mesh(ballGeom, bearingBallMaterial.clone());
        bm.position.set(pitchR * Math.cos(a), 0, pitchR * Math.sin(a));
        modelGroup.add(bm);
    }

    // ─── 치수선 ───
    if (options.dimensions) buildDGBBDimOnly(dims);
}

function buildDGBBDimOnly(dims) {
    const d  = dims.d1 || dims.D1 || dims.d || 30;
    const D  = dims.D2 || dims.D  || 62;
    const B  = dims.B  || 16;

    const innerR = d / 2;
    const outerR = D / 2;
    const halfB  = B / 2;

    // ★ 치수선 오프셋을 베어링 크기 비례로 계산 (작은 베어링 대응)
    //   기존: 고정 8mm/10mm → 작은 베어링(예: D=9)에서는 치수가 너무 멀리 배치되어
    //        모델이 작게 보임. 외경 D 기준 12% 정도가 시각적으로 적절.
    //   최소값은 유지하여 매우 작은 베어링에서도 치수선이 모델과 겹치지 않도록.
    const axOff  = Math.max(D * 0.12, 3);    // 축방향 오프셋 (d,D 치수의 z 위치)
    const lblOff = Math.max(D * 0.15, 4);    // 라벨 오프셋 (d,D 라벨의 x 방향)
    const bOff   = Math.max(D * 0.15, 4);    // B 치수의 x 오프셋

    // d (내경) — 좌측
    addHorizontalDim(-innerR, innerR, -halfB - axOff, -innerR - lblOff, 'd', d);
    // D (외경) — 우측
    addHorizontalDim(-outerR, outerR, halfB + axOff, outerR + lblOff, 'D', D);
    // B (폭) — 상단
    addVerticalDim(outerR + bOff, -halfB, halfB, 'B', B);
}

// ═══════════════════════════════════════════════════
// 베어링 공용 헬퍼
// ═══════════════════════════════════════════════════

/** 베어링 파라미터 계산 (공통) */
function _brgParams(d, D, B) {
    const innerR = d/2, outerR = D/2, pitchR = (innerR+outerR)/2;
    const ballDia = (D-d)*0.26, ballR = ballDia/2;
    const protR = ballR*0.38;
    const innerOD = pitchR-ballR+protR, outerID = pitchR+ballR-protR;
    const cham = Math.max(Math.min(B*0.10,(outerR-outerID)*0.30),0.3);
    return { innerR, outerR, pitchR, ballR, ballDia, innerOD, outerID, cham, halfB: B/2 };
}

/** 베어링 내/외륜 공용 빌더 (직선 어깨형) */
function _buildBrgRings(p, innerHalfB, outerHalfB) {
    const {innerR,outerR,innerOD,outerID,cham} = p;
    const iHB = innerHalfB ?? p.halfB, oHB = outerHalfB ?? p.halfB;
    const SEG = 64;
    const addRing = (pts) => modelGroup.add(new THREE.Mesh(
        new THREE.LatheGeometry(makeLatheProfile(pts), SEG), bearingRingMaterial.clone()));
    addRing([
        {r:innerR,z:-iHB+cham},{r:innerR+cham*0.4,z:-iHB},
        {r:innerOD-cham*0.5,z:-iHB},{r:innerOD,z:-iHB+cham},
        {r:innerOD,z:iHB-cham},{r:innerOD-cham*0.5,z:iHB},
        {r:innerR+cham*0.4,z:iHB},{r:innerR,z:iHB-cham},{r:innerR,z:-iHB+cham}
    ]);
    addRing([
        {r:outerR,z:-oHB+cham},{r:outerR-cham*0.4,z:-oHB},
        {r:outerID+cham*0.5,z:-oHB},{r:outerID,z:-oHB+cham},
        {r:outerID,z:oHB-cham},{r:outerID+cham*0.5,z:oHB},
        {r:outerR-cham*0.4,z:oHB},{r:outerR,z:oHB-cham},{r:outerR,z:-oHB+cham}
    ]);
}

/** 볼 배치 공용 */
function _buildBalls3D(pitchR, ballR, numBalls, yOff) {
    const geom = new THREE.SphereGeometry(ballR, 28, 28);
    for (let i=0; i<numBalls; i++) {
        const a = 2*Math.PI*i/numBalls;
        const m = new THREE.Mesh(geom, bearingBallMaterial.clone());
        m.position.set(pitchR*Math.cos(a), yOff||0, pitchR*Math.sin(a));
        modelGroup.add(m);
    }
}

/** 원통 롤러 배치 공용 */
function _buildCylRollers(pitchR, rollerR, rollerL, numRollers) {
    const geom = new THREE.CylinderGeometry(rollerR, rollerR, rollerL, 16);
    for (let i=0; i<numRollers; i++) {
        const a = 2*Math.PI*i/numRollers;
        const m = new THREE.Mesh(geom, bearingBallMaterial.clone());
        m.position.set(pitchR*Math.cos(a), 0, pitchR*Math.sin(a));
        m.rotation.x = Math.PI/2;  // 롤러 축 = Z축 → Y축으로 세워서 배치 후 XZ 평면 배치
        // LatheGeometry Y축 회전 → 롤러를 XZ 평면에 맞게 회전
        m.rotation.set(Math.PI/2, a, 0);  // 롤러 축이 원주 접선 방향 아닌 Y축 방향
        modelGroup.add(m);
    }
}

// ═══════════════════════════════════════════════════
// ⑭ ANBB — 앵귤러 컨택트 볼 베어링
//    (접촉각: 15°~40°, 축방향 하중 대응)
// ═══════════════════════════════════════════════════
function buildANBB(dims) {
    const d = dims.d1||dims.D1||dims.d||25;
    const D = dims.D2||dims.D||52;
    const B = dims.B||15;
    const ca = (dims.ContactAngle||dims.CONTACTANGLE||25)*Math.PI/180;
    const p = _brgParams(d, D, B);
    const SEG=64, {innerR,outerR,innerOD,outerID,cham,halfB} = p;

    // 내륜: 한쪽 어깨를 낮게 (접촉각 방향)
    const shldR = innerOD - Math.sin(ca)*p.ballR*0.5;
    modelGroup.add(new THREE.Mesh(new THREE.LatheGeometry(makeLatheProfile([
        {r:innerR,z:-halfB+cham},{r:innerR+cham*0.4,z:-halfB},
        {r:shldR-cham*0.4,z:-halfB},{r:shldR,z:-halfB+cham*1.5},
        {r:innerOD,z:0},{r:innerOD,z:halfB-cham},
        {r:innerR+cham*0.4,z:halfB},{r:innerR,z:halfB-cham},{r:innerR,z:-halfB+cham}
    ]),SEG), bearingRingMaterial.clone()));

    // 외륜: 반대쪽 어깨를 낮게
    const shldR2 = outerID + Math.sin(ca)*p.ballR*0.5;
    modelGroup.add(new THREE.Mesh(new THREE.LatheGeometry(makeLatheProfile([
        {r:outerR,z:-halfB+cham},{r:outerR-cham*0.4,z:-halfB},
        {r:outerID+cham*0.4,z:-halfB},{r:outerID,z:-halfB+cham},
        {r:outerID,z:0},{r:shldR2,z:halfB-cham*1.5},
        {r:outerR-cham*0.4,z:halfB},{r:outerR,z:halfB-cham},{r:outerR,z:-halfB+cham}
    ]),SEG), bearingRingMaterial.clone()));

    // 볼 (접촉각 Y 오프셋) — ★ Z 우선
    const Z_anbb = dims.Z || dims.z || dims['볼 개수'] || 0;
    const numBalls = Z_anbb > 0
        ? Math.round(Number(Z_anbb))
        : Math.max(5, Math.floor(Math.PI*(d+D)/2/(p.ballDia*1.65)));
    _buildBalls3D(p.pitchR, p.ballR, numBalls, Math.sin(ca)*p.pitchR*0.10);

    if (options.dimensions) buildANBBDimOnly(dims);
}
function buildANBBDimOnly(dims) {
    const d=dims.d1||dims.D1||25, D=dims.D2||dims.D||52, B=dims.B||15;
    addHorizontalDim(-d/2,d/2,-B/2-8,-d/2-10,'d',d);
    addHorizontalDim(-D/2,D/2,B/2+8,D/2+10,'D',D);
    addVerticalDim(D/2+10,-B/2,B/2,'B',B);
}

// ═══════════════════════════════════════════════════
// ⑮ TRBR — 테이퍼 롤러 베어링
//    (원뿔형 내/외륜, T=총폭, B=내륜폭, C=내륜 좁은쪽 높이)
// ═══════════════════════════════════════════════════
function buildTRBR(dims) {
    const d  = dims.d1||dims.D1||dims.d||25;
    const D  = dims.D2||dims.D||52;
    const T  = dims.T||dims.B||16;    // 조립 총 폭
    const B  = dims.B||T;             // 내륜 폭
    const halfT=T/2, innerR=d/2, outerR=D/2;
    const pitchR=(innerR+outerR)/2;
    const cham = Math.max(T*0.06, 0.5);
    const SEG=64;

    // 테이퍼 각 (일반적 약 12°)
    const taperA = 12*Math.PI/180;
    const dOD = Math.tan(taperA)*(B/2);  // 내륜 OD 반 폭에서의 반경 변화량

    // ① 내륜 (Cone): 기울어진 외면 + 직선 보어
    modelGroup.add(new THREE.Mesh(new THREE.LatheGeometry(makeLatheProfile([
        {r:innerR,z:-halfT+cham},{r:innerR+cham*0.3,z:-halfT},
        {r:pitchR-dOD-cham*0.2,z:-halfT},   // 좁은 쪽 어깨
        {r:pitchR-dOD,z:-halfT+cham},
        {r:pitchR+dOD,z:halfT-cham},         // 넓은 쪽
        {r:pitchR+dOD+cham*0.2,z:halfT},{r:innerR+cham*0.3,z:halfT},
        {r:innerR,z:halfT-cham},{r:innerR,z:-halfT+cham}
    ]),SEG), bearingRingMaterial.clone()));

    // ② 외륜 (Cup): 기울어진 내면 + 직선 OD
    modelGroup.add(new THREE.Mesh(new THREE.LatheGeometry(makeLatheProfile([
        {r:outerR,z:-halfT+cham},{r:outerR-cham*0.3,z:-halfT},
        {r:pitchR+dOD+cham*0.2,z:-halfT},
        {r:pitchR+dOD,z:-halfT+cham},
        {r:pitchR-dOD,z:halfT-cham},
        {r:pitchR-dOD-cham*0.2,z:halfT},{r:outerR-cham*0.3,z:halfT},
        {r:outerR,z:halfT-cham},{r:outerR,z:-halfT+cham}
    ]),SEG), bearingRingMaterial.clone()));

    // ③ 테이퍼 롤러 (기울어진 원통) — ★ Z 우선
    const rollerL  = T*0.65, rollerR = (D-d)*0.09;
    const Z_trbr = dims.Z || dims.z || dims['볼 개수'] || 0;
    const numRollers = Z_trbr > 0
        ? Math.round(Number(Z_trbr))
        : Math.max(8, Math.floor(Math.PI*pitchR*2/(rollerR*2*2.2)));
    for (let i=0; i<numRollers; i++) {
        const a = 2*Math.PI*i/numRollers;
        const geo = new THREE.CylinderGeometry(rollerR*0.8,rollerR,rollerL,12);
        const m = new THREE.Mesh(geo, bearingBallMaterial.clone());
        m.position.set(pitchR*Math.cos(a), 0, pitchR*Math.sin(a));
        // 롤러를 Y축 방향으로 배치 (LatheGeometry Y축 = 베어링 축)
        m.rotation.set(Math.PI/2+taperA*0.5, a+Math.PI/2, 0, 'ZYX');
        modelGroup.add(m);
    }
    if (options.dimensions) buildTRBRDimOnly(dims);
}
function buildTRBRDimOnly(dims) {
    const d=dims.d1||dims.D1||25, D=dims.D2||dims.D||52, T=dims.T||dims.B||16;
    addHorizontalDim(-d/2,d/2,-T/2-8,-d/2-10,'d',d);
    addHorizontalDim(-D/2,D/2,T/2+8,D/2+10,'D',D);
    addVerticalDim(D/2+10,-T/2,T/2,'T',T);
}

// ═══════════════════════════════════════════════════
// ⑯ CYLR — 원통 롤러 베어링
//    (NJ/NU/NF 형식, 플랜지 위치 다름)
// ═══════════════════════════════════════════════════
function buildCYLR(dims) {
    const d=dims.d1||dims.D1||dims.d||25, D=dims.D2||dims.D||52, B=dims.B||15;
    const p = _brgParams(d, D, B);
    _buildBrgRings(p);

    // 원통 롤러 — ★ Z 우선
    const rollerR  = (D-d)*0.10, rollerL = B*0.80;
    const Z_cylr = dims.Z || dims.z || dims['볼 개수'] || 0;
    const numRollers = Z_cylr > 0
        ? Math.round(Number(Z_cylr))
        : Math.max(8, Math.floor(Math.PI*p.pitchR*2/(rollerR*2*2.0)));
    for (let i=0; i<numRollers; i++) {
        const a = 2*Math.PI*i/numRollers;
        const geo = new THREE.CylinderGeometry(rollerR,rollerR,rollerL,12);
        const m = new THREE.Mesh(geo, bearingBallMaterial.clone());
        // Y축이 베어링 축 → 롤러를 Y축 방향에 수직(XZ 평면)으로 세움
        m.position.set(p.pitchR*Math.cos(a), 0, p.pitchR*Math.sin(a));
        m.rotation.set(0, a, Math.PI/2);
        modelGroup.add(m);
    }
    if (options.dimensions) buildCYLRDimOnly(dims);
}
function buildCYLRDimOnly(dims) {
    const d=dims.d1||dims.D1||25, D=dims.D2||dims.D||52, B=dims.B||15;
    addHorizontalDim(-d/2,d/2,-B/2-8,-d/2-10,'d',d);
    addHorizontalDim(-D/2,D/2,B/2+8,D/2+10,'D',D);
    addVerticalDim(D/2+10,-B/2,B/2,'B',B);
}

// ═══════════════════════════════════════════════════
// ⑰ THRB — 스러스트 볼 베어링
//    (축에 수직한 평면에서 축방향 하중 지지)
//    d1=축경, D2=외경, T=높이
// ═══════════════════════════════════════════════════
function buildTHRB(dims) {
    const d=dims.d1||dims.D1||dims.d||20, D=dims.D2||dims.D||47, T=dims.T||dims.B||11;
    const innerR=d/2, outerR=D/2, halfT=T/2;
    const pitchR=(innerR+outerR)/2;
    const ringH=T*0.35, cham=T*0.06;
    const SEG=64;
    const mat = bearingRingMaterial.clone();

    // ① 축 링 (shaft washer) — 하단 얇은 링
    modelGroup.add(new THREE.Mesh(new THREE.LatheGeometry(makeLatheProfile([
        {r:innerR,z:-halfT},{r:outerR*0.72,z:-halfT},
        {r:outerR*0.72,z:-halfT+ringH},{r:innerR,z:-halfT+ringH},{r:innerR,z:-halfT}
    ]),SEG), mat.clone()));

    // ② 하우징 링 (housing washer) — 상단 얇은 링
    modelGroup.add(new THREE.Mesh(new THREE.LatheGeometry(makeLatheProfile([
        {r:innerR*0.85,z:halfT-ringH},{r:outerR,z:halfT-ringH},
        {r:outerR,z:halfT},{r:innerR*0.85,z:halfT},{r:innerR*0.85,z:halfT-ringH}
    ]),SEG), mat.clone()));

    // ③ 볼 (XZ 평면 배치 — 스러스트 하중 방향) — ★ Z 우선
    const ballDia=(D-d)*0.22, ballR=ballDia/2;
    const Z_thrb = dims.Z || dims.z || dims['볼 개수'] || 0;
    const numBalls = Z_thrb > 0
        ? Math.round(Number(Z_thrb))
        : Math.max(6, Math.floor(Math.PI*pitchR*2/(ballDia*1.5)));
    for (let i=0; i<numBalls; i++) {
        const a=2*Math.PI*i/numBalls;
        const m=new THREE.Mesh(new THREE.SphereGeometry(ballR,20,20), bearingBallMaterial.clone());
        m.position.set(pitchR*Math.cos(a), 0, pitchR*Math.sin(a));
        modelGroup.add(m);
    }
    if (options.dimensions) buildTHRBDimOnly(dims);
}
function buildTHRBDimOnly(dims) {
    const d=dims.d1||dims.D1||20, D=dims.D2||dims.D||47, T=dims.T||dims.B||11;
    addHorizontalDim(-d/2,d/2,-T/2-8,-d/2-10,'d',d);
    addHorizontalDim(-D/2,D/2,T/2+8,D/2+10,'D',D);
    addVerticalDim(D/2+10,-T/2,T/2,'T',T);
}

// ═══════════════════════════════════════════════════
// ⑱ SRRB — 자동조심 롤러 베어링
//    (구형 외면 외륜 + 배럴형 롤러 복열)
// ═══════════════════════════════════════════════════
function buildSRRB(dims) {
    const d=dims.d1||dims.D1||dims.d||30, D=dims.D2||dims.D||62, B=dims.B||20;
    const innerR=d/2, outerR=D/2, halfB=B/2;
    const pitchR=(innerR+outerR)/2, cham=B*0.07;
    const SEG=64;

    // 내륜: 볼록한 외면(자동조심면)
    modelGroup.add(new THREE.Mesh(new THREE.LatheGeometry(makeLatheProfile([
        {r:innerR,z:-halfB+cham},{r:innerR+cham*0.4,z:-halfB},
        {r:pitchR*0.68,z:-halfB},{r:pitchR*0.70,z:-halfB+cham},
        {r:pitchR*0.72,z:0},
        {r:pitchR*0.70,z:halfB-cham},{r:pitchR*0.68,z:halfB},
        {r:innerR+cham*0.4,z:halfB},{r:innerR,z:halfB-cham},{r:innerR,z:-halfB+cham}
    ]),SEG), bearingRingMaterial.clone()));

    // 외륜: 구형(오목) 내면
    const outerID=pitchR*1.30;
    modelGroup.add(new THREE.Mesh(new THREE.LatheGeometry(makeLatheProfile([
        {r:outerR,z:-halfB+cham},{r:outerR-cham*0.3,z:-halfB},
        {r:outerID+cham*0.3,z:-halfB},{r:outerID,z:-halfB+cham},
        {r:outerID*0.98,z:0},           // 구형 오목 중앙
        {r:outerID,z:halfB-cham},{r:outerID+cham*0.3,z:halfB},
        {r:outerR-cham*0.3,z:halfB},{r:outerR,z:halfB-cham},{r:outerR,z:-halfB+cham}
    ]),SEG), bearingRingMaterial.clone()));

    // 배럴형 롤러 2열
    const rollerR=(D-d)*0.09, rollerL=B*0.55;
    const numR=Math.max(7,Math.floor(Math.PI*pitchR*2/(rollerR*2*2.5)));
    for (let row=0; row<2; row++) {
        const yOff = (row===0 ? -1 : 1)*halfB*0.35;
        for (let i=0; i<numR; i++) {
            const a=2*Math.PI*i/numR + row*Math.PI/numR;
            const geo=new THREE.CylinderGeometry(rollerR*0.85,rollerR,rollerL,10);
            const m=new THREE.Mesh(geo, bearingBallMaterial.clone());
            m.position.set(pitchR*Math.cos(a),yOff,pitchR*Math.sin(a));
            m.rotation.set(Math.PI/2, a, 0,'ZYX');
            modelGroup.add(m);
        }
    }
    if (options.dimensions) buildSRRBDimOnly(dims);
}
function buildSRRBDimOnly(dims) {
    const d=dims.d1||dims.D1||30, D=dims.D2||dims.D||62, B=dims.B||20;
    addHorizontalDim(-d/2,d/2,-B/2-8,-d/2-10,'d',d);
    addHorizontalDim(-D/2,D/2,B/2+8,D/2+10,'D',D);
    addVerticalDim(D/2+10,-B/2,B/2,'B',B);
}

// ═══════════════════════════════════════════════════
// ⑲ UNIT — 인서트 베어링 (구형 외면 유닛)
//    GD=구형시트 OD, Ga=총 폭, Gb=내부 베어링 폭
// ═══════════════════════════════════════════════════
const unitOuterMat = new THREE.MeshStandardMaterial({ color: 0x7A8A95, metalness: 0.42, roughness: 0.35, side: THREE.DoubleSide });

function buildUNIT(dims) {
    // ══════════════════════════════════════════════════════════════
    //  UC 인서트 베어링 (v37) — 엑셀 치수 정의 엄밀 매핑
    //
    //  치수 우선순위 (엑셀 "부품별치수명정의한_문서.xlsx" 기준):
    //   d1 = 안지름 (보어)
    //   D2 = 외경 (외륜 최대 외경)
    //   dk = 구면경 (Spherical Outer Diameter) — D2와 다를 수 있음
    //   B  = 내륜 폭 (= 전체 폭)
    //   C  = 외륜 폭 (구면 시작 전 원통부 폭)
    //   Dw = 볼 직경
    //   dm = 피치 원 직경 (PCD)
    //   Z  = 볼 개수
    //   G  = 멈춤나사 규격 (문자열: "M3", "M5" 등)
    //   r  = 모따기 치수
    //
    //  ※ 주의: GD는 "홈 지름(스냅링)"으로 UC에는 무관. v35까지 "구면 OD"로
    //          잘못 해석했던 키이므로 절대 사용 금지.
    //
    //  좌표계:
    //   C++(스케치)   : x = 폭, y = 반경
    //   Three.js(Lathe): point.x = 반경, point.y = 축(Y축 회전)
    //   → C++ (widthX, radiusY)  ⇒  Vector2(radiusY, widthX)
    // ══════════════════════════════════════════════════════════════

    // ── 치수 (엑셀 키 우선 + 표준 UC 비율 폴백) ──────────────────────
    const d  = dims.d1 || dims.d  || dims.D1 || 25;
    let   D  = dims.D2 || dims.D  || 0;
    let   dk = dims.dk || 0;
    let   B  = dims.B  || 0;
    let   C  = dims.C  || 0;
    let   r  = dims.r  || 0;
    const Dw = dims.Dw || 0;
    const dm = dims.dm || 0;
    const Z  = Math.max(5, (dims.Z | 0) || 8);
    const G  = (typeof dims.G === 'string' && dims.G) ? dims.G : 'M3';

    // 표준 UC 시리즈 회귀분석 기반 비율 폴백
    if (D  <= 0) D  = d * 2.07;        // UC 시리즈 D/d 평균 ≈ 2.07
    if (dk <= 0) dk = D;                // dk 없으면 D 사용
    if (B  <= 0) B  = d * 1.36;        // B/d 평균 ≈ 1.36
    if (C  <= 0) C  = D * 0.30;        // C/D 평균 ≈ 0.30 (UC206: 19/62=0.306)
    if (r  <= 0) r  = Math.max(0.6, d * 0.04);

    const innerR    = d / 2;
    const outerR    = D / 2;
    const sphereR   = dk / 2;           // 구면 반경
    const halfB     = B / 2;
    const halfC     = C / 2;

    // ── 궤도·볼 계산: Dw·dm 있으면 직접, 없으면 표준 비율 ──
    // v39: DB의 Dw/dm 이 내륜(innerR)과 외륜(outerR) 사이를 벗어나면 폴백
    let innerRingOR, outerRingIR, pcdR, ballR;
    const dwDmValid = (Dw > 0 && dm > 0
                    && (dm / 2 - Dw / 2) > innerR   // 내륜 보어보다 크게
                    && (dm / 2 + Dw / 2) < outerR); // 외륜 외경보다 작게

    if (dwDmValid) {
        pcdR        = dm / 2;
        ballR       = Dw / 2;
        innerRingOR = pcdR - ballR * 1.00;
        outerRingIR = pcdR + ballR * 1.00;
    } else {
        // UC 표준 회귀분석 (UC205~209 치수표 기반)
        innerRingOR = innerR + (outerR - innerR) * 0.26;
        outerRingIR = innerR + (outerR - innerR) * 0.85;
        pcdR        = (innerRingOR + outerRingIR) / 2;
        ballR       = (outerRingIR - innerRingOR) * 0.50;
    }
    // 궤도 홈은 볼보다 약간 커야 간섭 없음.
    // v39: 외륜 구면 벽 두께가 0.4mm 미만이 되지 않도록 동적 조정.
    //   홈 바닥 반경 = pcdR + hypot(outerRingIR - pcdR, grooveR)
    //   = pcdR + sqrt((outerRingIR-pcdR)^2 + grooveR^2)
    //   벽 두께 = sphereR - 홈 바닥 반경 ≥ 0.4
    //   → sqrt((ORIR-pcdR)^2 + grooveR^2) ≤ sphereR - pcdR - 0.4
    //   → grooveR ≤ sqrt((sphereR - pcdR - 0.4)^2 - (ORIR - pcdR)^2)
    const minWall = 0.4;
    const dx = outerRingIR - pcdR;            // = ballR (volume에서 내외륜 대칭 시)
    const grooveMaxBase = sphereR - pcdR - minWall;
    let grooveR;
    if (grooveMaxBase > dx) {
        const grooveRMax = Math.sqrt(grooveMaxBase * grooveMaxBase - dx * dx);
        // 기본은 ballR*1.04, 하지만 최대치로 클램핑
        grooveR = Math.min(ballR * 1.04, grooveRMax);
        // 최소한 ballR*0.95는 유지 (볼이 홈에 들어갈 수 있게)
        if (grooveR < ballR * 0.95) grooveR = ballR * 0.95;
    } else {
        // 구면 여유가 거의 없으면 볼보다 살짝 작게 (간섭 없이 표시만)
        grooveR = ballR * 0.95;
    }

    // 구면과 외륜 측면(±halfC) 교점
    const intersectR = Math.sqrt(Math.max(0, sphereR * sphereR - halfC * halfC));

    // 멈춤나사 규격 파서 ("M5" → 보어 2.5)
    const parseTap = g => {
        const m = /M(\d+(\.\d+)?)/.exec(g);
        return m ? parseFloat(m[1]) / 2 : 1.5;
    };
    const tapBoreR = parseTap(G);

    const SEG = 48;

    const innerRingMat = new THREE.MeshStandardMaterial({ color: 0xB6BBC2, metalness: 0.58, roughness: 0.30 });
    // v42: 프로파일을 외부 법선 순서로 재배열 → FrontSide로 외륜 안쪽이 안 보이게.
    // 만약 특정 뷰에서 "외륜이 투명하게 보이는" 현상 발생 시 임시로 DoubleSide 활성화:
    //   options.outerDoubleSide === true 로 설정
    const outerRingMat = new THREE.MeshStandardMaterial({
        color: 0xA5ABB3, metalness: 0.55, roughness: 0.32,
        side: (options.outerDoubleSide === true) ? THREE.DoubleSide : THREE.FrontSide
    });
    const ballMat      = new THREE.MeshStandardMaterial({ color: 0xE0E3E7, metalness: 0.65, roughness: 0.18 });
    const screwMat     = new THREE.MeshStandardMaterial({ color: 0x2F3439, metalness: 0.55, roughness: 0.42 });

    // ═══════════════════════════════════════════════════════════
    // ① 내륜 (폭 B) — v42 외부 법선 올바른 순서, 매끈한 원통
    //
    //    v41: 순서가 (내경→외경) 라서 법선 뒤집힘.
    //    v42: 외경부터 시작해서 외부 법선이 바깥을 향하게 재배열.
    //
    //    닫힌 루프:
    //      ① START (innerRingOR, -halfB)  좌측 끝 외경
    //      ② 외경 (-halfB → +halfB) [a+ 방향, 법선 +r = 바깥] ✓
    //      ③ (innerRingOR, halfB)
    //      ④ 우측 끝면 (r 감소, 법선 +a = 바깥) ✓
    //      ⑤ (innerR + r, halfB)
    //      ⑥ 모따기 경사 (innerR, halfB - r)
    //      ⑦ 보어 (+halfB-r → -halfB+r) [a- 방향, 법선 -r = 안쪽 but 구멍이므로 보임] ✓
    //      ⑧ (innerR, -halfB + r)
    //      ⑨ 좌측 모따기 (innerR + r, -halfB)
    //      ⑩ 좌측 끝면 (r 증가, 법선 -a = 바깥) ✓
    //      ⑪ (innerRingOR, -halfB)  닫기 = START
    // ═══════════════════════════════════════════════════════════
    {
        const pts = [];
        // ① START: 좌측 끝 외경
        pts.push(new THREE.Vector2(innerRingOR, -halfB));
        // ② 외경: a+ 방향
        pts.push(new THREE.Vector2(innerRingOR,  halfB));
        // ③~④ 우측 끝면: r 감소
        pts.push(new THREE.Vector2(innerR + r,   halfB));
        // ⑤ 우측 모따기
        pts.push(new THREE.Vector2(innerR,       halfB - r));
        // ⑥ 보어 (a- 방향)
        pts.push(new THREE.Vector2(innerR,      -halfB + r));
        // ⑦ 좌측 모따기
        pts.push(new THREE.Vector2(innerR + r,  -halfB));
        // ⑧ 좌측 끝면 (r 증가): 닫음
        pts.push(new THREE.Vector2(innerRingOR, -halfB));

        const lathe = new THREE.LatheGeometry(pts, 64);   // 48 → 64 segments
        lathe.computeVertexNormals();
        modelGroup.add(new THREE.Mesh(lathe, innerRingMat.clone()));
    }

    // ═══════════════════════════════════════════════════════════
    // ② 외륜 (폭 C) — v42 외부 법선 올바른 순서
    //
    //    v41까지 프로파일이 내경부터 시작해서 법선이 안쪽을 향했고,
    //    DoubleSide로 강제 렌더링하다 보니 외륜 뒤쪽이 투명하게 보이는 문제.
    //
    //    v42: 프로파일을 "외경 → 우측 끝면 → 내경 → 좌측 끝면 → 닫기"
    //    순서로 재배열. 모든 세그먼트의 법선이 바깥을 향함.
    //    → DoubleSide 불필요, 외륜 내부가 보이지 않음.
    //
    //    닫힌 루프 순서:
    //      ① START (intersectR, -halfC)  좌측 구면 끝점
    //      ② 구면 arc (-halfC → +halfC) [a 증가, 법선 +r = 바깥] ✓
    //      ③ (intersectR, halfC)
    //      ④ (lipR, halfC)    우측 끝면 (r 감소, 법선 +a = 바깥) ✓
    //      ⑤ (lipR, lipW)     우측 shoulder 내측
    //      ⑥ 경사 전환 (outerRingIR, lipW - step)
    //      ⑦ (outerRingIR, grooveR_shallow)
    //      ⑧ 홈 arc [+grooveR → -grooveR, a 감소, 법선 -r = 안쪽이지만 오목해서 외부에서 보이는 면] ⚠️
    //      ⑨ (outerRingIR, -grooveR_shallow)
    //      ⑩ 경사 전환 (outerRingIR, -lipW + step)
    //      ⑪ (lipR, -lipW)    좌측 shoulder 내측
    //      ⑫ (lipR, -halfC)   좌측 끝면 (r 증가, 법선 -a = 바깥) ✓
    //      ⑬ (intersectR, -halfC)  닫기 = START
    // ═══════════════════════════════════════════════════════════
    {
        // v44 파라미터: shoulder를 내륜 외경 바로 옆까지 깊게.
        //
        // [근본 재진단] v42/v43에서 "도넛 구멍"이 여전히 보인 진짜 이유:
        // lipR이 `pcdR + ballR*N` 로 계산되어 **outerRingIR 근처**에 있었음.
        // 즉 shoulder가 외륜 내경의 위쪽(바깥쪽)만 살짝 덮고,
        // 내륜 외경과 외륜 내경 사이 **9.5mm 갭이 그대로 노출**.
        //
        // 정답: lipR = innerRingOR + 작은 간격(0.3mm) 으로 두면
        //   shoulder가 갭 전체를 반경 방향으로 덮어 **축방향 구멍**이 사라짐.
        //   (물리적으로는 볼이 들어갈 공간 확보를 위해 내륜에 닿지 않음)
        //
        // UC206 예시: innerRingOR=18.74, outerRingIR=28.26
        //   → lipR = 18.74 + 0.3 = 19.04 (내륜 바로 옆)
        //   → 정면 뷰에서 외륜의 내측 경계가 내륜 외경과 거의 같은 원으로 보임
        //   → 둘 사이 0.3mm 얇은 갭만 남음 = 실제 CAD와 유사한 모습
        const gapToInner = 0.3;                              // 내륜·외륜 shoulder 간 여유
        const lipR = innerRingOR + gapToInner;               // ★ 내륜 바로 옆
        const lipAxialDepth = ballR + 0.5;                   // shoulder 축방향 깊이 (볼이 숨을 만큼)
        const lipW = halfC - lipAxialDepth;                  // shoulder 안쪽 축 위치
        const transStep = 0;                                  // 전환 없이 직각
        const grooveR_shallow = Math.min(ballR * 0.25, lipW - 0.3);  // lipW 안쪽에 홈

        // v44: lipR은 내륜 바로 옆, outerRingIR보다는 훨씬 안쪽이어야 함
        const hasLip = (lipR < outerRingIR - 1.0)              // shoulder 실제 존재 (최소 1mm 덮음)
                    && (lipR > innerRingOR + 0.15)             // 내륜 안 건드림
                    && (lipW > grooveR_shallow + 0.3)          // 홈과 shoulder 안 겹침
                    && (lipAxialDepth < halfC - 0.5);          // shoulder가 너무 깊지 않음

        const pts = [];

        // ① 좌측 구면 끝점 (START)
        pts.push(new THREE.Vector2(intersectR, -halfC));

        // ② 구면 arc: -halfC → +halfC, a 증가 방향
        appendLatheArc(pts,
            0, 0,
            intersectR, -halfC,
            intersectR,  halfC,
            true, 22);

        pts.push(new THREE.Vector2(intersectR, halfC));

        if (hasLip) {
            // ③~④ 우측 끝면 (r: intersectR → lipR, 수평 방향으로 감소)
            pts.push(new THREE.Vector2(lipR, halfC));
            // ⑤ shoulder 안쪽 축
            pts.push(new THREE.Vector2(lipR, lipW));
            // ⑥ 경사 전환
            pts.push(new THREE.Vector2(outerRingIR, lipW - transStep));
            // ⑦ 내경 우측 (홈 시작점)
            pts.push(new THREE.Vector2(outerRingIR, grooveR_shallow));

            // ⑧ 홈 arc: +grooveR → -grooveR, a 감소 방향
            // 홈은 "오목"이므로 arc 중심이 pcdR-쪽에 있어야 함
            // (a 감소 방향으로 minor arc = 반경이 pcdR+arcR에서 최대)
            appendLatheArc(pts,
                pcdR, 0,
                outerRingIR,  grooveR_shallow,
                outerRingIR, -grooveR_shallow,
                true, 14);

            // ⑨ 내경 좌측 (홈 끝점)
            pts.push(new THREE.Vector2(outerRingIR, -grooveR_shallow));
            // ⑩ 경사 전환
            pts.push(new THREE.Vector2(outerRingIR, -lipW + transStep));
            // ⑪ shoulder 안쪽 축
            pts.push(new THREE.Vector2(lipR, -lipW));
            // ⑫ 좌측 끝면 shoulder 내측
            pts.push(new THREE.Vector2(lipR, -halfC));
        } else {
            // hasLip=false: 단순 원통 내경
            pts.push(new THREE.Vector2(outerRingIR, halfC));
            pts.push(new THREE.Vector2(outerRingIR, grooveR_shallow));
            appendLatheArc(pts,
                pcdR, 0,
                outerRingIR,  grooveR_shallow,
                outerRingIR, -grooveR_shallow,
                true, 14);
            pts.push(new THREE.Vector2(outerRingIR, -grooveR_shallow));
            pts.push(new THREE.Vector2(outerRingIR, -halfC));
        }

        // ⑬ 좌측 끝면 (r 증가 방향, intersectR로 복귀)
        pts.push(new THREE.Vector2(intersectR, -halfC));  // 첫점과 동일 = 닫힘

        const lathe = new THREE.LatheGeometry(pts, 64);
        lathe.computeVertexNormals();
        modelGroup.add(new THREE.Mesh(lathe, outerRingMat.clone()));
    }

    // ═══════════════════════════════════════════════════════════
    // ③ 볼 Z개 (옵션, 기본 비활성화)
    //    v42: 실제 CAD 이미지(2번)에서 볼이 거의 안 보이므로 기본은 생성 안 함.
    //    options.showBalls === true 로 활성화 가능.
    //    활성화 시에도 반경을 ballR×0.85로 축소하여 외륜 뒤로 숨음.
    // ═══════════════════════════════════════════════════════════
    if (options.showBalls === true) {
        const ballR_visible = ballR * 0.85;
        for (let i = 0; i < Z; i++) {
            const a = (i * 2 * Math.PI) / Z;
            const bm = new THREE.Mesh(
                new THREE.SphereGeometry(ballR_visible, 20, 14),
                ballMat.clone()
            );
            bm.position.set(Math.cos(a) * pcdR, 0, Math.sin(a) * pcdR);
            modelGroup.add(bm);
        }
    }

    // ═══════════════════════════════════════════════════════════
    // ④ 멈춤나사 탭 마커 (옵션)
    //    실제 C++ CreateTap은 내부 나사산 구멍을 생성하지만,
    //    JS에서는 형상을 단순화하여 시각적 마커만 표시.
    //    v39: 기본 비활성화 (실제 CAD 이미지와 일치).
    //    필요시 options.showSetScrews = true 로 활성화.
    // ═══════════════════════════════════════════════════════════
    if (options.showSetScrews === true) {
        const screwDepth = (innerRingOR - innerR) * 0.95;
        const screwPosAxial = halfB * 0.7;
        for (const sY of [-1, 1]) {
            const sg = new THREE.CylinderGeometry(tapBoreR, tapBoreR, screwDepth, 12);
            sg.rotateZ(Math.PI / 2);
            const sm = new THREE.Mesh(sg, screwMat.clone());
            sm.position.set(innerRingOR - screwDepth / 2, sY * screwPosAxial, 0);
            modelGroup.add(sm);
        }
    }

    if (options.dimensions) buildUNITDimOnly(dims);
}
function buildUNITDimOnly(dims) {
    // ★ v37: 엑셀 치수 정의 매핑 — dk 우선, C 추가
    const d  = dims.d1 || dims.d  || dims.D1 || 25;
    let   D  = dims.D2 || dims.D  || 0;
    let   dk = dims.dk || 0;
    let   B  = dims.B  || 0;
    let   C  = dims.C  || 0;
    if (D  <= 0) D  = d * 2.07;
    if (dk <= 0) dk = D;
    if (B  <= 0) B  = d * 1.36;
    if (C  <= 0) C  = D * 0.30;

    addHorizontalDim(-d /2,  d/2,  -B/2 - 8, -d/2 - 10, 'd', d);
    addHorizontalDim(-dk/2, dk/2,   B/2 + 8, dk/2 + 10, (dims.dk ? 'dk' : 'D'), dk);
    addVerticalDim(dk/2 + 10, -B/2, B/2, 'B', B);
    if (C > 0) addVerticalDim(dk/2 + 30, -C/2, C/2, 'C', C);
}

// ═══════════════════════════════════════════════════
// ⑳ PILB — 플러머블록 (UC 인서트 계열 - UCP/UKP)
// ═══════════════════════════════════════════════════
const pilbHousingMat = new THREE.MeshStandardMaterial({ color: 0x8A9098, metalness: 0.30, roughness: 0.65 });

function buildPILB(dims) {
    const d = dims.d1 || dims.D1 || dims.d || 20;
    const D = dims.D2 || dims.D || 47;
    const B = dims.B || 14;
    const GD = dims.GD || D * 1.15;
    const HD = dims.HD || dims.Sd || D * 1.2;
    const HH = dims.HH || dims.Sh || D * 2.0;
    const HW = dims.HW || D * 2.2;
    const FD = dims.FD || D * 2.8;
    const FB = dims.FB || B * 1.3;
    const J  = dims.J  || D * 2.0;

    buildUNIT(dims);

    const topY = HH / 2 - HD, botY = -HD;
    const housingH = HH - HD * 0.3;
    const hMesh = new THREE.Mesh(new THREE.BoxGeometry(HW, housingH, FB), pilbHousingMat.clone());
    hMesh.position.set(0, (topY + botY) / 2, 0);
    modelGroup.add(hMesh);
    const bpH  = HD * 0.3;
    const bpM  = new THREE.Mesh(new THREE.BoxGeometry(FD, bpH, FB * 1.1), pilbHousingMat.clone());
    bpM.position.set(0, botY - bpH / 2, 0); modelGroup.add(bpM);

    const boltMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0, roughness: 1 });
    for (const sign of [-1, 1]) {
        const bm = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, bpH * 1.2, 12), boltMat);
        bm.position.set(sign * J / 2, botY - bpH / 2, 0); modelGroup.add(bm);
    }
    const boreM = new THREE.Mesh(
        new THREE.CylinderGeometry(GD * 0.60, GD * 0.60, FB * 1.02, 32),
        new THREE.MeshStandardMaterial({ color: 0x0A0A0A, metalness: 0, roughness: 1 })
    );
    boreM.position.set(0, 0, 0); modelGroup.add(boreM);
    if (options.dimensions) buildPILBDimOnly(dims);
}
function buildPILBDimOnly(dims) {
    const d = dims.d1 || dims.D1 || 20, D = dims.D2 || dims.D || 47;
    const HD = dims.HD || D * 1.2, HH = dims.HH || D * 2.0;
    const HW = dims.HW || D * 2.2, J  = dims.J  || D * 2.0;
    addHorizontalDim(-d/2, d/2, -HD-8, -d/2-10, 'd', d);
    addHorizontalDim(-HW/2, HW/2, HH/2-HD+HH*0.1, HW/2+10, 'HW', HW);
    addVerticalDim(HW/2+10, -HD, HH-HD, 'HH', HH);
    addHorizontalDim(-J/2, J/2, -HD-HH*0.15, -HD-HH*0.35, 'J', J);
}

// ⑳-B SD/SN — 플러머블록 (분할형 — Timken/SKF SD·SN 계열)
// ═══════════════════════════════════════════════════
//
//  치수 키 (이미지3 / 엑셀 기준):
//    d1  = 내경(보어)       H   = 중심고 (베이스 바닥→보어 중심)
//    L   = 전체 길이        T   = 조립 폭(하우징 깊이)
//    S   = 볼트 피치(길이방향) Bgw = 볼트 홀 간격(가로)
//    Bd  = 볼트 규격(M24)   Bdn = 볼트 홀 지름
//
//  좌표계:
//    보어 축 = Y (베어링 렌더러 공통)
//    위쪽(하우징 높이 방향) = +Z
//    하우징 폭 방향 = X
//    보어 중심 = 원점(0,0,0), 베이스 바닥 = Z = -H
//
//  구성:
//    ① 베이스 플레이트 (L×T×baseH, Z 중심 = -H+baseH/2)
//    ② 하우징 하부 몸체 (원호 단면, Z: -H+baseH ~ 0)
//    ③ 하우징 상부 캡  (원호 단면, Z: 0 ~ +capH)
//    ④ 보어 홀 (d1 원통, Y축)
//    ⑤ 분할면 플랜지 (양측 날개, 볼트 체결부)
//    ⑥ 베이스 볼트 홀 4개
//    ⑦ 그리스 니플 (상단)
// ═══════════════════════════════════════════════════
const sdHousingMat  = new THREE.MeshStandardMaterial({
    color: 0x8A9098, metalness: 0.28, roughness: 0.68,
    side: THREE.DoubleSide   // ★ 안팎 모두 렌더링 — 내부 단면 보임
});
const sdFlangeMat   = new THREE.MeshStandardMaterial({ color: 0x9AA2AA, metalness: 0.30, roughness: 0.62 });
const sdBaseMat     = new THREE.MeshStandardMaterial({ color: 0x7A8088, metalness: 0.25, roughness: 0.72 });
const sdBoreMat     = new THREE.MeshStandardMaterial({ color: 0x080C10, metalness: 0,    roughness: 1.0  });
const sdBoltMat     = new THREE.MeshStandardMaterial({ color: 0x404850, metalness: 0.55, roughness: 0.40 });

// ═══════════════════════════════════════════════════
// SD 전용 상태 저장 (GS 파라미터 등)
// ═══════════════════════════════════════════════════
let sdGlobalState = {
    GS: 0.1,
    lastDimensions: null
};

function buildSD(dims) {
    // ══════════════════════════════════════════════════════════════
    //  SD/SN 분할형 플러머블록 3D 렌더러
    //  C++ NewCreateBearingClass.cpp 소스 공식 직접 적용
    //
    //  Three.js 좌표계:
    //    Y = 보어(샤프트)축  Z = 수직(높이)  X = 수평(폭)
    //    보어 중심 = 원점(0,0,0)
    //
    //  C++ SD3134 실측값 (SetPlummerBlockDim):
    //    d=150, d1=180, d2=170, D2=280, H=170, H1=50
    //    A=250, A1=220, J=470, J1=120, g_dim=98, t=M24
    // ══════════════════════════════════════════════════════════════
    const GS = 0.1;
    const g  = v => v * GS;
    
    // ★ SD 전역 상태에 저장 (재생성시 사용)
    sdGlobalState.GS = GS;
    sdGlobalState.lastDimensions = dims;

    // ── DB 치수 (mm) ──────────────────────────────────────────
    // ★ 올바른 치수 키 매핑 (엑셀 문서 기반)
    // d1 = 기본 보어지름 (150), S = 실제 보어 내경 (180)
    const d   = dims.d1 || dims.d || 100;       // 기본 보어지름 (DB d1)
    const d1_real = dims.S || dims.s || d * 1.2;  // 실제 보어 내경 (DB S)
    const H_total = dims.H || d1_real * 1.86;   // 전체 높이 (DB H)
    const T   = dims.T  || d1_real * 1.28;      // C++ A1 ≈ DB T
    const S   = dims.S || dims.s || d1_real;    // DB S (bolt spacing) 
    const Bgw = dims.Bgw || dims.BGW || d1_real*2.39; // DB Bgw (bolt bore-dir span)
    const L   = dims.L  || d1_real * 2.83;      // DB L (base bore-dir length)
    const Bdn = Number(dims.Bdn || dims.BDN || 24); // cap bolt size (t)

    // ── C++ 내부 치수 — SD3134 비율 기반 ─────────────────────
    // d1_real = S (실제 보어 내경, SD3134: 180)
    // d = d1 (기본 보어지름, SD3134: 150) 
    // d2 = d * 1.133 (내부 확장 보어 좌측, SD3134: 150→170)
    // D2 = d1_real * 1.56 (베어링 외경, SD3134: 180→280)
    // A1 ≈ T (하우징 폭, C++ A1=220, DB T=230)
    // A  = A1 * 1.136 (베이스 폭, C++ A=250, A1=220)
    // H  = H_total * 0.507 (보어 중심고, C++ H=170, H_total=335)
    // H1 = H * 0.294 (베이스 두께, C++ H1=50, H=170)
    // g_dim = A1 * 0.445 (베어링 시트폭, C++ g=98, A1=220)
    // J1 = A1 * 0.545 (폭방향 볼트간격, C++ J1=120, A1=220)
    // J  = Bgw (보어방향 볼트간격 ≈ DB Bgw)

    const d1_cpp = d1_real;              // C++ d1 (실제 보어 내경 = S)
    const d2_cpp = d * 1.133;            // C++ d2 (좌측 확장 보어, 기본값 기준)
    const D2     = d1_real * 1.56;       // C++ D2 (베어링 외경)
    const A1     = T;                    // C++ A1
    const A      = A1 * 1.136;          // C++ A (베이스 폭)
    const cH     = H_total * 0.507;     // C++ H (보어 중심고)
    const H1     = cH * 0.294;          // C++ H1
    const g_dim  = A1 * 0.445;      // C++ g (베어링 시트폭)
    const J1_cpp = A1 * 0.545;      // C++ J1
    const H2_cpp = cH * 2.0;        // C++ H2 ≈ 2*H (SD 시리즈)

    // ── C++ domeR, cutY ─────────────────────────────────────────
    const domeR = D2 / 2 + 18;      // C++ 고정 공식
    const cutY  = Math.sqrt(Math.max(0, domeR*domeR - (A1/2)*(A1/2)));

    // ── C++ Lower_Shaft_Cylinder 치수 ──────────────────────────
    // clearD = (-0.00074074 * bore² + 1.4 * bore + 26.667)
    const clearD1 = (-0.00074074 * d1_cpp*d1_cpp) + (1.4*d1_cpp) + 26.667;
    const clearD2 = (-0.00074074 * d2_cpp*d2_cpp) + (1.4*d2_cpp) + 26.667;
    const clearR1 = clearD1 / 2;    // 우측 클리어런스 반경 ≈ 127.3mm
    const clearR2 = clearD2 / 2;    // 좌측 클리어런스 반경 ≈ 121.6mm
    const d1_R   = d1_cpp / 2;      // 우측 보어 반경 = 90mm
    const d2_R   = d2_cpp / 2;      // 좌측 보어 반경 = 85mm
    const halfA  = A / 2;           // 반폭 = 125mm

    // ── C++ 기둥 위치 공식 ────────────────────────────────────
    // raw_cbX = (J1/2) + ((H2 - 2H) * 0.75) - 10
    //   SD3134: (60) + (0) - 10 = 50mm (X 폭방향)
    // raw_capBoltZ = (D2*0.164) - (g*1.29) + (t*9.7) + 2.8
    //   SD3134: 45.92 - 126.42 + 232.8 + 2.8 = 155.1mm (Y 보어방향)
    // raw_pillarR = (t*1.2) - 1.5
    //   M24: 28.8 - 1.5 = 27.3mm
    const cbX_mm      = (J1_cpp/2) + ((H2_cpp - 2*cH) * 0.75) - 10;
    const capBoltZ_mm = (D2*0.164) - (g_dim*1.29) + (Bdn*9.7) + 2.8;
    const pillarR_mm  = (Bdn * 1.2) - 1.5;

    logToCSharp('[SD] d=' + d + ' d1_cpp=' + d1_cpp + ' clearR1=' + clearR1.toFixed(1) +
                ' clearR2=' + clearR2.toFixed(1) + ' halfA=' + halfA.toFixed(1) +
                ' cH=' + cH.toFixed(1) + ' H1=' + H1.toFixed(1) +
                ' cbX=' + cbX_mm.toFixed(1) + ' capBoltZ=' + capBoltZ_mm.toFixed(1));

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ① 베이스 플레이트 (C++ Lower_Base)
    //   C++: A×L 직사각형 → H1 두께 압출
    //   X(폭) = A, Y(보어) = L, Z 범위: -H ~ -(H-H1)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ★ C++ 좌표계: basePlane(XZ) 스케치에서
    //   halfA = A/2 → C++ X축(보어방향) → Three.js Y
    //   halfL = L/2 → C++ Z축(폭방향)  → Three.js X
    // 따라서: baseW(X) = L (큰값, 폭), baseL(Y) = A (작은값, 보어방향)
    const baseW  = g(L);              // Three.js X(폭) = C++ L
    const baseL  = g(A);             // Three.js Y(보어) = C++ A
    const baseH  = g(H1);
    const baseZc = g(-cH + H1/2);

    // ★ sdGroup: 보어축 방향 교정 (Y→X) — Z축 90° 회전
    const sdGroup = new THREE.Group();
    modelGroup.add(sdGroup);

    const baseMesh = new THREE.Mesh(
        new THREE.BoxGeometry(baseW, baseL, baseH),
        sdBaseMat.clone()
    );
    baseMesh.position.set(0, 0, baseZc);
    sdGroup.add(baseMesh);

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ② 하우징 구면 몸체
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const gBoreR   = g(d / 2);        // ★ d1→d 수정
    const gDomeR   = g(domeR);
    const gA1h     = g(A1 / 2);
    const gCutY    = g(cutY);
    const nSeg     = 32;

    // 외경 구면 프로파일
    const pts = [];
    for (let i = 0; i <= nSeg; i++) {
        const y = -gA1h + 2*gA1h*i/nSeg;
        const r = Math.sqrt(Math.max(0, gDomeR*gDomeR - y*y));
        pts.push(new THREE.Vector2(r, y));
    }
    const housingGeo  = new THREE.LatheGeometry(pts, 32);
    const housingMesh = new THREE.Mesh(housingGeo, sdHousingMat.clone());
    housingMesh.position.set(0, 0, 0);
    sdGroup.add(housingMesh);

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ②-B Lower_Shaft_Cylinder (C++ 핵심 형상)
    //
    //   이미지 1(실제 CAD 4번)의 양쪽 굵은 원통이 이것
    //   C++ d1=180, d2=170 → clearR1=127, clearR2=122
    //   LatheGeometry 대신 CylinderGeometry×2 + 끝단 RingGeometry
    //   → Three.js에서 확실히 렌더링됨
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ②-B Lower_Shaft_Cylinder
    //   C++ 원리: 보어축(Y) 중심 회전체 → clearR 외경, bore 내경
    //   THREE.js: 단일 CylinderGeometry Y=0 중심, 높이=2*halfA
    //
    //   SD3134: clearR1=127mm, clearR2=122mm, halfA=125mm
    //   → 단일 실린더: 반경=clearR1=127, 높이=2*125=250mm
    //   → Y: -g(halfA) ~ +g(halfA) (중심=0)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    {
        const gCR  = g(clearR1);       // 외경 ≈12.73 units
        const gHA  = g(halfA);         // 반폭 ≈12.5 units
        const gBR  = g(d / 2);         // 보어 반경 ≈7.5 units
        const endMat = new THREE.MeshStandardMaterial({
            color: 0x8A9098, metalness: 0.28, roughness: 0.68, side: THREE.DoubleSide
        });
        const boreMat2 = new THREE.MeshStandardMaterial({
            color: 0x70787E, metalness: 0.2, roughness: 0.8, side: THREE.DoubleSide
        });

        // ① 외벽 단일 실린더 (Y: -gHA ~ +gHA, 중심=0)
        const shCylGeo = new THREE.CylinderGeometry(gCR, gCR, gHA * 2, 48, 1, true);
        sdGroup.add(new THREE.Mesh(shCylGeo, sdHousingMat.clone()));

        // ② 끝단 링 (벽 두께 단면) — 우측(+Y), 좌측(-Y)
        for (const sy of [-1, 1]) {
            const innerR = sy > 0 ? g(d1_R) : g(d2_R);   // 우=d1_R=90, 좌=d2_R=85
            const outerR = sy > 0 ? g(clearR1) : g(clearR2);
            const eGeo = new THREE.RingGeometry(innerR, outerR, 32);
            eGeo.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
            const eMesh = new THREE.Mesh(eGeo, endMat.clone());
            eMesh.position.set(0, sy * gHA, 0);          // ★ 정확한 끝단 위치
            sdGroup.add(eMesh);
        }

        // ③ 보어 내면 (d/2, 전체 길이, openEnded + DoubleSide)
        const boreIntGeo = new THREE.CylinderGeometry(gBR, gBR, gHA * 2.1, 48, 1, true);
        sdGroup.add(new THREE.Mesh(boreIntGeo, boreMat2));

        // ④ 베어링 시트 링
        const seatTGeo = new THREE.TorusGeometry(g(clearR1 * 0.82), g(2.5), 8, 32);
        seatTGeo.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
        sdGroup.add(new THREE.Mesh(seatTGeo,
            new THREE.MeshStandardMaterial({ color: 0x606870, metalness: 0.4, roughness: 0.6 })
        ));
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ③ 분할면 (Split plane)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const splitGeo = new THREE.CylinderGeometry(g(cutY * 1.02), g(cutY * 1.02), g(2), 32);
    const splitMesh = new THREE.Mesh(splitGeo,
        new THREE.MeshStandardMaterial({ color: 0x50606E, metalness: 0.4, roughness: 0.5 })
    );
    splitMesh.position.set(0, 0, 0);
    sdGroup.add(splitMesh);

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ⑤-B 아이볼트(Eye Bolt) 2개
    //   C++ CreatePlummerBlock_EyeBolt: SD 전용, 상단 배치
    //   이미지 1(정면)에서 하나, 이미지 2(측면)에서 두개 보임
    //   → Y방향으로 ±J1/2 간격 배치
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const eyeR        = g(Bdn * 0.65);
    const eyeTubeR    = g(Bdn * 0.14);
    const eyeShaftH   = g(Bdn * 1.1);
    const eyeShaftR   = g(Bdn * 0.20);
    const eyeTopZ     = g(domeR * 0.75);
    // C++ J1=120mm → ±J1/2=±60mm (폭방향 X, 이미지 2 측면에서 보면 Y방향처럼 보임)
    // 실제로 아이볼트는 Y방향(보어방향)으로 배치
    const eyeSpacingY = g(J1_cpp * 0.5); // ±J1/2 = ±60mm → g=±6.0 units
    const eyeBoltMat  = new THREE.MeshStandardMaterial({ color: 0x9AA4AC, metalness: 0.5, roughness: 0.4 });

    for (const sy of [-1, 1]) {
        // 축: 수직(Z방향) 실린더
        const shaftGeo = new THREE.CylinderGeometry(eyeShaftR, eyeShaftR * 1.2, eyeShaftH, 8);
        shaftGeo.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
        const shaftMesh = new THREE.Mesh(shaftGeo, eyeBoltMat.clone());
        shaftMesh.position.set(sy * eyeSpacingY, 0, eyeTopZ + eyeShaftH / 2);
        sdGroup.add(shaftMesh);

        // 링: XZ 평면 (보어축과 수직으로 서있음)
        // TorusGeometry 기본 = XY 평면 → makeRotationX(PI/2) → XZ 평면
        const eyeGeo = new THREE.TorusGeometry(eyeR, eyeTubeR, 8, 24);
        eyeGeo.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
        const eyeMesh = new THREE.Mesh(eyeGeo, eyeBoltMat.clone());
        eyeMesh.position.set(sy * eyeSpacingY, 0, eyeTopZ + eyeShaftH + eyeR);
        sdGroup.add(eyeMesh);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ⑥ 캡 볼트 기둥 4개  (C++ Lower_Pillars + Upper_Pillars 합체)
    //   C++: Lower(베이스→분할면) + Upper(분할면→상단) 두 파트
    //   Three.js: Z=0 중심, 총 높이 = 2*(cH-H1) ≈ 24 units ≈ 보어 직경
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const pillarH   = g((cH - H1) * 2);   // ★ 상하 합계 높이
    const pillarZc  = 0;                   // ★ Z=0(분할면) 중심 → 상하 대칭
    const pillarW   = g(pillarR_mm * 2.5); // 기둥 폭 (X방향)
    const pillarD   = g(pillarR_mm * 2.5); // 기둥 깊이 (Y방향)

    for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
            // ★ BoxGeometry: 이미지 1의 사각형 플랜지 형태
            const pGeo  = new THREE.BoxGeometry(pillarW, pillarD, pillarH);
            const pMesh = new THREE.Mesh(pGeo, sdFlangeMat.clone());
            pMesh.position.set(sx * g(capBoltZ_mm), sy * g(cbX_mm), pillarZc);
            sdGroup.add(pMesh);

            // 육각머리 캡 볼트 — 머리만 기둥 상단 위로 살짝 돌출
            const hexR   = g(pillarR_mm * 0.80);   // 육각 머리 반경
            const hexH   = g(pillarR_mm * 0.65);   // 육각 머리 높이

            // 육각 머리만 기둥 상단 위에 표시 (축은 기둥 내부 → 생략)
            const hexGeo = new THREE.CylinderGeometry(hexR, hexR, hexH, 6);
            hexGeo.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
            const hexMesh = new THREE.Mesh(hexGeo, sdBoltMat.clone());
            hexMesh.position.set(sx * g(capBoltZ_mm), sy * g(cbX_mm),
                pillarH / 2 + hexH / 2);   // 기둥 상면에 딱 붙게
            sdGroup.add(hexMesh);
        }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ⑦ 베이스 마운팅 볼트 홀 4개  (C++ Mounting_Holes)
    //   ★ Y(보어방향): Bgw/2 = 215mm  X(수직): S/2 = 90mm
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const boltR  = g(Bdn / 2);
    for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
            const bhX = sx * g(Bgw / 2);
            const bhY = sy * g(J1_cpp / 2);
            const bhZ = baseZc;

            // 마운팅 홀만 표시 (볼트 머리 제거)
            const bhGeo = new THREE.CylinderGeometry(boltR, boltR, baseH * 1.1, 12);
            bhGeo.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
            const bhM = new THREE.Mesh(bhGeo,
                new THREE.MeshStandardMaterial({ color: 0x050810, metalness: 0, roughness: 1 })
            );
            bhM.position.set(bhX, bhY, bhZ);
            sdGroup.add(bhM);
        }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ⑧ 그리스 니플 (상단)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const nipR = g(d1_cpp * 0.035), nipH = g(d1_cpp * 0.12);
    const nipGeo = new THREE.CylinderGeometry(nipR * 0.6, nipR, nipH, 8);
    nipGeo.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
    const nipMesh = new THREE.Mesh(nipGeo,
        new THREE.MeshStandardMaterial({ color: 0xC0A020, metalness: 0.7, roughness: 0.3 })
    );
    nipMesh.position.set(0, 0, g(domeR) + nipH / 2);
    sdGroup.add(nipMesh);

    // ★ 치수는 updateModel에서 별도로 처리하므로 여기서는 제거
    // if (options.dimensions) buildSDDimOnly(dims, GS);
}

function buildSDDimOnly(dims, GS) {
    try {
        GS = GS || 0.1;
        const g = v => v * GS;

        // ★ 디버깅 로그 추가
        console.log('buildSDDimOnly called:', dims, 'GS:', GS);

        // ★ 올바른 SD 치수 키 매핑 (실제 데이터 기반)
        // d1 = 기본 보어지름 (150), S = 실제 보어 내경 (180)
        const d1 = dims.S || dims.s || dims.d1 || 100;  // 실제 보어 내경 (S=180)
        console.log('SD d1 추출 결과:', d1, 'from dims.S=' + dims.S + ', dims.s=' + dims.s + ', dims.d1=' + dims.d1);

        const H   = dims.H  || d1 * 1.86;
        const L   = dims.L  || d1 * 2.83;
        const T   = dims.T  || d1 * 1.28;
        const Bgw = dims.Bgw || dims.BGW || d1 * 2.39;
        const S   = dims.S  || dims.s || d1;
        const cH  = H * 0.51;
        const D2  = d1 * 1.56;
        const domeR = D2/2 + 18;

        // ★ 실제 매핑된 치수값 확인
        console.log('SD 치수 매핑:', {d1, H, L, T, Bgw, S});

        // ★ 디버깅: 치수 추가 전 dimGroup 상태 확인
        console.log('dimGroup exists:', !!dimGroup, 'visible:', dimGroup ? dimGroup.visible : 'N/A');

        // 보어 내경 d1 (수평 치수)
        addHorizontalDim(g(-d1/2), g(d1/2), 0, g(-T/2) - 8, 'd1', d1);
    // 중심고 H (전체 높이)
    addVerticalDim(g(T/2) + 12, g(-cH), g(domeR), 'H', H);
    // 전체 길이 L (보어축 방향)
    addLengthDimY(g(-L/2), g(L/2), g(domeR) + 10, 0, 'L', L);
    // 볼트 간격 Bgw
    addHorizontalDim(g(-Bgw/2), g(Bgw/2), g(-cH) - 8, 0, 'Bgw', Bgw);
    
    console.log('buildSDDimOnly 완료');
    
    } catch (error) {
        console.error('buildSDDimOnly 에러:', error.message);
        console.error('dims:', dims);
        logToCSharp('SD 치수 에러: ' + error.message);
    }
}

// ═══════════════════════════════════════════════════
// ㉑ FLBU — 플랜지형 유닛 (4볼트 플랜지)
//    인서트 베어링 + 플랜지 하우징
//    GD=시트OD, Ga=폭, FD=플랜지 OD, J/J1=볼트 피치
// ═══════════════════════════════════════════════════
function buildFLBU(dims) {
    const d=dims.d1||dims.D1||dims.d||20, D=dims.D2||dims.D||47, B=dims.B||14;
    const FD=dims.FD||D*1.9;   // 플랜지 OD
    const FB=dims.FB||FD;
    const J =dims.J||D*1.5;    // 볼트 피치 X
    const J1=dims.J1||J;       // 볼트 피치 Y
    const FL=dims.GL||B*0.6;   // 플랜지 두께

    // ① 인서트 베어링
    buildUNIT(dims);

    // ② 사각 플랜지 플레이트 (Z방향으로 얇게)
    const fGeo = new THREE.BoxGeometry(FD, FB, FL);
    const fMesh = new THREE.Mesh(fGeo, pilbHousingMat.clone());
    fMesh.position.set(0, 0, -(B/2+FL/2));
    modelGroup.add(fMesh);

    // ③ 볼트 구멍 (4개)
    const boltR=4;
    const boltMat = new THREE.MeshStandardMaterial({color:0x0A0A0A,metalness:0,roughness:1});
    for (const sx of [-1,1]) for (const sy of [-1,1]) {
        const bgGeo = new THREE.CylinderGeometry(boltR,boltR,FL*1.1,12);
        bgGeo.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI/2));
        const bgMesh = new THREE.Mesh(bgGeo, boltMat);
        bgMesh.position.set(sx*J/2, sy*J1/2, -(B/2+FL/2));
        modelGroup.add(bgMesh);
    }

    if (options.dimensions) buildFLBUDimOnly(dims);
}
function buildFLBUDimOnly(dims) {
    const d=dims.d1||dims.D1||20, D=dims.D2||dims.D||47;
    const FD=dims.FD||D*1.9, B=dims.B||14;
    addHorizontalDim(-d/2,d/2,-FD/2-8,-d/2-10,'d',d);
    addHorizontalDim(-FD/2,FD/2,FD/2+5,FD/2+10,'FD',FD);
    addVerticalDim(FD/2+10,-B/2,B/2,'B',B);
}

// ═══════════════════════════════════════════════════════════════════
//  ★ 신규 베어링 3D 렌더러 — C++ NewCreateBearingClass.cpp 기반
// ═══════════════════════════════════════════════════════════════════

// ──────────────────────────────────────────────
// 4점 접촉 볼베어링 (QPBB) — DGBB + 4점 접촉각
// C++ CreateDeepGrooveBallBearing 변형
// ──────────────────────────────────────────────
function buildQPBB(dims) {
    // DGBB와 동일 구조, 4점 접촉선 추가
    buildDGBB(dims);
    // 4점 접촉각 표시선 (X자 형태)
    const d=dims.d1||dims.d||20, D=dims.D2||dims.D||47, B=dims.B||14;
    const pitchR=(d+D)/4;
    const mat=new THREE.LineBasicMaterial({color:0xFF8800,linewidth:1.5});
    for(const a of [Math.PI/4,-Math.PI/4]){
        const pts=[new THREE.Vector3(Math.cos(a)*pitchR*0.6,0,Math.sin(a)*pitchR*0.6),
                   new THREE.Vector3(-Math.cos(a)*pitchR*0.6,0,-Math.sin(a)*pitchR*0.6)];
        modelGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),mat));
    }
}

// ──────────────────────────────────────────────
// 복열 앵귤러 콘텍트 볼베어링 (DANB)
// C++ CreateAngularContactBallBearing 복열
// ──────────────────────────────────────────────
function buildDANB(dims) {
    const d=dims.d1||dims.d||20, D=dims.D2||dims.D||47, B=dims.B||14;
    const halfB=B/2*0.48;
    // 두 열을 ±halfB 위치에 렌더링
    for(const sy of[-1,1]){
        const dimsRow={...dims, B: B*0.48};
        const tmpGroup=new THREE.Group();
        const prevGroup=modelGroup;
        // 임시로 modelGroup을 교체하여 buildANBB 호출
        const origAdd=modelGroup.add.bind(modelGroup);
        const rowGroup=new THREE.Group();
        rowGroup.position.y=sy*halfB;
        // 직접 ANBB 형상 구성
        _buildANBBRow(dims, B*0.48, rowGroup);
        modelGroup.add(rowGroup);
    }
    if(options.dimensions) buildANBBDimOnly(dims);
}

function _buildANBBRow(dims, rowB, group) {
    const d=dims.d1||dims.d||20, D=dims.D2||dims.D||47;
    const B=rowB, r=dims.r||1;
    const steelMat=new THREE.MeshStandardMaterial({color:0x8A9098,metalness:0.7,roughness:0.25});
    const innerMat=new THREE.MeshStandardMaterial({color:0x9AA2AA,metalness:0.6,roughness:0.3});
    const ballMat =new THREE.MeshStandardMaterial({color:0xC0C8D0,metalness:0.8,roughness:0.2});
    const halfB=B/2;
    const outerR=D/2, innerR=d/2;
    const pitchR=(d+D)/4;
    const ballR=(D-d)*0.15;
    const oWall=(D-d)*0.22, iWall=(D-d)*0.20;
    // 외륜
    const oGeo=new THREE.CylinderGeometry(outerR,outerR,B,48,1,false);
    const iHoleGeo=new THREE.CylinderGeometry(outerR-oWall,outerR-oWall,B*1.01,48,1,false);
    group.add(new THREE.Mesh(oGeo,steelMat.clone()));
    // 내륜
    const inGeo=new THREE.CylinderGeometry(innerR+iWall,innerR+iWall,B,48,1,false);
    group.add(new THREE.Mesh(inGeo,innerMat.clone()));
    // 볼
    const Z_val=Math.max(7,Math.floor(Math.PI*pitchR/ballR/1.3));
    for(let i=0;i<Z_val;i++){
        const a=i*Math.PI*2/Z_val;
        const bm=new THREE.Mesh(new THREE.SphereGeometry(ballR,12,8),ballMat.clone());
        bm.position.set(Math.cos(a)*pitchR,0,Math.sin(a)*pitchR);
        group.add(bm);
    }
}

// ──────────────────────────────────────────────
// 복열 원통 롤러 베어링 (DCYL)
// C++ CreateCylindricalRollerBearing 복열
// ──────────────────────────────────────────────
function buildDCYL(dims) {
    const d=dims.d1||dims.d||20, D=dims.D2||dims.D||52, B=dims.B||21;
    const halfB=B/2*0.48;
    for(const sy of[-1,1]){
        const rowGroup=new THREE.Group();
        rowGroup.position.y=sy*halfB;
        _buildCYLRRow({...dims,B:B*0.48},rowGroup);
        modelGroup.add(rowGroup);
    }
    if(options.dimensions) buildCYLRDimOnly(dims);
}

function _buildCYLRRow(dims, group) {
    const d=dims.d1||dims.d||20, D=dims.D2||dims.D||52, B=dims.B||21, r=dims.r||1;
    const steelMat=new THREE.MeshStandardMaterial({color:0x8A9098,metalness:0.7,roughness:0.25});
    const innerMat=new THREE.MeshStandardMaterial({color:0x9AA2AA,metalness:0.6,roughness:0.3});
    const rollerMat=new THREE.MeshStandardMaterial({color:0xB8C0C8,metalness:0.75,roughness:0.25});
    const oWall=(D-d)*0.22, iWall=(D-d)*0.20;
    const pitchR=(d+D)/4, rollerR=(D-d)*0.12, rollerL=B*0.7;
    const oGeo=new THREE.CylinderGeometry(D/2,D/2,B,48,1,false);
    group.add(new THREE.Mesh(oGeo,steelMat.clone()));
    const inGeo=new THREE.CylinderGeometry(d/2+iWall,d/2+iWall,B,48,1,false);
    group.add(new THREE.Mesh(inGeo,innerMat.clone()));
    const Z=Math.max(8,Math.floor(Math.PI*2*pitchR/(rollerR*2*1.3)));
    for(let i=0;i<Z;i++){
        const a=i*Math.PI*2/Z;
        const rm=new THREE.Mesh(new THREE.CylinderGeometry(rollerR,rollerR,rollerL,12),rollerMat.clone());
        rm.position.set(Math.cos(a)*pitchR,0,Math.sin(a)*pitchR);
        group.add(rm);
    }
}

// ──────────────────────────────────────────────
// 복열 테이퍼 롤러 베어링 (DTRB)
// ──────────────────────────────────────────────
function buildDTRB(dims) {
    // ★ 표준 베어링 치수 매핑
    const d=dims.d1 || dims.D1 || dims.d || 25;   // 안지름
    const D=dims.D2 || dims.D || 62;              // 바깥지름
    const B=dims.B || 24;                         // 폭
    const halfB=B/2*0.50;
    for(const sy of[-1,1]){
        const rowGroup=new THREE.Group();
        rowGroup.position.y=sy*halfB;
        rowGroup.rotation.y=sy>0?0:Math.PI;
        _buildTRBRRow({...dims,B:B*0.50},rowGroup);
        modelGroup.add(rowGroup);
    }
    if(options.dimensions) buildTRBRDimOnly(dims);
}

function _buildTRBRRow(dims, group) {
    const d=dims.d1||dims.d||25, D=dims.D2||dims.D||62, B=dims.B||24;
    const steelMat=new THREE.MeshStandardMaterial({color:0x8A9098,metalness:0.7,roughness:0.25});
    const innerMat=new THREE.MeshStandardMaterial({color:0x9AA2AA,metalness:0.6,roughness:0.3});
    const rollerMat=new THREE.MeshStandardMaterial({color:0xB8C0C8,metalness:0.75,roughness:0.25});
    const angle=15*Math.PI/180;
    const oGeo=new THREE.CylinderGeometry(D/2,D/2*0.95,B,48,1,false);
    group.add(new THREE.Mesh(oGeo,steelMat.clone()));
    const inGeo=new THREE.CylinderGeometry(d/2*1.2,d/2,B,48,1,false);
    group.add(new THREE.Mesh(inGeo,innerMat.clone()));
    const pitchR=(d+D)/4, Z=Math.max(10,Math.floor(2*Math.PI*pitchR/(B*0.45)));
    for(let i=0;i<Z;i++){
        const a=i*Math.PI*2/Z;
        const rTop=B*0.22, rBot=B*0.16;
        const rm=new THREE.Mesh(new THREE.CylinderGeometry(rTop,rBot,B*0.7,10),rollerMat.clone());
        rm.position.set(Math.cos(a)*pitchR,0,Math.sin(a)*pitchR);
        rm.rotation.z=angle; rm.rotation.x=-angle*Math.cos(a);
        group.add(rm);
    }
}

// ──────────────────────────────────────────────
// 니들 롤러 베어링 (NRBR / SNRB / GNRB / SHRB)
// C++ CreateNeedleRollerBearing 기반
// ──────────────────────────────────────────────
function buildNRBR(dims) {
    // ★ 표준 베어링 치수 매핑 (엑셀 정의 기준)
    const d=dims.d1 || dims.D1 || dims.d || 20;    // 안지름 (d1 우선)
    const D=dims.D2 || dims.D || 32;               // 바깥지름 
    const B=dims.B || 20;                          // 폭
    const r=dims.r||0.3;
    const steelMat=new THREE.MeshStandardMaterial({color:0x8A9098,metalness:0.7,roughness:0.3});
    const innerMat=new THREE.MeshStandardMaterial({color:0x9AA2AA,metalness:0.6,roughness:0.35});
    const needleMat=new THREE.MeshStandardMaterial({color:0xC0C8D0,metalness:0.85,roughness:0.15});
    const ringThick=(D-d)*0.2;
    const t=Math.min(1.5,(D-d)*0.15);
    const oR=D/2, iR=d/2;
    const innerTrackR=iR+ringThick;
    const pitchR=(innerTrackR+oR-ringThick)/2;
    const needleD=Math.min((D-d)*0.08,(B)*0.12);
    const needleL=B*0.75;
    // 외륜
    const oGeo=new THREE.CylinderGeometry(oR,oR,B,48,1,false);
    modelGroup.add(new THREE.Mesh(oGeo,steelMat.clone()));
    // 내륜 (솔리드형)
    const inGeo=new THREE.CylinderGeometry(innerTrackR,innerTrackR,B,48,1,false);
    modelGroup.add(new THREE.Mesh(inGeo,innerMat.clone()));
    // 니들 롤러
    const Z=Math.max(12,Math.floor(2*Math.PI*pitchR/(needleD*1.3)));
    for(let i=0;i<Z;i++){
        const a=i*Math.PI*2/Z;
        const nm=new THREE.Mesh(new THREE.CylinderGeometry(needleD/2,needleD/2,needleL,8),needleMat.clone());
        nm.position.set(Math.cos(a)*pitchR,0,Math.sin(a)*pitchR);
        modelGroup.add(nm);
    }
    if(options.dimensions) buildNRBRDimOnly(dims);
}
function buildNRBRDimOnly(dims){
    // ★ 표준 베어링 치수 매핑
    const d=dims.d1 || dims.D1 || 20;    // 안지름
    const D=dims.D2 || dims.D || 32;     // 바깥지름
    const B=dims.B || 20;                // 폭
    addHorizontalDim(-d/2,d/2,0,-D/2-10,'d',d);
    addHorizontalDim(-D/2,D/2,D/2+5,D/2+10,'D',D);
    addVerticalDim(D/2+12,-B/2,B/2,'B',B);
}

// ──────────────────────────────────────────────
// 복열 트러스트 볼베어링 (DTHB)
// ──────────────────────────────────────────────
function buildDTHB(dims) {
    const d=dims.d1||dims.d||20, D=dims.D2||dims.D||52, B=dims.B||22;
    const steelMat=new THREE.MeshStandardMaterial({color:0x8A9098,metalness:0.7,roughness:0.3});
    const ballMat=new THREE.MeshStandardMaterial({color:0xC0C8D0,metalness:0.8,roughness:0.2});
    const halfB=B/2;
    // 상/하 시트 3개
    for(const pos of[-halfB,0,halfB]){
        const sg=new THREE.CylinderGeometry(D/2,D/2,B*0.18,48,1,false);
        const sm=new THREE.Mesh(sg,steelMat.clone());
        sm.position.y=pos; modelGroup.add(sm);
    }
    // 볼 두 열
    const pitchR=(d+D)/4, ballR=(D-d)*0.12;
    const Z=Math.max(7,Math.floor(Math.PI*pitchR/ballR/1.3));
    for(const sy of[-1,1]){
        for(let i=0;i<Z;i++){
            const a=i*Math.PI*2/Z;
            const bm=new THREE.Mesh(new THREE.SphereGeometry(ballR,10,8),ballMat.clone());
            bm.position.set(Math.cos(a)*pitchR,sy*B*0.25,Math.sin(a)*pitchR);
            modelGroup.add(bm);
        }
    }
    if(options.dimensions) buildTHRBDimOnly(dims);
}

// ──────────────────────────────────────────────
// 트러스트 앵귤러 볼베어링 (DTAB/HTAB/TANB/DTAG)
// C++ CreateThrustRollerBearing 앵귤러 변형
// ──────────────────────────────────────────────
function buildDTAB(dims) {
    const d=dims.d1||dims.d||30, D=dims.D2||dims.D||62, B=dims.B||20;
    const steelMat=new THREE.MeshStandardMaterial({color:0x8A9098,metalness:0.7,roughness:0.3});
    const ballMat=new THREE.MeshStandardMaterial({color:0xC0C8D0,metalness:0.8,roughness:0.2});
    const angle=40*Math.PI/180; // 40° 접촉각
    const pitchR=(d+D)/4, ballR=(D-d)*0.13;
    // 시트 링 (비스듬한 원뿔형)
    const oGeo=new THREE.CylinderGeometry(D/2,D/2*0.92,B,48,1,false);
    modelGroup.add(new THREE.Mesh(oGeo,steelMat.clone()));
    const iGeo=new THREE.CylinderGeometry(d/2*1.08,d/2,B*0.7,48,1,false);
    modelGroup.add(new THREE.Mesh(iGeo,steelMat.clone()));
    // 볼
    const Z=Math.max(8,Math.floor(2*Math.PI*pitchR/(ballR*2*1.3)));
    for(let i=0;i<Z;i++){
        const a=i*Math.PI*2/Z;
        const bm=new THREE.Mesh(new THREE.SphereGeometry(ballR,10,8),ballMat.clone());
        bm.position.set(Math.cos(a)*pitchR,0,Math.sin(a)*pitchR);
        modelGroup.add(bm);
    }
    if(options.dimensions) buildTHRBDimOnly(dims);
}

// ──────────────────────────────────────────────
// 트러스트 원통 롤러 베어링 (THCR)
// ──────────────────────────────────────────────
function buildTHCR(dims) {
    const d=dims.d1||dims.d||30, D=dims.D2||dims.D||70, B=dims.B||18;
    const steelMat=new THREE.MeshStandardMaterial({color:0x8A9098,metalness:0.7,roughness:0.3});
    const rollerMat=new THREE.MeshStandardMaterial({color:0xB8C0C8,metalness:0.75,roughness:0.25});
    const halfB=B/2;
    // 상하 링 (스러스트 시트)
    for(const sy of[-1,1]){
        const sg=new THREE.CylinderGeometry(D/2,D/2,B*0.2,48,1,false);
        const sm=new THREE.Mesh(sg,steelMat.clone());
        sm.position.y=sy*halfB*0.82; modelGroup.add(sm);
    }
    // 원통 롤러 (방사형 배치, Y축 수직)
    const pitchR=(d+D)/4, rollerR=(D-d)*0.09, rollerL=(D-d)*0.38;
    const Z=Math.max(10,Math.floor(2*Math.PI*pitchR/(rollerR*2.5)));
    for(let i=0;i<Z;i++){
        const a=i*Math.PI*2/Z;
        const rm=new THREE.Mesh(new THREE.CylinderGeometry(rollerR,rollerR,rollerL,10),rollerMat.clone());
        rm.rotation.z=Math.PI/2; // 수평 눕힘
        rm.rotation.y=a;
        rm.position.set(Math.cos(a)*pitchR,0,Math.sin(a)*pitchR);
        modelGroup.add(rm);
    }
    if(options.dimensions) buildTHRBDimOnly(dims);
}

// ──────────────────────────────────────────────
// 트러스트 자동조심 롤러 베어링 (THSR)
// ──────────────────────────────────────────────
function buildTHSR(dims) {
    const d=dims.d1||dims.d||40, D=dims.D2||dims.D||90, B=dims.B||25;
    const steelMat=new THREE.MeshStandardMaterial({color:0x8A9098,metalness:0.7,roughness:0.3});
    const rollerMat=new THREE.MeshStandardMaterial({color:0xB8C0C8,metalness:0.75,roughness:0.25});
    // 구면 하우징 시트
    const seatR=D*0.55;
    const pts=[];
    for(let i=0;i<=32;i++){
        const ang=-Math.PI/4+i*Math.PI/2/32;
        pts.push(new THREE.Vector2(Math.sin(ang)*seatR,Math.cos(ang)*seatR-seatR*0.7));
    }
    const seatGeo=new THREE.LatheGeometry(pts,32);
    modelGroup.add(new THREE.Mesh(seatGeo,steelMat.clone()));
    // 시트링
    const baseGeo=new THREE.CylinderGeometry(D/2,d/2*1.1,B*0.22,48,1,false);
    modelGroup.add(new THREE.Mesh(baseGeo,steelMat.clone()));
    // 원추형 롤러
    const pitchR=(d+D)/4, rollerR=(D-d)*0.1;
    const Z=Math.max(10,Math.floor(2*Math.PI*pitchR/(rollerR*2.5)));
    for(let i=0;i<Z;i++){
        const a=i*Math.PI*2/Z;
        const rm=new THREE.Mesh(new THREE.CylinderGeometry(rollerR,rollerR*0.6,(D-d)*0.35,10),rollerMat.clone());
        rm.rotation.z=Math.PI/2; rm.rotation.y=a;
        rm.position.set(Math.cos(a)*pitchR,0,Math.sin(a)*pitchR);
        modelGroup.add(rm);
    }
    if(options.dimensions) buildTHRBDimOnly(dims);
}

// ──────────────────────────────────────────────
// 트러스트 니들 롤러 베어링 (THNR)
// ──────────────────────────────────────────────
function buildTHNR(dims) {
    const d=dims.d1||dims.d||20, D=dims.D2||dims.D||50, B=dims.B||5;
    const steelMat=new THREE.MeshStandardMaterial({color:0x8A9098,metalness:0.7,roughness:0.3});
    const needleMat=new THREE.MeshStandardMaterial({color:0xC0C8D0,metalness:0.85,roughness:0.15});
    // 상하 판 (와셔형)
    for(const sy of[-1,1]){
        const sg=new THREE.CylinderGeometry(D/2,D/2,B*0.25,48,1,false);
        const sm=new THREE.Mesh(sg,steelMat.clone()); sm.position.y=sy*B*0.37;
        modelGroup.add(sm);
    }
    // 니들 (방사형, 매우 가는 롤러)
    const pitchR=(d+D)/4, needleD=Math.min((D-d)*0.06,1.5), needleL=(D-d)*0.42;
    const Z=Math.max(15,Math.floor(2*Math.PI*pitchR/(needleD*1.4)));
    for(let i=0;i<Z;i++){
        const a=i*Math.PI*2/Z;
        const nm=new THREE.Mesh(new THREE.CylinderGeometry(needleD/2,needleD/2,needleL,6),needleMat.clone());
        nm.rotation.z=Math.PI/2; nm.rotation.y=a;
        nm.position.set(Math.cos(a)*pitchR,0,Math.sin(a)*pitchR);
        modelGroup.add(nm);
    }
    if(options.dimensions) buildTHRBDimOnly(dims);
}

// ──────────────────────────────────────────────
// 트러스트 롤러 베어링 (THRR)
// C++ CreateThrustRollerBearing (Spherical 타입)
// ──────────────────────────────────────────────
function buildTHRR(dims) {
    // 트러스트 자동조심 롤러와 유사
    buildTHSR(dims);
}

// ──────────────────────────────────────────────
// 오일씰 (OSEAL)
// C++ CreateOilSeal 기반
// d1=내경, D2=외경, B=폭
// ──────────────────────────────────────────────
function buildOSEAL(dims) {
    const d=dims.d1||dims.d||25, D=dims.D2||dims.D||40, B=dims.B||8;
    const metalMat=new THREE.MeshStandardMaterial({color:0x707880,metalness:0.5,roughness:0.5});
    const rubberMat=new THREE.MeshStandardMaterial({color:0x1A1A1A,metalness:0,roughness:0.95});
    const springMat=new THREE.MeshStandardMaterial({color:0x808890,metalness:0.8,roughness:0.3});

    const OD=D/2, ID=d/2, H=B;
    const t1=Math.min(1.5,H*0.15), t2=Math.min(1.2,H*0.12);
    const tR=Math.min(1.0,(OD-ID)*0.1);

    // ① 금속 케이스 (외륜)
    const caseGeo=new THREE.CylinderGeometry(OD,OD,H,48,1,false);
    modelGroup.add(new THREE.Mesh(caseGeo,metalMat.clone()));

    // ② 고무 립 바디 (프로파일 회전)
    const lipPts=[];
    const midR=ID+(OD-ID)*0.55;
    lipPts.push(new THREE.Vector2(ID,  H/2));
    lipPts.push(new THREE.Vector2(midR,H/2));
    lipPts.push(new THREE.Vector2(midR,-H/2+t1));
    lipPts.push(new THREE.Vector2(OD-t2,-H/2+t1));
    lipPts.push(new THREE.Vector2(OD-t2,-H/2));
    lipPts.push(new THREE.Vector2(ID,  -H/2));
    lipPts.push(new THREE.Vector2(ID,  H/2));
    const lipGeo=new THREE.LatheGeometry(lipPts,48);
    modelGroup.add(new THREE.Mesh(lipGeo,rubberMat.clone()));

    // ③ 스프링 (고무 립 안쪽)
    const springR=ID+(OD-ID)*0.3;
    const springTorus=new THREE.TorusGeometry(springR,Math.min(0.8,(OD-ID)*0.05),6,32);
    springTorus.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI/2));
    modelGroup.add(new THREE.Mesh(springTorus,springMat.clone()));

    if(options.dimensions) buildOSEALDimOnly(dims);
}
function buildOSEALDimOnly(dims){
    const d=dims.d1||25,D=dims.D2||40,B=dims.B||8;
    addHorizontalDim(-d/2,d/2,0,-D/2-8,'d',d);
    addHorizontalDim(-D/2,D/2,D/2+5,D/2+8,'D',D);
    addVerticalDim(D/2+10,-B/2,B/2,'B',B);
}

// ──────────────────────────────────────────────
// UK 베어링 (UKBB) — UC + 테이퍼 보어 어댑터
// C++ CreateUKBearing 기반
// ──────────────────────────────────────────────
function buildUKBB(dims) {
    buildUNIT(dims);  // UC 인서트 베어링과 동일 형상
    // 어댑터 슬리브 추가 (안쪽 테이퍼)
    // ★ 표준 베어링 치수 매핑  
    const d=dims.d1 || dims.D1 || dims.d || 20;   // 안지름
    const B=dims.B || dims.C || 14;               // 폭
    const sleeveR=d/2*0.9, sleeveL=B*1.15;
    const sleeveMat=new THREE.MeshStandardMaterial({color:0x707070,metalness:0.5,roughness:0.5});
    const sleeveGeo=new THREE.CylinderGeometry(sleeveR,sleeveR*0.88,sleeveL,32,1,false);
    modelGroup.add(new THREE.Mesh(sleeveGeo,sleeveMat));
}

// ──────────────────────────────────────────────
// UCFC — 소켓 붙이 둥근 플랜지형 (원형 플랜지)
// C++ CreateRoundFlangeHousing 기반
// ──────────────────────────────────────────────
function buildFCBB(dims) {
    // ★ 표준 베어링 치수 매핑
    const d=dims.d1 || dims.D1 || dims.d || 20;   // 안지름 
    const D=dims.D2 || dims.D || 47;              // 바깥지름
    const FD=dims.FD||D*2.3;
    const B=dims.B||14, H3=dims.H3||FD*0.55;
    const steelMat=new THREE.MeshStandardMaterial({color:0x8A9098,metalness:0.3,roughness:0.65});
    // 원형 플랜지 바디
    const flangeGeo=new THREE.CylinderGeometry(FD/2,FD/2,B*0.4,48,1,false);
    const flange=new THREE.Mesh(flangeGeo,steelMat.clone());
    flange.position.y=-B*0.3; modelGroup.add(flange);
    // 하우징 구면 바디 (UNIT 유사)
    buildUNIT(dims);
    if(options.dimensions) buildFLBUDimOnly(dims);
}

// ──────────────────────────────────────────────
// UCFL — 마름모꼴 플랜지형
// C++ CreateRhombusFlangeHousing 기반
// ──────────────────────────────────────────────
function buildFLBB(dims) {
    // ★ 표준 베어링 치수 매핑
    const d=dims.d1 || dims.D1 || dims.d || 20;   // 안지름
    const D=dims.D2 || dims.D || 47;              // 바깥지름
    const FD=dims.FD||D*2.0, B=dims.B||14, J=dims.J||FD*0.75;
    const steelMat=new THREE.MeshStandardMaterial({color:0x8A9098,metalness:0.3,roughness:0.65});
    const boltMat=new THREE.MeshStandardMaterial({color:0x505860,metalness:0.6,roughness:0.4});
    // 마름모 플랜지 (두 개의 타원형 날개)
    const wingW=FD*0.35, wingH=B*0.35, wingDist=J/2;
    for(const sx of[-1,1]){
        const wingGeo=new THREE.SphereGeometry(wingW*0.5,12,8);
        wingGeo.scale(1,0.35,1);
        const wing=new THREE.Mesh(wingGeo,steelMat.clone());
        wing.position.set(sx*wingDist,-B*0.32,0); modelGroup.add(wing);
        // 볼트홀
        const boltGeo=new THREE.CylinderGeometry(d*0.18,d*0.18,wingH*1.2,12,1,false);
        const bm=new THREE.Mesh(boltGeo,boltMat.clone());
        bm.position.set(sx*wingDist,-B*0.32,0); modelGroup.add(bm);
    }
    buildUNIT(dims);
    if(options.dimensions) buildFLBUDimOnly(dims);
}

// ──────────────────────────────────────────────
// UCFS — 소켓 붙이 각 플랜지형
// C++ CreateAdjustableFlangeHousing / CreateSquareFlangeHousing 기반
// ──────────────────────────────────────────────
function buildFSBB(dims) {
    // ★ 표준 베어링 치수 매핑  
    const d=dims.d1 || dims.D1 || dims.d || 20;   // 안지름
    const D=dims.D2 || dims.D || 47;              // 바깥지름
    const FD=dims.FD||D*2.0, B=dims.B||14, J=dims.J||FD*0.70;
    const steelMat=new THREE.MeshStandardMaterial({color:0x8A9098,metalness:0.3,roughness:0.65});
    // 사각 플랜지 플레이트
    const plateGeo=new THREE.BoxGeometry(FD,B*0.35,FD);
    const plate=new THREE.Mesh(plateGeo,steelMat.clone());
    plate.position.y=-B*0.35; modelGroup.add(plate);
    // 볼트홀 4개 (코너)
    const boltMat=new THREE.MeshStandardMaterial({color:0x050810,metalness:0,roughness:1});
    for(const sx of[-1,1]) for(const sz of[-1,1]){
        const bGeo=new THREE.CylinderGeometry(d*0.15,d*0.15,B*0.4,12,1,false);
        const bm=new THREE.Mesh(bGeo,boltMat.clone());
        bm.rotation.x=Math.PI/2; bm.position.set(sx*J/2,-B*0.35,sz*J/2);
        modelGroup.add(bm);
    }
    buildUNIT(dims);
    if(options.dimensions) buildFLBUDimOnly(dims);
}

// ──────────────────────────────────────────────
// UCT — 테이크업 하우징 (Take-Up)
// C++ CreateTakeUpHousing 기반
// ──────────────────────────────────────────────
function buildUCTU(dims) {
    const d=dims.d1||dims.d||20, D=dims.D2||dims.D||47;
    const B=dims.B||14, L=dims.L||D*3.5, H=dims.H||D*1.8;
    const steelMat=new THREE.MeshStandardMaterial({color:0x8A9098,metalness:0.3,roughness:0.65});
    // 직사각형 프레임
    const frameGeo=new THREE.BoxGeometry(H*1.2,B*0.4,L);
    const frame=new THREE.Mesh(frameGeo,steelMat.clone());
    frame.position.y=-H*0.55; modelGroup.add(frame);
    // 슬롯 (조정용 장공)
    const slotMat=new THREE.MeshStandardMaterial({color:0x050810,metalness:0,roughness:1});
    const slotGeo=new THREE.BoxGeometry(H*0.6,B*0.5,d*0.8);
    for(const sx of[-1,1]){
        const sm=new THREE.Mesh(slotGeo,slotMat.clone());
        sm.position.set(sx*H*0.3,-H*0.55,L*0.35); modelGroup.add(sm);
    }
    buildUNIT(dims);
    if(options.dimensions) buildPILBDimOnly(dims);
}

// ──────────────────────────────────────────────
// UCC — 카트리지 하우징 (Cartridge)
// C++ CreateCartridgeHousing / CreateCartridgeCoverHousing 기반
// ──────────────────────────────────────────────
function buildUCCA(dims) {
    const d=dims.d1||dims.d||20, D=dims.D2||dims.D||47, B=dims.B||14;
    const OD=dims.OD||D*1.6;
    const steelMat=new THREE.MeshStandardMaterial({color:0x8A9098,metalness:0.3,roughness:0.65});
    // 원통형 카트리지 바디
    const bodyGeo=new THREE.CylinderGeometry(OD/2,OD/2,B*1.3,48,1,false);
    modelGroup.add(new THREE.Mesh(bodyGeo,steelMat.clone()));
    // 플랜지 커버
    const coverGeo=new THREE.CylinderGeometry(OD/2*1.15,OD/2*1.15,B*0.2,48,1,false);
    const cover=new THREE.Mesh(coverGeo,steelMat.clone());
    cover.position.y=B*0.75; modelGroup.add(cover);
    // 내부 베어링 (UC)
    buildUNIT(dims);
    if(options.dimensions) buildPILBDimOnly(dims);
}


// ─────────────────────────────────────────────
// 오일리스 베어링 / 부시 계열 (SWUR*/DRY*/LUBO*)
// 원통형 부시로 표현 (내경+외경+길이)
// ─────────────────────────────────────────────
function buildOilless(dims) {
    const d  = dims.d1 || dims.d  || dims.D1 || 20;   // 내경
    const D  = dims.D2 || dims.D  || d * 1.5;         // 외경
    const B  = dims.B  || dims.L  || d * 1.2;         // 길이(폭)
    const r  = dims.r  || 0.5;

    const bushMat = new THREE.MeshStandardMaterial({
        color: 0x8B9E6A,   // 청동/오일리스 특유의 황녹색
        metalness: 0.35, roughness: 0.60
    });
    const innerMat = new THREE.MeshStandardMaterial({
        color: 0x6A7A50, metalness: 0.3, roughness: 0.7
    });

    // 외경 원통
    const oGeo = new THREE.CylinderGeometry(D/2, D/2, B, 48, 1, false);
    modelGroup.add(new THREE.Mesh(oGeo, bushMat.clone()));

    // 보어 (내경 어두운 면)
    const iGeo = new THREE.CylinderGeometry(d/2, d/2, B * 1.02, 48, 1, true);
    modelGroup.add(new THREE.Mesh(iGeo, innerMat.clone()));

    // 끝단 링
    for (const sy of [-1, 1]) {
        const rGeo = new THREE.RingGeometry(d/2, D/2, 32);
        rGeo.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
        const rm = new THREE.Mesh(rGeo, new THREE.MeshStandardMaterial({
            color: 0x8B9E6A, metalness: 0.35, roughness: 0.6, side: THREE.DoubleSide
        }));
        rm.position.y = sy * B / 2;
        modelGroup.add(rm);
    }

    // 플랜지형이면 플랜지 추가 (FLANGE 계열)
    if (dims.FD || dims.D3) {
        const FD = dims.FD || dims.D3 || D * 1.4;
        const FH = dims.FH || B * 0.2;
        const flGeo = new THREE.CylinderGeometry(FD/2, FD/2, FH, 48, 1, false);
        const fl = new THREE.Mesh(flGeo, bushMat.clone());
        fl.position.y = B / 2 + FH / 2;
        modelGroup.add(fl);
    }

    if (options.dimensions) buildOillessDimOnly(dims);
}

function buildOillessDimOnly(dims) {
    const d = dims.d1 || dims.d || 20;
    const D = dims.D2 || dims.D || d * 1.5;
    const B = dims.B  || dims.L || d * 1.2;
    addHorizontalDim(-d/2, d/2, 0, -D/2-10, 'd', d);
    addHorizontalDim(-D/2, D/2, D/2+5, D/2+10, 'D', D);
    addVerticalDim(D/2+12, -B/2, B/2, 'B', B);
}

function setWireframe(en) {
    modelGroup.traverse(ch => { if (ch.isMesh && ch.material) ch.material.wireframe = en; });
}

function fitCameraToModel() {
    if (modelGroup.children.length === 0) return;
    const box = new THREE.Box3().setFromObject(modelGroup);
    // ★ 연결부품(축 등)도 바운딩박스에 포함
    if (linkedGroup && linkedGroup.children.length > 0) {
        box.expandByObject(linkedGroup);
    }
    // ★ 치수선 그룹도 바운딩박스에 포함 (치수가 표시되면 그것까지 화면에 보이도록 줌 레벨 조정)
    //   포함 안 하면 카메라는 모델만 기준으로 피팅하고, 치수선은 카메라 시야 밖으로 나가
    //   사용자가 수동으로 줌아웃해야 치수가 보이는 현상 발생.
    //   포함하면 초기부터 모델+치수 전체가 화면에 들어옴.
    //   단, dimGroup 이 비어있거나 visible=false 면 영향 없음.
    if (dimGroup && dimGroup.visible && dimGroup.children.length > 0) {
        box.expandByObject(dimGroup);
    }
    const ctr = box.getCenter(new THREE.Vector3());
    const sz  = box.getSize(new THREE.Vector3());
    const mx  = Math.max(sz.x, sz.y, sz.z);
    controls.target.copy(ctr);
    // 카메라 거리 배수 조정: 기존 1.8 → 1.4 (dimGroup 포함으로 바운딩박스가 커졌으므로 배수를 줄여 시각적 크기 유지)
    camera.position.set(ctr.x + mx * 1.4, ctr.y + mx * 1.2, ctr.z + mx * 0.8);
    controls.update();
}

// ═══════════════════════════════════════════════
// 치수선 시스템 (CSS2DRenderer)
// ═══════════════════════════════════════════════

// ═══════════════════════════════════════════════
// 공용 Y축 기반 치수 헬퍼
// ─────────────────────────────────────────────
// 기존 addVerticalDim / addHorizontalDim 은
//   XZ 평면(Y=0) 고정 — 볼트/너트/와셔/베어링 등에 사용
//
// 아래 두 함수는 Y축을 길이 방향으로 사용하는
// 원통형·박스형 부품(모터, 실린더, LM가이드 등)에 공용으로 적용
//
// 사용 예)
//   addLengthDimY(xOff, yStart, yEnd, 'L', 100)   // Y축 방향 길이
//   addWidthDimXY(xL, xR, yPos, zOff, 'D', 40)    // X축 방향 폭/직경
// ═══════════════════════════════════════════════

/**
 * Y축 방향 길이 치수 (XY 평면)
 * @param {number} xOff    - 치수선 X 위치 (모델 옆, 양수=오른쪽, 음수=왼쪽)
 * @param {number} yStart  - 치수 시작 Y 좌표
 * @param {number} yEnd    - 치수 끝   Y 좌표
 * @param {string} name    - 치수 이름 (예: 'L', 'LX', 'LR')
 * @param {number} val     - 실제 치수값 (mm)
 * 사용: 모터 전체 길이, 실린더 행정거리, 축 돌출 길이 등
 */
function addLengthDimY(xOff, yStart, yEnd, name, val) {
    if (Math.abs(yEnd - yStart) < 0.01) return;
    const eL = 4;
    const pts = [new THREE.Vector3(xOff, yStart, 0), new THREE.Vector3(xOff, yEnd, 0)];
    dimGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), dimLineMaterial.clone()));
    dimGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(xOff - eL, yStart, 0), new THREE.Vector3(xOff + eL, yStart, 0)
    ]), dimExtLineMaterial.clone()));
    dimGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(xOff - eL, yEnd,   0), new THREE.Vector3(xOff + eL, yEnd,   0)
    ]), dimExtLineMaterial.clone()));
    addArrow3D(new THREE.Vector3(xOff, yStart, 0), new THREE.Vector3(0,  1, 0), 2);
    addArrow3D(new THREE.Vector3(xOff, yEnd,   0), new THREE.Vector3(0, -1, 0), 2);
    addDimLabel(xOff - 5, (yStart + yEnd) / 2, 0, name, val);
}

/**
 * X축 방향 폭/직경 치수 (XY 평면)
 * @param {number} xL    - 치수 왼쪽 X 좌표
 * @param {number} xR    - 치수 오른쪽 X 좌표
 * @param {number} yPos  - 치수선 Y 위치 (길이 방향 위치)
 * @param {number} zOff  - 라벨 Z 오프셋 (앞/뒤로 밀기, 겹침 방지)
 * @param {string} name  - 치수 이름 (예: 'D', 'LC', 'LB', 'PCD')
 * @param {number} val   - 실제 치수값 (mm)
 * 사용: 모터 프레임폭/플랜지직경, 실린더 내외경, 샤프트 직경 등
 */
function addWidthDimXY(xL, xR, yPos, zOff, name, val) {
    if (Math.abs(xR - xL) < 0.01) return;
    const eL = 3;
    const pts = [new THREE.Vector3(xL, yPos, zOff), new THREE.Vector3(xR, yPos, zOff)];
    dimGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), dimLineMaterial.clone()));
    dimGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(xL, yPos - eL, zOff), new THREE.Vector3(xL, yPos + eL, zOff)
    ]), dimExtLineMaterial.clone()));
    dimGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(xR, yPos - eL, zOff), new THREE.Vector3(xR, yPos + eL, zOff)
    ]), dimExtLineMaterial.clone()));
    addArrow3D(new THREE.Vector3(xL, yPos, zOff), new THREE.Vector3( 1, 0, 0), 2);
    addArrow3D(new THREE.Vector3(xR, yPos, zOff), new THREE.Vector3(-1, 0, 0), 2);
    addDimLabel((xL + xR) / 2, yPos, zOff + 3, name, val);
}

// 하위 호환 별칭 (기존 모터 코드가 이 이름을 사용하는 경우 대비)
const addMotorLengthDim = addLengthDimY;
const addMotorWidthDim  = addWidthDimXY;

function addVerticalDim(x, zBot, zTop, name, val) {
    const pts = [new THREE.Vector3(x, 0, zBot), new THREE.Vector3(x, 0, zTop)];
    dimGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), dimLineMaterial.clone()));
    const eL = 6;
    dimGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(x - eL, 0, zBot), new THREE.Vector3(x + eL, 0, zBot)
    ]), dimExtLineMaterial.clone()));
    dimGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(x - eL, 0, zTop), new THREE.Vector3(x + eL, 0, zTop)
    ]), dimExtLineMaterial.clone()));
    addArrow3D(new THREE.Vector3(x, 0, zBot), new THREE.Vector3(0, 0, 1), 2);
    addArrow3D(new THREE.Vector3(x, 0, zTop), new THREE.Vector3(0, 0, -1), 2);
    addDimLabel(x - 3, 0, (zBot + zTop) / 2, name, val);
}

function addHorizontalDim(xL, xR, z, offX, name, val) {
    const pts = [new THREE.Vector3(xL, 0, z), new THREE.Vector3(xR, 0, z)];
    dimGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), dimLineMaterial.clone()));
    const eL = 4;
    dimGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(xL, 0, z - eL), new THREE.Vector3(xL, 0, z + eL)
    ]), dimExtLineMaterial.clone()));
    dimGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(xR, 0, z - eL), new THREE.Vector3(xR, 0, z + eL)
    ]), dimExtLineMaterial.clone()));
    addArrow3D(new THREE.Vector3(xL, 0, z), new THREE.Vector3(1, 0, 0), 2);
    addArrow3D(new THREE.Vector3(xR, 0, z), new THREE.Vector3(-1, 0, 0), 2);
    addDimLabel((xL + xR) / 2, 0, z + 2, name, val);
}

function addArrow3D(o, d, l) {
    dimGroup.add(new THREE.ArrowHelper(d, o, l, 0xFFC832, l * 0.6, l * 0.4));
}

// ═══════════════════════════════════════════════
// ★ 표시용 실제 DB 변수명 복원
//   JS 렌더러 내부에서는 편의상 축약형(d, D, L, K)을 쓰지만,
//   화면(3D 라벨 + 패널)에는 DB의 실제 변수명(d1, D1, L1)을 표시해야
//   추후 DB 문서 검수 시 혼동이 없음.
//   currentDimMeta에 실제 DB 변수명이 키로 저장되어 있으므로 이를 근거로 복원.
// ═══════════════════════════════════════════════

/**
 * 단순화된 축약형(d, D 등)을 currentDimMeta 의 실제 DB 변수명으로 복원.
 * 복합 치수(L+K)는 각 항을 재귀 복원 후 연산자로 재조합.
 * 매칭 실패 시 원본을 그대로 반환 (안전한 fallback).
 *
 * 예시 (DB에 d1, D1, L, K, B 가 있을 때):
 *   'd'    → 'd1'
 *   'D'    → 'D1'
 *   'B'    → 'B'     (직접 매칭)
 *   'L+K'  → 'L+K'   (L과 K 모두 DB에 있으므로 복합명 그대로)
 *   'd+B'  → 'd1+B'  (d는 d1로, B는 그대로)
 *   'Xyz'  → 'Xyz'   (매칭 없음 → 원본 유지)
 */
/**
 * 단순화된 축약형(d, D, K, S 등)을 currentDimMeta 의 실제 DB 변수명으로 복원.
 *
 * 매칭 전략 (우선순위 순):
 *   (1) 직접 매칭 — currentDimMeta[name] 존재
 *   (2) 대문자 매칭 — currentDimMeta[name.toUpperCase()] 존재
 *   (3) ★ 값 기반 별칭 매칭 — currentDimensions 를 순회하며 동일 값을 가진 다른 키 중
 *       currentDimMeta 에도 존재하는 것을 찾음.
 *       예) C# 이 { K:13, k:13, H:13 } 을 함께 전송하고 dimMeta 에는 H 만 있을 때
 *           addDimLabel('K', 13) → H 로 복원됨 → 3D 라벨 "H=13.0"
 *       여러 후보가 있으면 다음 기준으로 우선순위 결정:
 *         a. 괄호/부등호 등 특수문자 포함 = 더 구체적 (B1(일반), P1(UNC) 등)
 *         b. 원본 name 과 동일
 *         c. 더 긴 이름 = 더 구체적
 *   (4) 숫자 접미사 fallback — d → d1, L → L1 ...
 *   (5) 복합 치수 (L+K 등) — 각 항을 재귀 복원 후 재조합
 *   (6) 매칭 실패 → 원본 그대로 (부품에 DB 매핑 없는 경우 대비)
 *
 * @param {string} name  렌더러가 사용한 축약형 변수명 (예: 'K', 'S', 'L+K')
 * @param {number} value 렌더링 중인 치수값 (값 기반 별칭 매칭에 사용)
 */
function resolveActualDbKey(name, value) {
    if (!name) return name;

    // (5) 복합 치수 — 연산자 기준 분해 후 각 항 재귀 복원
    if (/[+\-*/]/.test(name)) {
        let cleaned = name.trim();
        const wrapped = cleaned.startsWith('(') && cleaned.endsWith(')');
        if (wrapped) cleaned = cleaned.substring(1, cleaned.length - 1);

        const tokens = cleaned.split(/([+\-*/])/);
        const resolvedTokens = tokens.map(t => {
            const trimmed = t.trim();
            if (trimmed === '' || /^[+\-*/]$/.test(trimmed)) return trimmed;
            // 복합의 각 항은 개별 값을 currentDimensions에서 조회해서 전달
            const partValue = (currentDimensions && typeof currentDimensions[trimmed] === 'number')
                ? currentDimensions[trimmed]
                : undefined;
            return resolveActualDbKey(trimmed, partValue);
        });
        const combined = resolvedTokens.join('');
        return wrapped ? '(' + combined + ')' : combined;
    }

    // 단일 치수 — 후보 수집
    const candidates = new Set();
    const upper = name.toUpperCase();

    // (1)(2) 직접/대문자 매칭
    if (currentDimMeta[name]) candidates.add(name);
    if (upper !== name && currentDimMeta[upper]) candidates.add(upper);

    // (3) 값 기반 별칭 매칭
    //     currentDimensions 순회 → 값이 일치하며 currentDimMeta 에 존재하는 키 수집
    //     부동소수 비교 허용오차 1e-6 (치수는 mm 단위, 0.001 차이는 같은 값으로 간주)
    if (typeof value === 'number' && !isNaN(value) && currentDimensions) {
        for (const key of Object.keys(currentDimensions)) {
            const v = currentDimensions[key];
            if (typeof v === 'number' && Math.abs(v - value) < 1e-6 && currentDimMeta[key]) {
                candidates.add(key);
            }
        }
    }

    if (candidates.size > 0) {
        // 우선순위 정렬
        const sorted = [...candidates].sort((a, b) => {
            // a. 특수문자 (괄호·부등호 등) 포함 시 우선 — 더 구체적인 이름
            const aSpec = /[()<>=]/.test(a);
            const bSpec = /[()<>=]/.test(b);
            if (aSpec !== bSpec) return aSpec ? -1 : 1;
            // b. 원본 name 과 정확히 일치하면 우선
            if (a === name && b !== name) return -1;
            if (b === name && a !== name) return 1;
            // c. 원본의 대문자 버전이면 차순위
            if (a === upper && b !== upper) return -1;
            if (b === upper && a !== upper) return 1;
            // d. 더 긴 이름이 더 구체적
            if (a.length !== b.length) return b.length - a.length;
            // e. 알파벳 순 (안정성)
            return a.localeCompare(b);
        });
        return sorted[0];
    }

    // (4) 숫자 접미사 fallback — 값 기반 매칭도 실패했을 때의 최후 안전망
    for (let i = 1; i <= 9; i++) {
        if (currentDimMeta[name + i]) return name + i;
        if (upper !== name && currentDimMeta[upper + i]) return upper + i;
    }

    // (6) 모든 fallback 실패 → 원본 그대로
    return name;
}

function addDimLabel(x, y, z, name, val) {
    // ★ 표시용 DB 변수명으로 복원 (내부 name 은 'K'지만 DB 는 'H' 인 경우 등)
    //   값 기반 별칭 매칭을 위해 val 도 전달
    //   이 이름이 3D 라벨 + 치수 참조 패널 모두에 사용되어 DB와 일관성 유지
    const displayName = resolveActualDbKey(name, val);

    // ★ 렌더링된 치수 수집 (치수 참조 패널용) — 복원된 DB 변수명으로 저장
    //   동일 name 중복 시에도 모두 추가 (여러 위치에 같은 치수가 표시될 수 있음)
    //   updateDimPanel() 에서 중복 제거 후 표시
    renderedDimensions.push({ name: displayName, value: val });

    const div = document.createElement('div');
    div.className = 'dim-label';
    // ★ 굵고 진한 텍스트 스타일 적용
    div.style.fontWeight = 'bold';
    div.style.fontSize = '14px';
    div.style.color = '#1F2937';
    div.style.textShadow = '0 0 3px rgba(255,255,255,0.8)';
    div.style.fontFamily = 'Arial, sans-serif';
    div.innerHTML = '<span class="dim-label-name">' + displayName + '=</span><span class="dim-label-value">' + val.toFixed(1) + '</span>';
    const lbl = new CSS2DObject(div);
    lbl.position.set(x, y, z);
    dimGroup.add(lbl);
}

// ═══════════════════════════════════════════════
// ★ 치수 참조 패널 (약어 ↔ 전체명) — 렌더링된 치수만 표시
// ═══════════════════════════════════════════════

/**
 * 치수명 약어 정규화 — 패널/매핑 조회 시 키 통일용
 *   예) "Ø4.0" → "Ø4.0" (그대로)
 *       "PCD(LA)" → "PCD" (괄호 이후 제거) — 단, 매핑에 원본 키가 있으면 우선 사용
 */
function normalizeDimName(name) {
    if (!name) return '';
    return String(name).trim();
}

/**
 * 전체 치수명(표시명) 조회 — DB 변수명 → 전체 한글명
 *
 * ★ 이 함수는 renderedDimensions 에 저장된 "이미 복원된 DB 변수명"을
 *   전체 한글 치수명으로 변환하는 역할만 담당합니다.
 *   변수명 복원(축약형 → DB 변수명)은 addDimLabel의 resolveActualDbKey 가 먼저 처리.
 *
 * 단계별 동작:
 *   1) currentDimMeta 직접 매칭 (정상 경로) — 대부분 이 단계에서 해결
 *   2) 대문자 매칭 (case sensitivity 차이 대비)
 *   3) 괄호 이후 잘라낸 버전 (예: "PCD(LA)" → "PCD")
 *   4) 숫자 접미사 fallback — resolveActualDbKey 가 실패했을 때를 위한
 *       2차 안전망 (addDimLabel 단계에서 DB 매핑이 아예 없어 복원 못한 경우)
 *   5) 복합 치수 처리 — addDimLabel 의 resolveActualDbKey 가 이미 각 항을
 *       DB 변수명으로 복원했으므로, 여기서는 각 항의 전체 한글명으로 재조합
 *       예: "(L+K)" → "(나사부 길이 + 머리 높이)"
 *   6) 없으면 약어 자체 반환 (패널에서 "—" 로 표시)
 */
function resolveDimDisplayName(abbr) {
    if (!abbr) return '';

    // 1. 정확한 매칭
    if (currentDimMeta[abbr]) return currentDimMeta[abbr];

    // 2. 대문자 매칭
    const uK = abbr.toUpperCase();
    if (currentDimMeta[uK]) return currentDimMeta[uK];

    // 3. 괄호 제거 후 재시도 (예: "PCD(LA)" → "PCD")
    const idxParen = abbr.indexOf('(');
    if (idxParen > 0) {
        const head = abbr.substring(0, idxParen).trim();
        if (currentDimMeta[head]) return currentDimMeta[head];
        const headU = head.toUpperCase();
        if (currentDimMeta[headU]) return currentDimMeta[headU];
    }

    // 4. 숫자 접미사 fallback (2차 안전망 — resolveActualDbKey 가 놓친 경우)
    for (let i = 1; i <= 9; i++) {
        const trySfx = abbr + i;
        if (currentDimMeta[trySfx]) return currentDimMeta[trySfx];
        const trySfxU = uK + i;
        if (currentDimMeta[trySfxU]) return currentDimMeta[trySfxU];
    }

    // 5. 복합 치수명 처리 — 연산자 기준 분리 후 각 항을 전체 한글명으로 조합
    //    예: "L+K" → "(나사부 길이 + 머리 높이)"
    //        "L1+K" → "(나사부 길이 + 머리 높이)" (resolveActualDbKey 거친 경우)
    if (/[+\-*/]/.test(abbr)) {
        let cleaned = abbr.trim();
        if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
            cleaned = cleaned.substring(1, cleaned.length - 1);
        }
        const tokens = cleaned.split(/([+\-*/])/);
        let anyMapped = false;
        const resolvedTokens = tokens.map(t => {
            const trimmed = t.trim();
            if (trimmed === '') return '';
            if (/^[+\-*/]$/.test(trimmed)) return ' ' + trimmed + ' ';
            const sub = resolveDimDisplayName(trimmed);
            if (sub !== trimmed) anyMapped = true;
            return sub;
        });
        if (anyMapped) return '(' + resolvedTokens.join('').trim() + ')';
    }

    return abbr;  // 매핑 없음 → 약어 그대로 (패널에서 "—" 표시)
}

/**
 * C# 에서 전달된 dimMeta payload 적용.
 *
 * 특수 키(__panel_title, __panel_empty, __panel_no_mapping, __panel_count_unit)는
 * 패널 UI 텍스트(번역됨)이므로 currentPanelText 에 저장하고 currentDimMeta 에는 넣지 않음.
 * 일반 키(L, D1, H 등)만 currentDimMeta 에 등록되어 치수 매핑 조회에 사용.
 */
function applyDimMetaPayload(payload) {
    currentDimMeta = {};
    // 기존 UI 텍스트 유지 (payload 에 특수 키가 없으면 이전 값 유지)
    // C# 이 정상 전송하면 전부 교체됨
    for (const [key, val] of Object.entries(payload)) {
        if (!key) continue;
        const strVal = val == null ? '' : String(val);

        // 특수 키 (패널 UI 텍스트) → currentPanelText 에 저장, 치수 매핑엔 제외
        if (key === '__panel_title')        { currentPanelText.title     = strVal; continue; }
        if (key === '__panel_empty')        { currentPanelText.empty     = strVal; continue; }
        if (key === '__panel_no_mapping')   { currentPanelText.noMapping = strVal; continue; }
        if (key === '__panel_count_unit')   { currentPanelText.countUnit = strVal; continue; }

        // ★ 중요: 자동 대문자 엔트리 생성 금지
        //   과거에 currentDimMeta[key.toUpperCase()] 도 자동 추가했으나, 이로 인해
        //   DB에 없는 키(예: "K")가 "가짜 매핑"으로 등록되어 resolveActualDbKey 의
        //   값 기반 별칭 매칭에서 잘못된 후보(K)가 선택되는 버그 발생.
        //   실제 사례: dimMeta={"H":"육각머리높이/...", "k":"머리높이"} 전달 시,
        //             자동 K 추가 → 렌더러의 'K' 라벨이 H 대신 K(머리높이)로 표시됨.
        //   해결: DB/fallback 원본 키 그대로만 저장. 대소문자 차이는 resolveActualDbKey
        //         단계 (2) 에서 upper 변환으로 별도 처리됨.
        currentDimMeta[key] = strVal;
    }
}

/**
 * 치수 참조 패널 업데이트
 *   - options.dimPanel === false 이면 숨김
 *   - renderedDimensions의 중복 제거 후 표 렌더
 *   - dim-panel-row 호버 시 해당 3D 라벨이 강조됨 (시각적 힌트)
 */
function updateDimPanel() {
    const panel = document.getElementById('dim-panel');
    if (!panel) return;

    if (!options.dimPanel) {
        panel.style.display = 'none';
        return;
    }

    // ★ 다국어: 패널 헤더 타이틀도 현재 언어로 갱신
    const titleEl = panel.querySelector('.dim-panel-title');
    if (titleEl) titleEl.textContent = currentPanelText.title;

    // 중복 제거 — 같은 name이 여러 번 푸시된 경우 첫 값 유지
    const seen = new Set();
    const unique = [];
    for (const d of renderedDimensions) {
        const key = normalizeDimName(d.name);
        if (!key) continue;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push({ name: key, value: d.value });
    }

    const body  = panel.querySelector('.dim-panel-body');
    const count = panel.querySelector('.dim-panel-count');
    if (!body || !count) return;

    // ★ 다국어: "3개" / "3 items" 등 언어별 단위 접미사 적용
    count.textContent = unique.length > 0 ? unique.length + currentPanelText.countUnit : '';

    if (unique.length === 0) {
        // ★ 다국어: "표시된 치수가 없습니다" 번역문 적용
        body.innerHTML = '<div class="dim-panel-empty">' + escapeHtml(currentPanelText.empty) + '</div>';
        panel.style.display = 'block';
        return;
    }

    const rows = unique.map(d => {
        const abbr = d.name;
        const full = resolveDimDisplayName(abbr);
        const hasMapping = (full !== abbr);
        // ★ 다국어: "매핑된 치수명 없음" 번역문 적용 (title 속성)
        const nameHtml = hasMapping
            ? '<span class="dim-panel-name" title="' + escapeHtml(full) + '">' + escapeHtml(full) + '</span>'
            : '<span class="dim-panel-name" style="color:#64748B;font-style:italic" title="' + escapeHtml(currentPanelText.noMapping) + '">—</span>';
        return '<div class="dim-panel-row">' +
            '<span class="dim-panel-abbr">' + escapeHtml(abbr) + '</span>' +
            nameHtml +
            '<span class="dim-panel-value">' + d.value.toFixed(1) + '</span>' +
            '</div>';
    }).join('');

    body.innerHTML = rows;
    panel.style.display = 'block';
}

/** XSS 방지 — 치수명/값 HTML 이스케이프 */
function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** 치수 참조 패널 리셋 — 데이터 보기 탭 전환 등에서 호출 */
function resetDimPanel() {
    options.dimPanel = false;
    const panel = document.getElementById('dim-panel');
    if (panel) {
        panel.style.display = 'none';
        const body = panel.querySelector('.dim-panel-body');
        if (body) body.innerHTML = '';
    }
}

// ═══════════════════════════════════════════════
// C# ↔ JS Communication
// ═══════════════════════════════════════════════

window.onCSharpMessage = function (msg) {
    try {
        logToCSharp('C# msg: ' + msg.command + ', partCode=' + (msg.partCode || ''));
        switch (msg.command) {
            case 'updateModel': {
                const dims = {};
                if (msg.dimensions) {
                    for (const [key, val] of Object.entries(msg.dimensions)) {
                        const uK = key.toUpperCase();
                        const nV = typeof val === 'string' ? parseFloat(val) || 0 : Number(val) || 0;
                        dims[uK] = nV;
                        dims[key] = nV;
                    }
                }
                // ★ 치수 참조 패널용 매핑 수신 (C#에서 GetDimensionDisplayNames 결과 전달)
                //   { field_name → display_name }
                //   null/undefined면 빈 객체로 폴백 → 패널은 약어만 표시
                if (msg.dimMeta && typeof msg.dimMeta === 'object') {
                    applyDimMetaPayload(msg.dimMeta);
                } else {
                    currentDimMeta = {};
                }
                // ★ 연결부품 파싱
                const linked = [];
                if (msg.linkedParts && Array.isArray(msg.linkedParts)) {
                    for (const lp of msg.linkedParts) {
                        const ldims = {};
                        if (lp.dimensions) {
                            for (const [key, val] of Object.entries(lp.dimensions)) {
                                const uK = key.toUpperCase();
                                const nV = typeof val === 'string' ? parseFloat(val) : Number(val);
                                ldims[uK] = isNaN(nV) ? 0 : nV;
                                ldims[key] = isNaN(nV) ? 0 : nV;
                                // ★ 문자열 옵션값 별도 보존 ("단자 생성","어깨 생성" 등)
                                if (typeof val === 'string' && isNaN(parseFloat(val)) && val.trim() !== '') {
                                    ldims['_str_' + key] = val;
                                    ldims['_str_' + uK] = val;
                                }
                            }
                        }
                        linked.push({
                            partCode:      lp.partCode      || '',
                            partType:      lp.partType      || '',
                            partName:      lp.partName      || '',   // ★ 한글 partName 포함
                            dimensions:    ldims,
                            isDrawEnabled: lp.isDrawEnabled !== false,
                            mateOffset:    lp.mateOffset    || 0,
                            mateAlign:     lp.mateAlign     || 'center'
                        });
                    }
                }
                // 모터 치수 로그
                const motorKeys = ['LC','LH','LR','LX','L1(LL)','L2','LB','S','EnH','PCD(LA)'];
                const motorLog = motorKeys.map(k => k+'='+(dims[k]??dims[k.toUpperCase()]??'?')).join(', ');

                // ★ v50: 모터 옵션 수신 (SpecSelectorResponse.Options → JSON)
                //   예: { "hasBrake": "true", "hasGearhead": "false", "bodyType": "Servo", ... }
                //   값은 문자열이지만 JS에서 truthy 판정 가능 ("true"/"false" → 문자열 truthy 는 항상 true 이므로
                //   resolveMotorOpts에서 === 'true' 비교로 정규화됨)
                const motorOpts = msg.options || {};
                const optLog = Object.keys(motorOpts).length > 0
                    ? ' | options={' + Object.entries(motorOpts).map(([k,v]) => k+'='+v).join(',') + '}'
                    : '';

                logToCSharp('3D updateModel: ' + msg.partCode + ' | ' + motorLog +
                            ' | linkedParts=' + linked.length +
                            (linked.length > 0 ? ' [' + linked.map(lp =>
                                lp.partCode + '(' + lp.mateAlign + ',off=' + lp.mateOffset + ',draw=' + lp.isDrawEnabled + ')'
                            ).join(', ') + ']' : '') + optLog);
                updateModel(msg.partCode, dims, linked, motorOpts);
                
                // ★ SD/SN 모델 로드 완료 후 치수 체크박스 껐다켜기 시뮬레이션
                if ((msg.partCode === 'SD' || msg.partCode === 'SN') && options.dimensions) {
                    setTimeout(() => {
                        console.log('SD 치수 체크박스 껐다켜기 시뮬레이션 시작');
                        
                        try {
                            // 1단계: 치수 옵션 OFF (끄기)
                            console.log('SD 1단계: 치수 OFF');
                            options.dimensions = false;
                            applyOptions();
                            
                            // 2단계: 잠시 후 치수 옵션 ON (켜기)
                            setTimeout(() => {
                                console.log('SD 2단계: 치수 ON');
                                try {
                                    options.dimensions = true;
                                    applyOptions();
                                } catch (error) {
                                    console.error('SD 치수 ON 에러:', error.message);
                                    logToCSharp('SD 치수 ON 에러: ' + error.message);
                                }
                            }, 100);
                            
                        } catch (error) {
                            console.error('SD 치수 시뮬레이션 에러:', error.message);
                            logToCSharp('SD 치수 시뮬레이션 에러: ' + error.message);
                        }
                    }, 300);
                }
                break;
            }
            case 'setView':   
                setView(msg.view); 
                
                // ★ SD/SN 뷰 변경시 치수 체크박스 껐다켜기
                if ((currentPartCode === 'SD' || currentPartCode === 'SN') && options.dimensions) {
                    setTimeout(() => {
                        console.log('SD 뷰 변경 후 치수 체크박스 시뮬레이션');
                        
                        // 치수 off → on 시뮬레이션
                        options.dimensions = false;
                        applyOptions();
                        
                        setTimeout(() => {
                            options.dimensions = true;
                            applyOptions();
                        }, 80);
                        
                    }, 200);
                }
                break;
            case 'setOption': 
                options[msg.option] = msg.value; 

                // ★ 치수 참조 패널 토글 → 3D 라벨 재빌드 없이 패널만 갱신 (깜빡임 방지)
                if (msg.option === 'dimPanel') {
                    updateDimPanel();
                } else {
                    applyOptions();
                }
                
                // ★ SD/SN 치수 강제 처리 (최후 해결책)
                if (msg.option === 'dimensions' && msg.value === true && 
                    (currentPartCode === 'SD' || currentPartCode === 'SN')) {
                    
                    console.log('SD 치수 setOption 강제 호출');
                    setTimeout(() => {
                        clearGroup(dimGroup);
                        const GS = sdGlobalState.GS || 0.1;
                        const dims = sdGlobalState.lastDimensions || currentDimensions;
                        buildSDDimOnly(dims, GS);
                        
                        // 초강력 가시성 보장
                        if (dimGroup) {
                            dimGroup.visible = true;
                            console.log('SD 치수 요소 개수:', dimGroup.children.length);
                            
                            dimGroup.traverse(child => {
                                if (child.isCSS2DObject && child.element) {
                                    child.element.style.visibility = 'visible';
                                    child.element.style.display = 'block';
                                    child.element.style.opacity = '1';
                                    child.element.style.zIndex = '999';
                                    console.log('SD 치수 element 가시성 설정:', child.element.innerHTML);
                                }
                            });
                        }
                    }, 50);
                }
                break;
            case 'resize':    onResize(); break;
            case 'updateDimMeta': {
                // ★ 치수명 매핑만 업데이트 (전체 모델 재렌더 없이)
                //   SetDimensionMeta가 이미 로드된 모델에 대해 호출되면 이 커맨드로 전달됨
                if (msg.dimMeta && typeof msg.dimMeta === 'object') {
                    applyDimMetaPayload(msg.dimMeta);
                } else {
                    currentDimMeta = {};
                }
                // 현재 패널에 표시되어 있으면 즉시 갱신
                updateDimPanel();
                break;
            }
            case 'resetDimPanel': {
                // ★ 탭 전환 등으로 패널을 강제 초기화
                resetDimPanel();
                break;
            }
        }
    } catch (err) { logToCSharp('Error: ' + err.message); }
};

function applyOptions() {
    if (dimGroup) dimGroup.visible = options.dimensions;
    setWireframe(options.wireframe);
    if (gridHelper) gridHelper.visible = options.grid;

    // 치수선 on/off → dimOnly 재생성
    if (currentPartCode) {
        clearGroup(dimGroup);
        if (options.dimensions) {
            // ★ 치수 재빌드 시 수집 배열도 초기화 (기존 데이터 무효화)
            renderedDimensions = [];

            // ★ SD/SN 플러머블록은 저장된 GS 파라미터 사용
            if (currentPartCode === 'SD' || currentPartCode === 'SN') {
                const savedGS = sdGlobalState.GS || 0.1;
                const savedDims = sdGlobalState.lastDimensions || currentDimensions;
                console.log('applyOptions에서 SD 치수 재생성:', savedDims, 'GS:', savedGS);
                
                try {
                    buildSDDimOnly(savedDims, savedGS);
                } catch (error) {
                    console.error('applyOptions SD 치수 에러:', error.message);
                    logToCSharp('applyOptions SD 치수 에러: ' + error.message);
                }
            } else {
                try {
                    findBuilder(currentPartCode).dimOnly(currentDimensions);
                } catch (error) {
                    console.error('applyOptions 다른 부품 치수 에러:', error.message);
                }
            }

            // ★ 치수선 재생성 후 패널 업데이트 (수집 배열 다시 채워짐)
            updateDimPanel();
        } else {
            // 치수선 OFF → 패널도 빈 상태로 갱신 (표시 중이면 "표시된 치수 없음" 표시)
            renderedDimensions = [];
            updateDimPanel();
        }
    }
}

function sendToCSharp(msg) {
    try { if (window.chrome && window.chrome.webview) window.chrome.webview.postMessage(msg); }
    catch (e) { console.log('[sendToCSharp]', e); }
}

function logToCSharp(message) {
    sendToCSharp({ type: 'log', message: message });
    console.log('[PartRenderer]', message);
}

// ═══════════════════════════════════════════════
// ★ 연결부품(LinkedParts) 3D 렌더러
// ═══════════════════════════════════════════════


// ─────────────────────────────────────────────
// ★ 연결부품 종류 감지 헬퍼
//   partCode가 한글("축그리기")이어도 정상 감지
// ─────────────────────────────────────────────

/** 축(Shaft) 연결부품인지 판별
 *  1. partCode/partType 에 SHAFT/SHFT/AXIS 포함 (영문)
 *  2. partName/partCode 에 한글 "축"/"샤프트" 포함
 *  3. dimensions 에 "축 지름"/"축지름" 키 존재
 */
function isShaftLinkedPart(lp) {
    const code = (lp.partCode || '').toUpperCase();
    const type = (lp.partType || '').toUpperCase();
    const name = (lp.partName || '');
    if (code === 'SHAFT' || code === 'SHFT' || code === 'DSFT') return true;  // ★ DSFT 추가
    if (code.includes('SHAFT') || code.includes('AXIS') || code.includes('DSFT')) return true;  // ★ DSFT
    if (type.includes('SHAFT') || type.includes('DSFT')) return true;
    if (name.includes('축') || name.includes('샤프트')) return true;
    if (code.includes('축') || code.includes('샤프트')) return true;
    if (lp.dimensions && ('축 지름' in lp.dimensions || '축지름' in lp.dimensions)) return true;
    if (lp.dimensions && ('축 지름(전체동일)' in lp.dimensions)) return true;  // ★ DSFT 전용 키
    return false;
}

/** 오일씰(Oil Seal) 연결부품인지 판별
 *  1. partCode/partType 에 OSEAL / OILSEAL 포함
 *  2. partName 에 한글 "오일씰"/"오일 씰" 포함
 */
function isOilSealLinkedPart(lp) {
    const code = (lp.partCode || '').toUpperCase();
    const type = (lp.partType || '').toUpperCase();
    const name = (lp.partName || '');
    if (code === 'OSEAL' || code.includes('OSEAL')) return true;
    if (code.includes('OILSEAL') || code.includes('OIL_SEAL')) return true;
    if (type.includes('OSEAL') || type.includes('OILSEAL')) return true;
    if (name.includes('오일씰') || name.includes('오일 씰')) return true;
    return false;
}

/** 하우징/블록 연결부품인지 판별 */
function isHousingLinkedPart(lp) {
    const code = (lp.partCode || '').toUpperCase();
    const type = (lp.partType || '').toUpperCase();
    const name = (lp.partName || '');
    if (code.includes('HOUSING') || code.includes('BLOCK') || code.includes('PILLOW')) return true;
    if (type.includes('HOUSING')) return true;
    if (name.includes('하우징') || name.includes('블록')) return true;
    return false;
}

// ── 연결부품 전용 재질 (반투명 — 주 부품과 구분) ──
const linkedShaftMat = new THREE.MeshStandardMaterial({
    color: 0x7B9EC0, metalness: 0.80, roughness: 0.20,
    transparent: true, opacity: 0.75
});
const linkedHousingMat = new THREE.MeshStandardMaterial({
    color: 0x8B7355, metalness: 0.30, roughness: 0.65,
    transparent: true, opacity: 0.55
});
const linkedOilSealMat = new THREE.MeshStandardMaterial({  // ★ 오일씰 — 다크 브라운(고무)
    color: 0x2A1A0A, metalness: 0.08, roughness: 0.92,
    transparent: true, opacity: 0.80
});

/**
 * 연결부품 전체 디스패처
 * updateModel() 직후 호출 — currentLinkedParts 순회하며 각 부품 빌드
 *
 * @param {string} mainCode   주 부품 코드 (축 방향 결정용)
 * @param {object} mainDims   주 부품 치수 (내경 d 등 참조)
 */
function buildLinkedParts(mainCode, mainDims) {
    if (!linkedGroup) return;
    for (const lp of currentLinkedParts) {
        // ★ isDrawEnabled=false → 렌더링 완전 생략 (작도 체크박스 OFF)
        if (!lp.isDrawEnabled) continue;

        if (isShaftLinkedPart(lp)) {
            buildLinkedShaft3D(lp.dimensions, mainDims, lp.mateOffset, lp.mateAlign, mainCode);
        } else if (isOilSealLinkedPart(lp)) {                                          // ★ 오일씰
            buildLinkedOilSeal3D(lp.dimensions, mainDims, lp.mateOffset, mainCode);
        } else if (isHousingLinkedPart(lp)) {
            buildLinkedHousing3D(lp.dimensions, mainDims, lp.mateOffset, mainCode);
        }
    }
}

/**
 * buildLinkedShaft3D — 축(Shaft) 연결부품 3D 렌더링
 *
 * 좌표계:
 *   DGBB·볼트계열 → Z축이 중심축 (LatheGeometry 기반, rotateX(PI/2) 적용됨)
 *   SERVO_MOTOR   → Y축이 중심축 (CylinderGeometry 기본)
 *
 * @param {object} ldims      연결부품 치수 { D, L, D2, L2, KEY_W, KEY_H, KEY_L }
 * @param {object} mainDims   주 부품 치수 (d/d1/D1 — 내경 참조)
 * @param {number} mateOffset 주 부품 중심 기준 축방향 오프셋 (mm)
 * @param {string} mateAlign  'center' | 'left' | 'right'
 * @param {string} mainCode   주 부품 코드
 */
function buildLinkedShaft3D(ldims, mainDims, mateOffset, mateAlign, mainCode) {
    // ① 샤프트 직경 — 지정 없으면 주 부품 내경 사용
    //    ★ "축 지름"/"축지름"/"축경" 한글 키 폴백 (SelectedData에서 병합된 값)
    const shaftD = ldims.D  || ldims.d  || ldims.D1 || ldims.d1
                || ldims['축 지름(전체동일)']              // ★ DSFT 전용 키 (우선 적용)
                || ldims['축 지름'] || ldims['축지름'] || ldims['축경']
                || mainDims.D1 || mainDims.d1 || mainDims.d || 20;
    // ★ 최소 가시 반경 보장 (Z-fighting 방지: 베어링 내경보다 약간 작게)
    const boreR = (mainDims.D1 || mainDims.d1 || mainDims.d || shaftD) / 2;
    const shaftR = Math.min(shaftD / 2, boreR * 0.97);   // 내경보다 3% 작게

    // ② 샤프트 전체 길이
    //    ★ "전체 길이"/"길이" 한글 키 폴백
    //    ★ 기본값: 베어링 폭의 6배 (양쪽으로 충분히 돌출되어 가시성 확보)
    const mainB  = mainDims.B || mainDims.b || 16;
    const shaftL = ldims.L || ldims.l
                || ldims['전체 길이'] || ldims['길이']
                || mainB * 3;   // ★ 6배 → 3배로 단축 (카메라 너무 멀어지는 문제 해결)

    // ③ 축 방향 결정
    //   ・ SERVO_MOTOR → Y축 (CylinderGeometry 기본)
    //   ★ DGBB / 베어링 계열 → Y축 (LatheGeometry 기본 회전축 = Y)
    //   ・ 볼트·너트·와셔 등 → Z축 (rotateX(PI/2) 적용)
    const mc = (mainCode || '').toUpperCase();
    const isMotorAxis = mc.includes('MOTOR')
                     || mc.includes('DGBB') || mc.includes('ANBB') || mc.includes('TRBR')
                     || mc.includes('CYLR') || mc.includes('THRB') || mc.includes('SRRB')
                     || mc.includes('UNIT') || mc.includes('PILB') || mc.includes('FLBU')
                     || mc.includes('BEARING') || mc.includes('BALL');

    // ④ mateAlign에 따른 축방향 중심 위치
    //   ★ 재설계: 베어링 끝면 기준 (CAD 작도와 동일)
    //
    //   "right": 축이 베어링 오른쪽(+Y) 끝면에서 외부로 뻗음
    //            축 중심 = +mainB/2 + shaftL/2
    //            → 축 범위: +mainB/2 ~ +mainB/2+shaftL
    //
    //   "left" : 축이 베어링 왼쪽(-Y) 끝면에서 외부로 뻗음
    //            축 중심 = -mainB/2 - shaftL/2
    //            → 축 범위: -mainB/2-shaftL ~ -mainB/2
    //
    //   "center": 베어링 중심 기준 양쪽 균등 (기존 방식)
    let axialCenter = Number(mateOffset) || 0;
    if (mateAlign === 'right') {
        axialCenter = mainB / 2 + shaftL / 2;
    } else if (mateAlign === 'left') {
        axialCenter = -(mainB / 2 + shaftL / 2);
    }

    // ─────────────────────────────────────────────
    // ★ innerFix / grinding 미리 계산 (⑤ 축 형상에서 참조)
    // ─────────────────────────────────────────────
    const innerFix = (
        ldims['_str_안쪽 고정 방식']   ||
        ldims['_str_INNERFIXTYPE']      ||
        ldims['안쪽 고정 방식']         ||
        ldims['INNERFIXTYPE']           ||
        ''
    ).toString();

    const grindingStr = (
        ldims['_str_연삭 틈새 적용'] ||
        ldims['연삭 틈새 적용']       ||
        ''
    ).toString();
    const hasGrinding = grindingStr === 'true' || grindingStr === '1' || grindingStr.includes('적용');

    const rrDistRaw = ldims['안쪽 멈춤링 홈 거리'] || ldims['INNERSUPPORTX'] || ldims.InnerSupportX || 0;
    const rrDist    = Number(rrDistRaw) || 0;

    // ─────────────────────────────────────────────
    // ⑤ 축 형상 (재구성 — 실제 CAD와 동일한 단차 구조)
    //
    //   mateAlign='right':
    //   [보어통과]──[칼라(단차)]──[얇은 연장부]──[끝단]
    //   R=shaftR    R=collarR     R=shaftR
    //   -B/2~B/2    B/2~B/2+cW   B/2+cW~끝
    //
    //   핵심: 연장부는 칼라 끝단 이후부터 시작 → 단차가 명확히 보임
    // ─────────────────────────────────────────────
    const mat = linkedShaftMat.clone();

    // ─ 칼라 유무 판단 (연장부 시작 위치 결정에 필요) ─
    const chR_pre = ldims.ch_Radius || ldims.CH_RADIUS || 0;
    const chD_pre = ldims.ch_Depth  || ldims.CH_DEPTH  || 0;
    const hasCollarNow = innerFix.includes('단차') || innerFix.includes('단자') || (chR_pre > 0 && chD_pre > 0);
    const collarW_now  = chD_pre > 0 ? chD_pre : Math.max(shaftR * 0.6, 0.5);

    // 연장부 시작 위치 = 베어링 끝면 + (칼라 있으면 칼라 폭)

    // 연장부 시작 위치 = 베어링 끝면 + (칼라 있으면 칼라 폭)
    const extDir     = (mateAlign === 'right') ?  1 :
                       (mateAlign === 'left')  ? -1 : 0;
    const collarOff  = hasCollarNow ? collarW_now : 0;
    const extFaceY   = extDir * (mainB / 2 + collarOff); // 연장부 시작 Y
    const extEndY    = extFaceY + extDir * shaftL;         // 연장부 끝 Y
    const extCenterY = (extFaceY + extEndY) / 2;           // 연장부 중심 Y

    // ① 보어 통과 구간
    const boreGeo  = new THREE.CylinderGeometry(shaftR, shaftR, mainB, 48, 1);
    const boreMesh = new THREE.Mesh(boreGeo, mat.clone());
    if (isMotorAxis) boreMesh.position.set(0, 0, 0);
    else { boreGeo.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI/2)); boreMesh.position.set(0,0,0); }
    linkedGroup.add(boreMesh);

    // ② 축 연장부 (칼라 끝단 이후)
    if (extDir !== 0 && shaftL > 0.1) {
        const extGeo  = new THREE.CylinderGeometry(shaftR, shaftR, shaftL, 48, 1);
        const extMesh = new THREE.Mesh(extGeo, mat.clone());
        if (isMotorAxis) extMesh.position.set(0, extCenterY, 0);
        else { extGeo.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI/2)); extMesh.position.set(0,0,extCenterY); }
        linkedGroup.add(extMesh);

        // ③ 끝단 모따기
        const chamLen = Math.max(shaftR * 0.12, 0.3);
        const chamPos = extEndY - extDir * chamLen / 2;
        const cg = new THREE.CylinderGeometry(shaftR * 0.82, shaftR, chamLen, 32);
        const cm = new THREE.Mesh(cg, mat.clone());
        if (isMotorAxis) cm.position.set(0, chamPos, 0);
        else { cg.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI/2)); cm.position.set(0,0,chamPos); }
        linkedGroup.add(cm);
    } else if (extDir === 0) {
        // center 모드 — 양쪽 균등 (기존 동작)
        const extGeo  = new THREE.CylinderGeometry(shaftR, shaftR, shaftL, 48, 1);
        const extMesh = new THREE.Mesh(extGeo, mat.clone());
        if (isMotorAxis) extMesh.position.set(0, 0, 0);
        else { extGeo.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI/2)); extMesh.position.set(0,0,0); }
        linkedGroup.add(extMesh);
    }

    // ④ 단차 가공 (D2·L2 있을 때)
    if (ldims.D2 && ldims.L2 && ldims.D2 > shaftD && extDir !== 0) {
        const stepR   = ldims.D2 / 2;
        const stepL   = ldims.L2;
        const stepOff = extEndY + extDir * stepL / 2;
        const sg      = new THREE.CylinderGeometry(stepR, stepR, stepL, 48);
        const sm      = new THREE.Mesh(sg, mat.clone());
        if (isMotorAxis) sm.position.set(0, stepOff, 0);
        else { sg.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI/2)); sm.position.set(0,0,stepOff); }
        linkedGroup.add(sm);
    }

    // ─────────────────────────────────────────────
    // ⑤ 평행키 키홈 (Parallel Keyway)
    //   C++ 치수 키: pKey_Width, pKey_Height, pKey_Depth1
    //   위치 키:     PKeyOffset1("첫 번째 키홈 위치"), PKeyLength1("첫 번째 키홈 길이")
    //   한글키 폴백: "평행키 폭", "평행키 높이", "축 키홈 깊이"
    // ─────────────────────────────────────────────
    const kwayType = (
        ldims['_str_키 홈 형상'] || ldims['_str_KEYWAY'] || ldims['키 홈 형상'] || ''
    ).toString().toLowerCase();

    // 평행키 치수
    const pkW = ldims.pKey_Width   || ldims.PKEY_WIDTH   || ldims['평행키 폭']    || ldims.KEY_W || 0;
    const pkH = ldims.pKey_Height  || ldims.PKEY_HEIGHT  || ldims['평행키 높이']  || ldims.KEY_H || 0;
    const pkD = ldims.pKey_Depth1  || ldims.PKEY_DEPTH1  || ldims['축 키홈 깊이'] || ldims.KEY_D || pkH * 0.6;

    // 키홈 위치 및 길이 (한글 키 포함)
    const pkOff1Raw = ldims.PKeyOffset1 || ldims.PKEYOFFSET1 || ldims['첫 번째 키홈 위치'] || 0;
    const pkLen1Raw = ldims.PKeyLength1 || ldims.PKEYLEN1    || ldims['첫 번째 키홈 길이'] || shaftL * 0.6;
    const pkOff1    = Number(pkOff1Raw) || 0;
    const pkLen1    = Number(pkLen1Raw) || shaftL * 0.6;

    const hasParallelKey = (kwayType.includes('평행') || kwayType.includes('parallel')) && pkW > 0 && pkH > 0;

    if (hasParallelKey || (pkW > 0 && pkH > 0)) {
        // 키홈 중심 위치 (베어링 끝면 + offset + 키홈길이/2)
        const keyStartY = extFaceY + extDir * pkOff1;
        const keyCenterY = keyStartY + extDir * pkLen1 / 2;

        // 키홈 컷아웃 (어두운 홈 — 축 표면에서 pkD 만큼 파임)
        const grooveW = pkD > 0 ? pkD : pkH * 0.6;
        const grooveGeo = new THREE.BoxGeometry(pkW, grooveW * 2, pkLen1);
        const grooveMat = new THREE.MeshStandardMaterial({ color: 0x0A1520, metalness: 0.4, roughness: 0.7 });
        const grooveMesh = new THREE.Mesh(grooveGeo, grooveMat);
        if (isMotorAxis) {
            grooveMesh.position.set(0, keyCenterY, shaftR - grooveW / 2);
        } else {
            grooveGeo.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
            grooveMesh.position.set(0, shaftR - grooveW / 2, keyCenterY);
        }
        linkedGroup.add(grooveMesh);

        // 두 번째 키홈 (PKeyOffset2/PKeyLength2 있을 때)
        const pkOff2Raw = ldims.PKeyOffset2 || ldims['두 번째 키홈 위치'] || 0;
        const pkLen2Raw = ldims.PKeyLength2 || ldims['두 번째 키홈 길이'] || 0;
        if (Number(pkLen2Raw) > 0) {
            const key2StartY   = extFaceY + extDir * Number(pkOff2Raw);
            const key2CenterY  = key2StartY + extDir * Number(pkLen2Raw) / 2;
            const groove2Geo   = new THREE.BoxGeometry(pkW, grooveW * 2, Number(pkLen2Raw));
            const groove2Mesh  = new THREE.Mesh(groove2Geo, grooveMat.clone());
            if (isMotorAxis) {
                groove2Mesh.position.set(0, key2CenterY, shaftR - grooveW / 2);
            } else {
                groove2Geo.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
                groove2Mesh.position.set(0, shaftR - grooveW / 2, key2CenterY);
            }
            linkedGroup.add(groove2Mesh);
        }
    }

    // ─────────────────────────────────────────────
    // ⑥ 우드러프 키홈 (Woodruff Keyway)
    //   C++ 치수 키: wKey_Radius, wKey_Width, wKey_Depth
    // ─────────────────────────────────────────────
    const wkR = ldims.wKey_Radius || ldims.WKEY_RADIUS || 0;
    const wkW = ldims.wKey_Width  || ldims.WKEY_WIDTH  || 0;
    const wkD = ldims.wKey_Depth  || ldims.WKEY_DEPTH  || wkR * 0.5;
    const hasWoodruff = (kwayType.includes('우드러프') || kwayType.includes('woodruff')) && wkR > 0;

    if (hasWoodruff) {
        // 반원 형태의 키홈 — CylinderGeometry 반만 잘라서 표현
        const wGeo  = new THREE.CylinderGeometry(wkR, wkR, wkW, 32, 1, false, 0, Math.PI);
        const wMat  = new THREE.MeshStandardMaterial({ color: 0x0A1520, metalness: 0.4, roughness: 0.7 });
        const wMesh = new THREE.Mesh(wGeo, wMat);
        const wCenterY = extFaceY + extDir * shaftL * 0.35;
        if (isMotorAxis) {
            wMesh.rotation.z = Math.PI / 2;
            wMesh.position.set(0, wCenterY, shaftR - wkD / 2);
        } else {
            wMesh.rotation.x = Math.PI / 2;
            wMesh.rotation.y = Math.PI / 2;
            wMesh.position.set(0, shaftR - wkD / 2, wCenterY);
        }
        linkedGroup.add(wMesh);
    }

    // ─────────────────────────────────────────────
    // ⑦ 렌치 플랫 / 면취 (Wrench Flat / D면취)
    //   C++ 치수 키: wFlat_Depth, wFlat_Length
    //   한글 키: "이면폭 깊이", "평면취 (렌치 플랫)", "첫 번째 면취 거리", "첫 번째 면취 길이"
    // ─────────────────────────────────────────────
    const wfStr = (
        ldims['_str_평면취 (렌치 플랫)'] || ldims['평면취 (렌치 플랫)'] ||
        ldims['_str_WRENCHFLAT']         || ''
    ).toString();
    const wfD   = ldims.wFlat_Depth  || ldims.WFLAT_DEPTH  || ldims['이면폭 깊이'] || 0;
    const wfL   = ldims.wFlat_Length || ldims.WFLAT_LENGTH || ldims['첫 번째 면취 길이'] || shaftL * 0.4;
    const wfOff = ldims.WFlatOffset1  || ldims['첫 번째 면취 거리'] || 0;
    const hasWFlat = (wfStr !== '' && !wfStr.includes('없음') && !wfStr.includes('None')) || wfD > 0;

    if (hasWFlat) {
        // 절삭 박스로 평면 표현 (축 측면에 박스를 씌워 평면처럼 보이게)
        const flatDepth  = wfD > 0 ? wfD : shaftR * 0.15;          // 깎는 깊이
        const flatHeight = (shaftR - flatDepth) * 2;               // 평면 폭
        const flatLen    = Number(wfL) || shaftL * 0.4;
        const flatOff    = Number(wfOff) || 0;
        const flatCenterY = extFaceY + extDir * (flatOff + flatLen / 2);

        // 평면 표현: 주 색보다 약간 어두운 박스
        const flatGeo = new THREE.BoxGeometry(flatHeight, flatLen, flatDepth * 2);
        const flatMat = new THREE.MeshStandardMaterial({ color: 0x99B0C8, metalness: 0.75, roughness: 0.22 });
        const flatMesh = new THREE.Mesh(flatGeo, flatMat);
        if (isMotorAxis) {
            flatMesh.position.set(0, flatCenterY, shaftR - flatDepth + flatDepth);
        } else {
            flatGeo.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
            flatMesh.position.set(0, shaftR - flatDepth + flatDepth, flatCenterY);
        }
        linkedGroup.add(flatMesh);

        // 두 번째 면취 (180° 반대편 — TwoPlaces / AngledTwoPlaces)
        if (wfStr.includes('Two') || wfStr.includes('2') || wfStr.includes('양면')) {
            const flat2Mesh = new THREE.Mesh(flatGeo.clone(), flatMat.clone());
            if (isMotorAxis) {
                flat2Mesh.position.set(0, flatCenterY, -(shaftR - flatDepth + flatDepth));
            } else {
                flat2Mesh.position.set(0, -(shaftR - flatDepth + flatDepth), flatCenterY);
            }
            linkedGroup.add(flat2Mesh);
        }
    }

    // ─────────────────────────────────────────────
    // ⑧ 슬리팅 (Slitting) — 축 끝단 절개 홈
    //   C++ 치수 키: slit_Width, slit_Depth
    // ─────────────────────────────────────────────
    const slitW = ldims.slit_Width || ldims.SLIT_WIDTH || 0;
    const slitD = ldims.slit_Depth || ldims.SLIT_DEPTH || 0;
    const slitStr = (ldims['_str_슬리팅'] || ldims['슬리팅'] || '').toString();
    const hasSlitting = (slitStr !== '' && !slitStr.includes('없음')) || (slitW > 0 && slitD > 0);

    if (hasSlitting && extDir !== 0) {
        const sw = slitW > 0 ? slitW : shaftR * 0.12;
        const sd = slitD > 0 ? slitD : shaftR * 0.85;
        // 끝단 위치에 얇은 박스 슬롯
        const slitGeo = new THREE.BoxGeometry(shaftR * 2.1, sw, sd);
        const slitMesh = new THREE.Mesh(slitGeo,
            new THREE.MeshStandardMaterial({ color: 0x060C14, metalness: 0.3, roughness: 0.8 }));
        const slitPosY = extEndY - extDir * sd / 2;
        if (isMotorAxis) {
            slitMesh.position.set(0, slitPosY, 0);
        } else {
            slitGeo.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
            slitMesh.position.set(0, 0, slitPosY);
        }
        linkedGroup.add(slitMesh);
    }

    // ─────────────────────────────────────────────
    // ⑨ 슬릿캠 홈 (Slit Cam Groove)
    //   C++ 치수 키: sCam_Diameter, sCam_Width
    //   한글 키: "슬릿캠 홈 직경", "슬릿캠 홈 폭"
    // ─────────────────────────────────────────────
    const scamD = ldims.sCam_Diameter || ldims.SCAM_DIAMETER || ldims['슬릿캠 홈 직경'] || 0;
    const scamW = ldims.sCam_Width    || ldims.SCAM_WIDTH    || ldims['슬릿캠 홈 폭']    || 0;
    const scamStr = (ldims['_str_슬릿캠'] || ldims['슬릿캠'] || '').toString();
    const hasSlitCam = (scamStr !== '' && !scamStr.includes('없음')) || (scamD > 0 && scamW > 0);

    if (hasSlitCam && scamD > 0) {
        const scOff = ldims.SCamOffset2 || ldims['슬릿캠 위치'] || 0;
        const scPosY = extFaceY + extDir * (Number(scOff) || shaftL * 0.25);
        const scCylR = scamD > 0 ? scamD / 2 : shaftR * 0.40;
        const scW    = scamW > 0 ? scamW : shaftR * 0.25;

        // 슬릿캠 홈: 축 중심에서 편심된 원통 홈
        const scGeo  = new THREE.CylinderGeometry(scCylR, scCylR, scW, 32);
        const scMesh = new THREE.Mesh(scGeo,
            new THREE.MeshStandardMaterial({ color: 0x0C1A28, metalness: 0.5, roughness: 0.6 }));
        if (isMotorAxis) {
            scMesh.position.set(shaftR * 0.3, scPosY, 0);
        } else {
            scGeo.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
            scMesh.position.set(shaftR * 0.3, 0, scPosY);
        }
        linkedGroup.add(scMesh);
    }

    // ─────────────────────────────────────────────
    // ⑩-E : 바깥쪽 멈춤링 홈 (Outer Snap Ring Groove)
    //   C++ 치수 키: RingOffset2("바깥쪽 멈춤링 홈 거리"), retRing_Width, retRing_Thickness
    //   바깥쪽(축 자유단) → innerFix와 반대 방향에 위치
    // ─────────────────────────────────────────────
    const outerFix = (
        ldims['_str_바깥쪽 고정 방식']  || ldims['바깥쪽 고정 방식'] ||
        ldims['_str_OUTERFIX']           || ldims['OUTERFIX'] || ''
    ).toString();
    const ringOff2 = ldims.RingOffset2 || ldims['바깥쪽 멈춤링 홈 거리'] || 0;

    if (outerFix.includes('멈춤') || outerFix.includes('Snap') || Number(ringOff2) > 0) {
        // rrW / rrDep — 아래 ⑩-C 에서도 선언되지만 여기서 독립 계산
        const orW_v   = ldims.retRing_Width     || ldims.RETRING_WIDTH     || 0;
        const orDep_v = ldims.retRing_Thickness || ldims.RETRING_THICKNESS || shaftR * 0.08;
        const orW   = orW_v > 0 ? orW_v : Math.max(shaftR * 0.20, 1.0);
        const orDep = Number(orDep_v) > 0 ? Number(orDep_v) : shaftR * 0.08;
        const orR   = shaftR - orDep;
        const orDist = Number(ringOff2) > 0 ? Number(ringOff2) : shaftL * 0.85;
        const orPos = extFaceY + extDir * orDist;

        // 홈
        const orGeo  = new THREE.CylinderGeometry(orR, orR, orW, 32);
        const orMesh = new THREE.Mesh(orGeo,
            new THREE.MeshStandardMaterial({ color: 0x1A2A3A, metalness: 0.6, roughness: 0.4 }));
        if (isMotorAxis) {
            orMesh.position.set(0, orPos, 0);
        } else {
            orGeo.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
            orMesh.position.set(0, 0, orPos);
        }
        linkedGroup.add(orMesh);

        // 멈춤링
        const orTorus = new THREE.TorusGeometry(orR + orDep * 0.5, orDep * 0.8, 8, 32);
        const orRingMesh = new THREE.Mesh(orTorus,
            new THREE.MeshStandardMaterial({ color: 0x607080, metalness: 0.60, roughness: 0.38 }));
        orRingMesh.rotation.x = Math.PI / 2;
        if (isMotorAxis) {
            orRingMesh.position.set(0, orPos, 0);
        } else {
            orRingMesh.position.set(0, 0, orPos);
        }
        linkedGroup.add(orRingMesh);
    }

    // ─────────────────────────────────────────────
    // ⑩-F : 수나사 (Male Thread) — 축 끝단
    //   C++ 치수 키: ThreadOuterDia("수나사 규격"), ThreadLength("수나사 길이")
    // ─────────────────────────────────────────────
    const outerFixComp = (ldims['_str_바깥쪽 고정 부품'] || ldims['바깥쪽 고정 부품'] || '').toString();
    const threadOD  = ldims.ThreadOuterDia  || ldims['수나사 규격']  || '';
    const threadLen = ldims.ThreadLength    || ldims['수나사 길이']   || 0;
    const hasThread = outerFix.includes('수나사') || outerFix.includes('Thread') ||
                      outerFixComp.includes('로크너트') || String(threadLen) !== '0';

    if (hasThread && extDir !== 0) {
        const tLen = Number(threadLen) > 0 ? Number(threadLen) : shaftL * 0.35;
        const tPosStart = extEndY - extDir * tLen;
        const tCenter   = (tPosStart + extEndY) / 2;

        // 나사산 — 촘촘한 토러스 배열로 표현
        const threadPitch = Math.max(shaftR * 0.12, 0.8);
        const nThreads    = Math.max(3, Math.round(tLen / threadPitch));
        const threadMat   = new THREE.MeshStandardMaterial({ color: 0xC0C8D0, metalness: 0.55, roughness: 0.30 });
        for (let ti = 0; ti < nThreads; ti++) {
            const tY   = tPosStart + extDir * (ti + 0.5) * threadPitch;
            const tGeo = new THREE.TorusGeometry(shaftR * 1.04, shaftR * 0.035, 6, 32);
            const tMsh = new THREE.Mesh(tGeo, threadMat.clone());
            tMsh.rotation.x = Math.PI / 2;
            if (isMotorAxis) {
                tMsh.position.set(0, tY, 0);
            } else {
                tMsh.position.set(0, 0, tY);
            }
            linkedGroup.add(tMsh);
        }
    }

    // ─────────────────────────────────────────────
    // ★ 진단 로그 (전체 취합)
    // ─────────────────────────────────────────────
    {
        const numKeys = Object.keys(ldims).filter(k => !k.startsWith('_str_') && ldims[k] !== 0);
        const strKeys = Object.keys(ldims).filter(k => k.startsWith('_str_'));
        logToCSharp('[Shaft] numKeys: ' + numKeys.join(', '));
        if (strKeys.length > 0)
            logToCSharp('[Shaft] strKeys: ' + strKeys.map(k => k + '=' + ldims[k]).join(' | '));
        logToCSharp('[Shaft] innerFix="' + innerFix + '" outerFix="' + outerFix +
                    '" grinding="' + grindingStr + '" mateAlign=' + mateAlign +
                    ' kwayType="' + kwayType + '"' +
                    ' pkW=' + pkW + ' wkR=' + wkR + ' hasWFlat=' + hasWFlat +
                    ' hasSlitting=' + hasSlitting + ' hasSlitCam=' + hasSlitCam);
    }

    // ─────────────────────────────────────────────
    // ★ 단차 생성 (Step / Datum collar)
    //   베어링 내측(bearing face 안쪽)에 칼라 링을 추가
    //   — 베어링 내륜이 이 칼라에 맞닿아 축방향 위치 고정
    // ─────────────────────────────────────────────
    const chR = ldims.ch_Radius || ldims.CH_RADIUS || 0;
    const chD = ldims.ch_Depth  || ldims.CH_DEPTH  || 0;

    if (innerFix.includes('단차') || innerFix.includes('단자') || (chR > 0 && chD > 0)) {
        // ★ 칼라 치수 — 실제 CAD에 맞게 (미세한 단차)
        //   collarR = 축 반경의 135% → 직경으로 축의 1.35배
        //   collarW = 축 반경의 60% → 얇은 링
        const collarR = chR > 0
            ? chR
            : shaftR * 1.35;
        const collarW = chD > 0
            ? chD
            : Math.max(shaftR * 0.6, 0.5);

        logToCSharp('[Shaft] collar: shaftR=' + shaftR.toFixed(2) +
                    ' collarR=' + collarR.toFixed(2) +
                    ' collarW=' + collarW.toFixed(2));

        // ★ 칼라 색상: 축(파란빛)과 구분되는 밝은 스틸
        const collarMat = new THREE.MeshStandardMaterial({
            color: 0xD0D8E0, metalness: 0.70, roughness: 0.25
        });

        // ★ 칼라 위치: 축 연장부 시작점 (베어링 끝면 + 칼라 절반)
        //   mateAlign='right': 축이 +Y → 칼라도 +Y 끝면(카메라 방향) → FRONT뷰에서 보임
        //   mateAlign='left' : 축이 -Y → 칼라도 -Y 끝면
        //
        //   [보어 통과] ─── [칼라] ─── [축 연장부]
        //    -B/2~+B/2     +B/2+cW/2   +B/2+cW~+shaftL
        const collarSign = (mateAlign === 'right') ?  1 :   // ★ +1 (연장부 방향)
                           (mateAlign === 'left')  ? -1 : -1;
        const collarPos  = collarSign * (mainB / 2 + collarW / 2);

        const cGeo  = new THREE.CylinderGeometry(collarR, collarR, collarW, 32);
        const cMesh = new THREE.Mesh(cGeo, collarMat);
        if (isMotorAxis) {
            cMesh.position.set(0, collarPos, 0);
        } else {
            cGeo.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
            cMesh.position.set(0, 0, collarPos);
        }
        linkedGroup.add(cMesh);

        // ★ 단차 전환부 — 칼라에서 축(보어)으로 이어지는 원뿔형 테이퍼
        //   칼라 안쪽(-collarSign 방향)에 배치
        const taperH   = collarW * 0.30;
        const tGeo     = new THREE.CylinderGeometry(collarR, shaftR, taperH, 32);
        const tMesh    = new THREE.Mesh(tGeo, collarMat.clone());
        // 테이퍼는 칼라의 베어링 방향 끝에 붙음
        const taperPos = collarPos - collarSign * (collarW / 2 + taperH / 2);
        if (isMotorAxis) {
            tMesh.position.set(0, taperPos, 0);
        } else {
            tGeo.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
            tMesh.position.set(0, 0, taperPos);
        }
        linkedGroup.add(tMesh);

        // 연삭 틈새 홈 (칼라 루트 언더컷)
        if (hasGrinding) {
            const gR   = shaftR * 0.92;
            const gW   = Math.max(shaftR * 0.25, 0.4);
            const gPos = collarPos - collarSign * (collarW / 2 + gW * 0.5);
            const ggGeo  = new THREE.CylinderGeometry(gR, gR, gW, 32);
            const ggMesh = new THREE.Mesh(ggGeo, new THREE.MeshStandardMaterial({
                color: 0x334455, metalness: 0.5, roughness: 0.6
            }));
            if (isMotorAxis) {
                ggMesh.position.set(0, gPos, 0);
            } else {
                ggGeo.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
                ggMesh.position.set(0, 0, gPos);
            }
            linkedGroup.add(ggMesh);
        }
    }

    // ─────────────────────────────────────────────
    // ⑩-B : 어깨 생성 (Shoulder — 더 큰 직경 단차)
    //   축 베어링 자리 끝에 직경이 커지는 어깨 단차
    // ─────────────────────────────────────────────
    if (innerFix.includes('어깨') || innerFix.toLowerCase().includes('shoulder')) {
        const shldR  = shaftR * 1.25;   // 어깨 반경 (축보다 25% 크게)
        const shldW  = Math.max(shaftR * 0.40, 2.0);
        const shldMat = new THREE.MeshStandardMaterial({
            color: 0x8899AA, metalness: 0.55, roughness: 0.35
        });
        const shldSign = (mateAlign === 'right') ? -1 : 1;
        const shldPos  = shldSign * (mainB / 2 + shldW / 2);

        const sGeo  = new THREE.CylinderGeometry(shldR, shldR, shldW, 32);
        const sMesh = new THREE.Mesh(sGeo, shldMat);
        if (isMotorAxis) {
            sMesh.position.set(0, shldPos, 0);
        } else {
            sGeo.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
            sMesh.position.set(0, 0, shldPos);
        }
        linkedGroup.add(sMesh);

        // 연삭 틈새 (어깨 루트 언더컷)
        if (hasGrinding) {
            const gR   = shaftR * 0.94;
            const gW   = Math.max(shaftR * 0.15, 0.5);
            const gPos = shldPos - shldSign * (shldW / 2 + gW / 2);
            const ggGeo  = new THREE.CylinderGeometry(gR, gR, gW, 32);
            const ggMesh = new THREE.Mesh(ggGeo, new THREE.MeshStandardMaterial({
                color: 0x334455, metalness: 0.5, roughness: 0.6
            }));
            if (isMotorAxis) {
                ggMesh.position.set(0, gPos, 0);
            } else {
                ggGeo.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
                ggMesh.position.set(0, 0, gPos);
            }
            linkedGroup.add(ggMesh);
        }
    }

    // ─────────────────────────────────────────────
    // ⑩-C : 멈춤링 홈 + 링 (Snap/Retaining Ring)
    //   "멈춤링" 또는 rrDist > 0 일 때 홈 + 링 시각화
    // ─────────────────────────────────────────────
    const rrW   = ldims.retRing_Width     || ldims.RETRING_WIDTH     || 0;
    const rrDep = ldims.retRing_Thickness || ldims.RETRING_THICKNESS || shaftR * 0.08;
    const hasRetRing = innerFix.includes('멈춤') || rrW > 0 || rrDist > 0;
    const grooveW    = rrW > 0 ? rrW : Math.max(shaftR * 0.20, 1.0);  // ★ 블록 밖으로 호이스팅

    if (hasRetRing) {
        const grooveDep = rrDep;
        const grooveR = shaftR - grooveDep;
        // ★ 멈춤링은 칼라와 같은 방향(축 반대쪽) 끝면 바깥쪽에 위치
        const ringSign  = (mateAlign === 'right') ? -1 : 1;
        const groovePos = rrDist > 0
            ? ringSign * (mainB / 2 + rrDist)
            : ringSign * (mainB / 2 + grooveW * 2.5);

        // 홈 (어두운 가는 원통)
        const gGeo  = new THREE.CylinderGeometry(grooveR, grooveR, grooveW, 32);
        const gMesh = new THREE.Mesh(gGeo, new THREE.MeshStandardMaterial({
            color: 0x1A2A3A, metalness: 0.6, roughness: 0.4
        }));
        if (isMotorAxis) {
            gMesh.position.set(0, groovePos, 0);
        } else {
            gGeo.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
            gMesh.position.set(0, 0, groovePos);
        }
        linkedGroup.add(gMesh);

        // 멈춤링 본체 (얇은 토러스 — 스틸 블루)
        const ringTorus = new THREE.TorusGeometry(grooveR + grooveDep * 0.5, grooveDep * 0.8, 8, 32);
        const ringMesh  = new THREE.Mesh(ringTorus, new THREE.MeshStandardMaterial({
            color: 0x607080, metalness: 0.60, roughness: 0.38
        }));
        ringMesh.rotation.x = Math.PI / 2;  // XZ 평면에 눕힘 (베어링 Y축 방향)
        if (isMotorAxis) {
            ringMesh.position.set(0, groovePos, 0);
        } else {
            ringMesh.position.set(0, 0, groovePos);
        }
        linkedGroup.add(ringMesh);
    }

    // ─────────────────────────────────────────────
    // ⑩-D : 로크너트 (Lock Nut)
    // ─────────────────────────────────────────────
    const lnOD = ldims.locknut_OuterDia  || ldims.LOCKNUT_OUTERDIA  || 0;
    const lnT  = ldims.locknut_Thickness || ldims.LOCKNUT_THICKNESS || 0;
    if (lnOD > 0 && lnT > 0) {
        const lnSign = (mateAlign === 'right') ? -1 : 1;
        const lnOff  = extDir * (mainB / 2 + collarOff + shaftL + lnT / 2 + (hasRetRing ? grooveW * 4 : 0));
        const lnGeo  = new THREE.CylinderGeometry(lnOD/2, lnOD/2, lnT, 12);
        const lnMesh = new THREE.Mesh(lnGeo, new THREE.MeshStandardMaterial({
            color: 0xA0A8B0, metalness: 0.5, roughness: 0.35
        }));
        if (isMotorAxis) {
            lnMesh.position.set(0, lnOff, 0);
        } else {
            lnGeo.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
            lnMesh.position.set(0, 0, lnOff);
        }
        linkedGroup.add(lnMesh);
    }
}

/**
 * buildLinkedHousing3D — 하우징·필로우블록 연결부품 (간략형)
 */
function buildLinkedHousing3D(ldims, mainDims, mateOffset, mainCode) {
    const D    = mainDims.D  || mainDims.D2 || 40;
    const boreR = D / 2;
    const hw   = ldims.HW || ldims.W || D * 1.8;
    const hh   = ldims.HH || ldims.H || D * 1.4;
    const hl   = ldims.HL || ldims.L || (mainDims.B || 16) * 1.2;
    const off  = Number(mateOffset) || 0;

    const mat = linkedHousingMat.clone();

    // 하우징 박스
    const bg = new THREE.BoxGeometry(hw, hh, hl);
    const bm = new THREE.Mesh(bg, mat);
    bm.position.set(0, -hh * 0.1, off);
    linkedGroup.add(bm);

    // 보어 홀 (어두운 원기둥으로 구멍 시각화)
    const hg = new THREE.CylinderGeometry(boreR, boreR, hl * 1.01, 48);
    hg.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
    const hm = new THREE.Mesh(hg, new THREE.MeshStandardMaterial({
        color: 0x050A10, metalness: 0, roughness: 1
    }));
    hm.position.set(0, 0, off);
    linkedGroup.add(hm);
}

/**
 * buildLinkedOilSeal3D — 오일씰 연결부품 3D 렌더링
 *
 * 치수 매핑 (베어링 DB 키 그대로):
 *   d1 / d → 내경 (씰 내경 = 축 직경)
 *   D2 / D → 외경 (씰 외경 = 하우징 보어)
 *   B  / b → 폭   (씰 두께)
 *
 * 형상:
 *   ① 도넛형 압출 링 (linkedOilSealMat — 다크 브라운/고무)
 *   ② 씰 립 (토러스) — 내경 근처 강조
 *
 * 좌표계:
 *   비모터(DGBB 등) → Z축 중심, ExtrudeGeometry XY면 그대로 사용
 *   SERVO_MOTOR      → Y축 중심, geometry rotateX(-PI/2) 적용
 */
function buildLinkedOilSeal3D(ldims, mainDims, mateOffset, mainCode) {
    // ─────────────────────────────────────────────
    // ① 치수 추출
    //   오일씰 DB 키가 한글(내경, 두께)로 오므로 폴백 체인 확장
    //   호칭 예: "10x22x7" → d=10, D=22, B=7
    // ─────────────────────────────────────────────
    // ─── 호칭 파싱: "dxDxB" 세 숫자 모두 추출 ───────────────
    const titleStr = (ldims['_str_호칭'] || ldims['호칭'] || '').toString();
    const titleM   = titleStr.match(/(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)/);
    const title_d  = titleM ? Number(titleM[1]) : 0;   // 내경
    const title_D  = titleM ? Number(titleM[2]) : 0;   // 외경
    const title_B  = titleM ? Number(titleM[3]) : 0;   // 폭(두께)

    // ─── 내경 d1 ─────────────────────────────────────────────
    const d1 = title_d > 0 ? title_d :
               (ldims.d1 || ldims.d || ldims['내경'] || ldims['D1'] ||
                mainDims.d1 || mainDims.d || 10);

    // ─── 외경 D2 ─────────────────────────────────────────────
    const D2 = title_D > 0 ? title_D :
               (ldims.D2 || ldims.D || ldims['외경'] ||
                mainDims.D2 || mainDims.D || d1 * 3);

    // ─── 폭 B (오일씰 두께) ───────────────────────────────────
    //   ★ 핵심 수정: 호칭 3번째 숫자(title_B)를 최우선 사용
    //   ★ mainDims.B(베어링 폭)는 폴백에서 제거 — 오일씰 폭≠베어링 폭
    //   ★ 최종 폴백: 외경×0.25 (비율 추정), 최대 외경×0.40으로 캡
    const B_raw = title_B > 0 ? title_B :
                  (ldims.B || ldims.b || ldims['두께'] || ldims['폭'] || 0);
    const bearingOD = (mainDims.D2 || mainDims.D || D2) / 2;
    const maxSealW  = bearingOD * 0.60;   // 베어링 반경의 60% 이하
    const B_fallback = Math.min((D2 - d1) * 0.55, maxSealW);  // 링 폭의 55% 추정
    const sealW = Math.min(Math.max(Number(B_raw) > 0 ? Number(B_raw) : B_fallback, 1), maxSealW);

    // ─── D2 캡: 오일씰 외경이 베어링 외경을 초과하지 않도록 ───
    const innerR = d1 / 2;
    const outerR = Math.min(D2 / 2, bearingOD * 0.95);

    logToCSharp('[OilSeal] title="' + titleStr + '" → d1=' + d1 + ' D2=' + D2 +
                '(capped:' + (outerR*2).toFixed(1) + ') B_raw=' + B_raw + ' sealW=' + sealW.toFixed(2) +
                ' maxSealW=' + maxSealW.toFixed(2));

    // ─────────────────────────────────────────────
    // ② 좌표축 결정
    //   DGBB/베어링 계열 → Y축 (LatheGeometry 기본)
    //   SERVO_MOTOR     → Y축 (CylinderGeometry 기본)
    //   볼트/와셔 등    → Z축
    // ─────────────────────────────────────────────
    const mc = (mainCode || '').toUpperCase();
    const isYAxis = mc.includes('MOTOR') ||
                    mc.includes('DGBB')  || mc.includes('ANBB') || mc.includes('TRBR') ||
                    mc.includes('CYLR')  || mc.includes('THRB') || mc.includes('SRRB') ||
                    mc.includes('UNIT')  || mc.includes('PILB') || mc.includes('FLBU') ||
                    mc.includes('BEARING');

    // ─────────────────────────────────────────────
    // ③ 위치: 축 연장부와 같은 방향 (+Y 끝면) 바로 바깥
    //
    //   오일씰은 축이 하우징 밖으로 나오는 쪽(축 연장 방향)에서 밀봉
    //   ExtrudeGeometry + makeRotationX(-PI/2) 후 로컬 Y범위: 0 ~ sealW
    //   월드 Y범위: P ~ P+sealW
    //
    //   씰이 베어링 오른쪽(+mainB/2)에 딱 붙으려면:
    //     P = +mainB/2  → 씰 Y범위: +mainB/2 ~ +mainB/2+sealW
    // ─────────────────────────────────────────────
    const mainB    = mainDims.B || mainDims.b || 10;
    const sealStart = mainB / 2;             // ★ +Y 끝면에서 시작 (축 연장 방향)
    const sealMidY  = mainB / 2 + sealW / 2; // 씰 중심 Y

    const mat = linkedOilSealMat.clone();

    // ─────────────────────────────────────────────
    // ④ 오일씰 본체 — 도넛형 ExtrudeGeometry
    //   Y축 베어링: XY평면 단면 → rotateX(-PI/2) → Y방향으로 눕힘
    // ─────────────────────────────────────────────
    const shape = createCircleShapeWithHole(outerR, innerR);
    const geo   = new THREE.ExtrudeGeometry(shape, { depth: sealW, bevelEnabled: false });
    const mesh  = new THREE.Mesh(geo, mat);

    if (isYAxis) {
        geo.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
        mesh.position.set(0, sealStart, 0);   // ★ sealStart: 씰 바깥면이 시작, +sealW 방향으로 베어링에 붙음
    } else {
        mesh.position.set(0, 0, sealStart);
    }
    linkedGroup.add(mesh);

    // ─────────────────────────────────────────────
    // ⑤ 씰 립 — 내경 근처 얇은 링 (씰링 포인트 강조)
    //   Y축 베어링: TorusGeometry 기본(XY평면)을 rotation.x=PI/2로 XZ평면에 배치
    // ─────────────────────────────────────────────
    const lipR     = innerR + (outerR - innerR) * 0.15;
    const lipThick = Math.max((outerR - innerR) * 0.06, 0.3);
    const lipGeo   = new THREE.TorusGeometry(lipR, lipThick, 8, 48);
    const lipMat   = new THREE.MeshStandardMaterial({
        color: 0x1A0A00, metalness: 0.05, roughness: 0.95,
        transparent: true, opacity: 0.88
    });
    const lipMesh  = new THREE.Mesh(lipGeo, lipMat);

    if (isYAxis) {
        lipGeo.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
        lipMesh.position.set(0, sealMidY, 0);   // 씰 중심 Y
    } else {
        lipGeo.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
        lipMesh.position.set(0, 0, sealMidY);
    }
    linkedGroup.add(lipMesh);
}

// ═══════════════════════════════════════════════
// 시작
// ═══════════════════════════════════════════════
init();
