/**
 * Bearing family — single entry point for every bearing variant
 * registered in this proxy. Phase 1 implements the deep-groove ball
 * bearing (DGBB) plus its three related variants which the C++
 * reference (`NewCreateBearingClass.cpp` line 758–766) handles via
 * the same `CreateDeepGrooveBallBearing` function:
 *
 *   DGBB — 깊은 홈 볼베어링         (canonical)
 *   MNBB — 맥시멈형 볼베어링        (same geometry, different fill ratio)
 *   MIBB — 미니어쳐 볼베어링        (same geometry, smaller scale)
 *   ENBB — 매그니토 볼베어링        (will need open-side variant later)
 *
 * The remaining BearingType variants (cylindrical roller, taper
 * roller, mounted units, oil seals, etc.) will arrive in Phase 2+
 * — each gets its own generator function but shares this family
 * scaffolding (registry entry, dimension resolver, BOM embedder).
 *
 * STEP backend toggle (CAD_BACKEND env var):
 *   `occt` → real solids of revolution with `TOROIDAL_SURFACE`
 *            raceway grooves — measurable in CAD ✓
 *   `hand` → degraded fallback (no groove) — fastener-style fill-in
 *            kept only so requests succeed during OCCT outages
 */
import type { CadGenerateRequest, CadGenerateResult } from '../../types.js';
import { LOCAL_FORMATS } from '../../types.js';
import { registerFamily } from '../registry.js';
import { resolveBearingDims } from './dimensions.js';
import { buildBearingStep } from './step.js';
import { buildDgbbStepViaOcct } from './step-occt.js';
import { buildScrbStepViaOcct, buildDcrbStepViaOcct } from './step-occt-crb.js';
import { buildStrbStepViaOcct, buildDtrbStepViaOcct } from './step-occt-trb.js';
import { buildSabbStepViaOcct } from './step-occt-sabb.js';
import { buildSarbStepViaOcct } from './step-occt-srb.js';
import {
  buildSnrbStepViaOcct,
  buildCnrbStepViaOcct,
  buildShnrbStepViaOcct,
} from './step-occt-nrb.js';
import {
  buildStbbStepViaOcct,
  buildDtbbStepViaOcct,
  buildTacbbStepViaOcct,
  buildDtabbStepViaOcct,
} from './step-occt-tbb.js';
import { buildUcbStepViaOcct } from './step-occt-uc.js';
import {
  buildUcfStepViaOcct,
  buildUcfsStepViaOcct,
  buildUcfcStepViaOcct,
  buildUcflStepViaOcct,
} from './step-occt-uc-flange.js';
import { buildAcbbStepViaOcct } from './step-occt-acbb.js';
import { buildTcrbStepViaOcct, buildTsarbStepViaOcct } from './step-occt-trbg.js';
import { buildDrbbStepViaOcct } from './step-occt-bss.js';
import { buildFlbbStepViaOcct } from './step-occt-flbb.js';
import { buildOsealStepViaOcct } from './step-occt-oilseal.js';
import {
  buildOillessStepViaOcct,
  OILLESS_CODES,
} from './step-occt-oilless.js';
import { buildPlummerBlockStepViaOcct } from './step-occt-plummer.js';
import { resolvePlummerBlockDims } from './dimensions-plummer.js';
import { buildPlummerBlockDxf } from './dxf-plummer.js';
import { buildBearingDxf } from './dxf.js';
import { buildOillessDxf } from './dxf-oilless.js';
import { resetOcct } from '../../core/occt.js';
import { resolveBomMetadata } from '../../core/bom-meta.js';
import { embedBomInStep } from '../../core/step-bom.js';

const USE_OCCT = (process.env.CAD_BACKEND ?? 'hand').toLowerCase() === 'occt';

/**
 * partCode → bearing kind. Phase 1 maps the four DGBB-family codes
 * to a single shared generator. Adding a new BearingType (Cylindrical
 * Roller, Taper Roller, etc.) means: implement the new generator
 * function, add an entry here pointing to it, and register the
 * partCode in `BEARING_CODES`.
 */
type BearingKind =
  | 'DeepGrooveBall'
  | 'CylindricalRoller'
  | 'CylindricalRollerDouble'
  | 'TaperRoller'
  | 'TaperRollerDouble'
  | 'SelfAligningBall'
  | 'SphericalRoller'
  | 'NeedleRoller'
  | 'NeedleRollerGauge'
  | 'NeedleRollerDrawnCup'
  | 'ThrustBall'
  | 'ThrustBallDouble'
  | 'ThrustBallAngularContact'
  | 'ThrustBallDoubleAngularContact'
  | 'UCBearing'
  | 'UCBearingSquareFlange'
  | 'UCBearingSquareFlangeSocket'
  | 'UCBearingRoundFlangeSocket'
  | 'UCBearingRhombusFlange'
  | 'AngularContactBall'
  | 'ThrustRoller'
  | 'ThrustRollerSpherical'
  | 'BallScrewSupport'
  | 'Flanged'
  | 'OilSeal'
  | 'Oilless'
  | 'PlummerBlock';

const KIND_OF_CODE: Record<string, BearingKind> = {
  DGBB: 'DeepGrooveBall',
  MNBB: 'DeepGrooveBall',
  MIBB: 'DeepGrooveBall',
  ENBB: 'DeepGrooveBall', // Magneto — same geometry until Phase 2 special-cases the open shoulder.
  // Cylindrical roller — single row.
  SCRB: 'CylindricalRoller',
  // Double-row cylindrical roller — two stacked single-row sub-bearings,
  // each spanning B/2 of the catalog total width. C++ line 2147-2160
  // attempts a "mirror across XZ plane" which is geometrically a no-op
  // for rotational solids; we deviate by axially offsetting the second
  // row so the output actually has two roller rows.
  DCRB: 'CylindricalRollerDouble',
  // Taper roller — single row.
  STRB: 'TaperRoller',
  // Double-row taper roller — two complete sub-bearings stacked, each
  // spanning B/2. Tandem orientation (DT) — back-to-back / face-to-face
  // would require mirroring the second row, deferred until DualRow column
  // is exposed.
  DTRB: 'TaperRollerDouble',
  // Self-aligning ball — outer ring is a single sphere section, inner
  // ring carries two raceway grooves, balls in two rows.
  SABB: 'SelfAligningBall',
  // Spherical roller — single + double row (TSARB = thrust variant
  // deferred to Phase 2c).
  SARB: 'SphericalRoller',
  // Needle roller — Solid type with inner ring, no rib (most common
  // SNRB config). DrawnCup (SHNRB) is a separate kind because of its
  // sheet-metal cup outer ring; Gauge (CNRB) is a separate kind because
  // it ships as a cage-and-roller subassembly with NO rings at all.
  SNRB: 'NeedleRoller',
  // Gauge needle (CNRB) — cage-and-roller only, no rings. Used inside
  // hardened housing bores against hardened shafts where the bore /
  // shaft serve as the raceways. C++ line 2453-2455 + the missing
  // Gauge ring branch at 2475-2622.
  CNRB: 'NeedleRollerGauge',
  // Drawn-cup needle (SHNRB) — sheet-metal cup outer ring (no machined
  // outer ring or inner ring). The cup has bent corners that retain
  // needles axially during shipping. C++ line 2544-2622 (DrawnCup
  // branch).
  SHNRB: 'NeedleRollerDrawnCup',
  // Thrust ball — single direction.
  STBB: 'ThrustBall',
  // Double-direction thrust ball — central shaft washer with 2 raceway
  // grooves + 2 housing washers (one per side) + 2 ball rows. C++
  // line 3027-3098.
  DTBB: 'ThrustBallDouble',
  // Precision angular-contact thrust ball — single row at a steep
  // contact angle (60° default). Inner / outer rings have ASYMMETRIC
  // raceway grooves (tall shoulder + low relief). HSTACBB / DDTACBB
  // map to the same geometry. C++ line 3189-3281.
  TACBB: 'ThrustBallAngularContact',
  HSTACBB: 'ThrustBallAngularContact',
  DDTACBB: 'ThrustBallAngularContact',
  // Double-row angular-contact thrust ball — central inner ring with
  // 2 angular-contact grooves + 2 outer rings + 2 ball rows. C++ line
  // 3100-3188.
  DTABB: 'ThrustBallDoubleAngularContact',
  // UC mounted-unit insert bearing (no housing).
  UCB: 'UCBearing',
  // Unit bearings with FLANGE housings — UC vs UK is just bore type
  // (cylindrical vs taper) on the inner ring; housing geometry is
  // identical, so both share the same generator. C++ unified function
  // `CreateFlangeHousing(boltHoles, isRoundBody, hasSpigot)` at line
  // 5166 differentiates the four shapes via three boolean flags.
  UCF:  'UCBearingSquareFlange',         // square, 4 holes, no socket
  UKF:  'UCBearingSquareFlange',
  UCFS: 'UCBearingSquareFlangeSocket',   // square, 4 holes, with socket
  UKFS: 'UCBearingSquareFlangeSocket',
  UCFC: 'UCBearingRoundFlangeSocket',    // round, 4 holes at 45°, with socket
  UKFC: 'UCBearingRoundFlangeSocket',
  UCFL: 'UCBearingRhombusFlange',        // rhombus / oval, 2 holes (simplified to rectangle)
  UKFL: 'UCBearingRhombusFlange',
  // Angular contact ball — single row only at this stage.
  // DACBB (DB pair) / MACBB / FPCBB / UHSACBB / HACCBB variants
  // deferred to Phase 3b once SACBB is verified.
  ACBB: 'AngularContactBall',
  // Thrust cylindrical roller — flat washers + N radial cylinders.
  TCRB: 'ThrustRoller',
  // Thrust spherical roller — flat washers + N tilted barrel rollers
  // at 50° contact angle. Spherical raceway carve on the washers is
  // deliberately omitted (would not change measurable dimensions);
  // the rollers themselves carry the distinctive barrel-on-tilted-axis
  // geometry that distinguishes TSARB from TCRB.
  TSARB: 'ThrustRollerSpherical',
  // Ball-screw support bearing — double-row 60° angular contact ball
  // bearing optimised for axial-screw shaft duty. HLDTBB and HRTBB
  // share the same generator (deferred for now; map both later).
  DRBB: 'BallScrewSupport',
  // Flanged DGBB — DGBB topology with an extra annular flange disk on
  // one axial face of the outer ring. The C++ reference (line 4618)
  // matches any partCode containing "FL" or "MF", which clashes with
  // UCFL / UKFL / FLBOLT / FLGNUT in our DB; this synthetic partCode
  // 'FLBB' (FLanged Ball Bearing) keeps the dispatch unambiguous and
  // is wired up so a future DB row can use it directly.
  FLBB: 'Flanged',
  // Radial shaft oil seal — outer metal case + rubber elastomer +
  // optional inner metal case + optional brass garter spring (torus).
  // Variant (S/D/G × ''/M/A — 9 total) is read from the partspec's
  // LipShape column at generator time; default falls back to SM.
  OSEAL: 'OilSeal',
  // Oilless family — non-rolling oil-impregnated bushings, washers,
  // plates, spherical bearings, and guide pins. Six shape types
  // (Sleeve / Flange / ThrustWasher / Plate / Spherical / Pin) are
  // dispatched inside the generator from the partCode — see
  // `step-occt-oilless.ts:SHAPE_PATTERNS`. Mounting holes / DRY-slit /
  // graphite-plug pattern are intentionally skipped (cosmetic — see
  // file header for rationale).
  ...Object.fromEntries(OILLESS_CODES.map((c) => [c, 'Oilless' as BearingKind])),
  // Split-type plummer block housings — heavy-duty SD (4 cap bolts)
  // and light-duty SN (2 cap bolts). C++ line 6922 (Lower) + 7383
  // (Upper). Single multi-body STEP with the 2 housing halves +
  // bearing bore + foot mounting slots + cap-bolt clearance holes.
  SD: 'PlummerBlock',
  SN: 'PlummerBlock',
};

const BEARING_CODES = Object.keys(KIND_OF_CODE);

/**
 * Surface-count sanity check on a generated STEP. Returns null if the
 * file looks correct, or a short reason string if it fails — caller
 * falls back to the hand-written degraded path.
 *
 * Each bearing kind has a characteristic curved-surface signature.
 * OCCT occasionally produces planar tessellations on numerically
 * degenerate inputs (catalog rows with bad fillets, degenerate
 * shoulders, etc.) and these counts catch that case before the file
 * ships to the user.
 *
 * Sharing-aware: `rotateShapeAroundZ(..., share=true)` collapses N
 * rolling elements to 1 BRep + N placements, so we accept either
 * "≥ 6 spheres / cylinders" OR "1 sphere/cylinder + ≥ 6 placements".
 */
function validateOcctBearingStep(kind: BearingKind, stepText: string): string | null {
  const cylinders = (stepText.match(/CYLINDRICAL_SURFACE/g) || []).length;
  const toroidals = (stepText.match(/TOROIDAL_SURFACE/g) || []).length;
  const spheres = (stepText.match(/SPHERICAL_SURFACE/g) || []).length;
  const placements = (stepText.match(/NEXT_ASSEMBLY_USAGE_OCCURRENCE/g) || []).length;

  // TaperRoller raceways are CONICAL — no toroidal grooves expected —
  // so the toroidal sanity check applies only to ball / cylindrical
  // raceways. Each kind also has a different rolling-element signature
  // so we keep all per-kind logic together below.
  if (kind === 'DeepGrooveBall') {
    if (toroidals < 2) {
      return `OCCT output has ${toroidals} toroidal surfaces (expected ≥ 2 for both raceways)`;
    }
    // 2+ ring CYLINDRICAL_SURFACEs (bore + OD), N ball SPHERICAL_SURFACEs.
    if (cylinders < 2) {
      return `OCCT output has ${cylinders} cylindrical surfaces (expected ≥ 2 for both rings)`;
    }
    const ballsLooksRight = spheres >= 6 || (spheres >= 1 && placements >= 6);
    if (!ballsLooksRight) {
      return (
        `OCCT output has ${spheres} spherical surfaces and ${placements} ` +
        `placements (expected ≥ 6 spheres OR a shared sphere with ≥ 6 placements)`
      );
    }
    return null;
  }
  if (kind === 'CylindricalRollerDouble') {
    // Two stacked single-row CRBs — each row contributes the SCRB
    // signature, so totals roughly double.
    if (toroidals < 4) {
      return `OCCT output has ${toroidals} toroidal surfaces (expected ≥ 4 — both rows' raceways)`;
    }
    if (cylinders < 16) {
      return (
        `OCCT output has ${cylinders} cylindrical surfaces ` +
        `(expected ≥ 16 — 2 rows × (2 rings + ≥ 6 rollers))`
      );
    }
    return null;
  }
  if (kind === 'CylindricalRoller') {
    if (toroidals < 2) {
      return `OCCT output has ${toroidals} toroidal surfaces (expected ≥ 2 for both raceways)`;
    }
    // 2 rings (CYLINDRICAL on bore + OD) PLUS N rollers (each is itself a
    // CYLINDRICAL_SURFACE), so total cylinders ≥ 2 + 6 = 8 in unshared
    // mode, or 2 + 1 = 3 with shared roller BRep + ≥ 6 placements.
    const rollersLooksRight = cylinders >= 8 || (cylinders >= 3 && placements >= 6);
    if (!rollersLooksRight) {
      return (
        `OCCT output has ${cylinders} cylindrical surfaces and ${placements} ` +
        `placements (expected ≥ 8 cylinders OR ≥ 3 cylinders with ≥ 6 placements)`
      );
    }
    return null;
  }
  if (kind === 'TaperRollerDouble') {
    // Two stacked taper-roller sub-bearings — conical signature doubles.
    const conicals = (stepText.match(/CONICAL_SURFACE/g) || []).length;
    if (conicals < 16) {
      return (
        `OCCT output has ${conicals} conical surfaces ` +
        `(expected ≥ 16 — 2 rows × (2 raceways + ≥ 6 rollers))`
      );
    }
    return null;
  }
  if (kind === 'TaperRoller') {
    // Inner cone has 1 CYLINDRICAL (bore) + 1 CONICAL (raceway taper).
    // Outer cup has 1 CYLINDRICAL (OD) + 1 CONICAL (raceway taper).
    // Each roller is a CONICAL surface (truncated cone) — N rollers.
    // The earlier `toroidals < 2` check is a poor fit for taper (no
    // toroidal raceways), so we override it: TaperRoller has no
    // toroidal-radius raceway grooves — its raceways are conical.
    const conicals = (stepText.match(/CONICAL_SURFACE/g) || []).length;
    if (conicals < 8) {
      return (
        `OCCT output has ${conicals} conical surfaces ` +
        `(expected ≥ 8 — 2 raceways + ≥ 6 rollers)`
      );
    }
    return null;
  }
  if (kind === 'Flanged') {
    // FLBB: DGBB topology + 1 extra annular flange disk. Surface counts
    // are the same as DGBB (2 raceway TOROIDAL + 4 corner fillet + N
    // ball SPHERICAL) PLUS the flange contributes 1-2 cylindrical
    // surfaces (flange OD + flange inner-bore at outerR).
    if (toroidals < 2) {
      return `OCCT output has ${toroidals} toroidal surfaces (expected ≥ 2 for both raceways)`;
    }
    if (cylinders < 3) {
      return (
        `OCCT output has ${cylinders} cylindrical surfaces ` +
        `(expected ≥ 3 — bearing bore + OD + flange OD)`
      );
    }
    const ballsLooksRight = spheres >= 6 || (spheres >= 1 && placements >= 6);
    if (!ballsLooksRight) {
      return `OCCT output has ${spheres} spherical surfaces and ${placements} placements (expected ≥ 6 balls)`;
    }
    return null;
  }
  if (kind === 'BallScrewSupport') {
    // Two rings (CYLINDRICAL bore + OD) + 4 raceway TOROIDAL grooves
    // (2 per ring) + N×2 ball SPHERICAL_SURFACEs. Corner fillets
    // on the rings add another ~4 toroidals.
    if (toroidals < 4) {
      return `OCCT output has ${toroidals} toroidal surfaces (expected ≥ 4 for the four asymmetric raceway grooves)`;
    }
    if (cylinders < 2) {
      return `OCCT output has ${cylinders} cylindrical surfaces (expected ≥ 2 for both rings)`;
    }
    const ballsLooksRight = spheres >= 12 || (spheres >= 2 && placements >= 12);
    if (!ballsLooksRight) {
      return (
        `OCCT output has ${spheres} spherical surfaces and ${placements} ` +
        `placements (expected ≥ 12 balls = 6/row × 2 rows)`
      );
    }
    return null;
  }
  if (kind === 'ThrustRollerSpherical') {
    // 2 washers (rectangular profile) + N tilted barrel rollers. Each
    // barrel is a SPHERICAL_SURFACE arc revolved around its tilted axis,
    // producing a SPHERICAL surface on the roller body. Washer corners
    // contribute toroidals as in TCRB.
    if (cylinders < 4) {
      return (
        `OCCT output has ${cylinders} cylindrical surfaces ` +
        `(expected ≥ 4 — washer faces)`
      );
    }
    if (toroidals < 8) {
      return (
        `OCCT output has ${toroidals} toroidal surfaces ` +
        `(expected ≥ 8 — washer corner fillets)`
      );
    }
    if (spheres < 6) {
      return (
        `OCCT output has ${spheres} spherical surfaces ` +
        `(expected ≥ 6 — barrel-roller convex surfaces)`
      );
    }
    return null;
  }
  if (kind === 'ThrustRoller') {
    // TCRB: 2 flat washers (each contributes 2 CYLINDRICAL = OD + bore +
    // 4 TOROIDAL corner fillets) + N cylindrical rollers (each is 1
    // CYLINDRICAL surface). Total: ≥ 4 (washers) + ≥ 6 (rollers) = 10
    // CYLINDRICAL. TOROIDAL: 8 (4 fillets per washer × 2 washers).
    if (cylinders < 10) {
      return (
        `OCCT output has ${cylinders} cylindrical surfaces ` +
        `(expected ≥ 10 — 4 washer faces + ≥ 6 rollers)`
      );
    }
    if (toroidals < 8) {
      return (
        `OCCT output has ${toroidals} toroidal surfaces ` +
        `(expected ≥ 8 — 4 corner fillets per washer × 2 washers)`
      );
    }
    return null;
  }
  if (kind === 'AngularContactBall') {
    // ACBB has the same DGBB surface signature: 2 ring CYLINDRICAL
    // surfaces (bore + OD) + 2 raceway TOROIDAL grooves + 2 corner
    // fillets per ring + N ball SPHERICAL_SURFACEs. The asymmetric
    // raceway is still a TOROIDAL_SURFACE in STEP — only its location
    // differs from DGBB.
    if (toroidals < 2) {
      return `OCCT output has ${toroidals} toroidal surfaces (expected ≥ 2 for both raceways)`;
    }
    if (cylinders < 2) {
      return `OCCT output has ${cylinders} cylindrical surfaces (expected ≥ 2 for both rings)`;
    }
    const ballsLooksRight = spheres >= 6 || (spheres >= 1 && placements >= 6);
    if (!ballsLooksRight) {
      return (
        `OCCT output has ${spheres} spherical surfaces and ${placements} ` +
        `placements (expected ≥ 6 balls)`
      );
    }
    return null;
  }
  if (
    kind === 'UCBearingSquareFlange' ||
    kind === 'UCBearingSquareFlangeSocket' ||
    kind === 'UCBearingRoundFlangeSocket' ||
    kind === 'UCBearingRhombusFlange'
  ) {
    // UC housing variants = UC bearing (full UCB signature) PLUS the
    // housing solid which contributes additional CYLINDRICAL surfaces
    // (boss + bolt holes + through-bore) and SPHERICAL surfaces (the
    // bearing seat). The base UC checks still apply (raceway grooves,
    // ball spheres). The housing's extra surfaces inflate cylindrical
    // counts so we just use a relaxed lower bound.
    if (toroidals < 4) {
      return `OCCT output has ${toroidals} toroidal surfaces (expected ≥ 4 for UC raceways + corner fillets)`;
    }
    if (cylinders < 5) {
      // 1 inner-ring bore + 1 housing through-bore + ≥ 2 bolt holes + boss OD
      return (
        `OCCT output has ${cylinders} cylindrical surfaces ` +
        `(expected ≥ 5 — bearing bore + housing bore + bolt holes + boss OD)`
      );
    }
    // Outer ring still has 1 SPHERICAL_SURFACE (its OD) + ≥ 6 ball
    // spheres. Housing seat adds another spherical surface.
    if (spheres < 7) {
      return (
        `OCCT output has ${spheres} spherical surfaces ` +
        `(expected ≥ 7 — bearing OD + ≥ 6 balls + housing seat)`
      );
    }
    return null;
  }
  if (kind === 'UCBearing') {
    // UC = DGBB topology (1 toroidal raceway / ring + balls) PLUS one
    // SPHERICAL outer-OD surface (the housing-mating sphere). Cylinders
    // come from the inner ring's bore + the outer ring's two annular
    // end-faces (which OCCT writes as PLANE, not cylinder). Counting:
    //   · CYLINDRICAL: bore (1) + shoulder bands (2-3) ≈ 3+
    //   · TOROIDAL:    2 raceway grooves + 2 inner ring corner fillets ≥ 4
    //   · SPHERICAL:   1 outer OD + N balls ≥ 7
    if (toroidals < 4) {
      return `OCCT output has ${toroidals} toroidal surfaces (expected ≥ 4 for raceways + corner fillets)`;
    }
    if (cylinders < 1) {
      return `OCCT output has ${cylinders} cylindrical surfaces (expected ≥ 1 for the inner ring bore)`;
    }
    const ballsLooksRight = spheres >= 7 || (spheres >= 2 && placements >= 6);
    if (!ballsLooksRight) {
      return (
        `OCCT output has ${spheres} spherical surfaces and ${placements} placements ` +
        `(expected ≥ 7 spheres = OD + ≥ 6 balls, or shared ball geometry with ≥ 6 placements + outer OD)`
      );
    }
    return null;
  }
  if (kind === 'ThrustBallAngularContact') {
    // Inner + outer rings each have 1 ASYMMETRIC raceway groove
    // (TOROIDAL) + 4 corner fillets ⇒ ≥ 10 toroidals. ≥ 6 ball SPHERES.
    if (toroidals < 8) {
      return `OCCT output has ${toroidals} toroidal surfaces (expected ≥ 8 — raceway grooves + corner fillets)`;
    }
    if (cylinders < 2) {
      return `OCCT output has ${cylinders} cylindrical surfaces (expected ≥ 2 — bore + OD)`;
    }
    const ballsLooksRight = spheres >= 6 || (spheres >= 1 && placements >= 6);
    if (!ballsLooksRight) {
      return `OCCT output has ${spheres} spherical surfaces (expected ≥ 6 balls)`;
    }
    return null;
  }
  if (kind === 'ThrustBallDoubleAngularContact') {
    // Central inner with 2 grooves + 2 outer rings each with 1 groove +
    // corner fillets ⇒ ≥ 12 toroidals. 2 ball rows ⇒ ≥ 12 spheres.
    if (toroidals < 10) {
      return `OCCT output has ${toroidals} toroidal surfaces (expected ≥ 10 — 4 grooves + corner fillets)`;
    }
    const ballsLooksRight = spheres >= 12 || (spheres >= 2 && placements >= 12);
    if (!ballsLooksRight) {
      return `OCCT output has ${spheres} spherical surfaces (expected ≥ 12 — 6 balls × 2 rows)`;
    }
    return null;
  }
  if (kind === 'ThrustBallDouble') {
    // 3 washers (central + 2 housing) + 2 ball rows. Central washer
    // has 2 raceway grooves (TOROIDAL) + corner fillets; housing
    // washers each have 1 groove + 4 fillets. Total ≥ 12 toroidals
    // expected.
    if (cylinders < 6) {
      return (
        `OCCT output has ${cylinders} cylindrical surfaces ` +
        `(expected ≥ 6 — 3 washers' OD + bore each)`
      );
    }
    if (toroidals < 10) {
      return (
        `OCCT output has ${toroidals} toroidal surfaces ` +
        `(expected ≥ 10 — 3 raceway grooves + corner fillets)`
      );
    }
    const ballsLooksRight = spheres >= 12 || (spheres >= 2 && placements >= 12);
    if (!ballsLooksRight) {
      return (
        `OCCT output has ${spheres} spherical surfaces ` +
        `(expected ≥ 12 — 6 balls × 2 rows)`
      );
    }
    return null;
  }
  if (kind === 'ThrustBall') {
    // Two washers (shaft + housing) each contribute 1 CYLINDRICAL (OD)
    // + 1 CYLINDRICAL (bore) + planar faces — so cylinders ≥ 4. Each
    // washer has 1 TOROIDAL raceway groove (concave arc revolved) + 4
    // corner fillets ⇒ ≥ 10 toroidals. Balls ⇒ ≥ 6 SPHERICAL_SURFACEs
    // (or ≥ 1 with ≥ 6 placements when share=true was used).
    if (cylinders < 4) {
      return `OCCT output has ${cylinders} cylindrical surfaces (expected ≥ 4 for both washers' OD + bore)`;
    }
    if (toroidals < 8) {
      return (
        `OCCT output has ${toroidals} toroidal surfaces (expected ≥ 8 — ` +
        `2 raceway grooves + 8 corner fillets / safe_r arcs)`
      );
    }
    const ballsLooksRight = spheres >= 6 || (spheres >= 1 && placements >= 6);
    if (!ballsLooksRight) {
      return `OCCT output has ${spheres} spherical surfaces and ${placements} placements (expected ≥ 6 balls)`;
    }
    return null;
  }
  if (kind === 'NeedleRoller') {
    // Inner + outer rings: each contributes 1 CYLINDRICAL (raceway face)
    // + 1 CYLINDRICAL (bore/OD) + 2 TOROIDAL fillets ⇒ ≥ 4 cylinders +
    // 4 toroidals from rings alone.
    // Needles: each is a long cylinder with ROUNDED ENDS — OCCT writes
    // the body as 1 CYLINDRICAL_SURFACE plus 2 TOROIDAL_SURFACE end
    // caps (the corner fillets revolve to a torus). 30+ needles is
    // typical, so total cylinders + toroidals jumps significantly.
    if (cylinders < 8 || toroidals < 4) {
      return (
        `OCCT output has ${cylinders} cylindrical and ${toroidals} toroidal surfaces ` +
        `(expected ≥ 8 cyl + ≥ 4 tor — 4 ring fillets + needle end caps)`
      );
    }
    return null;
  }
  if (kind === 'NeedleRollerDrawnCup') {
    // Drawn cup: 1 outer ring (CYLINDRICAL surfaces on OD + inner
    // raceway face) with 2 corner bends (TOROIDAL each face, total ≥ 2)
    // + ≥ 6 needles each contributing 1 CYLINDRICAL + 2 TOROIDAL caps.
    if (cylinders < 8 || toroidals < 8) {
      return (
        `OCCT output has ${cylinders} cylindrical and ${toroidals} toroidal surfaces ` +
        `(expected ≥ 8 cyl + ≥ 8 tor — cup OD/raceway + 2 corner bends + needle caps)`
      );
    }
    return null;
  }
  if (kind === 'NeedleRollerGauge') {
    // CNRB has NO rings — only needles. Each needle is 1 CYLINDRICAL +
    // 2 TOROIDAL end caps, ≥ 6 needles minimum. So expect ≥ 6 cyl + ≥
    // 12 tor (or ≥ 1 cyl + ≥ 6 placements if shape sharing kicks in,
    // though we don't share needle BReps in CNRB).
    if (cylinders < 6 || toroidals < 12) {
      return (
        `OCCT output has ${cylinders} cylindrical and ${toroidals} toroidal surfaces ` +
        `(expected ≥ 6 cyl + ≥ 12 tor — needles + their end caps)`
      );
    }
    return null;
  }
  if (kind === 'SphericalRoller') {
    // Inner ring: ring with 7-line profile — bore CYLINDRICAL (or
    // CONICAL for tapered bore), top is a series of planar v-grooves
    // (not curved surfaces), so few cylindrical / no toroidal raceways
    // expected on the inner ring itself.
    // Outer ring: 1 CYLINDRICAL (OD) + 1 SPHERICAL raceway + 2 PLANE
    // walls.
    // Rollers: 2 rows × N cylinders ⇒ ≥ 12 CYLINDRICAL_SURFACEs from
    // rollers alone (one per cylinder); each tilted-cylinder roller's
    // axis is in 3D so OCCT writes it as CYLINDRICAL_SURFACE (not a
    // CONE — these are plain cylinders, not truncated cones).
    const rollersLooksRight = cylinders >= 12 || (cylinders >= 3 && placements >= 12);
    if (!rollersLooksRight) {
      return (
        `OCCT output has ${cylinders} cylindrical surfaces and ${placements} ` +
        `placements (expected ≥ 12 cylinders OR ≥ 3 cylinders with ≥ 12 placements ` +
        `for two rows of ≥ 6 rollers each)`
      );
    }
    if (spheres < 1) {
      return `OCCT output has 0 spherical surfaces (expected ≥ 1 for the outer raceway sphere)`;
    }
    return null;
  }
  if (kind === 'OilSeal') {
    // Outer metal case (always): three CYLINDRICAL surfaces from its
    // three axial walls (Y_MOD top, Y_MID right-bottom shoulder,
    // Y_MOD-t1 inner top) plus three planar annuli — no curved
    // surfaces on the case itself. Rubber body adds 2 TOROIDAL_SURFACEs
    // when hasSpring (the half-circle relief, split into two quarter
    // arcs). Garter spring revolves a circle ⇒ 1 TOROIDAL_SURFACE.
    //
    // We can't see hasSpring from here without re-parsing the request,
    // so we set a conservative floor: outer case alone guarantees at
    // least 3 cylindrical surfaces from its straight-axial walls. If
    // OCCT silently tessellates the rubber arcs into planar facets,
    // toroidal count drops to 0 — which the user will catch when
    // measuring the spring relief radius — but the validator can't
    // fail-on-silence here because the no-spring G/GM/GA variants
    // legitimately produce 0 toroidals.
    if (cylinders < 3) {
      return (
        `OCCT output has ${cylinders} cylindrical surfaces ` +
        `(expected ≥ 3 for the outer metal case walls)`
      );
    }
    return null;
  }
  if (kind === 'SelfAligningBall') {
    // Inner ring: 1 CYLINDRICAL (bore) + 2 TOROIDAL raceways + corner
    // fillets (also TOROIDAL when revolved).
    // Outer ring: 1 CYLINDRICAL (OD) + 1 SPHERICAL raceway + 2 TOROIDAL
    // corner fillets.
    // Balls: 2 rows × N spheres ⇒ ≥ 12 SPHERICAL_SURFACEs minimum.
    // Crucial check: at least 1 SPHERICAL_SURFACE on the outer ring's
    // raceway must be present, distinct from the ball spheres.
    const spheres = (stepText.match(/SPHERICAL_SURFACE/g) || []).length;
    if (spheres < 13) {
      // 12 balls (6 per row × 2) + 1 outer raceway sphere ≥ 13 minimum
      return (
        `OCCT output has ${spheres} spherical surfaces ` +
        `(expected ≥ 13 — 12 balls × 2 rows + 1 outer raceway sphere)`
      );
    }
    if (toroidals < 2) {
      return (
        `OCCT output has ${toroidals} toroidal surfaces ` +
        `(expected ≥ 2 for the inner-ring raceway grooves)`
      );
    }
    if (cylinders < 2) {
      return `OCCT output has ${cylinders} cylindrical surfaces (expected ≥ 2 for both rings)`;
    }
    return null;
  }
  return null;
}

/** Embed BOM metadata into a STEP result (idempotent for non-STEP). */
function applyBom(req: CadGenerateRequest, result: CadGenerateResult): CadGenerateResult {
  if (result.format !== 'STEP') return result;
  const bom = resolveBomMetadata(req);
  const text = result.bytes.toString('utf8');
  const next = embedBomInStep(text, bom);
  if (next === text) return result;
  return { ...result, bytes: Buffer.from(next, 'utf8') };
}

export async function generateBearing(
  req: CadGenerateRequest,
): Promise<CadGenerateResult> {
  if (!(LOCAL_FORMATS as readonly string[]).includes(req.format)) {
    throw new Error(
      `Bearing: format ${req.format} is not produced locally; route through CAD Exchanger.`,
    );
  }

  const code = req.partCode.toUpperCase();
  const kind = KIND_OF_CODE[code];
  if (!kind) {
    throw new Error(
      `Bearing: partCode "${req.partCode}" not mapped to a bearing kind. ` +
        `Edit parts/bearing/index.ts KIND_OF_CODE to register it. ` +
        `Currently supported: ${BEARING_CODES.join(', ')}.`,
    );
  }

  // Oilless dispatch happens BEFORE `resolveBearingDims` because
  // its shapes carry incompatible dimension sets — Plate uses B / L / T
  // (no d1 / D2 at all), Pin uses D2 + L without a bore, etc. The
  // generator owns its per-shape resolution and never references the
  // shared `BearingDims` contract.
  // Plummer block dispatch — uses its own dim resolver because the
  // catalog fields (A/L/H/H1/H2/J/J1/N/g/cap-bolt size) don't fit the
  // shared BearingDims contract (no d1/D2/B mapping that other bearings
  // expect — D2 is the bearing OD, not the housing OD).
  if (kind === 'PlummerBlock') {
    const dimsP = resolvePlummerBlockDims(req, req.partCode);
    if (req.format === 'DXF') {
      return buildPlummerBlockDxf(req, dimsP);
    }
    if (req.format !== 'STEP') {
      throw new Error(
        `PlummerBlock: format ${req.format} not yet implemented (STEP / DXF only). ` +
          `partCode=${req.partCode}`,
      );
    }
    if (!USE_OCCT) {
      throw new Error(
        `PlummerBlock: hand-written fallback not implemented; OCCT backend required.`,
      );
    }
    try {
      const result = await buildPlummerBlockStepViaOcct(req, dimsP);
      return applyBom(req, result);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(
        `[bearing/occt] PlummerBlock ${req.partCode} failed: ${(e as Error).message}. ` +
          `Resetting OCCT runtime.`,
      );
      resetOcct();
      throw e;
    }
  }

  if (kind === 'Oilless') {
    if (req.format === 'DXF') {
      // Oilless DXF — handles all 6 shape variants (some without
      // d1 / D2). Uses its own dimension resolver since Plate / Pin
      // don't fit the shared BearingDims contract.
      return buildOillessDxf(req);
    }
    if (req.format !== 'STEP') {
      throw new Error(
        `Oilless: format ${req.format} not yet implemented (STEP / DXF only). ` +
          `partCode=${req.partCode}`,
      );
    }
    if (!USE_OCCT) {
      throw new Error(
        `Oilless: hand-written fallback not implemented; OCCT backend ` +
          `required. Set CAD_BACKEND=occt.`,
      );
    }
    try {
      const result = await buildOillessStepViaOcct(req);
      return applyBom(req, result);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(
        `[bearing/occt] Oilless ${req.partCode} failed: ${(e as Error).message}. ` +
          `Resetting OCCT runtime.`,
      );
      resetOcct();
      throw e;
    }
  }

  const dims = resolveBearingDims(req, req.partCode);

  switch (req.format) {
    case 'STEP': {
      // OCCT path — preferred. Real toroidal raceway, measurable.
      if (USE_OCCT) {
        const useFallback = (reason: string) => {
          // eslint-disable-next-line no-console
          console.warn(
            `[bearing/occt] ${req.partCode}: ${reason}. ` +
              `Falling back to hand-written and resetting OCCT runtime.`,
          );
          resetOcct();
          const fallback = buildBearingStep(req, dims);
          return { ...applyBom(req, fallback), noCache: true };
        };
        try {
          const occtResult =
            kind === 'CylindricalRoller'
              ? await buildScrbStepViaOcct(req, dims)
              : kind === 'CylindricalRollerDouble'
                ? await buildDcrbStepViaOcct(req, dims)
              : kind === 'TaperRoller'
                ? await buildStrbStepViaOcct(req, dims)
                : kind === 'TaperRollerDouble'
                  ? await buildDtrbStepViaOcct(req, dims)
                : kind === 'SelfAligningBall'
                  ? await buildSabbStepViaOcct(req, dims)
                  : kind === 'SphericalRoller'
                    ? await buildSarbStepViaOcct(req, dims)
                    : kind === 'NeedleRoller'
                      ? await buildSnrbStepViaOcct(req, dims)
                      : kind === 'NeedleRollerGauge'
                        ? await buildCnrbStepViaOcct(req, dims)
                        : kind === 'NeedleRollerDrawnCup'
                          ? await buildShnrbStepViaOcct(req, dims)
                        : kind === 'ThrustBall'
                        ? await buildStbbStepViaOcct(req, dims)
                        : kind === 'ThrustBallDouble'
                        ? await buildDtbbStepViaOcct(req, dims)
                        : kind === 'ThrustBallAngularContact'
                        ? await buildTacbbStepViaOcct(req, dims)
                        : kind === 'ThrustBallDoubleAngularContact'
                        ? await buildDtabbStepViaOcct(req, dims)
                        : kind === 'UCBearing'
                          ? await buildUcbStepViaOcct(req, dims)
                          : kind === 'UCBearingSquareFlange'
                          ? await buildUcfStepViaOcct(req, dims)
                          : kind === 'UCBearingSquareFlangeSocket'
                          ? await buildUcfsStepViaOcct(req, dims)
                          : kind === 'UCBearingRoundFlangeSocket'
                          ? await buildUcfcStepViaOcct(req, dims)
                          : kind === 'UCBearingRhombusFlange'
                          ? await buildUcflStepViaOcct(req, dims)
                          : kind === 'AngularContactBall'
                            ? await buildAcbbStepViaOcct(req, dims)
                            : kind === 'ThrustRoller'
                              ? await buildTcrbStepViaOcct(req, dims)
                              : kind === 'ThrustRollerSpherical'
                                ? await buildTsarbStepViaOcct(req, dims)
                                : kind === 'BallScrewSupport'
                                ? await buildDrbbStepViaOcct(req, dims)
                                : kind === 'Flanged'
                                  ? await buildFlbbStepViaOcct(req, dims)
                                  : kind === 'OilSeal'
                                    ? await buildOsealStepViaOcct(req, dims)
                                    : await buildDgbbStepViaOcct(req, dims);
          // Validate — surface counts catch OCCT silently producing
          // tessellated planar facets instead of real curved surfaces.
          // Each kind has different rolling-element geometry:
          //   DGBB → SPHERICAL_SURFACE per ball + TOROIDAL raceways
          //   CRB  → CYLINDRICAL per roller (extra) + TOROIDAL raceways
          // The shared `rotateShapeAroundZ(..., share=true)` default
          // turns N rollers/balls into ONE BRep + N
          // NEXT_ASSEMBLY_USAGE_OCCURRENCE placements, so the per-element
          // count uses (N elements) ≥ 6 OR (1 element + 6 placements).
          const reason = validateOcctBearingStep(kind, occtResult.bytes.toString());
          if (reason) return useFallback(reason);
          return applyBom(req, occtResult);
        } catch (e) {
          return useFallback(
            `OCCT threw: ${(e as Error).message?.slice(0, 160)}`,
          );
        }
      }
      // Hand-written path — degraded but always works.
      return applyBom(req, buildBearingStep(req, dims));
    }
    case 'DXF':
      // Pass `kind` so the DXF generator can dispatch by topology
      // (radial vs thrust vs UC-flange vs OilSeal vs needle-only).
      return buildBearingDxf(req, dims, kind);
    default:
      throw new Error(
        `Bearing: local format ${req.format} not implemented yet (STEP/DXF only).`,
      );
  }
}

registerFamily({
  name: 'bearing',
  codes: BEARING_CODES,
  generate: generateBearing,
});
