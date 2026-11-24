// shuagent-site: a faster drop-in for makefun-site 1.0.0, byte-identical on every case.
//
// run(input) is one build: { site, templates, files } -> { <output path>: <text> }. It reads no clock, no environment,
// no randomness and no file: the output is a function of the input alone, and nothing is kept from one run to the next.
//
// The rules are makefun-site's own (README.md), re-stated here as fast code: front matter, template dialect, the
// Markdown subset, the slug rule and the report. Where this file and makefun-site's code differ, makefun-site's answer
// is the answer, so every rule below is written to reproduce it exactly.

// ================================================================ text rules

const AMP = '&amp;';
const LT = '&lt;';
const GT = '&gt;';
const QUOT = '&quot;';
const APOS = '&#39;';

/** `text` with & < > " and ' escaped. Zero-copy when the text holds none of them. */
export function escapeHtml(text) {
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text.charCodeAt(i);
    if (c === 38 || c === 60 || c === 62 || c === 34 || c === 39) break;
    i++;
  }
  if (i === n) return text;
  let out = text.slice(0, i);
  let last = i;
  while (i < n) {
    const c = text.charCodeAt(i);
    let rep;
    if (c === 38) rep = AMP;
    else if (c === 60) rep = LT;
    else if (c === 62) rep = GT;
    else if (c === 34) rep = QUOT;
    else if (c === 39) rep = APOS;
    else {
      i++;
      continue;
    }
    out += text.slice(last, i) + rep;
    i++;
    last = i;
  }
  return last >= n ? out : out + text.slice(last);
}

const SLUG_MAX = 64;

/**
 * The slug of `text`: NFKD, its combining marks dropped, A-Z lowered, every run of characters other than a-z and 0-9
 * one "-", none at either end, at most SLUG_MAX characters (a "-" left at the cut dropped), "untitled" when nothing
 * is left. Pure ASCII text takes a fast path that skips NFKD (NFKD leaves ASCII alone and ASCII has no marks).
 */
export function slugify(text) {
  const n = text.length;
  let plain;
  let ascii = true;
  for (let i = 0; i < n; i++) {
    if (text.charCodeAt(i) > 127) {
      ascii = false;
      break;
    }
  }
  if (ascii) plain = text;
  else plain = text.normalize('NFKD').replace(/\p{M}/gu, '');
  let out = '';
  let gap = false;
  // walk code points, as for..of over `plain` does
  for (let i = 0; i < plain.length; i++) {
    let c = plain.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const lo = plain.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        // a surrogate pair: never a-z, a digit or A-Z
        i++;
        gap = out.length > 0;
        continue;
      }
    }
    let keep = -1;
    if (c >= 65 && c <= 90) keep = c + 32;
    else if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) keep = c;
    if (keep === -1) {
      gap = out.length > 0;
      continue;
    }
    if (gap) out += '-';
    gap = false;
    out += String.fromCharCode(keep);
  }
  if (out.length > SLUG_MAX) {
    out = out.slice(0, SLUG_MAX);
    let e = out.length;
    while (e > 0 && out.charCodeAt(e - 1) === 45) e--;
    out = e === out.length ? out : out.slice(0, e);
  }
  return out === '' ? 'untitled' : out;
}

/** `slug` made unique against `taken` (and added to it): the first of slug, slug-2, slug-3 ... not taken. */
export function uniqueSlug(slug, taken) {
  let out = slug;
  for (let n = 2; taken.has(out); n++) out = `${slug}-${n}`;
  taken.add(out);
  return out;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A YYYY-MM-DD date in words, from the string alone: "2026-11-09" is "9 November 2026". */
export function longDate(date) {
  const y = (date.charCodeAt(0) - 48) * 1000 + (date.charCodeAt(1) - 48) * 100 + (date.charCodeAt(2) - 48) * 10 + (date.charCodeAt(3) - 48);
  const m = (date.charCodeAt(5) - 48) * 10 + (date.charCodeAt(6) - 48);
  const d = (date.charCodeAt(8) - 48) * 10 + (date.charCodeAt(9) - 48);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

// ================================================================ whitespace (JavaScript's \s)

/** Whether `c` is one of the characters JavaScript's \s matches. */
function isSpaceCode(c) {
  if (c === 32 || (c >= 9 && c <= 13)) return true;
  if (c < 128) return false;
  return c === 0xa0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff;
}

/** The words of a body: its runs of characters other than whitespace (what text.match(/\S+/g) counts). */
export function wordsOf(text) {
  const n = text.length;
  let count = 0;
  let inWord = false;
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);
    const sp = c === 32 || (c >= 9 && c <= 13) ? true : c < 128 ? false : isSpaceCode(c);
    if (sp) inWord = false;
    else if (!inWord) {
      inWord = true;
      count++;
    }
  }
  return count;
}

// ================================================================ front matter

const KEYS = ['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary'];

/** Whether a code unit is a letter (a URL's first character: [A-Za-z]). */
const A2Z = new Uint8Array(128);
for (let c = 65; c <= 90; c++) A2Z[c] = 1;
for (let c = 97; c <= 122; c++) A2Z[c] = 1;
/** Whether a code unit may follow the first of a URL's scheme: [A-Za-z0-9+.-]. */
const SCHEME = new Uint8Array(128);
for (let c = 65; c <= 90; c++) SCHEME[c] = 1;
for (let c = 97; c <= 122; c++) SCHEME[c] = 1;
for (let c = 48; c <= 57; c++) SCHEME[c] = 1;
for (const ch of '+.-') SCHEME[ch.charCodeAt(0)] = 1;

/** The days of month `m` (1-12) of year `y`, by the Gregorian rule. */
function daysIn(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

const isLowerCode = (c) => c >= 97 && c <= 122;
const isDigitCode = (c) => c >= 48 && c <= 57;

/** A string value: "..." with \" and \\ its only escapes, or bare, the rest of the line (never opening on " or [). */
function stringOf(raw) {
  const n = raw.length;
  if (raw.charCodeAt(0) === 34) {
    if (n < 2 || raw.charCodeAt(n - 1) !== 34) return { error: 'a quoted string is not closed' };
    let out = '';
    let last = 1;
    for (let i = 1; i < n - 1; i++) {
      const c = raw.charCodeAt(i);
      if (c === 92) {
        const nx = raw[i + 1];
        if ((nx !== '"' && nx !== '\\') || i + 1 === n - 1) return { error: 'a quoted string holds an escape other than \\" or \\\\' };
        out += raw.slice(last, i) + nx;
        i++;
        last = i + 1;
      } else if (c === 34) return { error: 'a quoted string holds a stray quote' };
    }
    out += raw.slice(last, n - 1);
    return { value: out };
  }
  if (raw.charCodeAt(0) === 91) return { error: 'a bare string opens on [' };
  return { value: raw };
}

/** Whether `s` is a name (a-z, 0-9 and -): the layout rule. */
function isName(s) {
  const n = s.length;
  if (n === 0) return false;
  for (let i = 0; i < n; i++) {
    const c = s.charCodeAt(i);
    if (!(isLowerCode(c) || isDigitCode(c) || c === 45)) return false;
  }
  return true;
}

/** Whether `s` is a slug (a-z and 0-9, single - between), at most 64 characters. */
function isSlug(s) {
  const n = s.length;
  if (n === 0 || n > 64) return false;
  let prevDash = true;
  for (let i = 0; i < n; i++) {
    const c = s.charCodeAt(i);
    if (c === 45) {
      if (prevDash) return false;
      prevDash = true;
    } else if (isLowerCode(c) || isDigitCode(c)) prevDash = false;
    else return false;
  }
  return !prevDash;
}

const TAG_BAD = 'key "tags": an empty tag, or one holding " [ or ]';

/** One key's value, or why it is refused. */
function valueOf(key, raw) {
  switch (key) {
    case 'title':
    case 'summary': {
      const s = stringOf(raw);
      return s.error !== undefined ? { error: `key "${key}": ${s.error}` } : s;
    }
    case 'date': {
      const n = raw.length;
      let ok = n === 10 && raw.charCodeAt(4) === 45 && raw.charCodeAt(7) === 45;
      if (ok) {
        for (let i = 0; i < 10; i++) {
          if (i === 4 || i === 7) continue;
          if (!isDigitCode(raw.charCodeAt(i))) {
            ok = false;
            break;
          }
        }
      }
      if (ok) {
        const y = (raw.charCodeAt(0) - 48) * 1000 + (raw.charCodeAt(1) - 48) * 100 + (raw.charCodeAt(2) - 48) * 10 + (raw.charCodeAt(3) - 48);
        const mo = (raw.charCodeAt(5) - 48) * 10 + (raw.charCodeAt(6) - 48);
        const d = (raw.charCodeAt(8) - 48) * 10 + (raw.charCodeAt(9) - 48);
        if (y >= 1970 && y <= 2099 && mo >= 1 && mo <= 12 && d >= 1 && d <= daysIn(y, mo)) return { value: raw };
      }
      return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
    }
    case 'tags': {
      const n = raw.length;
      if (n < 2 || raw.charCodeAt(0) !== 91 || raw.charCodeAt(n - 1) !== 93) return { error: 'key "tags": not a list [a, b]' };
      const inner = raw.slice(1, -1);
      if (inner.trim() === '') return { value: [] };
      const parts = inner.split(',');
      const tags = new Array(parts.length);
      for (let i = 0; i < parts.length; i++) {
        const t = parts[i].trim();
        if (t === '') return { error: TAG_BAD };
        for (let j = 0; j < t.length; j++) {
          const c = t.charCodeAt(j);
          if (c === 34 || c === 91 || c === 93) return { error: TAG_BAD };
        }
        tags[i] = t;
      }
      return { value: tags };
    }
    case 'draft':
      return raw === 'true' ? { value: true } : raw === 'false' ? { value: false } : { error: 'key "draft": true or false' };
    case 'layout':
      return isName(raw) ? { value: raw } : { error: 'key "layout": not a template name' };
    case 'slug':
      return isSlug(raw) ? { value: raw } : { error: 'key "slug": not a slug' };
    default:
      return { error: `unknown key "${key}"` };
  }
}

/** "\r\n" and lone "\r" made "\n" (zero-copy when there is no "\r"). */
export function normalizeNewlines(text) {
  if (text.indexOf('\r') === -1) return text;
  return text.replace(/\r\n?/g, '\n');
}

/**
 * A source's front matter and body: { data, body }, or { error } with the first reason it is refused. `text` has "\n"
 * line ends.
 */
export function parseFrontMatter(text) {
  const n = text.length;
  const e0 = text.indexOf('\n');
  const line0End = e0 === -1 ? n : e0;
  if (!(line0End === 3 && text.charCodeAt(0) === 45 && text.charCodeAt(1) === 45 && text.charCodeAt(2) === 45)) return { error: 'no front matter' };
  if (e0 === -1) return { error: 'the front matter is not closed' };
  const starts = [];
  let closeStart = -1;
  let ls = 4;
  while (ls <= n) {
    const nl = text.indexOf('\n', ls);
    const le = nl === -1 ? n : nl;
    if (le - ls === 3 && text.charCodeAt(ls) === 45 && text.charCodeAt(ls + 1) === 45 && text.charCodeAt(ls + 2) === 45) {
      closeStart = ls;
      break;
    }
    starts.push(ls);
    if (nl === -1) break;
    ls = nl + 1;
  }
  if (closeStart === -1) return { error: 'the front matter is not closed' };
  const data = {};
  const count = starts.length;
  for (let k = 0; k < count; k++) {
    const s = starts[k];
    let le = text.indexOf('\n', s);
    if (le === -1) le = n;
    let blank = true;
    for (let i = s; i < le; i++) {
      const c = text.charCodeAt(i);
      if (c !== 32 && c !== 9) {
        blank = false;
        break;
      }
    }
    if (blank) continue;
    if (text.charCodeAt(s) === 35) continue;
    let i = s;
    while (i < le) {
      const c = text.charCodeAt(i);
      if (isLowerCode(c) || c === 95) i++;
      else break;
    }
    if (i === s || i >= le || text.charCodeAt(i) !== 58) return { error: `line ${k + 2} is not "key: value"` };
    const key = text.slice(s, i);
    let raw = '';
    if (i + 1 < le) {
      if (text.charCodeAt(i + 1) !== 32) return { error: `line ${k + 2} is not "key: value"` };
      let vs = i + 2;
      let ve = le;
      while (ve > vs) {
        const c = text.charCodeAt(ve - 1);
        if (c === 32 || c === 9) ve--;
        else break;
      }
      raw = text.slice(vs, ve);
    }
    if (KEYS.indexOf(key) === -1) return { error: `unknown key "${key}"` };
    if (Object.hasOwn(data, key)) return { error: `key "${key}" is given twice` };
    if (raw === '') return { error: `key "${key}" has no value` };
    const v = valueOf(key, raw);
    if (v.error !== undefined) return { error: v.error };
    data[key] = v.value;
  }
  if (!Object.hasOwn(data, 'title')) return { error: 'no title' };
  const bodyStart = closeStart + 3 < n ? closeStart + 4 : n;
  return { data, body: bodyStart >= n ? '' : text.slice(bodyStart) };
}

// ================================================================ markdown

/** Whether `line` is blank: spaces and tabs only. */
/** Whether `line` is a blank line: spaces and tabs only. A line with any other character is never blank. */
function isBlankLine(line) {
  const n = line.length;
  for (let i = 0; i < n; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

/** `s` with spaces and tabs dropped at both ends. */
function trimSt(s) {
  let a = 0;
  let b = s.length;
  while (a < b) {
    const c = s.charCodeAt(a);
    if (c === 32 || c === 9) a++;
    else break;
  }
  while (b > a) {
    const c = s.charCodeAt(b - 1);
    if (c === 32 || c === 9) b--;
    else break;
  }
  return a === 0 && b === s.length ? s : s.slice(a, b);
}

/** `src` from `start` to `end` with spaces and tabs dropped at both ends: one slice, and none at all when the range
 * is already trimmed (the line is not copied out of `src` first, so a trimmed line costs only its own string). */
function trimRange(src, start, end) {
  let a = start;
  let b = end;
  while (a < b) {
    const c = src.charCodeAt(a);
    if (c === 32 || c === 9) a++;
    else break;
  }
  while (b > a) {
    const c = src.charCodeAt(b - 1);
    if (c === 32 || c === 9) b--;
    else break;
  }
  return src.slice(a, b);
}

/** A heading line's depth and text, or null (a heading's text is never empty). */
function headingOf(line) {
  const n = line.length;
  let i = 0;
  while (i < n && line.charCodeAt(i) === 35) i++;
  if (i === 0 || i > 6 || i >= n) return null;
  const c = line.charCodeAt(i);
  if (c !== 32 && c !== 9) return null;
  let a = i;
  while (a < n) {
    const cc = line.charCodeAt(a);
    if (cc === 32 || cc === 9) a++;
    else break;
  }
  if (a >= n) return null;
  let b = n;
  while (b > a) {
    const cc = line.charCodeAt(b - 1);
    if (cc === 32 || cc === 9) b--;
    else break;
  }
  if (b <= a) return null;
  return { depth: i, text: a === 0 && b === n ? line : line.slice(a, b) };
}

/** A fence open line's language, or null when the line is not a fence open. */
function fenceOpenOf(line) {
  const n = line.length;
  if (n < 3) return null;
  if (!(line.charCodeAt(0) === 96 && line.charCodeAt(1) === 96 && line.charCodeAt(2) === 96)) return null;
  let i = 3;
  while (i < n) {
    const c = line.charCodeAt(i);
    if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 43 || c === 45) i++;
    else break;
  }
  const lang = line.slice(3, i);
  while (i < n) {
    const c = line.charCodeAt(i);
    if (c === 32 || c === 9) i++;
    else return null;
  }
  return lang;
}

/** Whether `line` closes a fence: three backticks then spaces or tabs only. */
function isFenceClose(line) {
  const n = line.length;
  if (n < 3) return false;
  if (!(line.charCodeAt(0) === 96 && line.charCodeAt(1) === 96 && line.charCodeAt(2) === 96)) return false;
  for (let i = 3; i < n; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

/** Whether `line` is a thematic break: "---" or "***" then spaces or tabs only. */
function isHr(line) {
  const n = line.length;
  if (n < 3) return false;
  const c0 = line.charCodeAt(0);
  const ok = (c0 === 45 && line.charCodeAt(1) === 45 && line.charCodeAt(2) === 45) || (c0 === 42 && line.charCodeAt(1) === 42 && line.charCodeAt(2) === 42);
  if (!ok) return false;
  for (let i = 3; i < n; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

/** Whether `line` opens a blockquote. */
const isQuoteLine = (line) => line.length > 0 && line.charCodeAt(0) === 62;

/** A bullet item's text, or null. */
function bulletOf(line) {
  const n = line.length;
  if (n < 2) return null;
  const c0 = line.charCodeAt(0);
  if (!((c0 === 45 || c0 === 42) && line.charCodeAt(1) === 32)) return null;
  return line.slice(2);
}

/** An ordered item's start number and text, or null. */
function orderedOf(line) {
  const n = line.length;
  let i = 0;
  while (i < n && i < 9) {
    const c = line.charCodeAt(i);
    if (c >= 48 && c <= 57) i++;
    else break;
  }
  if (i === 0) return null;
  if (i + 1 >= n) return null;
  if (!(line.charCodeAt(i) === 46 && line.charCodeAt(i + 1) === 32)) return null;
  let num = 0;
  for (let k = 0; k < i; k++) num = num * 10 + (line.charCodeAt(k) - 48);
  return { num, text: line.slice(i + 2) };
}

/** Whether `line` continues a list item: two or more spaces then a non-space. */
function isContinued(line) {
  const n = line.length;
  if (n < 3 || line.charCodeAt(0) !== 32 || line.charCodeAt(1) !== 32) return false;
  let j = 2;
  while (j < n && line.charCodeAt(j) === 32) j++;
  if (j >= n) return false;
  return !isSpaceCode(line.charCodeAt(j));
}

/**
 * Whether `line` ends a paragraph: blank, a fence, a heading or a thematic break. Each of those starts
 * with one of three characters, so a line that starts with any other one is answered by its first
 * character alone.
 */
function endsParagraph(line) {
  const c = line.charCodeAt(0);
  if (c !== 35 && c !== 96 && c !== 45 && c !== 42) return isBlankLine(line);
  return isBlankLine(line) || fenceOpenOf(line) !== null || headingOf(line) !== null || isHr(line);
}

// ESCAPABLE: \ ` * _ [ ] ( ) # + - . ! >
const ESCAPABLE = new Uint8Array(128);
for (const ch of '\\`*_[]()#+-.!>') ESCAPABLE[ch.charCodeAt(0)] = 1;
const escAt = (c) => c < 128 && ESCAPABLE[c] === 1;

/** The first index from `from` where `s` holds `]` outside a backslash escape, or -1. */
function findUnescapedBracket(s, from) {
  const n = s.length;
  for (let j = from; j < n; j++) {
    const c = s.charCodeAt(j);
    if (c === 92 && j + 1 < n && escAt(s.charCodeAt(j + 1))) {
      j++;
      continue;
    }
    if (c === 93) return j;
  }
  return -1;
}

/** The first index from `from` where `s` holds `**` outside a backslash escape, or -1. */
function findUnescaped2(s, from) {
  const n = s.length;
  for (let j = from; j <= n - 2; j++) {
    const c = s.charCodeAt(j);
    if (c === 92 && j + 1 < n && escAt(s.charCodeAt(j + 1))) {
      j++;
      continue;
    }
    if (c === 42 && s.charCodeAt(j + 1) === 42) return j;
  }
  return -1;
}

/** The first single * from `from` (one whose run is not **), outside an escape, or -1. */
function findSingleStar(s, from) {
  const n = s.length;
  for (let j = from; j < n; j++) {
    const c = s.charCodeAt(j);
    if (c === 92 && j + 1 < n && escAt(s.charCodeAt(j + 1))) {
      j++;
      continue;
    }
    if (c !== 42) continue;
    if (s.charCodeAt(j + 1) === 42) {
      j++;
      continue;
    }
    return j;
  }
  return -1;
}

/** Whether `s` holds a whitespace character (what /\s/.test(s) asks). */
function hasSpace(s) {
  const n = s.length;
  for (let i = 0; i < n; i++) {
    const c = s.charCodeAt(i);
    if (c === 32 || (c >= 9 && c <= 13)) return true;
    if (c > 127 && isSpaceCode(c)) return true;
  }
  return false;
}

/** The index from `from` of the next character inline() must look at (& < > " ' \ ` * [), or -1. */
const MARKUP_RE = /[&<>"'\\`*[]/g;
function nextMarkup(s, from) {
  MARKUP_RE.lastIndex = from;
  const m = MARKUP_RE.exec(s);
  return m === null ? -1 : m.index;
}

/** The index from `from` of the next character inline() must look at, or -1. */
export function inline(s, link) {
  const n = s.length;
  let out = '';
  let i = 0;
  let last = 0;
  while (i < n) {
    // scan the plain run in one go with a native search over the characters that mean anything here
    const j = nextMarkup(s, i);
    if (j === -1) {
      if (last === 0) return escapeHtml(s);
      return out + s.slice(last);
    }
    if (j > i) {
      i = j;
      continue;
    }
    const c = s.charCodeAt(i);
    if (c === 38) {
      out += s.slice(last, i) + AMP;
      i++;
      last = i;
      continue;
    }
    if (c === 60) {
      out += s.slice(last, i) + LT;
      i++;
      last = i;
      continue;
    }
    if (c === 62) {
      out += s.slice(last, i) + GT;
      i++;
      last = i;
      continue;
    }
    if (c === 34) {
      out += s.slice(last, i) + QUOT;
      i++;
      last = i;
      continue;
    }
    if (c === 39) {
      out += s.slice(last, i) + APOS;
      i++;
      last = i;
      continue;
    }
    if (c === 92) {
      if (i + 1 < n && escAt(s.charCodeAt(i + 1))) {
        out += s.slice(last, i) + escapeHtml(s[i + 1]);
        i += 2;
        last = i;
        continue;
      }
      i++;
      continue;
    }
    if (c === 96) {
      const j = s.indexOf('`', i + 1);
      if (j > i + 1) {
        out += s.slice(last, i) + '<code>' + escapeHtml(s.slice(i + 1, j)) + '</code>';
        i = j + 1;
      } else {
        out += s.slice(last, i) + '`';
        i++;
      }
      last = i;
      continue;
    }
    if (c === 42) {
      if (s.charCodeAt(i + 1) === 42) {
        const j = findUnescaped2(s, i + 2);
        if (j > i + 2) {
          out += s.slice(last, i) + '<strong>' + inline(s.slice(i + 2, j), link) + '</strong>';
          i = j + 2;
        } else {
          out += s.slice(last, i) + '**';
          i += 2;
        }
      } else {
        const j = findSingleStar(s, i + 1);
        if (j > i + 1) {
          out += s.slice(last, i) + '<em>' + inline(s.slice(i + 1, j), link) + '</em>';
          i = j + 1;
        } else {
          out += s.slice(last, i) + '*';
          i++;
        }
      }
      last = i;
      continue;
    }
    if (c === 91) {
      const k = findUnescapedBracket(s, i + 1);
      const m = k !== -1 && s.charCodeAt(k + 1) === 40 ? s.indexOf(')', k + 2) : -1;
      const target = m === -1 ? '' : s.slice(k + 2, m);
      if (target !== '' && !hasSpace(target)) {
        out += s.slice(last, i) + '<a href="' + escapeHtml(link(target)) + '">' + inline(s.slice(i + 1, k), link) + '</a>';
        i = m + 1;
      } else {
        out += s.slice(last, i) + '[';
        i++;
      }
      last = i;
      continue;
    }
    i++;
  }
  return last === 0 ? escapeHtml(s) : last >= n ? out : out + s.slice(last);
}

/** Whether `src` from `start` to `end` is blank: spaces and tabs only. */
function isBlankRange(src, start, end) {
  for (let i = start; i < end; i++) {
    const c = src.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

/**
 * `src` rendered: its HTML (each block on its own lines, a "\n" after the last), its table of contents (every level 2
 * and 3 heading: level, id and its inline HTML) and its excerpt (the first paragraph's inline HTML, or "").
 */
export function renderMarkdown(src, link) {
  const ids = new Set();
  const toc = [];
  let html = '';
  let excerpt = null;
  const n = src.length;
  let pos = 0;
  while (pos <= n) {
    let end = src.indexOf('\n', pos);
    if (end === -1) end = n;
    const line = src.slice(pos, end);
    pos = end + 1;
    if (isBlankLine(line)) continue;
    const lang = fenceOpenOf(line);
    if (lang !== null) {
      let body = '';
      while (pos <= n) {
        let e2 = src.indexOf('\n', pos);
        if (e2 === -1) e2 = n;
        const l = src.slice(pos, e2);
        pos = e2 + 1;
        if (isFenceClose(l)) break;
        body += escapeHtml(l) + '\n';
      }
      html += `<pre><code${lang === '' ? '' : ` class="language-${escapeHtml(lang)}"`}>${body}</code></pre>\n`;
      continue;
    }
    const heading = headingOf(line);
    if (heading !== null) {
      const id = uniqueSlug(slugify(heading.text), ids);
      const h = inline(heading.text, link);
      html += `<h${heading.depth} id="${id}">${h}</h${heading.depth}>\n`;
      if (heading.depth === 2 || heading.depth === 3) toc.push({ level: heading.depth, id, html: h });
      continue;
    }
    if (isHr(line)) {
      html += '<hr>\n';
      continue;
    }
    if (isQuoteLine(line)) {
      const body = [];
      {
        const t = trimSt(line.slice(line.charCodeAt(1) === 32 ? 2 : 1));
        if (t !== '') body.push(t);
      }
      while (pos <= n) {
        let e2 = src.indexOf('\n', pos);
        if (e2 === -1) e2 = n;
        const l = src.slice(pos, e2);
        if (!isQuoteLine(l)) break;
        pos = e2 + 1;
        const t = trimSt(l.slice(l.charCodeAt(1) === 32 ? 2 : 1));
        if (t !== '') body.push(t);
      }
      html += body.length === 0 ? '<blockquote>\n</blockquote>\n' : `<blockquote>\n<p>${inline(body.join('\n'), link)}</p>\n</blockquote>\n`;
      continue;
    }
    const bullet = bulletOf(line);
    const ordered = bullet === null ? orderedOf(line) : null;
    if (bullet !== null || ordered !== null) {
      const isOrdered = ordered !== null;
      const start = isOrdered ? ordered.num : 1;
      const items = [[trimSt(isOrdered ? ordered.text : bullet)]];
      while (pos <= n) {
        let e2 = src.indexOf('\n', pos);
        if (e2 === -1) e2 = n;
        const l = src.slice(pos, e2);
        const m = isOrdered ? orderedOf(l) : bulletOf(l);
        if (m !== null) {
          items.push([trimSt(isOrdered ? m.text : m)]);
          pos = e2 + 1;
        } else if (isContinued(l)) {
          items[items.length - 1].push(trimSt(l));
          pos = e2 + 1;
        } else break;
      }
      const tag = isOrdered ? 'ol' : 'ul';
      let out = isOrdered && start !== 1 ? `<ol start="${start}">` : `<${tag}>`;
      out += '\n';
      for (let k = 0; k < items.length; k++) out += `<li>${inline(items[k].join('\n'), link)}</li>\n`;
      out += `</${tag}>`;
      html += out + '\n';
      continue;
    }
    const body = [trimSt(line)];
    while (pos <= n) {
      let e2 = src.indexOf('\n', pos);
      if (e2 === -1) e2 = n;
      // a paragraph is ended by a blank line and by a fence, a heading or a break, and those three open on one of
      // four characters: a line that opens on none of them and is not blank joins the paragraph without ever being
      // copied out of `src` to be looked at
      if (e2 > pos) {
        const c = src.charCodeAt(pos);
        if (c !== 35 && c !== 96 && c !== 45 && c !== 42 && !isBlankRange(src, pos, e2)) {
          body.push(trimRange(src, pos, e2));
          pos = e2 + 1;
          continue;
        }
      }
      const l = src.slice(pos, e2);
      // a line that cannot open a block is a paragraph line: only a blank, fence, heading or break ends one
      if (endsParagraph(l)) break;
      body.push(trimSt(l));
      pos = e2 + 1;
    }
    const h = inline(body.length === 1 ? body[0] : body.join('\n'), link);
    if (excerpt === null) excerpt = h;
    html += `<p>${h}</p>\n`;
  }
  return { html, toc, excerpt: excerpt ?? '' };
}

// ================================================================ templates

/** The deepest an include nests: one past it renders nothing. */
const INCLUDE_DEPTH = 8;

const PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const FOR_RE = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const IF_RE = /^if (not )?(\S+)$/;
const INCLUDE_RE = /^include "([a-z0-9-]+)"$/;

/** A template that does not parse: its name and why. */
export class TemplateError extends Error {}

/** The value at `path` in the scope chain: its first name from the nearest scope holding it, then own properties. */
function LK(S, name) {
  while (S !== null && !Object.hasOwn(S.vars, name)) S = S.parent;
  return S === null ? undefined : S.vars[name];
}

/** Own-property walk down `keys`. */
function prop(v, keys) {
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (v === null || typeof v !== 'object' || !Object.hasOwn(v, k)) return undefined;
    v = v[k];
  }
  return v;
}

/** A value as text: a string itself, a number in JavaScript's digits, true or false, an array's items joined by ", ", else "". */
function textOf(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.map(textOf).join(', ');
  return '';
}

/** Whether a value counts as true in an if: not undefined, null, false, "", 0 or an empty array. */
function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
}

/** `src`'s tokens: text, {{ }}, {{{ }}} and {% %}, a standalone tag's line taken with it. */
function tokenize(name, src) {
  const tokens = [];
  let text = '';
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1 || open === src.length - 1) {
      text += src.slice(i);
      break;
    }
    const next = src[open + 1];
    if (next !== '{' && next !== '%') {
      text += src.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    text += src.slice(i, open);
    if (next === '{') {
      const raw = src[open + 2] === '{';
      const close = src.indexOf(raw ? '}}}' : '}}', open + (raw ? 3 : 2));
      if (close === -1) throw new TemplateError(`template "${name}": a ${raw ? '{{{' : '{{'} is not closed`);
      if (text !== '') tokens.push({ t: 'text', text });
      text = '';
      tokens.push({ t: raw ? 'raw' : 'var', path: pathOf(name, src.slice(open + (raw ? 3 : 2), close).trim()) });
      i = close + (raw ? 3 : 2);
      continue;
    }
    const close = src.indexOf('%}', open + 2);
    if (close === -1) throw new TemplateError(`template "${name}": a {% is not closed`);
    const end = close + 2;
    const lineStart = src.lastIndexOf('\n', open - 1) + 1;
    const nl = src.indexOf('\n', end);
    const lineEnd = nl === -1 ? src.length : nl;
    const standalone = /^[ \t]*$/.test(src.slice(lineStart, open)) && /^[ \t]*$/.test(src.slice(end, lineEnd));
    if (standalone) text = text.slice(0, text.length - (open - lineStart));
    if (text !== '') tokens.push({ t: 'text', text });
    text = '';
    tokens.push({ t: 'tag', tag: src.slice(open + 2, close).trim() });
    i = standalone ? (nl === -1 ? src.length : nl + 1) : end;
  }
  if (text !== '') tokens.push({ t: 'text', text });
  return tokens;
}

/** The path `text` names, split at its dots, or a TemplateError. */
function pathOf(name, text) {
  if (!PATH_RE.test(text)) throw new TemplateError(`template "${name}": ${JSON.stringify(text)} is not a path`);
  return text.split('.');
}

/** `src` parsed into its tree of nodes (a TemplateError when it does not parse). */
export function parseTemplate(name, src) {
  const root = { kind: 'root', body: [] };
  const stack = [root];
  let body = root.body;
  for (const tok of tokenize(name, src)) {
    if (tok.t === 'text') body.push({ kind: 'text', text: tok.text });
    else if (tok.t === 'var' || tok.t === 'raw') body.push({ kind: tok.t, path: tok.path });
    else {
      const tag = tok.tag;
      const top = stack[stack.length - 1];
      let m;
      if ((m = FOR_RE.exec(tag)) !== null) {
        const node = { kind: 'for', name: m[1], path: pathOf(name, m[2]), body: [] };
        body.push(node);
        stack.push(node);
        body = node.body;
      } else if ((m = IF_RE.exec(tag)) !== null) {
        const node = { kind: 'if', not: m[1] !== undefined, path: pathOf(name, m[2]), then: [], else: null };
        body.push(node);
        stack.push(node);
        body = node.then;
      } else if (tag === 'else') {
        if (top.kind !== 'if' || top.else !== null) throw new TemplateError(`template "${name}": an else outside an if`);
        top.else = [];
        body = top.else;
      } else if (tag === 'endfor' || tag === 'endif') {
        if (top.kind !== (tag === 'endfor' ? 'for' : 'if')) throw new TemplateError(`template "${name}": an ${tag} with no open ${tag.slice(3)}`);
        stack.pop();
        const parent = stack[stack.length - 1];
        body = parent.kind === 'root' ? parent.body : parent.kind === 'for' ? parent.body : parent.else ?? parent.then;
      } else if ((m = INCLUDE_RE.exec(tag)) !== null) body.push({ kind: 'include', name: m[1] });
      else throw new TemplateError(`template "${name}": {% ${tag} %} is not a tag`);
    }
  }
  if (stack.length > 1) throw new TemplateError(`template "${name}": a ${stack[stack.length - 1].kind} is not closed`);
  return root.body;
}

/** The helpers a compiled template body may reach. */
function helpers() {
  return { esc: escapeHtml, textOf, truthy, prop, LK, T: [], K: [] };
}

/** One template's nodes as JavaScript source rendering into `out`, reading its scope from `${scope}`. */
function compileBody(nodes, ctx, depth, scope) {
  let code = '';
  for (const node of nodes) {
    switch (node.kind) {
      case 'text':
        code += `out+=${JSON.stringify(node.text)};`;
        break;
      case 'var':
        code += `out+=H.esc(H.textOf(${compilePath(node.path, ctx, scope)}));`;
        break;
      case 'raw':
        code += `out+=H.textOf(${compilePath(node.path, ctx, scope)});`;
        break;
      case 'if': {
        // an if that fixed values alone decide is decided here, and only its taken branch is compiled
        if (ctx.fold && ctx.locals.length === 0 && isFixedNodes([node], ctx.fixedNames, EMPTY_BOUND)) {
          code += `out+=${JSON.stringify(renderFixed([node], ctx.fixedVars))};`;
          break;
        }
        const c = compilePath(node.path, ctx, scope);
        const then = compileBody(node.then, ctx, depth, scope);
        const els = node.else === null ? '' : `else{${compileBody(node.else, ctx, depth, scope)}}`;
        code += node.not ? `if(!H.truthy(${c})){${then}}${els}` : `if(H.truthy(${c})){${then}}${els}`;
        break;
      }
      case 'for': {
        // likewise: a for that fixed values alone decide renders here, and its text is inlined
        if (ctx.fold && ctx.locals.length === 0 && isFixedNodes([node], ctx.fixedNames, EMPTY_BOUND)) {
          code += `out+=${JSON.stringify(renderFixed([node], ctx.fixedVars))};`;
          break;
        }
        const d = ctx.depth++;
        const v = `v${d}`;
        const xs = `xs${d}`;
        const nx = `n${d}`;
        const k = `k${d}`;
        const frame = `f${d}`;
        const needsFrame = hasInclude(node.body);
        const binds = needsFrame || usesLoop(node.body);
        const loopVar = `loop${d}`;
        ctx.locals.push({ name: node.name, js: v });
        if (binds) ctx.locals.push({ name: 'loop', js: loopVar });
        // an include renders in the same scope: the loop's own frame (with the binding and loop) is passed down
        const innerScope = needsFrame ? frame : scope;
        const inner = compileBody(node.body, ctx, depth, innerScope);
        if (binds) ctx.locals.pop();
        ctx.locals.pop();
        let head = `var ${v}=${xs}[${k}];`;
        if (needsFrame) {
          head += `var ${frame}={vars:{${JSON.stringify(node.name)}:${v},loop:{index:${k}+1,first:${k}===0,last:${k}===${nx}-1,length:${nx}}},parent:${scope}};`;
        } else if (binds) {
          head += `var ${loopVar}={index:${k}+1,first:${k}===0,last:${k}===${nx}-1,length:${nx}};`;
        }
        code += `{var ${xs}=${compilePath(node.path, ctx, scope)};if(Array.isArray(${xs})){var ${nx}=${xs}.length;for(var ${k}=0;${k}<${nx};${k}++){${head}${inner}}}}`;
        break;
      }
      case 'include': {
        // a fixed template's text is the same in every page only where no for of the caller binds a name it reads:
        // inside one, the loop's binding can shadow a fixed name, so the include is rendered as it is. Past the last
        // include depth an include renders nothing, as H.T does, so the literal is guarded the same way.
        const cached = ctx.locals.length === 0 ? ctx.hoist.get(node.name) : undefined;
        if (cached !== undefined) {
          code += `if(d<8)out+=${JSON.stringify(cached)};`;
          break;
        }
        const idx = ctx.index.get(node.name);
        if (idx !== undefined) code += `if(d<8)out+=H.T[${idx}](${scope},d+1);`;
        break;
      }
    }
  }
  return code;
}

/**
 * Whether `nodes` read only `fixed` names (so their text is the same in every page), given the `bound` names a
 * surrounding for binds. `include` is not free: a template it names is looked at by the caller.
 */
function isFixedNodes(nodes, fixedNames, bound) {
  for (const node of nodes) {
    switch (node.kind) {
      case 'text':
        break;
      case 'var':
      case 'raw':
        if (!bound.has(node.path[0]) && !fixedNames.has(node.path[0])) return false;
        break;
      case 'if':
        if (!bound.has(node.path[0]) && !fixedNames.has(node.path[0])) return false;
        if (!isFixedNodes(node.then, fixedNames, bound)) return false;
        if (node.else !== null && !isFixedNodes(node.else, fixedNames, bound)) return false;
        break;
      case 'for': {
        if (!bound.has(node.path[0]) && !fixedNames.has(node.path[0])) return false;
        const inner = new Set(bound);
        inner.add(node.name);
        inner.add('loop');
        if (!isFixedNodes(node.body, fixedNames, inner)) return false;
        break;
      }
      case 'include':
        return false;
      default:
        break;
    }
  }
  return true;
}
function analyzeFree(nodes, bound, acc) {
  for (const node of nodes) {
    switch (node.kind) {
      case 'var':
      case 'raw':
        if (!bound.has(node.path[0])) acc.names.add(node.path[0]);
        break;
      case 'if':
        if (!bound.has(node.path[0])) acc.names.add(node.path[0]);
        analyzeFree(node.then, bound, acc);
        if (node.else !== null) analyzeFree(node.else, bound, acc);
        break;
      case 'for': {
        if (!bound.has(node.path[0])) acc.names.add(node.path[0]);
        const inner = new Set(bound);
        inner.add(node.name);
        inner.add('loop');
        analyzeFree(node.body, inner, acc);
        break;
      }
      case 'include':
        acc.includes.add(node.name);
        break;
      default:
        break;
    }
  }
}

/** Whether `nodes` hold an include anywhere (through for and if). Memoised: the answer depends on `nodes` alone. */
const INC_CACHE = new WeakMap();
function hasInclude(nodes) {
  let v = INC_CACHE.get(nodes);
  if (v !== undefined) return v;
  for (const node of nodes) {
    if (node.kind === 'include') { INC_CACHE.set(nodes, true); return true; }
    if (node.kind === 'for') {
      if (hasInclude(node.body)) { INC_CACHE.set(nodes, true); return true; }
    } else if (node.kind === 'if') {
      if (hasInclude(node.then) || (node.else !== null && hasInclude(node.else))) { INC_CACHE.set(nodes, true); return true; }
    }
  }
  INC_CACHE.set(nodes, false);
  return false;
}

/** Whether `nodes` read `loop` outside a for of their own (which would bind its own). Memoised like hasInclude. */
const LOOP_CACHE = new WeakMap();
function usesLoop(nodes) {
  let v = LOOP_CACHE.get(nodes);
  if (v !== undefined) return v;
  let hit = false;
  for (const node of nodes) {
    switch (node.kind) {
      case 'var':
      case 'raw':
        if (node.path[0] === 'loop') hit = true;
        break;
      case 'if':
        if (node.path[0] === 'loop') hit = true;
        else if (usesLoop(node.then)) hit = true;
        else if (node.else !== null && usesLoop(node.else)) hit = true;
        break;
      case 'for':
        if (node.path[0] === 'loop') hit = true;
        break;
      default:
        break;
    }
    if (hit) break;
  }
  LOOP_CACHE.set(nodes, hit);
  return hit;
}

/** A path as a JavaScript expression over the locals and the scope chain. */
function compilePath(path, ctx, scope = 'S') {
  let base = null;
  for (let i = ctx.locals.length - 1; i >= 0; i--) {
    if (ctx.locals[i].name === path[0]) {
      base = ctx.locals[i].js;
      break;
    }
  }
  if (base === null) base = `H.LK(${scope},${JSON.stringify(path[0])})`;
  if (path.length === 1) return base;
  const keys = path.slice(1);
  const ks = JSON.stringify(keys);
  let kidx = ctx.keyIndex.get(ks);
  if (kidx === undefined) {
    kidx = ctx.K.length;
    ctx.K.push(keys);
    ctx.keyIndex.set(ks, kidx);
  }
  return `H.prop(${base},H.K[${kidx}])`;
}

/**
 * Every template of `ordered` (name -> nodes) compiled: an array of (S, d) -> string. `fixed` names the scope's own
 * top-level values (site, tags, recent): an include that reads none of a page's values renders the same text in every
 * page, so it is rendered once here and its text is inlined as a literal.
 */
/**
 * Every template of `ordered` (name -> nodes) compiled: an array of (scope, depth) -> string. `fixed` holds the build's
 * own top-level values (site, tags, recent): a template that reads none of a page's values renders the same text in
 * every page, so its text is rendered once (at every include depth, which must agree) and inlined as a literal.
 */
function compileTemplates(ordered, fixed) {
  const nodesOf = new Map(ordered);
  const index = new Map();
  for (let i = 0; i < ordered.length; i++) index.set(ordered[i][0], i);
  const keyIndex = new Map();
  const freeOf = new Map();
  const freeNamesOf = (name, seen) => {
    let v = freeOf.get(name);
    if (v !== undefined) return v;
    const nodes = nodesOf.get(name);
    if (nodes === undefined) return null;
    if (seen.has(name)) return EMPTY_FREE;
    const next = new Set(seen);
    next.add(name);
    const acc = { names: new Set(), includes: new Set() };
    analyzeFree(nodes, new Set(), acc);
    const out = { names: acc.names, includes: acc.includes };
    for (const inc of acc.includes) {
      const sub = freeNamesOf(inc, next);
      if (sub !== null) {
        for (const n of sub.names) out.names.add(n);
        for (const n of sub.includes) out.includes.add(n);
      }
    }
    freeOf.set(name, out);
    return out;
  };
  const fixedNames = new Set(Object.keys(fixed));
  /** Whether a template renders the same text in every page, at every include depth. */
  const isFixedText = (name) => {
    const free = freeNamesOf(name, new Set());
    if (free === null) return false;
    for (const n of free.names) if (!fixedNames.has(n)) return false;
    return true;
  };
  const compileOne = (nodes, hoist) => {
    const ctx = { locals: [], depth: 0, index, K: H.K, keyIndex, hoist, fixedNames, fixedVars: null, fold: false };
    const body = compileBody(nodes, ctx, 0, 'S');
    // eslint-disable-next-line no-new-func
    return new Function('H', `return function(S,d){var out="";${body}return out;}`)(H);
  };
  const H = helpers();
  // a stand-in function for every template index, so a render before the real ones exist sees an empty include
  while (H.T.length < ordered.length) H.T.push(() => '');
  const fixedVars = Object.create(null);
  fixedVars.site = fixed.site;
  fixedVars.tags = fixed.tags;
  fixedVars.recent = fixed.recent;
  const fixedScope = { vars: fixedVars, parent: null };
  // Only the templates that are fixed text are compiled here: a fixed template includes fixed templates alone, so
  // every include one makes is itself fixed text and is compiled in this same pass.
  const pass1 = new Array(ordered.length);
  const fixedIdx = [];
  for (let i = 0; i < ordered.length; i++) {
    if (!isFixedText(ordered[i][0])) continue;
    pass1[i] = compileOne(ordered[i][1], EMPTY_HOIST);
    H.T[i] = pass1[i];
    fixedIdx.push(i);
  }
  // its text at every include depth the render can see: INCLUDE_DEPTH itself renders nothing, so the probes cover
  // 0 through INCLUDE_DEPTH and a template whose text agrees at all of them is the same text wherever it is included
  const staticText = new Map();
  for (const i of fixedIdx) {
    const texts = [];
    for (let d = 0; d <= INCLUDE_DEPTH; d++) texts.push(pass1[i](fixedScope, d));
    let same = true;
    for (let d = 1; d < texts.length; d++) if (texts[d] !== texts[0]) { same = false; break; }
    if (same) staticText.set(ordered[i][0], texts[0]);
  }
  // pass 2: the templates that are not fixed text inline those that are, and fold the if/for subtrees only fixed
  // values decide
  const out = new Array(ordered.length);
  for (let i = 0; i < ordered.length; i++) {
    const name = ordered[i][0];
    if (staticText.has(name)) {
      out[i] = pass1[i];
      continue;
    }
    const hoist = new Map();
    for (const [n, t] of staticText) if (n !== name) hoist.set(n, t);
    const ctx = { locals: [], depth: 0, index, K: H.K, keyIndex, hoist, fixedNames, fixedVars, fold: true };
    const body = compileBody(ordered[i][1], ctx, 0, 'S');
    // eslint-disable-next-line no-new-func
    out[i] = new Function('H', `return function(S,d){var out="";${body}return out;}`)(H);
  }
  for (let i = 0; i < out.length; i++) H.T[i] = out[i];
  return out;
}

const EMPTY_FREE = { names: new Set(), includes: new Set() };
const EMPTY_BOUND = new Set();
const EMPTY_HOIST = new Map();

/**
 * A path's value in a fixed scope: a prototype chain of frames, each holding only its own bindings. The first name is
 * read from the nearest frame that holds it as an own property (never from Object.prototype), and the rest as own
 * properties down the value, as makefun-site's lookup does.
 */
function lookIn(path, vars) {
  let frame = vars;
  while (frame != null && !Object.hasOwn(frame, path[0])) frame = Object.getPrototypeOf(frame);
  let v = frame == null ? undefined : frame[path[0]];
  for (let i = 1; i < path.length; i++) {
    if (v === null || typeof v !== 'object' || !Object.hasOwn(v, path[i])) return undefined;
    v = v[path[i]];
  }
  return v;
}

/** `nodes` rendered with fixed values alone: what makefun-site's renderNodes gives for them in every page. */
function renderFixed(nodes, fixedVars) {
  let out = '';
  for (const node of nodes) {
    switch (node.kind) {
      case 'text':
        out += node.text;
        break;
      case 'var':
        out += escapeHtml(textOf(lookIn(node.path, fixedVars)));
        break;
      case 'raw':
        out += textOf(lookIn(node.path, fixedVars));
        break;
      case 'if': {
        const v = truthy(lookIn(node.path, fixedVars));
        const branch = v !== node.not ? node.then : node.else;
        if (branch !== null) out += renderFixed(branch, fixedVars);
        break;
      }
      case 'for': {
        const xs = lookIn(node.path, fixedVars);
        if (!Array.isArray(xs)) break;
        for (let k = 0; k < xs.length; k++) {
          const vars = Object.create(fixedVars);
          vars[node.name] = xs[k];
          vars.loop = { index: k + 1, first: k === 0, last: k === xs.length - 1, length: xs.length };
          out += renderFixed(node.body, vars);
        }
        break;
      }
      default:
        break;
    }
  }
  return out;
}

// ================================================================ the build

/** The report file every build writes. */
const REPORT_FILE = 'build-report.txt';

/** The top-level directories the generator writes itself, which no page's slug at the root may take. */
const RESERVED = Object.freeze(['posts', 'tags', 'page']);
const RESERVED_SET = new Set(RESERVED);

/** Code-unit order (never the locale's). */
const byCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** `rel` (a link's path, "/"-separated) from the directory `dir` of a source, or null when it climbs out of the root. */
function resolvePath(dir, rel) {
  const parts = dir === '' ? [] : dir.split('/');
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

const dirOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

/** One site's output tree: path -> text. Nothing here outlives the call. */
export function build(input) {
  const broken = new Set();
  const templatesSrc = input.templates;
  const names = Object.keys(templatesSrc).sort(byCodeUnits);
  const parsed = new Map();
  const report = [];
  for (const name of names) {
    try {
      parsed.set(name, parseTemplate(name, templatesSrc[name]));
    } catch (err) {
      if (!(err instanceof TemplateError)) throw err;
      report.push(err.message);
    }
  }
  const ordered = [...parsed.entries()];
  const index = new Map();
  for (let i = 0; i < ordered.length; i++) index.set(ordered[i][0], i);

  const base = input.site.base_url.replace(/\/+$/, '');

  // 1. the sources, in code-unit order of their paths; a source that is not .md is static
  const files = input.files.slice().sort((x, y) => byCodeUnits(x.path, y.path));
  const sources = [];
  const statics = [];
  for (const f of files) {
    if (f.path.endsWith('.md')) sources.push({ path: f.path, text: normalizeNewlines(f.content) });
    else statics.push({ path: f.path, content: f.content });
  }

  // 2. each source's front matter: a refused source is reported and dropped, and so is a draft
  const kept = [];
  for (const s of sources) {
    const fm = parseFrontMatter(s.text);
    if (fm.error !== undefined) {
      report.push(`refused ${s.path}: ${fm.error}`);
      continue;
    }
    s.data = fm.data;
    s.body = fm.body;
    s.post = s.path.startsWith('posts/');
    let own;
    if (s.path.startsWith('tags/')) own = 'tags';
    else if (s.path.startsWith('page/')) own = 'page';
    if (own !== undefined) {
      report.push(`refused ${s.path}: ${own}/ is the generator's own`);
      continue;
    }
    if (s.post && !Object.hasOwn(s.data, 'date')) {
      report.push(`refused ${s.path}: a post needs a date`);
      continue;
    }
    const layout = s.data.layout ?? (s.post ? 'post' : 'page');
    if (!parsed.has(layout)) {
      report.push(`refused ${s.path}: layout "${layout}" is no template that parses`);
      continue;
    }
    s.layout = layout;
    if (s.data.draft === true) {
      report.push(`draft ${s.path}`);
      continue;
    }
    kept.push(s);
  }
  sources.length = 0;

  // 3. each page's output directory and url: its slug made unique in its directory
  const taken = new Map();
  const bySource = new Map();
  const slugCache = new Map();
  const slugOf = (text) => {
    let v = slugCache.get(text);
    if (v === undefined) {
      v = slugify(text);
      slugCache.set(text, v);
    }
    return v;
  };
  for (const s of kept) {
    const dir = s.post ? 'posts' : dirOf(s.path);
    let set = taken.get(dir);
    if (set === undefined) {
      set = dir === '' ? new Set(RESERVED) : new Set();
      taken.set(dir, set);
    }
    const slug = uniqueSlug(s.data.slug ?? slugOf(s.data.title), set);
    s.slug = slug;
    s.outDir = dir === '' ? slug : `${dir}/${slug}`;
    s.url = `${base}/${s.outDir}/`;
    bySource.set(s.path, s);
  }

  // 4. each body's Markdown, its links resolved to the pages and static files they name
  const staticPaths = new Set(statics.map((f) => f.path));
  for (const s of kept) {
    const dir = dirOf(s.path);
    const link = (target) => {
      const c0 = target.charCodeAt(0);
      if (c0 === 47 || c0 === 35) return target;
      // an absolute URL opens on a letter, after which scheme characters and then a ":" come: scan it rather than
      // run a regex on every link (most are relative, and fail on their first character)
      if (A2Z[c0]) {
        let i = 1;
        const n = target.length;
        while (i < n) {
          const c = target.charCodeAt(i);
          if (!SCHEME[c < 128 ? c : 0]) break;
          i++;
        }
        if (i > 0 && i < n && target.charCodeAt(i) === 58) return target;
      }
      const hash = target.indexOf('#');
      const rel = hash === -1 ? target : target.slice(0, hash);
      const frag = hash === -1 ? '' : target.slice(hash);
      const path = rel === '' ? null : resolvePath(dir, rel);
      if (path !== null) {
        const hit = bySource.get(path);
        if (hit !== undefined) return `${hit.url}${frag}`;
        if (staticPaths.has(path)) return `${base}/${path}${frag}`;
      }
      broken.add(`broken-link ${s.path} -> ${target}`);
      return target;
    };
    const md = renderMarkdown(s.body, link);
    s.html = md.html;
    s.toc = md.toc;
    s.excerpt = md.excerpt;
  }

  // 5. the posts, newest first and then by slug; each post's newer and older neighbours
  const posts = kept.filter((s) => s.post);
  posts.sort((x, y) => byCodeUnits(y.data.date, x.data.date) || byCodeUnits(x.slug, y.slug));
  for (let k = 0; k < posts.length; k++) {
    posts[k].newer = k === 0 ? null : posts[k - 1];
    posts[k].older = k === posts.length - 1 ? null : posts[k + 1];
  }

  // 6. the tags: grouped by their slug, named as first met in the posts' order, ordered by count then slug
  const bySlug = new Map();
  const ownTags = (s) => {
    const tags = s.data.tags;
    if (tags === undefined) return [];
    const seen = new Set();
    const out = [];
    for (const name of tags) {
      const slug = slugOf(name);
      if (seen.has(slug)) continue;
      seen.add(slug);
      out.push(name);
    }
    return out;
  };
  for (const p of posts) {
    p.tagRefs = [];
    for (const name of ownTags(p)) {
      const slug = slugOf(name);
      let tag = bySlug.get(slug);
      if (tag === undefined) {
        tag = { name, slug, url: `${base}/tags/${slug}/`, posts: [] };
        bySlug.set(slug, tag);
      }
      tag.posts.push(p);
      p.tagRefs.push(tag);
    }
  }
  // a page's tags link to the posts' tag of the same slug, and to nothing (url "") where no post has it
  for (const s of kept) {
    if (s.post) continue;
    s.tagRefs = ownTags(s).map((name) => {
      const slug = slugOf(name);
      return bySlug.get(slug) ?? { name, slug, url: '', posts: [] };
    });
  }
  const tags = [...bySlug.values()].sort((x, y) => y.posts.length - x.posts.length || byCodeUnits(x.slug, y.slug));

  // 7. every page through its layout, the index pages and the tag pages through theirs
  const cards = new Map();
  const dateLongCache = new Map();
  const longOf = (date) => {
    let v = dateLongCache.get(date);
    if (v === undefined) {
      v = longDate(date);
      dateLongCache.set(date, v);
    }
    return v;
  };
  const cardOf = (s) => {
    const d = s.data.date;
    const tagRefs = s.tagRefs;
    const cardTags = new Array(tagRefs.length);
    for (let i = 0; i < tagRefs.length; i++) {
      const t = tagRefs[i];
      cardTags[i] = { name: t.name, slug: t.slug, url: t.url };
    }
    return {
      title: s.data.title,
      url: s.url,
      date: d ?? '',
      date_long: d === undefined ? '' : longOf(d),
      summary: s.data.summary ?? '',
      excerpt: s.excerpt,
      reading_minutes: Math.max(1, Math.ceil(wordsOf(s.body) / 200)),
      tags: cardTags,
    };
  };
  for (const p of posts) cards.set(p, cardOf(p));
  const linkOf = (s) =>
    s === null
      ? null
      : { title: s.data.title, url: s.url, date: s.data.date ?? '', date_long: s.data.date === undefined ? '' : longOf(s.data.date) };
  const pageOf = (s) => {
    const card = s.post ? cards.get(s) : cardOf(s);
    const toc = s.toc;
    const pageToc = new Array(toc.length);
    for (let i = 0; i < toc.length; i++) pageToc[i] = { level: toc[i].level, id: toc[i].id, html: toc[i].html };
    return {
      title: card.title,
      url: card.url,
      date: card.date,
      date_long: card.date_long,
      summary: card.summary,
      excerpt: card.excerpt,
      reading_minutes: card.reading_minutes,
      tags: card.tags,
      slug: s.slug,
      content: s.html,
      toc: pageToc,
      newer: linkOf(s.newer ?? null),
      older: linkOf(s.older ?? null),
      is_post: s.post,
    };
  };

  const site = { title: input.site.title, base_url: base };
  const allTags = tags.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length }));
  const recentLimit = input.site.recent;
  const recent = posts.slice(0, recentLimit).map((p) => cards.get(p));
  const T = compileTemplates(ordered, { site, tags: allTags, recent });

  const output = {};
  const render = (name, vars) => {
    const idx = index.get(name);
    if (idx === undefined) return null;
    return T[idx]({ vars: { site, tags: allTags, recent, ...vars }, parent: null }, 0);
  };
  for (const s of kept) output[`${s.outDir}/index.html`] = render(s.layout, { page: pageOf(s) });
  const per = input.site.per_page;
  const pages = Math.max(1, Math.ceil(posts.length / per));
  const indexUrl = (k) => (k === 1 ? `${base}/` : `${base}/page/${k}/`);
  for (let k = 1; k <= pages; k++) {
    const html = render('index', {
      posts: posts.slice((k - 1) * per, k * per).map((p) => cards.get(p)),
      pager: { number: k, total: pages, url: indexUrl(k), newer_url: k === 1 ? '' : indexUrl(k - 1), older_url: k === pages ? '' : indexUrl(k + 1) },
    });
    if (html !== null) output[k === 1 ? 'index.html' : `page/${k}/index.html`] = html;
  }
  const cardOfPost = (p) => cards.get(p);
  for (const t of tags) {
    const html = render('tag', { tag: { name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: t.posts.map(cardOfPost) } });
    if (html !== null) output[`tags/${t.slug}/index.html`] = html;
  }
  const tagsHtml = render('tags', {});
  if (tagsHtml !== null) output['tags/index.html'] = tagsHtml;
  for (const f of statics) {
    if (Object.hasOwn(output, f.path)) report.push(`shadowed ${f.path}: a built page has its path`);
    else output[f.path] = f.content;
  }

  // 8. the report
  const lines = [...report, ...broken].sort(byCodeUnits);
  let pageCount = 0;
  for (const s of kept) if (!s.post) pageCount++;
  lines.push(`built ${pageCount} pages, ${posts.length} posts, ${tags.length} tags and ${statics.length} static files`);
  output[REPORT_FILE] = `${lines.join('\n')}\n`;
  return output;
}

/** The published entry point: one case's input, makefun-site's answer for it. */
export function run(input) {
  return build(input);
}

/**
 * A JSON string literal for `s`, written as JSON.stringify writes it. JSON.stringify escapes ", \, the control
 * characters below 0x20, and a lone surrogate (a well-formed pair stays as it is).
 */
const JSON_NAMES = { 8: '\\b', 9: '\\t', 10: '\\n', 12: '\\f', 13: '\\r' };
export function jsonString(s) {
  const n = s.length;
  let needs = false;
  for (let i = 0; i < n; i++) {
    const c = s.charCodeAt(i);
    if (c < 32 || c === 34 || c === 92) { needs = true; break; }
    if (c >= 0xd800 && c <= 0xdfff) {
      const lo = s.charCodeAt(i + 1);
      if (!(c <= 0xdbff && lo >= 0xdc00 && lo <= 0xdfff)) { needs = true; break; }
      i++;
    }
  }
  if (!needs) return '"' + s + '"';
  let out = '"';
  let last = 0;
  for (let i = 0; i < n; i++) {
    const c = s.charCodeAt(i);
    let rep;
    if (c < 32) rep = JSON_NAMES[c] ?? '\\u' + c.toString(16).padStart(4, '0');
    else if (c === 34) rep = '\\"';
    else if (c === 92) rep = '\\\\';
    else if (c >= 0xd800 && c <= 0xdfff) {
      const lo = s.charCodeAt(i + 1);
      if (c <= 0xdbff && lo >= 0xdc00 && lo <= 0xdfff) { i++; continue; }
      rep = '\\u' + c.toString(16).padStart(4, '0');
    } else continue;
    out += s.slice(last, i) + rep;
    last = i + 1;
  }
  return last >= n ? out + '"' : out + s.slice(last) + '"';
}

/**
 * The same answer as run(), written as the JSON text of the answer: one string per case, ready to be joined into an
 * array. This saves the intermediate object tree (the answer is a JSON object of strings already).
 */
export function runJson(input) {
  const out = build(input);
  const paths = Object.keys(out);
  let s = '{';
  for (let i = 0; i < paths.length; i++) {
    if (i > 0) s += ',';
    s += jsonString(paths[i]) + ':' + jsonString(out[paths[i]]);
  }
  return s + '}';
}
