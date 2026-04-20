# 새 카테고리 DB 추가 가이드

새 카테고리 DB (예: `Cylinder_Core`, `LmGuide_Core`, `Pneumatic_Core`)를
BizMech 에 통합하는 절차입니다. **소스 코드는 거의 수정할 필요가 없습니다 —
대부분 데이터베이스 작업 + 환경변수 한 줄 추가입니다.**

---

## 사전 점검

새 DB는 기존 `Standard_Core` / `Motor_Core` 와 **동일한 스키마**를 가져야
합니다 (PartManager 가 만드는 SQLite 와 같은 구조).

필수 테이블:
- `partspec` (id, part_type, part_code, part_name, spec_data, is_active)
- `partdimension` (id, part_code, key_composite, key_values, dimension_data, is_active)
- `dimensionmeta` (part_code, field_name, …, is_key_field, …)
- `dimensionkeyoption` (part_code, key_field_name, …)

선택 테이블 (PartManager 와 호환을 위해 권장):
- `Unit`, `Vendor`, `partseries`, `dimcalculator`

`maincategory` / `subcategory` / `midcategory` / `parttype` 는 **PRIMARY DB
(Standard_Core)** 에만 두면 됩니다 — 새 카테고리도 거기에 등록합니다.

---

## 5단계 절차 — 예시: `Cylinder_Core` 추가

### 1단계  PostgreSQL 에 새 DB 생성

```sql
-- 192.168.0.17 Postgres 에 접속한 상태에서
CREATE DATABASE "Cylinder_Core"
  WITH OWNER = clickinfo
       ENCODING = 'UTF8'
       LC_COLLATE = 'C'
       LC_CTYPE = 'C'
       TEMPLATE = template0;
```

### 2단계  스키마 마이그레이션

기존 `Standard_Core` 의 partspec / partdimension / dimensionmeta /
dimensionkeyoption 테이블 정의를 `Cylinder_Core` 로 복제:

```bash
pg_dump -h 192.168.0.17 -U clickinfo -d Standard_Core \
        --schema-only \
        --table=partspec --table=partdimension \
        --table=dimensionmeta --table=dimensionkeyoption \
        --table=Unit --table=Vendor \
  | psql -h 192.168.0.17 -U clickinfo -d Cylinder_Core
```

### 3단계  데이터 적재

PartManager 가 생성한 `Cylinder_Core.db` (SQLite) 를 Postgres 로 옮기는
가장 빠른 방법:

```bash
# pgloader 사용 (https://pgloader.io/) — 가장 깔끔
pgloader Cylinder_Core.db pgsql://clickinfo:****@192.168.0.17/Cylinder_Core
```

또는 PartManager 측에서 export 스크립트를 돌리거나 CSV 우회로:

```bash
# SQLite → CSV → COPY (테이블별 반복)
sqlite3 Cylinder_Core.db -header -csv \
  "SELECT * FROM partspec;" > partspec.csv

psql -h 192.168.0.17 -U clickinfo -d Cylinder_Core \
  -c "\copy partspec FROM 'partspec.csv' CSV HEADER"
```

### 4단계  Standard_Core 에 카테고리 메타 등록

```sql
-- PRIMARY DB (Standard_Core) 에 접속
\c Standard_Core

-- 1) 대분류
INSERT INTO maincategory
  (main_cat_code, main_cat_name, main_cat_name_kr, is_standard,
   sort_order, is_active, db_file_name, color_code)
VALUES
  ('CYLINDER', 'Pneumatic Cylinder', '공압 실린더', false,
   6, true, 'Cylinder_Core.db',         -- ★ 새 DB 파일명 매칭
   '#06B6D4');

-- 2) 중분류 (필요하면 여러 개)
INSERT INTO subcategory
  (sub_cat_code, sub_cat_name, sub_cat_name_kr, main_cat_code,
   sort_order, is_active, is_vendor)
VALUES
  ('CYLINDER_AIR', 'Air Cylinder', '에어 실린더', 'CYLINDER',
   1, true, false),
  ('CYLINDER_GUIDE', 'Guide Cylinder', '가이드 실린더', 'CYLINDER',
   2, true, false);

-- 3) (선택) 소분류
-- INSERT INTO midcategory ...

-- 4) (선택) 부품 종류
-- INSERT INTO parttype ...
```

⚠ **`db_file_name` 의 값은 정확히 `<DB이름>.db`** 이어야 합니다.
프록시가 이 값에서 `.db` 를 떼고 case-insensitive 로 `PG_DATABASES` 와
매칭합니다.

### 5단계  프록시 환경변수 한 줄 수정

`bizmech-proxy/.env` 의 `PG_DATABASES` 에 새 DB 이름을 콤마로 추가:

```diff
- PG_DATABASES=Standard_Core,Motor_Core
+ PG_DATABASES=Standard_Core,Motor_Core,Cylinder_Core

  # (선택) 친근한 alias 추가
- PG_DB_ALIASES=std:Standard_Core,motor:Motor_Core
+ PG_DB_ALIASES=std:Standard_Core,motor:Motor_Core,cyl:Cylinder_Core
```

프록시 재시작 (`tsx watch` 모드면 자동) 하면 끝.

```
  Registered DBs (3): Standard_Core, Motor_Core, Cylinder_Core  [primary=Standard_Core]
  Postgres [Standard_Core]   OK — Standard_Core — PostgreSQL 10.19
  Postgres [Motor_Core]      OK — Motor_Core    — PostgreSQL 10.19
  Postgres [Cylinder_Core]   OK — Cylinder_Core — PostgreSQL 10.19
```

---

## 검증

### 5-1. 헬스 + 등록 상태 확인
```bash
curl http://localhost:8080/diag/dbs
```
```json
{
  "registered": ["Standard_Core","Motor_Core","Cylinder_Core"],
  "primary": "Standard_Core",
  "status": [
    {"db":"Standard_Core","status":"OK — Standard_Core — PostgreSQL 10.19"},
    {"db":"Motor_Core","status":"OK — Motor_Core — PostgreSQL 10.19"},
    {"db":"Cylinder_Core","status":"OK — Cylinder_Core — PostgreSQL 10.19"}
  ],
  "ok": true
}
```

### 5-2. 카테고리 트리에 노출 확인

`/api/categories/main` 응답에 `CYLINDER` 가 포함되어야 합니다. 만약 보이지
않으면 **프론트엔드의 `WEB_VISIBLE` 화이트리스트** 를 확인하세요.

```ts
// bizmech-web/src/services/api/MockPartApi.ts
const WEB_VISIBLE = new Set(['STANDARD', 'MOTOR']);  // ← 'CYLINDER' 추가
```
```ts
// bizmech-proxy/src/routes/categories.ts
const WEB_VISIBLE = new Set(['STANDARD', 'MOTOR']);  // ← 'CYLINDER' 추가
```

### 5-3. 부품 인덱스 확인

```bash
curl http://localhost:8080/diag/index
```
```json
{
  "totals": { "Standard_Core": 125, "Motor_Core": 44, "Cylinder_Core": 38 },
  "buckets": { ... }
}
```

### 5-4. subCategory → DB 매핑 확인

```bash
curl http://localhost:8080/diag/sub-index
```
```json
{
  "STD_FASTENER": "Standard_Core",
  "STD_BEARING": "Standard_Core",
  "SERVO": "Motor_Core",
  "BLDC": "Motor_Core",
  "CYLINDER_AIR": "Cylinder_Core",
  "CYLINDER_GUIDE": "Cylinder_Core"
}
```

`Cylinder_Core` 가 안 보이면 `maincategory.db_file_name` 값이 정확한지
재확인.

### 5-5. (선택) 모터 외 카테고리의 leaf-parts 매핑

`/api/motor/parts?subCatCode=CYLINDER_AIR` 호출 시 빈 배열이 나오면
`bizmech-proxy/src/routes/categories.ts` 의 `SUB_TO_PART_TYPE` 맵을 확장:

```ts
const SUB_TO_PART_TYPE: Record<string, string[]> = {
  SERVO: ['Servo'], BLDC: ['BLDC'], STEPPER: ['Stepper'], GEARED: ['Geard', 'Geared'],
  CYLINDER_AIR: ['Cylinder', 'Air'],          // ★ 추가
  CYLINDER_GUIDE: ['GuideCylinder'],          // ★ 추가
};
```

(또는 그냥 두면 자동으로 `ILIKE 'cylinder_air%'` 폴백이 적용됩니다.)

---

## 권한 분리 (구독 모델용 - 선택)

DB 별 권한을 분리하려면:

```sql
-- 표준 부품 전용 ROLE
CREATE ROLE bizmech_basic LOGIN PASSWORD '...';
GRANT CONNECT ON DATABASE "Standard_Core" TO bizmech_basic;
-- Motor_Core / Cylinder_Core 에는 권한 안 줌

-- 프리미엄 ROLE
CREATE ROLE bizmech_premium LOGIN PASSWORD '...';
GRANT CONNECT ON DATABASE "Standard_Core" TO bizmech_premium;
GRANT CONNECT ON DATABASE "Motor_Core"    TO bizmech_premium;
GRANT CONNECT ON DATABASE "Cylinder_Core" TO bizmech_premium;
```

이후 사용자 구독 등급에 따라 프록시가 다른 `PG_USER` 로 connect 하거나,
프록시 미들웨어에서 JWT 의 `allowedDbs` claim 을 검사해 차단합니다.

---

## 롤백 (DB 제거)

1. `.env` 의 `PG_DATABASES` 에서 해당 이름 제거
2. `Standard_Core.maincategory` 의 해당 row 의 `is_active = false`
3. 프록시 재시작
4. (선택) Postgres 에서 `DROP DATABASE "Cylinder_Core"`

---

## 트러블슈팅

| 증상 | 원인 | 해결 |
|---|---|---|
| `database "Cylinder_Core" does not exist` | DB 이름 오타 / 미생성 | `psql -l` 로 실제 이름 확인, `.env` 수정 |
| `permission denied for database` | clickinfo 가 새 DB 권한 없음 | `GRANT CONNECT ON DATABASE "Cylinder_Core" TO clickinfo;` |
| `/diag/sub-index` 에 새 sub 가 안 뜸 | `maincategory.db_file_name` 누락 / 오타 | INSERT 문의 db_file_name 값 재확인 |
| `/api/motor/parts?subCatCode=CYLINDER_AIR` 빈 배열 | partspec.part_type 값 매칭 실패 | `SUB_TO_PART_TYPE` 맵 추가 또는 데이터 part_type 값을 subCatCode 와 정렬 |
| 프록시는 OK 인데 프론트엔드가 카테고리를 못 봄 | `WEB_VISIBLE` 화이트리스트 누락 | MockPartApi 와 categories.ts 양쪽에 새 main_cat_code 추가 |
| `/diag/index` 토탈이 갱신 안 됨 | partIndex 캐시 stale | `curl -X POST http://localhost:8080/diag/reset` |

---

## 요약 체크리스트

```
☐ 1. PostgreSQL 에 새 DB CREATE
☐ 2. 스키마 마이그레이션 (pg_dump --schema-only)
☐ 3. 데이터 적재 (pgloader / CSV)
☐ 4. Standard_Core 에 maincategory + subcategory INSERT
     (db_file_name = '<NewDb>.db' 정확히)
☐ 5. .env 의 PG_DATABASES 에 새 DB 이름 추가
☐ 6. 프론트 + 프록시의 WEB_VISIBLE 에 main_cat_code 추가
☐ 7. (필요 시) SUB_TO_PART_TYPE 맵 확장
☐ 8. 프록시 재시작 후 /diag/dbs · /diag/sub-index 검증
☐ 9. 브라우저에서 새 카테고리 트리 동작 확인
```
