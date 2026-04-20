/**
 * @file NewCreateMotorClass.h
 * @brief Integrated motor creation system
 *        Single entry point (CreateMotor) for all motor types.
 *        Same structural pattern as BoltCreator.
 *
 * Motor types supported:
 *   Standard  - AC induction motor (square frame)
 *   Servo     - Servo motor (cylindrical body)
 *   Stepper   - Stepper motor (NEMA square frame)
 *   Gearhead  - Gearhead/reduction motor
 *   Brake     - Motor with brake unit
 */
#pragma once
#include <memory>
#include <unordered_map>
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
// Enumerations
//=============================================================================

enum class MotorBodyType
{
    Standard,           // 기본형 (기존 유지)
    Servo,              // 1. 서보 모터 (Servo Motor)
    Stepper,            // 2. 스테핑 모터 (Stepping Motor)
    BLDC,               // 3. BLDC 모터
    Linear,             // 4. 리니어 모터
    DirectDrive,        // 5. DD 모터 (Direct Drive)
    VoiceCoil,          // 6. 보이스 코일 (VCM)
    Geared,             // 7. 기어드모터
    Spindle,            // 8. 스핀들모터
    Fan,                // 9. 팬모터(Fan)
    LinearActuator,     // 10. 리니어 액추에이터
    Drum,               // 11. 드럼 모터
    Vibration,          // 12. 진동 모터
    Coreless,           // 13. 코어리스 모터
    ACInduction,        // 14. 산업용 AC 유도 모터
    Micro,              // 15. 소형 모터
    DC,                 // 16. DC 모터
    Universal,          // 17. 유니버셜 모터
    Pneumatic,          // 18. 공압(Air) 모터
    Hydraulic,          // 19. 유압(Hydraulic) 모터
    Inverter,           // 20. 인버터(Inverter)
    ServoDrive,         // 21. 서보 드라이브 (Servo Drive)
    Gearhead            // 감속기/기어헤드 (기존 유지)
};

enum class MotorShaftType
{
    // ---------------------------------------------------------
    // 1. 기본형 축 (Standard Shafts)
    // ---------------------------------------------------------
    Solid,              // 통축 (가공 없음)
    Straight,           // 둥근 축 (기본형)
    Plain,              // 민짜 축
    DoubleShaft,        // 양축 (모터 양방향으로 축이 돌출된 형태)

    // ---------------------------------------------------------
    // 2. 중공 및 특수 기어 형상 (Hollow & Special Shapes)
    // ---------------------------------------------------------
    Hollow,             // 중공축 (파이프 형상, 중심 관통)
    Spline,             // 스플라인 축 (기어 이빨 가공)
    Gear_Pinion,        // 기어 스크류 / 피니언 축 (감속기 결합용 고하중/일반 축)
    Flange,             // 플랜지 출력 (축 대신 면 형태로 출력)
    Tapered,            // 테이퍼 축 (원뿔 형태)
    Taper_And_Key,      // 테이퍼 축 + 키(Key) 가공 포함

    // ---------------------------------------------------------
    // 3. 플랫 가공 (Cut / Flat)
    // ---------------------------------------------------------
    D_Cut_Single,       // 1면 플랫 (D-Cut)
    D_Cut_Double,       // 2면 플랫 (평행하게 2면을 깎은 형태)
    L_Cut,              // L커트 축
    Flat_Dcut,          // (호환성 유지용) 

    // ---------------------------------------------------------
    // 4. 키홈 및 탭 가공 (Keyway & Tap)
    // ---------------------------------------------------------
    Tap,                // 끝단 탭 가공 (센터 홀)
    Keyway,             // (호환성 유지용) 일반 키홈
    Keyway_NoKey,       // 키홈 가공만 진행 (키 부품 생성 안 함)
    Keyway_WithKey,     // 키홈 가공 후 + 별도 '키(Key)' 부품을 어셈블리에 삽입
    Keyway_And_Tap      // 키홈 가공 + 끝단 탭 동시 적용
};

enum class MotorFlangType
{
    Square,
    Round,
    FaceMount,
    FootMount
};

struct MotorOptions
{
    MotorBodyType   bodyType     = MotorBodyType::Standard;
    MotorShaftType  shaftType    = MotorShaftType::Straight;
    MotorFlangType  flangType    = MotorFlangType::Round;
    bool hasBrake = false; // 브레이크 유무
    bool hasOilSeal = false; // 오일실 유무
    bool hasGearhead = false; // 감속기 유무
    bool hasEncoder = false; // 엔코더 유무 (서보, 스텝 등)
    bool hasConnector = false; // 커넥터 박스 유무
    int             mountHoleCnt = 4;
};

struct IX40Dimensions {
    // PDF 4-5p 참조 치수 (Unit: mm)
    double width = 22.9;
    double height = 14.3;
    double depthFront = 5.7;  // 커넥터 삽입부 (Stainless Shell)
    double depthBack = 8.4;   // 케이블 클램프부 (Resin Body)
    double totalDepth = 14.1;

    double cableHoleDia = 6.8; // 대응 케이블 Ø6.4mm
    double cableHoleRadius = 3.4;

    int pinCount = 8;
    double pinPitch = 1.0;     // 접점 간격 (추정치)
    double powerPinWidth = 0.8; // No.1, No.8 (2.0A)
    double signalPinWidth = 0.5; // No.2~7 (0.5A)

    // 재질 정보
    const TCHAR* matHousing = _T("Polyamide Resin");
    const TCHAR* matShell = _T("Stainless Steel");
};

//=============================================================================
// Constants
//=============================================================================

namespace MotorConstants
{
    constexpr double CORNER_RADIUS_RATIO  = 0.04;
    constexpr double FLANGE_THICK_RATIO   = 0.08;
    constexpr double ENCODER_RATIO        = 0.55;
    constexpr double TAP_DEPTH_FACTOR     = 1.5;
    constexpr double MOUNT_PCD_RATIO      = 0.707;
    constexpr double CONN_OFFSET_RATIO    = 0.35;
}

//=============================================================================
// Material map
//=============================================================================

static const std::unordered_map<std::wstring, const wchar_t*> g_MotorMaterialMap = {
    { L"Steel, Mild",      L"Steel, Mild"      },
    { L"Cast Iron",        L"Cast Iron"        },
    { L"Aluminum 6061",    L"Aluminum 6061"    },
    { L"Stainless Steel",  L"Stainless Steel"  },
    { L"Plastic, Black", L"Plastic, Black" },
};

//=============================================================================
// MotorCreator
//=============================================================================

class MotorCreator
{
public:

#if defined(SDWORKS)
    explicit MotorCreator(sdWrk::ISldWorksPtr& app) : m_pApplication(app) {}
#elif defined(ZW3D)
    explicit MotorCreator(int app) : m_pApplication(app) {}
#else
    explicit MotorCreator(acInv::ApplicationPtr& app) : m_pApplication(app) {}
#endif

#if defined(SDWORKS)
    sdWrk::IComponent2Ptr   CreateMotor(std::map<std::string, std::string>& pDim, MotorPartData& pd, double munit, const MotorOptions& options = MotorOptions());
#elif defined(ZW3D)
    CiDragComponent         CreateMotor(std::map<std::string, std::string>& pDim, MotorPartData& pd, double munit, const MotorOptions& options = MotorOptions());
#else
    acInv::ComponentDefinitionPtr CreateMotor(std::map<std::string, std::string>& pDim, MotorPartData& pd, double munit, const MotorOptions& options = MotorOptions());
#endif

private:
    void    SetMotorBodyType();
    void    SetMotorFlangType();
    void    SetMotorOptions();
    void    SetMotorShaftType();

    HRESULT AssemblePigtailConnectors(CiAssembly& NewComp, CiPart& pMotorBody, CiOccurrence& occBody, ATL::CString partCode);
    HRESULT ExecutePigtailAssembly(CiAssembly& NewComp, CiPart& pMotorBody, CiOccurrence& occBody, ATL::CString partCode);
    HRESULT CreateMotorBody(CiPart* pPart);
    HRESULT CreateSquareFrameBody(CiPart* pPart);
    HRESULT CreateCylindricalBody(CiPart* pPart);
    HRESULT CreateDDMotorBody(CiPart* pPart);
    HRESULT CreateGearedMotorBody(CiPart* pPart);
    HRESULT CreateLinearActuatorBody(CiPart* pPart);

    HRESULT CreateLinearMotorTrack(CiPart* pPart);
    HRESULT CreateVoiceCoilBody(CiPart* pPart);
    HRESULT CreateFluidMotorBody(CiPart* pPart);
    HRESULT CreateDriveBoxBody(CiPart* pPart);
    HRESULT CreateSpindleMotorBody(CiPart* pPart);
    HRESULT CreateFanMotorBody(CiPart* pPart);
    HRESULT CreateDrumMotorBody(CiPart* pPart);
    HRESULT CreateVibrationMotorBody(CiPart* pPart);
    HRESULT CreateCorelessMotorBody(CiPart* pPart);
    HRESULT CreateACInductionMotorBody(CiPart* pPart);
    HRESULT CreateSmallMotorBody(CiPart* pPart);
    HRESULT CreateDCMotorBody(CiPart* pPart);
    HRESULT CreateUniversalMotorBody(CiPart* pPart);
    HRESULT CreatePneumaticMotorBody(CiPart* pPart);
    HRESULT CreateHydraulicMotorBody(CiPart* pPart);
    HRESULT CreateInverterBody(CiPart* pPart);
    HRESULT CreateServoDriveBody(CiPart* pPart);
    HRESULT CreateRotaryEncoderBody(CiPart* pPart);
    HRESULT CreatePrecisionReducerBody(CiPart* pPart);
    HRESULT CreateIndustrialReducerBody(CiPart* pPart);

    HRESULT CreateMotorInternalCavity(CiPart* pPart, double brakeLen);
    HRESULT CreateMotorTerminal(CiPart* pPart, double frameW, double frameH, double L2);
    HRESULT CreateEncoderTerminal(CiPart* pPart, double frameW, double frameH, double L3, double es_md, double encTopSurface);
    HRESULT CreateCablePart(CiPart* pPart, double startX, double startY, double startZ, double dia, double length, ATL::CString partName, ATL::CString color);
    HRESULT CreatePlugConnectorPart(CiPart* pPart, double startX, double startY, double startZ,
        double width, double height, double depth, ATL::CString partName, ATL::CString color);
    HRESULT CreateCircularPlugPart(CiPart* pPart, double startX, double startY, double startZ, double maxDia, double length, double cableDia, ATL::CString partName, ATL::CString color);
    HRESULT CreateLeadOutletPart(CiPart* pPart, double dia, double height);
    HRESULT CreatePowerPlugPart(CiPart* pPart, double w, double h, double d, ATL::CString partName, ATL::CString color);
    HRESULT CreateIX40ConnectorPart(CiPart* pPart, double startX, double startY, double startZ, ATL::CString partName);
    HRESULT CreateSweptCablePart(CiPart* pPart, double dia, double length, ATL::CString partName, ATL::CString color);
    HRESULT CreateStepCablePart(CiPart* pPart, double dia, ATL::CString partName, ATL::CString color);

    //Connector
    HRESULT CreatePlugBody(CiPart* pPart, IX40Dimensions& dim, CiFeature& outBody);
    HRESULT CreateContactPins(CiPart* pPart, IX40Dimensions& dim);
    HRESULT CreateLockSpring(CiPart* pPart, IX40Dimensions& dim);
    HRESULT AssemblePigtailConnectors(CiPart* pPart);
    HRESULT CreateConnectorShape(CiPart* pPart, bool isEncoder);
    HRESULT CreateDetailedIX40Part(CiPart* pPart);

    HRESULT CreateMotorShapeByType(CiPart* pPart);

    HRESULT CreateOutputFlange(CiPart* pPart);
    HRESULT CreateRoundFlange(CiPart* pPart);
    HRESULT CreateSquareFlange(CiPart* pPart);

    HRESULT CreateOutputShaft(CiPart* pPart);
    HRESULT CreateShaftCover(CiPart* pPart);
    HRESULT CreateSolidShaft(CiPart* pPart);
    HRESULT CreateSolidShaftBase(CiPart* pPart);
    HRESULT CreateHollowShaft(CiPart* pPart);
    HRESULT CreateShaftKeyway(CiPart* pPart);
    HRESULT CreateShaftCenterTap(CiPart* pPart);
    HRESULT CreateHollowCutout(CiPart* pPart);
    HRESULT CreateShaftDCut(CiPart* pPart, int cutSides);
    HRESULT CreateMountingHoles(CiPart* pPart);
    HRESULT CreateCircularHolePattern(CiPart* pPart, double pcd, double holeDia,
                                      double depth, int count, double startAngle = 0.7854);

    HRESULT CreateRearCover(CiPart* pPart);
    HRESULT CreateEncoderSection(CiPart* pPart);

    HRESULT CreateGearheadSection(CiPart* pPart);
    HRESULT CreateGearStage(CiPart* pPart, double stageLen, double stageDia,
                             double flangDia, double flangThk, double startX);

    HRESULT CreateBrakeSection(CiPart* pPart);
    HRESULT CreateConnector(CiPart* pPart);
    HRESULT CreateConnectorBoxes(CiPart* pPart);

    //Linear Motor
    HRESULT CreateLinearMotorMover(CiPart* pPart);

    void    ApplyMaterial(CiPart* pPart);

    ATL::CString FormatDouble(double value);
    ATL::CString BuildPartCode();

    void ApplyBodyMaterial(CiPart* pPart, CiFeature& feature, ATL::CString engName, ATL::CString korName);

    void SetDimension();

    void PrintDocumentMaterials(CiPart* pPart);
    HRESULT ApplyAffectedBodyToFeature(CiPart* pPart, CiFeature cutFeat, CiFeature baseFeat);

private:
#if defined(SDWORKS)
    sdWrk::ISldWorksPtr&   m_pApplication;
#elif defined(ZW3D)
    int                    m_pApplication;
#else
    acInv::ApplicationPtr& m_pApplication;
#endif

    MotorPartData* m_partData;
    MotorOptions   m_options;
    double         m_unit;
};
