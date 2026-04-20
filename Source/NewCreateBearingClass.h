/**
 * @file  NewCreateBearingClass.h
 * @brief Integrated Bearing Creation System
 * @note  Standard Bearings + Unit Bearings (UC/UK series)
 *
 * [리팩터링] 2026-04
 *   CreateBearing() 의 700줄 if-else 나열을 6개 헬퍼로 분리.
 *   std::function 람다 대신 멤버 함수 포인터 사용 (MSVC 호환성).
 */
#pragma once
#include <memory>
#include <unordered_map>
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
// Bearing Type Enumerations
//=============================================================================
enum class BearingType
{
    DeepGrooveBall, MaximumBall, MagnetoBall, MiniatureBall,
    AngularContactBall, UltraHighSpeedAngularContactBall,
    DoubleAngularContactBall, MatchedAngularContactBall, FourPointContactBall,
    SelfAligningBall,
    CylindricalRoller, TaperRoller, FullComplementRoller,
    SphericalRoller, NeedleRoller,
    BallScrewSupport,
    ThrustBall, ThrustRoller,
    LinearBall, Flanged,
    OilSeal, Oilless,
    UCB, UKB,
    UCP, UKP,
    UCF, UKF,
    UCFC, UKFC,
    UCFL, UKFL,
    UCFS, UKFS,
    UCT, UKT,
    UCC, UKC,
    SD, SN
};

enum class BearingSealType { Open, Shield, ShieldDouble, Seal, SealDouble, NonContact };
enum class BearingBoreType { Cylindrical, Tapered, Extended, Eccentric };
enum class HousingType     { None, PillowBlock, SquareFlange, RhombusFlange, RoundFlange,
                             Cartridge, OvalFlange, AdjustableFlange, TakeUp,
                             CartridgeCover, PlummerBlock };
enum class DualRowType     { S, DF, DB, DT };
enum class NeedleType      { Solid, DrawnCup, Gauge };
enum class NeedleRibType   { WithRib, WithoutRib };
enum class InnerUseType    { WithInner, WithoutInner };
enum class ThrustBallType  { SingleDirection, DoubleDirection,
                             DoubleAngularContact, PrecisionAngularContact };
enum class ThrustRollerType{ Cylindrical, Spherical, Needle };
enum class OilSealType     { S, D, G, SM, DM, GM, SA, DA, GA };
enum class OillessShapeType{ Sleeve, Flange, ThrustWasher, Plate, Spherical, Pin };
enum class OuterRaceType   { None, N, NR };

//=============================================================================
// ShaftEndUIOptions
//=============================================================================
struct ShaftEndUIOptions
{
    bool isFixedSide = true;
    bool hasOilSeal  = false;

    enum class InnerSupportType    { None, Step, DRingGroove }         innerSupport         = InnerSupportType::None;
    enum class OuterFixType        { None, SnapRing, MaleThread }      outerFix             = OuterFixType::None;
    enum class OuterFixingCompType { None, EndSnapRing, Locknut }      outerFixingComponent = OuterFixingCompType::None;
    enum class KeywayShapeType     { None, Parallel, Woodruff }        keywayShape          = KeywayShapeType::None;
    enum class KeywayAddType       { None, OnePlace, TwoPlaces, EndPlace } keywayAdditional = KeywayAddType::None;
    enum class WrenchFlatType      { None, OnePlace, TwoPlaces, End, AngledTwoPlaces } wrenchFlat = WrenchFlatType::None;

    bool hasCenterHole   = false;
    bool hasFemaleThread = false;
    bool hasSlitting     = false;
    bool hasSlitCam      = false;
};

//=============================================================================
// BearingOptions
//=============================================================================
struct BearingOptions
{
    BearingType         bearingType      = BearingType::DeepGrooveBall;
    BearingSealType     sealType         = BearingSealType::Open;
    BearingBoreType     boreType         = BearingBoreType::Cylindrical;
    HousingType         housingType      = HousingType::None;
    DualRowType         dualRowType      = DualRowType::S;
    NeedleType          needleType       = NeedleType::DrawnCup;
    NeedleRibType       needleRibType    = NeedleRibType::WithRib;
    InnerUseType        innerUseType     = InnerUseType::WithoutInner;
    ThrustBallType      thrustType       = ThrustBallType::SingleDirection;
    ThrustRollerType    thrustRollerType = ThrustRollerType::Cylindrical;
    OilSealType         oilSealType      = OilSealType::SM;
    OillessShapeType    oillessShapeType = OillessShapeType::Sleeve;
    OuterRaceType       outerRaceType    = OuterRaceType::None;
    ShaftEndUIOptions   shaftEndUIOptions;

    bool   showRollingElements = false;
    bool   showCage            = false;
    bool   isSimplified        = false;
    double contactAngle        = 0.0;
    bool   hasGreaseNipple     = true;
    bool   hasSetScrew         = true;
    bool   hasAdapterSleeve    = false;
};

//=============================================================================
// Constants
//=============================================================================
namespace BearingConstants
{
    constexpr double PI                    = 3.14159265358979323846;
    constexpr double SQRT2                 = 1.4142135623730951;
    constexpr double INNER_RING_RATIO      = 0.15;
    constexpr double OUTER_RING_RATIO      = 0.12;
    constexpr double GROOVE_DEPTH_RATIO    = 0.03;
    constexpr double SHOULDER_HEIGHT_RATIO = 0.1;
    constexpr double SHIELD_THICKNESS      = 0.3;
    constexpr double SEAL_THICKNESS        = 0.8;
    constexpr double BALL_SPACING_RATIO    = 1.2;
    constexpr double ROLLER_SPACING_RATIO  = 1.1;
    constexpr double TAPER_ANGLE_DEFAULT   = 15.0;
    constexpr double ANGULAR_CONTACT_15    = 15.0;
    constexpr double ANGULAR_CONTACT_25    = 25.0;
    constexpr double ANGULAR_CONTACT_40    = 40.0;
    constexpr double HOUSING_WALL_RATIO    = 0.15;
    constexpr double PILLOW_HEIGHT_RATIO   = 1.8;
    constexpr double FLANGE_THICKNESS_RATIO= 0.25;
    constexpr double BOLT_HOLE_RATIO       = 0.12;
}

//=============================================================================
// Material Mapping
//=============================================================================
namespace BearingMaterials
{
    static const std::unordered_map<std::wstring, const wchar_t*> MaterialMap = {
        {L"SUJ2",L"Chrome Steel"},{L"SUJ3",L"Chrome Steel"},
        {L"52100",L"Chrome Steel"},{L"100Cr6",L"Chrome Steel"},
        {L"STS440C",L"Stainless Steel"},{L"SUS440C",L"Stainless Steel"},
        {L"STS304",L"Stainless Steel"},
        {L"Si3N4",L"Ceramic"},{L"ZrO2",L"Ceramic"},
        {L"POM",L"Plastic"},{L"PEEK",L"Plastic"},{L"PTFE",L"PTFE"}
    };
    static const std::unordered_map<std::wstring, const wchar_t*> HousingMaterialMap = {
        {L"GG25",L"Cast Iron"},{L"FC200",L"Cast Iron"},{L"FC250",L"Cast Iron"},
        {L"GGG40",L"Ductile Iron"},{L"FCD450",L"Ductile Iron"},
        {L"SS400",L"Steel, Mild"},{L"STS304",L"Stainless Steel"},
        {L"PA66",L"Plastic"},{L"PBT",L"Plastic"}
    };
    static const std::unordered_map<std::wstring, const wchar_t*> CageMaterialMap = {
        {L"Steel",L"Steel, Mild"},{L"Brass",L"Brass"},
        {L"PA66",L"Nylon 6/6"},{L"PEEK",L"Plastic"},{L"POM",L"Plastic"}
    };

    inline const wchar_t* GetInventorMaterial(const std::wstring& code)
    {
        auto it = MaterialMap.find(code);
        if (it != MaterialMap.end()) return it->second;
        for (const auto& p : MaterialMap)
            if (code.find(p.first) != std::wstring::npos) return p.second;
        return L"Chrome Steel";
    }
    inline const wchar_t* GetHousingMaterial(const std::wstring& code)
    {
        auto it = HousingMaterialMap.find(code);
        return (it != HousingMaterialMap.end()) ? it->second : L"Cast Iron";
    }
    inline const wchar_t* GetCageMaterial(const std::wstring& code)
    {
        auto it = CageMaterialMap.find(code);
        return (it != CageMaterialMap.end()) ? it->second : L"Brass";
    }
}

//=============================================================================
// Calc Helper Structs
//=============================================================================
struct BSSB_CalcData {
    double val_d, val_D, val_B, val_r;
    double half_B, pitchR, ballR, grooveR;
    double cX_L, cX_R;
    double Ax, Bx, Cx, Dx;
    double Ex, Fx, Gx, Hx;
    double H_shoulder_O, H_relief_O, H_shoulder_I, H_relief_I;
};

struct TBB_CalcData {
    ThrustBallType tType;
    double val_d, val_D, val_B, val_r;
    double half_B, pitchR, clr, ball_pos_X, ballR, grR, gap, dy, safe_r;
    int numBalls;
};

struct TRB_CalcData {
    ThrustRollerType tType;
    double val_d, val_D, val_T, val_r;
    double half_T, pitchR, clr, Dw, Lwe, R_r, gap, safe_r;
    double n_Dw, n_Lwe, w_thick, n_safe_r, inner_R_n, n_cut_Z, n_min_web;
    int    numNeedles;
    double inner_R_cyl, cut_Z, min_web;
    int    numRollers_cyl;
    double ang, X_sph, R_sph, R_out, R_in, inner_R_sph, sph_cut_Z, sph_min_web;
    int    numRollers_sph;
};

// ============================================================================
// 전방 선언
// ============================================================================
class BearingCreator;

//=============================================================================
// BearingPartFuncs  -  베어링 타입별 파트 생성 함수 묶음
//
//   std::function/lambda 대신 멤버 함수 포인터 사용 (MSVC 호환성).
//   nullptr 항목은 "해당 파트 없음" 을 의미합니다.
//     inner   nullptr  =>  내륜 없음 (예: NRB RNA, 스러스트 와셔)
//     cage    nullptr  =>  케이지 없음 (예: BSSB, 롤러 단열)
//=============================================================================
struct BearingPartFuncs
{
    typedef HRESULT (BearingCreator::*CreatorFn)(CiPart*);

    CreatorFn inner;    ///< 내륜 생성 함수
    CreatorFn outer;    ///< 외륜 생성 함수
    CreatorFn element;  ///< 전동체(볼/롤러) 생성 함수
    CreatorFn cage;     ///< 케이지 생성 함수 (선택)

    BearingPartFuncs()
        : inner(NULL), outer(NULL), element(NULL), cage(NULL) {}

    bool isValid() const { return outer != NULL && element != NULL; }
};

//=============================================================================
// BearingCreator
//=============================================================================
class BearingCreator
{
public:
#if defined(SDWORKS)
    explicit BearingCreator(sdWrk::ISldWorksPtr& app) : m_pApplication(app) {}
#elif defined(ZW3D)
    explicit BearingCreator(int app) : m_pApplication(app) {}
#else
    explicit BearingCreator(acInv::ApplicationPtr& app) : m_pApplication(app) {}
#endif

    //=========================================================================
    // Public Entry Points
    //=========================================================================
#if defined(SDWORKS)
    sdWrk::IComponent2Ptr CreateBearing(
        std::map<std::string, std::string>& pDim, BearingPartData& pd,
        double munit, const std::vector<DataMap>& linkedParts,
        const BearingOptions& options = BearingOptions());
#elif defined(ZW3D)
    CiDragComponent CreateBearing(
        std::map<std::string, std::string>& pDim, BearingPartData& pd,
        double munit, const std::vector<DataMap>& linkedParts,
        const BearingOptions& options = BearingOptions());
#else
    acInv::ComponentDefinitionPtr CreateBearing(
        std::map<std::string, std::string>& pDim, BearingPartData& pd,
        double munit, const std::vector<DataMap>& linkedParts,
        const BearingOptions& options = BearingOptions());
#endif

    void CreateLinkedShaft(
        CiAssembly& mainAssembly, const DataMap& lData, double munit,
        CiPart& outShaftPart, CiOccurrence& outShaftOcc);

    void ApplyBearingShaftMate(
        CiAssembly& mainAssembly,
        CiPart& pBearingPart, CiOccurrence& occBearing,
        CiPart& pShaftPart,   CiOccurrence& occShaft);

private:
    //=========================================================================
    // (1) 초기화
    //=========================================================================
    HRESULT Initialize(std::map<std::string, std::string>& pDim);

    //=========================================================================
    // (2) 베어링 본체 생성 - 단순 모드(isSimplified) 전용 타입 분기
    //=========================================================================
    HRESULT CreateBearingBody(CiPart* pPart);

    //=========================================================================
    // (3) 어셈블리 모드 헬퍼 - CreateBearing() 의 기능 단위 분리
    //=========================================================================

    // 베어링 타입 => BearingPartFuncs 반환 (멤버 함수 포인터 디스패치 테이블)
    BearingPartFuncs ResolveAssemblyFuncs();

    // 표준 베어링 공통 시퀀스: [내륜] => 외륜 => 전동체 => [케이지]
    void AssembleStandardBearingParts(
        CiAssembly& asm_, const BearingPartFuncs& funcs,
        const ATL::CString& nameInner,   const ATL::CString& nameOuter,
        const ATL::CString& nameElement, const ATL::CString& nameCage,
        CiPart& pInner,   CiOccurrence& occInner,
        CiPart& pOuter,   CiOccurrence& occOuter,
        CiPart& pElement, CiOccurrence& occElement,
        CiPart& pCage,    CiOccurrence& occCage);

    // UC/UK 인서트 베어링 전용 시퀀스: 외륜 => 볼 => 씰(R/L) => 내륜
    void AssembleInsertBearingParts(
        CiAssembly& asm_, const ATL::CString& partCode,
        CiPart& pInner,   CiOccurrence& occInner,
        CiPart& pOuter,   CiOccurrence& occOuter,
        CiPart& pElement, CiOccurrence& occElement,
        CiPart& pSealR,   CiOccurrence& occSealR,
        CiPart& pSealL,   CiOccurrence& occSealL);

    // 파트 간 기구학적 구속 조건(Mate) 일괄 적용
    void ApplyBearingMates(
        CiAssembly& asm_,
        CiPart& pInner,   CiOccurrence& occInner,
        CiPart& pOuter,   CiOccurrence& occOuter,
        CiPart& pElement, CiOccurrence& occElement,
        CiPart& pCage,    CiOccurrence& occCage,
        CiPart& pSealR,   CiOccurrence& occSealR,
        CiPart& pSealL,   CiOccurrence& occSealL,
        const ATL::CString& axis, const ATL::CString& plane);

    // 하우징 파트 생성 + 그리스 니플 조립
    void AssembleHousing(
        CiAssembly& asm_, const ATL::CString& partCode,
        CiPart& pOuterPart, CiOccurrence& occOuter,
        const ATL::CString& targetAxis, const ATL::CString& targetPlane);

    // 연결 부품(축, 오일실) 루프 처리
    void ProcessLinkedParts(
        CiAssembly& asm_, const std::vector<DataMap>& linkedParts,
        double munit, const ATL::CString& partCode,
        CiPart& pInnerPart, CiOccurrence& occInner,
        CiPart& pOuterPart, CiOccurrence& occOuter);

    //=========================================================================
    // (4) 표준 베어링 본체 - 단순 모드 / CreateBearingBody 에서 호출
    //=========================================================================
    HRESULT CreateDeepGrooveBallBearing(CiPart* pPart);
    HRESULT CreateAngularContactBallBearing(CiPart* pPart);
    HRESULT CreateSelfAligningBallBearing(CiPart* pPart);
    HRESULT CreateCylindricalRollerBearing(CiPart* pPart);
    HRESULT CreateTaperRollerBearing(CiPart* pPart);
    HRESULT CreateSphericalRollerBearing(CiPart* pPart);
    HRESULT CreateNeedleRollerBearing(CiPart* pPart);
    HRESULT CreateBallScrewSupportBearing(CiPart* pPart);
    HRESULT CreateThrustBallBearing(CiPart* pPart);
    HRESULT CreateThrustRollerBearing(CiPart* pPart);
    HRESULT CreateFlangedBearing(CiPart* pPart);
    HRESULT CreateOilSeal(CiPart* pPart);
    HRESULT CreateOillessComponent(CiPart* pPart);

    //=========================================================================
    // (5) 유니트 베어링 하우징 - CreateBearingBody 에서 호출
    //=========================================================================
    HRESULT CreateUCBearing(CiPart* pPart);
    HRESULT CreateUKBearing(CiPart* pPart);
    HRESULT CreateUCPBearing(CiPart* pPart);   HRESULT CreateUKPBearing(CiPart* pPart);
    HRESULT CreateUCFBearing(CiPart* pPart);   HRESULT CreateUKFBearing(CiPart* pPart);
    HRESULT CreateUCFCBearing(CiPart* pPart);  HRESULT CreateUKFCBearing(CiPart* pPart);
    HRESULT CreateUCFLBearing(CiPart* pPart);  HRESULT CreateUKFLBearing(CiPart* pPart);
    HRESULT CreateUCFSBearing(CiPart* pPart);  HRESULT CreateUKFSBearing(CiPart* pPart);
    HRESULT CreateUCTBearing(CiPart* pPart);   HRESULT CreateUKTBearing(CiPart* pPart);
    HRESULT CreateUCCBearing(CiPart* pPart);   HRESULT CreateUKCBearing(CiPart* pPart);

    //=========================================================================
    // (6) 링 / 전동체 / 씰 형상 헬퍼
    //=========================================================================
    HRESULT CreateInnerRing(CiPart* pPart, double innerDia, double outerDia, double width);
    HRESULT CreateOuterRing(CiPart* pPart, double innerDia, double outerDia, double width);
    HRESULT CreateBallRaceway(CiPart* pPart, double pitchDia, double ballDia, bool isInner);
    HRESULT CreateRollerRaceway(CiPart* pPart, double pitchDia, double rollerDia, bool isInner);
    HRESULT CreateBalls(CiPart* pPart);
    HRESULT CreateRollers(CiPart* pPart);
    HRESULT CreateNeedles(CiPart* pPart);
    HRESULT CreateSealOrShield(CiPart* pPart);
    HRESULT CreateShield(CiPart* pPart, bool bothSides);
    HRESULT CreateSeal(CiPart* pPart, bool bothSides);
    HRESULT CreateCage(CiPart* pPart);

    //=========================================================================
    // (7) 하우징 생성 - AssembleHousing 에서 호출
    //=========================================================================
    HRESULT CreatePillowBlockHousing(CiPart* pPart);
    HRESULT CreateSquareFlangeHousing(CiPart* pPart);
    HRESULT CreateCartridgeHousing(CiPart* pPart);
    HRESULT CreateOvalFlangeHousing(CiPart* pPart);
    HRESULT CreateAdjustableFlangeHousing(CiPart* pPart);
    HRESULT CreateTakeUpHousing(CiPart* pPart);
    HRESULT CreateCartridgeCoverHousing(CiPart* pPart);
    HRESULT CreateFlangeHousing(CiPart* pPart, int boltHoles, bool isRoundBody, bool hasSpigot);
    HRESULT CreateRhombusFlangeHousing(CiPart* pPart);
    HRESULT CreateRoundFlangeHousing(CiPart* pPart);
    HRESULT CreatePlummerBlock_Lower(CiPart* pPart);
    HRESULT CreatePlummerBlock_Upper(CiPart* pPart);
    HRESULT CreatePlummerBlock_Bolt(CiPart* pPart);
    HRESULT CreatePlummerBlock_EyeBolt(CiPart* pPart);
    void    CreateSphericalSeatCut(CiPart* pPart, double val_D2, double val_HW);
    void    CreateGreaseNipple(CiPart* pPart, double posX, double offsetY);
    void    SetPlummerBlockDim();
    ATL::CString mVal_t;

    HRESULT CreateSetScrew(CiPart* pPart);
    HRESULT CreateAdapterSleeve(CiPart* pPart);
    HRESULT CreateGreaseNipple(CiPart* pPart);
    HRESULT CreateBoltHoles(CiPart* pPart, int numHoles);

    //=========================================================================
    // (8) 재질 / 색상
    //=========================================================================
    void ApplyMaterial(CiPart* pPart);
    void ApplyHousingMaterial(CiPart* pPart);
    void SetFeatureColor(CiRevolveFeature& feature, ATL::CString colorName);

    //=========================================================================
    // (9) 스케치 프로파일 헬퍼
    //=========================================================================
    CiSketchLine CreateInnerRingProfile(CiPart* pPart);
    CiSketchLine CreateOuterRingProfile(CiPart* pPart);
    CiSketchLine CreateBallGrooveProfile(CiPart* pPart, double centerR, double grooveR, bool isInner);

    //=========================================================================
    // (10) 타입 감지 (PartCode => enum)
    //=========================================================================
    void SetBearingType();
    void SetSealType();
    void SetBoreType();
    void SetHousingType();
    void SetLibType();
    void SetDualRowType();
    void SetOuterRaceType();

    //=========================================================================
    // (11) Utility
    //=========================================================================
    ATL::CString FormatDouble(double value);
    inline double DegToRad(double deg) { return deg * BearingConstants::PI / 180.0; }
    bool IsUnitBearing();

    //=========================================================================
    // (12) Oilless
    //=========================================================================
    OillessShapeType ClassifyShapeType();
    void DrawSleeveProfile(CiPart* pPart);
    void DrawFlangeProfile(CiPart* pPart);
    void DrawWasherProfile(CiPart* pPart);
    void DrawPlateProfile(CiPart* pPart);
    void DrawSphericalProfile(CiPart* pPart);
    void DrawPinProfile(CiPart* pPart);
    void AddSpecificDetails(CiPart* pPart);

    //=========================================================================
    // (13) 어셈블리 파트 생성 함수군
    //      ResolveAssemblyFuncs() 의 CreatorFn 으로 등록됩니다.
    //=========================================================================

    // 볼 베어링 공용
    HRESULT Create_BallBearing_InnerRing(CiPart* pPart);
    HRESULT Create_BallBearing_OuterRing(CiPart* pPart);
    HRESULT Create_BallBearing_Balls(CiPart* pPart);
    HRESULT Create_BallBearing_Seal(CiPart* pPart, bool isRightSide);
    HRESULT Create_BallBearing_SnapRing(CiPart* pPart);
    HRESULT Apply_OuterRing_SnapRingGroove(CiPart* pPart);
    HRESULT Apply_Maximum_FillingSlot(CiPart* pPart);

    // 앵귤러 콘택트 볼 베어링 (ACBB)
    HRESULT Create_ACBB_InnerRing(CiPart* pPart);
    HRESULT Create_ACBB_OuterRing(CiPart* pPart);
    HRESULT Create_ACBB_Balls(CiPart* pPart);

    // 자동조심 볼 베어링 (SABB)
    HRESULT Create_SABB_InnerRing(CiPart* pPart);
    HRESULT Create_SABB_OuterRing(CiPart* pPart);
    HRESULT Create_SABB_Balls(CiPart* pPart);

    // 원통/테이퍼 롤러 베어링 공용
    HRESULT Create_RollerBearing_InnerRing(CiPart* pPart);
    HRESULT Create_RollerBearing_OuterRing(CiPart* pPart);
    HRESULT Create_RollerBearing_Rollers(CiPart* pPart);

    // 스페리컬 롤러 베어링 (SRB)
    HRESULT Create_SRB_InnerRing(CiPart* pPart);
    HRESULT Create_SRB_OuterRing(CiPart* pPart);
    HRESULT Create_SRB_Rollers(CiPart* pPart);
    HRESULT Create_SRB_Cage(CiPart* pPart);

    // 니들 롤러 베어링 (NRB)
    HRESULT Create_NRB_InnerRing(CiPart* pPart);
    HRESULT Create_NRB_OuterRing(CiPart* pPart);
    HRESULT Create_NRB_Rollers(CiPart* pPart);
    HRESULT Create_NRB_Cage(CiPart* pPart);

    // 볼스크류 서포트 (BSSB)
    HRESULT Create_BSSB_InnerRing(CiPart* pPart);
    HRESULT Create_BSSB_OuterRing(CiPart* pPart);
    HRESULT Create_BSSB_Balls(CiPart* pPart);

    // 스러스트 볼 (TBB)
    HRESULT Create_TBB_InnerRing(CiPart* pPart);
    HRESULT Create_TBB_OuterRing(CiPart* pPart);
    HRESULT Create_TBB_Balls(CiPart* pPart);
    HRESULT Create_TBB_Cage(CiPart* pPart);

    // 스러스트 롤러 (TRB)
    HRESULT Create_TRB_InnerRing(CiPart* pPart);
    HRESULT Create_TRB_OuterRing(CiPart* pPart);
    HRESULT Create_TRB_Rollers(CiPart* pPart);
    HRESULT Create_TRB_Cage(CiPart* pPart);

    // UC/UK 인서트 베어링
    HRESULT Create_UC_InnerRing(CiPart* pPart);
    HRESULT Create_UK_InnerRing(CiPart* pPart);
    HRESULT Create_UC_OuterRing(CiPart* pPart);
    HRESULT Create_UC_Balls(CiPart* pPart);
    HRESULT Create_UC_Seal(CiPart* pPart, bool isRight);
    HRESULT Create_Housing_GreaseNipple(CiPart* pPart);
    HRESULT ApplyHousingSphericalSeat(CiPart* pPart);

    //=========================================================================
    // 멤버 변수
    //=========================================================================
#if defined(SDWORKS)
    sdWrk::ISldWorksPtr& m_pApplication;
#elif defined(ZW3D)
    int m_pApplication;
#else
    acInv::ApplicationPtr& m_pApplication;
#endif

    BearingPartData*  m_partData;
    BearingOptions    m_options;
    ShaftEndUIOptions m_shaftOptions;
    double            m_unit;

    // 파생 치수 캐시
    double m_innerRingOD;
    double m_outerRingID;
    double m_pitchDia;
    double m_ballDia;
    int    m_numBalls;

    // 하우징 치수
    double m_housingHeight;
    double m_housingWidth;
    double m_housingLength;
    double m_boltHoleDia;
    double m_boltHoleSpacing;
};
