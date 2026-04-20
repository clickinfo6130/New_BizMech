/**
 * @file NewCreateNutClass.h
 * @brief 통합 너트 생성 시스템 - 모든 너트 타입을 단일 흐름으로 처리
 *
 * 설계 원칙:
 *   - 단일 진입점 (CreateNut)으로 모든 너트 타입 생성
 *   - PartData.h의 NutPartData/NutDimensions 구조체 사용
 *   - BoltCreator와 동일한 패턴 적용
 * 
 * NutDimensions 필드 (PartData.h 참조):
 *   d, P1_UNC, P2_UNF, m, m1, m2, B, b1, b2, N, N1, N2, 
 *   C, C1, C2, G, G1, G2, dk, dw, e, a, a1, a2, H, h1, h2,
 *   S, pt, Dp, r, t, eN, kN
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
// 너트 상수 정의
//=============================================================================
namespace NutConstants
{
    constexpr double PI = 3.14159265358979323846;
    constexpr double SQRT3 = 1.7320508075688772;
    constexpr double SQRT2 = 1.4142135623730951;

    constexpr double CHAMFER_25_DEG_FACTOR = 1.8;
    constexpr double CHAMFER_30_DEG_FACTOR = 1.5;
    constexpr double THREAD_MINOR_DIA_FACTOR = 1.2268;
    constexpr double THREAD_PITCH_DIA_FACTOR = 0.6495;

    constexpr double NUT_NYLON_INSERT_RATIO = 0.3;
    constexpr double NUT_CASTLE_SLOT_DEPTH = 0.4;
    constexpr double NUT_WING_LENGTH_RATIO = 1.2;
}

//=============================================================================
// 재질 매핑
//=============================================================================
namespace NutMaterials
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
        { L"SCM440",  L"Alloy Steel" },
        { L"C3604",   L"Brass" },
        { L"Nylon",   L"Nylon 6/6" },
        { L"PA66",    L"Nylon 6/6" }
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
// 너트 타입 정의
//=============================================================================
enum class NutType
{
    Hex, HexFlange, HexThin, Square,
    NylonLock, AllMetal, Castle, Slotted,
    Cap, Acorn, Wing, Knurled,
    TSlot, Weld, Rivet, Insert,
    Coupling, Eye, Speed
};

enum class NutStyle { Style1, Style2, Grade8, Grade10, GradeA, GradeB, GradeC };

struct NutOptions
{
    NutType  nutType = NutType::Hex;
    NutStyle style = NutStyle::Style1;
    SpecHeadTypeOption headTypeOption;
    bool     hasFlange = false;
    bool     hasSerration = false;
    bool     hasNylonInsert = false;
    bool     isLeftHand = false;
    int      slotCount = 6;
    double   customHeight = 0.0;
};

//=============================================================================
// 통합 너트 생성 클래스
//=============================================================================
class NutCreator
{
public:
#if defined(SDWORKS)
    explicit NutCreator(sdWrk::ISldWorksPtr& app) : m_pApplication(app) {}
    sdWrk::IComponent2Ptr CreateNut(std::map<std::string, std::string>& pDim, NutPartData& pd, double munit, const NutOptions& options = NutOptions());    
#elif defined(ZW3D)
    explicit NutCreator(int app) : m_pApplication(app) {}
    CiDragComponent CreateNut(std::map<std::string, std::string>& pDim, NutPartData& pd, double munit, const NutOptions& options = NutOptions());
#else
    explicit NutCreator(acInv::ApplicationPtr& app) : m_pApplication(app) {}
    acInv::ComponentDefinitionPtr CreateNut(std::map<std::string, std::string>& pDim, NutPartData& pd, double munit, const NutOptions& options = NutOptions());
#endif

private:
    HRESULT Initialize(std::map<std::string, std::string>& pDim);
    HRESULT CreateNutBody(CiPart* pPart);

    HRESULT CreateHexNut(CiPart* pPart);
    HRESULT CreateHexFlangeNut(CiPart* pPart);
    HRESULT CreateSquareNut(CiPart* pPart);
    HRESULT CreateCapNut(CiPart* pPart);
    HRESULT CreateNylonLockNut(CiPart* pPart);
    HRESULT CreateCastleNut(CiPart* pPart);
    HRESULT CreateEyeNut(CiPart* pPart);
    HRESULT CreateWingNut(CiPart* pPart);
    HRESULT CreateTSlotNut(CiPart* pPart);
    HRESULT CreateWeldNut(CiPart* pPart);
    HRESULT CreateCouplingNut(CiPart* pPart);
    HRESULT CreateKnurledNut(CiPart* pPart);
    HRESULT CreateInsertNut(CiPart* pPart);
    HRESULT CreateRivetNut(CiPart* pPart);
    HRESULT CreateSpeedNut(CiPart* pPart);

    void CreateOptionalFeatures(CiPart* pPart);
    HRESULT CreateFlangeFeature(CiPart* pPart);
    HRESULT CreateSerrationFeature(CiPart* pPart);

    HRESULT CreateThreadHole(CiPart* pPart);
    HRESULT CreateInternalThread(std::map<std::string, std::string>& pDim, CiPart* pPart);
    HRESULT CreateChamfers(CiPart* pPart);
    void ApplyMaterial(CiPart* pPart);

    void CreateHexProfile(CiPart* pPart, double cornerDia, bool inscribed = true);
    void CreateSquareProfile(CiPart* pPart, double side);
    CiSketchLine CreateDomeProfile(CiPart* pPart, double baseRadius, double domeRadius);
    void CreateWingProfile(CiPart* pPart, double length, double width, double thickness);
    void CreateChamfer30Profile(CiPart* pPart, double outerDia, double innerDia, double height, bool isTop);
    void SetNutTypeFromPartCode();
    ATL::CString FormatDouble(double value);

    inline double GetHexCorner(double S) { return (S * 2.0) / NutConstants::SQRT3; }

    void SetHeadTypeOption();

private:
#if defined(SDWORKS)
    sdWrk::ISldWorksPtr& m_pApplication;
#elif defined(ZW3D)
    int m_pApplication;
#else
    acInv::ApplicationPtr& m_pApplication;    
#endif  
    NutPartData*           m_partData;
    NutOptions             m_options;
    double                 m_unit;
    double                 m_pitchValue;
};
