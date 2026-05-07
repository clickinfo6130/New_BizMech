/**
 * STEP file composer — wraps a generator's face list with the standard
 * AP214 header + product scaffold and writes the final byte stream.
 *
 * Generators (in parts/*) call `assembleStepFile(req, build)` where
 * `build` is a callback that receives the StepBuilder and returns a
 * flat list of ADVANCED_FACE references. The composer closes those
 * faces into a CLOSED_SHELL + MANIFOLD_SOLID_BREP and threads them
 * through the AP214 Product / Context / Unit scaffolding.
 *
 * Nothing part-specific lives here — all the domain knowledge is in
 * the core/ primitives (reused) or the generator's own module.
 */
import type { CadGenerateRequest, CadGenerateResult } from '../types.js';
import { FORMAT_EXT, FORMAT_MIME } from '../types.js';
import { StepBuilder, Q, axis2, cart, dir } from '../core/step.js';
import { bomFileName } from '../core/bom-meta.js';

/** A generator callback: add faces via `b` and return the face references. */
export type StepGenerator = (b: StepBuilder) => string[];

export interface StepAssembleOptions {
  /** Name shown in STEP header / Product entity — defaults to partCode+keyComposite. */
  displayName?: string;
  /** Optional author line in the FILE_NAME header. */
  author?: string;
}

/**
 * Produce a full STEP file. The `build` callback gets a fresh StepBuilder
 * and returns the list of advanced faces that form a single closed solid.
 */
export function assembleStepFile(
  req: CadGenerateRequest,
  build: StepGenerator,
  opts: StepAssembleOptions = {},
): CadGenerateResult {
  const started = Date.now();
  const b = new StepBuilder();

  const faces = build(b);
  if (!faces.length) {
    throw new Error(`STEP generator produced no faces for ${req.partCode}`);
  }

  // Close the faces into a manifold solid
  const shell = b.add(`CLOSED_SHELL('',(${faces.join(',')}))`);
  const solid = b.add(`MANIFOLD_SOLID_BREP('',${shell})`);

  // World coordinate system for the shape rep
  const worldAxis = axis2(
    b,
    cart(b, 0, 0, 0, 'origin'),
    dir(b, 0, 0, 1, 'axis'),
    dir(b, 1, 0, 0, 'refdir'),
  );

  // ── Product / Context / Unit scaffolding (AP214 standard boilerplate)
  // Forward-reference placeholders are rewritten after rendering.
  const shapeRep = b.add(
    `ADVANCED_BREP_SHAPE_REPRESENTATION('',(${solid},${worldAxis}),#CTX)`,
  );
  const prodDefShape = b.add(`PRODUCT_DEFINITION_SHAPE('','',#PDEF)`);
  b.add(`SHAPE_DEFINITION_REPRESENTATION(${prodDefShape},${shapeRep})`);

  const appCtx = b.add(
    `APPLICATION_CONTEXT('core data for automotive mechanical design processes')`,
  );
  const productCtx = b.add(`PRODUCT_CONTEXT('',${appCtx},'mechanical')`);
  const displayName = opts.displayName ?? defaultDisplayName(req);
  const product = b.add(
    `PRODUCT(${Q(req.partCode)},${Q(displayName)},'',(${productCtx}))`,
  );
  const prodDefCtx = b.add(
    `PRODUCT_DEFINITION_CONTEXT('part definition',${appCtx},'design')`,
  );
  const prodForm = b.add(
    `PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE('','LAST_VERSION',${product},.MADE.)`,
  );
  const productDef = b.add(
    `PRODUCT_DEFINITION('design','',${prodForm},${prodDefCtx})`,
  );

  // Units: mm, radian, steradian
  const lengthUnit = b.add(`(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))`);
  const angleUnit = b.add(`(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))`);
  const solidUnit = b.add(`(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())`);
  const tolerance = b.add(
    `UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.0E-7),${lengthUnit},'distance_accuracy_value','')`,
  );
  const geomCtx = b.add(
    `(GEOMETRIC_REPRESENTATION_CONTEXT(3)` +
      `GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${tolerance}))` +
      `GLOBAL_UNIT_ASSIGNED_CONTEXT((${lengthUnit},${angleUnit},${solidUnit}))` +
      `REPRESENTATION_CONTEXT('Context #1','3D Context with UNIT and UNCERTAINTY'))`,
  );
  b.add(
    `APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,${appCtx})`,
  );

  const body = b.render().replace(/#CTX/g, geomCtx).replace(/#PDEF/g, productDef);
  const header = buildHeader(req, displayName, opts.author);
  const file = `${header}\nDATA;\n${body}\nENDSEC;\nEND-ISO-10303-21;\n`;
  const bytes = Buffer.from(file, 'utf-8');

  const ext = FORMAT_EXT.STEP;
  const mimeType = FORMAT_MIME.STEP;
  return {
    bytes,
    format: 'STEP',
    mimeType,
    ext,
    backend: 'local',
    generatedMs: Date.now() - started,
    // BOM-aware filename ("M6X1-40L.stp") — keeps Inventor's IPT tree
    // label readable after STEP→IPT conversion.
    fileName: bomFileName(req, ext),
  };
}

function defaultDisplayName(req: CadGenerateRequest): string {
  const base = req.keyComposite || req.partCode;
  return req.material ? `${base} / ${req.material}` : base;
}

function buildHeader(req: CadGenerateRequest, displayName: string, author = 'BizMech'): string {
  const now = new Date().toISOString();
  const safeKey = String(req.keyComposite || req.partCode).replace(/[^\w.-]+/g, '_');
  return [
    'ISO-10303-21;',
    'HEADER;',
    `FILE_DESCRIPTION(('${req.partCode} — ${displayName}'),'2;1');`,
    `FILE_NAME('${req.partCode}_${safeKey}.stp','${now}',('${author}'),('${author}'),'BizMech STEP writer v1','BizMech Phase 1','');`,
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));",
    'ENDSEC;',
  ].join('\n');
}
