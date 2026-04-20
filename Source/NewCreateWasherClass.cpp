/**
 * @file NewCreateWasherClass.cpp
 * @brief Unified Washer Creation System Implementation
 * @note Uses WasherPartData/WasherDimensions from PartData.h
 */
#include "stdafx.h"
#include "NewCreateWasherClass.h"
#include <memory>
#include <cmath>

//=============================================================================
// CreateWasher - Single Entry Point
//=============================================================================
#if defined(SDWORKS)
sdWrk::IComponent2Ptr WasherCreator::CreateWasher(std::map<std::string, std::string>& pDim, WasherPartData& pd, double munit, const WasherOptions& options)
#elif defined(ZW3D)
CiDragComponent WasherCreator::CreateWasher(std::map<std::string, std::string>& pDim, WasherPartData& pd, double munit, const WasherOptions& options)
#else
acInv::ComponentDefinitionPtr WasherCreator::CreateWasher(std::map<std::string, std::string>& pDim, WasherPartData& pd, double munit, const WasherOptions& options)
#endif  
{
    // Unit scale setting
    if (munit == 0.1)
        m_unit = 10.0;
    else if (munit == 0.01)
        m_unit = 100.0;
    else
        m_unit = munit;

    m_partData = &pd;
    m_options = options;

    SetHeadTypeOption();

    // Auto-detect washer type from part code
    SetWasherTypeFromPartCode();

    // Create part code
    ATL::CString partCode;
    partCode.Format(_T("D%sxD%sxT%s_WASHER"),
        FormatDouble(m_partData->Dim.d1 * m_unit),
        FormatDouble(m_partData->Dim.DD1 * m_unit),
        FormatDouble(m_partData->Dim.t1 * m_unit));

    ATL::CString createPartName;
    createPartName.Format(_T("%s_%s"), partCode, m_partData->Info.Material);

    // Initialize Inventor document
    CiDocument::InitApplication(m_pApplication);
    CiAssembly NewComponent = CiDocument::GetDocumentEdit().CreateAssembly(partCode);
    CiPart pPart = NewComponent.CreatePart(partCode);

    // 1. Initialize
    Initialize(pDim);

    // 2. Create washer body (type-specific)
    CreateWasherBody(&pPart);

    // 3. Create optional features
    CreateOptionalFeatures(&pPart);

    // 4. Apply material
    ApplyMaterial(&pPart);

    // ★ 7. iProperty에 BOM 정보 기록 ★
    {
        ATL::CString bomPartName;
        bomPartName.Format(_T("%s"), m_partData->Info.PartName);

        ATL::CString bomMaterial;
        bomMaterial.Format(_T("%s"), m_partData->Info.Material);

        ATL::CString bomSpec;
        bomSpec.Format(_T("%s"), partCode);  // "M8X1.25-40L" (line 62에서 계산됨)

        ATL::CString bomStandard;
        bomStandard.Format(_T("%s"), m_partData->Info.Standard);

        pPart.WritePartBomInfo(bomPartName, bomMaterial, bomSpec, bomStandard);
        NewComponent.WritePartBomInfo(bomPartName, bomMaterial, bomSpec, bomStandard);  // ★ 추가
    }

    CiOccurrence pOcc = NewComponent.Insert(pPart);
#ifdef ZW3D
    // Insert 후 어셈블리가 활성 문서 → 이 시점에 속성 기록
    NewComponent.FlushBomInfo();
#endif
    return NewComponent.GetDragDef();
}

//=============================================================================
// 1. Initialize
//=============================================================================
HRESULT WasherCreator::Initialize(std::map<std::string, std::string>& pDim)
{
    return S_OK;
}

//=============================================================================
// 2. Create Washer Body (Type Dispatch)
// Supported PartCodes:
//   PWAS     - Plate Washer (Plain)
//   SWAS     - Spring Washer
//   DWAS     - Disc Spring Washer (Belleville)
//   BWAS     - Bearing Washer (Plain/Thrust)
//   TWAS     - Toothed Lock Washer (External Tooth)
//   TOEWAS   - Toenail Lock Washer (Internal Tooth)
//   TOGWAS   - Tongue Lock Washer (Tab)
//   TAPERWAS - Taper Washer
//=============================================================================
HRESULT WasherCreator::CreateWasherBody(CiPart* pPart)
{
    switch (m_options.washerType)
    {
    case WasherType::Plain:      // PWAS, BWAS
        return CreatePlainWasher(pPart);

    case WasherType::Spring:     // SWAS
        return CreateSpringWasher(pPart);

    case WasherType::Belleville: // DWAS
        return CreateBellevilleWasher(pPart);

    case WasherType::ToothExternal:  // TWAS
        return CreateToothExternalWasher(pPart);

    case WasherType::ToothInternal:  // TOEWAS
        return CreateToothInternalWasher(pPart);

    case WasherType::Tab:        // TOGWAS
        return CreateTabWasher(pPart);

    case WasherType::Taper:      // TAPERWAS
        return CreateTaperWasher(pPart);

    case WasherType::Bearing: // Bearing
        return CreateBearingWasher(pPart);

    default:
        return CreatePlainWasher(pPart);
    }
}

//=============================================================================
// 2-1. Plain Washer
//=============================================================================
HRESULT WasherCreator::CreatePlainWasher(CiPart* pPart)
{
    CiWorkPlane xzPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ);
    pPart->SketchManager.StartSketch(xzPlane);

    int opt_Fg = m_options.headTypeOption == SpecHeadTypeOption::SquareLarge ? 4
        : m_options.headTypeOption == SpecHeadTypeOption::SquareSmall ? 3
        : m_options.headTypeOption == SpecHeadTypeOption::CirclePolished ? 2 : m_options.headTypeOption == SpecHeadTypeOption::CircleNormal ? 1 : 0;

    double Circle_D = opt_Fg ==1 ? m_partData->Dim.d2 : opt_Fg >= 3 ? m_partData->Dim.d3 : m_partData->Dim.d1;
    double Circle_DD = opt_Fg == 4 ? m_partData->Dim.DD4 : opt_Fg == 3 ? m_partData->Dim.DD3 : opt_Fg == 0 ? m_partData->Dim.DD1 : m_partData->Dim.DD2;
    double Circle_t = opt_Fg == 4 ? m_partData->Dim.t4 : opt_Fg == 3 ? m_partData->Dim.t3 : opt_Fg == 1 ? m_partData->Dim.t2 : m_partData->Dim.t1;

    if (m_options.headTypeOption == SpecHeadTypeOption::SquareSmall || m_options.headTypeOption == SpecHeadTypeOption::SquareLarge) {
        CiSketchPoint pCenter = pPart->SketchManager.SetSketchPoint(0, 0);
        CiSketchPoint rigCenter = pPart->SketchManager.SetSketchPoint(0, Circle_DD / 2.0);
        pPart->SketchManager.CreateSketchPolygon(4, pCenter, rigCenter, true);

        double innerRadius = Circle_D / 2.0;
        pPart->SketchManager.CreateSketchCircle(innerRadius, pCenter);
    }
    else
    {
        CiSketchPoint center = pPart->SketchManager.SetSketchPoint(0, 0);
        double outerRadius = Circle_DD / 2.0;
        pPart->SketchManager.CreateSketchCircle(outerRadius, center);

        double innerRadius = Circle_D / 2.0;
        pPart->SketchManager.CreateSketchCircle(innerRadius, center);
    }
    pPart->SetSolidProfile();
    double thickness = Circle_t;
    CiExtrudeFeature extFeature = pPart->FeatureManager.CreateExtrude(
        thickness, CiDirectionOpEnum::Positive, CiJoinOpEnum::Join, false);

    return S_OK;
}

//=============================================================================
// 2-2. Spring Washer
//=============================================================================
HRESULT WasherCreator::CreateSpringWasher(CiPart* pPart)
{
  //  CiPart* pPart1;
  //  CiSketchLine axisLine = CreateSpringProfile(pPart);
    double rawInnerDia = m_options.headTypeOption == SpecHeadTypeOption::Grade2 ? m_partData->Dim.d1 : m_partData->Dim.d2;
    double rawOuterDia = m_options.headTypeOption == SpecHeadTypeOption::Grade2 ? m_partData->Dim.DD1 : m_partData->Dim.DD2;
    double thickness = m_options.headTypeOption == SpecHeadTypeOption::Grade2 ? m_partData->Dim.t1 : m_partData->Dim.t2;

    CiWorkPlane sketchPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ);
    pPart->SketchManager.StartSketch(sketchPlane);
    // 2. 치수 계산
    double innerRadius = rawInnerDia / 2.0;
    double outerRadius = rawOuterDia / 2.0;
    double sectionWidth = outerRadius - innerRadius;
    double meanRadius = (innerRadius + outerRadius) / 2.0;

    // [A] 회전축 (Center Axis) 그리기 - Y축
    // (0,0)에서 (0, 10) 정도 길이의 선 (길이는 중요하지 않음, 방향이 중요)
    CiSketchPoint axisStart = pPart->SketchManager.SetSketchPoint(0, 0);
    CiSketchPoint axisEnd = pPart->SketchManager.SetSketchPoint(0, thickness * 5.0);
    CiSketchLine  workAxis = pPart->SketchManager.CreateSketchLine(axisStart, axisEnd);

    // 이 선을 '회전축' 속성으로 설정해야 할 수도 있습니다 (API에 따라 다름)
    // 예: workAxis->SetConstruction(true);

    // [B] 단면 (Profile) 그리기 - 직사각형
    // 축에서 meanRadius만큼 떨어진 곳에 그림
    double halfW = sectionWidth / 2.0;
    double halfT = thickness / 2.0;

    // 사각형의 두 대각 점
    CiSketchPoint rectP1 = pPart->SketchManager.SetSketchPoint(meanRadius - halfW, -halfT);
    CiSketchPoint rectP2 = pPart->SketchManager.SetSketchPoint(meanRadius + halfW, halfT);

    // 직사각형 생성
   // CiSketchLine axisLine = pPart->SketchManager.CreateSketchRect(rectP1, rectP2);
    pPart->SketchManager.CreateSketchRect(rectP1, rectP2);

    double pitch = thickness * 1.2;

    // 회전수(Revolution): 딱 1바퀴
    // double revolution = 1.0;
    // 전체 높이 = 피치 * 회전수
    //double targetHeight = pitch * revolution;
   
    // 2. 목표 회전 각도 설정 (350도) /반바퀴이상 더돌아감
    double targetAngle = 224.0;
    // 3. 350도에 해당하는 '높이(Height)' 계산 [핵심!]
    // 공식: 높이 = 피치 * (목표각도 / 360도)
    double heightFor350Deg = pitch * (targetAngle / 360.0);

    pPart->SetSolidProfile();
    pPart->FeatureManager.CreateCoilByHeight(workAxis, pitch, heightFor350Deg, CiJoinOpEnum::NewBody);

    return S_OK;
}

//=============================================================================
// 2-3. Tooth Internal Washer
//=============================================================================
HRESULT WasherCreator::CreateToothInternalWasher(CiPart* pPart)
{
    // 1. 작업 평면 설정 (XY 평면 - Front View)
    CiWorkPlane sketchPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XY);
    pPart->SketchManager.StartSketch(sketchPlane);

    // 2. 와셔 본체 스케치 (원)
    double outerR = m_partData->Dim.DD1 / 2.0;
    double innerR = m_partData->Dim.d1 / 2.0;

    CiSketchPoint center = pPart->SketchManager.SetSketchPoint(0, 0);   
    pPart->SketchManager.CreateSketchCircle(outerR, center); // 외경 원   
    pPart->SketchManager.CreateSketchCircle(innerR, center); // 내경 원 (구멍)

    pPart->SetSolidProfile(); // 와셔 본체와 발톱 스케치 모두 선택
   // 두께만큼 돌출 (New Body)
    pPart->FeatureManager.CreateExtrude(m_partData->Dim.t1, CiDirectionOpEnum::Positive, CiJoinOpEnum::NewBody);

    // 3. 발톱 (Claw) 스케치 (상단 돌출 사각형)
    double clawHalfW = m_partData->Dim.f / 2.0;
    double clawHalfH = m_partData->Dim.a_b1;

    CiWorkPlane sketchPlane1 = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XY);
    pPart->SketchManager.StartSketch(sketchPlane1);
    // 사각형 좌표 계산 (와셔 상단 12시 방향)
    // P1: 좌하단 (와셔 외경과 만나는 점) -> 겹침을 위해 약간 안쪽으로
    CiSketchPoint clawP1 = pPart->SketchManager.SetSketchPoint(-clawHalfW, clawHalfH - m_partData->Dim.c1);
    CiSketchPoint clawP2 = pPart->SketchManager.SetSketchPoint(clawHalfW, clawHalfH);  // P2: 우상단 (돌출된 끝점)
    // 발톱 사각형 생성
    pPart->SketchManager.CreateSketchRect(clawP1, clawP2);

    double totalTabHeight = m_partData->Dim.t1 + m_partData->Dim.c1;
    // 4. 솔리드 생성 (돌출)
    pPart->SetSolidProfile();
    // 두께만큼 돌출 (New Body)
    pPart->FeatureManager.CreateExtrude(totalTabHeight, CiDirectionOpEnum::Positive, CiJoinOpEnum::Join);

    CiWorkPlane sketchPlane2 = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XY);
    pPart->SketchManager.StartSketch(sketchPlane2);
    // 사각형 좌표 계산 (와셔 상단 12시 방향)
  // P1: 좌하단 (와셔 외경과 만나는 점) -> 겹침을 위해 약간 안쪽으로
    CiSketchPoint clawC1 = pPart->SketchManager.SetSketchPoint(-clawHalfW, clawHalfH);
    CiSketchPoint clawC2 = pPart->SketchManager.SetSketchPoint(clawHalfW, outerR + 0.1);  // P2: 우상단 (돌출된 끝점)

    // 발톱 사각형 생성
    pPart->SketchManager.CreateSketchRect(clawC1, clawC2);

    pPart->SetSolidProfile();
    //pPart->SetSolidProfile(); // 와셔 본체와 발톱 스케치 모두 선택
  // 두께만큼 돌출 (New Body)
    pPart->FeatureManager.CreateExtrude(totalTabHeight, CiDirectionOpEnum::Positive, CiJoinOpEnum::Cut);
        
    return S_OK;
}

//=============================================================================
// 2-4. Tooth External Washer
//=============================================================================
HRESULT WasherCreator::CreateToothExternalWasher(CiPart* pPart)
{
    CiWorkPlane sketchPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XY);
    pPart->SketchManager.StartSketch(sketchPlane);

    double r_in = m_partData->Dim.d1;
    double r_out = m_options.headTypeOption == SpecHeadTypeOption::InternalExternalTooth ? m_partData->Dim.DD2 : m_partData->Dim.DD1;
    
    double R_Tip = m_partData->Dim.d1 / 2.0;       // d1 / 2
    double R_Out = m_options.headTypeOption == SpecHeadTypeOption::InternalExternalTooth ? m_partData->Dim.DD2 / 2.0 : m_partData->Dim.DD1 / 2.0;       // d2 / 2

    // 톱니 깊이(Depth) 계산
    // 데이터에 d3(Root Dia)가 있다면: R_Root = dim.d3 / 2.0;
    // 없다면 자동 계산:
    double toothDepth = (R_Out - R_Tip) * 0.5; // 살 두께의 50% 깊이
    double R_Root = (R_Tip + R_Out) / 2.0;
    // 톱니 관련 치수
    int N_Inner = m_partData->Dim.N1 * m_unit;        // 내측 톱니 개수
    int N_Out = m_partData->Dim.N * m_unit;        // 외측 톱니 개수
    int N_OutN = m_partData->Dim.r * m_unit;        // 내외치형-외측 톱니 개수
    double washerWidth = (r_out - r_in) / 2.0;
    double Tooth_L = toothDepth;     // 톱니 길이 (Radial Length)
    double Tooth_W_Ratio = washerWidth; // 톱니 폭 비율 (0.5 = 피치의 50%가 톱니, 50%가 틈)
    double thickness = m_options.headTypeOption == SpecHeadTypeOption::InternalExternalTooth ? m_partData->Dim.t2 : m_partData->Dim.t1;

    double totalWidth = R_Out - R_Tip;
    
    CiSketchPoint center = pPart->SketchManager.SetSketchPoint(0, 0);
        if (m_options.headTypeOption == SpecHeadTypeOption::InternalTooth)
    {
        // [Loop A] 외경 원 (Outer Circle)
        pPart->SketchManager.CreateSketchCircle(r_out / 2.0, center);
        DrawInternalToothLoop(pPart, R_Tip, R_Root, N_Inner);
    }   
    else if (m_options.headTypeOption == SpecHeadTypeOption::ExternalTooth)
    {
        pPart->SketchManager.CreateSketchCircle(r_in / 2.0, center);
        // [외치형] 외경 쪽에 톱니 생성
        // radius: r_out, teethLen: +Tooth_L (바깥으로 돌출)
        DrawToothedLoop(pPart, R_Root, R_Out, N_Out);
    }
    else
    {   
        double toothDepth = totalWidth * 0.3; // 각 톱니의 깊이는 전체 폭의 30%

        double R_In_Root = R_Tip + toothDepth;// 내측 톱니의 뿌리 (Root)    
        double R_Out_Root = R_Out - toothDepth;// 외측 톱니의 뿌리 (Root)

        DrawRadialInternalLoop(pPart, R_Tip, R_In_Root, N_Inner); // 내측
        DrawRadialExternalLoop(pPart, R_Out_Root, R_Out, N_OutN); // 외측
    }
    // -----------------------------------------------------
    // 4. 솔리드 돌출 (Extrude)
    // -----------------------------------------------------
    pPart->SetSolidProfile(); // 외경 루프와 내경 루프 사이 영역 인식
    // 이붙이 와셔는 보통 평면 상태로 모델링합니다. (비틀림 표현 생략)
    pPart->FeatureManager.CreateExtrude(thickness, CiDirectionOpEnum::Positive, CiJoinOpEnum::NewBody);

    CiEdgeCollection edgesToFillet;
    double midZ = thickness / 2.0; // 두께 중간 높이 검색
    double searchTol = 0.1;

    auto FindEdgeAt = [&](double radius, double angleRad) -> CiEdge {
        // 1. 방향 벡터 계산 (단위 벡터)
        double dirX = cos(angleRad);
        double dirY = sin(angleRad);

        // 2. 레이 시작 위치 설정
        // 인식률을 높이기 위해 정확한 지점(radius)보다 약간 안쪽/바깥쪽에서 시작하여 관통하게 함
        // 예: 반지름 지점을 향해 안쪽에서 바깥으로 쏨
        double startR = radius * 0.95; // 95% 지점에서 시작
        CiPoint rayPos(startR * dirX, startR * dirY, midZ);

        // 3. 방향 설정 (중심에서 바깥쪽으로)
        CiVector rayDir(dirX, dirY, 0);

        // API 특성에 따라 SelectByRayEdge가 'Edge 위'를 찍어야 하는지, '관통'해야 하는지 확인 필요.
        // 일반적인 경우: 정확한 좌표 + 방향 or 약간 떨어진 곳 + 방향
        // 여기서는 기존 코드 스타일(정확한 좌표)을 따르되 방향을 수정함:

        // 수정된 방식: 정확한 좌표에서, 법선 방향(Radial)으로 탐색
        CiPoint exactPos(radius * dirX, radius * dirY, midZ);
        CiVector radialDir(dirX, dirY, 0);

        return pPart->SelectByRayEdge(exactPos, radialDir);
    };
    /*
    // 필렛(R) 적용 단계
    if (m_options.headTypeOption == SpecHeadTypeOption::InternalTooth)
    {
        double toothDepth = (R_Out-R_Tip)*2;
        double filletR = toothDepth * 0.15;

        // 가공 최소 R값 보정
        if (filletR < 0.1) filletR = 0.1;

        // 2. [톱니 각도 설정]
        // tooth_w가 없으므로, 전체 360도 중 톱니가 차지하는 '비율(Ratio)'로 계산합니다.
        // 보통 이붙이 와셔는 톱니:빈공간 = 5:5 또는 6:4 정도입니다.

        double toothRatio = 0.6; // 예: 톱니가 60%, 빈 공간이 40% (필요시 조정)

        double pitchAngle = 360.0 / (double)N_Inner;    // 톱니 하나당 할당된 전체 각도
        double toothSpanAngle = pitchAngle * toothRatio;  // 실제 톱니가 차지하는 각도
        double halfAngle = toothSpanAngle / 2.0;          // 중심선 기준 반각

        // 3. 엣지 선택 루프
        CiEdgeCollection edgesToFillet;

        for (int i = 0; i < N_Inner; ++i)
        {
            // 톱니의 중심 각도
            double centerAngDeg = i * pitchAngle;
            double centerAngRad = centerAngDeg * (M_PI / 180.0);

            // 반각을 라디안으로 변환
            double halfRad = halfAngle * (M_PI / 180.0);

            // --- [각도 계산] 방사형(사다리꼴)이므로 Root/Tip 각도가 동일함 ---
            double angleRight = centerAngRad - halfRad;
            double angleLeft = centerAngRad + halfRad;

            // --- [Edge 찾기] ---

            // [A] R_Root (이뿌리/대경) - 링과 연결되는 부위 (필렛 필수)
            // FindEdgeAt(반지름, 각도)
            CiEdge eRootR = FindEdgeAt(R_Root, angleRight);
            CiEdge eRootL = FindEdgeAt(R_Root, angleLeft);

            // [B] R_Tip (이끝/소경) - 톱니 끝부분 (선택 사항)
            // 사다리꼴이므로 이끝에서도 각도는 angleRight/Left로 동일합니다.
            CiEdge eTipR = FindEdgeAt(R_Tip, angleRight);
            CiEdge eTipL = FindEdgeAt(R_Tip, angleLeft);

            // 유효한 엣지 담기
            if (eRootR.isValid()) edgesToFillet.Add(eRootR);
            if (eRootL.isValid()) edgesToFillet.Add(eRootL);

            // 소경(Tip) 쪽에도 R이 필요하다면 추가
            if (eTipR.isValid()) edgesToFillet.Add(eTipR);
            if (eTipL.isValid()) edgesToFillet.Add(eTipL);
        }

        // 4. 필렛 적용
        if (edgesToFillet.GetSize() > 0)
        {
            pPart->FeatureManager.CreateFillet(edgesToFillet, filletR);
        }
    }
    else if (m_options.headTypeOption == SpecHeadTypeOption::ExternalTooth)
    {
        double toothDepth = R_Out - R_Root;
        double filletR = R_Out * 0.03;
        if (filletR < 0.1) filletR = 0.1;

        double angleStep = 360.0 / (double)N_Out;
        double halfToothAngle = (angleStep * 0.5) / 2.0;

        for (int i = 0; i < N_Out; ++i)
        {
            double centerAng = i * angleStep;
            double radStart = (centerAng - halfToothAngle) * (M_PI / 180.0);
            double radEnd = (centerAng + halfToothAngle) * (M_PI / 180.0);

            // [A] Root (이뿌리)
            CiEdge e1 = FindEdgeAt(R_Root, radStart);
            CiEdge e2 = FindEdgeAt(R_Root, radEnd);

            // [B] Tip (이끝) - External의 Tip은 R_Out
            CiEdge e3 = FindEdgeAt(R_Out, radStart);
            CiEdge e4 = FindEdgeAt(R_Out, radEnd);

            if (e1.isValid()) edgesToFillet.Add(e1);
            if (e2.isValid()) edgesToFillet.Add(e2);
            // External 팁은 보통 R을 잘 안주거나 작게 줌 (필요시 주석 해제)
            // if (e3.isValid()) edgesToFillet.Add(e3); 
            // if (e4.isValid()) edgesToFillet.Add(e4);
        }
        // 필렛 적용
        if (edgesToFillet.GetSize() > 0)
        {
            pPart->FeatureManager.CreateFillet(edgesToFillet, filletR);
        }
    }
    else
    {
    // ----------------------------------------------------------------------
        // 내측 톱니 루프
        double angStepIn = 360.0 / N_Inner;
        double halfAngIn = (angStepIn * 0.5) / 2.0;
        double toothDepthIn = totalWidth * 0.3; // 예시 값
        double filletR = toothDepthIn * 0.15;

        double toothDepth = totalWidth * 0.3; // 각 톱니의 깊이는 전체 폭의 30%

        double R_In_Root = R_Tip + toothDepth;// 내측 톱니의 뿌리 (Root)    
        double R_Out_Root = R_Out - toothDepth;// 외측 톱니의 뿌리 (Root)

        if (filletR < 0.1) filletR = 0.1;

        for (int i = 0; i < N_Inner; ++i) {
            double radS = (i * angStepIn - halfAngIn) * (M_PI / 180.0);
            double radE = (i * angStepIn + halfAngIn) * (M_PI / 180.0);

            // 내측은 Tip이 R_Tip, Root가 R_In_Root
            CiEdge e1 = FindEdgeAt(R_In_Root, radS);
            CiEdge e2 = FindEdgeAt(R_In_Root, radE);
            if (e1.isValid()) edgesToFillet.Add(e1);
            if (e2.isValid()) edgesToFillet.Add(e2);
            // Tip 부분 추가시 FindEdgeAt(R_Tip, ...) 호출
        }

        // 외측 톱니 루프
        // N_OutN 변수명 확인 필요 (m_partData->Dim.r 이 맞는지?)
        double angStepOut = 360.0 / N_OutN;
        double halfAngOut = (angStepOut * 0.5) / 2.0;

        for (int i = 0; i < N_OutN; ++i) {
            double radS = (i * angStepOut - halfAngOut) * (M_PI / 180.0);
            double radE = (i * angStepOut + halfAngOut) * (M_PI / 180.0);

            // 외측은 Root가 R_Out_Root
            CiEdge e1 = FindEdgeAt(R_Out_Root, radS);
            CiEdge e2 = FindEdgeAt(R_Out_Root, radE);
            if (e1.isValid()) edgesToFillet.Add(e1);
            if (e2.isValid()) edgesToFillet.Add(e2);
        }    
        // 필렛 적용
        if (edgesToFillet.GetSize() > 0)
        {
            pPart->FeatureManager.CreateFillet(edgesToFillet, filletR);
        }
    }
    */

    return S_OK;
}

//=============================================================================
// 2-5. Belleville Washer (Disc Spring)
//=============================================================================
HRESULT WasherCreator::CreateBellevilleWasher(CiPart* pPart)
{
    // 1. 치수 및 좌표 계산
    double Ri = m_partData->Dim.d1 / 2.0; // 내경 반지름
    double Re = m_partData->Dim.DD1 / 2.0; // 외경 반지름

    // 유효성 검사: 전체 높이(H)는 반드시 두께(t)보다 커야 함
    // 만약 H값이 입력되지 않았다면(0), 임의로 15도 각도 적용
    double totalH = m_partData->Dim.c1;
    if (totalH <= m_partData->Dim.t1) {
        double coneAngle = 15.0 * (3.141592 / 180.0);
        double width = Re - Ri;
        totalH = m_partData->Dim.t1 + (width * tan(coneAngle));
    }

    // 순수 휨 높이 (Cone Height) 계산
    double h0 = totalH - m_partData->Dim.t1;

    // 2. 스케치 평면 설정 (YZ 평면 - 단면)
    CiWorkPlane sketchPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ);
    pPart->SketchManager.StartSketch(sketchPlane);

    // 3. 점 4개 생성 (반시계 방향)
    // 외경 쪽이 바닥에 닿고, 내경 쪽이 들려 있는 형태 ("n"자 모양 단면)
    CiSketchPoint pts[4];    
    pts[0] = pPart->SketchManager.SetSketchPoint(Re, 0);// [0] 외경 바닥 (Ground)    
    pts[1] = pPart->SketchManager.SetSketchPoint(Re, m_partData->Dim.t1);// [1] 외경 상단 (Thickness)    
    pts[2] = pPart->SketchManager.SetSketchPoint(Ri, totalH); // [2] 내경 상단 (Total Height)// 내경 쪽은 휨 높이만큼 올라가 있음   
    pts[3] = pPart->SketchManager.SetSketchPoint(Ri, h0); // [3] 내경 하단 (Total Height - Thickness) // 평행한 두께를 유지하기 위해 높이차 적용

    // 4. 선 연결 (폐곡선)
    pPart->SketchManager.CreateSketchLine(pts[0], pts[1]); // 외경 수직선
    pPart->SketchManager.CreateSketchLine(pts[1], pts[2]); // 상단 경사선
    pPart->SketchManager.CreateSketchLine(pts[2], pts[3]); // 내경 수직선

    // 닫힌 프로파일 생성 (하단 경사선)
    CiSketchLine axisLine = pPart->SketchManager.CreateSketchLine(pts[3], pts[0]);

    // 5. 회전 (Revolve) 수행
    pPart->SetSolidProfile();

    // 중심축(Y축) 정의
    CiWorkAxis zAxis = pPart->WGManager.GetBaseAxis(CiBaseDirectionEnum::Z);

    // 회전 생성 (Join/New)
    pPart->FeatureManager.CreateRevolve(zAxis, CiJoinOpEnum::NewBody);

    return S_OK;
}

//=============================================================================
// 2-5. Bearing Washer 
//=============================================================================
HRESULT WasherCreator::CreateBearingWasher(CiPart* pPart)
{
    // --------------------------------------------------------------------------
    // 1. 기본 작업 평면 설정 (XY 평면 - Front View)
    // --------------------------------------------------------------------------
    CiWorkPlane sketchPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ);
    pPart->SketchManager.StartSketch(sketchPlane);

     //와셔단면		
    double p_D1R = m_partData->Dim.d1 * 0.5;
    double p_D4R = m_partData->Dim.Ds * 0.5;
    double p_D5R = m_partData->Dim.DD1 * 0.5;
    double tooth_w = m_partData->Dim.f;
    double Bent_C = m_partData->Dim.c1;
    int n_teeth = m_partData->Dim.N * m_unit;

    double thikT = m_partData->Dim.t1;
    double len1 = thikT * tan(atan(1.) / 3.6);
    double len2 = (p_D5R - (p_D4R + len1)) * tan(atan(1.) / 1.8);
    double len3 = thikT * cos(atan(1.) / 1.8);
    double len4 = thikT * sin(atan(1.) / 1.8);
    double R_Out_Tip = p_D5R + (p_D5R -p_D4R);

    CiSketchPoint ptList[6];
    ptList[0] = pPart->SketchManager.SetSketchPoint(0, 0);
    ptList[1] = pPart->SketchManager.SetSketchPoint(0, (p_D4R + len1));
    ptList[2] = pPart->SketchManager.SetSketchPoint(len2, p_D5R);
    ptList[3] = pPart->SketchManager.SetSketchPoint((len2 + len3), (p_D5R - len4));
    ptList[4] = pPart->SketchManager.SetSketchPoint(thikT, p_D4R);
    ptList[5] = pPart->SketchManager.SetSketchPoint(thikT, 0);
    for (int i = 0; i < 5; i++)
        pPart->SketchManager.CreateSketchLine(ptList[i], ptList[i + 1]);

    CiSketchLine oAxisLine = pPart->SketchManager.CreateSketchLine(ptList[0], ptList[5]);
    pPart->SetSolidProfile();
    CiRevolveFeature sunkHead = pPart->FeatureManager.CreateRevolve(oAxisLine);

    //
    sketchPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ);
    pPart->SketchManager.StartSketch(sketchPlane);

    CiSketchPoint center = pPart->SketchManager.SetSketchPoint(0, 0);
    //치형 생성
    DrawOuterTeethLoop(pPart, p_D5R +1, R_Out_Tip/2.0, n_teeth, tooth_w);
    pPart->SetSolidProfile();
    pPart->FeatureManager.CreateExtrude(len2 + len3, CiDirectionOpEnum::Negative, CiJoinOpEnum::Cut);

    sketchPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ);
    pPart->SketchManager.StartSketch(sketchPlane);

    center = pPart->SketchManager.SetSketchPoint(0, 0);
    pPart->SketchManager.CreateSketchCircle(p_D1R, center);
    pPart->SetSolidProfile();
    pPart->FeatureManager.CreateExtrude(len2 + len3, CiDirectionOpEnum::Negative, CiJoinOpEnum::Cut);

    double LangC = m_partData->Dim.c1;
    double tabHalfW = m_partData->Dim.f1 / 2.0;
    double startY = (m_partData->Dim.a_b1 / 2.0) - (m_partData->Dim.t1);
    double endY = p_D1R;
    sketchPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ);
    pPart->SketchManager.StartSketch(sketchPlane);

    center = pPart->SketchManager.SetSketchPoint(0, 0);
    // 사각형 좌표 (12시 방향)
    CiSketchPoint longP1 = pPart->SketchManager.SetSketchPoint(-tabHalfW, startY);
    CiSketchPoint longP2 = pPart->SketchManager.SetSketchPoint(tabHalfW, endY);
    pPart->SketchManager.CreateSketchRect(longP1, longP2);

    pPart->SetSolidProfile();
    // 합치기 (Join)
    pPart->FeatureManager.CreateExtrude(m_partData->Dim.t1, CiDirectionOpEnum::Negative, CiJoinOpEnum::Join);

    if (m_options.headTypeOption == SpecHeadTypeOption::Bent)
    {
        center = pPart->SketchManager.SetSketchPoint(0, 0);
        // 사각형 좌표 (12시 방향)
        CiSketchPoint longC1 = pPart->SketchManager.SetSketchPoint(-tabHalfW, startY + m_partData->Dim.t1);
        CiSketchPoint longC2 = pPart->SketchManager.SetSketchPoint(tabHalfW, endY);
        pPart->SketchManager.CreateSketchRect(longC1, longC2);

        pPart->SetSolidProfile();
        // 합치기 (Join)
        pPart->FeatureManager.CreateExtrude(Bent_C, CiDirectionOpEnum::Positive, CiJoinOpEnum::Join);
    }

    // 4. 외곽 톱니 표현을 위한 필렛(R) 적용
    // ----------------------------------------------------------------------
    // 베어링 와셔는 톱니를 구부릴 때 응력이 집중되는 '이뿌리(Root)' 부분에
    // 반드시 라운드(R) 처리가 되어 있습니다. 이를 표현합니다.
    /*
    double filletR = (p_D5R > 0) ? p_D5R : 0.5; // 기본값 0.5mm (규격에 따라 다름)
    CiEdgeCollection edgesToFillet;
    double midZ = thikT / 2.0;
    double searchTol = 0.1;

    double angStep = 360.0 / n_teeth;
    double toothRatio = 0.45; // DrawOuterTeethLoop와 동일한 비율 사용
    double halfAng = (angStep * toothRatio) / 2.0;

    for (int i = 0; i < n_teeth; ++i) {
        double centerAng = i * angStep;
        double rStart = (centerAng - halfAng) * (M_PI / 180.0);
        double rEnd = (centerAng + halfAng) * (M_PI / 180.0);

        // 외측 톱니의 Root(오목한 부분) 모서리만 선택
        // Tip(볼록한 부분)은 보통 날카롭거나 아주 작은 R이므로 제외하거나 별도 처리
        CiPoint rayPos1(p_D5R * cos(rStart), p_D5R * sin(rStart), midZ);
        CiVector rayDir1(-1, 0, 0);
        CiEdge edgeRoot1 = pPart->SelectByRayEdge(rayPos1, rayDir1);
        edgesToFillet.Add(edgeRoot1);

        CiPoint rayPos2(p_D5R * cos(rStart), p_D5R * sin(rStart), midZ);
        CiVector rayDir2(-1, 0, 0);
        CiEdge edgeRoot2 = pPart->SelectByRayEdge(rayPos2, rayDir2);
        edgesToFillet.Add(edgeRoot2);

        //R_Out_Base가 무엇인지 몰라 아래 두줄 안지움 ... 확인후 삭제
    //    edgesToFillet.Add(pPart->WGManager.SelectByRayEdge(R_Out_Base * cos(rStart), R_Out_Base * sin(rStart), midZ, searchTol));
    //    edgesToFillet.Add(pPart->WGManager.SelectByRayEdge(R_Out_Base * cos(rEnd), R_Out_Base * sin(rEnd), midZ, searchTol));
    }
    // 내측 키 탭의 코너에도 R 적용 (선택 사항)
    double tabY_Corner = -sqrt(p_D4R * p_D4R - (m_partData->Dim.f / 2.0) * (m_partData->Dim.f / 2.0));

    CiPoint rayTapPos1(R_Out_Tip / 2.0, tabY_Corner, midZ);
    CiVector rayTapDir1(-1, 0, 0);
    CiEdge edgeTap1 = pPart->SelectByRayEdge(rayTapPos1, rayTapDir1);
    edgesToFillet.Add(edgeTap1);

    CiPoint rayTapPos2(R_Out_Tip / 2.0, tabY_Corner, midZ);
    CiVector rayTapDir2(-1, 0, 0);
    CiEdge edgeTap2 = pPart->SelectByRayEdge(rayTapPos2, rayTapDir2);
    edgesToFillet.Add(edgeTap2);
    //dim.key_w가 무엇인지 몰라 임의로 m_partData->Dim.W 로 변경 아래 두줄 안지움 ... 확인후 삭제
  //  edgesToFillet.Add(pPart->WGManager.SelectByRayEdge(dim.key_w / 2.0, tabY_Corner, midZ, searchTol));
  //  edgesToFillet.Add(pPart->WGManager.SelectByRayEdge(-dim.key_w / 2.0, tabY_Corner, midZ, searchTol));

    // 필렛 피쳐 생성
    if (edgesToFillet.GetSize() > 0) {
        pPart->FeatureManager.CreateFillet(edgesToFillet, filletR);
    }
    */
    return S_OK;
}

//=============================================================================
// 2-6. Wave Washer
//=============================================================================
HRESULT WasherCreator::CreateWaveWasher(CiPart* pPart)
{
    CiWorkPlane xzPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ);
    pPart->SketchManager.StartSketch(xzPlane);

    CiSketchPoint center = pPart->SketchManager.SetSketchPoint(0, 0);
    double outerRadius = m_partData->Dim.DD1 / 2.0;
    double innerRadius = m_partData->Dim.d1 / 2.0;

    pPart->SketchManager.CreateSketchCircle(outerRadius, center);
    pPart->SketchManager.CreateSketchCircle(innerRadius, center);

    pPart->SetSolidProfile();

    double amplitude = m_partData->Dim.f > 0 ? m_partData->Dim.f : m_partData->Dim.t1 * 0.5;
    double effectiveThickness = m_partData->Dim.t1 + amplitude;

    CiExtrudeFeature extFeature = pPart->FeatureManager.CreateExtrude(
        effectiveThickness, CiDirectionOpEnum::Positive, CiJoinOpEnum::Join, false);

    return S_OK;
}

//=============================================================================
// 2-7. Square Washer
//=============================================================================
HRESULT WasherCreator::CreateSquareWasher(CiPart* pPart)
{
    CiWorkPlane xzPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ);
    pPart->SketchManager.StartSketch(xzPlane);

    double halfA = (m_partData->Dim.a_b1 > 0 ? m_partData->Dim.a_b1 : m_partData->Dim.DD1) / 2.0;
    double halfB = (m_partData->Dim.a_b2 > 0 ? m_partData->Dim.a_b2 : m_partData->Dim.DD1) / 2.0;

    CiSketchPoint sqPts[4];
    sqPts[0] = pPart->SketchManager.SetSketchPoint(-halfA, -halfB);
    sqPts[1] = pPart->SketchManager.SetSketchPoint(halfA, -halfB);
    sqPts[2] = pPart->SketchManager.SetSketchPoint(halfA, halfB);
    sqPts[3] = pPart->SketchManager.SetSketchPoint(-halfA, halfB);

    pPart->SketchManager.CreateSketchLine(sqPts[0], sqPts[1]);
    pPart->SketchManager.CreateSketchLine(sqPts[1], sqPts[2]);
    pPart->SketchManager.CreateSketchLine(sqPts[2], sqPts[3]);
    pPart->SketchManager.CreateSketchLine(sqPts[3], sqPts[0]);

    CiSketchPoint center = pPart->SketchManager.SetSketchPoint(0, 0);
    double innerRadius = m_partData->Dim.d1 / 2.0;
    pPart->SketchManager.CreateSketchCircle(innerRadius, center);

    pPart->SetSolidProfile();
    CiExtrudeFeature extFeature = pPart->FeatureManager.CreateExtrude(
        m_partData->Dim.t1, CiDirectionOpEnum::Positive, CiJoinOpEnum::Join, false);

    return S_OK;
}

//=============================================================================
// 2-8. Taper Washer
//=============================================================================
HRESULT WasherCreator::CreateTaperWasher(CiPart* pPart)
{
    CiWorkPlane sidePlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ);
    pPart->SketchManager.StartSketch(sidePlane);

    double thickness = m_options.headTypeOption == SpecHeadTypeOption::Angle8 ? m_partData->Dim.t3 : m_options.headTypeOption == SpecHeadTypeOption::Angle5 ? m_partData->Dim.t2 : m_partData->Dim.t1;
    double angle = m_options.headTypeOption == SpecHeadTypeOption::Angle8 ? 8 : m_options.headTypeOption == SpecHeadTypeOption::Angle5 ? 5 : 3;
    // 치수 계산
    double rad = angle * (M_PI / 180.0);
    double h_diff = m_partData->Dim.DD1 * tan(rad);      // 높이 차이 (밑변 * tan(각도))
    double t_max = thickness + h_diff;     // 두꺼운 쪽 두께

    // 중심을 (0,0,0)에 맞추기 위한 좌표 계산
    // 와셔의 길이 L을 Y축(가로)에 배치한다고 가정
    double halfL = m_partData->Dim.DD1 / 2.0;

    // 사다리꼴 점 4개 (반시계 방향)
    // P0: 좌측 하단 (얇은 쪽 바닥)
    CiSketchPoint p0 = pPart->SketchManager.SetSketchPoint(-halfL, 0);   
    CiSketchPoint p1 = pPart->SketchManager.SetSketchPoint(halfL, 0); // P1: 우측 하단 (두꺼운 쪽 바닥)    
    CiSketchPoint p2 = pPart->SketchManager.SetSketchPoint(halfL, t_max);// P2: 우측 상단 (두꺼운 쪽 위)   
    CiSketchPoint p3 = pPart->SketchManager.SetSketchPoint(-halfL, thickness); // P3: 좌측 상단 (얇은 쪽 위)

    // 선 연결
    pPart->SketchManager.CreateSketchLine(p0, p1);
    pPart->SketchManager.CreateSketchLine(p1, p2);
    pPart->SketchManager.CreateSketchLine(p2, p3);
    pPart->SketchManager.CreateSketchLine(p3, p0); // 폐곡선 완성

    pPart->SetSolidProfile();

    // 돌출 (Extrude)
    // 측면을 그렸으므로, 와셔의 폭(L)만큼 돌출합니다.
    // 중심을 맞추기 위해 Mid-Plane(양방향) 돌출이 좋으나, API가 지원하지 않으면
    // 한쪽으로 L만큼 돌출 후 위치 이동이 필요할 수 있음. 
    // 여기서는 단순하게 Positive 방향으로 L만큼 생성
    pPart->FeatureManager.CreateExtrude(m_partData->Dim.DD1, CiDirectionOpEnum::Symmetry, CiJoinOpEnum::NewBody);

    // --------------------------------------------------------------------------
    // 2. 구멍 (Hole) - 원 스케치 및 컷팅
    // --------------------------------------------------------------------------
    // 바닥면(XY 평면) 또는 돌출된 윗면을 기준으로 뚫습니다.
    // 여기서는 바닥면(XY) 기준으로 위로 뚫습니다.

    // [중요] Extrude 후 스케치를 다시 시작해야 함
    CiWorkPlane bottomPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XY);
    pPart->SketchManager.StartSketch(bottomPlane);

    // 구멍 중심은 와셔의 정중앙 (0, 0) - 위에서 돌출 시 폭의 중심이 이동했다면 보정 필요
    // 위에서 YZ평면에 그리고 X축으로 돌출했으므로, 
    // XZ평면상에서 중심은 (L/2, 0) 위치일 수 있음 (돌출 시작점에 따라 다름)

    // 만약 돌출이 (0,0)에서 시작되어 X+ 방향으로 L만큼 갔다면, 중심은 (L/2, 0)입니다.
    double centerX = 0;

    // Z축은 위에서 그린 사다리꼴의 Y축(가로)에 해당하므로 중심은 0
    // (좌표계 매칭에 주의: YZ평면의 Y축 -> 3D공간의 Y축 / YZ평면의 Z축 -> 3D공간의 Z축 가정 시)
    // *일반적인 CAD API 좌표계 매칭*
    // YZ Sketch Y -> 3D Y
    // YZ Sketch X -> 3D Z (보통)
    // 이 부분은 사용하시는 라이브러리의 평면 정의에 따라 (0,0)일수도, (L/2, 0)일수도 있습니다.
    // 여기서는 '돌출된 솔리드의 중심'에 원을 그린다고 가정합니다.

    CiSketchPoint holeCenter = pPart->SketchManager.SetSketchPoint(0, 0);
    pPart->SketchManager.CreateSketchCircle(m_partData->Dim.d1 / 2.0, holeCenter);

    pPart->SetSolidProfile();

    // 컷팅 (Cut)
    // 두꺼운 쪽 두께보다 더 깊게 뚫어야 완전히 관통됨
    double cutDepth = t_max * 1.5;

    // 바닥에서 위로(Y축 Positive) 컷팅 (XZ평면 기준 Normal 방향)
    pPart->FeatureManager.CreateExtrude(cutDepth, CiDirectionOpEnum::Positive, CiJoinOpEnum::Cut);

    return S_OK;
}

//=============================================================================
// 2-9. Spherical Washer
//=============================================================================
HRESULT WasherCreator::CreateSphericalWasher(CiPart* pPart)
{
    CiWorkPlane yzPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ);
    pPart->SketchManager.StartSketch(yzPlane);

    double innerR = m_partData->Dim.d1 / 2.0;
    double outerR = m_partData->Dim.DD1 / 2.0;
    double thickness = m_partData->Dim.t1;
    double sphereRadius = (outerR + innerR) / 2.0 * 1.5;

    CiSketchPoint pts[4];
    pts[0] = pPart->SketchManager.SetSketchPoint(0, 0);
    pts[1] = pPart->SketchManager.SetSketchPoint(0, innerR);
    pts[2] = pPart->SketchManager.SetSketchPoint(thickness, outerR);
    pts[3] = pPart->SketchManager.SetSketchPoint(thickness, 0);

    CiSketchPoint arcCenter = pPart->SketchManager.SetSketchPoint(thickness / 2.0, sphereRadius);

    pPart->SketchManager.CreateSketchLine(pts[0], pts[1]);
    pPart->SketchManager.CreateSketchArc(arcCenter, pts[1], pts[2]);
    pPart->SketchManager.CreateSketchLine(pts[2], pts[3]);
    CiSketchLine axisLine = pPart->SketchManager.CreateSketchLine(pts[3], pts[0]);

    pPart->SetSolidProfile();
    CiRevolveFeature revolveFeature = pPart->FeatureManager.CreateRevolve(
        axisLine, CiJoinOpEnum::Join, 360.0, CiDirectionOpEnum::Positive, _T(""));

    return S_OK;
}

//=============================================================================
// 2-10. Tab Washer
//=============================================================================
HRESULT WasherCreator::CreateTabWasher(CiPart* pPart)
{
    CiWorkPlane sketchPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XY);
    pPart->SketchManager.StartSketch(sketchPlane);

    double outerR = m_options.headTypeOption == SpecHeadTypeOption::DoubleTab ? m_partData->Dim.DD2 / 2.0 : m_partData->Dim.DD1 / 2.0;
    double innerR = m_partData->Dim.d1 / 2.0;
    CiSketchPoint center = pPart->SketchManager.SetSketchPoint(0, 0);
    // 외경 및 내경 원
    pPart->SketchManager.CreateSketchCircle(outerR, center);
    pPart->SketchManager.CreateSketchCircle(innerR, center);

    pPart->SetSolidProfile();
    // 몸통 생성 (Base)
    pPart->FeatureManager.CreateExtrude(m_partData->Dim.t1, CiDirectionOpEnum::Positive, CiJoinOpEnum::NewBody);

    // --------------------------------------------------------------------------
    // 2. 긴 혀 (Long Tab) - 12시 방향
    // --------------------------------------------------------------------------
    pPart->SketchManager.StartSketch(sketchPlane); // 스케치 재시작

    double tabHalfW = m_partData->Dim.f / 2.0;

    // 시작점: 외경보다 0.1mm 안쪽 (겹침 보장)
    double startY = outerR - 0.1;
    // 끝점: 중심에서 L_Long 거리만큼
    double endY = m_partData->Dim.a_b1;

    // 사각형 좌표 (12시 방향)
    CiSketchPoint longP1 = pPart->SketchManager.SetSketchPoint(-tabHalfW, startY);
    CiSketchPoint longP2 = pPart->SketchManager.SetSketchPoint(tabHalfW, endY);
    pPart->SketchManager.CreateSketchRect(longP1, longP2);

    pPart->SetSolidProfile();
    // 합치기 (Join)
    pPart->FeatureManager.CreateExtrude(m_partData->Dim.t1, CiDirectionOpEnum::Positive, CiJoinOpEnum::Join);

    // --------------------------------------------------------------------------
    // 3. 짧은 혀 (Short Tab) - 3시 방향 (양쪽 혀붙이일 경우만)
    // --------------------------------------------------------------------------
    if (m_options.headTypeOption == SpecHeadTypeOption::DoubleTab)
    {
        pPart->SketchManager.StartSketch(sketchPlane); // 스케치 재시작

        // 시작점: 외경보다 0.1mm 안쪽
        double startX = outerR - 0.1;
        // 끝점: 중심에서 L_Short 거리만큼
        double endX = m_partData->Dim.c1;

        // 사각형 좌표 (3시 방향: X축으로 뻗음)
        // Y좌표가 너비(b)의 절반이 됨
        CiSketchPoint shortP1 = pPart->SketchManager.SetSketchPoint(startX, -tabHalfW);
        CiSketchPoint shortP2 = pPart->SketchManager.SetSketchPoint(endX, tabHalfW);
        pPart->SketchManager.CreateSketchRect(shortP1, shortP2);

        pPart->SetSolidProfile();
        // 합치기 (Join)
        pPart->FeatureManager.CreateExtrude(m_partData->Dim.t1, CiDirectionOpEnum::Positive, CiJoinOpEnum::Join);
    }
    
    
    // --------------------------------------------------------------------------
    // [추가] 4. 필렛 (R값) 적용
    // --------------------------------------------------------------------------
    // R값이 입력되지 않았으면 두께의 절반 혹은 최소 0.25mm 적용
    double filletR = (m_partData->Dim.r > 0) ? m_partData->Dim.r : (m_partData->Dim.t1 * 0.5);
    if (filletR < 0.25) filletR = 0.25;

    // 필렛을 적용할 모서리 리스트
    CiEdgeCollection edgesToFillet;

    // 모서리를 찾는 기준 높이 (두께의 중간 지점)
    double midZ = m_partData->Dim.t1 / 2.0;
    double searchTol = 0.5; // 검색 허용 오차

    // [A] 긴 혀 (Long Tab) 연결부 모서리 찾기 (12시 방향)
    // 위치: X = ±tabHalfW, Y = outerR
    CiPoint rayPos(-tabHalfW,outerR,midZ );
    CiVector rayDir(0,-1,0);
    CiEdge longEdgeL = pPart->SelectByRayEdge(rayPos,rayDir );
      //  -tabHalfW, outerR, midZ, searchTol, CiSelectOption::Concave); // 좌측 오목 모서리

    CiPoint rayPos2(tabHalfW, outerR, midZ);
    CiVector rayDir2(0, -1, 0);
    CiEdge longEdgeR = pPart->SelectByRayEdge(rayPos2, rayDir2);
        //tabHalfW, outerR, midZ, searchTol, CiSelectOption::Concave);  // 우측 오목 모서리

    if (longEdgeL.isValid()) edgesToFillet.Add(longEdgeL);
    if (longEdgeR.isValid()) edgesToFillet.Add(longEdgeR);

    // [B] 짧은 혀 (Short Tab) 연결부 모서리 찾기 (3시 방향) - 양쪽일 경우만
    if (m_options.headTypeOption == SpecHeadTypeOption::DoubleTab)
    {
        // 위치: X = outerR, Y = ±tabHalfW
        CiPoint rayPos3(outerR, -tabHalfW, midZ);
        CiVector rayDir3(-1, 0, 0);
        CiEdge shortEdgeB = pPart->SelectByRayEdge(rayPos3, rayDir3);
           // outerR, -tabHalfW, midZ, searchTol, CiSelectOption::Concave); // 하단 오목 모서리

        CiPoint rayPos4(outerR, -tabHalfW, midZ);
        CiVector rayDir4(-1, 0, 0);
        CiEdge shortEdgeT = pPart->SelectByRayEdge(rayPos4, rayDir4);
          //  outerR, tabHalfW, midZ, searchTol, CiSelectOption::Concave);  // 상단 오목 모서리

        if (shortEdgeB.isValid()) edgesToFillet.Add(shortEdgeB);
        if (shortEdgeT.isValid()) edgesToFillet.Add(shortEdgeT);
    }

    // [C] 필렛 피쳐 생성
    if (edgesToFillet.GetSize() > 0)
    {
        pPart->FeatureManager.CreateFillet(edgesToFillet, filletR);
    }
    
    return S_OK;
}

//=============================================================================
// 2-11. Bonded Seal Washer
//=============================================================================
HRESULT WasherCreator::CreateBondedWasher(CiPart* pPart)
{
    // Metal ring
    CiWorkPlane metalPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ);
    pPart->SketchManager.StartSketch(metalPlane);

    CiSketchPoint center = pPart->SketchManager.SetSketchPoint(0, 0);
    double outerRadius = m_partData->Dim.DD1 / 2.0;
    double innerRadius = m_partData->Dim.d1 / 2.0;
    double metalThickness = m_partData->Dim.t1 * 0.6;

    pPart->SketchManager.CreateSketchCircle(outerRadius, center);
    pPart->SketchManager.CreateSketchCircle(innerRadius, center);

    pPart->SetSolidProfile();
    CiExtrudeFeature metalFeature = pPart->FeatureManager.CreateExtrude(
        metalThickness, CiDirectionOpEnum::Positive, CiJoinOpEnum::Join, false);

    // Rubber/seal portion (inner)
    double rubberThickness = m_partData->Dim.t1 * 0.4;
    double rubberOuterR = innerRadius + (outerRadius - innerRadius) * 0.3;

    // Create rubber on top of metal
    CiWorkPlane rubberPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ);
    pPart->SketchManager.StartSketch(rubberPlane);

    CiSketchPoint rubberCenter = pPart->SketchManager.SetSketchPoint(0, 0);
    pPart->SketchManager.CreateSketchCircle(rubberOuterR, rubberCenter);
    pPart->SketchManager.CreateSketchCircle(innerRadius, rubberCenter);

    pPart->SetSolidProfile();
    CiExtrudeFeature rubberFeature = pPart->FeatureManager.CreateExtrude(
        m_partData->Dim.t1, CiDirectionOpEnum::Positive, CiJoinOpEnum::Join, false);

    return S_OK;
}

//=============================================================================
// 2-12. Shoulder Washer
//=============================================================================
HRESULT WasherCreator::CreateShoulderWasher(CiPart* pPart)
{
    CiWorkPlane yzPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ);
    pPart->SketchManager.StartSketch(yzPlane);

    double innerR = m_partData->Dim.d1 / 2.0;
    double outerR = m_partData->Dim.DD1 / 2.0;
    double shoulderR = m_partData->Dim.Ds > 0 ? m_partData->Dim.Ds / 2.0 : (innerR + outerR) / 2.0;
    double flangeThickness = m_partData->Dim.t1;
    double shoulderHeight = m_partData->Dim.f > 0 ? m_partData->Dim.f : flangeThickness * 2;

    CiSketchPoint pts[7];
    pts[0] = pPart->SketchManager.SetSketchPoint(0, 0);
    pts[1] = pPart->SketchManager.SetSketchPoint(0, innerR);
    pts[2] = pPart->SketchManager.SetSketchPoint(shoulderHeight, innerR);
    pts[3] = pPart->SketchManager.SetSketchPoint(shoulderHeight, shoulderR);
    pts[4] = pPart->SketchManager.SetSketchPoint(shoulderHeight + flangeThickness, shoulderR);
    pts[5] = pPart->SketchManager.SetSketchPoint(shoulderHeight + flangeThickness, outerR);
    pts[6] = pPart->SketchManager.SetSketchPoint(shoulderHeight, outerR);

    pPart->SketchManager.CreateSketchLine(pts[0], pts[1]);
    pPart->SketchManager.CreateSketchLine(pts[1], pts[2]);
    pPart->SketchManager.CreateSketchLine(pts[2], pts[3]);
    pPart->SketchManager.CreateSketchLine(pts[3], pts[4]);
    pPart->SketchManager.CreateSketchLine(pts[4], pts[5]);
    pPart->SketchManager.CreateSketchLine(pts[5], pts[6]);
    CiSketchLine axisLine = pPart->SketchManager.CreateSketchLine(pts[6], pts[0]);

    pPart->SetSolidProfile();
    CiRevolveFeature revolveFeature = pPart->FeatureManager.CreateRevolve(
        axisLine, CiJoinOpEnum::Join, 360.0, CiDirectionOpEnum::Positive, _T(""));

    return S_OK;
}

//=============================================================================
// 2-13. Countersunk Washer
//=============================================================================
HRESULT WasherCreator::CreateCountersunkWasher(CiPart* pPart)
{
    CiWorkPlane yzPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ);
    pPart->SketchManager.StartSketch(yzPlane);

    double innerR = m_partData->Dim.d1 / 2.0;
    double outerR = m_partData->Dim.DD1 / 2.0;
    double thickness = m_partData->Dim.t1;
    double p_heightH = m_partData->Dim.c1;
    double p_gapAY = 0.5;
    double p_gapBX = 0.5;
    double xgap = (thickness * thickness) - (p_gapAY * p_gapAY);
    double dntx = sqrt(xgap);


    CiSketchPoint pts[4];
    pts[0] = pPart->SketchManager.SetSketchPoint(outerR * 0.5 - dntx, 0);
    pts[1] = pPart->SketchManager.SetSketchPoint(outerR * 0.5, p_gapAY);
    pts[2] = pPart->SketchManager.SetSketchPoint(innerR * 0.5 + p_gapBX, p_heightH);
    pts[3] = pPart->SketchManager.SetSketchPoint(innerR * 0.5, p_heightH - thickness);


    pPart->SketchManager.CreateSketchLine(pts[0], pts[1]);
    pPart->SketchManager.CreateSketchLine(pts[1], pts[2]);
    pPart->SketchManager.CreateSketchLine(pts[2], pts[3]);
    pPart->SketchManager.CreateSketchLine(pts[3], pts[0]);

    CiSketchLine axisLine = pPart->SketchManager.CreateSketchLine(pts[5], pts[0]);

    pPart->SetSolidProfile();
    CiRevolveFeature revolveFeature = pPart->FeatureManager.CreateRevolve(
        axisLine, CiJoinOpEnum::Join, 360.0, CiDirectionOpEnum::Positive, _T(""));

    return S_OK;
}

//=============================================================================
// 2-14. Nordlock Washer
//=============================================================================
HRESULT WasherCreator::CreateNordlockWasher(CiPart* pPart)
{
    CiWorkPlane yzPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ);
    pPart->SketchManager.StartSketch(yzPlane);

    double innerR = m_partData->Dim.d1 / 2.0;
    double outerR = m_partData->Dim.DD1 / 2.0;
    double thickness = m_partData->Dim.t1;

    double wedgeAngle = 12.0;
    double wedgeHeight = (outerR - innerR) * tan(DegToRad(wedgeAngle));

    CiSketchPoint pts[5];
    pts[0] = pPart->SketchManager.SetSketchPoint(0, 0);
    pts[1] = pPart->SketchManager.SetSketchPoint(0, innerR);
    pts[2] = pPart->SketchManager.SetSketchPoint(thickness, innerR);
    pts[3] = pPart->SketchManager.SetSketchPoint(thickness + wedgeHeight, outerR);
    pts[4] = pPart->SketchManager.SetSketchPoint(wedgeHeight, outerR);

    pPart->SketchManager.CreateSketchLine(pts[0], pts[1]);
    pPart->SketchManager.CreateSketchLine(pts[1], pts[2]);
    pPart->SketchManager.CreateSketchLine(pts[2], pts[3]);
    pPart->SketchManager.CreateSketchLine(pts[3], pts[4]);
    CiSketchLine axisLine = pPart->SketchManager.CreateSketchLine(pts[4], pts[0]);

    pPart->SetSolidProfile();
    CiRevolveFeature revolveFeature = pPart->FeatureManager.CreateRevolve(
        axisLine, CiJoinOpEnum::Join, 360.0, CiDirectionOpEnum::Positive, _T(""));

    return S_OK;
}

//=============================================================================
// 2-15. Finger Washer
//=============================================================================
HRESULT WasherCreator::CreateFingerWasher(CiPart* pPart)
{
    CiWorkPlane basePlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ);
    pPart->SketchManager.StartSketch(basePlane);

    CiSketchPoint center = pPart->SketchManager.SetSketchPoint(0, 0);
    double outerRadius = m_partData->Dim.DD1 / 2.0;
    double innerRadius = m_partData->Dim.d1 / 2.0;

    pPart->SketchManager.CreateSketchCircle(outerRadius, center);
    pPart->SketchManager.CreateSketchCircle(innerRadius, center);

    pPart->SetSolidProfile();
    CiExtrudeFeature baseFeature = pPart->FeatureManager.CreateExtrude(
        m_partData->Dim.t1, CiDirectionOpEnum::Positive, CiJoinOpEnum::Join, false);

    // Finger (slot) cuts
    int numFingers = 6;
    double fingerWidth = 2.0 * WasherConstants::PI * (innerRadius + outerRadius) / 2.0 / numFingers * 0.3;
    double fingerLength = (outerRadius - innerRadius) * 0.8;

    CiWorkPlane fingerPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ);
    pPart->SketchManager.StartSketch(fingerPlane);

    double midRadius = (innerRadius + outerRadius) / 2.0;
    CiSketchPoint fingerPts[4];
    fingerPts[0] = pPart->SketchManager.SetSketchPoint(midRadius - fingerLength / 2.0, -fingerWidth / 2.0);
    fingerPts[1] = pPart->SketchManager.SetSketchPoint(midRadius + fingerLength / 2.0, -fingerWidth / 2.0);
    fingerPts[2] = pPart->SketchManager.SetSketchPoint(midRadius + fingerLength / 2.0, fingerWidth / 2.0);
    fingerPts[3] = pPart->SketchManager.SetSketchPoint(midRadius - fingerLength / 2.0, fingerWidth / 2.0);

    pPart->SketchManager.CreateSketchLine(fingerPts[0], fingerPts[1]);
    pPart->SketchManager.CreateSketchLine(fingerPts[1], fingerPts[2]);
    pPart->SketchManager.CreateSketchLine(fingerPts[2], fingerPts[3]);
    pPart->SketchManager.CreateSketchLine(fingerPts[3], fingerPts[0]);

    pPart->SetSolidProfile();
    CiExtrudeFeature fingerFeature = pPart->FeatureManager.CreateExtrude(
        m_partData->Dim.t1 * 1.1, CiDirectionOpEnum::Positive, CiJoinOpEnum::Cut, true);

    return S_OK;
}

//=============================================================================
// 3. Optional Features
//=============================================================================
void WasherCreator::CreateOptionalFeatures(CiPart* pPart)
{
    if (m_options.isChamfered)
        CreateChamferFeature(pPart);

    if (m_options.isCountersunk && m_options.washerType != WasherType::Countersunk)
        CreateCountersinkFeature(pPart);
}

void WasherCreator::DrawOuterTeethLoop(CiPart* pPart, double R_Base, double R_Tip, int N, double tooth_w) // 베어링 톱니
{
    std::vector<CiSketchPoint> pts;
    double angleStep = 360.0 / (double)N;

    // 1. 남겨야 할 톱니의 반폭 (Half Width)
    double hW = tooth_w / 2.0;
    if (hW >= R_Base) hW = R_Base * 0.1;

    // 2. 톱니 옆면을 정의하는 로컬 X 좌표 (직사각형 유지를 위함)
    double xRoot = sqrt(R_Base * R_Base - hW * hW);
    double xTip = sqrt(R_Tip * R_Tip - hW * hW);

    // *중요*: Cut을 위한 Gap을 그리기 위해, "현재 톱니(i)"와 "다음 톱니(next)" 사이를 연결합니다.
    for (int i = 0; i < N; ++i)
    {
        pts.clear(); // 루프마다 점 초기화 (각 Gap은 독립된 폐곡선)

        int nextI = (i + 1) % N; // 다음 톱니 인덱스

        // [Angle A] 현재 톱니(i)의 중심각
        double rotAngA = (i * angleStep) * (M_PI / 180.0);
        double cosA = cos(rotAngA);
        double sinA = sin(rotAngA);

        // [Angle B] 다음 톱니(next)의 중심각
        double rotAngB = (nextI * angleStep) * (M_PI / 180.0);
        double cosB = cos(rotAngB);
        double sinB = sin(rotAngB);

        // --- 점 생성 순서 (반시계 방향) ---

        // 1. [Tooth A의 Right Tip] (Gap의 시작, 바깥쪽)
        // Tooth A의 윗면(Right Side)은 로컬 y = +hW 입니다.
        pts.push_back(pPart->SketchManager.SetSketchPoint(
            xTip * cosA - hW * sinA, xTip * sinA + hW * cosA));

        // 2. [Tooth A의 Right Root] (Gap의 안쪽으로 들어옴)
        // Tooth A의 윗면(Right Side)은 로컬 y = +hW 입니다.
        pts.push_back(pPart->SketchManager.SetSketchPoint(
            xRoot * cosA - hW * sinA, xRoot * sinA + hW * cosA));

        // 3. [Tooth B의 Left Root] (Gap의 건너편 안쪽)
        // Tooth B의 아랫면(Left Side)은 로컬 y = -hW 입니다.
        pts.push_back(pPart->SketchManager.SetSketchPoint(
            xRoot * cosB - (-hW) * sinB, xRoot * sinB + (-hW) * cosB));

        // 4. [Tooth B의 Left Tip] (Gap의 건너편 바깥쪽)
        // Tooth B의 아랫면(Left Side)은 로컬 y = -hW 입니다.
        pts.push_back(pPart->SketchManager.SetSketchPoint(
            xTip * cosB - (-hW) * sinB, xTip * sinB + (-hW) * cosB));

        // --- 선 연결 (Gap 하나 완성) ---
        // P1 -> P2 (Tooth A 옆면)
        // P2 -> P3 (이뿌리 바닥: 원호 대신 직선으로 연결하거나, 정밀하게 하려면 원호 추가 가능)
        // P3 -> P4 (Tooth B 옆면)
        // P4 -> P1 (바깥쪽 닫기)
        for (size_t k = 0; k < pts.size(); ++k) {
            pPart->SketchManager.CreateSketchLine(pts[k], pts[(k + 1) % pts.size()]);
        }
    }
}

void WasherCreator::DrawToothedLoop(CiPart* pPart, double R_Root, double R_Tip, int N) //외치형
{
    std::vector<CiSketchPoint> pts;

    double angleStep = 360.0 / (double)N; // 톱니 한 세트(톱니+틈)의 각도

    // ----------------------------------------------------------
    // [비율 설정] 1:1 비율 (이미지와 동일)
    // ----------------------------------------------------------
    // 톱니가 차지하는 각도와 빈 공간의 각도를 동일하게(0.5) 설정합니다.
    // 이렇게 해야 안쪽과 바깥쪽의 비율이 깨지지 않고 균일하게 나옵니다.
    double toothRatio = 0.5;

    double toothAngle = angleStep * toothRatio;        // 톱니 각도
    double halfToothAngle = toothAngle / 2.0;          // 중심에서 양옆으로 벌릴 각도

    // ----------------------------------------------------------
    // [루프 생성] 방사형(Radial) 로직
    // ----------------------------------------------------------
    for (int i = 0; i < N; ++i)
    {
        // 톱니의 중심 각도
        double centerAng = i * angleStep;

        // 중심을 기준으로 양쪽으로 각도를 벌림
        // 이렇게 하면 톱니의 옆면이 정확히 원의 중심을 향하게 됩니다.
        double angStart = centerAng - halfToothAngle;
        double angEnd = centerAng + halfToothAngle;

        // 라디안 변환
        double rStart = angStart * (M_PI / 180.0);
        double rEnd = angEnd * (M_PI / 180.0);

        // 점 4개 생성
        // P2와 P3(Tip)는 P1, P4(Root)와 '동일한 각도'를 가집니다.
        // 즉, 중심에서 일직선으로 뻗어나가는 형상입니다.

        // [P1] Root (이뿌리): 시작 각도
        pts.push_back(pPart->SketchManager.SetSketchPoint(
            R_Root * cos(rStart), R_Root * sin(rStart)));

        // [P2] Tip (이끝): 시작 각도 그대로 바깥으로 나감 (방사형 직선)
        pts.push_back(pPart->SketchManager.SetSketchPoint(
            R_Tip * cos(rStart), R_Tip * sin(rStart)));

        // [P3] Tip (이끝): 끝 각도 (호의 형태 유지)
        pts.push_back(pPart->SketchManager.SetSketchPoint(
            R_Tip * cos(rEnd), R_Tip * sin(rEnd)));

        // [P4] Root (이뿌리): 끝 각도 그대로 안으로 들어옴
        pts.push_back(pPart->SketchManager.SetSketchPoint(
            R_Root * cos(rEnd), R_Root * sin(rEnd)));
    }

    // 폐곡선 연결
    for (size_t i = 0; i < pts.size(); ++i)
    {
        size_t next = (i + 1) % pts.size();
        pPart->SketchManager.CreateSketchLine(pts[i], pts[next]);
    }
}

void WasherCreator::DrawInternalToothLoop(CiPart* pPart, double R_Tip, double R_Root, int N) // 내치형
{
    std::vector<CiSketchPoint> pts;
    double angleStep = 360.0 / (double)N;

    // 톱니(Tooth)와 틈(Gap)의 비율 1:1
    double toothRatio = 0.5;

    double toothAngle = angleStep * toothRatio;
    double halfToothAngle = toothAngle / 2.0;

    for (int i = 0; i < N; ++i)
    {
        // 톱니 중심 각도
        double centerAng = i * angleStep;

        // 중심 기준 양쪽으로 벌림 (방사형 직선 구조)
        double angStart = centerAng - halfToothAngle;
        double angEnd = centerAng + halfToothAngle;

        double rStart = angStart * (M_PI / 180.0);
        double rEnd = angEnd * (M_PI / 180.0);

        // 점 4개 생성 (내치형 순서: Root -> Tip -> Tip -> Root)
        // 톱니의 옆면이 원의 중심을 향해 직선으로 뻗는 구조입니다.

        // [P1] Root (이뿌리, 바깥쪽) - 시작
        pts.push_back(pPart->SketchManager.SetSketchPoint(
            R_Root * cos(rStart), R_Root * sin(rStart)));

        // [P2] Tip (이끝, 안쪽) - P1과 같은 각도 (직선)
        pts.push_back(pPart->SketchManager.SetSketchPoint(
            R_Tip * cos(rStart), R_Tip * sin(rStart)));

        // [P3] Tip (이끝, 안쪽) - P4와 같은 각도 (직선)
        pts.push_back(pPart->SketchManager.SetSketchPoint(
            R_Tip * cos(rEnd), R_Tip * sin(rEnd)));

        // [P4] Root (이뿌리, 바깥쪽) - 끝
        pts.push_back(pPart->SketchManager.SetSketchPoint(
            R_Root * cos(rEnd), R_Root * sin(rEnd)));
    }

    // 폐곡선 연결
    for (size_t i = 0; i < pts.size(); ++i)
    {
        size_t next = (i + 1) % pts.size();
        pPart->SketchManager.CreateSketchLine(pts[i], pts[next]);
    }
}

void WasherCreator::DrawRadialInternalLoop(CiPart* pPart, double R_Tip, double R_Root, int N) // 내외치형-내측
{
    std::vector<CiSketchPoint> pts;
    double angleStep = 360.0 / (double)N;
    double halfAngle = (angleStep * 0.5) / 2.0; // 1:1 비율

    for (int i = 0; i < N; ++i)
    {
        double centerAng = i * angleStep;
        double rStart = (centerAng - halfAngle) * (M_PI / 180.0);
        double rEnd = (centerAng + halfAngle) * (M_PI / 180.0);

        // 내치형 순서: Root(밖) -> Tip(안) -> Tip(안) -> Root(밖)
        pts.push_back(pPart->SketchManager.SetSketchPoint(R_Root * cos(rStart), R_Root * sin(rStart)));
        pts.push_back(pPart->SketchManager.SetSketchPoint(R_Tip * cos(rStart), R_Tip * sin(rStart)));
        pts.push_back(pPart->SketchManager.SetSketchPoint(R_Tip * cos(rEnd), R_Tip * sin(rEnd)));
        pts.push_back(pPart->SketchManager.SetSketchPoint(R_Root * cos(rEnd), R_Root * sin(rEnd)));
    }

    // 루프 닫기
    for (size_t i = 0; i < pts.size(); ++i) {
        pPart->SketchManager.CreateSketchLine(pts[i], pts[(i + 1) % pts.size()]);
    }
}

void WasherCreator::DrawRadialExternalLoop(CiPart* pPart, double R_Root, double R_Tip, int N) // 내외치형-외측
{
    std::vector<CiSketchPoint> pts;
    double angleStep = 360.0 / (double)N;
    double halfAngle = (angleStep * 0.5) / 2.0; // 1:1 비율

    for (int i = 0; i < N; ++i)
    {
        double centerAng = i * angleStep;
        double rStart = (centerAng - halfAngle) * (M_PI / 180.0);
        double rEnd = (centerAng + halfAngle) * (M_PI / 180.0);

        // 외치형 순서: Root(안) -> Tip(밖) -> Tip(밖) -> Root(안)
        pts.push_back(pPart->SketchManager.SetSketchPoint(R_Root * cos(rStart), R_Root * sin(rStart)));
        pts.push_back(pPart->SketchManager.SetSketchPoint(R_Tip * cos(rStart), R_Tip * sin(rStart)));
        pts.push_back(pPart->SketchManager.SetSketchPoint(R_Tip * cos(rEnd), R_Tip * sin(rEnd)));
        pts.push_back(pPart->SketchManager.SetSketchPoint(R_Root * cos(rEnd), R_Root * sin(rEnd)));
    }

    // 루프 닫기
    for (size_t i = 0; i < pts.size(); ++i) {
        pPart->SketchManager.CreateSketchLine(pts[i], pts[(i + 1) % pts.size()]);
    }
}

HRESULT WasherCreator::CreateChamferFeature(CiPart* pPart)
{
    double chamferSize = m_partData->Dim.c1 > 0 ? m_partData->Dim.c1 : m_partData->Dim.t1 * 0.1;
    return S_OK;
}

HRESULT WasherCreator::CreateCountersinkFeature(CiPart* pPart)
{
    return S_OK;
}

//=============================================================================
// 4. Apply Material
//=============================================================================
void WasherCreator::ApplyMaterial(CiPart* pPart)
{
    std::wstring matCode(m_partData->Info.Material);
    const wchar_t* invMaterial = WasherMaterials::GetInventorMaterial(matCode);
}

//=============================================================================
// Helper Functions
//=============================================================================
void WasherCreator::CreateAnnularProfile(CiPart* pPart, double innerDia, double outerDia)
{
    CiSketchPoint center = pPart->SketchManager.SetSketchPoint(0, 0);
    pPart->SketchManager.CreateSketchCircle(outerDia / 2.0, center);
    pPart->SketchManager.CreateSketchCircle(innerDia / 2.0, center);
}

//CiSketchLine WasherCreator::CreateSpringProfile(CiPart* pPart)
void WasherCreator::CreateSpringProfile(CiPart* pPart)
{
    double innerR = m_options.headTypeOption == SpecHeadTypeOption::Grade2 ? m_partData->Dim.d1 : m_partData->Dim.d2;
    double outerR = m_options.headTypeOption == SpecHeadTypeOption::Grade2 ? m_partData->Dim.DD1 : m_partData->Dim.DD2;
    double thickness = m_options.headTypeOption == SpecHeadTypeOption::Grade2 ? m_partData->Dim.t1 : m_partData->Dim.t2;

    CiWorkPlane sketchPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ);
    pPart->SketchManager.StartSketch(sketchPlane);

    // 2. 치수 계산
    double width = (outerR - innerR) / 2.0;       // 와셔 폭
    double meanRadius = (innerR + outerR) / 4.0;  // 중심 반경 (회전축에서 단면 중심까지 거리)

    // 3. 2D 스케치 작성 (축 + 단면)

    // [A] 회전축 (Center Axis) 그리기 - Y축
    // (0,0)에서 (0, 10) 정도 길이의 선 (길이는 중요하지 않음, 방향이 중요)
    CiSketchPoint axisStart = pPart->SketchManager.SetSketchPoint(0, 0);
    CiSketchPoint axisEnd = pPart->SketchManager.SetSketchPoint(0, thickness * 5.0);
    CiSketchLine  workAxis = pPart->SketchManager.CreateSketchLine(axisStart, axisEnd);

    // 이 선을 '회전축' 속성으로 설정해야 할 수도 있습니다 (API에 따라 다름)
    // 예: workAxis->SetConstruction(true);

    // [B] 단면 (Profile) 그리기 - 직사각형
    // 축에서 meanRadius만큼 떨어진 곳에 그림
    double halfW = width / 2.0;
    double halfT = thickness / 2.0;

    // 사각형의 두 대각 점
    CiSketchPoint rectP1 = pPart->SketchManager.SetSketchPoint(meanRadius - halfW, -halfT);
    CiSketchPoint rectP2 = pPart->SketchManager.SetSketchPoint(meanRadius + halfW, halfT);

    // 직사각형 생성
   // CiSketchLine axisLine = pPart->SketchManager.CreateSketchRect(rectP1, rectP2);
    pPart->SketchManager.CreateSketchRect(rectP1, rectP2);

    double pitch = thickness + (thickness * 0.2);
    double revolution = 1.0;
    pPart->SetSolidProfile();
    pPart->FeatureManager.CreateCoilByHeight(workAxis, pitch, revolution, CiJoinOpEnum::NewBody);

    // 프로파일 획득 (축을 제외한 닫힌 영역만 잡아야 함)
   // CiProfile pProfile = pPart->SetSolidProfile();
  //  // 원본===
  //  CiSketchPoint pts[5];
  //  pts[0] = pPart->SketchManager.SetSketchPoint(0, 0);
  //  pts[1] = pPart->SketchManager.SetSketchPoint(0, innerR);
  //  pts[2] = pPart->SketchManager.SetSketchPoint(meanRadius, outerR);
  //  pts[3] = pPart->SketchManager.SetSketchPoint(meanRadius + thickness, outerR);
  //  pts[4] = pPart->SketchManager.SetSketchPoint(thickness, innerR);

  //  pPart->SketchManager.CreateSketchLine(pts[0], pts[1]);
  //  pPart->SketchManager.CreateSketchLine(pts[1], pts[2]);
  //  pPart->SketchManager.CreateSketchLine(pts[2], pts[3]);
  //  pPart->SketchManager.CreateSketchLine(pts[3], pts[4]);
  //  CiSketchLine axisLine = pPart->SketchManager.CreateSketchLine(pts[4], pts[0]);
  ////----//

    // 4. 코일(Coil) 피쳐 생성
    // 2D 스케치만으로 3D 나선을 만듭니다.

    // 피치(Pitch): 한 바퀴 돌 때 올라가는 높이
    // 실제 스프링 와셔는 잘린 틈이 벌어져 있으므로, 두께보다 약간 커야 함.
  //  double pitch = thickness + (thickness * 0.2);

    // 회전수(Revolution): 딱 1바퀴
  //  double revolution = 1.0;

    /* [API 호출 가이드]
       CreateCoilFeature 함수의 인자는 보통 다음과 같습니다:
       1. Profile: 단면 (pProfile)
       2. Axis: 회전축 (workAxis 또는 Y축 벡터)
       3. Pitch: 피치
       4. Revolution: 회전수
       5. Operation: Join(생성) / Cut(제거)
    */

    // 예시 함수 호출 (사용하시는 라이브러리 명칭에 맞춰 수정 필요)
  //  pPart->CiFeature CreateCoilByRotate( pProfile,  workAxis,  pitch,  revolution, CiJoinOpEnum::NewBody );

 //   return axisLine;
}

CiSketchLine WasherCreator::CreateBellevilleProfile(CiPart* pPart)
{
    double innerR = m_partData->Dim.d1 / 2.0;
    double outerR = m_partData->Dim.DD1 / 2.0;
    double thickness = m_partData->Dim.t1;

    double coneHeight = m_partData->Dim.f > 0 ?
        m_partData->Dim.f : thickness * WasherConstants::WASHER_BELLEVILLE_HT_RATIO;

    CiSketchPoint pts[5];
    pts[0] = pPart->SketchManager.SetSketchPoint(0, 0);
    pts[1] = pPart->SketchManager.SetSketchPoint(0, innerR);
    pts[2] = pPart->SketchManager.SetSketchPoint(coneHeight, outerR);
    pts[3] = pPart->SketchManager.SetSketchPoint(coneHeight + thickness, outerR);
    pts[4] = pPart->SketchManager.SetSketchPoint(thickness, innerR);

    pPart->SketchManager.CreateSketchLine(pts[0], pts[1]);
    pPart->SketchManager.CreateSketchLine(pts[1], pts[2]);
    pPart->SketchManager.CreateSketchLine(pts[2], pts[3]);
    pPart->SketchManager.CreateSketchLine(pts[3], pts[4]);
    CiSketchLine axisLine = pPart->SketchManager.CreateSketchLine(pts[4], pts[0]);

    return axisLine;
}

void WasherCreator::CreateWaveProfile(CiPart* pPart)
{
    // Wave profile (simplified)
}

void WasherCreator::CreateToothProfile(CiPart* pPart, bool isInternal)
{
    double innerR = m_partData->Dim.d1 / 2.0;
    double outerR = m_partData->Dim.DD1 / 2.0;
    double toothDepth = (outerR - innerR) * WasherConstants::WASHER_TOOTH_DEPTH_RATIO;
}

void WasherCreator::SetWasherTypeFromPartCode()
{
    ATL::CString strPartCode(m_partData->Info.PartCode);
    strPartCode.MakeUpper();

    // PartCode matching (order matters - check longer strings first)
    // TAPERWAS - Taper Washer
    // TOEWAS   - Toenail Lock Washer (Internal Tooth)
    // TOGWAS   - Tongue Lock Washer (Tab)
    // TWAS     - Toothed Lock Washer (External Tooth)
    // DWAS     - Disc Spring Washer (Belleville)
    // SWAS     - Spring Washer
    // BWAS     - Bearing Washer (Bearing)
    // PWAS     - Plate Washer (Plain)

    if (strPartCode.Find(_T("TAPERWAS")) >= 0)
        m_options.washerType = WasherType::Taper;
    else if (strPartCode.Find(_T("TOEWAS")) >= 0)
        m_options.washerType = WasherType::ToothInternal;
    else if (strPartCode.Find(_T("TOGWAS")) >= 0)
        m_options.washerType = WasherType::Tab;
    else if (strPartCode.Find(_T("TWAS")) >= 0)
        m_options.washerType = WasherType::ToothExternal;
    else if (strPartCode.Find(_T("DWAS")) >= 0)
        m_options.washerType = WasherType::Belleville;
    else if (strPartCode.Find(_T("SWAS")) >= 0)
        m_options.washerType = WasherType::Spring;
    else if (strPartCode.Find(_T("BWAS")) >= 0)
        m_options.washerType = WasherType::Bearing;
    else if (strPartCode.Find(_T("PWAS")) >= 0)
        m_options.washerType = WasherType::Plain;
    else
        m_options.washerType = WasherType::Plain;
}

ATL::CString WasherCreator::FormatDouble(double value)
{
    ATL::CString str;
    str.Format(_T("%.10f"), value);
    str.TrimRight(_T('0'));
    str.TrimRight(_T('.'));
    return str;
}

void WasherCreator::SetHeadTypeOption()
{
    m_options.headTypeOption = HeadTypeOption(m_partData->Info.HeadType);
}