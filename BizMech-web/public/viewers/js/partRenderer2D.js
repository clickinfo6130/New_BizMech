/**
 * PartManager 2D Part Renderer
 * ─────────────────────────────
 * HTML5 Canvas 기반 기계 부품 2D 렌더러
 * WPF WebView2 (Preview2DControl) 및 웹 브라우저 공용
 *
 * ★ C# DrawingPreviewControl.xaml.cs 로직을 JS로 포팅
 * ★ partRenderer.js(3D)와 동일한 C#↔JS 통신 프로토콜
 *
 * 지원 부품 (13종):
 *   볼트류: HBOLT, SBOLT, SRBOLT, FBOLT, FLBOLT, STBOLT, SQBOLT
 *   모터류: SERVO_MOTOR (서보모터 SGM-7 계열)
 *   너트류: NUT(HNUT), FNUT
 *   와셔류: PWAS, SWAS
 *   베어링: DGBB (깊은 홈 볼 베어링)
 *
 * 뷰 타입: Front2D (정면도), Side2D (측면도), Top2D (평면도)
 */

// ═══════════════════════════════════════════════
// 전역 상태
// ═══════════════════════════════════════════════

let canvas, ctx;
let currentPartCode = '';
let currentDimensions = {};
let currentViewType = 'Front2D';
let showDimensions = true;
let currentLinkedParts = [];   // ★ 연결부품 목록 { partCode, dimensions, isDrawEnabled, ... }

// ── 색상 (C# Brush 대응) ──
const COLOR = {
    outline:    '#000000',     // OutlineBrush (Black)
    centerLine: '#FF0000',     // CenterLineBrush (Red)
    hiddenLine: '#808080',     // HiddenLineBrush (Gray)
    dimension:  '#0055FF',     // DimensionBrush (Blue)
    hatch:      '#A0A0A0',     // HatchBrush (LightGray)
    fill:       '#FFFFFF',     // 면 채우기 (White)
    background: '#F8F9FA',     // 배경
    ball:       '#D0D4D8',     // 베어링 볼 채우기
    // ★ 연결부품
    linked_shaft:   '#7B9EC0',              // 축 외형선
    linked_fill:    'rgba(123,158,192,0.25)', // 축 채우기
    linked_housing: 'rgba(139,115,85,0.30)',  // 하우징 채우기
};

const LINE = {
    outline:  1.5,
    hidden:   0.8,
    center:   0.5,
    dim:      0.8,
    dimExt:   0.6,
    hatch:    0.5,
};

// 중심선 대시 패턴 (C#: 10,3,2,3)
const DASH_CENTER = [10, 3, 2, 3];
const DASH_HIDDEN = [4, 2];

// ═══════════════════════════════════════════════
// 초기화
// ═══════════════════════════════════════════════

function init() {
    canvas = document.getElementById('canvas2d');
    if (!canvas) return;
    ctx = canvas.getContext('2d');

    // 고해상도 대응
    resizeCanvas();
    window.addEventListener('resize', () => { resizeCanvas(); redraw(); });

    logToCSharp('2D Canvas viewer initialized (12 part types)');

    // ★ C#에 준비 완료 알림 (Preview3DControl과 동일 프로토콜)
    sendToCSharp({ type: 'ready' });
}

function resizeCanvas() {
    const container = canvas.parentElement || document.body;
    const w = container.clientWidth  || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    const dpr = window.devicePixelRatio || 1;

    canvas.width  = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width  = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// ═══════════════════════════════════════════════
// 부품 빌더 테이블 (실제 시스템 코드 기준)
// ═══════════════════════════════════════════════

const PART_BUILDERS_2D = {
    // ★ 베어링
    DGBB:   { front: drawDGBB_Front,   side: drawDGBB_Front,   top: drawDGBB_Top   },
    ACBB:   { front: drawANBB_Front,   side: drawANBB_Front,   top: drawDGBB_Top   },
    STRB:   { front: drawTRBR_Front,   side: drawTRBR_Front,   top: drawTRBR_Top   },
    SCRB:   { front: drawCYLR_Front,   side: drawCYLR_Front,   top: drawDGBB_Top   },
    STBB:   { front: drawTHRB_Front,   side: drawTHRB_Front,   top: drawTHRB_Top   },
    SARB:   { front: drawSRRB_Front,   side: drawSRRB_Front,   top: drawDGBB_Top   },
    UCB:   { front: drawUNIT_Front,   side: drawUNIT_Front,   top: drawUNIT_Top   },
    UCP:   { front: drawPILB_Front,   side: drawPILB_Side,    top: drawPILB_Top   },

    // ── 오일리스 베어링 계열 ─────────────────────────────────
    'SWURB':  { front: drawOilless_Front, side: drawOilless_Front, top: drawOilless_Top },  // 오일리스 베어링
    'SWURFB':  { front: drawOilless_Front, side: drawOilless_Front, top: drawOilless_Top },  // 오일리스 베어링
    'SWURW':  { front: drawOilless_Front, side: drawOilless_Front, top: drawOilless_Top },  // 오일리스 베어링
    'SWURZB':  { front: drawOilless_Front, side: drawOilless_Front, top: drawOilless_Top },  // 오일리스 베어링
    'SWURSP':  { front: drawOilless_Front, side: drawOilless_Front, top: drawOilless_Top },  // 오일리스 베어링
    'SWURSL':  { front: drawOilless_Front, side: drawOilless_Front, top: drawOilless_Top },  // 오일리스 베어링
    'SWURFF':  { front: drawOilless_Front, side: drawOilless_Front, top: drawOilless_Top },  // 오일리스 베어링
    'SWUROB':  { front: drawOilless_Front, side: drawOilless_Front, top: drawOilless_Top },  // 오일리스 베어링
    'SWURWP':  { front: drawOilless_Front, side: drawOilless_Front, top: drawOilless_Top },  // 오일리스 베어링
    'SWUCBP':  { front: drawOilless_Front, side: drawOilless_Front, top: drawOilless_Top },  // 오일리스 베어링
    'SWURSCBP':  { front: drawOilless_Front, side: drawOilless_Front, top: drawOilless_Top },  // 오일리스 베어링
    'DRYBUSH':  { front: drawOilless_Front, side: drawOilless_Front, top: drawOilless_Top },  // 오일리스 베어링
    'DRYFBUSH':  { front: drawOilless_Front, side: drawOilless_Front, top: drawOilless_Top },  // 오일리스 베어링
    'DRYTWAS':  { front: drawOilless_Front, side: drawOilless_Front, top: drawOilless_Top },  // 오일리스 베어링
    'LUBOHB':  { front: drawOilless_Front, side: drawOilless_Front, top: drawOilless_Top },  // 오일리스 베어링
    'LUBOHBF':  { front: drawOilless_Front, side: drawOilless_Front, top: drawOilless_Top },  // 오일리스 베어링
    'LUBOTW':  { front: drawOilless_Front, side: drawOilless_Front, top: drawOilless_Top },  // 오일리스 베어링
    'LUBOLBGS':  { front: drawOilless_Front, side: drawOilless_Front, top: drawOilless_Top },  // 오일리스 베어링
    'LUBOLBTB':  { front: drawOilless_Front, side: drawOilless_Front, top: drawOilless_Top },  // 오일리스 베어링
    'LUBOGPP':  { front: drawOilless_Front, side: drawOilless_Front, top: drawOilless_Top },  // 오일리스 베어링
    'LUBOHGB':  { front: drawOilless_Front, side: drawOilless_Front, top: drawOilless_Top },  // 오일리스 베어링
    'LUBOHFB':  { front: drawOilless_Front, side: drawOilless_Front, top: drawOilless_Top },  // 오일리스 베어링
    'LUBOLBG':  { front: drawOilless_Front, side: drawOilless_Front, top: drawOilless_Top },  // 오일리스 베어링
    'LUBOLBFG':  { front: drawOilless_Front, side: drawOilless_Front, top: drawOilless_Top },  // 오일리스 베어링
    'LUBOLEBG':  { front: drawOilless_Front, side: drawOilless_Front, top: drawOilless_Top },  // 오일리스 베어링
    'LUBOLUBS':  { front: drawOilless_Front, side: drawOilless_Front, top: drawOilless_Top },  // 오일리스 베어링
    SD:     { front: drawSD_Front,     side: drawSD_Side,      top: drawSD_Top     },
    SN:     { front: drawSD_Front,     side: drawSD_Side,      top: drawSD_Top     },
    UCF:   { front: drawFLBU_Front,   side: drawFLBU_Front,   top: drawFLBU_Top   },

    // ── 볼베어링 변형 계열 ───────────────────────────────────────
    MNBB:   { front: drawDGBB_Front,   side: drawDGBB_Front,   top: drawDGBB_Top   },
    ENBB:   { front: drawDGBB_Front,   side: drawDGBB_Front,   top: drawDGBB_Top   },
    MIBB:   { front: drawDGBB_Front,   side: drawDGBB_Front,   top: drawDGBB_Top   },
    HLDTBB:   { front: drawDGBB_Front,   side: drawDGBB_Front,   top: drawDGBB_Top   },
    FPCBB:   { front: drawQPBB_Front,   side: drawDGBB_Front,   top: drawDGBB_Top   },
    SABB:   { front: drawSRRB_Front,   side: drawSRRB_Front,   top: drawDGBB_Top   },

    // ── 앵귤러 볼베어링 변형 ─────────────────────────────────────
    DACBB:   { front: drawDANB_Front,   side: drawDANB_Front,   top: drawDGBB_Top   },
    MACBB:   { front: drawDANB_Front,   side: drawDANB_Front,   top: drawDGBB_Top   },
    HACCBB:   { front: drawANBB_Front,   side: drawANBB_Front,   top: drawDGBB_Top   },
    UHSACBB:   { front: drawANBB_Front,   side: drawANBB_Front,   top: drawDGBB_Top   },
    HRTBB:   { front: drawANBB_Front,   side: drawANBB_Front,   top: drawDGBB_Top   },

    // ── 원통/테이퍼 롤러 변형 ────────────────────────────────────
    DCRB:   { front: drawDCYL_Front,   side: drawDCYL_Front,   top: drawDGBB_Top   },
    FDCORB:   { front: drawDCYL_Front,   side: drawDCYL_Front,   top: drawDGBB_Top   },
    FDCGRB:   { front: drawDCYL_Front,   side: drawDCYL_Front,   top: drawDGBB_Top   },
    PSCRB:   { front: drawCYLR_Front,   side: drawCYLR_Front,   top: drawDGBB_Top   },
    PDCRB:   { front: drawDCYL_Front,   side: drawDCYL_Front,   top: drawDGBB_Top   },
    DTRB:   { front: drawDTRB_Front,   side: drawDTRB_Front,   top: drawTRBR_Top   },
    DRBB:   { front: drawDCYL_Front,   side: drawDCYL_Front,   top: drawDGBB_Top   },

    // ── 니들 롤러 베어링 ─────────────────────────────────────────
    LMSNRB:   { front: drawNRBR_Front,   side: drawNRBR_Front,   top: drawDGBB_Top   },
    LMSNRB:   { front: drawNRBR_Front,   side: drawNRBR_Front,   top: drawDGBB_Top   },
    CNRB:   { front: drawNRBR_Front,   side: drawNRBR_Front,   top: drawDGBB_Top   },
    SHNRB:   { front: drawNRBR_Front,   side: drawNRBR_Front,   top: drawDGBB_Top   },

    // ── 트러스트 계열 ─────────────────────────────────────────────
    DTBB:   { front: drawDTHB_Front,   side: drawDTHB_Front,   top: drawTHRB_Top   },
    DTABB:   { front: drawDTAB_Front,   side: drawDTAB_Front,   top: drawTHRB_Top   },
    TCRB:   { front: drawTHCR_Front,   side: drawTHCR_Front,   top: drawTHRB_Top   },
    TSARB:   { front: drawDTHB_Front,   side: drawDTHB_Front,   top: drawTHRB_Top   },
    TNRB:   { front: drawTHNR_Front,   side: drawTHNR_Front,   top: drawTHRB_Top   },
    TCNRB:   { front: drawDTHB_Front,   side: drawDTHB_Front,   top: drawTHRB_Top   },
    HSTACBB:   { front: drawDTAB_Front,   side: drawDTAB_Front,   top: drawTHRB_Top   },
    TACBB:   { front: drawDTAB_Front,   side: drawDTAB_Front,   top: drawTHRB_Top   },
    DDTACBB:   { front: drawDTAB_Front,   side: drawDTAB_Front,   top: drawTHRB_Top   },

    // ── 오일씰 ────────────────────────────────────────────────────
    OSEAL:  { front: drawOSEAL_Front,  side: drawOSEAL_Front,  top: drawOSEAL_Top  },

    // ── UC/UK 인서트+하우징 계열 ──────────────────────────────────
    UKB:   { front: drawUNIT_Front,   side: drawUNIT_Front,   top: drawUNIT_Top   },
    UKP:   { front: drawPILB_Front,   side: drawPILB_Side,    top: drawPILB_Top   },
    UKF:   { front: drawFLBU_Front,   side: drawFLBU_Front,   top: drawFLBU_Top   },
    UCFC:   { front: drawFCBB_Front,   side: drawFLBU_Front,   top: drawFLBU_Top   },
    UKFC:   { front: drawFCBB_Front,   side: drawFLBU_Front,   top: drawFLBU_Top   },
    UCFL:   { front: drawFLBB_Front,   side: drawFLBU_Front,   top: drawFLBU_Top   },
    UKFL:   { front: drawFLBB_Front,   side: drawFLBU_Front,   top: drawFLBU_Top   },
    UCFS:   { front: drawFSBB_Front,   side: drawFLBU_Front,   top: drawFSBB_Top   },
    UKFS:   { front: drawFSBB_Front,   side: drawFLBU_Front,   top: drawFSBB_Top   },
    UCT:   { front: drawUCTU_Front,   side: drawUCTU_Side,    top: drawUCTU_Top   },
    UKT:   { front: drawUCTU_Front,   side: drawUCTU_Side,    top: drawUCTU_Top   },
    UCC:   { front: drawUCCA_Front,   side: drawUCCA_Front,   top: drawFLBU_Top   },
    UKC:   { front: drawUCCA_Front,   side: drawUCCA_Front,   top: drawFLBU_Top   },
    // 모터
    SERVO_MOTOR: { front: drawServoMotor_Front, side: drawServoMotor_Side, top: drawServoMotor_Top },
    // 볼트 (구체적 코드 먼저)
    SBOLT:  { front: drawSBolt_Front,  side: drawSBolt_Front,  top: drawSBolt_Top  },
    SRBOLT: { front: drawSRBolt_Front, side: drawSRBolt_Front, top: drawSBolt_Top  },
    FBOLT:  { front: drawFBolt_Front,  side: drawFBolt_Front,  top: drawSBolt_Top  },
    FLBOLT: { front: drawFLBolt_Front, side: drawFLBolt_Side,  top: drawFLBolt_Top },
    STBOLT: { front: drawSTBolt_Front, side: drawSTBolt_Front, top: drawSTBolt_Top },
    SQBOLT: { front: drawSQBolt_Front, side: drawSQBolt_Front, top: drawSQBolt_Top },
    HBOLT:  { front: drawHBolt_Front,  side: drawHBolt_Side,   top: drawHBolt_Top  },
    // 너트
    FNUT:   { front: drawFNut_Front,   side: drawFNut_Front,   top: drawFNut_Top   },
    HNUT:   { front: drawNut_Front,    side: drawNut_Front,    top: drawNut_Top    },
    NUT:    { front: drawNut_Front,    side: drawNut_Front,    top: drawNut_Top    },
    // 와셔
    SWAS:   { front: drawSWas_Front,   side: drawSWas_Front,   top: drawSWas_Top   },
    PWAS:   { front: drawPWas_Front,   side: drawPWas_Front,   top: drawPWas_Top   },
};

function findBuilder2D(partCode) {
    const code = partCode.toUpperCase();
    // 1. 정확 매칭
    for (const key of Object.keys(PART_BUILDERS_2D)) {
        if (code === key || code.startsWith(key)) return PART_BUILDERS_2D[key];
    }
    // 2. 베어링 포함 매칭
    if (code.includes('ANBB') || code.includes('ANGULAR'))         return PART_BUILDERS_2D.ANBB;
    if (code.includes('TRBR') || code.includes('TAPER'))           return PART_BUILDERS_2D.TRBR;
    if (code.includes('CYLR') || code.includes('CYLINDRICAL'))     return PART_BUILDERS_2D.CYLR;
    if (code.includes('THRB') || code.includes('THRUST'))          return PART_BUILDERS_2D.THRB;
    if (code.includes('SRRB') || code.includes('SELF'))            return PART_BUILDERS_2D.SRRB;
    if (code === 'SD' || code.startsWith('SD') || code === 'SN' || code.startsWith('SN'))
                                                                    return PART_BUILDERS_2D.SD;
    if (code.includes('PILB') || code.includes('PILLOW'))          return PART_BUILDERS_2D.PILB;
    if (code.includes('FLBU'))                                      return PART_BUILDERS_2D.FLBU;
    if (code.includes('UNIT') || code.includes('INSERT'))          return PART_BUILDERS_2D.UNIT;
    if (code.includes('DGBB') || code.includes('DEEPGROOVE'))      return PART_BUILDERS_2D.DGBB;
    // 모터
    if (code.includes('SERVO') || code.includes('SGM') || code.includes('SERVO_MOTOR')) return PART_BUILDERS_2D.SERVO_MOTOR;
    if (code.includes('SBOLT') || code.includes('SOCKET'))       return PART_BUILDERS_2D.SBOLT;
    if (code.includes('SRBOLT') || code.includes('BUTTON'))      return PART_BUILDERS_2D.SRBOLT;
    if (code.includes('FBOLT') || code.includes('COUNTERSUNK'))  return PART_BUILDERS_2D.FBOLT;
    if (code.includes('FLBOLT'))                                  return PART_BUILDERS_2D.FLBOLT;
    if (code.includes('STBOLT') || code.includes('STUD'))        return PART_BUILDERS_2D.STBOLT;
    if (code.includes('SQBOLT') || code.includes('SQUARE'))      return PART_BUILDERS_2D.SQBOLT;
    if (code.includes('HBOLT') || code.includes('BOLT'))         return PART_BUILDERS_2D.HBOLT;
    if (code.includes('FNUT'))                                    return PART_BUILDERS_2D.FNUT;
    if (code.includes('NUT'))                                     return PART_BUILDERS_2D.HNUT;
    if (code.includes('SWAS') || code.includes('SPRING'))        return PART_BUILDERS_2D.SWAS;
    if (code.includes('PWAS') || code.includes('WASHER'))        return PART_BUILDERS_2D.PWAS;
    return PART_BUILDERS_2D.HBOLT;
}

// ═══════════════════════════════════════════════
// 모델 업데이트 & 렌더
// ═══════════════════════════════════════════════

function updateModel(partCode, dimensions, linkedParts, viewType) {
    currentPartCode    = partCode;
    currentDimensions  = dimensions;
    currentLinkedParts = linkedParts || [];    // ★ 연결부품 저장
    if (viewType) currentViewType = viewType;
    redraw();
    logToCSharp('Model: ' + partCode + ' view=' + currentViewType +
                ' linked=' + currentLinkedParts.length);
}

function redraw() {
    if (!ctx) return;
    const W = canvas.width / (window.devicePixelRatio || 1);
    const H = canvas.height / (window.devicePixelRatio || 1);

    // 배경
    ctx.fillStyle = COLOR.background;
    ctx.fillRect(0, 0, W, H);

    if (!currentPartCode) { drawEmptyState(W, H); return; }

    const builder = findBuilder2D(currentPartCode);
    const dims = currentDimensions;
    const vt = currentViewType;

    // 뷰 타입별 분기
    if (vt === 'Top2D' && builder.top) {
        builder.top(dims, W, H);
    } else if (vt === 'Side2D' && builder.side) {
        builder.side(dims, W, H);
    } else {
        builder.front(dims, W, H);
    }

    // ★ 연결부품 렌더링 (주 부품 위에 덮어 그림)
    drawLinkedParts2D(dims, W, H);

    // 상태 표시
    drawStatusBar(W, H, currentPartCode, currentViewType);
}

function drawEmptyState(W, H) {
    ctx.fillStyle = '#999';
    ctx.font = '14px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('부품을 선택하세요', W / 2, H / 2);
}

function drawStatusBar(W, H, partCode, viewType) {
    ctx.fillStyle = 'rgba(0,0,0,0.05)';
    ctx.fillRect(0, H - 24, W, 24);
    ctx.fillStyle = '#666';
    ctx.font = '11px "Segoe UI", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(partCode + '  |  ' + viewType, 8, H - 7);
    // JS badge
    ctx.fillStyle = '#2563EB';
    ctx.fillRect(W - 30, H - 20, 24, 14);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('JS', W - 18, H - 10);
}

// ═══════════════════════════════════════════════
// 공용 치수 추출 헬퍼
// ═══════════════════════════════════════════════

function dimVal(dims, key, def) {
    if (!dims) return def;
    const upper = key.toUpperCase();
    for (const k of Object.keys(dims)) {
        if (k.toUpperCase() === upper) {
            const v = parseFloat(dims[k]);
            return isNaN(v) || v <= 0 ? def : v;
        }
    }
    return def;
}

/** 부품별 스케일 계산 (캔버스에 맞춤) */
function calcScale(maxPartDim, W, H, margin) {
    margin = margin || 0.5;
    return Math.min(W, H) * margin / maxPartDim;
}

function fmtDim(v) { return Math.abs(v - Math.round(v)) < 0.001 ? v.toFixed(0) : v.toFixed(2); }

// ═══════════════════════════════════════════════
// 공용 Canvas 드로잉 헬퍼
// ═══════════════════════════════════════════════

function drawLine(x1, y1, x2, y2, color, width, dash) {
    ctx.beginPath();
    ctx.strokeStyle = color || COLOR.outline;
    ctx.lineWidth = width || LINE.outline;
    ctx.setLineDash(dash || []);
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.setLineDash([]);
}

function drawRect(x, y, w, h, fillColor, strokeColor, lineWidth) {
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.fillStyle = fillColor || COLOR.fill;
    ctx.fill();
    ctx.strokeStyle = strokeColor || COLOR.outline;
    ctx.lineWidth = lineWidth || LINE.outline;
    ctx.stroke();
}

function drawCircle(cx, cy, r, color, width, dash, fill) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    ctx.strokeStyle = color || COLOR.outline;
    ctx.lineWidth = width || LINE.outline;
    ctx.setLineDash(dash || []);
    ctx.stroke();
    ctx.setLineDash([]);
}

function drawArc(cx, cy, r, startAngle, endAngle, color, width, ccw) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAngle, endAngle, ccw);
    ctx.strokeStyle = color || COLOR.outline;
    ctx.lineWidth = width || LINE.outline;
    ctx.stroke();
}

function drawPolygon(points, color, width, fill) {
    if (points.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
    ctx.closePath();
    ctx.fillStyle = fill || COLOR.fill;
    ctx.fill();
    ctx.strokeStyle = color || COLOR.outline;
    ctx.lineWidth = width || LINE.outline;
    ctx.stroke();
}

function drawCenterCross(cx, cy, extent) {
    drawLine(cx - extent, cy, cx + extent, cy, COLOR.centerLine, LINE.center, DASH_CENTER);
    drawLine(cx, cy - extent, cx, cy + extent, COLOR.centerLine, LINE.center, DASH_CENTER);
}

function drawCenterLineV(cx, y1, y2) {
    drawLine(cx, y1, cx, y2, COLOR.centerLine, LINE.center, DASH_CENTER);
}

function drawCenterLineH(x1, x2, cy) {
    drawLine(x1, cy, x2, cy, COLOR.centerLine, LINE.center, DASH_CENTER);
}

/** 육각형 꼭지점 배열 */
function hexPoints(cx, cy, S) {
    const r = S / 2 / Math.cos(Math.PI / 6);
    const pts = [];
    for (let i = 0; i < 6; i++) {
        const a = Math.PI / 6 + i * Math.PI / 3;
        pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return pts;
}

// ═══════════════════════════════════════════════
// 치수선 시스템
// ═══════════════════════════════════════════════

function drawHDim(x1, x2, y, offset, name, value) {
    const dimY = y + offset;
    const dir = offset > 0 ? 1 : -1;
    // 연장선
    drawLine(x1, y + dir * 3, x1, dimY + dir * 4, COLOR.dimension, LINE.dimExt);
    drawLine(x2, y + dir * 3, x2, dimY + dir * 4, COLOR.dimension, LINE.dimExt);
    // 치수선
    drawLine(x1, dimY, x2, dimY, COLOR.dimension, LINE.dim);
    // 화살표
    drawArrowH(x1, dimY, true);
    drawArrowH(x2, dimY, false);
    // 텍스트
    const txt = name + '=' + fmtDim(value);
    ctx.font = '11px "Segoe UI", sans-serif';
    ctx.fillStyle = COLOR.dimension;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // 배경
    const tw = ctx.measureText(txt).width + 4;
    ctx.fillStyle = COLOR.background;
    ctx.fillRect((x1 + x2) / 2 - tw / 2, dimY - 7, tw, 14);
    ctx.fillStyle = COLOR.dimension;
    ctx.fillText(txt, (x1 + x2) / 2, dimY);
}

function drawVDim(y1, y2, x, offset, name, value) {
    const dimX = x + offset;
    const dir = offset > 0 ? 1 : -1;
    drawLine(x + dir * 3, y1, dimX + dir * 4, y1, COLOR.dimension, LINE.dimExt);
    drawLine(x + dir * 3, y2, dimX + dir * 4, y2, COLOR.dimension, LINE.dimExt);
    drawLine(dimX, y1, dimX, y2, COLOR.dimension, LINE.dim);
    drawArrowV(dimX, y1, true);
    drawArrowV(dimX, y2, false);
    // 텍스트 (회전)
    const txt = name + '=' + fmtDim(value);
    ctx.save();
    ctx.translate(dimX, (y1 + y2) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.font = '11px "Segoe UI", sans-serif';
    const tw = ctx.measureText(txt).width + 4;
    ctx.fillStyle = COLOR.background;
    ctx.fillRect(-tw / 2, -7, tw, 14);
    ctx.fillStyle = COLOR.dimension;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(txt, 0, 0);
    ctx.restore();
}

function drawArrowH(x, y, pointRight) {
    const sz = 5, dir = pointRight ? 1 : -1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - dir * sz, y - sz / 2);
    ctx.lineTo(x - dir * sz, y + sz / 2);
    ctx.closePath();
    ctx.fillStyle = COLOR.dimension;
    ctx.fill();
}

function drawArrowV(x, y, pointDown) {
    const sz = 5, dir = pointDown ? 1 : -1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - sz / 2, y - dir * sz);
    ctx.lineTo(x + sz / 2, y - dir * sz);
    ctx.closePath();
    ctx.fillStyle = COLOR.dimension;
    ctx.fill();
}

// ═══════════════════════════════════════════════
// ① HBOLT — 육각볼트
// ═══════════════════════════════════════════════

function drawHBolt_Front(dims, W, H) {
    const D = dimVal(dims, 'D', 10), L = dimVal(dims, 'L', 50);
    const S = dimVal(dims, 'S', D * 1.5), K = dimVal(dims, 'K', D * 0.7);
    const sc = calcScale(Math.max(S, L + K), W, H);
    const ds = D * sc, ls = L * sc, ss = S * sc, ks = K * sc;
    const cx = W / 2, cy = H / 2;
    const totalH = ls + ks, topY = cy - totalH / 2;

    // 머리
    drawRect(cx - ss / 2, topY, ss, ks);
    // 모따기
    drawLine(cx - ss / 2, topY, cx - ss / 2 + ks * 0.3, topY + ks * 0.15, COLOR.outline, 1.0);
    drawLine(cx + ss / 2, topY, cx + ss / 2 - ks * 0.3, topY + ks * 0.15, COLOR.outline, 1.0);
    // 몸체
    drawRect(cx - ds / 2, topY + ks, ds, ls);
    // 중심선
    drawCenterLineV(cx, topY - 15, topY + totalH + 15);

    if (showDimensions) {
        drawHDim(cx - ds / 2, cx + ds / 2, topY + ks + ls / 2, 30, 'D', D);
        drawVDim(topY + ks, topY + ks + ls, cx + ds / 2, 50, 'L', L);
        drawHDim(cx - ss / 2, cx + ss / 2, topY, -30, 'S', S);
        drawVDim(topY, topY + ks, cx - ss / 2, -30, 'K', K);
    }
}

function drawHBolt_Side(dims, W, H) {
    const D = dimVal(dims, 'D', 10), L = dimVal(dims, 'L', 50);
    const S = dimVal(dims, 'S', D * 1.5), K = dimVal(dims, 'K', D * 0.7);
    const sc = calcScale(Math.max(S, L + K), W, H);
    const ds = D * sc, ls = L * sc, ss = S * sc, ks = K * sc;
    const cx = W / 2, cy = H / 2;
    const totalH = ls + ks, topY = cy - totalH / 2;
    const hexW = ss * 0.866;

    // 머리 (사다리꼴)
    drawPolygon([
        [cx - hexW / 2, topY], [cx + hexW / 2, topY],
        [cx + ss / 2, topY + ks * 0.25], [cx + ss / 2, topY + ks],
        [cx - ss / 2, topY + ks], [cx - ss / 2, topY + ks * 0.25]
    ]);
    drawRect(cx - ds / 2, topY + ks, ds, ls);
    drawCenterLineV(cx, topY - 15, topY + totalH + 15);

    if (showDimensions) {
        drawHDim(cx - ds / 2, cx + ds / 2, topY + ks + ls / 2, 30, 'D', D);
        drawVDim(topY + ks, topY + ks + ls, cx + ds / 2, 50, 'L', L);
        drawVDim(topY, topY + ks, cx - ss / 2, -30, 'K', K);
    }
}

function drawHBolt_Top(dims, W, H) {
    const D = dimVal(dims, 'D', 10), S = dimVal(dims, 'S', D * 1.5);
    const sc = calcScale(S, W, H);
    const ds = D * sc, ss = S * sc;
    const cx = W / 2, cy = H / 2;

    drawPolygon(hexPoints(cx, cy, ss));
    drawCircle(cx, cy, ds / 2);
    drawCenterCross(cx, cy, ss / 2 + 15);

    if (showDimensions) {
        drawHDim(cx - ss / 2, cx + ss / 2, cy, ss / 2 + 25, 'S', S);
        drawHDim(cx - ds / 2, cx + ds / 2, cy, -ds / 2 - 25, 'D', D);
    }
}

// ═══════════════════════════════════════════════
// ② SBOLT — 소켓볼트
// ═══════════════════════════════════════════════

function drawSBolt_Front(dims, W, H) {
    const D = dimVal(dims, 'D', 10), L = dimVal(dims, 'L', 40);
    const DK = dimVal(dims, 'DK', D * 1.5), K = dimVal(dims, 'K', D * 0.7);
    const S = dimVal(dims, 'S', D * 0.8);
    const sc = calcScale(Math.max(DK, L + K), W, H);
    const ds = D * sc, ls = L * sc, dks = DK * sc, ks = K * sc, ss = S * sc;
    const cx = W / 2, cy = H / 2;
    const totalH = ls + ks, topY = cy - totalH / 2;

    // 원통머리
    drawRect(cx - dks / 2, topY, dks, ks);
    // 소켓홈 (점선)
    const sockD = ks * 0.5;
    drawLine(cx - ss / 2, topY, cx - ss / 2, topY + sockD, COLOR.hiddenLine, LINE.hidden, DASH_HIDDEN);
    drawLine(cx + ss / 2, topY, cx + ss / 2, topY + sockD, COLOR.hiddenLine, LINE.hidden, DASH_HIDDEN);
    drawLine(cx - ss / 2, topY + sockD, cx + ss / 2, topY + sockD, COLOR.hiddenLine, LINE.hidden, DASH_HIDDEN);
    // 모따기
    const ch = ks * 0.1;
    drawLine(cx - dks / 2, topY, cx - dks / 2 + ch, topY + ch, COLOR.outline, 1.0);
    drawLine(cx + dks / 2, topY, cx + dks / 2 - ch, topY + ch, COLOR.outline, 1.0);
    // 몸체
    drawRect(cx - ds / 2, topY + ks, ds, ls);
    drawCenterLineV(cx, topY - 15, topY + totalH + 15);

    if (showDimensions) {
        drawHDim(cx - ds / 2, cx + ds / 2, topY + ks + ls / 2, 30, 'D', D);
        drawVDim(topY + ks, topY + ks + ls, cx + ds / 2, 50, 'L', L);
        drawHDim(cx - dks / 2, cx + dks / 2, topY, -30, 'Dk', DK);
        drawVDim(topY, topY + ks, cx - dks / 2, -30, 'K', K);
    }
}

function drawSBolt_Top(dims, W, H) {
    const D = dimVal(dims, 'D', 10), DK = dimVal(dims, 'DK', D * 1.5);
    const S = dimVal(dims, 'S', D * 0.8);
    const sc = calcScale(DK, W, H);
    const ds = D * sc, dks = DK * sc, ss = S * sc;
    const cx = W / 2, cy = H / 2;

    drawCircle(cx, cy, dks / 2);
    drawCircle(cx, cy, ds / 2);
    drawPolygon(hexPoints(cx, cy, ss), COLOR.hiddenLine, LINE.hidden);
    drawCenterCross(cx, cy, dks / 2 + 15);

    if (showDimensions) {
        drawHDim(cx - dks / 2, cx + dks / 2, cy, dks / 2 + 25, 'Dk', DK);
        drawHDim(cx - ds / 2, cx + ds / 2, cy, -ds / 2 - 25, 'D', D);
    }
}

// ═══════════════════════════════════════════════
// ③ SRBOLT — 버튼볼트 (반구 머리)
// ═══════════════════════════════════════════════

function drawSRBolt_Front(dims, W, H) {
    const D = dimVal(dims, 'D', 10), L = dimVal(dims, 'L', 40);
    const DK = dimVal(dims, 'DK', D * 1.5), K = dimVal(dims, 'K', D * 0.5);
    const sc = calcScale(Math.max(DK, L + K), W, H);
    const ds = D * sc, ls = L * sc, dks = DK * sc, ks = K * sc;
    const cx = W / 2, cy = H / 2;
    const totalH = ls + ks, topY = cy - totalH / 2;
    const headBot = topY + ks;

    // 돔 머리 (아크)
    ctx.beginPath();
    ctx.moveTo(cx - dks / 2, headBot);
    ctx.quadraticCurveTo(cx - dks / 2, topY, cx, topY);
    ctx.quadraticCurveTo(cx + dks / 2, topY, cx + dks / 2, headBot);
    ctx.lineTo(cx - dks / 2, headBot);
    ctx.closePath();
    ctx.fillStyle = COLOR.fill; ctx.fill();
    ctx.strokeStyle = COLOR.outline; ctx.lineWidth = LINE.outline; ctx.stroke();

    // 몸체
    drawRect(cx - ds / 2, headBot, ds, ls);
    drawCenterLineV(cx, topY - 15, headBot + ls + 15);

    if (showDimensions) {
        drawHDim(cx - ds / 2, cx + ds / 2, headBot + ls / 2, 30, 'D', D);
        drawVDim(headBot, headBot + ls, cx + ds / 2, 50, 'L', L);
        drawHDim(cx - dks / 2, cx + dks / 2, headBot, -30 - ks, 'Dk', DK);
        drawVDim(topY, topY + ks, cx - dks / 2, -30, 'K', K);
    }
}

// ═══════════════════════════════════════════════
// ④ FBOLT — 접시머리볼트 (역사다리꼴)
// ═══════════════════════════════════════════════

function drawFBolt_Front(dims, W, H) {
    const D = dimVal(dims, 'D', 10), L = dimVal(dims, 'L', 40);
    const DK = dimVal(dims, 'DK', D * 1.8), K = dimVal(dims, 'K', D * 0.35);
    const sc = calcScale(Math.max(DK, L + K), W, H);
    const ds = D * sc, ls = L * sc, dks = DK * sc, ks = K * sc;
    const cx = W / 2, cy = H / 2;
    const totalH = ls + ks, topY = cy - totalH / 2;

    // 역사다리꼴 머리
    drawPolygon([
        [cx - dks / 2, topY], [cx + dks / 2, topY],
        [cx + ds / 2, topY + ks], [cx - ds / 2, topY + ks]
    ]);
    drawRect(cx - ds / 2, topY + ks, ds, ls);
    drawCenterLineV(cx, topY - 15, topY + totalH + 15);

    if (showDimensions) {
        drawHDim(cx - ds / 2, cx + ds / 2, topY + ks + ls / 2, 30, 'D', D);
        drawVDim(topY + ks, topY + ks + ls, cx + ds / 2, 50, 'L', L);
        drawHDim(cx - dks / 2, cx + dks / 2, topY, -30, 'Dk', DK);
        drawVDim(topY, topY + ks, cx - dks / 2, -30, 'K', K);
    }
}

// ═══════════════════════════════════════════════
// ⑤ FLBOLT — 플랜지볼트
// ═══════════════════════════════════════════════

function drawFLBolt_Front(dims, W, H) {
    const D = dimVal(dims, 'D', 10), L = dimVal(dims, 'L', 40);
    const S = dimVal(dims, 'S', D * 1.5), K = dimVal(dims, 'K', D * 0.7);
    const DF = dimVal(dims, 'DF', D * 2.2), KF = dimVal(dims, 'KF', K * 0.3);
    const sc = calcScale(Math.max(DF, L + K), W, H);
    const ds = D * sc, ls = L * sc, ss = S * sc, ks = K * sc, dfs = DF * sc, kfs = KF * sc;
    const cx = W / 2, cy = H / 2;
    const headK = ks - kfs, totalH = ls + ks, topY = cy - totalH / 2;

    // 육각머리
    drawRect(cx - ss / 2, topY, ss, headK);
    const ch = headK * 0.15;
    drawLine(cx - ss / 2, topY, cx - ss / 2 + ch, topY + ch, COLOR.outline, 1.0);
    drawLine(cx + ss / 2, topY, cx + ss / 2 - ch, topY + ch, COLOR.outline, 1.0);
    // 플랜지
    drawRect(cx - dfs / 2, topY + headK, dfs, kfs);
    // 몸체
    drawRect(cx - ds / 2, topY + ks, ds, ls);
    drawCenterLineV(cx, topY - 15, topY + totalH + 15);

    if (showDimensions) {
        drawHDim(cx - ds / 2, cx + ds / 2, topY + ks + ls / 2, 30, 'D', D);
        drawVDim(topY + ks, topY + ks + ls, cx + ds / 2, 50, 'L', L);
        drawHDim(cx - ss / 2, cx + ss / 2, topY, -30, 'S', S);
        drawVDim(topY, topY + ks, cx - dfs / 2, -30, 'K', K);
        drawHDim(cx - dfs / 2, cx + dfs / 2, topY + headK + kfs / 2, dfs / 2 + 20, 'Df', DF);
    }
}

function drawFLBolt_Side(dims, W, H) {
    const D = dimVal(dims, 'D', 10), L = dimVal(dims, 'L', 40);
    const S = dimVal(dims, 'S', D * 1.5), K = dimVal(dims, 'K', D * 0.7);
    const DF = dimVal(dims, 'DF', D * 2.2), KF = dimVal(dims, 'KF', K * 0.3);
    const sc = calcScale(Math.max(DF, L + K), W, H);
    const ds = D * sc, ls = L * sc, ss = S * sc, ks = K * sc, dfs = DF * sc, kfs = KF * sc;
    const cx = W / 2, cy = H / 2;
    const headK = ks - kfs, totalH = ls + ks, topY = cy - totalH / 2;
    const hexW = ss * 0.866;

    drawPolygon([
        [cx - hexW / 2, topY], [cx + hexW / 2, topY],
        [cx + ss / 2, topY + headK * 0.25], [cx + ss / 2, topY + headK],
        [cx - ss / 2, topY + headK], [cx - ss / 2, topY + headK * 0.25]
    ]);
    drawRect(cx - dfs / 2, topY + headK, dfs, kfs);
    drawRect(cx - ds / 2, topY + ks, ds, ls);
    drawCenterLineV(cx, topY - 15, topY + totalH + 15);

    if (showDimensions) {
        drawHDim(cx - ds / 2, cx + ds / 2, topY + ks + ls / 2, 30, 'D', D);
        drawVDim(topY + ks, topY + ks + ls, cx + ds / 2, 50, 'L', L);
        drawVDim(topY, topY + ks, cx - dfs / 2, -30, 'K', K);
    }
}

function drawFLBolt_Top(dims, W, H) {
    const D = dimVal(dims, 'D', 10), S = dimVal(dims, 'S', D * 1.5), DF = dimVal(dims, 'DF', D * 2.2);
    const sc = calcScale(DF, W, H);
    const ds = D * sc, ss = S * sc, dfs = DF * sc;
    const cx = W / 2, cy = H / 2;

    drawCircle(cx, cy, dfs / 2);               // 플랜지원
    drawPolygon(hexPoints(cx, cy, ss));         // 육각
    drawCircle(cx, cy, ds / 2);                 // 몸체원
    drawCenterCross(cx, cy, dfs / 2 + 15);

    if (showDimensions) {
        drawHDim(cx - dfs / 2, cx + dfs / 2, cy, dfs / 2 + 25, 'Df', DF);
        drawHDim(cx - ss / 2, cx + ss / 2, cy, -ss / 2 - 25, 'S', S);
    }
}

// ═══════════════════════════════════════════════
// ⑥ STBOLT — 스터드볼트 (머리 없음)
// ═══════════════════════════════════════════════

function drawSTBolt_Front(dims, W, H) {
    const D = dimVal(dims, 'D', 10), L = dimVal(dims, 'L', 80);
    const B1 = dimVal(dims, 'B1', L * 0.3), B2 = dimVal(dims, 'B2', L * 0.3);
    const sc = calcScale(L, W, H);
    const ds = D * sc, ls = L * sc, b1s = B1 * sc, b2s = B2 * sc;
    const cx = W / 2, cy = H / 2, topY = cy - ls / 2;

    // 전체 몸체
    drawRect(cx - ds / 2, topY, ds, ls);
    // 나사부 경계 (점선)
    drawLine(cx - ds / 2 - 5, topY + b2s, cx + ds / 2 + 5, topY + b2s, COLOR.hiddenLine, LINE.hidden, DASH_HIDDEN);
    drawLine(cx - ds / 2 - 5, topY + ls - b1s, cx + ds / 2 + 5, topY + ls - b1s, COLOR.hiddenLine, LINE.hidden, DASH_HIDDEN);
    // 나사산 빗금
    const step = 3;
    for (let y = topY; y < topY + b2s; y += step) {
        drawLine(cx - ds / 2, y, cx - ds / 2 + ds * 0.15, y + step * 0.5, COLOR.hatch, LINE.hatch);
        drawLine(cx + ds / 2, y, cx + ds / 2 - ds * 0.15, y + step * 0.5, COLOR.hatch, LINE.hatch);
    }
    for (let y = topY + ls - b1s; y < topY + ls; y += step) {
        drawLine(cx - ds / 2, y, cx - ds / 2 + ds * 0.15, y + step * 0.5, COLOR.hatch, LINE.hatch);
        drawLine(cx + ds / 2, y, cx + ds / 2 - ds * 0.15, y + step * 0.5, COLOR.hatch, LINE.hatch);
    }
    drawCenterLineV(cx, topY - 15, topY + ls + 15);

    if (showDimensions) {
        drawVDim(topY, topY + ls, cx - ds / 2, -50, 'L', L);
        drawHDim(cx - ds / 2, cx + ds / 2, cy, 30 + ls / 2, 'D', D);
        drawVDim(topY, topY + b2s, cx + ds / 2, 30, 'B2', B2);
        drawVDim(topY + ls - b1s, topY + ls, cx + ds / 2, 55, 'B1', B1);
    }
}

function drawSTBolt_Top(dims, W, H) {
    const D = dimVal(dims, 'D', 10);
    const sc = calcScale(D, W, H);
    const ds = D * sc, cx = W / 2, cy = H / 2;
    drawCircle(cx, cy, ds / 2);
    drawCenterCross(cx, cy, ds / 2 + 15);
    if (showDimensions) drawHDim(cx - ds / 2, cx + ds / 2, cy, ds / 2 + 25, 'D', D);
}

// ═══════════════════════════════════════════════
// ⑦ SQBOLT — 사각볼트
// ═══════════════════════════════════════════════

function drawSQBolt_Front(dims, W, H) {
    const D = dimVal(dims, 'D', 10), L = dimVal(dims, 'L', 50);
    const S = dimVal(dims, 'S', D * 1.5), K = dimVal(dims, 'K', D * 0.7);
    const sc = calcScale(Math.max(S, L + K), W, H);
    const ds = D * sc, ls = L * sc, ss = S * sc, ks = K * sc;
    const cx = W / 2, cy = H / 2;
    const totalH = ls + ks, topY = cy - totalH / 2;

    drawRect(cx - ss / 2, topY, ss, ks);
    drawRect(cx - ds / 2, topY + ks, ds, ls);
    drawCenterLineV(cx, topY - 15, topY + totalH + 15);

    if (showDimensions) {
        drawHDim(cx - ds / 2, cx + ds / 2, topY + ks + ls / 2, 30, 'D', D);
        drawVDim(topY + ks, topY + ks + ls, cx + ds / 2, 50, 'L', L);
        drawHDim(cx - ss / 2, cx + ss / 2, topY, -30, 'S', S);
        drawVDim(topY, topY + ks, cx - ss / 2, -30, 'K', K);
    }
}

function drawSQBolt_Top(dims, W, H) {
    const D = dimVal(dims, 'D', 10), S = dimVal(dims, 'S', D * 1.5);
    const sc = calcScale(S, W, H);
    const ds = D * sc, ss = S * sc, cx = W / 2, cy = H / 2;
    drawRect(cx - ss / 2, cy - ss / 2, ss, ss);
    drawCircle(cx, cy, ds / 2);
    drawCenterCross(cx, cy, ss / 2 + 15);
    if (showDimensions) {
        drawHDim(cx - ss / 2, cx + ss / 2, cy, ss / 2 + 25, 'S', S);
        drawHDim(cx - ds / 2, cx + ds / 2, cy, -ds / 2 - 25, 'D', D);
    }
}

// ═══════════════════════════════════════════════
// ⑧ NUT (HNUT) — 육각너트
// ═══════════════════════════════════════════════

function drawNut_Front(dims, W, H) {
    const D = dimVal(dims, 'D', 10), S = dimVal(dims, 'S', D * 1.5);
    const HH = dimVal(dims, 'H', D * 0.8);
    const sc = calcScale(Math.max(S, HH), W, H);
    const ds = D * sc, ss = S * sc, hs = HH * sc;
    const cx = W / 2, cy = H / 2, topY = cy - hs / 2;

    drawRect(cx - ss / 2, topY, ss, hs);
    // 내부 구멍 (점선)
    drawLine(cx - ds / 2, topY, cx - ds / 2, topY + hs, COLOR.hiddenLine, LINE.hidden, DASH_HIDDEN);
    drawLine(cx + ds / 2, topY, cx + ds / 2, topY + hs, COLOR.hiddenLine, LINE.hidden, DASH_HIDDEN);
    drawCenterLineV(cx, topY - 15, topY + hs + 15);

    if (showDimensions) {
        drawHDim(cx - ss / 2, cx + ss / 2, topY, -25, 'S', S);
        drawVDim(topY, topY + hs, cx + ss / 2, 25, 'H', HH);
        drawHDim(cx - ds / 2, cx + ds / 2, cy, 25 + hs / 2 + 15, 'D', D);
    }
}

function drawNut_Top(dims, W, H) {
    const D = dimVal(dims, 'D', 10), S = dimVal(dims, 'S', D * 1.5);
    const sc = calcScale(S, W, H);
    const ds = D * sc, ss = S * sc, cx = W / 2, cy = H / 2;
    drawPolygon(hexPoints(cx, cy, ss));
    drawCircle(cx, cy, ds / 2);
    drawCenterCross(cx, cy, ss / 2 + 15);
    if (showDimensions) {
        drawHDim(cx - ss / 2, cx + ss / 2, cy, ss / 2 + 25, 'S', S);
        drawHDim(cx - ds / 2, cx + ds / 2, cy, -ds / 2 - 25, 'D', D);
    }
}

// ═══════════════════════════════════════════════
// ⑨ FNUT — 플랜지너트
// ═══════════════════════════════════════════════

function drawFNut_Front(dims, W, H) {
    const D = dimVal(dims, 'D', 10), S = dimVal(dims, 'S', D * 1.5);
    const HH = dimVal(dims, 'H', D * 0.8);
    const DF = dimVal(dims, 'DF', D * 2.2), KF = dimVal(dims, 'KF', HH * 0.25);
    const sc = calcScale(Math.max(DF, HH), W, H);
    const ds = D * sc, ss = S * sc, hs = HH * sc, dfs = DF * sc, kfs = KF * sc;
    const cx = W / 2, cy = H / 2;
    const nutH = hs - kfs, topY = cy - hs / 2;

    drawRect(cx - ss / 2, topY, ss, nutH);
    drawRect(cx - dfs / 2, topY + nutH, dfs, kfs);
    drawLine(cx - ds / 2, topY, cx - ds / 2, topY + hs, COLOR.hiddenLine, LINE.hidden, DASH_HIDDEN);
    drawLine(cx + ds / 2, topY, cx + ds / 2, topY + hs, COLOR.hiddenLine, LINE.hidden, DASH_HIDDEN);
    drawCenterLineV(cx, topY - 15, topY + hs + 15);

    if (showDimensions) {
        drawHDim(cx - ss / 2, cx + ss / 2, topY, -25, 'S', S);
        drawVDim(topY, topY + hs, cx + dfs / 2, 25, 'H', HH);
        drawHDim(cx - ds / 2, cx + ds / 2, cy, dfs / 2 + 40, 'D', D);
        drawHDim(cx - dfs / 2, cx + dfs / 2, topY + nutH + kfs / 2, -dfs / 2 - 25, 'Df', DF);
    }
}

function drawFNut_Top(dims, W, H) {
    const D = dimVal(dims, 'D', 10), S = dimVal(dims, 'S', D * 1.5), DF = dimVal(dims, 'DF', D * 2.2);
    const sc = calcScale(DF, W, H);
    const ds = D * sc, ss = S * sc, dfs = DF * sc, cx = W / 2, cy = H / 2;
    drawCircle(cx, cy, dfs / 2);
    drawPolygon(hexPoints(cx, cy, ss));
    drawCircle(cx, cy, ds / 2);
    drawCenterCross(cx, cy, dfs / 2 + 15);
    if (showDimensions) {
        drawHDim(cx - dfs / 2, cx + dfs / 2, cy, dfs / 2 + 25, 'Df', DF);
        drawHDim(cx - ss / 2, cx + ss / 2, cy, -ss / 2 - 25, 'S', S);
    }
}

// ═══════════════════════════════════════════════
// ⑩ PWAS — 평와셔
// ═══════════════════════════════════════════════

function drawPWas_Front(dims, W, H) {
    const D = dimVal(dims, 'D', 10), OD = dimVal(dims, 'OD', D * 2);
    const T = dimVal(dims, 'T', 2);
    const sc = calcScale(Math.max(OD, T * 5), W, H);
    const ds = D * sc, ods = OD * sc, ts = T * sc;
    const cx = W / 2, cy = H / 2, topY = cy - ts / 2;

    drawRect(cx - ods / 2, topY, ods, ts);
    drawLine(cx - ds / 2, topY, cx - ds / 2, topY + ts, COLOR.hiddenLine, LINE.hidden, DASH_HIDDEN);
    drawLine(cx + ds / 2, topY, cx + ds / 2, topY + ts, COLOR.hiddenLine, LINE.hidden, DASH_HIDDEN);
    drawCenterLineV(cx, topY - 15, topY + ts + 15);

    if (showDimensions) {
        drawHDim(cx - ods / 2, cx + ods / 2, topY, -20, 'OD', OD);
        drawVDim(topY, topY + ts, cx + ods / 2, 20, 'T', T);
        drawHDim(cx - ds / 2, cx + ds / 2, cy, 20 + ts / 2 + 15, 'D', D);
    }
}

function drawPWas_Top(dims, W, H) {
    const D = dimVal(dims, 'D', 10), OD = dimVal(dims, 'OD', D * 2);
    const sc = calcScale(OD, W, H);
    const ds = D * sc, ods = OD * sc, cx = W / 2, cy = H / 2;
    drawCircle(cx, cy, ods / 2);
    drawCircle(cx, cy, ds / 2);
    drawCenterCross(cx, cy, ods / 2 + 15);
    if (showDimensions) {
        drawHDim(cx - ods / 2, cx + ods / 2, cy, ods / 2 + 20, 'OD', OD);
        drawHDim(cx - ds / 2, cx + ds / 2, cy, -ds / 2 - 20, 'D', D);
    }
}

// ═══════════════════════════════════════════════
// ⑪ SWAS — 스프링와셔
// ═══════════════════════════════════════════════

function drawSWas_Front(dims, W, H) {
    const D = dimVal(dims, 'D', 10), OD = dimVal(dims, 'OD', D * 1.8);
    const T = dimVal(dims, 'T', D * 0.3), HH = dimVal(dims, 'H', T * 1.5);
    const sc = calcScale(Math.max(OD, HH * 3), W, H);
    const ds = D * sc, ods = OD * sc, ts = (OD - D) / 2 * sc, hs = HH * sc;
    const cx = W / 2, cy = H / 2, topY = cy - hs / 2;

    // 좌측 단면 (아래)
    drawRect(cx - ods / 2, topY + hs - ts, ts, ts);
    // 우측 단면 (위)
    drawRect(cx + ds / 2, topY, ts, ts);
    // 경사 연결선
    drawLine(cx - ds / 2, topY + hs - ts, cx + ds / 2, topY + ts, COLOR.outline, 1.0);
    drawCenterLineV(cx, topY - 15, topY + hs + 15);

    if (showDimensions) {
        drawVDim(topY, topY + hs, cx - ods / 2, -25, 'H', HH);
        drawHDim(cx - ods / 2, cx + ods / 2, topY + hs, 30, 'OD', OD);
        drawHDim(cx - ds / 2, cx + ds / 2, topY, -25, 'D', D);
    }
}

function drawSWas_Top(dims, W, H) {
    const D = dimVal(dims, 'D', 10), OD = dimVal(dims, 'OD', D * 1.8);
    const sc = calcScale(OD, W, H);
    const ds = D * sc, ods = OD * sc, cx = W / 2, cy = H / 2;
    const startA = 15 * Math.PI / 180, sweepA = 330 * Math.PI / 180;

    // 절개 아크 (330°)
    drawArc(cx, cy, ods / 2, startA, startA + sweepA, COLOR.outline, LINE.outline);
    drawArc(cx, cy, ds / 2, startA, startA + sweepA, COLOR.outline, LINE.outline);
    // 절개 양 끝 연결
    const sa = startA, ea = startA + sweepA;
    drawLine(cx + ds / 2 * Math.cos(sa), cy + ds / 2 * Math.sin(sa),
             cx + ods / 2 * Math.cos(sa), cy + ods / 2 * Math.sin(sa), COLOR.outline, LINE.outline);
    drawLine(cx + ds / 2 * Math.cos(ea), cy + ds / 2 * Math.sin(ea),
             cx + ods / 2 * Math.cos(ea), cy + ods / 2 * Math.sin(ea), COLOR.outline, LINE.outline);

    drawCenterCross(cx, cy, ods / 2 + 15);
    if (showDimensions) {
        drawHDim(cx - ods / 2, cx + ods / 2, cy, ods / 2 + 25, 'OD', OD);
        drawHDim(cx - ds / 2, cx + ds / 2, cy, -ds / 2 - 25, 'D', D);
    }
}

// ═══════════════════════════════════════════════
// ⑬ SERVO_MOTOR — 서보 모터 2D 도면 (3면도)
// ═══════════════════════════════════════════════
/**
 * ★ DB 필드명 직접 접근: dims['L1(LL)'], dims['CW(MW)'] 등 괄호 포함
 *
 * 좌표계 (측면도 기준):
 *   X 우→: 샤프트 끝 → 플랜지 → 본체
 *   Y 상↑: 모터 높이 방향
 *   기준점: 좌하 = (샤프트 끝, 모터 하면)
 *
 * 주요 치수 표시:
 *   ① LX  - 전체 길이         ② LR - 샤프트 돌출
 *   ③ L1  - 본체 길이         ④ L2 - 본체 주요 구간
 *   ⑤ LC  - 프레임 폭         ⑥ LH - 프레임 높이
 *   ⑦ S   - 샤프트 직경       ⑧ LB - 플랜지 직경
 *   ⑨ EnH - 엔코더 OD         ⑩ CH - 커넥터 높이
 */

function mVal(dims, key, fallback=0) {
    if (!dims) return fallback;
    const v = dims[key];
    if (v === null || v === undefined || v === '' || isNaN(Number(v))) return fallback;
    return Number(v);
}

// ─────────────────────────────────────────────
// 정면도 (축방향에서 본 뷰): 사각 프레임 + 플랜지원 + 마운팅홀
// ─────────────────────────────────────────────
function drawServoMotor_Front(dims, W, H) {
    const LC  = mVal(dims,'LC',   mVal(dims,'S', 40));
    const LH  = mVal(dims,'LH',   LC);
    const LB  = mVal(dims,'LB',   LC*0.75);
    const S   = mVal(dims,'S',    LC*0.2);
    const PCD = mVal(dims,'PCD(LA)', LB*0.80);
    const MHd = mVal(dims,'TL(LG)', LC*0.07) * 0.6; // 홀 직경 근사

    const ext = Math.max(LC, LH, LB) * 1.1;
    const sc  = calcScale(ext, W, H, 0.60);
    const cx = W/2, cy = H/2;

    const lcs = LC*sc, lhs = LH*sc, lbs = LB*sc;
    const shDs = S*sc, PCDs = PCD*sc, MHds = MHd*sc;
    const rr = Math.min(lcs * 0.04, 4);

    // 배경 채우기
    ctx.fillStyle = '#F8F9FA';
    ctx.fillRect(0, 0, W, H);

    // 해치 (재질 표시 - 사각 프레임 내부)
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(cx - lcs/2, cy - lhs/2, lcs, lhs, rr);
    ctx.clip();
    ctx.strokeStyle = COLOR.hatch;
    ctx.lineWidth = LINE.hatch;
    ctx.setLineDash([2, 3]);
    for (let i = -lcs; i <= lcs + lhs; i += 6) {
        drawLine(cx - lcs/2 + i, cy - lhs/2, cx - lcs/2 + i + lhs, cy + lhs/2, COLOR.hatch, LINE.hatch);
    }
    ctx.setLineDash([]);
    ctx.restore();

    // 사각 프레임 외형
    ctx.beginPath();
    ctx.roundRect(cx - lcs/2, cy - lhs/2, lcs, lhs, rr);
    ctx.fillStyle = 'rgba(44,44,44,0.85)';
    ctx.fill();
    ctx.strokeStyle = COLOR.outline;
    ctx.lineWidth = LINE.outline;
    ctx.stroke();

    // 플랜지 원 (밝은 알루미늄)
    ctx.beginPath();
    ctx.arc(cx, cy, lbs/2, 0, Math.PI*2);
    ctx.fillStyle = 'rgba(168,176,187,0.6)';
    ctx.fill();
    ctx.strokeStyle = COLOR.outline;
    ctx.lineWidth = LINE.outline;
    ctx.stroke();

    // PCD 원 (점선)
    ctx.beginPath();
    ctx.setLineDash(DASH_CENTER);
    ctx.strokeStyle = COLOR.centerLine;
    ctx.lineWidth = LINE.center;
    ctx.arc(cx, cy, PCDs/2, 0, Math.PI*2);
    ctx.stroke();
    ctx.setLineDash([]);

    // 마운팅홀 (4개, 45°배치)
    for (let i = 0; i < 4; i++) {
        const a = Math.PI/4 + Math.PI/2 * i;
        const hx = cx + (PCDs/2)*Math.cos(a);
        const hy = cy + (PCDs/2)*Math.sin(a);
        drawCircle(hx, hy, Math.max(MHds/2, 2.5), COLOR.outline, LINE.outline*0.8, null, '#111');
    }

    // 출력축 (중심원)
    ctx.beginPath();
    ctx.arc(cx, cy, shDs/2, 0, Math.PI*2);
    ctx.fillStyle = 'rgba(200,210,215,0.9)';
    ctx.fill();
    ctx.strokeStyle = COLOR.outline;
    ctx.lineWidth = LINE.outline;
    ctx.stroke();

    // 중심선
    drawCenterLineH(cx - lcs/2 - 18, cx + lcs/2 + 18, cy);
    drawCenterLineV(cx, cy - lhs/2 - 18, cy + lhs/2 + 18);

    if (showDimensions) {
        const off = 22;
        drawHDim(cx - lcs/2, cx + lcs/2, cy - lhs/2, -off,      'LC', LC);
        drawVDim(cy - lhs/2, cy + lhs/2, cx + lcs/2, off + 5,   'LH', LH);
        drawHDim(cx - lbs/2, cx + lbs/2, cy + lhs/2, off + 5,   'LB', LB);
        drawHDim(cx - shDs/2, cx + shDs/2, cy,        off + 28,  'S',  S);
        drawHDim(cx - PCDs/2, cx + PCDs/2, cy - lhs/2, -off-22,  'PCD', PCD);
    }
}

// ─────────────────────────────────────────────
// 측면도 (옆에서 본 단면): 실제 치수 비례 반영
// ─────────────────────────────────────────────
function drawServoMotor_Side(dims, W, H) {
    const LC  = mVal(dims,'LC',       mVal(dims,'S', 40));
    const LH  = mVal(dims,'LH',       LC);
    const LR  = mVal(dims,'LR',       LC*0.25);   // 샤프트 돌출
    const LX  = mVal(dims,'LX',       LC*1.5);    // 전체 길이
    const L1  = mVal(dims,'L1(LL)',   LX - LR);   // 본체 길이
    const L2  = mVal(dims,'L2',       L1*0.46);   // 본체 주구간
    const TL  = mVal(dims,'TL(LG)',   LC*0.07);   // 전방 링 구간
    const LB  = mVal(dims,'LB',       LC*0.75);   // 플랜지 OD
    const LE  = mVal(dims,'LE',       LC*0.07);   // 플랜지 두께
    const S   = mVal(dims,'S',        LC*0.2);    // 샤프트 직경
    const EnH = mVal(dims,'EnH',      LC*0.8);    // 엔코더 OD
    const CW  = mVal(dims,'CW(MW)',   0);
    const CL  = mVal(dims,'CL(ML)',   0);
    const CH  = mVal(dims,'CH(MH)',   0);
    const PCD = mVal(dims,'PCD(LA)',  LB*0.80);

    // 전체 폭 = LR + LE + L1, 전체 높이 = max(LH+CH, EnH)
    const totalW = LR + LE + L1;
    const totalH = Math.max(LH + (CH > 0 ? CH + 2 : 0), EnH > LH ? EnH : LH);
    const sc = calcScale(Math.max(totalW, totalH*1.5), W, H, 0.50);

    // 배치: 샤프트 끝이 좌측, 모터 수직 중앙
    const marginL = 55;
    const xSh  = marginL;               // 샤프트 끝 X위치
    const xFlg = xSh + LR*sc;           // 플랜지 전면
    const xBody= xFlg + LE*sc;          // 본체 시작
    const xEnd = xBody + L1*sc;         // 본체 끝
    const cy   = H * 0.52;             // 모터 수직 중앙

    const lcs = LC*sc, lhs = LH*sc, les = LE*sc;
    const shDs = S*sc, lbs = LB*sc;
    const tls = TL*sc;
    const enHs = Math.max(EnH*sc, lhs);  // 엔코더 높이 (최소 본체 높이)

    // ── 배경
    ctx.fillStyle = '#F8F9FA';
    ctx.fillRect(0, 0, W, H);

    // ── 샤프트 (Y방향 기준, 중앙)
    ctx.fillStyle = 'rgba(200,210,215,0.95)';
    ctx.fillRect(xSh, cy - shDs/2, LR*sc, shDs);
    drawLine(xSh, cy - shDs/2, xFlg, cy - shDs/2, COLOR.outline, LINE.outline);
    drawLine(xSh, cy + shDs/2, xFlg, cy + shDs/2, COLOR.outline, LINE.outline);
    drawLine(xSh, cy - shDs/2, xSh,  cy + shDs/2, COLOR.outline, LINE.outline);

    // ── 플랜지 (두꺼운 디스크)
    ctx.fillStyle = 'rgba(168,176,187,0.95)';
    ctx.fillRect(xFlg, cy - lbs/2, les, lbs);
    drawLine(xFlg, cy - lbs/2, xFlg + les, cy - lbs/2, COLOR.outline, LINE.outline);
    drawLine(xFlg, cy + lbs/2, xFlg + les, cy + lbs/2, COLOR.outline, LINE.outline);
    drawLine(xFlg, cy - lbs/2, xFlg, cy + lbs/2, COLOR.outline, LINE.outline);
    // 플랜지 내경 (샤프트홀 가이드)
    ctx.setLineDash(DASH_HIDDEN);
    ctx.strokeStyle = COLOR.hiddenLine;
    ctx.lineWidth = LINE.hidden;
    drawLine(xFlg, cy - shDs/2, xFlg + les, cy - shDs/2, COLOR.hiddenLine, LINE.hidden);
    drawLine(xFlg, cy + shDs/2, xFlg + les, cy + shDs/2, COLOR.hiddenLine, LINE.hidden);
    ctx.setLineDash([]);

    // ── 본체 사각 프레임 (플랜지 전면에서 플랫 sA+sB까지)
    // Section A (전방 단단)
    const xA = xBody;
    const wA = tls > 1 ? tls : lcs*0.1;
    ctx.fillStyle = 'rgba(44,44,44,0.95)';
    ctx.fillRect(xA, cy - lcs/2, wA, lcs);
    drawLine(xA, cy - lcs/2, xA + wA, cy - lcs/2, COLOR.outline, LINE.outline);
    drawLine(xA, cy + lcs/2, xA + wA, cy + lcs/2, COLOR.outline, LINE.outline);

    // Section B (중공)
    const xB = xA + wA;
    const wB = Math.max(0.1, L2*sc - wA);
    ctx.fillStyle = 'rgba(44,44,44,0.80)';
    ctx.fillRect(xB, cy - lcs/2, wB, lcs);
    // 내공 표시
    const inR = lcs * 0.78 / 2;
    ctx.fillStyle = 'rgba(220,224,230,0.3)';
    ctx.fillRect(xB, cy - inR, wB, inR*2);
    drawLine(xB, cy - lcs/2, xB + wB, cy - lcs/2, COLOR.outline, LINE.outline);
    drawLine(xB, cy + lcs/2, xB + wB, cy + lcs/2, COLOR.outline, LINE.outline);

    // Section C (엔코더 구간)
    const xE = xBody + L2*sc;
    const wE = Math.max(0.1, (L1 - L2)*sc);
    const eH = enHs;
    const eOffZ = enHs > lhs ? (enHs - lhs)/4 : 0; // 엔코더가 크면 위쪽으로 오프셋
    ctx.fillStyle = 'rgba(32,32,40,0.90)';
    ctx.fillRect(xE, cy - eH/2 - eOffZ, wE, eH);
    drawLine(xE, cy - eH/2 - eOffZ, xE + wE, cy - eH/2 - eOffZ, COLOR.outline, LINE.outline);
    drawLine(xE, cy + eH/2 - eOffZ, xE + wE, cy + eH/2 - eOffZ, COLOR.outline, LINE.outline);
    drawLine(xE + wE, cy - eH/2 - eOffZ, xE + wE, cy + eH/2 - eOffZ, COLOR.outline, LINE.outline);

    // 좌우 연결선 (사각 프레임 전체 윤곽)
    drawLine(xA, cy - lcs/2, xE, cy - lcs/2, COLOR.outline, LINE.outline);
    drawLine(xA, cy + lcs/2, xE, cy + lcs/2, COLOR.outline, LINE.outline);
    drawLine(xA, cy - lcs/2, xA, cy + lcs/2, COLOR.outline, LINE.outline);

    // ── 커넥터 박스 (본체 하면 돌출)
    if (CW > 0 && CH > 0 && CL > 0) {
        const cxPos = xBody + TL*sc*0.5;
        const cwW   = CL*sc, cwH = CH*sc;
        ctx.fillStyle = 'rgba(20,20,20,0.92)';
        ctx.fillRect(cxPos, cy + lcs/2, cwW, cwH);
        drawLine(cxPos,       cy + lcs/2, cxPos + cwW, cy + lcs/2, COLOR.outline, LINE.outline);
        drawLine(cxPos,       cy + lcs/2, cxPos,       cy + lcs/2 + cwH, COLOR.outline, LINE.outline);
        drawLine(cxPos + cwW, cy + lcs/2, cxPos + cwW, cy + lcs/2 + cwH, COLOR.outline, LINE.outline);
        drawLine(cxPos,       cy + lcs/2 + cwH, cxPos + cwW, cy + lcs/2 + cwH, COLOR.outline, LINE.outline);
    }

    // ── 마운팅홀 위치 (플랜지 면에서 수직 가이드)
    ctx.setLineDash(DASH_HIDDEN);
    ctx.strokeStyle = COLOR.hiddenLine;
    ctx.lineWidth = LINE.hidden;
    const pcdR_px = (PCD/2)*sc;
    drawLine(xFlg, cy - pcdR_px, xFlg + les + tls, cy - pcdR_px, COLOR.hiddenLine, LINE.hidden);
    drawLine(xFlg, cy + pcdR_px, xFlg + les + tls, cy + pcdR_px, COLOR.hiddenLine, LINE.hidden);
    ctx.setLineDash([]);

    // 중심선
    drawCenterLineH(xSh - 15, xEnd + 10, cy);

    // ── 치수 표시 ──
    if (showDimensions) {
        const dimOff  = 20;
        const dimOff2 = 40;

        // ① 전체 길이 LX (위쪽)
        const lxTotalW = (LR + LE + L1) * sc;
        drawHDim(xSh, xSh + lxTotalW, cy - Math.max(lhs/2, eH/2) - dimOff2, -dimOff, 'LX', LX);

        // ② 샤프트 돌출 LR (아래 짧은 구간)
        drawHDim(xSh, xFlg, cy + lbs/2 + 5, dimOff, 'LR', LR);

        // ③ 본체 길이 L1 (아래 전체)
        drawHDim(xBody, xEnd, cy + lcs/2 + (CH > 0 ? CH*sc + 8 : 5), dimOff + 5, 'L1', L1);

        // ④ L2 구간 (작은 치수)
        drawHDim(xBody, xBody + L2*sc, cy - lcs/2 - 5, -dimOff, 'L2', L2);

        // ⑤ 프레임 폭 LC (우측)
        drawVDim(cy - lcs/2, cy + lcs/2, xEnd + 10, dimOff, 'LC', LC);

        // ⑥ 플랜지 직경 LB (좌측)
        drawVDim(cy - lbs/2, cy + lbs/2, xFlg - 10, -dimOff2, 'LB', LB);

        // ⑦ 샤프트 직경 S
        drawVDim(cy - shDs/2, cy + shDs/2, xSh - 8, -dimOff, 'S', S);

        // ⑧ 엔코더 OD (있을 때)
        if (EnH > LH + 1) {
            drawVDim(cy - eH/2 - eOffZ, cy + eH/2 - eOffZ, xEnd + 10, dimOff + 25, 'EnH', EnH);
        }
    }
}

// ─────────────────────────────────────────────
// 평면도 (위에서 본 뷰): 본체 + 커넥터 + 마운팅홀 위치
// ─────────────────────────────────────────────
function drawServoMotor_Top(dims, W, H) {
    const LC  = mVal(dims,'LC',       mVal(dims,'S', 40));
    const LR  = mVal(dims,'LR',       LC*0.25);
    const LX  = mVal(dims,'LX',       LC*1.5);
    const L1  = mVal(dims,'L1(LL)',   LX - LR);
    const L2  = mVal(dims,'L2',       L1*0.46);
    const TL  = mVal(dims,'TL(LG)',   LC*0.07);
    const LE  = mVal(dims,'LE',       LC*0.07);
    const S   = mVal(dims,'S',        LC*0.2);
    const LB  = mVal(dims,'LB',       LC*0.75);
    const CW  = mVal(dims,'CW(MW)',   0);
    const CL  = mVal(dims,'CL(ML)',   0);
    const PCD = mVal(dims,'PCD(LA)',  LB*0.80);

    const totalW = LR + LE + L1;
    const sc = calcScale(Math.max(totalW, LC + (CW > 0 ? CW + 4 : 0) + 20), W, H, 0.50);

    const marginL = 50;
    const xSh  = marginL;
    const xFlg = xSh + LR*sc;
    const xBody= xFlg + LE*sc;
    const xEnd = xBody + L1*sc;
    const cy   = H * 0.5;

    const lcs = LC*sc, les = LE*sc, shDs = S*sc, lbs = LB*sc;
    const tls = TL > 0.1 ? TL*sc : lcs*0.1;

    // 배경
    ctx.fillStyle = '#F8F9FA';
    ctx.fillRect(0, 0, W, H);

    // ── 샤프트 (평면도: 사각형)
    ctx.fillStyle = 'rgba(200,210,215,0.8)';
    ctx.fillRect(xSh, cy - shDs/2, LR*sc, shDs);
    drawLine(xSh, cy - shDs/2, xFlg, cy - shDs/2, COLOR.outline, LINE.outline);
    drawLine(xSh, cy + shDs/2, xFlg, cy + shDs/2, COLOR.outline, LINE.outline);
    drawLine(xSh, cy - shDs/2, xSh,  cy + shDs/2, COLOR.outline, LINE.outline);

    // ── 플랜지 (평면도: 원 표시)
    ctx.setLineDash(DASH_HIDDEN);
    ctx.strokeStyle = COLOR.hiddenLine;
    ctx.lineWidth = LINE.hidden;
    ctx.beginPath();
    ctx.arc(xFlg + les/2, cy, lbs/2, 0, Math.PI*2);
    ctx.stroke();
    ctx.setLineDash([]);

    // ── 본체 상면
    ctx.fillStyle = 'rgba(44,44,44,0.85)';
    ctx.fillRect(xBody, cy - lcs/2, L1*sc, lcs);
    drawLine(xBody, cy - lcs/2, xEnd, cy - lcs/2, COLOR.outline, LINE.outline);
    drawLine(xBody, cy + lcs/2, xEnd, cy + lcs/2, COLOR.outline, LINE.outline);
    drawLine(xBody, cy - lcs/2, xBody, cy + lcs/2, COLOR.outline, LINE.outline);
    drawLine(xEnd,  cy - lcs/2, xEnd,  cy + lcs/2, COLOR.outline, LINE.outline);

    // 본체 A/B 경계 (점선)
    ctx.setLineDash(DASH_HIDDEN);
    ctx.strokeStyle = COLOR.hiddenLine;
    ctx.lineWidth = LINE.hidden;
    const xSec = xBody + L2*sc;
    drawLine(xSec, cy - lcs/2, xSec, cy + lcs/2, COLOR.hiddenLine, LINE.hidden);
    ctx.setLineDash([]);

    // ── 라벨 (노란 스티커)
    const lblW = lcs * 0.65, lblH = L2*sc * 0.18;
    ctx.fillStyle = 'rgba(240,192,64,0.8)';
    ctx.fillRect(xBody + L2*sc*0.15, cy - lcs/2 + 2, lblW, lblH);

    // ── 커넥터 (아랫면)
    if (CW > 0 && CL > 0) {
        const cxP = xBody + TL*sc * 0.5;
        const cwW = CL*sc, cwH = CW*sc;
        ctx.fillStyle = 'rgba(20,20,20,0.9)';
        ctx.fillRect(cxP, cy + lcs/2, cwW, cwH);
        drawLine(cxP,       cy + lcs/2, cxP + cwW, cy + lcs/2, COLOR.outline, LINE.outline);
        drawLine(cxP,       cy + lcs/2, cxP,       cy + lcs/2 + cwH, COLOR.outline, LINE.outline);
        drawLine(cxP + cwW, cy + lcs/2, cxP + cwW, cy + lcs/2 + cwH, COLOR.outline, LINE.outline);
        drawLine(cxP,       cy + lcs/2 + cwH, cxP + cwW, cy + lcs/2 + cwH, COLOR.outline, LINE.outline);
    }

    // ── PCD 원 (점선, 플랜지 면)
    const pcdR_px = (PCD/2)*sc;
    ctx.setLineDash(DASH_CENTER);
    ctx.strokeStyle = COLOR.centerLine;
    ctx.lineWidth = LINE.center;
    ctx.beginPath();
    ctx.arc(xFlg + les/2, cy, pcdR_px, 0, Math.PI*2);
    ctx.stroke();
    ctx.setLineDash([]);

    // 중심선
    drawCenterLineH(xSh - 12, xEnd + 10, cy);
    drawCenterLineV(xFlg + les/2, cy - lbs/2 - 12, cy + lbs/2 + 12);

    if (showDimensions) {
        const off = 18;
        drawHDim(xSh, xEnd, cy - Math.max(lcs/2, lbs/2) - 30, -off, 'LX', LX);
        drawVDim(cy - lcs/2, cy + lcs/2, xEnd + 8, off, 'LC', LC);
        drawHDim(xBody, xBody + L2*sc, cy + lcs/2 + (CW > 0 ? CW*sc + 8 : 5), off, 'L2', L2);
        drawHDim(xSh, xFlg, cy - lbs/2 - 18, -off, 'LR', LR);
        if (CW > 0) drawVDim(cy + lcs/2, cy + lcs/2 + CW*sc, xBody + CL*sc*0.3, off+10, 'CW', CW);
    }
}


// ⑫ DGBB — 깊은 홈 볼 베어링 (단면도)
// ═══════════════════════════════════════════════

function drawDGBB_Front(dims, W, H) {
    // ★ 표준 베어링 치수 매핑 (엑셀 정의 기준)
    const d = dimVal(dims, 'd1', dimVal(dims, 'D1', dimVal(dims, 'd', 30)));  // 안지름 (d1 우선)
    const D = dimVal(dims, 'D2', dimVal(dims, 'D', 62));                      // 바깥지름
    const B = dimVal(dims, 'B', 16);                                          // 폭
    const r = dimVal(dims, 'r', B * 0.05);                                    // 모따기

    const sc = calcScale(Math.max(D, B * 2), W, H, 0.4);
    const ds = d * sc, Ds = D * sc, Bs = B * sc, rs = r * sc;
    const cx = W / 2, cy = H / 2;

    const innerR = ds / 2, outerR = Ds / 2, halfB = Bs / 2;
    const pitchR = (ds + Ds) / 4;
    const ballR = (Ds - ds) * 0.15;
    const grooveR = ballR * 1.02;
    const shoulderInner = pitchR - grooveR * 0.8;
    const shoulderOuter = pitchR + grooveR * 0.8;
    const grooveHalfW = Math.sqrt(Math.max(0, grooveR * grooveR - Math.pow(pitchR - shoulderInner, 2)));

    const lx = cx - halfB, rx = cx + halfB;

    // ── 상반부 + 하반부 그리기 ──
    for (const sign of [-1, 1]) { // -1: 상반부, 1: 하반부
        // 내륜
        const inBot = cy + sign * innerR;
        const inSh = cy + sign * shoulderInner;
        drawLine(lx, inBot, rx, inBot, COLOR.outline, LINE.outline);         // 내경 바닥
        drawLine(lx, inBot, lx, inSh, COLOR.outline, LINE.outline);         // 좌벽
        drawLine(rx, inBot, rx, inSh, COLOR.outline, LINE.outline);         // 우벽
        drawLine(lx, inSh, cx - grooveHalfW, inSh, COLOR.outline, LINE.outline);  // 좌 어깨
        drawLine(cx + grooveHalfW, inSh, rx, inSh, COLOR.outline, LINE.outline);  // 우 어깨
        // 내륜 궤도홈 (아크)
        drawGrooveArc(cx, cy, pitchR, grooveR, grooveHalfW, sign, true);

        // 외륜
        const outTop = cy + sign * outerR;
        const outSh = cy + sign * shoulderOuter;
        drawLine(lx, outTop, rx, outTop, COLOR.outline, LINE.outline);      // 외경 천장
        drawLine(lx, outTop, lx, outSh, COLOR.outline, LINE.outline);      // 좌벽
        drawLine(rx, outTop, rx, outSh, COLOR.outline, LINE.outline);      // 우벽
        drawLine(lx, outSh, cx - grooveHalfW, outSh, COLOR.outline, LINE.outline);
        drawLine(cx + grooveHalfW, outSh, rx, outSh, COLOR.outline, LINE.outline);
        // 외륜 궤도홈
        drawGrooveArc(cx, cy, pitchR, grooveR, grooveHalfW, sign, false);

        // 볼 (단면원)
        drawCircle(cx, cy + sign * pitchR, ballR * 0.95, COLOR.outline, 1.0, null, COLOR.ball);
    }

    // 중심선
    drawCenterLineH(lx - 15, rx + 15, cy);
    drawCenterLineV(cx, cy - outerR - 15, cy + outerR + 15);

    if (showDimensions) {
        const off = 25;
        drawVDim(cy - innerR, cy + innerR, lx, -off - 20, 'd', d);
        drawVDim(cy - outerR, cy + outerR, rx, off + 20, 'D', D);
        drawHDim(lx, rx, cy - outerR, -off, 'B', B);
    }
}

/** 궤도홈 아크를 여러 직선으로 근사해서 그리기 */
function drawGrooveArc(cx, cy, pitchR, grooveR, grooveHalfW, sign, isInner) {
    const segs = 16;
    for (let i = 0; i < segs; i++) {
        const a1 = Math.PI * i / segs;
        const a2 = Math.PI * (i + 1) / segs;
        const x1 = cx + grooveHalfW * Math.cos(Math.PI - a1);
        const x2 = cx + grooveHalfW * Math.cos(Math.PI - a2);
        let y1, y2;
        if (isInner) { // 내륜: 위로 볼록
            y1 = cy + sign * (pitchR + grooveR * Math.sin(a1));
            y2 = cy + sign * (pitchR + grooveR * Math.sin(a2));
        } else { // 외륜: 아래로 오목
            y1 = cy + sign * (pitchR - grooveR * Math.sin(a1));
            y2 = cy + sign * (pitchR - grooveR * Math.sin(a2));
        }
        drawLine(x1, y1, x2, y2, COLOR.outline, 1.0);
    }
}

function drawDGBB_Top(dims, W, H) {
    // ★ 표준 베어링 치수 매핑
    const d = dimVal(dims, 'd1', dimVal(dims, 'D1', dimVal(dims, 'd', 30))); // 안지름
    const D = dimVal(dims, 'D2', dimVal(dims, 'D', 62));                     // 바깥지름
    const B = dimVal(dims, 'B', 16);                                         // 폭
    const sc = calcScale(D, W, H, 0.4);
    const ds = d * sc, Ds = D * sc;
    const innerR = ds / 2, outerR = Ds / 2;
    const pitchR = (ds + Ds) / 4;
    const ballR = (Ds - ds) * 0.15;
    const cx = W / 2, cy = H / 2;

    drawCircle(cx, cy, outerR, COLOR.outline, LINE.outline, null, COLOR.fill);
    drawCircle(cx, cy, innerR, COLOR.outline, LINE.outline, null, COLOR.background);
    // 피치원 (점선)
    drawCircle(cx, cy, pitchR, COLOR.hiddenLine, 0.6, [6, 3]);
    // 볼 배치
    const numBalls = Math.max(6, Math.floor(Math.PI * (ds + Ds) / (ballR * 4.8)));
    for (let i = 0; i < numBalls; i++) {
        const a = 2 * Math.PI * i / numBalls;
        drawCircle(cx + pitchR * Math.cos(a), cy + pitchR * Math.sin(a),
                   ballR * 0.95, COLOR.outline, 0.8, null, COLOR.ball);
    }
    drawCenterCross(cx, cy, outerR + 15);

    if (showDimensions) {
        drawHDim(cx - outerR, cx + outerR, cy, outerR + 25, 'D', D);
        drawHDim(cx - innerR, cx + innerR, cy, -innerR - 25, 'd', d);
    }
}

// ═══════════════════════════════════════════════
// C# ↔ JS Communication (3D와 동일 프로토콜)
// ═══════════════════════════════════════════════

window.onCSharpMessage = function (msg) {
    try {
        logToCSharp('C# msg: ' + msg.command + ', partCode=' + (msg.partCode || ''));
        switch (msg.command) {
            case 'updateModel': {
                const dims = {};
                if (msg.dimensions) {
                    for (const [key, val] of Object.entries(msg.dimensions)) {
                        const nV = typeof val === 'string' ? parseFloat(val) || 0 : Number(val) || 0;
                        dims[key.toUpperCase()] = nV;
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
                                // ★ 문자열 옵션값 보존 ("단차 생성", "어깨 생성" 등)
                                if (typeof val === 'string' && isNaN(parseFloat(val)) && val.trim() !== '') {
                                    ldims['_str_' + key] = val;
                                    ldims['_str_' + uK]  = val;
                                }
                            }
                        }
                        linked.push({
                            partCode:      lp.partCode      || '',
                            partName:      lp.partName      || '',   // ★ 추가
                            partType:      lp.partType      || '',
                            dimensions:    ldims,
                            isDrawEnabled: lp.isDrawEnabled !== false,
                            mateOffset:    lp.mateOffset    || 0,
                            mateAlign:     lp.mateAlign     || 'center'
                        });
                    }
                }
                updateModel(msg.partCode, dims, linked, msg.viewType || currentViewType);
                break;
            }
            case 'setView':
                currentViewType = msg.view || 'Front2D';
                redraw();
                break;
            case 'setOption':
                if (msg.option === 'dimensions') showDimensions = msg.value;
                redraw();
                break;
            case 'resize':
                resizeCanvas();
                redraw();
                break;
        }
    } catch (err) { logToCSharp('Error: ' + err.message); }
};

function sendToCSharp(msg) {
    try { if (window.chrome && window.chrome.webview) window.chrome.webview.postMessage(msg); }
    catch (e) { console.log('[sendToCSharp]', e); }
}

function logToCSharp(message) {
    sendToCSharp({ type: 'log', message: message });
    console.log('[PartRenderer2D]', message);
}

// ═══════════════════════════════════════════════
// ★ 연결부품(LinkedParts) 2D 렌더러
// ═══════════════════════════════════════════════

/**
 * drawLinkedParts2D — 연결부품 전체 디스패처
 * redraw() 안에서 주 부품 드로잉 직후 호출
 * currentLinkedParts 배열을 순회하며 뷰타입·partCode별 드로어 분기
 *
 * @param {object} mainDims  주 부품 치수 (내경·폭 등 참조)
 * @param {number} W, H      캔버스 논리 크기
 */
function drawLinkedParts2D(mainDims, W, H) {
    for (const lp of currentLinkedParts) {
        // ★ isDrawEnabled=false → 완전 생략 (체크박스 OFF)
        if (!lp.isDrawEnabled) continue;

        if (isShaftLinkedPart(lp)) {
            if (currentViewType === 'Top2D') {
                drawLinkedShaft_Top_2D(lp.dimensions, mainDims, W, H, lp.mateOffset, lp.mateAlign);
            } else {
                drawLinkedShaft_Front_2D(lp.dimensions, mainDims, W, H, lp.mateOffset, lp.mateAlign);
            }
        } else if (isOilSealLinkedPart(lp)) {
            // ★ 오일씰: 뷰타입별 분기
            if (currentViewType === 'Top2D') {
                drawLinkedOilSeal_Top_2D(lp.dimensions, mainDims, W, H, lp.mateOffset);
            } else {
                drawLinkedOilSeal_Front_2D(lp.dimensions, mainDims, W, H, lp.mateOffset);
            }
        } else if (isHousingLinkedPart(lp)) {
            drawLinkedHousing_Front_2D(lp.dimensions, mainDims, W, H, lp.mateOffset);
        }
    }
}


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

// ─────────────────────────────────────────────
// 연결부품 ① — 축(Shaft) 정면도 / 측면도
// ─────────────────────────────────────────────
/**
 * drawLinkedShaft_Front_2D
 *
 * 베어링 단면도 위에 축을 겹쳐 그림.
 * ┌──────────────────────────────────┐  ← cy - shaftR (상면)
 * │  (베어링 외부: 실선 + 해칭)       │
 * │  [베어링 내부: 은선(파선)]        │
 * └──────────────────────────────────┘  ← cy + shaftR (하면)
 *
 * 렌더링 규칙:
 *   - 베어링 외부 연장부: 실선(COLOR.linked_shaft) + 옅은 파란 채우기 + 45° 해칭
 *   - 베어링 내부 겹침:   은선(파선, COLOR.hiddenLine) — CAD 제도 관례
 *   - 단차(D2/L2 있을 때): 오른쪽에 직사각형 추가
 *   - 중심선: 축 전체 구간 연장
 */
function drawLinkedShaft_Front_2D(ldims, mainDims, W, H, mateOffset, mateAlign) {
    // ① 주 부품 치수 추출
    const d  = dimVal(mainDims, 'd1', dimVal(mainDims, 'd', dimVal(mainDims, 'D1', 20)));
    const D  = dimVal(mainDims, 'D2', dimVal(mainDims, 'D', 40));
    const B  = dimVal(mainDims, 'B',  16);
    const sc = calcScale(Math.max(D, B * 2), W, H, 0.4);

    // ② 연결부품 치수 — 한글 키 폴백 포함
    const shaftD = dimVal(ldims, 'D', dimVal(ldims, 'd',
                   ldims['축 지름(전체동일)'] || ldims['축 지름'] || ldims['축지름'] || ldims['축경'] || d));
    const shaftL = dimVal(ldims, 'L',
                   ldims['전체 길이'] || ldims['길이'] || B * 3);  // ★ 3배로 단축

    // ★ 안쪽 고정 방식 (단차/어깨/멈춤링)
    const innerFix = (
        ldims['_str_안쪽 고정 방식'] || ldims['안쪽 고정 방식'] ||
        ldims['_str_INNERFIXTYPE']   || ''
    ).toString();

    const shaftR_px = (shaftD / 2) * sc;
    const shaftL_px = shaftL * sc;
    const mainB_px  = B * sc;
    const outerR_px = (D / 2) * sc;
    const cx = W / 2 + (Number(mateOffset) || 0) * sc;
    const cy = H / 2;

    // ③ mateAlign에 따른 수평 시작점
    //   ★ 재설계: 실제 CAD와 동일 — 베어링 끝면 기준
    //   'right': 베어링 오른쪽(+X) 끝면에서 시작 → 오른쪽으로 뻗음
    //   'left' : 베어링 왼쪽(-X) 끝면에서 시작 → 왼쪽으로 뻗음
    //   'center': 중앙 기준 (기존)
    const bearingLx = cx - mainB_px / 2;
    const bearingRx = cx + mainB_px / 2;

    // ★ 단차(칼라) 치수 미리 계산
    const hasCollar = innerFix.includes('단차') || innerFix.includes('단자');
    const collarR   = shaftD / 2 * 1.35;   // 축 직경의 135%
    const collarW   = Math.max(shaftD / 2 * 0.6, 0.5);
    const collarR_px = collarR * sc;
    const collarW_px = collarW * sc;

    // 연장부 시작/끝 X 좌표
    let xStart, xEnd;
    if (mateAlign === 'right') {
        // ★ 오른쪽 끝면에서 오른쪽으로 연장 (칼라 있으면 칼라 폭 추가)
        xStart = bearingRx + (hasCollar ? collarW_px : 0);
        xEnd   = xStart + shaftL_px;
    } else if (mateAlign === 'left') {
        // ★ 왼쪽 끝면에서 왼쪽으로 연장
        xStart = bearingLx - (hasCollar ? collarW_px : 0) - shaftL_px;
        xEnd   = bearingLx - (hasCollar ? collarW_px : 0);
    } else {
        // center (기존 동작)
        xStart = cx - shaftL_px / 2;
        xEnd   = cx + shaftL_px / 2;
    }

    // ④ 보어 통과 구간 (베어링 내부 — 은선)
    ctx.save();
    ctx.setLineDash(DASH_HIDDEN);
    drawLine(bearingLx, cy - shaftR_px, bearingRx, cy - shaftR_px, COLOR.hiddenLine, LINE.hidden);
    drawLine(bearingLx, cy + shaftR_px, bearingRx, cy + shaftR_px, COLOR.hiddenLine, LINE.hidden);
    ctx.setLineDash([]);
    ctx.restore();

    // ⑤ 연장부 채우기 + 해칭
    const hatchStep = 7;
    ctx.fillStyle = COLOR.linked_fill;
    ctx.fillRect(xStart, cy - shaftR_px, xEnd - xStart, shaftR_px * 2);

    ctx.save();
    ctx.beginPath();
    ctx.rect(xStart, cy - shaftR_px, xEnd - xStart, shaftR_px * 2);
    ctx.clip();
    ctx.strokeStyle = 'rgba(123,158,192,0.45)';
    ctx.lineWidth = 0.7;
    for (let hx = xStart - shaftR_px * 2; hx < xEnd + shaftR_px * 2; hx += hatchStep) {
        ctx.beginPath(); ctx.moveTo(hx, cy - shaftR_px); ctx.lineTo(hx + shaftR_px * 2, cy + shaftR_px); ctx.stroke();
    }
    ctx.restore();

    // ⑥ 연장부 외형선
    drawLine(xStart, cy - shaftR_px, xEnd, cy - shaftR_px, COLOR.linked_shaft, LINE.outline);
    drawLine(xStart, cy + shaftR_px, xEnd, cy + shaftR_px, COLOR.linked_shaft, LINE.outline);
    drawLine(xEnd,   cy - shaftR_px, xEnd, cy + shaftR_px, COLOR.linked_shaft, LINE.outline);
    // ★ 베어링 쪽 끝단선 (칼라 없을 때만)
    if (!hasCollar) {
        if (mateAlign === 'right') drawLine(xStart, cy - shaftR_px, xStart, cy + shaftR_px, COLOR.linked_shaft, LINE.outline);
        if (mateAlign === 'left')  drawLine(xEnd,   cy - shaftR_px, xEnd,   cy + shaftR_px, COLOR.linked_shaft, LINE.outline);
    }

    // ⑦ 단차(칼라) 표시 — 베어링 끝면과 연장부 사이
    if (hasCollar) {
        let collarX1, collarX2;
        if (mateAlign === 'right') {
            collarX1 = bearingRx;
            collarX2 = bearingRx + collarW_px;
        } else {
            collarX1 = bearingLx - collarW_px;
            collarX2 = bearingLx;
        }
        // 칼라 채우기 (밝은 은색)
        ctx.fillStyle = 'rgba(200,210,220,0.85)';
        ctx.fillRect(collarX1, cy - collarR_px, collarX2 - collarX1, collarR_px * 2);
        // 칼라 외형선
        const collarC = '#8899AA';
        drawLine(collarX1, cy - collarR_px, collarX2, cy - collarR_px, collarC, LINE.outline); // 상면
        drawLine(collarX1, cy + collarR_px, collarX2, cy + collarR_px, collarC, LINE.outline); // 하면
        drawLine(collarX1, cy - collarR_px, collarX1, cy + collarR_px, collarC, LINE.outline); // 좌면
        drawLine(collarX2, cy - collarR_px, collarX2, cy + collarR_px, collarC, LINE.outline); // 우면
        // 단차 전환선 (축→칼라)
        if (mateAlign === 'right') {
            drawLine(collarX2, cy - collarR_px, collarX2, cy - shaftR_px, COLOR.linked_shaft, LINE.outline);
            drawLine(collarX2, cy + collarR_px, collarX2, cy + shaftR_px, COLOR.linked_shaft, LINE.outline);
        } else {
            drawLine(collarX1, cy - collarR_px, collarX1, cy - shaftR_px, COLOR.linked_shaft, LINE.outline);
            drawLine(collarX1, cy + collarR_px, collarX1, cy + shaftR_px, COLOR.linked_shaft, LINE.outline);
        }
    }

    // ⑧ 중심선
    const totalLeft  = Math.min(xStart, bearingLx) - 10;
    const totalRight = Math.max(xEnd,   bearingRx) + 10;
    drawCenterLineH(totalLeft, totalRight, cy);

    // ⑨ D2·L2 단차 가공
    const shaftD2 = dimVal(ldims, 'D2', 0);
    const shaftL2 = dimVal(ldims, 'L2', 0);
    if (shaftD2 > shaftD && shaftL2 > 0) {
        const r2   = (shaftD2 / 2) * sc;
        const ext2 = shaftL2 * sc;
        const extX = (mateAlign === 'left') ? xStart - ext2 : xEnd;
        ctx.fillStyle = COLOR.linked_fill;
        ctx.fillRect(extX, cy - r2, ext2, r2 * 2);
        ctx.save();
        ctx.beginPath(); ctx.rect(extX, cy - r2, ext2, r2 * 2); ctx.clip();
        ctx.strokeStyle = 'rgba(123,158,192,0.40)'; ctx.lineWidth = 0.7;
        for (let hx = extX - r2 * 2; hx < extX + ext2 + r2 * 2; hx += hatchStep) {
            ctx.beginPath(); ctx.moveTo(hx, cy - r2); ctx.lineTo(hx + r2 * 2, cy + r2); ctx.stroke();
        }
        ctx.restore();
        drawLine(extX, cy - shaftR_px, extX, cy - r2, COLOR.linked_shaft, LINE.outline);
        drawLine(extX, cy + shaftR_px, extX, cy + r2, COLOR.linked_shaft, LINE.outline);
        drawLine(extX, cy - r2, extX + ext2, cy - r2, COLOR.linked_shaft, LINE.outline);
        drawLine(extX, cy + r2, extX + ext2, cy + r2, COLOR.linked_shaft, LINE.outline);
        drawLine(extX + ext2, cy - r2, extX + ext2, cy + r2, COLOR.linked_shaft, LINE.outline);
    }

    // ⑩ 치수 표시
    if (showDimensions) {
        const off2 = 18;
        const dimY = cy - Math.max(shaftR_px, outerR_px) - 30;
        drawHDim(xStart, xEnd, dimY, -off2, 'L', shaftL);
        drawVDim(cy - shaftR_px, cy + shaftR_px, xStart - 8, -off2 - 10, 'Ø', shaftD);
    }

    // ─────────────────────────────────────────────
    // ⑪ 평행키 키홈 (Parallel Keyway) — 정면도: 상단 직사각형 노치
    //   pKey_Width (폭), pKey_Depth1 (깊이), PKeyOffset1 (위치), PKeyLength1 (길이)
    // ─────────────────────────────────────────────
    const kwayType2 = (ldims['_str_키 홈 형상'] || ldims['키 홈 형상'] || '').toString().toLowerCase();
    const pkW2  = ldims.pKey_Width  || ldims.PKEY_WIDTH  || ldims['평행키 폭']    || ldims.KEY_W || 0;
    const pkH2  = ldims.pKey_Height || ldims.PKEY_HEIGHT || ldims['평행키 높이']  || 0;
    const pkD2  = ldims.pKey_Depth1 || ldims.PKEY_DEPTH1 || ldims['축 키홈 깊이'] || (pkH2 * 0.6);
    const pkOff = Number(ldims.PKeyOffset1 || ldims['첫 번째 키홈 위치'] || 0) * sc;
    const pkLen = Number(ldims.PKeyLength1  || ldims['첫 번째 키홈 길이'] || shaftL * 0.6) * sc;
    const pkDpx = (pkD2 > 0 ? pkD2 : (pkH2 > 0 ? pkH2 * 0.6 : shaftR * 0.15)) * sc;

    if (pkW2 > 0 || kwayType2.includes('평행') || kwayType2.includes('parallel')) {
        const kxStart = (mateAlign === 'right') ? xStart + pkOff : xStart + (xEnd - xStart) * 0.1;
        const kxEnd   = kxStart + pkLen;
        const pkW_px  = (pkW2 > 0 ? pkW2 : shaftD * 0.25) * sc;
        // 키홈: 상단에서 pkD2 만큼 파인 직사각형 홈
        ctx.fillStyle = 'rgba(10,21,32,0.85)';
        ctx.fillRect(kxStart, cy - shaftR_px, kxEnd - kxStart, pkDpx);       // 상단 홈
        ctx.fillRect(kxStart, cy + shaftR_px - pkDpx, kxEnd - kxStart, pkDpx); // 하단 은선 대칭 (생략 — 1면 키홈)
        // 키홈 외형선
        drawLine(kxStart, cy - shaftR_px,           kxEnd, cy - shaftR_px,           '#0A1520', LINE.outline);
        drawLine(kxStart, cy - shaftR_px + pkDpx,   kxEnd, cy - shaftR_px + pkDpx,   '#0A1520', 0.7);
        drawLine(kxStart, cy - shaftR_px,            kxStart, cy - shaftR_px + pkDpx, '#0A1520', 0.7);
        drawLine(kxEnd,   cy - shaftR_px,            kxEnd,   cy - shaftR_px + pkDpx, '#0A1520', 0.7);

        // 두 번째 키홈
        const pk2Len = Number(ldims.PKeyLength2 || ldims['두 번째 키홈 길이'] || 0) * sc;
        if (pk2Len > 0) {
            const pk2Off  = Number(ldims.PKeyOffset2 || ldims['두 번째 키홈 위치'] || 0) * sc;
            const kx2Start = (mateAlign === 'right') ? xStart + pk2Off : xStart + (xEnd - xStart) * 0.5;
            const kx2End   = kx2Start + pk2Len;
            ctx.fillStyle = 'rgba(10,21,32,0.85)';
            ctx.fillRect(kx2Start, cy - shaftR_px, kx2End - kx2Start, pkDpx);
            drawLine(kx2Start, cy - shaftR_px, kx2End, cy - shaftR_px, '#0A1520', LINE.outline);
            drawLine(kx2Start, cy - shaftR_px + pkDpx, kx2End, cy - shaftR_px + pkDpx, '#0A1520', 0.7);
            drawLine(kx2Start, cy - shaftR_px, kx2Start, cy - shaftR_px + pkDpx, '#0A1520', 0.7);
            drawLine(kx2End,   cy - shaftR_px, kx2End,   cy - shaftR_px + pkDpx, '#0A1520', 0.7);
        }
    }

    // ─────────────────────────────────────────────
    // ⑫ 렌치 플랫 / 면취 (Wrench Flat) — 정면도: 양측 평면 절단
    //   wFlat_Depth (깊이), wFlat_Length (길이), WFlatOffset1 (위치)
    // ─────────────────────────────────────────────
    const wfStr2  = (ldims['_str_평면취 (렌치 플랫)'] || ldims['평면취 (렌치 플랫)'] || '').toString();
    const wfD2    = ldims.wFlat_Depth  || ldims.WFLAT_DEPTH  || ldims['이면폭 깊이'] || 0;
    const wfL2    = ldims.wFlat_Length || ldims.WFLAT_LENGTH || ldims['첫 번째 면취 길이'] || 0;
    const wfOff2  = Number(ldims.WFlatOffset1 || ldims['첫 번째 면취 거리'] || 0) * sc;
    const hasWF2  = (wfStr2 !== '' && !wfStr2.includes('없음') && !wfStr2.includes('None')) || wfD2 > 0;

    if (hasWF2) {
        const wfDepPx = (wfD2 > 0 ? Number(wfD2) : shaftD * 0.10) * sc;
        const wfLenPx = (wfL2 > 0 ? Number(wfL2) : shaftL * 0.40) * sc;
        const wfX1    = (mateAlign === 'right') ? xStart + wfOff2 : xStart + (xEnd - xStart) * 0.2;
        const wfX2    = wfX1 + wfLenPx;
        const flatTop = cy - shaftR_px + wfDepPx;
        const flatBot = cy + shaftR_px - wfDepPx;
        // 밝은 스틸 채우기 (평면 노출)
        ctx.fillStyle = 'rgba(153,176,200,0.65)';
        ctx.fillRect(wfX1, cy - shaftR_px, wfLenPx, wfDepPx);   // 상단 평면
        ctx.fillRect(wfX1, cy + shaftR_px - wfDepPx, wfLenPx, wfDepPx); // 하단 평면
        // 외형선
        const wfC = '#7799BB';
        drawLine(wfX1, flatTop, wfX2, flatTop, wfC, LINE.outline);
        drawLine(wfX1, flatBot, wfX2, flatBot, wfC, LINE.outline);
        drawLine(wfX1, cy - shaftR_px, wfX1, flatTop, wfC, 0.9);
        drawLine(wfX2, cy - shaftR_px, wfX2, flatTop, wfC, 0.9);
        drawLine(wfX1, cy + shaftR_px, wfX1, flatBot, wfC, 0.9);
        drawLine(wfX2, cy + shaftR_px, wfX2, flatBot, wfC, 0.9);
    }

    // ─────────────────────────────────────────────
    // ⑬ 슬리팅 (Slitting) — 축 끝단 절개선
    // ─────────────────────────────────────────────
    const slitW2 = ldims.slit_Width || ldims.SLIT_WIDTH || 0;
    const slitD2 = ldims.slit_Depth || ldims.SLIT_DEPTH || 0;
    const slitStr2 = (ldims['_str_슬리팅'] || ldims['슬리팅'] || '').toString();
    if ((slitStr2 !== '' && !slitStr2.includes('없음')) || (slitW2 > 0 && slitD2 > 0)) {
        const sw2   = (slitW2 > 0 ? slitW2 : shaftD * 0.06) * sc;
        const sd2   = (slitD2 > 0 ? slitD2 : shaftD * 0.40) * sc;
        // 끝단 슬롯: 수직 절개선
        ctx.fillStyle = 'rgba(6,12,20,0.90)';
        ctx.fillRect(xEnd - sw2 / 2, cy - sd2 / 2, sw2, sd2);
        drawLine(xEnd - sw2 / 2, cy - sd2 / 2, xEnd - sw2 / 2, cy + sd2 / 2, '#060C14', LINE.outline);
        drawLine(xEnd + sw2 / 2, cy - sd2 / 2, xEnd + sw2 / 2, cy + sd2 / 2, '#060C14', LINE.outline);
    }

    // ─────────────────────────────────────────────
    // ⑭ 바깥쪽 멈춤링 홈 (Outer Snap Ring) — 자유단에 추가 홈
    //   RingOffset2("바깥쪽 멈춤링 홈 거리")
    // ─────────────────────────────────────────────
    const outerFix2   = (ldims['_str_바깥쪽 고정 방식'] || ldims['바깥쪽 고정 방식'] || '').toString();
    const ringOff2_2d = Number(ldims.RingOffset2 || ldims['바깥쪽 멈춤링 홈 거리'] || 0);
    if (outerFix2.includes('멈춤') || outerFix2.includes('Snap') || ringOff2_2d > 0) {
        const orW2   = Number(ldims.retRing_Width || ldims.RETRING_WIDTH || 0);
        const orT2   = Number(ldims.retRing_Thickness || ldims.RETRING_THICKNESS || shaftD * 0.04);
        const orGW   = (orW2 > 0 ? orW2 : shaftD * 0.08) * sc;
        const orDep2 = (orT2 > 0 ? orT2 : shaftD * 0.04) * sc;
        const orDist = ringOff2_2d > 0 ? ringOff2_2d * sc : shaftL_px * 0.85;
        const orX    = (mateAlign === 'right') ? xStart + orDist - orGW / 2 :
                                                 xEnd   - orDist - orGW / 2;
        // 홈 (어두운 사각형)
        ctx.fillStyle = 'rgba(26,42,58,0.90)';
        ctx.fillRect(orX, cy - shaftR_px + orDep2, orGW, (shaftR_px - orDep2) * 2);
        drawLine(orX,       cy - shaftR_px, orX,       cy + shaftR_px, '#1A2A3A', LINE.outline);
        drawLine(orX + orGW, cy - shaftR_px, orX + orGW, cy + shaftR_px, '#1A2A3A', LINE.outline);
        drawLine(orX, cy - shaftR_px + orDep2, orX + orGW, cy - shaftR_px + orDep2, '#1A2A3A', 0.8);
        drawLine(orX, cy + shaftR_px - orDep2, orX + orGW, cy + shaftR_px - orDep2, '#1A2A3A', 0.8);
    }

    // ─────────────────────────────────────────────
    // ⑮ 수나사 끝단 (Male Thread) — 나사산 표현
    //   ThreadLength("수나사 길이"), 外Fix="수나사"
    // ─────────────────────────────────────────────
    const outerFixStr = (ldims['_str_바깥쪽 고정 방식'] || ldims['바깥쪽 고정 방식'] || '').toString();
    const threadLen2  = Number(ldims.ThreadLength || ldims['수나사 길이'] || 0);
    if (outerFixStr.includes('수나사') || outerFixStr.includes('Thread') || threadLen2 > 0) {
        const tLen2px = (threadLen2 > 0 ? threadLen2 : shaftL * 0.35) * sc;
        const tX1 = xEnd - tLen2px;  // 나사 시작 (끝단 방향)
        const tX2 = xEnd;
        // 나사산: 사선 해칭 (KS 관례: 나사 단면 표시)
        ctx.save();
        ctx.beginPath();
        ctx.rect(tX1, cy - shaftR_px, tLen2px, shaftR_px * 2);
        ctx.clip();
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.lineWidth = 0.6;
        const tPitch = Math.max(3, shaftR_px * 0.18);
        for (let tx = tX1; tx < tX2 + shaftR_px * 2; tx += tPitch) {
            ctx.beginPath();
            ctx.moveTo(tx, cy - shaftR_px);
            ctx.lineTo(tx - shaftR_px * 1.5, cy + shaftR_px);
            ctx.stroke();
        }
        ctx.restore();
        // 나사 유효경 점선
        ctx.setLineDash([3, 2]);
        drawLine(tX1, cy - shaftR_px * 0.85, tX2, cy - shaftR_px * 0.85, '#334455', 0.7);
        drawLine(tX1, cy + shaftR_px * 0.85, tX2, cy + shaftR_px * 0.85, '#334455', 0.7);
        ctx.setLineDash([]);
        // 나사 종단선
        drawLine(tX1, cy - shaftR_px, tX1, cy + shaftR_px, COLOR.linked_shaft, LINE.outline);
    }
}

// ─────────────────────────────────────────────
// 연결부품 ① — 축(Shaft) 평면도 (Top2D)
// ─────────────────────────────────────────────
/**
 * drawLinkedShaft_Top_2D
 * 평면도: 내경과 동일 크기의 원으로 축 단면 표시
 */
function drawLinkedShaft_Top_2D(ldims, mainDims, W, H, mateOffset, mateAlign) {
    const d  = dimVal(mainDims, 'd1', dimVal(mainDims, 'd', 20));
    const D  = dimVal(mainDims, 'D2', dimVal(mainDims, 'D', 40));
    const sc = calcScale(D, W, H, 0.4);
    const cx = W / 2, cy = H / 2;

    // ★ "축 지름" 한글 키 폴백 (DSFT)
    const shaftD   = dimVal(ldims, 'D', dimVal(ldims, 'd',
                     Number(ldims['축 지름(전체동일)'] || ldims['축 지름'] || ldims['축지름'] || ldims['축경'] || d)));
    const shaftR_px = (shaftD / 2) * sc;

    // ① 축 단면 원
    drawCircle(cx, cy, shaftR_px, COLOR.linked_shaft, LINE.outline, null, COLOR.linked_fill);

    // ② 평행키 홈 — 12시 방향 직사각형 노치
    const pkW2 = ldims.pKey_Width  || ldims.PKEY_WIDTH  || ldims['평행키 폭']   || ldims.KEY_W || 0;
    const pkH2 = ldims.pKey_Height || ldims.PKEY_HEIGHT || ldims['평행키 높이'] || 0;
    const pkD2 = ldims.pKey_Depth1 || ldims.PKEY_DEPTH1 || ldims['축 키홈 깊이'] || (pkH2 * 0.6);
    const kwayType2 = (ldims['_str_키 홈 형상'] || ldims['키 홈 형상'] || '').toString().toLowerCase();

    if (pkW2 > 0 || kwayType2.includes('평행') || kwayType2.includes('parallel')) {
        const kW_px = (pkW2 > 0 ? pkW2 : shaftD * 0.25) * sc;
        const kD_px = (pkD2 > 0 ? pkD2 : shaftD * 0.15) * sc;
        // 키홈: 축 상단 (12시) 에서 kD_px 깊이만큼 직사각형
        ctx.fillStyle = 'rgba(10,21,32,0.80)';
        ctx.fillRect(cx - kW_px / 2, cy - shaftR_px - kD_px, kW_px, kD_px);
        ctx.strokeStyle = '#0A1520';
        ctx.lineWidth = LINE.outline;
        ctx.strokeRect(cx - kW_px / 2, cy - shaftR_px - kD_px, kW_px, kD_px);
    }

    // ③ 우드러프 키홈 — 반원 노치
    const wkR2 = ldims.wKey_Radius || ldims.WKEY_RADIUS || 0;
    if (wkR2 > 0 || kwayType2.includes('우드러프') || kwayType2.includes('woodruff')) {
        const wr_px = (wkR2 > 0 ? wkR2 : shaftD * 0.18) * sc;
        ctx.beginPath();
        ctx.arc(cx, cy - shaftR_px, wr_px, Math.PI, 0);
        ctx.closePath();
        ctx.fillStyle = 'rgba(10,21,32,0.80)';
        ctx.fill();
        ctx.strokeStyle = '#0A1520';
        ctx.lineWidth = 0.9;
        ctx.stroke();
    }

    // ④ 렌치 플랫 — 좌우 직선 절단 (D면: 축 양면을 평행하게 절단)
    const wfStr2  = (ldims['_str_평면취 (렌치 플랫)'] || ldims['평면취 (렌치 플랫)'] || '').toString();
    const wfD2    = ldims.wFlat_Depth || ldims.WFLAT_DEPTH || ldims['이면폭 깊이'] || 0;
    const hasWF2  = (wfStr2 !== '' && !wfStr2.includes('없음') && !wfStr2.includes('None')) || wfD2 > 0;
    if (hasWF2) {
        const wdp = (wfD2 > 0 ? Number(wfD2) : shaftD * 0.10) * sc;
        const flatR = shaftR_px - wdp;
        // 축 원 위에 좌우 평면(현)을 표시
        ctx.fillStyle = 'rgba(153,176,200,0.55)';
        // 왼쪽 절단면
        ctx.beginPath();
        ctx.rect(cx - shaftR_px, cy - shaftR_px, wdp, shaftR_px * 2);
        ctx.clip && ctx.restore && null;
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, shaftR_px, 0, Math.PI * 2); ctx.clip();
        ctx.fillRect(cx - shaftR_px, cy - shaftR_px, wdp, shaftR_px * 2);
        ctx.fillRect(cx + shaftR_px - wdp, cy - shaftR_px, wdp, shaftR_px * 2);
        ctx.restore();
        // 평면 경계선
        drawLine(cx - flatR, cy - shaftR_px, cx - flatR, cy + shaftR_px, '#7799BB', LINE.outline);
        drawLine(cx + flatR, cy - shaftR_px, cx + flatR, cy + shaftR_px, '#7799BB', LINE.outline);
    }
}

// ─────────────────────────────────────────────
// 연결부품 ③ — 오일씰(Oil Seal) 정면도 / 측면도
// ─────────────────────────────────────────────
/**
 * drawLinkedOilSeal_Front_2D — 오일씰 단면도 (도넛 단면: 상하 2개의 사각형 단면)
 *
 * 치수 매핑 (베어링 DB 키 그대로):
 *   D2 / D → 외경    d1 / d → 내경    B / b → 폭
 *
 * 단면 레이아웃 (Front/Side 공통):
 *
 *   ┌────┐   ← cy - outerR   (상부 단면 상면)
 *   │XXXX│      (크로스해칭 — 고무/비금속 KS 관례)
 *   └────┘   ← cy - innerR   (상부 단면 하면)
 *   ─────── ← cy             (중심축 — 중심선)
 *   ┌────┐   ← cy + innerR   (하부 단면 상면)
 *   │XXXX│
 *   └────┘   ← cy + outerR   (하부 단면 하면)
 *
 *  | B(폭) |  ← x1 ~ x2
 */
function drawLinkedOilSeal_Front_2D(ldims, mainDims, W, H, mateOffset) {
    // ① 주 부품 치수
    const mainD  = dimVal(mainDims, 'D2', dimVal(mainDims, 'D',  40));
    const mainD1 = dimVal(mainDims, 'd1', dimVal(mainDims, 'd',  20));
    const mainB  = dimVal(mainDims, 'B',  10);
    const sc     = calcScale(Math.max(mainD, mainB * 2), W, H, 0.4);

    // ② 오일씰 치수 — 호칭 "dxDxB" 세 숫자 모두 파싱
    const titleStr = (ldims['_str_호칭'] || ldims['호칭'] || '').toString();
    const titleM   = titleStr.match(/(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)/);
    const title_d  = titleM ? Number(titleM[1]) : 0;
    const title_D  = titleM ? Number(titleM[2]) : 0;
    const title_B  = titleM ? Number(titleM[3]) : 0;

    const sealD1 = title_d > 0 ? title_d :
                   (ldims.d1 || ldims.d || ldims['내경'] || mainD1);

    const sealD_raw = title_D > 0 ? title_D :
                      (ldims.D2 || ldims.D || ldims['외경'] || mainD);

    // ★ 핵심 수정: B는 호칭 3번째 숫자 우선, mainDims.B 폴백 제거
    const B_raw2   = title_B > 0 ? title_B :
                     (ldims.B || ldims.b || ldims['두께'] || ldims['폭'] || 0);
    const maxSealW2 = (sealD_raw / 2) * 0.60;
    const B_fallback2 = Math.min((sealD_raw - sealD1) * 0.55, maxSealW2);
    const sealB  = Math.min(
        Math.max(Number(B_raw2) > 0 ? Number(B_raw2) : B_fallback2, 1),
        maxSealW2
    );

    // D2 캡: 베어링 외경 초과 방지
    const sealD     = Math.min(sealD_raw, mainD * 0.95);
    const outerR_px = (sealD  / 2) * sc;
    const innerR_px = (sealD1 / 2) * sc;
    const sealW_px  = sealB * sc;
    const ringH     = outerR_px - innerR_px;

    const cx = W / 2 + (Number(mateOffset) || 0) * sc;
    const cy = H / 2;

    // ③ 위치: 베어링 왼쪽(-X) 끝면 바로 바깥에 배치
    //   mateAlign='right' → 축이 오른쪽 → 오일씰은 왼쪽 끝면 외측
    //   x1 = bearingLx - sealW_px  (씰 왼쪽 끝)
    //   x2 = bearingLx             (베어링 왼쪽 끝면에 딱 붙음)
    const mainB_px = mainB * sc;
    const bearingLx = cx - mainB_px / 2;
    const x2 = bearingLx;
    const x1 = x2 - sealW_px;

    // ④ 상하 단면 채우기 (고무: 어두운 갈색)
    const fillColor = 'rgba(42,26,10,0.32)';
    ctx.fillStyle = fillColor;
    ctx.fillRect(x1, cy - outerR_px, sealW_px, ringH);   // 상부
    ctx.fillRect(x1, cy + innerR_px, sealW_px, ringH);   // 하부

    // ⑤ 크로스해칭 (45° + -45° — 고무/비금속 KS 단면)
    const crossStep = 6;
    for (const [clipY1, clipY2] of [
        [cy - outerR_px, cy - innerR_px],
        [cy + innerR_px, cy + outerR_px]
    ]) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x1, clipY1, sealW_px, clipY2 - clipY1);
        ctx.clip();
        ctx.strokeStyle = 'rgba(42,26,10,0.48)';
        ctx.lineWidth = 0.6;
        const hRange = clipY2 - clipY1;
        for (let hx = x1 - hRange; hx < x2 + hRange; hx += crossStep) {
            ctx.beginPath(); ctx.moveTo(hx, clipY1); ctx.lineTo(hx + hRange, clipY2); ctx.stroke();
        }
        for (let hx = x1 - hRange; hx < x2 + hRange; hx += crossStep) {
            ctx.beginPath(); ctx.moveTo(hx + hRange, clipY1); ctx.lineTo(hx, clipY2); ctx.stroke();
        }
        ctx.restore();
    }

    // ⑥ 외형선
    const sc2 = '#2A1A0A';
    drawLine(x1, cy - outerR_px, x2, cy - outerR_px, sc2, LINE.outline);
    drawLine(x1, cy - innerR_px, x2, cy - innerR_px, sc2, LINE.outline);
    drawLine(x1, cy - outerR_px, x1, cy - innerR_px, sc2, LINE.outline);
    drawLine(x2, cy - outerR_px, x2, cy - innerR_px, sc2, LINE.outline);
    drawLine(x1, cy + innerR_px, x2, cy + innerR_px, sc2, LINE.outline);
    drawLine(x1, cy + outerR_px, x2, cy + outerR_px, sc2, LINE.outline);
    drawLine(x1, cy + innerR_px, x1, cy + outerR_px, sc2, LINE.outline);
    drawLine(x2, cy + innerR_px, x2, cy + outerR_px, sc2, LINE.outline);

    // ⑦ 씰 립 강조선
    const lipR_px = innerR_px + ringH * 0.18;
    drawLine(x1, cy - lipR_px, x2, cy - lipR_px, sc2, 0.7);
    drawLine(x1, cy + lipR_px, x2, cy + lipR_px, sc2, 0.7);

    // ⑧ 중심선
    drawCenterLineH(x1 - 14, x2 + 14, cy);

    // ⑨ 치수 표시
    if (showDimensions) {
        const off2 = 18;
        drawHDim(x1, x2, cy - outerR_px, -off2, 'B', sealB);
        drawVDim(cy - outerR_px, cy + outerR_px, x2,      off2,      'D',  sealD);
        drawVDim(cy - innerR_px, cy + innerR_px, x1, -off2 - 12, 'd1', sealD1);
    }
}

// ─────────────────────────────────────────────
// 연결부품 ③-B — 오일씰(Oil Seal) 평면도 (Top2D)
// ─────────────────────────────────────────────
/**
 * drawLinkedOilSeal_Top_2D — 오일씰 평면도 (동심원 링)
 *
 * 평면도에서 오일씰은 베어링처럼 동심원으로 표현:
 *   외원: 오일씰 외경(D2)
 *   내원: 오일씰 내경(d1) = 축경
 *   위치: 베어링 왼쪽(-X) 끝면 (mateAlign='right' 기준)
 *
 * 단면 표현이 아닌 정면(End) 뷰이므로 크로스해칭 불필요
 */
function drawLinkedOilSeal_Top_2D(ldims, mainDims, W, H, mateOffset) {
    // ① 치수
    const mainD  = dimVal(mainDims, 'D2', dimVal(mainDims, 'D',  40));
    const mainD1 = dimVal(mainDims, 'd1', dimVal(mainDims, 'd',  20));
    const mainB  = dimVal(mainDims, 'B',  10);
    const sc     = calcScale(Math.max(mainD, mainB * 2), W, H, 0.4);

    const sealD1 = ldims.d1 || ldims.d || ldims['내경'] || mainD1;

    // 호칭 "dxDxB" 파싱 — 전체 3숫자
    const titleStr = (ldims['_str_호칭'] || ldims['호칭'] || '').toString();
    const titleM   = titleStr.match(/(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)/);
    const sealD_raw = (titleM ? Number(titleM[2]) : 0) ||
                      ldims.D2 || ldims.D || ldims['외경'] || mainD;
    const sealD = Math.min(sealD_raw, mainD * 0.95);  // D2 캡

    const outerR_px = (sealD  / 2) * sc;
    const innerR_px = (sealD1 / 2) * sc;
    const ringW     = outerR_px - innerR_px;

    // ② 위치: 베어링 중심과 동일 (Top2D는 베어링 원 위에 오버레이)
    const cx = W / 2 + (Number(mateOffset) || 0) * sc;
    const cy = H / 2;

    // ③ 링 채우기 (반투명 갈색 — 고무)
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, outerR_px, 0, Math.PI * 2);
    ctx.arc(cx, cy, innerR_px, 0, Math.PI * 2, true);
    ctx.fillStyle = 'rgba(42,26,10,0.28)';
    ctx.fill();

    // ④ 외형선
    const sc2 = '#2A1A0A';
    // 외원
    ctx.beginPath();
    ctx.arc(cx, cy, outerR_px, 0, Math.PI * 2);
    ctx.strokeStyle = sc2;
    ctx.lineWidth = LINE.outline;
    ctx.stroke();
    // 내원
    ctx.beginPath();
    ctx.arc(cx, cy, innerR_px, 0, Math.PI * 2);
    ctx.strokeStyle = sc2;
    ctx.lineWidth = LINE.outline;
    ctx.stroke();

    // ⑤ 씰 립 강조선 (내경 근처 원)
    const lipR_px = innerR_px + ringW * 0.18;
    ctx.beginPath();
    ctx.arc(cx, cy, lipR_px, 0, Math.PI * 2);
    ctx.strokeStyle = sc2;
    ctx.lineWidth = 0.7;
    ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // ⑥ 치수 표시
    if (showDimensions) {
        const off2 = 18;
        drawVDim(cy - outerR_px, cy + outerR_px, cx + outerR_px + 8, off2, 'D', sealD);
        drawVDim(cy - innerR_px, cy + innerR_px, cx - innerR_px - 8, -off2 - 12, 'd1', sealD1);
    }
}

// ─────────────────────────────────────────────
// 연결부품 ② — 하우징(Housing) 정면도
// ─────────────────────────────────────────────
/**
 * drawLinkedHousing_Front_2D — 필로우블록/하우징 간략 표현
 */
function drawLinkedHousing_Front_2D(ldims, mainDims, W, H, mateOffset) {
    const D  = dimVal(mainDims, 'D2', dimVal(mainDims, 'D', 40));
    const B  = dimVal(mainDims, 'B', 16);
    const sc = calcScale(Math.max(D * 2.2, B * 3), W, H, 0.32);
    const cx = W / 2 + (Number(mateOffset) || 0) * sc;
    const cy = H / 2;

    const hw    = dimVal(ldims, 'HW', dimVal(ldims, 'W', D * 1.8)) * sc;
    const hh    = dimVal(ldims, 'HH', dimVal(ldims, 'H', D * 1.4)) * sc;
    const boreR = (D / 2) * sc;
    const topY  = cy - hh * 0.65;

    // 하우징 채우기
    ctx.fillStyle = COLOR.linked_housing;
    ctx.fillRect(cx - hw / 2, topY, hw, hh);

    // 외형선
    ctx.strokeStyle = '#8B7355';
    ctx.lineWidth   = LINE.outline;
    ctx.strokeRect(cx - hw / 2, topY, hw, hh);

    // 보어 홀 — 은선 원
    ctx.setLineDash(DASH_HIDDEN);
    drawCircle(cx, cy, boreR, COLOR.hiddenLine, LINE.hidden);
    ctx.setLineDash([]);

    // 베이스 볼트홀 (간략 표시)
    const boltXoff = hw * 0.35;
    const boltY    = cy + hh * 0.3;
    for (const bx of [-boltXoff, boltXoff]) {
        drawCircle(cx + bx, boltY, 3.5, '#8B7355', 0.9);
    }

    // 중심선
    drawCenterLineH(cx - hw / 2 - 14, cx + hw / 2 + 14, cy);
    drawCenterLineV(cx, topY - 12, cy + hh * 0.35 + 12);

    // 치수 표시
    if (showDimensions) {
        const off2 = 18;
        drawHDim(cx - hw / 2, cx + hw / 2, topY, -off2, 'HW', hw / sc);
        drawVDim(topY, topY + hh, cx + hw / 2, off2, 'HH', hh / sc);
    }
}

// ═══════════════════════════════════════════════════════
// 베어링 공용 2D 헬퍼
// ═══════════════════════════════════════════════════════

/** 베어링 단면 기본 레이아웃 파라미터 계산 */
function _brg2dLayout(d, D, B, W, H, margin) {
    const sc = calcScale(Math.max(D, B*1.5), W, H, margin||0.45);
    const cx = W/2, cy = H/2;
    const outerR_px = (D/2)*sc, innerR_px = (d/2)*sc, halfB_px = (B/2)*sc;
    return { sc, cx, cy, outerR_px, innerR_px, halfB_px, d, D, B };
}

/** 베어링 상하 링 단면 (직사각형 2개) */
function _drawBrgRingSections(cx, cy, outerR_px, innerR_px, halfB_px, ringW_px, color) {
    color = color || COLOR.outline;
    for (const sign of [-1, 1]) {
        const yc = cy + sign * (outerR_px - ringW_px/2);
        drawRect(cx - halfB_px, yc - ringW_px/2, halfB_px*2, ringW_px, color, LINE.outline);
    }
    // 가운데 보어 공간
    drawLine(cx - halfB_px, cy - innerR_px, cx + halfB_px, cy - innerR_px, color, LINE.outline);
    drawLine(cx - halfB_px, cy + innerR_px, cx + halfB_px, cy + innerR_px, color, LINE.outline);
    drawLine(cx - halfB_px, cy - outerR_px, cx - halfB_px, cy + outerR_px, color, LINE.outline);
    drawLine(cx + halfB_px, cy - outerR_px, cx + halfB_px, cy + outerR_px, color, LINE.outline);
}

/** 볼 열 그리기 */
function _drawBallRow(cx, cy, pitchR_px, ballR_px, numBalls, yOff) {
    yOff = yOff || 0;
    for (let i=0; i<numBalls; i++) {
        const a = 2*Math.PI*i/numBalls;
        const bx = cx + pitchR_px*Math.cos(a);
        const by = cy + yOff + pitchR_px*Math.sin(a);
        drawCircle(bx, by, ballR_px, COLOR.ball, LINE.outline, null, COLOR.ball);
    }
}

// ═══════════════════════════════════════════════
// ⑭ ANBB — 앵귤러 컨택트 볼 베어링 2D
// ═══════════════════════════════════════════════
function drawANBB_Front(dims, W, H) {
    // ★ 표준 베어링 치수 매핑 (d1 우선)
    const d=dimVal(dims,'d1',dimVal(dims,'D1',25));
    const D=dimVal(dims,'D2',dimVal(dims,'D',52));
    const B=dimVal(dims,'B',15);
    const ca=(dimVal(dims,'ContactAngle',25))*Math.PI/180;
    const {sc,cx,cy,outerR_px,innerR_px,halfB_px} = _brg2dLayout(d,D,B,W,H);

    const ringW = (outerR_px-innerR_px)*0.55;
    const pitchR_px = (outerR_px+innerR_px)/2;
    const ballR_px  = (outerR_px-innerR_px)*0.13;
    const numBalls  = Math.max(6,Math.floor(Math.PI*(d+D)/2/((D-d)*0.26*1.65)));

    // 외곽 사각형 (단면)
    drawRect(cx-halfB_px, cy-outerR_px, halfB_px*2, outerR_px-innerR_px);
    drawRect(cx-halfB_px, cy+innerR_px, halfB_px*2, outerR_px-innerR_px);
    // 접촉각 표시선
    const caOff = Math.sin(ca)*pitchR_px*0.3;
    ctx.setLineDash([3,3]);
    drawLine(cx-halfB_px*0.5, cy-pitchR_px-caOff, cx+halfB_px*0.5, cy-pitchR_px+caOff, COLOR.hiddenLine, LINE.hidden);
    drawLine(cx-halfB_px*0.5, cy+pitchR_px-caOff, cx+halfB_px*0.5, cy+pitchR_px+caOff, COLOR.hiddenLine, LINE.hidden);
    ctx.setLineDash([]);
    // 볼 (접촉각 오프셋)
    _drawBallRow(cx, cy, pitchR_px, ballR_px, numBalls, Math.sin(ca)*pitchR_px*0.08);
    drawCenterLineH(cx-halfB_px-14, cx+halfB_px+14, cy);
    drawCenterLineV(cx, cy-outerR_px-14, cy+outerR_px+14);
    if (showDimensions) {
        drawHDim(cx-halfB_px,cx+halfB_px, cy-outerR_px,-20,'B',B);
        drawVDim(cy-outerR_px,cy+outerR_px, cx+halfB_px,20,'D',D);
        drawVDim(cy-innerR_px,cy+innerR_px, cx-halfB_px,-20,'d',d);
    }
}

// ═══════════════════════════════════════════════
// ⑮ TRBR — 테이퍼 롤러 베어링 2D
// ═══════════════════════════════════════════════
function drawTRBR_Front(dims, W, H) {
    // ★ 표준 베어링 치수 매핑 (d1 우선)  
    const d=dimVal(dims,'d1',dimVal(dims,'D1',25));
    const D=dimVal(dims,'D2',dimVal(dims,'D',52));
    const T=dimVal(dims,'T',dimVal(dims,'B',16));
    const {sc,cx,cy,outerR_px,innerR_px} = _brg2dLayout(d,D,T,W,H);
    const halfT_px = (T/2)*sc;
    const ringW = (outerR_px-innerR_px)*0.50;
    const pitchR_px = (outerR_px+innerR_px)/2;
    const taperOff = ringW*0.25;  // 테이퍼 오프셋

    // 상단 단면 (사다리꼴)
    drawPolygon([[cx-halfT_px,cy-innerR_px],[cx+halfT_px,cy-innerR_px-taperOff],[cx+halfT_px,cy-outerR_px+taperOff],[cx-halfT_px,cy-outerR_px]]);
    // 하단 단면
    drawPolygon([[cx-halfT_px,cy+outerR_px],[cx+halfT_px,cy+outerR_px-taperOff],[cx+halfT_px,cy+innerR_px+taperOff],[cx-halfT_px,cy+innerR_px]]);
    // 롤러 열
    const rollerH = ringW*0.75, rollerW = halfT_px*0.8;
    ctx.fillStyle = COLOR.ball;
    for (const sign of [-1,1]) {
        const ryc = cy + sign*pitchR_px;
        ctx.fillRect(cx-rollerW/2, ryc-rollerH/2, rollerW, rollerH);
        drawRect(cx-rollerW/2, ryc-rollerH/2, rollerW, rollerH);
    }
    drawCenterLineH(cx-halfT_px-14, cx+halfT_px+14, cy);
    if (showDimensions) {
        drawHDim(cx-halfT_px,cx+halfT_px,cy-outerR_px,-20,'T',T);
        drawVDim(cy-outerR_px,cy+outerR_px,cx+halfT_px,20,'D',D);
        drawVDim(cy-innerR_px,cy+innerR_px,cx-halfT_px,-20,'d',d);
    }
}
function drawTRBR_Top(dims, W, H) { drawDGBB_Top(dims, W, H); }

// ═══════════════════════════════════════════════
// ⑯ CYLR — 원통 롤러 베어링 2D
// ═══════════════════════════════════════════════
function drawCYLR_Front(dims, W, H) {
    // ★ 표준 베어링 치수 매핑 (d1 우선)
    const d=dimVal(dims,'d1',dimVal(dims,'D1',25));
    const D=dimVal(dims,'D2',dimVal(dims,'D',52));
    const B=dimVal(dims,'B',15);
    const {sc,cx,cy,outerR_px,innerR_px,halfB_px} = _brg2dLayout(d,D,B,W,H);
    const ringW=(outerR_px-innerR_px)*0.50, pitchR_px=(outerR_px+innerR_px)/2;
    const rollerH=ringW*0.80, rollerW=halfB_px*0.75;

    // 링 단면 (사각형)
    drawRect(cx-halfB_px, cy-outerR_px, halfB_px*2, ringW);
    drawRect(cx-halfB_px, cy+innerR_px, halfB_px*2, ringW);
    // 원통 롤러 (직사각형)
    for (const sign of [-1,1]) {
        ctx.fillStyle = COLOR.ball;
        ctx.fillRect(cx-rollerW/2, cy+sign*pitchR_px-rollerH/2, rollerW, rollerH);
        drawRect(cx-rollerW/2, cy+sign*pitchR_px-rollerH/2, rollerW, rollerH);
    }
    drawCenterLineH(cx-halfB_px-14,cx+halfB_px+14,cy);
    if (showDimensions) {
        drawHDim(cx-halfB_px,cx+halfB_px,cy-outerR_px,-20,'B',B);
        drawVDim(cy-outerR_px,cy+outerR_px,cx+halfB_px,20,'D',D);
        drawVDim(cy-innerR_px,cy+innerR_px,cx-halfB_px,-20,'d',d);
    }
}

// ═══════════════════════════════════════════════
// ⑰ THRB — 스러스트 볼 베어링 2D
// ═══════════════════════════════════════════════
function drawTHRB_Front(dims, W, H) {
    // ★ 표준 베어링 치수 매핑 (d1 우선)
    const d=dimVal(dims,'d1',dimVal(dims,'D1',20));
    const D=dimVal(dims,'D2',dimVal(dims,'D',47));
    const T=dimVal(dims,'T',dimVal(dims,'B',11));
    const sc=calcScale(Math.max(D,T*3), W, H, 0.45);
    const cx=W/2, cy=H/2;
    const outerR_px=(D/2)*sc, innerR_px=(d/2)*sc, halfT_px=(T/2)*sc;
    const ringH=halfT_px*0.7;
    const pitchR_px=(outerR_px+innerR_px)/2;
    const ballR_px=(outerR_px-innerR_px)*0.13;
    const numBalls=Math.max(6,Math.floor(Math.PI*(d+D)/2/((D-d)*0.22*1.5)));

    // 하부 링 (shaft washer)
    drawRect(cx-innerR_px, cy-halfT_px, innerR_px, ringH);
    drawRect(cx, cy-halfT_px, innerR_px, ringH);
    // 볼
    for (let i=0; i<numBalls; i++) {
        const a=2*Math.PI*i/numBalls;
        drawCircle(cx+pitchR_px*Math.cos(a), cy+pitchR_px*Math.sin(a)*0.25, ballR_px, COLOR.ball, LINE.outline, null, COLOR.ball);
    }
    // 상부 링 (housing washer)
    drawRect(cx-outerR_px, cy+halfT_px-ringH, outerR_px, ringH);
    drawRect(cx, cy+halfT_px-ringH, outerR_px, ringH);
    drawCenterLineV(cx, cy-halfT_px-14, cy+halfT_px+14);
    if (showDimensions) {
        drawHDim(cx-outerR_px,cx+outerR_px,cy+halfT_px,20,'D',D);
        drawVDim(cy-halfT_px,cy+halfT_px,cx+outerR_px,20,'T',T);
        drawHDim(cx-innerR_px,cx+innerR_px,cy-halfT_px,-20,'d',d);
    }
}
function drawTHRB_Top(dims, W, H) {
    // ★ 표준 베어링 치수 매핑 (d1 우선)
    const d=dimVal(dims,'d1',dimVal(dims,'D1',20)), D=dimVal(dims,'D2',dimVal(dims,'D',47));
    const sc=calcScale(D,W,H,0.4);
    const cx=W/2, cy=H/2;
    drawCircle(cx,cy,(D/2)*sc); drawCircle(cx,cy,(d/2)*sc);
    drawCenterCross(cx,cy,(D/2)*sc+15);
    if (showDimensions) {
        drawHDim(cx-(D/2)*sc,cx+(D/2)*sc,cy,(D/2)*sc+25,'D',D);
        drawHDim(cx-(d/2)*sc,cx+(d/2)*sc,cy,-(d/2)*sc-25,'d',d);
    }
}

// ═══════════════════════════════════════════════
// ⑱ SRRB — 자동조심 롤러 베어링 2D
// ═══════════════════════════════════════════════
function drawSRRB_Front(dims, W, H) {
    // ★ 표준 베어링 치수 매핑 (d1 우선)
    const d=dimVal(dims,'d1',dimVal(dims,'D1',30));
    const D=dimVal(dims,'D2',dimVal(dims,'D',62));
    const B=dimVal(dims,'B',20);
    const {sc,cx,cy,outerR_px,innerR_px,halfB_px}=_brg2dLayout(d,D,B,W,H);
    const ringW=(outerR_px-innerR_px)*0.52, pitchR_px=(outerR_px+innerR_px)/2;
    const rollerH=ringW*0.80, rollerW=halfB_px*0.55;

    // 외륜 (구형 외면 — 약간 볼록한 호로 표현)
    ctx.beginPath();
    ctx.arc(cx-halfB_px, cy, outerR_px*1.02, -Math.PI*0.15, Math.PI*0.15);
    ctx.arc(cx+halfB_px, cy, outerR_px*1.02, Math.PI*0.85, Math.PI*1.15);
    ctx.fillStyle=COLOR.fill; ctx.fill();
    ctx.strokeStyle=COLOR.outline; ctx.lineWidth=LINE.outline; ctx.stroke();
    // 내륜
    drawRect(cx-halfB_px, cy-innerR_px-ringW, halfB_px*2, ringW);
    drawRect(cx-halfB_px, cy+innerR_px, halfB_px*2, ringW);
    // 복열 롤러
    for (const row of [-0.35,0.35]) {
        for (const sign of [-1,1]) {
            ctx.fillStyle=COLOR.ball;
            ctx.fillRect(cx+row*halfB_px-rollerW/2, cy+sign*pitchR_px-rollerH/2, rollerW, rollerH);
            drawRect(cx+row*halfB_px-rollerW/2, cy+sign*pitchR_px-rollerH/2, rollerW, rollerH);
        }
    }
    drawCenterLineH(cx-halfB_px-14,cx+halfB_px+14,cy);
    if (showDimensions) {
        drawHDim(cx-halfB_px,cx+halfB_px,cy-outerR_px,-20,'B',B);
        drawVDim(cy-outerR_px,cy+outerR_px,cx+halfB_px,20,'D',D);
        drawVDim(cy-innerR_px,cy+innerR_px,cx-halfB_px,-20,'d',d);
    }
}

// ═══════════════════════════════════════════════
// ⑲ UNIT — 인서트 베어링 2D (v36: C++ CreateUCBearing 원본 기반)
// ═══════════════════════════════════════════════

/**
 * 2D Canvas 폴리라인에 호(arc) 세분화 점들을 추가하는 헬퍼.
 * Canvas 좌표계(y-down)에서 직접 작동.
 * addFn(x, y)는 각 중간점을 lineTo 등으로 추가.
 */
function appendArc2D(addFn, cx, cy, sx, sy, ex, ey, shortArc, segments) {
    const r = Math.hypot(sx - cx, sy - cy);
    let a1 = Math.atan2(sy - cy, sx - cx);
    let a2 = Math.atan2(ey - cy, ex - cx);
    let delta = a2 - a1;
    while (delta >  Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    if (!shortArc) {
        delta = delta > 0 ? delta - Math.PI * 2 : delta + Math.PI * 2;
    }
    // 끝점은 caller가 별도 처리 (여기선 i ≤ segments로 끝점 포함)
    for (let i = 1; i <= segments; i++) {
        const t = i / segments;
        const a = a1 + delta * t;
        addFn(cx + r * Math.cos(a), cy + r * Math.sin(a));
    }
}

/**
 * UC 단면도 단일 링 (상 또는 하) 그리기.
 * sign: -1 = 보어 축 위쪽, +1 = 아래쪽 (canvas y-down)
 * 좌표 변환: C++(wx, ry) → canvas(cx + sc*wx, cy + sign*sc*ry)
 * ★ v38: 외륜 shoulder(lip) 반영
 */
function _drawUCSection(sign, geom, cx, cy, sc) {
    const {halfB, halfC, innerR, innerRingOR, outerRingIR, outerR,
           pcdR, grooveR, intersectR, r, ballR} = geom;
    const X = wx => cx + sc * wx;
    const Y = ry => cy + sign * sc * ry;

    // ── 내륜: 매끈한 원통 + 양 끝 모따기 (v41: 궤도 홈 제거) ──
    ctx.beginPath();
    ctx.moveTo(X(-halfB + r), Y(innerR));
    ctx.lineTo(X( halfB - r), Y(innerR));
    ctx.lineTo(X( halfB),     Y(innerR + r));
    ctx.lineTo(X( halfB),     Y(innerRingOR));
    ctx.lineTo(X(-halfB),     Y(innerRingOR));
    ctx.lineTo(X(-halfB),     Y(innerR + r));
    ctx.closePath();
    ctx.fillStyle = COLOR.fill;    ctx.fill();
    ctx.strokeStyle = COLOR.outline; ctx.lineWidth = LINE.outline; ctx.stroke();

    // ── 외륜: v44 deep shoulder — 내륜 바로 옆까지 깊게 ──
    const gapToInner = 0.3;
    const lipR_v41 = (ballR !== undefined && innerRingOR !== undefined)
        ? innerRingOR + gapToInner
        : outerRingIR * 0.55;   // 폴백: 외륜 내경의 약 55% 지점
    const lipAxialDepth = (ballR !== undefined) ? (ballR + 0.5) : halfC * 0.6;
    const lipW_v41 = halfC - lipAxialDepth;
    const transStep = 0;
    const grooveR_shallow = (ballR !== undefined)
        ? Math.min(ballR * 0.25, lipW_v41 - 0.3)
        : Math.max(0.2, lipW_v41 - 0.3);
    const hasLip = (lipR_v41 < outerRingIR - 1.0)
                && (innerRingOR === undefined || lipR_v41 > innerRingOR + 0.15)
                && (lipW_v41 > grooveR_shallow + 0.3)
                && (lipAxialDepth < halfC - 0.5);

    ctx.beginPath();
    if (hasLip) {
        ctx.moveTo(X(-halfC),      Y(lipR_v41));
        ctx.lineTo(X(-lipW_v41),   Y(lipR_v41));
        ctx.lineTo(X(-lipW_v41 + transStep), Y(outerRingIR));
        ctx.lineTo(X(-grooveR_shallow), Y(outerRingIR));
    } else {
        ctx.moveTo(X(-halfC),      Y(outerRingIR));
        ctx.lineTo(X(-grooveR_shallow), Y(outerRingIR));
    }

    // 얕은 홈 arc
    appendArc2D((x, y) => ctx.lineTo(x, y),
        X(0), Y(pcdR),
        X(-grooveR_shallow), Y(outerRingIR),
        X( grooveR_shallow), Y(outerRingIR),
        true, 14);

    if (hasLip) {
        ctx.lineTo(X( grooveR_shallow), Y(outerRingIR));
        ctx.lineTo(X( lipW_v41 - transStep), Y(outerRingIR));
        ctx.lineTo(X( lipW_v41),   Y(lipR_v41));
        ctx.lineTo(X( halfC),      Y(lipR_v41));
    } else {
        ctx.lineTo(X( grooveR_shallow), Y(outerRingIR));
        ctx.lineTo(X( halfC),      Y(outerRingIR));
    }

    ctx.lineTo(X( halfC),      Y(intersectR));

    // 구면 arc
    appendArc2D((x, y) => ctx.lineTo(x, y),
        X(0), Y(0),
        X( halfC), Y(intersectR),
        X(-halfC), Y(intersectR),
        true, 20);

    ctx.lineTo(X(-halfC), Y(intersectR));
    ctx.closePath();
    ctx.fillStyle = COLOR.fill;    ctx.fill();
    ctx.strokeStyle = COLOR.outline; ctx.lineWidth = LINE.outline; ctx.stroke();
}

function drawUNIT_Front(dims, W, H) {
    // ★ v37: 엑셀 치수 정의 엄밀 매핑
    const d  = dimVal(dims,'d1', dimVal(dims,'d', dimVal(dims,'D1', 25)));
    let   D  = dimVal(dims,'D2', dimVal(dims,'D', 0));
    let   dk = dimVal(dims,'dk', 0);
    let   B  = dimVal(dims,'B',  0);
    let   C  = dimVal(dims,'C',  0);
    let   r  = dimVal(dims,'r',  0);
    const Dw = dimVal(dims,'Dw', 0);
    const dm = dimVal(dims,'dm', 0);

    if (D  <= 0) D  = d * 2.07;
    if (dk <= 0) dk = D;
    if (B  <= 0) B  = d * 1.36;
    if (C  <= 0) C  = D * 0.30;
    if (r  <= 0) r  = Math.max(0.6, d * 0.04);

    const innerR  = d / 2;
    const outerR  = D / 2;
    const sphereR = dk / 2;
    const halfB   = B / 2;
    const halfC   = C / 2;

    let innerRingOR, outerRingIR, pcdR, ballR;
    const dwDmValid = (Dw > 0 && dm > 0
                    && (dm / 2 - Dw / 2) > innerR
                    && (dm / 2 + Dw / 2) < outerR);
    if (dwDmValid) {
        pcdR = dm / 2;
        ballR = Dw / 2;
        innerRingOR = pcdR - ballR;
        outerRingIR = pcdR + ballR;
    } else {
        innerRingOR = innerR + (outerR - innerR) * 0.26;
        outerRingIR = innerR + (outerR - innerR) * 0.85;
        pcdR  = (innerRingOR + outerRingIR) / 2;
        ballR = (outerRingIR - innerRingOR) * 0.50;
    }
    // 궤도 홈 동적 조정 (3D와 동일 로직, v39)
    const minWall = 0.4;
    const dx = outerRingIR - pcdR;
    const grooveMaxBase = sphereR - pcdR - minWall;
    let grooveR;
    if (grooveMaxBase > dx) {
        const grooveRMax = Math.sqrt(grooveMaxBase * grooveMaxBase - dx * dx);
        grooveR = Math.min(ballR * 1.04, grooveRMax);
        if (grooveR < ballR * 0.95) grooveR = ballR * 0.95;
    } else {
        grooveR = ballR * 0.95;
    }
    const intersectR = Math.sqrt(Math.max(0, sphereR * sphereR - halfC * halfC));

    const sc = calcScale(Math.max(dk, B * 1.2), W, H, 0.4);
    const cx = W / 2, cy = H / 2;

    const geom = {halfB, halfC, innerR, innerRingOR, outerRingIR, outerR: sphereR,
                  pcdR, grooveR, intersectR, r, ballR};

    _drawUCSection(-1, geom, cx, cy, sc);
    _drawUCSection( 1, geom, cx, cy, sc);

    // v42: 볼 그리기 제거 (실제 CAD 이미지처럼 외부에서 볼 안 보임)
    // 필요 시 showDimensions와 유사한 옵션으로 제어 가능

    const halfB_px  = sc * halfB;
    const sphereR_px = sc * sphereR;
    drawCenterLineH(cx - halfB_px - 14, cx + halfB_px + 14, cy);
    drawCenterLineV(cx, cy - sphereR_px - 14, cy + sphereR_px + 14);

    if (showDimensions) {
        drawHDim(cx - halfB_px, cx + halfB_px, cy - sphereR_px, -20, 'B', B);
        drawVDim(cy - sphereR_px, cy + sphereR_px, cx + halfB_px, 20,
                 (dims.dk ? 'dk' : 'D'), (dims.dk ? dk : D));
        drawVDim(cy - sc * innerR, cy + sc * innerR, cx - halfB_px, -20, 'd', d);
        drawHDim(cx - sc * halfC, cx + sc * halfC, cy + sphereR_px, 20, 'C', C);
    }
}

function drawUNIT_Top(dims, W, H) {
    // ★ v37: dk 우선, 없으면 D
    const d  = dimVal(dims,'d1', dimVal(dims,'d', dimVal(dims,'D1', 25)));
    let   D  = dimVal(dims,'D2', dimVal(dims,'D', 0));
    let   dk = dimVal(dims,'dk', 0);
    if (D  <= 0) D  = d * 2.07;
    if (dk <= 0) dk = D;

    const sc = calcScale(dk, W, H, 0.4);
    const cx = W / 2, cy = H / 2;
    const oR = (dk / 2) * sc;
    const iR = (d  / 2) * sc;

    drawCircle(cx, cy, oR, COLOR.outline, LINE.outline, null, COLOR.fill);
    drawCircle(cx, cy, iR);
    drawCenterCross(cx, cy, oR + 15);

    if (showDimensions) {
        drawHDim(cx - oR, cx + oR, cy,  oR + 25, (dims.dk ? 'dk' : 'D'), dk);
        drawHDim(cx - iR, cx + iR, cy, -iR - 25, 'd', d);
    }
}

// ═══════════════════════════════════════════════
// ⑳ PILB — 플러머블록 2D
// ═══════════════════════════════════════════════
function drawPILB_Front(dims, W, H) {
    // ★ 표준 베어링 치수 매핑 (d1 우선)
    const d=dimVal(dims,'d1',dimVal(dims,'D1',20));
    const D=dimVal(dims,'D2',dimVal(dims,'D',47));
    const B=dimVal(dims,'B',14);
    const HD=dimVal(dims,'HD',D*1.2), HH=dimVal(dims,'HH',D*2.0), HW=dimVal(dims,'HW',D*2.2);
    const FD=dimVal(dims,'FD',D*2.8), J=dimVal(dims,'J',D*2.0);
    const sc=calcScale(Math.max(FD,HH),W,H,0.38);
    const cx=W/2, cy=H/2;
    const hdPx=HD*sc, hhPx=HH*sc, hwPx=HW*sc, fdPx=FD*sc, jPx=J*sc;
    const outerR_px=(D/2)*sc, innerR_px=(d/2)*sc, bpH=HD*0.25*sc;
    const topY=cy-(hhPx-hdPx), botY=cy+hdPx;

    // 하우징
    drawRect(cx-hwPx/2, topY, hwPx, hhPx-hdPx+hdPx*0.7);
    // 베이스
    drawRect(cx-fdPx/2, botY-bpH, fdPx, bpH);
    // 유닛 인서트 (은선)
    ctx.setLineDash(DASH_HIDDEN);
    drawCircle(cx, cy, outerR_px*1.05, COLOR.hiddenLine, LINE.hidden);
    ctx.setLineDash([]);
    // 볼트 구멍
    for (const sign of [-1,1]) drawCircle(cx+sign*jPx/2, botY-bpH/2, 4*sc, COLOR.outline, LINE.outline);
    // 중심선
    drawCenterLineH(cx-fdPx/2-10,cx+fdPx/2+10,cy);
    drawCenterLineV(cx,topY-10,botY);
    if (showDimensions) {
        drawVDim(topY,botY,cx+hwPx/2,20,'HH',HH);
        drawHDim(cx-hwPx/2,cx+hwPx/2,topY,-20,'HW',HW);
        drawHDim(cx-jPx/2,cx+jPx/2,botY,20,'J',J);
        drawVDim(cy-innerR_px,cy+innerR_px,cx-hwPx/2,-20,'d',d);
    }
}
function drawPILB_Side(dims, W, H) {
    // ★ 표준 베어링 치수 매핑 (d1 우선)
    const d=dimVal(dims,'d1',dimVal(dims,'D1',20));
    const D=dimVal(dims,'D2',dimVal(dims,'D',47)), B=dimVal(dims,'B',14);
    const HD=dimVal(dims,'HD',D*1.2), HH=dimVal(dims,'HH',D*2.0), HW=dimVal(dims,'HW',D*2.2);
    const FD=dimVal(dims,'FD',D*2.8);
    const sc=calcScale(Math.max(FD,HH),W,H,0.38);
    const cx=W/2, cy=H/2;
    const bPx=B*sc, hhPx=HH*sc, hdPx=HD*sc, fdPx=FD*sc, bpH=HD*0.25*sc;
    const topY=cy-(hhPx-hdPx), botY=cy+hdPx;

    // 측면: 하우징 박스
    drawRect(cx-bPx/2, topY, bPx, hhPx-hdPx+hdPx*0.7);
    drawRect(cx-fdPx/2, botY-bpH, fdPx, bpH);
    // 유닛 보어
    ctx.setLineDash(DASH_HIDDEN);
    drawCircle(cx, cy, (D/2)*sc*1.05, COLOR.hiddenLine, LINE.hidden);
    ctx.setLineDash([]);
    drawCircle(cx, cy, (d/2)*sc, COLOR.outline, LINE.outline);
    drawCenterCross(cx,cy,(D/2)*sc+15);
}
function drawPILB_Top(dims, W, H) {
    // ★ 표준 베어링 치수 매핑 (d1 우선)
    const d=dimVal(dims,'d1',dimVal(dims,'D1',20)), D=dimVal(dims,'D2',dimVal(dims,'D',47)), B=dimVal(dims,'B',14);
    const FD=dimVal(dims,'FD',D*2.8), HW=dimVal(dims,'HW',D*2.2), J=dimVal(dims,'J',D*2.0);
    const sc=calcScale(Math.max(FD,HW*1.2),W,H,0.38);
    const cx=W/2, cy=H/2;
    const fdPx=FD*sc, hwPx=HW*sc, bPx=B*sc, jPx=J*sc;
    // 베이스 평면도
    drawRect(cx-fdPx/2, cy-bPx/2, fdPx, bPx);
    drawRect(cx-hwPx/2, cy-bPx/2, hwPx, bPx, COLOR.hiddenLine, LINE.hidden);
    // 볼트 구멍
    for (const sign of [-1,1]) drawCircle(cx+sign*jPx/2, cy, 4*sc);
    // 보어 (은선)
    ctx.setLineDash(DASH_HIDDEN);
    drawCircle(cx, cy, (D/2)*sc, COLOR.hiddenLine, LINE.hidden);
    ctx.setLineDash([]);
    drawCenterCross(cx,cy,fdPx/2+10);
    if (showDimensions) {
        drawHDim(cx-fdPx/2,cx+fdPx/2,cy-bPx/2,-20,'FD',FD);
        drawHDim(cx-jPx/2,cx+jPx/2,cy+bPx/2,20,'J',J);
    }
}

// ═══════════════════════════════════════════════
// ⑳-B SD/SN — 분할형 플러머블록 2D
//
//  Front2D (정면도 — 보어 방향에서 바라봄):
//    ┌────────────────────┐  ← 상부 캡 (반원)
//    │   ┌────────────┐   │  ← 하우징 몸체
//    │   │    (O)     │   │  ← 보어 (원)
//    │   └────────────┘   │
//    │  │분할플랜지│  │
//    └──────────────────────┘  ← 베이스 플레이트
//       O               O      ← 볼트 홀 2개 (정면에서 2개만 보임)
//
//  Side2D (측면도 — 길이 방향):
//    사각 하우징 + 보어 단면 + 볼트 홀 2개
//
//  Top2D (평면도 — 위에서 바라봄):
//    베이스 직사각형 + 하우징 직사각형 + 볼트 홀 4개
// ═══════════════════════════════════════════════

function drawSD_Front(dims, W, H) {
    // ══════════════════════════════════════════════════════
    //  SD/SN 플러머블록 정면도 (Front View)
    //  보어 축 방향에서 본 뷰 — 3D FRONT 버튼과 동일
    //
    //  C++ 좌표 → 화면 매핑:
    //    C++ Z (폭방향) → 화면 X (좌우, 넓은 방향)
    //    C++ Y (높이)   → 화면 Y (상하, 위가 -)
    //
    //  치수 근거: NewCreateBearingClass.cpp SetPlummerBlockDim
    // ══════════════════════════════════════════════════════
    // ★ 올바른 SD 치수 키 매핑 (실제 데이터 기준)
    // d1 = 기본 보어지름 (150), S = 실제 보어 내경 (180)
    const d       = dimVal(dims, 'd1', dimVal(dims, 'd', 100));     // 기본 보어 (150)
    const d1_real = dimVal(dims, 'S', dimVal(dims, 's', d * 1.2)); // 실제 보어 (180)
    const H_total = dimVal(dims, 'H',  d1_real * 1.86);
    const T       = dimVal(dims, 'T',  d1_real * 1.28);    // C++ A1 (하우징 폭)
    const L       = dimVal(dims, 'L',  d1_real * 2.83);     // C++ L  (베이스 폭방향)
    const Bgw     = dimVal(dims, 'Bgw', dimVal(dims, 'BGW', d1_real * 2.39)); // ≈ C++ J
    const Bdn     = dimVal(dims, 'Bdn', 24);

    // ── C++ 내부 치수 (3D 동일 공식) ───────────────────
    const A1    = T;
    const A     = A1 * 1.136;            // C++ A (보어방향 베이스 폭)
    const cH    = H_total * 0.507;       // 보어 중심고
    const H1    = cH * 0.294;            // 베이스 두께
    const D2    = d1_real * 1.56;        // C++ D2 (베어링 외경, 실제 보어 기준)
    const domeR = D2 / 2 + 18;           // 구면 반경
    const d1_cpp = d1_real;              // 실제 보어 내경 (S=180)
    const clearD1 = (-0.00074074*d1_cpp*d1_cpp)+(1.4*d1_cpp)+26.667;
    const clearR1 = clearD1 / 2;
    const J1_cpp  = A1 * 0.545;          // 볼트 보어방향 간격
    const H2_cpp  = cH * 2.0;
    const cbX_mm  = (J1_cpp/2) + ((H2_cpp - 2*cH)*0.75) - 10;   // 기둥 보어방향
    const capBoltZ_mm = (D2*0.164) - ((A1*0.445)*1.29) + (Bdn*9.7) + 2.8; // 기둥 폭방향
    const pillarR_mm  = (Bdn * 1.2) - 1.5;
    const pillarH_mm  = (cH - H1) * 2;  // 상하 합계

    // ── 스케일 ─────────────────────────────────────────
    const ref = Math.max(L * 1.05, (cH + domeR) * 2.1);
    const sc  = calcScale(ref, W, H, 0.36);
    const cx  = W / 2;
    // 보어 중심 Y좌표: 캔버스 중심보다 약간 아래 (위에 돔 공간 확보)
    const boreY = H * 0.52;

    // ── px 치수 ─────────────────────────────────────────
    const boreR_px   = (d / 2)    * sc;
    const clearR_px  = clearR1    * sc;
    const domeR_px   = domeR      * sc;
    const A1h_px     = (A1 / 2)   * sc;   // 하우징 반폭
    const cH_px      = cH         * sc;   // 중심고
    const H1_px      = H1         * sc;   // 베이스 두께
    const Lh_px      = (L / 2)    * sc;   // 베이스 반폭
    const Bgwh_px    = (Bgw / 2)  * sc;   // 볼트 폭방향 반간격
    const boltR_px   = (Bdn / 2)  * sc;
    const capZ_px    = capBoltZ_mm * sc;  // 기둥 폭방향 위치
    const pillarH_px = pillarH_mm  * sc;
    const pillarW_px = pillarR_mm  * 2.5 * sc;

    const baseBotY  = boreY + cH_px;              // 베이스 하단
    const baseTopY  = baseBotY - H1_px;           // 베이스 상단
    const pillarBotY = boreY + pillarH_px / 2;    // 기둥 하단 (Z=0 중심)
    const pillarTopY = boreY - pillarH_px / 2;    // 기둥 상단

    // ─ ① 베이스 플레이트 (C++ L 폭) ─
    ctx.fillStyle = COLOR.fill;
    ctx.fillRect(cx - Lh_px, baseTopY, Lh_px*2, H1_px);
    ctx.strokeStyle = COLOR.outline; ctx.lineWidth = LINE.outline;
    ctx.strokeRect(cx - Lh_px, baseTopY, Lh_px*2, H1_px);

    // ─ ② 기둥 4개 (±capBoltZ 위치, 상하 대칭) ─
    for (const sx of [-1, 1]) {
        const px = cx + sx * capZ_px;
        ctx.fillStyle = '#D0D4D8';
        ctx.fillRect(px - pillarW_px/2, pillarTopY, pillarW_px, pillarH_px);
        ctx.strokeStyle = COLOR.outline; ctx.lineWidth = LINE.outline;
        ctx.strokeRect(px - pillarW_px/2, pillarTopY, pillarW_px, pillarH_px);

        // 육각 볼트 머리 (기둥 상단)
        const hexR_px = pillarR_mm * 0.8 * sc;
        const hexH_px = pillarR_mm * 0.65 * sc;
        drawRect(px - hexR_px, pillarTopY - hexH_px, hexR_px*2, hexH_px,
                 '#404850', COLOR.outline, LINE.outline);
    }

    // ─ ③ 하우징 구면 배럴 (LatheGeometry 정면 프로파일) ─
    //   보어 끝단 반경 = cutY, 보어 방향 폭 = A1
    //   정면뷰: 직사각형 + 상단 아치
    const import_cutY = Math.sqrt(Math.max(0, domeR*domeR - A1h_px/sc*A1h_px/sc)) * sc;
    // 하우징 몸체 (사각형 — 분할면 기준 상하 대칭)
    ctx.fillStyle = COLOR.fill;
    ctx.fillRect(cx - import_cutY, boreY - import_cutY, import_cutY*2, import_cutY*2);

    // 상부 아치 (구면 돔)
    ctx.beginPath();
    ctx.arc(cx, boreY, domeR_px, Math.PI, 0);
    ctx.lineTo(cx + domeR_px, boreY);
    ctx.lineTo(cx - domeR_px, boreY);
    ctx.closePath();
    ctx.fillStyle = COLOR.fill; ctx.fill();
    ctx.strokeStyle = COLOR.outline; ctx.lineWidth = LINE.outline; ctx.stroke();

    // 하우징 하단부 (분할면→베이스)
    const cyl_side = import_cutY;
    ctx.fillStyle = COLOR.fill;
    ctx.fillRect(cx - cyl_side, boreY, cyl_side*2, cH_px - H1_px);
    ctx.strokeStyle = COLOR.outline; ctx.lineWidth = LINE.outline;
    ctx.strokeRect(cx - cyl_side, boreY, cyl_side*2, cH_px - H1_px);

    // ─ ④ 샤프트 클리어런스 링 (보어 외경) ─
    drawCircle(cx, boreY, clearR_px, COLOR.outline, LINE.outline, null, 'rgba(215,220,225,0.5)');

    // ─ ⑤ 보어 원 (내경) ─
    drawCircle(cx, boreY, boreR_px, COLOR.outline, LINE.outline);

    // ─ ⑥ 분할면 수평선 ─
    drawLine(cx - domeR_px, boreY, cx + domeR_px, boreY, COLOR.outline, 0.8);

    // ─ ⑦ 볼트 홀 (베이스, ±Bgw/2 폭방향) ─
    for (const sx of [-1, 1]) {
        drawCircle(cx + sx * Bgwh_px, baseTopY + H1_px/2, boltR_px, COLOR.outline, LINE.outline);
    }

    // ─ ⑧ 아이볼트 (상단, ±J1/2 폭방향) ─
    const eyeY   = boreY - domeR_px * 0.85;
    const eyeSpX = J1_cpp * 0.5 * sc;
    const eyeR   = Bdn * 0.65 * sc;
    const eyeTubeR = Bdn * 0.14 * sc;
    for (const sx of [-1, 1]) {
        const ex = cx + sx * eyeSpX;
        // 링
        ctx.beginPath();
        ctx.arc(ex, eyeY - eyeR, eyeR, 0, Math.PI*2);
        ctx.strokeStyle = COLOR.outline; ctx.lineWidth = LINE.outline; ctx.stroke();
        // 축
        drawLine(ex, eyeY, ex, eyeY - eyeR*0.4, COLOR.outline, LINE.outline);
    }

    // ─ ⑨ 중심선 ─
    drawCenterLineH(cx - Lh_px - 15, cx + Lh_px + 15, boreY);
    drawCenterLineV(cx, boreY - domeR_px - 15, baseBotY + 10);

    // ─ ⑩ 치수 ─
    if (showDimensions) {
        const off = 18;
        // 보어 내경 d1
        drawVDim(boreY - boreR_px, boreY + boreR_px, cx - domeR_px - off - 10, -off, 'd1', d);
        // 중심고 H
        drawVDim(boreY, baseBotY, cx + Lh_px + off, off, 'H', H_total);
        // 볼트 간격 Bgw
        drawHDim(cx - Bgwh_px, cx + Bgwh_px, baseBotY + 8, off, 'Bgw', Bgw);
    }
}

function drawSD_Side(dims, W, H) {
    // ══════════════════════════════════════════════════════
    //  SD/SN 플러머블록 측면도 (Side View)
    //  보어 방향에서 수직인 방향에서 본 뷰 (C++ Z 방향에서)
    //
    //  C++ 좌표 → 화면 매핑:
    //    C++ X (보어방향) → 화면 X (좌우)
    //    C++ Y (높이)     → 화면 Y (상하)
    // ══════════════════════════════════════════════════════
    // ★ 올바른 SD 치수 키 매핑 (실제 데이터 기준)
    const d       = dimVal(dims, 'd1', dimVal(dims, 'd', 100));     // 기본 보어 (150)
    const d1_real = dimVal(dims, 'S', dimVal(dims, 's', d * 1.2)); // 실제 보어 (180)
    const H_total = dimVal(dims, 'H',  d1_real * 1.86);
    const T       = dimVal(dims, 'T',  d1_real * 1.28);
    const L       = dimVal(dims, 'L',  d1_real * 2.83);
    const Bdn     = dimVal(dims, 'Bdn', 24);

    const A1    = T;
    const A     = A1 * 1.136;
    const cH    = H_total * 0.507;
    const H1    = cH * 0.294;
    const D2    = d1_real * 1.56;        // 실제 보어 기준
    const domeR = D2 / 2 + 18;
    const d1_cpp = d1_real;              // 실제 보어 내경
    const clearD1 = (-0.00074074*d1_cpp*d1_cpp)+(1.4*d1_cpp)+26.667;
    const clearR1 = clearD1 / 2;
    const halfA  = A / 2;              // 샤프트 실린더 반폭 (±halfA)
    const J1_cpp = A1 * 0.545;
    const cbX_mm = (J1_cpp/2) + 0 - 10;  // 기둥 보어방향 위치

    const ref = Math.max(A * 1.2, (cH + domeR) * 2.2);
    const sc  = calcScale(ref, W, H, 0.36);
    const cx  = W / 2;
    const boreY = H * 0.52;

    const halfA_px   = halfA    * sc;
    const boreR_px   = (d / 2)  * sc;
    const clearR_px  = clearR1  * sc;
    const domeR_px   = domeR    * sc;
    const A1h_px     = (A1/2)   * sc;
    const cH_px      = cH       * sc;
    const H1_px      = H1       * sc;
    const boltR_px   = (Bdn/2)  * sc;

    const baseBotY = boreY + cH_px;
    const baseTopY = baseBotY - H1_px;

    // ─ ① 베이스 플레이트 (C++ A 폭) ─
    drawRect(cx - halfA_px, baseTopY, halfA_px*2, H1_px, COLOR.fill, COLOR.outline, LINE.outline);

    // ─ ② 샤프트 클리어런스 실린더 측면 프로파일 ─
    //   halfA 폭, 높이: boreY-clearR ~ boreY+clearR (clearR1 높이)
    drawRect(cx - halfA_px, boreY - clearR_px, halfA_px*2, clearR_px*2,
             '#D8DDE2', COLOR.outline, LINE.outline);

    // ─ ③ 하우징 측면 (A1 폭, 하단부) ─
    drawRect(cx - A1h_px, boreY, A1h_px*2, cH_px - H1_px, COLOR.fill, COLOR.outline, LINE.outline);

    // ─ ④ 하우징 상단 아치 (측면: 직사각형으로 보임) ─
    drawRect(cx - A1h_px, boreY - domeR_px, A1h_px*2, domeR_px, COLOR.fill, COLOR.outline, LINE.outline);

    // ─ ⑤ 보어 (은선) ─
    ctx.setLineDash(DASH_HIDDEN);
    drawCircle(cx, boreY, boreR_px, COLOR.hiddenLine, LINE.hidden);
    ctx.setLineDash([]);

    // ─ ⑥ 볼트 홀 (전면 2개, 보어방향 ±J1/2) ─
    for (const sx of [-1, 1]) {
        drawCircle(cx + sx * cbX_mm * sc, baseTopY + H1_px/2, boltR_px, COLOR.outline, LINE.outline);
    }

    // ─ ⑦ 분할면 ─
    drawLine(cx - halfA_px, boreY, cx + halfA_px, boreY, COLOR.outline, 0.8);

    // ─ ⑧ 중심선 ─
    drawCenterLineH(cx - halfA_px - 15, cx + halfA_px + 15, boreY);
    drawCenterLineV(cx, boreY - domeR_px - 15, baseBotY + 10);

    // ─ ⑨ 치수 ─
    if (showDimensions) {
        const off = 18;
        // 중심고 H
        drawVDim(boreY, baseBotY, cx + halfA_px + off, off, 'H', H_total);
        // 보어 내경 (은선)
        drawHDim(cx - boreR_px, cx + boreR_px, boreY + boreR_px + 8, off, 'd1', d);
    }
}

function drawSD_Top(dims, W, H) {
    // ══════════════════════════════════════════════════════
    //  SD/SN 플러머블록 평면도 (Top View)
    //  위에서 내려다본 뷰
    //
    //  C++ 좌표 → 화면 매핑:
    //    C++ Z (폭방향, L) → 화면 X (좌우, 넓은 방향)
    //    C++ X (보어방향, A) → 화면 Y (상하, 짧은 방향)
    // ══════════════════════════════════════════════════════
    // ★ 올바른 SD 치수 키 매핑 (실제 데이터 기준)
    const d       = dimVal(dims, 'd1', dimVal(dims, 'd', 100));     // 기본 보어 (150)
    const d1_real = dimVal(dims, 'S', dimVal(dims, 's', d * 1.2)); // 실제 보어 (180)
    const T    = dimVal(dims, 'T',  d1_real * 1.28);
    const L    = dimVal(dims, 'L',  d1_real * 2.83);
    const Bgw  = dimVal(dims, 'Bgw', dimVal(dims, 'BGW', d1_real * 2.39));
    const Bdn  = dimVal(dims, 'Bdn', 24);

    const A1    = T;
    const A     = A1 * 1.136;
    const J1_cpp = A1 * 0.545;     // 볼트 보어방향 간격
    const capBoltZ_mm = A1 * 0.71; // 기둥 폭방향 위치

    const ref = Math.max(L * 1.1, A * 1.6);
    const sc  = calcScale(ref, W, H, 0.38);
    const cx  = W / 2, cy = H / 2;

    const Lh_px   = (L / 2)   * sc;   // 베이스 폭 반폭
    const Ah_px   = (A / 2)   * sc;   // 베이스 보어방향 반폭
    const A1h_px  = (A1 / 2)  * sc;   // 하우징 폭 반폭
    const Bgwh_px = (Bgw / 2) * sc;   // 볼트 폭 반간격
    const J1h_px  = (J1_cpp/2)* sc;   // 볼트 보어방향 반간격
    const boltR_px = (Bdn / 2)* sc;
    const capZ_px = capBoltZ_mm * sc;

    // ─ ① 베이스 플레이트 (L × A) ─
    drawRect(cx - Lh_px, cy - Ah_px, Lh_px*2, Ah_px*2, COLOR.fill, COLOR.outline, LINE.outline);

    // ─ ② 하우징 외형 (A1 × A 점선) ─
    ctx.setLineDash(DASH_HIDDEN);
    ctx.strokeStyle = COLOR.hiddenLine; ctx.lineWidth = LINE.hidden;
    ctx.strokeRect(cx - A1h_px, cy - Ah_px, A1h_px*2, Ah_px*2);
    ctx.setLineDash([]);

    // ─ ③ 기둥 위치 (±capBoltZ 폭방향, 폭 pillarW) ─
    const pillarW_px = ((Bdn*1.2-1.5)*2.5) * sc;
    const pillarD_px = ((Bdn*1.2-1.5)*2.5) * sc;
    for (const sx of [-1, 1]) {
        const px = cx + sx * capZ_px;
        ctx.setLineDash(DASH_HIDDEN);
        ctx.strokeStyle = COLOR.hiddenLine; ctx.lineWidth = LINE.hidden;
        ctx.strokeRect(px - pillarW_px/2, cy - pillarD_px/2, pillarW_px, pillarD_px);
        ctx.setLineDash([]);
    }

    // ─ ④ 볼트 홀 4개 (±Bgw/2 폭 × ±J1/2 보어방향) ─
    for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
            drawCircle(cx + sx * Bgwh_px, cy + sy * J1h_px, boltR_px, COLOR.outline, LINE.outline);
        }
    }

    // ─ ⑤ 보어 (은선, 중심) ─
    ctx.setLineDash(DASH_HIDDEN);
    drawCircle(cx, cy, (d/2) * sc, COLOR.hiddenLine, LINE.hidden);
    ctx.setLineDash([]);

    // ─ ⑥ 중심선 ─
    drawCenterLineH(cx - Lh_px - 15, cx + Lh_px + 15, cy);
    drawCenterLineV(cx, cy - Ah_px - 15, cy + Ah_px + 15);

    // ─ ⑦ 치수 ─
    if (showDimensions) {
        const off = 18;
        drawHDim(cx - Lh_px, cx + Lh_px, cy - Ah_px - 8, -off, 'L', L);
        drawVDim(cy - Bgwh_px, cy + Bgwh_px, cx + Lh_px + off, off, 'Bgw', Bgw);
        drawHDim(cx - J1h_px, cx + J1h_px, cy + Ah_px + 8, off, 'S', J1_cpp);
    }
}

// ═══════════════════════════════════════════════
// ㉑ FLBU — 플랜지형 유닛 2D
// ═══════════════════════════════════════════════
function drawFLBU_Front(dims, W, H) {
    // ★ 표준 베어링 치수 매핑 (d1 우선)
    const d=dimVal(dims,'d1',dimVal(dims,'D1',20));
    const D=dimVal(dims,'D2',dimVal(dims,'D',47));
    const GD=dimVal(dims,'GD',D*1.15);
    const FD=dimVal(dims,'FD',D*1.9), B=dimVal(dims,'B',14);
    const J=dimVal(dims,'J',D*1.5);
    const sc=calcScale(Math.max(FD,GD),W,H,0.4);
    const cx=W/2, cy=H/2;
    const fdPx=FD*sc, bPx=B*sc, jPx=J*sc, outerR_px=(GD/2)*sc, innerR_px=(d/2)*sc;

    // 플랜지 사각 외형
    drawRect(cx-fdPx/2, cy-fdPx/2, fdPx, fdPx);
    // 구형 외륜 (원)
    drawCircle(cx, cy, outerR_px, COLOR.outline, LINE.outline, null, COLOR.fill);
    // 볼트 구멍 4개
    const boltR=4*sc;
    for (const sx of [-1,1]) for (const sy of [-1,1])
        drawCircle(cx+sx*jPx/2, cy+sy*jPx/2, boltR);
    drawCircle(cx, cy, innerR_px);
    drawCenterCross(cx, cy, fdPx/2+15);
    if (showDimensions) {
        drawHDim(cx-fdPx/2,cx+fdPx/2,cy-fdPx/2,-20,'FD',FD);
        drawHDim(cx-jPx/2,cx+jPx/2,cy,jPx/2+25,'J',J);
        drawVDim(cy-innerR_px,cy+innerR_px,cx-fdPx/2,-20,'d',d);
    }
}
function drawFLBU_Top(dims, W, H) { drawUNIT_Top(dims, W, H); }

function drawFLBU_Top(dims, W, H) { drawUNIT_Top(dims, W, H); }

// ═══════════════════════════════════════════════════════════════════
//  ★ 신규 베어링 2D 드로어 — C++ NewCreateBearingClass.cpp 기반
// ═══════════════════════════════════════════════════════════════════

// ─────────────────────────────────────
// 공통 헬퍼: 단순 베어링 단면 (외륜+내륜+롤러존)
// ─────────────────────────────────────
function _drawBearingSection(cx, cy, outerR, innerR, wallW, sc, hasChamfer) {
    const r = hasChamfer ? Math.min(wallW*0.3, 1.5)*sc : 0;
    // 외륜
    ctx.fillStyle = COLOR.fill; ctx.strokeStyle = COLOR.outline; ctx.lineWidth = LINE.outline;
    ctx.beginPath();
    ctx.rect(cx-outerR*sc, cy-outerR*sc, outerR*sc*2, wallW*sc);
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.rect(cx-outerR*sc, cy+outerR*sc-wallW*sc, outerR*sc*2, wallW*sc);
    ctx.fill(); ctx.stroke();
    // 내륜
    ctx.beginPath();
    ctx.rect(cx-innerR*sc-wallW*sc, cy-innerR*sc, wallW*sc, innerR*sc*2);
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.rect(cx+innerR*sc, cy-innerR*sc, wallW*sc, innerR*sc*2);
    ctx.fill(); ctx.stroke();
}

// ─────────────────────────────────────
// 4점 접촉 볼베어링 (QPBB)
// ─────────────────────────────────────
function drawQPBB_Front(dims, W, H) {
    const d=dimVal(dims,'d1',dimVal(dims,'d',20)), D=dimVal(dims,'D2',dimVal(dims,'D',47));
    const B=dimVal(dims,'B',14);
    const ref=Math.max(D*1.1,B*2.5), sc=calcScale(ref,W,H,0.42);
    const cx=W/2, cy=H/2;
    const oR=D/2*sc, iR=d/2*sc, halfB=B/2*sc;
    const wall=(D-d)*0.22*sc;

    // 외륜 단면
    drawRect(cx-oR,cy-halfB,oR*2,wall,COLOR.fill,COLOR.outline,LINE.outline);
    drawRect(cx-oR,cy+halfB-wall,oR*2,wall,COLOR.fill,COLOR.outline,LINE.outline);
    // 내륜 단면
    drawRect(cx-iR-wall,cy-halfB,wall,halfB*2,COLOR.fill,COLOR.outline,LINE.outline);
    drawRect(cx+iR,cy-halfB,wall,halfB*2,COLOR.fill,COLOR.outline,LINE.outline);
    // 4점 접촉선 (X자)
    const pitchR=(d/2+D/2)/2*sc;
    ctx.strokeStyle='#FF8800'; ctx.lineWidth=0.8; ctx.setLineDash([3,2]);
    ctx.beginPath(); ctx.moveTo(cx-pitchR*0.6,cy-pitchR*0.6);
    ctx.lineTo(cx+pitchR*0.6,cy+pitchR*0.6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx+pitchR*0.6,cy-pitchR*0.6);
    ctx.lineTo(cx-pitchR*0.6,cy+pitchR*0.6); ctx.stroke();
    ctx.setLineDash([]);
    // 볼 (원)
    const ballR=(D-d)*0.15*sc;
    drawCircle(cx,cy,ballR,COLOR.outline,LINE.outline,null,COLOR.ball);
    drawCenterLineH(cx-oR-12,cx+oR+12,cy);
    drawCenterLineV(cx,cy-halfB-12,cy+halfB+12);
    if(showDimensions){
        drawHDim(cx-d/2*sc,cx+d/2*sc,cy-halfB-8,-15,'d',d);
        drawHDim(cx-D/2*sc,cx+D/2*sc,cy+halfB+8,15,'D',D);
        drawVDim(cy-halfB,cy+halfB,cx+oR+15,12,'B',B);
    }
}

// ─────────────────────────────────────
// 복열 앵귤러 콘텍트 볼베어링 (DANB)
// ─────────────────────────────────────
function drawDANB_Front(dims, W, H) {
    const d=dimVal(dims,'d1',dimVal(dims,'d',20)), D=dimVal(dims,'D2',dimVal(dims,'D',47));
    const B=dimVal(dims,'B',28); // 복열은 폭이 넓음
    const ref=Math.max(D*1.1,B*2), sc=calcScale(ref,W,H,0.40);
    const cx=W/2, cy=H/2;
    const oR=D/2*sc, iR=d/2*sc, halfB=B/2*sc;
    const wall=(D-d)*0.22*sc, gap=B*0.04*sc;

    // 외륜 (하나로 이어짐)
    drawRect(cx-oR,cy-halfB,oR*2,wall,COLOR.fill,COLOR.outline,LINE.outline);
    drawRect(cx-oR,cy+halfB-wall,oR*2,wall,COLOR.fill,COLOR.outline,LINE.outline);
    // 내륜 (두 개, 중앙 갭)
    for(const sx of[-1,1]){
        drawRect(cx-iR-wall,cy+sx*gap,wall,halfB-Math.abs(sx)*gap,COLOR.fill,COLOR.outline,LINE.outline);
        drawRect(cx+iR,cy+sx*gap,wall,halfB-Math.abs(sx)*gap,COLOR.fill,COLOR.outline,LINE.outline);
    }
    // 분리선 (중앙)
    drawLine(cx-oR,cy,cx+oR,cy,COLOR.hiddenLine,LINE.hidden);
    // 볼 2열
    const ballR=(D-d)*0.14*sc, pitchR=(d/2+D/2)/2*sc;
    for(const sy of[-1,1]){
        const angle=40*Math.PI/180*sy;
        drawCircle(cx+Math.sin(angle)*pitchR*0.5,cy+sy*(halfB*0.45),ballR,COLOR.outline,LINE.outline,null,COLOR.ball);
    }
    // 접촉각 사선
    ctx.strokeStyle='#FF8800'; ctx.lineWidth=0.7; ctx.setLineDash([4,2]);
    for(const sy of[-1,1]){
        const yc=cy+sy*(halfB*0.45);
        ctx.beginPath(); ctx.moveTo(cx-iR*0.6,yc+sy*iR*0.4);
        ctx.lineTo(cx+iR*0.6,yc-sy*iR*0.4); ctx.stroke();
    }
    ctx.setLineDash([]);
    drawCenterLineH(cx-oR-12,cx+oR+12,cy);
    drawCenterLineV(cx,cy-halfB-12,cy+halfB+12);
    if(showDimensions){
        drawHDim(cx-d/2*sc,cx+d/2*sc,cy-halfB-8,-15,'d',d);
        drawHDim(cx-D/2*sc,cx+D/2*sc,cy+halfB+8,15,'D',D);
        drawVDim(cy-halfB,cy+halfB,cx+oR+15,12,'B',B);
    }
}

// ─────────────────────────────────────
// 복열 원통 롤러 베어링 (DCYL)
// ─────────────────────────────────────
function drawDCYL_Front(dims, W, H) {
    const d=dimVal(dims,'d1',dimVal(dims,'d',20)), D=dimVal(dims,'D2',dimVal(dims,'D',52));
    const B=dimVal(dims,'B',34);
    const ref=Math.max(D*1.1,B*2), sc=calcScale(ref,W,H,0.40);
    const cx=W/2, cy=H/2;
    const oR=D/2*sc, iR=d/2*sc, halfB=B/2*sc;
    const wall=(D-d)*0.22*sc;

    // 외륜
    drawRect(cx-oR,cy-halfB,oR*2,wall,COLOR.fill,COLOR.outline,LINE.outline);
    drawRect(cx-oR,cy+halfB-wall,oR*2,wall,COLOR.fill,COLOR.outline,LINE.outline);
    // 내륜 (두 열 사이 립 있음)
    drawRect(cx-iR-wall,cy-halfB,wall,halfB*2,COLOR.fill,COLOR.outline,LINE.outline);
    drawRect(cx+iR,cy-halfB,wall,halfB*2,COLOR.fill,COLOR.outline,LINE.outline);
    // 립 (중앙 구분 링)
    const lipH=wall*0.7;
    drawRect(cx-iR-wall*1.05,cy-lipH/2,wall*1.05,lipH,'#D0D4D8',COLOR.outline,0.6);
    drawRect(cx+iR,cy-lipH/2,wall*1.05,lipH,'#D0D4D8',COLOR.outline,0.6);
    // 롤러 (직사각형 단면)
    const rollerW=(D-d)*0.11*sc, rollerH=(B*0.35)*sc;
    const pitchR=(d/2+D/2)/2*sc;
    for(const sy of[-1,1]){
        drawRect(cx+pitchR-rollerW/2,cy+sy*halfB*0.45-rollerH/2,rollerW,rollerH,'#B8C0C8',COLOR.outline,0.8);
        drawRect(cx-pitchR-rollerW/2,cy+sy*halfB*0.45-rollerH/2,rollerW,rollerH,'#B8C0C8',COLOR.outline,0.8);
    }
    // 분리선
    ctx.setLineDash(DASH_HIDDEN);
    drawLine(cx-oR,cy,cx+oR,cy,COLOR.hiddenLine,LINE.hidden);
    ctx.setLineDash([]);
    drawCenterLineH(cx-oR-12,cx+oR+12,cy);
    drawCenterLineV(cx,cy-halfB-12,cy+halfB+12);
    if(showDimensions){
        drawHDim(cx-d/2*sc,cx+d/2*sc,cy-halfB-8,-15,'d',d);
        drawHDim(cx-D/2*sc,cx+D/2*sc,cy+halfB+8,15,'D',D);
        drawVDim(cy-halfB,cy+halfB,cx+oR+15,12,'B',B);
    }
}

// ─────────────────────────────────────
// 복열 테이퍼 롤러 베어링 (DTRB)
// ─────────────────────────────────────
function drawDTRB_Front(dims, W, H) {
    const d=dimVal(dims,'d1',dimVal(dims,'d',25)), D=dimVal(dims,'D2',dimVal(dims,'D',62));
    const B=dimVal(dims,'B',45);
    const ref=Math.max(D*1.1,B*2), sc=calcScale(ref,W,H,0.38);
    const cx=W/2, cy=H/2;
    const oR=D/2*sc, iR=d/2*sc, halfB=B/2*sc;
    const wall=(D-d)*0.20*sc;
    const taper=wall*0.4; // 테이퍼 기울기

    // 외륜 2열 (테이퍼 형상)
    for(const sy of[-1,1]){
        ctx.fillStyle=COLOR.fill; ctx.strokeStyle=COLOR.outline; ctx.lineWidth=LINE.outline;
        ctx.beginPath();
        ctx.moveTo(cx-oR, cy+sy*(halfB*0.1));
        ctx.lineTo(cx-oR+taper, cy+sy*halfB);
        ctx.lineTo(cx+oR-taper, cy+sy*halfB);
        ctx.lineTo(cx+oR, cy+sy*(halfB*0.1));
        ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    // 내륜 2열
    for(const sy of[-1,1]){
        ctx.fillStyle=COLOR.fill; ctx.strokeStyle=COLOR.outline; ctx.lineWidth=LINE.outline;
        ctx.beginPath();
        ctx.moveTo(cx-iR, cy+sy*(halfB*0.05));
        ctx.lineTo(cx-iR-taper*0.7, cy+sy*halfB);
        ctx.lineTo(cx-iR-wall, cy+sy*halfB);
        ctx.lineTo(cx-iR-wall, cy+sy*(halfB*0.05));
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx+iR, cy+sy*(halfB*0.05));
        ctx.lineTo(cx+iR+taper*0.7, cy+sy*halfB);
        ctx.lineTo(cx+iR+wall, cy+sy*halfB);
        ctx.lineTo(cx+iR+wall, cy+sy*(halfB*0.05));
        ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    // 분리선
    drawLine(cx-oR,cy,cx+oR,cy,COLOR.hiddenLine,LINE.hidden);
    drawCenterLineH(cx-oR-12,cx+oR+12,cy);
    drawCenterLineV(cx,cy-halfB-12,cy+halfB+12);
    if(showDimensions){
        drawHDim(cx-d/2*sc,cx+d/2*sc,cy-halfB-8,-15,'d',d);
        drawHDim(cx-D/2*sc,cx+D/2*sc,cy+halfB+8,15,'D',D);
        drawVDim(cy-halfB,cy+halfB,cx+oR+15,12,'B',B);
    }
}

// ─────────────────────────────────────
// 니들 롤러 베어링 (NRBR/SNRB/GNRB/SHRB)
// C++ CreateNeedleRollerBearing 단면
// ─────────────────────────────────────
function drawNRBR_Front(dims, W, H) {
    const d=dimVal(dims,'d1',dimVal(dims,'d',20)), D=dimVal(dims,'D2',dimVal(dims,'D',32));
    const B=dimVal(dims,'B',20), r=dimVal(dims,'r',0.3);
    const ref=Math.max(D*1.1,B*2.2), sc=calcScale(ref,W,H,0.42);
    const cx=W/2, cy=H/2;
    const oR=D/2*sc, iR=d/2*sc, halfB=B/2*sc;
    const ringThick=(D-d)*0.20*sc;

    // 외륜 (모서리 필렛)
    ctx.fillStyle=COLOR.fill; ctx.strokeStyle=COLOR.outline; ctx.lineWidth=LINE.outline;
    ctx.beginPath();
    ctx.moveTo(cx-oR+r*sc, cy-halfB);
    ctx.lineTo(cx+oR-r*sc, cy-halfB);
    ctx.arcTo(cx+oR,cy-halfB,cx+oR,cy-halfB+r*sc,r*sc);
    ctx.lineTo(cx+oR, cy-halfB+ringThick);
    ctx.lineTo(cx+oR-ringThick, cy-halfB+ringThick);
    ctx.lineTo(cx+oR-ringThick, cy+halfB-ringThick);
    ctx.lineTo(cx+oR, cy+halfB-ringThick);
    ctx.lineTo(cx+oR, cy+halfB-r*sc);
    ctx.arcTo(cx+oR,cy+halfB,cx+oR-r*sc,cy+halfB,r*sc);
    ctx.lineTo(cx-oR+r*sc, cy+halfB);
    ctx.arcTo(cx-oR,cy+halfB,cx-oR,cy+halfB-r*sc,r*sc);
    ctx.lineTo(cx-oR, cy+halfB-ringThick);
    ctx.lineTo(cx-oR+ringThick, cy+halfB-ringThick);
    ctx.lineTo(cx-oR+ringThick, cy-halfB+ringThick);
    ctx.lineTo(cx-oR, cy-halfB+ringThick);
    ctx.lineTo(cx-oR, cy-halfB+r*sc);
    ctx.arcTo(cx-oR,cy-halfB,cx-oR+r*sc,cy-halfB,r*sc);
    ctx.closePath(); ctx.fill(); ctx.stroke();

    // 내륜
    drawRect(cx-iR-ringThick,cy-halfB,ringThick,halfB*2,COLOR.fill,COLOR.outline,LINE.outline);
    drawRect(cx+iR,cy-halfB,ringThick,halfB*2,COLOR.fill,COLOR.outline,LINE.outline);

    // 니들 (가는 직사각형)
    const nD=Math.min((D-d)*0.07,(B)*0.1)*sc;
    const pitchR=(d/2+D/2)/2*sc;
    const nL=halfB*0.72;
    for(const sx of[-1,1]){
        drawRect(cx+sx*pitchR-nD/2,cy-nL,nD,nL*2,'#B8C0C8',COLOR.outline,0.5);
    }
    drawCenterLineH(cx-oR-12,cx+oR+12,cy);
    drawCenterLineV(cx,cy-halfB-12,cy+halfB+12);
    if(showDimensions){
        drawHDim(cx-d/2*sc,cx+d/2*sc,cy-halfB-8,-15,'d',d);
        drawHDim(cx-D/2*sc,cx+D/2*sc,cy+halfB+8,15,'D',D);
        drawVDim(cy-halfB,cy+halfB,cx+oR+15,12,'B',B);
    }
}

// ─────────────────────────────────────
// 오일씰 (OSEAL) 정면도
// C++ CreateOilSeal 단면
// ─────────────────────────────────────
function drawOSEAL_Front(dims, W, H) {
    const d=dimVal(dims,'d1',dimVal(dims,'d',25)), D=dimVal(dims,'D2',dimVal(dims,'D',40));
    const B=dimVal(dims,'B',8);
    const ref=Math.max(D*1.1,B*3), sc=calcScale(ref,W,H,0.42);
    const cx=W/2, cy=H/2;
    const oR=D/2*sc, iR=d/2*sc, halfB=B/2*sc;
    const H_ring=(D-d)/2*sc;
    const t1=Math.min(1.5,B*0.15)*sc, t2=Math.min(1.2,B*0.12)*sc;

    // 금속 케이스 (회색 — 외경 전체 폭 덮음)
    drawRect(cx-oR,cy-halfB,oR*2,t1,'#A0A8B0',COLOR.outline,LINE.outline);
    drawRect(cx-oR,cy+halfB-t1,oR*2,t1,'#A0A8B0',COLOR.outline,LINE.outline);
    drawRect(cx-oR,cy-halfB,t2,halfB*2,'#A0A8B0',COLOR.outline,LINE.outline);
    drawRect(cx+oR-t2,cy-halfB,t2,halfB*2,'#A0A8B0',COLOR.outline,LINE.outline);

    // 고무 바디 (검정)
    const midR=iR+(oR-iR)*0.55;
    ctx.fillStyle='#1A1A1A'; ctx.strokeStyle=COLOR.outline; ctx.lineWidth=LINE.outline;
    ctx.beginPath();
    ctx.moveTo(cx-iR, cy-halfB+t1);
    ctx.lineTo(cx-midR, cy-halfB+t1);
    ctx.lineTo(cx-midR, cy+halfB-t1);
    ctx.lineTo(cx-iR, cy+halfB-t1);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx+iR, cy-halfB+t1);
    ctx.lineTo(cx+midR, cy-halfB+t1);
    ctx.lineTo(cx+midR, cy+halfB-t1);
    ctx.lineTo(cx+iR, cy+halfB-t1);
    ctx.closePath(); ctx.fill(); ctx.stroke();

    // 립 (안쪽으로 기울어진 삼각형)
    ctx.fillStyle='#1A1A1A'; ctx.strokeStyle=COLOR.outline; ctx.lineWidth=0.7;
    for(const sx of[-1,1]){
        ctx.beginPath();
        ctx.moveTo(cx+sx*iR, cy-halfB*0.3);
        ctx.lineTo(cx+sx*(iR-H_ring*0.15), cy);
        ctx.lineTo(cx+sx*iR, cy+halfB*0.3);
        ctx.closePath(); ctx.fill(); ctx.stroke();
    }

    // 스프링 (점선 원)
    const springR=iR+(oR-iR)*0.3;
    ctx.setLineDash([2,1]);
    drawCircle(cx,cy,springR,COLOR.hiddenLine,0.7);
    ctx.setLineDash([]);

    drawCenterLineH(cx-oR-12,cx+oR+12,cy);
    drawCenterLineV(cx,cy-halfB-12,cy+halfB+12);
    if(showDimensions){
        drawHDim(cx-d/2*sc,cx+d/2*sc,cy-halfB-8,-15,'d',d);
        drawHDim(cx-D/2*sc,cx+D/2*sc,cy+halfB+8,15,'D',D);
        drawVDim(cy-halfB,cy+halfB,cx+oR+15,12,'B',B);
    }
}

function drawOSEAL_Top(dims, W, H) {
    // 평면도: 동심원 3개 (내경, 스프링, 외경)
    const d=dimVal(dims,'d1',25), D=dimVal(dims,'D2',40);
    const ref=D*1.2, sc=calcScale(ref,W,H,0.45);
    const cx=W/2, cy=H/2;
    drawCircle(cx,cy,D/2*sc,COLOR.outline,LINE.outline,null,'rgba(200,205,210,0.4)');
    drawCircle(cx,cy,(d/2+(D/2-d/2)*0.3)*sc,'#888888',0.7,[3,2]);
    ctx.setLineDash(DASH_HIDDEN);
    drawCircle(cx,cy,d/2*sc,COLOR.hiddenLine,LINE.hidden);
    ctx.setLineDash([]);
    drawCenterLineH(cx-D/2*sc-12,cx+D/2*sc+12,cy);
    drawCenterLineV(cx,cy-D/2*sc-12,cy+D/2*sc+12);
}

// ─────────────────────────────────────
// 복열 트러스트 볼베어링 (DTHB)
// ─────────────────────────────────────
function drawDTHB_Front(dims, W, H) {
    const d=dimVal(dims,'d1',25), D=dimVal(dims,'D2',52), B=dimVal(dims,'B',22);
    const ref=Math.max(D*1.1,B*2.2), sc=calcScale(ref,W,H,0.40);
    const cx=W/2, cy=H/2;
    const oR=D/2*sc, iR=d/2*sc, halfB=B/2*sc;
    const sheetH=B*0.18*sc;

    // 3개 시트 링
    for(const pos of[-halfB, 0, halfB]){
        drawRect(cx-oR,cy+pos-sheetH/2,oR*2,sheetH,COLOR.fill,COLOR.outline,LINE.outline);
    }
    // 볼 2열
    const ballR=(D-d)*0.12*sc, pitchR=(d/2+D/2)/2*sc;
    for(const sy of[-1,1]){
        drawCircle(cx+pitchR,cy+sy*halfB*0.5,ballR,COLOR.outline,LINE.outline,null,COLOR.ball);
        drawCircle(cx-pitchR,cy+sy*halfB*0.5,ballR,COLOR.outline,LINE.outline,null,COLOR.ball);
    }
    drawCenterLineH(cx-oR-12,cx+oR+12,cy);
    drawCenterLineV(cx,cy-halfB-12,cy+halfB+12);
    if(showDimensions){
        drawHDim(cx-iR,cx+iR,cy-halfB-8,-15,'d',d);
        drawHDim(cx-oR,cx+oR,cy+halfB+8,15,'D',D);
        drawVDim(cy-halfB,cy+halfB,cx+oR+15,12,'T',B);
    }
}

// ─────────────────────────────────────
// 트러스트 앵귤러 볼베어링 (DTAB/HTAB/TANB/DTAG)
// ─────────────────────────────────────
function drawDTAB_Front(dims, W, H) {
    const d=dimVal(dims,'d1',30), D=dimVal(dims,'D2',62), B=dimVal(dims,'B',20);
    const ref=Math.max(D*1.1,B*2.5), sc=calcScale(ref,W,H,0.40);
    const cx=W/2, cy=H/2;
    const oR=D/2*sc, iR=d/2*sc, halfB=B/2*sc;
    const wall=(D-d)*0.20*sc;
    const angle=40*Math.PI/180;

    // 외부 시트 (기울어진 단면)
    ctx.fillStyle=COLOR.fill; ctx.strokeStyle=COLOR.outline; ctx.lineWidth=LINE.outline;
    ctx.beginPath();
    ctx.moveTo(cx-oR,cy-halfB);
    ctx.lineTo(cx+oR,cy-halfB);
    ctx.lineTo(cx+oR*0.93,cy-halfB+wall);
    ctx.lineTo(cx-oR*0.93,cy-halfB+wall);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx-oR*0.93,cy+halfB-wall);
    ctx.lineTo(cx+oR*0.93,cy+halfB-wall);
    ctx.lineTo(cx+oR,cy+halfB);
    ctx.lineTo(cx-oR,cy+halfB);
    ctx.closePath(); ctx.fill(); ctx.stroke();

    // 내부 시트
    drawRect(cx-iR-wall,cy-halfB*0.7,wall,halfB*1.4,COLOR.fill,COLOR.outline,LINE.outline);
    drawRect(cx+iR,cy-halfB*0.7,wall,halfB*1.4,COLOR.fill,COLOR.outline,LINE.outline);

    // 볼 + 접촉각선
    const pitchR=(d/2+D/2)/2*sc, ballR=(D-d)*0.13*sc;
    drawCircle(cx+pitchR,cy,ballR,COLOR.outline,LINE.outline,null,COLOR.ball);
    drawCircle(cx-pitchR,cy,ballR,COLOR.outline,LINE.outline,null,COLOR.ball);
    ctx.strokeStyle='#FF8800'; ctx.lineWidth=0.8; ctx.setLineDash([4,2]);
    ctx.beginPath(); ctx.moveTo(cx-pitchR-ballR*Math.cos(angle),cy+ballR*Math.sin(angle));
    ctx.lineTo(cx-pitchR+ballR*Math.cos(angle),cy-ballR*Math.sin(angle)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx+pitchR-ballR*Math.cos(angle),cy+ballR*Math.sin(angle));
    ctx.lineTo(cx+pitchR+ballR*Math.cos(angle),cy-ballR*Math.sin(angle)); ctx.stroke();
    ctx.setLineDash([]);
    drawCenterLineH(cx-oR-12,cx+oR+12,cy);
    drawCenterLineV(cx,cy-halfB-12,cy+halfB+12);
    if(showDimensions){
        drawHDim(cx-iR,cx+iR,cy-halfB-8,-15,'d',d);
        drawHDim(cx-oR,cx+oR,cy+halfB+8,15,'D',D);
        drawVDim(cy-halfB,cy+halfB,cx+oR+15,12,'T',B);
    }
}

// ─────────────────────────────────────
// 트러스트 원통 롤러 베어링 (THCR)
// ─────────────────────────────────────
function drawTHCR_Front(dims, W, H) {
    const d=dimVal(dims,'d1',30), D=dimVal(dims,'D2',70), B=dimVal(dims,'B',18);
    const ref=Math.max(D*1.1,B*2.5), sc=calcScale(ref,W,H,0.40);
    const cx=W/2, cy=H/2;
    const oR=D/2*sc, iR=d/2*sc, halfB=B/2*sc;
    const sheetH=B*0.2*sc;

    // 상하 시트
    drawRect(cx-oR,cy-halfB,oR*2,sheetH,COLOR.fill,COLOR.outline,LINE.outline);
    drawRect(cx-oR,cy+halfB-sheetH,oR*2,sheetH,COLOR.fill,COLOR.outline,LINE.outline);

    // 롤러 (수평 방향, 여러 개)
    const rollerD=(D-d)*0.09*sc, pitchR=(d/2+D/2)/2*sc;
    for(const sx of[-1,0,1]){
        const rx=cx+sx*rollerD*2.2;
        if(Math.abs(rx-cx)+rollerD/2>oR-rollerD) continue;
        drawRect(rx-rollerD/2,cy-halfB+sheetH,rollerD,halfB*2-sheetH*2,'#B8C0C8',COLOR.outline,0.8);
    }
    // 대표 4개
    for(const sx of[-1,1]){
        drawRect(cx+sx*pitchR-rollerD/2,cy-halfB+sheetH,rollerD,halfB*2-sheetH*2,'#B8C0C8',COLOR.outline,0.8);
    }
    drawCenterLineH(cx-oR-12,cx+oR+12,cy);
    drawCenterLineV(cx,cy-halfB-12,cy+halfB+12);
    if(showDimensions){
        drawHDim(cx-iR,cx+iR,cy-halfB-8,-15,'d',d);
        drawHDim(cx-oR,cx+oR,cy+halfB+8,15,'D',D);
        drawVDim(cy-halfB,cy+halfB,cx+oR+15,12,'T',B);
    }
}

// ─────────────────────────────────────
// 트러스트 니들 롤러 베어링 (THNR)
// ─────────────────────────────────────
function drawTHNR_Front(dims, W, H) {
    const d=dimVal(dims,'d1',20), D=dimVal(dims,'D2',50), B=dimVal(dims,'B',5);
    const ref=Math.max(D*1.1,B*5), sc=calcScale(ref,W,H,0.42);
    const cx=W/2, cy=H/2;
    const oR=D/2*sc, iR=d/2*sc, halfB=B/2*sc;
    const sheetH=B*0.25*sc;

    // 얇은 상하 판 (와셔형)
    drawRect(cx-oR,cy-halfB,oR*2,sheetH,'#A0A8B0',COLOR.outline,LINE.outline);
    drawRect(cx-oR,cy+halfB-sheetH,oR*2,sheetH,'#A0A8B0',COLOR.outline,LINE.outline);

    // 니들 (매우 가는 직사각형 다수)
    const nD=Math.min((D-d)*0.06,1.5)*sc;
    const pitchR=(d/2+D/2)/2*sc;
    for(const sx of[-1,1]){
        for(let i=-1;i<=1;i++){
            const rx=cx+sx*pitchR+i*nD*1.8;
            drawRect(rx-nD/2,cy-halfB+sheetH,nD,halfB*2-sheetH*2,'#C0C8D0',COLOR.outline,0.4);
        }
    }
    drawCenterLineH(cx-oR-12,cx+oR+12,cy);
    drawCenterLineV(cx,cy-halfB-12,cy+halfB+12);
    if(showDimensions){
        drawHDim(cx-iR,cx+iR,cy-halfB-8,-15,'d',d);
        drawHDim(cx-oR,cx+oR,cy+halfB+8,15,'D',D);
        drawVDim(cy-halfB,cy+halfB,cx+oR+12,12,'T',B);
    }
}

// ─────────────────────────────────────
// UCFC — 둥근 플랜지형 (Front)
// C++ CreateRoundFlangeHousing 기반
// ─────────────────────────────────────
function drawFCBB_Front(dims, W, H) {
    const d=dimVal(dims,'d1',20), D=dimVal(dims,'D2',47);
    const FD=dimVal(dims,'FD',D*2.3), B=dimVal(dims,'B',14);
    const J=dimVal(dims,'J',FD*0.75), Bdn=dimVal(dims,'Bdn',12);
    const ref=Math.max(FD*1.1,B*2.5), sc=calcScale(ref,W,H,0.38);
    const cx=W/2, cy=H/2;
    const fR=FD/2*sc, halfB=B/2*sc, hR=D/2*sc*1.1;

    // 원형 플랜지 바디
    drawCircle(cx,cy,fR,COLOR.outline,LINE.outline,null,COLOR.fill);
    // 하우징 돔
    drawCircle(cx,cy,hR,COLOR.outline,LINE.outline,null,'rgba(200,205,210,0.8)');
    // 보어
    ctx.setLineDash(DASH_HIDDEN);
    drawCircle(cx,cy,d/2*sc,COLOR.hiddenLine,LINE.hidden);
    ctx.setLineDash([]);
    // 볼트홀 4개 (균등 배치)
    const bR=Bdn/2*sc, bDist=J/2*sc;
    for(let i=0;i<4;i++){
        const a=i*Math.PI/2+Math.PI/4;
        drawCircle(cx+Math.cos(a)*bDist,cy+Math.sin(a)*bDist,bR,COLOR.outline,LINE.outline);
    }
    drawCenterLineH(cx-fR-12,cx+fR+12,cy);
    drawCenterLineV(cx,cy-fR-12,cy+fR+12);
    if(showDimensions){
        drawHDim(cx-d/2*sc,cx+d/2*sc,cy-fR-8,-15,'d',d);
        drawHDim(cx-fR,cx+fR,cy+fR+8,15,'FD',FD);
    }
}

// ─────────────────────────────────────
// UCFL — 마름모 플랜지형 (Front)
// C++ CreateRhombusFlangeHousing 기반
// ─────────────────────────────────────
function drawFLBB_Front(dims, W, H) {
    const d=dimVal(dims,'d1',20), D=dimVal(dims,'D2',47);
    const FD=dimVal(dims,'FD',D*2.0), B=dimVal(dims,'B',14);
    const J=dimVal(dims,'J',FD*0.75), Bdn=dimVal(dims,'Bdn',12);
    const ref=Math.max(FD*1.1,B*2.5), sc=calcScale(ref,W,H,0.38);
    const cx=W/2, cy=H/2;
    const fW=FD/2*sc, halfB=B/2*sc, hR=D/2*sc*1.1;

    // 마름모 날개 2개
    for(const sx of[-1,1]){
        const wx=cx+sx*fW*0.7;
        drawCircle(wx,cy,fW*0.28,COLOR.outline,LINE.outline,null,COLOR.fill);
        drawCircle(wx,cy,Bdn/2*sc,COLOR.outline,LINE.outline);
    }
    // 하우징 바디
    drawRect(cx-hR,cy-halfB*0.8,hR*2,halfB*1.6,COLOR.fill,COLOR.outline,LINE.outline);
    drawCircle(cx,cy,hR,COLOR.outline,LINE.outline,null,COLOR.fill);
    // 보어
    ctx.setLineDash(DASH_HIDDEN);
    drawCircle(cx,cy,d/2*sc,COLOR.hiddenLine,LINE.hidden);
    ctx.setLineDash([]);
    drawCenterLineH(cx-fW-12,cx+fW+12,cy);
    drawCenterLineV(cx,cy-hR-12,cy+hR+12);
    if(showDimensions){
        drawHDim(cx-d/2*sc,cx+d/2*sc,cy-hR-8,-15,'d',d);
        drawHDim(cx-fW,cx+fW,cy+hR+8,15,'L',J);
    }
}

// ─────────────────────────────────────
// UCFS — 소켓 각 플랜지형 (Front/Top)
// C++ CreateSquareFlangeHousing / CreateAdjustableFlangeHousing 기반
// ─────────────────────────────────────
function drawFSBB_Front(dims, W, H) {
    const d=dimVal(dims,'d1',20), D=dimVal(dims,'D2',47);
    const FD=dimVal(dims,'FD',D*2.0), B=dimVal(dims,'B',14);
    const J=dimVal(dims,'J',FD*0.70), Bdn=dimVal(dims,'Bdn',12);
    const ref=Math.max(FD*1.1,B*2.5), sc=calcScale(ref,W,H,0.38);
    const cx=W/2, cy=H/2;
    const fW=FD/2*sc, halfB=B/2*sc, hR=D/2*sc*1.1;

    // 사각 플랜지 플레이트
    drawRect(cx-fW,cy-fW,fW*2,fW*2,COLOR.fill,COLOR.outline,LINE.outline);
    // 하우징 돔
    ctx.beginPath(); ctx.arc(cx,cy,hR,Math.PI,0);
    ctx.fillStyle=COLOR.fill; ctx.fill();
    ctx.strokeStyle=COLOR.outline; ctx.lineWidth=LINE.outline; ctx.stroke();
    ctx.fillStyle=COLOR.fill;
    ctx.fillRect(cx-hR,cy,hR*2,halfB*0.8);
    ctx.strokeRect(cx-hR,cy,hR*2,halfB*0.8);
    // 보어
    ctx.setLineDash(DASH_HIDDEN);
    drawCircle(cx,cy,d/2*sc,COLOR.hiddenLine,LINE.hidden);
    ctx.setLineDash([]);
    // 볼트홀 4개 (코너)
    const jh=J/2*sc;
    for(const sx of[-1,1]) for(const sy of[-1,1]){
        drawCircle(cx+sx*jh,cy+sy*jh,Bdn/2*sc,COLOR.outline,LINE.outline);
    }
    drawCenterLineH(cx-fW-12,cx+fW+12,cy);
    drawCenterLineV(cx,cy-fW-12,cy+fW+12);
    if(showDimensions){
        drawHDim(cx-d/2*sc,cx+d/2*sc,cy-fW-8,-15,'d',d);
        drawHDim(cx-fW,cx+fW,cy+fW+8,15,'FD',FD);
    }
}

function drawFSBB_Top(dims, W, H) {
    // 평면도: 사각 플레이트 + 볼트홀
    const d=dimVal(dims,'d1',20), D=dimVal(dims,'D2',47);
    const FD=dimVal(dims,'FD',D*2.0), B=dimVal(dims,'B',14);
    const J=dimVal(dims,'J',FD*0.70), Bdn=dimVal(dims,'Bdn',12);
    const ref=FD*1.1, sc=calcScale(ref,W,H,0.42);
    const cx=W/2, cy=H/2;
    const fW=FD/2*sc, jh=J/2*sc;
    drawRect(cx-fW,cy-B/2*sc,fW*2,B*sc,COLOR.fill,COLOR.outline,LINE.outline);
    for(const sx of[-1,1]) for(const sy of[-1,1]){
        drawCircle(cx+sx*jh,cy+sy*(B*0.3)*sc,Bdn/2*sc,COLOR.outline,LINE.outline);
    }
    ctx.setLineDash(DASH_HIDDEN);
    drawCircle(cx,cy,d/2*sc,COLOR.hiddenLine,LINE.hidden);
    ctx.setLineDash([]);
    drawCenterLineH(cx-fW-12,cx+fW+12,cy);
    drawCenterLineV(cx,cy-fW-12,cy+fW+12);
}

// ─────────────────────────────────────
// UCT — 테이크업 하우징 (Front/Side/Top)
// C++ CreateTakeUpHousing 기반
// ─────────────────────────────────────
function drawUCTU_Front(dims, W, H) {
    const d=dimVal(dims,'d1',20), D=dimVal(dims,'D2',47);
    const L=dimVal(dims,'L',D*3.5), hH=dimVal(dims,'H',D*1.8), B=dimVal(dims,'B',14);
    const ref=Math.max(L*0.8,hH*1.5), sc=calcScale(ref,W,H,0.36);
    const cx=W/2, cy=H/2;
    const lH=hH*sc, lW=L*sc, halfB=B/2*sc, hR=D/2*sc*1.1;

    // 프레임 (직사각형)
    drawRect(cx-lW/2,cy-lH*0.35,lW,lH*0.7,COLOR.fill,COLOR.outline,LINE.outline);
    // 슬롯 (가운데 장공)
    for(const sx of[-1,1]){
        const sx1=cx+sx*(lW*0.35);
        ctx.fillStyle='rgba(50,60,70,0.8)';
        ctx.fillRect(sx1-lW*0.06,cy-lH*0.2,lW*0.12,lH*0.4);
        ctx.strokeStyle=COLOR.outline; ctx.lineWidth=0.8;
        ctx.strokeRect(sx1-lW*0.06,cy-lH*0.2,lW*0.12,lH*0.4);
    }
    // 하우징 (중앙 UNIT)
    drawCircle(cx,cy,hR,COLOR.outline,LINE.outline,null,'rgba(200,205,210,0.9)');
    ctx.setLineDash(DASH_HIDDEN);
    drawCircle(cx,cy,d/2*sc,COLOR.hiddenLine,LINE.hidden);
    ctx.setLineDash([]);
    drawCenterLineH(cx-lW/2-12,cx+lW/2+12,cy);
    drawCenterLineV(cx,cy-lH/2-12,cy+lH/2+12);
    if(showDimensions){
        drawHDim(cx-d/2*sc,cx+d/2*sc,cy-lH/2-8,-15,'d',d);
        drawHDim(cx-lW/2,cx+lW/2,cy+lH/2+8,15,'L',L);
        drawVDim(cy-hR,cy+hR,cx+lW/2+15,12,'H',hH);
    }
}

function drawUCTU_Side(dims, W, H) {
    const d=dimVal(dims,'d1',20), D=dimVal(dims,'D2',47);
    const hH=dimVal(dims,'H',D*1.8), B=dimVal(dims,'B',14);
    const ref=Math.max(D*1.5,hH*1.3), sc=calcScale(ref,W,H,0.40);
    const cx=W/2, cy=H/2;
    const hR=D/2*sc*1.1, halfB=B/2*sc;
    // 프레임 측면
    drawRect(cx-hR*1.4,cy-hH*sc*0.35,hR*2.8,hH*sc*0.7,COLOR.fill,COLOR.outline,LINE.outline);
    drawCircle(cx,cy,hR,COLOR.outline,LINE.outline,null,'rgba(200,205,210,0.9)');
    ctx.setLineDash(DASH_HIDDEN);
    drawCircle(cx,cy,d/2*sc,COLOR.hiddenLine,LINE.hidden);
    ctx.setLineDash([]);
    drawCenterLineH(cx-hR*1.5,cx+hR*1.5,cy);
    drawCenterLineV(cx,cy-hR*1.5,cy+hR*1.5);
}

function drawUCTU_Top(dims, W, H) {
    const d=dimVal(dims,'d1',20), D=dimVal(dims,'D2',47);
    const L=dimVal(dims,'L',D*3.5), B=dimVal(dims,'B',14);
    const ref=Math.max(L*0.8,B*3), sc=calcScale(ref,W,H,0.42);
    const cx=W/2, cy=H/2;
    drawRect(cx-L*sc/2,cy-B*sc/2,L*sc,B*sc,COLOR.fill,COLOR.outline,LINE.outline);
    // 슬롯
    for(const sx of[-1,1]){
        ctx.fillStyle='rgba(50,60,70,0.8)';
        ctx.fillRect(cx+sx*L*sc*0.35-L*sc*0.06,cy-B*sc*0.25,L*sc*0.12,B*sc*0.5);
    }
    ctx.setLineDash(DASH_HIDDEN);
    drawCircle(cx,cy,d/2*sc,COLOR.hiddenLine,LINE.hidden);
    ctx.setLineDash([]);
    drawCenterLineH(cx-L*sc/2-12,cx+L*sc/2+12,cy);
    drawCenterLineV(cx,cy-B*sc-12,cy+B*sc+12);
}

// ─────────────────────────────────────
// UCC — 카트리지 하우징 (Front)
// C++ CreateCartridgeHousing 기반
// ─────────────────────────────────────
function drawUCCA_Front(dims, W, H) {
    const d=dimVal(dims,'d1',20), D=dimVal(dims,'D2',47), B=dimVal(dims,'B',14);
    const OD=dimVal(dims,'OD',D*1.6);
    const ref=Math.max(OD*1.1,B*2.5), sc=calcScale(ref,W,H,0.40);
    const cx=W/2, cy=H/2;
    const oR=OD/2*sc, halfB=B/2*sc, hR=D/2*sc*1.05;

    // 외부 원통
    drawRect(cx-oR,cy-halfB*1.3,oR*2,halfB*2.6,COLOR.fill,COLOR.outline,LINE.outline);
    // 플랜지 커버
    drawRect(cx-oR*1.15,cy-halfB*1.3,oR*2.3,halfB*0.35,'#C8CDD3',COLOR.outline,LINE.outline);
    // 하우징 돔
    drawCircle(cx,cy,hR,COLOR.outline,LINE.outline,null,'rgba(200,205,210,0.8)');
    // 보어
    ctx.setLineDash(DASH_HIDDEN);
    drawCircle(cx,cy,d/2*sc,COLOR.hiddenLine,LINE.hidden);
    ctx.setLineDash([]);
    drawCenterLineH(cx-oR-12,cx+oR+12,cy);
    drawCenterLineV(cx,cy-halfB*1.5,cy+halfB*1.5);
    if(showDimensions){
        drawHDim(cx-d/2*sc,cx+d/2*sc,cy-halfB*1.5,-15,'d',d);
        drawHDim(cx-oR,cx+oR,cy+halfB*1.5+8,15,'OD',OD);
        drawVDim(cy-halfB*1.3,cy+halfB*1.3,cx+oR+15,12,'B',B);
    }
}




// ─────────────────────────────────────────────
// 오일리스 베어링 / 부시 계열 2D 드로어
// ─────────────────────────────────────────────
function drawOilless_Front(dims, W, H) {
    const d  = dimVal(dims,'d1',dimVal(dims,'d',20));
    const D  = dimVal(dims,'D2',dimVal(dims,'D',d*1.5));
    const B  = dimVal(dims,'B',dimVal(dims,'L',d*1.2));
    const FD = dimVal(dims,'FD',0);  // 플랜지 외경 (있으면)
    const ref = Math.max(Math.max(D,FD)*1.1, B*2.5);
    const sc = calcScale(ref, W, H, 0.42);
    const cx = W/2, cy = H/2;
    const oR = D/2*sc, iR = d/2*sc, halfB = B/2*sc;
    const wall = (D-d)/2*sc;

    // 청동색 (#8B9E6A)
    const bushColor = '#8B9E6A';

    // 외경 사각 단면 (좌우)
    drawRect(cx-oR,cy-halfB,wall,halfB*2,bushColor,COLOR.outline,LINE.outline);
    drawRect(cx+iR,cy-halfB,wall,halfB*2,bushColor,COLOR.outline,LINE.outline);
    // 상하 끝단
    drawRect(cx-oR,cy-halfB,oR*2,wall*0.5,bushColor,COLOR.outline,LINE.outline);
    drawRect(cx-oR,cy+halfB-wall*0.5,oR*2,wall*0.5,bushColor,COLOR.outline,LINE.outline);

    // 플랜지 (있으면)
    if (FD > 0) {
        const fR = FD/2*sc, fH = B*0.2*sc;
        drawRect(cx-fR, cy-halfB-fH, fR*2, fH, bushColor, COLOR.outline, LINE.outline);
    }

    // 보어 중심선
    drawCenterLineH(cx-oR-12, cx+oR+12, cy);
    drawCenterLineV(cx, cy-halfB-12, cy+halfB+12);

    if(showDimensions){
        const off=15;
        drawHDim(cx-iR, cx+iR, cy-halfB-8, -off, 'd', d);
        drawHDim(cx-oR, cx+oR, cy+halfB+8, off, 'D', D);
        drawVDim(cy-halfB, cy+halfB, cx+oR+off, off, 'B', B);
    }
}

function drawOilless_Top(dims, W, H) {
    const d  = dimVal(dims,'d1',20);
    const D  = dimVal(dims,'D2',d*1.5);
    const FD = dimVal(dims,'FD',0);
    const ref = Math.max(FD>0?FD:D, D)*1.15;
    const sc = calcScale(ref, W, H, 0.45);
    const cx = W/2, cy = H/2;
    // 외경 원
    drawCircle(cx,cy,D/2*sc,COLOR.outline,LINE.outline,null,'rgba(139,158,106,0.4)');
    if (FD > 0) drawCircle(cx,cy,FD/2*sc,COLOR.outline,LINE.outline);
    // 보어 (은선)
    ctx.setLineDash(DASH_HIDDEN);
    drawCircle(cx,cy,d/2*sc,COLOR.hiddenLine,LINE.hidden);
    ctx.setLineDash([]);
    drawCenterLineH(cx-D/2*sc-12,cx+D/2*sc+12,cy);
    drawCenterLineV(cx,cy-D/2*sc-12,cy+D/2*sc+12);
}

// ═══════════════════════════════════════════════
// 시작
// ═══════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', init);
