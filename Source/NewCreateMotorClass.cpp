/**
 * @file NewCreateMotorClass.cpp
 * @brief Motor creation implementation
 *
 * Dimension variable reference (MotorDimensions):
 *   S / S_h / S_l   - Frame width (square: S, rect: S_h x S_l)
 *   LM              - Motor body length
 *   LR              - Rear cover length
 *   LO              - Output shaft total protrusion length
 *   LO1_LLO         - Output shaft effective length (from flange face)
 *   LB              - Flange outer diameter (round) or diagonal (square)
 *   LB_h / LB_l     - Square flange height x width
 *   LE              - Flange thickness
 *   LB1/LE1~LB3/LE3 - Gearhead stage flange OD and thickness
 *   PCD_LA          - Mounting bolt hole PCD
 *   M_LZ            - Mounting bolt count (integer part) / size (fraction)
 *   TL_LG           - Tap depth or through-hole length
 *   U               - Output shaft diameter
 *   W               - Hollow shaft inner diameter
 *   T               - Shaft T dimension (keyway position)
 *   TM              - Center tap nominal diameter
 *   TapL            - Center tap depth
 *   KA              - Keyway width
 *   KE              - Keyway depth
 *   KL              - Keyway length
 *   QK              - Number of keys (1 or 2)
 *   RL1/RL2/RL3     - Gearhead stage 1/2/3 length
 *   SL              - Brake unit length
 *   EnH / EnL       - Encoder height (OD) / length
 *   ES_MD           - Encoder OD / servo body diameter
 *   CW_MW / CL_ML / CH_MH / CS  - Connector box W/L/H/offset
 */

#include "stdafx.h"
#include "NewCreateMotorClass.h"
#include <memory>
#include <unordered_map>
#include <cmath>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

//=============================================================================
// CreateMotor - single entry point
//=============================================================================

#if defined(SDWORKS)
sdWrk::IComponent2Ptr MotorCreator::CreateMotor(
    std::map<std::string, std::string>& pDim, MotorPartData& pd, double munit, const MotorOptions& options)
#elif defined(ZW3D)
CiDragComponent MotorCreator::CreateMotor(
    std::map<std::string, std::string>& pDim, MotorPartData& pd, double munit, const MotorOptions& options)
#else
acInv::ComponentDefinitionPtr MotorCreator::CreateMotor(
    std::map<std::string, std::string>& pDim, MotorPartData& pd, double munit, const MotorOptions& options)
#endif
{
    if (munit == 0.1)
        m_unit = 10.0;
    else if (munit == 0.01)
        m_unit = 100.0;
    else
        m_unit = munit;

    m_partData = &pd;
    m_options  = options;

    SetMotorBodyType();
    SetMotorFlangType();
    SetMotorOptions();
    SetMotorShaftType();

    ATL::CString partCode  = BuildPartCode();
    ATL::CString makername = _T("");
    makername.Format(_T("%s"), m_partData->Info.Lib_Maker);

    CiDocument::InitApplication(m_pApplication);
    CiAssembly NewComponent = CiDocument::GetDocumentEdit().CreateAssembly(partCode);
  //  CiPart     m_IFC        = NewComponent.CreatePart(partCode);

   // CreateMotorBody(&m_IFC);
   // CreateOutputFlange(&m_IFC);
  //  CreateOutputShaft(&m_IFC);
  //  CreateMountingHoles(&m_IFC);
  //  CreateRearCover(&m_IFC);

    // 어셈블리에 사용될 기준 평면 및 축 이름 (인벤터 기본 설정 기준)
    ATL::CString xAxisName = _T("X-Axis");
    ATL::CString yzPlaneName = _T("YZ");
    ATL::CString xzPlaneName = _T("XZ");
    ATL::CString xyPlaneName = _T("XY");

    // =========================================================================
    // [Case 1] 드라이브 박스 타입 (인버터, 서보 드라이브)
    // =========================================================================
    if (m_options.bodyType == MotorBodyType::Inverter ||
        m_options.bodyType == MotorBodyType::ServoDrive)
    {
        CiPart pDriveBox = NewComponent.CreatePart(partCode + _T("_DriveBox"));
        CreateDriveBoxBody(&pDriveBox); // 전용 바디 생성 함수
        //ApplyBodyMaterial(&pDriveBox, ...); // 공통 재질 함수 사용
        NewComponent.Insert(pDriveBox);
    }
    // =========================================================================
    // [Case 2] 리니어 모터 타입 (Track + Mover)
    // =========================================================================
    else if (m_options.bodyType == MotorBodyType::Linear)
    {
        // 1. 고정자(Track) 생성 및 삽입
        CiPart pTrack = NewComponent.CreatePart(partCode + _T("_Track"));
        CreateLinearMotorTrack(&pTrack);
        CiOccurrence occTrack = NewComponent.Insert(pTrack);

        // 2. 가동자(Mover) 생성 및 삽입
        CiPart pMover = NewComponent.CreatePart(partCode + _T("_Mover"));
        CreateLinearMotorMover(&pMover);
        CiOccurrence occMover = NewComponent.Insert(pMover);

        // 3. 조립 메이트 (AddDistanceMate 대신 offset 활용)
        double airGap = 1.0;
        // XY 평면 기준 높이(Air Gap) 설정
        NewComponent.MateManager.AddCoincidentByName(pTrack, occTrack, xyPlaneName, pMover, occMover, xyPlaneName, false, airGap);
        // XZ 평면 기준 좌우 중심 정렬
        NewComponent.MateManager.AddCoincidentByName(pTrack, occTrack, xzPlaneName, pMover, occMover, xzPlaneName, false, 0.0);
    }
    // =========================================================================
    // [Case 3] 일반 회전형 모터 (서보, 스텝, BLDC, DD, 기어드 등)
    // =========================================================================
    else
    {
        // 1. 모터 바디 파트 생성 (L1, L2, L3 다단 구조 반영)
        CiPart pMotorBody = NewComponent.CreatePart(partCode + _T("_Body"));
        CreateSquareFrameBody(&pMotorBody);
        CiOccurrence occMotorBody = NewComponent.Insert(pMotorBody);

        PrintDocumentMaterials(&pMotorBody);

        // DD 모터가 아닐 때만 축(Shaft) 생성
        if (m_options.bodyType != MotorBodyType::DirectDrive)
        {
            // 2. 모터 축 파트 생성 (Keyway, Tap 등 Enum 옵션 반영)
            CiPart pMotorShaft = NewComponent.CreatePart(partCode + _T("_Shaft"));
            CreateOutputShaft(&pMotorShaft);
            CiOccurrence occMotorShaft = NewComponent.Insert(pMotorShaft);

            // 축 메이트: 동심 및 면 일치
            NewComponent.MateManager.AddCoincidentByName(pMotorBody, occMotorBody, pMotorShaft, occMotorShaft, xAxisName, false);
            NewComponent.MateManager.AddCoincidentByName(pMotorBody, occMotorBody, pMotorShaft, occMotorShaft, yzPlaneName, false);
        }

        // 3. 감속기 파트 (hasGearhead 옵션 시)
        if (m_options.hasGearhead) {
            CiPart pReducer = NewComponent.CreatePart(partCode + _T("_Reducer"));
            CreateGearheadSection(&pReducer);
            CiOccurrence occReducer = NewComponent.Insert(pReducer);
            NewComponent.MateManager.AddCoincidentByName(pMotorBody, occMotorBody, pReducer, occReducer, xAxisName, false);
        }

        // -------------------------------------------------------------------------
        // ★ 4. 피그테일 커넥터 (케이블 및 플러그) 생성 및 조립
        // -------------------------------------------------------------------------
        // pMotorBody(대상 파트)와 occMotorBody(대상 인스턴스)를 모두 넘겨줍니다.
        ExecutePigtailAssembly(NewComponent, pMotorBody, occMotorBody, partCode);

        //// 4. 컨넥터 박스 (스키마 치수 존재 시)
        //if (m_partData->Dim.CW_MW > 0) {
        //    CiPart pConnector = NewComponent.CreatePart(partCode + _T("_Connector"));
        //    CreateConnectorBoxes(&pConnector);
        //    CiOccurrence occConnector = NewComponent.Insert(pConnector);

        //    // [1] 앞뒤 위치 구속 (X축): YZ 평면 메이트 + offset(거리)
        //    // 바디가 -X 방향이므로 커넥터를 뒤쪽(-L2) 근처로 오프셋
        //    double ml = m_partData->Dim.CL_ML;
        //    double L2 = m_partData->Dim.L2;
        //    if (L2 <= 0.0) L2 = m_partData->Dim.L1_LL * 0.7; // 방어 로직

        //    double posX = -(L2 - (ml / 2.0));
        //    NewComponent.MateManager.AddCoincidentByName(
        //        pMotorBody, occMotorBody,
        //        pConnector, occConnector,
        //        yzPlaneName, false, posX
        //    );

        //    // [2] 높이 위치 구속 (Y축): XZ 평면 메이트 + offset(거리)
        //    // 모터 프레임 높이의 절반 위치에 얹음
        //    double frameH = m_partData->Dim.LH > 0.0 ? m_partData->Dim.LH : m_partData->Dim.LC;
        //    double posY = frameH / 2.0;

        //    NewComponent.MateManager.AddCoincidentByName(
        //        pMotorBody, occMotorBody,
        //        pConnector, occConnector,
        //        xzPlaneName, false, posY
        //    );

        //    // [3] 좌우 위치 구속 (Z축): XY 평면 메이트 + offset(거리)
        //    // 커넥터 Z축 편심(ES_MD) 값 적용
        //    double es_md = m_partData->Dim.ES_MD;
        //    NewComponent.MateManager.AddCoincidentByName(
        //        pMotorBody, occMotorBody,
        //        pConnector, occConnector,
        //        xyPlaneName, false, es_md
        //    );
        //}
    }

    // BOM info
    {
        ATL::CString bomPartName;
        bomPartName.Format(_T("%s"), m_partData->Info.PartName);

        ATL::CString bomMaterial;
        bomMaterial.Format(_T("%s"), m_partData->Info.Lib_Maker);

        ATL::CString bomSpec;
        bomSpec.Format(_T("%s [%s / %s]"),
            m_partData->Info.Motor_Model,
            m_partData->Info.Motor_Size,
            m_partData->Info.Rated_Power);

        ATL::CString bomStandard;
        bomStandard.Format(_T("%s"), m_partData->Info.Lib_Maker);

        //m_IFC.WritePartBomInfo(bomPartName, bomMaterial, bomSpec, bomStandard);
        NewComponent.WritePartBomInfo(bomPartName, bomMaterial, bomSpec, bomStandard);
    }

    //CiOccurrence pOcc = NewComponent.Insert(m_IFC);

#ifdef ZW3D
    NewComponent.FlushBomInfo();
#endif

    return NewComponent.GetDragDef();
}

////=============================================================================
//// 어셈블리 내 피그테일 조립 (스윕 케이블 + IX40/M23 커넥터 적용)
////=============================================================================
//HRESULT MotorCreator::AssemblePigtailConnectors(CiAssembly& NewComp, CiPart& pMotorBody, CiOccurrence& occBody, ATL::CString partCode)
//{
//    // 1. 필요한 치수 정의 (m_partData에서 직접 추출)
//    double frameW = m_partData->Dim.LC;
//    // ★ frameH 정의: LH가 있으면 사용하고, 없으면 LC(정사각형)를 사용
//    double frameH = (m_partData->Dim.LH > 0.0) ? m_partData->Dim.LH : frameW;
//
//    double L1 = (m_partData->Dim.L1_LL > 0) ? m_partData->Dim.L1_LL : m_partData->Dim.LX;
//    double L2 = (m_partData->Dim.L2 > 0.0) ? m_partData->Dim.L2 : m_partData->Dim.LM;
//
//    // 엔코더 캡 시작 위치 (브레이크 길이를 고려하거나 기본값 적용)
//    double brakeLen = m_partData->Dim.SL;
//    double encStartPos = L2 + (brakeLen > 0 ? brakeLen : 25.0 / m_unit);
//
//    double cableLen = 300.0 / m_unit;
//    double outletH = 5.0 / m_unit; // 본체 인출부 두께
//
//    // 공통 참조 평면 이름
//    ATL::CString plnXY = _T("XY");
//    ATL::CString plnYZ = _T("YZ");
//    ATL::CString plnXZ = _T("XZ");
//
//    // -------------------------------------------------------------------------
//    // 2. 파워 라인 (본체 -> 인출부 -> 스윕 전선 -> 커넥터)
//    // -------------------------------------------------------------------------
//    // 2-1. 파워 전선 인출부 (Outlet)
//    CiPart pPwrOutlet = NewComp.CreatePart(partCode + _T("_PwrOutlet"));
//    CreateLeadOutletPart(&pPwrOutlet, 8.0 / m_unit, outletH);
//    CiOccurrence oPwrOutlet = NewComp.Insert(pPwrOutlet);
//    NewComp.MateManager.AddCoincidentByName(pMotorBody, occBody, pPwrOutlet, oPwrOutlet, plnYZ, false, -encStartPos);
//    NewComp.MateManager.AddCoincidentByName(pMotorBody, occBody, pPwrOutlet, oPwrOutlet, plnXZ, false, (frameW / 4.0));
//    NewComp.MateManager.AddCoincidentByName(pMotorBody, occBody, pPwrOutlet, oPwrOutlet, plnXY, false, (frameH / 2.0));
//
//    // 2-2. 파워 전선 (★ CreateSweptCablePart 호출)
//    CiPart pPwrCable = NewComp.CreatePart(partCode + _T("_PwrCable"));
//    CreateSweptCablePart(&pPwrCable, 5.0 / m_unit, cableLen, _T("Pwr_Wire"), _T("Rubber - Black"));
//    CiOccurrence oPwrCable = NewComp.Insert(pPwrCable);
//    // 인출부 끝면에 조립
//    NewComp.MateManager.AddCoincidentByName(pPwrOutlet, oPwrOutlet, pPwrCable, oPwrCable, plnYZ, false, outletH);
//    NewComp.MateManager.AddCoincidentByName(pPwrOutlet, oPwrOutlet, pPwrCable, oPwrCable, plnXZ, false, 0.0);
//    NewComp.MateManager.AddCoincidentByName(pPwrOutlet, oPwrOutlet, pPwrCable, oPwrCable, plnXY, false, 0.0);
//
//    // -------------------------------------------------------------------------
//    // 3. 엔코더 라인 (본체 -> 인출부 -> 스윕 전선 -> IX40 커넥터)
//    // -------------------------------------------------------------------------
//    // 3-1. 엔코더 전선 인출부
//    CiPart pEncOutlet = NewComp.CreatePart(partCode + _T("_EncOutlet"));
//    CreateLeadOutletPart(&pEncOutlet, 7.0 / m_unit, outletH);
//    CiOccurrence oEncOutlet = NewComp.Insert(pEncOutlet);
//    NewComp.MateManager.AddCoincidentByName(pMotorBody, occBody, pEncOutlet, oEncOutlet, plnYZ, false, -encStartPos);
//    NewComp.MateManager.AddCoincidentByName(pMotorBody, occBody, pEncOutlet, oEncOutlet, plnXZ, false, -(frameW / 4.0));
//    NewComp.MateManager.AddCoincidentByName(pMotorBody, occBody, pEncOutlet, oEncOutlet, plnXY, false, (frameH / 2.0));
//
//    // 3-2. 엔코더 전선 (★ CreateSweptCablePart 호출)
//    CiPart pEncCable = NewComp.CreatePart(partCode + _T("_EncCable"));
//    CreateSweptCablePart(&pEncCable, 4.0 / m_unit, cableLen, _T("Enc_Wire"), _T("Rubber - Black"));
//    CiOccurrence oEncCable = NewComp.Insert(pEncCable);
//    NewComp.MateManager.AddCoincidentByName(pEncOutlet, oEncOutlet, pEncCable, oEncCable, plnYZ, false, outletH);
//    NewComp.MateManager.AddCoincidentByName(pEncOutlet, oEncOutlet, pEncCable, oEncCable, plnXZ, false, 0.0);
//    NewComp.MateManager.AddCoincidentByName(pEncOutlet, oEncOutlet, pEncCable, oEncCable, plnXY, false, 0.0);
//
//    // 3-3. IX40 엔코더 커넥터 (플러그)
//    CiPart pEncPlug = NewComp.CreatePart(partCode + _T("_IX40_Plug"));
//    // 케이블 끝 좌표(스윕의 끝점)를 고려하여 파트 생성 (0,0,0 기준으로 생성 후 조립)
//    CreateIX40ConnectorPart(&pEncPlug, 0, 0, 0, _T("IX40_Plug"));
//    CiOccurrence oEncPlug = NewComp.Insert(pEncPlug);
//
//    // 스윕 케이블의 끝 지점은 좌표 계산이 복잡하므로, 
//    // 간소화된 설계에서는 케이블 파트의 원점 평면에서 오프셋 조립을 수행합니다.
//    NewComp.MateManager.AddCoincidentByName(pEncCable, oEncCable, pEncPlug, oEncPlug, plnYZ, false, cableLen);
//    NewComp.MateManager.AddCoincidentByName(pEncCable, oEncCable, pEncPlug, oEncPlug, plnXZ, false, 0.0);
//    NewComp.MateManager.AddCoincidentByName(pEncCable, oEncCable, pEncPlug, oEncPlug, plnXY, false, 0.0);
//
//    return S_OK;
//}

//=============================================================================
// 5. [조립 로직] 본체 + 인출부 + ㄱ자 전선 + 플러그 어셈블리
//=============================================================================
//=============================================================================
// [조립 로직] 인출부 + 계단형(Step) 케이블 + IX40 커넥터 메이트
//=============================================================================
HRESULT MotorCreator::ExecutePigtailAssembly(CiAssembly& NewComp, CiPart& pMotorBody, CiOccurrence& occBody, ATL::CString partCode)
{
    //// =======================================================================
    //// [1] _EncOutlet 조립 (가장 먼저 모터 본체에 붙음)
    //// =======================================================================
    //CiPart pEncOutlet = NewComp.CreatePart(partCode + _T("_EncOutlet"));
    //CreateLeadOutletPart(&pEncOutlet, 7.0 / m_unit, 5.0 / m_unit);
    //CiOccurrence oEncOutlet = NewComp.Insert(pEncOutlet);

    //// 모터 바디의 "Encoder_Terminal_Base"와 Outlet 평면 결합
    //NewComp.MateManager.AddCoincidentByName(pMotorBody, occBody, _T("Encoder_Terminal_Base"), pEncOutlet, oEncOutlet, _T("YZ"), false, 0.0);
    //// 축 정렬
    //NewComp.MateManager.AddCoincidentByName(pMotorBody, occBody, _T("Encoder_Terminal_Axis"), pEncOutlet, oEncOutlet, _T("X-Axis"), false, 0.0);

    // 1. 케이블 생성 및 조립
    CiPart pEncCable = NewComp.CreatePart(partCode + _T("_EncCable"));
    CreateStepCablePart(&pEncCable, 4.0 / m_unit, _T("Enc_Wire"), _T("고무 - 검은색"));
    CiOccurrence oEncCable = NewComp.Insert(pEncCable);

    // 모터 본체의 Encoder_Terminal_Base(XY)와 케이블의 시작면(XY) 조립
    NewComp.MateManager.AddCoincidentByName(pMotorBody, occBody, _T("Encoder_Terminal_Base"),
        pEncCable, oEncCable, _T("Cable-Start-Plane"), false, 0.0);

    // 모터 본체의 Encoder_Terminal_Axis(Y축)와 케이블의 시작축(Y축) 조립
    NewComp.MateManager.AddCoincidentByName(pMotorBody, occBody, _T("Encoder_Terminal_Axis"),
        pEncCable, oEncCable, _T("Cable-Start-Axis"), false, 0.0);

    // =======================================================================
    // [3] _IX40 플러그 조립 (Cable 끝단에 이어서 붙음)
    // =======================================================================
    CiPart pEncPlug = NewComp.CreatePart(partCode + _T("_IX40"));
    CreateDetailedIX40Part(&pEncPlug);
    CiOccurrence oEncPlug = NewComp.Insert(pEncPlug);

    // 케이블 끝면(Cable-End-Plane) <-> 플러그 베이스(Plug-Base-Plane) 조립
    NewComp.MateManager.AddCoincidentByName(pEncCable, oEncCable, _T("Cable-End-Plane"), pEncPlug, oEncPlug, _T("Plug-Base-Plane"), true, 0.0);
    NewComp.MateManager.AddCoincidentByName(pEncCable, oEncCable, _T("Cable-End-Axis"), pEncPlug, oEncPlug, _T("Plug-Axis"), true, 0.0);

    return S_OK;
}

//=============================================================================
// Option auto-resolution
//=============================================================================

//=============================================================================
// 1. 모터 바디 및 구동 타입 설정 (문자열 파싱 기반)
//=============================================================================
void MotorCreator::SetMotorBodyType()
{
    ATL::CString code = _T("");
    code.Format(_T("%s"), m_partData->Info.PartCode);
    code.Trim();
    code.MakeUpper();

    // 1. 제어기 및 전장품 그룹
    if (code.Find(_T("INVERTER")) >= 0)      m_options.bodyType = MotorBodyType::Inverter;
    else if (code.Find(_T("DRIVE")) >= 0)         m_options.bodyType = MotorBodyType::ServoDrive;

    // 2. 특수 및 직동형 모터 그룹
    else if (code.Find(_T("LINEAR_ACT")) >= 0)    m_options.bodyType = MotorBodyType::LinearActuator;
    else if (code.Find(_T("LINEAR")) >= 0)        m_options.bodyType = MotorBodyType::Linear;
    else if (code.Find(_T("DD")) >= 0 ||
        code.Find(_T("DIRECT")) >= 0)        m_options.bodyType = MotorBodyType::DirectDrive;
    else if (code.Find(_T("VOICE")) >= 0 ||
        code.Find(_T("VCM")) >= 0)           m_options.bodyType = MotorBodyType::VoiceCoil;

    // 3. 일반 회전형 모터 그룹
    else if (code.Find(_T("SERVO")) >= 0)         m_options.bodyType = MotorBodyType::Servo;
    else if (code.Find(_T("STEP")) >= 0)          m_options.bodyType = MotorBodyType::Stepper;
    else if (code.Find(_T("BLDC")) >= 0)          m_options.bodyType = MotorBodyType::BLDC;
    else if (code.Find(_T("SPINDLE")) >= 0)       m_options.bodyType = MotorBodyType::Spindle;
    else if (code.Find(_T("FAN")) >= 0)           m_options.bodyType = MotorBodyType::Fan;
    else if (code.Find(_T("CORELESS")) >= 0)      m_options.bodyType = MotorBodyType::Coreless;
    else if (code.Find(_T("AC_IND")) >= 0)        m_options.bodyType = MotorBodyType::ACInduction;
    else if (code.Find(_T("DC")) >= 0)            m_options.bodyType = MotorBodyType::DC;

    // 4. 유공압 및 기계식 구동 그룹
    else if (code.Find(_T("PNEUMATIC")) >= 0 ||
        code.Find(_T("AIR")) >= 0)           m_options.bodyType = MotorBodyType::Pneumatic;
    else if (code.Find(_T("HYDRAULIC")) >= 0)     m_options.bodyType = MotorBodyType::Hydraulic;

    // 5. 기어헤드(감속기) 전용
    else if (code.Find(_T("GEAR")) >= 0)          m_options.bodyType = MotorBodyType::Gearhead;

    // 예외 처리: 기본형
    else m_options.bodyType = MotorBodyType::Servo;
}

//=============================================================================
// 2. 출력축 형상(가공) 타입 설정
//=============================================================================
void MotorCreator::SetMotorShaftType()
{
    ATL::CString shaft_End = _T("");
    shaft_End.Format(_T("%s"), m_partData->Info.Shaft_End);
    shaft_End.MakeUpper(); // 영어 대문자 통일 (D-CUT, HOLLOW 등)

    // 띄어쓰기로 인한 검색 오류 방지를 위해 공백 모두 제거
    ATL::CString checkStr = shaft_End;
    checkStr.Remove(_T(' '));

    // ==========================================================
    // 1. 단일 의미를 갖는 명확한 기호 우선 처리
    // ==========================================================
    if (checkStr.Find(_T("HOLLOW")) >= 0) {
        m_options.shaftType = MotorShaftType::Hollow;
        return;
    }
    if (checkStr.Find(_T("6:")) >= 0) { // 스트레이트. 키 및 탭 있음
        m_options.shaftType = MotorShaftType::Keyway_And_Tap;
        return;
    }
    if (checkStr.Find(_T("0:")) >= 0) { // 플랜지 출력
        m_options.shaftType = MotorShaftType::Flange;
        return;
    }
    if (checkStr.Find(_T("C:")) >= 0) { // 테이퍼 & 키 있음
        m_options.shaftType = MotorShaftType::Taper_And_Key; // (Enum 필요시 추가)
        return;
    }
    if (checkStr.Find(_T("GU:")) >= 0 || checkStr.Find(_T("GN:")) >= 0 || checkStr.Find(_T("GE:")) >= 0) {
        m_options.shaftType = MotorShaftType::Gear_Pinion; // 기어헤드 결합용 피니언
        return;
    }
    if (checkStr.Find(_T("W:")) >= 0 || checkStr.Find(_T("10:")) >= 0) {
        m_options.shaftType = MotorShaftType::DoubleShaft; // 양축
        return;
    }
    if (checkStr.Find(_T("L:")) >= 0) {
        m_options.shaftType = MotorShaftType::L_Cut; // L컷 축
        return;
    }

    // ==========================================================
    // 2. 1차 기호(A, B, N 등) + 2차 설명(플랫, 키 등) 기반 복합 분기
    // ==========================================================

    // [A: 기호]
    if (checkStr.Find(_T("A:")) >= 0) {
        if (checkStr.Find(_T("플랫")) >= 0) {
            m_options.shaftType = MotorShaftType::D_Cut_Single;
        }
        else if (checkStr.Find(_T("페더키")) >= 0) {
            m_options.shaftType = MotorShaftType::Keyway_WithKey;
        }
        else {
            // "스트레이트(키없음)", "단축", "둥근축", "브레이크미포함" 등
            m_options.shaftType = MotorShaftType::Straight;
        }
        return;
    }

    // [B: 기호]
    if (checkStr.Find(_T("B:")) >= 0) {
        if (checkStr.Find(_T("플랫")) >= 0) { // "2면플랫"
            m_options.shaftType = MotorShaftType::D_Cut_Double;
        }
        else if (checkStr.Find(_T("키있음")) >= 0 || checkStr.Find(_T("페더키")) >= 0) {
            m_options.shaftType = MotorShaftType::Keyway_WithKey;
        }
        else if (checkStr.Find(_T("양축")) >= 0) {
            m_options.shaftType = MotorShaftType::DoubleShaft;
        }
        else {
            m_options.shaftType = MotorShaftType::Straight;
        }
        return;
    }

    // [N: 기호]
    if (checkStr.Find(_T("N:")) >= 0) {
        if (checkStr.Find(_T("키홈")) >= 0 || checkStr.Find(_T("키없음")) >= 0) {
            m_options.shaftType = MotorShaftType::Keyway_NoKey;
        }
        else {
            // "스트레이트"
            m_options.shaftType = MotorShaftType::Straight;
        }
        return;
    }

    // [G: 기호]
    if (checkStr.Find(_T("G:")) >= 0) {
        if (checkStr.Find(_T("기어")) >= 0 || checkStr.Find(_T("스크류")) >= 0) {
            m_options.shaftType = MotorShaftType::Gear_Pinion;
        }
        else {
            // "플레인", "표준축"
            m_options.shaftType = MotorShaftType::Straight;
        }
        return;
    }

    // [H: 기호]
    if (checkStr.Find(_T("H:")) >= 0) {
        if (checkStr.Find(_T("기어")) >= 0 || checkStr.Find(_T("스크류")) >= 0) {
            m_options.shaftType = MotorShaftType::Gear_Pinion;
        }
        else {
            // "플레인샤프트"
            m_options.shaftType = MotorShaftType::Straight;
        }
        return;
    }

    // [K: 기호]
    if (checkStr.Find(_T("K:")) >= 0) {
        // "키홈장착축", "한쪽둥근키", "KEY타입" 등
        m_options.shaftType = MotorShaftType::Keyway_WithKey;
        return;
    }

    // [D: 기호]
    if (checkStr.Find(_T("D:")) >= 0 || checkStr.Find(_T("D-CUT")) >= 0) {
        m_options.shaftType = MotorShaftType::D_Cut_Single;
        return;
    }

    // [S: 기호]
    if (checkStr.Find(_T("S:")) >= 0) {
        if (checkStr.Find(_T("D-CUT")) >= 0 || checkStr.Find(_T("D컷")) >= 0) {
            m_options.shaftType = MotorShaftType::D_Cut_Single;
        }
        else {
            // "스트레이트"
            m_options.shaftType = MotorShaftType::Straight;
        }
        return;
    }

    // [NON: 기호]
    if (checkStr.Find(_T("NON:")) >= 0) {
        // "스트레이트", "단축", "1축제어" 등
        m_options.shaftType = MotorShaftType::Straight;
        return;
    }

    // [기타 기호 처리 (2, 40, 2X, 4X 등)]
    if (checkStr.Find(_T("2:")) >= 0 || checkStr.Find(_T("40:")) >= 0 || checkStr.Find(_T("2X:")) >= 0 || checkStr.Find(_T("4X:")) >= 0) {
        m_options.shaftType = MotorShaftType::Straight;
        return;
    }

    // ==========================================================
    // 3. 매핑되지 않은 기본값
    // ==========================================================
    m_options.shaftType = MotorShaftType::Straight;
}

//=============================================================================
// 모터 타입별 바디 및 주요 형상 생성 분기 함수 (Wrapper)
//=============================================================================
HRESULT MotorCreator::CreateMotorShapeByType(CiPart* pPart)
{
    switch (m_options.bodyType) {
        // ---------------------------------------------------------
        // [그룹 A] 일반 회전형 모터 (프레임 치수에 따라 사각/원통 분기)
        // ---------------------------------------------------------
    case MotorBodyType::Servo:          // 1. 서보 모터
    case MotorBodyType::Stepper:        // 2. 스테핑 모터
    case MotorBodyType::DC:             // 16. DC 모터
    case MotorBodyType::Coreless:       // 13. 코어리스 모터
    case MotorBodyType::Micro:          // 15. 소형 모터
    case MotorBodyType::ACInduction:    // 14. 산업용 AC 유도 모터
    case MotorBodyType::Universal:      // 17. 유니버셜 모터
    case MotorBodyType::Standard:       // 기본형
        // 프레임 가로 치수(LC)가 존재하면 사각 프레임, 없으면 원통형 바디로 생성
        if (m_partData->Dim.LC > 0.0) return CreateSquareFrameBody(pPart);
        else return CreateCylindricalBody(pPart);

        // ---------------------------------------------------------
        // [그룹 B] 특수 회전형 모터 (구조적 변형이 들어갈 수 있는 그룹)
        // ---------------------------------------------------------
    case MotorBodyType::BLDC:           // 3. BLDC 모터
    case MotorBodyType::Spindle:        // 8. 스핀들모터
    case MotorBodyType::Fan:            // 9. 팬모터
    case MotorBodyType::Drum:           // 11. 드럼 모터
    case MotorBodyType::Vibration:      // 12. 진동 모터 (편심 추 추가 필요 시 분기 가능)
        if (m_partData->Dim.LC > 0.0) return CreateSquareFrameBody(pPart);
        else return CreateCylindricalBody(pPart);

        // ---------------------------------------------------------
        // [그룹 C] 기어 일체형 모터
        // ---------------------------------------------------------
    case MotorBodyType::Geared:         // 7. 기어드모터
    case MotorBodyType::Gearhead:       // 감속기 전용
        return CreateGearedMotorBody(pPart); // 내부에서 바디+기어헤드 연속 생성

        // ---------------------------------------------------------
        // [그룹 D] DD 모터 (대구경 중공 로터리)
        // ---------------------------------------------------------
    case MotorBodyType::DirectDrive:    // 5. DD 모터
        return CreateDDMotorBody(pPart);

        // ---------------------------------------------------------
        // [그룹 E] 직동형 (Linear) 구동계 (축이 없음)
        // ---------------------------------------------------------
    case MotorBodyType::Linear:         // 4. 리니어 모터
        return CreateLinearMotorTrack(pPart); // 고정자 생성 (가동자는 어셈블리에서 생성)

    case MotorBodyType::LinearActuator: // 10. 리니어 액추에이터 (실린더/로드 형태)
        return CreateLinearActuatorBody(pPart);

    case MotorBodyType::VoiceCoil:      // 6. 보이스 코일 (VCM)
        return CreateVoiceCoilBody(pPart);

        // ---------------------------------------------------------
        // [그룹 F] 유/공압 모터 (포트/피팅 형상이 필요한 그룹)
        // ---------------------------------------------------------
    case MotorBodyType::Pneumatic:      // 18. 공압(Air) 모터
    case MotorBodyType::Hydraulic:      // 19. 유압(Hydraulic) 모터
        return CreateFluidMotorBody(pPart);

        // ---------------------------------------------------------
        // [그룹 G] 전장품 / 제어기 박스 (회전/직동 불가, 직육면체 쉘 형태)
        // ---------------------------------------------------------
    case MotorBodyType::Inverter:       // 20. 인버터
    case MotorBodyType::ServoDrive:     // 21. 서보 드라이브
        return CreateDriveBoxBody(pPart);

        // ---------------------------------------------------------
        // [기본값] 예외 처리
        // ---------------------------------------------------------
    default:
        return CreateCylindricalBody(pPart);
    }
}

void MotorCreator::SetMotorFlangType()
{
    ATL::CString name = _T("");
    name.Format(_T("%s"), m_partData->Info.PartName);
    name.Trim();

    if      (name.Find(_T("FOOT")) >= 0)
        m_options.flangType = MotorFlangType::FootMount;
    else if (name.Find(_T("FACE")) >= 0)
        m_options.flangType = MotorFlangType::FaceMount;
    else if (m_partData->Dim.LB_h > 0.0 && m_partData->Dim.LB_l > 0.0)
        m_options.flangType = MotorFlangType::Square;
    else
        m_options.flangType = MotorFlangType::Round;
}

void MotorCreator::SetMotorOptions()
{
    if (m_partData->Dim.RL1 > 0.0)
        m_options.hasGearhead = true;
    if (m_partData->Dim.EnH > 0.0 || m_partData->Dim.EnL > 0.0)
        m_options.hasEncoder  = true;
    if (m_partData->Dim.SL  > 0.0)
        m_options.hasBrake    = true;

    //m_options.hasKeyway    = (m_partData->Dim.KA > 0.0 || m_partData->Dim.KL > 0.0);
    m_options.hasConnector = (m_partData->Dim.CW_MW > 0.0);

    m_options.mountHoleCnt = 4;   
}

//=============================================================================
// 1. Motor body
//=============================================================================

HRESULT MotorCreator::CreateMotorBody(CiPart* pPart)
{
    if (m_options.bodyType == MotorBodyType::Spindle || m_options.bodyType == MotorBodyType::Fan)
        return CreateCylindricalBody(pPart);
    else
        return  CreateSquareFrameBody(pPart);
}

//HRESULT MotorCreator::CreateSquareFrameBody(CiPart* pPart) // Servo, Standard
//{
//    ATL::CString attachment_Options = m_partData->Info.Attachment_Options;
//
//    int Opt = attachment_Options.Find(_T("E")) >= 0 ? 2 : attachment_Options.Find(_T("C")) >= 0 ? 1 : 0;
//
//    double frameW  = m_partData->Dim.LC;
//    double frameH   =  m_partData->Dim.LH;
//    double EncoderH = m_partData->Dim.EnH;
//    double bodyall_Len = Opt > 0 ? m_partData->Dim.LO : m_partData->Dim.LX;
//    double bodyLen = Opt > 0 ? m_partData->Dim.LO1_LLO: m_partData->Dim.L1_LL; 
//    double bodyLen2 = Opt > 0 ? m_partData->Dim.LO2 : m_partData->Dim.L2;
//    double bodyLen3 = Opt > 0 ? m_partData->Dim.LO3 : m_partData->Dim.L3;
//    double bodyTL = m_partData->Dim.TL_LG;
//    double bodyStart = m_partData->Dim.LR;
//    double motorConW = m_partData->Dim.CW_MW;
//    double motorConL = m_partData->Dim.CL_ML;
//    double motorConH = m_partData->Dim.CH_MH;
//    double flangThk = m_partData->Dim.LE;
//    double shaftDia = m_partData->Dim.S - m_partData->Dim.S_l;
//    double shaftD = m_partData->Dim.LB;
//    double Pcd_D = frameW == 1.5 ? 1.6 : 2.8; // m_partData->PCD_LA;
//    double inDia = frameW * 0.8;
//    double MoR = 0.1;// m_partData->Dim.R;
//
//    if (frameW <= 0.0 || bodyTL <= 0.0)
//        return E_INVALIDARG;
//
//    double offsetF = 0.01;
//    double r = shaftDia / 2.0;
//    // Sketch on YZ plane
//    CiWorkPlane yzPlaneS =  pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, bodyStart+ offsetF);
//    pPart->SketchManager.StartSketch(yzPlaneS);
//
//    // Use CreateSketchRect (centered at origin)
//    pPart->SketchManager.CreateSketchRectRound(frameW, frameH, MoR);
//    pPart->SketchManager.CreateSketchCircle(r, 0.0, 0.0);
//
//    pPart->SetSolidProfile();
//    CiExtrudeFeature motorBodyS = pPart->FeatureManager.CreateExtrude(bodyTL - offsetF, CiDirectionOpEnum::Positive, CiJoinOpEnum::NewBody, 0, _T("MotorBodyS"));
//    ApplyBodyMaterial(pPart, motorBodyS, _T("Anodized - Black"), _T("피막 처리 - 검은색"));
//
//    CiWorkPlane yzPlaneC= pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, bodyStart+bodyTL);
//    pPart->SketchManager.StartSketch(yzPlaneC);
//
//    // Use CreateSketchRect (centered at origin)
//    double inr = inDia / 2.0;
//    pPart->SketchManager.CreateSketchRectRound(frameW-0.01, frameH-0.01, MoR);
//    pPart->SketchManager.CreateSketchCircle(inr, 0.0, 0.0);
//
//    double Body_all =bodyLen2- bodyTL;
//    pPart->SetSolidProfile();
//    CiExtrudeFeature motorBodyC = pPart->FeatureManager.CreateExtrude(Body_all, CiDirectionOpEnum::Positive, CiJoinOpEnum::NewBody, 0, _T("MotorBodyC"));
//    ApplyBodyMaterial(pPart, motorBodyC, _T("Anodized - Black"), _T("피막 처리 - 검은색"));
//
//    double Body_B = bodyStart + bodyTL + Body_all;
//    CiWorkPlane yzPlaneE = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, Body_B);
//    pPart->SketchManager.StartSketch(yzPlaneE);
//
//    double genY = (EncoderH / 2) - (frameH / 2);
//    // Use CreateSketchRect (centered at origin)
//    if (frameH < EncoderH) 
//        pPart->SketchManager.CreateSketchRectRound(EncoderH, frameW, MoR, genY);
//    else 
//        pPart->SketchManager.CreateSketchRectRound(frameW, frameH, MoR);
// 
//    pPart->SetSolidProfile();
//    CiExtrudeFeature motorBodyE = pPart->FeatureManager.CreateExtrude(bodyLen- bodyLen2, CiDirectionOpEnum::Positive, CiJoinOpEnum::NewBody, 0, _T("MotorBodyE"));
//    ApplyBodyMaterial(pPart, motorBodyE, _T("Anodized - Black"), _T("피막 처리 - 검은색"));
//    
//    // 모터 컨넥터 ====================================================
//    CiWorkPlane moCplaneA = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ, frameH / 2);
//    pPart->SketchManager.StartSketch(moCplaneA);
//
//    double ConnectorL = bodyLen2 + bodyStart;
//
//    CiSketchPoint conPts[4];
//    conPts[0] = pPart->SketchManager.SetSketchPoint(-(ConnectorL), motorConW / 2);
//    conPts[1] = pPart->SketchManager.SetSketchPoint(-(ConnectorL - motorConL / 2), motorConW / 2);
//    conPts[2] = pPart->SketchManager.SetSketchPoint(-(ConnectorL - motorConL / 2), -(motorConW / 2));
//    conPts[3] = pPart->SketchManager.SetSketchPoint(-(ConnectorL), -(motorConW / 2));
//
//    pPart->SketchManager.CreateSketchLine(conPts[0], conPts[1]);
//    pPart->SketchManager.CreateSketchLine(conPts[1], conPts[2]);
//    pPart->SketchManager.CreateSketchLine(conPts[2], conPts[3]);
//    pPart->SketchManager.CreateSketchLine(conPts[3], conPts[0]);
//
//    pPart->SetSolidProfile();
//    CiExtrudeFeature motorConnector = pPart->FeatureManager.CreateExtrude(motorConH, CiDirectionOpEnum::Positive, CiJoinOpEnum::NewBody, 0, _T("MotorConnector"));
//    ApplyBodyMaterial(pPart, motorConnector, _T("Anodized - Black"), _T("피막 처리 - 검은색"));
//
//    // 엔코더 컨넥터=============================================================================
//    CiWorkPlane enCplaneA = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ, EncoderH / 2 + genY);
//    pPart->SketchManager.StartSketch(enCplaneA);
//
//    double ConnectorD = m_partData->Dim.Ed;
//    double ConnecL = m_partData->Dim.EL;
//    double ConnecS = m_partData->Dim.ES_MD;
//
//    pPart->SketchManager.CreateSketchCircle((ConnectorD / 2) + 0.02, -(bodyall_Len - ConnecL), -ConnecS);
//
//    pPart->SetSolidProfile();
//    CiExtrudeFeature enConnector = pPart->FeatureManager.CreateExtrude(motorConH, CiDirectionOpEnum::Positive, CiJoinOpEnum::NewBody, 0, _T("EnConnector"));
//    ApplyBodyMaterial(pPart, enConnector, _T("Anodized - Black"), _T("피막 처리 - 검은색"));
//
//    CiWorkPlane enCplaneB = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ, EncoderH / 2 + (genY + motorConH));
//    pPart->SketchManager.StartSketch(enCplaneB);
//
//    pPart->SketchManager.CreateSketchCircle(ConnectorD / 2, -(bodyall_Len - ConnecL), -ConnecS);
//
//    pPart->SetSolidProfile();
//    CiExtrudeFeature enConnector1 = pPart->FeatureManager.CreateExtrude(motorConH, CiDirectionOpEnum::Positive, CiJoinOpEnum::NewBody, 0, _T("EnConnector1"));
//    ApplyBodyMaterial(pPart, enConnector1, _T("Anodized - Black"), _T("피막 처리 - 검은색"));
//    
//    //==============================================================================
//    // 플랜지 
//    /// 
//    CiWorkPlane yzplaneB = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, bodyStart);
//    pPart->SketchManager.StartSketch(yzplaneB);
//
//    double Rr = shaftD / 2.0;
//    double Rr1 = (shaftD / 2.0) - offsetF;
//    if (frameW > 1.5) {
//        pPart->SketchManager.CreateSketchCircle(Rr1, 0.0, 0.0);
//        pPart->SketchManager.CreateSketchCircle(r, 0.0, 0.0);
//
//        pPart->SetSolidProfile();
//        CiExtrudeFeature motorBodyR = pPart->FeatureManager.CreateExtrude(flangThk, CiDirectionOpEnum::Negative, CiJoinOpEnum::NewBody, 0, _T("MotorBodyR"));
//        ApplyBodyMaterial(pPart, motorBodyR, _T("Anodized - Black"), _T("피막 처리 - 검은색"));
//    }
//    
//    //CreateSquareFlange(pPart);
//    CreateMountingHoles(pPart);
//
//    return S_OK;
//}

//=============================================================================
// [재질 최적화 완성본] 사각 프레임 서보/스테핑 모터 바디 생성
// - 제공된 인벤터 재질 텍스트 목록의 정확한 명칭 반영
// - 3단 분할 바디(Front/Stator/Rear) 및 평면 보정 로직 완벽 적용
//=============================================================================
HRESULT MotorCreator::CreateSquareFrameBody(CiPart* pPart)
{
    // -------------------------------------------------------------------------
    // 1. 기초 치수 및 브레이크 옵션 파라미터 매핑
    // -------------------------------------------------------------------------
    ATL::CString attachment_Options = m_partData->Info.Attachment_Options;
    bool hasBrake = (attachment_Options.Find(_T("E")) >= 0 ||
        attachment_Options.Find(_T("C")) >= 0 ||
        m_partData->Dim.SL > 0.0);

    double L1 = hasBrake ? m_partData->Dim.LO1_LLO : m_partData->Dim.L1_LL;
    if (L1 <= 0.0) L1 = m_partData->Dim.LX;

    double L2 = hasBrake ? m_partData->Dim.LO2 : m_partData->Dim.L2;
    double L3 = hasBrake ? m_partData->Dim.LO3 : m_partData->Dim.L3;

    if (L2 <= 0.0) L2 = m_partData->Dim.L2;
    if (L3 <= 0.0) L3 = m_partData->Dim.L3;

    double es_md = m_partData->Dim.ES_MD;

    // 엔코더 길이 산출 (디폴트: 총 길이의 20%)
    double encCapLen = m_partData->Dim.EnL > 0 ? m_partData->Dim.EnL : L1 * 0.2;

    if (L2 <= 0.0) L2 = L1 - encCapLen; // L2가 없으면 (전체 - 엔코더)로 추정
    if (L3 <= 0.0) L3 = L2 + (L1 - L2) * 0.5;

    double frameW = m_partData->Dim.LC;
    double frameH = m_partData->Dim.LH > 0.0 ? m_partData->Dim.LH : frameW;
    double cornerR = m_partData->Dim.R > 0.0 ? m_partData->Dim.R : (1.0 / m_unit);

    if (frameW <= 0.0 || L1 <= 0.0) return E_INVALIDARG;

    // -------------------------------------------------------------------------
    // 2. 모터 메인 바디 세분화 (브라켓 / 스테이터)
    // -------------------------------------------------------------------------
    double endbellLen = L2 * 0.15;
    double statorLen = L2 * 0.85; // L2 내부 공간 배분 조정

    // [2-1] 전면 브라켓 (Front Endbell)
    CiWorkPlane yzPlaneFront = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, 0.0);
    pPart->SketchManager.StartSketch(yzPlaneFront);
    if (cornerR > 0.0) pPart->SketchManager.CreateSketchRectRound(frameH, frameW, cornerR);
    else               pPart->SketchManager.CreateSketchRect(frameH, frameW, CiPoint(0.0, 0.0, 0.0), true);
    pPart->SetSolidProfile();
    CiFeature frontFeat = pPart->FeatureManager.CreateExtrude(endbellLen, CiDirectionOpEnum::Negative, CiJoinOpEnum::NewBody, 0, _T("Front_Endbell"));
    ApplyBodyMaterial(pPart, frontFeat, _T("Aluminum - Polished"), _T("알루미늄 - 연마"));

    // (전면 샤프트 관통 홀)
    double shaftDia = m_partData->Dim.S > 0 ? m_partData->Dim.S : (10.0 / m_unit);
    pPart->SketchManager.StartSketch(yzPlaneFront);
    pPart->SketchManager.CreateSketchCircle((shaftDia + 2.0 / m_unit) / 2.0, 0.0, 0.0);
    pPart->SetSolidProfile();
    pPart->FeatureManager.CreateExtrude(15.0 / m_unit, CiDirectionOpEnum::Negative, CiJoinOpEnum::Cut, 0, _T("Cut_ShaftHole"));

    // [2-2] 고정자 코어 (Stator Stack)
    double statorIndent = 1.0 / m_unit;
    double statorCornerR = cornerR > statorIndent ? cornerR - statorIndent : 0.0;
    CiWorkPlane yzPlaneStator = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, -endbellLen);
    pPart->SketchManager.StartSketch(yzPlaneStator);
    if (statorCornerR > 0.0) pPart->SketchManager.CreateSketchRectRound(frameH - (statorIndent * 2), frameW - (statorIndent * 2), statorCornerR);
    else                     pPart->SketchManager.CreateSketchRect(frameH - (statorIndent * 2), frameW - (statorIndent * 2), CiPoint(0.0, 0.0, 0.0), true);
    pPart->SetSolidProfile();
    CiFeature statorFeat = pPart->FeatureManager.CreateExtrude(statorLen, CiDirectionOpEnum::Negative, CiJoinOpEnum::NewBody, 0, _T("Stator_Stack"));
    ApplyBodyMaterial(pPart, statorFeat, _T("Steel - Cast"), _T("강철 - 주조"));

    // -------------------------------------------------------------------------
    // 3. 브레이크 및 브레이크 커버 생성
    // -------------------------------------------------------------------------
    double brakePos = L2;
    double brakeLen = 0.0;

    if (hasBrake) {
        brakeLen = m_partData->Dim.SL > 0.0 ? m_partData->Dim.SL : (L1 - L2 - encCapLen);
        if (brakeLen < 0.0) brakeLen = 25.0 / m_unit;

        // [3-1] 내부 브레이크 모듈 (핵심 블록 - 기존 로직 유지)
        double brakeIndent = 2.0 / m_unit; // 본체보다 2mm 작게 설정
        double brakeCornerR = cornerR > brakeIndent ? cornerR - brakeIndent : 0.0;

        CiWorkPlane yzPlaneBrake = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, -brakePos);
        pPart->SketchManager.StartSketch(yzPlaneBrake);
        if (brakeCornerR > 0.0) pPart->SketchManager.CreateSketchRectRound(frameH - (brakeIndent * 2), frameW - (brakeIndent * 2), brakeCornerR);
        else                    pPart->SketchManager.CreateSketchRect(frameH - (brakeIndent * 2), frameW - (brakeIndent * 2), CiPoint(0.0, 0.0, 0.0), true);
        pPart->SetSolidProfile();

        CiFeature brakeFeat = pPart->FeatureManager.CreateExtrude(brakeLen, CiDirectionOpEnum::Negative, CiJoinOpEnum::NewBody, 0, _T("EM_Brake_Module"));
        ApplyBodyMaterial(pPart, brakeFeat, _T("Steel - Galvanized"), _T("강철 - 아연도금"));

        // ---------------------------------------------------------------------
        // [3-2] ★ 브레이크 커버 (Brake Cover) 추가
        // - 특징: 외곽은 모터 본체와 동일(Flush), 내부는 브레이크 모듈에 맞춰 파임
        // ---------------------------------------------------------------------
        pPart->SketchManager.StartSketch(yzPlaneBrake); // 동일 평면에 스케치 시작

        // 외곽선 (모터 프레임 크기)
        if (cornerR > 0.0) pPart->SketchManager.CreateSketchRectRound(frameH, frameW, cornerR);
        else               pPart->SketchManager.CreateSketchRect(frameH, frameW, CiPoint(0.0, 0.0, 0.0), true);

        // 내측선 (브레이크 모듈 크기 - 이 부분을 그리면 자동으로 속이 빈 형상이 됨)
        if (brakeCornerR > 0.0) pPart->SketchManager.CreateSketchRectRound(frameH - (brakeIndent * 2), frameW - (brakeIndent * 2), brakeCornerR);
        else                    pPart->SketchManager.CreateSketchRect(frameH - (brakeIndent * 2), frameW - (brakeIndent * 2), CiPoint(0.0, 0.0, 0.0), true);

        pPart->SetSolidProfile();

        // 브레이크 길이만큼 동일하게 압출
        CiFeature coverFeat = pPart->FeatureManager.CreateExtrude(brakeLen, CiDirectionOpEnum::Negative, CiJoinOpEnum::NewBody, 0, _T("Brake_Cover"));

        // 재질: 보통 전면 브라켓과 동일한 알루미늄 재질 사용
        ApplyBodyMaterial(pPart, coverFeat, _T("Aluminum - Polished"), _T("알루미늄 - 연마"));
    }

    // ★ 내부 로터 공간 파내기 (엔코더 생성 전 호출하여 보호)
    CreateMotorInternalCavity(pPart, brakeLen);

    // -------------------------------------------------------------------------
    // 4. 엔코더 캡 생성
    // -------------------------------------------------------------------------
    double encStartPos = L2 + brakeLen; // 브레이크 유무에 따라 시작점 밀림
    double finalEncCapLen = L1 - encStartPos; // 남은 길이를 엔코더 캡으로
    if (finalEncCapLen <= 0.0) finalEncCapLen = encCapLen; // 안전값

    double enH = m_partData->Dim.EnH;
    double enW = m_partData->Dim.EnW;

    // (안전장치) DB에 엔코더 치수가 아예 누락된 경우, 모터 폭의 85% 크기인 원형 캡으로 기본값 설정
    if (enH <= 0.0 && enW <= 0.0) {
        enH = frameW * 0.85;
    }

    double enDia = (enW > 0.0) ? 0.0 : enH;

    double encCenterOffset = (enH - frameH) / 2.0;
    enW = frameW;

    CiWorkPlane yzPlaneEnc = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, -encStartPos);
    pPart->SketchManager.StartSketch(yzPlaneEnc);
    if (enW > 0.0) {
        pPart->SketchManager.SetPointXYReplace();
        pPart->SketchManager.CreateSketchRect(enW, enH, CiPoint(0.0, encCenterOffset, 0.0), true);
    }
    else {
        pPart->SketchManager.CreateSketchCircle(enDia / 2.0, encCenterOffset, 0.0);
    }
    pPart->SetSolidProfile();
    CiFeature encFeat = pPart->FeatureManager.CreateExtrude(finalEncCapLen, CiDirectionOpEnum::Negative, CiJoinOpEnum::NewBody, 0, _T("Encoder_Cap"));
    ApplyBodyMaterial(pPart, encFeat, _T("Smooth - Black"), _T("매끄러움 - 검은색"));

    // -------------------------------------------------------------------------
    // 5. 커넥터 단자대 생성 (별도 분리된 함수 호출)
    // -------------------------------------------------------------------------
    double encTopSurface = encCenterOffset + (enH / 2.0);

    CreateMotorTerminal(pPart, frameW, frameH, L2);
    CreateEncoderTerminal(pPart, frameW, frameH, L3, es_md, encTopSurface);

    // -------------------------------------------------------------------------
    // 6. 마무리 연동
    // -------------------------------------------------------------------------
    CreateMountingHoles(pPart);
    CreateShaftCover(pPart);

    return S_OK;
}

//=============================================================================
// 원통형 모터 바디 생성
// - 부위별(메인/브레이크/엔코더/커넥터) 독립 바디 및 개별 재질 적용
//=============================================================================
HRESULT MotorCreator::CreateCylindricalBody(CiPart* pPart)
{
    // [1. 파라미터 매핑]
    ATL::CString attachment_Options = m_partData->Info.Attachment_Options;
    bool hasBrake = (attachment_Options.Find(_T("E")) >= 0 || attachment_Options.Find(_T("C")) >= 0 || m_partData->Dim.SL > 0.0);
    double L1 = hasBrake ? m_partData->Dim.LO1_LLO : m_partData->Dim.L1_LL;
    if (L1 <= 0.0) L1 = hasBrake ? m_partData->Dim.LO : m_partData->Dim.LX;
    double L2 = L1 - m_partData->Dim.EnL;
    double L3 = L1 - m_partData->Dim.EL;
    if (L3 <= 0.0) L3 = L1 * 0.6;
    if (L2 <= 0.0) L2 = L3 + (L1 - L3) * 0.5;

    double seg1_Len = L3, seg2_Len = L2 - L3, seg3_Len = L1 - L2;
    double bodyDia = m_partData->Dim.ES_MD > 0.0 ? m_partData->Dim.ES_MD : (m_partData->Dim.LB > 0.0 ? m_partData->Dim.LB : m_partData->Dim.S);

    if (bodyDia <= 0.0 || L1 <= 0.0) return E_INVALIDARG;

    // [2. 메인 바디] (스틸)
    CiWorkPlane yzPlane1 = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, 0.0);
    pPart->SketchManager.StartSketch(yzPlane1);
    pPart->SketchManager.CreateSketchCircle(bodyDia / 2.0, 0.0, 0.0);
    pPart->SetSolidProfile();
    CiFeature motorBody = pPart->FeatureManager.CreateExtrude(seg1_Len, CiDirectionOpEnum::Negative, CiJoinOpEnum::NewBody, 0, _T("Cyl_Main"));
    ApplyBodyMaterial(pPart, motorBody, _T("Steel, Galvanized"), _T("스틸 - 도금"));

    // (샤프트 홀)
    double shaftDia = m_partData->Dim.S > 0 ? m_partData->Dim.S : (10.0 / m_unit);
    pPart->SketchManager.StartSketch(yzPlane1);
    pPart->SketchManager.CreateSketchCircle((shaftDia + 2.0 / m_unit) / 2.0, 0.0, 0.0);
    pPart->SetSolidProfile();
    pPart->FeatureManager.CreateExtrude(15.0 / m_unit, CiDirectionOpEnum::Negative, CiJoinOpEnum::Cut, 0, _T("Cut_ShaftHole"));

    // [3. 중간 브레이크 단차] (흑색 피막)
    if (seg2_Len > 0.0) {
        CiWorkPlane yzPlane2 = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, -L3);
        pPart->SketchManager.StartSketch(yzPlane2);
        pPart->SketchManager.CreateSketchCircle((bodyDia * 0.95) / 2.0, 0.0, 0.0);
        pPart->SetSolidProfile();
        // ★ NewBody 
        CiFeature midBody = pPart->FeatureManager.CreateExtrude(seg2_Len, CiDirectionOpEnum::Negative, CiJoinOpEnum::NewBody, 0, _T("Cyl_Middle"));
        ApplyBodyMaterial(pPart, midBody, _T("Anodized - Black"), _T("피막 처리 - 검은색"));
    }

    // [4. 후면 엔코더] (플라스틱)
    if (seg3_Len > 0.0) {
        CiWorkPlane yzPlane3 = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, -L2);
        pPart->SketchManager.StartSketch(yzPlane3);
        double enW = m_partData->Dim.EW, enH = m_partData->Dim.EnH;
        if (enW > 0.0) pPart->SketchManager.CreateSketchRectRound(enH, enW, 1.0 / m_unit);
        else pPart->SketchManager.CreateSketchCircle((enH > 0.0 ? enH : bodyDia * 0.85) / 2.0, 0.0, 0.0);
        pPart->SetSolidProfile();

        // ★ NewBody
        CiFeature encBody = pPart->FeatureManager.CreateExtrude(seg3_Len, CiDirectionOpEnum::Negative, CiJoinOpEnum::NewBody, 0, _T("Cyl_Encoder"));
        ApplyBodyMaterial(pPart, encBody, _T("Plastic, Black"), _T("플라스틱 - 검정"));
    }

    // [5. 상단 커넥터] (플라스틱)
    double mw = m_partData->Dim.CW_MW, ml = m_partData->Dim.CL_ML, mh = m_partData->Dim.CH_MH;
    if (mw > 0 || mh > 0 || ml > 0) {
        double embedDepth = 2.0 / m_unit;
        if (mw <= 0) mw = bodyDia * 0.3; if (ml <= 0) ml = bodyDia * 0.3; if (mh <= 0) mh = bodyDia * 0.15;
        double motorTerminalCenterX = -L2 + (ml / 2.0);

        CiWorkPlane mPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ, (bodyDia / 2.0) - embedDepth);
        pPart->SketchManager.StartSketch(mPlane);
        pPart->SketchManager.SetPointXRevert();
        pPart->SketchManager.CreateSketchRect(ml, mw, CiPoint(motorTerminalCenterX, 0.0, 0.0), true);
        pPart->SetSolidProfile();

        // ★ NewBody
        CiFeature termBody = pPart->FeatureManager.CreateExtrude(mh + embedDepth, CiDirectionOpEnum::Positive, CiJoinOpEnum::NewBody, 0, _T("Cyl_Terminal"));
        ApplyBodyMaterial(pPart, termBody, _T("Plastic, Black"), _T("플라스틱 - 검정"));
    }

    CreateMountingHoles(pPart);
    CreateShaftCover(pPart);

    return S_OK;
}

//=============================================================================
// 다이렉트 드라이브 (Direct Drive / DD) 모터 바디 생성
// - 넓은 직경(LB 또는 S)과 얇은 두께(LM)의 팬케이크 구조 구현
// - W(중공축 내경) 파라미터를 이용한 Body Center 컷아웃(관통)
//=============================================================================
HRESULT MotorCreator::CreateDDMotorBody(CiPart* pPart)
{
    // DD모터는 보통 프레임 폭(S)보다 플랜지 외경(LB)을 메인 외경으로 사용하는 경우가 많음
    double bodyDia = m_partData->Dim.LB > 0.0 ? m_partData->Dim.LB : m_partData->Dim.S;
    double bodyLen = m_partData->Dim.LM;
    double hollowDia = m_partData->Dim.W; // 중공축 내경

    if (bodyDia <= 0.0 || bodyLen <= 0.0) return E_INVALIDARG;

    // 1. DD 모터 메인 바디 생성 (도넛 형태)
    CiWorkPlane yzPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, 0.0);
    pPart->SketchManager.StartSketch(yzPlane);
    pPart->SketchManager.CreateSketchCircle(bodyDia / 2.0, 0.0, 0.0); // 외부 직경

    if (hollowDia > 0.0) {
        // 내부 타공 (프로파일 안에 원을 하나 더 그리면 인벤터가 자동으로 도넛 모양으로 인식함)
        pPart->SketchManager.CreateSketchCircle(hollowDia / 2.0, 0.0, 0.0);
    }
    pPart->SetSolidProfile();

    // 방향: Negative (-X 방향 돌출)
    CiFeature ddBody = pPart->FeatureManager.CreateExtrude(bodyLen, CiDirectionOpEnum::Negative, CiJoinOpEnum::NewBody, 0, _T("DD_Motor_Body"));
    ApplyBodyMaterial(pPart, ddBody, _T("Steel, Cast"), _T("주철 - 흑색"));

    // 2. 단자대 (Connector) 생성
    double mw = m_partData->Dim.CW_MW, ml = m_partData->Dim.CL_ML, mh = m_partData->Dim.CH_MH;
    if (mw > 0 || mh > 0 || ml > 0) {
        double embedDepth = 2.0 / m_unit;
        if (mw <= 0) mw = bodyDia * 0.15;
        if (ml <= 0) ml = bodyDia * 0.15;
        if (mh <= 0) mh = bodyLen * 0.5;

        // 측면 터미널 부착
        CiWorkPlane mPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ, (bodyDia / 2.0) - embedDepth);
        pPart->SketchManager.StartSketch(mPlane);
        pPart->SketchManager.SetPointXRevert();

        pPart->SketchManager.CreateSketchRect(ml, mw, CiPoint(-bodyLen / 2.0, 0.0, 0.0), true);
        pPart->SetSolidProfile();

        CiFeature termFeat = pPart->FeatureManager.CreateExtrude(mh + embedDepth, CiDirectionOpEnum::Positive, CiJoinOpEnum::NewBody, 0, _T("DD_Terminal"));
        ApplyBodyMaterial(pPart, termFeat, _T("Plastic, Black"), _T("플라스틱 - 검정"));
    }

    // 3. 플랜지 취부 홀 생성 (-X 방향 컷아웃)
    CreateMountingHoles(pPart);

    return S_OK;
}

//=============================================================================
// 보이스 코일 모터 (VCM) 바디 생성
// - 스키마: LC(사각폭) 또는 ES_MD(원통외경), LM(길이), W(내부 가동자 홀 직경)
//=============================================================================
HRESULT MotorCreator::CreateVoiceCoilBody(CiPart* pPart)
{
    // 1. 스키마 치수 매핑
    double bodyLen = m_partData->Dim.LM;             // 하우징 전체 길이
    double frameW = m_partData->Dim.LC;             // 사각 프레임 폭 (존재할 경우)
    double outerDia = m_partData->Dim.ES_MD > 0.0 ? m_partData->Dim.ES_MD : m_partData->Dim.S; // 원통형일 경우 외경
    double innerDia = m_partData->Dim.W;             // 내부 가동자(Coil/Rod)가 움직이는 관통 홀 내경

    if (bodyLen <= 0.0) return E_INVALIDARG;

    // 2. 기준 평면 생성 (YZ 평면, X축 방향으로 돌출)
    CiWorkPlane yzPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, 0.0);
    pPart->SketchManager.StartSketch(yzPlane);

    // 3. 외곽 형상 스케치 (사각형 vs 원통형 분기)
    if (frameW > 0.0) {
        // 사각형 VCM
        double cornerR = m_partData->Dim.R > 0.0 ? m_partData->Dim.R : 0.1;
        pPart->SketchManager.CreateSketchRectRound(frameW, frameW, cornerR);
    }
    else {
        // 원통형 VCM
        if (outerDia <= 0.0) return E_INVALIDARG;
        pPart->SketchManager.CreateSketchCircle(outerDia / 2.0, 0.0, 0.0);
    }

    // 4. 내부 관통 홀 스케치 (가동자가 들어갈 공간)
    if (innerDia > 0.0) {
        pPart->SketchManager.CreateSketchCircle(innerDia / 2.0, 0.0, 0.0);
    }

    // 5. 돌출(Extrude) 실행
    pPart->SetSolidProfile();
    // VCM 하우징 바디 돌출 (Positive 방향)
    CiFeature vcmBody = pPart->FeatureManager.CreateExtrude(bodyLen, CiDirectionOpEnum::Positive, CiJoinOpEnum::NewBody, 0, _T("VCM_Housing"));

    // 6. 재질 적용 (일반적으로 금속 케이스)
    ApplyBodyMaterial(pPart, vcmBody, _T("Steel, Galvanized"), _T("스틸 - 도금"));

    // 7. 취부 홀 가공 (기존 공통 함수 활용)
    CreateMountingHoles(pPart);

    return S_OK;
}

//=============================================================================
// 5. 기어드 모터 바디 생성 (Geared Motor)
// - 방향성: 축(+X 방향), 감속기 및 모터 바디(-X 방향)
// - 스키마: G_ 접두사(감속기 치수) + 일반 모터 치수 혼합
// - 전면 샤프트 홀 가공 및 CreateShaftCover 연동
//=============================================================================
HRESULT MotorCreator::CreateGearedMotorBody(CiPart* pPart)
{
    // 1. 기어박스부(Gearhead) 치수 매핑
    double gearW = m_partData->Dim.G_LC;  // 기어박스 사각 프레임 폭
    double gearDia = m_partData->Dim.G_C;   // 기어박스 원형 외경
    double gearLen = m_partData->Dim.G_LM > 0.0 ? m_partData->Dim.G_LM : m_partData->Dim.G_L1;

    // 2. 모터부 치수 매핑
    double motorW = m_partData->Dim.LC;
    double motorDia = m_partData->Dim.ES_MD > 0.0 ? m_partData->Dim.ES_MD : m_partData->Dim.S;
    double motorLen = m_partData->Dim.LM;

    if (motorLen <= 0.0) return E_INVALIDARG;

    // =========================================================================
    // [세그먼트 1] 기어박스 하우징 (0 ~ -gearLen)
    // =========================================================================
    if (gearLen > 0.0) {
        CiWorkPlane yzPlaneGear = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, 0.0);
        pPart->SketchManager.StartSketch(yzPlaneGear);

        if (gearW > 0.0) {
            pPart->SketchManager.CreateSketchRectRound(gearW, gearW, 1.0 / m_unit);
        }
        else if (gearDia > 0.0) {
            pPart->SketchManager.CreateSketchCircle(gearDia / 2.0, 0.0, 0.0);
        }

        pPart->SetSolidProfile();
        // ★ 방향: Negative (-X 방향 돌출)
        CiFeature gearBody = pPart->FeatureManager.CreateExtrude(gearLen, CiDirectionOpEnum::Negative, CiJoinOpEnum::NewBody, 0, _T("Geared_Gearbox"));
        ApplyBodyMaterial(pPart, gearBody, _T("Cast Iron"), _T("주철 - 검정"));

        // ★ 전면 샤프트 관통 홀 가공 (X=0에서 기어박스 내부인 -X 방향으로 컷)
        double shaftDia = m_partData->Dim.S > 0 ? m_partData->Dim.S : (10.0 / m_unit);
        double clearance = 2.0 / m_unit;
        pPart->SketchManager.StartSketch(yzPlaneGear);
        pPart->SketchManager.CreateSketchCircle((shaftDia + clearance) / 2.0, 0.0, 0.0);
        pPart->SetSolidProfile();
        pPart->FeatureManager.CreateExtrude(15.0 / m_unit, CiDirectionOpEnum::Negative, CiJoinOpEnum::Cut, 0, _T("Cut_ShaftHole"));
    }

    // =========================================================================
    // [세그먼트 2] 모터 메인 바디 (-gearLen ~ -(gearLen + motorLen))
    // =========================================================================
    // 기어박스가 있으면 그 뒷면(-gearLen)에서 시작, 없으면 0에서 시작
    double motorStartPos = gearLen > 0.0 ? -gearLen : 0.0;
    CiWorkPlane yzPlaneMotor = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, motorStartPos);
    pPart->SketchManager.StartSketch(yzPlaneMotor);

    if (motorW > 0.0) {
        double cornerR = m_partData->Dim.R > 0.0 ? m_partData->Dim.R : (1.0 / m_unit);
        pPart->SketchManager.CreateSketchRectRound(motorW, motorW, cornerR);
    }
    else {
        double mDia = motorDia > 0 ? motorDia : (gearDia > 0 ? gearDia * 0.8 : 50.0 / m_unit);
        pPart->SketchManager.CreateSketchCircle(mDia / 2.0, 0.0, 0.0);
    }

    pPart->SetSolidProfile();

    // 기어박스가 존재하면 Join(결합), 없으면 NewBody
    CiJoinOpEnum joinOp = gearLen > 0.0 ? CiJoinOpEnum::Join : CiJoinOpEnum::NewBody;

    // ★ 방향: Negative (-X 방향 돌출)
    CiFeature motorBody = pPart->FeatureManager.CreateExtrude(motorLen, CiDirectionOpEnum::Negative, joinOp, 0, _T("Geared_Motor"));

    if (joinOp == CiJoinOpEnum::NewBody) {
        ApplyBodyMaterial(pPart, motorBody, _T("Anodized - Black"), _T("피막 처리 - 검은색"));
    }

    // =========================================================================
    // [단자 가공] 모터 측면에 커넥터가 정의되어 있을 경우
    // =========================================================================
    double mw = m_partData->Dim.CW_MW;
    double ml = m_partData->Dim.CL_ML;
    double mh = m_partData->Dim.CH_MH;

    if (mw > 0 || mh > 0 || ml > 0) {
        double embedDepth = 2.0 / m_unit;
        if (mw <= 0) mw = (motorW > 0 ? motorW : motorDia) * 0.3;
        if (ml <= 0) ml = (motorW > 0 ? motorW : motorDia) * 0.3;
        if (mh <= 0) mh = (motorW > 0 ? motorW : motorDia) * 0.15;

        // 모터 바디의 끝단(-gearLen - motorLen)을 기준으로 위치 지정
        double motorTerminalCenterX = motorStartPos - motorLen + (ml / 2.0);
        double surfaceY = (motorW > 0 ? motorW : motorDia) / 2.0;

        CiWorkPlane mPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ, surfaceY - embedDepth);
        pPart->SketchManager.StartSketch(mPlane);
        pPart->SketchManager.SetPointXRevert(); // XZ 평면 보정

        pPart->SketchManager.CreateSketchRect(ml, mw, CiPoint(motorTerminalCenterX, 0.0, 0.0), true);
        pPart->SetSolidProfile();

        // 방향 Positive (바깥쪽 돌출)
        pPart->FeatureManager.CreateExtrude(mh + embedDepth, CiDirectionOpEnum::Positive, CiJoinOpEnum::Join, 0, _T("Geared_Terminal"));
    }

    // =========================================================================
    // 마무리 가공 (-X 방향 마운팅 홀 및 +X 방향 샤프트 커버 연동)
    // =========================================================================
    CreateMountingHoles(pPart);
    CreateShaftCover(pPart);

    return S_OK;
}

//=============================================================================
// 스핀들 모터 바디 생성 (Spindle Motor)
// - 방향성: 축(+X 방향), 3단 바디(-X 방향)
// - 구조: 전면 하우징(L1) + 메인 바디(L2) + 후면 캡(L3)
// - 전면 샤프트 홀 가공 및 커넥터 삽입, ShaftCover 연동 포함
//=============================================================================
HRESULT MotorCreator::CreateSpindleMotorBody(CiPart* pPart)
{
    // 1. 외경 치수 매핑
    double bodyDia = m_partData->Dim.ES_MD > 0.0 ? m_partData->Dim.ES_MD : m_partData->Dim.S;
    if (bodyDia <= 0.0) return E_INVALIDARG;

    // 2. 세그먼트별 길이 매핑
    double L1 = m_partData->Dim.L1_LL; // 전면 베어링 하우징 길이
    double L2 = m_partData->Dim.L2;    // 메인 스핀들 바디 길이
    double L3 = m_partData->Dim.L3;    // 후면 쿨링팬/단자대 캡 길이
    double LM = m_partData->Dim.LM;    // 전체 길이

    // 데이터 누락 시 임의 분할 보정 (15% - 70% - 15%)
    if (L1 <= 0.0 && L2 <= 0.0 && L3 <= 0.0) {
        if (LM <= 0.0) return E_INVALIDARG;
        L1 = LM * 0.15;
        L2 = LM * 0.70;
        L3 = LM * 0.15;
    }

    // =========================================================================
    // [세그먼트 1] 전면 하우징 (0 ~ -L1)
    // =========================================================================
    CiWorkPlane yzPlane1 = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, 0.0);
    pPart->SketchManager.StartSketch(yzPlane1);
    pPart->SketchManager.CreateSketchCircle((bodyDia * 0.9) / 2.0, 0.0, 0.0);
    pPart->SetSolidProfile();

    // ★ 방향: Negative (-X 방향 돌출)
    CiFeature body1 = pPart->FeatureManager.CreateExtrude(L1, CiDirectionOpEnum::Negative, CiJoinOpEnum::NewBody, 0, _T("Spindle_Front_Housing"));
    ApplyBodyMaterial(pPart, body1, _T("Steel"), _T("스틸"));

    // ★ 전면 샤프트 관통 홀 가공 (-X 방향 컷아웃)
    double shaftDia = m_partData->Dim.S > 0 ? m_partData->Dim.S : (10.0 / m_unit);
    double clearance = 2.0 / m_unit;
    pPart->SketchManager.StartSketch(yzPlane1);
    pPart->SketchManager.CreateSketchCircle((shaftDia + clearance) / 2.0, 0.0, 0.0);
    pPart->SetSolidProfile();
    pPart->FeatureManager.CreateExtrude(15.0 / m_unit, CiDirectionOpEnum::Negative, CiJoinOpEnum::Cut, 0, _T("Cut_ShaftHole"));

    // =========================================================================
    // [세그먼트 2] 메인 스핀들 바디 (-L1 ~ -(L1+L2))
    // =========================================================================
    if (L2 > 0.0) {
        // -L1 위치에 평면 생성
        CiWorkPlane yzPlane2 = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, -L1);
        pPart->SketchManager.StartSketch(yzPlane2);
        pPart->SketchManager.CreateSketchCircle(bodyDia / 2.0, 0.0, 0.0);
        pPart->SetSolidProfile();

        // ★ 방향: Negative (-X 방향 병합)
        pPart->FeatureManager.CreateExtrude(L2, CiDirectionOpEnum::Negative, CiJoinOpEnum::Join, 0, _T("Spindle_Main_Body"));
    }

    // =========================================================================
    // [세그먼트 3] 후면 캡 (-(L1+L2) ~ -(L1+L2+L3))
    // =========================================================================
    if (L3 > 0.0) {
        // -(L1+L2) 위치에 평면 생성
        CiWorkPlane yzPlane3 = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, -(L1 + L2));
        pPart->SketchManager.StartSketch(yzPlane3);
        pPart->SketchManager.CreateSketchCircle((bodyDia * 0.95) / 2.0, 0.0, 0.0);
        pPart->SetSolidProfile();

        pPart->FeatureManager.CreateExtrude(L3, CiDirectionOpEnum::Negative, CiJoinOpEnum::Join, 0, _T("Spindle_Rear_Cap"));
    }

    // =========================================================================
    // [단자 가공] 모터 커넥터 (메인 바디 위에 위치)
    // =========================================================================
    double mw = m_partData->Dim.CW_MW;
    double ml = m_partData->Dim.CL_ML;
    double mh = m_partData->Dim.CH_MH;

    if (mw > 0 || mh > 0 || ml > 0) {
        double embedDepth = 2.0 / m_unit;
        if (mw <= 0) mw = bodyDia * 0.3;
        if (ml <= 0) ml = bodyDia * 0.3;
        if (mh <= 0) mh = bodyDia * 0.15;

        // 메인 바디가 시작되는 -L1 위치에서 뒤쪽으로 ml/2 만큼 이동한 곳
        double motorTerminalCenterX = -L1 - (ml / 2.0);

        CiWorkPlane mPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ, (bodyDia / 2.0) - embedDepth);
        pPart->SketchManager.StartSketch(mPlane);
        pPart->SketchManager.SetPointXRevert(); // XZ 보정

        // 모터 커넥터이므로 ES_MD 적용 안 함 (Z=0.0)
        pPart->SketchManager.CreateSketchRect(ml, mw, CiPoint(motorTerminalCenterX, 0.0, 0.0), true);
        pPart->SetSolidProfile();

        // 방향 Positive (바깥쪽 돌출)
        pPart->FeatureManager.CreateExtrude(mh + embedDepth, CiDirectionOpEnum::Positive, CiJoinOpEnum::Join, 0, _T("Spindle_Terminal"));
    }

    // 마무리 연동 함수 (홀은 -X 방향, 커버는 +X 방향으로 알아서 처리됨)
    CreateMountingHoles(pPart);
    CreateShaftCover(pPart);

    return S_OK;
}

//=============================================================================
// 팬 모터 바디 생성 (Fan Motor)
// - 방향성: 바디(-X 방향), 중앙 허브(+X 방향 돌출)
//=============================================================================
HRESULT MotorCreator::CreateFanMotorBody(CiPart* pPart)
{
    double frameW = m_partData->Dim.LC;
    double bodyLen = m_partData->Dim.LM;
    double cornerR = m_partData->Dim.R > 0.0 ? m_partData->Dim.R : (5.0 / m_unit);

    // 중앙 허브 직경(LB 우선, 없으면 S 또는 프레임의 50%) 및 돌출 길이(LE)
    double hubDia = m_partData->Dim.LB > 0.0 ? m_partData->Dim.LB :
        (m_partData->Dim.S > 0.0 ? m_partData->Dim.S : frameW * 0.5);
    double hubProtrusion = m_partData->Dim.LE > 0.0 ? m_partData->Dim.LE : (2.0 / m_unit);

    if (frameW <= 0.0 || bodyLen <= 0.0) return E_INVALIDARG;

    // =========================================================================
    // [세그먼트 1] 메인 프레임 바디 (0 ~ -LM)
    // =========================================================================
    CiWorkPlane yzPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, 0.0);
    pPart->SketchManager.StartSketch(yzPlane);
    pPart->SketchManager.CreateSketchRectRound(frameW, frameW, cornerR);
    pPart->SetSolidProfile();

    // ★ 방향: Negative (-X 방향 돌출)
    CiFeature baseBody = pPart->FeatureManager.CreateExtrude(bodyLen, CiDirectionOpEnum::Negative, CiJoinOpEnum::NewBody, 0, _T("FanMotor_Base"));
    ApplyBodyMaterial(pPart, baseBody, _T("Plastic, Black"), _T("플라스틱 - 검정"));

    // =========================================================================
    // [세그먼트 2] 중앙 허브 (0 ~ +LE)
    // =========================================================================
    if (hubDia > 0.0) {
        pPart->SketchManager.StartSketch(yzPlane);
        pPart->SketchManager.CreateSketchCircle(hubDia / 2.0, 0.0, 0.0);
        pPart->SetSolidProfile();

        // ★ 방향: Positive (+X 방향으로 앞쪽 돌출)
        pPart->FeatureManager.CreateExtrude(hubProtrusion, CiDirectionOpEnum::Positive, CiJoinOpEnum::Join, 0, _T("FanMotor_Hub"));
    }

    // 샤프트 홀(-X 방향) 및 마운팅 홀(-X 방향) 가공
    double shaftDia = m_partData->Dim.S > 0.0 ? m_partData->Dim.S : (8.0 / m_unit);
    pPart->SketchManager.StartSketch(yzPlane);
    pPart->SketchManager.CreateSketchCircle((shaftDia + 2.0 / m_unit) / 2.0, 0.0, 0.0);
    pPart->SetSolidProfile();
    pPart->FeatureManager.CreateExtrude(15.0 / m_unit, CiDirectionOpEnum::Negative, CiJoinOpEnum::Cut, 0, _T("Cut_ShaftHole"));

    CreateMountingHoles(pPart);
    CreateShaftCover(pPart);

    return S_OK;
}

//=============================================================================
// 리니어 액추에이터 바디 생성 (Linear Actuator)
// - 방향성: 하우징(-X 방향)
// - 커넥터: 바디 상단 XZ 평면 보정 적용, Positive 돌출
//=============================================================================
HRESULT MotorCreator::CreateLinearActuatorBody(CiPart* pPart)
{
    double bodyLen = m_partData->Dim.LM;
    double frameW = m_partData->Dim.LC;
    double frameH = m_partData->Dim.LH > 0.0 ? m_partData->Dim.LH : frameW;
    double bodyDia = m_partData->Dim.ES_MD > 0.0 ? m_partData->Dim.ES_MD : m_partData->Dim.S;

    if (bodyLen <= 0.0) return E_INVALIDARG;

    // =========================================================================
    // [세그먼트 1] 하우징 베이스 (0 ~ -LM)
    // =========================================================================
    CiWorkPlane yzPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, 0.0);
    pPart->SketchManager.StartSketch(yzPlane);

    if (frameW > 0.0) {
        double cornerR = m_partData->Dim.R > 0.0 ? m_partData->Dim.R : (1.0 / m_unit);
        pPart->SketchManager.CreateSketchRectRound(frameW, frameH, cornerR);
    }
    else {
        pPart->SketchManager.CreateSketchCircle(bodyDia / 2.0, 0.0, 0.0);
    }
    pPart->SetSolidProfile();

    // ★ 방향: Negative (-X 방향 돌출)
    CiFeature actBody = pPart->FeatureManager.CreateExtrude(bodyLen, CiDirectionOpEnum::Negative, CiJoinOpEnum::NewBody, 0, _T("Actuator_Housing"));
    ApplyBodyMaterial(pPart, actBody, _T("Aluminum, Polished"), _T("알루미늄 - 연마"));

    // 전면 샤프트 관통 홀 (-X 방향)
    double shaftDia = m_partData->Dim.S > 0.0 ? m_partData->Dim.S : (10.0 / m_unit);
    pPart->SketchManager.StartSketch(yzPlane);
    pPart->SketchManager.CreateSketchCircle((shaftDia + 2.0 / m_unit) / 2.0, 0.0, 0.0);
    pPart->SetSolidProfile();
    pPart->FeatureManager.CreateExtrude(15.0 / m_unit, CiDirectionOpEnum::Negative, CiJoinOpEnum::Cut, 0, _T("Cut_ShaftHole"));

    // =========================================================================
    // [단자 가공] 액추에이터 커넥터 블록
    // =========================================================================
    double mw = m_partData->Dim.CW_MW;
    double ml = m_partData->Dim.CL_ML;
    double mh = m_partData->Dim.CH_MH;

    if (mw > 0.0 || mh > 0.0 || ml > 0.0) {
        double embedDepth = 2.0 / m_unit;
        double refW = frameW > 0.0 ? frameW : bodyDia;
        double refH = frameH > 0.0 ? frameH : bodyDia;

        if (mw <= 0.0) mw = refW * 0.3;
        if (ml <= 0.0) ml = refW * 0.3;
        if (mh <= 0.0) mh = refH * 0.15;

        // 바디 끝단(-LM) 근처에 커넥터 위치
        double termCenterX = -bodyLen + (ml / 2.0) + (10.0 / m_unit);

        CiWorkPlane mPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ, (refH / 2.0) - embedDepth);
        pPart->SketchManager.StartSketch(mPlane);
        pPart->SketchManager.SetPointXRevert(); // XZ 보정

        pPart->SketchManager.CreateSketchRect(ml, mw, CiPoint(termCenterX, 0.0, 0.0), true);
        pPart->SetSolidProfile();

        // 방향 Positive (바깥쪽 돌출)
        pPart->FeatureManager.CreateExtrude(mh + embedDepth, CiDirectionOpEnum::Positive, CiJoinOpEnum::Join, 0, _T("Actuator_Terminal"));
    }

    CreateMountingHoles(pPart);
    CreateShaftCover(pPart);

    return S_OK;
}

//=============================================================================
// 1. 드럼 모터 (Drum Motor) 바디 생성
// - 특징: 컨베이어 구동용 롤러 형태. 중앙 메인 드럼과 양쪽의 고정축(Shaft)으로 구성
// - 방향성: -X 방향으로 메인 드럼 생성 후, 양 끝단에 축 생성
//=============================================================================
HRESULT MotorCreator::CreateDrumMotorBody(CiPart* pPart)
{
    double drumDia = m_partData->Dim.LB > 0.0 ? m_partData->Dim.LB : m_partData->Dim.LC; // 드럼 외경
    double drumLen = m_partData->Dim.LM; // 드럼 면 길이 (Face Width)
    double shaftDia = m_partData->Dim.S; // 고정축 직경
    double shaftLen = m_partData->Dim.LR > 0.0 ? m_partData->Dim.LR : (50.0 / m_unit); // 양단 축 길이

    if (drumDia <= 0.0 || drumLen <= 0.0) return E_INVALIDARG;

    // [1] 중앙 메인 드럼 (Steel / Stainless Steel)
    CiWorkPlane yzPlaneBase = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, 0.0);
    pPart->SketchManager.StartSketch(yzPlaneBase);
    pPart->SketchManager.CreateSketchCircle(drumDia / 2.0, 0.0, 0.0);
    pPart->SetSolidProfile();

    // -X 방향으로 드럼 본체 압출
    CiFeature drumBody = pPart->FeatureManager.CreateExtrude(drumLen, CiDirectionOpEnum::Negative, CiJoinOpEnum::NewBody, 0, _T("Drum_Main_Body"));
    ApplyBodyMaterial(pPart, drumBody, _T("Steel - Polished"), _T("강철 - 연마"));

    // [2] 앞쪽 고정축 (+X 방향 돌출)
    if (shaftDia > 0.0) {
        pPart->SketchManager.StartSketch(yzPlaneBase);
        pPart->SketchManager.CreateSketchCircle(shaftDia / 2.0, 0.0, 0.0);
        pPart->SetSolidProfile();
        CiFeature frontShaft = pPart->FeatureManager.CreateExtrude(shaftLen, CiDirectionOpEnum::Positive, CiJoinOpEnum::NewBody, 0, _T("Drum_Front_Shaft"));
        ApplyBodyMaterial(pPart, frontShaft, _T("Steel - Galvanized"), _T("강철 - 아연도금"));
    }

    // [3] 뒤쪽 고정축 (-X 방향, 드럼 끝에서 더 뒤로 돌출)
    if (shaftDia > 0.0) {
        CiWorkPlane yzPlaneRear = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, -drumLen);
        pPart->SketchManager.StartSketch(yzPlaneRear);
        pPart->SketchManager.CreateSketchCircle(shaftDia / 2.0, 0.0, 0.0);
        pPart->SetSolidProfile();
        CiFeature rearShaft = pPart->FeatureManager.CreateExtrude(shaftLen, CiDirectionOpEnum::Negative, CiJoinOpEnum::NewBody, 0, _T("Drum_Rear_Shaft"));
        ApplyBodyMaterial(pPart, rearShaft, _T("Steel - Galvanized"), _T("강철 - 아연도금"));
    }

    return S_OK;
}

//=============================================================================
// 2. 진동 모터 (ERM Vibration Motor) 바디 생성
// - 특징: 초소형 원통형 바디 + 축 끝단에 부착된 반달 모양의 편심 추(Eccentric Mass)
// - API 호환: CreateSketchArc(중심, 시작, 끝, 방향) 사용하여 반원 작도
//=============================================================================
HRESULT MotorCreator::CreateVibrationMotorBody(CiPart* pPart)
{
    double bodyDia = m_partData->Dim.LC > 0.0 ? m_partData->Dim.LC : (6.0 / m_unit);
    double bodyLen = m_partData->Dim.LM > 0.0 ? m_partData->Dim.LM : (12.0 / m_unit);
    double shaftDia = m_partData->Dim.S > 0.0 ? m_partData->Dim.S : (1.0 / m_unit);
    double shaftLen = m_partData->Dim.LR > 0.0 ? m_partData->Dim.LR : (4.0 / m_unit);

    // [1] 모터 메인 바디 (-X 방향)
    CiWorkPlane yzPlaneBase = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, 0.0);
    pPart->SketchManager.StartSketch(yzPlaneBase);
    pPart->SketchManager.CreateSketchCircle(bodyDia / 2.0, 0.0, 0.0);
    pPart->SetSolidProfile();
    CiFeature motorBody = pPart->FeatureManager.CreateExtrude(bodyLen, CiDirectionOpEnum::Negative, CiJoinOpEnum::NewBody, 0, _T("Vib_Motor_Body"));
    ApplyBodyMaterial(pPart, motorBody, _T("Aluminum - Polished"), _T("알루미늄 - 연마"));

    // [2] 출력축 (+X 방향)
    pPart->SketchManager.StartSketch(yzPlaneBase);
    pPart->SketchManager.CreateSketchCircle(shaftDia / 2.0, 0.0, 0.0);
    pPart->SetSolidProfile();
    pPart->FeatureManager.CreateExtrude(shaftLen, CiDirectionOpEnum::Positive, CiJoinOpEnum::NewBody, 0, _T("Vib_Shaft"));

    // [3] 편심 추 (Eccentric Mass) 생성
    double massLen = shaftLen * 0.8;
    double massDia = bodyDia * 0.8;
    double massStart = shaftLen * 0.1; // 축에서 살짝 띄움

    CiWorkPlane yzPlaneMass = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, massStart);
    pPart->SketchManager.StartSketch(yzPlaneMass);
    pPart->SketchManager.SetPointXYReplace(); // YZ 보정

    // ★ 수정된 반원(반달 모양) 스케치 로직
    CiSketchPoint pCenter = pPart->SketchManager.SetSketchPoint(0.0, 0.0);                  // 중심점
    CiSketchPoint pTop = pPart->SketchManager.SetSketchPoint(0.0, massDia / 2.0);        // 상단점 (Y+)
    CiSketchPoint pBottom = pPart->SketchManager.SetSketchPoint(0.0, -massDia / 2.0);       // 하단점 (Y-)

    // 하단점(Start)에서 상단점(End)으로 반시계방향(true)으로 그리면 오른쪽 반원이 됨
    pPart->SketchManager.CreateSketchArc(pCenter, pBottom, pTop, true);

    // 직선으로 상단과 하단을 연결하여 닫힌 프로파일 생성
    pPart->SketchManager.CreateSketchLine(pTop, pBottom);

    pPart->SetSolidProfile();

    CiFeature massBody = pPart->FeatureManager.CreateExtrude(massLen, CiDirectionOpEnum::Positive, CiJoinOpEnum::NewBody, 0, _T("Eccentric_Mass"));
    ApplyBodyMaterial(pPart, massBody, _T("Brass - Polished"), _T("황동 - 연마")); // 황동 재질 적용

    return S_OK;
}

//=============================================================================
// 3. 코어리스 모터 (Coreless DC Motor) 바디 생성
// - 특징: 얇은 금속 케이스 + 후면 플라스틱 브라켓(터미널 부)
//=============================================================================
HRESULT MotorCreator::CreateCorelessMotorBody(CiPart* pPart)
{
    double bodyDia = m_partData->Dim.LC > 0.0 ? m_partData->Dim.LC : (16.0 / m_unit);
    double bodyLen = m_partData->Dim.LM > 0.0 ? m_partData->Dim.LM : (25.0 / m_unit);
    double capLen = bodyLen * 0.15; // 후면 플라스틱 캡의 비율
    double caseLen = bodyLen - capLen;

    if (bodyDia <= 0.0 || bodyLen <= 0.0) return E_INVALIDARG;

    // [1] 메인 금속 케이스 (-X 방향, 0 ~ -caseLen)
    CiWorkPlane yzPlaneBase = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, 0.0);
    pPart->SketchManager.StartSketch(yzPlaneBase);
    pPart->SketchManager.CreateSketchCircle(bodyDia / 2.0, 0.0, 0.0);
    pPart->SetSolidProfile();

    CiFeature caseBody = pPart->FeatureManager.CreateExtrude(caseLen, CiDirectionOpEnum::Negative, CiJoinOpEnum::NewBody, 0, _T("Coreless_Case"));
    ApplyBodyMaterial(pPart, caseBody, _T("Steel - Polished"), _T("강철 - 연마"));

    // 전면 샤프트 홀 가공
    double shaftDia = m_partData->Dim.S > 0 ? m_partData->Dim.S : (1.5 / m_unit);
    pPart->SketchManager.StartSketch(yzPlaneBase);
    pPart->SketchManager.CreateSketchCircle((shaftDia + 1.0 / m_unit) / 2.0, 0.0, 0.0);
    pPart->SetSolidProfile();
    pPart->FeatureManager.CreateExtrude(2.0 / m_unit, CiDirectionOpEnum::Negative, CiJoinOpEnum::Cut, 0, _T("Cut_FrontHole"));

    // [2] 후면 플라스틱 캡 (-X 방향, -caseLen ~ -bodyLen)
    CiWorkPlane yzPlaneRear = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, -caseLen);
    pPart->SketchManager.StartSketch(yzPlaneRear);
    pPart->SketchManager.CreateSketchCircle(bodyDia / 2.0, 0.0, 0.0);
    pPart->SetSolidProfile();

    CiFeature capBody = pPart->FeatureManager.CreateExtrude(capLen, CiDirectionOpEnum::Negative, CiJoinOpEnum::NewBody, 0, _T("Coreless_Rear_Cap"));
    ApplyBodyMaterial(pPart, capBody, _T("Plastic - Black"), _T("플라스틱 - 검정"));

    // [3] 전원 단자 핀 (Pin Terminals)
    double pinLen = 3.0 / m_unit;
    CiWorkPlane yzPlanePin = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, -bodyLen);

    // +극, -극 핀 2개 생성
    for (int i = -1; i <= 1; i += 2) {
        pPart->SketchManager.StartSketch(yzPlanePin);
        pPart->SketchManager.SetPointXYReplace();
        // 중심에서 위아래로 약간 이격하여 직사각형 핀 스케치
        pPart->SketchManager.CreateSketchRect(1.0 / m_unit, 0.5 / m_unit, CiPoint(0.0, i * (bodyDia * 0.25), 0.0), true);
        pPart->SetSolidProfile();
        CiFeature pinFeat = pPart->FeatureManager.CreateExtrude(pinLen, CiDirectionOpEnum::Negative, CiJoinOpEnum::NewBody, 0, _T("Terminal_Pin"));
        ApplyBodyMaterial(pPart, pinFeat, _T("Copper - Alloy"), _T("구리 - 합금"));
    }

    return S_OK;
}

//=============================================================================
// 4. 산업용 AC 유도 모터 (Industrial AC Induction Motor) 바디 생성
// - 특징: 주철 프레임, 대형 상단 단자함, 후면 냉각 팬 커버 구조
// - 재질: 강철 - 주조 (메인 하우징) / 강철 - 얇은판 (팬 커버)
//=============================================================================
HRESULT MotorCreator::CreateACInductionMotorBody(CiPart* pPart)
{
    double bodyDia = m_partData->Dim.LB > 0.0 ? m_partData->Dim.LB : m_partData->Dim.LC; // 프레임 외경
    double bodyLen = m_partData->Dim.LM; // 전체 길이

    if (bodyDia <= 0.0 || bodyLen <= 0.0) return E_INVALIDARG;

    double statorLen = bodyLen * 0.75; // 메인 하우징 길이
    double fanCoverLen = bodyLen - statorLen; // 후면 팬 커버 길이

    // [1] 메인 주철 하우징 (-X 방향)
    CiWorkPlane yzPlaneBase = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, 0.0);
    pPart->SketchManager.StartSketch(yzPlaneBase);
    pPart->SketchManager.CreateSketchCircle(bodyDia / 2.0, 0.0, 0.0);
    pPart->SetSolidProfile();

    CiFeature statorFeat = pPart->FeatureManager.CreateExtrude(statorLen, CiDirectionOpEnum::Negative, CiJoinOpEnum::NewBody, 0, _T("AC_Stator_Housing"));
    ApplyBodyMaterial(pPart, statorFeat, _T("Steel - Cast"), _T("강철 - 주조"));

    // 전면 샤프트 홀 컷아웃
    double shaftDia = m_partData->Dim.S > 0 ? m_partData->Dim.S : (14.0 / m_unit);
    pPart->SketchManager.StartSketch(yzPlaneBase);
    pPart->SketchManager.CreateSketchCircle((shaftDia + 2.0 / m_unit) / 2.0, 0.0, 0.0);
    pPart->SetSolidProfile();
    pPart->FeatureManager.CreateExtrude(15.0 / m_unit, CiDirectionOpEnum::Negative, CiJoinOpEnum::Cut, 0, _T("Cut_ShaftHole"));

    // [2] 후면 냉각 팬 커버 (-X 방향, 얇은 강철판 느낌)
    CiWorkPlane yzPlaneFan = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, -statorLen);
    pPart->SketchManager.StartSketch(yzPlaneFan);
    pPart->SketchManager.CreateSketchCircle((bodyDia * 0.95) / 2.0, 0.0, 0.0); // 하우징보다 살짝 작게
    pPart->SetSolidProfile();

    CiFeature fanFeat = pPart->FeatureManager.CreateExtrude(fanCoverLen, CiDirectionOpEnum::Negative, CiJoinOpEnum::NewBody, 0, _T("AC_Fan_Cover"));
    ApplyBodyMaterial(pPart, fanFeat, _T("Steel - Galvanized"), _T("강철 - 아연도금"));

    // [3] 대형 단자함 (Terminal Box) - 상단(+Y 방향)에 돌출
    double tbWidth = bodyDia * 0.4;
    double tbLength = bodyDia * 0.5;
    double tbHeight = bodyDia * 0.3;
    double tbOffsetZ = m_partData->Dim.ES_MD; // Z축 편심이 있을 경우 적용

    double embedDepth = 2.0 / m_unit;
    double tbCenterX = -(statorLen / 2.0); // 하우징 중간에 위치

    CiWorkPlane xzPlaneTB = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ, (bodyDia / 2.0) - embedDepth);
    pPart->SketchManager.StartSketch(xzPlaneTB);
    pPart->SketchManager.SetPointXRevert(); // XZ 평면 보정

    pPart->SketchManager.CreateSketchRect(tbLength, tbWidth, CiPoint(tbCenterX, tbOffsetZ, 0.0), true);
    pPart->SetSolidProfile();

    CiFeature tbFeat = pPart->FeatureManager.CreateExtrude(tbHeight + embedDepth, CiDirectionOpEnum::Positive, CiJoinOpEnum::NewBody, 0, _T("AC_Terminal_Box"));
    ApplyBodyMaterial(pPart, tbFeat, _T("Steel - Cast"), _T("강철 - 주조"));

    CreateMountingHoles(pPart);
    CreateShaftCover(pPart);

    return S_OK;
}

//=============================================================================
// 5. 소형 기어드 모터 베이스 (Small Motor) 바디 생성
// - 특징: 전면 사각 플랜지 + 원통형 메인 바디 + 후면 소형 단자/리드선 취출구
// - 재질: 알루미늄 다이캐스팅 (플랜지) + 피막 처리 (바디)
//=============================================================================
HRESULT MotorCreator::CreateSmallMotorBody(CiPart* pPart)
{
    double frameW = m_partData->Dim.LC; // 사각 플랜지 크기 (예: 90mm)
    double bodyLen = m_partData->Dim.LM;

    if (frameW <= 0.0 || bodyLen <= 0.0) return E_INVALIDARG;

    double flangeThick = 5.0 / m_unit; // 전면 플랜지 두께
    double motorDia = frameW * 0.9;    // 원통형 바디 직경 (프레임보다 약간 작음)

    // [1] 전면 사각 플랜지 (-X 방향)
    CiWorkPlane yzPlaneFront = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, 0.0);
    pPart->SketchManager.StartSketch(yzPlaneFront);
    double cornerR = 2.0 / m_unit;
    pPart->SketchManager.CreateSketchRectRound(frameW, frameW, cornerR); // (H, W) 스왑 적용 방식
    pPart->SetSolidProfile();

    CiFeature flangeFeat = pPart->FeatureManager.CreateExtrude(flangeThick, CiDirectionOpEnum::Negative, CiJoinOpEnum::NewBody, 0, _T("Small_Flange"));
    ApplyBodyMaterial(pPart, flangeFeat, _T("Aluminum - Cast"), _T("알루미늄 - 주조"));

    // 샤프트 홀
    double shaftDia = m_partData->Dim.S > 0 ? m_partData->Dim.S : (10.0 / m_unit);
    pPart->SketchManager.StartSketch(yzPlaneFront);
    pPart->SketchManager.CreateSketchCircle((shaftDia + 2.0 / m_unit) / 2.0, 0.0, 0.0);
    pPart->SetSolidProfile();
    pPart->FeatureManager.CreateExtrude(15.0 / m_unit, CiDirectionOpEnum::Negative, CiJoinOpEnum::Cut, 0, _T("Cut_ShaftHole"));

    // [2] 원통형 메인 바디 (-X 방향)
    CiWorkPlane yzPlaneBody = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, -flangeThick);
    pPart->SketchManager.StartSketch(yzPlaneBody);
    pPart->SketchManager.CreateSketchCircle(motorDia / 2.0, 0.0, 0.0);
    pPart->SetSolidProfile();

    CiFeature bodyFeat = pPart->FeatureManager.CreateExtrude(bodyLen - flangeThick, CiDirectionOpEnum::Negative, CiJoinOpEnum::NewBody, 0, _T("Small_Motor_Body"));
    ApplyBodyMaterial(pPart, bodyFeat, _T("Anodized - Black"), _T("피막 처리 - 검은색"));

    // [3] 후면 리드선/콘덴서 커넥터 블록
    double termW = frameW * 0.4;
    double embedDepth = 2.0 / m_unit;
    CiWorkPlane xzPlaneTerm = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ, (motorDia / 2.0) - embedDepth);
    pPart->SketchManager.StartSketch(xzPlaneTerm);
    pPart->SketchManager.SetPointXRevert();

    pPart->SketchManager.CreateSketchRect(termW, termW, CiPoint(-bodyLen + (termW / 2), 0.0, 0.0), true);
    pPart->SetSolidProfile();

    CiFeature termFeat = pPart->FeatureManager.CreateExtrude(10.0 / m_unit + embedDepth, CiDirectionOpEnum::Positive, CiJoinOpEnum::NewBody, 0, _T("Small_Terminal"));
    ApplyBodyMaterial(pPart, termFeat, _T("Plastic - Black"), _T("플라스틱 - 검정"));

    CreateMountingHoles(pPart);
    CreateShaftCover(pPart);

    return S_OK;
}

//=============================================================================
// 6. 브러시드 DC 모터 (Brushed DC Motor) 바디 생성
// - 특징: 금속 원통 바디 + 후면 정류자(Commutator) 섹션 + 양측면 브러시 캡
//=============================================================================
HRESULT MotorCreator::CreateDCMotorBody(CiPart* pPart)
{
    double bodyDia = m_partData->Dim.LB > 0.0 ? m_partData->Dim.LB : m_partData->Dim.LC;
    double bodyLen = m_partData->Dim.LM;

    if (bodyDia <= 0.0 || bodyLen <= 0.0) return E_INVALIDARG;

    double mainBodyLen = bodyLen * 0.8; // 자석이 위치한 메인 하우징
    double commLen = bodyLen - mainBodyLen; // 브러시/정류자가 위치한 후면부

    // [1] 메인 하우징 (-X 방향)
    CiWorkPlane yzPlaneBase = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, 0.0);
    pPart->SketchManager.StartSketch(yzPlaneBase);
    pPart->SketchManager.CreateSketchCircle(bodyDia / 2.0, 0.0, 0.0);
    pPart->SetSolidProfile();

    CiFeature mainFeat = pPart->FeatureManager.CreateExtrude(mainBodyLen, CiDirectionOpEnum::Negative, CiJoinOpEnum::NewBody, 0, _T("DC_Main_Body"));
    ApplyBodyMaterial(pPart, mainFeat, _T("Steel - Polished"), _T("강철 - 연마")); // 금속 캔 느낌

    // 샤프트 홀
    double shaftDia = m_partData->Dim.S > 0 ? m_partData->Dim.S : (8.0 / m_unit);
    pPart->SketchManager.StartSketch(yzPlaneBase);
    pPart->SketchManager.CreateSketchCircle((shaftDia + 1.0 / m_unit) / 2.0, 0.0, 0.0);
    pPart->SetSolidProfile();
    pPart->FeatureManager.CreateExtrude(10.0 / m_unit, CiDirectionOpEnum::Negative, CiJoinOpEnum::Cut, 0, _T("Cut_ShaftHole"));

    // [2] 후면 브러시/정류자 섹션 (-X 방향)
    double commDia = bodyDia * 0.9; // 메인 하우징보다 약간 작음
    CiWorkPlane yzPlaneComm = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, -mainBodyLen);
    pPart->SketchManager.StartSketch(yzPlaneComm);
    pPart->SketchManager.CreateSketchCircle(commDia / 2.0, 0.0, 0.0);
    pPart->SetSolidProfile();

    CiFeature commFeat = pPart->FeatureManager.CreateExtrude(commLen, CiDirectionOpEnum::Negative, CiJoinOpEnum::NewBody, 0, _T("DC_Commutator_Section"));
    ApplyBodyMaterial(pPart, commFeat, _T("Plastic - Black"), _T("플라스틱 - 검정"));

    // [3] 브러시 캡 (양 측면 돌출부)
    // Z축 평면(XY 평면)에서 스케치하여 양방향(Symmetry)으로 돌출시킴
    double capDia = bodyDia * 0.25;
    double brushPosX = -mainBodyLen - (commLen / 2.0);

    CiWorkPlane xyPlaneBrush = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XY, 0.0);
    pPart->SketchManager.StartSketch(xyPlaneBrush);
    // 중심이 (brushPosX, 0.0) 인 원을 작도
    pPart->SketchManager.CreateSketchCircle(capDia / 2.0, brushPosX, 0.0);
    pPart->SetSolidProfile();

    // 양쪽으로 튀어나오도록 대칭(Symmetry) 돌출. 폭은 바디 직경보다 약간 넓게(bodyDia + 5mm)
    CiFeature brushCapFeat = pPart->FeatureManager.CreateExtrude(bodyDia + (5.0 / m_unit), CiDirectionOpEnum::Symmetry, CiJoinOpEnum::NewBody, 0, _T("DC_Brush_Caps"));
    ApplyBodyMaterial(pPart, brushCapFeat, _T("Nylon 6/6"), _T("나일론 6/6")); // 검정색 나일론 캡

    CreateMountingHoles(pPart);
    CreateShaftCover(pPart);

    return S_OK;
}

//=============================================================================
// 7. 유니버셜 모터 (Universal Motor) 바디 생성
// - 특징: 고속 회전용 스테이터 코어 노출 구조 + 양 측면 브러시 홀더 돌출
// - 재질: 강철(코어) 및 플라스틱(브라켓/홀더)
//=============================================================================
HRESULT MotorCreator::CreateUniversalMotorBody(CiPart* pPart)
{
    double bodyDia = m_partData->Dim.LB > 0.0 ? m_partData->Dim.LB : m_partData->Dim.LC;
    double bodyLen = m_partData->Dim.LM;

    if (bodyDia <= 0.0 || bodyLen <= 0.0) return E_INVALIDARG;

    double bracketLen = bodyLen * 0.2; // 전/후면 브라켓 두께
    double coreLen = bodyLen - (bracketLen * 2); // 중앙 노출 코어 길이

    // [1] 전면 브라켓 (-X 방향)
    CiWorkPlane yzPlaneFront = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, 0.0);
    pPart->SketchManager.StartSketch(yzPlaneFront);
    pPart->SketchManager.CreateSketchCircle(bodyDia / 2.0, 0.0, 0.0);
    pPart->SetSolidProfile();
    CiFeature frontFeat = pPart->FeatureManager.CreateExtrude(bracketLen, CiDirectionOpEnum::Negative, CiJoinOpEnum::NewBody, 0, _T("Univ_Front_Bracket"));
    ApplyBodyMaterial(pPart, frontFeat, _T("Aluminum - Cast"), _T("알루미늄 - 주조"));

    // 샤프트 홀 컷아웃
    double shaftDia = m_partData->Dim.S > 0 ? m_partData->Dim.S : (8.0 / m_unit);
    pPart->SketchManager.StartSketch(yzPlaneFront);
    pPart->SketchManager.CreateSketchCircle((shaftDia + 2.0 / m_unit) / 2.0, 0.0, 0.0);
    pPart->SetSolidProfile();
    pPart->FeatureManager.CreateExtrude(10.0 / m_unit, CiDirectionOpEnum::Negative, CiJoinOpEnum::Cut, 0, _T("Cut_ShaftHole"));

    // [2] 중앙 노출 코어 (Lamination) (-X 방향)
    double coreDia = bodyDia * 0.95; // 브라켓보다 살짝 작게 단차
    CiWorkPlane yzPlaneCore = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, -bracketLen);
    pPart->SketchManager.StartSketch(yzPlaneCore);
    pPart->SketchManager.CreateSketchCircle(coreDia / 2.0, 0.0, 0.0);
    pPart->SetSolidProfile();
    CiFeature coreFeat = pPart->FeatureManager.CreateExtrude(coreLen, CiDirectionOpEnum::Negative, CiJoinOpEnum::NewBody, 0, _T("Univ_Stator_Core"));
    ApplyBodyMaterial(pPart, coreFeat, _T("Steel - Cast"), _T("강철 - 주조"));

    // [3] 후면 브라켓 (-X 방향)
    CiWorkPlane yzPlaneRear = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, -(bracketLen + coreLen));
    pPart->SketchManager.StartSketch(yzPlaneRear);
    pPart->SketchManager.CreateSketchCircle(bodyDia / 2.0, 0.0, 0.0);
    pPart->SetSolidProfile();
    CiFeature rearFeat = pPart->FeatureManager.CreateExtrude(bracketLen, CiDirectionOpEnum::Negative, CiJoinOpEnum::NewBody, 0, _T("Univ_Rear_Bracket"));
    ApplyBodyMaterial(pPart, rearFeat, _T("Aluminum - Cast"), _T("알루미늄 - 주조"));

    // [4] 브러시 홀더 (후면 브라켓 측면에 돌출)
    double brushDia = bodyDia * 0.3;
    double brushPosX = -bodyLen + (bracketLen / 2.0); // 후면 브라켓 중앙
    CiWorkPlane xyPlaneBrush = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XY, 0.0);
    pPart->SketchManager.StartSketch(xyPlaneBrush);
    pPart->SketchManager.CreateSketchCircle(brushDia / 2.0, brushPosX, 0.0);
    pPart->SetSolidProfile();

    CiFeature brushFeat = pPart->FeatureManager.CreateExtrude(bodyDia + (10.0 / m_unit), CiDirectionOpEnum::Symmetry, CiJoinOpEnum::NewBody, 0, _T("Univ_Brush_Holders"));
    ApplyBodyMaterial(pPart, brushFeat, _T("Plastic - Black"), _T("플라스틱 - 검정"));

    CreateMountingHoles(pPart);
    CreateShaftCover(pPart);

    return S_OK;
}

//=============================================================================
// 8. 공압 모터 (Pneumatic / Air Motor) 바디 생성
// - 특징: 밋밋한 원통형 금속 하우징 + 후면 에어(Air) IN/OUT 포트 연결부
// - 재질: 스테인리스스틸 (방폭/내환경 특성 반영)
//=============================================================================
HRESULT MotorCreator::CreatePneumaticMotorBody(CiPart* pPart)
{
    double bodyDia = m_partData->Dim.LB > 0.0 ? m_partData->Dim.LB : m_partData->Dim.LC;
    double bodyLen = m_partData->Dim.LM;

    if (bodyDia <= 0.0 || bodyLen <= 0.0) return E_INVALIDARG;

    double portBlockLen = 20.0 / m_unit; // 후면 에어 포트 블록 두께
    double mainLen = bodyLen - portBlockLen;

    // [1] 메인 하우징 (-X 방향)
    CiWorkPlane yzPlaneBase = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, 0.0);
    pPart->SketchManager.StartSketch(yzPlaneBase);
    pPart->SketchManager.CreateSketchCircle(bodyDia / 2.0, 0.0, 0.0);
    pPart->SetSolidProfile();

    CiFeature mainFeat = pPart->FeatureManager.CreateExtrude(mainLen, CiDirectionOpEnum::Negative, CiJoinOpEnum::NewBody, 0, _T("AirMotor_Housing"));
    ApplyBodyMaterial(pPart, mainFeat, _T("Stainless Steel"), _T("스테인리스스틸"));

    // 전면 샤프트 홀
    double shaftDia = m_partData->Dim.S > 0 ? m_partData->Dim.S : (12.0 / m_unit);
    pPart->SketchManager.StartSketch(yzPlaneBase);
    pPart->SketchManager.CreateSketchCircle((shaftDia + 2.0 / m_unit) / 2.0, 0.0, 0.0);
    pPart->SetSolidProfile();
    pPart->FeatureManager.CreateExtrude(15.0 / m_unit, CiDirectionOpEnum::Negative, CiJoinOpEnum::Cut, 0, _T("Cut_ShaftHole"));

    // [2] 후면 에어 포트 블록 (-X 방향)
    CiWorkPlane yzPlanePort = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, -mainLen);
    pPart->SketchManager.StartSketch(yzPlanePort);
    pPart->SketchManager.CreateSketchCircle((bodyDia * 0.8) / 2.0, 0.0, 0.0); // 챔퍼 느낌을 위해 약간 작게
    pPart->SetSolidProfile();

    CiFeature portFeat = pPart->FeatureManager.CreateExtrude(portBlockLen, CiDirectionOpEnum::Negative, CiJoinOpEnum::NewBody, 0, _T("AirMotor_PortBlock"));
    ApplyBodyMaterial(pPart, portFeat, _T("Aluminum - Polished"), _T("알루미늄 - 연마"));

    // [3] 에어 포트 구멍 (IN / OUT 2개의 홀을 후면에 가공)
    double portDia = 10.0 / m_unit;
    pPart->SketchManager.StartSketch(yzPlanePort);
    pPart->SketchManager.SetPointXYReplace(); // YZ 보정
    // 중심축 기준 위/아래로 포트 홀 생성
    pPart->SketchManager.CreateSketchCircle(portDia / 2.0, CiPoint(0.0, bodyDia * 0.2, 0.0));
    pPart->SketchManager.CreateSketchCircle(portDia / 2.0, CiPoint(0.0, -bodyDia * 0.2, 0.0));
    pPart->SetSolidProfile();
    pPart->FeatureManager.CreateExtrude(15.0 / m_unit, CiDirectionOpEnum::Negative, CiJoinOpEnum::Cut, 0, _T("Cut_AirPorts"));

    CreateMountingHoles(pPart);
    CreateShaftCover(pPart);

    return S_OK;
}

//=============================================================================
// 9. 유압 모터 (Hydraulic Motor) 바디 생성
// - 특징: 튼튼한 주철 바디 + 측면 대형 유압 포트 매니폴드(Manifold)
// - 재질: 강철 - 주조 (육중한 쇳덩어리 느낌)
//=============================================================================
HRESULT MotorCreator::CreateHydraulicMotorBody(CiPart* pPart)
{
    double bodyDia = m_partData->Dim.LB > 0.0 ? m_partData->Dim.LB : m_partData->Dim.LC;
    double bodyLen = m_partData->Dim.LM;

    if (bodyDia <= 0.0 || bodyLen <= 0.0) return E_INVALIDARG;

    // [1] 튼튼한 2단 주철 하우징 (-X 방향)
    double frontLen = bodyLen * 0.4;
    double rearLen = bodyLen - frontLen;

    // 1단 (플랜지부)
    CiWorkPlane yzPlane1 = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, 0.0);
    pPart->SketchManager.StartSketch(yzPlane1);
    pPart->SketchManager.CreateSketchCircle(bodyDia / 2.0, 0.0, 0.0);
    pPart->SetSolidProfile();
    CiFeature feat1 = pPart->FeatureManager.CreateExtrude(frontLen, CiDirectionOpEnum::Negative, CiJoinOpEnum::NewBody, 0, _T("Hyd_Front_Housing"));
    ApplyBodyMaterial(pPart, feat1, _T("Steel - Cast"), _T("강철 - 주조"));

    // 전면 샤프트 홀
    double shaftDia = m_partData->Dim.S > 0 ? m_partData->Dim.S : (25.0 / m_unit); // 유압은 샤프트가 굵음
    pPart->SketchManager.StartSketch(yzPlane1);
    pPart->SketchManager.CreateSketchCircle((shaftDia + 3.0 / m_unit) / 2.0, 0.0, 0.0);
    pPart->SetSolidProfile();
    pPart->FeatureManager.CreateExtrude(20.0 / m_unit, CiDirectionOpEnum::Negative, CiJoinOpEnum::Cut, 0, _T("Cut_ShaftHole"));

    // 2단 (실린더부)
    CiWorkPlane yzPlane2 = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, -frontLen);
    pPart->SketchManager.StartSketch(yzPlane2);
    pPart->SketchManager.CreateSketchCircle((bodyDia * 0.9) / 2.0, 0.0, 0.0);
    pPart->SetSolidProfile();
    CiFeature feat2 = pPart->FeatureManager.CreateExtrude(rearLen, CiDirectionOpEnum::Negative, CiJoinOpEnum::Join, 0, _T("Hyd_Rear_Housing"));

    // [2] 유압 매니폴드 블록 (측면 돌출부)
    double blockW = bodyDia * 0.6;
    double blockL = bodyDia * 0.6;
    double blockH = 30.0 / m_unit;
    double embedDepth = 2.0 / m_unit;

    // 모터의 위쪽(Y축)에 블록 부착
    CiWorkPlane xzPlanePort = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ, (bodyDia / 2.0) - embedDepth);
    pPart->SketchManager.StartSketch(xzPlanePort);
    pPart->SketchManager.SetPointXRevert(); // XZ 보정

    // 블록 중심: 모터 중앙보다 약간 뒤쪽
    double blockCenterX = -(bodyLen / 2.0);
    pPart->SketchManager.CreateSketchRect(blockL, blockW, CiPoint(blockCenterX, 0.0, 0.0), true);
    pPart->SetSolidProfile();

    CiFeature portFeat = pPart->FeatureManager.CreateExtrude(blockH + embedDepth, CiDirectionOpEnum::Positive, CiJoinOpEnum::NewBody, 0, _T("Hyd_Port_Manifold"));
    ApplyBodyMaterial(pPart, portFeat, _T("Steel - Cast"), _T("강철 - 주조"));

    CreateMountingHoles(pPart);
    CreateShaftCover(pPart);

    return S_OK;
}

//=============================================================================
// 10. 인버터 (Inverter / VFD) 바디 생성
// - 특징: 전면 플라스틱 하우징 + 후면 알루미늄 방열판(Heat Sink) + 전면 조작 패널
// - 방향성: 설치 기준면(X=0)에서 앞으로(+X) 튀어나오는 박스 형태
//=============================================================================
HRESULT MotorCreator::CreateInverterBody(CiPart* pPart)
{
    // 제어기 류는 LC(폭), LH(높이), LM(깊이)를 박스 치수로 사용
    double width = m_partData->Dim.LC;
    double height = m_partData->Dim.LH > 0.0 ? m_partData->Dim.LH : width * 1.5;
    double depth = m_partData->Dim.LM;

    if (width <= 0.0 || height <= 0.0 || depth <= 0.0) return E_INVALIDARG;

    double heatSinkDepth = depth * 0.3; // 전체 깊이의 30%를 후면 방열판으로 할당
    double housingDepth = depth - heatSinkDepth; // 70%는 메인 하우징

    // [1] 후면 방열판 (Heat Sink) - 벽면(X=0)에서 앞으로(+X) 돌출
    CiWorkPlane yzPlaneBase = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, 0.0);
    pPart->SketchManager.StartSketch(yzPlaneBase);
    pPart->SketchManager.SetPointXYReplace(); // YZ 보정
    pPart->SketchManager.CreateSketchRect(height, width, CiPoint(0.0, 0.0, 0.0), true);
    pPart->SetSolidProfile();

    CiFeature heatSinkFeat = pPart->FeatureManager.CreateExtrude(heatSinkDepth, CiDirectionOpEnum::Positive, CiJoinOpEnum::NewBody, 0, _T("Inverter_HeatSink"));
    ApplyBodyMaterial(pPart, heatSinkFeat, _T("Aluminum - Cast"), _T("알루미늄 - 주조"));

    // [2] 전면 메인 하우징 (Plastic Housing)
    CiWorkPlane yzPlaneHousing = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, heatSinkDepth);
    pPart->SketchManager.StartSketch(yzPlaneHousing);
    pPart->SketchManager.SetPointXYReplace();
    // 방열판과 구분되도록 폭을 미세하게(1mm) 줄여서 모델링
    pPart->SketchManager.CreateSketchRect(height, width - (2.0 / m_unit), CiPoint(0.0, 0.0, 0.0), true);
    pPart->SetSolidProfile();

    CiFeature housingFeat = pPart->FeatureManager.CreateExtrude(housingDepth, CiDirectionOpEnum::Positive, CiJoinOpEnum::NewBody, 0, _T("Inverter_Housing"));
    ApplyBodyMaterial(pPart, housingFeat, _T("Plastic - Black"), _T("플라스틱 - 검정"));

    // [3] 전면 조작 패널 (Display & Keypad)
    double panelW = width * 0.6;
    double panelH = height * 0.3;
    double panelDepth = 3.0 / m_unit;
    double panelOffsetY = height * 0.25; // 중앙보다 살짝 위쪽 배치

    CiWorkPlane yzPlanePanel = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, depth);
    pPart->SketchManager.StartSketch(yzPlanePanel);
    pPart->SketchManager.SetPointXYReplace();
    pPart->SketchManager.CreateSketchRect(panelH, panelW, CiPoint(0.0, panelOffsetY, 0.0), true);
    pPart->SetSolidProfile();

    CiFeature panelFeat = pPart->FeatureManager.CreateExtrude(panelDepth, CiDirectionOpEnum::Positive, CiJoinOpEnum::NewBody, 0, _T("Inverter_Keypad"));
    ApplyBodyMaterial(pPart, panelFeat, _T("Smooth - Black"), _T("매끄러움 - 검은색"));

    return S_OK;
}

//=============================================================================
// 11. 서보 드라이브 (Servo Drive) 바디 생성
// - 특징: 좁고 깊은 북 타입(Book Style) 하우징 + 전면 커넥터 블록
//=============================================================================
HRESULT MotorCreator::CreateServoDriveBody(CiPart* pPart)
{
    double width = m_partData->Dim.LC; // 좁은 폭
    double height = m_partData->Dim.LH > 0.0 ? m_partData->Dim.LH : width * 3.0;
    double depth = m_partData->Dim.LM;

    if (width <= 0.0 || height <= 0.0 || depth <= 0.0) return E_INVALIDARG;

    // [1] 메인 드라이브 하우징 (통풍을 위한 플라스틱/금속 혼합 느낌)
    CiWorkPlane yzPlaneBase = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, 0.0);
    pPart->SketchManager.StartSketch(yzPlaneBase);
    pPart->SketchManager.SetPointXYReplace();
    pPart->SketchManager.CreateSketchRect(height, width, CiPoint(0.0, 0.0, 0.0), true);
    pPart->SetSolidProfile();

    CiFeature driveFeat = pPart->FeatureManager.CreateExtrude(depth, CiDirectionOpEnum::Positive, CiJoinOpEnum::NewBody, 0, _T("Servo_Drive_Housing"));
    ApplyBodyMaterial(pPart, driveFeat, _T("Plastic - Black"), _T("플라스틱 - 검정"));

    // [2] 전면 단자대 및 I/O 커넥터 영역 (여러 개의 단차 블록 생성)
    // 상단: 제어 전원 및 통신 / 하단: 주전원 및 모터 U,V,W
    double connDepth = 5.0 / m_unit;
    CiWorkPlane yzPlaneConn = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, depth);

    // 2-1. 상단 통신 커넥터
    pPart->SketchManager.StartSketch(yzPlaneConn);
    pPart->SketchManager.SetPointXYReplace();
    pPart->SketchManager.CreateSketchRect(height * 0.2, width * 0.8, CiPoint(0.0, height * 0.35, 0.0), true);
    pPart->SetSolidProfile();
    CiFeature topConnFeat = pPart->FeatureManager.CreateExtrude(connDepth, CiDirectionOpEnum::Positive, CiJoinOpEnum::NewBody, 0, _T("Servo_Comm_Port"));
    ApplyBodyMaterial(pPart, topConnFeat, _T("Steel - Galvanized"), _T("강철 - 아연도금")); // 차폐 쉴드 느낌

    // 2-2. 하단 파워 커넥터
    pPart->SketchManager.StartSketch(yzPlaneConn);
    pPart->SketchManager.SetPointXYReplace();
    pPart->SketchManager.CreateSketchRect(height * 0.3, width * 0.8, CiPoint(0.0, -height * 0.3, 0.0), true);
    pPart->SetSolidProfile();
    CiFeature botConnFeat = pPart->FeatureManager.CreateExtrude(connDepth, CiDirectionOpEnum::Positive, CiJoinOpEnum::NewBody, 0, _T("Servo_Power_Port"));
    ApplyBodyMaterial(pPart, botConnFeat, _T("ABS Plastic"), _T("ABS 플라스틱"));

    return S_OK;
}

//=============================================================================
// 12. 로터리 엔코더 (Standalone Rotary Encoder) 바디 생성
// - 특징: 초소형 정밀 샤프트(+X 방향) + 소형 원통 하우징(-X 방향) + 측면 케이블 인출
//=============================================================================
HRESULT MotorCreator::CreateRotaryEncoderBody(CiPart* pPart)
{
    double encDia = m_partData->Dim.LB > 0.0 ? m_partData->Dim.LB : m_partData->Dim.LC; // 외경
    double encLen = m_partData->Dim.LM; // 바디 길이
    double shaftDia = m_partData->Dim.S; // 샤프트 직경
    double shaftLen = m_partData->Dim.LR; // 샤프트 돌출 길이

    if (encDia <= 0.0 || encLen <= 0.0) return E_INVALIDARG;

    // [1] 전면 취부 플랜지 (Aluminum)
    double flangeThick = 5.0 / m_unit;
    CiWorkPlane yzPlaneFront = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, 0.0);
    pPart->SketchManager.StartSketch(yzPlaneFront);
    pPart->SketchManager.CreateSketchCircle(encDia / 2.0, 0.0, 0.0);
    pPart->SetSolidProfile();

    CiFeature flangeFeat = pPart->FeatureManager.CreateExtrude(flangeThick, CiDirectionOpEnum::Negative, CiJoinOpEnum::NewBody, 0, _T("Encoder_Flange"));
    ApplyBodyMaterial(pPart, flangeFeat, _T("Aluminum - Polished"), _T("알루미늄 - 연마"));

    // [2] 엔코더 메인 바디 (Steel or Black Plastic)
    CiWorkPlane yzPlaneBody = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, -flangeThick);
    pPart->SketchManager.StartSketch(yzPlaneBody);
    pPart->SketchManager.CreateSketchCircle((encDia * 0.95) / 2.0, 0.0, 0.0); // 약간 작게 단차
    pPart->SetSolidProfile();

    CiFeature bodyFeat = pPart->FeatureManager.CreateExtrude(encLen - flangeThick, CiDirectionOpEnum::Negative, CiJoinOpEnum::NewBody, 0, _T("Encoder_Body"));
    ApplyBodyMaterial(pPart, bodyFeat, _T("Anodized - Black"), _T("피막 처리 - 검은색"));

    // [3] 입력 축 (Shaft) - +X 방향 돌출
    if (shaftDia > 0.0 && shaftLen > 0.0) {
        pPart->SketchManager.StartSketch(yzPlaneFront);
        pPart->SketchManager.CreateSketchCircle(shaftDia / 2.0, 0.0, 0.0);
        pPart->SetSolidProfile();
        CiFeature shaftFeat = pPart->FeatureManager.CreateExtrude(shaftLen, CiDirectionOpEnum::Positive, CiJoinOpEnum::NewBody, 0, _T("Encoder_Shaft"));
        ApplyBodyMaterial(pPart, shaftFeat, _T("Steel - Polished"), _T("강철 - 연마"));
    }

    // [4] 측면 케이블 인출구 (Cable Gland)
    double glandDia = 6.0 / m_unit;
    double glandLen = 8.0 / m_unit;
    double embedDepth = 2.0 / m_unit;

    CiWorkPlane xzPlaneGland = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ, (encDia / 2.0) - embedDepth);
    pPart->SketchManager.StartSketch(xzPlaneGland);
    pPart->SketchManager.SetPointXRevert();

    // 바디 중앙 부근에서 측면으로 인출
    pPart->SketchManager.CreateSketchCircle(glandDia / 2.0, -(encLen / 2.0), 0.0);
    pPart->SetSolidProfile();

    CiFeature glandFeat = pPart->FeatureManager.CreateExtrude(glandLen + embedDepth, CiDirectionOpEnum::Positive, CiJoinOpEnum::NewBody, 0, _T("Cable_Gland"));
    ApplyBodyMaterial(pPart, glandFeat, _T("Rubber - Black"), _T("고무 - 검정"));

    return S_OK;
}

//=============================================================================
// 13. 정밀 감속기 (Precision Reducer) 바디 생성
// - 특징: 얇은 원통형 메인 하우징 + 출력 플랜지(+X) + 입력 플랜지(-X)
// - 재질: 강철 - 연마 (정밀 가공된 금속 표면)
//=============================================================================
HRESULT MotorCreator::CreatePrecisionReducerBody(CiPart* pPart)
{
    double outDia = m_partData->Dim.LB > 0.0 ? m_partData->Dim.LB : m_partData->Dim.LC; // 감속기 외경
    double totalLen = m_partData->Dim.LM; // 전체 길이

    if (outDia <= 0.0 || totalLen <= 0.0) return E_INVALIDARG;

    double outFlangeLen = totalLen * 0.2; // 출력부 두께 (20%)
    double inFlangeLen = totalLen * 0.25; // 입력부(모터 조립부) 두께 (25%)
    double mainLen = totalLen - (outFlangeLen + inFlangeLen); // 메인 하우징

    // [1] 메인 하우징 (-X 방향)
    CiWorkPlane yzPlaneBase = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, 0.0);
    pPart->SketchManager.StartSketch(yzPlaneBase);
    pPart->SketchManager.CreateSketchCircle(outDia / 2.0, 0.0, 0.0);
    pPart->SetSolidProfile();

    CiFeature mainFeat = pPart->FeatureManager.CreateExtrude(mainLen, CiDirectionOpEnum::Negative, CiJoinOpEnum::NewBody, 0, _T("Precision_Main_Housing"));
    ApplyBodyMaterial(pPart, mainFeat, _T("Steel - Polished"), _T("강철 - 연마"));

    // [2] 출력 플랜지 (+X 방향 돌출)
    double outFlangeDia = outDia * 0.85; // 메인 바디보다 살짝 작음
    pPart->SketchManager.StartSketch(yzPlaneBase);
    pPart->SketchManager.CreateSketchCircle(outFlangeDia / 2.0, 0.0, 0.0);
    pPart->SetSolidProfile();

    CiFeature outFlangeFeat = pPart->FeatureManager.CreateExtrude(outFlangeLen, CiDirectionOpEnum::Positive, CiJoinOpEnum::NewBody, 0, _T("Precision_Output_Flange"));
    ApplyBodyMaterial(pPart, outFlangeFeat, _T("Steel - Galvanized"), _T("강철 - 아연도금"));

    // (출력부 중앙 탭 또는 중공홀 가공)
    double centerHoleDia = m_partData->Dim.S > 0 ? m_partData->Dim.S : (15.0 / m_unit);
    pPart->SketchManager.StartSketch(yzPlaneBase);
    pPart->SketchManager.CreateSketchCircle(centerHoleDia / 2.0, 0.0, 0.0);
    pPart->SetSolidProfile();
    pPart->FeatureManager.CreateExtrude(10.0 / m_unit, CiDirectionOpEnum::Positive, CiJoinOpEnum::Cut, 0, _T("Cut_CenterHole"));

    // [3] 모터 입력 플랜지 (-X 방향)
    double inFlangeDia = outDia * 0.9;
    CiWorkPlane yzPlaneIn = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, -mainLen);
    pPart->SketchManager.StartSketch(yzPlaneIn);
    pPart->SketchManager.CreateSketchCircle(inFlangeDia / 2.0, 0.0, 0.0);
    pPart->SetSolidProfile();

    CiFeature inFlangeFeat = pPart->FeatureManager.CreateExtrude(inFlangeLen, CiDirectionOpEnum::Negative, CiJoinOpEnum::NewBody, 0, _T("Precision_Input_Flange"));
    ApplyBodyMaterial(pPart, inFlangeFeat, _T("Steel - Polished"), _T("강철 - 연마"));

    CreateMountingHoles(pPart);

    return S_OK;
}

//=============================================================================
// 14. 산업용 웜 감속기 (Industrial Worm Gear Reducer) 바디 생성
// - 특징: 무거운 주철 박스형 하우징 + 측면(Z축 방향) 직교축 출력 보스
// - 재질: 강철 - 주조 (거친 쇳덩이 질감)
//=============================================================================
HRESULT MotorCreator::CreateIndustrialReducerBody(CiPart* pPart)
{
    // 감속기의 기본 박스 크기
    double boxW = m_partData->Dim.LC > 0.0 ? m_partData->Dim.LC : (80.0 / m_unit);
    double boxH = m_partData->Dim.LH > 0.0 ? m_partData->Dim.LH : boxW * 1.2;
    double boxL = m_partData->Dim.LM > 0.0 ? m_partData->Dim.LM : boxW * 1.2;

    // [1] 모터 조립용 입력 플랜지 (-X 방향)
    double inFlangeLen = 15.0 / m_unit;
    CiWorkPlane yzPlaneFront = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, 0.0);
    pPart->SketchManager.StartSketch(yzPlaneFront);
    pPart->SketchManager.CreateSketchCircle(boxW / 2.0, 0.0, 0.0);
    pPart->SetSolidProfile();
    CiFeature inFlangeFeat = pPart->FeatureManager.CreateExtrude(inFlangeLen, CiDirectionOpEnum::Negative, CiJoinOpEnum::NewBody, 0, _T("Worm_Input_Flange"));
    ApplyBodyMaterial(pPart, inFlangeFeat, _T("Steel - Cast"), _T("강철 - 주조"));

    // [2] 감속기 메인 큐빅 하우징 (-X 방향으로 더 깊게)
    double cornerR = 5.0 / m_unit;
    CiWorkPlane yzPlaneBox = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, -inFlangeLen);
    pPart->SketchManager.StartSketch(yzPlaneBox);
    // (H, W) 스왑 적용하여 사각형 작도
    pPart->SketchManager.CreateSketchRectRound(boxH, boxW, cornerR);
    pPart->SetSolidProfile();

    CiFeature boxFeat = pPart->FeatureManager.CreateExtrude(boxL, CiDirectionOpEnum::Negative, CiJoinOpEnum::NewBody, 0, _T("Worm_Main_Box"));
    ApplyBodyMaterial(pPart, boxFeat, _T("Steel - Cast"), _T("강철 - 주조"));

    // [3] 웜 휠(출력) 보스부 - 측면 돌출 (Z축 방향)
    double outBossDia = boxW * 0.8;
    double outBossLen = boxW + (20.0 / m_unit); // 양옆으로 돌출되도록 박스보다 크게
    double bossCenterY = -boxH * 0.1; // 살짝 아래쪽 중심
    double bossCenterX = -inFlangeLen - (boxL / 2.0); // 박스 길이의 중앙

    CiWorkPlane xyPlaneSide = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XY, 0.0);
    pPart->SketchManager.StartSketch(xyPlaneSide);
    // XY 평면 스케치: 중심(X, Y)
    pPart->SketchManager.CreateSketchCircle(outBossDia / 2.0, bossCenterX, bossCenterY);
    pPart->SetSolidProfile();

    // Z축 양방향(Symmetry)으로 돌출
    CiFeature bossFeat = pPart->FeatureManager.CreateExtrude(outBossLen, CiDirectionOpEnum::Symmetry, CiJoinOpEnum::NewBody, 0, _T("Worm_Output_Boss"));
    ApplyBodyMaterial(pPart, bossFeat, _T("Steel - Cast"), _T("강철 - 주조"));

    // [4] 출력 중공축(Hollow Shaft) 관통 홀
    double hollowDia = m_partData->Dim.S > 0.0 ? m_partData->Dim.S : (20.0 / m_unit);
    pPart->SketchManager.StartSketch(xyPlaneSide);
    pPart->SketchManager.CreateSketchCircle(hollowDia / 2.0, bossCenterX, bossCenterY);
    pPart->SetSolidProfile();

    pPart->FeatureManager.CreateExtrude(outBossLen + (5.0 / m_unit), CiDirectionOpEnum::Symmetry, CiJoinOpEnum::Cut, 0, _T("Cut_Worm_Hollow"));

    return S_OK;
}

//=============================================================================
// 모터 내부 로터 및 샤프트 관통 공간 파내기 (브레이크 구간 포함)
//=============================================================================
HRESULT MotorCreator::CreateMotorInternalCavity(CiPart* pPart, double brakeLen)
{
    double shaftDia = m_partData->Dim.S;
    double L1 = (m_partData->Dim.L1_LL > 0) ? m_partData->Dim.L1_LL : m_partData->Dim.LX;

    // 모터 바디 길이 계산
    double motorBodyLen = (m_partData->Dim.L2 > 0.0) ? m_partData->Dim.L2 : m_partData->Dim.LM;
    if (motorBodyLen <= 0.0) motorBodyLen = L1 * 0.8;

    // ★ 브레이크가 있다면 파내는 총 길이를 브레이크 끝까지 연장!
    double totalCavityLen = motorBodyLen + brakeLen;

    if (shaftDia <= 0.0 || L1 <= 0.0) return S_OK;

    // 로터 공간 비율 적용
    double rotorLen = motorBodyLen * 0.5;
    double rotorDia = shaftDia * 2.5;
    double rotorStartPos = motorBodyLen * 0.2;

    double clearance = 1.0 / m_unit;

    CiWorkPlane xyPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XY, 0.0);
    pPart->SketchManager.StartSketch(xyPlane);

    std::vector<CiSketchPoint> cPts;

    // 1. 전면 베어링 하우징 간극
    cPts.push_back(pPart->SketchManager.SetSketchPoint(0.0, (shaftDia / 2.0) + clearance));
    cPts.push_back(pPart->SketchManager.SetSketchPoint(-rotorStartPos + clearance, (shaftDia / 2.0) + clearance));

    // 2. 넓은 스테이터/로터 회전 공간
    cPts.push_back(pPart->SketchManager.SetSketchPoint(-rotorStartPos + clearance, (rotorDia / 2.0) + clearance));
    cPts.push_back(pPart->SketchManager.SetSketchPoint(-(rotorStartPos + rotorLen) - clearance, (rotorDia / 2.0) + clearance));

    // 3. ★ 후면 베어링 간극 및 브레이크 관통 간극 (totalCavityLen까지 연장)
    cPts.push_back(pPart->SketchManager.SetSketchPoint(-(rotorStartPos + rotorLen) - clearance, (shaftDia / 2.0) + clearance));
    cPts.push_back(pPart->SketchManager.SetSketchPoint(-totalCavityLen, (shaftDia / 2.0) + clearance));

    // 4. 중심축 점 (X축상에 위치)
    cPts.push_back(pPart->SketchManager.SetSketchPoint(-totalCavityLen, 0.0));
    cPts.push_back(pPart->SketchManager.SetSketchPoint(0.0, 0.0));

    // 중심축 라인을 제외한 나머지 외곽선 루프로 연결
    for (size_t i = 0; i < cPts.size() - 2; ++i) {
        pPart->SketchManager.CreateSketchLine(cPts[i], cPts[i + 1]);
    }

    // X축 라인 생성 및 동시에 axisLine 초기화 
    CiSketchLine axisLine = pPart->SketchManager.CreateSketchLine(cPts[cPts.size() - 2], cPts.back());

    // 프로파일 닫기
    pPart->SketchManager.CreateSketchLine(cPts.back(), cPts.front());

    pPart->SetSolidProfile();

    // 회전 컷(Revolve Cut) 피처 생성
    CiFeature cavityFeat = pPart->FeatureManager.CreateRevolve(
        axisLine, CiJoinOpEnum::Cut, 360.0, CiDirectionOpEnum::Positive, _T("Cut_Internal_Cavity"));

    // =========================================================================
    // 멀티바디(브레이크 포함) 전체 뚫기를 위한 AffectedBodies 
    // =========================================================================
    acInv::RevolveFeaturePtr pRevFeat = cavityFeat.Get();
    if (pRevFeat != nullptr)
    {
        acInv::PartDocumentPtr pDoc = pPart->GetPartDoc();
        acInv::ApplicationPtr pApp = pDoc->Parent;
        acInv::TransientObjectsPtr pTransObjs = pApp->TransientObjects;

        VARIANT vtMissing;
        ::VariantInit(&vtMissing);
        vtMissing.vt = VT_ERROR;
        vtMissing.scode = DISP_E_PARAMNOTFOUND;

        acInv::ObjectCollection* pRawCollection = nullptr;
        HRESULT hr = pTransObjs->CreateObjectCollection(vtMissing, &pRawCollection);

        if (SUCCEEDED(hr) && pRawCollection != nullptr)
        {
            acInv::ObjectCollectionPtr pAffectedBodies;
            pAffectedBodies.Attach(pRawCollection);

            acInv::ComponentDefinitionPtr pCompDef = pDoc->ComponentDefinition;
            acInv::PartComponentDefinitionPtr pPartDef = pCompDef;
            acInv::SurfaceBodiesPtr pBodies = pPartDef->SurfaceBodies;

            long bodyCount = pBodies->Count;
            for (long i = 1; i <= bodyCount; ++i)
            {
                acInv::SurfaceBodyPtr pBody = pBodies->Item[i];
                ATL::CString bodyName = (LPCTSTR)pBody->Name;

                // 엔코더와 샤프트를 제외한 나머지 본체(프론트, 스테이터, 브레이크 등)는 모두 포함!
                if (bodyName.Find(_T("Encoder")) == -1 && bodyName.Find(_T("Shaft")) == -1)
                {
                    pAffectedBodies->MethodAdd(pBody);
                }
            }
            pRevFeat->SetAffectedBodies(pAffectedBodies);
        }
    }

    return S_OK;
}

//=============================================================================
// 모터 파워 커넥터 단자대 (Square Right-Angle Type)
// - 특징: 커넥터 삽입구가 앞쪽(+X 방향)을 향하도록 설정
// - 핀: 내부 폭(cav_mw)에 비례한 동적 크기 적용, Z축(2D X축) 방향 1열 배치
//=============================================================================
HRESULT MotorCreator::CreateMotorTerminal(CiPart* pPart, double frameW, double frameH, double L2)
{
    double embedDepth = 2.0 / m_unit;
    double mw = m_partData->Dim.CW_MW, ml = m_partData->Dim.CL_ML, mh = m_partData->Dim.CH_MH;

    if (mw <= 0) mw = frameW * 0.3;
    if (ml <= 0) ml = frameW * 0.3;
    if (mh <= 0) mh = frameH * 0.15;
    if (mw <= 0 || mh <= 0 || ml <= 0) return S_OK;

    // 단자대 중심 및 전/후면 좌표 계산
    double motorTerminalCenterX = -L2 + (ml / 2.0);
    double termCenterY = (frameH / 2.0) - embedDepth + (mh / 2.0);
    double backFaceX = motorTerminalCenterX - (ml / 2.0);
    double frontFaceX = backFaceX + ml; // 회원님 로직: 커넥터 앞면(개구부) 위치

    // -------------------------------------------------------------------------
    // [1] 단자대 외부 하우징 Base (backFaceX에서 +X 방향으로 돌출)
    // -------------------------------------------------------------------------
    CiWorkPlane basePlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, backFaceX);
    pPart->SketchManager.StartSketch(basePlane);
    pPart->SketchManager.SetPointXYReplace(); // 좌표계 보정 (X=폭, Y=높이)

    double baseR = mh * 0.15;
    double baseXmin = -(mw / 2.0);
    double baseXmax = (mw / 2.0);
    double baseYmin = termCenterY - (mh / 2.0);
    double baseYmax = termCenterY + (mh / 2.0);

    CiSketchPoint ptB1 = pPart->SketchManager.SetSketchPoint(baseXmin, baseYmin);
    CiSketchPoint ptB2 = pPart->SketchManager.SetSketchPoint(baseXmax, baseYmin);
    CiSketchPoint ptB3 = pPart->SketchManager.SetSketchPoint(baseXmax, baseYmax - baseR);
    CiSketchPoint ptB4 = pPart->SketchManager.SetSketchPoint(baseXmax - baseR, baseYmax);
    CiSketchPoint ptB5 = pPart->SketchManager.SetSketchPoint(baseXmin + baseR, baseYmax);
    CiSketchPoint ptB6 = pPart->SketchManager.SetSketchPoint(baseXmin, baseYmax - baseR);

    CiSketchPoint cB1 = pPart->SketchManager.SetSketchPoint(baseXmax - baseR, baseYmax - baseR);
    CiSketchPoint cB2 = pPart->SketchManager.SetSketchPoint(baseXmin + baseR, baseYmax - baseR);

    pPart->SketchManager.CreateSketchLine(ptB1, ptB2);
    pPart->SketchManager.CreateSketchLine(ptB2, ptB3);
    pPart->SketchManager.CreateSketchArc(cB1, ptB3, ptB4, false);
    pPart->SketchManager.CreateSketchLine(ptB4, ptB5);
    pPart->SketchManager.CreateSketchArc(cB2, ptB5, ptB6, false);
    pPart->SketchManager.CreateSketchLine(ptB6, ptB1);

    pPart->SetSolidProfile();
    CiFeature mTermFeat = pPart->FeatureManager.CreateExtrude(ml, CiDirectionOpEnum::Positive, CiJoinOpEnum::NewBody, 0, _T("Motor_Terminal_Base"));
    ApplyBodyMaterial(pPart, mTermFeat, _T("Smooth - Black"), _T("매끄러움 - 검은색"));


    // -------------------------------------------------------------------------
    // [2] 커넥터 내부 빈 공간 파내기 Cavity Cut (★ 회원님 로직 반영)
    // - 시작 평면: 앞면(frontFaceX)
    // - 돌출 방향: Negative (-X 방향으로 파고 들어감)
    // -------------------------------------------------------------------------
    double cav_mh = mh * 0.75;
    double cav_mw = mw * 0.75;
    double cav_R = cav_mh * 0.15;
    double cavityDepth = ml * 0.6;

    CiWorkPlane yzPlaneCavity = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, frontFaceX);
    pPart->SketchManager.StartSketch(yzPlaneCavity);
    pPart->SketchManager.SetPointXYReplace();

    double cavXmin = -(cav_mw / 2.0);
    double cavXmax = (cav_mw / 2.0);
    double cavYmin = termCenterY - (cav_mh / 2.0);
    double cavYmax = termCenterY + (cav_mh / 2.0);

    CiSketchPoint ptC1 = pPart->SketchManager.SetSketchPoint(cavXmin, cavYmin);
    CiSketchPoint ptC2 = pPart->SketchManager.SetSketchPoint(cavXmax, cavYmin);
    CiSketchPoint ptC3 = pPart->SketchManager.SetSketchPoint(cavXmax, cavYmax - cav_R);
    CiSketchPoint ptC4 = pPart->SketchManager.SetSketchPoint(cavXmax - cav_R, cavYmax);
    CiSketchPoint ptC5 = pPart->SketchManager.SetSketchPoint(cavXmin + cav_R, cavYmax);
    CiSketchPoint ptC6 = pPart->SketchManager.SetSketchPoint(cavXmin, cavYmax - cav_R);

    CiSketchPoint cC1 = pPart->SketchManager.SetSketchPoint(cavXmax - cav_R, cavYmax - cav_R);
    CiSketchPoint cC2 = pPart->SketchManager.SetSketchPoint(cavXmin + cav_R, cavYmax - cav_R);

    pPart->SketchManager.CreateSketchLine(ptC1, ptC2);
    pPart->SketchManager.CreateSketchLine(ptC2, ptC3);
    pPart->SketchManager.CreateSketchArc(cC1, ptC3, ptC4, false);
    pPart->SketchManager.CreateSketchLine(ptC4, ptC5);
    pPart->SketchManager.CreateSketchArc(cC2, ptC5, ptC6, false);
    pPart->SketchManager.CreateSketchLine(ptC6, ptC1);

    pPart->SetSolidProfile();
    // ★ 돌출 방향 Negative로 변경
    CiFeature cavityFeat = pPart->FeatureManager.CreateExtrude(cavityDepth, CiDirectionOpEnum::Negative, CiJoinOpEnum::Cut, 0, _T("Cut_Motor_Terminal_Cavity"));

    ApplyAffectedBodyToFeature(pPart, cavityFeat, mTermFeat);


    // -------------------------------------------------------------------------
    // [3] 내부 연결 핀(Pins) 1열 생성 (★ 회원님 로직 반영)
    // - 시작 평면: 파낸 공간의 제일 안쪽 면 (frontFaceX - cavityDepth)
    // - 돌출 방향: Positive (+X 방향으로 뻗어나옴)
    // -------------------------------------------------------------------------

    // ★ 핀 직경을 단자대 내부 폭(cav_mw)에 비례하여 동적 계산 (폭의 약 1/8 크기)
    double pinDia = cav_mw / 8.0;
    double pinHeight = cavityDepth * 0.8;

    CiWorkPlane yzPlanePins = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, frontFaceX - cavityDepth);
    pPart->SketchManager.StartSketch(yzPlanePins);
    pPart->SketchManager.SetPointXYReplace();

    // Z축(스케치 X축)을 따라 4개의 핀을 1열로 균등 배치하기 위한 간격 계산
    double spacing = cav_mw / 5.0;

    // 높이(Y축)는 중앙(termCenterY)으로 고정하고, 폭(X축) 위치만 이동시키며 1열 배치
    pPart->SketchManager.CreateSketchCircle(pinDia / 2.0, -1.5 * spacing, termCenterY); // 1번 핀
    pPart->SketchManager.CreateSketchCircle(pinDia / 2.0, -0.5 * spacing, termCenterY); // 2번 핀
    pPart->SketchManager.CreateSketchCircle(pinDia / 2.0, 0.5 * spacing, termCenterY); // 3번 핀
    pPart->SketchManager.CreateSketchCircle(pinDia / 2.0, 1.5 * spacing, termCenterY); // 4번 핀
    pPart->SetSolidProfile();

    // ★ 돌출 방향 Positive로 변경
    CiFeature pinsFeat = pPart->FeatureManager.CreateExtrude(pinHeight, CiDirectionOpEnum::Positive, CiJoinOpEnum::NewBody, 0, _T("Motor_Terminal_Pins"));
    ApplyBodyMaterial(pPart, pinsFeat, _T("Brass - Polished"), _T("황동 - 연마"));

    return S_OK;
}

//=============================================================================
// 엔코더 커넥터 단자대 (사각/원형 캡 대응)
// [추가 인자] isSquareEnc: 엔코더 캡이 사각형인지 여부
//=============================================================================
//=============================================================================
// 엔코더 커넥터 단자대 (Circular Revolved Taper Type)
// - 특징: 함수 내부에서 m_partData를 참조하여 사각/원형 캡 여부를 자동 판별
//=============================================================================
HRESULT MotorCreator::CreateEncoderTerminal(CiPart* pPart, double frameW, double frameH, double L3, double es_md, double encTopSurface)
{
    double ed = m_partData->Dim.Ed;
    double eh = m_partData->Dim.Eh;

    if (eh <= 0.0) eh = frameH * 0.12;
    if (ed <= 0.0) ed = frameW * 0.2;
    if (eh <= 0.0 || ed <= 0.0) return S_OK;

    // -------------------------------------------------------------------------
    // ★ 인자 없이 내부 데이터(m_partData)로 사각 캡 여부 자동 판별
    // -------------------------------------------------------------------------
    double enW = m_partData->Dim.EnW;
    enW = frameW;
    bool isSquareEnc = (enW > 0.0);

    // 사각형 캡이면 표면에서 바로 시작(0.0), 원형이면 곡면을 파고듦(2.0)
    double actualEmbed = isSquareEnc ? 0.0 : (2.0 / m_unit);
    double base_Y = encTopSurface - actualEmbed;
    double total_H = eh + actualEmbed;

    // -------------------------------------------------------------------------
    // [1] 엔코더 단자대 본체 (XY 평면 Revolve, 사선 단차 적용)
    // -------------------------------------------------------------------------
    CiWorkPlane xyPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XY, es_md);
    pPart->SketchManager.StartSketch(xyPlane);

    double ed2 = ed * 0.7; // 상단 헤드 지름
    double h1 = total_H * 0.4, h2 = total_H * 0.2, h3 = total_H * 0.4;

    std::vector<CiSketchPoint> ePts;
    ePts.push_back(pPart->SketchManager.SetSketchPoint(-L3 + (ed / 2.0), base_Y));
    ePts.push_back(pPart->SketchManager.SetSketchPoint(-L3 + (ed / 2.0), base_Y + h1));
    ePts.push_back(pPart->SketchManager.SetSketchPoint(-L3 + (ed2 / 2.0), base_Y + h1 + h2));
    ePts.push_back(pPart->SketchManager.SetSketchPoint(-L3 + (ed2 / 2.0), base_Y + total_H));
    ePts.push_back(pPart->SketchManager.SetSketchPoint(-L3, base_Y + total_H));
    ePts.push_back(pPart->SketchManager.SetSketchPoint(-L3, base_Y));

    for (size_t i = 0; i < ePts.size() - 2; ++i) {
        pPart->SketchManager.CreateSketchLine(ePts[i], ePts[i + 1]);
    }
    CiSketchLine axisLine = pPart->SketchManager.CreateSketchLine(ePts[ePts.size() - 2], ePts.back());
    pPart->SketchManager.CreateSketchLine(ePts.back(), ePts.front());

    pPart->SetSolidProfile();
    CiFeature eTermBaseFeat = pPart->FeatureManager.CreateRevolve(axisLine, CiJoinOpEnum::NewBody, 360.0, CiDirectionOpEnum::Positive, _T("Encoder_Terminal_Body"));
    ApplyBodyMaterial(pPart, eTermBaseFeat, _T("Smooth - Black"), _T("매끄러움 - 검은색"));

    // -------------------------------------------------------------------------
    // [2] 커넥터 내부 빈 공간 파내기 Cavity Cut
    // -------------------------------------------------------------------------
    double cav_dia = ed2 * 0.8;
    double cavityDepth = eh * 0.7;

    CiWorkPlane xzPlaneCavity = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ, encTopSurface + eh);
    pPart->SketchManager.StartSketch(xzPlaneCavity);
    pPart->SketchManager.SetPointXRevert(); // 규칙 반영
    pPart->SketchManager.CreateSketchCircle(cav_dia / 2.0, -L3, es_md);
    pPart->SetSolidProfile();

    CiFeature cavityFeat = pPart->FeatureManager.CreateExtrude(cavityDepth, CiDirectionOpEnum::Negative, CiJoinOpEnum::Cut, 0, _T("Cut_Encoder_Terminal_Cavity"));
    ApplyAffectedBodyToFeature(pPart, cavityFeat, eTermBaseFeat);

    // -------------------------------------------------------------------------
    // [3] 내부 연결 핀(Pins) 4개 사각 배열
    // -------------------------------------------------------------------------
    double pinDia = cav_dia / 8.0, pinHeight = cavityDepth * 0.8, pinOffset = cav_dia * 0.2;

    CiWorkPlane xzPlanePins = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ, encTopSurface + eh - cavityDepth);
    pPart->SketchManager.StartSketch(xzPlanePins);
    pPart->SketchManager.SetPointXRevert(); // 규칙 반영

    pPart->SketchManager.CreateSketchCircle(pinDia / 2.0, -L3 - pinOffset, es_md - pinOffset);
    pPart->SketchManager.CreateSketchCircle(pinDia / 2.0, -L3 - pinOffset, es_md + pinOffset);
    pPart->SketchManager.CreateSketchCircle(pinDia / 2.0, -L3 + pinOffset, es_md - pinOffset);
    pPart->SketchManager.CreateSketchCircle(pinDia / 2.0, -L3 + pinOffset, es_md + pinOffset);
    pPart->SetSolidProfile();

    CiFeature pinsFeat = pPart->FeatureManager.CreateExtrude(pinHeight, CiDirectionOpEnum::Positive, CiJoinOpEnum::NewBody, 0, _T("Encoder_Terminal_Pins"));
    ApplyBodyMaterial(pPart, pinsFeat, _T("Brass - Polished"), _T("황동 - 연마"));

    // 1. 사용자 요청: XY 평면, es_md 오프셋 위치를 Base로 설정
    CiWorkPlane eBase = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ, encTopSurface + eh, _T("Encoder_Terminal_Base"));
    pPart->WGManager.AddMateRef(eBase);

    // 2. 터미널의 중심축 (Revolve의 중심이었던 X=-L3 위치의 Y방향 축)
    // 위치: X=-L3, Z=es_md, 방향: Y축
    CiWorkAxis eAxis = pPart->WGManager.CreateWorkAxis(CiBaseDirectionEnum::Y, CiPoint(-L3, 0, es_md), _T("Encoder_Terminal_Axis"));
    pPart->WGManager.AddMateRef(eAxis);

    return S_OK;
}

//=============================================================================
// [독립 파트] 유연한 전선(Cable) 파트 생성 (절대 좌표 기준 +Y 방향 돌출)
//=============================================================================
HRESULT MotorCreator::CreateCablePart(CiPart* pPart, double startX, double startY, double startZ,
    double dia, double length, ATL::CString partName, ATL::CString color)
{
    // 시작 높이(startY)에 XZ 평면 생성 (Y축 방향으로 돌출하기 위함)
    CiWorkPlane xzPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ, startY);
    pPart->SketchManager.StartSketch(xzPlane);
    pPart->SketchManager.SetPointXRevert(); // XZ 평면 Circle 규칙 적용

    // 절대 좌표 (startX, startZ) 위치에 케이블 단면 스케치
    pPart->SketchManager.CreateSketchCircle(dia / 2.0, startX, startZ);
    pPart->SetSolidProfile();

    // +Y 방향으로 케이블 길이만큼 돌출
    CiFeature cableFeat = pPart->FeatureManager.CreateExtrude(length, CiDirectionOpEnum::Positive, CiJoinOpEnum::NewBody, 0, partName);

    ApplyBodyMaterial(pPart, cableFeat, color, color); // 예: "Rubber - Black"
    return S_OK;
}

//=============================================================================
// [독립 파트] ┌ ┘ 계단형(Step) 케이블 생성
// - X축 직진 ➔ Y축 하강 ➔ X축 직진 경로
//=============================================================================
HRESULT MotorCreator::CreateStepCablePart(CiPart* pPart, double dia, ATL::CString partName, ATL::CString color)
{
    double u = m_unit;
    double z_exit = 10.0 / u;  // 단자대에서 위로(Z축) 뽑아내는 길이
    double R = 5.0 / u;        // 곡률 반경
    double y_step = 15.0 / u;  // 위로(+Y) 꺾이는 길이
    double x_step = -15.0 / u; // 옆으로(-X) 꺾이는 길이 (최종 ㄱ 모양)

    // 1. 스윕 궤적(Path) 스케치 - YZ 평면에서 시작하여 X방향으로 꺾임
    CiWorkPlane yzPlane = pPart->WGManager.GetBasePlane(CiBasePlaneEnum::YZ);
    pPart->SketchManager.StartSketch(yzPlane);
    pPart->SketchManager.SetPointXYReplace(); // Z, Y 좌표 사용

    CiItemCollection pathItems = CiItemCollection();
    CiSketchPoint p0 = pPart->SketchManager.SetSketchPoint(0, 0);
    CiSketchPoint p1 = pPart->SketchManager.SetSketchPoint(z_exit, 0); // Z축으로 진입
    pathItems.Add(pPart->SketchManager.CreateSketchLine(p0, p1));

    // 첫 번째 꺾임 (Z -> Y) : ┌ 형태의 시작
    CiSketchPoint pCenter1 = pPart->SketchManager.SetSketchPoint(z_exit, R);
    CiSketchPoint p2 = pPart->SketchManager.SetSketchPoint(z_exit + R, R);
    pathItems.Add(pPart->SketchManager.CreateSketchArc(pCenter1, p1, p2, false));

    // Y축 직진 후 X축으로 꺾기 위해 XY 평면 평행 경로 구성
    CiSketchPoint p3 = pPart->SketchManager.SetSketchPoint(z_exit + R, R + y_step);
    pathItems.Add(pPart->SketchManager.CreateSketchLine(p2, p3));
    pPart->SketchManager.FinishSketch();

    // 2. 단면 스케치 - XY 평면 (Z축 시작점에 수직)
    CiWorkPlane xyPlane = pPart->WGManager.GetBasePlane(CiBasePlaneEnum::XY);
    pPart->SketchManager.StartSketch(xyPlane);
    pPart->SketchManager.CreateSketchCircle(dia / 2.0, 0, 0);
    CiProfile profile = pPart->SketchManager.FinishSketch();

    double finalX = 20.0 / u; // 예시 계산값
    double finalY = 15.0 / u;

    // 3. 스윕 생성 (첫 피처이므로 Join)
    pPart->FeatureManager.PrepareSweep();
    pPart->FeatureManager.SetSweepPath(pathItems);
    pPart->FeatureManager.SetSweepProfile(profile);
    pPart->FeatureManager.CreateSweep(CiJoinOpEnum::Join);

    // 4. 메이트 등록
    CiWorkPlane startPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XY, 0, _T("Cable-Start-Plane"));
    pPart->WGManager.AddMateRef(startPlane); // 메이트 요소 등록
    CiWorkAxis startAxis = pPart->WGManager.CreateWorkAxis(CiBaseDirectionEnum::Z, CiPoint(0, 0, 0), _T("Cable-Start-Axis"));
    pPart->WGManager.AddMateRef(startAxis);   // 메이트 요소 등록

    // [End] 플러그와 조립되는 부위 (YZ 평면, X축 방향)
    CiWorkPlane endPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ, finalX, _T("Cable-End-Plane"));
    pPart->WGManager.AddMateRef(endPlane);   // 메이트 요소 등록
    CiWorkAxis endAxis = pPart->WGManager.CreateWorkAxis(CiBaseDirectionEnum::Y, CiPoint(0, 0, finalY), _T("Cable-End-Axis"));
    pPart->WGManager.AddMateRef(endAxis);     // 메이트 요소 등록

    return S_OK;
}

//=============================================================================
// [독립 파트] 끝단 플러그 커넥터(Plug Connector) 파트 생성 
// - 인자 수정: length -> depth (Z축 폭)
//=============================================================================
HRESULT MotorCreator::CreatePlugConnectorPart(CiPart* pPart, double startX, double startY, double startZ,
    double width, double height, double depth, ATL::CString partName, ATL::CString color)
{
    // 케이블이 끝나는 지점(startY)에 XZ 평면 생성
    CiWorkPlane xzPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ, startY);
    pPart->SketchManager.StartSketch(xzPlane);

    // 사각 플러그 스케치 (중심이 startX, startZ에 오도록 설정)
    double xMin = startX - (width / 2.0);
    double xMax = startX + (width / 2.0);
    // ★ 이제 인자로 받은 depth가 정상적으로 적용됩니다!
    double zMin = startZ - (depth / 2.0);
    double zMax = startZ + (depth / 2.0);

    CiSketchPoint pt1 = pPart->SketchManager.SetSketchPoint(xMin, zMin);
    CiSketchPoint pt2 = pPart->SketchManager.SetSketchPoint(xMax, zMin);
    CiSketchPoint pt3 = pPart->SketchManager.SetSketchPoint(xMax, zMax);
    CiSketchPoint pt4 = pPart->SketchManager.SetSketchPoint(xMin, zMax);

    pPart->SketchManager.CreateSketchLine(pt1, pt2);
    pPart->SketchManager.CreateSketchLine(pt2, pt3);
    pPart->SketchManager.CreateSketchLine(pt3, pt4);
    pPart->SketchManager.CreateSketchLine(pt4, pt1);

    pPart->SetSolidProfile();

    // +Y 방향으로 플러그 높이(height)만큼 돌출
    CiFeature plugFeat = pPart->FeatureManager.CreateExtrude(height, CiDirectionOpEnum::Positive, CiJoinOpEnum::NewBody, 0, partName);

    // 플라스틱 재질 적용
    ApplyBodyMaterial(pPart, plugFeat, color, color);
    return S_OK;
}

//=============================================================================
// [독립 파트] 하이디테일 끝단 플러그 커넥터 (M17/M23 Circular Type)
// - 특징: 케이블 부트(Taper), 바디, 커플링 너트(Groove/Chamfer) 등 실제 형상 구현
//=============================================================================
HRESULT MotorCreator::CreateCircularPlugPart(CiPart* pPart, double startX, double startY, double startZ,
    double maxDia, double length, double cableDia,
    ATL::CString partName, ATL::CString color)
{
    // Z축으로 startZ만큼 띄운 XY 평면에 스케치 (Y축을 중심으로 회전시키기 위함)
    CiWorkPlane xyPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XY, startZ);
    pPart->SketchManager.StartSketch(xyPlane);

    // [각 구간 길이 및 반경 세팅]
    double r_cable = cableDia / 2.0;       // 케이블 반경
    double r_nut = maxDia / 2.0;           // 너트 반경 (가장 두꺼운 곳)
    double r_body = r_nut * 0.75;          // 메인 바디 반경

    double l_boot = length * 0.25;         // 고무 부트 길이 (케이블 보호 꺾임 방지)
    double l_body = length * 0.40;         // 바디 길이
    double l_nut = length * 0.35;         // 커플링 너트 길이

    std::vector<CiSketchPoint> pts;

    // 1. 하단 중심축 (케이블과 만나는 곳)
    pts.push_back(pPart->SketchManager.SetSketchPoint(startX, startY));
    // 2. 부트 시작 (케이블 두께와 일치)
    pts.push_back(pPart->SketchManager.SetSketchPoint(startX + r_cable, startY));

    // 3. 부트 끝 & 바디 시작 (자연스러운 사선 Taper)
    pts.push_back(pPart->SketchManager.SetSketchPoint(startX + r_body, startY + l_boot));
    // 4. 바디 직진 구간
    pts.push_back(pPart->SketchManager.SetSketchPoint(startX + r_body, startY + l_boot + l_body));

    // 5. 커플링 너트 하단 턱 (급격히 넓어짐)
    pts.push_back(pPart->SketchManager.SetSketchPoint(startX + r_nut, startY + l_boot + l_body));

    // 6. 너트 중앙 홈(Groove) 디테일 - 손으로 돌리는 널링(Knurling) 느낌을 주기 위한 단차
    pts.push_back(pPart->SketchManager.SetSketchPoint(startX + r_nut, startY + l_boot + l_body + (l_nut * 0.3)));
    pts.push_back(pPart->SketchManager.SetSketchPoint(startX + (r_nut * 0.85), startY + l_boot + l_body + (l_nut * 0.4)));
    pts.push_back(pPart->SketchManager.SetSketchPoint(startX + (r_nut * 0.85), startY + l_boot + l_body + (l_nut * 0.6)));
    pts.push_back(pPart->SketchManager.SetSketchPoint(startX + r_nut, startY + l_boot + l_body + (l_nut * 0.7)));

    // 7. 너트 상단 모따기(Chamfer)
    pts.push_back(pPart->SketchManager.SetSketchPoint(startX + r_nut, startY + length - (l_nut * 0.15)));
    pts.push_back(pPart->SketchManager.SetSketchPoint(startX + (r_nut * 0.8), startY + length));

    // 8. 상단 중심축
    pts.push_back(pPart->SketchManager.SetSketchPoint(startX, startY + length));

    // 외곽 라인 연결
    for (size_t i = 0; i < pts.size() - 1; ++i) {
        pPart->SketchManager.CreateSketchLine(pts[i], pts[i + 1]);
    }

    // 중심축 라인 생성 및 스케치 닫기 (상단 -> 하단)
    CiSketchLine axisLine = pPart->SketchManager.CreateSketchLine(pts.back(), pts.front());
    pPart->SetSolidProfile();

    // 360도 회전 피처 생성
    CiFeature plugFeat = pPart->FeatureManager.CreateRevolve(axisLine, CiJoinOpEnum::NewBody, 360.0, CiDirectionOpEnum::Positive, partName);

    // 금속 재질(알루미늄이나 크롬) 또는 플라스틱 재질 적용
    ApplyBodyMaterial(pPart, plugFeat, color, color);

    return S_OK;
}

//=============================================================================
// 1. [독립 파트] 전선 인출부 (고무 부쉬) 생성
//=============================================================================
HRESULT MotorCreator::CreateLeadOutletPart(CiPart* pPart, double dia, double height)
{
    double u = m_unit;
    // 1. 형상 생성 (-X 방향 돌출)
    CiWorkPlane yzPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, 0.0);
    pPart->SketchManager.StartSketch(yzPlane);
    pPart->SketchManager.SetPointXYReplace();
    pPart->SketchManager.CreateSketchCircle(dia / 2.0, 0.0, 0.0);
    pPart->SetSolidProfile();
    CiFeature outletFeat = pPart->FeatureManager.CreateExtrude(height, CiDirectionOpEnum::Negative, CiJoinOpEnum::Join, 0, _T("Lead_Outlet"));
    ApplyBodyMaterial(pPart, outletFeat, _T("고무 - 검은색"), _T("고무 - 검은색"));

    // 2. 메이트 요소 등록 (끝단 조립용)
    // 조립 중심축 (X축)
    CiWorkAxis endAxis = pPart->WGManager.CreateWorkAxis(CiBaseDirectionEnum::X, CiPoint(0, 0, 0), _T("Outlet-Axis"));
    pPart->WGManager.AddMateRef(endAxis);

    // 조립 평면 (X = -height 위치의 YZ 평면)
    CiWorkPlane endPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, -height, _T("Outlet-End-Plane"));
    pPart->WGManager.AddMateRef(endPlane);

    return S_OK;
}

//=============================================================================
// 2. [독립 파트] 파워용 사각 플러그 생성
//=============================================================================
HRESULT MotorCreator::CreatePowerPlugPart(CiPart* pPart, double w, double h, double d, ATL::CString partName, ATL::CString color)
{
    CiWorkPlane xyPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XY, 0.0);
    pPart->SketchManager.StartSketch(xyPlane);
    pPart->SketchManager.CreateSketchRect(w, h, CiPoint(0, 0, 0), true);

    double tabW = w * 0.4; double tabH = h * 0.2;
    pPart->SketchManager.CreateSketchRect(tabW, tabH, CiPoint(0, (h / 2.0) + (tabH / 2.0), 0), true);
    pPart->SetSolidProfile();

    CiFeature plugFeat = pPart->FeatureManager.CreateExtrude(d, CiDirectionOpEnum::Positive, CiJoinOpEnum::NewBody, 0, partName);
    pPart->FeatureManager.CreateFillet(plugFeat, 0.5 / m_unit);

    ApplyBodyMaterial(pPart, plugFeat, color, color);
    return S_OK;
}

//=============================================================================
// [독립 파트] 정밀 IX40 커넥터 생성
// - 특징: 다중 재질 바디 분리, 특정 바디(Mating_Shell)에만 Pin Hole 파내기
//=============================================================================
HRESULT MotorCreator::CreateDetailedIX40Part(CiPart* pPart)
{
    double u = m_unit;
    double Length_Total = 22.9 / u, Height_Total = 14.3 / u, Width_Body = 8.4 / u;
    double Length_Outlet = 3.2 / u, Length_Body = 14.0 / u, Length_MatingShell = 5.7 / u;
    double Width_MatingShell = 4.2 / u, Height_MatingShell = 7.15 / u;

    // -------------------------------------------------------------------------
    // [1] Cable Outlet (고무 부트) : 첫 번째 피처이므로 Join 사용
    // -------------------------------------------------------------------------
    CiWorkPlane yzOutlet = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, 0.0);
    pPart->SketchManager.StartSketch(yzOutlet);
    pPart->SketchManager.CreateSketchCircle(3.4 / u, 0.0, 0.0);
    pPart->SetSolidProfile();

    CiFeature outletFeat = pPart->FeatureManager.CreateExtrude(Length_Outlet, CiDirectionOpEnum::Negative, CiJoinOpEnum::Join, 0, _T("Cable_Outlet"));
    ApplyBodyMaterial(pPart, outletFeat, _T("Smooth - Black"), _T("매끄러움 - 검은색"));

    // -------------------------------------------------------------------------
    // [2] Connector Body (플라스틱 커버 본체) : NewBody 사용
    // -------------------------------------------------------------------------
    double bodyStartX = -Length_Outlet; // -3.2 위치
    CiWorkPlane yzBody = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, bodyStartX);
    pPart->SketchManager.StartSketch(yzBody);
    pPart->SketchManager.SetPointXYReplace(); // X=폭(Width), Y=높이(Height)

    pPart->SketchManager.CreateSketchRect(Width_Body, Height_Total, CiPoint(0, 0, 0), true);
    pPart->SetSolidProfile();

    CiFeature bodyFeat = pPart->FeatureManager.CreateExtrude(Length_Body, CiDirectionOpEnum::Negative, CiJoinOpEnum::NewBody, 0, _T("Connector_Body"));
    ApplyBodyMaterial(pPart, bodyFeat, _T("Smooth - Black"), _T("매끄러움 - 검은색"));

    // -------------------------------------------------------------------------
    // [3] Mating Shell (전면 ▣ 체결부 + A-Key) : NewBody 사용
    // -------------------------------------------------------------------------
    double shellStartX = -(Length_Outlet + Length_Body); // -17.2 위치
    CiWorkPlane yzMating = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, shellStartX);
    pPart->SketchManager.StartSketch(yzMating);
    pPart->SketchManager.SetPointXYReplace();

    double w2 = Width_MatingShell / 2.0, h2 = Height_MatingShell / 2.0;
    double inW = w2 * 0.5, inH = h2 * 0.8, chamfer = 1.0 / u;

    // 바깥 외곽선 (A-Key 우측 하단 모깎기)
    std::vector<CiSketchPoint> sPts;
    sPts.push_back(pPart->SketchManager.SetSketchPoint(-w2, -h2));
    sPts.push_back(pPart->SketchManager.SetSketchPoint(w2 - chamfer, -h2));
    sPts.push_back(pPart->SketchManager.SetSketchPoint(w2, -h2 + chamfer));
    sPts.push_back(pPart->SketchManager.SetSketchPoint(w2, h2));
    sPts.push_back(pPart->SketchManager.SetSketchPoint(-w2, h2));

    for (size_t i = 0; i < sPts.size() - 1; ++i) {
        pPart->SketchManager.CreateSketchLine(sPts[i], sPts[i + 1]);
    }
    pPart->SketchManager.CreateSketchLine(sPts.back(), sPts.front());

    // 안쪽 사각형 (▣ 형상 파내기)
    pPart->SketchManager.CreateSketchRect(inW * 2.0, inH * 2.0, CiPoint(0, 0, 0), true);
    pPart->SetSolidProfile();

    CiFeature shellFeat = pPart->FeatureManager.CreateExtrude(Length_MatingShell, CiDirectionOpEnum::Negative, CiJoinOpEnum::NewBody, 0, _T("Mating_Shell"));
    ApplyBodyMaterial(pPart, shellFeat, _T("Stainless - Brushed"), _T("스테인레스 - 브러시"));

    // -------------------------------------------------------------------------
    // [4] 8-Pin Cavities (양쪽 4열 핀 구멍 컷) + ★ Affected Body 적용
    // -------------------------------------------------------------------------
    CiWorkPlane yzPin = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, shellStartX - Length_MatingShell);

    pPart->SketchManager.StartSketch(yzPin);
    pPart->SketchManager.SetPointXYReplace();

    double cav = 0.5 / u, pitchY = Height_MatingShell / 5.0;
    double leftX = -(w2 + inW) / 2.0, rightX = (w2 + inW) / 2.0;

    for (int i = 0; i < 4; ++i) {
        double posY = (1.5 * pitchY) - (i * pitchY);
        pPart->SketchManager.CreateSketchRect(cav, cav, CiPoint(leftX, posY, 0.0), true);
        pPart->SketchManager.CreateSketchRect(cav, cav, CiPoint(rightX, posY, 0.0), true);
    }
    pPart->SetSolidProfile();

    CiFeature cutFeat = pPart->FeatureManager.CreateExtrude(4.0 / u, CiDirectionOpEnum::Positive, CiJoinOpEnum::Cut, 0, _T("Cut_Pin_Holes"));

    // ★ 제공해주신 함수 형식 적용: Mating_Shell 바디에만 구멍을 뚫음
    ApplyAffectedBodyToFeature(pPart, cutFeat, shellFeat);

    // -------------------------------------------------------------------------
    // [5] 메이트 요소 등록 (케이블과 결합될 입구)
    // -------------------------------------------------------------------------
    CiWorkAxis plugAxis = pPart->WGManager.CreateWorkAxis(CiBaseDirectionEnum::X, CiPoint(0, 0, 0), _T("Plug-Axis"));
    pPart->WGManager.AddMateRef(plugAxis);

    CiWorkPlane plugBase = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, 0.0, _T("Plug-Base-Plane"));
    pPart->WGManager.AddMateRef(plugBase);

    return S_OK;
}

//=============================================================================
// 6. 리니어 모터 고정자(Track) 파트 생성
//=============================================================================
HRESULT MotorCreator::CreateLinearMotorTrack(CiPart* pPart)
{
    // 스키마 치수 매핑
    double trackWidth = m_partData->Dim.LC;   // 트랙 폭
    double trackLength = m_partData->Dim.LM;   // 트랙 전체 길이
    double trackHeight = m_partData->Dim.LH;   // 트랙 높이(두께)

    if (trackWidth <= 0.0 || trackLength <= 0.0) return E_INVALIDARG;

    // 높이값이 누락되었을 경우를 대비한 안전값(Fallback)
    if (trackHeight <= 0.0) trackHeight = 15.0;

    // 1. 기준 평면 생성 (XY 바닥면 기준)
    CiWorkPlane xyPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XY, 0.0);
    pPart->SketchManager.StartSketch(xyPlane);

    // 2. 트랙 베이스 직사각형 스케치
    // 원점을 중심으로 배치 (true 파라미터가 Center 렉탱글을 의미한다고 가정)
    pPart->SketchManager.CreateSketchRect(trackLength, trackWidth, CiPoint(0, 0, 0), true);

    pPart->SetSolidProfile();

    // 3. 돌출 (Positive 방향)
    CiFeature trackBody = pPart->FeatureManager.CreateExtrude(trackHeight, CiDirectionOpEnum::Positive, CiJoinOpEnum::NewBody, 0, _T("Linear_Track"));

    // 4. 재질 적용
    ApplyBodyMaterial(pPart, trackBody, _T("Steel, Galvanized"), _T("스틸 - 도금"));

    // (필요 시 취부 홀 가공 추가)
    // CreateMountingHoles(pPart);

    return S_OK;
}

//=============================================================================
// 7. 리니어 모터 가동자(Mover) 파트 생성
//=============================================================================
HRESULT MotorCreator::CreateLinearMotorMover(CiPart* pPart)
{
    // 스키마 치수 매핑 (리니어 모터 특화 매핑)
    double moverWidth = m_partData->Dim.S_l;  // 가동자 폭
    double moverLength = m_partData->Dim.S_h;  // 가동자 길이
    double moverHeight = m_partData->Dim.LE;   // 가동자 높이

    if (moverWidth <= 0.0 || moverLength <= 0.0) return E_INVALIDARG;

    if (moverHeight <= 0.0) moverHeight = 20.0; // Fallback

    // 1. 기준 평면 생성 (XY 평면)
    // 어셈블리(CreateMotor) 단계에서 에어갭(Air Gap)만큼 띄워서 메이트하므로 파트는 원점에서 스케치
    CiWorkPlane xyPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XY, 0.0);
    pPart->SketchManager.StartSketch(xyPlane);

    // 2. 가동자 직사각형 스케치
    pPart->SketchManager.CreateSketchRect(moverLength, moverWidth, CiPoint(0, 0, 0), true);

    pPart->SetSolidProfile();

    // 3. 돌출 (Positive 방향)
    CiFeature moverBody = pPart->FeatureManager.CreateExtrude(moverHeight, CiDirectionOpEnum::Positive, CiJoinOpEnum::NewBody, 0, _T("Linear_Mover"));

    // 4. 재질 적용 (검은색 알루미늄 방열판 느낌)
    ApplyBodyMaterial(pPart, moverBody, _T("Aluminum, Anodized Black"), _T("알루미늄 - 흑색 아노다이징"));

    return S_OK;
}

//=============================================================================
// 8. 커넥터 박스 파트 생성
//=============================================================================
HRESULT MotorCreator::CreateConnectorBoxes(CiPart* pPart)
{
    // 스키마 치수 매핑 (M 커넥터 기준)
    double cw = m_partData->Dim.CW_MW; // 커넥터 너비
    double cl = m_partData->Dim.CL_ML; // 커넥터 길이
    double ch = m_partData->Dim.CH_MH; // 커넥터 높이
    double cs = m_partData->Dim.CS;    // 중심 기준 오프셋

    if (cw <= 0.0 || ch <= 0.0) return S_OK; // 커넥터 치수가 없으면 생성 안 함
    if (cl <= 0.0) cl = cw; // 길이가 없으면 정사각형 블록으로 간주

    // 1. 기준 평면 생성 (XY 바닥면 기준)
    // 파트를 개별로 생성 후, 어셈블리 단에서 바디 표면에 메이트 시키기 위해 0.0 기준
    CiWorkPlane xyPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XY, 0.0);
    pPart->SketchManager.StartSketch(xyPlane);

    // 2. 커넥터 사각형 스케치 (중심이 아닌 오프셋 CS 적용)
    // Z위치는 0, Y위치를 CS값 만큼 이동, X위치는 길이의 절반으로 설정하여 바디 중앙부근 위치 모사
    CiPoint centerPt(cl / 2.0, cs, 0.0);
    pPart->SketchManager.CreateSketchRect(cl, cw, centerPt, true);

    pPart->SetSolidProfile();

    // 3. 돌출 (Positive 방향)
    CiFeature connBody = pPart->FeatureManager.CreateExtrude(ch, CiDirectionOpEnum::Positive, CiJoinOpEnum::NewBody, 0, _T("M_Connector_Box"));

    // 4. 재질 적용 (검은색 플라스틱 몰딩 느낌)
    ApplyBodyMaterial(pPart, connBody, _T("Plastic, Black"), _T("플라스틱 - 검정"));

    return S_OK;
}

HRESULT MotorCreator::CreateFluidMotorBody(CiPart* pPart)
{
    return S_OK;
}

HRESULT MotorCreator::CreateDriveBoxBody(CiPart* pPart)
{
    return S_OK;
}

//=============================================================================
// 2. Output flange
//=============================================================================

HRESULT MotorCreator::CreateOutputFlange(CiPart* pPart)
{
    if (m_options.flangType == MotorFlangType::Square ||
        m_options.flangType == MotorFlangType::FootMount)
        return CreateSquareFlange(pPart);
    else
        return CreateRoundFlange(pPart);
}

HRESULT MotorCreator::CreateRoundFlange(CiPart* pPart)
{
    double flangDia = m_partData->Dim.LB;
    double flangThk = m_partData->Dim.LE;
    double bodyLen  = m_partData->Dim.LM;

    if (flangDia <= 0.0)
        return E_INVALIDARG;
    if (flangThk <= 0.0)
        flangThk = flangDia * MotorConstants::FLANGE_THICK_RATIO;
/*
    // Offset from body front face
    CiWorkPlane plane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, bodyLen);
 //   pPart->SketchManager.StartSketch(plane);

    double r = flangDia / 2.0;
    pPart->SketchManager.CreateSketchCircle(r, 0.0, 0.0);

    pPart->SetSolidProfile();
  //  pPart->FeatureManager.CreateExtrude(flangThk, CiDirectionOpEnum::Positive, CiJoinOpEnum::Join);
*/
    return S_OK;
}

//=============================================================================
// 12. 전면 플랜지 및 파일럿 보스(Boss/Bearing) 파트 생성
//=============================================================================
HRESULT MotorCreator::CreateSquareFlange(CiPart* pPart)
{
    // 스키마 치수 매핑 (Schema 3번 - Flange & Mounting)
    double frameW = m_partData->Dim.LC;           // 플랜지 폭 (일반적으로 바디 폭과 동일)
    double flangeThick = m_partData->Dim.LH;      // 플랜지 두께 (높이)
    double bossDia = m_partData->Dim.LB;          // 파일럿 보스(베어링 하우징) 외경
    double bossProtrusion = m_partData->Dim.LE;   // 파일럿 보스 돌출 길이
    double cornerR = m_partData->Dim.R > 0.0 ? m_partData->Dim.R : 0.1;

    // 플랜지 두께가 누락된 경우 기본값 할당
    if (flangeThick <= 0.0) flangeThick = 5.0;

    // 샤프트가 관통할 수 있도록 중앙에 뚫어줄 홀 직경 (샤프트 직경 S보다 약간 크게 설정)
    double shaftHoleDia = m_partData->Dim.S + 1.0;

    if (frameW <= 0.0) return S_OK;

    // =========================================================================
    // [1단계] 플랜지 베이스 생성
    // =========================================================================
    // 조립면(X=0)을 기준으로 모터 바깥쪽(Negative)으로 두께만큼 돌출
    CiWorkPlane yzPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, 0.0);
    pPart->SketchManager.StartSketch(yzPlane);

    // 사각형 외곽선 및 중앙 관통 홀 스케치
    pPart->SketchManager.CreateSketchRectRound(frameW, frameW, cornerR);
    pPart->SketchManager.CreateSketchCircle(shaftHoleDia / 2.0, 0.0, 0.0);

    pPart->SetSolidProfile();
    CiFeature flangeBody = pPart->FeatureManager.CreateExtrude(flangeThick, CiDirectionOpEnum::Negative, CiJoinOpEnum::NewBody, 0, _T("Flange_Base"));

    // 플랜지 재질 적용 (연마된 알루미늄 느낌)
    ApplyBodyMaterial(pPart, flangeBody, _T("Aluminum, Polished"), _T("알루미늄 - 연마"));

    // =========================================================================
    // [2단계] 파일럿 보스(Boss) 단차 돌출
    // =========================================================================
    // 보스 치수가 존재하는 경우, 플랜지 앞면(-flangeThick)에서 추가로 돌출
    if (bossDia > 0.0 && bossProtrusion > 0.0) {
        CiWorkPlane bossPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, -flangeThick);
        pPart->SketchManager.StartSketch(bossPlane);

        // 보스 외곽선 및 중앙 관통 홀 스케치
        pPart->SketchManager.CreateSketchCircle(bossDia / 2.0, 0.0, 0.0);
        pPart->SketchManager.CreateSketchCircle(shaftHoleDia / 2.0, 0.0, 0.0);

        pPart->SetSolidProfile();
        // 기존 플랜지 바디에 병합(Join)
        pPart->FeatureManager.CreateExtrude(bossProtrusion, CiDirectionOpEnum::Negative, CiJoinOpEnum::Join, 0, _T("Flange_Boss"));
    }

    return S_OK;
}

//=============================================================================
// 9. 출력축 생성 메인 제어 (타입별 피처 가공 분기)
//=============================================================================
HRESULT MotorCreator::CreateOutputShaft(CiPart* pPart)
{
    // 1. 공통 뼈대 생성 (둥근 원통형 기본 축 및 로터)
    CreateSolidShaftBase(pPart);

    // 2. 축 타입(Enum)에 따른 추가 피처(Feature) 가공
    switch (m_options.shaftType)
    {
    case MotorShaftType::Hollow:
        // 중공축 컷아웃 (일반 모터의 관통 등)
        CreateHollowCutout(pPart);
        break;

    case MotorShaftType::D_Cut_Single:
        // 1면 플랫 가공
        CreateShaftDCut(pPart, 1);
        break;

    case MotorShaftType::D_Cut_Double:
        // 2면 플랫 가공
        CreateShaftDCut(pPart, 2);
        break;

    case MotorShaftType::Keyway:
    case MotorShaftType::Keyway_NoKey:
    case MotorShaftType::Keyway_WithKey:
        // 키홈 파기 (실제 Key 조립품 삽입은 CreateMotor 어셈블리 단에서 처리)
        CreateShaftKeyway(pPart);
        break;

    case MotorShaftType::Tap:
        // 중심 끝단 탭 가공
        CreateShaftCenterTap(pPart);
        break;

    case MotorShaftType::Keyway_And_Tap:
        // 키홈 + 중심 끝단 탭 동시 가공
        CreateShaftKeyway(pPart);
        CreateShaftCenterTap(pPart);
        break;

        // [향후 로직 추가를 위한 명시적 분기]
    case MotorShaftType::DoubleShaft:
        // CreateDoubleShaft(pPart); // 양축 가공
        break;

    case MotorShaftType::Flange:
        // CreateFlangeOutput(pPart); // 플랜지형 출력
        break;

    case MotorShaftType::Gear_Pinion:
        // CreateGearPinion(pPart); // 기어/피니언 가공
        break;

    case MotorShaftType::L_Cut:
        // CreateShaftLCut(pPart); // L컷 가공
        break;

    case MotorShaftType::Solid:
    case MotorShaftType::Straight:
    case MotorShaftType::Plain:
    case MotorShaftType::Spline:
    case MotorShaftType::Tapered:
    case MotorShaftType::Taper_And_Key:
    default:
        // 기본 원통축 유지
        break;
    }

    return S_OK;
}

HRESULT MotorCreator::CreateSolidShaftBase(CiPart* pPart)
{
    double shaftDia = m_partData->Dim.S;        // 축 외경
    double shaftLR = m_partData->Dim.LR;        // 축 돌출 길이 (+X 방향)

    // 전체 길이(L1)와 모터 바디 길이(motorBodyLen) 분리
    double L1 = (m_partData->Dim.L1_LL > 0) ? m_partData->Dim.L1_LL : m_partData->Dim.LX;
    double motorBodyLen = (m_partData->Dim.L2 > 0.0) ? m_partData->Dim.L2 : m_partData->Dim.LM;
    if (motorBodyLen <= 0.0) motorBodyLen = L1 * 0.8; // 예외 처리

    double hollowR = (m_options.bodyType == MotorBodyType::DirectDrive && m_partData->Dim.W > 0)
        ? (m_partData->Dim.W / 2.0) : 0.0;

    if (shaftDia <= 0.0 || L1 <= 0.0) return E_INVALIDARG;

    CiWorkPlane xyPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XY, 0.0);
    pPart->SketchManager.StartSketch(xyPlane);

    // ★ 로터(Rotor)는 모터 바디(motorBodyLen) 길이에 비례하도록 수정
    double rotorLen = motorBodyLen * 0.5;
    double rotorDia = shaftDia * 2.5;
    double rotorStartPos = motorBodyLen * 0.2;

    // 축 자체는 엔코더 내부까지 길게 뻗음
    double internalShaftLen = L1 * 0.9;

    std::vector<CiSketchPoint> sPts;

    sPts.push_back(pPart->SketchManager.SetSketchPoint(shaftLR, hollowR));
    sPts.push_back(pPart->SketchManager.SetSketchPoint(shaftLR, shaftDia / 2.0));

    sPts.push_back(pPart->SketchManager.SetSketchPoint(-rotorStartPos, shaftDia / 2.0));
    sPts.push_back(pPart->SketchManager.SetSketchPoint(-rotorStartPos, rotorDia / 2.0));
    sPts.push_back(pPart->SketchManager.SetSketchPoint(-(rotorStartPos + rotorLen), rotorDia / 2.0));
    sPts.push_back(pPart->SketchManager.SetSketchPoint(-(rotorStartPos + rotorLen), shaftDia / 2.0));
    sPts.push_back(pPart->SketchManager.SetSketchPoint(-internalShaftLen, shaftDia / 2.0)); // 엔코더까지 뻗음
    sPts.push_back(pPart->SketchManager.SetSketchPoint(-internalShaftLen, hollowR));

    for (size_t i = 0; i < sPts.size() - 1; ++i) {
        pPart->SketchManager.CreateSketchLine(sPts[i], sPts[i + 1]);
    }

    if (hollowR == 0.0) {
        CiSketchLine axisLine = pPart->SketchManager.CreateSketchLine(sPts.back(), sPts.front());
        pPart->SetSolidProfile();
        CiFeature shaftFullBody = pPart->FeatureManager.CreateRevolve(
            axisLine, CiJoinOpEnum::NewBody, 360.0, CiDirectionOpEnum::Positive, _T("Shaft_with_Rotor"));
        ApplyBodyMaterial(pPart, shaftFullBody, _T("Steel - Polished"), _T("강철 - 연마"));
    }
    else {
        pPart->SketchManager.CreateSketchLine(sPts.back(), sPts.front());
        CiSketchPoint axisPt1 = pPart->SketchManager.SetSketchPoint(-internalShaftLen, 0.0);
        CiSketchPoint axisPt2 = pPart->SketchManager.SetSketchPoint(shaftLR, 0.0);
        CiSketchLine axisLine = pPart->SketchManager.CreateSketchLine(axisPt1, axisPt2);
        pPart->SetSolidProfile();
        CiFeature shaftFullBody = pPart->FeatureManager.CreateRevolve(
            axisLine, CiJoinOpEnum::NewBody, 360.0, CiDirectionOpEnum::Positive, _T("Shaft_with_Rotor"));
        ApplyBodyMaterial(pPart, shaftFullBody, _T("Steel - Polished"), _T("강철 - 연마"));
    }

    return S_OK;
}

//=============================================================================
// 샤프트 커버 / 보스 (Shaft Cover / Pilot Boss) 생성
// - Join 대신 NewBody 옵션 적용을 통해 재질 독립 부여
//=============================================================================
HRESULT MotorCreator::CreateShaftCover(CiPart* pPart)
{
    double bossDia = m_partData->Dim.LB;
    double bossLen = m_partData->Dim.LE;

    if (bossDia <= 0.0 || bossLen <= 0.0) return S_OK;

    CiWorkPlane yzPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, 0.0);
    pPart->SketchManager.StartSketch(yzPlane);

    pPart->SketchManager.CreateSketchCircle(bossDia / 2.0, 0.0, 0.0);

    double shaftHole = m_partData->Dim.S > 0.0 ? m_partData->Dim.S + (0.1 / m_unit) : (11.0 / m_unit);
    pPart->SketchManager.CreateSketchCircle(shaftHole / 2.0, 0.0, 0.0);

    pPart->SetSolidProfile();

    // ★ Join -> NewBody로 변경하여 독립된 솔리드 바디로 생성
    CiFeature coverBody = pPart->FeatureManager.CreateExtrude(bossLen, CiDirectionOpEnum::Positive, CiJoinOpEnum::NewBody, 0, _T("Shaft_Cover"));

    // 알루미늄 재질 부여
    ApplyBodyMaterial(pPart, coverBody, _T("Aluminum"), _T("알루미늄"));

    return S_OK;
}

//=============================================================================
// 11-1. D-Cut (플랫) 가공
//=============================================================================
HRESULT MotorCreator::CreateShaftDCut(CiPart* pPart, int cutSides)
{
    double shaftDia = m_partData->Dim.S;   // 축 직경
    double shaftKa = m_partData->Dim.KA;  // 깎여나가는 깊이
    double shaftKL = m_partData->Dim.KL;  // 깎이는 면의 길이(축 방향)
    double shaftLR = m_partData->Dim.LR;  // 축의 전체 길이 (돌출된 끝단 위치)

    // 컷(Cut) 실행 시 모델을 확실하게 관통하기 위한 여유값
    double nLen = 2.0 / m_unit;

    if (shaftKa <= 0.0 || shaftKL <= 0.0 || shaftLR <= 0.0) return S_OK;

    // ---------------------------------------------------------
    // [1] 1면 D-Cut (XZ 평면 하단 깎기)
    // ---------------------------------------------------------
    CiWorkPlane xzPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ, 0.0);
    pPart->SketchManager.StartSketch(xzPlane);

    // ★ XZ 평면 스케치 축 방향 보정 함수 적용
    pPart->SketchManager.SetPointXRevert();

    // 축 끝단(X = LR)에서 모터 방향(-X)으로 깎아 들어가는 X 좌표 계산
    double startX = shaftLR + nLen;
    double endX = shaftLR - shaftKL;
    double runoutX = shaftLR - shaftKL - shaftKa;

    // Y 좌표 계산 (아래쪽 깎기)
    double cutY = -((shaftDia * 0.5) - shaftKa);
    double bottomY = -((shaftDia * 0.5) + nLen);

    CiSketchPoint plt[4];
    plt[0] = pPart->SketchManager.SetSketchPoint(startX, cutY);
    plt[1] = pPart->SketchManager.SetSketchPoint(endX, cutY);
    plt[2] = pPart->SketchManager.SetSketchPoint(runoutX, bottomY);
    plt[3] = pPart->SketchManager.SetSketchPoint(startX, bottomY);

    pPart->SketchManager.CreateSketchLine(plt[0], plt[1]);
    pPart->SketchManager.CreateSketchLine(plt[1], plt[2]);
    pPart->SketchManager.CreateSketchLine(plt[2], plt[3]);
    pPart->SketchManager.CreateSketchLine(plt[3], plt[0]);

    pPart->SetSolidProfile();
    pPart->FeatureManager.CreateExtrude(shaftDia + nLen, CiDirectionOpEnum::Symmetry, CiJoinOpEnum::Cut, 0, _T("Cut_DCut_1"));

    // ---------------------------------------------------------
    // [2] 2면 D-Cut일 경우 (XZ 평면 상단 평행하게 깎기)
    // ---------------------------------------------------------
    if (cutSides == 2) {
        pPart->SketchManager.StartSketch(xzPlane);

        // ★ 스케치를 새로 열었으므로 보정 함수 다시 적용
        pPart->SketchManager.SetPointXRevert();

        // Y 좌표 계산 (위쪽 깎기) - 부호 반대
        double topCutY = ((shaftDia * 0.5) - shaftKa);
        double topY = ((shaftDia * 0.5) + nLen);

        CiSketchPoint plt2[4];
        plt2[0] = pPart->SketchManager.SetSketchPoint(startX, topCutY);
        plt2[1] = pPart->SketchManager.SetSketchPoint(endX, topCutY);
        plt2[2] = pPart->SketchManager.SetSketchPoint(runoutX, topY);
        plt2[3] = pPart->SketchManager.SetSketchPoint(startX, topY);

        pPart->SketchManager.CreateSketchLine(plt2[0], plt2[1]);
        pPart->SketchManager.CreateSketchLine(plt2[1], plt2[2]);
        pPart->SketchManager.CreateSketchLine(plt2[2], plt2[3]);
        pPart->SketchManager.CreateSketchLine(plt2[3], plt2[0]);

        pPart->SetSolidProfile();
        pPart->FeatureManager.CreateExtrude(shaftDia + nLen, CiDirectionOpEnum::Symmetry, CiJoinOpEnum::Cut, 0, _T("Cut_DCut_2"));
    }

    return S_OK;
}

//=============================================================================
// 11-2. 키홈(Keyway) 가공
//=============================================================================
HRESULT MotorCreator::CreateShaftKeyway(CiPart* pPart)
{
    double keyW = m_partData->Dim.W;  // 키홈 폭
    double keyL = m_partData->Dim.QK; // 키홈 유효 길이
    double keyU = m_partData->Dim.U;  // 축 외경에서 파고드는 깊이
    double shaftD = m_partData->Dim.S;  // 축 직경

    if (keyW <= 0.0 || keyL <= 0.0) return S_OK;

    // U값이 누락되었을 경우 기본 컷 깊이 지정 (축 직경의 약 15%)
    double keyDep = keyU > 0.0 ? keyU : (shaftD * 0.15);

    // 축 외곽 표면(XZ 평면을 반경만큼 띄움)에서 스케치 시작
    CiWorkPlane keyPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ, shaftD / 2.0);
    pPart->SketchManager.StartSketch(keyPlane);

    double R = keyW / 2.0;
    double L = keyL;

    // 양쪽 끝이 둥근 장공(Slot) 형태의 키홈 스케치
    CiSketchPoint p1 = pPart->SketchManager.SetSketchPoint(R, R);
    CiSketchPoint p2 = pPart->SketchManager.SetSketchPoint(R - L, R);
    CiSketchPoint p3 = pPart->SketchManager.SetSketchPoint(R - L, -R);
    CiSketchPoint p4 = pPart->SketchManager.SetSketchPoint(R, -R);

    pPart->SketchManager.CreateSketchLine(p1, p2);
    pPart->SketchManager.CreateSketchLine(p3, p4);

    CiSketchPoint cp1 = pPart->SketchManager.SetSketchPoint(R - L, 0);
    CiSketchPoint cp2 = pPart->SketchManager.SetSketchPoint(R, 0);
    pPart->SketchManager.CreateSketchArc(cp1, p2, p3);
    pPart->SketchManager.CreateSketchArc(cp2, p4, p1);

    pPart->SetSolidProfile();
    // Negative 방향으로 깊이(keyDep)만큼 컷아웃
    pPart->FeatureManager.CreateExtrude(keyDep, CiDirectionOpEnum::Negative, CiJoinOpEnum::Cut, 0, _T("Cut_Keyway"));

    return S_OK;
}

//=============================================================================
// 11-3. 중심 탭(Tap) 가공
//=============================================================================
HRESULT MotorCreator::CreateShaftCenterTap(CiPart* pPart)
{
    double tapDia = m_partData->Dim.TM;   // 탭 내경 규격
    double tapDepth = m_partData->Dim.TapL; // 탭 깊이

    if (tapDia <= 0.0 || tapDepth <= 0.0) return S_OK;

    // 플랜지 앞단(YZ 평면) 또는 축 끝단에서 스케치
    CiWorkPlane yzPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, 0.0);
    pPart->SketchManager.StartSketch(yzPlane);
    pPart->SketchManager.CreateSketchCircle(tapDia / 2.0, 0.0, 0.0);

    pPart->SetSolidProfile();
    // 축 내부를 향해(Negative) 깊이만큼 컷
    pPart->FeatureManager.CreateExtrude(tapDepth, CiDirectionOpEnum::Negative, CiJoinOpEnum::Cut, 0, _T("Cut_CenterTap"));

    return S_OK;
}

//=============================================================================
// 11-4. 중공축 (Hollow) 내부 컷아웃
//=============================================================================
HRESULT MotorCreator::CreateHollowCutout(CiPart* pPart)
{
    double innerDia = m_partData->Dim.W; // 중공 내경 (W 파라미터 매핑)
    double shaftTotalL = m_partData->Dim.LR;

    if (innerDia <= 0.0) return S_OK;

    CiWorkPlane yzPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, 0.0);
    pPart->SketchManager.StartSketch(yzPlane);
    pPart->SketchManager.CreateSketchCircle(innerDia / 2.0, 0.0, 0.0);

    pPart->SetSolidProfile();
    // 축 전체를 양방향(대칭)으로 길게 뚫어버림
    pPart->FeatureManager.CreateExtrude(shaftTotalL * 2, CiDirectionOpEnum::Symmetry, CiJoinOpEnum::Cut, 0, _T("Cut_Hollow"));

    return S_OK;
}

HRESULT MotorCreator::CreateSolidShaft(CiPart* pPart) // Straight Shaft and Flat, Key 
{
    double shaftDia = m_partData->Dim.S;
    double shaftKa = m_partData->Dim.KA;
    double shaftKL = m_partData->Dim.KL;
    double shaftLen = m_partData->Dim.LR;
    double LG_Len = m_partData->Dim.TL_LG;
    double motorLen = m_partData->Dim.L2;
    double flangThk = m_partData->Dim.LE;
    double shaftD = m_partData->Dim.LB;
    double frameW = m_partData->Dim.LC;
    double inDia = frameW * 0.75;
    double nLen = 0.1;

    if (shaftDia <= 0.0 || shaftLen <= 0.0)
        return E_INVALIDARG;

    CiWorkPlane shplaneA = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XY); // 축단-Revolve(메이트)
    pPart->SketchManager.StartSketch(shplaneA);

    double Shaft_all_Len = shaftLen + LG_Len + nLen;
    double Shaft_all_Len2 = Shaft_all_Len + (motorLen - flangThk) - nLen;

    CiSketchPoint pts[8];
    pts[0] = pPart->SketchManager.SetSketchPoint(0, 0);        //1
    pts[1] = pPart->SketchManager.SetSketchPoint(0, shaftDia * 0.5); //2
    pts[2] = pPart->SketchManager.SetSketchPoint(Shaft_all_Len, shaftDia * 0.5);
    pts[3] = pPart->SketchManager.SetSketchPoint(Shaft_all_Len, inDia * 0.5);
    pts[4] = pPart->SketchManager.SetSketchPoint(Shaft_all_Len2 - nLen, inDia * 0.5);
    pts[5] = pPart->SketchManager.SetSketchPoint(Shaft_all_Len2 - nLen, shaftDia * 0.5);
    pts[6] = pPart->SketchManager.SetSketchPoint(Shaft_all_Len2, shaftDia * 0.5);
    pts[7] = pPart->SketchManager.SetSketchPoint(Shaft_all_Len2, 0);

    pPart->SketchManager.CreateSketchLine(pts[0], pts[1]);
    pPart->SketchManager.CreateSketchLine(pts[1], pts[2]);
    pPart->SketchManager.CreateSketchLine(pts[2], pts[3]);
    pPart->SketchManager.CreateSketchLine(pts[3], pts[4]);
    pPart->SketchManager.CreateSketchLine(pts[4], pts[5]);
    pPart->SketchManager.CreateSketchLine(pts[5], pts[6]);
    pPart->SketchManager.CreateSketchLine(pts[6], pts[7]);
    pPart->SketchManager.CreateSketchLine(pts[7], pts[0]);

    pPart->SetSolidProfile();
    CiWorkAxis oAxis2Line = pPart->WGManager.GetBaseAxis(CiBaseDirectionEnum::X);
    CiRevolveFeature shaftBody = pPart->FeatureManager.CreateRevolve(oAxis2Line, CiJoinOpEnum::Join);
    ApplyBodyMaterial(pPart, shaftBody, _T("Aluminum, Polished"), _T("알루미늄 - 연마"));

    ATL::CString shaft_End = m_partData->Info.Shaft_End;

    if (shaft_End.Find(_T("A:")) >= 0 || shaft_End.Find(_T("B:")) >= 0) {
        // 1면 플렛
        CiWorkPlane shplaneB = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ); // 축단-플렛
        pPart->SketchManager.StartSketch(shplaneB);

        CiSketchPoint plt[4];
        plt[0] = pPart->SketchManager.SetSketchPoint(nLen, -((shaftDia * 0.5) - shaftKa));
        plt[1] = pPart->SketchManager.SetSketchPoint(-shaftKL, -((shaftDia * 0.5) - shaftKa));
        plt[2] = pPart->SketchManager.SetSketchPoint(-(shaftKL + shaftKa), -((shaftDia * 0.5) + nLen));
        plt[3] = pPart->SketchManager.SetSketchPoint(nLen, -((shaftDia * 0.5) + nLen));

        pPart->SketchManager.CreateSketchLine(plt[0], plt[1]);
        pPart->SketchManager.CreateSketchLine(plt[1], plt[2]);
        pPart->SketchManager.CreateSketchLine(plt[2], plt[3]);
        pPart->SketchManager.CreateSketchLine(plt[3], plt[0]);

        pPart->SetSolidProfile();
        pPart->FeatureManager.CreateExtrude(shaftDia, CiDirectionOpEnum::Symmetry, CiJoinOpEnum::Cut);

        if (shaft_End.Find(_T("B:")) >= 0) {
            // 2면 플렛
            CiWorkPlane shplaneC = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XY); // 축단-2플렛
            pPart->SketchManager.StartSketch(shplaneC);

            CiSketchPoint pltY[4];
            pltY[0] = pPart->SketchManager.SetSketchPoint(nLen, -((shaftDia * 0.5) - shaftKa));
            pltY[1] = pPart->SketchManager.SetSketchPoint(-shaftKL, -((shaftDia * 0.5) - shaftKa));
            pltY[2] = pPart->SketchManager.SetSketchPoint(-(shaftKL + shaftKa), -((shaftDia * 0.5) + nLen));
            pltY[3] = pPart->SketchManager.SetSketchPoint(nLen, -((shaftDia * 0.5) + nLen));

            pPart->SketchManager.CreateSketchLine(pltY[0], pltY[1]);
            pPart->SketchManager.CreateSketchLine(pltY[1], pltY[2]);
            pPart->SketchManager.CreateSketchLine(pltY[2], pltY[3]);
            pPart->SketchManager.CreateSketchLine(pltY[3], pltY[0]);

            pPart->SetSolidProfile();
            pPart->FeatureManager.CreateExtrude(shaftDia, CiDirectionOpEnum::Symmetry, CiJoinOpEnum::Cut);
        }
    }

    if ( (shaft_End.Find(_T("2")) || shaft_End.Find(_T("6"))) && m_partData->Dim.QK > 0.0)
        CreateShaftKeyway(pPart);

    if (shaft_End.Find(_T("6")) && m_partData->Dim.TM > 0.0 && m_partData->Dim.TapL > 0.0)
        CreateShaftCenterTap(pPart);

    return S_OK;
}

HRESULT MotorCreator::CreateHollowShaft(CiPart* pPart) //  Straight and Flat 
{
    double outerDia = m_partData->Dim.U;
    double innerDia = m_partData->Dim.W;
    double shaftLen = m_partData->Dim.LO;
    double bodyLen  = m_partData->Dim.LM;
    double flangThk = m_partData->Dim.LE;

    if (outerDia <= 0.0 || shaftLen <= 0.0)
        return E_INVALIDARG;
    if (innerDia <= 0.0)
        innerDia = outerDia * 0.5;

    double shaftStart = bodyLen + flangThk;

    CiWorkPlane plane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, shaftStart);
  //  pPart->SketchManager.StartSketch(plane);

    // Outer circle
    pPart->SketchManager.CreateSketchCircle(outerDia / 2.0, 0.0, 0.0);
    // Inner circle (creates annular region)
    pPart->SketchManager.CreateSketchCircle(innerDia / 2.0, 0.0, 0.0);

    pPart->SetSolidProfile();
 //   pPart->FeatureManager.CreateExtrude(shaftLen, CiDirectionOpEnum::Positive, CiJoinOpEnum::Join);

    return S_OK;
}

//=============================================================================
// 13. 플랜지/바디 체결용 마운팅 홀(Hole) 및 탭(Tap) 가공
// - PCD_LA, TL_LG: 이미 스케일링 완료된 값 (그대로 사용)
// - M_LZ (스트링 파싱값), 10.0 (하드코딩값): / m_unit 적용
//=============================================================================
HRESULT MotorCreator::CreateMountingHoles(CiPart* pPart)
{
    // 1. M_LZ 치수 문자열 가져오기 및 수량 표기("4-") 제거
    ATL::CString strMLZ = m_partData->Dim.M_LZ;
    strMLZ.Trim();
    strMLZ.MakeUpper();

    int dashIdx = strMLZ.Find(_T("-"));
    if (dashIdx >= 0) {
        strMLZ = strMLZ.Mid(dashIdx + 1);
    }

    // 2. 이미 스케일 보정이 완료된 파라미터들
    double pcd = m_partData->Dim.PCD_LA;
    double holeDepth = m_partData->Dim.TL_LG;

    if (pcd <= 0.0 || strMLZ.IsEmpty()) return S_OK;

    // [보정 적용] 하드코딩된 길이값이므로 / m_unit 처리
    if (holeDepth <= 0.0) holeDepth = 10.0 / m_unit;

    // 3. 기준 평면 생성 (조립면인 YZ 평면 기준, X=0)
    CiWorkPlane yzPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, 0.0);

    // 4. PCD 좌표 계산 (pcd는 이미 스케일링 되었으므로 여기서 추가 보정 안 함!)
    double radius = pcd / 2.0;
    double offset = radius * cos(45.0 * 3.14159265358979 / 180.0);

    // 5. 'M' 포함 여부로 분기 처리
    if (strMLZ.Find(_T("M")) >= 0)
    {
        // =====================================================================
        // [케이스 A] 탭(Tap) 가공
        // =====================================================================
        pPart->FeatureManager.SetHolePlane(yzPlane);

        // 스케일링이 끝난 offset을 그대로 사용
        pPart->FeatureManager.AddHolePoint(offset, offset);   // 1사분면
        pPart->FeatureManager.AddHolePoint(-offset, offset);  // 2사분면
        pPart->FeatureManager.AddHolePoint(-offset, -offset); // 3사분면
        pPart->FeatureManager.AddHolePoint(offset, -offset);  // 4사분면

        // strMLZ 원본 텍스트와 스케일링된 holeDepth 전달
        pPart->FeatureManager.CreateTap(strMLZ, holeDepth, CiDirectionOpEnum::Positive);
    }
    else
    {
        // =====================================================================
        // [케이스 B] 일반 관통 홀(Hole) 가공
        // =====================================================================
        double holeDia = _ttof(strMLZ);
        if (holeDia <= 0.0) return S_OK;

        // [보정 적용] 문자열에서 방금 추출한 순수 mm 숫자이므로 / m_unit 처리
        double cadRadius = (holeDia / m_unit) / 2.0;

        pPart->SketchManager.StartSketch(yzPlane);

        CiSketchPoint pts[4];
        // 스케일링이 끝난 offset을 그대로 사용
        pts[0] = pPart->SketchManager.SetSketchPoint(offset, offset);
        pts[1] = pPart->SketchManager.SetSketchPoint(-offset, offset);
        pts[2] = pPart->SketchManager.SetSketchPoint(-offset, -offset);
        pts[3] = pPart->SketchManager.SetSketchPoint(offset, -offset);

        for (int i = 0; i < 4; i++) {
            pPart->SketchManager.CreateSketchCircle(cadRadius, pts[i]);
        }

        pPart->SetSolidProfile();

        // 스케일링이 끝난 holeDepth를 그대로 사용
        pPart->FeatureManager.CreateExtrude(holeDepth, CiDirectionOpEnum::Negative, CiJoinOpEnum::Cut, 0, _T("Cut_MountingHole"));
    }

    return S_OK;
}

//=============================================================================
// 5. Rear cover
//=============================================================================

HRESULT MotorCreator::CreateRearCover(CiPart* pPart)
{
    double rearLen = m_partData->Dim.LR;
    double frameW  = m_partData->Dim.S;

    if (rearLen <= 0.0)
        return S_OK;
/*
    // Rear face is at X = 0 (negative direction from body start)
    CiWorkPlane rearPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ);
   // pPart->SketchManager.StartSketch(rearPlane);

    if (m_options.bodyType == MotorBodyType::Servo)
    {
        double rearDia = (m_partData->Dim.ES_MD > 0.0)
                          ? m_partData->Dim.ES_MD * 0.85
                          : frameW * 0.85;
        pPart->SketchManager.CreateSketchCircle(rearDia / 2.0, 0.0, 0.0);
    }
    else
    {
        // Slightly smaller than body
        double rw = frameW * 0.96;
        double rh = ((m_partData->Dim.S_h > 0.0) ? m_partData->Dim.S_h : frameW) * 0.96;
        pPart->SketchManager.CreateSketchRect(rw, rh);
    }

    pPart->SetSolidProfile();
  //  pPart->FeatureManager.CreateExtrude(rearLen, CiDirectionOpEnum::Negative, CiJoinOpEnum::Join);
*/
    return S_OK;
}

//=============================================================================
// 6. Encoder section
//=============================================================================

HRESULT MotorCreator::CreateEncoderSection(CiPart* pPart)
{
    double enH   = m_partData->Dim.EnH;  // encoder OD
    double enL   = m_partData->Dim.EnL;  // encoder length
    double rearL = m_partData->Dim.LR;

    if (enH <= 0.0 || enL <= 0.0)
        return S_OK;
/*
    // Encoder attached to rear cover back face
    double encPos = -(rearL);
    CiWorkPlane encPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, encPos);
  //  pPart->SketchManager.StartSketch(encPlane);

    pPart->SketchManager.CreateSketchCircle(enH / 2.0, 0.0, 0.0);

    pPart->SetSolidProfile();
  //  pPart->FeatureManager.CreateExtrude(enL, CiDirectionOpEnum::Negative, CiJoinOpEnum::Join);
*/
    return S_OK;
}

//=============================================================================
// 7. Gearhead section
//=============================================================================

HRESULT MotorCreator::CreateGearStage(CiPart* pPart,
    double stageLen, double stageDia, double flangDia, double flangThk, double startX)
{
    if (stageLen <= 0.0 || stageDia <= 0.0)
        return S_OK;
/*
    // Gear body
    CiWorkPlane bodyPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, startX);
    pPart->SketchManager.StartSketch(bodyPlane);
    pPart->SketchManager.CreateSketchCircle(stageDia / 2.0, 0.0, 0.0);
    pPart->SetSolidProfile();
    pPart->FeatureManager.CreateExtrude(stageLen, CiDirectionOpEnum::Positive, CiJoinOpEnum::Join);

    // Gear flange
    if (flangDia > 0.0 && flangThk > 0.0)
    {
        double flangStart = startX + stageLen;
        CiWorkPlane flangPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, flangStart);
        pPart->SketchManager.StartSketch(flangPlane);
        pPart->SketchManager.CreateSketchCircle(flangDia / 2.0, 0.0, 0.0);
        pPart->SetSolidProfile();
        pPart->FeatureManager.CreateExtrude(flangThk, CiDirectionOpEnum::Positive, CiJoinOpEnum::Join);
    }
    */
    return S_OK;
}

HRESULT MotorCreator::CreateGearheadSection(CiPart* pPart)
{
    double bodyLen  = m_partData->Dim.LM;
    double flangThk = m_partData->Dim.LE;
    double curX     = bodyLen + flangThk;

    if (m_partData->Dim.RL1 > 0.0) {
        // 감속기 1단 스케치 및 Extrude
    }
/*
    // Stage 1
    if (m_partData->Dim.RL1 > 0.0)
    {
        double dia1 = (m_partData->Dim.LB1 > 0.0) ? m_partData->Dim.LB1       : m_partData->Dim.LB * 0.90;
        double ld1  = (m_partData->Dim.LE1 > 0.0) ? m_partData->Dim.LB1       : 0.0;
        double lt1  = m_partData->Dim.LE1;
        CreateGearStage(pPart, m_partData->Dim.RL1, dia1, ld1, lt1, curX);
        curX += m_partData->Dim.RL1 + lt1;
    }

    // Stage 2
    if (m_partData->Dim.RL2 > 0.0)
    {
        double dia2 = (m_partData->Dim.LB2 > 0.0) ? m_partData->Dim.LB2 * 0.85 : m_partData->Dim.LB * 0.75;
        double ld2  = (m_partData->Dim.LE2 > 0.0) ? m_partData->Dim.LB2         : 0.0;
        double lt2  = m_partData->Dim.LE2;
        CreateGearStage(pPart, m_partData->Dim.RL2, dia2, ld2, lt2, curX);
        curX += m_partData->Dim.RL2 + lt2;
    }

    // Stage 3
    if (m_partData->Dim.RL3 > 0.0)
    {
        double dia3 = (m_partData->Dim.LB3 > 0.0) ? m_partData->Dim.LB3 * 0.80 : m_partData->Dim.LB * 0.65;
        double ld3  = (m_partData->Dim.LE3 > 0.0) ? m_partData->Dim.LB3         : 0.0;
        double lt3  = m_partData->Dim.LE3;
        CreateGearStage(pPart, m_partData->Dim.RL3, dia3, ld3, lt3, curX);
    }
*/
    return S_OK;
}

//=============================================================================
// 8. Brake section
//=============================================================================

HRESULT MotorCreator::CreateBrakeSection(CiPart* pPart)
{
    double brakeLen = m_partData->Dim.SL;
    double rearLen  = m_partData->Dim.LR;
    double frameW   = m_partData->Dim.S;

    if (brakeLen <= 0.0)
        return S_OK;
/*
    double brakePos = -(rearLen * 0.5);

    CiWorkPlane brakePlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ, brakePos);
 //   pPart->SketchManager.StartSketch(brakePlane);

    double brakeDia = (m_partData->Dim.ES_MD > 0.0)
                       ? m_partData->Dim.ES_MD * 0.90
                       : frameW * 0.90;

    pPart->SketchManager.CreateSketchCircle(brakeDia / 2.0, 0.0, 0.0);

    pPart->SetSolidProfile();
//    pPart->FeatureManager.CreateExtrude(brakeLen, CiDirectionOpEnum::Negative, CiJoinOpEnum::Join);
*/
    return S_OK;
}

//=============================================================================
// 9. Connector box
//=============================================================================

HRESULT MotorCreator::CreateConnector(CiPart* pPart)  // Connector Box
{
    double connW   = m_partData->Dim.CW_MW;   // connector width
    double connLen = m_partData->Dim.CL_ML;   // connector length
    double connH   = m_partData->Dim.CH_MH;   // connector height (protrusion)
    double connOff = m_partData->Dim.CS;      // side offset from body edge
    double frameW  = m_partData->Dim.S;
    double bodyLen = m_partData->Dim.LM;

    if (connW <= 0.0 || connH <= 0.0)
        return S_OK;

    if (connLen <= 0.0)
        connLen = bodyLen * 0.30;

    // Connector protrudes from the side face (XY plane, offset by half-frame + CS)
    double sideOffset = (frameW / 2.0) + (connOff > 0.0 ? connOff : 0.0);

    CiWorkPlane connPlane = pPart->WGManager.CreateWorkPlane(CiBasePlaneEnum::XY, sideOffset);
    //pPart->SketchManager.StartSketch(connPlane);

    // Center the rectangle at (bodyLen*0.5, 0) in the XY plane
    double cx = bodyLen * 0.35 + connLen * 0.5;
    double cy = 0.0;
    pPart->SketchManager.CreateSketchRect(connLen, connW, CiPoint(cx, cy, 0.0), true);

    pPart->SetSolidProfile();
    //pPart->FeatureManager.CreateExtrude(connH, CiDirectionOpEnum::Positive, CiJoinOpEnum::Join);

    return S_OK;
}

//=============================================================================
// 10. Material
//=============================================================================

void MotorCreator::ApplyMaterial(CiPart* pPart)
{
    /*
    // Default motor frame material
    const wchar_t* matName = L"Aluminum 6061";

    ATL::CString strMat = _T("");
    strMat.Format(_T("%s"), m_partData->Info.PartName);
    std::wstring matKey(strMat.GetString());

    auto it = g_MotorMaterialMap.find(matKey);
    if (it != g_MotorMaterialMap.end())
        matName = it->second;

    pPart->SetMaterial(matName);*/
}

//=============================================================================
// Helpers
//=============================================================================

ATL::CString MotorCreator::FormatDouble(double value)
{
    ATL::CString str;
    str.Format(_T("%.10f"), value);
    str.TrimRight(_T('0'));
    str.TrimRight(_T('.'));
    return str;
}

ATL::CString MotorCreator::BuildPartCode()
{
    ATL::CString model = _T("");
    model.Format(_T("%s"), m_partData->Info.Motor_Model);

    ATL::CString size = _T("");
    size.Format(_T("%s"), m_partData->Info.Motor_Size);

    ATL::CString partCode = _T("");
    if (model.IsEmpty())
        partCode.Format(_T("%s"), m_partData->Info.PartCode);
    else if (size.IsEmpty())
        partCode = model;
    else
        partCode.Format(_T("%s [%s]"), model, size);

    return partCode;
}

//=============================================================================
// 공통: 파트 피처에 재질 및 색상 적용
//=============================================================================
void MotorCreator::ApplyBodyMaterial(CiPart* pPart, CiFeature& feature, ATL::CString engName, ATL::CString korName)
{
    if (!feature.isValid()) return;
    try {
#if defined(SDWORKS)
        // ── 1. 재질명 → RGB 색상 매핑 ─────────────────────────────
        double r = 0.75, g = 0.75, b = 0.75;   // 기본: 밝은 회색

        ATL::CString styleName = engName;
        if (styleName.IsEmpty()) styleName = korName;
        styleName.MakeLower();

        if (styleName.Find(_T("steel")) >= 0 || styleName.Find(_T("stainless")) >= 0) {
            r = 0.75; g = 0.75; b = 0.78;
        }
        else if (styleName.Find(_T("aluminum")) >= 0 || styleName.Find(_T("aluminium")) >= 0) {
            r = 0.83; g = 0.83; b = 0.83;
        }
        else if (styleName.Find(_T("brass")) >= 0) { r = 0.85; g = 0.75; b = 0.30; }
        else if (styleName.Find(_T("copper")) >= 0) { r = 0.72; g = 0.45; b = 0.20; }
        else if (styleName.Find(_T("cast iron")) >= 0) { r = 0.30; g = 0.30; b = 0.30; }
        else if (styleName.Find(_T("black")) >= 0) { r = 0.10; g = 0.10; b = 0.10; }
        else if (styleName.Find(_T("red")) >= 0) { r = 0.80; g = 0.10; b = 0.10; }
        else if (styleName.Find(_T("blue")) >= 0) { r = 0.10; g = 0.30; b = 0.80; }
        else if (styleName.Find(_T("yellow")) >= 0) { r = 0.95; g = 0.85; b = 0.10; }
        else if (styleName.Find(_T("green")) >= 0) { r = 0.10; g = 0.65; b = 0.20; }
        else if (styleName.Find(_T("rubber")) >= 0) { r = 0.18; g = 0.18; b = 0.18; }
        else if (styleName.Find(_T("plastic")) >= 0) { r = 0.60; g = 0.60; b = 0.65; }

        // ── 2. VARIANT 배열 구성 (9개 double) ──────────────────────
        double props[9] = {
            r,   g,   b,
            0.5, 0.8, 0.5,
            0.5, 0.0, 0.0
        };

        SAFEARRAY* psa = SafeArrayCreateVector(VT_R8, 0, 9);
        for (long i = 0; i < 9; ++i)
            SafeArrayPutElement(psa, &i, &props[i]);

        VARIANT vProps;
        VariantInit(&vProps);
        vProps.vt = VT_ARRAY | VT_R8;
        vProps.parray = psa;

        // ── 3. IFeature::SetMaterialPropertyValues 직접 호출 ───────
        VARIANT_BOOL bOk = VARIANT_FALSE;
        feature.Get()->SetMaterialPropertyValues(vProps, &bOk);

        // ── 4. 화면 갱신 ────────────────────────────────────────────
        if (bOk == VARIANT_TRUE)
            pPart->GetDoc()->GraphicsRedraw2();

        // ── 5. 리소스 정리 ──────────────────────────────────────────
        VariantClear(&vProps);   // psa 내부 포함 해제
#elif defined(ZW3D)
        // ── 1. 재질명 → RGB 색상 결정 ─────────────────────────────
        ATL::CString styleName = engName;
        if (styleName.IsEmpty()) styleName = korName;
        styleName.MakeLower();

        svxColor col;
        col.r = 190;  col.g = 190;  col.b = 190;   // 기본: 회색

        if (styleName.Find(_T("steel")) >= 0 || styleName.Find(_T("stainless")) >= 0) {
            col.r = 190; col.g = 192; col.b = 198;
        }
        else if (styleName.Find(_T("aluminum")) >= 0 || styleName.Find(_T("aluminium")) >= 0) {
            col.r = 212; col.g = 212; col.b = 212;
        }
        else if (styleName.Find(_T("brass")) >= 0) { col.r = 217; col.g = 191; col.b = 76; }
        else if (styleName.Find(_T("copper")) >= 0) { col.r = 184; col.g = 115; col.b = 51; }
        else if (styleName.Find(_T("cast iron")) >= 0) { col.r = 77;  col.g = 77;  col.b = 77; }
        else if (styleName.Find(_T("black")) >= 0) { col.r = 26;  col.g = 26;  col.b = 26; }
        else if (styleName.Find(_T("red")) >= 0) { col.r = 204; col.g = 26;  col.b = 26; }
        else if (styleName.Find(_T("blue")) >= 0) { col.r = 26;  col.g = 77;  col.b = 204; }
        else if (styleName.Find(_T("yellow")) >= 0) { col.r = 242; col.g = 217; col.b = 26; }
        else if (styleName.Find(_T("green")) >= 0) { col.r = 26;  col.g = 166; col.b = 51; }
        else if (styleName.Find(_T("rubber")) >= 0) { col.r = 46;  col.g = 46;  col.b = 46; }
        else if (styleName.Find(_T("plastic")) >= 0) { col.r = 153; col.g = 153; col.b = 166; }

        int iStartOp = cvxOpCount();
        int  iShapeCnt = 0;
        int* pShapeList = NULL;

        evxErrors eRet = cvxPartInqShapes(NULL, NULL, &iShapeCnt, &pShapeList);

        if (eRet == ZW_API_NO_ERROR && iShapeCnt > 0 && pShapeList != NULL)
        {
            int iFeatHandle = feature.Get();
            int iTargetShape = -1;

            for (int i = 0; i < iShapeCnt; ++i)
            {
                int  iFtrCnt = 0;
                int* pFtrList = NULL;

                if (cvxPartInqShapeFtrs(pShapeList[i], 1, &iFtrCnt, &pFtrList) == ZW_API_NO_ERROR)
                {
                    for (int j = 0; j < iFtrCnt; ++j)
                    {
                        if (pFtrList[j] == iFeatHandle)
                        {
                            iTargetShape = pShapeList[i];
                            break;
                        }
                    }
                    cvxMemFree((void**)&pFtrList);
                }
                if (iTargetShape >= 0) break;
            }

            if (iTargetShape < 0 && iShapeCnt > 0)
                iTargetShape = pShapeList[0];

            if (iTargetShape >= 0)
            {
                int iEntList[1] = { iTargetShape };
                cvxEntRgbSet(col, 1, iEntList);
            }
            cvxMemFree((void**)&pShapeList);
        }
#else
        acInv::SurfaceBodiesPtr pBodies;
        feature.Get()->get_SurfaceBodies(&pBodies);
        if (pBodies != NULL && pBodies->GetCount() > 0) {
            acInv::SurfaceBodyPtr pBody = pBodies->GetItem(1);
            acInv::RenderStylesPtr pRenderStyles;
            pPart->GetPartDoc()->get_RenderStyles(&pRenderStyles);
            acInv::RenderStylePtr pStyle;

            HRESULT hr = pRenderStyles->get_Item(_variant_t(_bstr_t((LPCTSTR)engName)), &pStyle);
            if (FAILED(hr) || pStyle == NULL) {
                hr = pRenderStyles->get_Item(_variant_t(_bstr_t((LPCTSTR)korName)), &pStyle);
            }

            if (SUCCEEDED(hr) && pStyle != NULL) {
                pBody->SetRenderStyle(acInv::kOverrideRenderStyle, _variant_t((IDispatch*)pStyle), VARIANT_FALSE);
            }
        }
#endif
    }
    catch (...) {}
}

//=============================================================================
// [디버그용] 파트 문서에 사용 가능한 전체 재질 목록 출력 (호환성 버전)
// - AssetLibrary 대신 전통적인 Materials 객체 사용
//=============================================================================
void MotorCreator::PrintDocumentMaterials(CiPart* pPart)
{
    // 파트 포인터 및 문서 유효성 검사
    if (!pPart || pPart->GetPartDoc() == NULL) return;

    acInv::PartDocumentPtr pDoc = pPart->GetPartDoc();

    // 최신 MaterialAssets 대신 구버전부터 지원하는 Materials 속성 접근
    acInv::MaterialsPtr pMaterials = pDoc->Materials;
    if (pMaterials == NULL)
    {
        ATLTRACE(_T("재질 컬렉션을 찾을 수 없습니다.\n"));
        return;
    }

    long count = pMaterials->Count;

    ATLTRACE(_T("\n======================================================\n"));
    ATLTRACE(_T("▶ 현재 문서에서 사용 가능한 재질 목록 (총 %d개) \n"), count);
    ATLTRACE(_T("======================================================\n"));

    // 인벤터의 COM 컬렉션 인덱스는 1부터 시작합니다.
    for (long i = 1; i <= count; ++i)
    {
        acInv::MaterialPtr pMat = pMaterials->Item[i];

        // 재질 이름 가져오기
        ATL::CString matName = (LPCTSTR)pMat->Name;

        ATLTRACE(_T("[%03d] %s\n"), i, matName.GetString());
    }
    ATLTRACE(_T("======================================================\n\n"));
}

//=============================================================================
// 헬퍼 함수: 특정 피처가 생성한 바디에만 Cut을 적용하도록 참여 바디 재설정
// [인자] cutFeat: Cut을 수행할 피처 / baseFeat: 뚫림을 당할 대상 바디를 만든 피처
//=============================================================================
HRESULT MotorCreator::ApplyAffectedBodyToFeature(CiPart* pPart, CiFeature cutFeat, CiFeature baseFeat)
{
    // Cut 피처 포인터 획득
    acInv::ExtrudeFeaturePtr pCutExtFeat = cutFeat.Get();
    if (pCutExtFeat == nullptr) return E_FAIL;

    acInv::PartDocumentPtr pDoc = pPart->GetPartDoc();
    acInv::ApplicationPtr pApp = pDoc->Parent; // 또는 GetParent()
    acInv::TransientObjectsPtr pTransObjs = pApp->TransientObjects;

    // 초기화 인자 생략을 위한 빈 VARIANT
    VARIANT vtMissing;
    ::VariantInit(&vtMissing);
    vtMissing.vt = VT_ERROR;
    vtMissing.scode = DISP_E_PARAMNOTFOUND;

    acInv::ObjectCollection* pRawCollection = nullptr;
    HRESULT hr = pTransObjs->CreateObjectCollection(vtMissing, &pRawCollection);

    if (SUCCEEDED(hr) && pRawCollection != nullptr)
    {
        acInv::ObjectCollectionPtr pAffectedBodies;
        pAffectedBodies.Attach(pRawCollection); // 메모리 누수 방지

        // ★ [핵심] baseFeat가 만들어낸 실제 바디(솔리드1 등)를 직접 가져옴
        acInv::SurfaceBodiesPtr pTargetBodies;

        // 회원님 래퍼 환경에 맞춰 get_SurfaceBodies 호출
        baseFeat.Get()->get_SurfaceBodies(&pTargetBodies);
        // (만약 위 코드가 안 되면 pTargetBodies = baseFeat.Get()->SurfaceBodies; 로 시도)

        if (pTargetBodies != nullptr)
        {
            long bodyCount = 0;
            pTargetBodies->get_Count(&bodyCount); // 또는 bodyCount = pTargetBodies->Count;

            // baseFeat로 인해 생성된 모든 바디를 타겟으로 추가 (보통 1개)
            for (long i = 1; i <= bodyCount; ++i)
            {
                acInv::SurfaceBodyPtr pBody;
                pTargetBodies->get_Item(i, &pBody); // 또는 pBody = pTargetBodies->Item[i];

                // 이름이 "솔리드X"든 상관없이 객체 자체의 주소값을 컬렉션에 추가
                pAffectedBodies->MethodAdd(pBody);
            }
        }

        // 컷 피처에 타겟 바디 덮어쓰기
        pCutExtFeat->SetAffectedBodies(pAffectedBodies);
    }

    return S_OK;
}