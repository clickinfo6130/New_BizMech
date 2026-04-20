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
 *   모터류: SERVO_MOTOR (서보모터 SGM-7 계열)
 *   너트류: NUT(HNUT), FNUT
 *   와셔류: PWAS, SWAS
 *   베어링: DGBB (깊은 홈 볼 베어링)
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
let options = {
    dimensions: true,
    wireframe: false,
    grid: true
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
    chrome:      () => new THREE.MeshStandardMaterial({ color: 0xC8CDD3, metalness: 0.90, roughness: 0.12 }),
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
 * L자 케이블 생성 (커넥터 출구 → 90° 꺾임 → 긴 구간 → 끝 커넥터).
 * @param {object} opts
 *   start     : THREE.Vector3 시작점 (커넥터 출구)
 *   dir1      : 1단계 방향 ('+z', '-z', '+y', '-y', '+x', '-x')
 *   len1      : 1단계 길이
 *   dir2      : 2단계 방향 (꺾임 후)
 *   len2      : 2단계 길이
 *   dia       : 케이블 지름
 *   material  : 케이블 재질 (MAT.rubberBlack() 기본)
 *   endConnector : { w, h, d, material } — 끝 커넥터 박스 (null이면 없음)
 */
function _buildLCable(opts) {
    const { start, dir1, len1, dir2, len2, dia,
            material = MAT.rubberBlack(),
            endConnector = null } = opts;

    const dirVec = (d) => ({
        '+x': [1, 0, 0], '-x': [-1, 0, 0],
        '+y': [0, 1, 0], '-y': [0, -1, 0],
        '+z': [0, 0, 1], '-z': [0, 0, -1]
    }[d]);
    const v1 = dirVec(dir1), v2 = dirVec(dir2);
    if (!v1 || !v2) return;

    // 1단계 중심
    const mid1 = new THREE.Vector3(
        start.x + v1[0] * len1 / 2,
        start.y + v1[1] * len1 / 2,
        start.z + v1[2] * len1 / 2
    );
    // 꺾임점
    const elbow = new THREE.Vector3(
        start.x + v1[0] * len1,
        start.y + v1[1] * len1,
        start.z + v1[2] * len1
    );
    // 2단계 중심
    const mid2 = new THREE.Vector3(
        elbow.x + v2[0] * len2 / 2,
        elbow.y + v2[1] * len2 / 2,
        elbow.z + v2[2] * len2 / 2
    );
    // 끝점
    const endPt = new THREE.Vector3(
        elbow.x + v2[0] * len2,
        elbow.y + v2[1] * len2,
        elbow.z + v2[2] * len2
    );

    // 축 방향을 Y축(기본 Cylinder)에서 회전시키는 함수
    const makeAlignedCyl = (dirKey, length, mid) => {
        const g = new THREE.CylinderGeometry(dia / 2, dia / 2, length, 12);
        // Y축 → 필요 방향 회전
        if (dirKey === '+x' || dirKey === '-x') g.applyMatrix4(new THREE.Matrix4().makeRotationZ(Math.PI / 2));
        else if (dirKey === '+z' || dirKey === '-z') g.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
        // y 방향은 그대로
        const m = new THREE.Mesh(g, material.clone());
        m.position.copy(mid);
        modelGroup.add(m);
        return m;
    };

    makeAlignedCyl(dir1, len1, mid1);

    // 엘보 (구)
    const elbowGeo = new THREE.SphereGeometry(dia / 2 * 1.15, 12, 8);
    const elbowMesh = new THREE.Mesh(elbowGeo, material.clone());
    elbowMesh.position.copy(elbow);
    modelGroup.add(elbowMesh);

    makeAlignedCyl(dir2, len2, mid2);

    // 끝 커넥터
    if (endConnector) {
        const { w = dia * 2, h = dia * 2, d: ed = dia * 1.5,
                material: endMat = MAT.plasticBlack() } = endConnector;
        const eg = new THREE.BoxGeometry(w, h, ed);
        const em = new THREE.Mesh(eg, endMat);
        em.position.copy(endPt);
        modelGroup.add(em);
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
    if (code.includes('SERVO') || code.includes('SGM') || code.includes('SERVO_MOTOR')) return PART_BUILDERS.SERVO_MOTOR;
    return PART_BUILDERS.HBOLT; // 기본값
}

function updateModel(partCode, dimensions, linkedParts) {
    currentPartCode    = partCode;
    currentDimensions  = dimensions;
    currentLinkedParts = linkedParts || [];
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
        }, 200);
    }
    
    fitCameraToModel();
    logToCSharp('Model: ' + partCode + ' (' + builder.build.name + ')' +
                ' linked=' + currentLinkedParts.length);
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
    const LC   = motorDim(dims, 'LC',       40);
    const LH   = motorDim(dims, 'LH',       LC);
    const LR   = motorDim(dims, 'LR',       LC * 0.40);
    const LX   = motorDim(dims, 'LX',       LC * 2.0);
    const L1   = motorDim(dims, 'L1(LL)',   LX - LR);
    const L2   = motorDim(dims, 'L2',       L1 * 0.55);
    const L3   = motorDim(dims, 'L3',       L2 * 1.6);
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

    // 파생 치수
    const cornerR    = Math.max(LC * 0.04, 0.6);
    const endbellLen = L2 * 0.15;                    // Front Endbell (알루미늄)
    const statorLen  = L2 - endbellLen;              // Stator (강철)
    const statorIndent = Math.min(1.0, LC * 0.04);   // Stator는 Endbell보다 1mm 안쪽 (C++ 동일)

    // ★ v48: 좌표계 뒤집음 — 샤프트 +Y, 엔코더 -Y
    // (v47은 샤프트 +Y=0~LR, 엔코더가 +Y 먼 곳에 있어서 카메라와 반대)
    const shaftTipY  = LR;      // 샤프트 끝 (+Y 최대)
    const flangeY    = 0;       // 플랜지 전면
    const statorStartY = -endbellLen;
    const encoderStartY = -L2;
    const motorEndY  = -L1;     // 모터 뒤끝

    // ─── 1. 샤프트 (Y=0 ~ +LR) ───
    _buildShaftWithChamfer({
        dia: S, length: LR, posY: shaftTipY, tipTowards: 'minus',
        material: MAT.chrome()
    });

    // ─── 2. 베어링 보스 (Y=0 ~ -LE, 원형 LB) ───
    // 플랜지 전면에서 샤프트 쪽으로 약간 돌출된 원형 보스
    if (LB > 0 && LE > 0) {
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

    // ─── 5. Encoder Cap (Y=-L2 ~ -L1, 검정) ───
    {
        const encH = EnH > 0 ? EnH : LH;
        const encW = EnW > 0 ? EnW : LC;
        const encCornerR = Math.max(cornerR - 0.2, 0.3);
        const encCenterOffset = (encH - LH) / 2;  // 엔코더가 프레임보다 클 때 위로 오프셋

        _buildRoundedBox({
            w: encW, h: encH, depth: EnL,
            posY: encoderStartY - EnL,  // -L2 - EnL = -L1
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

    // ─── 7. 엔코더 커넥터 + L자 케이블 ───
    // 엔코더 상단(+Z 방향)에 커넥터 박스, 케이블이 위로 나와서 꺾여 내려감.
    // 실제 CAD 이미지 2번과 일치하도록.
    if (CW > 0 && CH > 0 && CL > 0) {
        const encH = EnH > 0 ? EnH : LH;
        const encCenterOffset = (encH - LH) / 2;
        const encMidY = encoderStartY - EnL / 2;   // 엔코더 중앙 Y
        const encTopZ = encCenterOffset + encH / 2;  // 엔코더 상단 Z

        // 커넥터 박스 (엔코더 위에 돌출)
        // ES(MD) 오프셋 적용 가능 (0이면 중앙)
        const connGeo = new THREE.BoxGeometry(CW, CH, CL);
        const connMesh = new THREE.Mesh(connGeo, MAT.plasticBlack());
        connMesh.position.set(ES, encMidY, encTopZ + CH / 2);
        modelGroup.add(connMesh);

        // L자 케이블: 커넥터 상단에서 +Z로 짧게 → -Y로 길게 (샤프트 반대 방향)
        const cableDia = Math.max(CH * 0.6, 1.5);
        const cableLen1 = CH * 1.8;          // +Z 수직 구간
        const cableLen2 = L2 * 0.6;          // -Y 수평 구간 (엔코더 뒤쪽)

        _buildLCable({
            start: new THREE.Vector3(ES, encMidY, encTopZ + CH),
            dir1: '+z', len1: cableLen1,
            dir2: '-y', len2: cableLen2,
            dia: cableDia,
            endConnector: {
                w: CW * 0.7, h: CH * 1.3, d: CL * 0.6,
                material: MAT.plasticBlack()
            }
        });
    }

    // ─── 8. 치수선 ───
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
    const LX  = motorDim(dims, 'LX',       LC * 2.0);
    const L1  = motorDim(dims, 'L1(LL)',   LX - LR);
    const L2  = motorDim(dims, 'L2',       L1 * 0.55);
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
    const hw = LC / 2;

    // ─── 길이 치수 (Y축 방향) — -X 방향 4단계 오프셋으로 분산 ───
    // 각 레벨 사이 최소 hw*0.7 간격 확보
    const xLevel1 = -(hw + LC * 0.6);   // 가장 가까운 레벨 (LR, L2 작은 것)
    const xLevel2 = -(hw + LC * 1.2);   // 중간 (L1)
    const xLevel3 = -(hw + LC * 1.8);   // 먼 (LX 전체)

    // ① LR 샤프트 돌출 — 샤프트 쪽 +Y에만 있으므로 +X 쪽에 별도 배치 (안 겹침)
    addLengthDimY(hw + LC * 0.6, flangeY, shaftTipY, 'LR', LR);

    // ② L2 플랜지 → 엔코더 시작 — 왼쪽 가장 가까운 레벨
    if (L2 > 1) {
        addLengthDimY(xLevel1, -L2, flangeY, 'L2', L2);
    }

    // ③ L1 본체 전체 — 왼쪽 중간 레벨
    addLengthDimY(xLevel2, motorEndY, flangeY, 'L1', L1);

    // ④ LX 전체 — 왼쪽 가장 먼 레벨 (가장 큰 치수)
    addLengthDimY(xLevel3, motorEndY, shaftTipY, 'LX', LX);

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
    if (EnH > LH + 1) {
        addWidthDimXY(-EnH / 2, EnH / 2, -(L2 + EnL * 0.5), -hw * 2.8, 'EnH', EnH);
    }
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

    // d (내경) — 좌측
    addHorizontalDim(-innerR, innerR, -halfB - 8, -innerR - 10, 'd', d);
    // D (외경) — 우측  
    addHorizontalDim(-outerR, outerR, halfB + 8, outerR + 10, 'D', D);
    // B (폭) — 상단
    addVerticalDim(outerR + 10, -halfB, halfB, 'B', B);
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
    const ctr = box.getCenter(new THREE.Vector3());
    const sz  = box.getSize(new THREE.Vector3());
    const mx  = Math.max(sz.x, sz.y, sz.z);
    controls.target.copy(ctr);
    camera.position.set(ctr.x + mx * 1.8, ctr.y + mx * 1.5, ctr.z + mx * 1.0);
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

function addDimLabel(x, y, z, name, val) {
    const div = document.createElement('div');
    div.className = 'dim-label';
    // ★ 굵고 진한 텍스트 스타일 적용
    div.style.fontWeight = 'bold';
    div.style.fontSize = '14px';
    div.style.color = '#1F2937';
    div.style.textShadow = '0 0 3px rgba(255,255,255,0.8)';
    div.style.fontFamily = 'Arial, sans-serif';
    div.innerHTML = '<span class="dim-label-name">' + name + '=</span><span class="dim-label-value">' + val.toFixed(1) + '</span>';
    const lbl = new CSS2DObject(div);
    lbl.position.set(x, y, z);
    dimGroup.add(lbl);
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
                logToCSharp('3D updateModel: ' + msg.partCode + ' | ' + motorLog +
                            ' | linkedParts=' + linked.length +
                            (linked.length > 0 ? ' [' + linked.map(lp =>
                                lp.partCode + '(' + lp.mateAlign + ',off=' + lp.mateOffset + ',draw=' + lp.isDrawEnabled + ')'
                            ).join(', ') + ']' : ''));
                updateModel(msg.partCode, dims, linked);
                
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
                applyOptions();
                
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
