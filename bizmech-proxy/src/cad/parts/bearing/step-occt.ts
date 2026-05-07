/**
 * OCCT-backed STEP generator for deep-groove ball bearings (DGBB).
 *
 * Faithful port of `BearingCreator::CreateDeepGrooveBallBearing`
 * (`C++Source/NewCreateBearingClass.cpp` line 871–1100). The bearing
 * is rendered as TWO solids of revolution — inner ring + outer ring —
 * compounded together. Rolling elements (balls, cage) are NOT drawn,
 * matching the C++ reference exactly: it sketches only the two rings
 * and revolves each profile 360° around the bearing axis.
 *
 * The whole point of this generator (per the project's "geometry, not
 * picture" rule) is that designers measuring the imported STEP get
 * the catalog row's exact d1 / D2 / B values, the corner fillets at
 * radius `r`, and the raceway groove as a real `TOROIDAL_SURFACE` —
 * not a tessellated approximation.
 *
 * Geometry (matches C++ `CreateDeepGrooveBallBearing`)
 * ────────────────────────────────────────────────────
 *   pitchDia      = (d1 + D2) / 2                     // PCD
 *   ballDia       = (D2 - d1) × 0.3                   // empirical
 *   grooveR       = ballDia / 2 × 1.02                // raceway radius
 *   shoulderH_Inner = pitchR - grooveR × 0.8          // inner-ring shoulder
 *   shoulderH_Outer = pitchR + grooveR × 0.8          // outer-ring shoulder
 *   grooveHalfW   = √(grooveR² - (pitchR - shoulderH_Inner)²)
 *
 * NOTE on the C++ test override
 * ─────────────────────────────
 * Lines 937–940 of the C++ source HARDCODE val_d=.3 / val_D=1.0 /
 * val_B=.4 / val_r=.02 over the partdata values — that is leftover
 * test code (a known bug in the reference). We deliberately do NOT
 * replicate it; the imported STEP must reflect the catalog row.
 *
 * Coordinate convention
 * ─────────────────────
 *   · Z = bearing axis (axis of revolution).
 *   · Profile lies in the XZ plane (Y=0): X = radial distance from
 *     axis, Z = axial position.
 *   · CCW boundary traversal (interior of metal on the LEFT as you
 *     walk the boundary) gives `BRepBuilderAPI_MakeFace` an outward-
 *     normal face — the resulting `BRepPrimAPI_MakeRevol` solid then
 *     has surface normals pointing AWAY from the metal, which is the
 *     STEP convention.
 */
import type { CadGenerateRequest, CadGenerateResult } from '../../types.js';
import { FORMAT_EXT, FORMAT_MIME } from '../../types.js';
import {
  exportStepBytes,
  flattenBrepWithVoidsToManifolds,
  getOcct,
  makeProfileWireXZ,
  makeRevolZ,
  makeSphere,
  mergeShapesIntoMultibodySolid,
  rotateShapeAroundZ,
  type ProfileSegment,
} from '../../core/occt.js';
import { bomFileName } from '../../core/bom-meta.js';
import type { BearingDims } from './dimensions.js';

export async function buildDgbbStepViaOcct(
  req: CadGenerateRequest,
  dims: BearingDims,
): Promise<CadGenerateResult> {
  const started = Date.now();
  const oc = await getOcct();

  // ── 1. Resolve geometry constants from the catalog row ──
  const innerR = dims.d1 / 2;
  const outerR = dims.D2 / 2;
  const halfB = dims.B / 2;
  const r = dims.r;

  const pitchR = (dims.d1 + dims.D2) / 4;
  const ballDia = (dims.D2 - dims.d1) * 0.3;
  const ballR = ballDia / 2;
  const grooveR = ballR * 1.02;

  const shoulderH_Inner = pitchR - grooveR * 0.8;
  const shoulderH_Outer = pitchR + grooveR * 0.8;
  // grooveHalfW solves grooveR² = (pitchR - shoulderH)² + grooveHalfW²;
  // since (pitchR - shoulderH_Inner) = grooveR·0.8, grooveHalfW = grooveR·0.6.
  const grooveHalfW = Math.sqrt(
    grooveR * grooveR - (pitchR - shoulderH_Inner) * (pitchR - shoulderH_Inner),
  );

  // Sanity: groove must fit inside both rings — otherwise the catalog
  // row's d1/D2 are inconsistent (e.g. ballDia formula degenerate for
  // very small rings). Falling back here would mask the bad data.
  if (
    shoulderH_Inner <= innerR + r ||
    shoulderH_Outer >= outerR - r ||
    grooveHalfW > halfB - r
  ) {
    throw new Error(
      `DGBB ${req.partCode}: degenerate groove geometry — ` +
        `d1=${dims.d1} D2=${dims.D2} B=${dims.B} r=${r}. ` +
        `pitchR=${pitchR.toFixed(3)} grooveR=${grooveR.toFixed(3)} ` +
        `shoulderH_Inner=${shoulderH_Inner.toFixed(3)} ` +
        `grooveHalfW=${grooveHalfW.toFixed(3)} — check the partdimension row.`,
    );
  }

  // ── 2. Inner ring profile (CCW boundary in XZ plane) ──
  //
  // Starting at the top of the bore wall and going CCW around the metal:
  //   bore wall (DOWN) → bore-bottom fillet → bottom edge → right wall
  //   (UP through groove) → top edge → bore-top fillet → close.
  const innerRingProfile = buildInnerRingProfile({
    innerR,
    shoulderH_Inner,
    halfB,
    r,
    pitchR,
    grooveHalfW,
  });
  const innerRingFace = makeProfileWireXZ(
    oc,
    innerRingProfile.start,
    innerRingProfile.segments,
  );
  const innerRing = makeRevolZ(oc, innerRingFace);

  // ── 3. Outer ring profile (mirror-image structure) ──
  const outerRingProfile = buildOuterRingProfile({
    outerR,
    shoulderH_Outer,
    halfB,
    r,
    pitchR,
    grooveHalfW,
  });
  const outerRingFace = makeProfileWireXZ(
    oc,
    outerRingProfile.start,
    outerRingProfile.segments,
  );
  const outerRing = makeRevolZ(oc, outerRingFace);

  // ── 4. Rolling balls — master sphere at PCD + circular pattern ──
  //
  // Mirrors `CreateBalls` (NewCreateBearingClass.cpp line 1151–1206):
  //   · Master sphere at (pitchR, 0, 0) — radial = PCD/2, axial = 0.
  //   · Ball count from DB `Z` field if present, else
  //     ⌊π · pitchDia / (ballDia · BALL_SPACING_RATIO)⌋ with the
  //     reference's BALL_SPACING_RATIO = 1.2.
  //   · Minimum 6 balls (matches the C++ floor + min logic).
  const masterBall = makeSphere(oc, [pitchR, 0, 0], ballR);
  const ballCount = computeBallCount(req, pitchR, ballDia);

  // Each ball is a deep-copy of the master so the multi-body merger
  // below sees N independent SHELLs (one per sphere). Sharing a single
  // BRep across rotations would have only one shell to feed into the
  // merged Solid — the other N−1 instances would be lost — and the
  // result would render as a single sphere rather than the patterned
  // ring of N balls the C++ reference draws.
  const balls: unknown[] = [];
  for (let i = 0; i < ballCount; i++) {
    const angle = (2 * Math.PI * i) / ballCount;
    balls.push(rotateShapeAroundZ(oc, masterBall, angle, /* share */ false));
  }

  // ── 5. Stuff every shell (2 rings + N balls) into ONE TopoDS_Solid.
  //    OCCT serialises this as a single `BREP_WITH_VOIDS` under one
  //    PRODUCT. Inventor imports a one-PRODUCT STEP as a single
  //    multi-body .ipt where each shell becomes a body — the bodies
  //    can be selected but cannot be dragged independently, matching
  //    the C++ reference's "one part, N bodies" design intent. See
  //    `mergeShapesIntoMultibodySolid` doc-comment for the topology
  //    trade-off (the merged Solid is technically an outer shell +
  //    voids, semantically wrong but visually + dimensionally correct).
  const bearing = mergeShapesIntoMultibodySolid(oc, [innerRing, outerRing, ...balls]);

  // OCCT writes our multi-shell Solid as `BREP_WITH_VOIDS`. Inventor's
  // STEP translator splits BREP_WITH_VOIDS shells back into separate
  // draggable components on import — undoing the whole point of the
  // merge. Re-encoding as N sibling MANIFOLD_SOLID_BREPs (the SolidWorks /
  // Creo convention for a multi-body part) is what triggers Inventor's
  // "single .ipt with N bodies" import path, where bodies cannot drag
  // apart. The post-processor is a pure text transformation — no OCCT
  // call — so it adds < 1 ms even on the largest bearing.
  const rawStep = exportStepBytes(oc, bearing);
  const flattened = flattenBrepWithVoidsToManifolds(rawStep.toString('utf8'));
  const bytes = Buffer.from(flattened, 'utf8');
  const ext = FORMAT_EXT.STEP;
  return {
    bytes,
    format: 'STEP',
    mimeType: FORMAT_MIME.STEP,
    ext,
    backend: 'local',
    generatedMs: Date.now() - started,
    fileName: bomFileName(req, ext),
  };
}

/**
 * Compute the rolling-ball count for a DGBB. Prefers the DB-supplied
 * `Z` field when the catalog row exposes it (most KS / ISO bearings
 * have a documented ball count), and falls back to the same
 * geometric formula the C++ reference uses
 * (`m_numBalls = ⌊π·pcd / (ballDia·1.2)⌋`, line 944) when absent.
 *
 * Always at least 6 — matches the C++ floor (line 1196) and prevents
 * a degenerate 1-ball "bearing" for catalog rows with malformed Z.
 */
function computeBallCount(
  req: CadGenerateRequest,
  pitchR: number,
  ballDia: number,
): number {
  const dbZ = req.dimensions['Z'];
  if (dbZ != null && dbZ !== '') {
    const n = typeof dbZ === 'number' ? dbZ : parseFloat(String(dbZ));
    if (Number.isFinite(n) && n >= 6) return Math.floor(n);
  }
  const BALL_SPACING_RATIO = 1.2;
  const pitchDia = pitchR * 2;
  const formula = Math.floor((Math.PI * pitchDia) / (ballDia * BALL_SPACING_RATIO));
  return Math.max(6, formula);
}

// ─────────────────────────────────────────────────────────
// Profile builders — pure data, no OCCT dependency. Returned
// as `{ start, segments }` so unit tests can assert vertices
// without instantiating the WASM runtime.
// ─────────────────────────────────────────────────────────

interface InnerProfileInput {
  innerR: number;
  shoulderH_Inner: number;
  halfB: number;
  r: number;
  pitchR: number;
  grooveHalfW: number;
}

interface OuterProfileInput {
  outerR: number;
  shoulderH_Outer: number;
  halfB: number;
  r: number;
  pitchR: number;
  grooveHalfW: number;
}

interface ProfileBuilt {
  start: readonly [number, number];
  segments: ProfileSegment[];
}

/**
 * CCW boundary of the inner ring's cross-section (interior on the left
 * when viewed from +Y). Fillets only on the bore-side corners, groove
 * arc on the shoulder side dipping inward toward the bearing axis.
 */
function buildInnerRingProfile(p: InnerProfileInput): ProfileBuilt {
  const { innerR, shoulderH_Inner, halfB, r, pitchR, grooveHalfW } = p;
  const start: [number, number] = [innerR, halfB - r];
  const segments: ProfileSegment[] = [
    // 1. LEFT (bore) wall — going DOWN.
    { kind: 'line', to: [innerR, -halfB + r] },
    // 2. Bore-bottom fillet — short 90° CCW arc.
    {
      kind: 'arc',
      to: [innerR + r, -halfB],
      center: [innerR + r, -halfB + r],
      ccw: true,
    },
    // 3. BOTTOM edge — going RIGHT toward the shoulder.
    { kind: 'line', to: [shoulderH_Inner, -halfB] },
    // 4. RIGHT (shoulder) wall — going UP toward the groove start.
    { kind: 'line', to: [shoulderH_Inner, -grooveHalfW] },
    // 5. Raceway groove — short CW arc dipping inward (CCW from −Y view,
    //    which is `ccw=false` in our XZ-plane builder).
    {
      kind: 'arc',
      to: [shoulderH_Inner, grooveHalfW],
      center: [pitchR, 0],
      ccw: false,
    },
    // 6. RIGHT wall — going UP from groove end to top.
    { kind: 'line', to: [shoulderH_Inner, halfB] },
    // 7. TOP edge — going LEFT toward the bore-top fillet.
    { kind: 'line', to: [innerR + r, halfB] },
    // 8. Bore-top fillet — short 90° CCW arc closing the loop.
    {
      kind: 'arc',
      to: start,
      center: [innerR + r, halfB - r],
      ccw: true,
    },
  ];
  return { start, segments };
}

/**
 * CCW boundary of the outer ring's cross-section. Mirror-image of the
 * inner ring: fillets on the OD-side corners, groove arc on the bore
 * side dipping outward toward the bearing's outer surface.
 */
function buildOuterRingProfile(p: OuterProfileInput): ProfileBuilt {
  const { outerR, shoulderH_Outer, halfB, r, pitchR, grooveHalfW } = p;
  const start: [number, number] = [outerR, -halfB + r];
  const segments: ProfileSegment[] = [
    // 1. RIGHT (OD) wall — going UP.
    { kind: 'line', to: [outerR, halfB - r] },
    // 2. OD-top fillet — short 90° CCW arc.
    {
      kind: 'arc',
      to: [outerR - r, halfB],
      center: [outerR - r, halfB - r],
      ccw: true,
    },
    // 3. TOP edge — going LEFT toward the shoulder.
    { kind: 'line', to: [shoulderH_Outer, halfB] },
    // 4. LEFT (shoulder) wall — going DOWN toward the groove start.
    { kind: 'line', to: [shoulderH_Outer, grooveHalfW] },
    // 5. Raceway groove — short CW arc dipping outward (toward higher X).
    {
      kind: 'arc',
      to: [shoulderH_Outer, -grooveHalfW],
      center: [pitchR, 0],
      ccw: false,
    },
    // 6. LEFT wall — going DOWN from groove end to bottom.
    { kind: 'line', to: [shoulderH_Outer, -halfB] },
    // 7. BOTTOM edge — going RIGHT toward the OD-bottom fillet.
    { kind: 'line', to: [outerR - r, -halfB] },
    // 8. OD-bottom fillet — short 90° CCW arc closing the loop.
    {
      kind: 'arc',
      to: start,
      center: [outerR - r, -halfB + r],
      ccw: true,
    },
  ];
  return { start, segments };
}
