/**
 * @file NewCreateNutClass.cpp
 * @brief Unified Nut Creation System Implementation
 * @note Uses NutPartData/NutDimensions from PartData.h
 */
#include "stdafx.h"
#include "NewCreateNutClass.h"
#include <memory>
#include <cmath>

//=============================================================================
// CreateNut - Single Entry Point
//=============================================================================
#if defined(SDWORKS)
sdWrk::IComponent2Ptr NutCreator::CreateNut(std::map<std::string, std::string>& pDim, NutPartData& pd, double munit, const NutOptions& options)
#elif defined(ZW3D)
CiDragComponent NutCreator::CreateNut(std::map<std::string, std::string>& pDim, NutPartData& pd, double munit, const NutOptions& options)
#else
acInv::ComponentDefinitionPtr NutCreator::CreateNut(std::map<std::string, std::string>& pDim, NutPartData& pd, double munit, const NutOptions& options)
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

    // Auto-detect nut type from part code
    SetNutTypeFromPartCode();

    // Set pitch value (coarse/fine thread)
    m_pitchValue = m_partData->Dim.P1_UNC;
    ATL::CString strScrewType(m_partData->Info.ScrewType);
    strScrewType.Trim();
    // Check for fine thread
    if (strScrewType.Find(_T("가는나사")) >= 0)
    {
        m_pitchValue = m_partData->Dim.P2_UNF;
    }

    // Create part code
    ATL::CString partCode;
    partCode.Format(_T("M%sX%s_NUT"),
        FormatDouble(m_partData->Dim.d * m_unit),
        FormatDouble(m_pitchValue * m_unit));

    ATL::CString createPartName;
    createPartName.Format(_T("%s_%s"), partCode, m_partData->Info.Material);

    // Initialize Inventor document
    CiDocument::InitApplication(m_pApplication);
    CiAssembly NewComponent = CiDocument::GetDocumentEdit().CreateAssembly(partCode);
    CiPart pPart = NewComponent.CreatePart(partCode);

    // 1. Initialize
    Initialize(pDim);

    // 2. Create nut body (type-specific)
    CreateNutBody(&pPart);

    // 3. Create optional features
    CreateOptionalFeatures(&pPart);

    // 4. Create thread hole
    CreateThreadHole(&pPart);

    // 5. Create internal thread
    CreateInternalThread(pDim, &pPart);

    // 6. Create chamfers
    CreateChamfers(&pPart);

    // 7. Apply material
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
HRESULT NutCreator::Initialize(std::map<std::string, std::string>& pDim)
{
    return S_OK;
}

//=============================================================================
// 2. Create Nut Body (Type Dispatch)
// Supported PartCodes:
//   HNUT     - Hex Nut
//   ENUT     - Eye Nut (Hex base)
//   WNUT     - Wing Nut
//   TNUT     - T-Slot Nut
//   SQNUT    - Square Nut
//   CAPNUT   - Cap Nut
//   FLGNUT   - Flange Nut
//   HSNUT    - Hex Slotted Nut (Castle)
//   BENUT    - Special Nut (Hex base)
//   LOCKNUT  - Lock Nut (Nylon Insert)
//   PTNUT    - Prevailing Torque Nut (Nylon Insert)
//=============================================================================
HRESULT NutCreator::CreateNutBody(CiPart* pPart)
{
    switch (m_options.nutType)
    {
    case NutType::Hex:       // HNUT, BENUT
        return CreateHexNut(pPart);

    case NutType::HexFlange: // FLGNUT
        return CreateHexFlangeNut(pPart);

    case NutType::Square:    // SQNUT
        return CreateSquareNut(pPart);

    case NutType::Cap:       // CAPNUT
        return CreateCapNut(pPart);

    case NutType::NylonLock: // LOCKNUT, PTNUT
        return CreateNylonLockNut(pPart);

    case NutType::Castle:    // HSNUT
        return CreateCastleNut(pPart);

    case NutType::Eye:       // ENUT (Hex base)
        return CreateEyeNut(pPart);

    case NutType::Wing:      // WNUT
        return CreateWingNut(pPart);

    case NutType::TSlot:     // TNUT
        return CreateTSlotNut(pPart);

    default:
        return CreateHexNut(pPart);
    }
}

//=============================================================================
// 2-1. Hex Nut
//=============================================================================
HRESULT NutCreator::CreateHexNut(CiPart* pPart)
{
    const double chamferHeight =
        ((m_partData->Dim.C - m_partData->Dim.B) / 2.0) *
        tan(atan(1.0) / NutConstants::CHAMFER_30_DEG_FACTOR);

    // 1. 기초 치수 설정
    const double Height_H = (m_options.headTypeOption == SpecHeadTypeOption::Type3) ? m_partData->Dim.m1 : m_partData->Dim.m;
    const double flatWidth_S = m_partData->Dim.B;     // 평경 (맞변 거리)
    const double cornerDist_C = m_partData->Dim.C;   // 대각선 거리
    const double holeRadius = m_partData->Dim.d / 2.0; // 호칭경(M)의 절반


    // --- STEP 1: 육각형 본체 생성 (XZ 평면) ---
    CiWorkPlane xzPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ);
    pPart->SketchManager.StartSketch(xzPlane);

    CiSketchPoint pCenter = pPart->SketchManager.SetSketchPoint(0, 0);
    // 육각형의 꼭짓점 좌표 (대각선 거리의 절반)
    CiSketchPoint pCorner = pPart->SketchManager.SetSketchPoint(0, cornerDist_C / 2.0);
    pPart->SketchManager.CreateSketchPolygon(6, pCenter, pCorner, true);

    pPart->SetSolidProfile();
    // Negative 방향으로 높이 H만큼 돌출
    CiExtrudeFeature pBody = pPart->FeatureManager.CreateExtrude(Height_H, CiDirectionOpEnum::Negative);

    // --- STEP 2: 상단 챔퍼 컷팅 (YZ 평면에서 회전 컷) ---
    CiWorkPlane yzPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ);
    pPart->SketchManager.StartSketch(yzPlane);

    CiSketchPoint triUpper[3];
    // 삼각형 좌표: 너트 상단 바깥쪽 모서리를 깎아내는 형상
    triUpper[0] = pPart->SketchManager.SetSketchPoint(-Height_H, flatWidth_S * 0.5);
    triUpper[1] = pPart->SketchManager.SetSketchPoint(-(Height_H - chamferHeight), cornerDist_C * 0.5);
    triUpper[2] = pPart->SketchManager.SetSketchPoint(-Height_H, cornerDist_C * 0.5);

    pPart->SketchManager.CreateSketchLine(triUpper[0], triUpper[1]);
    pPart->SketchManager.CreateSketchLine(triUpper[1], triUpper[2]);
    pPart->SketchManager.CreateSketchLine(triUpper[2], triUpper[0]);

    pPart->SetSolidProfile();
    CiWorkAxis yAxis = pPart->WGManager.GetBaseAxis(CiBaseDirectionEnum::Y);
    pPart->FeatureManager.CreateRevolve(yAxis, CiJoinOpEnum::Cut);

    // --- STEP 3: 하단 챔퍼 컷팅 (선택 사항 또는 양면 처리) ---
    pPart->SketchManager.StartSketch(yzPlane);
    CiSketchPoint triLower[3];
    triLower[0] = pPart->SketchManager.SetSketchPoint(0, flatWidth_S * 0.5);
    triLower[1] = pPart->SketchManager.SetSketchPoint(-chamferHeight, cornerDist_C * 0.5);
    triLower[2] = pPart->SketchManager.SetSketchPoint(0, cornerDist_C * 0.5);

    pPart->SketchManager.CreateSketchLine(triLower[0], triLower[1]);
    pPart->SketchManager.CreateSketchLine(triLower[1], triLower[2]);
    pPart->SketchManager.CreateSketchLine(triLower[2], triLower[0]);

    pPart->SetSolidProfile();
    pPart->FeatureManager.CreateRevolve(yAxis, CiJoinOpEnum::Cut);

    // --- STEP 4: 중앙 관통 구멍 생성 ---
    pPart->SketchManager.StartSketch(xzPlane);
    CiSketchPoint holeCenter = pPart->SketchManager.SetSketchPoint(0, 0);
    pPart->SketchManager.CreateSketchCircle(holeRadius, holeCenter);

    pPart->SetSolidProfile();
    // 전체 관통 Cut
    pPart->FeatureManager.CreateExtrude(Height_H, CiDirectionOpEnum::Negative, CiJoinOpEnum::Cut);

    return S_OK;
}

//=============================================================================
// 2-2. Hex Flange Nut
//=============================================================================
HRESULT NutCreator::CreateHexFlangeNut(CiPart* pPart)
{
    CiWorkPlane xzPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ);
    pPart->SketchManager.StartSketch(xzPlane);

    double cornerDia = m_partData->Dim.e > 0 ? m_partData->Dim.e : GetHexCorner(m_partData->Dim.S);
    CiSketchPoint center = pPart->SketchManager.SetSketchPoint(0, 0);
    CiSketchPoint vertex = pPart->SketchManager.SetSketchPoint(0, cornerDia / 2.0);
    pPart->SketchManager.CreateSketchPolygon(6, center, vertex, true);

    pPart->SetSolidProfile();
    double flangeHeight = m_partData->Dim.a > 0 ? m_partData->Dim.a : m_partData->Dim.m * 0.2;
    double hexHeight = m_partData->Dim.m - flangeHeight;
    CiExtrudeFeature hexFeature = pPart->FeatureManager.CreateExtrude(
        hexHeight, CiDirectionOpEnum::Positive, CiJoinOpEnum::Join, false);

    CiWorkPlane bottomPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ);
    pPart->SketchManager.StartSketch(bottomPlane);

    CiSketchPoint flangeCenter = pPart->SketchManager.SetSketchPoint(0, 0);
    double flangeRadius = m_partData->Dim.dk > 0 ? m_partData->Dim.dk / 2.0 : cornerDia / 2.0 * 1.3;
    pPart->SketchManager.CreateSketchCircle(flangeRadius, flangeCenter);

    pPart->SetSolidProfile();
    CiExtrudeFeature flangeFeature = pPart->FeatureManager.CreateExtrude(
        flangeHeight, CiDirectionOpEnum::Negative, CiJoinOpEnum::Join, false);

    return S_OK;
}

//=============================================================================
// 2-3. Square Nut
//=============================================================================
HRESULT NutCreator::CreateSquareNut(CiPart* pPart)
{
    // 1. 치수 정의 (변수명은 데이터 구조에 맞게 매핑)
    const double widthAcrossFlats = m_partData->Dim.B; // B: 2면폭 (평면 간 거리)
    const double widthAcrossCorners = m_partData->Dim.C; // C: 대각 거리 (코너 간 거리)
    const double nutHeight = m_partData->Dim.m;        // m: 너트 높이 (H 대신 m 사용)
    const double tapDiameter = m_partData->Dim.d;      // d: 나사 호칭경

    // 2. 모따기(Chamfer) 높이 계산
    // 일반적으로 30도 모따기를 적용하거나, 규격에 따른 계수를 사용합니다.
    // 여기서는 tan(30도)를 기준으로 B(평면)에서 C(코너)까지 깎이는 깊이를 계산합니다.
    // (B/2 지점에서 시작하여 30도로 깎아내려갈 때의 높이)
    const double PI = 3.14159265358979323846;
    const double chamferAngle = 30.0 * (PI / 180.0);
    const double chamferDept = (widthAcrossFlats / 2.0) * tan(chamferAngle);

    //-------------------------------------------------------------------------
    // [Step 1] 너트 몸체 생성 (XZ 평면 스케치 -> Y축 돌출)
    //-------------------------------------------------------------------------
    CiWorkPlane xzPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ);
    pPart->SketchManager.StartSketch(xzPlane);

    // 사각형 그리기 (중심점, 2면폭의 절반 거리 이용)
    // CreateSketchPolygon(변의 수, 중심점, 반지름점, 내접/외접 여부)
    // 사각형의 경우 4변, 중심(0,0), 반지름은 외접원 기준일 경우 C/2, 내접원 기준일 경우 B/2
    // *API 특성에 따라 다를 수 있으나, 보통 Polygon은 외접원(Corner) 기준이 많습니다.
    CiSketchPoint pCenter = pPart->SketchManager.SetSketchPoint(0, 0);
    // 사각너트의 모서리가 X, Z축에 오도록 하려면 회전이 필요할 수 있습니다. 
    // 여기서는 단순히 C/2 지점을 찍어 사각형 생성
    CiSketchPoint pCorner = pPart->SketchManager.SetSketchPoint(0, widthAcrossCorners / 2.0);

    // 4각형 생성 (true/false는 내접/외접 여부 혹은 회전 여부 확인 필요, 여기서는 일반적 폴리곤 생성 가정)
    pPart->SketchManager.CreateSketchPolygon(4, pCenter, pCorner, true);

    pPart->SetSolidProfile();
    // Y축 음의 방향(Negative)으로 너트 높이만큼 돌출
    CiExtrudeFeature pBody = pPart->FeatureManager.CreateExtrude(nutHeight, CiDirectionOpEnum::Negative);


    //-------------------------------------------------------------------------
    // [Step 2] 나사 구멍 생성 (XZ 평면 스케치 -> 돌출 컷)
    //-------------------------------------------------------------------------
    pPart->SketchManager.StartSketch(xzPlane); // 같은 평면 재사용

    CiSketchPoint holeCenter = pPart->SketchManager.SetSketchPoint(0, 0);
    double holeRadius = tapDiameter / 2.0;

    pPart->SketchManager.CreateSketchCircle(holeRadius, holeCenter);

    pPart->SetSolidProfile();
    // 전체 관통 혹은 너트 높이만큼 Cut
    pPart->FeatureManager.CreateExtrude(nutHeight, CiDirectionOpEnum::Negative, CiJoinOpEnum::Cut);


    //-------------------------------------------------------------------------
    // [Step 3] 상단 모따기 (YZ 평면 스케치 -> 회전 컷)
    // 너트 상단면(Y=0)의 모서리를 둥글게 깎아내는 작업입니다.
    //-------------------------------------------------------------------------
    CiWorkPlane yzPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ);
    pPart->SketchManager.StartSketch(yzPlane);

    // 모따기 단면 삼각형 좌표 계산 (우측 상단 모서리를 깎아냄)
    // Y축이 회전축(x=0)입니다.
    // P1: 모따기 시작점 (상단면, 2면폭의 1/2 지점) -> 여기서부터 원형으로 깎임
    // P2: 모따기 바깥점 (상단면, 대각폭의 1/2 지점보다 약간 더 크게 잡음) -> 확실하게 자르기 위함
    // P3: 모따기 아래점 (측면, 각도에 따라 내려온 지점)

    double startX = widthAcrossFlats / 2.0;    // B/2
    double endX = widthAcrossCorners / 2.0;      // C/2 (코너 끝)

    // Y=0이 상단면이므로, 깎여나갈 부분은 삼각형입니다.
    // 하지만 "남겨질 부분"이 아니라 "제거할 부분(Cut)"을 그려야 합니다.
    // 제거할 부분: B/2 바깥쪽의 영역

    CiSketchPoint pts[3];

    // 1. 상단면의 내측 시작점 (접선 지점)
    pts[0] = pPart->SketchManager.SetSketchPoint(startX, 0);

    // 2. 상단면의 외측 끝점 (코너보다 멀리)
    pts[1] = pPart->SketchManager.SetSketchPoint(endX, 0);

    // 3. 아래쪽 점 (30도 각도로 내려오는 지점)
    // 삼각형을 그려서 회전시키면, B/2 지점부터 밖으로 갈수록 깎이는 원뿔이 생성됨
    // P1(startX, 0)과 P3를 잇는 선이 30도가 되어야 함.
    double cutDepth = (endX - startX) * tan(chamferAngle); // 기하학적 깊이 계산

    pts[2] = pPart->SketchManager.SetSketchPoint(endX, -cutDepth);

    // 삼각형 그리기
    pPart->SketchManager.CreateSketchLine(pts[0], pts[1]); // 상단 수평선
    pPart->SketchManager.CreateSketchLine(pts[1], pts[2]); // 외측 수직선
    pPart->SketchManager.CreateSketchLine(pts[2], pts[0]); // 경사선 (실제 깎이는 면)

    pPart->SetSolidProfile();

    // Y축을 기준으로 회전 컷 (Revolve Cut)
    CiWorkAxis yAxis = pPart->WGManager.GetBaseAxis(CiBaseDirectionEnum::Y);
    CiRevolveFeature chamferCut = pPart->FeatureManager.CreateRevolve(yAxis, CiJoinOpEnum::Cut);

    return S_OK;
}

//=============================================================================
// 2-4. Cap Nut
//=============================================================================
HRESULT NutCreator::CreateCapNut(CiPart* pPart)
{
    CiWorkPlane xzPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ);
    pPart->SketchManager.StartSketch(xzPlane);

    // 코너 직경(e) 계산 (값이 없으면 S/cos(30)로 자동 계산)
    double hexS = m_partData->Dim.S;
    double cornerDia = m_partData->Dim.e > 0 ? m_partData->Dim.e : (hexS / cos(30.0 * M_PI / 180.0));

    // 육각 스케치 (중심에서 코너까지)
    CiSketchPoint center = pPart->SketchManager.SetSketchPoint(0, 0);
    CiSketchPoint vertex = pPart->SketchManager.SetSketchPoint(0, cornerDia / 2.0);
    pPart->SketchManager.CreateSketchPolygon(6, center, vertex, true); // true: 내접/외접 여부 확인 필요 (보통 외접)

    pPart->SetSolidProfile();

    // 육각 높이(m) 만큼 돌출 (Join: 생성)
    double nutHeight = m_partData->Dim.m;
    CiExtrudeFeature hexFeature = pPart->FeatureManager.CreateExtrude(
        nutHeight, CiDirectionOpEnum::Positive, CiJoinOpEnum::NewBody, false);


    // ---------------------------------------------------------
    // 2. 상단 돔 (Dome Cap) 생성 - Revolve (Join)
    // ---------------------------------------------------------
    CiWorkPlane yzPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ);
    pPart->SketchManager.StartSketch(yzPlane);

    // 돔 치수 설정
    double domeH = m_partData->Dim.h1 > 0 ? m_partData->Dim.h1 : (m_partData->Dim.d * 0.5);
    double domeRadius = hexS / 2.0; // 보통 이면폭(S)의 절반을 돔의 바닥 반지름으로 함

    // 스케치 포인트 (육각 몸체 위쪽에서 시작)
    // P0: 회전 중심 축 상단 (nutHeight + domeH)
    // P1: 회전 중심 축 하단 (nutHeight) -> 육각 상단면 중심
    // P2: 돔 바닥 외곽 (nutHeight, S/2)

    CiSketchPoint p0 = pPart->SketchManager.SetSketchPoint(0, nutHeight + domeH);
    CiSketchPoint p1 = pPart->SketchManager.SetSketchPoint(0, nutHeight);
    CiSketchPoint p2 = pPart->SketchManager.SetSketchPoint(domeRadius, nutHeight);

    // 프로파일 생성 (중심축 -> 바닥선 -> 아크)
    CiSketchLine axisLine = pPart->SketchManager.CreateSketchLine(p0, p1); // 중심축
    pPart->SketchManager.CreateSketchLine(p1, p2); // 바닥 (육각면과 닿는 부분)

    // 돔 아크 (CreateSketchArc 파라미터 순서: Center, Start, End 가정)
    // 중심점이 Y축 선상 어딘가에 있어야 부드러운 돔이 됨.
    // 단순 반구(Hemisphere)라면 중심은 (0, nutHeight)
    // 접시형이라면 중심 계산 필요. 여기서는 단순화하여 3점 아크 혹은 타원형 아크 처리
    // (라이브러리에 따라 아크 생성 방식이 다르므로, 여기서는 3점 아크로 가정)
    pPart->SketchManager.CreateSketchArc(p1, p2, p0);

    pPart->SetSolidProfile();

    // 육각 몸체 위에 합치기 (Join)
    CiRevolveFeature revolveFeature = pPart->FeatureManager.CreateRevolve(axisLine, CiJoinOpEnum::Join);


    // ---------------------------------------------------------
    // 3. 내부 나사 구멍 (Thread Hole) - Extrude (Cut)
    // ---------------------------------------------------------
    // 다시 바닥 평면(XZ) 선택
    pPart->SketchManager.StartSketch(xzPlane);

    double threadDia = m_partData->Dim.d;
    double tapDepth = m_partData->Dim.H - (m_partData->Dim.t > 0 ? m_partData->Dim.t : 2.0); // 돔 두께 남기고 뚫기

    center = pPart->SketchManager.SetSketchPoint(0, 0);
    CiSketchPoint circleEdge = pPart->SketchManager.SetSketchPoint(threadDia / 2.0, 0);

    // 원 생성 (Center, Edge)
    pPart->SketchManager.CreateSketchCircle(threadDia, center); // 또는 CreateSketchArc(Full)

    pPart->SetSolidProfile();

    // 구멍 뚫기 (Cut)
    CiExtrudeFeature holeFeature = pPart->FeatureManager.CreateExtrude(
        tapDepth, CiDirectionOpEnum::Positive, CiJoinOpEnum::Cut, false);

    return S_OK;
}

//=============================================================================
// 2-5. Nylon Insert Lock Nut
//=============================================================================
HRESULT NutCreator::CreateNylonLockNut(CiPart* pPart)
{
    CiWorkPlane xzPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ);
    pPart->SketchManager.StartSketch(xzPlane);

    double cornerDia = m_partData->Dim.e > 0 ? m_partData->Dim.e : GetHexCorner(m_partData->Dim.S);
    CiSketchPoint center = pPart->SketchManager.SetSketchPoint(0, 0);
    CiSketchPoint vertex = pPart->SketchManager.SetSketchPoint(0, cornerDia / 2.0);
    pPart->SketchManager.CreateSketchPolygon(6, center, vertex, true);

    pPart->SetSolidProfile();
    double metalHeight = m_partData->Dim.m * (1.0 - NutConstants::NUT_NYLON_INSERT_RATIO);
    CiExtrudeFeature hexFeature = pPart->FeatureManager.CreateExtrude(
        metalHeight, CiDirectionOpEnum::Positive, CiJoinOpEnum::Join, false);

    CiWorkPlane topPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ, metalHeight);
    pPart->SketchManager.StartSketch(topPlane);

    CiSketchPoint nylonCenter = pPart->SketchManager.SetSketchPoint(0, 0);
    double nylonRadius = m_partData->Dim.S / 2.0;
    pPart->SketchManager.CreateSketchCircle(nylonRadius, nylonCenter);

    pPart->SetSolidProfile();
    double nylonHeight = m_partData->Dim.m * NutConstants::NUT_NYLON_INSERT_RATIO;
    CiExtrudeFeature nylonFeature = pPart->FeatureManager.CreateExtrude(
        nylonHeight, CiDirectionOpEnum::Positive, CiJoinOpEnum::Join, false);

    return S_OK;
}

//=============================================================================
// 2-6. Castle Nut
//=============================================================================
HRESULT NutCreator::CreateCastleNut(CiPart* pPart)
{
    CiWorkPlane xzPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ);
    pPart->SketchManager.StartSketch(xzPlane);

    double cornerDia = m_partData->Dim.e > 0 ? m_partData->Dim.e : GetHexCorner(m_partData->Dim.S);
    CiSketchPoint center = pPart->SketchManager.SetSketchPoint(0, 0);
    CiSketchPoint vertex = pPart->SketchManager.SetSketchPoint(0, cornerDia / 2.0);
    pPart->SketchManager.CreateSketchPolygon(6, center, vertex, true);

    double castleHeight = m_partData->Dim.kN > 0 ? m_partData->Dim.kN : m_partData->Dim.m * 0.3;
    double baseHeight = m_partData->Dim.m - castleHeight;

    pPart->SetSolidProfile();
    CiExtrudeFeature hexFeature = pPart->FeatureManager.CreateExtrude(
        baseHeight, CiDirectionOpEnum::Positive, CiJoinOpEnum::Join, false);

    CiWorkPlane topPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ, baseHeight);
    pPart->SketchManager.StartSketch(topPlane);

    CiSketchPoint castleCenter = pPart->SketchManager.SetSketchPoint(0, 0);
    double castleRadius = m_partData->Dim.eN > 0 ? m_partData->Dim.eN / 2.0 : m_partData->Dim.d * 0.8;
    pPart->SketchManager.CreateSketchCircle(castleRadius, castleCenter);

    pPart->SetSolidProfile();
    CiExtrudeFeature castleFeature = pPart->FeatureManager.CreateExtrude(
        castleHeight, CiDirectionOpEnum::Positive, CiJoinOpEnum::Join, false);

    CiWorkPlane slotPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ);
    pPart->SketchManager.StartSketch(slotPlane);

    double slotWidth = m_partData->Dim.t > 0 ? m_partData->Dim.t : m_pitchValue * 1.5;
    double slotDepth = castleHeight * NutConstants::NUT_CASTLE_SLOT_DEPTH;

    CiSketchPoint slotPts[4];
    slotPts[0] = pPart->SketchManager.SetSketchPoint(baseHeight, castleRadius * 0.6);
    slotPts[1] = pPart->SketchManager.SetSketchPoint(baseHeight + slotDepth, castleRadius * 0.6);
    slotPts[2] = pPart->SketchManager.SetSketchPoint(baseHeight + slotDepth, castleRadius + 0.1);
    slotPts[3] = pPart->SketchManager.SetSketchPoint(baseHeight, castleRadius + 0.1);

    pPart->SketchManager.CreateSketchLine(slotPts[0], slotPts[1]);
    pPart->SketchManager.CreateSketchLine(slotPts[1], slotPts[2]);
    pPart->SketchManager.CreateSketchLine(slotPts[2], slotPts[3]);
    pPart->SketchManager.CreateSketchLine(slotPts[3], slotPts[0]);

    pPart->SetSolidProfile();
    CiExtrudeFeature slotFeature = pPart->FeatureManager.CreateExtrude(
        slotWidth, CiDirectionOpEnum::Symmetry, CiJoinOpEnum::Cut, false);

    return S_OK;
}

//=============================================================================
// 2-7. Wing Nut
//=============================================================================
HRESULT NutCreator::CreateWingNut(CiPart* pPart)
{
    CiWorkPlane xzPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ);
    pPart->SketchManager.StartSketch(xzPlane);

    CiSketchPoint center = pPart->SketchManager.SetSketchPoint(0, 0);
    double bodyRadius = m_partData->Dim.d * 0.8;
    pPart->SketchManager.CreateSketchCircle(bodyRadius, center);

    pPart->SetSolidProfile();
    CiExtrudeFeature bodyFeature = pPart->FeatureManager.CreateExtrude(
        m_partData->Dim.m, CiDirectionOpEnum::Positive, CiJoinOpEnum::Join, false);

    double wingLength = m_partData->Dim.d * NutConstants::NUT_WING_LENGTH_RATIO;
    double wingWidth = m_partData->Dim.m * 0.8;
    double wingThickness = m_partData->Dim.d * 0.3;

    CiWorkPlane wingPlane1 = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ);
    pPart->SketchManager.StartSketch(wingPlane1);
    CreateWingProfile(pPart, wingLength, wingWidth, wingThickness);

    pPart->SetSolidProfile();
    CiExtrudeFeature wing1Feature = pPart->FeatureManager.CreateExtrude(
        wingThickness, CiDirectionOpEnum::Positive, CiJoinOpEnum::Join, false);

    CiWorkPlane wingPlane2 = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ);
    pPart->SketchManager.StartSketch(wingPlane2);
    CreateWingProfile(pPart, wingLength, wingWidth, -wingThickness);

    pPart->SetSolidProfile();
    CiExtrudeFeature wing2Feature = pPart->FeatureManager.CreateExtrude(
        wingThickness, CiDirectionOpEnum::Negative, CiJoinOpEnum::Join, false);

    return S_OK;
}

//=============================================================================
// 2-8. T-Slot Nut
//=============================================================================
HRESULT NutCreator::CreateTSlotNut(CiPart* pPart)
{
    CiWorkPlane yzPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ);
    pPart->SketchManager.StartSketch(yzPlane);

    double tWidth = m_partData->Dim.B > 0 ? m_partData->Dim.B : m_partData->Dim.S;
    double tHeight = m_partData->Dim.H > 0 ? m_partData->Dim.H : m_partData->Dim.m;
    double stemWidth = m_partData->Dim.d * 1.2;
    double stemHeight = tHeight * 0.6;

    CiSketchPoint pts[8];
    pts[0] = pPart->SketchManager.SetSketchPoint(-tWidth / 2, 0);
    pts[1] = pPart->SketchManager.SetSketchPoint(-tWidth / 2, tHeight - stemHeight);
    pts[2] = pPart->SketchManager.SetSketchPoint(-stemWidth / 2, tHeight - stemHeight);
    pts[3] = pPart->SketchManager.SetSketchPoint(-stemWidth / 2, tHeight);
    pts[4] = pPart->SketchManager.SetSketchPoint(stemWidth / 2, tHeight);
    pts[5] = pPart->SketchManager.SetSketchPoint(stemWidth / 2, tHeight - stemHeight);
    pts[6] = pPart->SketchManager.SetSketchPoint(tWidth / 2, tHeight - stemHeight);
    pts[7] = pPart->SketchManager.SetSketchPoint(tWidth / 2, 0);

    pPart->SketchManager.CreateSketchLine(pts[0], pts[1]);
    pPart->SketchManager.CreateSketchLine(pts[1], pts[2]);
    pPart->SketchManager.CreateSketchLine(pts[2], pts[3]);
    pPart->SketchManager.CreateSketchLine(pts[3], pts[4]);
    pPart->SketchManager.CreateSketchLine(pts[4], pts[5]);
    pPart->SketchManager.CreateSketchLine(pts[5], pts[6]);
    pPart->SketchManager.CreateSketchLine(pts[6], pts[7]);
    pPart->SketchManager.CreateSketchLine(pts[7], pts[0]);

    pPart->SetSolidProfile();
    CiExtrudeFeature extFeature = pPart->FeatureManager.CreateExtrude(
        m_partData->Dim.S, CiDirectionOpEnum::Symmetry, CiJoinOpEnum::Join, false);

    return S_OK;
}

//=============================================================================
// 2-9. Eye Nut
//=============================================================================
HRESULT NutCreator::CreateEyeNut(CiPart* pPart)
{
    CiWorkPlane xzPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ);
    pPart->SketchManager.StartSketch(xzPlane);

    double cornerDia = m_partData->Dim.e > 0 ? m_partData->Dim.e : GetHexCorner(m_partData->Dim.S);
    CiSketchPoint center = pPart->SketchManager.SetSketchPoint(0, 0);
    CiSketchPoint vertex = pPart->SketchManager.SetSketchPoint(0, cornerDia / 2.0);
    pPart->SketchManager.CreateSketchPolygon(6, center, vertex, true);

    pPart->SetSolidProfile();
    CiExtrudeFeature hexFeature = pPart->FeatureManager.CreateExtrude(
        m_partData->Dim.m, CiDirectionOpEnum::Positive, CiJoinOpEnum::Join, false);

    double weldDia = m_pitchValue;
    double weldHeight = m_pitchValue * 0.5;
    double weldRadius = m_partData->Dim.S / 2.0 * 0.6;

    CiWorkPlane bottomPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ);
    pPart->SketchManager.StartSketch(bottomPlane);

    CiSketchPoint weldCenter = pPart->SketchManager.SetSketchPoint(weldRadius, 0);
    pPart->SketchManager.CreateSketchCircle(weldDia / 2.0, weldCenter);

    pPart->SetSolidProfile();
    CiExtrudeFeature weldFeature = pPart->FeatureManager.CreateExtrude(
        weldHeight, CiDirectionOpEnum::Negative, CiJoinOpEnum::Join, false);

    return S_OK;
}


//=============================================================================
// 2-9. Weld Nut
//=============================================================================
HRESULT NutCreator::CreateWeldNut(CiPart* pPart)
{
    CiWorkPlane xzPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ);
    pPart->SketchManager.StartSketch(xzPlane);

    double cornerDia = m_partData->Dim.e > 0 ? m_partData->Dim.e : GetHexCorner(m_partData->Dim.S);
    CiSketchPoint center = pPart->SketchManager.SetSketchPoint(0, 0);
    CiSketchPoint vertex = pPart->SketchManager.SetSketchPoint(0, cornerDia / 2.0);
    pPart->SketchManager.CreateSketchPolygon(6, center, vertex, true);

    pPart->SetSolidProfile();
    CiExtrudeFeature hexFeature = pPart->FeatureManager.CreateExtrude(
        m_partData->Dim.m, CiDirectionOpEnum::Positive, CiJoinOpEnum::Join, false);

    double weldDia = m_pitchValue;
    double weldHeight = m_pitchValue * 0.5;
    double weldRadius = m_partData->Dim.S / 2.0 * 0.6;

    CiWorkPlane bottomPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ);
    pPart->SketchManager.StartSketch(bottomPlane);

    CiSketchPoint weldCenter = pPart->SketchManager.SetSketchPoint(weldRadius, 0);
    pPart->SketchManager.CreateSketchCircle(weldDia / 2.0, weldCenter);

    pPart->SetSolidProfile();
    CiExtrudeFeature weldFeature = pPart->FeatureManager.CreateExtrude(
        weldHeight, CiDirectionOpEnum::Negative, CiJoinOpEnum::Join, false);

    return S_OK;
}

//=============================================================================
// 2-10. Coupling Nut
//=============================================================================
HRESULT NutCreator::CreateCouplingNut(CiPart* pPart)
{
    CiWorkPlane xzPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ);
    pPart->SketchManager.StartSketch(xzPlane);

    double cornerDia = m_partData->Dim.e > 0 ? m_partData->Dim.e : GetHexCorner(m_partData->Dim.S);
    CiSketchPoint center = pPart->SketchManager.SetSketchPoint(0, 0);
    CiSketchPoint vertex = pPart->SketchManager.SetSketchPoint(0, cornerDia / 2.0);
    pPart->SketchManager.CreateSketchPolygon(6, center, vertex, true);

    double length = m_partData->Dim.H > 0 ? m_partData->Dim.H : m_partData->Dim.m * 3;

    pPart->SetSolidProfile();
    CiExtrudeFeature extFeature = pPart->FeatureManager.CreateExtrude(
        length, CiDirectionOpEnum::Positive, CiJoinOpEnum::Join, false);

    return S_OK;
}

//=============================================================================
// 2-11. Knurled Nut
//=============================================================================
HRESULT NutCreator::CreateKnurledNut(CiPart* pPart)
{
    CiWorkPlane xzPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ);
    pPart->SketchManager.StartSketch(xzPlane);

    CiSketchPoint center = pPart->SketchManager.SetSketchPoint(0, 0);
    double outerRadius = m_partData->Dim.S / 2.0;
    pPart->SketchManager.CreateSketchCircle(outerRadius, center);

    pPart->SetSolidProfile();
    CiExtrudeFeature bodyFeature = pPart->FeatureManager.CreateExtrude(
        m_partData->Dim.m, CiDirectionOpEnum::Positive, CiJoinOpEnum::Join, false);

    return S_OK;
}

//=============================================================================
// 2-12. Insert Nut
//=============================================================================
HRESULT NutCreator::CreateInsertNut(CiPart* pPart)
{
    CiWorkPlane xzPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ);
    pPart->SketchManager.StartSketch(xzPlane);

    CiSketchPoint center = pPart->SketchManager.SetSketchPoint(0, 0);
    double outerRadius = m_partData->Dim.S / 2.0;
    pPart->SketchManager.CreateSketchCircle(outerRadius, center);

    pPart->SetSolidProfile();
    CiExtrudeFeature bodyFeature = pPart->FeatureManager.CreateExtrude(
        m_partData->Dim.m, CiDirectionOpEnum::Positive, CiJoinOpEnum::Join, false);

    return S_OK;
}

//=============================================================================
// 2-13. Rivet Nut
//=============================================================================
HRESULT NutCreator::CreateRivetNut(CiPart* pPart)
{
    CiWorkPlane xzPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ);
    pPart->SketchManager.StartSketch(xzPlane);

    CiSketchPoint center = pPart->SketchManager.SetSketchPoint(0, 0);
    double flangeRadius = m_partData->Dim.dk > 0 ? m_partData->Dim.dk / 2.0 : m_partData->Dim.d * 1.5;
    pPart->SketchManager.CreateSketchCircle(flangeRadius, center);

    double flangeHeight = m_partData->Dim.a > 0 ? m_partData->Dim.a : m_partData->Dim.m * 0.2;
    pPart->SetSolidProfile();
    CiExtrudeFeature flangeFeature = pPart->FeatureManager.CreateExtrude(
        flangeHeight, CiDirectionOpEnum::Positive, CiJoinOpEnum::Join, false);

    CiWorkPlane bodyPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ, flangeHeight);
    pPart->SketchManager.StartSketch(bodyPlane);

    CiSketchPoint bodyCenter = pPart->SketchManager.SetSketchPoint(0, 0);
    double bodyRadius = m_partData->Dim.S / 2.0;
    pPart->SketchManager.CreateSketchCircle(bodyRadius, bodyCenter);

    pPart->SetSolidProfile();
    CiExtrudeFeature bodyFeature = pPart->FeatureManager.CreateExtrude(
        m_partData->Dim.m - flangeHeight, CiDirectionOpEnum::Positive, CiJoinOpEnum::Join, false);

    return S_OK;
}

//=============================================================================
// 2-14. Speed Nut
//=============================================================================
HRESULT NutCreator::CreateSpeedNut(CiPart* pPart)
{
    CiWorkPlane yzPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ);
    pPart->SketchManager.StartSketch(yzPlane);

    double width = m_partData->Dim.S;
    double height = m_partData->Dim.m;
    double thickness = m_pitchValue * 0.5;

    CiSketchPoint pts[8];
    pts[0] = pPart->SketchManager.SetSketchPoint(-width / 2, 0);
    pts[1] = pPart->SketchManager.SetSketchPoint(-width / 2, height);
    pts[2] = pPart->SketchManager.SetSketchPoint(-width / 2 + thickness, height);
    pts[3] = pPart->SketchManager.SetSketchPoint(-width / 2 + thickness, thickness);
    pts[4] = pPart->SketchManager.SetSketchPoint(width / 2 - thickness, thickness);
    pts[5] = pPart->SketchManager.SetSketchPoint(width / 2 - thickness, height);
    pts[6] = pPart->SketchManager.SetSketchPoint(width / 2, height);
    pts[7] = pPart->SketchManager.SetSketchPoint(width / 2, 0);

    pPart->SketchManager.CreateSketchLine(pts[0], pts[1]);
    pPart->SketchManager.CreateSketchLine(pts[1], pts[2]);
    pPart->SketchManager.CreateSketchLine(pts[2], pts[3]);
    pPart->SketchManager.CreateSketchLine(pts[3], pts[4]);
    pPart->SketchManager.CreateSketchLine(pts[4], pts[5]);
    pPart->SketchManager.CreateSketchLine(pts[5], pts[6]);
    pPart->SketchManager.CreateSketchLine(pts[6], pts[7]);
    pPart->SketchManager.CreateSketchLine(pts[7], pts[0]);

    pPart->SetSolidProfile();
    CiExtrudeFeature extFeature = pPart->FeatureManager.CreateExtrude(
        m_partData->Dim.d * 1.5, CiDirectionOpEnum::Symmetry, CiJoinOpEnum::Join, false);

    return S_OK;
}

//=============================================================================
// 3. Optional Features
//=============================================================================
void NutCreator::CreateOptionalFeatures(CiPart* pPart)
{
    if (m_options.hasFlange && m_options.nutType != NutType::HexFlange)
        CreateFlangeFeature(pPart);
    if (m_options.hasSerration)
        CreateSerrationFeature(pPart);
}

HRESULT NutCreator::CreateFlangeFeature(CiPart* pPart) { return S_OK; }
HRESULT NutCreator::CreateSerrationFeature(CiPart* pPart) { return S_OK; }

//=============================================================================
// 4. Thread Hole
//=============================================================================
HRESULT NutCreator::CreateThreadHole(CiPart* pPart)
{
    CiWorkPlane xzPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ);
    pPart->SketchManager.StartSketch(xzPlane);

    CiSketchPoint center = pPart->SketchManager.SetSketchPoint(0, 0);
    double holeRadius = (m_partData->Dim.d - NutConstants::THREAD_MINOR_DIA_FACTOR * m_pitchValue) / 2.0;
    pPart->SketchManager.CreateSketchCircle(holeRadius, center);

    pPart->SetSolidProfile();

    double holeDepth = m_partData->Dim.m * 1.1;
    if (m_options.nutType == NutType::Cap || m_options.nutType == NutType::Acorn)
        holeDepth = m_partData->Dim.m * 0.7;

    CiExtrudeFeature holeFeature = pPart->FeatureManager.CreateExtrude(
        holeDepth, CiDirectionOpEnum::Positive, CiJoinOpEnum::Cut, true);

    return S_OK;
}

//=============================================================================
// 5. Internal Thread
//=============================================================================
HRESULT NutCreator::CreateInternalThread(std::map<std::string, std::string>& pDim, CiPart* pPart)
{


    return S_OK;
}

//=============================================================================
// 6. Chamfers
//=============================================================================
HRESULT NutCreator::CreateChamfers(CiPart* pPart)
{
    double cornerDia = m_partData->Dim.e > 0 ? m_partData->Dim.e : GetHexCorner(m_partData->Dim.S);
    double chamferHeight = ((cornerDia - m_partData->Dim.d) / 2.0) *
        tan(atan(1.0) / NutConstants::CHAMFER_30_DEG_FACTOR);

    double outerR = cornerDia / 2.0;
    double nutHeight = m_partData->Dim.m;

    CiWorkPlane yzPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ);
    pPart->SketchManager.StartSketch(yzPlane);

    CiSketchPoint topPts[3];
    topPts[0] = pPart->SketchManager.SetSketchPoint(nutHeight, 0);
    topPts[1] = pPart->SketchManager.SetSketchPoint(nutHeight, outerR);
    topPts[2] = pPart->SketchManager.SetSketchPoint(nutHeight - chamferHeight, outerR);

    pPart->SketchManager.CreateSketchLine(topPts[0], topPts[1]);
    pPart->SketchManager.CreateSketchLine(topPts[1], topPts[2]);
    CiSketchLine topAxisLine = pPart->SketchManager.CreateSketchLine(topPts[2], topPts[0]);

    pPart->SetSolidProfile();
    CiRevolveFeature topChamfer = pPart->FeatureManager.CreateRevolve(topAxisLine);

    pPart->SketchManager.StartSketch(yzPlane);

    CiSketchPoint botPts[3];
    botPts[0] = pPart->SketchManager.SetSketchPoint(0, 0);
    botPts[1] = pPart->SketchManager.SetSketchPoint(0, outerR);
    botPts[2] = pPart->SketchManager.SetSketchPoint(chamferHeight, outerR);

    pPart->SketchManager.CreateSketchLine(botPts[0], botPts[1]);
    pPart->SketchManager.CreateSketchLine(botPts[1], botPts[2]);
    CiSketchLine botAxisLine = pPart->SketchManager.CreateSketchLine(botPts[2], botPts[0]);

    pPart->SetSolidProfile();
    CiRevolveFeature bottomChamfer = pPart->FeatureManager.CreateRevolve(botAxisLine);

    return S_OK;
}

//=============================================================================
// 7. Apply Material
//=============================================================================
void NutCreator::ApplyMaterial(CiPart* pPart)
{
    std::wstring matCode(m_partData->Info.Material);
    const wchar_t* invMaterial = NutMaterials::GetInventorMaterial(matCode);
}

//=============================================================================
// Helper Functions
//=============================================================================
void NutCreator::CreateHexProfile(CiPart* pPart, double cornerDia, bool inscribed)
{
    CiSketchPoint center = pPart->SketchManager.SetSketchPoint(0, 0);
    CiSketchPoint vertex = pPart->SketchManager.SetSketchPoint(0, cornerDia / 2.0);
    pPart->SketchManager.CreateSketchPolygon(6, center, vertex, inscribed);
}

void NutCreator::CreateSquareProfile(CiPart* pPart, double side)
{
    double half = side / 2.0;
    CiSketchPoint pts[4];
    pts[0] = pPart->SketchManager.SetSketchPoint(-half, -half);
    pts[1] = pPart->SketchManager.SetSketchPoint(half, -half);
    pts[2] = pPart->SketchManager.SetSketchPoint(half, half);
    pts[3] = pPart->SketchManager.SetSketchPoint(-half, half);

    for (int i = 0; i < 3; i++)
        pPart->SketchManager.CreateSketchLine(pts[i], pts[i + 1]);
    pPart->SketchManager.CreateSketchLine(pts[3], pts[0]);
}

CiSketchLine NutCreator::CreateDomeProfile(CiPart* pPart, double baseRadius, double domeRadius)
{
    double hexHeight = m_partData->Dim.m;

    CiSketchPoint pts[4];
    pts[0] = pPart->SketchManager.SetSketchPoint(0, 0);
    pts[1] = pPart->SketchManager.SetSketchPoint(0, baseRadius);
    pts[2] = pPart->SketchManager.SetSketchPoint(hexHeight, baseRadius);
    pts[3] = pPart->SketchManager.SetSketchPoint(hexHeight + domeRadius, 0);

    CiSketchPoint arcCenter = pPart->SketchManager.SetSketchPoint(hexHeight, 0);

    pPart->SketchManager.CreateSketchLine(pts[0], pts[1]);
    pPart->SketchManager.CreateSketchLine(pts[1], pts[2]);
    pPart->SketchManager.CreateSketchArc(arcCenter, pts[2], pts[3]);
    CiSketchLine axisLine = pPart->SketchManager.CreateSketchLine(pts[3], pts[0]);

    return axisLine;
}

void NutCreator::CreateWingProfile(CiPart* pPart, double length, double width, double thickness)
{
    double startX = m_partData->Dim.d * 0.4;
    double startY = m_partData->Dim.m * 0.2;

    CiSketchPoint pts[4];
    pts[0] = pPart->SketchManager.SetSketchPoint(startX, startY);
    pts[1] = pPart->SketchManager.SetSketchPoint(startX + length, startY);
    pts[2] = pPart->SketchManager.SetSketchPoint(startX + length, startY + width);
    pts[3] = pPart->SketchManager.SetSketchPoint(startX, startY + width);

    pPart->SketchManager.CreateSketchLine(pts[0], pts[1]);
    pPart->SketchManager.CreateSketchLine(pts[1], pts[2]);
    pPart->SketchManager.CreateSketchLine(pts[2], pts[3]);
    pPart->SketchManager.CreateSketchLine(pts[3], pts[0]);
}

void NutCreator::CreateChamfer30Profile(CiPart* pPart, double outerDia, double innerDia, double height, bool isTop)
{
    double outerR = outerDia / 2.0;
    double innerR = innerDia / 2.0;

    CiSketchPoint pts[3];
    if (isTop)
    {
        pts[0] = pPart->SketchManager.SetSketchPoint(0, innerR);
        pts[1] = pPart->SketchManager.SetSketchPoint(0, outerR);
        pts[2] = pPart->SketchManager.SetSketchPoint(-height, outerR);
    }
    else
    {
        pts[0] = pPart->SketchManager.SetSketchPoint(0, innerR);
        pts[1] = pPart->SketchManager.SetSketchPoint(0, outerR);
        pts[2] = pPart->SketchManager.SetSketchPoint(height, outerR);
    }

    pPart->SketchManager.CreateSketchLine(pts[0], pts[1]);
    pPart->SketchManager.CreateSketchLine(pts[1], pts[2]);
    pPart->SketchManager.CreateSketchLine(pts[2], pts[0]);
}

void NutCreator::SetNutTypeFromPartCode()
{
    ATL::CString strPartCode(m_partData->Info.PartCode);
    strPartCode.MakeUpper();

    // Primary matching: Exact PartCode prefixes
    // HNUT     - Hex Nut (standard)
    // ENUT     - Eye Nut
    // WNUT     - Wing Nut
    // TNUT     - T-Slot Nut
    // SQNUT    - Square Nut
    // CAPNUT   - Cap Nut (Acorn)
    // FLGNUT   - Flange Nut
    // HSNUT    - Hex Slotted Nut (Castle)
    // BENUT    - Belleville / Special Nut (treated as Hex)
    // LOCKNUT  - Lock Nut (Nylon Insert)
    // PTNUT    - Prevailing Torque Nut (treated as NylonLock)

    if (strPartCode.Find(_T("FLGNUT")) >= 0)
        m_options.nutType = NutType::HexFlange;
    else if (strPartCode.Find(_T("SQNUT")) >= 0)
        m_options.nutType = NutType::Square;
    else if (strPartCode.Find(_T("CAPNUT")) >= 0)
        m_options.nutType = NutType::Cap;
    else if (strPartCode.Find(_T("HSNUT")) >= 0)
        m_options.nutType = NutType::Castle;
    else if (strPartCode.Find(_T("LOCKNUT")) >= 0)
        m_options.nutType = NutType::NylonLock;
    else if (strPartCode.Find(_T("PTNUT")) >= 0)
        m_options.nutType = NutType::NylonLock;
    else if (strPartCode.Find(_T("WNUT")) >= 0)
        m_options.nutType = NutType::Wing;
    else if (strPartCode.Find(_T("TNUT")) >= 0)
        m_options.nutType = NutType::TSlot;
    else if (strPartCode.Find(_T("ENUT")) >= 0)
        m_options.nutType = NutType::Eye;
    else if (strPartCode.Find(_T("BENUT")) >= 0)
        m_options.nutType = NutType::Hex;
    else if (strPartCode.Find(_T("HNUT")) >= 0)
        m_options.nutType = NutType::Hex;
    // Fallback: default to Hex
    else
        m_options.nutType = NutType::Hex;
}

ATL::CString NutCreator::FormatDouble(double value)
{
    ATL::CString str;
    str.Format(_T("%.10f"), value);
    str.TrimRight(_T('0'));
    str.TrimRight(_T('.'));
    return str;
}

void NutCreator::SetHeadTypeOption()
{
    m_options.headTypeOption = HeadTypeOption(m_partData->Info.HeadType);
}