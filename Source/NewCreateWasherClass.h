/**
 * @file NewCreateWasherClass.h
 * @brief Unified Washer Creation System
 * @note Uses WasherPartData/WasherDimensions from PartData.h
 */
#pragma once
#include <memory>
#include <unordered_map>
#include <functional>
#include <map>
#include <string>
#include <cmath>
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
// Washer Constants
//=============================================================================
namespace WasherConstants
{
    constexpr double PI = 3.14159265358979323846;
    constexpr double SQRT3 = 1.7320508075688772;
    constexpr double SQRT2 = 1.4142135623730951;

    constexpr double WASHER_SPRING_GAP_RATIO = 0.7;
    constexpr double WASHER_TOOTH_DEPTH_RATIO = 0.3;
    constexpr double WASHER_BELLEVILLE_HT_RATIO = 1.4;
}

//=============================================================================
// Material Mapping
//=============================================================================
namespace WasherMaterials
{
    static const std::unordered_map<std::wstring, const wchar_t*> MaterialMap = {
        { L"S20C",    L"Steel, Mild" },
        { L"SM20C",   L"Steel, Mild" },
        { L"SS41",    L"Steel, Mild" },
        { L"SS400",   L"Steel, Mild" },
        { L"STS304",  L"Stainless Steel" },
        { L"STS316",  L"Stainless Steel" },
        { L"SUS304",  L"Stainless Steel" },
        { L"SUS316",  L"Stainless Steel" },
        { L"SCM435",  L"Alloy Steel" },
        { L"C3604",   L"Brass" },
        { L"C1100",   L"Copper" },
        { L"A5052",   L"Aluminum 6061" },
        { L"A6061",   L"Aluminum 6061" },
        { L"NBR",     L"Rubber" },
        { L"EPDM",    L"Rubber" },
        { L"Nylon",   L"Nylon 6/6" },
        { L"PA66",    L"Nylon 6/6" },
        { L"POM",     L"Plastic" },
        { L"PTFE",    L"PTFE" }
    };

    inline const wchar_t* GetInventorMaterial(const std::wstring& materialCode)
    {
        auto it = MaterialMap.find(materialCode);
        if (it != MaterialMap.end()) return it->second;
        for (const auto& pair : MaterialMap)
            if (materialCode.find(pair.first) != std::wstring::npos)
                return pair.second;
        return L"Steel, Mild";
    }
}

//=============================================================================
// Washer Type Definition
//=============================================================================
enum class WasherType
{
    // Plain washer series
    Plain,
    PlainSmall,
    PlainLarge,
    Fender,
    // Spring washer series
    Spring,
    SpringHeavy,
    Split,
    Bearing,
    // Tooth/Star washer series
    ToothInternal,
    ToothExternal,
    ToothInternalExternal,
    Star,
    // Disc spring series
    Belleville,
    Wave,
    Finger,
    // Special shapes
    Square,
    Taper,
    Spherical,
    Tab,
    TabMulti,
    Nord,
    // Sealing washers
    Sealing,
    Bonded,
    Copper,
    Fiber,
    Rubber,
    // Shoulder/Step washers
    Shoulder,
    Countersunk,
    Cup,
    // Insulating washers
    Insulating,
    Nylon,
    // Special purpose
    Retaining,
    Thrust,
    Shim
};

enum class WasherGrade { Normal, Fine, HRC, Galvanized, StainlessA2, StainlessA4 };

struct WasherOptions
{
    WasherType   washerType = WasherType::Plain;
    WasherGrade  grade = WasherGrade::Normal;
    SpecHeadTypeOption headTypeOption;
    bool         isChamfered = false;
    bool         isCountersunk = false;
    int          toothCount = 0;
    int          waveCount = 0;
    int          stackCount = 1;
    double       customThickness = 0.0;
};

//=============================================================================
// Unified Washer Creator Class
//=============================================================================
class WasherCreator
{
public:
#if defined(SDWORKS)
    explicit WasherCreator(sdWrk::ISldWorksPtr& app) : m_pApplication(app) {}
    sdWrk::IComponent2Ptr CreateWasher(std::map<std::string, std::string>& pDim, WasherPartData& pd, double munit, const WasherOptions& options = WasherOptions());    
#elif defined(ZW3D)
    explicit WasherCreator(int app) : m_pApplication(app) {}
    CiDragComponent CreateWasher(std::map<std::string, std::string>& pDim, WasherPartData& pd, double munit, const WasherOptions& options = WasherOptions());
#else
    explicit WasherCreator(acInv::ApplicationPtr& app) : m_pApplication(app) {}
    acInv::ComponentDefinitionPtr CreateWasher(std::map<std::string, std::string>& pDim, WasherPartData& pd, double munit, const WasherOptions& options = WasherOptions());
#endif

private:
    HRESULT Initialize(std::map<std::string, std::string>& pDim);
    HRESULT CreateWasherBody(CiPart* pPart);

    HRESULT CreatePlainWasher(CiPart* pPart);
    HRESULT CreateSpringWasher(CiPart* pPart);
    HRESULT CreateToothInternalWasher(CiPart* pPart);
    HRESULT CreateToothExternalWasher(CiPart* pPart);
    HRESULT CreateBellevilleWasher(CiPart* pPart);
    HRESULT CreateBearingWasher(CiPart* pPart);
    HRESULT CreateWaveWasher(CiPart* pPart);
    HRESULT CreateSquareWasher(CiPart* pPart);
    HRESULT CreateTaperWasher(CiPart* pPart);
    HRESULT CreateSphericalWasher(CiPart* pPart);
    HRESULT CreateTabWasher(CiPart* pPart);
    HRESULT CreateBondedWasher(CiPart* pPart);
    HRESULT CreateShoulderWasher(CiPart* pPart);
    HRESULT CreateCountersunkWasher(CiPart* pPart);
    HRESULT CreateNordlockWasher(CiPart* pPart);
    HRESULT CreateFingerWasher(CiPart* pPart);

    void CreateOptionalFeatures(CiPart* pPart);
    HRESULT CreateChamferFeature(CiPart* pPart);
    HRESULT CreateCountersinkFeature(CiPart* pPart);

    void ApplyMaterial(CiPart* pPart);

    void CreateAnnularProfile(CiPart* pPart, double innerDia, double outerDia);
    void CreateSpringProfile(CiPart* pPart);
    void DrawOuterTeethLoop(CiPart* pPart, double R_Base, double R_Tip, int N, double tooth_w);
    void DrawToothedLoop(CiPart* pPart, double R_Root, double R_Tip, int N);
    void DrawInternalToothLoop(CiPart* pPart, double R_Tip, double R_Root, int N);
    void DrawRadialInternalLoop(CiPart* pPart, double R_Tip, double R_Root, int N);
    void DrawRadialExternalLoop(CiPart* pPart, double R_Root, double R_Tip, int N);
    //CiSketchLine CreateSpringProfile(CiPart* pPart);
    CiSketchLine CreateBellevilleProfile(CiPart* pPart);
    void CreateWaveProfile(CiPart* pPart);
    void CreateToothProfile(CiPart* pPart, bool isInternal);
    void SetWasherTypeFromPartCode();
    ATL::CString FormatDouble(double value);

    inline double DegToRad(double deg) { return deg * WasherConstants::PI / 180.0; }

    void SetHeadTypeOption();

private:
#if defined(SDWORKS)    
    sdWrk::ISldWorksPtr& m_pApplication;
#elif defined(ZW3D)
    int m_pApplication;
#else
    acInv::ApplicationPtr& m_pApplication;
#endif
    WasherPartData*        m_partData;
    WasherOptions          m_options;
    double                 m_unit;
};

