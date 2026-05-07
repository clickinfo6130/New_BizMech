/**
 * STEP AP214 engine — part-agnostic primitives and solid builders.
 *
 * Every generator composes from:
 *   1. Low-level entity helpers — `cart`, `dir`, `vertex`, `axis2`, …
 *   2. Edge/wire builders — `lineEdge`, `circleEdge`, `edgeLoop`
 *   3. Whole-solid builders — `cylinderSolid`, `hexPrism`, `boxSolid`,
 *      `revolveSolid`, `coneSolid`
 *
 * Nothing in here knows about bolts, nuts, or bearings. The part family
 * (see `parts/*`) composes these into shapes and hands the resulting
 * face list to `formats/step.ts` for final AP214 assembly.
 *
 * All numeric coords pass through `P()` which standardizes on 6-decimal
 * precision to keep the cache key (in cache.ts) aligned with on-disk
 * text — rounding mismatch would cause spurious cache misses.
 */

/** Fluent STEP entity emitter. */
export class StepBuilder {
  private lines: string[] = [];
  private nextId = 1;

  add(ent: string): string {
    const id = this.nextId++;
    this.lines.push(`#${id}=${ent};`);
    return `#${id}`;
  }

  /** Snapshot the current entity body — the DATA section contents. */
  render(): string {
    return this.lines.join('\n');
  }
}

// ─────────────────────────────────────────────────────────────────────
// Low-level formatters
// ─────────────────────────────────────────────────────────────────────

/** Format a number for STEP — always has a decimal point, 6-digit precision. */
export const P = (n: number): string => {
  const s = Number(n.toFixed(6)).toString();
  return s.includes('.') ? s : `${s}.`;
};

/** Quote a STEP string literal (single-quoted, double-escaped). */
export const Q = (v: string): string => `'${v.replace(/'/g, "''")}'`;

// ─────────────────────────────────────────────────────────────────────
// Primitive entities
// ─────────────────────────────────────────────────────────────────────

export function cart(b: StepBuilder, x: number, y: number, z: number, name = ''): string {
  return b.add(`CARTESIAN_POINT(${Q(name)},(${P(x)},${P(y)},${P(z)}))`);
}

export function dir(b: StepBuilder, x: number, y: number, z: number, name = ''): string {
  return b.add(`DIRECTION(${Q(name)},(${P(x)},${P(y)},${P(z)}))`);
}

export function vertex(b: StepBuilder, pt: string): string {
  return b.add(`VERTEX_POINT('',${pt})`);
}

export function axis2(b: StepBuilder, origin: string, normal: string, xAxis: string): string {
  return b.add(`AXIS2_PLACEMENT_3D('',${origin},${normal},${xAxis})`);
}

// ─────────────────────────────────────────────────────────────────────
// Edges / wires
// ─────────────────────────────────────────────────────────────────────

interface Pt3 { x: number; y: number; z: number }

/** A straight 3D line between two points — returns the LINE reference. */
export function lineBetween(b: StepBuilder, a: Pt3, c: Pt3): string {
  const dx = c.x - a.x;
  const dy = c.y - a.y;
  const dz = c.z - a.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  const origin = cart(b, a.x, a.y, a.z);
  const d = b.add(`VECTOR('',${dir(b, dx / len, dy / len, dz / len)},${P(len)})`);
  return b.add(`LINE('',${origin},${d})`);
}

export function makeEdge(b: StepBuilder, v1: string, v2: string, curve: string): string {
  return b.add(`EDGE_CURVE('',${v1},${v2},${curve},.T.)`);
}

export function orientedEdge(b: StepBuilder, edge: string, forward: boolean): string {
  return b.add(`ORIENTED_EDGE('',*,*,${edge},${forward ? '.T.' : '.F.'})`);
}

export function edgeLoop(b: StepBuilder, orientedEdges: string[]): string {
  return b.add(`EDGE_LOOP('',(${orientedEdges.join(',')}))`);
}

/** A straight-line edge between two point tuples. */
export function straightEdge(b: StepBuilder, a: Pt3, c: Pt3): string {
  const v1 = vertex(b, cart(b, a.x, a.y, a.z));
  const v2 = vertex(b, cart(b, c.x, c.y, c.z));
  return makeEdge(b, v1, v2, lineBetween(b, a, c));
}

// ─────────────────────────────────────────────────────────────────────
// Solid builders — each returns the list of ADVANCED_FACE refs making
// up a closed shell. The caller combines one or more face lists into a
// single CLOSED_SHELL + MANIFOLD_SOLID_BREP at the assembly step
// (see formats/step.ts).
// ─────────────────────────────────────────────────────────────────────

/**
 * Cylinder aligned with +Z, radius r, from z=zBase to z=zBase+length.
 * Returns 3 faces: cylindrical side + top disk + bottom disk.
 */
export function cylinderSolid(
  b: StepBuilder,
  r: number,
  length: number,
  zBase: number,
): string[] {
  const zTop = zBase + length;

  const cylAx = axis2(b, cart(b, 0, 0, zBase), dir(b, 0, 0, 1), dir(b, 1, 0, 0));
  const cylSurface = b.add(`CYLINDRICAL_SURFACE('',${cylAx},${P(r)})`);

  // seam edge (vertical line at θ=0)
  const vBot = vertex(b, cart(b, r, 0, zBase));
  const vTop = vertex(b, cart(b, r, 0, zTop));
  const seamLine = lineBetween(b, { x: r, y: 0, z: zBase }, { x: r, y: 0, z: zTop });
  const seamEdge = makeEdge(b, vBot, vTop, seamLine);

  // full circles at top/bottom
  const botAx = axis2(b, cart(b, 0, 0, zBase), dir(b, 0, 0, 1), dir(b, 1, 0, 0));
  const botCircle = b.add(`CIRCLE('',${botAx},${P(r)})`);
  const botEdge = makeEdge(b, vBot, vBot, botCircle);

  const topAx = axis2(b, cart(b, 0, 0, zTop), dir(b, 0, 0, 1), dir(b, 1, 0, 0));
  const topCircle = b.add(`CIRCLE('',${topAx},${P(r)})`);
  const topEdge = makeEdge(b, vTop, vTop, topCircle);

  // Side face — loop: bottom circle + seam up + top circle (reversed) + seam down
  const sideLoop = edgeLoop(b, [
    orientedEdge(b, botEdge, true),
    orientedEdge(b, seamEdge, true),
    orientedEdge(b, topEdge, false),
    orientedEdge(b, seamEdge, false),
  ]);
  const sideBound = b.add(`FACE_OUTER_BOUND('',${sideLoop},.T.)`);
  const sideFace = b.add(`ADVANCED_FACE('',(${sideBound}),${cylSurface},.T.)`);

  // Top disk
  const topLoop = edgeLoop(b, [orientedEdge(b, topEdge, true)]);
  const topBound = b.add(`FACE_OUTER_BOUND('',${topLoop},.T.)`);
  const topPlane = b.add(`PLANE('',${topAx})`);
  const topFace = b.add(`ADVANCED_FACE('',(${topBound}),${topPlane},.T.)`);

  // Bottom disk — reversed orientation
  const botRevAx = axis2(b, cart(b, 0, 0, zBase), dir(b, 0, 0, -1), dir(b, 1, 0, 0));
  const botLoop = edgeLoop(b, [orientedEdge(b, botEdge, false)]);
  const botBound = b.add(`FACE_OUTER_BOUND('',${botLoop},.T.)`);
  const botPlane = b.add(`PLANE('',${botRevAx})`);
  const botFace = b.add(`ADVANCED_FACE('',(${botBound}),${botPlane},.T.)`);

  return [sideFace, topFace, botFace];
}

/**
 * Regular hex prism aligned with +Z, across-flats S, height H.
 * Head sits from z=zBase to z=zBase+H. 8 faces (6 sides + top + bottom).
 */
export function hexPrism(
  b: StepBuilder,
  acrossFlats: number,
  height: number,
  zBase: number,
): string[] {
  const R = acrossFlats / Math.sqrt(3); // circumradius
  // Corners at 30/90/150/210/270/330° (flats on X axis)
  const angles = [30, 90, 150, 210, 270, 330].map((a) => (a * Math.PI) / 180);
  const bot = angles.map((a) => ({ x: R * Math.cos(a), y: R * Math.sin(a), z: zBase }));
  const top = bot.map((p) => ({ ...p, z: zBase + height }));

  const vBot = bot.map((p) => vertex(b, cart(b, p.x, p.y, p.z)));
  const vTop = top.map((p) => vertex(b, cart(b, p.x, p.y, p.z)));

  const faces: string[] = [];

  // 6 side faces
  for (let i = 0; i < 6; i++) {
    const j = (i + 1) % 6;
    const e0 = makeEdge(b, vBot[i], vBot[j], lineBetween(b, bot[i], bot[j]));
    const e1 = makeEdge(b, vBot[j], vTop[j], lineBetween(b, bot[j], top[j]));
    const e2 = makeEdge(b, vTop[j], vTop[i], lineBetween(b, top[j], top[i]));
    const e3 = makeEdge(b, vTop[i], vBot[i], lineBetween(b, top[i], bot[i]));
    const loop = edgeLoop(b, [
      orientedEdge(b, e0, true),
      orientedEdge(b, e1, true),
      orientedEdge(b, e2, true),
      orientedEdge(b, e3, true),
    ]);
    const outer = b.add(`FACE_OUTER_BOUND('',${loop},.T.)`);
    // outward normal = perpendicular to edge, in-plane with +Z
    const ex = bot[j].x - bot[i].x;
    const ey = bot[j].y - bot[i].y;
    const nLen = Math.hypot(ex, ey) || 1;
    const nx = ey / nLen;
    const ny = -ex / nLen;
    const ap = axis2(b, cart(b, bot[i].x, bot[i].y, bot[i].z), dir(b, nx, ny, 0), dir(b, 1, 0, 0));
    const plane = b.add(`PLANE('',${ap})`);
    faces.push(b.add(`ADVANCED_FACE('',(${outer}),${plane},.T.)`));
  }

  // Top hex face
  {
    const loop = edgeLoop(
      b,
      [0, 1, 2, 3, 4, 5].map((i) =>
        orientedEdge(b, makeEdge(b, vTop[i], vTop[(i + 1) % 6], lineBetween(b, top[i], top[(i + 1) % 6])), true),
      ),
    );
    const outer = b.add(`FACE_OUTER_BOUND('',${loop},.T.)`);
    const ap = axis2(b, cart(b, 0, 0, zBase + height), dir(b, 0, 0, 1), dir(b, 1, 0, 0));
    const plane = b.add(`PLANE('',${ap})`);
    faces.push(b.add(`ADVANCED_FACE('',(${outer}),${plane},.T.)`));
  }

  // Bottom hex face — reversed
  {
    const order = [0, 5, 4, 3, 2, 1];
    const loop = edgeLoop(
      b,
      order.map((i, idx) => {
        const next = order[(idx + 1) % order.length];
        return orientedEdge(b, makeEdge(b, vBot[i], vBot[next], lineBetween(b, bot[i], bot[next])), true);
      }),
    );
    const outer = b.add(`FACE_OUTER_BOUND('',${loop},.T.)`);
    const ap = axis2(b, cart(b, 0, 0, zBase), dir(b, 0, 0, -1), dir(b, 1, 0, 0));
    const plane = b.add(`PLANE('',${ap})`);
    faces.push(b.add(`ADVANCED_FACE('',(${outer}),${plane},.T.)`));
  }

  return faces;
}

/**
 * Threaded shaft — emits TWO closed solids sharing the axis:
 *   · Shank region: radius `rMajor`, length `L − Lt`, from zBase upward
 *   · Thread region: radius `rMinor` (< rMajor), length `Lt`, next
 *
 * The two solids meet at z = zBase + (L − Lt). CAD imports treat this
 * as a single compound part; measurements are exact. Phase 2 with
 * opencascade.js will replace this with a proper helical-swept thread.
 *
 * Special cases:
 *   · Lt ≤ 0 → single plain cylinder (no thread).
 *   · Lt ≥ L → single cylinder at minor diameter (fully-threaded stud).
 *
 * Returns the concatenated face list.
 */
export function threadedShaftSolids(
  b: StepBuilder,
  rMajor: number,
  rMinor: number,
  L: number,
  Lt: number,
  zBase: number,
): string[] {
  if (Lt <= 0 || rMinor <= 0 || rMinor >= rMajor) {
    return cylinderSolid(b, rMajor, L, zBase);
  }
  if (Lt >= L) {
    return cylinderSolid(b, rMinor, L, zBase);
  }
  const shankLen = L - Lt;
  const shankFaces = cylinderSolid(b, rMajor, shankLen, zBase);
  const threadFaces = cylinderSolid(b, rMinor, Lt, zBase + shankLen);
  return [...shankFaces, ...threadFaces];
}

/**
 * Regular square prism along +Z — across-flats `s` (same convention as
 * `hexPrism`), height `h`, base at zBase. 6 faces (4 sides + top +
 * bottom). Used by square-head bolts and similar four-sided heads.
 */
export function squarePrism(
  b: StepBuilder,
  acrossFlats: number,
  height: number,
  zBase: number,
): string[] {
  const r = acrossFlats / 2;
  // Corners at ±r (across-flats aligned to x/y axes).
  const bot = [
    { x:  r, y:  r, z: zBase },
    { x: -r, y:  r, z: zBase },
    { x: -r, y: -r, z: zBase },
    { x:  r, y: -r, z: zBase },
  ];
  const top = bot.map((p) => ({ ...p, z: zBase + height }));
  const vBot = bot.map((p) => vertex(b, cart(b, p.x, p.y, p.z)));
  const vTop = top.map((p) => vertex(b, cart(b, p.x, p.y, p.z)));

  const faces: string[] = [];

  // 4 side faces
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const e0 = makeEdge(b, vBot[i], vBot[j], lineBetween(b, bot[i], bot[j]));
    const e1 = makeEdge(b, vBot[j], vTop[j], lineBetween(b, bot[j], top[j]));
    const e2 = makeEdge(b, vTop[j], vTop[i], lineBetween(b, top[j], top[i]));
    const e3 = makeEdge(b, vTop[i], vBot[i], lineBetween(b, top[i], bot[i]));
    const loop = edgeLoop(b, [
      orientedEdge(b, e0, true),
      orientedEdge(b, e1, true),
      orientedEdge(b, e2, true),
      orientedEdge(b, e3, true),
    ]);
    const outer = b.add(`FACE_OUTER_BOUND('',${loop},.T.)`);
    const ex = bot[j].x - bot[i].x;
    const ey = bot[j].y - bot[i].y;
    const nLen = Math.hypot(ex, ey) || 1;
    const nx = ey / nLen;
    const ny = -ex / nLen;
    const ap = axis2(b, cart(b, bot[i].x, bot[i].y, bot[i].z), dir(b, nx, ny, 0), dir(b, 1, 0, 0));
    const plane = b.add(`PLANE('',${ap})`);
    faces.push(b.add(`ADVANCED_FACE('',(${outer}),${plane},.T.)`));
  }

  // Top square
  {
    const loop = edgeLoop(
      b,
      [0, 1, 2, 3].map((i) =>
        orientedEdge(b, makeEdge(b, vTop[i], vTop[(i + 1) % 4], lineBetween(b, top[i], top[(i + 1) % 4])), true),
      ),
    );
    const outer = b.add(`FACE_OUTER_BOUND('',${loop},.T.)`);
    const ap = axis2(b, cart(b, 0, 0, zBase + height), dir(b, 0, 0, 1), dir(b, 1, 0, 0));
    const plane = b.add(`PLANE('',${ap})`);
    faces.push(b.add(`ADVANCED_FACE('',(${outer}),${plane},.T.)`));
  }

  // Bottom square (reverse orientation)
  {
    const order = [0, 3, 2, 1];
    const loop = edgeLoop(
      b,
      order.map((i, idx) => {
        const next = order[(idx + 1) % order.length];
        return orientedEdge(b, makeEdge(b, vBot[i], vBot[next], lineBetween(b, bot[i], bot[next])), true);
      }),
    );
    const outer = b.add(`FACE_OUTER_BOUND('',${loop},.T.)`);
    const ap = axis2(b, cart(b, 0, 0, zBase), dir(b, 0, 0, -1), dir(b, 1, 0, 0));
    const plane = b.add(`PLANE('',${ap})`);
    faces.push(b.add(`ADVANCED_FACE('',(${outer}),${plane},.T.)`));
  }

  return faces;
}

/**
 * Annular (ring) solid along +Z — outer radius `rOuter`, inner hole
 * radius `rInner`, thickness `h`, base at zBase. 4 faces:
 *   · outer cylindrical wall
 *   · inner cylindrical wall (inverted normal)
 *   · top annular ring (PLANE with outer bound + inner hole bound)
 *   · bottom annular ring (reversed)
 *
 * Used by washers and flanged bolt heads. `rInner` must be strictly
 * smaller than `rOuter`; otherwise this returns a plain cylinder.
 */
export function annularSolid(
  b: StepBuilder,
  rOuter: number,
  rInner: number,
  h: number,
  zBase: number,
): string[] {
  if (rInner <= 0 || rInner >= rOuter) {
    return cylinderSolid(b, rOuter, h, zBase);
  }
  const zTop = zBase + h;

  // ── Outer cylindrical wall (points outward, .T. orientation) ──
  const outerAx = axis2(b, cart(b, 0, 0, zBase), dir(b, 0, 0, 1), dir(b, 1, 0, 0));
  const outerCyl = b.add(`CYLINDRICAL_SURFACE('',${outerAx},${P(rOuter)})`);
  const vOutBot = vertex(b, cart(b, rOuter, 0, zBase));
  const vOutTop = vertex(b, cart(b, rOuter, 0, zTop));
  const outerSeam = makeEdge(
    b,
    vOutBot,
    vOutTop,
    lineBetween(b, { x: rOuter, y: 0, z: zBase }, { x: rOuter, y: 0, z: zTop }),
  );
  const outerCircleBotAx = axis2(b, cart(b, 0, 0, zBase), dir(b, 0, 0, 1), dir(b, 1, 0, 0));
  const outerCircleBot = b.add(`CIRCLE('',${outerCircleBotAx},${P(rOuter)})`);
  const outerEdgeBot = makeEdge(b, vOutBot, vOutBot, outerCircleBot);
  const outerCircleTopAx = axis2(b, cart(b, 0, 0, zTop), dir(b, 0, 0, 1), dir(b, 1, 0, 0));
  const outerCircleTop = b.add(`CIRCLE('',${outerCircleTopAx},${P(rOuter)})`);
  const outerEdgeTop = makeEdge(b, vOutTop, vOutTop, outerCircleTop);
  const outerWallLoop = edgeLoop(b, [
    orientedEdge(b, outerEdgeBot, true),
    orientedEdge(b, outerSeam, true),
    orientedEdge(b, outerEdgeTop, false),
    orientedEdge(b, outerSeam, false),
  ]);
  const outerWallBound = b.add(`FACE_OUTER_BOUND('',${outerWallLoop},.T.)`);
  const outerWall = b.add(`ADVANCED_FACE('',(${outerWallBound}),${outerCyl},.T.)`);

  // ── Inner cylindrical wall (points inward — we flip the surface normal
  //     by using .F. on the face) ──
  const innerAx = axis2(b, cart(b, 0, 0, zBase), dir(b, 0, 0, 1), dir(b, 1, 0, 0));
  const innerCyl = b.add(`CYLINDRICAL_SURFACE('',${innerAx},${P(rInner)})`);
  const vInBot = vertex(b, cart(b, rInner, 0, zBase));
  const vInTop = vertex(b, cart(b, rInner, 0, zTop));
  const innerSeam = makeEdge(
    b,
    vInBot,
    vInTop,
    lineBetween(b, { x: rInner, y: 0, z: zBase }, { x: rInner, y: 0, z: zTop }),
  );
  const innerCircleBot = b.add(`CIRCLE('',${outerCircleBotAx},${P(rInner)})`);
  const innerEdgeBot = makeEdge(b, vInBot, vInBot, innerCircleBot);
  const innerCircleTop = b.add(`CIRCLE('',${outerCircleTopAx},${P(rInner)})`);
  const innerEdgeTop = makeEdge(b, vInTop, vInTop, innerCircleTop);
  const innerWallLoop = edgeLoop(b, [
    orientedEdge(b, innerEdgeBot, true),
    orientedEdge(b, innerSeam, true),
    orientedEdge(b, innerEdgeTop, false),
    orientedEdge(b, innerSeam, false),
  ]);
  const innerWallBound = b.add(`FACE_OUTER_BOUND('',${innerWallLoop},.T.)`);
  const innerWall = b.add(`ADVANCED_FACE('',(${innerWallBound}),${innerCyl},.F.)`);

  // ── Top annular face — outer bound CCW + inner hole bound CW (.F.) ──
  const topOuterBound = b.add(
    `FACE_OUTER_BOUND('',${edgeLoop(b, [orientedEdge(b, outerEdgeTop, true)])},.T.)`,
  );
  const topHoleBound = b.add(
    `FACE_BOUND('',${edgeLoop(b, [orientedEdge(b, innerEdgeTop, false)])},.T.)`,
  );
  const topPlane = b.add(`PLANE('',${outerCircleTopAx})`);
  const topFace = b.add(`ADVANCED_FACE('',(${topOuterBound},${topHoleBound}),${topPlane},.T.)`);

  // ── Bottom annular face — reversed ──
  const botRevAx = axis2(b, cart(b, 0, 0, zBase), dir(b, 0, 0, -1), dir(b, 1, 0, 0));
  const botOuterBound = b.add(
    `FACE_OUTER_BOUND('',${edgeLoop(b, [orientedEdge(b, outerEdgeBot, false)])},.T.)`,
  );
  const botHoleBound = b.add(
    `FACE_BOUND('',${edgeLoop(b, [orientedEdge(b, innerEdgeBot, true)])},.T.)`,
  );
  const botPlane = b.add(`PLANE('',${botRevAx})`);
  const botFace = b.add(`ADVANCED_FACE('',(${botOuterBound},${botHoleBound}),${botPlane},.T.)`);

  return [outerWall, innerWall, topFace, botFace];
}

/**
 * Truncated cone (frustum) along +Z, radius rBot at zBase, rTop at
 * zBase+height. If rTop === 0 it's a full cone, if rTop === rBot a cylinder.
 * 3 faces: conical side + top disk + bottom disk.
 *
 * Used for countersunk / button / pan heads where the head flares out.
 */
export function coneSolid(
  b: StepBuilder,
  rBot: number,
  rTop: number,
  height: number,
  zBase: number,
): string[] {
  if (Math.abs(rBot - rTop) < 1e-6) {
    return cylinderSolid(b, rBot, height, zBase);
  }
  const zTop = zBase + height;
  // CONICAL_SURFACE apex; we describe the cone around its actual axis.
  // For a frustum we still emit ADVANCED_FACE with a conical surface.
  // Half-angle: tan α = (rBot - rTop) / height (positive if rBot > rTop)
  const alpha = Math.atan2(rBot - rTop, height);
  // Apex is on the +Z side of zTop (if rBot>rTop) at distance rTop/tan(alpha).
  const apexOffset = alpha === 0 ? 0 : rTop / Math.tan(alpha);
  const apexZ = zTop + apexOffset;
  const coneAx = axis2(b, cart(b, 0, 0, apexZ), dir(b, 0, 0, -1), dir(b, 1, 0, 0));
  // CONICAL_SURFACE is defined by apex axis + half-angle + ref radius at a given offset;
  // STEP's CONICAL_SURFACE(placement, radius, semi_angle). Radius at the placement origin,
  // which we set to apex ⇒ radius 0 nominally. Many importers accept (ax, 0, alpha).
  const coneSurface = b.add(`CONICAL_SURFACE('',${coneAx},${P(0)},${P(alpha)})`);

  const vBot = vertex(b, cart(b, rBot, 0, zBase));
  const vTop = vertex(b, cart(b, rTop, 0, zTop));
  const seamLine = lineBetween(b, { x: rBot, y: 0, z: zBase }, { x: rTop, y: 0, z: zTop });
  const seamEdge = makeEdge(b, vBot, vTop, seamLine);

  const botAx = axis2(b, cart(b, 0, 0, zBase), dir(b, 0, 0, 1), dir(b, 1, 0, 0));
  const botCircle = b.add(`CIRCLE('',${botAx},${P(rBot)})`);
  const botEdge = makeEdge(b, vBot, vBot, botCircle);

  const topAx = axis2(b, cart(b, 0, 0, zTop), dir(b, 0, 0, 1), dir(b, 1, 0, 0));
  const topCircle = b.add(`CIRCLE('',${topAx},${P(rTop)})`);
  const topEdge = makeEdge(b, vTop, vTop, topCircle);

  const sideLoop = edgeLoop(b, [
    orientedEdge(b, botEdge, true),
    orientedEdge(b, seamEdge, true),
    orientedEdge(b, topEdge, false),
    orientedEdge(b, seamEdge, false),
  ]);
  const sideBound = b.add(`FACE_OUTER_BOUND('',${sideLoop},.T.)`);
  const sideFace = b.add(`ADVANCED_FACE('',(${sideBound}),${coneSurface},.T.)`);

  const topLoop = edgeLoop(b, [orientedEdge(b, topEdge, true)]);
  const topBound = b.add(`FACE_OUTER_BOUND('',${topLoop},.T.)`);
  const topPlane = b.add(`PLANE('',${topAx})`);
  const topFace = b.add(`ADVANCED_FACE('',(${topBound}),${topPlane},.T.)`);

  const botRevAx = axis2(b, cart(b, 0, 0, zBase), dir(b, 0, 0, -1), dir(b, 1, 0, 0));
  const botLoop = edgeLoop(b, [orientedEdge(b, botEdge, false)]);
  const botBound = b.add(`FACE_OUTER_BOUND('',${botLoop},.T.)`);
  const botPlane = b.add(`PLANE('',${botRevAx})`);
  const botFace = b.add(`ADVANCED_FACE('',(${botBound}),${botPlane},.T.)`);

  return [sideFace, topFace, botFace];
}
