// Brief-area formula engine — a tiny, dependency-free spreadsheet used by both
// the client (live preview) and the server (authoritative resolution).
//
// A space's `target_area` (area EACH) may be a literal number or a formula
// string. Formulas support:
//   • arithmetic          @staff * 12 + 5
//   • grouping / unary     (a + b) / 2, -x
//   • percents            15% * [Adult Collection]      (15% → 0.15)
//   • project variables    @staff, @occupants           (plain numbers)
//   • space references     [Reading Room]               (that space's TOTAL area)
//                          [Reading Room].each          (its unit area)
//                          [Reading Room].total         (explicit total)
//   • functions            min max round ceil floor abs sum
//
// A leading '=' is optional and stripped. Space references resolve to the
// referenced space's TOTAL programme area (count × each, or a container's
// rolled-up subtotal), while a formula itself yields the area EACH — matching
// the "Area each" / "Total" columns in the brief.

const FUNCTIONS = {
  min: (...a) => Math.min(...a),
  max: (...a) => Math.max(...a),
  round: (x) => Math.round(x),
  ceil: (x) => Math.ceil(x),
  floor: (x) => Math.floor(x),
  abs: (x) => Math.abs(x),
  sum: (...a) => a.reduce((s, x) => s + x, 0),
};

// ---------- tokenizer ----------

function tokenize(src) {
  const tokens = [];
  let i = 0;
  const s = src;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (c >= '0' && c <= '9') {
      let j = i + 1;
      while (j < s.length && ((s[j] >= '0' && s[j] <= '9') || s[j] === '.')) j++;
      let value = Number(s.slice(i, j));
      if (!Number.isFinite(value)) throw new Error(`Bad number "${s.slice(i, j)}"`);
      if (s[j] === '%') { value /= 100; j++; }
      tokens.push({ t: 'num', value });
      i = j;
      continue;
    }
    if (c === '@') { // variable reference
      let j = i + 1;
      while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
      const name = s.slice(i + 1, j);
      if (!name) throw new Error('Expected a variable name after "@"');
      tokens.push({ t: 'var', name });
      i = j;
      continue;
    }
    if (c === '[') { // space reference, optionally .each / .total
      const j = s.indexOf(']', i + 1);
      if (j === -1) throw new Error('Unclosed "[" in a space reference');
      const name = s.slice(i + 1, j).trim();
      let k = j + 1;
      let part = 'total'; // bare [Name] stays the TOTAL, for back-compat
      const m = /^\.(each|total)/i.exec(s.slice(k));
      if (m) {
        part = m[1].toLowerCase();
        k += m[0].length;
      }
      tokens.push({ t: 'ref', name, part });
      i = k;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) { // function name
      let j = i + 1;
      while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
      tokens.push({ t: 'fn', name: s.slice(i, j).toLowerCase() });
      i = j;
      continue;
    }
    if ('+-*/(),'.includes(c)) { tokens.push({ t: c }); i++; continue; }
    throw new Error(`Unexpected character "${c}"`);
  }
  return tokens;
}

// ---------- recursive-descent parser → evaluator ----------
// Grammar: expr = term (('+'|'-') term)*; term = unary (('*'|'/') unary)*;
//          unary = '-' unary | primary; primary = num | var | ref | fn '(' args ')' | '(' expr ')'.

function parse(tokens) {
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const expect = (t) => {
    const tok = next();
    if (!tok || tok.t !== t) throw new Error(`Expected "${t}"`);
  };

  function primary() {
    const tok = peek();
    if (!tok) throw new Error('Unexpected end of formula');
    if (tok.t === 'num') { next(); return { k: 'num', value: tok.value }; }
    if (tok.t === 'var') { next(); return { k: 'var', name: tok.name }; }
    if (tok.t === 'ref') { next(); return { k: 'ref', name: tok.name, part: tok.part || 'total' }; }
    if (tok.t === 'fn') {
      next();
      expect('(');
      const args = [];
      if (peek() && peek().t !== ')') {
        args.push(expr());
        while (peek() && peek().t === ',') { next(); args.push(expr()); }
      }
      expect(')');
      return { k: 'fn', name: tok.name, args };
    }
    if (tok.t === '(') { next(); const e = expr(); expect(')'); return e; }
    throw new Error('Expected a number, variable, reference or "("');
  }
  function unary() {
    if (peek() && peek().t === '-') { next(); return { k: 'neg', arg: unary() }; }
    if (peek() && peek().t === '+') { next(); return unary(); }
    return primary();
  }
  function term() {
    let node = unary();
    while (peek() && (peek().t === '*' || peek().t === '/')) {
      const op = next().t;
      node = { k: 'bin', op, l: node, r: unary() };
    }
    return node;
  }
  function expr() {
    let node = term();
    while (peek() && (peek().t === '+' || peek().t === '-')) {
      const op = next().t;
      node = { k: 'bin', op, l: node, r: term() };
    }
    return node;
  }

  const ast = expr();
  if (pos < tokens.length) throw new Error('Unexpected trailing input');
  return ast;
}

// Strip an optional leading '=' and confirm there's something to parse.
function normalize(src) {
  let t = String(src ?? '').trim();
  if (t.startsWith('=')) t = t.slice(1).trim();
  return t;
}

export function isFormula(src) {
  return typeof src === 'string' && src.trim().startsWith('=');
}

// List the space names a formula references (for building the dependency graph).
export function referencedSpaces(src) {
  const out = [];
  const body = normalize(src);
  if (!body) return out;
  try {
    for (const tok of tokenize(body)) if (tok.t === 'ref') out.push(tok.name);
  } catch { /* parse errors surface elsewhere */ }
  return out;
}

// Evaluate one formula against a scope:
//   scope.vars      — { name: number } project variables (referenced as @name)
//   scope.spaceArea — (name) => number (a referenced space's total area)
// Throws Error(message) on parse / reference / math problems.
export function evalFormula(src, scope = {}) {
  const body = normalize(src);
  if (!body) throw new Error('Empty formula');
  const ast = parse(tokenize(body));
  const vars = scope.vars || {};
  const spaceArea = scope.spaceArea || (() => { throw new Error('No space lookup'); });
  const walk = (n) => {
    switch (n.k) {
      case 'num': return n.value;
      case 'neg': return -walk(n.arg);
      case 'var': {
        const v = vars[n.name];
        if (v == null || !Number.isFinite(Number(v))) throw new Error(`Unknown variable “@${n.name}”`);
        return Number(v);
      }
      case 'ref': {
        const v = spaceArea(n.name, n.part || 'total');
        if (v == null || !Number.isFinite(v)) throw new Error(`Unknown space “[${n.name}]”`);
        return v;
      }
      case 'fn': {
        const fn = FUNCTIONS[n.name];
        if (!fn) throw new Error(`Unknown function “${n.name}()”`);
        return fn(...n.args.map(walk));
      }
      case 'bin': {
        const l = walk(n.l), r = walk(n.r);
        if (n.op === '+') return l + r;
        if (n.op === '-') return l - r;
        if (n.op === '*') return l * r;
        if (n.op === '/') {
          if (r === 0) throw new Error('Division by zero');
          return l / r;
        }
        throw new Error(`Bad operator ${n.op}`);
      }
      default: throw new Error('Bad expression');
    }
  };
  const result = walk(ast);
  if (!Number.isFinite(result)) throw new Error('Formula did not produce a number');
  return result;
}

// ---------- whole-brief resolution ----------
// Resolve every space's `each` (target_area) and `total` area, honouring
// formulas, variables and inter-space references. Pure: takes plain space rows
// and a variables map; returns resolved values plus per-space error messages.
//
// spaces: [{ id, name, count, target_area, area_formula, parent_id, kind, child_mode }]
// Returns { each: Map(id→number), total: Map(id→number), errors: Map(id→string) }.
export function resolveBrief(spaces, variables = {}) {
  const CONTAINER_KINDS = new Set(['building', 'group']);
  const byId = new Map(spaces.map((s) => [s.id, s]));
  const childIds = new Set();
  for (const s of spaces) if (s.parent_id != null) childIds.add(s.parent_id);

  // Mirror compute.js's notion of which rows carry their own area (leaves) vs.
  // roll up from descendants (pure containers). Kept local so this stays a
  // dependency-free module usable on the server.
  const isPureContainer = (s) => {
    if (CONTAINER_KINDS.has(s.kind)) return true;
    if (childIds.has(s.id)) return s.child_mode !== 'within' && s.child_mode !== 'attached';
    return false;
  };
  const isWithinDescendant = (s) => {
    let cur = s;
    const seen = new Set();
    while (cur && cur.parent_id != null && byId.has(cur.parent_id) && !seen.has(cur.id)) {
      seen.add(cur.id);
      cur = byId.get(cur.parent_id);
      if (!CONTAINER_KINDS.has(cur.kind) && cur.child_mode === 'within') return true;
    }
    return false;
  };
  const isLeaf = (s) => !isPureContainer(s) && !isWithinDescendant(s);

  const byName = new Map(); // lower-cased name → first matching space
  for (const s of spaces) {
    const key = (s.name || '').trim().toLowerCase();
    if (key && !byName.has(key)) byName.set(key, s);
  }

  const each = new Map();   // resolved area-each per leaf
  const total = new Map();  // resolved total area per space (leaf & container)
  const errors = new Map();

  const leaves = spaces.filter(isLeaf);
  const leafById = new Map(leaves.map((s) => [s.id, s]));
  const countOf = (s) => Math.max(1, s?.count || 1);

  // Literal leaves are known immediately; formula leaves resolve by fixpoint.
  const pending = new Set();
  for (const s of leaves) {
    if (isFormula(s.area_formula)) {
      pending.add(s.id);
    } else {
      const e = Number(s.target_area) || 0;
      each.set(s.id, e);
      total.set(s.id, (s.count || 1) * e);
    }
  }

  // A referenced name resolves to a leaf total, or a container's rolled-up
  // subtotal (only once all its leaf descendants are known).
  const containerTotal = (s) => {
    let sum = 0;
    const stack = spaces.filter((x) => x.parent_id === s.id);
    while (stack.length) {
      const c = stack.pop();
      if (isLeaf(c)) {
        if (!total.has(c.id)) return null; // not resolved yet
        sum += total.get(c.id);
      }
      for (const gc of spaces.filter((x) => x.parent_id === c.id)) stack.push(gc);
    }
    return sum;
  };
  // `part` is 'total' (count × each — what a bare [Name] means, kept for
  // back-compat) or 'each' (the unit area). The bare form silently returning
  // the total is the trap: `5% * [Science laboratory]` on a ×6 room reads as
  // 5% of one lab and resolves to 5% of six, which is a plausible wrong number
  // rather than an error. `.each` / `.total` let a formula say which it meant.
  const lookupArea = (name, part = 'total') => {
    const s = byName.get((name || '').trim().toLowerCase());
    if (!s) return undefined; // unknown reference
    if (leafById.has(s.id)) {
      if (!total.has(s.id)) return null; // pending
      const t = total.get(s.id);
      return part === 'each' ? t / countOf(s) : t;
    }
    const t = containerTotal(s); // container (null while pending)
    // A container has no "each" of its own; its rolled-up subtotal is both.
    return t;
  };

  let progressed = true;
  while (progressed && pending.size) {
    progressed = false;
    for (const id of [...pending]) {
      const s = leafById.get(id);
      let unresolvedRef = false;
      const scope = {
        vars: variables,
        spaceArea: (name, part) => {
          const v = lookupArea(name, part);
          if (v === undefined) throw new Error(`Unknown space “[${name}]”`);
          if (v === null) { unresolvedRef = true; return 0; } // dependency pending
          return v;
        },
      };
      try {
        const value = evalFormula(s.area_formula, scope);
        if (unresolvedRef) continue; // wait for dependencies to resolve first
        if (value < 0) throw new Error('Area cannot be negative');
        each.set(id, value);
        total.set(id, (s.count || 1) * value);
        pending.delete(id);
        progressed = true;
      } catch (err) {
        if (unresolvedRef) continue; // real error is a pending dep, not this
        // A formula that does not evaluate leaves the room's LAST GOOD area in
        // place — it does not silently become 0 m². Zeroing it quietly deleted
        // the room from the net, from the applied design and from the issued
        // milestone, on nothing worse than a typo'd variable name. The error is
        // recorded so callers can render the row as blocking and exclude it
        // from a total they present as complete.
        errors.set(id, err.message);
        const held = Number(s.target_area);
        const keep = Number.isFinite(held) && held > 0 ? held : 0;
        each.set(id, keep);
        total.set(id, (s.count || 1) * keep);
        pending.delete(id);
        progressed = true;
      }
    }
  }
  // Anything still pending is a dependency cycle. Same rule as a bad formula:
  // hold the last good area and mark the row, rather than zeroing it.
  for (const id of pending) {
    const s = leafById.get(id);
    errors.set(id, 'Circular reference between spaces');
    const held = Number(s?.target_area);
    const keep = Number.isFinite(held) && held > 0 ? held : 0;
    each.set(id, keep);
    total.set(id, (s?.count || 1) * keep);
  }

  // Roll up container totals now that every leaf is resolved.
  for (const s of spaces) {
    if (leafById.has(s.id)) continue;
    total.set(s.id, containerTotal(s) || 0);
  }

  return { each, total, errors };
}
