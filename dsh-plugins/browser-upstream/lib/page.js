// What the Agent sees of a browser page. The page script runs through
// browser_evaluate once the page has stopped changing for a moment. It writes
// the page as lines of text in reading order, with each link, button and
// field the user can use now in brackets with a number, such as
// [#12 button "搜索"], and sets that number on the element as data-eduwork-ref
// for browser_act to target. What the user cannot see is left out: hidden
// boxes, menus closed or slid off the screen (their links are listed apart and
// opened by their address), and the page behind a modal dialog. Each read also
// tags the document and what each numbered element says, so browser_act can
// tell the page it read from a new document at the same address or a control
// the page has since put to another use, and notes the user's own input from
// then on, which may have changed what the Agent read, such as the option
// chosen. These scripts run in the page's own world: the tags tell ordinary
// changes apart, not a page that forges them, as a page decides what its own
// controls do anyway.
export const REF = 'data-eduwork-ref'
const READ_ID = '__eduworkRead'
const SAYS = '__eduworkSays'
const USED = '__eduworkUsed'
// How the page script names an element, which browser_act's check repeats.
const NAMES = String.raw`
  const FIELD = 'input:not([type=hidden], [type=submit], [type=button], [type=reset], [type=image]), select, textarea';
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const cut = (s, n) => s.length > n ? s.slice(0, n - 1) + '…' : s;
  const words = fragment => { fragment.querySelectorAll('select, input, textarea, [role=listbox]').forEach(x => x.remove()); return clean(fragment.textContent); };
  const own = node => words(node.cloneNode(true));
  // An element is called by the name the page gives it (aria-labelledby,
  // aria-label, a label), a field without one by the short caption shown with
  // it in a box of its own, as many pages lay out fields without labels: the
  // text before it, as a message the page adds, such as "required", goes after
  // it; a checkbox's after it. What a field holds is never its name: that
  // could be a password.
  const given = el => clean((el.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' '))
    || clean(el.getAttribute('aria-label')) || (el.labels?.[0] ? own(el.labels[0]) : '');
  const caption = el => {
    const after = el.type === 'checkbox' || el.type === 'radio';
    for (let up = el.parentElement, i = 0; up && i < 3 && up.querySelectorAll(FIELD).length === 1; up = up.parentElement, i++) {
      const range = document.createRange();
      range.selectNodeContents(up);
      if (after) range.setStartAfter(el); else range.setEndBefore(el);
      const found = words(range.cloneContents());
      if (found.length > 20) break;
      if (found) return found;
    }
    return '';
  };
  const name = el => cut(given(el) || (el.matches(FIELD) ? caption(el) || clean(el.placeholder) : clean(el.innerText || el.value))
    || clean(el.title || el.querySelector('img[alt]')?.alt || el.name), 80);
  // What an element is and is called, in any case, as showing a hidden menu can
  // change the case of its text.
  const says = el => el.tagName + ' ' + (el.matches(FIELD) ? el.type + ' ' : '') + name(el).toLowerCase();
`

export const READ = String.raw`async () => {
  // A page still loading (as after a redirect) is read once its document is all there.
  if (document.readyState === 'loading') await new Promise(resolve => { document.addEventListener('DOMContentLoaded', resolve, { once: true }); setTimeout(resolve, 5000) });
  await new Promise(resolve => {
    const done = () => { observer.disconnect(); clearTimeout(timer); clearTimeout(cap); resolve() };
    let timer = setTimeout(done, 80);
    const cap = setTimeout(done, 600);
    const observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(done, 80) });
    observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  });
  const REF = 'data-eduwork-ref';
  const read = Math.random().toString(36).slice(2);
  document[${JSON.stringify(READ_ID)}] = read;
  // The Agent's input comes as the user's would, but only while it acts, after which it reads again.
  if (!(${JSON.stringify(USED)} in document)) for (const type of ['pointerdown', 'keydown', 'input']) addEventListener(type, event => { if (event.isTrusted) document[${JSON.stringify(USED)}] = true; }, true);
  document[${JSON.stringify(USED)}] = false;
  const INTERACTIVE = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [contenteditable=true], [role=button], [role=link], [role=textbox], [role=searchbox], [role=tab], [role=switch], [role=option], [role=checkbox], [role=radio], [role=combobox], [role=menuitem], [role=menuitemradio], [role=menuitemcheckbox], [role=treeitem]';
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'CANVAS', 'VIDEO', 'AUDIO', 'OBJECT', 'EMBED']);
  const CJK = /[　-ヿ㐀-鿿＀-￯]/;
  const MAX = 60000, CHUNK = 2000;
  ${NAMES}
  const quote = s => JSON.stringify(s);
  // Children as drawn: an open shadow root's instead of the light ones, and a slot's assigned nodes.
  const kids = node => node.shadowRoot ? node.shadowRoot.childNodes
    : node.tagName === 'SLOT' && node.assignedNodes({ flatten: true }).length ? node.assignedNodes({ flatten: true }) : node.childNodes;
  const unmark = root => { for (const el of root.querySelectorAll('*')) { el.removeAttribute(REF); if (el.shadowRoot) unmark(el.shadowRoot); } };
  unmark(document);

  // Shown to the user: rendered, not clipped to nothing as a closed menu is,
  // and not a fixed or absolute box placed beside the viewport or above the
  // page, as narrow layouts keep their menus. Content that only overflows to
  // the side, as a wide table does, still counts.
  const shown = el => {
    const st = getComputedStyle(el);
    if (st.display === 'contents') return true;
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    const r = el.getBoundingClientRect();
    if (st.overflow !== 'visible' && st.display !== 'inline' && (r.width < 1 || r.height < 1)) return false;
    return !((st.position === 'fixed' || st.position === 'absolute') && (r.right <= 0 || r.left >= innerWidth || r.bottom + scrollY <= 0));
  };
  const block = el => !/^(inline|contents|table-cell|none)/.test(getComputedStyle(el).display);
  // What takes the clicks: the element, or for an inline link around block
  // content, which has no box of its own, the first child that has one.
  const sized = el => { const r = el.getBoundingClientRect(); return r.width >= 2 && r.height >= 2; };
  const clickable = el => sized(el) ? el : [...el.children].find(sized);
  // Large enough to be a chart rather than an icon.
  const drawing = el => { const r = el.getBoundingClientRect(); return r.width >= 160 && r.height >= 100; };
  const kindOf = el => {
    const role = el.getAttribute('role'), type = (el.getAttribute('type') || '').toLowerCase();
    const roles = { link: 'link', button: 'button', tab: 'tab', switch: 'switch', option: 'option', checkbox: 'checkbox', radio: 'radio', textbox: 'textbox', searchbox: 'textbox', treeitem: 'tree item', menuitem: 'menu item', menuitemradio: 'menu item', menuitemcheckbox: 'menu item' };
    if (role === 'combobox') return el.matches('input, textarea') || el.isContentEditable ? 'textbox' : 'dropdown';
    if (roles[role]) return roles[role];
    if (el.tagName === 'A') return 'link';
    if (el.tagName === 'SELECT') return 'select';
    if (el.tagName === 'INPUT') return type === 'checkbox' || type === 'radio' ? type : type === 'file' ? 'file chooser' : ['button', 'submit', 'reset', 'image'].includes(type) ? 'button' : 'textbox';
    return el.tagName === 'TEXTAREA' || el.isContentEditable ? 'textbox' : 'button';
  };
  // What the element holds or will do, as the user sees it.
  const state = (el, kind) => {
    const s = [];
    const on = attribute => el.getAttribute(attribute) === 'true';
    if (kind === 'textbox') {
      const value = clean(el.isContentEditable ? el.innerText : el.value);
      s.push(el.type === 'password' ? (value ? 'filled' : 'empty') : value ? '= ' + quote(cut(value, 80)) : 'empty');
      if (el.placeholder && clean(el.placeholder) !== name(el)) s.push('hint ' + quote(cut(clean(el.placeholder), 40)));
      // What the field takes, as far as the page says: a kind other than text, its range, its length.
      if (el.tagName === 'INPUT' && !['text', 'search', 'password'].includes(el.type)) s.push(el.type + (el.min || el.max ? ' ' + (el.min || '…') + '–' + (el.max || '…') : ''));
      if (el.maxLength > 0) s.push('at most ' + el.maxLength + ' characters');
      if (el === document.activeElement) s.push(on('aria-expanded') ? 'focused, suggestions open' : 'focused');
    } else if (kind === 'select') {
      const options = [...el.options].map(o => clean(o.text));
      s.push('= ' + quote(clean(el.selectedOptions[0]?.text)), 'options ' + options.slice(0, 15).map(quote).join(' ') + (options.length > 15 ? ' … (' + options.length + ')' : ''));
    } else if (kind === 'checkbox' || kind === 'radio' || kind === 'switch') {
      const checked = el.matches('input') ? el.checked : on('aria-checked');
      s.push(kind === 'switch' ? (checked ? 'on' : 'off') : kind === 'radio' ? (checked ? 'selected' : 'not selected') : checked ? 'checked' : 'not checked');
    } else {
      if (on('aria-selected') || on('aria-checked') || on('aria-pressed')) s.push('selected');
      if ((el.getAttribute('aria-current') || 'false') !== 'false') s.push('current');
      if (el.hasAttribute('aria-expanded')) s.push(on('aria-expanded') ? 'expanded' : 'collapsed');
      else if ((el.getAttribute('aria-haspopup') || 'false') !== 'false' || kind === 'dropdown') s.push('opens a list');
    }
    if (el.required || on('aria-required')) s.push('required');
    if (on('aria-invalid')) s.push('invalid');
    return s;
  };

  // Only a modal dialog is shown while one is open.
  const modal = document.querySelector('dialog:modal')
    || [...document.querySelectorAll('[aria-modal=true], [role=alertdialog]')].find(d => shown(d) && d.getBoundingClientRect().height > 0);
  // Under a fixed overlay that covers most of the viewport, nothing can be used.
  const covered = (el, r) => {
    if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) return false;
    const hit = document.elementFromPoint(Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 2), Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 2));
    if (!hit || hit === el || el.contains(hit) || el.labels?.[0]?.contains(hit)) return false;
    for (let up = hit; up && up !== document.body; up = up.parentElement) {
      const b = up.getBoundingClientRect();
      if (getComputedStyle(up).position === 'fixed' && b.width * b.height >= innerWidth * innerHeight / 2) return !up.contains(el);
    }
    return false;
  };

  // A picture link with no words beside a worded link to the same address, as
  // news lists put a thumbnail before each headline, is left to the worded one.
  const worded = new Set([...document.querySelectorAll('a[href]')].filter(a => clean(a.innerText || a.getAttribute('aria-label') || a.title)).map(a => a.href));
  // A link that loads another page, which opening its address does as well.
  const loads = a => /^https?:/.test(a.href) && !a.hasAttribute('download') && a.href.split('#')[0] !== location.href.split('#')[0];
  const lines = [], closed = [], refs = {};
  let line = '', top = 0, bottom = 0, size = 0, skipped = 0, k = 0, inside = 0, room = 0, prefix = '', gap = false;
  // Past the budget, lines wholly above the viewport make room for the ones
  // below, so a long page is read around where it is scrolled to.
  const full = () => {
    while (size > MAX && lines.length && lines[0].bottom < scrollY) { const first = lines.shift(); size -= first.text.length + 1; skipped += first.text.length + 1; }
    return size > MAX;
  };
  // A line grown past a screenful or so goes on in a new one, so each line has
  // its own place on the page. at is the element or range the text is drawn in.
  const put = (text, at) => {
    if (!text || full()) return;
    if (!inside && line.length > CHUNK) flush();
    // Inside a card, each piece of text is kept short, so its date or price at the end still shows.
    if (inside) { if (room <= 0) return; text = cut(text, Math.min(room, 60)); room -= text.length; }
    const r = at.getBoundingClientRect();
    if (!line) { top = Math.round(r.top + scrollY); bottom = top; text = prefix + text; prefix = ''; }
    bottom = Math.max(bottom, Math.round(r.bottom + scrollY));
    line += line && (gap || !(CJK.test(line.at(-1)) && CJK.test(text[0]))) ? ' ' + text : text;
    gap = false;
  };
  const flush = () => { const t = line.trim(); if (t) { lines.push({ text: t, top, bottom }); size += t.length + 1; } line = ''; };
  // A long run of text goes in pieces, each placed where it is drawn, broken at a space where there is one.
  const text = node => {
    const raw = node.textContent;
    if (raw.length <= CHUNK) return put(clean(raw), node.parentElement);
    for (let from = 0; from < raw.length && !full();) {
      let to = Math.min(from + CHUNK, raw.length);
      const space = to < raw.length ? raw.lastIndexOf(' ', to) : -1;
      if (space > from + CHUNK / 2) to = space;
      const range = document.createRange();
      range.setStart(node, from);
      range.setEnd(node, to);
      put(clean(raw.slice(from, to)), range);
      from = to;
    }
  };
  // A block starts a line of its own, or inside a card at least a word of its own.
  const apart = () => { if (inside) gap = true; else flush(); };
  const mark = (el, meta) => { el.setAttribute(REF, ++k); el[${JSON.stringify(SAYS)}] = says(el); refs[k] = meta; return k; };
  const hidden = el => {
    if (modal) return;
    for (const a of el.matches('a[href]') ? [el] : el.querySelectorAll('a[href]')) {
      const text = cut(clean(a.textContent), 80);
      if (closed.length >= 30 || !text || !loads(a) || closed.some(c => c.href === a.href)) continue;
      closed.push({ ref: mark(a, { kind: 'link', name: text, href: a.href }), name: text });
    }
  };
  const item = (el, target = el) => {
    const kind = kindOf(target), at = clickable(el), named = name(target);
    if (el.tagName === 'A' && !named && worded.has(el.href)) return;
    // A link with no words, such as a logo, goes by its address.
    const label = named || (el.tagName === 'A' ? cut(el.getAttribute('href'), 60) : '');
    if (target.disabled || target.getAttribute('aria-disabled') === 'true') return put('[' + kind + ' ' + quote(label) + ' disabled]', el);
    if (!at || covered(at, at.getBoundingClientRect())) return hidden(el);
    const ref = mark(at, { kind, name: label, ...el.tagName === 'A' && loads(el) && { href: el.href, newTab: !/^(_self|_top|_parent)?$/.test(el.target) } });
    // A link or button wrapping a whole card keeps the card's words, on one line.
    const words = clean(el.innerText).length;
    if (['link', 'button', 'option', 'menu item', 'tab'].includes(kind) && (words > 80 || (words > 30 && [...el.children].some(block)))) {
      put('[#' + ref + ' ' + kind + ':', el);
      inside++; room = 240; walk(el); inside--;
      line += ']';
      return;
    }
    const states = state(target, kind);
    put('[#' + ref + ' ' + kind + ' ' + quote(label) + (states.length ? ' ' + states.join(', ') : '') + ']', el);
  };
  const walk = node => {
    for (const child of kids(node)) {
      if (full()) return;
      if (child.nodeType === Node.TEXT_NODE) { text(child); continue; }
      // A chart drawn on a canvas or in an SVG has no text to read.
      if ((child.tagName === 'CANVAS' || child instanceof SVGSVGElement) && shown(child) && drawing(child)) {
        const named = clean(child.getAttribute('aria-label') || child.querySelector(':scope > title')?.textContent);
        put('[drawing' + (named ? ' ' + quote(named) : '') + ', not read: to see it, take a screenshot without a filename]', child);
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE || SKIP.has(child.tagName) || child instanceof SVGElement) continue;
      const el = child;
      if (!shown(el)) { hidden(el); continue; }
      if (el.tagName === 'IFRAME') { put('[frame ' + quote(clean(el.title || el.name)) + ', not read: use browser_snapshot]', el); continue; }
      const breaks = block(el);
      if (breaks) apart();
      // A label speaks for its field; a field hidden behind its label, as a
      // custom checkbox is, takes its clicks through the label.
      const control = el.tagName === 'LABEL' ? el.control : null;
      if (control && !shown(control)) item(el, control);
      else if (control) { if (el.contains(control)) item(control); }
      else if (el.matches(INTERACTIVE)) item(el);
      else {
        if (!inside && /^H[1-6]$/.test(el.tagName)) prefix = '#'.repeat(Number(el.tagName[1])) + ' ';
        if (!inside && el.tagName === 'LI') prefix = '- ';
        walk(el);
        if ((el.tagName === 'TD' || el.tagName === 'TH') && el.nextElementSibling) put('|', el);
      }
      if (breaks) apart();
    }
  };
  walk(modal || document.body);
  flush();
  const alerts = [...document.querySelectorAll('[role=alert], [role=status], [aria-live=assertive]')].filter(shown).map(e => cut(clean(e.innerText), 200)).filter(Boolean);
  return { url: location.href, title: document.title, dialog: modal ? cut(clean(modal.getAttribute('aria-label') || modal.querySelector('h1, h2, h3')?.innerText), 80) : undefined,
    alerts: [...new Set(alerts)].slice(0, 5), lines, closed, refs, scrollY: Math.round(scrollY), skipped, truncated: size > MAX, read };
}`

/**
 * Before browser_act's next action, in the page: whether it is still the page
 * read, the same document at the same address, after a moment (settle) for a
 * navigation the last action set off to begin, as a form that submits itself
 * when an option is chosen does; before its first (first), whether the user
 * has used the page since; whether the element of the next action is still
 * there; and whether typing opened suggestions under a field.
 */
export const STILL = (seen, { next, typed, settle = true, first = false } = {}) => `async () => {
  ${settle ? 'await new Promise(resolve => setTimeout(resolve, 120));' : ''}
  // The numbered element, in the document or an open shadow root, as the page read finds it.
  const at = ref => {
    const find = root => root.querySelector('[${REF}="' + ref + '"]') || [...root.querySelectorAll('*')].reduce((hit, el) => hit || (el.shadowRoot && find(el.shadowRoot)), null);
    return find(document);
  };
  if (location.href !== ${JSON.stringify(seen.url)} || document[${JSON.stringify(READ_ID)}] !== ${JSON.stringify(seen.read)} || document.readyState === 'loading') return 'went to another page';
  ${NAMES}
  const same = el => el && el[${JSON.stringify(SAYS)}] === says(el);
  if (${first} && document[${JSON.stringify(USED)}]) return 'the user used the page';
  if (${next === undefined ? 'false' : `!same(at(${next}))`}) return 'the page changed';
  if (${typed === undefined ? 'false' : `at(${typed})?.getAttribute('aria-expanded') === 'true'`}) return 'suggestions opened under the field';
  return '';
}`

const BUDGET = 6000
const length = lines => lines.reduce((n, l) => n + l.text.length + 1, 0)

// The lines that fit the budget, from the first one that reaches into the
// viewport down, then filled up with the ones before it.
function within(lines, scrollY, budget) {
  let from = lines.findIndex(l => (l.bottom ?? l.top) >= scrollY - 40)
  if (from < 0) from = lines.length
  let to = from, size = 0
  while (to < lines.length && (to === from || size + lines[to].text.length < budget)) size += lines[to++].text.length + 1
  while (from > 0 && size + lines[from - 1].text.length < budget) size += lines[--from].text.length + 1
  return { shown: lines.slice(from, to), above: length(lines.slice(0, from)), below: length(lines.slice(to)) }
}

/**
 * The page as the Agent reads it. With find, only the lines that contain one of
 * its words, each with the line after it. fresh holds the numbers of elements
 * that were not on this page when the Agent last read it; they are marked *.
 */
export function render(seen, { find, fresh = new Set(), budget = BUDGET } = {}) {
  const mark = text => text.replace(/\[#(\d+) /gu, (all, ref) => fresh.has(Number(ref)) ? `[#${ref}* ` : all)
  const out = [`Page: ${seen.title}`, `URL: ${seen.url}`]
  if (seen.dialog !== undefined) out.push(`A dialog is open${seen.dialog ? ` ("${seen.dialog}")` : ''}; only the dialog is shown.`)
  if (seen.alerts.length) out.push(`Messages: ${seen.alerts.join(' / ')}`)
  out.push('')
  // A long page is read only around where it is scrolled to.
  const unread = [seen.skipped && 'above', seen.truncated && 'below'].filter(Boolean)
  if (find) {
    const wanted = find.toLowerCase().split(/\s+/u).filter(Boolean)
    const hits = new Set()
    seen.lines.forEach((l, i) => { if (wanted.some(w => l.text.toLowerCase().includes(w))) hits.add(i).add(i + 1) })
    const { shown, below } = within([...hits].filter(i => i < seen.lines.length).sort((a, b) => a - b).map(i => seen.lines[i]), 0, budget)
    out.push(...shown.length ? shown.map(l => mark(l.text)) : [`No line ${unread.length ? 'read' : 'on the page'} contains ${find}.`])
    if (below) out.push('(More lines match: narrow find.)')
  } else {
    const { shown, above, below } = within(seen.lines, seen.scrollY, budget)
    if (above) out.push(`(${above} characters above, not shown: scroll up, or read with find.)`)
    out.push(...shown.length ? shown.map(l => mark(l.text)) : ['(The page shows no text.)'])
    if (below) out.push(`(${below} characters below, not shown: scroll down, or read with find.)`)
  }
  if (unread.length) out.push(`(The page goes on ${unread.join(' and ')} what was read: scroll there to read it.)`)
  if (seen.closed.length) out.push('', `In closed menus (a click opens the address): ${seen.closed.map(c => `[#${c.ref} link "${c.name}"]`).join(' ')}`)
  return out.join('\n')
}

/** What counts as the page changing: its address, title and what it says. */
export const fingerprint = seen => JSON.stringify([seen.url, seen.title, seen.lines.map(l => l.text)])
