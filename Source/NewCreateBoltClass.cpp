#include "stdafx.h"
#include "NewCreateBoltClass.h"
#include <memory>
#include <unordered_map>

#if defined(SDWORKS)
sdWrk::IComponent2Ptr BoltCreator::CreateBolt(std::map<std::string, std::string>& pDim, BoltPartData& pd, double munit, const BoltOptions& options)
#elif defined(ZW3D)
CiDragComponent BoltCreator::CreateBolt(std::map<std::string, std::string>& pDim, BoltPartData& pd, double munit, const BoltOptions& options)
#else
acInv::ComponentDefinitionPtr BoltCreator::CreateBolt(std::map<std::string, std::string>& pDim, BoltPartData& pd, double munit, const BoltOptions& options)
#endif

{     
    if (munit == 0.1)
        m_unit = 10.;
    else if (munit == 0.01)
        m_unit = 100.;
    else
        m_unit = munit;
        
    m_partData = &pd;
    m_options = options;

    int itype = 0;

    //----- Head----------//
    SetHeadType();
    //---------------------//

    //-----------------//
    SetHeadTypeOption();
    //--------------------//
    //----- 볼트 끝단 ----------//
    SetBoltOption();
    //----------------//

    //---- 자리붙이 flag set -----//
    ATL::CString strHeadType = _T("");
    strHeadType.Format(_T("%s"), m_partData->Info.HeadType);
    m_options.hasFlange = false;
    if ((strHeadType.Trim().Find(_T("자리붙이")) >= 0))
    {
        m_options.hasFlange = true;  // 추후 사용시에는 해당 변수 사용 하면 된다.   
    }
    //--------------//

    // 1. 초기화
    //if (FAILED(Initialize(pDim)))
    //    return nullptr;
    ATL::CString partCode = _T("");
    ATL::CString strScrewType = _T("");
    strScrewType.Format(_T("%s"), m_partData->Info.ScrewType);
     
    m_ScreTypeValue = m_partData->Dim.P1_UNC;  

    if (strScrewType.Trim() == _T("가는나사"))
    {
        m_ScreTypeValue = m_partData->Dim.P2_UNF;
    }
    // 기존 값이 0.1 또는 0.01이 곱해졌을 경우 (m_ScreTypeValue * m_unit)
    partCode.Format(_T("M%sX%s-%sL"), FormatDouble((m_partData->Dim.M*m_unit)), FormatDouble(m_ScreTypeValue * m_unit), FormatDouble((m_partData->Dim.Length* m_unit)));

    ATL::CString createPartName;
    createPartName.Format(_T("%s_%s"), partCode, m_partData->Info.Material);

    CiDocument::InitApplication(m_pApplication);
    CiAssembly NewComponent = CiDocument::GetDocumentEdit().CreateAssembly(partCode);

    CiPart m_IFC = NewComponent.CreatePart(partCode);

    // 2. 나사부 몸통 생성 (공통)
    CreateBoltShank(&m_IFC);
    
    // 3. 머리 형상 생성 (타입별 분기)
    CreateBoltHead(&m_IFC);

    // 4. 추가 피처 (옵션별)
    CreateOptionalFeatures(&m_IFC);

    // 5. 나사산 생성 (공통)
    CreateThread(pDim, &m_IFC);
        
    // 6. 재질 적용 (공통)
    ApplyMaterial(&m_IFC);


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

        m_IFC.WritePartBomInfo(bomPartName, bomMaterial, bomSpec, bomStandard);
        NewComponent.WritePartBomInfo(bomPartName, bomMaterial, bomSpec, bomStandard);  // ★ 추가
    }

    CiOccurrence pOcc = NewComponent.Insert(m_IFC);
#ifdef ZW3D
    // Insert 후 어셈블리가 활성 문서 → 이 시점에 속성 기록
    NewComponent.FlushBomInfo();
#endif
    return NewComponent.GetDragDef(); //m_IFC->GetPartComponent();
}
//=========================================================================
// 1. 초기화 (공통)
//=========================================================================

HRESULT BoltCreator::Initialize(std::map<std::string, std::string>& pDim)
{
    //ATL::CString partCode = _T("");
    //partCode.Format(_T("%s_%s_%s"), m_partData->Info.PartCode, m_partData->Info.Standard, m_partData->Info.Size);

    //ATL::CString createPartName;
    //createPartName.Format(_T("%s_%s"), partCode, m_partData->Info.Material);

    //CiDocument::InitApplication(m_pApplication);
    //CiAssembly NewComponent = CiDocument::GetDocumentEdit().CreateAssembly(partCode);

    //m_IFC = NewComponent.CreatePart(partCode);
    /*m_IFC->InitializeCreatePart(_T("mm"), createPartName);
    m_IFC = std::make_unique<CinvFeaCrt>(m_pApplication);
    m_IFC->InitializeCreatePart(_T("mm"), createPartName)*/

    //ATL::CString partNo;
    //partNo.Format(_T("%s_%s"), m_partData->Info.Standard, partCode);
    //m_IFC.->SetBomPartNo(partNo);
    //m_IFC->SetBomPartDesc(m_partData->Info.PartName);

    return S_OK;
}

//=========================================================================
// 2. 나사부 몸통 생성 (공통)
//=========================================================================

HRESULT BoltCreator::CreateBoltShank(CiPart* m_IFC)
{
    double z = m_partData->Dim.z;
    if (z == 0.0)
        z = m_ScreTypeValue;// m_partData->Dim.P1_UNC;

    //m_IFC->CreateSkecthPlanWorkPlanBase(CinvFeaCrt::kYZ);
    CiWorkPlane yzPlane = m_IFC->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ); //XZ 평면 생성
    m_IFC->SketchManager.StartSketch(yzPlane); //이 평면에 스케치 시작

    //acInv::SketchLinePtr axisLine;
    
    if (m_options.endType == BoltEndType::Rounded)
    {
        CiSketchLine axisLine = CreateRoundedEndProfile(z, m_IFC);
        m_IFC->SetSolidProfile();
        CiRevolveFeature rLine = m_IFC->FeatureManager.CreateRevolve(axisLine);
    }
    else if (m_options.endType == BoltEndType::Chamfered)
    {
        CiSketchLine axisLine = CreateChamferedEndProfile(z, m_IFC);
        m_IFC->SetSolidProfile();
        CiRevolveFeature rLine = m_IFC->FeatureManager.CreateRevolve(axisLine);
    }
    else if (m_options.endType == BoltEndType::Flat)
    {
        CiSketchLine axisLine = CreateFlatEndProfile(z, m_IFC);
        m_IFC->SetSolidProfile();
        CiRevolveFeature rLine = m_IFC->FeatureManager.CreateRevolve(axisLine);
    }
    else if (m_options.endType == BoltEndType::Concave)
    {
        CiSketchLine axisLine = CreateConcavePointProfile(z, m_IFC);
        m_IFC->SetSolidProfile();
        CiRevolveFeature rLine = m_IFC->FeatureManager.CreateRevolve(axisLine);
    }
    else if (m_options.endType == BoltEndType::Rough)
    {
        CiSketchLine axisLine = CreateRoughEndProfile(m_IFC);
        m_IFC->SetSolidProfile();
        CiRevolveFeature rLine = m_IFC->FeatureManager.CreateRevolve(axisLine);
    }
    else if (m_options.endType == BoltEndType::Pointed)
    {
        CiSketchLine axisLine = CreatePointedEndProfile(z, m_IFC);
        m_IFC->SetSolidProfile();
        CiRevolveFeature rLine = m_IFC->FeatureManager.CreateRevolve(axisLine);
    }
    else if (m_options.endType == BoltEndType::Rod)
    {
        CiSketchLine axisLine = CreateRodEndProfile(z, m_IFC);
        m_IFC->SetSolidProfile();
        CiRevolveFeature rLine = m_IFC->FeatureManager.CreateRevolve(axisLine);
    }
    else if (m_options.endType == BoltEndType::HalfRod)
    {
        CiSketchLine axisLine = CreateHalfRodEndProfile(z, m_IFC);
        m_IFC->SetSolidProfile();
        CiRevolveFeature rLine = m_IFC->FeatureManager.CreateRevolve(axisLine);
    }

    return S_OK;
}

//=========================================================================
// 3. 머리 형상 생성 (타입별 분기)
//=========================================================================

HRESULT BoltCreator::CreateBoltHead(CiPart* m_IFC)
{
    // 스터드볼트는 머리가 없음
    if (m_options.headType == BoltHeadType::Stud)
        return S_OK;

    switch (m_options.headType)
    {
    case BoltHeadType::Hex: // 육각머리
        return CreateHexHead(m_IFC);

    case BoltHeadType::Socket:  //  육각구멍붙이
        return CreateSocketHead(m_IFC);

    case BoltHeadType::Button:  //렌치볼트  
        return CreateButtonHead(m_IFC);

    case BoltHeadType::Countersunk:  //접시머리 
        return CreateCountersunkHead(m_IFC);

    case BoltHeadType::HexFlange: // 플팬지붙이
        return CreateHexFlangeHead(m_IFC);

    case BoltHeadType::Pan:
        return CreatePanHead(m_IFC);

    case BoltHeadType::Round:
        return CreateRoundHead(m_IFC);

    case BoltHeadType::UBolt: // U볼트
        return CreateUHead(m_IFC);

    case BoltHeadType::TSlot:  // T홈볼트
        return CreateTSlotHead(m_IFC);

    case BoltHeadType::Eye: // 아이볼트
        return CreateEyeHead(m_IFC);

    case BoltHeadType::Wing:  // 나비볼트
        return CreateWingHead(m_IFC);

    case BoltHeadType::Square: // 사각볼트
        return CreateSqHead(m_IFC);

    case BoltHeadType::Found: // 기초볼트
        return CreateFdHead(m_IFC);

    case BoltHeadType::Hinge: // 힌지볼트
        return CreateHgHead(m_IFC);

    case BoltHeadType::Knock: // 노크볼트
        return CreateKnHead(m_IFC);

    case BoltHeadType::Should: // 숄더볼트
        return CreateSdHead(m_IFC);

    case BoltHeadType::Turnb: // 턴버클
        return CreateTbHead(m_IFC);

    case BoltHeadType::Anchor: // 앙카볼트
        return CreateAcHead(m_IFC);

    case BoltHeadType::Sems: // 샘스볼트
        return CreateSmHead(m_IFC);

    case BoltHeadType::Piping: // 관용볼트
        return CreatePuHead(m_IFC);

    default:
        return CreateHexHead(m_IFC);  // 기본값
    }
}

//-------------------------------------------------------------------------
// 3-1. 육각머리
//-------------------------------------------------------------------------
HRESULT BoltCreator::CreateHexHead(CiPart* m_IFC)
{
    using namespace BoltConstants;

    const double WidthB = m_options.headTypeOption == SpecHeadTypeOption::StandardNormal ? m_partData->Dim.B1 : m_partData->Dim.B2;
    const double WidthC = m_options.headTypeOption == SpecHeadTypeOption::StandardNormal ? m_partData->Dim.C1 : m_partData->Dim.C2;

    const double chamferHeight =
        ((WidthC - WidthB) / 2.0) *
        tan(atan(1.0) / CHAMFER_30_DEG_FACTOR);

    // 육각형 스케치 및 돌출
    //m_IFC->CreateSkecthPlanWorkPlanBase(CinvFeaCrt::kXZ);
    CiWorkPlane xzPlane = m_IFC->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ); //XZ 평면 생성
    m_IFC->SketchManager.StartSketch(xzPlane); //이 평면에 스케치 시작

    //acInv::Point2dPtr center = m_IFC->GetPoint2d(0, 0);
    //acInv::Point2dPtr rigCenter = m_IFC->GetPoint2d(0, m_partData->Dim.C1 / 2.0);
    //m_IFC->AddSketchAsPolygon2d(6, center, rigCenter, true);
    CiSketchPoint pCenter = m_IFC->SketchManager.SetSketchPoint(0, 0);
    CiSketchPoint rigCenter = m_IFC->SketchManager.SetSketchPoint(0, WidthC / 2.0);
    m_IFC->SketchManager.CreateSketchPolygon(6, pCenter, rigCenter, true);
 
    //m_IFC->CreateExtrudeFeature(m_partData->Dim.H, -1);
   m_IFC->SetSolidProfile(); //스케치로부터 피쳐에 적용할 프로필을 추출
    CiExtrudeFeature pPip =m_IFC->FeatureManager.CreateExtrude(m_partData->Dim.H, CiDirectionOpEnum::Negative); //돌출

    // 30° 챔퍼 컷팅
    //m_IFC->CreateSkecthPlanWorkPlanBase(CinvFeaCrt::kYZ);
    CiWorkPlane yzPlane =m_IFC->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ); //XZ 평면 생성
   m_IFC->SketchManager.StartSketch(yzPlane); //이 평면에 스케치 시작

    //SketchPointAr pts(3);
    //pts[0] = m_IFC->SetSketchPoint2d(-m_partData->Dim.H, m_partData->Dim.B1 * 0.5);
    //pts[1] = m_IFC->SetSketchPoint2d(-(m_partData->Dim.H - chamferHeight), m_partData->Dim.C1 * 0.5);
    //pts[2] = m_IFC->SetSketchPoint2d(-m_partData->Dim.H, m_partData->Dim.C1 * 0.5);
    CiSketchPoint pts[3];
    pts[0] =m_IFC->SketchManager.SetSketchPoint(-m_partData->Dim.H, WidthB * 0.5);        //1
    pts[1] =m_IFC->SketchManager.SetSketchPoint(-(m_partData->Dim.H - chamferHeight), WidthC * 0.5); //2
    pts[2] =m_IFC->SketchManager.SetSketchPoint(-m_partData->Dim.H, WidthC * 0.5);

 /* m_IFC->SetSketchLine2d(pts[0], pts[1]);
    m_IFC->SetSketchLine2d(pts[1], pts[2]);
    m_IFC->SetSketchLine2d(pts[2], pts[0]);*/
   m_IFC->SketchManager.CreateSketchLine(pts[0], pts[1]);
   m_IFC->SketchManager.CreateSketchLine(pts[1], pts[2]);
   m_IFC->SketchManager.CreateSketchLine(pts[2], pts[0]);

    //m_IFC->CreateRevolveFeature(m_IFC->GetWorkAxis(2), true);
   m_IFC->SetSolidProfile();
   CiWorkAxis oAxis2Line =m_IFC->WGManager.GetBaseAxis(CiBaseDirectionEnum::Y);
   CiRevolveFeature ferralSCcut =m_IFC->FeatureManager.CreateRevolve(oAxis2Line, CiJoinOpEnum::Cut);

    // 자리붙이 추가
   if (m_options.hasFlange==true)
   {
       CiWorkPlane xzPlane = m_IFC->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ); //XZ 평면 생성
       m_IFC->SketchManager.StartSketch(xzPlane); //이 평면에 스케치 시작

       CiSketchPoint pCenter1 = m_IFC->SketchManager.SetSketchPoint(0, 0);
       CiSketchPoint rigCenter1 = m_IFC->SketchManager.SetSketchPoint(0, WidthC / 2.0);
       m_IFC->SketchManager.CreateSketchPolygon(6, pCenter1, rigCenter1, true);

       m_IFC->SetSolidProfile(); //스케치로부터 피쳐에 적용할 프로필을 추출
       CiExtrudeFeature pPip1 = m_IFC->FeatureManager.CreateExtrude(m_partData->Dim.hh, CiDirectionOpEnum::Negative, CiJoinOpEnum::Cut);  // Positive

       m_IFC->SketchManager.StartSketch(xzPlane); //이 평면에 스케치 시작
       CiSketchPoint pCenter2 = m_IFC->SketchManager.SetSketchPoint(0, 0);
       m_IFC->SketchManager.CreateSketchCircle(m_partData->Dim.S * 0.5, pCenter2);

       m_IFC->SetSolidProfile(); //스케치로부터 피쳐에 적용할 프로필을 추출
       CiExtrudeFeature pFlang = m_IFC->FeatureManager.CreateExtrude(m_partData->Dim.hh, CiDirectionOpEnum::Negative); //돌출   
   }

    return S_OK;
}

//-------------------------------------------------------------------------
// 3-2. 소켓헤드 (육각구멍볼트)
//-------------------------------------------------------------------------
HRESULT BoltCreator::CreateSocketHead(CiPart* m_IFC)
{
    using namespace BoltConstants;

    const double Height_H = m_options.headTypeOption == SpecHeadTypeOption::Normal ? m_partData->Dim.H : m_partData->Dim.H1;
    // 원통형 머리 생성
    //m_IFC->CreateSkecthPlanWorkPlanBase(CinvFeaCrt::kXZ);
    CiWorkPlane xzPlane = m_IFC->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ); //XZ 평면 생성
    m_IFC->SketchManager.StartSketch(xzPlane); //이 평면에 스케치 시작

    //acInv::Point2dPtr center = m_IFC->GetPoint2d(0, 0);
    CiSketchPoint center = m_IFC->SketchManager.SetSketchPoint(0, 0);

    // 머리 외경 (D = 약 1.5 * M)
    const double headDia = m_partData->Dim.M*1.5;  // 또는 계산값 사용
    //m_IFC->SetSketchCircle2d(center, headDia / 2.0);
    m_IFC->SketchManager.CreateSketchCircle(headDia/2.0, center);

    //m_IFC->CreateExtrudeFeature(m_partData->Dim.H, -1);
    m_IFC->SetSolidProfile(); //스케치로부터 피쳐에 적용할 프로필을 추출
    CiExtrudeFeature pPip = m_IFC->FeatureManager.CreateExtrude(Height_H, CiDirectionOpEnum::Negative); //돌출   

    //acInv::EdgePtr  oEdgeHead = m_IFC->SelectByRayEdge(0, -m_partData->Dim.H, m_partData->Dim.S * 0.8, 0, 0, -1, 0.001);
    CiPoint cepos(0, -Height_H, m_partData->Dim.S * 0.8);
    CiVector cedir(0, 0, -1);
    CiEdge  oEdgeHead = m_IFC->SelectByRayEdge(cepos, cedir);// , 0.001);

    //chamfer
    //m_IFC-> AddEdgeCollection(oEdgeHead, false);
    //m_IFC->CreateChamferFeatureDist(m_IFC->GetEdgeCollection(), m_partData->Dim.V1);

    CiEdgeCollection filletColl1;
    filletColl1.Add(oEdgeHead);
    CiFeature fillet1 = m_IFC->FeatureManager.CreateFillet(filletColl1, m_partData->Dim.V1);

    //육각홈 plane
   // acInv::FacePtr  oEndFace = m_IFC->SelectByRayFace(0, -m_partData->Dim.H * 2., 0, 0, 1, 0, 0.001);
    CiPoint cfpos(0, -Height_H * 2., 0); //(X,Y,Z)
    CiVector cfdir(0, 1, 0);
    CiFace  oEndFace = m_IFC->SelectByRayFace(cfpos, cfdir);

    //m_IFC->CreateSkecthPlanFaceBase(oEndFace);
    //oEndFace.GetNormal();
    //oEndFace.GetCenter();
    CiWorkPlane endFacePlane = m_IFC->WGManager.CreateWorkPlane(oEndFace);
    m_IFC->SketchManager.StartSketch(endFacePlane);

    //acInv::SketchPointPtr oCenter1 = m_IFC->SetSketchPoint2d(0, 0);
    //CiSketchPoint oCenter1 = m_IFC->SketchManager.SetSketchPoint(0,0);        //1

    // 소켓 깊이
    const double socketDepth = Height_H * SOCKET_DEPTH_RATIO;
    //m_IFC->CreateHoleFeatureDepth(m_partData->Dim.B1, socketDepth);   // p_socDpT
    m_IFC->FeatureManager.SetHolePlane(endFacePlane);
    m_IFC->FeatureManager.AddHolePoint(0,0);
    m_IFC->FeatureManager.CreateHoleDepth(m_partData->Dim.B1, socketDepth);   // p_socDpT

    //육각홈		
    //m_IFC->CreateSkecthPlanFaceBase(oEndFace);
    m_IFC->SketchManager.StartSketch(endFacePlane);

    //acInv::Point2dPtr oCenter2 = m_IFC->GetPoint2d(0, 0);
    CiSketchPoint oCenter2 = m_IFC->SketchManager.SetSketchPoint(0,0);

    // 소켓 크기 (S = 렌치 사이즈)
    //acInv::Point2dPtr socketVertex = m_IFC->GetPoint2d(m_partData->Dim.B1 * 0.5, 0); 
    CiSketchPoint socketVertex = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.B1 * 0.5, 0);

    //m_IFC->AddSketchAsPolygon2d(6, oCenter2, socketVertex, false);
    m_IFC->SketchManager.CreateSketchPolygon(6, oCenter2, socketVertex, false);
        
    //m_IFC->CreateExtrudeFeature(socketDepth, -1, true);  // 컷 모드
    m_IFC->SetSolidProfile(); //스케치로부터 피쳐에 적용할 프로필을 추출
    CiExtrudeFeature oCPip = m_IFC->FeatureManager.CreateExtrude(socketDepth, CiDirectionOpEnum::Negative, CiJoinOpEnum::Cut);

    return S_OK;
}

HRESULT BoltCreator::CreateStudBolt(CiPart* m_IFC)
{
    using namespace BoltConstants;

    // 스터드볼트에 필요한 치수 가져오기 (실제 변수명에 맞게 수정 필요)
    double diameter = m_partData->Dim.D;    // 볼트 직경
    double totalLength = m_partData->Dim.H; // 볼트 전체 길이 (또는 H)

    double radius = diameter / 2.0;

    // ==========================================
    // [선택 사항] 스윕(Sweep)을 위한 경로(Path) 스케치 - YZ 평면
    // 💡 돌출(Extrude) API를 사용하실 거라면 이 단계는 아예 삭제하셔도 됩니다.
    // ==========================================
    CiWorkPlane yzPlane = m_IFC->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ);
    m_IFC->SketchManager.StartSketch(yzPlane);

    // Z축(또는 Y축) 방향으로 일직선을 그립니다. (여기서는 Y축 방향 상승으로 가정)
    CiSketchPoint pathStart = m_IFC->SketchManager.SetSketchPoint(0, 0);
    CiSketchPoint pathEnd = m_IFC->SketchManager.SetSketchPoint(0, totalLength);

    m_IFC->SketchManager.CreateSketchLine(pathStart, pathEnd);


    // ==========================================
    // [필수 단계] 단면(Profile) 스케치 - XY 평면
    // ==========================================
    CiWorkPlane xyPlane = m_IFC->WGManager.CreateWorkPlane(CiBasePlaneEnum::XY);
    m_IFC->SketchManager.StartSketch(xyPlane);

    // 원점(0,0)을 중심으로 하는 스터드볼트 단면(원)을 그립니다.
    CiSketchPoint center = m_IFC->SketchManager.SetSketchPoint(0, 0);

    // 360도 원호 계산 오류를 방지하기 위해, 이전처럼 180도 아크 2개로 분할하여 그립니다.
    // (만약 CreateSketchCircle 같은 전용 함수가 있다면 그것을 쓰시는 것이 제일 좋습니다)
    CiSketchPoint pt1 = m_IFC->SketchManager.SetSketchPoint(radius, 0);
    CiSketchPoint pt2 = m_IFC->SketchManager.SetSketchPoint(-radius, 0);

    m_IFC->SketchManager.CreateSketchArc(center, pt1, pt2); // 호 1 (0 -> 180도)
    m_IFC->SketchManager.CreateSketchArc(center, pt2, pt1); // 호 2 (180 -> 0도)


    // ==========================================
    // [최종 단계] 3D 형상(Feature) 생성
    // ==========================================
    // 1. 돌출(Extrude)을 지원하는 API라면 단면만 그리고 길이를 입력해 돌출시킵니다.
    // m_IFC->FeatureManager.CreateExtrude(totalLength); 

    // 2. 스윕(Sweep)만 써야 한다면 위에서 그린 경로와 단면을 결합합니다.
    // m_IFC->FeatureManager.CreateSweep();

    return S_OK;
}

//-------------------------------------------------------------------------
// 3-3. 버튼헤드
//-------------------------------------------------------------------------
HRESULT BoltCreator::CreateButtonHead(CiPart* m_IFC)
{
    ////반구형 머리 생성
    //m_IFC->CreateSkecthPlanWorkPlanBase(CinvFeaCrt::kYZ);


    //double hfaceD = m_partData->Dim.B1;
    //double arcHoff = m_partData->Dim.r - sqrt((4. * m_partData->Dim.r * m_partData->Dim.r) - (hfaceD * hfaceD)) * 0.5;
    //arcHoff = m_partData->Dim.r - (m_partData->Dim.H + arcHoff);  //돔 곡률반경(r)과 머리높이(H), 육각홈(B1) 기반 호 중심 계산

    ////=========================================================================
    //// 기준점 및 교점 계산
    ////=========================================================================
    //acInv::Point2dPtr oAcen = m_IFC->GetPoint2d(arcHoff, 0);   // 호 중심
    //acInv::Point2dPtr oP1 = m_IFC->GetPoint2d(0, m_partData->Dim.S * 0.5);  // 머리 외경 상단
    //acInv::Point2dPtr oP2 = m_IFC->GetPoint2d(-(m_partData->Dim.H * 4.), m_partData->Dim.S * 0.5); // 교점 계산용 (임시)
    //acInv::Point2dPtr oP3 = m_IFC->GetPoint2d(-m_partData->Dim.H, m_partData->Dim.S * 0.5);  // 교점 계산용 (임시)
    //acInv::Point2dPtr oP4 = m_IFC->GetPoint2d(-m_partData->Dim.H, 0); // 머리 높이 위치(축)

    //// 원과 직선의 교점 계산
    //oP2 = m_IFC->GetCircleIntersectPoint2d(oAcen, m_partData->Dim.r, oP1, oP2);    // 상단 교점
    //oP3 = m_IFC->GetCircleIntersectPoint2d(oAcen, m_partData->Dim.r, oP4, oP3);    // 측면 교점

    ////=========================================================================
    //// 프로파일 스케치
    ////=========================================================================
    //SketchPointAr ptHead(5);
    //ptHead[0] = m_IFC->SetSketchPoint2d(0, 0);   // 원점 (축)
    //ptHead[1] = m_IFC->SetSketchPoint2d(oP1->X, oP1->Y);  // 머리 외경 상단
    //ptHead[2] = m_IFC->SetSketchPoint2d(oP2->X, oP2->Y);  // 돔 호 시작점
    //ptHead[3] = m_IFC->SetSketchPoint2d(oP3->X, oP3->Y);  // 돔 호 끝점
    //ptHead[4] = m_IFC->SetSketchPoint2d(oP4->X, oP4->Y);  // 머리 높이 (축)
    //acInv::SketchPointPtr oCenR = m_IFC->SetSketchPoint2d(oAcen->X, oAcen->Y);

    //// 프로파일 그리기
    //m_IFC->SetSketchLine2d(ptHead[0], ptHead[1]);  // 축 → 외경
    //m_IFC->SetSketchLine2d(ptHead[1], ptHead[2]);  // 외경 → 호 시작
    //m_IFC->SetSketchLine2d(ptHead[3], ptHead[4]);   // 호 끝 → 축
    //m_IFC->SetSketchArc2d(oCenR, ptHead[2], ptHead[3]);  // 돔 호

    //  // 회전축 및 Revolve
    //acInv::SketchLinePtr oAxisLine = m_IFC->SetSketchLine2d(ptHead[0], ptHead[4]);
    //acInv::RevolveFeaturePtr head = m_IFC->CreateRevolveFeature(oAxisLine);

    ////=========================================================================
    //// 육각 소켓 홈
    ////=========================================================================
    //acInv::FacePtr  oEndFace = m_IFC->SelectByRayFace(0, -m_partData->Dim.H * 2., 0, 0, 1, 0, 0.001);

    //// 육각형 컷		
    //m_IFC->CreateSkecthPlanFaceBase(oEndFace);
    //acInv::Point2dPtr oCenter2 = m_IFC->GetPoint2d(0, 0);
    //acInv::Point2dPtr oRigCenter = m_IFC->GetPoint2d(m_partData->Dim.B1 * 0.5, 0);

    //m_IFC->AddSketchAsPolygon2d(6, oCenter2, oRigCenter, false);
    //acInv::ExtrudeFeaturePtr ohexHole = m_IFC->CreateExtrudeFeature(m_partData->Dim.dt, -1, true);

    //// 소켓 바닥 라운드용 홀
    //oEndFace = m_IFC->SelectByRayFace(0, -m_partData->Dim.H * 2., 0, 0, 1, 0, 0.001);
    //m_IFC->CreateSkecthPlanFaceBase(oEndFace);
    //acInv::SketchPointPtr oCenter1 = m_IFC->SetSketchPoint2d(0, 0);
    //m_IFC->CreateHoleFeatureDepth(m_partData->Dim.B1, m_unit * 0.2f);

    return S_OK;
}

//-------------------------------------------------------------------------
// 3-4. 접시머리 (카운터싱크)
//-------------------------------------------------------------------------
HRESULT BoltCreator::CreateCountersunkHead(CiPart* m_IFC)
{    
    using namespace BoltConstants;

    CiWorkPlane yzPlane = m_IFC->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ); //YZ 평면 생성
    m_IFC->SketchManager.StartSketch(yzPlane);

    const double BoltM = m_partData->Dim.M;  
    const double headWidth = m_partData->Dim.B1;  
    const double headHeight = m_partData->Dim.H1;
    const double Chamfer = m_partData->Dim.V1;

    CiSketchPoint pts[5];
    pts[0] = m_IFC->SketchManager.SetSketchPoint(0, 0);
    pts[1] = m_IFC->SketchManager.SetSketchPoint(0, BoltM * 0.5);
    pts[2] = m_IFC->SketchManager.SetSketchPoint(-((headHeight * 0.5) - Chamfer), headWidth * 0.5);
    pts[3] = m_IFC->SketchManager.SetSketchPoint(-(headHeight * 0.5), headWidth * 0.5);
    pts[4] = m_IFC->SketchManager.SetSketchPoint(-(headHeight * 0.5), 0);

    m_IFC->SketchManager.CreateSketchLine(pts[0], pts[1]);
    m_IFC->SketchManager.CreateSketchLine(pts[1], pts[2]);
    m_IFC->SketchManager.CreateSketchLine(pts[2], pts[3]);
    m_IFC->SketchManager.CreateSketchLine(pts[3], pts[4]);
    m_IFC->SketchManager.CreateSketchLine(pts[4], pts[0]);
        
    CiSketchLine oAxisLine = m_IFC->SketchManager.CreateSketchLine(pts[0], pts[4]);
    m_IFC->SetSolidProfile();
    CiRevolveFeature sunkHead = m_IFC->FeatureManager.CreateRevolve(oAxisLine);

    //// 드라이버 홈 (십자 또는 육각)
    //CreateDriverSlot();

    return S_OK;
}

//-------------------------------------------------------------------------
// 3-5. 냄비머리
//-------------------------------------------------------------------------
HRESULT BoltCreator::CreatePanHead(CiPart* m_IFC)
{
    //m_IFC->CreateSkecthPlanWorkPlanBase(CinvFeaCrt::kYZ);

    //const double headDia = m_partData->Dim.M * 1.5;
    //const double headHeight = m_partData->Dim.H;
    //const double cornerR = headHeight * 0.3;  // 코너 라운드

    //// 냄비 형상 프로파일 (상단 평면 + 측면 라운드)
    //SketchPointAr pts(5);
    //pts[0] = m_IFC->SetSketchPoint2d(0, 0);
    //pts[1] = m_IFC->SetSketchPoint2d(0, headDia / 2.0 - cornerR);
    //pts[2] = m_IFC->SetSketchPoint2d(-cornerR, headDia / 2.0);
    //pts[3] = m_IFC->SetSketchPoint2d(-headHeight, headDia / 2.0);
    //pts[4] = m_IFC->SetSketchPoint2d(-headHeight, 0);

    //acInv::SketchPointPtr arcCenter = m_IFC->SetSketchPoint2d(-cornerR, headDia / 2.0 - cornerR);

    //m_IFC->SetSketchLine2d(pts[0], pts[1]);
    //m_IFC->SetSketchArc2d(arcCenter, pts[1], pts[2]);
    //m_IFC->SetSketchLine2d(pts[2], pts[3]);
    //m_IFC->SetSketchLine2d(pts[3], pts[4]);
    //acInv::SketchLinePtr axis = m_IFC->SetSketchLine2d(pts[4], pts[0]);

    //m_IFC->CreateRevolveFeature(axis);

    //CreateDriverSlot();

    return S_OK;
}

//-------------------------------------------------------------------------
// 3-6. 둥근머리
//-------------------------------------------------------------------------
HRESULT BoltCreator::CreateRoundHead(CiPart* m_IFC)
{
    //// 버튼헤드와 유사하지만 더 완만한 곡선
    //m_IFC->CreateSkecthPlanWorkPlanBase(CinvFeaCrt::kYZ);

    //const double headDia = m_partData->Dim.M * 1.5;
    //const double headHeight = m_partData->Dim.H;

    //// 반구보다 낮은 돔 형상
    //const double arcRadius = (headDia * headDia / 4.0 + headHeight * headHeight) / (2.0 * headHeight);

    //SketchPointAr pts(3);
    //pts[0] = m_IFC->SetSketchPoint2d(0, 0);
    //pts[1] = m_IFC->SetSketchPoint2d(0, headDia / 2.0);
    //pts[2] = m_IFC->SetSketchPoint2d(-headHeight, 0);

    //acInv::SketchPointPtr arcCenter = m_IFC->SetSketchPoint2d(arcRadius - headHeight, 0);

    //m_IFC->SetSketchArc2d(arcCenter, pts[1], pts[2]);
    //m_IFC->SetSketchLine2d(pts[2], pts[0]);
    //acInv::SketchLinePtr axis = m_IFC->SetSketchLine2d(pts[0], pts[2]);

    //m_IFC->CreateRevolveFeature(axis);

    //CreateDriverSlot();

    return S_OK;
}

//-------------------------------------------------------------------------
// 3-7. U볼트
//-------------------------------------------------------------------------
HRESULT BoltCreator::CreateUHead(CiPart* m_IFC)
{
    using namespace BoltConstants;

    CiWorkPlane yzPlane = m_IFC->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ); //YZ 평면 생성
    m_IFC->SketchManager.StartSketch(yzPlane);

    const double diameter = m_partData->Dim.D;
    const double insideWidth = m_partData->Dim.B1;
    const double totalLength = m_partData->Dim.H;

    // 1. 치수 계산 (중심선 기준)
    double radius = (insideWidth + diameter) / 2.0; // 벤딩 반경 (중심 기준)
    double straightLen = totalLength - radius;      // 직선 구간 길이

    // 직선 구간이 음수면 모델링 불가 방지
    if (straightLen < 0) straightLen = 0;

    // 좌표계: YZ 평면이므로 (Y, Z) 좌표계 적용.
    CiSketchPoint pts[5];
    pts[0] = m_IFC->SketchManager.SetSketchPoint(-radius, 0);           // [0] 좌측 다리 끝 (시작점)
    pts[1] = m_IFC->SketchManager.SetSketchPoint(-radius, straightLen); // [1] 좌측 다리 상단 (아크 시작)
    pts[2] = m_IFC->SketchManager.SetSketchPoint(0, straightLen);       // [2] 아크 중심점
    pts[3] = m_IFC->SketchManager.SetSketchPoint(radius, straightLen);  // [3] 우측 다리 상단 (아크 끝)
    pts[4] = m_IFC->SketchManager.SetSketchPoint(radius, 0);            // [4] 우측 다리 끝 (종료점)

    // 선 연결 (Line -> Arc -> Line)
    m_IFC->SketchManager.CreateSketchLine(pts[0], pts[1]);
    // 아크 생성 (API에 따라 Start/End 순서 주의: 보통 반시계방향)
    m_IFC->SketchManager.CreateSketchArc(pts[2], pts[3], pts[1]);
    m_IFC->SketchManager.CreateSketchLine(pts[3], pts[4]);

    // ==========================================
    // [단계 2] 스윕 단면(Profile) 스케치 - XY 평면
    // ==========================================
    // 경로의 시작점(-radius, 0)에서 Z축 방향으로 출발하므로, 
    // 이에 수직인 평면은 XY 평면(Z=0)이 됩니다.
    CiWorkPlane xyPlane = m_IFC->WGManager.CreateWorkPlane(CiBasePlaneEnum::XY);
    m_IFC->SketchManager.StartSketch(xyPlane);

    double r = diameter / 2.0;

    // XY 평면에서의 프로파일 중심 좌표: X=0, Y=-radius
    CiSketchPoint center = m_IFC->SketchManager.SetSketchPoint(0, -radius);

    // 원 생성 (CreateSketchArc로 360도를 그릴 때 에러가 나는 API가 많으므로, 
    // 가급적 전용 원 그리기 함수(예: CreateSketchCircle) 사용을 권장합니다.)
    /* CiSketchPoint startArc = m_IFC->SketchManager.SetSketchPoint(r, -radius);
    m_IFC->SketchManager.CreateSketchArc(center, startArc, startArc);
    */

    // 원 전용 함수가 있다고 가정한 예시:
    // m_IFC->SketchManager.CreateSketchCircle(center, r);

    // ==========================================
    // [단계 3] 스윕(Sweep) 피처 생성
    // ==========================================
    // 작성된 단면(Profile)을 경로(Path)를 따라 밀어내어 3D 솔리드 생성
    // m_IFC->FeatureManager.CreateSweep();


    return S_OK;
}

//-------------------------------------------------------------------------
// 3-8. T홈볼트
//-------------------------------------------------------------------------
HRESULT BoltCreator::CreateTSlotHead(CiPart* m_IFC)
{
    using namespace BoltConstants;

    CiWorkPlane yzPlane = m_IFC->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ); //YZ 평면 생성
     m_IFC->SketchManager.StartSketch(yzPlane);

    //// T형상 프로파일 (직사각형 머리)
   const double headWidth = m_partData->Dim.B1;   // T홈 폭
   const double headHeight = m_partData->Dim.H;
   const double Chamfer = m_partData->Dim.V1;

   CiSketchPoint pts[7];
    pts[0] = m_IFC->SketchManager.SetSketchPoint(0, 0);
    pts[1] = m_IFC->SketchManager.SetSketchPoint(0, headWidth *0.5);
    pts[2] = m_IFC->SketchManager.SetSketchPoint(-((headHeight * 0.5) - Chamfer), headWidth *0.5);
    pts[3] = m_IFC->SketchManager.SetSketchPoint(-(headHeight * 0.5), (headWidth * 0.5)- Chamfer);
    pts[4] = m_IFC->SketchManager.SetSketchPoint(-(headHeight * 0.5), -((headWidth * 0.5) - Chamfer));
    pts[5] = m_IFC->SketchManager.SetSketchPoint(-((headHeight * 0.5) - Chamfer), -(headWidth * 0.5));
    pts[6] = m_IFC->SketchManager.SetSketchPoint(0, -(headWidth * 0.5));

    m_IFC->SketchManager.CreateSketchLine(pts[0], pts[1]);
    m_IFC->SketchManager.CreateSketchLine(pts[1], pts[2]);
    m_IFC->SketchManager.CreateSketchLine(pts[2], pts[3]);
    m_IFC->SketchManager.CreateSketchLine(pts[3], pts[4]);
    m_IFC->SketchManager.CreateSketchLine(pts[4], pts[5]);
    m_IFC->SketchManager.CreateSketchLine(pts[5], pts[6]); 
    m_IFC->SketchManager.CreateSketchLine(pts[6], pts[0]);

    m_IFC->SetSolidProfile();
    CiExtrudeFeature pPip = m_IFC->FeatureManager.CreateExtrude(m_partData->Dim.C1, CiDirectionOpEnum::Symmetry);

    return S_OK;
}

//-------------------------------------------------------------------------
// 3-9. 아이볼트
//-------------------------------------------------------------------------
HRESULT BoltCreator::CreateEyeHead(CiPart* m_IFC)
{
    using namespace BoltConstants;

    // 아이볼트 머리에 필요한 가상 치수 정의 (실제 m_partData에 맞게 수정 필요)
    // 예: D1=내경, D2=철사직경 (또는 m_partData->Dim.D1, D2 사용 가정)
    const double insideDiameter = m_partData->Dim.D1; // 아이볼트 고리 내경 (ID)
    const double wireDiameter = m_partData->Dim.D2; // 아이볼트 고리 철사/단면 직경 (WD)
    // const double totalHeight = m_partData->Dim.H1; // 머리 전체 높이 (필요시)

    // 1. 치수 계산 (중심선 기준)
    double pathRadius = (insideDiameter + wireDiameter) / 2.0; // 경로(토러스 중심)의 반지름
    double profileRadius = wireDiameter / 2.0;               // 단면(토러스 두께)의 반지름

    // ==========================================
    // [단계 1] 스윕 경로(Path) 스케치 - YZ 평면
    // ==========================================
    // 아이볼트 고리의 중심 경로(원)를 그립니다.
    CiWorkPlane yzPlane = m_IFC->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ);
    m_IFC->SketchManager.StartSketch(yzPlane);

    // 좌표계: YZ 평면 (0,0)을 고리의 중심으로 가정.
    // [중요] 360도 닫힌 원호는 API에 따라 실패할 수 있으므로, 안전하게 두 개의 180도 아크로 구성합니다.
    CiSketchPoint pathPts[3];
    pathPts[0] = m_IFC->SketchManager.SetSketchPoint(pathRadius, 0);  // [0] 경로 시작/끝점
    pathPts[1] = m_IFC->SketchManager.SetSketchPoint(-pathRadius, 0); // [1] 경로 반대편점
    pathPts[2] = m_IFC->SketchManager.SetSketchPoint(0, 0);           // [2] 고리의 중심점

    // 아크 생성 (API에 따라 Start/End 순서 주의: 보통 반시계방향)
    // 반시계방향(CCW)으로 180도씩 두 번 그립니다.
    m_IFC->SketchManager.CreateSketchArc(pathPts[2], pathPts[0], pathPts[1]); // 호 1 (0 -> 180도)
    m_IFC->SketchManager.CreateSketchArc(pathPts[2], pathPts[1], pathPts[0]); // 호 2 (180 -> 0도)

    // [피드백 반영] m_IFC->SketchManager.EndSketch(); 는 오류가 발생하므로 삭제합니다.
    // 새로운 StartSketch 호출 시 자동으로 완료된다고 가정합니다.

    // ==========================================
    // [단계 2] 스윕 단면(Profile) 스케치 - XY 평면
    // ==========================================
    // 경로의 시작점(pathRadius, 0, 0)에 수직인 XY 평면에 단면(원)을 그립니다.
    // YZ 평면 경로가 (pathRadius, 0)에서 시작하므로, 3D 공간좌표는 (0, pathRadius, 0)입니다.
    // 이에 수직인 XY 평면(Z=0)에서의 원의 중심 좌표는 (0, pathRadius)가 됩니다.

    CiWorkPlane xyPlane = m_IFC->WGManager.CreateWorkPlane(CiBasePlaneEnum::XY);
    m_IFC->SketchManager.StartSketch(xyPlane);

    // XY 평면에서의 프로파일 중심 좌표: X=0, Y=pathRadius
    CiSketchPoint profileCenter = m_IFC->SketchManager.SetSketchPoint(0, pathRadius);

    // [중요] 원 생성: API 목록에 전용 원 그리기 함수(예: CreateSketchCircle)가 있는지 꼭 확인하세요!
    // 이전 답변 조언처럼 전용 함수 사용을 강력히 권장합니다.

    // m_IFC->SketchManager.CreateSketchCircle(profileCenter, profileRadius); 

    // 만약 전용 함수가 없고 Arc만 있다면, 경로와 동일하게 안전하게 2개의 아크로 구성합니다.
    CiSketchPoint profilePts[2];
    profilePts[0] = m_IFC->SketchManager.SetSketchPoint(profileRadius, pathRadius); // 단면 시작/끝점
    profilePts[1] = m_IFC->SketchManager.SetSketchPoint(-profileRadius, pathRadius); // 단면 반대편점

    m_IFC->SketchManager.CreateSketchArc(profileCenter, profilePts[0], profilePts[1]); // 단면 호 1
    m_IFC->SketchManager.CreateSketchArc(profileCenter, profilePts[1], profilePts[0]); // 단면 호 2

    // ==========================================
    // [단계 3] 스윕(Sweep) 피처 생성
    // ==========================================
    // 작성된 단면(Profile)을 경로(Path)를 따라 밀어내어 3D 솔리드(토러스) 생성
    // m_IFC->FeatureManager.CreateSweep();

    return S_OK;
}

//-------------------------------------------------------------------------
// 3-10. 나비볼트
//-------------------------------------------------------------------------
HRESULT BoltCreator::CreateWingHead(CiPart* m_IFC)
{
    using namespace BoltConstants;

    // 공통 변수 설정
    const double wingSpan = m_partData->Dim.B1;    // 전체 날개 폭 (S)
    const double wingHeight = m_partData->Dim.H;  // 날개 높이 (H)
    const double hubDia = m_partData->Dim.D1;     // 허브(몸통) 지름
    const double wingThick = m_partData->Dim.dt;   // 날개 두께 (돌출량)

    // 작업 평면 설정 (XZ 평면: 볼트를 정면에서 본 모습)
    CiWorkPlane xzPlane = m_IFC->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ);
    m_IFC->SketchManager.StartSketch(xzPlane);

    CiSketchPoint pts[10]; // 넉넉하게 할당

    //-------------------------------------------------------
    // [Type 1] 1종: 각진 형태 (사다리꼴/직사각형 기반)
    //-------------------------------------------------------
    if (m_options.headTypeOption == SpecHeadTypeOption::Type1)
    {
        // 1종은 허브에서 직선으로 뻗어나가 끝이 살짝 둥근 형태입니다.
        double halfSpan = wingSpan / 2.0;
        double halfHub = hubDia / 2.0;
        double cornerR = wingHeight * 0.15; // 모서리 둥글기 (약식)

        // 우측 날개 프로파일 좌표 계산
        // (0,0)은 볼트 머리의 바닥 중앙 기준

        // P0: 중앙 바닥
        pts[0] = m_IFC->SketchManager.SetSketchPoint(0, 0);
        // P1: 우측 바닥 끝 (모서리 R 제외)
        pts[1] = m_IFC->SketchManager.SetSketchPoint(halfSpan - cornerR, 0);
        // P2: 우측 바닥 코너 끝
        pts[2] = m_IFC->SketchManager.SetSketchPoint(halfSpan, cornerR);
        // P3: 우측 상단 코너 끝
        pts[3] = m_IFC->SketchManager.SetSketchPoint(halfSpan, wingHeight - cornerR);
        // P4: 우측 상단 안쪽
        pts[4] = m_IFC->SketchManager.SetSketchPoint(halfSpan - cornerR, wingHeight);
        // P5: 중앙 상단
        pts[5] = m_IFC->SketchManager.SetSketchPoint(0, wingHeight);

        // 선/아크 그리기 (반시계 방향)
        m_IFC->SketchManager.CreateSketchLine(pts[0], pts[1]); // 바닥 직선
        m_IFC->SketchManager.CreateSketchArc(pts[1], pts[2], pts[2]); // 우측 하단 코너 (Arc)
        m_IFC->SketchManager.CreateSketchLine(pts[2], pts[3]); // 우측 수직선
        m_IFC->SketchManager.CreateSketchArc(pts[3], pts[4], pts[4]); // 우측 상단 코너 (Arc)
        m_IFC->SketchManager.CreateSketchLine(pts[4], pts[5]); // 상단 직선
        m_IFC->SketchManager.CreateSketchLine(pts[5], pts[0]); // 중앙 수직선 (닫힘)

        // *실제 모델링 시에는 좌측 대칭 복사(Mirror)가 필요합니다.
    }
    //-------------------------------------------------------
    // [Type 2] 2종: 둥근 형태 (아치형 곡선)
    //-------------------------------------------------------
    else
    {
        // 2종은 허브에서 오목하게 시작해 볼록하게 끝나는 'S'자 곡선 혹은 큰 원호 형태입니다.
        double halfSpan = wingSpan / 2.0;
        double halfHub = hubDia / 2.0;

        // P0: 중앙 바닥
        pts[0] = m_IFC->SketchManager.SetSketchPoint(0, 0);

        // P1: 허브와 날개가 만나는 지점 (바닥)
        pts[1] = m_IFC->SketchManager.SetSketchPoint(halfHub, 0);

        // P2: 날개 끝점 (가장 먼 곳, 높이는 중간보다 약간 아래)
        // 2종은 끝이 완전히 둥글므로 Tip에 대한 중심점 계산이 중요합니다.
        double tipRadius = wingHeight * 0.35;
        CiSketchPoint tipCenter = m_IFC->SketchManager.SetSketchPoint(halfSpan - tipRadius, tipRadius);

        // P3: 날개 끝 아크의 시작점 (바닥쪽)
        pts[2] = m_IFC->SketchManager.SetSketchPoint(halfSpan - tipRadius, 0);
        // P4: 날개 끝 아크의 끝점 (위쪽)
        pts[3] = m_IFC->SketchManager.SetSketchPoint(halfSpan, tipRadius);

        // P5: 중앙 상단 (허브 높이)
        // 날개 윗면은 큰 곡선으로 중앙과 이어짐
        pts[4] = m_IFC->SketchManager.SetSketchPoint(0, wingHeight * 0.8); // 중앙부는 약간 낮게(오목) 하거나 높게 설정

        // 그리기
        m_IFC->SketchManager.CreateSketchLine(pts[0], pts[2]); // 바닥 직선 (허브~날개끝 직전)

        // 날개 끝 둥근 부분 (반원)
        // Center, Start, End 순서 주의 (API 맞게 조정)
        m_IFC->SketchManager.CreateSketchArc(tipCenter, pts[2], pts[3]);

        // 날개 윗면 (끝점에서 중앙으로 이어지는 큰 아크)
        // 3점 아크(Start, End, Mid) 혹은 접선 아크 사용
        // 여기서는 단순화를 위해 직선과 아크 조합 대신, 큰 아크 하나로 연결 가정
        // 곡률 반경 계산이 복잡하므로 3점 아크 방식(Through Point) API가 있다면 유리
        CiSketchPoint topArcMid = m_IFC->SketchManager.SetSketchPoint(halfSpan * 0.5, wingHeight);
        m_IFC->SketchManager.CreateSketchArc(pts[3], pts[4], topArcMid);

        m_IFC->SketchManager.CreateSketchLine(pts[4], pts[0]); // 중앙 수직선 (닫힘)
    }

    // 3. 솔리드 생성 (돌출)
    m_IFC->SetSolidProfile();

    // 날개 두께만큼 양쪽으로 돌출 (Mid-Plane Extrude) 하거나 한쪽으로 돌출
    // 나비볼트 날개는 보통 중심축 기준 대칭이므로 Mid-Plane 옵션 권장
    m_IFC->FeatureManager.CreateExtrude(wingThick, CiDirectionOpEnum::Symmetry);


    return S_OK;
}

//-------------------------------------------------------------------------
// 3-11. 사각볼트
//-------------------------------------------------------------------------
HRESULT BoltCreator::CreateSqHead(CiPart* m_IFC)
{
    using namespace BoltConstants;

    const double chamferHeight =
        ((m_partData->Dim.C1 - m_partData->Dim.B1) / 2.0) *
        tan(atan(1.0) / CHAMFER_25_DEG_FACTOR);

    //m_IFC->CreateSkecthPlanWorkPlanBase(CinvFeaCrt::kXZ);
    //acInv::Point2dPtr oCenter = m_IFC->GetPoint2d(0, 0);
    CiWorkPlane xzPlane = m_IFC->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ); //XZ 평면 생성
    m_IFC->SketchManager.StartSketch(xzPlane);
    ////
    ////bolt body 생성
    CiSketchPoint pCenter = m_IFC->SketchManager.SetSketchPoint(0, 0);
    CiSketchPoint rigCenter = m_IFC->SketchManager.SetSketchPoint(0, m_partData->Dim.C1 / 2.0);
    m_IFC->SketchManager.CreateSketchPolygon(4, pCenter, rigCenter, true);
    
    m_IFC->SetSolidProfile(); //스케치로부터 피쳐에 적용할 프로필을 추출
    CiExtrudeFeature pPip = m_IFC->FeatureManager.CreateExtrude(m_partData->Dim.H, CiDirectionOpEnum::Negative); //돌출

    CiWorkPlane yzPlane = m_IFC->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ); //XZ 평면 생성
    m_IFC->SketchManager.StartSketch(yzPlane); //이 평면에 스케치 시작

    CiSketchPoint pts[3];
    pts[0] = m_IFC->SketchManager.SetSketchPoint(-m_partData->Dim.H, m_partData->Dim.B1 * 0.5);        //1
    pts[1] = m_IFC->SketchManager.SetSketchPoint(-(m_partData->Dim.H - chamferHeight), m_partData->Dim.C1 * 0.5); //2
    pts[2] = m_IFC->SketchManager.SetSketchPoint(-m_partData->Dim.H, m_partData->Dim.C1 * 0.5);

    /* m_IFC->SetSketchLine2d(pts[0], pts[1]);
       m_IFC->SetSketchLine2d(pts[1], pts[2]);
       m_IFC->SetSketchLine2d(pts[2], pts[0]);*/
    m_IFC->SketchManager.CreateSketchLine(pts[0], pts[1]);
    m_IFC->SketchManager.CreateSketchLine(pts[1], pts[2]);
    m_IFC->SketchManager.CreateSketchLine(pts[2], pts[0]);

    //m_IFC->CreateRevolveFeature(m_IFC->GetWorkAxis(2), true);
    m_IFC->SetSolidProfile();
    CiWorkAxis oAxis2Line = m_IFC->WGManager.GetBaseAxis(CiBaseDirectionEnum::Y);
    CiRevolveFeature ferralSCcut = m_IFC->FeatureManager.CreateRevolve(oAxis2Line, CiJoinOpEnum::Cut);

    return S_OK;
}

//-------------------------------------------------------------------------
// 3-12. 플랜지볼트
//-------------------------------------------------------------------------
HRESULT BoltCreator::CreateHexFlangeHead(CiPart* m_IFC)
{
    using namespace BoltConstants;

    const double chamferHeight =
        ((m_partData->Dim.C1 - m_partData->Dim.B1) / 2.0) *
        tan(atan(1.0) / CHAMFER_30_DEG_FACTOR);

    // 육각형 스케치 및 돌출
    //m_IFC->CreateSkecthPlanWorkPlanBase(CinvFeaCrt::kXZ);
    CiWorkPlane xzPlane = m_IFC->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ); //XZ 평면 생성
    m_IFC->SketchManager.StartSketch(xzPlane); //이 평면에 스케치 시작

    //acInv::Point2dPtr center = m_IFC->GetPoint2d(0, 0);
    //acInv::Point2dPtr rigCenter = m_IFC->GetPoint2d(0, m_partData->Dim.C1 / 2.0);
    //m_IFC->AddSketchAsPolygon2d(6, center, rigCenter, true);
    CiSketchPoint pCenter = m_IFC->SketchManager.SetSketchPoint(0, 0);
    CiSketchPoint rigCenter = m_IFC->SketchManager.SetSketchPoint(0, m_partData->Dim.C1 / 2.0);
    m_IFC->SketchManager.CreateSketchPolygon(6, pCenter, rigCenter, true);
 
    //m_IFC->CreateExtrudeFeature(m_partData->Dim.H, -1);
   m_IFC->SetSolidProfile(); //스케치로부터 피쳐에 적용할 프로필을 추출
    CiExtrudeFeature pPip =m_IFC->FeatureManager.CreateExtrude(m_partData->Dim.H, CiDirectionOpEnum::Negative); //돌출

    // 30° 챔퍼 컷팅
    //m_IFC->CreateSkecthPlanWorkPlanBase(CinvFeaCrt::kYZ);
    CiWorkPlane yzPlane =m_IFC->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ); //XZ 평면 생성
   m_IFC->SketchManager.StartSketch(yzPlane); //이 평면에 스케치 시작

    //SketchPointAr pts(3);
    //pts[0] = m_IFC->SetSketchPoint2d(-m_partData->Dim.H, m_partData->Dim.B1 * 0.5);
    //pts[1] = m_IFC->SetSketchPoint2d(-(m_partData->Dim.H - chamferHeight), m_partData->Dim.C1 * 0.5);
    //pts[2] = m_IFC->SetSketchPoint2d(-m_partData->Dim.H, m_partData->Dim.C1 * 0.5);
    CiSketchPoint pts[3];
    pts[0] =m_IFC->SketchManager.SetSketchPoint(-m_partData->Dim.H, m_partData->Dim.B1 * 0.5);        //1
    pts[1] =m_IFC->SketchManager.SetSketchPoint(-(m_partData->Dim.H - chamferHeight), m_partData->Dim.C1 * 0.5); //2
    pts[2] =m_IFC->SketchManager.SetSketchPoint(-m_partData->Dim.H, m_partData->Dim.C1 * 0.5);

 /* m_IFC->SetSketchLine2d(pts[0], pts[1]);
    m_IFC->SetSketchLine2d(pts[1], pts[2]);
    m_IFC->SetSketchLine2d(pts[2], pts[0]);*/
   m_IFC->SketchManager.CreateSketchLine(pts[0], pts[1]);
   m_IFC->SketchManager.CreateSketchLine(pts[1], pts[2]);
   m_IFC->SketchManager.CreateSketchLine(pts[2], pts[0]);

    //m_IFC->CreateRevolveFeature(m_IFC->GetWorkAxis(2), true);
   m_IFC->SetSolidProfile();
   CiWorkAxis oAxis2Line =m_IFC->WGManager.GetBaseAxis(CiBaseDirectionEnum::Y);
   CiRevolveFeature ferralSCcut =m_IFC->FeatureManager.CreateRevolve(oAxis2Line, CiJoinOpEnum::Cut);

   // 플랜지
   CreateFlangeFeature(m_IFC);

    return S_OK;
}

//-------------------------------------------------------------------------
// 3-13. 기초볼트
//-------------------------------------------------------------------------
HRESULT BoltCreator::CreateFdHead(CiPart* m_IFC)
{
    using namespace BoltConstants;

    const double chamferHeight =
        ((m_partData->Dim.C1 - m_partData->Dim.B1) / 2.0) *
        tan(atan(1.0) / CHAMFER_25_DEG_FACTOR);

    // 기초볼트에 필요한 가상 치수 정의 (실제 m_partData 변수명에 맞게 매핑해 주세요)
    double diameter = m_partData->Dim.M;     // 볼트 몸통 직경
    double totalLength = m_partData->Dim.H;  // 수직 구간의 전체 길이
    double hookLength = m_partData->Dim.H1;   // 하단 갈고리(수평) 구간의 길이
    double bendRadius = m_partData->Dim.H2;   // 굽힘 반경 (보통 직경의 2~3배)

    double radius = diameter / 2.0;

    // 1. 수직 직선 구간 길이 계산 (전체 길이에서 굽힘 반경 제외)
    double straightLen = totalLength - bendRadius;
    if (straightLen < 0) straightLen = 0; // 모델링 오류 방지

    // ==========================================
    // [단계 1] 스윕 경로(Path) 스케치 - YZ 평면
    // ==========================================
    CiWorkPlane yzPlane = m_IFC->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ);
    m_IFC->SketchManager.StartSketch(yzPlane);

    // 좌표계: YZ 평면. (0,0)을 볼트 최상단으로 설정하고 아래(-Y)로 그려나갑니다.
    CiSketchPoint pts[5];
    pts[0] = m_IFC->SketchManager.SetSketchPoint(0, 0);                        // [0] 볼트 최상단 (시작점)
    pts[1] = m_IFC->SketchManager.SetSketchPoint(0, -straightLen);             // [1] 수직 구간 끝 (90도 아크 시작점)
    pts[2] = m_IFC->SketchManager.SetSketchPoint(bendRadius, -straightLen);    // [2] 90도 아크의 중심점
    pts[3] = m_IFC->SketchManager.SetSketchPoint(bendRadius, -totalLength);    // [3] 90도 아크 끝점 (수평 구간 시작)
    pts[4] = m_IFC->SketchManager.SetSketchPoint(bendRadius + hookLength, -totalLength); // [4] 갈고리 끝점 (종료점)

    // 선 연결 (수직 Line -> 90도 Arc -> 수평 Line)
    m_IFC->SketchManager.CreateSketchLine(pts[0], pts[1]);

    // 90도 굽힘 아크 생성 (API에 따라 Start/End 순서 주의)
    // 중심이 pts[2]이고, pts[1]에서 pts[3]으로 이어지는 90도 호입니다.
    m_IFC->SketchManager.CreateSketchArc(pts[2], pts[1], pts[3]);

    m_IFC->SketchManager.CreateSketchLine(pts[3], pts[4]);

    // ==========================================
    // [단계 2] 스윕 단면(Profile) 스케치 - XZ 평면
    // ==========================================
    // 경로의 시작점이 (0,0,0)에서 Y축 방향(-Y)으로 내려가므로, 
    // 이에 수직인 단면 평면은 XY가 아니라 **XZ 평면**이 됩니다.
    CiWorkPlane xzPlane = m_IFC->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ);
    m_IFC->SketchManager.StartSketch(xzPlane);

    // 단면 원의 중심은 원점(0,0)
    CiSketchPoint center = m_IFC->SketchManager.SetSketchPoint(0, 0);

    // 이전과 동일하게 360도 계산 오류를 막기 위해 180도 아크 2개로 원을 그립니다.
    // (CreateSketchCircle 함수가 확인되었다면 그것으로 대체하세요)
    CiSketchPoint profilePt1 = m_IFC->SketchManager.SetSketchPoint(radius, 0);
    CiSketchPoint profilePt2 = m_IFC->SketchManager.SetSketchPoint(-radius, 0);

    m_IFC->SketchManager.CreateSketchArc(center, profilePt1, profilePt2); // 호 1 (0 -> 180도)
    m_IFC->SketchManager.CreateSketchArc(center, profilePt2, profilePt1); // 호 2 (180 -> 0도)

    // ==========================================
    // [단계 3] 스윕(Sweep) 피처 생성
    // ==========================================
    // m_IFC->FeatureManager.CreateSweep();

    return S_OK;
}

//-------------------------------------------------------------------------
// 3-14. 힌지볼트
//-------------------------------------------------------------------------
HRESULT BoltCreator::CreateHgHead(CiPart* m_IFC)
{
    using namespace BoltConstants;

    const double chamferHeight =
        ((m_partData->Dim.C1 - m_partData->Dim.B1) / 2.0) *
        tan(atan(1.0) / CHAMFER_25_DEG_FACTOR);

    //m_IFC->CreateSkecthPlanWorkPlanBase(CinvFeaCrt::kXZ);
    //acInv::Point2dPtr oCenter = m_IFC->GetPoint2d(0, 0);
    CiWorkPlane xzPlane = m_IFC->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ); //XZ 평면 생성
    m_IFC->SketchManager.StartSketch(xzPlane);
    ////
    ////bolt body 생성
    CiSketchPoint pCenter = m_IFC->SketchManager.SetSketchPoint(0, 0);
    CiSketchPoint rigCenter = m_IFC->SketchManager.SetSketchPoint(0, m_partData->Dim.C1 / 2.0);
    m_IFC->SketchManager.CreateSketchPolygon(4, pCenter, rigCenter, true);

    m_IFC->SetSolidProfile(); //스케치로부터 피쳐에 적용할 프로필을 추출
    CiExtrudeFeature pPip = m_IFC->FeatureManager.CreateExtrude(m_partData->Dim.H, CiDirectionOpEnum::Negative); //돌출

    CiWorkPlane yzPlane = m_IFC->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ); //XZ 평면 생성
    m_IFC->SketchManager.StartSketch(yzPlane); //이 평면에 스케치 시작

    CiSketchPoint pts[3];
    pts[0] = m_IFC->SketchManager.SetSketchPoint(-m_partData->Dim.H, m_partData->Dim.B1 * 0.5);        //1
    pts[1] = m_IFC->SketchManager.SetSketchPoint(-(m_partData->Dim.H - chamferHeight), m_partData->Dim.C1 * 0.5); //2
    pts[2] = m_IFC->SketchManager.SetSketchPoint(-m_partData->Dim.H, m_partData->Dim.C1 * 0.5);

    /* m_IFC->SetSketchLine2d(pts[0], pts[1]);
       m_IFC->SetSketchLine2d(pts[1], pts[2]);
       m_IFC->SetSketchLine2d(pts[2], pts[0]);*/
    m_IFC->SketchManager.CreateSketchLine(pts[0], pts[1]);
    m_IFC->SketchManager.CreateSketchLine(pts[1], pts[2]);
    m_IFC->SketchManager.CreateSketchLine(pts[2], pts[0]);

    //m_IFC->CreateRevolveFeature(m_IFC->GetWorkAxis(2), true);
    m_IFC->SetSolidProfile();
    CiWorkAxis oAxis2Line = m_IFC->WGManager.GetBaseAxis(CiBaseDirectionEnum::Y);
    CiRevolveFeature ferralSCcut = m_IFC->FeatureManager.CreateRevolve(oAxis2Line, CiJoinOpEnum::Cut);

    return S_OK;
}

//-------------------------------------------------------------------------
// 3-15. 노크볼트
//-------------------------------------------------------------------------
HRESULT BoltCreator::CreateKnHead(CiPart* m_IFC)
{
    using namespace BoltConstants;

    const double chamferHeight =
        ((m_partData->Dim.C1 - m_partData->Dim.B1) / 2.0) *
        tan(atan(1.0) / CHAMFER_25_DEG_FACTOR);

    //m_IFC->CreateSkecthPlanWorkPlanBase(CinvFeaCrt::kXZ);
    //acInv::Point2dPtr oCenter = m_IFC->GetPoint2d(0, 0);
    CiWorkPlane xzPlane = m_IFC->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ); //XZ 평면 생성
    m_IFC->SketchManager.StartSketch(xzPlane);
    ////
    ////bolt body 생성
    CiSketchPoint pCenter = m_IFC->SketchManager.SetSketchPoint(0, 0);
    CiSketchPoint rigCenter = m_IFC->SketchManager.SetSketchPoint(0, m_partData->Dim.C1 / 2.0);
    m_IFC->SketchManager.CreateSketchPolygon(4, pCenter, rigCenter, true);

    m_IFC->SetSolidProfile(); //스케치로부터 피쳐에 적용할 프로필을 추출
    CiExtrudeFeature pPip = m_IFC->FeatureManager.CreateExtrude(m_partData->Dim.H, CiDirectionOpEnum::Negative); //돌출

    CiWorkPlane yzPlane = m_IFC->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ); //XZ 평면 생성
    m_IFC->SketchManager.StartSketch(yzPlane); //이 평면에 스케치 시작

    CiSketchPoint pts[3];
    pts[0] = m_IFC->SketchManager.SetSketchPoint(-m_partData->Dim.H, m_partData->Dim.B1 * 0.5);        //1
    pts[1] = m_IFC->SketchManager.SetSketchPoint(-(m_partData->Dim.H - chamferHeight), m_partData->Dim.C1 * 0.5); //2
    pts[2] = m_IFC->SketchManager.SetSketchPoint(-m_partData->Dim.H, m_partData->Dim.C1 * 0.5);

    /* m_IFC->SetSketchLine2d(pts[0], pts[1]);
       m_IFC->SetSketchLine2d(pts[1], pts[2]);
       m_IFC->SetSketchLine2d(pts[2], pts[0]);*/
    m_IFC->SketchManager.CreateSketchLine(pts[0], pts[1]);
    m_IFC->SketchManager.CreateSketchLine(pts[1], pts[2]);
    m_IFC->SketchManager.CreateSketchLine(pts[2], pts[0]);

    //m_IFC->CreateRevolveFeature(m_IFC->GetWorkAxis(2), true);
    m_IFC->SetSolidProfile();
    CiWorkAxis oAxis2Line = m_IFC->WGManager.GetBaseAxis(CiBaseDirectionEnum::Y);
    CiRevolveFeature ferralSCcut = m_IFC->FeatureManager.CreateRevolve(oAxis2Line, CiJoinOpEnum::Cut);

    return S_OK;
}

//-------------------------------------------------------------------------
// 3-16. 숄더볼트
//-------------------------------------------------------------------------
HRESULT BoltCreator::CreateSdHead(CiPart* m_IFC)
{
    using namespace BoltConstants;

    const double chamferHeight =
        ((m_partData->Dim.C1 - m_partData->Dim.B1) / 2.0) *
        tan(atan(1.0) / CHAMFER_25_DEG_FACTOR);

    //m_IFC->CreateSkecthPlanWorkPlanBase(CinvFeaCrt::kXZ);
    //acInv::Point2dPtr oCenter = m_IFC->GetPoint2d(0, 0);
    CiWorkPlane xzPlane = m_IFC->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ); //XZ 평면 생성
    m_IFC->SketchManager.StartSketch(xzPlane);
    ////
    ////bolt body 생성
    CiSketchPoint pCenter = m_IFC->SketchManager.SetSketchPoint(0, 0);
    CiSketchPoint rigCenter = m_IFC->SketchManager.SetSketchPoint(0, m_partData->Dim.C1 / 2.0);
    m_IFC->SketchManager.CreateSketchPolygon(4, pCenter, rigCenter, true);

    m_IFC->SetSolidProfile(); //스케치로부터 피쳐에 적용할 프로필을 추출
    CiExtrudeFeature pPip = m_IFC->FeatureManager.CreateExtrude(m_partData->Dim.H, CiDirectionOpEnum::Negative); //돌출

    CiWorkPlane yzPlane = m_IFC->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ); //XZ 평면 생성
    m_IFC->SketchManager.StartSketch(yzPlane); //이 평면에 스케치 시작

    CiSketchPoint pts[3];
    pts[0] = m_IFC->SketchManager.SetSketchPoint(-m_partData->Dim.H, m_partData->Dim.B1 * 0.5);        //1
    pts[1] = m_IFC->SketchManager.SetSketchPoint(-(m_partData->Dim.H - chamferHeight), m_partData->Dim.C1 * 0.5); //2
    pts[2] = m_IFC->SketchManager.SetSketchPoint(-m_partData->Dim.H, m_partData->Dim.C1 * 0.5);

    /* m_IFC->SetSketchLine2d(pts[0], pts[1]);
       m_IFC->SetSketchLine2d(pts[1], pts[2]);
       m_IFC->SetSketchLine2d(pts[2], pts[0]);*/
    m_IFC->SketchManager.CreateSketchLine(pts[0], pts[1]);
    m_IFC->SketchManager.CreateSketchLine(pts[1], pts[2]);
    m_IFC->SketchManager.CreateSketchLine(pts[2], pts[0]);

    //m_IFC->CreateRevolveFeature(m_IFC->GetWorkAxis(2), true);
    m_IFC->SetSolidProfile();
    CiWorkAxis oAxis2Line = m_IFC->WGManager.GetBaseAxis(CiBaseDirectionEnum::Y);
    CiRevolveFeature ferralSCcut = m_IFC->FeatureManager.CreateRevolve(oAxis2Line, CiJoinOpEnum::Cut);

    return S_OK;
}

//-------------------------------------------------------------------------
// 3-17. 턴버클
//-------------------------------------------------------------------------
HRESULT BoltCreator::CreateTbHead(CiPart* m_IFC)
{
    using namespace BoltConstants;

    const double chamferHeight =
        ((m_partData->Dim.C1 - m_partData->Dim.B1) / 2.0) *
        tan(atan(1.0) / CHAMFER_25_DEG_FACTOR);

    //m_IFC->CreateSkecthPlanWorkPlanBase(CinvFeaCrt::kXZ);
    //acInv::Point2dPtr oCenter = m_IFC->GetPoint2d(0, 0);
    CiWorkPlane xzPlane = m_IFC->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ); //XZ 평면 생성
    m_IFC->SketchManager.StartSketch(xzPlane);
    ////
    ////bolt body 생성
    CiSketchPoint pCenter = m_IFC->SketchManager.SetSketchPoint(0, 0);
    CiSketchPoint rigCenter = m_IFC->SketchManager.SetSketchPoint(0, m_partData->Dim.C1 / 2.0);
    m_IFC->SketchManager.CreateSketchPolygon(4, pCenter, rigCenter, true);

    m_IFC->SetSolidProfile(); //스케치로부터 피쳐에 적용할 프로필을 추출
    CiExtrudeFeature pPip = m_IFC->FeatureManager.CreateExtrude(m_partData->Dim.H, CiDirectionOpEnum::Negative); //돌출

    CiWorkPlane yzPlane = m_IFC->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ); //XZ 평면 생성
    m_IFC->SketchManager.StartSketch(yzPlane); //이 평면에 스케치 시작

    CiSketchPoint pts[3];
    pts[0] = m_IFC->SketchManager.SetSketchPoint(-m_partData->Dim.H, m_partData->Dim.B1 * 0.5);        //1
    pts[1] = m_IFC->SketchManager.SetSketchPoint(-(m_partData->Dim.H - chamferHeight), m_partData->Dim.C1 * 0.5); //2
    pts[2] = m_IFC->SketchManager.SetSketchPoint(-m_partData->Dim.H, m_partData->Dim.C1 * 0.5);

    /* m_IFC->SetSketchLine2d(pts[0], pts[1]);
       m_IFC->SetSketchLine2d(pts[1], pts[2]);
       m_IFC->SetSketchLine2d(pts[2], pts[0]);*/
    m_IFC->SketchManager.CreateSketchLine(pts[0], pts[1]);
    m_IFC->SketchManager.CreateSketchLine(pts[1], pts[2]);
    m_IFC->SketchManager.CreateSketchLine(pts[2], pts[0]);

    //m_IFC->CreateRevolveFeature(m_IFC->GetWorkAxis(2), true);
    m_IFC->SetSolidProfile();
    CiWorkAxis oAxis2Line = m_IFC->WGManager.GetBaseAxis(CiBaseDirectionEnum::Y);
    CiRevolveFeature ferralSCcut = m_IFC->FeatureManager.CreateRevolve(oAxis2Line, CiJoinOpEnum::Cut);

    return S_OK;
}

//-------------------------------------------------------------------------
// 3-18. 앙카볼트
//-------------------------------------------------------------------------
HRESULT BoltCreator::CreateAcHead(CiPart* m_IFC)
{
    using namespace BoltConstants;

    const double chamferHeight =
        ((m_partData->Dim.C1 - m_partData->Dim.B1) / 2.0) *
        tan(atan(1.0) / CHAMFER_25_DEG_FACTOR);

    //m_IFC->CreateSkecthPlanWorkPlanBase(CinvFeaCrt::kXZ);
    //acInv::Point2dPtr oCenter = m_IFC->GetPoint2d(0, 0);
    CiWorkPlane xzPlane = m_IFC->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ); //XZ 평면 생성
    m_IFC->SketchManager.StartSketch(xzPlane);
    ////
    ////bolt body 생성
    CiSketchPoint pCenter = m_IFC->SketchManager.SetSketchPoint(0, 0);
    CiSketchPoint rigCenter = m_IFC->SketchManager.SetSketchPoint(0, m_partData->Dim.C1 / 2.0);
    m_IFC->SketchManager.CreateSketchPolygon(4, pCenter, rigCenter, true);

    m_IFC->SetSolidProfile(); //스케치로부터 피쳐에 적용할 프로필을 추출
    CiExtrudeFeature pPip = m_IFC->FeatureManager.CreateExtrude(m_partData->Dim.H, CiDirectionOpEnum::Negative); //돌출

    CiWorkPlane yzPlane = m_IFC->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ); //XZ 평면 생성
    m_IFC->SketchManager.StartSketch(yzPlane); //이 평면에 스케치 시작

    CiSketchPoint pts[3];
    pts[0] = m_IFC->SketchManager.SetSketchPoint(-m_partData->Dim.H, m_partData->Dim.B1 * 0.5);        //1
    pts[1] = m_IFC->SketchManager.SetSketchPoint(-(m_partData->Dim.H - chamferHeight), m_partData->Dim.C1 * 0.5); //2
    pts[2] = m_IFC->SketchManager.SetSketchPoint(-m_partData->Dim.H, m_partData->Dim.C1 * 0.5);

    /* m_IFC->SetSketchLine2d(pts[0], pts[1]);
       m_IFC->SetSketchLine2d(pts[1], pts[2]);
       m_IFC->SetSketchLine2d(pts[2], pts[0]);*/
    m_IFC->SketchManager.CreateSketchLine(pts[0], pts[1]);
    m_IFC->SketchManager.CreateSketchLine(pts[1], pts[2]);
    m_IFC->SketchManager.CreateSketchLine(pts[2], pts[0]);

    //m_IFC->CreateRevolveFeature(m_IFC->GetWorkAxis(2), true);
    m_IFC->SetSolidProfile();
    CiWorkAxis oAxis2Line = m_IFC->WGManager.GetBaseAxis(CiBaseDirectionEnum::Y);
    CiRevolveFeature ferralSCcut = m_IFC->FeatureManager.CreateRevolve(oAxis2Line, CiJoinOpEnum::Cut);

    return S_OK;
}

//-------------------------------------------------------------------------
// 3-19. 샘스볼트
//-------------------------------------------------------------------------
HRESULT BoltCreator::CreateSmHead(CiPart* m_IFC)
{
    using namespace BoltConstants;

    const double chamferHeight =
        ((m_partData->Dim.C1 - m_partData->Dim.B1) / 2.0) *
        tan(atan(1.0) / CHAMFER_25_DEG_FACTOR);

    //m_IFC->CreateSkecthPlanWorkPlanBase(CinvFeaCrt::kXZ);
    //acInv::Point2dPtr oCenter = m_IFC->GetPoint2d(0, 0);
    CiWorkPlane xzPlane = m_IFC->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ); //XZ 평면 생성
    m_IFC->SketchManager.StartSketch(xzPlane);
    ////
    ////bolt body 생성
    CiSketchPoint pCenter = m_IFC->SketchManager.SetSketchPoint(0, 0);
    CiSketchPoint rigCenter = m_IFC->SketchManager.SetSketchPoint(0, m_partData->Dim.C1 / 2.0);
    m_IFC->SketchManager.CreateSketchPolygon(4, pCenter, rigCenter, true);

    m_IFC->SetSolidProfile(); //스케치로부터 피쳐에 적용할 프로필을 추출
    CiExtrudeFeature pPip = m_IFC->FeatureManager.CreateExtrude(m_partData->Dim.H, CiDirectionOpEnum::Negative); //돌출

    CiWorkPlane yzPlane = m_IFC->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ); //XZ 평면 생성
    m_IFC->SketchManager.StartSketch(yzPlane); //이 평면에 스케치 시작

    CiSketchPoint pts[3];
    pts[0] = m_IFC->SketchManager.SetSketchPoint(-m_partData->Dim.H, m_partData->Dim.B1 * 0.5);        //1
    pts[1] = m_IFC->SketchManager.SetSketchPoint(-(m_partData->Dim.H - chamferHeight), m_partData->Dim.C1 * 0.5); //2
    pts[2] = m_IFC->SketchManager.SetSketchPoint(-m_partData->Dim.H, m_partData->Dim.C1 * 0.5);

    /* m_IFC->SetSketchLine2d(pts[0], pts[1]);
       m_IFC->SetSketchLine2d(pts[1], pts[2]);
       m_IFC->SetSketchLine2d(pts[2], pts[0]);*/
    m_IFC->SketchManager.CreateSketchLine(pts[0], pts[1]);
    m_IFC->SketchManager.CreateSketchLine(pts[1], pts[2]);
    m_IFC->SketchManager.CreateSketchLine(pts[2], pts[0]);

    //m_IFC->CreateRevolveFeature(m_IFC->GetWorkAxis(2), true);
    m_IFC->SetSolidProfile();
    CiWorkAxis oAxis2Line = m_IFC->WGManager.GetBaseAxis(CiBaseDirectionEnum::Y);
    CiRevolveFeature ferralSCcut = m_IFC->FeatureManager.CreateRevolve(oAxis2Line, CiJoinOpEnum::Cut);

    return S_OK;
}

//-------------------------------------------------------------------------
// 3-20. 관용볼트
//-------------------------------------------------------------------------
HRESULT BoltCreator::CreatePuHead(CiPart* m_IFC)
{
    using namespace BoltConstants;

    const double chamferHeight =
        ((m_partData->Dim.C1 - m_partData->Dim.B1) / 2.0) *
        tan(atan(1.0) / CHAMFER_25_DEG_FACTOR);

    //m_IFC->CreateSkecthPlanWorkPlanBase(CinvFeaCrt::kXZ);
    //acInv::Point2dPtr oCenter = m_IFC->GetPoint2d(0, 0);
    CiWorkPlane xzPlane = m_IFC->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ); //XZ 평면 생성
    m_IFC->SketchManager.StartSketch(xzPlane);
    ////
    ////bolt body 생성
    CiSketchPoint pCenter = m_IFC->SketchManager.SetSketchPoint(0, 0);
    CiSketchPoint rigCenter = m_IFC->SketchManager.SetSketchPoint(0, m_partData->Dim.C1 / 2.0);
    m_IFC->SketchManager.CreateSketchPolygon(4, pCenter, rigCenter, true);

    m_IFC->SetSolidProfile(); //스케치로부터 피쳐에 적용할 프로필을 추출
    CiExtrudeFeature pPip = m_IFC->FeatureManager.CreateExtrude(m_partData->Dim.H, CiDirectionOpEnum::Negative); //돌출

    CiWorkPlane yzPlane = m_IFC->WGManager.CreateWorkPlane(CiBasePlaneEnum::YZ); //XZ 평면 생성
    m_IFC->SketchManager.StartSketch(yzPlane); //이 평면에 스케치 시작

    CiSketchPoint pts[3];
    pts[0] = m_IFC->SketchManager.SetSketchPoint(-m_partData->Dim.H, m_partData->Dim.B1 * 0.5);        //1
    pts[1] = m_IFC->SketchManager.SetSketchPoint(-(m_partData->Dim.H - chamferHeight), m_partData->Dim.C1 * 0.5); //2
    pts[2] = m_IFC->SketchManager.SetSketchPoint(-m_partData->Dim.H, m_partData->Dim.C1 * 0.5);

    /* m_IFC->SetSketchLine2d(pts[0], pts[1]);
       m_IFC->SetSketchLine2d(pts[1], pts[2]);
       m_IFC->SetSketchLine2d(pts[2], pts[0]);*/
    m_IFC->SketchManager.CreateSketchLine(pts[0], pts[1]);
    m_IFC->SketchManager.CreateSketchLine(pts[1], pts[2]);
    m_IFC->SketchManager.CreateSketchLine(pts[2], pts[0]);

    //m_IFC->CreateRevolveFeature(m_IFC->GetWorkAxis(2), true);
    m_IFC->SetSolidProfile();
    CiWorkAxis oAxis2Line = m_IFC->WGManager.GetBaseAxis(CiBaseDirectionEnum::Y);
    CiRevolveFeature ferralSCcut = m_IFC->FeatureManager.CreateRevolve(oAxis2Line, CiJoinOpEnum::Cut);

    return S_OK;
}

//=========================================================================
// 4. 선택적 피처 (옵션별)
//=========================================================================

void BoltCreator::CreateOptionalFeatures(CiPart* m_IFC)
{
    // 자리붙이 (플랜지)
    if (m_options.hasFlange && m_options.headType != BoltHeadType::HexFlange)
    {
        CreateFlangeFeature(m_IFC);
    }

    // 와셔 일체형
    if (m_options.hasWasher)
    {
        CreateIntegratedWasher(m_IFC);
    }
}

HRESULT BoltCreator::CreateFlangeFeature(CiPart* m_IFC)
{
    using namespace BoltConstants;

    const double boltSize = m_partData->Dim.M;
    if (boltSize >= (m_unit * FLANGE_MAX_SIZE) ||
        boltSize <= (m_unit * FLANGE_MIN_SIZE))
    {
        return S_FALSE;
    }

    //m_IFC->CreateSkecthPlanWorkPlanBase(CinvFeaCrt::kXZ);
    CiWorkPlane xzPlane =m_IFC->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ); //XZ 평면 생성
   m_IFC->SketchManager.StartSketch(xzPlane); //이 평면에 스케치 시작

    //acInv::Point2dPtr center = m_IFC->GetPoint2d(0, 0);
    CiSketchPoint pCenter =m_IFC->SketchManager.SetSketchPoint(0, 0);

    //m_IFC->SetSketchCircle2d(center, m_partData->Dim.S * 0.5);
    //m_IFC->SetSketchCircle2d(center, m_partData->Dim.C1 * 0.5);
   m_IFC->SketchManager.CreateSketchCircle(m_partData->Dim.S * 0.5, pCenter);

    //m_IFC->CreateExtrudeFeature(m_partData->Dim.hh, -1, true);
    CiExtrudeFeature pFlang =m_IFC->FeatureManager.CreateExtrude(m_partData->Dim.hh, CiDirectionOpEnum::Negative, CiJoinOpEnum::Join, true); //돌출   Positive

    return S_OK;
}

HRESULT BoltCreator::CreateIntegratedWasher(CiPart* m_IFC)
{
    //// 머리 아래 와셔 형상 추가
    //m_IFC->CreateSkecthPlanWorkPlanBase(CinvFeaCrt::kXZ);
    //acInv::Point2dPtr center = m_IFC->GetPoint2d(0, 0);

    //const double washerOD = m_partData->Dim.M * 2.0;
    //const double washerID = m_partData->Dim.M * 1.1;
    //const double washerThk = m_partData->Dim.M * 0.15;

    //m_IFC->SetSketchCircle2d(center, washerOD / 2.0);
    //m_IFC->SetSketchCircle2d(center, washerID / 2.0);
    //m_IFC->CreateExtrudeFeature(washerThk, 1);  // 양방향

    return S_OK;
}

//=========================================================================
// 5. 나사산 생성 (공통)
//=========================================================================

HRESULT BoltCreator::CreateThread(std::map<std::string, std::string>& pDim, CiPart* m_IFC)
{
    using namespace BoltConstants;

    const double pFgz = m_options.endType == BoltEndType::Pointed ? 2 : m_options.endType == BoltEndType::Rough ? 0 : 1;

    const double rayRadius = m_partData->Dim.M * RAY_RADIUS_RATIO;
    const double faceZ = m_partData->Dim.Length - (m_partData->Dim.z * 2.0);
    const double edgeZ = m_partData->Dim.Length - (m_partData->Dim.z * pFgz);

    //acInv::FacePtr face = m_IFC->SelectByRayFace(0, faceZ, rayRadius, 0, 0, -1, RAY_TOLERANCE);
    //acInv::EdgePtr edge = m_IFC->SelectByRayEdge(0, edgeZ, rayRadius, 0, 0, -1, RAY_TOLERANCE);

    CiPoint cfpos(0,faceZ, rayRadius); //(X,Y,Z)
    CiVector cfdir(0, 0, -1); 
    CiFace  face =m_IFC->SelectByRayFace(cfpos, cfdir);

    CiPoint cepos(0,edgeZ, rayRadius);
    CiVector cedir(0, 0, -1);
    CiEdge  oEdgeL =m_IFC->SelectByRayEdge(cepos, cedir);// , 0.001);

    if (!face.Get() || !oEdgeL.Get())
        return E_FAIL;

//    std::wstring pitch = Utf8ToWide(GetValue(pDim, WideToUtf8(L"P1(UNC)")));
    ATL::CString threadSpec;
    threadSpec.Format(_T("%sx%s"), m_partData->Info.Size, FormatDouble(m_ScreTypeValue * m_unit));// pitch.c_str());

    double threadLen = 0;
    double dLs = m_partData->Dim.Ls_125;   // 해당 부분은 체크요 어떨때 Ls / 어떨때 Ls_125
    if (dLs <= 0)
        dLs = m_partData->Dim.Ls;

    threadLen = (dLs - m_partData->Dim.z);//  CreateThread() 함수내에서 곱하기 10을 하기에...  *THREAD_LENGTH_SCALE; 을 하지 않아도 된다.
    //m_IFC->CreateThreadFeature(face, edge, threadSpec, threadLen);
    m_IFC->FeatureManager.CreateThread(face, oEdgeL, threadSpec, threadLen);

    return S_OK;
}

//=========================================================================
// 6. 재질 적용 (공통)
//=========================================================================

void BoltCreator::ApplyMaterial(CiPart* m_IFC)
{
    auto it = g_MaterialMap.find(m_partData->Info.Material);
    if (it != g_MaterialMap.end())
    {
        //m_IFC->SetMaterialSolid(it->second);
       m_IFC->SetMaterial(it->second);
    }
}

//=========================================================================
// 헬퍼 함수들
//=========================================================================

// 둥근끝 끝단 프로파일
CiSketchLine BoltCreator::CreateRoundedEndProfile(double z, CiPart* m_IFC)
{
     const double endR = (m_partData->Dim.M * m_partData->Dim.M + 4.0 * z * z) / (8.0 * z);
   
    CiSketchPoint pts[5];
    pts[0] =m_IFC->SketchManager.SetSketchPoint(0, 0);
    if (m_partData->Dim.r == 0) {
        pts[1] = m_IFC->SketchManager.SetSketchPoint(0, m_partData->Dim.M * 0.5);
        pts[2] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.Length - z, m_partData->Dim.M * 0.5);
        pts[3] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.Length, 0);
    }
    else {
        pts[1] = m_IFC->SketchManager.SetSketchPoint(0, m_partData->Dim.M * 0.5 + m_partData->Dim.r);
        pts[2] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.r, m_partData->Dim.M * 0.5);
        pts[3] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.Length - z, m_partData->Dim.M * 0.5);
        pts[4] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.Length, 0);
    }
    auto leftArc =m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.r, m_partData->Dim.M * 0.5 + m_partData->Dim.r);
    auto rightArc =m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.Length - endR, 0);

    if (m_partData->Dim.r == 0) {
        CiSketchLine line1 = m_IFC->SketchManager.CreateSketchLine(pts[0], pts[1]);
        CiSketchLine line2 = m_IFC->SketchManager.CreateSketchLine(pts[1], pts[2]);
        CiSketchArc arc2 = m_IFC->SketchManager.CreateSketchArc(rightArc, pts[3], pts[2]);
    }
    else {
        CiSketchLine line1 = m_IFC->SketchManager.CreateSketchLine(pts[0], pts[1]);
        CiSketchLine line2 = m_IFC->SketchManager.CreateSketchLine(pts[2], pts[3]);
        CiSketchArc arc1 = m_IFC->SketchManager.CreateSketchArc(leftArc, pts[1], pts[2]);
        CiSketchArc arc2 = m_IFC->SketchManager.CreateSketchArc(rightArc, pts[4], pts[3]);
    }
    CiSketchLine rLine = m_IFC->SketchManager.CreateSketchLine(pts[0], m_partData->Dim.r == 0 ? pts[3] : pts[4]);
    return rLine;
}

// 모따기끝 끝단 프로파일
CiSketchLine BoltCreator::CreateChamferedEndProfile(double z, CiPart* m_IFC)
{
    CiSketchPoint pts[6];
    pts[0] =m_IFC->SketchManager.SetSketchPoint(0, 0);
    if (m_partData->Dim.r == 0) {
        pts[1] = m_IFC->SketchManager.SetSketchPoint(0, m_partData->Dim.M * 0.5);
        pts[2] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.Length - z, m_partData->Dim.M * 0.5);
        pts[3] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.Length, m_partData->Dim.M * 0.5 - (z * 1.2));
        pts[4] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.Length, 0);
    } else {
    pts[1] = m_IFC->SketchManager.SetSketchPoint(0, m_partData->Dim.M * 0.5 + m_partData->Dim.r);
    pts[2] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.r, m_partData->Dim.M * 0.5);
    pts[3] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.Length - z, m_partData->Dim.M * 0.5);
    pts[4] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.Length, m_partData->Dim.M * 0.5 - (z * 1.2));
    pts[5] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.Length, 0);
    }
    auto leftArc =m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.r, m_partData->Dim.M * 0.5 + m_partData->Dim.r);

    if (m_partData->Dim.r == 0) {
        m_IFC->SketchManager.CreateSketchLine(pts[0], pts[1]);
        m_IFC->SketchManager.CreateSketchLine(pts[1], pts[2]);
        m_IFC->SketchManager.CreateSketchLine(pts[2], pts[3]);
        m_IFC->SketchManager.CreateSketchLine(pts[3], pts[4]);
    }
    else {
        m_IFC->SketchManager.CreateSketchLine(pts[0], pts[1]);
        m_IFC->SketchManager.CreateSketchLine(pts[2], pts[3]);
        m_IFC->SketchManager.CreateSketchLine(pts[3], pts[4]);
        m_IFC->SketchManager.CreateSketchLine(pts[4], pts[5]);
        m_IFC->SketchManager.CreateSketchArc(leftArc, pts[1], pts[2]);
    }
   CiSketchLine rLine =m_IFC->SketchManager.CreateSketchLine(pts[0], m_partData->Dim.r == 0 ? pts[4] : pts[5]);
   return rLine;
}

// 납작끝 끝단 프로파일
CiSketchLine BoltCreator::CreateFlatEndProfile(double z, CiPart* m_IFC)
{
    CiSketchPoint pts[6];
    pts[0] = m_IFC->SketchManager.SetSketchPoint(0, 0);
    if (m_partData->Dim.r == 0) {
        pts[1] = m_IFC->SketchManager.SetSketchPoint(0, m_partData->Dim.M * 0.5);
        pts[2] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.Length - z, m_partData->Dim.M * 0.5);
        pts[3] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.Length, m_partData->Dim.M * 0.5 - z);
        pts[4] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.Length, 0);
    }
    else {
        pts[1] = m_IFC->SketchManager.SetSketchPoint(0, m_partData->Dim.M * 0.5 + m_partData->Dim.r);
        pts[2] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.r, m_partData->Dim.M * 0.5);
        pts[3] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.Length - z, m_partData->Dim.M * 0.5);
        pts[4] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.Length, m_partData->Dim.M * 0.5 - z);
        pts[5] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.Length, 0);
    }
    auto leftArc = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.r, m_partData->Dim.M * 0.5 + m_partData->Dim.r);

    if (m_partData->Dim.r == 0) {
        m_IFC->SketchManager.CreateSketchLine(pts[0], pts[1]);
        m_IFC->SketchManager.CreateSketchLine(pts[1], pts[2]);
        m_IFC->SketchManager.CreateSketchLine(pts[2], pts[3]);
        m_IFC->SketchManager.CreateSketchLine(pts[3], pts[4]);
    }
    else {
        m_IFC->SketchManager.CreateSketchLine(pts[0], pts[1]);
        m_IFC->SketchManager.CreateSketchLine(pts[2], pts[3]);
        m_IFC->SketchManager.CreateSketchLine(pts[3], pts[4]);
        m_IFC->SketchManager.CreateSketchLine(pts[4], pts[5]);
        m_IFC->SketchManager.CreateSketchArc(leftArc, pts[1], pts[2]);
    }
    CiSketchLine rLine = m_IFC->SketchManager.CreateSketchLine(pts[0], m_partData->Dim.r == 0 ? pts[4] : pts[5]);
    return rLine;
}

// 오목끝 끝단 프로파일
CiSketchLine BoltCreator::CreateConcavePointProfile(double z, CiPart* m_IFC)
{
    CiSketchPoint pts[6];
    pts[0] = m_IFC->SketchManager.SetSketchPoint(0, 0);
    if (m_partData->Dim.r == 0) {
        pts[1] = m_IFC->SketchManager.SetSketchPoint(0, m_partData->Dim.M * 0.5);
        pts[2] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.Length - z, m_partData->Dim.M * 0.5);
        pts[3] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.Length, m_partData->Dim.M * 0.5 - (z * 1.2));
        pts[4] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.Length - z, 0);
    }
    else {
        pts[1] = m_IFC->SketchManager.SetSketchPoint(0, m_partData->Dim.M * 0.5 + m_partData->Dim.r);
        pts[2] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.r, m_partData->Dim.M * 0.5);
        pts[3] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.Length - z, m_partData->Dim.M * 0.5);
        pts[4] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.Length, m_partData->Dim.M * 0.5 - (z * 1.2));
        pts[5] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.Length - z, 0);       
    }
    auto leftArc = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.r, m_partData->Dim.M * 0.5 + m_partData->Dim.r);

    if (m_partData->Dim.r == 0) {
        m_IFC->SketchManager.CreateSketchLine(pts[0], pts[1]);
        m_IFC->SketchManager.CreateSketchLine(pts[1], pts[2]);
        m_IFC->SketchManager.CreateSketchLine(pts[2], pts[3]);
        m_IFC->SketchManager.CreateSketchLine(pts[3], pts[4]);
    }
    else {
        m_IFC->SketchManager.CreateSketchLine(pts[0], pts[1]);
        m_IFC->SketchManager.CreateSketchLine(pts[2], pts[3]);
        m_IFC->SketchManager.CreateSketchLine(pts[3], pts[4]);
        m_IFC->SketchManager.CreateSketchLine(pts[4], pts[5]);
        m_IFC->SketchManager.CreateSketchArc(leftArc, pts[1], pts[2]);
    }
    CiSketchLine rLine = m_IFC->SketchManager.CreateSketchLine(pts[0], m_partData->Dim.r == 0 ? pts[4] : pts[5]);
    return rLine;
}

// 거친끝 끝단 프로파일
CiSketchLine BoltCreator::CreateRoughEndProfile(CiPart* m_IFC)
{
    CiSketchPoint pts[5];
    pts[0] = m_IFC->SketchManager.SetSketchPoint(0, 0);
    if (m_partData->Dim.r == 0) {
        pts[1] = m_IFC->SketchManager.SetSketchPoint(0, m_partData->Dim.M * 0.5 + m_partData->Dim.r);
        pts[2] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.Length, m_partData->Dim.M * 0.5);
        pts[3] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.Length, 0);
    }
    else {
        pts[1] = m_IFC->SketchManager.SetSketchPoint(0, m_partData->Dim.M * 0.5 + m_partData->Dim.r);
        pts[2] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.r, m_partData->Dim.M * 0.5);
        pts[3] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.Length, m_partData->Dim.M * 0.5);
        pts[4] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.Length, 0);
    }
    auto leftArc = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.r, m_partData->Dim.M * 0.5 + m_partData->Dim.r);

    if (m_partData->Dim.r == 0) {
        m_IFC->SketchManager.CreateSketchLine(pts[0], pts[1]);
        m_IFC->SketchManager.CreateSketchLine(pts[1], pts[2]);
        m_IFC->SketchManager.CreateSketchLine(pts[2], pts[3]);
    }
    else {
        m_IFC->SketchManager.CreateSketchLine(pts[0], pts[1]);
        m_IFC->SketchManager.CreateSketchLine(pts[2], pts[3]);
        m_IFC->SketchManager.CreateSketchLine(pts[3], pts[4]);
        m_IFC->SketchManager.CreateSketchArc(leftArc, pts[1], pts[2]);
    }
    CiSketchLine rLine = m_IFC->SketchManager.CreateSketchLine(pts[0], m_partData->Dim.r == 0 ? pts[3] : pts[4]);
    return rLine;
}

// 뾰족끝 끝단 프로파일
CiSketchLine BoltCreator::CreatePointedEndProfile(double z, CiPart* m_IFC)
{
    CiSketchPoint pts[6];
    pts[0] = m_IFC->SketchManager.SetSketchPoint(0, 0);
    if (m_partData->Dim.r == 0) {
        pts[1] = m_IFC->SketchManager.SetSketchPoint(0, m_partData->Dim.M * 0.5);
        pts[2] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.Length - (z * 2.0), m_partData->Dim.M * 0.5);
        pts[3] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.Length, m_partData->Dim.M * 0.5 - (z * 2));
        pts[4] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.Length, 0);
    }
    else {
        pts[1] = m_IFC->SketchManager.SetSketchPoint(0, m_partData->Dim.M * 0.5 + m_partData->Dim.r);
        pts[2] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.r, m_partData->Dim.M * 0.5);
        pts[3] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.Length - (z * 2.0), m_partData->Dim.M * 0.5);
        pts[4] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.Length, m_partData->Dim.M * 0.5 - (z * 2));
        pts[5] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.Length, 0);
    }
    auto leftArc = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.r, m_partData->Dim.M * 0.5 + m_partData->Dim.r);

    if (m_partData->Dim.r == 0) {
        m_IFC->SketchManager.CreateSketchLine(pts[0], pts[1]);
        m_IFC->SketchManager.CreateSketchLine(pts[1], pts[2]);
        m_IFC->SketchManager.CreateSketchLine(pts[2], pts[3]);
        m_IFC->SketchManager.CreateSketchLine(pts[3], pts[4]);
    }
    else {
        m_IFC->SketchManager.CreateSketchLine(pts[0], pts[1]);
        m_IFC->SketchManager.CreateSketchLine(pts[2], pts[3]);
        m_IFC->SketchManager.CreateSketchLine(pts[3], pts[4]);
        m_IFC->SketchManager.CreateSketchLine(pts[4], pts[5]);
        m_IFC->SketchManager.CreateSketchArc(leftArc, pts[1], pts[2]);
    }
    CiSketchLine rLine = m_IFC->SketchManager.CreateSketchLine(pts[0], m_partData->Dim.r == 0 ? pts[4] : pts[5]);
    return rLine;
}

// 막대끝 끝단 프로파일
CiSketchLine BoltCreator::CreateRodEndProfile(double z, CiPart* m_IFC)
{
    const double ConcaveDia = m_partData->Dim.M * 0.5 - z;  // 도그 직경
    const double ConcaveLen = m_partData->Dim.M - (m_partData->Dim.P1_UNC * 2);  // 도그 길이

    CiSketchPoint pts[8];
    pts[0] = m_IFC->SketchManager.SetSketchPoint(0, 0);
    if (m_partData->Dim.r == 0) {
        pts[1] = m_IFC->SketchManager.SetSketchPoint(0, m_partData->Dim.M * 0.5);
        pts[2] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.Length - z, m_partData->Dim.M * 0.5);
        pts[3] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.Length, ConcaveDia);
        pts[4] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.Length + (ConcaveLen - m_partData->Dim.r), ConcaveDia);
        pts[5] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.Length + ConcaveLen, ConcaveDia - m_partData->Dim.r);
        pts[6] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.Length + ConcaveLen, 0);
    }
    else {
        pts[1] = m_IFC->SketchManager.SetSketchPoint(0, m_partData->Dim.M * 0.5 + m_partData->Dim.r);
        pts[2] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.r, m_partData->Dim.M * 0.5);
        pts[3] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.Length - z, m_partData->Dim.M * 0.5);
        pts[4] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.Length, ConcaveDia);
        pts[5] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.Length + (ConcaveLen - m_partData->Dim.r), ConcaveDia);
        pts[6] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.Length + ConcaveLen, ConcaveDia - m_partData->Dim.r);
        pts[7] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.Length + ConcaveLen, 0);
    }
    auto leftArc = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.r, m_partData->Dim.M * 0.5 + m_partData->Dim.r);
    auto rightArc = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.Length + (ConcaveLen - m_partData->Dim.r), ConcaveDia - m_partData->Dim.r );
    
    if (m_partData->Dim.r == 0) {
        m_IFC->SketchManager.CreateSketchLine(pts[0], pts[1]);
        m_IFC->SketchManager.CreateSketchLine(pts[1], pts[2]);
        m_IFC->SketchManager.CreateSketchLine(pts[2], pts[3]);
        m_IFC->SketchManager.CreateSketchLine(pts[3], pts[4]);
        m_IFC->SketchManager.CreateSketchLine(pts[5], pts[6]);
        m_IFC->SketchManager.CreateSketchArc(rightArc, pts[5], pts[4]);
    }
    else {
        m_IFC->SketchManager.CreateSketchLine(pts[0], pts[1]);
        m_IFC->SketchManager.CreateSketchLine(pts[2], pts[3]);
        m_IFC->SketchManager.CreateSketchLine(pts[3], pts[4]);
        m_IFC->SketchManager.CreateSketchLine(pts[4], pts[5]);
        m_IFC->SketchManager.CreateSketchLine(pts[6], pts[7]);
        m_IFC->SketchManager.CreateSketchArc(leftArc, pts[1], pts[2]);
        m_IFC->SketchManager.CreateSketchArc(rightArc, pts[6], pts[5]);
    }
    CiSketchLine rLine = m_IFC->SketchManager.CreateSketchLine(pts[0], m_partData->Dim.r == 0 ? pts[6] : pts[7]);
    return  rLine;  
}

// 반막대끝 끝단 프로파일
CiSketchLine BoltCreator::CreateHalfRodEndProfile(double z, CiPart* m_IFC)
{
    const double ConcaveDia = m_partData->Dim.M * 0.5 - z;  // 도그 직경
    const double ConcaveLen = (m_partData->Dim.M - (m_partData->Dim.P1_UNC * 2)) / 2;  // 도그 길이

    CiSketchPoint pts[8];
    pts[0] = m_IFC->SketchManager.SetSketchPoint(0, 0);
    if (m_partData->Dim.r == 0) {
        pts[1] = m_IFC->SketchManager.SetSketchPoint(0, m_partData->Dim.M * 0.5);
        pts[2] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.Length - z, m_partData->Dim.M * 0.5);
        pts[3] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.Length, ConcaveDia);
        pts[4] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.Length + (ConcaveLen - m_partData->Dim.r), ConcaveDia);
        pts[5] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.Length + ConcaveLen, ConcaveDia - m_partData->Dim.r);
        pts[6] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.Length + ConcaveLen, 0);
    }
    else {
        pts[1] = m_IFC->SketchManager.SetSketchPoint(0, m_partData->Dim.M * 0.5 + m_partData->Dim.r);
        pts[2] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.r, m_partData->Dim.M * 0.5);
        pts[3] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.Length - z, m_partData->Dim.M * 0.5);
        pts[4] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.Length, ConcaveDia);
        pts[5] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.Length + (ConcaveLen - m_partData->Dim.r), ConcaveDia);
        pts[6] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.Length + ConcaveLen, ConcaveDia - m_partData->Dim.r);
        pts[7] = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.Length + ConcaveLen, 0);
    }
    auto leftArc = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.r, m_partData->Dim.M * 0.5 + m_partData->Dim.r);
    auto rightArc = m_IFC->SketchManager.SetSketchPoint(m_partData->Dim.Length + (ConcaveLen - m_partData->Dim.r), ConcaveDia - m_partData->Dim.r);

    if (m_partData->Dim.r == 0) {
        m_IFC->SketchManager.CreateSketchLine(pts[0], pts[1]);
        m_IFC->SketchManager.CreateSketchLine(pts[1], pts[2]);
        m_IFC->SketchManager.CreateSketchLine(pts[2], pts[3]);
        m_IFC->SketchManager.CreateSketchLine(pts[3], pts[4]);
        m_IFC->SketchManager.CreateSketchLine(pts[5], pts[6]);
        m_IFC->SketchManager.CreateSketchArc(rightArc, pts[5], pts[4]);
    }
    else {
        m_IFC->SketchManager.CreateSketchLine(pts[0], pts[1]);
        m_IFC->SketchManager.CreateSketchLine(pts[2], pts[3]);
        m_IFC->SketchManager.CreateSketchLine(pts[3], pts[4]);
        m_IFC->SketchManager.CreateSketchLine(pts[4], pts[5]);
        m_IFC->SketchManager.CreateSketchLine(pts[6], pts[7]);
        m_IFC->SketchManager.CreateSketchArc(leftArc, pts[1], pts[2]);
        m_IFC->SketchManager.CreateSketchArc(rightArc, pts[6], pts[5]);
    }
    CiSketchLine rLine = m_IFC->SketchManager.CreateSketchLine(pts[0], m_partData->Dim.r == 0 ? pts[6] : pts[7]);
    return  rLine; 
}

// 머리 상단 챔퍼
void BoltCreator::CreateHeadChamfer()
{
    // 필요시 구현
}

// 소켓 컷 (육각 홈)
void BoltCreator::CreateSocketCut(CiPart* m_IFC)
{
    using namespace BoltConstants;

   //m_IFC->CreateSkecthPlanWorkPlanBase(CinvFeaCrt::kXZ);
    CiWorkPlane xzPlane =m_IFC->WGManager.CreateWorkPlane(CiBasePlaneEnum::XZ); //XZ 평면 생성
   m_IFC->SketchManager.StartSketch(xzPlane); //이 평면에 스케치 시작

    //acInv::Point2dPtr center = m_IFC->GetPoint2d(0, 0);
    //acInv::Point2dPtr vertex = m_IFC->GetPoint2d(0, m_partData->Dim.S / 2.0);
    //m_IFC->AddSketchAsPolygon2d(6, center, vertex, false);// true);
    CiSketchPoint center =m_IFC->SketchManager.SetSketchPoint(0, 0);
    CiSketchPoint vertex =m_IFC->SketchManager.SetSketchPoint(0, m_partData->Dim.S / 2.0);
   m_IFC->SketchManager.CreateSketchPolygon(6, center, vertex, true);

   // m_IFC->CreateExtrudeFeature(m_partData->Dim.H * SOCKET_DEPTH_RATIO, -1, true);
   m_IFC->SetSolidProfile(); //스케치로부터 피쳐에 적용할 프로필을 추출
    CiExtrudeFeature pPip =m_IFC->FeatureManager.CreateExtrude(m_partData->Dim.H * SOCKET_DEPTH_RATIO, CiDirectionOpEnum::Negative, CiJoinOpEnum::Join,true); //돌출
}

// 2D 점 구조체 (계산용)
struct Point2D { double x, y; };

// 드라이버 슬롯 (십자/일자)
void BoltCreator::CreateDriverSlot(CiPart* m_IFC)
{
    // 십자홈 또는 일자홈 구현
    // 실제 구현은 볼트 규격에 따라 다름


    
    
    // 별 렌치
    // 1. Torx 규격 비율 설정 (일반적인 T규격 비율 근사치)
    // - MajorDiameter: 대변 (팁 끝에서 끝까지 거리)
    double R_out = m_partData->Dim.B1 / 2.0;         // 외경 반지름
    double R_in = R_out * 0.72;                // 내경 반지름 (약 72%)
    double r_tip = R_out * 0.22;                // 팁의 둥근 반경
    double r_valley = R_out * 0.22;             // 안쪽의 둥근 반경 (팁과 유사하게 설정)

    // 2. 중심점 계산을 위한 거리
    // 팁 원호 중심은 원점에서 (R_out - r_tip) 거리에 있음
    double centerDist_Tip = R_out - r_tip;
    // 밸리 원호 중심은 원점에서 (R_in + r_valley) 거리에 있음
    double centerDist_Valley = R_in + r_valley;

    // 스케치 포인트들을 담을 벡터
    // 6개의 팁 + 6개의 밸리 = 12개의 연결 구간
    // 각 구간마다 (중심점, 시작점, 끝점)이 필요함

    // 교차점(접점)을 저장할 배열
    // intersectionPoints[0] = 0번 팁과 0번 밸리 사이의 점
    Point2D intersections[12];

    // 3. 교차점(Tangent Point) 계산
    // 팁 중심(TipCenter)과 밸리 중심(ValleyCenter) 사이의 거리를 구하고,
    // 두 원(팁원, 밸리원)의 교점을 구해야 정확하지만, 
    // 시각적 구현을 위해 각도 분할 방식(Angular Approximation)을 사용합니다.
    // Torx는 대칭형이므로 30도(PI/6) 단위로 반복됩니다.

    // 팁의 유효 각도 범위 (예: 중심 기준 +/- 10도)
    double tipHalfAngle = DEG2RAD(12.0);

    if (m_options.headTypeOption == SpecHeadTypeOption::Slotted) {
        CreateSocketCut(m_IFC);
    }
    else if (m_options.headTypeOption == SpecHeadTypeOption::Phillips) {
        CreateSocketCut(m_IFC);
    }
    else if (m_options.headTypeOption == SpecHeadTypeOption::Hex) {
        CreateSocketCut(m_IFC);
    }
    else
    {
        for (int i = 0; i < 6; ++i)
        {
            double baseAngle = i * (M_PI / 3.0); // 0, 60, 120... (60도 간격)
            double nextBaseAngle = (i + 1) * (M_PI / 3.0);

            // --- 팁(Tip) 원호 생성 ---
            // 팁 원호의 중심 좌표
            double tcX = centerDist_Tip * cos(baseAngle);
            double tcY = centerDist_Tip * sin(baseAngle);
            auto tipCenter = m_IFC->SketchManager.SetSketchPoint(tcX, tcY);

            // 팁 원호의 시작/끝 점 (로컬 좌표계에서 회전)
            // 시작점: baseAngle - tipHalfAngle
            // 끝점:   baseAngle + tipHalfAngle
            double tStartAngle = baseAngle - tipHalfAngle;
            double tEndAngle = baseAngle + tipHalfAngle;

            // 좌표 계산
            double tsX = tcX + r_tip * cos(tStartAngle);
            double tsY = tcY + r_tip * sin(tStartAngle);
            double teX = tcX + r_tip * cos(tEndAngle);
            double teY = tcY + r_tip * sin(tEndAngle);

            auto ptTipStart = m_IFC->SketchManager.SetSketchPoint(tsX, tsY);
            auto ptTipEnd = m_IFC->SketchManager.SetSketchPoint(teX, teY);

            // 팁 원호 그리기 (볼록)
            // 주의: CreateSketchArc의 파라미터 순서가 (Center, Start, End) 인지 확인 필요
            // 반시계 방향 그리기를 가정 (Start -> End)
            m_IFC->SketchManager.CreateSketchArc(tipCenter, ptTipStart, ptTipEnd);


            // --- 밸리(Valley) 원호 생성 ---
            // 밸리(오목한 부분)는 현재 팁과 다음 팁 사이에 위치 (30도 더 돌아간 곳)
            double valleyAngle = baseAngle + (M_PI / 6.0); // 30, 90, 150...

            // 밸리 원호의 중심 좌표 (외부에 중심이 있음 -> 오목)
            // 오목한 호를 그리려면 중심이 형상 바깥쪽에 위치해야 함
            double vcX = centerDist_Valley * cos(valleyAngle);
            double vcY = centerDist_Valley * sin(valleyAngle);
            auto valleyCenter = m_IFC->SketchManager.SetSketchPoint(vcX, vcY);

            // 밸리 원호는 "현재 팁의 끝점"에서 시작하여 "다음 팁의 시작점"으로 연결되어야 함
            // 다음 팁의 시작점 계산
            double nextTipAngle = nextBaseAngle;
            double ntStartX_local = centerDist_Tip * cos(nextTipAngle) + r_tip * cos(nextTipAngle - tipHalfAngle);
            double ntStartY_local = centerDist_Tip * sin(nextTipAngle) + r_tip * sin(nextTipAngle - tipHalfAngle);

            auto ptNextTipStart = m_IFC->SketchManager.SetSketchPoint(ntStartX_local, ntStartY_local);

            // 밸리 원호 그리기 (오목)
            // 연결: (현재 팁의 끝점) -> (다음 팁의 시작점)
            // 중심점: valleyCenter
            // 방향: 반시계 방향
            m_IFC->SketchManager.CreateSketchArc(valleyCenter, ptTipEnd, ptNextTipStart);
        }
    }

    
}

ATL::CString BoltCreator::FormatDouble(double value)
{
    ATL::CString str;
    str.Format(_T("%.10f"), value);   // 충분히 큰 precision

    // 뒤의 0 제거
    str.TrimRight(_T('0'));

    // 소수점만 남았으면 제거
    str.TrimRight(_T('.'));

    return str;
}

void BoltCreator::SetHeadType()
{
    ATL::CString strParcode = _T("");
    strParcode.Format(_T("%s"), m_partData->Info.PartCode);

    if (strParcode.Trim() == _T("HSBOLT"))  //육각구멍볼트
        m_options.headType = BoltHeadType::Socket;
    else   if (strParcode.Trim() == _T("SQBOLT"))   // 사각볼트
        m_options.headType = BoltHeadType::Square;
    else   if (strParcode.Trim() == _T("TBOLT"))    //T홈볼트
        m_options.headType = BoltHeadType::TSlot;
    else   if (strParcode.Trim() == _T("FBOLT"))  // 접시머리
        m_options.headType = BoltHeadType::Countersunk;
    else   if (strParcode.Trim() == _T("WBOLT"))  // 나비볼트
        m_options.headType = BoltHeadType::Wing;   
    else   if (strParcode.Trim() == _T("EBOLT"))   // 아이볼트
        m_options.headType = BoltHeadType::Eye;  
    else   if (strParcode.Trim() == _T("UBOLT"))   // U 볼트
        m_options.headType = BoltHeadType::UBolt;
    else   if (strParcode.Trim() == _T("FLBOLT"))   // 플랜지볼트
        m_options.headType = BoltHeadType::HexFlange;
    else   if (strParcode.Trim() == _T("FDBOLT"))   // 기초볼트
        m_options.headType = BoltHeadType::Found;
    else   if (strParcode.Trim() == _T("HGBOLT"))   // 힌지 볼트
        m_options.headType = BoltHeadType::Hinge;
    else   if (strParcode.Trim() == _T("KNBOLT"))   // 노크 볼트
        m_options.headType = BoltHeadType::Knock;
    else   if (strParcode.Trim() == _T("SDBOLT"))   // 숄더 볼트
        m_options.headType = BoltHeadType::Should;
    else   if (strParcode.Trim() == _T("TBBOLT"))   // 턴버클
        m_options.headType = BoltHeadType::Turnb;
    else   if (strParcode.Trim() == _T("ACBOLT"))   // 앙카 볼트
        m_options.headType = BoltHeadType::Anchor;
    else   if (strParcode.Trim() == _T("SMBOLT"))   // 샘스 볼트
        m_options.headType = BoltHeadType::Sems;
    else   if (strParcode.Trim() == _T("PUBOLT"))   // 관용 볼트
        m_options.headType = BoltHeadType::Piping;
    else
        m_options.headType = BoltHeadType::Hex;

}

void BoltCreator::SetBoltOption()
{
    ATL::CString strBoltEnd = _T("");
    strBoltEnd.Format(_T("%s"), m_partData->Info.BoltEnd);
    if (strBoltEnd.Trim() == _T("거친끝"))
        m_options.endType = BoltEndType::Rough;
    else if(strBoltEnd.Trim() == _T("모따기끝"))
        m_options.endType = BoltEndType::Chamfered;
    else if (strBoltEnd.Trim() == _T("납작끝"))
        m_options.endType = BoltEndType::Flat;
    else if (strBoltEnd.Trim() == _T("둥근끝"))
        m_options.endType = BoltEndType::Rounded;
    else if (strBoltEnd.Trim() == _T("오목끝"))
        m_options.endType = BoltEndType::Concave;
    else if (strBoltEnd.Trim() == _T("뾰족끝"))
        m_options.endType = BoltEndType::Pointed;
    else if (strBoltEnd.Trim() == _T("막대끝"))
        m_options.endType = BoltEndType::Rod;
    else if (strBoltEnd.Trim() == _T("반막대끝"))
        m_options.endType = BoltEndType::HalfRod;
}

void BoltCreator::SetHeadTypeOption()
{
    m_options.headTypeOption = HeadTypeOption(m_partData->Info.HeadType);
}
