/**
 * @file NewCreateShaftClass.h
 * @brief Shaft (축) 작도 시스템 - 헤더 정의
 * @note 직선축 / 단차축 / 중공축 / 테이퍼축 + 각종 추가 가공 지원
 *       BearingCreator 와 동일한 구조 패턴 적용
 */
#pragma once
#include <memory>
#include <unordered_map>
#include <functional>
#include <map>
#include <string>
#include "../Common/NewUI/PartData.h"

#if defined(SDWORKS)
#include "../DrawSolidworks/CiItems.h"
#elif defined(ZW3D)
#include "../DrawZW3D/CiItems.h"
#else
#include "../DrawInventor/CiItems.h"
#endif

using namespace PartManagerIPC;

//=============================================================================
// ShaftBodyType : 축 형상 종류
//=============================================================================
enum class ShaftBodyType
{
    Straight,   // 직선축   - 단일 직경의 원통
    Stepped,    // 단차축   - 직경 변화가 있는 다단 구조
    Hollow,     // 중공축   - 중심부에 관통 구멍
    Tapered,    // 테이퍼축 - 원뿔형 경사면
    Splined,    // 스플라인축 - 스플라인 치형 성형
    Flanged     // 플랜지축 - 끝단 일체형 플랜지
};

//=============================================================================
// ShaftSurfaceFinish : 표면 마감
//=============================================================================
enum class ShaftSurfaceFinish
{
    AsForged,       // 단조 그대로
    Rough,          // 황삭 (거친 선삭)
    Finished,       // 정삭 (일반 선삭)
    Ground,         // 연삭 (그라인딩)
    PolishedGround  // 경면 연삭
};

//=============================================================================
// ShaftEndMachiningType : 끝단 가공 종류
//=============================================================================
enum class ShaftEndMachiningType
{
    Plain,          // 평면 절단 (무 가공)
    Chamfered,      // 모따기 (일반 45도)
    OilSealChamfer, // 오일실용 모따기 (30도/2mm)
    CenterHole,     // 센터 구멍 (60도 원뿔)
    FemaleThread,   // 암나사 (탭)
    Slitting,       // 슬리팅 (일자 홈)
    SlitCam         // 슬릿 캠 (원통면 캠 궤도)
};

//=============================================================================
// ShaftKeywayType : 키 홈 종류
//=============================================================================
enum class ShaftKeywayType
{
    None,           // 없음
    Parallel_One,   // 평행 키홈 - 1곳
    Parallel_Two,   // 평행 키홈 - 2곳 (180도 대칭)
    Parallel_End,   // 평행 키홈 - 단부 (끝 0지점)
    Woodruff        // 반달(우드러프) 키홈
};

// 1. 안쪽 지지 방식
enum class ShaftInnerSupportType
{
    None,           // 없음
    Step,           // 단차 (숄더) - 직경을 키워 베어링 등을 지지하는 구조
    DRingGroove     // D부 멈춤링 홈 - 안쪽 멈춤링을 끼우기 위한 홈 가공
};

// 2. 바깥쪽 고정 방식 (고정측 가공 형태)
enum class ShaftOuterFixType
{
    None,           // 없음
    SnapRing,       // 멈춤링 - 일반적인 멈춤링 홈 가공
    MaleThread      // 수나사 - 너트 체결을 위한 나사산 가공
};

// 2-1. 바깥쪽 고정 부품 (실제 조립되는 부품)
enum class ShaftOuterFixingCompType
{
    None,           // 없음
    EndSnapRing,    // 단부 멈춤링 - 축 끝단(또는 수나사 위)에 체결되는 멈춤링
    Locknut         // 로크 너트 - 와셔와 함께 단단히 체결되는 락너트 조립
};

// 3. 키 홈 형상
enum class ShaftKeywayShapeType
{
    None,           // 없음
    Parallel,       // 평행 키 홈 - 일반적인 직선 형태의 닫힌/열린 키 홈
    Woodruff        // 반달 키 홈 - 원판 커터로 파내는 반달 모양의 키 홈
};

// 3-1. 키 홈 추가공 (가공 개수 및 위치)
enum class ShaftKeywayAddType
{
    None,           // 해당 없음
    OnePlace,       // 1곳 - D부(기본 위치)에만 단일 가공
    TwoPlaces,      // 2곳 - D부와 P부(추가 위치) 양쪽 모두 가공
    EndPlace        // 단부 - 축 끝단이 시원하게 열려있는 관통 형태로 가공
};

// 4. 평면취 (렌치 플랫 / D-Cut) 종류
enum class ShaftWrenchFlatType
{
    None,               // 없음
    OnePlace,           // 1곳 - 지정된 위치에 한쪽 면만 평면 가공 (D-Cut)
    TwoPlaces,          // 2곳 - 서로 다른 위치(D부, P부)에 각각 한쪽 면씩 가공
    End,                // 단부 - 축 끝단에 가공
    AngledTwoPlaces     // 각도 지정 2곳 - 같은 위치에서 입력된 각도(V자 형태)로 두 면 가공
};

//=============================================================================
// ShaftOptions : 전체 옵션 구조체 (BearingOptions 에 대응)
//=============================================================================
struct ShaftOptions
{
    // 축 본체 형상
    ShaftBodyType       bodyType        = ShaftBodyType::Straight;
    ShaftSurfaceFinish  surfaceFinish   = ShaftSurfaceFinish::Ground;

    bool isFixedSide = true;    // 지지방식: true(고정측), false(자유측)
    bool hasOilSeal = false;   // 밀봉 세팅: 오일 씰 추가 (30도/2mm 모따기)
    bool hasCenterHole = false;   // 센터 구멍 (60도 원뿔)
    bool hasFemaleThread = false;   // 암나사 (축 끝단 탭 가공)
    bool hasSlitting = false;   // 슬리팅 (끝단 일자 홈 컷팅)
    bool hasSlitCam = false;   // 슬릿 캠 (원통면 캠 궤도 컷팅)

    // 안쪽 지지
    ShaftInnerSupportType    innerSupport = ShaftInnerSupportType::None;
    // 바깥쪽 고정
    ShaftOuterFixType        outerFix = ShaftOuterFixType::None;
    ShaftOuterFixingCompType outerFixingComponent = ShaftOuterFixingCompType::None;
    // 키 홈
    ShaftKeywayShapeType     keywayShape = ShaftKeywayShapeType::None;
    ShaftKeywayAddType       keywayAdditional = ShaftKeywayAddType::None;
    // 스패너 평면취
    ShaftWrenchFlatType      wrenchFlat = ShaftWrenchFlatType::None;
    // 끝단 가공
    ShaftEndMachiningType endMachining = ShaftEndMachiningType::Chamfered;

    // 부자재 생성 플래그
    bool createSnapRing = false;  // 멈춤링 독립 파트 생성
    bool createLocknut  = false;  // 로크너트 독립 파트 생성

    // 중공 파라미터 (bodyType == Hollow 일 때)
    double hollowRatio  = 0.5;    // 중공비 (내경 / 외경)

    // ==========================================================
    // ★ 베어링 조립 연동 데이터 (전역 변수 대신 안전하게 전달)
    // ==========================================================
    double referenceBearingWidth = 0.0; // 조립될 베어링의 총 폭 (mm)

    // 단차 축 파라미터 (bodyType == Stepped 일 때)
    double stepRatio    = 1.25;   // 단차 외경 비율 (대경 / 기준경)
    double stepPosition = 0.75;   // 단차 시작 위치 비율 (전체 길이 대비)

    // 테이퍼 파라미터 (bodyType == Tapered 일 때)
    double taperAngleDeg = 3.0;   // 테이퍼 각도 (도, 기본 1/10 기울기 약 2.86도)

    // 플랜지 파라미터 (bodyType == Flanged 일 때)
    double flangeOD_Ratio  = 2.0;   // 플랜지 외경 / 축경 비율
    double flangeThk_Ratio = 0.25;  // 플랜지 두께 / 축경 비율
    int    flangeBoltHoles = 4;     // 플랜지 볼트 구멍 수

    // 스플라인 파라미터 (bodyType == Splined 일 때)
    int    splineTeeth      = 6;    // 스플라인 잇수
    double splineDepthRatio = 0.08; // 이 높이 / 축경 비율
};

//=============================================================================
// ShaftConstants : 축 작도 상수 네임스페이스
//=============================================================================
namespace ShaftConstants
{
    constexpr double PI = 3.14159265358979323846;

    // 연삭 틈새 (Grinding Undercut)
    constexpr double GRIND_UNDERCUT_W = 2.0;   // 폭 (mm)
    constexpr double GRIND_UNDERCUT_D = 0.3;   // 깊이 (mm)

    // 오일실 모따기
    constexpr double ORING_CHAMFER_LEN = 2.0;  // 모따기 길이 (mm)
    constexpr double ORING_CHAMFER_ANG = 30.0; // 모따기 각도 (도)

    // D부 멈춤링 홈 (Inner DRing Groove)
    constexpr double DRING_GROOVE_W = 1.35;    // 홈 폭 (mm)
    constexpr double DRING_GROOVE_D = 1.2;     // 홈 깊이 (mm)

    // 단부 멈춤링 홈 (End Snap Ring Groove)
    constexpr double SNAPRING_GROOVE_W = 1.15; // 홈 폭 (mm)
    constexpr double SNAPRING_GROOVE_D = 1.0;  // 홈 깊이 (mm)

    // 멈춤링 외경 돌출 비율
    constexpr double SNAPRING_OD_RATIO = 1.25;

    // 센터 구멍
    constexpr double CENTER_HOLE_R   = 2.5;    // 기본 반경 (mm)
    constexpr double CENTER_HOLE_ANG = 60.0;   // 원뿔 각도 (도)

    // 키홈 비율
    constexpr double KEY_WIDTH_RATIO   = 0.25; // 키폭 / 축경
    constexpr double KEY_DEPTH_RATIO   = 0.15; // 키 깊이 / 축경
    constexpr double KEY_WOODRUFF_R    = 0.40; // 반달키 반경 / 축경

    // 스패너 평면취
    constexpr double FLAT_RATIO = 0.80;        // 평면높이 / 반경

    // 로크너트
    constexpr double NUT_WIDTH_RATIO = 0.40;   // 너트폭 / 축경
    constexpr double NUT_OD_RATIO    = 1.40;   // 너트외경 / 축경
    constexpr double NUT_SLOT_W      = 4.0;    // 십자 슬롯 폭 (mm)
}

//=============================================================================
// ShaftMaterials : 재질 매핑 네임스페이스
//=============================================================================
namespace ShaftMaterials
{
    // 한국 규격 -> CAD 재질명 매핑
    static const std::unordered_map<std::wstring, const wchar_t*> MaterialMap = {
        // 기계 구조용 탄소강
        { L"SM20C",   L"Steel, Mild"   },
        { L"SM25C",   L"Steel, Mild"   },
        { L"SM35C",   L"Steel, Carbon" },
        { L"SM45C",   L"Steel, Carbon" },
        { L"SM55C",   L"Steel, Carbon" },
        // 크롬-몰리 합금강
        { L"SCM415",  L"Steel, Alloy"  },
        { L"SCM420",  L"Steel, Alloy"  },
        { L"SCM435",  L"Steel, Alloy"  },
        { L"SCM440",  L"Steel, Alloy"  },
        { L"SCM445",  L"Steel, Alloy"  },
        // 니켈-크롬-몰리
        { L"SNCM220", L"Steel, Alloy"  },
        { L"SNCM240", L"Steel, Alloy"  },
        { L"SNCM439", L"Steel, Alloy"  },
        // 스테인리스
        { L"SUS303",  L"Stainless Steel" },
        { L"SUS304",  L"Stainless Steel" },
        { L"SUS316",  L"Stainless Steel" },
        { L"SUS420J2",L"Stainless Steel" },
        // 일반 구조용
        { L"SS400",   L"Steel, Mild"   },
        { L"S45C",    L"Steel, Carbon" },
        // 알루미늄
        { L"A2024",   L"Aluminum 2024" },
        { L"A6061",   L"Aluminum 6061" },
        { L"A7075",   L"Aluminum 7075" }
    };

    inline const wchar_t* GetInventorMaterial(const std::wstring& materialCode)
    {
        auto it = MaterialMap.find(materialCode);
        if (it != MaterialMap.end()) return it->second;
        for (const auto& kv : MaterialMap)
            if (materialCode.find(kv.first) != std::wstring::npos)
                return kv.second;
        return L"Steel, Alloy"; // 기본값
    }
}

//=============================================================================
// ShaftCreator 클래스 (BearingCreator 와 동일한 패턴)
//=============================================================================
class ShaftCreator
{
public:
    // 생성자 - CAD 플랫폼별 분기
#if defined(SDWORKS)
    explicit ShaftCreator(sdWrk::ISldWorksPtr& app) : m_pApplication(app) {}
#elif defined(ZW3D)
    explicit ShaftCreator(int app) : m_pApplication(app) {}
#else
    explicit ShaftCreator(acInv::ApplicationPtr& app) : m_pApplication(app) {}
#endif

    // 공개 진입점
    /**
     * @brief 축(Shaft) 파트 생성 메인 함수
     * @param pDim    DB 에서 읽은 치수 맵 (raw string map)
     * @param pd      ConvertToShaftPartData() 로 변환한 파트 데이터
     * @param munit   단위 계수 (1.0=mm, 0.1=cm, 0.01=m)
     * @param options 형상 및 추가 가공 옵션
     * @return 생성된 컴포넌트 (플랫폼별 타입)
     */
#if defined(SDWORKS)
    sdWrk::IComponent2Ptr CreateShaft(
        std::map<std::string, std::string>& pDim,
        ShaftPartData& pd,
        double munit,
        const ShaftOptions& options = ShaftOptions(), CiAssembly* pTargetAssembly = nullptr, CiPart* outShaftPart = nullptr, CiOccurrence* outShaftOcc = nullptr);
#elif defined(ZW3D)
    CiDragComponent CreateShaft(
        std::map<std::string, std::string>& pDim,
        ShaftPartData& pd,
        double munit,
        const ShaftOptions& options = ShaftOptions(), CiAssembly* pTargetAssembly = nullptr, CiPart* outShaftPart = nullptr, CiOccurrence* outShaftOcc = nullptr);
#else
    acInv::ComponentDefinitionPtr CreateShaft(
        std::map<std::string, std::string>& pDim,
        ShaftPartData& pd,
        double munit,
        const ShaftOptions& options = ShaftOptions(), CiAssembly* pTargetAssembly = nullptr, CiPart* outShaftPart = nullptr, CiOccurrence* outShaftOcc = nullptr);
#endif

private:
    //=========================================================================
    // 1. 초기화 및 파싱
    //=========================================================================
    HRESULT Initialize(std::map<std::string, std::string>& pDim);
    void SetShaftBodyType(); // PartName 에서 형상 타입 자동 감지
    void SetShaftMaterial(); // 재질 코드 -> CAD 재질명 변환
    void SetShaftEndOptions();

    //=========================================================================
    // 2. 축 본체 생성 (형상 타입별 분기)
    //=========================================================================
    HRESULT CreateShaftBody(CiPart* pPart);

    HRESULT CreateStraightShaft(CiPart* pPart);   // 직선축
    HRESULT CreateSteppedShaft(CiPart* pPart);    // 단차축
    HRESULT CreateHollowShaft(CiPart* pPart);     // 중공축
    HRESULT CreateTaperedShaft(CiPart* pPart);    // 테이퍼축
    HRESULT CreateSplinedShaft(CiPart* pPart);    // 스플라인축
    HRESULT CreateFlangedShaft(CiPart* pPart);    // 플랜지축

    //=========================================================================
    // 3. 추가 가공
    //=========================================================================
    HRESULT Apply_InnerDRingGroove(CiPart* pPart);    // 안쪽 D부 멈춤링 홈
    HRESULT Apply_OuterSnapRingGroove(CiPart* pPart); // 바깥쪽 단부 멈춤링 홈
    HRESULT Apply_OuterFix_SnapRing(CiPart* pPart);   // 바깥쪽 단부 멈춤링 홈
    HRESULT Apply_MaleThread(CiPart* pPart);          // 수나사 / 로크너트 홈
    HRESULT Apply_OuterFix_MaleThread(CiPart* pPart); // 수나사 / 로크너트 홈
    HRESULT Apply_Keyway(CiPart* pPart);              // 평행 키홈 / 반달 키홈
    HRESULT Apply_ParallelKeyway(CiPart* pPart);      // 평행 키홈
    HRESULT Apply_WoodruffKeyway(CiPart* pPart);      // 반달 키홈
    HRESULT Apply_WrenchFlat(CiPart* pPart);          // 스패너 평면취
    HRESULT Apply_CenterHole(CiPart* pPart);          // 센터 구멍
    HRESULT Apply_FemaleThread(CiPart* pPart);        // 암나사 (탭)
    HRESULT Apply_Slitting(CiPart* pPart);            // 슬리팅
    HRESULT Apply_SlitCam(CiPart* pPart);             // 슬릿 캠
    HRESULT Apply_FlangeBoltHoles(CiPart* pPart);     // 플랜지 볼트 구멍

    //=========================================================================
    // 4. 부자재 파트 독립 생성 (어셈블리 모드)
    //=========================================================================
    HRESULT Create_Accessory_SnapRing(CiPart* pPart, ATL::CString mateName, double targetDia, bool isEndRing);
    HRESULT Create_Accessory_Locknut(CiPart* pPart);
    HRESULT Create_Accessory_LockWasher(CiPart* pPart);


    //=========================================================================
    // 5. 재질 / 색상 적용
    //=========================================================================
    void ApplyMaterial(CiPart* pPart);
    void SetFeatureColor(CiRevolveFeature& feature, ATL::CString colorName);

    //=========================================================================
    // 6. 유틸리티
    //=========================================================================
    ATL::CString FormatDouble(double value);
    inline double DegToRad(double deg) { return deg * ShaftConstants::PI / 180.0; }

    // 파생 치수 계산 헬퍼
    double GetStepRadius()    const { return (m_shaftDia / 2.0) * m_options.stepRatio; }
    double GetStepPositionX() const { return m_shaftLen * m_options.stepPosition; }
    double GetOuterGrooveX()  const { return m_shaftDia * 0.5; }
    double GetInnerSupportX() const { return m_shaftLen * 0.8; }

private:
    //=========================================================================
    // 멤버 변수
    //=========================================================================
#if defined(SDWORKS)
    sdWrk::ISldWorksPtr&   m_pApplication;
#elif defined(ZW3D)
    int                    m_pApplication;
#else
    acInv::ApplicationPtr& m_pApplication;
#endif

    ShaftPartData* m_partData;   // DB 에서 변환된 파트 데이터 포인터
    ShaftOptions   m_options;    // 현재 작도 옵션
    double         m_unit;       // 단위 배율 (내부 계산용)

    // 자주 참조하는 파생 치수 캐시
    double m_shaftDia;  // 기준 축경
    double m_shaftLen;  // 축 전체 길이
    double m_keyWidth;  // 키 홈 폭
    double m_keyDepth;  // 키 홈 깊이

    // ========================================================================
    // ★ 파싱된 치수 캐싱 변수 (모든 Apply_ 함수에서 공통 사용)
    // ========================================================================
    double m_val_d, m_val_L, m_radius;
    double m_chamfer_X, m_chamfer_Y;

    // 수나사 및 축 길이
    bool   m_hasMaleThread;
    double m_val_threadLength, m_val_threadEffectiveLength, m_val_threadOuterDia, m_thread_Radius;
    double m_base_L;
    ATL::CString m_strThreadInfo;

    // 안쪽 지지
    double m_innerSupportX;

    // 멈춤링 (D부, P부)
    double m_val_ring_offset1, m_val_ring_offset2;

    // ★ 1) 멈춤링 (축 본체용 - D부/일반 바깥쪽)
    double m_val_dRing_Width, m_val_dRing_Radius;
    double m_val_dRing_Thickness, m_val_dRing_FreeID, m_val_dRing_MaxWidth, m_val_dRing_EndWidth, m_val_dRing_HoleDia;

    // ★ 2) 멈춤링 (수나사 단부용)
    double m_val_endRing_Width, m_val_endRing_Radius;
    double m_val_endRing_Thickness, m_val_endRing_FreeID, m_val_endRing_MaxWidth, m_val_endRing_EndWidth, m_val_endRing_HoleDia;

    // 평행 키
    double m_val_pKey_Width, m_val_pKey_Depth;
    double m_val_pKey_Length, m_val_pKey_Length2;
    double m_val_pKey_offset1, m_val_pKey_offset2;

    // 반달 키
    double m_val_wKey_Radius, m_val_wKey_Width, m_val_wKey_Depth;

    // 평면취
    double m_val_wFlat_Depth, m_val_wFlat_HalfWidth;
    double m_val_wFlat_Length, m_val_wFlat_Length2;
    double m_val_wFlat_offset1, m_val_wFlat_offset2;
    double m_val_wFlat_Angle;

    // 기타 끝단 가공
    double m_val_sCam_offset2, m_val_sCam_Radius, m_val_sCam_Width;
    double m_val_slit_Width, m_val_slit_Depth;
    double m_val_ch_Radius, m_val_ch_Depth;
    double m_val_femaleThreadDia, m_val_femaleThreadDepth;
    ATL::CString m_strFemaleThreadInfo;

    ATL::CString m_cadMaterial; // CAD 시스템용 재질명
};

//=============================================================================
// 사용 예시 (Usage Examples)
//=============================================================================
/*
// 1. 기본 직선 축 (키홈 1개 + 오일실 모따기)
ShaftCreator creator(m_pApplication);
ShaftOptions opts;
opts.bodyType      = ShaftBodyType::Straight;
opts.keyway        = ShaftKeywayType::Parallel_One;
opts.hasOilSeal    = true;
auto shaft = creator.CreateShaft(pDim, pd, 1.0, opts);

// 2. 단차 축 (고정측 / D부 멈춤링 홈 + 로크너트 + 키홈 2곳)
ShaftOptions fixedOpts;
fixedOpts.bodyType      = ShaftBodyType::Stepped;
fixedOpts.isFixedSide   = true;
fixedOpts.innerSupport  = ShaftInnerSupportType::DRingGroove;
fixedOpts.outerFix      = ShaftOuterFixType::Locknut;
fixedOpts.keyway        = ShaftKeywayType::Parallel_Two;
fixedOpts.createSnapRing = true;
fixedOpts.createLocknut  = true;
auto fixedShaft = creator.CreateShaft(pDim, pd, 1.0, fixedOpts);

// 3. 중공 축 (반달 키홈 + 센터 구멍)
ShaftOptions hollowOpts;
hollowOpts.bodyType     = ShaftBodyType::Hollow;
hollowOpts.hollowRatio  = 0.4;
hollowOpts.keyway       = ShaftKeywayType::Woodruff;
hollowOpts.endMachining = ShaftEndMachiningType::CenterHole;
auto hollowShaft = creator.CreateShaft(pDim, pd, 1.0, hollowOpts);
*/
