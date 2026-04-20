// ============================================
// PartData.h
// 부품 데이터 구조체 및 파싱 함수
// V10 - Header-Only (모듈 경계 문제 해결)
// ★ 이 파일을 UTF-8 BOM 인코딩으로 저장하세요 ★
// ============================================

#pragma once

#include "PartSpecIpcHelper_COM.h"
#include <atlstr.h>  // ATL::CString

namespace PartManagerIPC
{
#pragma pack(push, 8)  // 8바이트 정렬 강제 (모든 프로젝트에서 동일하게)
    // ============================================
    // 부품 기본 정보 구조체 (고정 크기 배열)
    // ============================================
    struct PartInfo
    {
        wchar_t PartCode[64];
        wchar_t PartName[128];
        wchar_t KeyComposite[256];
        wchar_t Size[64];           
        wchar_t Material[64];       
        wchar_t Standard[128];       
        wchar_t Usage[64];          
        wchar_t ScrewType[64];      
        wchar_t HeadType[64];       
        wchar_t Surface[64];        
        wchar_t ThreadDir[64];      
        wchar_t BoltEnd[64];
        
        PartInfo() { memset(this, 0, sizeof(PartInfo)); }
        
        ATL::CString GetPartCode() const     { return PartCode; }
        ATL::CString GetPartName() const     { return PartName; }
        ATL::CString GetKeyComposite() const { return KeyComposite; }
        ATL::CString GetSize() const         { return Size; }
        ATL::CString GetMaterial() const     { return Material; }
        ATL::CString GetStandard() const     { return Standard; }
        ATL::CString GetUsage() const        { return Usage; }
        ATL::CString GetScrewType() const    { return ScrewType; }
        ATL::CString GetHeadType() const     { return HeadType; }
        ATL::CString GetSurface() const      { return Surface; }
        ATL::CString GetThreadDir() const    { return ThreadDir; }
        ATL::CString GetBoltEnd() const      { return BoltEnd; }
    };

    // ============================================
    // 볼트/나사 치수 구조체 (unit 적용됨)
    // ============================================
    struct BoltDimensions
    {
        double M;           
        double P1_UNC;      
        double P2_UNF;      
        double H;           
        double H1;                       
        double H2;
        double A;
        double A1;
        double A2;
        double D;
        double D1;
        double D2;
        double B1;          
        double B2;          
        double B3;
        double C1;          
        double C2;  
        double dt;
        double dt1;
        double dt2;
        double G;
        double G1;
        double G2;
        double r;           
        double r1;          
        double Hs;          
        double hh;          
        double hh1;         
        double hh2;
        double S;             
        double S1;            
        double z;           
        double V1;          
        double V2;          
        double Ls;          
        double Ls_125;           
        double LS130;       
        double Ls_220;
        double Length_min;  
        double Length_max;  
        double tpL_p1, tpL_p2;
        double Length;      
        double ValidLength; 
        double Sk1, Sk2, Sk3, Sk4, Sk5;
        
        
        BoltDimensions() { memset(this, 0, sizeof(BoltDimensions)); }
    };
	
	struct NutDimensions
    {
        double d;           
        double P1_UNC;      
        double P2_UNF;      
        double m;           
        double m1;                       
        double m2;
        double B;
        double b1;
        double b2;
        double N;
        double N1;
        double N2;
        double C;          
        double C1;          
        double C2;
        double G;
        double G1;
        double G2;
        double dk;
        double dw;
        double e;
        double a;           
        double a1;          
        double a2;          
        double H;          
        double h1;         
        double h2;
        double S;             
        double pt;            
        double Dp;           
        double r;          
        double t;          
        double eN;          
        double kN;           
      
        
        NutDimensions() { memset(this, 0, sizeof(NutDimensions)); }
    };

    struct WasherDimensions
    {
        double d1;
        double d2;
        double d3;
        double DD1;
        double DD2;
        double DD3;
        double DD4;
        double a_b1;
        double a_b2;
        double a_b3;
        double a_b4;
        double a_b5;
        double t1;
        double t2;
        double t3;
        double t4;
        double t5;
        double c1;
        double c2;
        double c3;
        double Ds;
        double f;
        double f1;
        double r;
        double N;
        double N1;
        double W;
        double W1;

        WasherDimensions() { memset(this, 0, sizeof(WasherDimensions)); }
    };


    //=============================================================================
    // Bolt Head Type Option Enum
    //=============================================================================
    enum class SpecHeadTypeOption
    {
        // 기본 (Standard)
        StandardNormal,         // 기본(일반)
        StandardSmall,          // 기본(소형)

        // 자리붙이 (Flange)
        FlangeNormal,           // 자리붙이(일반)
        FlangeSmall,            // 자리붙이(소형)

        // 머리 높이 (Head Height)
        Normal,                 // 보통
        LowHead,                // 낮은머리

        // 드라이브 타입 (Drive Type)
        Slotted,                // 일자
        Phillips,               // 십자
        Hex,                    // 육각
        Torx,                   // 별
        HexPhillips,            // 육각십자
        RoundPhillips,          // 둥근십자

        // 종류 (Type/Class)
        Type1,                  // 1종
        Type2,                  // 2종
        Type3,                  // 3종
        Type4,                  // 4종

        // 등급 (Grade)
        GradeA,                 // A
        GradeB,                 // B
        GradeC,                 // C

        // 형식 (Style)
        StyleL,                 // L
        StyleJ,                 // J
        StyleLA,                // LA
        StyleJA,                // JA

        // 머리 형상 (Head Shape)
        RoundHead,              // 둥근머리
        FlatHead,               // 접시머리
        SocketHead,             // 렌치 (Socket Head)

        // 캡 종류 (Cap Type)
        Type1ShortCap,          // 1종(짧은캡)
        Type1LongCap,           // 1종(긴캡)
        Type2ShortCap,          // 2종(짧은캡)
        Type2LongCap,           // 2종(긴캡)

        // 높이 종류 (Height Type)
        Type1High,              // 1종(고형)
        Type1Low,               // 1종(저형)
        Type2High,              // 2종(고형)
        Type2Low,               // 2종(저형)
        Type3High,              // 3종(고형)
        Type3Low,               // 3종(저형)

        // 형태 (Form)
        Bent,                   // 구부린 형식
        Straight,               // 구부리지 않은 형식

        // 원형 (Circle)
        CircleSmall,            // 원형(소형)
        CircleNormal,           // 원형(보통)
        CirclePolished,         // 원형(연마)

        // 사각 (Square)
        SquareSmall,            // 사각(소형)
        SquareLarge,            // 사각(대형)

        // 호수 (Grade Number)
        Grade2,                 // 2호
        Grade3,                 // 3호

        // 치형 (Tooth Type) - for Lock Washers
        InternalTooth,          // 내치형
        ExternalTooth,          // 외치형
        InternalExternalTooth,  // 내외치형

        // 혀붙이 (Tab/Tongue Type)
        SingleTab,              // 한쪽혀붙이
        DoubleTab,              // 양쪽혀붙이

        // 각도 (Angle) - for Taper Washers
        Angle3,                 // 각도3
        Angle5,                 // 각도5
        Angle8,                 // 각도8

        // Count
        OptionCount
    };
    // ============================================
    // 통합 부품 데이터 구조체
    // ============================================
    struct BoltPartData
    {        
        double Unit;
        PartInfo Info;
        BoltDimensions Dim;
        bool IsOk;
        
        BoltPartData() : IsOk(false), Unit(1.0) {}
    };
	
	struct NutPartData
    {        
        double Unit;
        PartInfo Info;
        NutDimensions Dim;
        bool IsOk;
        
        NutPartData() : IsOk(false), Unit(1.0) {}
    };

    struct WasherPartData
    {
        double Unit;
        PartInfo Info;
        WasherDimensions Dim;
        bool IsOk;

        WasherPartData() : IsOk(false), Unit(1.0) {}
    };

#pragma pack(pop)  // 원래 정렬로 복원
    // ============================================
    // 인라인 헬퍼 함수들
    // ============================================
    
    inline void SafeCopyWide(wchar_t* dest, size_t destSize, const std::wstring& src)
    {
        if (dest == NULL || destSize == 0) return;
        
        size_t copyLen = src.length();
        if (copyLen >= destSize)
            copyLen = destSize - 1;
        
        if (copyLen > 0)
            wcsncpy_s(dest, destSize, src.c_str(), copyLen);
        else
            dest[0] = L'\0';
    }

    inline std::wstring GetWideValueK(const DataMap& data, const wchar_t* key)
    {
        return Utf8ToWide(GetValue(data, WideToUtf8(key)));
    }

    inline std::wstring GetWideValueE(const DataMap& data, const char* key)
    {
        return Utf8ToWide(GetValue(data, key));
    }

    inline double GetDimK(const DataMap& data, const wchar_t* key, double unit)
    {
        return GetValueDouble(data, WideToUtf8(key), 0.0) * unit;
    }

    inline double GetDimE(const DataMap& data, const char* key, double unit)
    {
        return GetValueDouble(data, key, 0.0) * unit;
    }

    // ============================================
    // ★ ConvertToPartData - 인라인 함수 (핵심!) Bolt
    // ============================================
    inline BoltPartData ConvertToBoltPartData(const DataMap& dataMap, double unit)
    {
        BoltPartData pd;
        pd.IsOk = false;
        pd.Unit = unit;

        if (dataMap.empty())
        {
            return pd;
        }

        pd.IsOk = true;

        // 1. 기본 정보 파싱 (고정 배열로 복사)
        SafeCopyWide(pd.Info.PartCode, 64, GetWideValueE(dataMap, "PartCode"));
        SafeCopyWide(pd.Info.PartName, 128, GetWideValueE(dataMap, "PartName"));
        SafeCopyWide(pd.Info.KeyComposite, 256, GetWideValueE(dataMap, "KeyComposite"));

        SafeCopyWide(pd.Info.Size, 64, GetWideValueK(dataMap, L"사이즈"));
        SafeCopyWide(pd.Info.Material, 64, GetWideValueK(dataMap, L"재질"));
        SafeCopyWide(pd.Info.Standard, 128, GetWideValueK(dataMap, L"규격(표준번호)"));
        SafeCopyWide(pd.Info.Usage, 64, GetWideValueK(dataMap, L"용도"));
        SafeCopyWide(pd.Info.ScrewType, 64, GetWideValueK(dataMap, L"나사종류(Pich)"));
        SafeCopyWide(pd.Info.HeadType, 64, GetWideValueK(dataMap, L"머리형식(Type)"));
        SafeCopyWide(pd.Info.Surface, 64, GetWideValueK(dataMap, L"표면처리"));
        SafeCopyWide(pd.Info.ThreadDir, 64, GetWideValueK(dataMap, L"나사산방향"));
        SafeCopyWide(pd.Info.BoltEnd, 64, GetWideValueK(dataMap, L"볼트끝단"));

        // 2. 기본 치수 파싱 
        pd.Dim.M      = GetDimE(dataMap, "M", unit);
        pd.Dim.P1_UNC = GetDimE(dataMap, "P1(UNC)", unit);
        pd.Dim.P2_UNF = GetDimE(dataMap, "P2(UNF)", unit);
        pd.Dim.H      = GetDimE(dataMap, "H", unit);
        pd.Dim.H1     = GetDimE(dataMap, "H1", unit);
        pd.Dim.H2     = GetDimE(dataMap, "H2", unit);

        pd.Dim.A      = GetDimE(dataMap, "A", unit);
        pd.Dim.A1     = GetDimE(dataMap, "A1", unit);
        pd.Dim.A2     = GetDimE(dataMap, "A2", unit);

        pd.Dim.D      = GetDimE(dataMap, "D", unit);
        pd.Dim.D1     = GetDimE(dataMap, "D1", unit);
        pd.Dim.D2     = GetDimE(dataMap, "D2", unit);
  
        pd.Dim.B1 = GetDimK(dataMap, L"B1(일반)", unit);
        pd.Dim.B2 = GetDimK(dataMap, L"B2(소형)", unit);
        pd.Dim.B3 = GetDimK(dataMap, L"B3", unit);
        pd.Dim.C1 = GetDimK(dataMap, L"C1(일반)", unit);
        pd.Dim.C2 = GetDimK(dataMap, L"C2(소형)", unit);

        pd.Dim.dt  = GetDimE(dataMap, "dt", unit);
        pd.Dim.dt1 = GetDimE(dataMap, "dt1", unit);
        pd.Dim.dt2 = GetDimE(dataMap, "dt2", unit);

        pd.Dim.G   = GetDimE(dataMap, "G", unit);
        pd.Dim.G1  = GetDimE(dataMap, "G1", unit);
        pd.Dim.G2  = GetDimE(dataMap, "G2", unit);

        pd.Dim.r   = GetDimE(dataMap, "r", unit);
        pd.Dim.r1  = GetDimE(dataMap, "r1", unit);
        pd.Dim.Hs  = GetDimE(dataMap, "Hs", unit);
        pd.Dim.hh  = GetDimE(dataMap, "hh", unit);
        pd.Dim.hh1 = GetDimE(dataMap, "hh1", unit);
        pd.Dim.hh2 = GetDimE(dataMap, "hh2", unit);
        pd.Dim.S   = GetDimE(dataMap, "S", unit);
        pd.Dim.S1  = GetDimE(dataMap, "S1", unit);
        pd.Dim.z   = GetDimE(dataMap, "z", unit);
        pd.Dim.V1  = GetDimE(dataMap, "V1", unit);
        pd.Dim.V2  = GetDimE(dataMap, "V2", unit);
        pd.Dim.Ls  = GetDimE(dataMap, "Ls", unit);

        // 3. 길이 관련
        double Ls_125_raw = GetDimE(dataMap, "L<=125(Ls1)", unit);
        pd.Dim.Ls_125 = Ls_125_raw;// -pd.Dim.r; 잠시 보류

        pd.Dim.Ls_220     = GetDimE(dataMap, "L>=220(Ls3)", unit);
        pd.Dim.LS130      = GetDimE(dataMap, "L>=130&&L<=200(Ls2)", unit);
        pd.Dim.Length_min = GetDimE(dataMap, "Length_min", unit);
        pd.Dim.Length_max = GetDimE(dataMap, "Length_max", unit);
        pd.Dim.Length     = GetDimK(dataMap, L"전체길이", unit);

        pd.Dim.ValidLength = GetDimK(dataMap, L"유효길이", unit);

        if (pd.Dim.Length <= 0)
            pd.Dim.Length = 45.0 * unit;

        if (pd.Dim.ValidLength <= 0)
        {
            if (pd.Dim.Length <= 125)
                pd.Dim.ValidLength = pd.Dim.Ls_125;
            else if (pd.Dim.Length >= 130 && pd.Dim.Length <= 200)
                pd.Dim.ValidLength = pd.Dim.LS130;
            else if (pd.Dim.Length >= 220)
                pd.Dim.ValidLength = pd.Dim.Ls_220;
            else
                pd.Dim.ValidLength = pd.Dim.Ls;
        }

        // 4. Sk, tpL 시리즈
        pd.Dim.Sk1    = GetDimE(dataMap, "Sk1", unit);
        pd.Dim.Sk2    = GetDimE(dataMap, "Sk2", unit);
        pd.Dim.Sk3    = GetDimE(dataMap, "Sk3", unit);
        pd.Dim.Sk4    = GetDimE(dataMap, "Sk4", unit);
        pd.Dim.Sk5    = GetDimE(dataMap, "Sk5", unit);
        pd.Dim.tpL_p1 = GetDimE(dataMap, "tpL_p1", unit);
        pd.Dim.tpL_p2 = GetDimE(dataMap, "tpL_p2", unit);

        return pd;
    }

    // ============================================
    // ★ ConvertToPartData - 인라인 함수 (핵심!) Nut
    // ============================================
    inline NutPartData ConvertToNutPartData(const DataMap& dataMap, double unit)
    {
        NutPartData pd;
        pd.IsOk = false;
        pd.Unit = unit;

        if (dataMap.empty())
        {
            return pd;
        }

        pd.IsOk = true;

        // 1. 기본 정보 파싱 (고정 배열로 복사)
        SafeCopyWide(pd.Info.PartCode, 64, GetWideValueE(dataMap, "PartCode"));
        SafeCopyWide(pd.Info.PartName, 128, GetWideValueE(dataMap, "PartName"));
        SafeCopyWide(pd.Info.KeyComposite, 256, GetWideValueE(dataMap, "KeyComposite"));

        SafeCopyWide(pd.Info.Size, 64, GetWideValueK(dataMap, L"사이즈"));
        SafeCopyWide(pd.Info.Material, 64, GetWideValueK(dataMap, L"재질"));
        SafeCopyWide(pd.Info.Standard, 128, GetWideValueK(dataMap, L"규격(표준번호)"));
        SafeCopyWide(pd.Info.Usage, 64, GetWideValueK(dataMap, L"용도"));
        SafeCopyWide(pd.Info.ScrewType, 64, GetWideValueK(dataMap, L"나사종류(Pitch)"));
        SafeCopyWide(pd.Info.HeadType, 64, GetWideValueK(dataMap, L"머리형식(Type)"));
        SafeCopyWide(pd.Info.Surface, 64, GetWideValueK(dataMap, L"표면처리"));
        SafeCopyWide(pd.Info.ThreadDir, 64, GetWideValueK(dataMap, L"나사산방향"));

        // 2. 기본 치수 파싱
        pd.Dim.d      = GetDimE(dataMap, "d", unit);
        pd.Dim.P1_UNC = GetDimE(dataMap, "P1(UNC)", unit);
        pd.Dim.P2_UNF = GetDimE(dataMap, "P2(UNF)", unit);
        pd.Dim.m      = GetDimE(dataMap, "m", unit);
        pd.Dim.m1     = GetDimE(dataMap, "m1", unit);
        pd.Dim.m2     = GetDimE(dataMap, "m2", unit);

        pd.Dim.B      = GetDimE(dataMap, "B", unit);
        pd.Dim.b1     = GetDimE(dataMap, "b1", unit);
        pd.Dim.b2     = GetDimE(dataMap, "b2", unit);

        pd.Dim.N      = GetDimE(dataMap, "N", unit);
        pd.Dim.N1     = GetDimE(dataMap, "N1", unit);
        pd.Dim.N2     = GetDimE(dataMap, "N2", unit);

        pd.Dim.C = GetDimK(dataMap, L"C", unit);
        pd.Dim.C1 = GetDimK(dataMap, L"C1", unit);
        pd.Dim.C2 = GetDimK(dataMap, L"C2", unit);

        pd.Dim.G  = GetDimE(dataMap, "G", unit);
        pd.Dim.G1 = GetDimE(dataMap, "G1", unit);
        pd.Dim.G2 = GetDimE(dataMap, "G2", unit);

        pd.Dim.dk  = GetDimE(dataMap, "dk", unit);
        pd.Dim.dw  = GetDimE(dataMap, "dw", unit);

        pd.Dim.e  = GetDimE(dataMap, "e", unit);

        pd.Dim.a   = GetDimE(dataMap, "a", unit);
        pd.Dim.a1  = GetDimE(dataMap, "a1", unit);
        pd.Dim.a2  = GetDimE(dataMap, "a2", unit);

        pd.Dim.H  = GetDimE(dataMap, "H", unit);
        pd.Dim.h1 = GetDimE(dataMap, "h1", unit);
        pd.Dim.h2 = GetDimE(dataMap, "h2", unit);

        pd.Dim.S   = GetDimE(dataMap, "S", unit);
        pd.Dim.pt  = GetDimE(dataMap, "pt", unit);
        pd.Dim.Dp   = GetDimE(dataMap, "Dp", unit);

        pd.Dim.r  = GetDimE(dataMap, "r", unit);
        pd.Dim.t  = GetDimE(dataMap, "t", unit);

        pd.Dim.eN  = GetDimE(dataMap, "eN", unit);
        pd.Dim.kN  = GetDimE(dataMap, "kN", unit);

        return pd;
    }
    // ============================================
// ★ ConvertToPartData - 인라인 함수 (핵심!) Washer
// ============================================
    inline WasherPartData ConvertToWasherPartData(const DataMap& dataMap, double unit)
    {
        WasherPartData pd;
        pd.IsOk = false;
        pd.Unit = unit;

        if (dataMap.empty())
        {
            return pd;
        }

        pd.IsOk = true;

        // 1. 기본 정보 파싱 (고정 배열로 복사)
        SafeCopyWide(pd.Info.PartCode, 64, GetWideValueE(dataMap, "PartCode"));
        SafeCopyWide(pd.Info.PartName, 128, GetWideValueE(dataMap, "PartName"));
        SafeCopyWide(pd.Info.KeyComposite, 256, GetWideValueE(dataMap, "KeyComposite"));

        SafeCopyWide(pd.Info.Size, 64, GetWideValueK(dataMap, L"사이즈"));
        SafeCopyWide(pd.Info.Material, 64, GetWideValueK(dataMap, L"재질"));
        SafeCopyWide(pd.Info.Standard, 128, GetWideValueK(dataMap, L"규격(표준번호)"));
        SafeCopyWide(pd.Info.Usage, 64, GetWideValueK(dataMap, L"용도"));
        SafeCopyWide(pd.Info.ScrewType, 64, GetWideValueK(dataMap, L"나사종류(Pitch)"));
        SafeCopyWide(pd.Info.HeadType, 64, GetWideValueK(dataMap, L"머리형식(Type)"));
        SafeCopyWide(pd.Info.Surface, 64, GetWideValueK(dataMap, L"표면처리"));
        SafeCopyWide(pd.Info.ThreadDir, 64, GetWideValueK(dataMap, L"나사산방향"));

        // 2. 기본 치수 파싱
        pd.Dim.d1 = GetDimE(dataMap, "d1", unit);
        pd.Dim.d2 = GetDimE(dataMap, "d2", unit);
        pd.Dim.d3 = GetDimE(dataMap, "d3", unit);

        pd.Dim.DD1 = GetDimE(dataMap, "DD1", unit);
        pd.Dim.DD2 = GetDimE(dataMap, "DD2", unit);
        pd.Dim.DD3 = GetDimE(dataMap, "DD3", unit);
        pd.Dim.DD4 = GetDimE(dataMap, "DD4", unit);

        pd.Dim.a_b1 = GetDimE(dataMap, "a-b1", unit);
        pd.Dim.a_b2 = GetDimE(dataMap, "a-b2", unit);
        pd.Dim.a_b3 = GetDimE(dataMap, "a-b3", unit);
        pd.Dim.a_b4 = GetDimE(dataMap, "a-b4", unit);
        pd.Dim.a_b5 = GetDimE(dataMap, "a-b5", unit);

        pd.Dim.t1 = GetDimE(dataMap, "t1", unit);
        pd.Dim.t2 = GetDimE(dataMap, "t2", unit);
        pd.Dim.t3 = GetDimE(dataMap, "t3", unit);
        pd.Dim.t4 = GetDimE(dataMap, "t4", unit);
        pd.Dim.t5 = GetDimE(dataMap, "t5", unit);

        pd.Dim.c1 = GetDimE(dataMap, "c1", unit);
        pd.Dim.c2 = GetDimE(dataMap, "c2", unit);
        pd.Dim.c3 = GetDimE(dataMap, "c3", unit);


        pd.Dim.Ds = GetDimE(dataMap, "Ds", unit);
        pd.Dim.f  = GetDimE(dataMap, "f", unit);
        pd.Dim.f1 = GetDimE(dataMap, "f1", unit);
        pd.Dim.r = GetDimE(dataMap, "r", unit);

        pd.Dim.N = GetDimK(dataMap, L"N", unit);
        pd.Dim.N1 = GetDimK(dataMap, L"N1", unit);

        pd.Dim.W = GetDimK(dataMap, L"W", unit);
        pd.Dim.W1 = GetDimK(dataMap, L"W1", unit);

        return pd;
    }

    inline SpecHeadTypeOption HeadTypeOption(const wchar_t* name)
    {
        std::wstring str(name);

        if (str == L"기본(일반)")           return SpecHeadTypeOption::StandardNormal;
        if (str == L"기본(소형)")           return SpecHeadTypeOption::StandardSmall;
        if (str == L"자리붙이(일반)")       return SpecHeadTypeOption::FlangeNormal;
        if (str == L"자리붙이(소형)")       return SpecHeadTypeOption::FlangeSmall;
        if (str == L"보통")                 return SpecHeadTypeOption::Normal;
        if (str == L"낮은머리")             return SpecHeadTypeOption::LowHead;
        if (str == L"일자")                 return SpecHeadTypeOption::Slotted;
        if (str == L"십자")                 return SpecHeadTypeOption::Phillips;
        if (str == L"육각")                 return SpecHeadTypeOption::Hex;
        if (str == L"별")                   return SpecHeadTypeOption::Torx;
        if (str == L"육각십자")             return SpecHeadTypeOption::HexPhillips;
        if (str == L"둥근십자")             return SpecHeadTypeOption::RoundPhillips;
        if (str == L"1종")                  return SpecHeadTypeOption::Type1;
        if (str == L"2종")                  return SpecHeadTypeOption::Type2;
        if (str == L"3종")                  return SpecHeadTypeOption::Type3;
        if (str == L"4종")                  return SpecHeadTypeOption::Type4;
        if (str == L"A")                    return SpecHeadTypeOption::GradeA;
        if (str == L"B")                    return SpecHeadTypeOption::GradeB;
        if (str == L"C")                    return SpecHeadTypeOption::GradeC;
        if (str == L"L")                    return SpecHeadTypeOption::StyleL;
        if (str == L"J")                    return SpecHeadTypeOption::StyleJ;
        if (str == L"LA")                   return SpecHeadTypeOption::StyleLA;
        if (str == L"JA")                   return SpecHeadTypeOption::StyleJA;
        if (str == L"둥근머리")             return SpecHeadTypeOption::RoundHead;
        if (str == L"접시머리")             return SpecHeadTypeOption::FlatHead;
        if (str == L"렌치")                 return SpecHeadTypeOption::SocketHead;
        if (str == L"1종(짧은캡)")          return SpecHeadTypeOption::Type1ShortCap;
        if (str == L"1종(긴캡)")            return SpecHeadTypeOption::Type1LongCap;
        if (str == L"2종(짧은캡)")          return SpecHeadTypeOption::Type2ShortCap;
        if (str == L"2종(긴캡)")            return SpecHeadTypeOption::Type2LongCap;
        if (str == L"1종(고형)")            return SpecHeadTypeOption::Type1High;
        if (str == L"1종(저형)")            return SpecHeadTypeOption::Type1Low;
        if (str == L"2종(고형)")            return SpecHeadTypeOption::Type2High;
        if (str == L"2종(저형)")            return SpecHeadTypeOption::Type2Low;
        if (str == L"3종(고형)")            return SpecHeadTypeOption::Type3High;
        if (str == L"3종(저형)")            return SpecHeadTypeOption::Type3Low;
        if (str == L"구부린 형식")          return SpecHeadTypeOption::Bent;
        if (str == L"구부리지 않은 형식")   return SpecHeadTypeOption::Straight;
        if (str == L"원형(소형)")           return SpecHeadTypeOption::CircleSmall;
        if (str == L"원형(보통)")           return SpecHeadTypeOption::CircleNormal;
        if (str == L"원형(연마)")           return SpecHeadTypeOption::CirclePolished;
        if (str == L"사각(소형)")           return SpecHeadTypeOption::SquareSmall;
        if (str == L"사각(대형)")           return SpecHeadTypeOption::SquareLarge;
        if (str == L"2호")                  return SpecHeadTypeOption::Grade2;
        if (str == L"3호")                  return SpecHeadTypeOption::Grade3;
        if (str == L"내치형")               return SpecHeadTypeOption::InternalTooth;
        if (str == L"외치형")               return SpecHeadTypeOption::ExternalTooth;
        if (str == L"내외치형")             return SpecHeadTypeOption::InternalExternalTooth;
        if (str == L"한쪽혀붙이")           return SpecHeadTypeOption::SingleTab;
        if (str == L"양쪽혀붙이")           return SpecHeadTypeOption::DoubleTab;
        if (str == L"각도3")                return SpecHeadTypeOption::Angle3;
        if (str == L"각도5")                return SpecHeadTypeOption::Angle5;
        if (str == L"각도8")                return SpecHeadTypeOption::Angle8;
        return SpecHeadTypeOption::StandardNormal;
    }

    //--------------- 베어링 관련 정보 -------------//
    //-----------------------------------------------//

    struct PartInfo_Bearing
    {
        wchar_t PartCode[64];
        wchar_t PartName[128];
        wchar_t KeyComposite[256];
        wchar_t Standard_Maker[64];
        wchar_t BoreDiameter[64];
        wchar_t ProductNo[64];
        wchar_t Seal_ShieldType[64];
        wchar_t OuterRace[64];
        wchar_t BoreType[64];
        wchar_t Material[64];
        wchar_t CageMaterial[64];
        wchar_t LipShape[64];
        wchar_t DualRow[64];

        PartInfo_Bearing() { memset(this, 0, sizeof(PartInfo_Bearing)); }

        ATL::CString GetPartCode() const { return PartCode; }
        ATL::CString GetPartName() const { return PartName; }
        ATL::CString GetKeyComposite() const { return KeyComposite; }
        ATL::CString GetStandard_Maker() const { return Standard_Maker; }
        ATL::CString GetBoreDiameter() const { return BoreDiameter; }
        ATL::CString GetProductNo() const { return ProductNo; }
        ATL::CString GetSeal_ShieldType() const { return Seal_ShieldType; }
        ATL::CString GetOuterRace() const { return OuterRace; }
        ATL::CString GetBoreType() const { return BoreType; }
        ATL::CString GetMaterial() const { return Material; }
        ATL::CString GetCageMaterial() const { return CageMaterial; }
        ATL::CString GetLipShape() const { return LipShape; }
        ATL::CString GetDualRow() const { return DualRow; }
    };


    struct BearingDimensions
    {
        double d;
        double d1;
        double d2;
        double D2;
        double B;
        double B1;
        double C;
        double L;
        double T;
        double A;
        double Fw;
        double Ew;
        double r;
        double r1;
        double Ga;
        double Gb;
        double GD;
        double GH;
        double FD;
        double FB;
        double J;
        double J1;
        double J2;
        double J3;
        double J4;
        double Bd;
        double Bdn;
        double Bgw;
        double Bgh;
        double a;
        double Sd;
        double Sh;
        double Hd1;
        double HW;
        double Ea;
        double Eb;
        double GL;
        double HD;
        double HH;
        double dk;
        double S;
        wchar_t G[64];
        double H;
        double H3;
        double f;
        double Dw;
        double dm;
        double Z;
        double A1;
        double A2;
        double H1;
        double H2;
        double N;
        double N1;
        double N2;
        double N3;
        double L1;
        double L2;
        double L3;
        double R1;
        double g;
        double Y;
        double Base_r;
        wchar_t t[64];
        wchar_t t2[64];

        double ContactAngle;

        BearingDimensions() { memset(this, 0, sizeof(BearingDimensions)); }

        ATL::CString GetDimG() const { return G; }
    };

    struct BearingPartData
    {
        double Unit;
        PartInfo_Bearing Info;
        BearingDimensions Dim;
        bool IsOk;

        BearingPartData() : IsOk(false), Unit(1.0) {}
    };

    // ============================================
// ★ ConvertToPartData - 인라인 함수 (핵심!) Bearing
// ============================================
    inline BearingPartData ConvertToBearingPartData(const DataMap& dataMap, double unit)
    {
        BearingPartData pd;
        pd.IsOk = false;
        pd.Unit = unit;

        if (dataMap.empty())
        {
            return pd;
        }

        pd.IsOk = true;

        // 1. 기본 정보 파싱 (고정 배열로 복사)
        SafeCopyWide(pd.Info.PartCode, 64, GetWideValueE(dataMap, "PartCode"));
        SafeCopyWide(pd.Info.PartName, 128, GetWideValueE(dataMap, "PartName"));
        SafeCopyWide(pd.Info.KeyComposite, 256, GetWideValueE(dataMap, "KeyComposite"));

        SafeCopyWide(pd.Info.Standard_Maker, 64, GetWideValueK(dataMap, L"규격/제조사"));
        SafeCopyWide(pd.Info.BoreDiameter, 64, GetWideValueK(dataMap, L"내경"));
        SafeCopyWide(pd.Info.ProductNo, 64, GetWideValueK(dataMap, L"호칭"));
        SafeCopyWide(pd.Info.Seal_ShieldType, 64, GetWideValueK(dataMap, L"밀봉 형식"));
        SafeCopyWide(pd.Info.OuterRace, 64, GetWideValueK(dataMap, L"외륜 옵션"));
        SafeCopyWide(pd.Info.BoreType, 64, GetWideValueK(dataMap, L"내경 형상"));
        SafeCopyWide(pd.Info.Material, 64, GetWideValueK(dataMap, L"재질"));
        SafeCopyWide(pd.Info.CageMaterial, 64, GetWideValueK(dataMap, L"리테이너 재질"));
        SafeCopyWide(pd.Info.LipShape, 64, GetWideValueK(dataMap, L"립 형상"));
        SafeCopyWide(pd.Info.DualRow, 64, GetWideValueK(dataMap, L"배열"));

        // 2. 기본 치수 파싱
        pd.Dim.d  = GetDimE(dataMap, "d", unit);
        pd.Dim.d1  = GetDimE(dataMap, "d1", unit);
        pd.Dim.d2  = GetDimE(dataMap, "d2", unit);
        pd.Dim.D2  = GetDimE(dataMap, "D2", unit);
        pd.Dim.B  = GetDimE(dataMap, "B", unit);
        pd.Dim.B1 = GetDimE(dataMap, "B1", unit);
        pd.Dim.C = GetDimE(dataMap, "C", unit);
        pd.Dim.L = GetDimE(dataMap, "L", unit);
        pd.Dim.T = GetDimE(dataMap, "T", unit);
        pd.Dim.A = GetDimE(dataMap, "A", unit);
        pd.Dim.Fw = GetDimE(dataMap, "Fw", unit);
        pd.Dim.Ew = GetDimE(dataMap, "Ew", unit);
        pd.Dim.r = GetDimE(dataMap, "r", unit);
        pd.Dim.r1 = GetDimE(dataMap, "r1", unit);
        pd.Dim.Ga = GetDimE(dataMap, "Ga", unit);
        pd.Dim.Gb = GetDimE(dataMap, "Gb", unit);
        pd.Dim.GD = GetDimE(dataMap, "GD", unit);
        pd.Dim.GH = GetDimE(dataMap, "GH", unit);
        pd.Dim.FD = GetDimE(dataMap, "FD", unit);
        pd.Dim.FB = GetDimE(dataMap, "FB", unit);
        pd.Dim.J = GetDimE(dataMap, "J", unit);
        pd.Dim.J1 = GetDimE(dataMap, "J1", unit);
        pd.Dim.Bd = GetDimE(dataMap, "Bd", unit);
        pd.Dim.Bdn = GetDimE(dataMap, "Bdn", unit);
        pd.Dim.Bgw = GetDimE(dataMap, "Bgw", unit);
        pd.Dim.Bgh = GetDimE(dataMap, "Bgh", unit);
        pd.Dim.a = GetDimE(dataMap, "a", unit);
        pd.Dim.Sd = GetDimE(dataMap, "Sd", unit);
        pd.Dim.Sh = GetDimE(dataMap, "Sh", unit);
        pd.Dim.Hd1 = GetDimE(dataMap, "Hd1", unit);
        pd.Dim.HW = GetDimE(dataMap, "HW", unit);
        pd.Dim.Ea = GetDimE(dataMap, "Ea", unit);
        pd.Dim.Eb = GetDimE(dataMap, "Eb", unit);
        pd.Dim.GL = GetDimE(dataMap, "GL", unit);
        pd.Dim.HD = GetDimE(dataMap, "HD", unit);
        pd.Dim.HH = GetDimE(dataMap, "HH", unit);
        pd.Dim.dk = GetDimE(dataMap, "dk", unit);
        pd.Dim.S = GetDimE(dataMap, "S", unit);
        SafeCopyWide(pd.Dim.G, 64, GetWideValueK(dataMap, L"G"));
        //pd.Dim.G = GetDimE(dataMap, "G", unit);
        pd.Dim.H = GetDimE(dataMap, "H", unit);
        pd.Dim.H3 = GetDimE(dataMap, "H3", unit);
        pd.Dim.f = GetDimE(dataMap, "f", unit);
        pd.Dim.Dw = GetDimE(dataMap, "Dw", unit);
        pd.Dim.dm = GetDimE(dataMap, "dm", unit);
        pd.Dim.Z  = GetDimE(dataMap, "Z", unit);
        pd.Dim.A1  = GetDimE(dataMap, "A1", unit);
        pd.Dim.A2  = GetDimE(dataMap, "A2", unit);
        pd.Dim.H1  = GetDimE(dataMap, "H1", unit);
        pd.Dim.H2  = GetDimE(dataMap, "H2", unit);
        pd.Dim.N  = GetDimE(dataMap, "N", unit);
        pd.Dim.N1  = GetDimE(dataMap, "N1", unit);
        pd.Dim.N2  = GetDimE(dataMap, "N2", unit);
        pd.Dim.L1  = GetDimE(dataMap, "L1", unit);
        pd.Dim.L2  = GetDimE(dataMap, "L2", unit);
        pd.Dim.L3  = GetDimE(dataMap, "L3", unit);
        pd.Dim.R1  = GetDimE(dataMap, "R1", unit);
        pd.Dim.g  = GetDimE(dataMap, "g", unit);
        pd.Dim.Y  = GetDimE(dataMap, "Y", unit);
        pd.Dim.Base_r = GetDimE(dataMap, "Base_r", unit);
        SafeCopyWide(pd.Dim.t, 64, GetWideValueK(dataMap, L"t"));

        pd.Dim.ContactAngle = GetDimE(dataMap, "ContactAngle", unit);

        return pd;
    }


   //--------------- Motor 관련 정보 -------------//
  //-----------------------------------------------//

    struct PartInfo_Motor
    {
        wchar_t PartCode[64];
        wchar_t PartName[128];
        wchar_t KeyComposite[256];
        wchar_t Lib_Maker[64];  // 제조사
        wchar_t Motor_Model[64];      // 모델
        wchar_t Motor_Size[64];  // 모터 사이즈
        wchar_t Rated_Power[64]; // 정격출력
        wchar_t Reduction_Ratio[64]; // 감속비
        wchar_t Rated_Speed[64]; // 정격회전속도
        wchar_t Shaft_End[64]; // 축단(옵션)
        wchar_t Attachment_Options[64]; // 부착옵션


        PartInfo_Motor() { memset(this, 0, sizeof(PartInfo_Motor)); }

        ATL::CString GetPartCode() const { return PartCode; }
        ATL::CString GetPartName() const { return PartName; }
        ATL::CString GetKeyComposite() const { return KeyComposite; }
        ATL::CString GetLib_Maker() const { return Lib_Maker; }
        ATL::CString GetMotorModel() const { return Motor_Model; }
        ATL::CString GetMotorSize() const { return Motor_Size; }
        ATL::CString GetRatedPower() const { return Rated_Power; }
        ATL::CString GetReductionRatio() const { return Reduction_Ratio; }
        ATL::CString GetRatedSpeed() const { return Rated_Speed; }
        ATL::CString GetShaftEnd() const { return Shaft_End; }
        ATL::CString GetAttachmentOptions() const { return Attachment_Options; }
    };


    struct MotorDimensions
    {
        double S;
        double S_h;
        double S_l;
        double LR;
        double LX;
        double W1;
        double LO;
        double W2;
        double SL;
        double RL1;
        double RL2;
        double RL3;
        double EnH;
        double EnW;
        double EnL;
        double LM;
        double L1_LL;
        double L2;
        double L3;
        double LO1_LLO;
        double LO2;
        double LO3;
        double LB;
        double LB_h;
        double LB_l;
        double LE;
        double CW_MW;
        double CL_ML;
        double CH_MH;
        double CS;
        double EW;
        double Ed;
        double Eh;
        double EL;
        double ES_MD;
        double PCD_LA;
        wchar_t M_LZ[64];
        double TL_LG;
        double LC;
        double LH;
        double KA;
        double KE;
        double KL;
        double QK;
        double U;
        double W;
        double T;
        double TM;
        double TapL;
        double LB1;
        double LE1;
        double LB2;
        double LE2;
        double LB3;
        double LE3;
        double Q;
        double Rod_L;
        double ArmD;
        double G_S;
        double G_S_h;
        double G_S_l;
        double G_LR;
        double G_LX;
        double G_W1;
        double G_LO;
        double G_W2;
        double G_L1;
        double G_L2;
        double G_L3;
        double G_LL;
        double G_LLO;
        double G_LM;
        double MnL;
        double CnL;
        double R;
        double MWD;
        double ML;
        double MH;
        double MWD1;
        double ML1;
        double MH1;
        double CS1;
        double LH1;
        double G_QK;
        double G_U;
        double G_W;
        double G_T;
        double G_TM;
        double G_TapL;
        double G_Q;
        double G_C;
        double G_LE;
        double G_LG;
        double G_B;
        double G_LD;
        double G_LB;
        double G_LB_h;
        double G_LB_l;
        double G_LC;
        double G_LA;
        double G_LZ;

        MotorDimensions() { memset(this, 0, sizeof(MotorDimensions)); }
    };

    struct MotorPartData
    {
        double Unit;
        PartInfo_Motor Info;
        MotorDimensions Dim;
        bool IsOk;

        MotorPartData() : IsOk(false), Unit(1.0) {}
    };

    // ============================================
// ★ ConvertToPartData - 인라인 함수 (핵심!) Bearing
// ============================================
    inline MotorPartData ConvertToMotorPartData(const DataMap& dataMap, double unit)
    {
        MotorPartData pd;
        pd.IsOk = false;
        pd.Unit = unit;

        if (dataMap.empty())
        {
            return pd;
        }

        pd.IsOk = true;

        // 1. 기본 정보 파싱 (고정 배열로 복사)
        SafeCopyWide(pd.Info.PartCode, 64, GetWideValueE(dataMap, "PartCode"));
        SafeCopyWide(pd.Info.PartName, 128, GetWideValueE(dataMap, "PartName"));
        SafeCopyWide(pd.Info.KeyComposite, 256, GetWideValueE(dataMap, "KeyComposite"));

        SafeCopyWide(pd.Info.Lib_Maker, 64, GetWideValueK(dataMap, L"제조사"));
        SafeCopyWide(pd.Info.Motor_Model, 64, GetWideValueK(dataMap, L"모델"));
        SafeCopyWide(pd.Info.Motor_Size, 64, GetWideValueK(dataMap, L"모터사이즈"));
        SafeCopyWide(pd.Info.Rated_Power, 64, GetWideValueK(dataMap, L"정격출력"));
        SafeCopyWide(pd.Info.Reduction_Ratio, 64, GetWideValueK(dataMap, L"감속비"));
        SafeCopyWide(pd.Info.Rated_Speed, 64, GetWideValueK(dataMap, L"정격회전속도(r/min)"));
        SafeCopyWide(pd.Info.Shaft_End, 64, GetWideValueK(dataMap, L"축단(옵션)⑦"));
        SafeCopyWide(pd.Info.Attachment_Options, 64, GetWideValueK(dataMap, L"부착옵션⑧"));


        // 2. 기본 치수 파싱
        pd.Dim.S = GetDimE(dataMap, "S", unit);
        pd.Dim.S_h = GetDimE(dataMap, "S_h", unit);
        pd.Dim.S_l = GetDimE(dataMap, "S_l", unit);
        pd.Dim.LR = GetDimE(dataMap, "LR", unit);
        pd.Dim.LX = GetDimE(dataMap, "LX", unit);
        pd.Dim.W1 = GetDimE(dataMap, "W1", unit);
        pd.Dim.LO = GetDimE(dataMap, "LO", unit);
        pd.Dim.W2 = GetDimE(dataMap, "W2", unit);
        pd.Dim.SL = GetDimE(dataMap, "SL", unit);
        pd.Dim.RL1 = GetDimE(dataMap, "RL1", unit);
        pd.Dim.RL2 = GetDimE(dataMap, "RL2", unit);
        pd.Dim.RL3 = GetDimE(dataMap, "RL3", unit);
        pd.Dim.EnH = GetDimE(dataMap, "EnH", unit);
        pd.Dim.EnW = GetDimE(dataMap, "EnW", unit);
        pd.Dim.EnL = GetDimE(dataMap, "EnL", unit);
        pd.Dim.LM = GetDimE(dataMap, "LM", unit);
        pd.Dim.L1_LL = GetDimE(dataMap, "L1(LL)", unit);
        pd.Dim.L2 = GetDimE(dataMap, "L2", unit);
        pd.Dim.L3 = GetDimE(dataMap, "L3", unit);
        pd.Dim.LO1_LLO = GetDimE(dataMap, "LO1(LLO)", unit);
        pd.Dim.LO2 = GetDimE(dataMap, "LO2", unit);
        pd.Dim.LO3 = GetDimE(dataMap, "LO3", unit);
        pd.Dim.LB = GetDimE(dataMap, "LB", unit);
        pd.Dim.LB_h = GetDimE(dataMap, "LB_h", unit);
        pd.Dim.LB_l = GetDimE(dataMap, "LB_l", unit);
        pd.Dim.LE = GetDimE(dataMap, "LE", unit);
        pd.Dim.CW_MW = GetDimE(dataMap, "CW(MW)", unit);
        pd.Dim.CL_ML = GetDimE(dataMap, "CL(ML)", unit);
        pd.Dim.CH_MH = GetDimE(dataMap, "CH(MH)", unit);
        pd.Dim.CS = GetDimE(dataMap, "CS", unit);
        pd.Dim.EW = GetDimE(dataMap, "EW", unit);
        pd.Dim.Ed = GetDimE(dataMap, "Ed", unit);
        pd.Dim.Eh = GetDimE(dataMap, "Eh", unit);
        pd.Dim.EL = GetDimE(dataMap, "EL", unit);
        pd.Dim.ES_MD = GetDimE(dataMap, "ES(MD)", unit);
        pd.Dim.PCD_LA = GetDimE(dataMap, "PCD(LA)", unit);
        SafeCopyWide(pd.Dim.M_LZ, 64, GetWideValueK(dataMap, L"M(LZ)"));
        pd.Dim.TL_LG = GetDimE(dataMap, "TL(LG)", unit);
        pd.Dim.LC = GetDimE(dataMap, "LC", unit);
        pd.Dim.LH = GetDimE(dataMap, "LH", unit);
        pd.Dim.KA = GetDimE(dataMap, "KA", unit);
        pd.Dim.KE = GetDimE(dataMap, "KE", unit);
        pd.Dim.KL = GetDimE(dataMap, "KL", unit);
        pd.Dim.QK = GetDimE(dataMap, "QK", unit);
        pd.Dim.U = GetDimE(dataMap, "U", unit);
        pd.Dim.W = GetDimE(dataMap, "W", unit);
        pd.Dim.T = GetDimE(dataMap, "T", unit);
        pd.Dim.TM = GetDimE(dataMap, "TM", unit);
        pd.Dim.TapL = GetDimE(dataMap, "TapL", unit);
        pd.Dim.LB1 = GetDimE(dataMap, "LB1", unit);
        pd.Dim.LE1 = GetDimE(dataMap, "LE1", unit);
        pd.Dim.LB2 = GetDimE(dataMap, "LB2", unit);
        pd.Dim.LE2 = GetDimE(dataMap, "LE2", unit);
        pd.Dim.LB3 = GetDimE(dataMap, "LB3", unit);
        pd.Dim.LE3 = GetDimE(dataMap, "LE3", unit);
        pd.Dim.Q = GetDimE(dataMap, "Q", unit);
        pd.Dim.Rod_L = GetDimE(dataMap, "Rod_L", unit);
        pd.Dim.ArmD = GetDimE(dataMap, "ArmD", unit);
        pd.Dim.G_S = GetDimE(dataMap, "G_S", unit);
        pd.Dim.G_S_h = GetDimE(dataMap, "G_S_h", unit);
        pd.Dim.G_S_l = GetDimE(dataMap, "G_S_l", unit);
        pd.Dim.G_LR = GetDimE(dataMap, "G_LR", unit);
        pd.Dim.G_LX = GetDimE(dataMap, "G_LX", unit);
        pd.Dim.G_W1 = GetDimE(dataMap, "G_W1", unit);
        pd.Dim.G_LO = GetDimE(dataMap, "G_LO", unit);
        pd.Dim.G_W2 = GetDimE(dataMap, "G_W2", unit);
        pd.Dim.G_L1 = GetDimE(dataMap, "G_L1", unit);
        pd.Dim.G_L2 = GetDimE(dataMap, "G_L2", unit);
        pd.Dim.G_L3 = GetDimE(dataMap, "G_L3", unit);
        pd.Dim.G_LL = GetDimE(dataMap, "G_LL", unit);
        pd.Dim.G_LLO = GetDimE(dataMap, "G_LLO", unit);
        pd.Dim.G_LM = GetDimE(dataMap, "G_LM", unit);
        pd.Dim.MnL = GetDimE(dataMap, "MnL", unit);
        pd.Dim.CnL = GetDimE(dataMap, "CnL", unit);
        pd.Dim.R = GetDimE(dataMap, "R", unit);
        pd.Dim.MWD = GetDimE(dataMap, "MWD", unit);
        pd.Dim.ML = GetDimE(dataMap, "ML", unit);
        pd.Dim.MH = GetDimE(dataMap, "MH", unit);
        pd.Dim.MWD1 = GetDimE(dataMap, "MWD1", unit);
        pd.Dim.ML1 = GetDimE(dataMap, "ML1", unit);
        pd.Dim.MH1 = GetDimE(dataMap, "MH1", unit);
        pd.Dim.CS1 = GetDimE(dataMap, "CS1", unit);
        pd.Dim.LH1 = GetDimE(dataMap, "LH1", unit);
        pd.Dim.G_QK = GetDimE(dataMap, "G_QK", unit);
        pd.Dim.G_U = GetDimE(dataMap, "G_U", unit);
        pd.Dim.G_W = GetDimE(dataMap, "G_W", unit);
        pd.Dim.G_T = GetDimE(dataMap, "G_T", unit);
        pd.Dim.G_TM = GetDimE(dataMap, "G_TM", unit);
        pd.Dim.G_TapL = GetDimE(dataMap, "G_TapL", unit);
        pd.Dim.G_Q = GetDimE(dataMap, "G_Q", unit);
        pd.Dim.G_C = GetDimE(dataMap, "G_C", unit);
        pd.Dim.G_LE = GetDimE(dataMap, "G_LE", unit);
        pd.Dim.G_LG = GetDimE(dataMap, "G_LG", unit);
        pd.Dim.G_B = GetDimE(dataMap, "G_B", unit);
        pd.Dim.G_LD = GetDimE(dataMap, "G_LD", unit);
        pd.Dim.G_LB = GetDimE(dataMap, "G_LB", unit);
        pd.Dim.G_LB_h = GetDimE(dataMap, "G_LB_h", unit);
        pd.Dim.G_LB_l = GetDimE(dataMap, "G_LB_l", unit);
        pd.Dim.G_LC = GetDimE(dataMap, "G_LC", unit);
        pd.Dim.G_LA = GetDimE(dataMap, "G_LA", unit);
        pd.Dim.G_LZ = GetDimE(dataMap, "G_LZ", unit);

        return pd;
    }


    //----------- 축그리기 ----------------//
     //---------------  관련 정보 -------------//
  //-----------------------------------------------//

    struct PartInfo_Shaft
    {
        wchar_t PartCode[64];
        wchar_t PartName[128];
        wchar_t KeyComposite[256];
        wchar_t Shaft_Diameter[64];          // 축지름       
        wchar_t Shaft_Length[64];            // 전체 길이       
        wchar_t Offset_Length[64];           // 기준이격거리       
        wchar_t InnerFixType[64];            // 안쪽 고정 방식
        wchar_t HasGrindingRelief[64];       // 연삭 틈새 적용
        wchar_t InnerSupportX[64];           // 안쪽 멈춤링 홈 거리
        wchar_t OuterFix[64];                // 바깥쪽 고정 방식
        wchar_t ThreadOuterDia[64];          // 수나사 규격
        wchar_t ThreadLength[64];            // 수나사 길이
        wchar_t ThreadEffectiveLength[64];   // 나사산 유효 길이
        wchar_t ThreadDirection[64];         // 수나사 방향
        wchar_t ThreadSpec[64];              // 수나사 특수 변경
        wchar_t FineThreadDia[64];           // 가는 나사 규격
        wchar_t ReliefSize[64];              // 릴리프 치수 가공
        wchar_t OuterFixingComponent[64];    // 바깥쪽 고정 부품
        wchar_t RingOffset2[64];             // 바깥쪽 멈춤링 홈 거리
        wchar_t HasOilSeal[64];              // 오일 씰 추가 여부
        wchar_t OilSealOffset[64];           // 오일씰 위치
        wchar_t Keyway[64];                  // 키 홈 형상
        wchar_t KeywayAdditionalType[64];    // 키 홈 추가공
        wchar_t PKeyOffset1[64];             // 첫 번째 키홈 위치
        wchar_t PKeyLength1[64];             // 첫 번째 키홈 길이
        wchar_t PKeyOffset2[64];             // 두 번째 키홈 위치
        wchar_t PKeyLength2[64];             // 두 번째 키홈 길이
        wchar_t GenerateKeySolid[64];        // 키 생성 여부
        wchar_t WrenchFlat[64];              // 평면취 (렌치 플랫)
        wchar_t WFlatOffset1[64];            // 첫 번째 면취 거리
        wchar_t WFlatLength1[64];            // 첫 번째 면취 길이
        wchar_t WFlatOffset2[64];            // 두 번째 면취 거리
        wchar_t WFlatLength2[64];            // 두 번째 면취 길이
        wchar_t WrenchFlatAngle[64];         // 면취 각도
        wchar_t HasCenterHole[64];           // 센터 구멍
        wchar_t FemaleThreadName[64];        // 암나사 규격
        wchar_t HasSlitCam[64];              // 슬릿캠
        wchar_t SCamOffset2[64];             // 슬릿캠 위치
        wchar_t HasSlitting[64];             // 슬리팅
        wchar_t DPartChamfer[64];            // D부 C면취 변경
        wchar_t MaterialType[64];            // 재질 선택
        wchar_t SurfaceTreatment[64];        // 표면 처리
        wchar_t DTolerance[64];              // D부 공차 변경
        wchar_t PTolerance[64];              // P부 공차 변경
        wchar_t CoaxialityTolerance[64];     // 동축도 변경   

        PartInfo_Shaft() { memset(this, 0, sizeof(PartInfo_Shaft)); }

        ATL::CString GetPartCode() const { return PartCode; }
        ATL::CString GetPartName() const { return PartName; }
        ATL::CString GetKeyComposite() const { return KeyComposite; }
        ATL::CString GetShaft_Dia() const { return Shaft_Diameter; }      
        ATL::CString GetShaft_Length() const { return Shaft_Length; }
        ATL::CString GetOffset_Length() const { return Offset_Length; }
        ATL::CString GetInnerFixType() const { return InnerFixType; }                      // 안쪽 고정 방식
        ATL::CString GetHasGrindingRelief() const { return HasGrindingRelief; }            // 연삭 틈새 적용
        ATL::CString GetInnerSupportX() const { return InnerSupportX; }                    // 안쪽 멈춤링 홈 거리
        ATL::CString GetOuterFix() const { return OuterFix; }                              // 바깥쪽 고정 방식
        ATL::CString GetThreadOuterDia() const { return ThreadOuterDia; }                  // 수나사 규격
        ATL::CString GetThreadLength() const { return ThreadLength; }                      // 수나사 길이
        ATL::CString GetThreadEffectiveLength() const { return ThreadEffectiveLength; }    // 나사산 유효 길이
        ATL::CString GetThreadDirection() const { return ThreadDirection; }                // 수나사 방향
        ATL::CString GetThreadSpec() const { return ThreadSpec; }                          // 수나사 특수 변경
        ATL::CString GetFineThreadDia() const { return FineThreadDia; }                    // 가는 나사 규격
        ATL::CString GetReliefSize() const { return ReliefSize; }                          // 릴리프 치수 가공
        ATL::CString GetOuterFixingComponent() const { return OuterFixingComponent; }      // 바깥쪽 고정 부품
        ATL::CString GetRingOffset2() const { return RingOffset2; }                        // 바깥쪽 멈춤링 홈 거리
        ATL::CString GetHasOilSeal() const { return HasOilSeal; }                          // 오일 씰 추가 여부
        ATL::CString GetOilSealOffset() const { return OilSealOffset; }                    // 오일씰 위치
        ATL::CString GetKeyway() const { return Keyway; }                                  // 키 홈 형상
        ATL::CString GetKeywayAdditionalType() const { return KeywayAdditionalType; }      // 키 홈 추가공
        ATL::CString GetPKeyOffset1() const { return PKeyOffset1; }                        // 첫 번째 키홈 위치
        ATL::CString GetPKeyLength1() const { return PKeyLength1; }                        // 첫 번째 키홈 길이
        ATL::CString GetPKeyOffset2() const { return PKeyOffset2; }                        // 두 번째 키홈 위치
        ATL::CString GetPKeyLength2() const { return PKeyLength2; }                        // 두 번째 키홈 길이
        ATL::CString GetGenerateKeySolid() const { return GenerateKeySolid; }              // 키 생성 여부
        ATL::CString GetWrenchFlat() const { return WrenchFlat; }                          // 평면취 (렌치 플랫)
        ATL::CString GetWFlatOffset1() const { return WFlatOffset1; }                      // 첫 번째 면취 거리
        ATL::CString GetWFlatLength1() const { return WFlatLength1; }                      // 첫 번째 면취 길이
        ATL::CString GetWFlatOffset2() const { return WFlatOffset2; }                      // 두 번째 면취 거리
        ATL::CString GetWFlatLength2() const { return WFlatLength2; }                      // 두 번째 면취 길이
        ATL::CString GetWrenchFlatAngle() const { return WrenchFlatAngle; }                // 면취 각도
        ATL::CString GetHasCenterHole() const { return HasCenterHole; }                    // 센터 구멍
        ATL::CString GetFemaleThreadName() const { return FemaleThreadName; }              // 암나사 규격
        ATL::CString GetHasSlitCam() const { return HasSlitCam; }                          // 슬릿캠
        ATL::CString GetSCamOffset2() const { return SCamOffset2; }                        // 슬릿캠 위치
        ATL::CString GetHasSlitting() const { return HasSlitting; }                        // 슬리팅
        ATL::CString GetDPartChamfer() const { return DPartChamfer; }                      // D부 C면취 변경
        ATL::CString GetMaterialType() const { return MaterialType; }                      // 재질 선택
        ATL::CString GetSurfaceTreatment() const { return SurfaceTreatment; }              // 표면 처리
        ATL::CString GetDTolerance() const { return DTolerance; }                          // D부 공차 변경
        ATL::CString GetPTolerance() const { return PTolerance; }                          // P부 공차 변경
        ATL::CString GetCoaxialityTolerance() const { return CoaxialityTolerance; }        // 동축도 변경
    };

    struct ShaftDimensions
    {
        double pKey_Width;
        double pKey_Height;
        double pKey_Depth;
        double pKey_Depth1;
        double pKey_Depth2;
        double wKey_Radius;
        double wKey_Width;
        double wKey_Depth;
        double retRing_Width;
        double retRing_Radius;
        double retRing_FreeID;
        double retRing_Thickness;
        double retRing_MaxWidth;
        double retRing_MaxOD;
        double retRing_EndWidth;
        double retRing_HoleDia;
        double endRing_Width;
        double endRing_Radius;
        double endRing_FreeID;
        double endRing_Thickness;
        double endRing_MaxWidth;
        double endRing_MaxOD;
        double endRing_EndWidth;
        double endRing_HoleDia;
        double slit_Width;
        double slit_Depth;
        double sCam_Radius;
        double sCam_Width;
        double sCam_Diameter;
        double wFlat_Depth;
        double wFlat_Length;
        double ch_Radius;
        double ch_Depth;
        double locknut_OuterDia;
        double locknut_Thickness;
        double locknut_SlotWidth;
        double locknut_SlotDepth;

        ShaftDimensions() { memset(this, 0, sizeof(ShaftDimensions)); }
    };

    struct ShaftPartData
    {
        double Unit;
        PartInfo_Shaft Info;
        ShaftDimensions Dim;
        bool IsOk;

        ShaftPartData() : IsOk(false), Unit(1.0) {}
    };

    // ============================================
// ★ ConvertToPartData - 인라인 함수 (핵심!) Bearing
// ============================================
    inline ShaftPartData ConvertToShaftPartData(const DataMap& dataMap, double unit)
    {
        ShaftPartData pd;
        pd.IsOk = false;
        pd.Unit = unit;

        if (dataMap.empty())
        {
            return pd;
        }

        pd.IsOk = true;

        // 1. 기본 정보 파싱 (고정 배열로 복사)
        SafeCopyWide(pd.Info.PartCode, 64, GetWideValueE(dataMap, "PartCode"));
        SafeCopyWide(pd.Info.PartName, 128, GetWideValueE(dataMap, "PartName"));
        SafeCopyWide(pd.Info.KeyComposite, 256, GetWideValueE(dataMap, "KeyComposite"));

        SafeCopyWide(pd.Info.Shaft_Diameter, 64, GetWideValueK(dataMap, L"축 지름(전체동일)"));
        SafeCopyWide(pd.Info.Shaft_Length, 64, GetWideValueK(dataMap, L"전체 길이"));
        SafeCopyWide(pd.Info.Offset_Length, 64, GetWideValueK(dataMap, L"기준 이격 거리"));
        SafeCopyWide(pd.Info.InnerFixType, 64, GetWideValueK(dataMap, L"안쪽 고정 방식"));
        SafeCopyWide(pd.Info.HasGrindingRelief, 64, GetWideValueK(dataMap, L"연삭 틈새 적용"));
        SafeCopyWide(pd.Info.InnerSupportX, 64, GetWideValueK(dataMap, L"안쪽 멈춤링 홈 거리"));
        SafeCopyWide(pd.Info.OuterFix, 64, GetWideValueK(dataMap, L"바깥쪽 고정 방식"));
        SafeCopyWide(pd.Info.ThreadOuterDia, 64, GetWideValueK(dataMap, L"수나사 규격"));
        SafeCopyWide(pd.Info.ThreadLength, 64, GetWideValueK(dataMap, L"수나사 길이"));
        SafeCopyWide(pd.Info.ThreadEffectiveLength, 64, GetWideValueK(dataMap, L"나사산 유효 길이"));
        SafeCopyWide(pd.Info.ThreadDirection, 64, GetWideValueK(dataMap, L"수나사 방향"));
        SafeCopyWide(pd.Info.ThreadSpec, 64, GetWideValueK(dataMap, L"수나사 특수 변경"));
        SafeCopyWide(pd.Info.FineThreadDia, 64, GetWideValueK(dataMap, L"가는 나사 규격"));
        SafeCopyWide(pd.Info.ReliefSize, 64, GetWideValueK(dataMap, L"릴리프 치수 가공"));

        SafeCopyWide(pd.Info.OuterFixingComponent, 64, GetWideValueK(dataMap, L"바깥쪽 고정 부품"));
        SafeCopyWide(pd.Info.RingOffset2, 64, GetWideValueK(dataMap, L"바깥쪽 멈춤링 홈 거리"));
        SafeCopyWide(pd.Info.HasOilSeal, 64, GetWideValueK(dataMap, L"오일 씰 추가 여부"));
        SafeCopyWide(pd.Info.OilSealOffset, 64, GetWideValueK(dataMap, L"오일씰 위치"));

        SafeCopyWide(pd.Info.Keyway, 64, GetWideValueK(dataMap, L"키 홈 형상"));
        SafeCopyWide(pd.Info.KeywayAdditionalType, 64, GetWideValueK(dataMap, L"키 홈 추가공"));
        SafeCopyWide(pd.Info.PKeyOffset1, 64, GetWideValueK(dataMap, L"첫 번째 키홈 위치"));
        SafeCopyWide(pd.Info.PKeyLength1, 64, GetWideValueK(dataMap, L"첫 번째 키홈 길이"));
        SafeCopyWide(pd.Info.PKeyOffset2, 64, GetWideValueK(dataMap, L"두 번째 키홈 위치"));
        SafeCopyWide(pd.Info.PKeyLength2, 64, GetWideValueK(dataMap, L"두 번째 키홈 길이"));
        SafeCopyWide(pd.Info.GenerateKeySolid, 64, GetWideValueK(dataMap, L"키 생성 여부"));

        SafeCopyWide(pd.Info.WrenchFlat, 64, GetWideValueK(dataMap, L"평면취 (렌치 플랫)"));
        SafeCopyWide(pd.Info.WFlatOffset1, 64, GetWideValueK(dataMap, L"첫 번째 면취 거리"));
        SafeCopyWide(pd.Info.WFlatLength1, 64, GetWideValueK(dataMap, L"첫 번째 면취 길이"));
        SafeCopyWide(pd.Info.WFlatOffset2, 64, GetWideValueK(dataMap, L"두 번째 면취 거리"));
        SafeCopyWide(pd.Info.WFlatLength2, 64, GetWideValueK(dataMap, L"두 번째 면취 길이"));
        SafeCopyWide(pd.Info.WrenchFlatAngle, 64, GetWideValueK(dataMap, L"면취 각도"));

        SafeCopyWide(pd.Info.HasCenterHole, 64, GetWideValueK(dataMap, L"센터 구멍"));
        SafeCopyWide(pd.Info.FemaleThreadName, 64, GetWideValueK(dataMap, L"암나사 규격"));

        SafeCopyWide(pd.Info.HasSlitCam, 64, GetWideValueK(dataMap, L"슬릿캠"));
        SafeCopyWide(pd.Info.SCamOffset2, 64, GetWideValueK(dataMap, L"슬릿캠 위치"));
        SafeCopyWide(pd.Info.HasSlitting, 64, GetWideValueK(dataMap, L"슬리팅"));

        SafeCopyWide(pd.Info.DPartChamfer, 64, GetWideValueK(dataMap, L"D부 C면취 변경"));
        SafeCopyWide(pd.Info.MaterialType, 64, GetWideValueK(dataMap, L"재질 선택"));
        SafeCopyWide(pd.Info.SurfaceTreatment, 64, GetWideValueK(dataMap, L"표면 처리"));
        SafeCopyWide(pd.Info.DTolerance, 64, GetWideValueK(dataMap, L"D부 공차 변경"));
        SafeCopyWide(pd.Info.PTolerance, 64, GetWideValueK(dataMap, L"P부 공차 변경"));
        SafeCopyWide(pd.Info.CoaxialityTolerance, 64, GetWideValueK(dataMap, L"동축도 변경"));

        // 2. 기본 치수 파싱
        pd.Dim.pKey_Width = GetDimE(dataMap, "pKey_Width", unit);
        pd.Dim.pKey_Height = GetDimE(dataMap, "pKey_Height", unit);
        pd.Dim.pKey_Depth = GetDimE(dataMap, "pKey_Depth", unit);
        pd.Dim.pKey_Depth1 = GetDimE(dataMap, "pKey_Depth1", unit);
        pd.Dim.pKey_Depth2 = GetDimE(dataMap, "pKey_Depth2", unit);
        pd.Dim.wKey_Radius = GetDimE(dataMap, "wKey_Radius", unit);
        pd.Dim.wKey_Width = GetDimE(dataMap, "wKey_Width", unit);
        pd.Dim.wKey_Depth = GetDimE(dataMap, "wKey_Depth", unit);
        pd.Dim.retRing_Width = GetDimE(dataMap, "retRing_Width", unit);
        pd.Dim.retRing_Radius = GetDimE(dataMap, "retRing_Radius", unit);
        pd.Dim.retRing_FreeID = GetDimE(dataMap, "retRing_FreeID", unit);
        pd.Dim.retRing_Thickness = GetDimE(dataMap, "retRing_Thickness", unit);
        pd.Dim.retRing_MaxWidth = GetDimE(dataMap, "retRing_MaxWidth", unit);
        pd.Dim.retRing_MaxOD = GetDimE(dataMap, "retRing_MaxOD", unit);
        pd.Dim.retRing_EndWidth = GetDimE(dataMap, "retRing_EndWidth", unit);
        pd.Dim.retRing_HoleDia = GetDimE(dataMap, "retRing_HoleDia", unit);
        pd.Dim.endRing_Width = GetDimE(dataMap, "endRing_Width", unit);
        pd.Dim.endRing_Radius = GetDimE(dataMap, "endRing_Radius", unit);
        pd.Dim.endRing_FreeID = GetDimE(dataMap, "endRing_FreeID", unit);
        pd.Dim.endRing_Thickness = GetDimE(dataMap, "endRing_Thickness", unit);
        pd.Dim.endRing_MaxWidth = GetDimE(dataMap, "endRing_MaxWidth", unit);
        pd.Dim.endRing_MaxOD = GetDimE(dataMap, "endRing_MaxOD", unit);
        pd.Dim.endRing_EndWidth = GetDimE(dataMap, "endRing_EndWidth", unit);
        pd.Dim.endRing_HoleDia = GetDimE(dataMap, "endRing_HoleDia", unit);
        pd.Dim.slit_Width = GetDimE(dataMap, "slit_Width", unit);
        pd.Dim.slit_Depth = GetDimE(dataMap, "slit_Depth", unit);
        pd.Dim.sCam_Radius = GetDimE(dataMap, "sCam_Radius", unit);
        pd.Dim.sCam_Width = GetDimE(dataMap, "sCam_Width", unit);
        pd.Dim.sCam_Diameter = GetDimE(dataMap, "sCam_Diameter", unit);
        pd.Dim.wFlat_Depth = GetDimE(dataMap, "wFlat_Depth", unit);
        pd.Dim.wFlat_Length = GetDimE(dataMap, "wFlat_Length", unit);
        pd.Dim.ch_Radius = GetDimE(dataMap, "ch_Radius", unit);
        pd.Dim.ch_Depth = GetDimE(dataMap, "ch_Depth", unit);
        pd.Dim.locknut_OuterDia = GetDimE(dataMap, "locknut_OuterDia", unit);
        pd.Dim.locknut_Thickness = GetDimE(dataMap, "locknut_Thickness", unit);
        pd.Dim.locknut_SlotWidth = GetDimE(dataMap, "locknut_SlotWidth", unit);
        pd.Dim.locknut_SlotDepth = GetDimE(dataMap, "locknut_SlotDepth", unit);

        return pd;
    }


}  // namespace PartManagerIPC
