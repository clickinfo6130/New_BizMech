/**
 * OCCT-backed STEP generator for self-aligning ball bearings (SABB).
 *
 * Faithful port of `BearingCreator::CreateSelfAligningBallBearing`
 * (`C++Source/NewCreateBearingClass.cpp` line 1765–1958). What makes
 * SABB distinct from DGBB is the OUTER ring: its raceway is a single
 * SPHERICAL surface centered at the bearing's geometric centre, not a
 * toroidal groove. That sphere lets the inner-ring-plus-balls assembly
 * pivot freely inside the outer ring — that's the "self-aligning"
 * property the bearing is named for.
 *
 * Geometry (matches C++ CreateSelfAligningBallBearing)
 * ────────────────────────────────────────────────────
 *   ballDia       = catalog Dw if present, else (D2 - d1) × 0.22
 *   pitchR        = catalog dm/2 if present, else (d1 + D2) / 4
 *   outerRaceR    = D2 × 0.40                 // big sphere radius (line 1793)
 *   shoulderRadius_inner = (d1 + (D2-d1) × 0.25) / 2
 *   ballX         = halfB - ballRadius        // axial offset of each ball row
 *   oPtY          = √((outerRaceR - ballRadius)² - ballX²)
 *                                              // ball-row PCD (radial position)
 *   numBalls/row  = catalog Z if present (split per row), else
 *                   ⌊π · pcd / (ballDia × 1.5)⌋
 *
 * Construction
 * ────────────
 *   · Inner ring: a single revolved profile with TWO concave toroidal
 *     raceways (one per ball row), symmetric about axial=0.
 *   · Outer ring: a single revolved profile whose raceway portion is an
 *     arc centered at [0,0] (the bearing's geometric centre); revolving
 *     that arc around the bearing axis produces the spherical raceway.
 *   · Balls: a master sphere at (radial=oPtY, axial=ballX) cloned via
 *     circular pattern around Z (one row), then mirrored across axial=0
 *     to populate the second row.
 *
 * Coordinate convention — same as DGBB / SCRB / TRB:
 *   · Z = bearing axis (axis of revolution)
 *   · Profiles in XZ plane (Y=0): X = radial, Z = axial
 *   · CCW boundaries with metal interior on the LEFT
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

const C_PLUS_PLUS_BALL_DIA_RATIO = 0.22; // line 1785
const C_PLUS_PLUS_OUTER_RACE_RATIO = 0.40; // line 1793 — D × 0.40
const C_PLUS_PLUS_INNER_SHOULDER_RATIO = 0.25; // line 1799
const BALL_GAP_FACTOR = 1.5; // line 1947 (1.5 × ballDia spacing)

export async function buildSabbStepViaOcct(
  req: CadGenerateRequest,
  dims: BearingDims,
): Promise<CadGenerateResult> {
  const started = Date.now();
  const oc = await getOcct();

  // ── 1. Geometry constants ──
  const innerR = dims.d1 / 2;
  const outerR = dims.D2 / 2;
  const halfB = dims.B / 2;
  const r = dims.r;

  // SABB ball-diameter source: ALWAYS use the C++ (D-d)×0.22 ratio,
  // NOT the catalog `Dw` field. The C++ raceway / shoulder ratios
  // (innerShoulder = 0.25·(D-d), outerRaceR = 0.40·D, ballX = halfB-
  // ballRadius) are tuned to that 0.22 ball-size; substituting a
  // catalog Dw that's much larger (the 1208 row in Standard_Core has
  // Dw=12 vs the formula's 8.8) breaks two geometric invariants:
  //   1. The two ball rows overlap when 2·ballX < 2·ballRadius
  //      (1208: rows separated 6 mm but each ball is 12 mm wide ⇒
  //      they fuse into one row, defeating the self-aligning design).
  //   2. The inner-ring shoulder line no longer reaches the raceway
  //      arc — the Pythagoras intersection ballRadius²−Δy² goes
  //      negative, throwing on a degenerate-shoulder error.
  // Catalog Dw is honoured everywhere else (DGBB / SCRB / TRB) where
  // those invariants don't apply; SABB is the exception.
  const ballDia = (dims.D2 - dims.d1) * C_PLUS_PLUS_BALL_DIA_RATIO;
  const ballRadius = ballDia / 2;
  const innerShoulderRadius =
    (dims.d1 + (dims.D2 - dims.d1) * C_PLUS_PLUS_INNER_SHOULDER_RATIO) / 2;
  const ballX = halfB - ballRadius;

  // Ball-row PCD (oPtY) is DERIVED from the C++ outer-raceway formula,
  // not read from catalog `dm`. Mixing catalog dm with the C++ shoulder
  // ratio (innerShoulder = 0.25·(D-d) above) breaks the inner-ring
  // raceway intersection — for 1208 the catalog dm=60 gives oPtY=30
  // while the shoulder line sits at radial=25, leaving a 5 mm gap that
  // the 4.4 mm ball can't bridge (Pythagoras goes negative). The C++
  // formula keeps all four ratios self-consistent at the cost of small
  // catalog drift (1208's actual dm is 60 but our derived oPtY is
  // 27.21). Designers cross-checking against catalog dm should
  // therefore measure the bearing OD / bore / width for verification,
  // not the PCD which is implicit.
  const outerRaceR = dims.D2 * C_PLUS_PLUS_OUTER_RACE_RATIO;
  if (outerRaceR <= ballRadius) {
    throw new Error(
      `SABB ${req.partCode}: outerRaceR (${outerRaceR.toFixed(3)}) ≤ ballRadius ` +
        `(${ballRadius.toFixed(3)}). The C++ 0.40·D outer-raceway formula breaks down ` +
        `for very thin-cross-section bearings; partdimension row needs review.`,
    );
  }
  const innerLocusR = outerRaceR - ballRadius;
  if (innerLocusR <= ballX) {
    throw new Error(
      `SABB ${req.partCode}: ball-row locus radius (${innerLocusR.toFixed(3)}) ≤ ballX ` +
        `(${ballX.toFixed(3)}). Bearing width B is too small for the standard ratios.`,
    );
  }
  const oPtY = Math.sqrt(innerLocusR * innerLocusR - ballX * ballX);
  const pitchR = (dims.d1 + dims.D2) / 4;

  // Inner-ring raceway intersections with the shoulder line.
  // The horizontal line at radial=innerShoulderRadius meets the right-row
  // raceway circle (centre [oPtY, ballX], radius ballRadius) at two axial
  // values, oP2x (closer to the bearing's right end) and oP3x (closer to
  // axial=0). The left row is the mirror across axial=0.
  const dy = innerShoulderRadius - oPtY;
  const ballRSq = ballRadius * ballRadius - dy * dy;
  if (ballRSq <= 0) {
    throw new Error(
      `SABB ${req.partCode}: degenerate inner-shoulder intersection — ` +
        `the ball doesn't reach the shoulder line. shoulder=${innerShoulderRadius.toFixed(3)} ` +
        `oPtY=${oPtY.toFixed(3)} ballRadius=${ballRadius.toFixed(3)}.`,
    );
  }
  const dx = Math.sqrt(ballRSq);
  const oP2x = ballX + dx; // right-row, far end (toward halfB)
  const oP3x = ballX - dx; // right-row, near end (toward axial=0)

  // Outer-ring spherical raceway — endpoints where the raceway sphere
  // (centre [0,0], radius outerRaceR) meets the vertical lines at axial
  // = ±halfB. The arc between them lies entirely on this sphere; revolved
  // around the bearing axis it produces the spherical outer raceway.
  if (outerRaceR <= halfB) {
    throw new Error(
      `SABB ${req.partCode}: outerRaceR (${outerRaceR.toFixed(3)}) ≤ halfB ` +
        `(${halfB.toFixed(3)}) — sphere doesn't extend past the bearing's axial ends.`,
    );
  }
  const getPtOutY = Math.sqrt(outerRaceR * outerRaceR - halfB * halfB);
  if (getPtOutY >= outerR - r) {
    throw new Error(
      `SABB ${req.partCode}: outer raceway entry (${getPtOutY.toFixed(3)}) overlaps OD-r ` +
        `(${(outerR - r).toFixed(3)}) — degenerate outer ring profile.`,
    );
  }

  // ── 2. Inner ring profile (10 edges, two raceway grooves) ──
  const innerRingFace = makeProfileWireXZ(
    oc,
    [innerShoulderRadius, halfB], // start: top-right shoulder corner
    [
      // 1. Right shoulder — axial decreasing toward right raceway entry.
      { kind: 'line', to: [innerShoulderRadius, oP2x] },
      // 2. Right raceway arc — short arc dipping inward (toward smaller
      //    radial = into the inner ring's metal). Centre at [oPtY, ballX].
      {
        kind: 'arc',
        to: [innerShoulderRadius, oP3x],
        center: [oPtY, ballX],
        ccw: false,
      },
      // 3. Middle bridge across axial=0 — connects the two raceway grooves.
      { kind: 'line', to: [innerShoulderRadius, -oP3x] },
      // 4. Left raceway arc — mirror of the right raceway.
      {
        kind: 'arc',
        to: [innerShoulderRadius, -oP2x],
        center: [oPtY, -ballX],
        ccw: false,
      },
      // 5. Left shoulder — axial decreasing toward the left wall start.
      { kind: 'line', to: [innerShoulderRadius, -halfB] },
      // 6. Left wall going down (radial decreasing toward bore).
      { kind: 'line', to: [innerR + r, -halfB] },
      // 7. Left-bottom fillet (90° arc).
      {
        kind: 'arc',
        to: [innerR, -halfB + r],
        center: [innerR + r, -halfB + r],
        ccw: true,
      },
      // 8. Bore floor — axial increasing at radial=innerR.
      { kind: 'line', to: [innerR, halfB - r] },
      // 9. Right-bottom fillet (90° arc).
      {
        kind: 'arc',
        to: [innerR + r, halfB],
        center: [innerR + r, halfB - r],
        ccw: true,
      },
      // 10. Right wall going up — closes loop back to start.
      { kind: 'line', to: [innerShoulderRadius, halfB] },
    ] satisfies ProfileSegment[],
  );
  const innerRing = makeRevolZ(oc, innerRingFace);

  // ── 3. Outer ring profile (6 edges, ONE spherical raceway) ──
  const outerRingFace = makeProfileWireXZ(
    oc,
    [outerR, halfB - r], // start: top-right OD corner just before fillet
    [
      // 1. OD top face — axial decreasing.
      { kind: 'line', to: [outerR, -halfB + r] },
      // 2. Left-top fillet.
      {
        kind: 'arc',
        to: [outerR - r, -halfB],
        center: [outerR - r, -halfB + r],
        ccw: true,
      },
      // 3. Left wall — radial decreasing toward raceway entry.
      { kind: 'line', to: [getPtOutY, -halfB] },
      // 4. Spherical raceway arc — short arc dipping outward (toward OD)
      //    on a sphere centered at the bearing's geometric centre [0,0].
      //    This is the defining feature of self-aligning bearings.
      {
        kind: 'arc',
        to: [getPtOutY, halfB],
        center: [0, 0],
        ccw: false,
      },
      // 5. Right wall — radial increasing back to OD.
      { kind: 'line', to: [outerR - r, halfB] },
      // 6. Right-top fillet — closes the loop.
      {
        kind: 'arc',
        to: [outerR, halfB - r],
        center: [outerR - r, halfB - r],
        ccw: true,
      },
    ] satisfies ProfileSegment[],
  );
  const outerRing = makeRevolZ(oc, outerRingFace);

  // ── 4. Balls — two rows, each a circular pattern of master sphere ──
  // Right row: ball centre at [oPtY, ballX], in our [radial, axial]
  // notation that's world XYZ = (oPtY, 0, ballX). Left row mirrors across
  // axial=0 so the centre is (oPtY, 0, -ballX).
  const ballsPerRow = computeBallsPerRow(pitchR, ballDia);
  const masterBallRight = makeSphere(oc, [oPtY, 0, ballX], ballRadius);
  const masterBallLeft = makeSphere(oc, [oPtY, 0, -ballX], ballRadius);

  const balls: unknown[] = [];
  for (let i = 0; i < ballsPerRow; i++) {
    const angle = (2 * Math.PI * i) / ballsPerRow;
    balls.push(rotateShapeAroundZ(oc, masterBallRight, angle, /* share */ false));
    balls.push(rotateShapeAroundZ(oc, masterBallLeft, angle, /* share */ false));
  }

  // ── 5. Merge into a single multi-body solid + STEP export ──
  const bearing = mergeShapesIntoMultibodySolid(oc, [innerRing, outerRing, ...balls]);

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
 * Per-row ball count, always from the C++ formula `floor(π·pcd /
 * (ballDia × 1.5))`. Catalog `Z` is intentionally ignored for SABB
 * (it varies between per-row and total across catalogs, and combining
 * catalog Z with the formula-derived ballDia produces visibly wrong
 * counts — e.g. 1208's catalog Z=13 splits to 6/row, but the C++
 * formula yields 14/row to match the visible ball density in the C++
 * reference image).
 */
function computeBallsPerRow(pitchR: number, ballDia: number): number {
  const pitchDia = pitchR * 2;
  return Math.max(6, Math.floor((Math.PI * pitchDia) / (ballDia * BALL_GAP_FACTOR)));
}
