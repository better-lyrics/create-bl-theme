// ---------------------------------------------------------------------------
// Just enough CSS reading for migrate: rules with the at-rules around them, and
// selectors taken apart far enough to say which lines they pick and which of
// two wins the cascade.
// ---------------------------------------------------------------------------

const UNCONDITIONAL_AT_RULE = /^@(?:layer\b|media\s+(?:all|screen)$)/i;
const NOT_STYLE_RULES = /^@(?:-[\w-]+-)?(?:keyframes|font-face|property|page|counter-style|font-feature-values)\b/i;

/**
 * Style rules in order: { selector, conditional, conditions, declarations: [name, value, important][] },
 * `conditions` being the heads of the conditional at-rules around the rule (`@media (…)`).
 */
export function parseRules(css) {
  const text = blankComments(css);
  const rules = [];

  function read(start, parent, conditions, record) {
    const own = [];
    if (parent && record) rules.push({ selector: parent, conditional: conditions.length > 0, conditions, declarations: own });
    let from = start;
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (ch === "\\") i++;
      else if (ch === '"' || ch === "'") i = endOfString(text, i);
      else if (ch === "(" || ch === "[") depth++;
      else if ((ch === ")" || ch === "]") && depth > 0) depth--;
      else if (depth > 0) continue;
      else if (ch === ";") {
        addDeclaration(own, text.slice(from, i));
        from = i + 1;
      } else if (ch === "}") {
        addDeclaration(own, text.slice(from, i));
        return i + 1;
      } else if (ch === "{") {
        const head = text.slice(from, i).trim().replace(/\s+/g, " ");
        if (head.startsWith("@")) {
          i = read(i + 1, parent, UNCONDITIONAL_AT_RULE.test(head) ? conditions : [...conditions, head], record && !NOT_STYLE_RULES.test(head)) - 1;
        } else {
          i = read(i + 1, parent ? nest(parent, head) : head, conditions, record) - 1;
        }
        from = i + 1;
      }
    }
    addDeclaration(own, text.slice(from));
    return text.length;
  }

  read(0, "", [], true);
  return rules.filter((rule) => rule.declarations.length > 0);
}

/**
 * The `@keyframes` in `css` by name, the last of each wherever it is: a list of
 * { selector, declarations } with the stops (`0%`, `from`, `0%, 100%`) as selectors.
 */
export function parseKeyframes(css) {
  const text = blankComments(css);
  const out = new Map();
  for (const m of text.matchAll(/@(?:-[\w-]+-)?keyframes\s+([^\s{]+)\s*\{/gi)) {
    const start = m.index + m[0].length;
    let depth = 1;
    let end = start;
    for (; end < text.length && depth > 0; end++) {
      const ch = text[end];
      if (ch === "\\") end++;
      else if (ch === '"' || ch === "'") end = endOfString(text, end);
      else if (ch === "{") depth++;
      else if (ch === "}") depth--;
    }
    out.set(m[1].replace(/^["']|["']$/g, ""), parseRules(text.slice(start, end - 1)));
  }
  return out;
}

function nest(parent, head) {
  const outer = splitTopLevel(parent, ",");
  return splitTopLevel(head, ",")
    .flatMap((inner) => outer.map((p) => (inner.includes("&") ? inner.trim().replaceAll("&", p.trim()) : `${p.trim()} ${inner.trim()}`)))
    .join(", ");
}

function addDeclaration(list, text) {
  const colon = text.indexOf(":");
  if (colon < 0) return;
  let name = text.slice(0, colon).trim();
  if (!/^-{0,2}[a-z_][\w-]*$/i.test(name)) return;
  if (!name.startsWith("--")) name = name.toLowerCase();
  const value = text.slice(colon + 1).trim();
  const bare = value.replace(/\s*!\s*important$/i, "");
  list.push([name, bare, bare !== value]);
}

function endOfString(text, start) {
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === text[start] || text[i] === "\n") return i;
  }
  return text.length;
}

/** `css` with its comments turned to spaces, so offsets and lines stay put. */
export function blankComments(css) {
  return css.replace(/"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|\/\*[\s\S]*?\*\//g, (found) =>
    found.startsWith("/*") ? found.replace(/[^\n]/g, " ") : found
  );
}

export function splitTopLevel(text, separator) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\") i++;
    else if (ch === '"' || ch === "'") i = endOfString(text, i);
    else if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (ch === separator && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out;
}

/** The compounds of a complex selector, each with the combinator before it (`""` for none). */
export function compounds(selector) {
  const out = [];
  let combinator = "";
  let current = "";
  let depth = 0;
  const flush = () => {
    if (!current) return;
    out.push({ combinator, compound: current });
    current = "";
    combinator = " ";
  };
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];
    if (ch === '"' || ch === "'") {
      const end = endOfString(selector, i);
      current += selector.slice(i, end + 1);
      i = end;
    } else if (ch === "\\") {
      current += selector.slice(i, i + 2);
      i++;
    } else if (depth === 0 && (ch === ">" || ch === "+" || ch === "~")) {
      flush();
      combinator = ch;
    } else if (depth === 0 && /\s/.test(ch)) {
      flush();
    } else {
      if (ch === "(" || ch === "[") depth++;
      if (ch === ")" || ch === "]") depth--;
      current += ch;
    }
  }
  flush();
  return out;
}

/** The simple selectors of a compound: `div`, `.a`, `[b]`, `:not(.c)`. */
export function simples(compound) {
  const out = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i < compound.length; i++) {
    const ch = compound[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      i = endOfString(compound, i);
      continue;
    }
    if (depth === 0 && i > start && ".#[:".includes(ch) && !(ch === ":" && compound.slice(start, i) === ":")) {
      out.push(compound.slice(start, i));
      start = i;
    }
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth--;
  }
  if (start < compound.length) out.push(compound.slice(start));
  return out;
}

/** The arguments of a functional pseudo-class called `name`, or null. */
export function argumentsOf(simple, name) {
  const open = `:${name}(`;
  if (!simple.startsWith(open) || !simple.endsWith(")")) return null;
  return splitTopLevel(simple.slice(open.length, -1), ",").map((arg) => arg.trim());
}

/** Each alternative of the `:is()` and `:where()` that stand outside other parentheses, in place. */
export function expandIs(selector, depth = 0) {
  const parts = compounds(selector);
  if (depth > 6) return [selector];
  for (let p = 0; p < parts.length; p++) {
    const own = simples(parts[p].compound);
    for (let s = 0; s < own.length; s++) {
      const args = argumentsOf(own[s], "is") ?? argumentsOf(own[s], "where");
      if (!args) continue;
      const others = own.filter((_, i) => i !== s);
      // An alternative with combinators can only stand in for a whole compound.
      if (others.length > 0 && args.some((arg) => compounds(arg).length > 1)) return [selector];
      return args.flatMap((arg) => {
        // A type selector has to come first in its compound.
        const compound = /^[a-z*]/i.test(arg) ? [arg, ...others].join("") : [...others, arg].join("");
        const next = parts.map((part, i) => `${part.combinator} ${i === p ? compound : part.compound}`.trim()).join(" ");
        return expandIs(next, depth + 1);
      });
    }
  }
  return [selector];
}

/** [ids, classes, attributes and pseudo-classes, types and pseudo-elements]. */
export function specificity(selector) {
  const total = [0, 0, 0];
  for (const { compound } of compounds(selector)) {
    for (const simple of simples(compound)) {
      if (simple.startsWith(":where(") || simple === "*") continue;
      const args = argumentsOf(simple, "is") ?? argumentsOf(simple, "not") ?? argumentsOf(simple, "has");
      if (args) {
        const most = args.map(specificity).sort((a, b) => compareSpecificity(b, a))[0] ?? [0, 0, 0];
        for (let i = 0; i < 3; i++) total[i] += most[i];
      } else if (simple.startsWith("#")) total[0]++;
      else if (simple.startsWith("::")) total[2]++;
      else if (".[:".includes(simple[0])) total[1]++;
      else total[2]++;
    }
  }
  return total;
}

export function compareSpecificity(a, b) {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}
