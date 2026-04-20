/**
 * @file 3D볼트작도_통합시스템.cpp
 * @brief 통합 볼트 생성 시스템 - 모든 볼트 타입을 단일 흐름으로 처리
 *
 * 설계 원칙:
 *   - 단일 진입점 (CreateBolt)으로 모든 볼트 타입 생성
 *   - 공통 로직은 재사용, 볼트별 특수 사항만 조건 분기
 *   - 새로운 볼트 타입 추가 시 최소한의 수정
 */
#pragma once
#include <memory>
#include <unordered_map>
#include <functional>
#include "../Common/NewUI/PartData.h"
#if defined(SDWORKS)
#include "../DrawSolidworks/CiItems.h"
#elif defined(ZW3D)
#include "../DrawZW3D/CiItems.h"
#else
#include "../DrawInventor/CiItems.h"
#endif  
//#include "../DrawInventor/ciUtilFeatureCreateInventor.h"
using namespace PartManagerIPC;

 //=============================================================================
 // 볼트 타입 및 옵션 정의
 //=============================================================================

 /**
  * @brief 볼트 머리 타입
  */
enum class BoltHeadType
{
    Hex,            // 육각머리 (KS B 1002)
    HexFlange,      // 플랜지 육각머리
    Socket,         // 소켓헤드/육각구멍 (KS B 1003)
    Button,         // 버튼헤드 (KS B 1024)
    Countersunk,    // 접시머리 (KS B 1005)
    Pan,            // 냄비머리
    Round,          // 둥근머리
    Cheese,         // 치즈머리
    TSlot,          // T홈볼트
    Eye,            // 아이볼트
    Wing,         // 나비볼트
    UBolt,          // U볼트
    Stud,            // 스터드볼트 (머리 없음)
    Square,       // 정사각머리
    Found,       // 기초볼트
    Hinge,       // 힌지볼트
    Knock,       // 노크볼트
    Should,       // 숄더볼트
    Turnb,       // 턴버클
    Anchor,       // 앙카볼트
    Sems,       // 샘스볼트
    Piping       // 관용볼트
};
/**
 * @brief 볼트 끝단 형상
 */
enum class BoltEndType
{
    Rough,          // 거친끝 (가공 안 된 절단면)
    Chamfered,      // 모따기끝 (Chamfer, C)
    Flat,                 // 납작끝 (Flat, F)
    Rounded,        // 둥근끝 (Rounded, R)
    Concave,        // 오목끝 (Dog point 계열)
    Pointed,        // 뾰족끝 (Cone / Point)
    Rod,               // 막대끝 (Rod end / Full dog)
    HalfRod         // 반막대끝 (Half dog point)
};

/**
 * @brief 볼트 생성 옵션 구조체
 */
struct BoltOptions
{
    BoltHeadType    headType = BoltHeadType::Hex;
    BoltEndType     endType; // = BoltEndType::Flat;
    SpecHeadTypeOption headTypeOption;
    bool            hasFlange = false;        // 자리붙이 여부
    bool            hasWasher = false;        // 와셔 일체형 여부
    bool            isFullThread = false;       // 전산볼트 여부
    double          customLength = 0.0;         // 커스텀 길이 (0이면 표준)
};

//=============================================================================
// 상수 정의
//=============================================================================

namespace BoltConstants
{
    // 기하학적 상수
    constexpr double CHAMFER_25_DEG_FACTOR = 1.8;       // tan(25°) = tan(45°/1.8)
    constexpr double CHAMFER_30_DEG_FACTOR = 1.5;       // tan(30°) = tan(45°/1.5)
    constexpr double CHAMFER_45_DEG = 1.0;                        // tan(45°) = 1.0
    constexpr double SOCKET_DEPTH_RATIO = 0.5;                // 소켓 깊이 = 머리높이 * 0.5
    constexpr double COUNTERSUNK_ANGLE = 90.0;             // 접시머리 각도

    // 레이 캐스트
    constexpr double RAY_RADIUS_RATIO = 0.8;
    constexpr double RAY_TOLERANCE = 0.001;

    // 나사부
    constexpr double THREAD_PITCH_MULT = 2.0;
    constexpr double THREAD_LENGTH_SCALE = 10.0;

    // 플랜지 크기 제한 (mm)
    constexpr double FLANGE_MIN_SIZE = 4.0;
    constexpr double FLANGE_MAX_SIZE = 27.0;
}

//=============================================================================
// 재질 매핑
//=============================================================================

static const std::unordered_map<std::wstring, const wchar_t*> g_MaterialMap = {
    // 일반강
    { L"S20C",   L"Steel, Mild" },
    { L"SM20C",  L"Steel, Mild" },
    { L"SS41",   L"Steel, Mild" },
    { L"SS400",  L"Steel, Mild" },
    // 스테인리스
    { L"STS304", L"Stainless Steel" },
    { L"STS316", L"Stainless Steel" },
    // 합금강
    { L"SCM435", L"Alloy Steel" },
    { L"SCM440", L"Alloy Steel" },
    // 황동
    { L"C3604", L"Brass" },
    // 티타늄
    { L"Ti-6Al-4V", L"Titanium" }
};

//=============================================================================
// 통합 볼트 생성 클래스
//=============================================================================
class BoltCreator
{
public:

#if defined(SDWORKS)
    explicit BoltCreator(sdWrk::ISldWorksPtr& app)
        : m_pApplication(app)
    {
    }    
#elif defined(ZW3D)
    explicit BoltCreator(int app)
        : m_pApplication(app)
    {
    }
#else
    explicit BoltCreator(acInv::ApplicationPtr& app)
        : m_pApplication(app)
    {
    }
#endif

    /**
     * @brief 볼트 생성 - 단일 진입점
     * @param pDim 치수 데이터
     * @param mData 스케치 파라미터
     * @param options 볼트 옵션
     * @return 생성된 ComponentDefinition
     */
#if defined(SDWORKS)
    sdWrk::IComponent2Ptr CreateBolt(std::map<std::string, std::string>& pDim, BoltPartData& pd, double munit, const BoltOptions& options = BoltOptions());
#elif defined(ZW3D)
    CiDragComponent CreateBolt(std::map<std::string, std::string>& pDim, BoltPartData& pd, double munit, const BoltOptions& options = BoltOptions());
#else    
    acInv::ComponentDefinitionPtr CreateBolt(std::map<std::string, std::string>& pDim, BoltPartData& pd, double munit, const BoltOptions& options = BoltOptions());
#endif

private:
    //=========================================================================
    // 1. 초기화 (공통)
    //=========================================================================

    HRESULT Initialize(std::map<std::string, std::string>& pDim);

    //=========================================================================
    // 2. 나사부 몸통 생성 (공통)
    //=========================================================================

    HRESULT CreateBoltShank(CiPart* m_IFC);
   
    //=========================================================================
    // 3. 머리 형상 생성 (타입별 분기)
    //=========================================================================

    HRESULT CreateBoltHead(CiPart* m_IFC);

    //-------------------------------------------------------------------------
    // 3-1. 육각머리
    //-------------------------------------------------------------------------
    HRESULT CreateHexHead(CiPart* m_IFC);

    //-------------------------------------------------------------------------
    // 3-2. 소켓헤드 (육각구멍볼트)
    //-------------------------------------------------------------------------
    HRESULT CreateSocketHead(CiPart* m_IFC);

    //-------------------------------------------------------------------------
    // 3-3. 버튼헤드
    //-------------------------------------------------------------------------
    HRESULT CreateButtonHead(CiPart* m_IFC);

    //-------------------------------------------------------------------------
    // 3-4. 접시머리 (카운터싱크)
    //-------------------------------------------------------------------------
    HRESULT CreateCountersunkHead(CiPart* m_IFC);

    //-------------------------------------------------------------------------
    // 3-5. 냄비머리
    //-------------------------------------------------------------------------
    HRESULT CreatePanHead(CiPart* m_IFC);
        
    //-------------------------------------------------------------------------
    // 3-6. 스터드 
    HRESULT CreateStudBolt(CiPart* m_IFC);
    
    // 3-6. 둥근머리
    //-------------------------------------------------------------------------
    HRESULT CreateRoundHead(CiPart* m_IFC);

    //-------------------------------------------------------------------------
    // 3-7. U볼트
    //-------------------------------------------------------------------------
    HRESULT CreateUHead(CiPart* m_IFC);

    //-------------------------------------------------------------------------
    // 3-8. T홈볼트
    //-------------------------------------------------------------------------
    HRESULT CreateTSlotHead(CiPart* m_IFC);

    //-------------------------------------------------------------------------
    // 3-9. 아이볼트
    //-------------------------------------------------------------------------
    HRESULT CreateEyeHead(CiPart* m_IFC);

    //-------------------------------------------------------------------------
    // 3-10. 나비볼트
    //-------------------------------------------------------------------------
    HRESULT CreateWingHead(CiPart* m_IFC);

    //-------------------------------------------------------------------------
    // 3-11. 사각볼트
    //-------------------------------------------------------------------------
    HRESULT CreateSqHead(CiPart* m_IFC);

    //-------------------------------------------------------------------------
   // 3-12. 플랜지볼트
   //-------------------------------------------------------------------------
    HRESULT CreateHexFlangeHead(CiPart* m_IFC);

    //-------------------------------------------------------------------------
   // 3-13. 기초볼트
   //-------------------------------------------------------------------------
    HRESULT CreateFdHead(CiPart* m_IFC);

    //-------------------------------------------------------------------------
   // 3-14. 힌지볼트
   //-------------------------------------------------------------------------
    HRESULT CreateHgHead(CiPart* m_IFC);

    //-------------------------------------------------------------------------
   // 3-15. 노크볼트
   //-------------------------------------------------------------------------
    HRESULT CreateKnHead(CiPart* m_IFC);

    //-------------------------------------------------------------------------
   // 3-16. 숄더볼트
   //-------------------------------------------------------------------------
    HRESULT CreateSdHead(CiPart* m_IFC);

    //-------------------------------------------------------------------------
   // 3-17. 턴버클
   //-------------------------------------------------------------------------
    HRESULT CreateTbHead(CiPart* m_IFC);

    //-------------------------------------------------------------------------
   // 3-18. 앙카볼트
   //-------------------------------------------------------------------------
    HRESULT CreateAcHead(CiPart* m_IFC);

    //-------------------------------------------------------------------------
   // 3-19. 샘스볼트
   //-------------------------------------------------------------------------
    HRESULT CreateSmHead(CiPart* m_IFC);

    //-------------------------------------------------------------------------
  // 3-20. 관용볼트
  //-------------------------------------------------------------------------
    HRESULT CreatePuHead(CiPart* m_IFC);

    //=========================================================================
    // 4. 선택적 피처 (옵션별)
    //=========================================================================

    void CreateOptionalFeatures(CiPart* m_IFC);

    HRESULT CreateFlangeFeature(CiPart* m_IFC);

    HRESULT CreateIntegratedWasher(CiPart* m_IFC);

    //=========================================================================
    // 5. 나사산 생성 (공통)
    //=========================================================================

    HRESULT CreateThread(std::map<std::string, std::string>& pDim, CiPart* m_IFC);

    //=========================================================================
    // 6. 재질 적용 (공통)
    //=========================================================================

    void ApplyMaterial(CiPart* m_IFC);
        
    //=========================================================================
    // 헬퍼 함수들
    //=========================================================================

    // 라운드 끝단 프로파일
    //acInv::SketchLinePtr CreateRoundedEndProfile(double z);
    CiSketchLine CreateRoundedEndProfile(double z, CiPart* m_IFC);

    // 모따기끝 끝단 프로파일
    //acInv::SketchLinePtr CreateChamferedEndProfile(double z);
    CiSketchLine CreateChamferedEndProfile(double z, CiPart* m_IFC);

    // 납작끝 끝단 프로파일
    //acInv::SketchLinePtr CreateFlatEndProfile();
    CiSketchLine CreateFlatEndProfile(double z, CiPart* m_IFC);

    // 오목끝 끝단 프로파일
    //acInv::SketchLinePtr CreateConcavePointProfile(double z);
    CiSketchLine CreateConcavePointProfile(double z, CiPart* m_IFC);

    // 거친끝 끝단 프로파일
    CiSketchLine CreateRoughEndProfile(CiPart* m_IFC);

    // 뾰족끝 끝단 프로파일
    CiSketchLine CreatePointedEndProfile(double z, CiPart* m_IFC);

    // 막대끝 끝단 프로파일
    CiSketchLine CreateRodEndProfile(double z, CiPart* m_IFC);

    // 반막대끝 끝단 프로파일
    CiSketchLine CreateHalfRodEndProfile(double z, CiPart* m_IFC);

    // 머리 상단 챔퍼
    void CreateHeadChamfer();

    // 소켓 컷 (육각 홈)
    void CreateSocketCut(CiPart* m_IFC);

    // 드라이버 슬롯 (십자/일자)
    void CreateDriverSlot(CiPart* m_IFC);


    ATL::CString FormatDouble(double value);

    void SetHeadType();
    void SetHeadTypeOption();
    void SetBoltOption();

private:
#if defined(SDWORKS)    
    sdWrk::ISldWorksPtr& m_pApplication;
#elif  defined(ZW3D)
    int m_pApplication;
#else
    acInv::ApplicationPtr& m_pApplication;
#endif
//    std::unique_ptr<CinvFeaCrt>     m_IFC;
    BoltPartData*                   m_partData;
    BoltOptions                     m_options;
    double                          m_unit;
    double                          m_ScreTypeValue;
};

//=============================================================================
// 사용 예시
//=============================================================================

/*
// 기본 육각머리 볼트
BoltCreator creator(m_pApplication);
auto bolt = creator.CreateBolt(pDim, mData);

// 소켓헤드 볼트
BoltOptions opts;
opts.headType = BoltHeadType::Socket;
opts.endType = BoltEndType::Chamfered;
auto socketBolt = creator.CreateBolt(pDim, mData, opts);

// 플랜지 육각볼트
BoltOptions flangeOpts;
flangeOpts.headType = BoltHeadType::HexFlange;
auto flangeBolt = creator.CreateBolt(pDim, mData, flangeOpts);

// 접시머리 볼트
BoltOptions csOpts;
csOpts.headType = BoltHeadType::Countersunk;
auto csBolt = creator.CreateBolt(pDim, mData, csOpts);
*/
