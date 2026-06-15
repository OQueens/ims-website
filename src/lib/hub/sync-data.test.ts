import { describe, it, expect } from 'vitest';
import {
  getWeekKey,
  isWeekKey,
  sanitizeHtml,
  escapeText,
  normalizeColumn,
  validateSyncPayload,
  readColumn,
  emptyColumn,
  COLUMN_KEYS,
  MAX_SECTIONS,
  MAX_FOCUSES,
  MAX_HTML_LEN,
  type IdGen,
  type Focus,
} from './sync-data';

// Deterministic id generator for stable assertions.
function counterGen(): IdGen {
  let n = 0;
  return (prefix: string) => `${prefix}_${++n}`;
}

describe('getWeekKey (ISO week, UTC, deterministic)', () => {
  it('formats as YYYY-Wxx and pads single-digit weeks', () => {
    expect(getWeekKey(new Date('2026-01-04T00:00:00Z'))).toBe('2026-W01');
  });
  it('computes a mid-year week correctly', () => {
    expect(getWeekKey(new Date('2026-06-08T12:00:00Z'))).toBe('2026-W24');
  });
  it('rolls the ISO year on the boundary (2025-12-29 is 2026-W01)', () => {
    expect(getWeekKey(new Date('2025-12-29T00:00:00Z'))).toBe('2026-W01');
  });
});

describe('isWeekKey', () => {
  it('accepts well-formed keys and rejects junk', () => {
    expect(isWeekKey('2026-W24')).toBe(true);
    expect(isWeekKey('2026-24')).toBe(false);
    expect(isWeekKey('now')).toBe(false);
    expect(isWeekKey(123)).toBe(false);
  });
});

describe('sanitizeHtml (allowlist, no attributes, escape-all-then-restore)', () => {
  it('keeps the allowed inline tags, attribute-stripped', () => {
    expect(sanitizeHtml('<b>bold</b> <i>it</i> <em>e</em> <strong>s</strong> <u>u</u> <mark>m</mark>'))
      .toBe('<b>bold</b> <i>it</i> <em>e</em> <strong>s</strong> <u>u</u> <mark>m</mark>');
  });
  it('strips attributes from allowed tags (e.g. event handlers)', () => {
    expect(sanitizeHtml('<b onclick="evil()">x</b>')).toBe('<b>x</b>');
    expect(sanitizeHtml('<mark style="background:red" data-x=1>y</mark>')).toBe('<mark>y</mark>');
  });
  it('normalizes <br> variants', () => {
    expect(sanitizeHtml('a<br>b<br/>c<BR />d')).toBe('a<br>b<br>c<br>d');
  });
  it('neutralizes script, img/onerror, and other tags as inert text', () => {
    expect(sanitizeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(sanitizeHtml('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;');
    expect(sanitizeHtml('<div><span>hi</span></div>')).toBe('&lt;div&gt;&lt;span&gt;hi&lt;/span&gt;&lt;/div&gt;');
  });
  it('escapes a malformed almost-tag rather than trusting it', () => {
    // <b/onclick=x> is NOT matched as an allowed tag → escaped to inert text.
    expect(sanitizeHtml('<b/onclick=x>hi')).toBe('&lt;b/onclick=x&gt;hi');
  });
  it('escapes stray ampersands and angle brackets', () => {
    expect(sanitizeHtml('5 < 7 && 8 > 2')).toBe('5 &lt; 7 &amp;&amp; 8 &gt; 2');
  });
  it('strips control chars so sentinels cannot be smuggled in', () => {
    const sneaky = 'a' + String.fromCharCode(1) + 'b' + String.fromCharCode(2) + 'c';
    expect(sanitizeHtml(sneaky)).toBe('abc');
  });
  it('caps length', () => {
    const long = 'x'.repeat(MAX_HTML_LEN + 500);
    expect(sanitizeHtml(long).length).toBe(MAX_HTML_LEN);
  });
  it('returns empty string for non-strings', () => {
    expect(sanitizeHtml(null)).toBe('');
    expect(sanitizeHtml(42)).toBe('');
  });
  it('is IDEMPOTENT — re-sanitizing sanitized output is a no-op (no double-escape)', () => {
    const cases = [
      '<b>Close Austin</b> <mark>hot</mark><script>alert(1)</script>',
      '<i>x</i><img src=y onerror=z>',
      'Tom & Jerry < 5 > 2',
      'already &amp; &lt;safe&gt;',
    ];
    for (const c of cases) {
      const once = sanitizeHtml(c);
      expect(sanitizeHtml(once)).toBe(once);
      expect(sanitizeHtml(sanitizeHtml(once))).toBe(once);
    }
  });
  it('still fully escapes a raw script on the first pass', () => {
    expect(sanitizeHtml('<script>alert("a&b")</script>')).toBe('&lt;script&gt;alert("a&amp;b")&lt;/script&gt;');
  });
});

describe('escapeText (no tags survive)', () => {
  it('escapes all markup to inert text', () => {
    expect(escapeText('<b>x</b>')).toBe('&lt;b&gt;x&lt;/b&gt;');
    expect(escapeText('a & b')).toBe('a &amp; b');
  });
});

describe('normalizeColumn', () => {
  it('migrates a v1 string[] into one untitled section (escaped, ids assigned)', () => {
    const c = normalizeColumn(['Close Austin', '<b>not bold</b>'], counterGen());
    expect(c.v).toBe(3);
    expect(c.sections.length).toBe(1);
    expect(c.sections[0].title).toBe('');
    expect(c.sections[0].focuses.map((f) => f.html)).toEqual(['Close Austin', '&lt;b&gt;not bold&lt;/b&gt;']);
    expect(c.sections[0].focuses.every((f) => f.id.startsWith('f_'))).toBe(true);
    expect(c.sections[0].id.startsWith('s_')).toBe(true);
  });
  it('drops empty v1 strings and yields zero sections when all empty', () => {
    expect(normalizeColumn(['', '   '], counterGen()).sections).toEqual([]);
  });
  it('normalizes a v2 object: sanitizes html, keeps client ids, caps title', () => {
    const c = normalizeColumn(
      { v: 2, sections: [{ id: 'sec-1', title: 'Pipeline'.repeat(20), focuses: [{ id: 'foc-1', html: '<b>x</b><script>y</script>' }] }] },
      counterGen(),
    );
    expect(c.sections[0].id).toBe('sec-1');
    expect(c.sections[0].title.length).toBeLessThanOrEqual(80);
    expect(c.sections[0].focuses[0].id).toBe('foc-1');
    expect(c.sections[0].focuses[0].html).toBe('<b>x</b>&lt;script&gt;y&lt;/script&gt;');
  });
  it('caps section + focus counts', () => {
    const sections = Array.from({ length: MAX_SECTIONS + 5 }, (_, i) => ({
      id: 's' + i,
      title: '',
      focuses: Array.from({ length: MAX_FOCUSES + 10 }, (_, j) => ({ id: 'f' + i + '_' + j, html: 'x' })),
    }));
    const c = normalizeColumn({ v: 2, sections }, counterGen());
    expect(c.sections.length).toBe(MAX_SECTIONS);
    expect(c.sections[0].focuses.length).toBe(MAX_FOCUSES);
  });
  it('generates ids for missing/invalid ones', () => {
    const c = normalizeColumn({ v: 2, sections: [{ title: '', focuses: [{ html: 'x' }] }] }, counterGen());
    expect(c.sections[0].id.startsWith('s_')).toBe(true);
    expect(c.sections[0].focuses[0].id.startsWith('f_')).toBe(true);
  });
  it('returns an empty column for garbage', () => {
    expect(normalizeColumn(null, counterGen())).toEqual(emptyColumn());
    expect(normalizeColumn('nope', counterGen())).toEqual(emptyColumn());
  });
  it('reads a v2 sections ARRAY (the stored jsonb form), preserving ids', () => {
    const stored = [{ id: 'sec_a', title: 'Pipe', focuses: [{ id: 'foc_a', html: '<b>x</b><script>y</script>' }] }];
    const c = normalizeColumn(stored, counterGen());
    expect(c.sections.length).toBe(1);
    expect(c.sections[0].id).toBe('sec_a');
    expect(c.sections[0].title).toBe('Pipe');
    expect(c.sections[0].focuses[0].id).toBe('foc_a');
    expect(c.sections[0].focuses[0].html).toBe('<b>x</b>&lt;script&gt;y&lt;/script&gt;');
  });
  it('treats an empty array as a blank column (no sections)', () => {
    expect(normalizeColumn([], counterGen()).sections).toEqual([]);
  });
});

describe('validateSyncPayload', () => {
  it('exposes the three valid columns', () => {
    expect([...COLUMN_KEYS]).toEqual(['recruiting', 'marketing', 'operations']);
  });
  it('accepts a v2 column payload and sanitizes it', () => {
    const r = validateSyncPayload(
      { weekKey: '2026-W24', columnKey: 'recruiting', column: { v: 2, sections: [{ id: 'a1b', title: '', focuses: [{ id: 'c2d', html: '<b>hi</b><img onerror=x>' }] }] } },
      counterGen(),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.weekKey).toBe('2026-W24');
      expect(r.value.column.sections[0].focuses[0].html).toBe('<b>hi</b>&lt;img onerror=x&gt;');
    }
  });
  it('accepts a legacy { items: string[] } payload (migrates)', () => {
    const r = validateSyncPayload({ weekKey: '2026-W24', columnKey: 'operations', items: ['a', 'b'] }, counterGen());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.column.sections[0].focuses.map((f) => f.html)).toEqual(['a', 'b']);
  });
  it('rejects a non-object, bad week, unknown column, missing column', () => {
    expect(validateSyncPayload(null).ok).toBe(false);
    expect(validateSyncPayload({ weekKey: '2026-24', columnKey: 'recruiting', column: emptyColumn() }).ok).toBe(false);
    expect(validateSyncPayload({ weekKey: '2026-W24', columnKey: 'finance', column: emptyColumn() }).ok).toBe(false);
    expect(validateSyncPayload({ weekKey: '2026-W24', columnKey: 'recruiting' }).ok).toBe(false);
  });
  it('accepts an empty (cleared) column', () => {
    const r = validateSyncPayload({ weekKey: '2026-W24', columnKey: 'marketing', column: emptyColumn() });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.column.sections).toEqual([]);
  });
});

describe('readColumn', () => {
  it('reads null as an empty column', () => {
    expect(readColumn(null, counterGen())).toEqual(emptyColumn());
  });
  it('reads a v1 row as a migrated v3 column', () => {
    const c = readColumn(['x'], counterGen());
    expect(c.v).toBe(3);
    expect(c.sections[0].focuses[0].html).toBe('x');
  });
});

describe('v3 read enrichment', () => {
  it('migrates a v1 string[] item to a v3 focus with empty attribution', () => {
    const col = readColumn(['Ship the thing'], (p) => p + '_x');
    expect(col.v).toBe(3);
    const f = col.sections[0].focuses[0] as Focus;
    expect(f.html).toBe('Ship the thing');
    expect(f.by).toBe('');
    expect(f.createdAt).toBe(0);
  });
  it('preserves by/createdAt/editedBy/editedAt on a stored focus', () => {
    const stored = [{ id: 'sec1', title: 'T', focuses: [
      { id: 'foc1', html: '<b>x</b>', by: 'a@iastaffing.com', createdAt: 100, editedBy: 'b@iastaffing.com', editedAt: 200 },
    ] }];
    const f = readColumn(stored, (p) => p + '_x').sections[0].focuses[0];
    expect(f).toMatchObject({ id: 'foc1', by: 'a@iastaffing.com', createdAt: 100, editedBy: 'b@iastaffing.com', editedAt: 200 });
  });
});
