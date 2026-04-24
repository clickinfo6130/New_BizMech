/**
 * PartManager 2D Part Renderer
 * ─────────────────────────────
 * HTML5 Canvas 기반 기계 부품 2D 렌더러
 * WPF WebView2 (Preview2DControl) 및 웹 브라우저 공용
 *
 * ★ C# DrawingPreviewControl.xaml.cs 로직을 JS로 포팅
 * ★ partRenderer.js(3D)와 동일한 C#↔JS 통신 프로토콜
 *
 * 지원 부품 (14종):
 *   볼트류: HBOLT, SBOLT, SRBOLT, FBOLT, FLBOLT, STBOLT, SQBOLT
 *   모터류: SERVO_MOTOR (서보모터 SGM-7 계열, v50: Brake/Gearhead 옵션 지원)
 *          STEPPER_MOTOR (스테핑 모터 NEMA 계열, v50 3세션차 신규)
 *   너트류: NUT(HNUT), FNUT
 *   와셔류: PWAS, SWAS
 *   베어링: DGBB (깊은 홈 볼 베어링)
 *
 * 뷰 타입: Front2D (정면도), Side2D (측면도), Top2D (평면도)
 *
 * ═══════════════════════════════════════════════════════════════
 *  v50 변경점 (2026.04 — 3세션차: 2D 동기화 + Stepper + OilSeal 인식)
 * ═══════════════════════════════════════════════════════════════
 *   1. updateModel(partCode, dims, linked, viewType, motorOptions) 시그니처 확장
 *   2. resolveMotorOpts() 헬퍼 — 3D와 동일 규칙으로 옵션 해석
 *   3. drawServoMotor_Side/Top에 hasBrake, hasGearhead 분기 추가
 *   4. buildStepperMotor / drawStepperMotor_Front/Side/Top 신규
 *   5. OilSeal dims 인식 (LB1~LB3 / LE1~LE3) — 향후 확장 준비
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
let currentMotorOptions = {};  // ★ v50 3세션차: 모터 옵션 { hasBrake, hasGearhead, hasEncoder, hasOilSeal, hasConnector, bodyType, shaftType, flangType }

// ═══════════════════════════════════════════════
// ★ 치수 참조 패널 상태 (3D 뷰어와 동일 프로토콜)
//   renderedDimensions: 이번 렌더링에서 실제로 그려진 치수 [{ name, value }]
//   currentDimMeta:     C# 에서 전달된 { field_name → display_name } 매핑
//   showDimPanel:       패널 표시 여부 (C# 의 ShowDimPanel 체크박스가 제어)
// ═══════════════════════════════════════════════
let renderedDimensions = [];
let currentDimMeta     = {};
let showDimPanel       = false;
// ★ 패널 UI 텍스트 (C# 에서 현재 언어에 맞게 번역해 전달)
//   __panel_title / __panel_empty / __panel_no_mapping / __panel_count_unit
//   fallback: 한국어 기본값 (C# 이 빈 dimMeta 를 보낼 경우 대비)
let currentPanelText = {
    title:     '📏 치수 정보',
    empty:     '표시된 치수가 없습니다',
    noMapping: '매핑된 치수명 없음',
    countUnit: '개'
};

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
    STEPPER_MOTOR: { front: drawStepperMotor_Front, side: drawStepperMotor_Side, top: drawStepperMotor_Top },   // ★ v50 3세션차
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
    //   ★ v50 3세션차: Stepper를 Servo보다 먼저 매칭
    if (code.includes('STEPPER') || code.includes('STEP_MOTOR') || code === 'SMOT' || code.startsWith('SMOT') ||
        code.includes('PKP') || code.includes('PKE'))
        return PART_BUILDERS_2D.STEPPER_MOTOR;
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

function updateModel(partCode, dimensions, linkedParts, viewType, motorOptions) {
    currentPartCode    = partCode;
    currentDimensions  = dimensions;
    currentLinkedParts = linkedParts || [];    // ★ 연결부품 저장
    currentMotorOptions = motorOptions || {};   // ★ v50 3세션차: 모터 옵션 저장
    if (viewType) currentViewType = viewType;
    redraw();
    logToCSharp('Model: ' + partCode + ' view=' + currentViewType +
                ' linked=' + currentLinkedParts.length +
                ' opts=' + Object.keys(currentMotorOptions).length);
}

/**
 * ★ v50 3세션차: 모터 옵션 해석 헬퍼 (partRenderer.js 3D와 동일 규칙)
 *
 * 옵션 명시 우선, 없으면 dims/opts/partCode 기반 자동 판정.
 * C++ MotorCreator::SetMotorOptions 로직 동일:
 *   hasBrake    <- Dim.SL > 0  또는 opts value에 "브레이크/Brake"
 *   hasGearhead <- Dim.G_S > 0 || Dim.G_LL > 0 || Dim.G_LX > 0
 *                  또는 opts value에 "감속기/Gearhead/HDS"
 *                  또는 partCode에 감속기 패턴
 *   hasEncoder  <- Dim.EnH > 0 || Dim.EnL > 0
 *   hasOilSeal  <- Dim.LB1 > 0 || Dim.LE1 > 0
 *   hasConnector<- Dim.CW(MW) > 0
 *
 *  ★ v50 핫픽스: SpecWindow가 C# UpdatePreview 호출 시 SelectedData 미전달되는 경우
 *               대응을 위해 opts의 value 스캔 + partCode 패턴 감지 추가.
 */
function resolveMotorOpts(dims, opts, partCode) {
    opts = opts || {};
    partCode = partCode || '';

    const asBool = (v) => {
        if (v === undefined || v === null || v === '') return null;
        const s = String(v).trim().toLowerCase();
        return s === 'true' || s === '1' || s === 'yes';
    };
    const mv = (k) => mVal(dims, k, 0);

    const optBrake     = asBool(opts.hasBrake);
    const optGearhead  = asBool(opts.hasGearhead);
    const optEncoder   = asBool(opts.hasEncoder);
    const optOilSeal   = asBool(opts.hasOilSeal);
    const optConnector = asBool(opts.hasConnector);

    // opts의 value(선택 라벨 문자열)에서 키워드 포함 여부 검사
    const scanOpts = (keywords) => {
        for (const [k, v] of Object.entries(opts)) {
            if (typeof v !== 'string') continue;
            for (const kw of keywords) if (v.includes(kw)) return true;
            if (k && typeof k === 'string') {
                for (const kw of keywords) {
                    if (k.includes(kw)) {
                        if (v.trim() !== '' &&
                            !['없음','none','null','0','no'].includes(v.trim().toLowerCase())) {
                            return true;
                        }
                    }
                }
            }
        }
        return false;
    };

    const hasGDimKey = dims ? Object.keys(dims).some(k => typeof k === 'string' && k.startsWith('G_') && mv(k) > 0) : false;
    const hasGDimPositive = mv('G_S') > 0 || mv('G_LL') > 0 || mv('G_LX') > 0 || mv('G_LC') > 0;

    const pcUpper = (partCode || '').toUpperCase();
    const hasGearPartCodePattern = /[A-Z0-9]H[A-Z][0-9]/.test(pcUpper) ||
                                     /[A-Z0-9]H[0-9]/.test(pcUpper) ||
                                     /[A-Z0-9]GH[A-Z0-9]/.test(pcUpper) ||
                                     pcUpper.includes('GEAR') ||
                                     pcUpper.includes('REDUC');

    const autoGearhead = scanOpts(['감속기','Gearhead','GEARHEAD','Reducer','REDUCER','HDS']) ||
                          hasGDimPositive ||
                          hasGDimKey ||
                          hasGearPartCodePattern;
    const autoBrake = mv('SL') > 0 || scanOpts(['브레이크','Brake','BRAKE']);

    return {
        hasBrake:     optBrake     !== null ? optBrake     : autoBrake,
        hasGearhead:  optGearhead  !== null ? optGearhead  : autoGearhead,
        hasEncoder:   optEncoder   !== null ? optEncoder   : (mv('EnH') > 0 || mv('EnL') > 0),
        hasOilSeal:   optOilSeal   !== null ? optOilSeal   : (mv('LB1') > 0 || mv('LE1') > 0),
        hasConnector: optConnector !== null ? optConnector : (mv('CW(MW)') > 0 || mv('CW') > 0),
        bodyType:  (opts.bodyType  || 'Standard'),
        shaftType: (opts.shaftType || 'Straight'),
        flangType: (opts.flangType || 'Round')
    };
}

function redraw() {
    if (!ctx) return;
    const W = canvas.width / (window.devicePixelRatio || 1);
    const H = canvas.height / (window.devicePixelRatio || 1);

    // 배경
    ctx.fillStyle = COLOR.background;
    ctx.fillRect(0, 0, W, H);

    if (!currentPartCode) {
        drawEmptyState(W, H);
        // ★ 빈 상태에서도 패널 갱신 (비우기)
        renderedDimensions = [];
        updateDimPanel();
        return;
    }

    // ★ 이번 렌더링 치수 수집 시작 (drawHDim/drawVDim 호출마다 push)
    renderedDimensions = [];

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

    // ★ 치수 참조 패널 업데이트 (drawHDim/drawVDim 이 수집한 내용 반영)
    updateDimPanel();
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
    // ★ 치수 참조 패널 — DB 정규 변수명 복원 후 수집
    //   내부 축약형(K, D) → DB 변수명(H, D1 등) 복원
    const displayName = resolveActualDbKey(name, value);
    renderedDimensions.push({ name: displayName, value: value });

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
    // 텍스트 (★ displayName 사용)
    const txt = displayName + '=' + fmtDim(value);
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
    // ★ 치수 참조 패널 — DB 정규 변수명 복원 후 수집
    const displayName = resolveActualDbKey(name, value);
    renderedDimensions.push({ name: displayName, value: value });

    const dimX = x + offset;
    const dir = offset > 0 ? 1 : -1;
    drawLine(x + dir * 3, y1, dimX + dir * 4, y1, COLOR.dimension, LINE.dimExt);
    drawLine(x + dir * 3, y2, dimX + dir * 4, y2, COLOR.dimension, LINE.dimExt);
    drawLine(dimX, y1, dimX, y2, COLOR.dimension, LINE.dim);
    drawArrowV(dimX, y1, true);
    drawArrowV(dimX, y2, false);
    // 텍스트 (회전, ★ displayName 사용)
    const txt = displayName + '=' + fmtDim(value);
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

// ═══════════════════════════════════════════════
// ★ 치수 참조 패널 (약어 ↔ 전체명) — 3D 뷰어 (partRenderer.js) 와 동일 로직
//   drawHDim/drawVDim 이 addDimLabel 역할, renderedDimensions 가 수집 버퍼.
//   bizMech 웹 이식 시 3D/2D 양쪽 JS 를 그대로 활용.
// ═══════════════════════════════════════════════

/**
 * 단순화된 축약형(d, D, K, L 등)을 currentDimMeta 의 실제 DB 변수명으로 복원.
 * 매칭 전략은 3D 뷰어와 동일:
 *   (1) 직접 매칭  (2) 대문자 매칭
 *   (3) 값 기반 별칭 — currentDimensions 에서 같은 값 가진 다른 키 중 dimMeta 에 존재하는 것
 *   (4) 숫자 접미사  (5) 복합 치수 (L+K → 각 항 재귀)
 *   (6) 실패 → 원본 유지
 * @param {string} name   렌더러가 사용한 축약형 변수명
 * @param {number} value  렌더링 중인 치수값 (값 기반 별칭 매칭에 사용)
 */
function resolveActualDbKey(name, value) {
    if (!name) return name;

    // (5) 복합 치수 — 연산자 분해 후 각 항 재귀 복원
    if (/[+\-*/]/.test(name)) {
        let cleaned = name.trim();
        const wrapped = cleaned.startsWith('(') && cleaned.endsWith(')');
        if (wrapped) cleaned = cleaned.substring(1, cleaned.length - 1);
        const tokens = cleaned.split(/([+\-*/])/);
        const resolvedTokens = tokens.map(t => {
            const trimmed = t.trim();
            if (trimmed === '' || /^[+\-*/]$/.test(trimmed)) return trimmed;
            const partValue = (currentDimensions && typeof currentDimensions[trimmed] === 'number')
                ? currentDimensions[trimmed] : undefined;
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
    if (typeof value === 'number' && !isNaN(value) && currentDimensions) {
        for (const key of Object.keys(currentDimensions)) {
            const v = currentDimensions[key];
            if (typeof v === 'number' && Math.abs(v - value) < 1e-6 && currentDimMeta[key]) {
                candidates.add(key);
            }
        }
    }

    if (candidates.size > 0) {
        const sorted = [...candidates].sort((a, b) => {
            const aSpec = /[()<>=]/.test(a);
            const bSpec = /[()<>=]/.test(b);
            if (aSpec !== bSpec) return aSpec ? -1 : 1;
            if (a === name && b !== name) return -1;
            if (b === name && a !== name) return 1;
            if (a === upper && b !== upper) return -1;
            if (b === upper && a !== upper) return 1;
            if (a.length !== b.length) return b.length - a.length;
            return a.localeCompare(b);
        });
        return sorted[0];
    }

    // (4) 숫자 접미사 fallback
    for (let i = 1; i <= 9; i++) {
        if (currentDimMeta[name + i]) return name + i;
        if (upper !== name && currentDimMeta[upper + i]) return upper + i;
    }

    return name;
}

/**
 * DB 변수명을 한글 전체 치수명으로 변환 (패널 중앙 컬럼에 표시)
 * 3D 뷰어 resolveDimDisplayName 와 동일 로직
 */
function resolveDimDisplayName(abbr) {
    if (!abbr) return '';
    if (currentDimMeta[abbr]) return currentDimMeta[abbr];
    const uK = abbr.toUpperCase();
    if (currentDimMeta[uK]) return currentDimMeta[uK];

    // 괄호 제거 후 재시도
    const idxParen = abbr.indexOf('(');
    if (idxParen > 0) {
        const head = abbr.substring(0, idxParen).trim();
        if (currentDimMeta[head]) return currentDimMeta[head];
        const headU = head.toUpperCase();
        if (currentDimMeta[headU]) return currentDimMeta[headU];
    }

    // 숫자 접미사 fallback
    for (let i = 1; i <= 9; i++) {
        const trySfx = abbr + i;
        if (currentDimMeta[trySfx]) return currentDimMeta[trySfx];
        const trySfxU = uK + i;
        if (currentDimMeta[trySfxU]) return currentDimMeta[trySfxU];
    }

    // 복합 치수 — 연산자 기준 분리 후 각 항을 전체 한글명으로 조합
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

    return abbr;
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
    for (const [key, val] of Object.entries(payload)) {
        if (!key) continue;
        const strVal = val == null ? '' : String(val);

        if (key === '__panel_title')      { currentPanelText.title     = strVal; continue; }
        if (key === '__panel_empty')      { currentPanelText.empty     = strVal; continue; }
        if (key === '__panel_no_mapping') { currentPanelText.noMapping = strVal; continue; }
        if (key === '__panel_count_unit') { currentPanelText.countUnit = strVal; continue; }

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

/** 치수 참조 패널 업데이트 — showDimPanel 과 renderedDimensions 기반 */
function updateDimPanel() {
    const panel = document.getElementById('dim-panel');
    if (!panel) return;

    if (!showDimPanel) {
        panel.style.display = 'none';
        return;
    }

    // ★ 다국어: 패널 헤더 타이틀도 현재 언어로 갱신
    const titleEl = panel.querySelector('.dim-panel-title');
    if (titleEl) titleEl.textContent = currentPanelText.title;

    // 중복 제거 (같은 name 여러 번 push 된 경우 첫 값 유지)
    const seen = new Set();
    const unique = [];
    for (const d of renderedDimensions) {
        const key = (d.name || '').trim();
        if (!key) continue;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push({ name: key, value: d.value });
    }

    const body  = panel.querySelector('.dim-panel-body');
    const count = panel.querySelector('.dim-panel-count');
    if (!body || !count) return;

    count.textContent = unique.length > 0 ? unique.length + currentPanelText.countUnit : '';

    if (unique.length === 0) {
        body.innerHTML = '<div class="dim-panel-empty">' + escapeHtml(currentPanelText.empty) + '</div>';
        panel.style.display = 'block';
        return;
    }

    const rows = unique.map(d => {
        const abbr = d.name;
        const full = resolveDimDisplayName(abbr);
        const hasMapping = (full !== abbr);
        const nameHtml = hasMapping
            ? '<span class="dim-panel-name" title="' + escapeHtml(full) + '">' + escapeHtml(full) + '</span>'
            : '<span class="dim-panel-name" style="color:#64748B;font-style:italic" title="' + escapeHtml(currentPanelText.noMapping) + '">—</span>';
        return '<div class="dim-panel-row">' +
            '<span class="dim-panel-abbr">' + escapeHtml(abbr) + '</span>' +
            nameHtml +
            '<span class="dim-panel-value">' + (typeof d.value === 'number' ? d.value.toFixed(1) : String(d.value)) + '</span>' +
            '</div>';
    }).join('');

    body.innerHTML = rows;
    panel.style.display = 'block';
}

/** 패널 강제 숨김 (치수 DATA 탭 전환 시 등 외부 호출) */
function resetDimPanel() {
    showDimPanel = false;
    const panel = document.getElementById('dim-panel');
    if (panel) {
        panel.style.display = 'none';
        const body = panel.querySelector('.dim-panel-body');
        if (body) body.innerHTML = '';
    }
}

/** XSS 방지 */
function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
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

    // ★ v50 3세션차: 옵션 해석 (hasBrake, hasGearhead)
    const mOpt = resolveMotorOpts(dims, currentMotorOptions, currentPartCode);
    const hasBrake = mOpt.hasBrake;
    const hasGearhead = mOpt.hasGearhead;

    // ★ Brake 분기: L1/L2/LX → LO1/LO2/LO 치환 (3D buildServoMotor와 동일)
    const LX_raw = mVal(dims,'LX',   0);
    const LO_raw = mVal(dims,'LO',   0);
    const LX  = hasBrake ? (LO_raw > 0 ? LO_raw : (LX_raw || LC*1.8)) : (LX_raw || LC*1.5);
    const L1_key = hasBrake ? 'LO1(LLO)' : 'L1(LL)';
    const L2_key = hasBrake ? 'LO2'      : 'L2';
    const L1  = mVal(dims, L1_key, LX - LR);
    const L2  = mVal(dims, L2_key, L1*0.46);

    // Brake 길이
    const SL_raw = mVal(dims,'SL', 0);
    const SL  = hasBrake ? (SL_raw > 0 ? SL_raw : Math.max(L1 - L2 - mVal(dims,'EnL', LC*0.3), LC*0.25)) : 0;

    const TL  = mVal(dims,'TL(LG)',   LC*0.07);   // 전방 링 구간
    const LB  = mVal(dims,'LB',       LC*0.75);   // 플랜지 OD
    const LE  = mVal(dims,'LE',       LC*0.07);   // 플랜지 두께
    const S   = mVal(dims,'S',        LC*0.2);    // 샤프트 직경
    const EnH = mVal(dims,'EnH',      LC*0.8);    // 엔코더 OD
    const CW  = mVal(dims,'CW(MW)',   0);
    const CL  = mVal(dims,'CL(ML)',   0);
    const CH  = mVal(dims,'CH(MH)',   0);
    const PCD = mVal(dims,'PCD(LA)',  LB*0.80);

    // ★ Gearhead 치수 (hasGearhead=true일 때만)
    const G_LC = hasGearhead ? mVal(dims,'G_LC', LC*1.1) : 0;
    const G_LG = hasGearhead ? mVal(dims,'G_LG', LC*0.15) : 0;
    const G_LB = hasGearhead ? mVal(dims,'G_LB', G_LC*0.55) : 0;
    const G_LE = hasGearhead ? mVal(dims,'G_LE', LC*0.10) : 0;
    const G_LD = hasGearhead ? mVal(dims,'G_LD', G_LC*0.88) : 0;
    const G_L3 = hasGearhead ? mVal(dims,'G_L3', LC*0.12) : 0;
    const G_LL = hasGearhead ? mVal(dims,'G_LL', 0) : 0;
    const G_LLO = hasGearhead ? mVal(dims,'G_LLO', 0) : 0;
    const G_S  = hasGearhead ? mVal(dims,'G_S',  S*1.4) : 0;
    const G_B  = hasGearhead ? mVal(dims,'G_B',  0) : 0;
    const G_C  = hasGearhead ? mVal(dims,'G_C',  0) : 0;
    const G_L1 = hasGearhead ? mVal(dims,'G_L1', LC*0.40) : 0;
    const G_L2 = hasGearhead ? mVal(dims,'G_L2', LC*0.80) : 0;
    const G_Q  = hasGearhead ? mVal(dims,'G_Q',  G_L2*0.65) : 0;
    const G_LR = hasGearhead ? mVal(dims,'G_LR', 0) : 0;

    // Gearhead 파생
    const L1_LL_for_gear = mVal(dims,'L1(LL)', 0) || L1;
    const G_LLeff = hasBrake ? (G_LLO > 0 ? G_LLO : G_LL) : G_LL;
    let gearTotalLen = hasGearhead ? (G_LLeff - L1_LL_for_gear) : 0;
    if (hasGearhead && !(gearTotalLen > 0)) gearTotalLen = LC * 1.2;
    let gearBodyLen = hasGearhead ? (gearTotalLen - G_LG) : 0;
    if (hasGearhead && !(gearBodyLen >= 0)) gearBodyLen = 0;
    const pilot1Len = hasGearhead ? G_LE : 0;
    const pilot2Len = hasGearhead ? Math.max(G_L3 - G_LE, 0) : 0;
    const gearShaftLen1 = hasGearhead && G_B > 0 ? Math.max(G_L1 - G_L3, 0) : 0;
    const gearShaftLen2 = hasGearhead && G_C > 0 ? Math.max(G_L2 - G_Q, 0) : 0;
    const gearMainShaftLen = hasGearhead ? (G_C > 0 ? G_Q : G_L2) : 0;
    const gearShaftTotal = hasGearhead
        ? (G_LR > 0 ? G_LR : gearShaftLen1 + gearShaftLen2 + gearMainShaftLen)
        : 0;
    const gearTotalForw = hasGearhead ? (gearTotalLen + pilot1Len + pilot2Len + gearShaftTotal) : 0;

    // 전체 폭/높이: hasGearhead 시 +Y 방향으로 감속기가 뻗어 나감
    const leftExtent = hasGearhead ? gearTotalForw : LR;   // 좌측 (샤프트/감속기)
    const rightExtent = LE + L1;                              // 우측 (플랜지+본체+브레이크+엔코더)
    const totalW = leftExtent + rightExtent;
    const totalH = Math.max(
        hasGearhead ? G_LC : 0,
        LH + (CH > 0 ? CH + 2 : 0),
        EnH > LH ? EnH : LH
    );
    const sc = calcScale(Math.max(totalW, totalH*1.5), W, H, 0.50);

    // 배치: 좌측에 모터 샤프트/감속기, 우측에 모터 본체
    const marginL = 55;
    // 샤프트 끝(없으면 감속기 끝)이 왼쪽 기준
    const xGearShTip = marginL;                             // 감속기 출력축 끝
    const xGearFlgFront = xGearShTip + gearShaftTotal*sc;   // 감속기 플랜지 전면 (=Pilot 시작)
    const xGearFlgBack  = xGearFlgFront + (pilot1Len + pilot2Len)*sc;  // 감속기 플랜지 후면 쪽 방향 아님(중심): 단순히 +
    // Three.js 공간의 감속기 배치(+Y)는 2D 측면도에서는 모터 플랜지면의 왼쪽으로 뻗어 나감
    // 따라서 Pilot 2 → Pilot 1 → Flange → GearBody → 모터 플랜지면 순서 (왼→오)
    const xPilot2End = xGearShTip + gearShaftTotal*sc;          // Pilot2 축 끝 (= 감속기 출력면)
    const xPilot2Start = xPilot2End + pilot2Len*sc;             // Pilot2 시작 = Pilot1 끝
    const xPilot1Start = xPilot2Start + pilot1Len*sc;           // Pilot1 시작 = 감속기 플랜지 전면
    const xGearFlgEnd  = xPilot1Start + G_LG*sc;                // 감속기 플랜지 후면 = 바디 전면
    const xGearBodyEnd = xGearFlgEnd + gearBodyLen*sc;          // 감속기 바디 뒤쪽 = 모터 플랜지면

    // 모터 샤프트 구간 (감속기 없을 때만 그림)
    const xShTip = xGearShTip;                                  // 모터 샤프트 끝 (감속기 없을 때)
    const xFlg = hasGearhead ? xGearBodyEnd : (xShTip + LR*sc); // 모터 플랜지 전면
    const xBody= xFlg + LE*sc;                                  // 본체 시작
    const xEnd = xBody + L1*sc;                                 // 본체 끝
    const cy   = H * 0.52;                                      // 모터 수직 중앙

    const lcs = LC*sc, lhs = LH*sc, les = LE*sc;
    const shDs = S*sc, lbs = LB*sc;
    const tls = TL*sc;
    const enHs = Math.max(EnH*sc, lhs);

    // ── 배경
    ctx.fillStyle = '#F8F9FA';
    ctx.fillRect(0, 0, W, H);

    // ═══════════════════════════════════════════════════════════════
    // ★ v50 3세션차 NEW: Gearhead 구간 (hasGearhead=true일 때만)
    // ═══════════════════════════════════════════════════════════════
    if (hasGearhead) {
        // ① Gearhead Body (사각/원통: 2D 측면도에서는 사각 근사)
        if (gearBodyLen > 0.01) {
            const gbW = gearBodyLen * sc;
            const gbH = (G_LD > 0.01 ? G_LD : G_LC * 0.95) * sc;
            ctx.fillStyle = 'rgba(200,204,208,0.90)';   // steelCast
            ctx.fillRect(xGearFlgEnd, cy - gbH/2, gbW, gbH);
            drawLine(xGearFlgEnd, cy - gbH/2, xGearFlgEnd + gbW, cy - gbH/2, COLOR.outline, LINE.outline);
            drawLine(xGearFlgEnd, cy + gbH/2, xGearFlgEnd + gbW, cy + gbH/2, COLOR.outline, LINE.outline);
        }

        // ② Gearhead Flange (사각 G_LC × G_LG)
        if (G_LG > 0.01) {
            const flgW = G_LG * sc;
            const flgH = G_LC * sc;
            ctx.fillStyle = 'rgba(184,188,194,0.92)';   // aluminum
            ctx.fillRect(xPilot1Start, cy - flgH/2, flgW, flgH);
            drawLine(xPilot1Start, cy - flgH/2, xPilot1Start + flgW, cy - flgH/2, COLOR.outline, LINE.outline);
            drawLine(xPilot1Start, cy + flgH/2, xPilot1Start + flgW, cy + flgH/2, COLOR.outline, LINE.outline);
            drawLine(xPilot1Start, cy - flgH/2, xPilot1Start, cy + flgH/2, COLOR.outline, LINE.outline);
            drawLine(xPilot1Start + flgW, cy - flgH/2, xPilot1Start + flgW, cy + flgH/2, COLOR.outline, LINE.outline);
        }

        // ③ Pilot 1 (원형 G_LB × pilot1Len)
        if (pilot1Len > 0.01 && G_LB > 0.01) {
            const p1W = pilot1Len * sc;
            const p1H = G_LB * sc;
            ctx.fillStyle = 'rgba(184,188,194,0.85)';
            ctx.fillRect(xPilot2Start, cy - p1H/2, p1W, p1H);
            drawLine(xPilot2Start, cy - p1H/2, xPilot2Start + p1W, cy - p1H/2, COLOR.outline, LINE.outline);
            drawLine(xPilot2Start, cy + p1H/2, xPilot2Start + p1W, cy + p1H/2, COLOR.outline, LINE.outline);
        }

        // ④ Pilot 2 (원형 G_LD × pilot2Len)
        if (pilot2Len > 0.01 && G_LD > 0.01) {
            const p2W = pilot2Len * sc;
            const p2H = G_LD * sc;
            ctx.fillStyle = 'rgba(184,188,194,0.78)';
            ctx.fillRect(xPilot2End, cy - p2H/2, p2W, p2H);
            drawLine(xPilot2End, cy - p2H/2, xPilot2End + p2W, cy - p2H/2, COLOR.outline, LINE.outline);
            drawLine(xPilot2End, cy + p2H/2, xPilot2End + p2W, cy + p2H/2, COLOR.outline, LINE.outline);
        }

        // ⑤ 감속기 다단 출력축 (G_B → G_C → G_S, 좌측 끝으로 뻗음)
        if (G_S > 0.01) {
            let xCur = xPilot2End;  // 감속기 출력면 시작, +Y 쪽(2D 왼쪽)으로 그림
            // 실제 +Y 방향 = 2D 측면도에서 왼쪽(xShTip 쪽)
            // 각 단 width 는 -방향으로 쌓임
            // G_B 단
            if (gearShaftLen1 > 0.01 && G_B > 0.01) {
                const w = gearShaftLen1 * sc;
                const h = G_B * sc;
                ctx.fillStyle = 'rgba(200,205,211,0.95)';
                ctx.fillRect(xCur - w, cy - h/2, w, h);
                drawLine(xCur - w, cy - h/2, xCur, cy - h/2, COLOR.outline, LINE.outline);
                drawLine(xCur - w, cy + h/2, xCur, cy + h/2, COLOR.outline, LINE.outline);
                xCur -= w;
            }
            // G_C 단
            if (gearShaftLen2 > 0.01 && G_C > 0.01) {
                const w = gearShaftLen2 * sc;
                const h = G_C * sc;
                ctx.fillStyle = 'rgba(200,205,211,0.95)';
                ctx.fillRect(xCur - w, cy - h/2, w, h);
                drawLine(xCur - w, cy - h/2, xCur, cy - h/2, COLOR.outline, LINE.outline);
                drawLine(xCur - w, cy + h/2, xCur, cy + h/2, COLOR.outline, LINE.outline);
                xCur -= w;
            }
            // G_S 메인 출력축
            if (gearMainShaftLen > 0.01) {
                const w = gearMainShaftLen * sc;
                const h = G_S * sc;
                ctx.fillStyle = 'rgba(200,205,211,0.95)';
                ctx.fillRect(xCur - w, cy - h/2, w, h);
                drawLine(xCur - w, cy - h/2, xCur, cy - h/2, COLOR.outline, LINE.outline);
                drawLine(xCur - w, cy + h/2, xCur, cy + h/2, COLOR.outline, LINE.outline);
                drawLine(xCur - w, cy - h/2, xCur - w, cy + h/2, COLOR.outline, LINE.outline);
                xCur -= w;
            }
        }

        // 좌우 연결선 (감속기 바디 후면부터 플랜지까지의 외곽 윤곽)
        // (없음 - 위에서 각 구간이 위/아래 선 그어짐)
    }

    // ── 샤프트 (Y방향 기준, 중앙) — hasGearhead=true면 샤프트는 숨김
    if (!hasGearhead) {
        ctx.fillStyle = 'rgba(200,210,215,0.95)';
        ctx.fillRect(xShTip, cy - shDs/2, LR*sc, shDs);
        drawLine(xShTip, cy - shDs/2, xFlg, cy - shDs/2, COLOR.outline, LINE.outline);
        drawLine(xShTip, cy + shDs/2, xFlg, cy + shDs/2, COLOR.outline, LINE.outline);
        drawLine(xShTip, cy - shDs/2, xShTip,  cy + shDs/2, COLOR.outline, LINE.outline);
    }

    // ── 플랜지 (두꺼운 디스크)
    ctx.fillStyle = 'rgba(168,176,187,0.95)';
    ctx.fillRect(xFlg, cy - lbs/2, les, lbs);
    drawLine(xFlg, cy - lbs/2, xFlg + les, cy - lbs/2, COLOR.outline, LINE.outline);
    drawLine(xFlg, cy + lbs/2, xFlg + les, cy + lbs/2, COLOR.outline, LINE.outline);
    drawLine(xFlg, cy - lbs/2, xFlg, cy + lbs/2, COLOR.outline, LINE.outline);
    // 플랜지 내경 (샤프트홀 가이드) — hasGearhead=true면 숨김(감속기 내부)
    if (!hasGearhead) {
        ctx.setLineDash(DASH_HIDDEN);
        ctx.strokeStyle = COLOR.hiddenLine;
        ctx.lineWidth = LINE.hidden;
        drawLine(xFlg, cy - shDs/2, xFlg + les, cy - shDs/2, COLOR.hiddenLine, LINE.hidden);
        drawLine(xFlg, cy + shDs/2, xFlg + les, cy + shDs/2, COLOR.hiddenLine, LINE.hidden);
        ctx.setLineDash([]);
    }

    // ── 본체 사각 프레임 (Section A: Front Endbell 전방 단단)
    const xA = xBody;
    const wA = tls > 1 ? tls : lcs*0.1;
    ctx.fillStyle = 'rgba(44,44,44,0.95)';
    ctx.fillRect(xA, cy - lcs/2, wA, lcs);
    drawLine(xA, cy - lcs/2, xA + wA, cy - lcs/2, COLOR.outline, LINE.outline);
    drawLine(xA, cy + lcs/2, xA + wA, cy + lcs/2, COLOR.outline, LINE.outline);

    // Section B (Stator + 내공)
    const xB = xA + wA;
    const wB = Math.max(0.1, L2*sc - wA);
    ctx.fillStyle = 'rgba(44,44,44,0.80)';
    ctx.fillRect(xB, cy - lcs/2, wB, lcs);
    const inR = lcs * 0.78 / 2;
    ctx.fillStyle = 'rgba(220,224,230,0.3)';
    ctx.fillRect(xB, cy - inR, wB, inR*2);
    drawLine(xB, cy - lcs/2, xB + wB, cy - lcs/2, COLOR.outline, LINE.outline);
    drawLine(xB, cy + lcs/2, xB + wB, cy + lcs/2, COLOR.outline, LINE.outline);

    // ★ v50 3세션차 NEW: Section B2 (Brake Module + Brake Cover) — hasBrake=true일 때만
    //   본체 Section B(=L2 끝) 뒤쪽에 SL 길이 Brake 추가.
    //   Brake Module: 본체보다 살짝(픽셀 2) 안쪽
    //   Brake Cover:  본체 외곽 + 속빔 (측면도에서는 외곽선만 표시)
    let xBrakeEnd = xBody + L2*sc;    // Brake 없을 때는 Section B 끝 = Section C 시작
    if (hasBrake && SL > 0.01) {
        const brW = SL * sc;
        const brIndent = Math.min(lcs * 0.04, 3);   // 본체보다 살짝 안쪽
        ctx.fillStyle = 'rgba(68,70,76,0.92)';       // steelDark (아연도금)
        ctx.fillRect(xBrakeEnd, cy - lcs/2 + brIndent, brW, lcs - brIndent*2);
        // Brake Cover 외곽 (본체와 같은 폭)
        drawLine(xBrakeEnd, cy - lcs/2, xBrakeEnd + brW, cy - lcs/2, COLOR.outline, LINE.outline);
        drawLine(xBrakeEnd, cy + lcs/2, xBrakeEnd + brW, cy + lcs/2, COLOR.outline, LINE.outline);
        // Brake 시작선 (Section B와의 경계)
        drawLine(xBrakeEnd, cy - lcs/2, xBrakeEnd, cy + lcs/2, COLOR.hiddenLine, LINE.hidden);
        xBrakeEnd += brW;
    }

    // Section C (엔코더 구간) — Brake 뒤로 밀림
    const xE = xBrakeEnd;
    const wE = Math.max(0.1, xEnd - xE);
    const eH = enHs;
    const eOffZ = enHs > lhs ? (enHs - lhs)/4 : 0;
    ctx.fillStyle = 'rgba(32,32,40,0.90)';
    ctx.fillRect(xE, cy - eH/2 - eOffZ, wE, eH);
    drawLine(xE, cy - eH/2 - eOffZ, xE + wE, cy - eH/2 - eOffZ, COLOR.outline, LINE.outline);
    drawLine(xE, cy + eH/2 - eOffZ, xE + wE, cy + eH/2 - eOffZ, COLOR.outline, LINE.outline);
    drawLine(xE + wE, cy - eH/2 - eOffZ, xE + wE, cy + eH/2 - eOffZ, COLOR.outline, LINE.outline);

    // 좌우 연결선 (사각 프레임 전체 윤곽)
    drawLine(xA, cy - lcs/2, xE, cy - lcs/2, COLOR.outline, LINE.outline);
    drawLine(xA, cy + lcs/2, xE, cy + lcs/2, COLOR.outline, LINE.outline);
    drawLine(xA, cy - lcs/2, xA, cy + lcs/2, COLOR.outline, LINE.outline);

    // ── 커넥터: 인출부 + 소켓 + 핀 + 케이블 + IX40 플러그 (3D와 동기화)
    //    Side 뷰 좌표 매핑:
    //      3D Y축 (축방향, 엔코더←→샤프트) → 2D 화면 X축 (왼쪽=샤프트, 오른쪽=엔코더)
    //      3D Z축 (수직 +Z=위) → 2D 화면 Y축 반전 (화면상 위쪽이 음수 픽셀)
    //      ★ 3D에서 엔코더는 Y-(뒤쪽), 2D에서는 xE~xEnd 구간 (오른쪽)
    //      ★ 3D 인출부 (encMidY - EnL*0.27, 뒤쪽) → 2D 오른쪽 (엔코더 중심에서 오른쪽으로)
    //      ★ 3D 소켓   (encMidY + EnL*0.52, 앞쪽) → 2D 왼쪽 (엔코더 중심에서 왼쪽으로)
    //      ★ 소형(LC<30)은 3D와 동일하게 소켓 바닥이 본체 상단에 밀착, 치수 축소
    if (CW > 0 && CH > 0 && CL > 0 && wE > 1) {
        const isSmallEnc = LC < 30;
        const encMidX = (xE + xEnd) / 2;
        const encTopY = cy - eH/2 - eOffZ;   // 엔코더 상단 Y 픽셀 (화면상)
        const bodyTopY = cy - lcs/2;         // 본체 상단 Y 픽셀

        // ─── [1] 인출부 (뒤쪽=2D 오른쪽, 작은 사각형)
        //   3D의 원통 부트 → 2D Side에서는 작은 사각형 (원통의 측면 단면)
        const bossDia_mm = isSmallEnc
            ? Math.min(CH * 0.95, (L1 - L2) * 0.50)
            : Math.min(CH * 0.70, (L1 - L2) * 0.40);
        const bossShoulderH_mm = CL * 0.18;
        const bossTopH_mm = CL * 0.22;
        const bossY_mm_offset = isSmallEnc ? -0.22 : -0.27;   // 3D: encMidY + EnL*(이 값)
        const bossTotalH_mm = bossShoulderH_mm + bossTopH_mm;  // 인출부 총 높이 (Z축)

        // 2D에서 3D의 Y축 오프셋 → 화면 X 변환: 3D +Y = 화면 왼쪽 (샤프트 방향)
        //   3D `encMidY + EnL * bossY_mm_offset` 에서 bossY_mm_offset이 음수이면 뒤쪽
        //   → 2D 화면 X = encMidX - (bossY_mm_offset) * wE   (음수 오프셋 → 화면 오른쪽으로)
        const bossCenterX = encMidX - bossY_mm_offset * wE;
        const bossW_px = bossDia_mm * sc;
        const bossH_px = bossTotalH_mm * sc;

        ctx.fillStyle = 'rgba(20,20,20,0.95)';
        ctx.fillRect(bossCenterX - bossW_px/2, encTopY - bossH_px, bossW_px, bossH_px);
        drawLine(bossCenterX - bossW_px/2, encTopY - bossH_px,
                 bossCenterX + bossW_px/2, encTopY - bossH_px, COLOR.outline, LINE.outline);
        drawLine(bossCenterX - bossW_px/2, encTopY - bossH_px,
                 bossCenterX - bossW_px/2, encTopY, COLOR.outline, LINE.outline);
        drawLine(bossCenterX + bossW_px/2, encTopY - bossH_px,
                 bossCenterX + bossW_px/2, encTopY, COLOR.outline, LINE.outline);

        // ─── [2] 소켓 (앞쪽=2D 왼쪽)
        const sockW_mm = isSmallEnc ? CW * 0.85 : CW * 1.00;   // 단, Side 뷰에서 W는 화면 안 보임
        const sockD_mm = isSmallEnc ? (L1 - L2) * 0.55 : (L1 - L2) * 0.95;   // 축방향 길이 (화면 X폭)
        const sockH_mm = isSmallEnc ? CH * 0.65 : CH * 0.95;                 // 수직 높이 (화면 Y폭)
        const sockY_mm_offset = isSmallEnc ? 0.375 : 0.52;

        const sockCenterX = encMidX - sockY_mm_offset * wE;    // 음수 반전
        const sockD_px = sockD_mm * sc;
        const sockH_px = sockH_mm * sc;

        // 소켓 Z 기준:
        //   중형: 엔코더 상단 위에 얹힘 (encTopY 바로 위)
        //   소형: 본체 상단에 소켓 바닥 밀착 (bodyTopY 위로)
        const sockBottomY = isSmallEnc ? bodyTopY : encTopY;
        const sockTopY = sockBottomY - sockH_px;

        ctx.fillStyle = 'rgba(15,15,15,0.96)';
        ctx.fillRect(sockCenterX - sockD_px/2, sockTopY, sockD_px, sockH_px);
        drawLine(sockCenterX - sockD_px/2, sockTopY,
                 sockCenterX + sockD_px/2, sockTopY, COLOR.outline, LINE.outline);
        drawLine(sockCenterX - sockD_px/2, sockBottomY,
                 sockCenterX + sockD_px/2, sockBottomY, COLOR.outline, LINE.outline);
        drawLine(sockCenterX - sockD_px/2, sockTopY,
                 sockCenterX - sockD_px/2, sockBottomY, COLOR.outline, LINE.outline);
        drawLine(sockCenterX + sockD_px/2, sockTopY,
                 sockCenterX + sockD_px/2, sockBottomY, COLOR.outline, LINE.outline);

        // ─── [2-a] 소켓 전면 개구부 (소켓 좌측 면, 즉 +Y 방향)
        //   3D에서 소켓 전면은 +Y 방향 → 2D 화면상 왼쪽
        const openD_mm = Math.min(1.8, sockD_mm * 0.4);
        const openH_mm = sockH_mm * 0.65;
        const openD_px = openD_mm * sc;
        const openH_px = openH_mm * sc;
        const openLeftX = sockCenterX - sockD_px/2;
        const openTopY = sockTopY + (sockH_px - openH_px) / 2;
        ctx.fillStyle = 'rgba(5,5,5,0.98)';
        ctx.fillRect(openLeftX, openTopY, openD_px, openH_px);

        // ─── [2-b] 핀 4개 (소켓 전면에서 +Y로 돌출 → 2D 화면상 왼쪽으로 튀어나감)
        //   Side 뷰에서는 핀 배열축이 X축 → 화면 안쪽/바깥쪽 → 수직선(Z)로만 보임
        //   즉 4개 핀이 겹쳐 보이지만, 핀 수직 높이는 소켓 높이 내에 분포
        //   여기서는 대표적으로 얇은 선 하나로 표시 (핀 묶음)
        const pinLen_mm = Math.min(1.6, sockD_mm * 0.35);
        const pinLen_px = pinLen_mm * sc;
        const pinCenterY = (sockTopY + sockBottomY) / 2;
        ctx.fillStyle = 'rgba(210,160,60,0.95)';   // brassGold
        // 핀 영역: 소켓 개구부에서 왼쪽으로 pinLen_px만큼 돌출
        const pinBoxH = openH_px * 0.55;
        ctx.fillRect(openLeftX - pinLen_px, pinCenterY - pinBoxH/2, pinLen_px, pinBoxH);
        drawLine(openLeftX - pinLen_px, pinCenterY - pinBoxH/2,
                 openLeftX, pinCenterY - pinBoxH/2, COLOR.outline, LINE.outline*0.7);
        drawLine(openLeftX - pinLen_px, pinCenterY + pinBoxH/2,
                 openLeftX, pinCenterY + pinBoxH/2, COLOR.outline, LINE.outline*0.7);

        // ─── [3] L자 케이블 (인출부 상단 → +Z로 위 → -X로 꺾임)
        //   3D: dir1='+z', dir2='-x' (좌우 방향)
        //   Side 뷰 좌표: -X 방향 = 화면 안쪽/바깥쪽 → 화면상 보이지 않음
        //   → Side 뷰에서는 케이블이 위로 올라가다가 화면 안쪽으로 사라짐
        //   간단화: 위로 일정 길이만 그리고 끝부분에서 IX40 플러그를 그림
        const cableDia_mm = Math.max(bossDia_mm * 0.7, 1.8);
        const cableLen1_mm = CH * 1.6;
        const cableLen1_px = cableLen1_mm * sc;
        const cableW_px = cableDia_mm * sc;

        const cableStartY = encTopY - bossH_px;  // 인출부 상단
        const cableTopY = cableStartY - cableLen1_px;

        // 케이블 수직 구간
        ctx.fillStyle = 'rgba(230,232,235,0.95)';   // 밝은 회색 케이블
        ctx.fillRect(bossCenterX - cableW_px/2, cableTopY, cableW_px, cableLen1_px);
        drawLine(bossCenterX - cableW_px/2, cableTopY,
                 bossCenterX - cableW_px/2, cableStartY, COLOR.outline, LINE.outline*0.8);
        drawLine(bossCenterX + cableW_px/2, cableTopY,
                 bossCenterX + cableW_px/2, cableStartY, COLOR.outline, LINE.outline*0.8);

        // 꺾임 (엘보) — 작은 원
        ctx.beginPath();
        ctx.arc(bossCenterX, cableTopY, cableW_px * 0.6, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(230,232,235,0.95)';
        ctx.fill();
        ctx.strokeStyle = COLOR.outline;
        ctx.lineWidth = LINE.outline*0.8;
        ctx.stroke();

        // ─── [4] IX40 플러그 (케이블 끝, -X 방향)
        //   3D: 케이블이 -X로 꺾여 IX40 플러그가 좌우 방향으로 붙음
        //   Side 뷰에서는 이 플러그가 카메라 쪽으로 튀어나오거나 안쪽으로 사라짐
        //   → 케이블 엘보 위에 작은 사각형으로 플러그 "끝 단면"만 표시 (단순화)
        const plugW_mm = 14.3;  // IX40 Height (Side 뷰에서 카메라 방향)
        const plugH_mm = 8.4;   // IX40 Width
        const plugScale = Math.max(cableDia_mm / 6.8, 0.75);
        const plugW_px = plugW_mm * plugScale * sc * 0.6;   // 화면상 축소 표현
        const plugH_px = plugH_mm * plugScale * sc * 0.6;

        ctx.fillStyle = 'rgba(30,30,30,0.94)';
        ctx.fillRect(bossCenterX - plugW_px/2, cableTopY - plugH_px/2 - 1, plugW_px, plugH_px);
        drawLine(bossCenterX - plugW_px/2, cableTopY - plugH_px/2 - 1,
                 bossCenterX + plugW_px/2, cableTopY - plugH_px/2 - 1, COLOR.outline, LINE.outline*0.8);
        drawLine(bossCenterX - plugW_px/2, cableTopY + plugH_px/2 - 1,
                 bossCenterX + plugW_px/2, cableTopY + plugH_px/2 - 1, COLOR.outline, LINE.outline*0.8);
        drawLine(bossCenterX - plugW_px/2, cableTopY - plugH_px/2 - 1,
                 bossCenterX - plugW_px/2, cableTopY + plugH_px/2 - 1, COLOR.outline, LINE.outline*0.8);
        drawLine(bossCenterX + plugW_px/2, cableTopY - plugH_px/2 - 1,
                 bossCenterX + plugW_px/2, cableTopY + plugH_px/2 - 1, COLOR.outline, LINE.outline*0.8);
    }

    // ── 마운팅홀 위치 (플랜지 면에서 수직 가이드)
    ctx.setLineDash(DASH_HIDDEN);
    ctx.strokeStyle = COLOR.hiddenLine;
    ctx.lineWidth = LINE.hidden;
    const pcdR_px = (PCD/2)*sc;
    drawLine(xFlg, cy - pcdR_px, xFlg + les + tls, cy - pcdR_px, COLOR.hiddenLine, LINE.hidden);
    drawLine(xFlg, cy + pcdR_px, xFlg + les + tls, cy + pcdR_px, COLOR.hiddenLine, LINE.hidden);
    ctx.setLineDash([]);

    // 중심선 (감속기까지 연장)
    drawCenterLineH(xGearShTip - 15, xEnd + 10, cy);

    // ── 치수 표시 ──
    if (showDimensions) {
        const dimOff  = 20;
        const dimOff2 = 40;

        // ★ v50: hasBrake=true면 라벨 치환
        const L1_label = hasBrake ? 'LO1' : 'L1';
        const L2_label = hasBrake ? 'LO2' : 'L2';
        const LX_label = hasBrake ? 'LO'  : 'LX';

        // ① 전체 길이 LX (또는 LO) — 위쪽
        if (hasGearhead) {
            // 감속기까지 포함한 총 폭
            const allTotal = gearTotalForw + LE + L1;
            drawHDim(xGearShTip, xGearShTip + allTotal*sc, cy - Math.max(lhs/2, eH/2) - dimOff2, -dimOff, LX_label, LX);
        } else {
            const lxTotalW = (LR + LE + L1) * sc;
            drawHDim(xShTip, xShTip + lxTotalW, cy - Math.max(lhs/2, eH/2) - dimOff2, -dimOff, LX_label, LX);
        }

        // ② LR (또는 G_LR) — 아래 짧은 구간
        if (hasGearhead) {
            if (gearShaftTotal > 0.1) {
                drawHDim(xGearShTip, xPilot2End, cy + Math.max(lbs, G_LC*sc)/2 + 5, dimOff, 'G_LR', gearShaftTotal);
            }
        } else {
            drawHDim(xShTip, xFlg, cy + lbs/2 + 5, dimOff, 'LR', LR);
        }

        // ③ 본체 길이 L1 (또는 LO1) — 아래 전체
        drawHDim(xBody, xEnd, cy + lcs/2 + (CH > 0 ? CH*sc + 8 : 5), dimOff + 5, L1_label, L1);

        // ④ L2 구간 (또는 LO2) — 작은 치수
        drawHDim(xBody, xBody + L2*sc, cy - lcs/2 - 5, -dimOff, L2_label, L2);

        // ★ v50 3세션차: SL Brake 길이 — hasBrake=true일 때만
        if (hasBrake && SL > 0.5) {
            drawHDim(xBody + L2*sc, xBrakeEnd, cy - lcs/2 - 5, -(dimOff + 25), 'SL', SL);
        }

        // ⑤ 프레임 폭 LC (우측)
        drawVDim(cy - lcs/2, cy + lcs/2, xEnd + 10, dimOff, 'LC', LC);

        // ⑥ 플랜지 직경 LB (좌측) — hasGearhead 시 감속기 플랜지와 혼동되므로 위치 이동
        if (!hasGearhead) {
            drawVDim(cy - lbs/2, cy + lbs/2, xFlg - 10, -dimOff2, 'LB', LB);
        }

        // ⑦ 샤프트 직경 S — hasGearhead 시 숨김
        if (!hasGearhead) {
            drawVDim(cy - shDs/2, cy + shDs/2, xShTip - 8, -dimOff, 'S', S);
        }

        // ⑧ 엔코더 OD (있을 때)
        if (EnH > LH + 1) {
            drawVDim(cy - eH/2 - eOffZ, cy + eH/2 - eOffZ, xEnd + 10, dimOff + 25, 'EnH', EnH);
        }

        // ★ v50 3세션차 NEW: Gearhead 치수선
        if (hasGearhead) {
            // G_LC 감속기 플랜지 외곽 폭
            if (G_LC > 0.5) {
                drawVDim(cy - G_LC*sc/2, cy + G_LC*sc/2, xPilot1Start + G_LG*sc/2, -dimOff2 - 10, 'G_LC', G_LC);
            }
            // Ø G_S 출력축 직경
            if (G_S > 0.5 && gearShaftTotal > 0.1) {
                drawVDim(cy - G_S*sc/2, cy + G_S*sc/2, xGearShTip - 8, -dimOff, 'ØG_S', G_S);
            }
            // G_LB Pilot1 외경
            if (G_LB > 0.5 && pilot1Len > 0.1) {
                drawVDim(cy - G_LB*sc/2, cy + G_LB*sc/2, xPilot2Start + pilot1Len*sc/2, dimOff + 15, 'G_LB', G_LB);
            }
            // G_LG 플랜지 두께
            if (G_LG > 0.5) {
                drawHDim(xPilot1Start, xGearFlgEnd, cy + Math.max(lbs, G_LC*sc)/2 + 25, dimOff + 15, 'G_LG', G_LG);
            }
            // G_LL 또는 G_LLO (감속기 포함 전체 바디 길이)
            if (G_LLeff > 0.5) {
                const gll_label = hasBrake ? 'G_LLO' : 'G_LL';
                drawHDim(xPilot1Start, xEnd, cy - Math.max(lhs/2, G_LC*sc/2) - dimOff2 - 25, -dimOff, gll_label, G_LLeff);
            }
        }
    }
}

// ─────────────────────────────────────────────
// 평면도 (위에서 본 뷰): 본체 + 커넥터 + 마운팅홀 위치
// ─────────────────────────────────────────────
function drawServoMotor_Top(dims, W, H) {
    const LC  = mVal(dims,'LC',       mVal(dims,'S', 40));
    const LR  = mVal(dims,'LR',       LC*0.25);

    // ★ v50 3세션차: 옵션 해석
    const mOpt = resolveMotorOpts(dims, currentMotorOptions, currentPartCode);
    const hasBrake = mOpt.hasBrake;
    const hasGearhead = mOpt.hasGearhead;

    // Brake 치환
    const LX_raw = mVal(dims,'LX', 0);
    const LO_raw = mVal(dims,'LO', 0);
    const LX  = hasBrake ? (LO_raw > 0 ? LO_raw : (LX_raw || LC*1.8)) : (LX_raw || LC*1.5);
    const L1_key = hasBrake ? 'LO1(LLO)' : 'L1(LL)';
    const L2_key = hasBrake ? 'LO2'      : 'L2';
    const L1  = mVal(dims, L1_key, LX - LR);
    const L2  = mVal(dims, L2_key, L1*0.46);
    const SL_raw = mVal(dims,'SL', 0);
    const SL  = hasBrake ? (SL_raw > 0 ? SL_raw : Math.max(L1 - L2 - mVal(dims,'EnL', LC*0.3), LC*0.25)) : 0;

    const TL  = mVal(dims,'TL(LG)',   LC*0.07);
    const LE  = mVal(dims,'LE',       LC*0.07);
    const S   = mVal(dims,'S',        LC*0.2);
    const LB  = mVal(dims,'LB',       LC*0.75);
    const CW  = mVal(dims,'CW(MW)',   0);
    const CL  = mVal(dims,'CL(ML)',   0);
    const PCD = mVal(dims,'PCD(LA)',  LB*0.80);

    // Gearhead 치수
    const G_LC = hasGearhead ? mVal(dims,'G_LC', LC*1.1) : 0;
    const G_LG = hasGearhead ? mVal(dims,'G_LG', LC*0.15) : 0;
    const G_LL = hasGearhead ? mVal(dims,'G_LL', 0) : 0;
    const G_LLO = hasGearhead ? mVal(dims,'G_LLO', 0) : 0;
    const G_LR = hasGearhead ? mVal(dims,'G_LR', 0) : 0;
    const G_LD = hasGearhead ? mVal(dims,'G_LD', G_LC*0.88) : 0;
    const G_L3 = hasGearhead ? mVal(dims,'G_L3', LC*0.12) : 0;
    const G_LE = hasGearhead ? mVal(dims,'G_LE', LC*0.10) : 0;

    const L1_LL_for_gear = mVal(dims,'L1(LL)', 0) || L1;
    const G_LLeff = hasBrake ? (G_LLO > 0 ? G_LLO : G_LL) : G_LL;
    let gearTotalLen = hasGearhead ? (G_LLeff - L1_LL_for_gear) : 0;
    if (hasGearhead && !(gearTotalLen > 0)) gearTotalLen = LC * 1.2;

    const pilot1Len = hasGearhead ? G_LE : 0;
    const pilot2Len = hasGearhead ? Math.max(G_L3 - G_LE, 0) : 0;
    const gearShaftTotal = hasGearhead ? (G_LR > 0 ? G_LR : LC * 0.5) : 0;
    const gearTotalForw = hasGearhead ? (gearTotalLen + pilot1Len + pilot2Len + gearShaftTotal) : 0;

    const leftExtent = hasGearhead ? gearTotalForw : LR;
    const totalW = leftExtent + LE + L1;
    const sc = calcScale(Math.max(totalW, Math.max(LC, G_LC) + (CW > 0 ? CW + 4 : 0) + 20), W, H, 0.50);

    const marginL = 50;
    // 감속기 있으면 왼쪽에 감속기 + 모터 샤프트 자리, 없으면 모터 샤프트만
    const xLeft = marginL;                                  // 가장 왼쪽 (샤프트 끝 또는 감속기 축 끝)
    const xFlg = xLeft + leftExtent * sc;                   // 모터 플랜지 전면
    const xBody= xFlg + LE*sc;
    const xEnd = xBody + L1*sc;
    const cy   = H * 0.5;

    const lcs = LC*sc, les = LE*sc, shDs = S*sc, lbs = LB*sc;
    const tls = TL > 0.1 ? TL*sc : lcs*0.1;

    // 배경
    ctx.fillStyle = '#F8F9FA';
    ctx.fillRect(0, 0, W, H);

    // ★ v50 3세션차: Gearhead 평면도 (사각 플랜지 G_LC, +바디)
    if (hasGearhead) {
        // 감속기 출력축 (평면도: 가는 사각)
        const xGearShTip = xLeft;
        const xGearShEnd = xGearShTip + gearShaftTotal * sc;
        const gS = mVal(dims,'G_S', S*1.4);
        const gSs = gS * sc;
        ctx.fillStyle = 'rgba(200,205,211,0.85)';
        ctx.fillRect(xGearShTip, cy - gSs/2, gearShaftTotal * sc, gSs);
        drawLine(xGearShTip, cy - gSs/2, xGearShEnd, cy - gSs/2, COLOR.outline, LINE.outline);
        drawLine(xGearShTip, cy + gSs/2, xGearShEnd, cy + gSs/2, COLOR.outline, LINE.outline);
        drawLine(xGearShTip, cy - gSs/2, xGearShTip, cy + gSs/2, COLOR.outline, LINE.outline);

        // 감속기 플랜지 (사각 G_LC)
        const gLCs = G_LC * sc;
        const xGearFlgStart = xGearShEnd + (pilot1Len + pilot2Len) * sc;
        const xGearFlgEnd   = xGearFlgStart + G_LG * sc;
        ctx.fillStyle = 'rgba(184,188,194,0.85)';
        ctx.fillRect(xGearFlgStart, cy - gLCs/2, G_LG * sc, gLCs);
        drawLine(xGearFlgStart, cy - gLCs/2, xGearFlgEnd, cy - gLCs/2, COLOR.outline, LINE.outline);
        drawLine(xGearFlgStart, cy + gLCs/2, xGearFlgEnd, cy + gLCs/2, COLOR.outline, LINE.outline);

        // 감속기 바디 (평면도: 사각 G_LD 또는 G_LC*0.95)
        const gBodyLen_d = gearTotalLen - G_LG;
        if (gBodyLen_d > 0.01) {
            const gbH = (G_LD > 0.01 ? G_LD : G_LC * 0.95) * sc;
            ctx.fillStyle = 'rgba(200,204,208,0.80)';
            ctx.fillRect(xGearFlgEnd, cy - gbH/2, gBodyLen_d * sc, gbH);
            drawLine(xGearFlgEnd, cy - gbH/2, xGearFlgEnd + gBodyLen_d * sc, cy - gbH/2, COLOR.outline, LINE.outline);
            drawLine(xGearFlgEnd, cy + gbH/2, xGearFlgEnd + gBodyLen_d * sc, cy + gbH/2, COLOR.outline, LINE.outline);
        }
    }

    // ── 샤프트 (평면도: 사각형) — hasGearhead=true면 숨김
    if (!hasGearhead) {
        ctx.fillStyle = 'rgba(200,210,215,0.8)';
        ctx.fillRect(xLeft, cy - shDs/2, LR*sc, shDs);
        drawLine(xLeft, cy - shDs/2, xFlg, cy - shDs/2, COLOR.outline, LINE.outline);
        drawLine(xLeft, cy + shDs/2, xFlg, cy + shDs/2, COLOR.outline, LINE.outline);
        drawLine(xLeft, cy - shDs/2, xLeft,  cy + shDs/2, COLOR.outline, LINE.outline);
    }

    // ── 플랜지 (평면도: 원 표시) — hasGearhead=true면 숨김 (감속기 플랜지로 대체됨)
    if (!hasGearhead) {
        ctx.setLineDash(DASH_HIDDEN);
        ctx.strokeStyle = COLOR.hiddenLine;
        ctx.lineWidth = LINE.hidden;
        ctx.beginPath();
        ctx.arc(xFlg + les/2, cy, lbs/2, 0, Math.PI*2);
        ctx.stroke();
        ctx.setLineDash([]);
    }

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

    // ★ v50 3세션차: Brake 경계선 (hasBrake=true일 때만)
    if (hasBrake && SL > 0.01) {
        const xBrakeEnd = xBody + (L2 + SL) * sc;
        drawLine(xBrakeEnd, cy - lcs/2, xBrakeEnd, cy + lcs/2, COLOR.hiddenLine, LINE.hidden);
    }
    ctx.setLineDash([]);

    // ── 라벨 (노란 스티커)
    const lblW = lcs * 0.65, lblH = L2*sc * 0.18;
    ctx.fillStyle = 'rgba(240,192,64,0.8)';
    ctx.fillRect(xBody + L2*sc*0.15, cy - lcs/2 + 2, lblW, lblH);

    // ── 커넥터 (위에서 본 평면도: 3D 인출부 + 소켓 + 핀)
    //    Top 뷰 좌표 매핑:
    //      3D Y축 (축방향) → 2D 화면 X축 (왼쪽=샤프트, 오른쪽=엔코더)
    //      3D X축 (모터 좌우) → 2D 화면 Y축 (위/아래)
    //      3D Z축 (수직, 높이) → Top 뷰에서는 보이지 않음 (위에서 내려다 보므로)
    //      ★ 인출부 (3D: encMidY + EnL*(-0.27), 뒤쪽) → 2D 화면 오른쪽
    //      ★ 소켓   (3D: encMidY + EnL*(+0.52), 앞쪽) → 2D 화면 왼쪽
    //    커넥터는 본체 한쪽 면(아래 = 화면 Y+)에 배치 (도면 관례)
    if (CW > 0 && CL > 0 && CH > 0) {
        const isSmallEnc = LC < 30;
        const encMidX = (xBody + L2*sc + xEnd) / 2;   // 엔코더 X 중심 (L2 이후 구간)
        const wE_px = (L1 - L2) * sc;                  // 엔코더 X 폭

        // ─── [1] 인출부 (오른쪽, 원형 부트 → 위에서 보면 원)
        const bossDia_mm = isSmallEnc
            ? Math.min(CH * 0.95, (L1 - L2) * 0.50)
            : Math.min(CH * 0.70, (L1 - L2) * 0.40);
        const bossY_mm_offset = isSmallEnc ? -0.22 : -0.27;
        const bossCenterX = encMidX - bossY_mm_offset * wE_px;
        const bossR_px = bossDia_mm * sc / 2;
        const bossCenterY = cy + lcs/2 + bossR_px + 4;  // 본체 아래쪽 4px 간격

        // 원 그리기 (위에서 본 원통 부트)
        ctx.beginPath();
        ctx.arc(bossCenterX, bossCenterY, bossR_px, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(25,25,25,0.95)';
        ctx.fill();
        ctx.strokeStyle = COLOR.outline;
        ctx.lineWidth = LINE.outline;
        ctx.stroke();

        // ─── [2] 소켓 (왼쪽, 사각 셸)
        const sockW_mm = isSmallEnc ? CW * 0.85 : CW * 1.00;    // Top 뷰 Y폭 (3D X축)
        const sockD_mm = isSmallEnc ? (L1 - L2) * 0.55 : (L1 - L2) * 0.95;   // Top 뷰 X폭 (3D Y축)
        const sockY_mm_offset = isSmallEnc ? 0.375 : 0.52;

        const sockCenterX = encMidX - sockY_mm_offset * wE_px;
        const sockD_px = sockD_mm * sc;
        const sockW_px = sockW_mm * sc;

        // 소켓 Y(Top 뷰 세로) 위치: 인출부와 같이 본체 아래쪽 → 중앙을 본체 아래 sockW_px/2 지점
        //   정확히는 본체 밖으로 튀어나온 부분 (인출부와 같은 쪽)
        const sockTopPxY = cy + lcs/2;
        const sockBotPxY = sockTopPxY + sockW_px;

        ctx.fillStyle = 'rgba(15,15,15,0.96)';
        ctx.fillRect(sockCenterX - sockD_px/2, sockTopPxY, sockD_px, sockW_px);
        drawLine(sockCenterX - sockD_px/2, sockTopPxY,
                 sockCenterX + sockD_px/2, sockTopPxY, COLOR.outline, LINE.outline);
        drawLine(sockCenterX - sockD_px/2, sockBotPxY,
                 sockCenterX + sockD_px/2, sockBotPxY, COLOR.outline, LINE.outline);
        drawLine(sockCenterX - sockD_px/2, sockTopPxY,
                 sockCenterX - sockD_px/2, sockBotPxY, COLOR.outline, LINE.outline);
        drawLine(sockCenterX + sockD_px/2, sockTopPxY,
                 sockCenterX + sockD_px/2, sockBotPxY, COLOR.outline, LINE.outline);

        // ─── [2-a] 소켓 개구부 + 핀 4개 (소켓 전면 = +Y 방향 = 2D 화면 왼쪽)
        const openD_mm = Math.min(1.8, sockD_mm * 0.4);
        const openD_px = openD_mm * sc;
        const openW_px = sockW_px * 0.8;
        const openLeftX = sockCenterX - sockD_px/2;
        const openTopY = (sockTopPxY + sockBotPxY - openW_px) / 2;

        // 개구부 (어두운 영역)
        ctx.fillStyle = 'rgba(5,5,5,0.98)';
        ctx.fillRect(openLeftX, openTopY, openD_px, openW_px);

        // 핀 4개 (화면상 Y축 따라 나란히, 왼쪽으로 튀어나감)
        const pinLen_mm = Math.min(1.6, sockD_mm * 0.35);
        const pinLen_px = pinLen_mm * sc;
        const pinDia_px = Math.min(0.7 * sc, sockW_px * 0.08);
        const pinCount = 4;
        const pinSpan = openW_px * 0.65;
        const pinStep = pinCount > 1 ? pinSpan / (pinCount - 1) : 0;
        const pinStartY = (sockTopPxY + sockBotPxY) / 2 - pinSpan / 2;

        ctx.fillStyle = 'rgba(210,160,60,0.95)';   // brassGold
        for (let i = 0; i < pinCount; i++) {
            const pinY = pinStartY + i * pinStep;
            ctx.fillRect(openLeftX - pinLen_px, pinY - pinDia_px/2,
                         pinLen_px, pinDia_px);
            drawLine(openLeftX - pinLen_px, pinY - pinDia_px/2,
                     openLeftX, pinY - pinDia_px/2, COLOR.outline, LINE.outline*0.6);
            drawLine(openLeftX - pinLen_px, pinY + pinDia_px/2,
                     openLeftX, pinY + pinDia_px/2, COLOR.outline, LINE.outline*0.6);
        }

        // ─── [3] 케이블 (Top 뷰에서는 3D의 +Z→-X 경로 중 -X 구간이 보임)
        //   3D: 인출부 상단에서 +Z로 올라가다가 -X로 꺾임 (모터 측면 방향)
        //   Top 뷰에서는 수직(+Z) 구간은 한 점으로, -X 구간만 선으로 보임
        //   -X 방향 = 3D X- = Top 뷰 화면상 Y- (위쪽)
        const cableDia_mm = Math.max(bossDia_mm * 0.7, 1.8);
        const cableLen2_mm = (L1 - L2) * 1.6;   // -X 수평 구간 길이 (3D와 동일 공식)
        const cableLen2_px = cableLen2_mm * sc;
        const cableDia_px = cableDia_mm * sc;

        // 케이블이 인출부 중심에서 위쪽(-X, Top 뷰 Y-)으로 뻗어나감
        const cableStartY = bossCenterY;
        const cableEndY = cableStartY - cableLen2_px;

        ctx.fillStyle = 'rgba(230,232,235,0.95)';
        ctx.fillRect(bossCenterX - cableDia_px/2, cableEndY, cableDia_px, cableLen2_px);
        drawLine(bossCenterX - cableDia_px/2, cableEndY,
                 bossCenterX - cableDia_px/2, cableStartY, COLOR.outline, LINE.outline*0.8);
        drawLine(bossCenterX + cableDia_px/2, cableEndY,
                 bossCenterX + cableDia_px/2, cableStartY, COLOR.outline, LINE.outline*0.8);

        // ─── [4] IX40 플러그 (케이블 끝, -X 방향)
        //   Top 뷰에서는 플러그가 -X(화면 Y-) 방향으로 붙음
        const plugScale = Math.max(cableDia_mm / 6.8, 0.75);
        const plugH_mm = 8.4;   // IX40 Width
        const plugL_mm = 22.9;  // IX40 Length
        const plugW_px = plugH_mm * plugScale * sc * 0.6;  // 화면 X 폭 (소폭)
        const plugL_px = plugL_mm * plugScale * sc * 0.6;  // 화면 Y 폭 (길이)

        const plugTopY = cableEndY - plugL_px;
        ctx.fillStyle = 'rgba(30,30,30,0.94)';
        ctx.fillRect(bossCenterX - plugW_px/2, plugTopY, plugW_px, plugL_px);
        drawLine(bossCenterX - plugW_px/2, plugTopY,
                 bossCenterX + plugW_px/2, plugTopY, COLOR.outline, LINE.outline*0.8);
        drawLine(bossCenterX - plugW_px/2, cableEndY,
                 bossCenterX + plugW_px/2, cableEndY, COLOR.outline, LINE.outline*0.8);
        drawLine(bossCenterX - plugW_px/2, plugTopY,
                 bossCenterX - plugW_px/2, cableEndY, COLOR.outline, LINE.outline*0.8);
        drawLine(bossCenterX + plugW_px/2, plugTopY,
                 bossCenterX + plugW_px/2, cableEndY, COLOR.outline, LINE.outline*0.8);
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
    drawCenterLineH(xLeft - 12, xEnd + 10, cy);
    drawCenterLineV(xFlg + les/2, cy - lbs/2 - 12, cy + lbs/2 + 12);

    if (showDimensions) {
        const off = 18;
        // ★ v50 3세션차: 라벨 자동 전환
        const LX_label = hasBrake ? 'LO'  : 'LX';
        const L2_label = hasBrake ? 'LO2' : 'L2';

        drawHDim(xLeft, xEnd, cy - Math.max(lcs/2, lbs/2) - 30, -off, LX_label, LX);
        drawVDim(cy - lcs/2, cy + lcs/2, xEnd + 8, off, 'LC', LC);
        drawHDim(xBody, xBody + L2*sc, cy + lcs/2 + (CW > 0 ? CW*sc + 8 : 5), off, L2_label, L2);
        // LR은 감속기가 있으면 G_LR로 표시
        if (hasGearhead && gearShaftTotal > 0.1) {
            drawHDim(xLeft, xLeft + gearShaftTotal * sc, cy - lbs/2 - 18, -off, 'G_LR', gearShaftTotal);
        } else {
            drawHDim(xLeft, xFlg, cy - lbs/2 - 18, -off, 'LR', LR);
        }
        if (CW > 0) drawVDim(cy + lcs/2, cy + lcs/2 + CW*sc, xBody + CL*sc*0.3, off+10, 'CW', CW);

        // SL 브레이크 길이
        if (hasBrake && SL > 0.5) {
            drawHDim(xBody + L2*sc, xBody + (L2 + SL) * sc, cy + lcs/2 + (CW > 0 ? CW*sc + 8 : 5) + 18, off + 10, 'SL', SL);
        }

        // G_LC 감속기 플랜지 폭
        if (hasGearhead && G_LC > 0.5) {
            drawVDim(cy - G_LC*sc/2, cy + G_LC*sc/2, xLeft + gearShaftTotal * sc + (pilot1Len + pilot2Len) * sc + G_LG*sc*0.5, -off - 10, 'G_LC', G_LC);
        }
    }
}


// ═══════════════════════════════════════════════
// ⑬-B STEPPER_MOTOR — 스테핑 모터 2D 도면 (3면도) — v50 3세션차 신규
// ═══════════════════════════════════════════════
/**
 *  NEMA 사각 프레임 + 짧은 샤프트 + 리드선 출구 구조.
 *  Servo보다 단순하게 — 본체는 단일 블록, 엔코더 없음, 리드선만.
 *
 *  정면도 : 사각 프레임 + 중앙 플랜지원 + 4개 마운팅홀
 *  측면도 : 샤프트 + 플랜지 + 본체(단일 블록) + 뒤쪽 리드선
 *  평면도 : 샤프트 + 본체 + 리드선 (위에서)
 */

function drawStepperMotor_Front(dims, W, H) {
    const LC = mVal(dims,'LC', 42);          // NEMA17 기본
    const LH = mVal(dims,'LH', LC);
    const S  = mVal(dims,'S',  LC*0.12);
    const PCD = mVal(dims,'PCD(LA)', LC*0.741);
    const LB  = mVal(dims,'LB',   LC*0.53);  // NEMA 보스 OD 기본 22mm/42mm
    const MHd = mVal(dims,'TL(LG)', LC*0.09) * 0.55;

    const ext = Math.max(LC, LH, LB) * 1.1;
    const sc = calcScale(ext, W, H, 0.60);
    const cx = W/2, cy = H/2;

    const lcs = LC*sc, lhs = LH*sc, lbs = LB*sc;
    const shDs = S*sc, PCDs = PCD*sc, MHds = MHd*sc;
    const rr = Math.min(lcs*0.04, 4);   // NEMA 모서리 라운드

    // 배경
    ctx.fillStyle = '#F8F9FA';
    ctx.fillRect(0, 0, W, H);

    // ── 사각 프레임 (NEMA 라운드 모서리)
    ctx.fillStyle = 'rgba(44,44,44,0.85)';
    const fx = cx - lcs/2, fy = cy - lhs/2;
    ctx.beginPath();
    ctx.moveTo(fx + rr, fy);
    ctx.lineTo(fx + lcs - rr, fy); ctx.quadraticCurveTo(fx + lcs, fy, fx + lcs, fy + rr);
    ctx.lineTo(fx + lcs, fy + lhs - rr); ctx.quadraticCurveTo(fx + lcs, fy + lhs, fx + lcs - rr, fy + lhs);
    ctx.lineTo(fx + rr, fy + lhs); ctx.quadraticCurveTo(fx, fy + lhs, fx, fy + lhs - rr);
    ctx.lineTo(fx, fy + rr); ctx.quadraticCurveTo(fx, fy, fx + rr, fy);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = COLOR.outline;
    ctx.lineWidth = LINE.outline;
    ctx.stroke();

    // ── 중앙 보스 (플랜지원) + PCD 원 + 샤프트 원
    ctx.fillStyle = 'rgba(168,176,187,0.9)';
    ctx.beginPath();
    ctx.arc(cx, cy, lbs/2, 0, Math.PI*2);
    ctx.fill();
    ctx.strokeStyle = COLOR.outline;
    ctx.lineWidth = LINE.outline;
    ctx.stroke();

    // PCD 점선 (빨강 중심선)
    ctx.setLineDash(DASH_CENTER);
    ctx.strokeStyle = COLOR.centerLine;
    ctx.lineWidth = LINE.center;
    ctx.beginPath();
    ctx.arc(cx, cy, PCDs/2, 0, Math.PI*2);
    ctx.stroke();
    ctx.setLineDash([]);

    // 샤프트 원
    ctx.fillStyle = 'rgba(220,224,230,0.6)';
    ctx.beginPath();
    ctx.arc(cx, cy, shDs/2, 0, Math.PI*2);
    ctx.fill();
    ctx.strokeStyle = COLOR.outline;
    ctx.lineWidth = LINE.outline;
    ctx.stroke();

    // ── 4개 마운팅 홀 (45° 위치)
    for (let i = 0; i < 4; i++) {
        const a = Math.PI/4 + (Math.PI/2) * i;
        const hx = cx + (PCDs/2) * Math.cos(a);
        const hy = cy + (PCDs/2) * Math.sin(a);
        ctx.fillStyle = '#0d0d0d';
        ctx.beginPath();
        ctx.arc(hx, hy, MHds/2, 0, Math.PI*2);
        ctx.fill();
        ctx.strokeStyle = COLOR.outline;
        ctx.lineWidth = LINE.hidden;
        ctx.stroke();
    }

    // 중심선 (수직/수평)
    drawCenterLineH(cx - lcs/2 - 12, cx + lcs/2 + 12, cy);
    drawCenterLineV(cx, cy - lhs/2 - 12, cy + lhs/2 + 12);

    if (showDimensions) {
        const off = 20;
        drawHDim(cx - lcs/2, cx + lcs/2, cy - lhs/2 - 22, -off, 'LC', LC);
        drawVDim(cy - lhs/2, cy + lhs/2, cx + lcs/2 + 12, off, 'LH', LH);
        drawVDim(cy - PCDs/2, cy + PCDs/2, cx - lcs/2 - 12, -off, 'PCD', PCD);
        drawHDim(cx - shDs/2, cx + shDs/2, cy + lhs/2 + 15, off + 5, 'ØS', S);
    }
}

function drawStepperMotor_Side(dims, W, H) {
    const LC = mVal(dims,'LC', 42);
    const LH = mVal(dims,'LH', LC);
    const LR = mVal(dims,'LR', LC*0.56);
    const S  = mVal(dims,'S',  LC*0.12);

    // 옵션 (Stepper도 Brake 지원)
    const mOpt = resolveMotorOpts(dims, currentMotorOptions, currentPartCode);
    const hasBrake = mOpt.hasBrake;

    const LO_raw = mVal(dims,'LO', 0);
    const LX_raw = mVal(dims,'LX', 0);
    const LX = hasBrake ? (LO_raw > 0 ? LO_raw : LX_raw || LC*1.2) : (LX_raw || LC*1.0);
    const L1_key = hasBrake ? 'LO1(LLO)' : 'L1(LL)';
    const L1 = mVal(dims, L1_key, LX - LR);
    const SL = hasBrake ? mVal(dims,'SL', LC*0.3) : 0;

    const MnL = mVal(dims,'MnL', LC*1.2);   // 리드선 길이
    const MWD = mVal(dims,'MWD', LC*0.08);  // 케이블 지름 (근사)

    const totalW = LR + L1 + MnL * 0.3;
    const sc = calcScale(Math.max(totalW, LH*1.5), W, H, 0.55);

    const marginL = 50;
    const xSh   = marginL;
    const xFlg  = xSh + LR*sc;
    const xBodyEnd = xFlg + L1*sc;     // 모터 뒤끝 (Brake 있을 때도 동일 — L1에 이미 포함)
    const cy    = H * 0.5;

    const lcs = LC*sc, lhs = LH*sc, shDs = S*sc;

    // 배경
    ctx.fillStyle = '#F8F9FA';
    ctx.fillRect(0, 0, W, H);

    // ── 샤프트
    ctx.fillStyle = 'rgba(200,210,215,0.95)';
    ctx.fillRect(xSh, cy - shDs/2, LR*sc, shDs);
    drawLine(xSh, cy - shDs/2, xFlg, cy - shDs/2, COLOR.outline, LINE.outline);
    drawLine(xSh, cy + shDs/2, xFlg, cy + shDs/2, COLOR.outline, LINE.outline);
    drawLine(xSh, cy - shDs/2, xSh, cy + shDs/2, COLOR.outline, LINE.outline);

    // ── 본체 (단일 블록, NEMA 사각)
    //   Brake 있을 때는 뒤쪽 SL 부분 색을 다르게
    const bodyLen = hasBrake ? (L1 - SL) : L1;
    ctx.fillStyle = 'rgba(44,44,44,0.90)';
    ctx.fillRect(xFlg, cy - lcs/2, bodyLen * sc, lcs);
    drawLine(xFlg, cy - lcs/2, xFlg + bodyLen * sc, cy - lcs/2, COLOR.outline, LINE.outline);
    drawLine(xFlg, cy + lcs/2, xFlg + bodyLen * sc, cy + lcs/2, COLOR.outline, LINE.outline);
    drawLine(xFlg, cy - lcs/2, xFlg, cy + lcs/2, COLOR.outline, LINE.outline);

    // Brake 구간 (hasBrake일 때만)
    if (hasBrake && SL > 0.01) {
        const xBrake = xFlg + bodyLen * sc;
        ctx.fillStyle = 'rgba(68,70,76,0.92)';
        ctx.fillRect(xBrake, cy - lcs/2, SL * sc, lcs);
        drawLine(xBrake, cy - lcs/2, xBrake + SL * sc, cy - lcs/2, COLOR.outline, LINE.outline);
        drawLine(xBrake, cy + lcs/2, xBrake + SL * sc, cy + lcs/2, COLOR.outline, LINE.outline);
        drawLine(xBrake, cy - lcs/2, xBrake, cy + lcs/2, COLOR.hiddenLine, LINE.hidden);   // 경계 점선
    }

    // 본체 뒤끝
    drawLine(xBodyEnd, cy - lcs/2, xBodyEnd, cy + lcs/2, COLOR.outline, LINE.outline);

    // ── 리드선 (뒤쪽 중앙에서 아래로)
    if (MnL > 0.5 && MWD > 0.1) {
        const cableD = MWD * sc;
        const c0x = xBodyEnd;
        const c0y = cy;
        // 수평 구간 (뒤로 약간)
        const cHoriz = MnL * 0.3 * sc;
        ctx.fillStyle = 'rgba(35,35,35,0.9)';
        ctx.fillRect(c0x, c0y - cableD/2, cHoriz, cableD);
        drawLine(c0x, c0y - cableD/2, c0x + cHoriz, c0y - cableD/2, COLOR.outline, LINE.outline);
        drawLine(c0x, c0y + cableD/2, c0x + cHoriz, c0y + cableD/2, COLOR.outline, LINE.outline);
        // 수직 구간 (아래로)
        const cVert = MnL * 0.7 * sc;
        const c1x = c0x + cHoriz;
        ctx.fillRect(c1x - cableD/2, c0y, cableD, cVert);
        drawLine(c1x - cableD/2, c0y, c1x - cableD/2, c0y + cVert, COLOR.outline, LINE.outline);
        drawLine(c1x + cableD/2, c0y, c1x + cableD/2, c0y + cVert, COLOR.outline, LINE.outline);
        drawLine(c1x - cableD/2, c0y + cVert, c1x + cableD/2, c0y + cVert, COLOR.outline, LINE.outline);
    }

    // 중심선
    drawCenterLineH(xSh - 12, xBodyEnd + 10, cy);

    if (showDimensions) {
        const off = 18;
        const LX_label = hasBrake ? 'LO'  : 'LX';
        const L1_label = hasBrake ? 'LO1' : 'L1';

        drawHDim(xSh, xBodyEnd, cy - lcs/2 - 30, -off, LX_label, LX);
        drawHDim(xSh, xFlg, cy - lcs/2 - 10, -off, 'LR', LR);
        drawHDim(xFlg, xBodyEnd, cy + lcs/2 + 5, off + 5, L1_label, L1);
        drawVDim(cy - lcs/2, cy + lcs/2, xBodyEnd + 10, off, 'LC', LC);
        drawVDim(cy - shDs/2, cy + shDs/2, xSh - 8, -off, 'S', S);

        if (hasBrake && SL > 0.5) {
            drawHDim(xFlg + (L1 - SL) * sc, xBodyEnd, cy - lcs/2 - 10, -(off + 20), 'SL', SL);
        }
    }
}

function drawStepperMotor_Top(dims, W, H) {
    // 평면도는 측면도와 동일한 실루엣 (Y축 대신 Z축 높이 차이만)
    // 간단하게 Side 재사용 — Stepper는 대칭성이 높아 Front/Side/Top 차이가 크지 않음
    drawStepperMotor_Side(dims, W, H);
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
                // ★ 치수 참조 패널용 매핑 수신 (C# 이 GetDimensionDisplayNames + fallback 보강 결과 전달)
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
                // ★ v50 3세션차: 모터 옵션 수신 (SpecSelectorResponse.Options → JSON)
                const motorOpts = msg.options || {};
                const optLog = Object.keys(motorOpts).length > 0
                    ? ' opts={' + Object.entries(motorOpts).map(([k,v]) => k+'='+v).join(',') + '}'
                    : '';
                logToCSharp('2D updateModel: ' + msg.partCode + ' | view=' + (msg.viewType || currentViewType) +
                            ' linked=' + linked.length + optLog);
                updateModel(msg.partCode, dims, linked, msg.viewType || currentViewType, motorOpts);
                break;
            }
            case 'setView':
                currentViewType = msg.view || 'Front2D';
                redraw();
                break;
            case 'setOption':
                if (msg.option === 'dimensions') {
                    showDimensions = msg.value;
                    redraw();
                } else if (msg.option === 'dimPanel') {
                    // ★ 치수 참조 패널 토글 — 재작도 없이 패널 가시성만 변경
                    showDimPanel = msg.value;
                    updateDimPanel();
                } else {
                    redraw();
                }
                break;
            case 'updateDimMeta': {
                // ★ 이미 로드된 모델에 치수명 매핑만 업데이트 (재작도 없이 패널 갱신)
                if (msg.dimMeta && typeof msg.dimMeta === 'object') {
                    applyDimMetaPayload(msg.dimMeta);
                } else {
                    currentDimMeta = {};
                }
                // 치수명이 바뀌면 drawHDim 이 수집하는 displayName 도 달라지므로 재작도 필요
                redraw();
                break;
            }
            case 'resetDimPanel': {
                // ★ 탭 전환 등에서 외부가 패널을 강제 초기화
                resetDimPanel();
                break;
            }
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
