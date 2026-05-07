/**
 * Bootstrap — side-effect imports that register every part family with
 * the top-level registry. Import this module from the worker (or any
 * caller that needs the registry populated) BEFORE calling into it.
 *
 * Adding a new family = add one import line. Each family's index.ts
 * performs its own `registerFamily(...)` call at module load time.
 */
import './bolt/index.js';
import './washer/index.js';
import './bearing/index.js';
import './motor/index.js';
// Future:
// import './nut/index.js';
