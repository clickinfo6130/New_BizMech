/**
 * @file NewCreateShaftClass.cpp
 * @brief Shaft (축) 작도 시스템 - 구현
 * @note BearingCreator 와 동일한 코드 구조 패턴 적용
 *       직선축 / 단차축 / 중공축 / 테이퍼축 / 스플라인축 / 플랜지축
 *       키홈 / 평면취 / 멈춤링 홈 / 수나사 / 로크너트 / 센터구멍 등
 */
#include "stdafx.h"
#include "NewCreateShaftClass.h"
#include <memory>
#include <cmath>

//=============================================================================
// CreateShaft - Entry Point (BearingCreator::CreateBearing 에 대응)
//=============================================================================

#if defined(SDWORKS)
sdWrk::IComponent2Ptr ShaftCreator::CreateShaft(
    std::map<std::string, std::string>& pDim,
    ShaftPartData& pd, double munit,
    const ShaftOptions& options, CiAssembly* pTargetAssembly, CiPart* outShaftPart, CiOccurrence* outShaftOcc)
#elif defined(ZW3D)
CiDragComponent ShaftCreator::CreateShaft(
    std::map<std::string, std::string>& pDim,
    ShaftPartData& pd, double munit,
    const ShaftOptions& options, CiAssembly* pTargetAssembly, CiPart* outShaftPart, CiOccurrence* outShaftOcc)
#else
acInv::ComponentDefinitionPtr ShaftCreator::CreateShaft(
    std::map<std::string, std::string>& pDim,
    ShaftPartData& pd, double munit,
    const ShaftOptions& options, CiAssembly* pTargetAssembly, CiPart* outShaftPart, CiOccurrence* outShaftOcc)
#endif
{
    // 단위 스케일 설정
    if      (munit == 0.1)  m_unit = 10.0;
    else if (munit == 0.01) m_unit = 100.0;
    else                    m_unit = munit;

    m_partData = &pd;
    m_options  = options;

    // 파생 치수 캐시 계산
    // retRing_Radius : DB에 있는 경우 사용, 없으면 20mm 기본값
    m_shaftDia = (m_partData->Dim.retRing_Radius > 0)
               ? m_partData->Dim.retRing_Radius * 2.0
               : 20.0 / m_unit;

    m_keyWidth = (m_partData->Dim.pKey_Width > 0)
               ? m_partData->Dim.pKey_Width
               : m_shaftDia * ShaftConstants::KEY_WIDTH_RATIO;

    m_keyDepth = (m_partData->Dim.pKey_Depth1 > 0)
               ? m_partData->Dim.pKey_Depth1
               : m_shaftDia * ShaftConstants::KEY_DEPTH_RATIO;

    // 타입 자동 감지 (PartName 기반)
    SetShaftBodyType();
    SetShaftMaterial();
    SetShaftEndOptions();

    // 파트 코드 생성
    ATL::CString partCode;
    partCode.Format(_T("%s_d%s_L%s"),
        m_partData->Info.PartCode,
        FormatDouble(m_shaftDia * m_unit),
        FormatDouble(m_shaftLen * m_unit));

    // ==========================================================
        // ★ CAD 문서 / 어셈블리 초기화 (선언과 동시에 즉시 할당!)
        // ==========================================================
    bool isStandalone = (pTargetAssembly == nullptr); // 단독 모드 여부 판별

    if (isStandalone) {
        // 단독 모드일 경우에만 문서 편집기 어플리케이션 초기화
        CiDocument::InitApplication(m_pApplication);
    }

    // ★ 삼항 연산자를 사용하여 선언과 동시에 완벽하게 초기화 (기본 생성자 에러 해결)
    CiAssembly NewComponent = isStandalone ? CiDocument::GetDocumentEdit().CreateAssembly(partCode) : *pTargetAssembly;

    // 1. 치수 초기화
    Initialize(pDim);

    // 2. 축 본체 생성
    ATL::CString nameShaft = partCode + _T("_Shaft");
    CiPart pShaftPart = NewComponent.CreatePart(nameShaft);

    // 순차적 가공 실행 (모듈화)
    CreateShaftBody(&pShaftPart);
    Apply_InnerDRingGroove(&pShaftPart);
    Apply_OuterFix_SnapRing(&pShaftPart);
    Apply_OuterFix_MaleThread(&pShaftPart);
    Apply_Keyway(&pShaftPart);
    Apply_WrenchFlat(&pShaftPart);
    Apply_CenterHole(&pShaftPart);
    Apply_FemaleThread(&pShaftPart);
    Apply_Slitting(&pShaftPart);
    Apply_SlitCam(&pShaftPart);

    CiOccurrence occShaft = NewComponent.Insert(pShaftPart);

    // ==========================================================
    // ★ 외부(베어링 메인함수)에서 메이트를 할 수 있도록 결과물을 포인터에 담아줌
    // ==========================================================
    if (outShaftPart) *outShaftPart = pShaftPart;
    if (outShaftOcc)  *outShaftOcc = occShaft;

    // 3. 부자재(멈춤링/로크너트) 파트 어셈블리 조립
    ATL::CString xAxisName = _T("Mate-X-Axis"); // 축도 이 이름으로 생성됨
    const ShaftOptions& shaftOpts = m_options;

    // 안쪽 멈춤링 조립
    if (shaftOpts.innerSupport == ShaftInnerSupportType::DRingGroove) {
        ATL::CString nameInnerRing = partCode + _T("_InnerSnapRing");
        CiPart pInnerRingPart = NewComponent.CreatePart(nameInnerRing);
        Create_Accessory_SnapRing(&pInnerRingPart, _T("Mate-InnerSnapRing-YZ"), m_val_d, false);
        CiOccurrence occInnerRing = NewComponent.Insert(pInnerRingPart);

        if (occShaft.isValid() && occInnerRing.isValid()) {
            NewComponent.MateManager.AddCoincidentByName(pInnerRingPart, occInnerRing, pShaftPart, occShaft, xAxisName, false);
            // ★ 고유 이름으로 메이트
            NewComponent.MateManager.AddCoincidentByName(pInnerRingPart, occInnerRing, pShaftPart, occShaft, _T("Mate-InnerSnapRing-YZ"), false);
        }
    }

    // 바깥쪽 부자재 조립
    if (shaftOpts.isFixedSide) {

        // ★ 일반 멈춤링(SnapRing)이거나 단부 멈춤링(EndSnapRing)일 경우 모두 적용
        if (shaftOpts.outerFix == ShaftOuterFixType::SnapRing ||
            shaftOpts.outerFixingComponent == ShaftOuterFixingCompType::EndSnapRing) {

            ATL::CString nameOuterRing = partCode + _T("_OuterSnapRing");
            CiPart pOuterRingPart = NewComponent.CreatePart(nameOuterRing);
            // ★ 수나사 단부 멈춤링일 경우 true, 일반 멈춤링일 경우 false!
            bool isEndRing = (shaftOpts.outerFixingComponent == ShaftOuterFixingCompType::EndSnapRing);
            double targetDia = isEndRing ? m_val_threadOuterDia : m_val_d;

            Create_Accessory_SnapRing(&pOuterRingPart, _T("Mate-EndSnapRing-YZ"), targetDia, isEndRing);
            CiOccurrence occOuterRing = NewComponent.Insert(pOuterRingPart);

            if (occShaft.isValid() && occOuterRing.isValid()) {
                NewComponent.MateManager.AddCoincidentByName(pOuterRingPart, occOuterRing, pShaftPart, occShaft, xAxisName, false);
                // ★ 통일된 고유 이름으로 완벽하게 메이트 결합!
                NewComponent.MateManager.AddCoincidentByName(pOuterRingPart, occOuterRing, pShaftPart, occShaft, _T("Mate-EndSnapRing-YZ"), false);
            }
        }
        else if (shaftOpts.outerFixingComponent == ShaftOuterFixingCompType::Locknut) {
            ATL::CString nameLocknut = partCode + _T("_Locknut");
            CiPart pLocknutPart = NewComponent.CreatePart(nameLocknut);
            Create_Accessory_Locknut(&pLocknutPart);
            CiOccurrence occLocknut = NewComponent.Insert(pLocknutPart);

            if (occShaft.isValid() && occLocknut.isValid()) {
                NewComponent.MateManager.AddCoincidentByName(pLocknutPart, occLocknut, pShaftPart, occShaft, xAxisName, false);
                NewComponent.MateManager.AddCoincidentByName(pLocknutPart, occLocknut, pShaftPart, occShaft, _T("Mate-Locknut-YZ"), false);
            }
        }
    }

    // 5. 재질 적용
    ApplyMaterial(&pShaftPart);

    if (isStandalone) {
#ifdef ZW3D
        NewComponent.FlushBomInfo();
#endif
        return NewComponent.GetDragDef();
    }
    else {
#if defined(SDWORKS)
        return nullptr;
#elif defined(ZW3D)
        return CiDragComponent();
#else
        return nullptr;
#endif
    }
}

//=============================================================================
// [2] 문자열 치수를 Double로 파싱하여 전역 캐싱 (Initialize)
//=============================================================================
HRESULT ShaftCreator::Initialize(std::map<std::string, std::string>& pDim)
{
    const ShaftOptions& opt = m_options;

    // 1. 기본 축 치수 파싱
    m_val_d = _wtof(m_partData->Info.Shaft_Diameter) / m_unit;
    m_val_L = _wtof(m_partData->Info.Shaft_Length) / m_unit;
    if (m_val_d <= 0.0) m_val_d = 20.0 / m_unit;
    if (m_val_L <= 0.0) m_val_L = 100.0 / m_unit;

    m_radius = m_val_d / 2.0;
    m_chamfer_X = opt.hasOilSeal ? (2.0 / m_unit) : 0.0;
    m_chamfer_Y = opt.hasOilSeal ? (m_chamfer_X * tan(30.0 * 3.14159265 / 180.0)) : 0.0;

    // 2. 수나사 정보 파싱 (★ x 피치 포함 여부 로직 추가)
    m_hasMaleThread = (opt.isFixedSide && (opt.outerFix == ShaftOuterFixType::MaleThread || opt.outerFixingComponent == ShaftOuterFixingCompType::Locknut));
    m_val_threadLength = _wtof(m_partData->Info.ThreadLength) / m_unit;
    m_val_threadEffectiveLength = _wtof(m_partData->Info.ThreadEffectiveLength) / m_unit;

    m_strThreadInfo = m_partData->Info.ThreadOuterDia;
    m_val_threadOuterDia = _wtof(m_strThreadInfo) / m_unit;
    if (m_val_threadOuterDia <= 0.0 && m_strThreadInfo.GetLength() > 1) {
        m_val_threadOuterDia = _wtof(m_strThreadInfo.Mid(1)) / m_unit;
    }

    if (m_val_threadLength <= 0.0) m_val_threadLength = m_val_d * 1.5;
    if (m_val_threadEffectiveLength <= 0.0) m_val_threadEffectiveLength = m_val_threadLength;
    if (m_val_threadOuterDia <= 0.0) m_val_threadOuterDia = m_val_d; // 값 없을 시 축경 따라감
    m_thread_Radius = m_val_threadOuterDia / 2.0;
    m_base_L = m_hasMaleThread ? (m_val_L - m_val_threadLength) : m_val_L;

    // ★ 수나사 문자열 포맷팅
    if (m_strThreadInfo.IsEmpty()) {
        m_strThreadInfo.Format(_T("M%d"), (int)(m_val_threadOuterDia * m_unit));
    }
    else if (m_strThreadInfo.Find(_T("x")) >= 0 || m_strThreadInfo.Find(_T("X")) >= 0) {
        // "M16x1.5" 등 피치가 포함된 정확한 치수가 들어오면 원본 그대로 사용 (Pass)
    }
    else if (m_val_threadOuterDia > 0.0 && m_strThreadInfo.Find(_T("M")) < 0 && m_strThreadInfo.Find(_T("m")) < 0) {
        // "16" 처럼 숫자만 있을 경우 "M"을 붙여줌
        m_strThreadInfo.Format(_T("M%d"), (int)(m_val_threadOuterDia * m_unit));
    }


    // 3. 멈춤링 및 안쪽 지지부 파싱
    m_innerSupportX = _wtof(m_partData->Info.InnerSupportX) / m_unit;
    if (m_innerSupportX <= 0.0) m_innerSupportX = m_val_L * 0.3;
    if (m_innerSupportX >= m_base_L) m_innerSupportX = m_base_L * 0.3;

    m_val_ring_offset1 = m_innerSupportX;
    m_val_ring_offset2 = _wtof(m_partData->Info.RingOffset2) / m_unit;
    if (m_val_ring_offset2 <= 0.0) m_val_ring_offset2 = m_val_d * 0.5;

    // ==========================================================
    // ★ 3-1) 축 본체용 멈춤링 파싱 (retRing_...)
    // ==========================================================
    m_val_dRing_Width = m_partData->Dim.retRing_Width;
    m_val_dRing_Radius = m_partData->Dim.retRing_Radius;
    m_val_dRing_Thickness = m_partData->Dim.retRing_Thickness;
    m_val_dRing_FreeID = m_partData->Dim.retRing_FreeID;
    m_val_dRing_MaxWidth = m_partData->Dim.retRing_MaxWidth;
    m_val_dRing_EndWidth = m_partData->Dim.retRing_EndWidth;
    m_val_dRing_HoleDia = m_partData->Dim.retRing_HoleDia;

    if (m_val_dRing_Width <= 0.0)  m_val_dRing_Width = 1.15 / m_unit;
    if (m_val_dRing_Radius <= 0.0) m_val_dRing_Radius = m_radius - (1.0 / m_unit);

    // ==========================================================
    // ★ 3-2) 수나사 단부용 멈춤링 파싱 (endRing_... 구조체 변수 추가 가정)
    // ==========================================================
    m_val_endRing_Width = m_partData->Dim.endRing_Width;
    m_val_endRing_Radius = m_partData->Dim.endRing_Radius;
    m_val_endRing_Thickness = m_partData->Dim.endRing_Thickness;
    m_val_endRing_FreeID = m_partData->Dim.endRing_FreeID;
    m_val_endRing_MaxWidth = m_partData->Dim.endRing_MaxWidth;
    m_val_endRing_EndWidth = m_partData->Dim.endRing_EndWidth;
    m_val_endRing_HoleDia = m_partData->Dim.endRing_HoleDia;

    if (m_val_endRing_Width <= 0.0)  m_val_endRing_Width = 1.15 / m_unit;
    if (m_val_endRing_Radius <= 0.0) m_val_endRing_Radius = m_thread_Radius - (1.0 / m_unit);

    // 4. 평행키 & 반달키 파싱
    m_val_pKey_Width = m_partData->Dim.pKey_Width;
    m_val_pKey_Depth = m_partData->Dim.pKey_Depth;
    m_val_pKey_Length = _wtof(m_partData->Info.PKeyLength1) / m_unit;
    m_val_pKey_Length2 = _wtof(m_partData->Info.PKeyLength2) / m_unit;
    m_val_pKey_offset1 = _wtof(m_partData->Info.PKeyOffset1) / m_unit;
    m_val_pKey_offset2 = _wtof(m_partData->Info.PKeyOffset2) / m_unit;
    if (m_val_pKey_Width <= 0.0) m_val_pKey_Width = m_val_d * 0.25;
    if (m_val_pKey_Depth <= 0.0) m_val_pKey_Depth = m_val_d * 0.15;
    if (m_val_pKey_Length <= 0.0) m_val_pKey_Length = m_val_d * 1.5;
    if (m_val_pKey_Length2 <= 0.0) m_val_pKey_Length2 = m_val_pKey_Length;
    if (m_val_pKey_offset1 <= 0.0) m_val_pKey_offset1 = m_val_d * 1.0;
    if (m_val_pKey_offset2 <= 0.0) m_val_pKey_offset2 = m_val_d * 1.5;

    m_val_wKey_Radius = m_partData->Dim.wKey_Radius;
    m_val_wKey_Width = m_partData->Dim.wKey_Width;
    m_val_wKey_Depth = m_partData->Dim.wKey_Depth;
    if (m_val_wKey_Radius <= 0.0) m_val_wKey_Radius = m_val_d * 0.4;
    if (m_val_wKey_Width <= 0.0)  m_val_wKey_Width = m_val_d * 0.25;
    if (m_val_wKey_Depth <= 0.0)  m_val_wKey_Depth = m_val_d * 0.15;

    // 5. 평면취 파싱
    m_val_wFlat_Depth = m_partData->Dim.wFlat_Depth;
    m_val_wFlat_Length = _wtof(m_partData->Info.WFlatLength1) / m_unit;
    m_val_wFlat_Length2 = _wtof(m_partData->Info.WFlatLength2) / m_unit;
    m_val_wFlat_offset1 = _wtof(m_partData->Info.WFlatOffset1) / m_unit;
    m_val_wFlat_offset2 = _wtof(m_partData->Info.WFlatOffset2) / m_unit;
    m_val_wFlat_Angle = _wtof(m_partData->Info.WrenchFlatAngle);
    if (m_val_wFlat_Angle <= 0.0) m_val_wFlat_Angle = 90.0;
    if (m_val_wFlat_Depth <= 0.0) m_val_wFlat_Depth = m_val_d * 0.1;
    m_val_wFlat_HalfWidth = m_radius - m_val_wFlat_Depth;
    if (m_val_wFlat_Length <= 0.0) m_val_wFlat_Length = m_val_d * 0.8;
    if (m_val_wFlat_Length2 <= 0.0) m_val_wFlat_Length2 = m_val_wFlat_Length;
    if (m_val_wFlat_offset1 <= 0.0) m_val_wFlat_offset1 = m_val_d * 1.5;
    if (m_val_wFlat_offset2 <= 0.0) m_val_wFlat_offset2 = m_val_d * 3.0;

    // 6. 끝단 추가 가공
    m_val_sCam_offset2 = _wtof(m_partData->Info.SCamOffset2) / m_unit;
    if (m_val_sCam_offset2 <= 0.0) m_val_sCam_offset2 = m_val_d * 4.0;
    m_val_slit_Width = m_partData->Dim.slit_Width;
    m_val_slit_Depth = m_partData->Dim.slit_Depth;
    if (m_val_slit_Width <= 0.0) m_val_slit_Width = 2.0 / m_unit;
    if (m_val_slit_Depth <= 0.0) m_val_slit_Depth = 2.5 / m_unit;
    m_val_sCam_Radius = m_partData->Dim.sCam_Radius;
    m_val_sCam_Width = m_partData->Dim.sCam_Width;
    if (m_val_sCam_Radius <= 0.0) m_val_sCam_Radius = m_radius - (1.0 / m_unit);
    if (m_val_sCam_Width <= 0.0)  m_val_sCam_Width = 3.0 / m_unit;

    m_val_ch_Radius = m_partData->Dim.ch_Radius;
    m_val_ch_Depth = m_partData->Dim.ch_Depth;
    if (m_val_ch_Radius <= 0.0 || m_val_ch_Depth <= 0.0) {
        double shaft_dia_mm = m_val_d * m_unit;
        if (m_val_ch_Radius <= 0.0) m_val_ch_Radius = (0.53 * sqrt(shaft_dia_mm)) / m_unit;
        if (m_val_ch_Depth <= 0.0)  m_val_ch_Depth = (0.44 * sqrt(shaft_dia_mm)) / m_unit;
    }

    // ★ 암나사 문자열 포맷팅 (x 피치 포함 여부 확인)
    m_strFemaleThreadInfo = m_partData->Info.FemaleThreadName;
    m_val_femaleThreadDia = _wtof(m_strFemaleThreadInfo);
    if (m_val_femaleThreadDia <= 0.0 && m_strFemaleThreadInfo.GetLength() > 1) {
        m_val_femaleThreadDia = _wtof(m_strFemaleThreadInfo.Mid(1));
    }

    if (m_strFemaleThreadInfo.IsEmpty()) {
        if (m_val_femaleThreadDia <= 0.0) m_val_femaleThreadDia = m_val_d * 0.5;
        m_strFemaleThreadInfo.Format(_T("M%d"), (int)(m_val_femaleThreadDia * m_unit));
    }
    else if (m_strFemaleThreadInfo.Find(_T("x")) >= 0 || m_strFemaleThreadInfo.Find(_T("X")) >= 0) {
        // "M10x1.0" 등 피치가 포함된 정확한 치수가 들어오면 원본 그대로 사용 (Pass)
    }
    else if (m_val_femaleThreadDia > 0.0 && m_strFemaleThreadInfo.Find(_T("M")) < 0 && m_strFemaleThreadInfo.Find(_T("m")) < 0) {
        // "10" 처럼 숫자만 있을 경우 "M"을 붙여줌
        m_strFemaleThreadInfo.Format(_T("M%d"), (int)(m_val_femaleThreadDia * m_unit));
    }

    m_val_femaleThreadDepth = m_val_femaleThreadDia * 2.0;

    return S_OK;
}

//=============================================================================
// CreateShaftBody - 형상 타입별 분기
//=============================================================================
HRESULT ShaftCreator::CreateShaftBody(CiPart* pPart)
{
    //switch (m_options.bodyType)
    //{
    //case ShaftBodyType::Straight: return CreateStraightShaft(pPart);
    //case ShaftBodyType::Stepped:  return CreateSteppedShaft(pPart);
    //case ShaftBodyType::Hollow:   return CreateHollowShaft(pPart);
    //case ShaftBodyType::Tapered:  return CreateTaperedShaft(pPart);
    //case ShaftBodyType::Splined:  return CreateSplinedShaft(pPart);
    //case ShaftBodyType::Flanged:  return CreateFlangedShaft(pPart);
    //default:                      return CreateStraightShaft(pPart);
    //}
    if (m_options.innerSupport == ShaftInnerSupportType::Step) {
        return CreateSteppedShaft(pPart);
    }
    else {
        return CreateStraightShaft(pPart);
    }
}

//=============================================================================
// [축 본체] 1. 직선축 (Straight Shaft)
//=============================================================================
HRESULT ShaftCreator::CreateStraightShaft(CiPart* pPart)
{
    CiWorkPlane xyPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XY);
    pPart->SketchManager.StartSketch(xyPlane);

    CiSketchPoint p0 = pPart->SketchManager.SetSketchPoint(0.0, 0.0);
    CiSketchPoint p_corner;

    if (m_options.hasOilSeal) { // 플래그 직접 참조
        CiSketchPoint p1 = pPart->SketchManager.SetSketchPoint(0.0, m_radius - m_chamfer_Y);
        CiSketchPoint p2 = pPart->SketchManager.SetSketchPoint(m_chamfer_X, m_radius);
        pPart->SketchManager.CreateSketchLine(p0, p1);
        pPart->SketchManager.CreateSketchLine(p1, p2);
        p_corner = p2;
    }
    else {
        CiSketchPoint p1 = pPart->SketchManager.SetSketchPoint(0.0, m_radius);
        pPart->SketchManager.CreateSketchLine(p0, p1);
        p_corner = p1;
    }

    CiSketchPoint p3 = pPart->SketchManager.SetSketchPoint(m_innerSupportX, m_radius);
    CiSketchPoint p5 = pPart->SketchManager.SetSketchPoint(m_base_L, m_radius);
    CiSketchPoint p6 = pPart->SketchManager.SetSketchPoint(m_base_L, 0.0);

    pPart->SketchManager.CreateSketchLine(p_corner, p3);
    pPart->SketchManager.CreateSketchLine(p3, p5);
    pPart->SketchManager.CreateSketchLine(p5, p6);

    CiSketchLine revAxis = pPart->SketchManager.CreateSketchLine(p6, p0);
    pPart->SetSolidProfile();
    pPart->FeatureManager.CreateRevolve(revAxis, CiJoinOpEnum::Join, 360.0, CiDirectionOpEnum::Positive, _T("Shaft_Base_Straight"));

    // ==========================================================
    // ★ 축 기본 메이트 참조 등록 (원점 기준)
    // ==========================================================
    CiWorkPlane matePlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, 0.0, _T("Mate-YZ-Plane"));
    pPart->WGManager.AddMateRef(matePlane);
    CiPoint originPos(0.0, 0.0, 0.0);
    CiWorkAxis mateAxis = pPart->WGManager.CreateWorkAxis(CiBaseDirectionEnum::X, originPos, _T("Mate-X-Axis"));
    pPart->WGManager.AddMateRef(mateAxis);

    // ==========================================================
    // ★ 베어링 조립용 Offset 메이트 참조 등록 추가
    // ==========================================================
    double val_offsetLength = _wtof(m_partData->Info.Offset_Length) / m_unit;
    CiWorkPlane offsetMatePlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, val_offsetLength, _T("Mate-Offset-YZ"));
    pPart->WGManager.AddMateRef(offsetMatePlane);

    // ==========================================================
    // ★ 오일씰(Oil Seal) 조립용 메이트 참조 등록 (수식 적용)
    // 공식: Offset_Length + 베어링 폭(복열 계산됨) + OilSealOffset
    // ==========================================================
    double val_bearingWidth = m_options.referenceBearingWidth; // 옵션에서 배달받은 폭
    double val_oilSealOffset = _wtof(m_partData->Info.OilSealOffset) / m_unit; // 축 DB에서 오일씰 여유간격 파싱

    double oilSealMateX = val_offsetLength + val_bearingWidth + val_oilSealOffset;

    CiWorkPlane oilSealMatePlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, oilSealMateX, _T("Mate-OilSeal-YZ"));
    pPart->WGManager.AddMateRef(oilSealMatePlane);

    return S_OK;
}

//=============================================================================
// [축 본체] 2. 단차축 (Stepped Shaft)
//=============================================================================
HRESULT ShaftCreator::CreateSteppedShaft(CiPart* pPart)
{
    double stepRadius = m_radius * 1.25;

    CiWorkPlane xyPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XY);
    pPart->SketchManager.StartSketch(xyPlane);

    CiSketchPoint p0 = pPart->SketchManager.SetSketchPoint(0.0, 0.0);
    CiSketchPoint p_corner;

    if (m_options.hasOilSeal) { // 플래그 직접 참조
        CiSketchPoint p1 = pPart->SketchManager.SetSketchPoint(0.0, m_radius - m_chamfer_Y);
        CiSketchPoint p2 = pPart->SketchManager.SetSketchPoint(m_chamfer_X, m_radius);
        pPart->SketchManager.CreateSketchLine(p0, p1);
        pPart->SketchManager.CreateSketchLine(p1, p2);
        p_corner = p2;
    }
    else {
        CiSketchPoint p1 = pPart->SketchManager.SetSketchPoint(0.0, m_radius);
        pPart->SketchManager.CreateSketchLine(p0, p1);
        p_corner = p1;
    }

    // 연삭 틈새 (Undercut)
    double uc_W = 2.0 / m_unit;
    double uc_D = 0.3 / m_unit;

    CiSketchPoint p3_start = pPart->SketchManager.SetSketchPoint(m_innerSupportX - uc_W, m_radius);
    CiSketchPoint p3_bot1 = pPart->SketchManager.SetSketchPoint(m_innerSupportX - uc_W * 0.5, m_radius - uc_D);
    CiSketchPoint p3_bot2 = pPart->SketchManager.SetSketchPoint(m_innerSupportX, m_radius - uc_D);
    CiSketchPoint p4 = pPart->SketchManager.SetSketchPoint(m_innerSupportX, stepRadius);
    CiSketchPoint p5 = pPart->SketchManager.SetSketchPoint(m_base_L, stepRadius);
    CiSketchPoint p6 = pPart->SketchManager.SetSketchPoint(m_base_L, 0.0);

    pPart->SketchManager.CreateSketchLine(p_corner, p3_start);
    pPart->SketchManager.CreateSketchLine(p3_start, p3_bot1);
    pPart->SketchManager.CreateSketchLine(p3_bot1, p3_bot2);
    pPart->SketchManager.CreateSketchLine(p3_bot2, p4);
    pPart->SketchManager.CreateSketchLine(p4, p5);
    pPart->SketchManager.CreateSketchLine(p5, p6);

    CiSketchLine revAxis = pPart->SketchManager.CreateSketchLine(p6, p0);
    pPart->SetSolidProfile();
    pPart->FeatureManager.CreateRevolve(revAxis, CiJoinOpEnum::Join, 360.0, CiDirectionOpEnum::Positive, _T("Shaft_Base_With_Step"));

    // ==========================================================
    // ★ 축 기본 메이트 참조 등록 (원점 기준)
    // ==========================================================
    CiWorkPlane matePlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, 0.0, _T("Mate-YZ-Plane"));
    pPart->WGManager.AddMateRef(matePlane);
    CiPoint originPos(0.0, 0.0, 0.0);
    CiWorkAxis mateAxis = pPart->WGManager.CreateWorkAxis(CiBaseDirectionEnum::X, originPos, _T("Mate-X-Axis"));
    pPart->WGManager.AddMateRef(mateAxis);

    // ==========================================================
    // ★ 베어링 조립용 Offset 메이트 참조 등록 추가
    // ==========================================================
    double val_offsetLength = _wtof(m_partData->Info.Offset_Length) / m_unit;
    CiWorkPlane offsetMatePlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, val_offsetLength, _T("Mate-Offset-YZ"));
    pPart->WGManager.AddMateRef(offsetMatePlane);

    // ==========================================================
    // ★ 오일씰(Oil Seal) 조립용 메이트 참조 등록 (수식 적용)
    // 공식: Offset_Length + 베어링 폭(복열 계산됨) + OilSealOffset
    // ==========================================================
    double val_bearingWidth = m_options.referenceBearingWidth / m_unit; // 옵션에서 배달받은 폭
    double val_oilSealOffset = _wtof(m_partData->Info.OilSealOffset) / m_unit; // 축 DB에서 오일씰 여유간격 파싱

    double oilSealMateX = val_offsetLength + val_bearingWidth + val_oilSealOffset;

    CiWorkPlane oilSealMatePlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, oilSealMateX, _T("Mate-OilSeal-YZ"));
    pPart->WGManager.AddMateRef(oilSealMatePlane);

    return S_OK;
}

//=============================================================================
// [축 본체] 3. 중공축 (Hollow Shaft)
//=============================================================================
HRESULT ShaftCreator::CreateHollowShaft(CiPart* pPart)
{
    double radius      = m_shaftDia / 2.0;
    double innerRadius = radius * m_options.hollowRatio;

    CiWorkAxis  xAxis   = pPart->WGManager.GetBaseAxis(CiBaseDirectionEnum::X);
    CiWorkPlane xyPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XY);

    // [1] 외경 솔리드 생성
    pPart->SketchManager.StartSketch(xyPlane);
    CiSketchPoint p0 = pPart->SketchManager.SetSketchPoint(0.0,        0.0);
    CiSketchPoint p1 = pPart->SketchManager.SetSketchPoint(0.0,        radius);
    CiSketchPoint p2 = pPart->SketchManager.SetSketchPoint(m_shaftLen, radius);
    CiSketchPoint p3 = pPart->SketchManager.SetSketchPoint(m_shaftLen, 0.0);
    pPart->SketchManager.CreateSketchLine(p0, p1);
    pPart->SketchManager.CreateSketchLine(p1, p2);
    pPart->SketchManager.CreateSketchLine(p2, p3);
    CiSketchLine revAxis = pPart->SketchManager.CreateSketchLine(p3, p0);
    pPart->SetSolidProfile();
    pPart->FeatureManager.CreateRevolve(
        revAxis, CiJoinOpEnum::Join, 360.0, CiDirectionOpEnum::Positive,
        _T("Shaft_Hollow_Outer"));

    // [2] 내경 관통 컷
    pPart->SketchManager.StartSketch(xyPlane);
    CiSketchPoint h0 = pPart->SketchManager.SetSketchPoint(0.0,        0.0);
    CiSketchPoint h1 = pPart->SketchManager.SetSketchPoint(0.0,        innerRadius);
    CiSketchPoint h2 = pPart->SketchManager.SetSketchPoint(m_shaftLen, innerRadius);
    CiSketchPoint h3 = pPart->SketchManager.SetSketchPoint(m_shaftLen, 0.0);
    pPart->SketchManager.CreateSketchLine(h0, h1);
    pPart->SketchManager.CreateSketchLine(h1, h2);
    pPart->SketchManager.CreateSketchLine(h2, h3);
    CiSketchLine hAxis = pPart->SketchManager.CreateSketchLine(h3, h0);
    pPart->SetSolidProfile();
    pPart->FeatureManager.CreateRevolve(
        hAxis, CiJoinOpEnum::Cut, 360.0, CiDirectionOpEnum::Positive,
        _T("Shaft_Hollow_InnerBore_Cut"));

    //Apply_InnerDRingGroove(pPart);
    //if (m_options.isFixedSide) {
    //    Apply_OuterSnapRingGroove(pPart);
    //    Apply_MaleThread(pPart);
    //}
    //Apply_ParallelKeyway(pPart);
    //Apply_WoodruffKeyway(pPart);
    //Apply_WrenchFlat(pPart);
    //Apply_CenterHole(pPart);
    //Apply_FemaleThread(pPart);
    //Apply_Slitting(pPart);
    //Apply_SlitCam(pPart);
    return S_OK;
}

//=============================================================================
// [축 본체] 4. 테이퍼축 (Tapered Shaft)
//=============================================================================
HRESULT ShaftCreator::CreateTaperedShaft(CiPart* pPart)
{
    double radiusStart = m_shaftDia / 2.0;
    double taperOffset = m_shaftLen * tan(DegToRad(m_options.taperAngleDeg));
    double radiusEnd   = radiusStart - taperOffset;
    if (radiusEnd <= 0.0) radiusEnd = radiusStart * 0.5;

    CiWorkPlane xyPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XY);
    pPart->SketchManager.StartSketch(xyPlane);

    CiSketchPoint p0 = pPart->SketchManager.SetSketchPoint(0.0,        0.0);
    CiSketchPoint p1 = pPart->SketchManager.SetSketchPoint(0.0,        radiusStart);
    CiSketchPoint p2 = pPart->SketchManager.SetSketchPoint(m_shaftLen, radiusEnd);
    CiSketchPoint p3 = pPart->SketchManager.SetSketchPoint(m_shaftLen, 0.0);
    pPart->SketchManager.CreateSketchLine(p0, p1);
    pPart->SketchManager.CreateSketchLine(p1, p2); // 테이퍼 경사면
    pPart->SketchManager.CreateSketchLine(p2, p3);
    CiSketchLine revAxis = pPart->SketchManager.CreateSketchLine(p3, p0);
    pPart->SetSolidProfile();
    pPart->FeatureManager.CreateRevolve(
        revAxis, CiJoinOpEnum::Join, 360.0, CiDirectionOpEnum::Positive,
        _T("Shaft_Tapered_Body"));

    //Apply_ParallelKeyway(pPart);
    //Apply_WoodruffKeyway(pPart);
    //Apply_WrenchFlat(pPart);
    //Apply_CenterHole(pPart);
    //Apply_FemaleThread(pPart);
    return S_OK;
}

//=============================================================================
// [축 본체] 5. 스플라인축 (Splined Shaft)
//=============================================================================
HRESULT ShaftCreator::CreateSplinedShaft(CiPart* pPart)
{
    double radius     = m_shaftDia / 2.0;
    int    teeth      = m_options.splineTeeth;
    double toothDepth = radius * m_options.splineDepthRatio;

    CiWorkAxis  xAxis   = pPart->WGManager.GetBaseAxis(CiBaseDirectionEnum::X);
    CiWorkPlane xyPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XY);
    CiWorkPlane yzPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ);

    // [1] 기본 원통 생성
    pPart->SketchManager.StartSketch(xyPlane);
    CiSketchPoint p0 = pPart->SketchManager.SetSketchPoint(0.0,        0.0);
    CiSketchPoint p1 = pPart->SketchManager.SetSketchPoint(0.0,        radius);
    CiSketchPoint p2 = pPart->SketchManager.SetSketchPoint(m_shaftLen, radius);
    CiSketchPoint p3 = pPart->SketchManager.SetSketchPoint(m_shaftLen, 0.0);
    pPart->SketchManager.CreateSketchLine(p0, p1);
    pPart->SketchManager.CreateSketchLine(p1, p2);
    pPart->SketchManager.CreateSketchLine(p2, p3);
    CiSketchLine revAxis = pPart->SketchManager.CreateSketchLine(p3, p0);
    pPart->SetSolidProfile();
    pPart->FeatureManager.CreateRevolve(
        revAxis, CiJoinOpEnum::Join, 360.0, CiDirectionOpEnum::Positive,
        _T("Shaft_Spline_Base"));

    // [2] 스플라인 치형 컷 (직선 치형 근사)
    double slotHalfW = (radius * ShaftConstants::PI / teeth) * 0.35;
    pPart->SketchManager.StartSketch(yzPlane);
    CiSketchPoint s0 = pPart->SketchManager.SetSketchPoint(-slotHalfW, radius - toothDepth);
    CiSketchPoint s1 = pPart->SketchManager.SetSketchPoint(-slotHalfW, radius + toothDepth);
    CiSketchPoint s2 = pPart->SketchManager.SetSketchPoint( slotHalfW, radius + toothDepth);
    CiSketchPoint s3 = pPart->SketchManager.SetSketchPoint( slotHalfW, radius - toothDepth);
    pPart->SketchManager.CreateSketchLine(s0, s1);
    pPart->SketchManager.CreateSketchLine(s1, s2);
    pPart->SketchManager.CreateSketchLine(s2, s3);
    pPart->SketchManager.CreateSketchLine(s3, s0);
    pPart->SetSolidProfile();
    CiFeature splineCut = pPart->FeatureManager.CreateExtrude(
        m_shaftLen, CiDirectionOpEnum::Positive, CiJoinOpEnum::Cut, 0,
        _T("Spline_Slot_Cut_1"));

    // 원형 패턴으로 나머지 치형 복사
    if (splineCut.isValid() && teeth > 1)
        pPart->FeatureManager.CreateCircularPattern(splineCut, xAxis, teeth, 360.0 / teeth, true);

    return S_OK;
}

//=============================================================================
// [축 본체] 6. 플랜지축 (Flanged Shaft)
//=============================================================================
HRESULT ShaftCreator::CreateFlangedShaft(CiPart* pPart)
{
    double radius    = m_shaftDia / 2.0;
    double flangeOD  = radius * m_options.flangeOD_Ratio;
    double flangeThk = m_shaftDia * m_options.flangeThk_Ratio;

    CiWorkAxis  xAxis   = pPart->WGManager.GetBaseAxis(CiBaseDirectionEnum::X);
    CiWorkPlane xyPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XY);

    // 축 본체 + 플랜지 일체 프로파일
    pPart->SketchManager.StartSketch(xyPlane);
    CiSketchPoint f0 = pPart->SketchManager.SetSketchPoint(0.0,        0.0);
    CiSketchPoint f1 = pPart->SketchManager.SetSketchPoint(0.0,        flangeOD);
    CiSketchPoint f2 = pPart->SketchManager.SetSketchPoint(flangeThk,  flangeOD);
    CiSketchPoint f3 = pPart->SketchManager.SetSketchPoint(flangeThk,  radius);
    CiSketchPoint f4 = pPart->SketchManager.SetSketchPoint(m_shaftLen, radius);
    CiSketchPoint f5 = pPart->SketchManager.SetSketchPoint(m_shaftLen, 0.0);
    pPart->SketchManager.CreateSketchLine(f0, f1);
    pPart->SketchManager.CreateSketchLine(f1, f2);
    pPart->SketchManager.CreateSketchLine(f2, f3);
    pPart->SketchManager.CreateSketchLine(f3, f4);
    pPart->SketchManager.CreateSketchLine(f4, f5);
    CiSketchLine revAxis = pPart->SketchManager.CreateSketchLine(f5, f0);
    pPart->SetSolidProfile();
    pPart->FeatureManager.CreateRevolve(
        revAxis, CiJoinOpEnum::Join, 360.0, CiDirectionOpEnum::Positive,
        _T("Shaft_Flanged_Body"));

    //Apply_FlangeBoltHoles(pPart);
    //Apply_ParallelKeyway(pPart);
    //Apply_WoodruffKeyway(pPart);
    //Apply_WrenchFlat(pPart);
    //Apply_CenterHole(pPart);
    //Apply_FemaleThread(pPart);
    return S_OK;
}

//=============================================================================
// [추가 가공] 안쪽 D부 멈춤링 홈 (Inner DRing Groove)
//=============================================================================
// 4-1. 안쪽 지지: D부 멈춤링 홈
HRESULT ShaftCreator::Apply_InnerDRingGroove(CiPart* pPart)
{
    const ShaftOptions& opt = m_options; // 통합된 구조체 참조
    CiWorkAxis xAxis = pPart->WGManager.GetBaseAxis(CiBaseDirectionEnum::X);
    CiWorkPlane xyPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XY);

    // 1) D부 기본 멈춤링 위치 (offset1)
    if (m_val_ring_offset1 > 0.0 && m_val_ring_offset1 < m_innerSupportX) {
        pPart->SketchManager.StartSketch(xyPlane);
        double ringD_StartX = m_val_ring_offset1;
        CiSketchPoint dg1 = pPart->SketchManager.SetSketchPoint(ringD_StartX, m_val_dRing_Radius);
        CiSketchPoint dg2 = pPart->SketchManager.SetSketchPoint(ringD_StartX + m_val_dRing_Width, m_val_dRing_Radius);
        CiSketchPoint dg3 = pPart->SketchManager.SetSketchPoint(ringD_StartX + m_val_dRing_Width, m_radius);
        CiSketchPoint dg4 = pPart->SketchManager.SetSketchPoint(ringD_StartX, m_radius);
        pPart->SketchManager.CreateSketchLine(dg1, dg2); pPart->SketchManager.CreateSketchLine(dg2, dg3);
        pPart->SketchManager.CreateSketchLine(dg3, dg4); pPart->SketchManager.CreateSketchLine(dg4, dg1);
        pPart->SetSolidProfile();
        pPart->FeatureManager.CreateRevolve(xAxis, CiJoinOpEnum::Cut, 360.0, CiDirectionOpEnum::Positive, _T("D_SnapRing_Groove_Cut"));

        // ★ D부 멈춤링 조립 메이트 평면
        CiWorkPlane innerMate = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, m_val_ring_offset1, _T("Mate-InnerSnapRing-YZ"));
        pPart->WGManager.AddMateRef(innerMate);
    }

    // 2) 안쪽 지지부가 멈춤링 홈일 경우 (독립 Enum 타입 사용)
    if (opt.innerSupport == ShaftInnerSupportType::DRingGroove) {
        pPart->SketchManager.StartSketch(xyPlane);
        CiSketchPoint dg1 = pPart->SketchManager.SetSketchPoint(m_innerSupportX - m_val_dRing_Width, m_val_dRing_Radius);
        CiSketchPoint dg2 = pPart->SketchManager.SetSketchPoint(m_innerSupportX, m_val_dRing_Radius);
        CiSketchPoint dg3 = pPart->SketchManager.SetSketchPoint(m_innerSupportX, m_radius);
        CiSketchPoint dg4 = pPart->SketchManager.SetSketchPoint(m_innerSupportX - m_val_dRing_Width, m_radius);
        pPart->SketchManager.CreateSketchLine(dg1, dg2); pPart->SketchManager.CreateSketchLine(dg2, dg3);
        pPart->SketchManager.CreateSketchLine(dg3, dg4); pPart->SketchManager.CreateSketchLine(dg4, dg1);
        pPart->SetSolidProfile();
        pPart->FeatureManager.CreateRevolve(xAxis, CiJoinOpEnum::Cut, 360.0, CiDirectionOpEnum::Positive, _T("Inner_DRing_Groove_Cut"));

        // ★ 안쪽 단차 멈춤링 조립 메이트 평면
        double ringX = m_innerSupportX - m_val_dRing_Width;
        CiWorkPlane innerMate2 = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, ringX, _T("Mate-InnerSnapRing-YZ"));
        pPart->WGManager.AddMateRef(innerMate2);
    }
    return S_OK;
}

//=============================================================================
// [추가 가공] 바깥쪽 단부 멈춤링 홈 (Outer Snap Ring Groove)
//=============================================================================
//HRESULT ShaftCreator::Apply_OuterSnapRingGroove(CiPart* pPart)
//{
//    if (m_options.outerFix != ShaftOuterFixType::SnapRing) return S_OK;
//
//    double radius   = m_shaftDia / 2.0;
//    double grooveX  = GetOuterGrooveX();
//    double groove_W = ShaftConstants::SNAPRING_GROOVE_W / m_unit;
//    double groove_R = radius - (ShaftConstants::SNAPRING_GROOVE_D / m_unit);
//
//    CiWorkAxis  xAxis   = pPart->WGManager.GetBaseAxis(CiBaseDirectionEnum::X);
//    CiWorkPlane xyPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XY);
//
//    pPart->SketchManager.StartSketch(xyPlane);
//    CiSketchPoint s1 = pPart->SketchManager.SetSketchPoint(grooveX,            groove_R);
//    CiSketchPoint s2 = pPart->SketchManager.SetSketchPoint(grooveX + groove_W, groove_R);
//    CiSketchPoint s3 = pPart->SketchManager.SetSketchPoint(grooveX + groove_W, radius);
//    CiSketchPoint s4 = pPart->SketchManager.SetSketchPoint(grooveX,            radius);
//    pPart->SketchManager.CreateSketchLine(s1, s2);
//    pPart->SketchManager.CreateSketchLine(s2, s3);
//    pPart->SketchManager.CreateSketchLine(s3, s4);
//    pPart->SketchManager.CreateSketchLine(s4, s1);
//    pPart->SetSolidProfile();
//    pPart->FeatureManager.CreateRevolve(
//        xAxis, CiJoinOpEnum::Cut, 360.0, CiDirectionOpEnum::Positive,
//        _T("Outer_SnapRing_Groove_Cut"));
//    return S_OK;
//}

// 4-2. 바깥쪽 고정: 일반 멈춤링 홈
HRESULT ShaftCreator::Apply_OuterFix_SnapRing(CiPart* pPart)
{
    if (m_options.outerFix != ShaftOuterFixType::SnapRing) return S_OK;

    CiWorkAxis xAxis = pPart->WGManager.GetBaseAxis(CiBaseDirectionEnum::X);
    CiWorkPlane xyPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XY);

    pPart->SketchManager.StartSketch(xyPlane);
    double ringP_StartX = m_val_L - m_val_ring_offset2 - m_val_dRing_Width;

    CiSketchPoint pg1 = pPart->SketchManager.SetSketchPoint(ringP_StartX, m_val_dRing_Radius);
    CiSketchPoint pg2 = pPart->SketchManager.SetSketchPoint(ringP_StartX + m_val_dRing_Width, m_val_dRing_Radius);
    CiSketchPoint pg3 = pPart->SketchManager.SetSketchPoint(ringP_StartX + m_val_dRing_Width, m_radius);
    CiSketchPoint pg4 = pPart->SketchManager.SetSketchPoint(ringP_StartX, m_radius);

    pPart->SketchManager.CreateSketchLine(pg1, pg2); pPart->SketchManager.CreateSketchLine(pg2, pg3);
    pPart->SketchManager.CreateSketchLine(pg3, pg4); pPart->SketchManager.CreateSketchLine(pg4, pg1);

    pPart->SetSolidProfile();
    pPart->FeatureManager.CreateRevolve(xAxis, CiJoinOpEnum::Cut, 360.0, CiDirectionOpEnum::Positive, _T("P_SnapRing_Groove_Cut"));

    // ★ 메이트 이름을 부자재와 완벽히 일치하도록 "Mate-EndSnapRing-YZ"로 통일!
    CiWorkPlane outerMate = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, ringP_StartX, _T("Mate-EndSnapRing-YZ"));
    pPart->WGManager.AddMateRef(outerMate);

    return S_OK;
}

////=============================================================================
//// [추가 가공] 수나사 / 로크너트 홈 (Male Thread)
////=============================================================================
//HRESULT ShaftCreator::Apply_MaleThread(CiPart* pPart)
//{
//    if (m_options.outerFix != ShaftOuterFixType::MaleThread &&
//        m_options.outerFix != ShaftOuterFixType::Locknut)
//        return S_OK;
//
//    // 축경 기반 나사 규격 자동 결정
//    ATL::CString threadSpec;
//    double dia_mm = m_shaftDia * m_unit;
//    if      (dia_mm <= 12) threadSpec = _T("M12x1.25");
//    else if (dia_mm <= 16) threadSpec = _T("M16x1.5");
//    else if (dia_mm <= 20) threadSpec = _T("M20x1.5");
//    else if (dia_mm <= 25) threadSpec = _T("M25x1.5");
//    else if (dia_mm <= 30) threadSpec = _T("M30x2.0");
//    else if (dia_mm <= 40) threadSpec = _T("M40x2.0");
//    else                   threadSpec = _T("M50x2.0");
//
//    // pPart->FeatureManager.CreateThread(threadSpec, 0.0, m_shaftDia);
//
//    // 로크너트용 록 와셔 잠금 탭 홈
//    if (m_options.outerFix == ShaftOuterFixType::Locknut) {
//        double lw_W = 4.0 / m_unit;
//        double lw_L = m_shaftDia * 1.2;
//        CiWorkPlane xzPlane = pPart->WGManager.CreateWorkPlane(
//            CiBasePlaneEnum::XZ, m_shaftDia / 2.0);
//        pPart->SketchManager.StartSketch(xzPlane);
//        pPart->SketchManager.CreateSketchRect(lw_L, lw_W, lw_L / 2.0, 0.0);
//        pPart->SetSolidProfile();
//        pPart->FeatureManager.CreateExtrude(
//            m_shaftDia * 0.1, CiDirectionOpEnum::Negative, CiJoinOpEnum::Cut, 0,
//            _T("Lockwasher_Tab_Groove"));
//    }
//    return S_OK;
//}

// 4-3. 바깥쪽 고정: 수나사 (단부 멈춤링 / 로크너트 포함)
HRESULT ShaftCreator::Apply_OuterFix_MaleThread(CiPart* pPart)
{
    if (!m_hasMaleThread) return S_OK;

    const ShaftOptions& opt = m_options;
    CiWorkAxis xAxis = pPart->WGManager.GetBaseAxis(CiBaseDirectionEnum::X);
    CiWorkPlane xyPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XY);

    // 1) 수나사 원통 돌출 (Join)
    CiWorkPlane yzPlaneThread = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, m_base_L);
    pPart->SketchManager.StartSketch(yzPlaneThread);
    CiSketchPoint centerTap = pPart->SketchManager.SetSketchPoint(0.0, 0.0);
    pPart->SketchManager.CreateSketchCircle(m_thread_Radius, centerTap);
    pPart->SetSolidProfile();
    pPart->FeatureManager.CreateExtrude(m_val_threadLength, CiDirectionOpEnum::Positive, CiJoinOpEnum::Join, 0, _T("Male_Threaded_Portion"));

    // 2) Ray-Casting 나사산 생성
    double faceX = m_base_L + (m_val_threadLength / 2.0);
    double rayStart_Radius = m_thread_Radius + (5.0 / m_unit);
    CiPoint cfpos(faceX, rayStart_Radius, 0.0);
    CiVector cfdir(0.0, -1.0, 0.0);
    CiFace TreadFace = pPart->SelectByRayFace(cfpos, cfdir);

    double rayStart_X = m_val_L + (5.0 / m_unit);
    CiPoint cepos(rayStart_X, m_thread_Radius, 0.0);
    CiVector cedir(-1.0, 0.0, 0.0);
    CiEdge ThreadEdge = pPart->SelectByRayEdge(cepos, cedir);

    if (TreadFace.Get() && ThreadEdge.Get()) {
        pPart->FeatureManager.CreateThread(TreadFace, ThreadEdge, m_strThreadInfo, m_val_threadEffectiveLength);
    }

    // 3) 수나사 위 단부 멈춤링 가공
    if (opt.outerFixingComponent == ShaftOuterFixingCompType::EndSnapRing) {
        pPart->SketchManager.StartSketch(xyPlane);
        double endRing_StartX = m_val_L - m_val_ring_offset2 - m_val_endRing_Width;
        double endRing_InnerRadius = m_thread_Radius - (1.0 / m_unit);

        CiSketchPoint pg1 = pPart->SketchManager.SetSketchPoint(endRing_StartX, endRing_InnerRadius);
        CiSketchPoint pg2 = pPart->SketchManager.SetSketchPoint(endRing_StartX + m_val_endRing_Width, endRing_InnerRadius);
        CiSketchPoint pg3 = pPart->SketchManager.SetSketchPoint(endRing_StartX + m_val_endRing_Width, m_thread_Radius);
        CiSketchPoint pg4 = pPart->SketchManager.SetSketchPoint(endRing_StartX, m_thread_Radius);

        pPart->SketchManager.CreateSketchLine(pg1, pg2); pPart->SketchManager.CreateSketchLine(pg2, pg3);
        pPart->SketchManager.CreateSketchLine(pg3, pg4); pPart->SketchManager.CreateSketchLine(pg4, pg1);
        pPart->SetSolidProfile();
        pPart->FeatureManager.CreateRevolve(xAxis, CiJoinOpEnum::Cut, 360.0, CiDirectionOpEnum::Positive, _T("EndSnapRing_Groove_Cut"));

        // ★ 바깥쪽 단부 멈춤링 조립 메이트 평면
        CiWorkPlane endRingMate = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, endRing_StartX, _T("Mate-EndSnapRing-YZ"));
        pPart->WGManager.AddMateRef(endRingMate);
    }

    // 4) 로크너트 와셔 홈
    if (opt.outerFixingComponent == ShaftOuterFixingCompType::Locknut) {
        CiWorkPlane xzPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ, m_thread_Radius);
        pPart->SketchManager.StartSketch(xzPlane);
        pPart->SketchManager.SetPointXRevert();

        double lw_Width = 4.0 / m_unit;
        double lw_Length = m_val_threadLength + (2.0 / m_unit);
        pPart->SketchManager.CreateSketchRect(lw_Length, lw_Width, CiPoint(m_val_L - (lw_Length / 2.0), 0.0, 0.0), 0.0);
        pPart->SetSolidProfile();
        pPart->FeatureManager.CreateExtrude(m_val_threadOuterDia * 0.1, CiDirectionOpEnum::Negative, CiJoinOpEnum::Cut, 0, _T("Lockwasher_Groove"));

        // ★ 로크너트 조립 메이트 평면 (수나사 시작점)
        CiWorkPlane locknutMate = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, m_base_L, _T("Mate-Locknut-YZ"));
        pPart->WGManager.AddMateRef(locknutMate);
    }

    return S_OK;
}

// 4-4. 평행키 & 반달키
HRESULT ShaftCreator::Apply_Keyway(CiPart* pPart)
{
    const ShaftOptions& opt = m_options;
    if (opt.keywayShape == ShaftKeywayShapeType::None) return S_OK;

    bool isTwoPlaces = (opt.keywayAdditional == ShaftKeywayAddType::TwoPlaces);
    bool isEndPlace = (opt.keywayAdditional == ShaftKeywayAddType::EndPlace);

    // 반달키 (XY 평면 사용)
    if (opt.keywayShape == ShaftKeywayShapeType::Woodruff) {
        CiWorkPlane centerPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XY);

        if (isEndPlace) {
            pPart->SketchManager.StartSketch(centerPlane);
            double wKeyEnd_CenterX = m_val_L - m_val_wKey_Radius;
            double wKeyEnd_CenterY = m_radius - m_val_wKey_Depth + m_val_wKey_Radius;
            CiSketchPoint centerEnd = pPart->SketchManager.SetSketchPoint(wKeyEnd_CenterX, wKeyEnd_CenterY);
            pPart->SketchManager.CreateSketchCircle(m_val_wKey_Radius, centerEnd);
            pPart->SetSolidProfile();
            pPart->FeatureManager.CreateExtrude(m_val_wKey_Width, CiDirectionOpEnum::Symmetry, CiJoinOpEnum::Cut, 0, _T("Woodruff_Keyway_End"));
        }
        else {
            pPart->SketchManager.StartSketch(centerPlane);
            double wKey1_CenterX = m_val_pKey_offset1 + m_val_wKey_Radius;
            double wKey1_CenterY = m_radius - m_val_wKey_Depth + m_val_wKey_Radius;
            CiSketchPoint center1 = pPart->SketchManager.SetSketchPoint(wKey1_CenterX, wKey1_CenterY);
            pPart->SketchManager.CreateSketchCircle(m_val_wKey_Radius, center1);
            pPart->SetSolidProfile();
            pPart->FeatureManager.CreateExtrude(m_val_wKey_Width, CiDirectionOpEnum::Symmetry, CiJoinOpEnum::Cut, 0, _T("Woodruff_Keyway_1"));

            if (isTwoPlaces) {
                pPart->SketchManager.StartSketch(centerPlane);
                double wKey2_CenterX = m_val_L - m_val_pKey_offset2 - m_val_wKey_Radius;
                double wKey2_CenterY = m_radius - m_val_wKey_Depth + m_val_wKey_Radius;
                CiSketchPoint center2 = pPart->SketchManager.SetSketchPoint(wKey2_CenterX, wKey2_CenterY);
                pPart->SketchManager.CreateSketchCircle(m_val_wKey_Radius, center2);
                pPart->SetSolidProfile();
                pPart->FeatureManager.CreateExtrude(m_val_wKey_Width, CiDirectionOpEnum::Symmetry, CiJoinOpEnum::Cut, 0, _T("Woodruff_Keyway_2"));
            }
        }
    }
    // 평행키 (XZ 평면 사용)
    else if (opt.keywayShape == ShaftKeywayShapeType::Parallel) {
        CiWorkPlane xzPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ, m_radius);
        double halfKw = m_val_pKey_Width / 2.0;

        if (m_val_pKey_Length <= m_val_pKey_Width) m_val_pKey_Length = m_val_pKey_Width + (2.0 / m_unit);
        if (m_val_pKey_Length2 <= m_val_pKey_Width) m_val_pKey_Length2 = m_val_pKey_Width + (2.0 / m_unit);

        if (isEndPlace) {
            pPart->SketchManager.StartSketch(xzPlane);
            pPart->SketchManager.SetPointXRevert();

            double c1_X = m_val_L - m_val_pKey_Length + halfKw;
            double c2_X = m_val_L;
            CiSketchPoint k1 = pPart->SketchManager.SetSketchPoint(c1_X, halfKw);
            CiSketchPoint k2 = pPart->SketchManager.SetSketchPoint(c2_X, halfKw);
            CiSketchPoint k3 = pPart->SketchManager.SetSketchPoint(c2_X, -halfKw);
            CiSketchPoint k4 = pPart->SketchManager.SetSketchPoint(c1_X, -halfKw);
            CiSketchPoint center1 = pPart->SketchManager.SetSketchPoint(c1_X, 0.0);

            pPart->SketchManager.CreateSketchLine(k1, k2);
            pPart->SketchManager.CreateSketchLine(k2, k3);
            pPart->SketchManager.CreateSketchLine(k3, k4);
            pPart->SketchManager.CreateSketchArc(center1, k4, k1);
            pPart->SetSolidProfile();
            pPart->FeatureManager.CreateExtrude(m_val_pKey_Depth, CiDirectionOpEnum::Negative, CiJoinOpEnum::Cut, 0, _T("Parallel_Keyway_End"));
        }
        else {
            pPart->SketchManager.StartSketch(xzPlane);
            pPart->SketchManager.SetPointXRevert();

            double c1_X = m_val_pKey_offset1 + halfKw;
            double c2_X = m_val_pKey_offset1 + m_val_pKey_Length - halfKw;
            CiSketchPoint k1 = pPart->SketchManager.SetSketchPoint(c1_X, halfKw);
            CiSketchPoint k2 = pPart->SketchManager.SetSketchPoint(c2_X, halfKw);
            CiSketchPoint k3 = pPart->SketchManager.SetSketchPoint(c2_X, -halfKw);
            CiSketchPoint k4 = pPart->SketchManager.SetSketchPoint(c1_X, -halfKw);
            CiSketchPoint center1 = pPart->SketchManager.SetSketchPoint(c1_X, 0.0);
            CiSketchPoint center2 = pPart->SketchManager.SetSketchPoint(c2_X, 0.0);

            pPart->SketchManager.CreateSketchLine(k1, k2);
            pPart->SketchManager.CreateSketchArc(center2, k2, k3);
            pPart->SketchManager.CreateSketchLine(k3, k4);
            pPart->SketchManager.CreateSketchArc(center1, k4, k1);
            pPart->SetSolidProfile();
            pPart->FeatureManager.CreateExtrude(m_val_pKey_Depth, CiDirectionOpEnum::Negative, CiJoinOpEnum::Cut, 0, _T("Parallel_Keyway_1"));

            if (isTwoPlaces) {
                pPart->SketchManager.StartSketch(xzPlane);
                pPart->SketchManager.SetPointXRevert();

                double pKey2_StartX = m_val_L - m_val_pKey_offset2 - m_val_pKey_Length2;
                double c3_X = pKey2_StartX + halfKw;
                double c4_X = pKey2_StartX + m_val_pKey_Length2 - halfKw;

                CiSketchPoint p1 = pPart->SketchManager.SetSketchPoint(c3_X, halfKw);
                CiSketchPoint p2 = pPart->SketchManager.SetSketchPoint(c4_X, halfKw);
                CiSketchPoint p3 = pPart->SketchManager.SetSketchPoint(c4_X, -halfKw);
                CiSketchPoint p4 = pPart->SketchManager.SetSketchPoint(c3_X, -halfKw);
                CiSketchPoint center3 = pPart->SketchManager.SetSketchPoint(c3_X, 0.0);
                CiSketchPoint center4 = pPart->SketchManager.SetSketchPoint(c4_X, 0.0);

                pPart->SketchManager.CreateSketchLine(p1, p2);
                pPart->SketchManager.CreateSketchArc(center4, p2, p3);
                pPart->SketchManager.CreateSketchLine(p3, p4);
                pPart->SketchManager.CreateSketchArc(center3, p4, p1);

                pPart->SetSolidProfile();
                pPart->FeatureManager.CreateExtrude(m_val_pKey_Depth, CiDirectionOpEnum::Negative, CiJoinOpEnum::Cut, 0, _T("Parallel_Keyway_2"));
            }
        }
    }
    return S_OK;
}

////=============================================================================
//// [추가 가공] 평행 키홈 (Parallel Keyway)
////=============================================================================
//HRESULT ShaftCreator::Apply_ParallelKeyway(CiPart* pPart)
//{
//    if (m_options.keyway == ShaftKeywayType::None ||
//        m_options.keyway == ShaftKeywayType::Woodruff)
//        return S_OK;
//
//    double radius    = m_shaftDia / 2.0;
//    double key_W     = (m_partData->Dim.pKey_Width  > 0) ? m_partData->Dim.pKey_Width  : m_keyWidth;
//    double key_Depth = (m_partData->Dim.pKey_Depth1 > 0) ? m_partData->Dim.pKey_Depth1 : m_keyDepth;
//    double key_X     = (m_options.keyway == ShaftKeywayType::Parallel_End) ? 0.0 : m_shaftDia * 0.5;
//    double key_L     = (m_options.keyway == ShaftKeywayType::Parallel_End) ? m_shaftLen * 0.6 : m_shaftDia * 2.5;
//
//    CiWorkPlane topPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ, radius);
//    pPart->SketchManager.StartSketch(topPlane);
//
//    double half_W = key_W / 2.0;
//    CiSketchPoint k1 = pPart->SketchManager.SetSketchPoint(key_X,          -half_W);
//    CiSketchPoint k2 = pPart->SketchManager.SetSketchPoint(key_X + key_L,  -half_W);
//    CiSketchPoint k3 = pPart->SketchManager.SetSketchPoint(key_X + key_L,   half_W);
//    CiSketchPoint k4 = pPart->SketchManager.SetSketchPoint(key_X,           half_W);
//    pPart->SketchManager.CreateSketchLine(k1, k2);
//    pPart->SketchManager.CreateSketchLine(k2, k3);
//    pPart->SketchManager.CreateSketchLine(k3, k4);
//    pPart->SketchManager.CreateSketchLine(k4, k1);
//    pPart->SetSolidProfile();
//    CiFeature keyFeat = pPart->FeatureManager.CreateExtrude(
//        key_Depth, CiDirectionOpEnum::Negative, CiJoinOpEnum::Cut, 0,
//        _T("Parallel_Keyway_Cut_1"));
//
//    // 2곳 - 180도 대칭 복사
//    if (m_options.keyway == ShaftKeywayType::Parallel_Two && keyFeat.isValid()) {
//        CiWorkAxis xAxis = pPart->WGManager.GetBaseAxis(CiBaseDirectionEnum::X);
//        pPart->FeatureManager.CreateCircularPattern(keyFeat, xAxis, 2, 180.0, false);
//    }
//    return S_OK;
//}
//
////=============================================================================
//// [추가 가공] 반달(우드러프) 키홈 (Woodruff Keyway)
////=============================================================================
//HRESULT ShaftCreator::Apply_WoodruffKeyway(CiPart* pPart)
//{
//    if (m_options.keyway != ShaftKeywayType::Woodruff) return S_OK;
//
//    double radius     = m_shaftDia / 2.0;
//    double key_Radius = m_shaftDia * ShaftConstants::KEY_WOODRUFF_R;
//    double key_Depth  = (m_partData->Dim.pKey_Depth1 > 0)
//                      ? m_partData->Dim.pKey_Depth1
//                      : m_shaftDia * ShaftConstants::KEY_DEPTH_RATIO;
//    double key_X      = m_shaftDia * 0.5;
//    double center_Y   = radius - key_Depth + key_Radius;
//
//    CiWorkPlane xyPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XY);
//    pPart->SketchManager.StartSketch(xyPlane);
//    CiSketchPoint center = pPart->SketchManager.SetSketchPoint(key_X, center_Y);
//    pPart->SketchManager.CreateSketchCircle(key_Radius, center);
//    pPart->SetSolidProfile();
//    pPart->FeatureManager.CreateRevolve(
//        pPart->WGManager.GetBaseAxis(CiBaseDirectionEnum::X),
//        CiJoinOpEnum::Cut, 360.0, CiDirectionOpEnum::Positive,
//        _T("Woodruff_Keyway_Cut"));
//    return S_OK;
//}

//=============================================================================
// [추가 가공] 스패너 평면취 (Wrench Flat / D-cut)
//=============================================================================
// 4-5. 평면취 (Circular Pattern 적용)
HRESULT ShaftCreator::Apply_WrenchFlat(CiPart* pPart)
{
    const ShaftOptions& opt = m_options;
    if (opt.wrenchFlat == ShaftWrenchFlatType::None) return S_OK;

    bool isTwoPlaces = (opt.wrenchFlat == ShaftWrenchFlatType::TwoPlaces);
    bool isAngled = (opt.wrenchFlat == ShaftWrenchFlatType::AngledTwoPlaces);

    double safe_R = m_radius + (5.0 / m_unit);
    double flat_H = m_val_wFlat_HalfWidth;
    CiWorkAxis xAxis = pPart->WGManager.GetBaseAxis(CiBaseDirectionEnum::X);

    // 첫 번째 평면취 (1곳, D-Cut)
    double flat1_CenterX = m_val_wFlat_offset1 + (m_val_wFlat_Length / 2.0);
    CiWorkPlane flatPlane1 = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, flat1_CenterX);
    pPart->SketchManager.StartSketch(flatPlane1);

    CiSketchPoint c1 = pPart->SketchManager.SetSketchPoint(-safe_R, flat_H);
    CiSketchPoint c2 = pPart->SketchManager.SetSketchPoint(safe_R, flat_H);
    CiSketchPoint c3 = pPart->SketchManager.SetSketchPoint(safe_R, safe_R);
    CiSketchPoint c4 = pPart->SketchManager.SetSketchPoint(-safe_R, safe_R);

    pPart->SketchManager.CreateSketchLine(c1, c2); pPart->SketchManager.CreateSketchLine(c2, c3);
    pPart->SketchManager.CreateSketchLine(c3, c4); pPart->SketchManager.CreateSketchLine(c4, c1);
    pPart->SetSolidProfile();

    CiExtrudeFeature wrenchFlatFeature1 = pPart->FeatureManager.CreateExtrude(m_val_wFlat_Length, CiDirectionOpEnum::Symmetry, CiJoinOpEnum::Cut, 0, _T("Wrench_Flat_1"));

    // 패턴 적용
    if (isAngled) {
        pPart->FeatureManager.CreateCircularPattern(wrenchFlatFeature1, xAxis, 2, m_val_wFlat_Angle);
    }
    // 두 번째 평면취 (offset2 별도 지정 시)
    else if (isTwoPlaces) {
        double flat2_CenterX = m_val_L - m_val_wFlat_offset2 - m_val_wFlat_Length2 + (m_val_wFlat_Length2 / 2.0);
        CiWorkPlane flatPlane2 = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, flat2_CenterX);
        pPart->SketchManager.StartSketch(flatPlane2);

        CiSketchPoint p_c1 = pPart->SketchManager.SetSketchPoint(-safe_R, flat_H);
        CiSketchPoint p_c2 = pPart->SketchManager.SetSketchPoint(safe_R, flat_H);
        CiSketchPoint p_c3 = pPart->SketchManager.SetSketchPoint(safe_R, safe_R);
        CiSketchPoint p_c4 = pPart->SketchManager.SetSketchPoint(-safe_R, safe_R);

        pPart->SketchManager.CreateSketchLine(p_c1, p_c2); pPart->SketchManager.CreateSketchLine(p_c2, p_c3);
        pPart->SketchManager.CreateSketchLine(p_c3, p_c4); pPart->SketchManager.CreateSketchLine(p_c4, p_c1);
        pPart->SetSolidProfile();
        pPart->FeatureManager.CreateExtrude(m_val_wFlat_Length2, CiDirectionOpEnum::Symmetry, CiJoinOpEnum::Cut, 0, _T("Wrench_Flat_2"));
    }
    return S_OK;
}

// 4-6. 센터 구멍
HRESULT ShaftCreator::Apply_CenterHole(CiPart* pPart)
{
    if (!m_options.hasCenterHole) return S_OK;

    CiWorkPlane xyPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XY);
    pPart->SketchManager.StartSketch(xyPlane);

    CiSketchPoint ch1 = pPart->SketchManager.SetSketchPoint(0.0, 0.0);
    CiSketchPoint ch2 = pPart->SketchManager.SetSketchPoint(0.0, m_val_ch_Radius);
    CiSketchPoint ch3 = pPart->SketchManager.SetSketchPoint(m_val_ch_Depth, 0.0);

    pPart->SketchManager.CreateSketchLine(ch1, ch2);
    pPart->SketchManager.CreateSketchLine(ch2, ch3);
    CiSketchLine chAxis = pPart->SketchManager.CreateSketchLine(ch3, ch1);

    pPart->SetSolidProfile();
    pPart->FeatureManager.CreateRevolve(chAxis, CiJoinOpEnum::Cut, 360.0, CiDirectionOpEnum::Positive, _T("Center_Hole_Cut"));

    return S_OK;
}

// 4-7. 암나사 탭
HRESULT ShaftCreator::Apply_FemaleThread(CiPart* pPart)
{
    if (!m_options.hasFemaleThread) return S_OK;

    CiWorkPlane yzPlaneEnd = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, 0.0);
    pPart->FeatureManager.SetHolePlane(yzPlaneEnd);
    pPart->FeatureManager.AddHolePoint(0.0, 0.0);
    pPart->FeatureManager.CreateTap(m_strFemaleThreadInfo, m_val_femaleThreadDepth, CiDirectionOpEnum::Positive);

    return S_OK;
}

// 4-8. 슬리팅
HRESULT ShaftCreator::Apply_Slitting(CiPart* pPart)
{
    if (!m_options.hasSlitting) return S_OK;

    CiWorkPlane yzPlaneEnd = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, 0.0);
    pPart->SketchManager.StartSketch(yzPlaneEnd);

    double hw = m_val_slit_Width / 2.0;
    double hl = m_val_d * 0.6;

    CiSketchPoint sl1 = pPart->SketchManager.SetSketchPoint(-hl, hw);
    CiSketchPoint sl2 = pPart->SketchManager.SetSketchPoint(hl, hw);
    CiSketchPoint sl3 = pPart->SketchManager.SetSketchPoint(hl, -hw);
    CiSketchPoint sl4 = pPart->SketchManager.SetSketchPoint(-hl, -hw);

    pPart->SketchManager.CreateSketchLine(sl1, sl2); pPart->SketchManager.CreateSketchLine(sl2, sl3);
    pPart->SketchManager.CreateSketchLine(sl3, sl4); pPart->SketchManager.CreateSketchLine(sl4, sl1);

    pPart->SetSolidProfile();
    pPart->FeatureManager.CreateExtrude(m_val_slit_Depth, CiDirectionOpEnum::Positive, CiJoinOpEnum::Cut, 0, _T("Slitting_Cut"));

    return S_OK;
}

// 4-9. 슬릿 캠
HRESULT ShaftCreator::Apply_SlitCam(CiPart* pPart)
{
    if (!m_options.hasSlitCam) return S_OK;

    CiWorkAxis xAxis = pPart->WGManager.GetBaseAxis(CiBaseDirectionEnum::X);
    CiWorkPlane xyPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XY);

    pPart->SketchManager.StartSketch(xyPlane);
    double cam_StartX = m_val_L - m_val_sCam_offset2 - m_val_sCam_Width;

    CiSketchPoint sc1 = pPart->SketchManager.SetSketchPoint(cam_StartX, m_val_sCam_Radius);
    CiSketchPoint sc2 = pPart->SketchManager.SetSketchPoint(cam_StartX + m_val_sCam_Width, m_val_sCam_Radius);
    CiSketchPoint sc3 = pPart->SketchManager.SetSketchPoint(cam_StartX + m_val_sCam_Width, m_radius);
    CiSketchPoint sc4 = pPart->SketchManager.SetSketchPoint(cam_StartX, m_radius);

    pPart->SketchManager.CreateSketchLine(sc1, sc2); pPart->SketchManager.CreateSketchLine(sc2, sc3);
    pPart->SketchManager.CreateSketchLine(sc3, sc4); pPart->SketchManager.CreateSketchLine(sc4, sc1);

    pPart->SetSolidProfile();
    pPart->FeatureManager.CreateRevolve(xAxis, CiJoinOpEnum::Cut, 360.0, CiDirectionOpEnum::Positive, _T("Slit_Cam_Cut"));

    return S_OK;
}

//=============================================================================
// [추가 가공] 플랜지 볼트 구멍 (Flange Bolt Holes)
//=============================================================================
HRESULT ShaftCreator::Apply_FlangeBoltHoles(CiPart* pPart)
{
    int    numHoles = m_options.flangeBoltHoles;
    double flangeOD = (m_shaftDia / 2.0) * m_options.flangeOD_Ratio;
    double flangeThk = m_shaftDia * m_options.flangeThk_Ratio;
    double pcd      = flangeOD * 0.75;
    double holeDia  = m_shaftDia * 0.12;

    CiWorkPlane yzPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, 0.0);
    pPart->SketchManager.StartSketch(yzPlane);
    CiSketchPoint boltCenter = pPart->SketchManager.SetSketchPoint(0.0, pcd);
    pPart->SketchManager.CreateSketchCircle(holeDia / 2.0, boltCenter);
    pPart->SetSolidProfile();
    CiFeature boltHole = pPart->FeatureManager.CreateExtrude(
        flangeThk, CiDirectionOpEnum::Positive, CiJoinOpEnum::Cut, 0,
        _T("Flange_BoltHole_1"));

    if (boltHole.isValid() && numHoles > 1) {
        CiWorkAxis xAxis = pPart->WGManager.GetBaseAxis(CiBaseDirectionEnum::X);
        pPart->FeatureManager.CreateCircularPattern(boltHole, xAxis, numHoles, 360.0 / numHoles, true);
    }
    return S_OK;
}

//=============================================================================
// [5] 부자재 파트 독립 생성 (멈춤링, 로크너트)
//=============================================================================
HRESULT ShaftCreator::Create_Accessory_SnapRing(CiPart* pPart, ATL::CString mateName, double targetDia, bool isEndRing)
{
    // ★ 플래그에 따라 축용 / 단부용 치수 선택
    double val_FreeID = isEndRing ? m_val_endRing_FreeID : m_val_dRing_FreeID;
    double val_Thickness = isEndRing ? m_val_endRing_Thickness : m_val_dRing_Thickness;
    double val_MaxWidth = isEndRing ? m_val_endRing_MaxWidth : m_val_dRing_MaxWidth;
    double val_EndWidth = isEndRing ? m_val_endRing_EndWidth : m_val_dRing_EndWidth;
    double val_HoleDia = isEndRing ? m_val_endRing_HoleDia : m_val_dRing_HoleDia;

    // 타겟 직경에 맞춘 오차 방어 및 자동 재계산 (DIN 471 표준 비율 반영)
    if (val_FreeID <= 0.0 || abs(val_FreeID - targetDia) > (targetDia * 0.2)) {
        val_FreeID = targetDia * 0.93; // 멈춤링 자유내경은 축경의 약 93% 수준
        val_Thickness = (targetDia < (15.0 / m_unit)) ? (1.0 / m_unit) : (1.15 / m_unit);
        val_MaxWidth = val_Thickness * 3.0;
        val_EndWidth = val_Thickness * 1.5;
    }

    if (val_HoleDia <= 0.0) {
        val_HoleDia = (val_EndWidth * 0.5 > 1.0 / m_unit) ? (1.0 / m_unit) : (val_EndWidth * 0.5);
    }

    // 편심(Eccentric) 스케치를 위한 계산
    double r_inner = val_FreeID / 2.0;
    double offset = (val_MaxWidth - val_EndWidth) / 2.0;
    double r_outer = r_inner + (val_MaxWidth + val_EndWidth) / 2.0;

    CiWorkPlane yzPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ);

    // ------------------------------------------------------------------------
    // [1단계] 메인 바디 생성 (편심 링 형태)
    // ------------------------------------------------------------------------
    pPart->SketchManager.StartSketch(yzPlane);
    CiSketchPoint centerInner = pPart->SketchManager.SetSketchPoint(0.0, 0.0);
    pPart->SketchManager.CreateSketchCircle(r_inner, centerInner);
    CiSketchPoint centerOuter = pPart->SketchManager.SetSketchPoint(0.0, -offset);
    pPart->SketchManager.CreateSketchCircle(r_outer, centerOuter);
    pPart->SetSolidProfile();
    pPart->FeatureManager.CreateExtrude(val_Thickness, CiDirectionOpEnum::Positive, CiJoinOpEnum::Join, 0, _T("SnapRing_Body"));

    // ------------------------------------------------------------------------
    // [2단계] 바깥쪽으로 돌출된 "귀(Ears/Lugs)" 추가 (Join)
    // ------------------------------------------------------------------------
    double ear_Radius = val_HoleDia * 0.85; // 구멍을 감싸는 귀의 반경
    if (ear_Radius < val_EndWidth * 0.7) ear_Radius = val_EndWidth * 0.7;

    // ★ 틈새 폭(gapWidth)을 하드코딩(2.5)하지 않고 축경(targetDia)에 비례하도록 동적 계산!
    double gapWidth = targetDia * 0.08;
    if (gapWidth > 3.0 / m_unit) gapWidth = 3.0 / m_unit; // 최대 한계치 (너무 벌어짐 방지)
    if (gapWidth < 1.0 / m_unit) gapWidth = 1.0 / m_unit; // 최소 한계치 (너무 좁아짐 방지)

    // 구멍 위치(X, Y) 밸런스 조정
    double hole_X = (gapWidth / 2.0) + (ear_Radius * 0.75); // 구멍이 귀 중앙에 예쁘게 위치하도록 간격 조정
    double hole_Y = r_inner + (val_EndWidth * 0.6);         // 귀가 너무 위로 솟지 않도록 약간 아래로 당김

    pPart->SketchManager.StartSketch(yzPlane);
    CiSketchPoint earLeft = pPart->SketchManager.SetSketchPoint(-hole_X, hole_Y);
    pPart->SketchManager.CreateSketchCircle(ear_Radius, earLeft);
    CiSketchPoint earRight = pPart->SketchManager.SetSketchPoint(hole_X, hole_Y);
    pPart->SketchManager.CreateSketchCircle(ear_Radius, earRight);

    pPart->SetSolidProfile();
    pPart->FeatureManager.CreateExtrude(val_Thickness, CiDirectionOpEnum::Positive, CiJoinOpEnum::Join, 0, _T("SnapRing_Ears"));

    // ------------------------------------------------------------------------
    // [3단계] 중앙 틈새(Gap)와 플라이어 핀 구멍(Holes) 컷팅 (Cut)
    // ------------------------------------------------------------------------
    pPart->SketchManager.StartSketch(yzPlane);

    // 중앙 틈새 컷 (직사각형) - 링 상단을 완전히 자르도록 높이를 r_outer로 배치
    pPart->SketchManager.CreateSketchRect(gapWidth, r_outer * 2.0, CiPoint(0.0,0.0,0.0), r_outer);

    // 플라이어 구멍 컷 (정확히 귀의 중심에 위치)
    CiSketchPoint holeLeftPt = pPart->SketchManager.SetSketchPoint(-hole_X, hole_Y);
    pPart->SketchManager.CreateSketchCircle(val_HoleDia / 2.0, holeLeftPt);

    CiSketchPoint holeRightPt = pPart->SketchManager.SetSketchPoint(hole_X, hole_Y);
    pPart->SketchManager.CreateSketchCircle(val_HoleDia / 2.0, holeRightPt);

    pPart->SetSolidProfile();
    pPart->FeatureManager.CreateExtrude(val_Thickness * 2.0, CiDirectionOpEnum::Symmetry, CiJoinOpEnum::Cut, 0, _T("SnapRing_Gap_Hole_Cut"));

    // ------------------------------------------------------------------------
    // [4단계] 어셈블리 조립용 메이트(Mate) 참조 생성
    // ------------------------------------------------------------------------
    CiWorkPlane matePlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, 0.0, mateName);
    pPart->WGManager.AddMateRef(matePlane);

    CiPoint originPos(0.0, 0.0, 0.0);
    CiWorkAxis mateAxis = pPart->WGManager.CreateWorkAxis(CiBaseDirectionEnum::X, originPos, _T("Mate-X-Axis"));
    pPart->WGManager.AddMateRef(mateAxis);

    return S_OK;
}

HRESULT ShaftCreator::Create_Accessory_Locknut(CiPart* pPart)
{
    double ln_OD = m_partData->Dim.locknut_OuterDia;
    double ln_T = m_partData->Dim.locknut_Thickness;
    double ln_SlotW = m_partData->Dim.locknut_SlotWidth;
    double ln_SlotD = m_partData->Dim.locknut_SlotDepth;

    if (ln_OD <= 0.0) ln_OD = m_val_d * 1.6;
    if (ln_T <= 0.0)  ln_T = m_val_d * 0.35;
    if (ln_SlotW <= 0.0) ln_SlotW = m_val_d * 0.25;
    if (ln_SlotD <= 0.0) ln_SlotD = m_val_d * 0.1;

    double r_outer = ln_OD / 2.0;
    double r_inner = m_val_d / 2.0;

    CiWorkPlane yzPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ);
    pPart->SketchManager.StartSketch(yzPlane);

    // ★ 로컬 원점 모델링
    CiSketchPoint center = pPart->SketchManager.SetSketchPoint(0.0, 0.0);
    pPart->SketchManager.CreateSketchCircle(r_outer, center);
    pPart->SketchManager.CreateSketchCircle(r_inner, center);
    pPart->SetSolidProfile();
    // ★ Positive 돌출로 기준면 확보
    pPart->FeatureManager.CreateExtrude(ln_T, CiDirectionOpEnum::Positive, CiJoinOpEnum::Join, 0, _T("Locknut_Body"));

    pPart->SketchManager.StartSketch(yzPlane);
    pPart->SketchManager.CreateSketchRect(ln_SlotW, ln_SlotD * 2.0, CiPoint(0.0, 0.0, 0.0), r_outer);
    pPart->SketchManager.CreateSketchRect(ln_SlotW, ln_SlotD * 2.0, CiPoint(0.0, 0.0, 0.0), -r_outer);
    pPart->SketchManager.CreateSketchRect(ln_SlotD * 2.0, ln_SlotW, CiPoint (-r_outer,0.0,0.0), 0.0);
    pPart->SketchManager.CreateSketchRect(ln_SlotD * 2.0, ln_SlotW, CiPoint(r_outer,0.0,0.0), 0.0);
    pPart->SetSolidProfile();
    pPart->FeatureManager.CreateExtrude(ln_T, CiDirectionOpEnum::Positive, CiJoinOpEnum::Cut, 0, _T("Locknut_Slots_Cut"));

    // ==========================================================
    // ★ 축의 메이트 평면과 정확히 일치하는 로크너트 전용 메이트 생성
    // ==========================================================
    CiWorkPlane matePlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, 0.0, _T("Mate-Locknut-YZ"));
    pPart->WGManager.AddMateRef(matePlane);
    CiPoint originPos(0.0, 0.0, 0.0);
    CiWorkAxis mateAxis = pPart->WGManager.CreateWorkAxis(CiBaseDirectionEnum::X, originPos, _T("Mate-X-Axis"));
    pPart->WGManager.AddMateRef(mateAxis);

    return S_OK;
}

//=============================================================================
// [부자재] 록 와셔 (Lock Washer)
//=============================================================================
HRESULT ShaftCreator::Create_Accessory_LockWasher(CiPart* pPart)
{
    double radius   = m_shaftDia / 2.0;
    double nut_W    = m_shaftDia * ShaftConstants::NUT_WIDTH_RATIO;
    double nut_OD   = m_shaftDia * ShaftConstants::NUT_OD_RATIO;
    double posX     = m_shaftDia * 0.2;
    double washer_T = 1.5 / m_unit;   // 와셔 두께 1.5mm

    CiWorkAxis  xAxis   = pPart->WGManager.GetBaseAxis(CiBaseDirectionEnum::X);
    CiWorkPlane xyPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XY);

    // 와셔 링 바디
    double wX = posX + nut_W;
    pPart->SketchManager.StartSketch(xyPlane);
    CiSketchPoint w1 = pPart->SketchManager.SetSketchPoint(wX,             radius);
    CiSketchPoint w2 = pPart->SketchManager.SetSketchPoint(wX + washer_T,  radius);
    CiSketchPoint w3 = pPart->SketchManager.SetSketchPoint(wX + washer_T,  nut_OD / 2.0 * 0.95);
    CiSketchPoint w4 = pPart->SketchManager.SetSketchPoint(wX,             nut_OD / 2.0 * 0.95);
    pPart->SketchManager.CreateSketchLine(w1, w2);
    pPart->SketchManager.CreateSketchLine(w2, w3);
    pPart->SketchManager.CreateSketchLine(w3, w4);
    pPart->SketchManager.CreateSketchLine(w4, w1);
    pPart->SetSolidProfile();
    pPart->FeatureManager.CreateRevolve(
        xAxis, CiJoinOpEnum::Join, 360.0, CiDirectionOpEnum::Positive,
        _T("LockWasher_Ring_Body"));

    // 내경 잠금 탭 (축 홈에 걸리는 돌기)
    CiWorkPlane yzPlane = pPart->WGManager.CreateWorkPlane(
        CiBasePlaneEnum::YZ, wX + washer_T / 2.0);
    pPart->SketchManager.StartSketch(yzPlane);
    double tab_W = 3.0 / m_unit;
    double tab_H = 2.5 / m_unit;
    pPart->SketchManager.CreateSketchRect(tab_W, tab_H, CiPoint(0.0,0.0,0.0), -(radius + tab_H / 2.0));
    pPart->SetSolidProfile();
    pPart->FeatureManager.CreateExtrude(
        washer_T, CiDirectionOpEnum::Symmetry, CiJoinOpEnum::Join, 0,
        _T("LockWasher_InnerTab"));

    // 외경 잠금 탭 (로크너트 슬롯에 끼워지는 돌기)
    pPart->SketchManager.StartSketch(yzPlane);
    pPart->SketchManager.CreateSketchRect(tab_W, tab_H, CiPoint(0.0,0.0,0.0), nut_OD / 2.0 * 0.95 + tab_H / 2.0);
    pPart->SetSolidProfile();
    pPart->FeatureManager.CreateExtrude(
        washer_T, CiDirectionOpEnum::Symmetry, CiJoinOpEnum::Join, 0,
        _T("LockWasher_OuterTab"));
    return S_OK;
}

void  ShaftCreator::SetShaftEndOptions()
{
    ShaftOptions& opt = m_options; // 통합된 구조체를 직접 참조

    // 기본값 초기화
    opt.innerSupport = ShaftInnerSupportType::None;
    opt.outerFix = ShaftOuterFixType::None;
    opt.outerFixingComponent = ShaftOuterFixingCompType::None;
    opt.keywayShape = ShaftKeywayShapeType::None;
    opt.keywayAdditional = ShaftKeywayAddType::None;
    opt.wrenchFlat = ShaftWrenchFlatType::None;

    opt.hasOilSeal = false;
    opt.hasCenterHole = false;
    opt.hasFemaleThread = false;
    opt.hasSlitting = false;
    opt.hasSlitCam = false;

    // 안쪽 지지 방식
    ATL::CString strInnerFixType(m_partData->Info.InnerFixType); strInnerFixType.MakeUpper();
    if (strInnerFixType.Find(_T("단차")) >= 0) opt.innerSupport = ShaftInnerSupportType::Step;
    else if (strInnerFixType.Find(_T("멈춤링")) >= 0) opt.innerSupport = ShaftInnerSupportType::DRingGroove;

    // 바깥쪽 고정 방식
    ATL::CString strOuterFix(m_partData->Info.OuterFix); strOuterFix.MakeUpper();
    if (strOuterFix.Find(_T("멈춤링")) >= 0) opt.outerFix = ShaftOuterFixType::SnapRing;
    else if (strOuterFix.Find(_T("수나사")) >= 0) opt.outerFix = ShaftOuterFixType::MaleThread;

    // 바깥쪽 고정 부품
    ATL::CString strOuterFixingComponent(m_partData->Info.OuterFixingComponent); strOuterFixingComponent.MakeUpper();
    if (strOuterFixingComponent.Find(_T("멈춤링")) >= 0) opt.outerFixingComponent = ShaftOuterFixingCompType::EndSnapRing;
    else if (strOuterFixingComponent.Find(_T("로크")) >= 0) opt.outerFixingComponent = ShaftOuterFixingCompType::Locknut;

    // 키 홈 형상
    ATL::CString strKeyway(m_partData->Info.Keyway); strKeyway.MakeUpper();
    if (strKeyway.Find(_T("평행")) >= 0) opt.keywayShape = ShaftKeywayShapeType::Parallel;
    else if (strKeyway.Find(_T("반달")) >= 0) opt.keywayShape = ShaftKeywayShapeType::Woodruff;

    // 키 홈 추가공
    ATL::CString strKeywayAdditionalType(m_partData->Info.KeywayAdditionalType); strKeywayAdditionalType.MakeUpper();
    if (strKeywayAdditionalType.Find(_T("1곳")) >= 0) opt.keywayAdditional = ShaftKeywayAddType::OnePlace;
    else if (strKeywayAdditionalType.Find(_T("2곳")) >= 0) opt.keywayAdditional = ShaftKeywayAddType::TwoPlaces;
    else if (strKeywayAdditionalType.Find(_T("단부")) >= 0) opt.keywayAdditional = ShaftKeywayAddType::EndPlace;

    // 평면취 (렌치 플랫)
    ATL::CString strWrenchFlat(m_partData->Info.WrenchFlat); strWrenchFlat.MakeUpper();
    if (strWrenchFlat.Find(_T("각도")) >= 0) opt.wrenchFlat = ShaftWrenchFlatType::AngledTwoPlaces;
    else if (strWrenchFlat.Find(_T("1곳")) >= 0) opt.wrenchFlat = ShaftWrenchFlatType::OnePlace;
    else if (strWrenchFlat.Find(_T("2곳")) >= 0) opt.wrenchFlat = ShaftWrenchFlatType::TwoPlaces;
    else if (strWrenchFlat.Find(_T("단부")) >= 0) opt.wrenchFlat = ShaftWrenchFlatType::End;

    // T/F 플래그들
    ATL::CString strHasOilSeal(m_partData->Info.HasOilSeal); strHasOilSeal.MakeUpper();
    if (strHasOilSeal == _T("TRUE") || strHasOilSeal.Find(_T("추가")) >= 0 || strHasOilSeal == _T("1") || strHasOilSeal == _T("ON") || strHasOilSeal == _T("O")) opt.hasOilSeal = true;

    ATL::CString strHasCenterHole(m_partData->Info.HasCenterHole); strHasCenterHole.MakeUpper();
    if (strHasCenterHole.Find(_T("A")) >= 0 || strHasCenterHole.Find(_T("B")) >= 0 || strHasCenterHole.Find(_T("R")) >= 0 || strHasCenterHole.Find(_T("추가")) >= 0) opt.hasCenterHole = true;
    else if (strHasCenterHole.Find(_T("암나사")) >= 0) opt.hasFemaleThread = true;

    ATL::CString strHasSlitCam(m_partData->Info.HasSlitCam); strHasSlitCam.MakeUpper();
    if (strHasSlitCam == _T("TRUE") || strHasSlitCam == _T("O") || strHasSlitCam == _T("1")) opt.hasSlitCam = true;

    ATL::CString strHasSlitting(m_partData->Info.HasSlitting); strHasSlitting.MakeUpper();
    if (strHasSlitting == _T("TRUE") || strHasSlitting == _T("O") || strHasSlitting == _T("1")) opt.hasSlitting = true;
}

//=============================================================================
// SetShaftBodyType - PartName 에서 형상 타입 자동 감지
//=============================================================================
void ShaftCreator::SetShaftBodyType()
{
    if (!m_partData) return;
    ATL::CString partName = m_partData->Info.PartName;
    partName.MakeLower();

    if      (partName.Find(_T("hollow"))  != -1 || partName.Find(_T("중공"))     != -1)
        m_options.bodyType = ShaftBodyType::Hollow;
    else if (partName.Find(_T("taper"))   != -1 || partName.Find(_T("테이퍼"))   != -1)
        m_options.bodyType = ShaftBodyType::Tapered;
    else if (partName.Find(_T("spline"))  != -1 || partName.Find(_T("스플라인")) != -1)
        m_options.bodyType = ShaftBodyType::Splined;
    else if (partName.Find(_T("flange"))  != -1 || partName.Find(_T("플랜지"))   != -1)
        m_options.bodyType = ShaftBodyType::Flanged;
    else if (partName.Find(_T("step"))    != -1 || partName.Find(_T("단차"))     != -1)
        m_options.bodyType = ShaftBodyType::Stepped;
    // 기본값은 ShaftOptions 초기값 (Straight)
}

//=============================================================================
// SetShaftMaterial - 재질 코드 -> CAD 재질명 변환
//=============================================================================
void ShaftCreator::SetShaftMaterial()
{
    m_cadMaterial = _T("Steel, Alloy"); // 기본값 (SM45C / SCM440 계열)
}

//=============================================================================
// ApplyMaterial - CAD 재질 및 색상 적용
//=============================================================================
void ShaftCreator::ApplyMaterial(CiPart* pPart)
{
    if (!pPart) return;
    ATL::CString mat = m_cadMaterial.IsEmpty() ? _T("Steel, Alloy") : m_cadMaterial;
    pPart->SetMaterial(mat);
    //pPart->SetColor(_T("Silver (Metallic)")); // 축 기본색 : 메탈 실버
}

void ShaftCreator::SetFeatureColor(CiRevolveFeature& feature, ATL::CString colorName)
{
    //if (feature.isValid()) feature.SetColor(colorName);
}

//=============================================================================
// FormatDouble - 치수값 문자열 변환
//=============================================================================
ATL::CString ShaftCreator::FormatDouble(double value)
{
    ATL::CString result;
    if (fmod(value, 1.0) == 0.0)
        result.Format(_T("%d"), static_cast<int>(value));
    else
        result.Format(_T("%.1f"), value);
    return result;
}
