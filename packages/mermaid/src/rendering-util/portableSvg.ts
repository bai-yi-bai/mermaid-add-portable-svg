/**
 * Rewrites a rendered diagram, while it is still attached to the live DOM, into SVG that
 * renderers without a browser engine can draw, such as Batik or prawn-svg.
 *
 * Those renderers ignore or misread `<foreignObject>`, CSS style sheets with descendant
 * selectors, `hsl()` colors, `em` lengths, `dominant-baseline`, and gradient strokes. Every
 * value written here is read back from the browser, so the result matches what the browser
 * draws.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const PAINT_PROPS = ['fill', 'stroke'];
const PLAIN_PROPS = [
  'stroke-width',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'fill-rule',
];
const TEXT_PROPS = ['font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor'];
const SHAPES = new Set(['rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path']);
const TEXTS = new Set(['text', 'tspan', 'textPath']);
const BASELINE_ATTRS = ['dominant-baseline', 'alignment-baseline'];

const toHex = (n: string) => Number(n).toString(16).padStart(2, '0');

/** Returns `[color, alpha]` for a computed color, or `undefined` for none or transparent. */
const parseColor = (value: string): [string, number] | undefined => {
  const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(value);
  if (!m) {
    return value === 'none' ? undefined : [value, 1];
  }
  const alpha = m[4] === undefined ? 1 : Number(m[4]);
  if (alpha === 0) {
    return undefined;
  }
  return [`#${toHex(m[1])}${toHex(m[2])}${toHex(m[3])}`, alpha];
};

const px = (value: string) => value.replace(/px$/, '');

const startsChunk = (el: Element) => ['x', 'y', 'dx', 'dy'].some((a) => el.hasAttribute(a));

const sameAttrs = (a: Element, b: Element) =>
  a.attributes.length === b.attributes.length &&
  [...a.attributes].every((attr) => b.getAttribute(attr.name) === attr.value);

const decoder = () => document.createElement('textarea');

/** Replaces HTML labels that `htmlLabels: false` did not cover with centered SVG text. */
const convertForeignObjects = (root: SVGSVGElement) => {
  for (const fo of root.querySelectorAll('foreignObject')) {
    // A <switch> already holds an SVG text fallback; keep only that.
    const parent = fo.parentElement;
    if (parent?.localName === 'switch') {
      fo.remove();
      parent.replaceWith(...parent.childNodes);
      continue;
    }
    const html = fo.querySelector<HTMLElement>('*') ?? fo;
    const lines = (('innerText' in html ? html.innerText : undefined) ?? fo.textContent ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const cs = getComputedStyle(html);
    const w = Number(fo.getAttribute('width')) || 0;
    const h = Number(fo.getAttribute('height')) || 0;
    const fontSize = parseFloat(cs.fontSize) || 16;
    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('text-anchor', 'middle');
    text.style.fill = cs.color;
    text.style.fontFamily = cs.fontFamily;
    text.style.fontSize = cs.fontSize;
    text.style.fontWeight = cs.fontWeight;
    const top = h / 2 - ((lines.length - 1) * fontSize * 1.2) / 2 + fontSize * 0.35;
    lines.forEach((line, i) => {
      const tspan = document.createElementNS(SVG_NS, 'tspan');
      tspan.setAttribute('x', String(w / 2));
      tspan.setAttribute('y', String(top + i * fontSize * 1.2));
      tspan.textContent = line;
      text.appendChild(tspan);
    });
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute(
      'transform',
      `translate(${fo.getAttribute('x') ?? 0}, ${fo.getAttribute('y') ?? 0})`
    );
    g.appendChild(text);
    fo.replaceWith(g);
  }
};

/**
 * Mermaid writes one `<tspan>` per word. Renderers that anchor each `<tspan>` on its own
 * stack the words of a centered label on top of each other, so join runs of identically
 * attributed spans that do not start a new text chunk.
 */
const mergeWordSpans = (root: SVGSVGElement) => {
  for (const tspan of root.querySelectorAll('tspan')) {
    const prev = tspan.previousElementSibling;
    if (
      prev?.localName === 'tspan' &&
      prev.nextSibling === tspan &&
      !startsChunk(tspan) &&
      prev.children.length === 0 &&
      tspan.children.length === 0 &&
      sameAttrs(prev, tspan)
    ) {
      prev.textContent = (prev.textContent ?? '') + (tspan.textContent ?? '');
      tspan.remove();
    }
  }
};

/** Labels written as SVG text keep HTML entities such as `&nbsp;` as literal text. */
const decodeTextEntities = (root: SVGSVGElement) => {
  const area = decoder();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = node.nodeValue ?? '';
    if (/&(#\d+|#x[\da-f]+|[a-z]+);/i.test(value)) {
      area.innerHTML = value;
      node.nodeValue = area.value;
    }
  }
};

/**
 * Gradients without explicit coordinates crash some renderers, and many renderers cannot
 * stroke with a gradient at all. Fill in the coordinates, and stroke with the first stop.
 */
const resolveGradients = (root: SVGSVGElement, attrs: Map<Element, Record<string, string>>) => {
  for (const gradient of root.querySelectorAll('linearGradient')) {
    const defaults: Record<string, string> = { x1: '0%', y1: '0%', x2: '100%', y2: '0%' };
    for (const [name, value] of Object.entries(defaults)) {
      if (!gradient.hasAttribute(name)) {
        gradient.setAttribute(name, value);
      }
    }
    for (const stop of gradient.querySelectorAll('stop')) {
      const cs = getComputedStyle(stop);
      const color = parseColor(cs.stopColor);
      stop.setAttribute('stop-color', color ? color[0] : '#000000');
      const opacity = (color ? color[1] : 0) * Number(cs.stopOpacity);
      if (opacity !== 1) {
        stop.setAttribute('stop-opacity', String(opacity));
      }
    }
  }
  for (const [el, values] of attrs) {
    const ref = /url\(["']?#([^"')]+)["']?\)/.exec(values.stroke ?? '');
    const stop = ref && root.querySelector(`[id="${ref[1]}"] stop`);
    if (stop) {
      values.stroke = stop.getAttribute('stop-color') ?? '#000000';
      const opacity = stop.getAttribute('stop-opacity');
      if (opacity) {
        values['stroke-opacity'] = opacity;
      }
    }
    attrs.set(el, values);
  }
};

/**
 * Returns the CSS transform as an SVG transform attribute, or `undefined` when the element
 * has no CSS transform beyond its own transform attribute.
 */
const cssTransform = (el: Element, cs: CSSStyleDeclaration): string | undefined => {
  const m = /^matrix\(([^)]+)\)$/.exec(cs.transform);
  if (!m) {
    return undefined;
  }
  const css = m[1].split(',').map(Number);
  const own = (el as SVGGraphicsElement).transform?.baseVal.consolidate()?.matrix;
  const attr = own ? [own.a, own.b, own.c, own.d, own.e, own.f] : [1, 0, 0, 1, 0, 0];
  // Computed values are rounded, so compare loosely.
  if (css.every((v, i) => Math.abs(v - attr[i]) < 0.01)) {
    return undefined;
  }
  const [ox, oy] = cs.transformOrigin.split(' ').map((v) => parseFloat(v) || 0);
  return `translate(${ox}, ${oy}) matrix(${css.join(', ')}) translate(${-ox}, ${-oy})`;
};

const shiftY = (el: Element, delta: number) => {
  const y = el.getAttribute('y');
  el.setAttribute('y', String((y ? parseFloat(y) : 0) + delta));
};

/**
 * Converts `<text>` elements in place. Call before serializing the diagram.
 * @param root - The rendered diagram, still attached to the document.
 */
export const makePortable = (root: SVGSVGElement) => {
  convertForeignObjects(root);
  mergeWordSpans(root);
  // A rect without a size is never drawn, and some renderers warn on every one.
  for (const rect of root.querySelectorAll('rect')) {
    if (!Number(rect.getAttribute('width')) || !Number(rect.getAttribute('height'))) {
      rect.remove();
    }
  }

  // Remember where each text sits while the style sheet still sets its baseline.
  const texts = [...root.querySelectorAll('text')] as SVGTextElement[];
  const before = new Map(texts.map((text) => [text, text.getBBox().y]));

  // Resolve every style first, then write, so earlier writes can't change what later
  // elements inherit.
  const elements = [...root.querySelectorAll('*')].filter(
    (el) => el.namespaceURI === SVG_NS && el.localName !== 'style'
  );
  const resolved = new Map<Element, Record<string, string>>();
  for (const el of elements) {
    const cs = getComputedStyle(el);
    const attrs: Record<string, string> = {};
    if (cs.display === 'none') {
      attrs.display = 'none';
    }
    if (cs.visibility === 'hidden') {
      attrs.visibility = 'hidden';
    }
    if (Number(cs.opacity) !== 1) {
      attrs.opacity = cs.opacity;
    }
    const transform = cssTransform(el, cs);
    if (transform) {
      attrs.transform = transform;
      attrs['transform-origin'] = '';
    }
    const name = el.localName;
    if (SHAPES.has(name) || TEXTS.has(name)) {
      for (const prop of PAINT_PROPS) {
        const color = parseColor(cs.getPropertyValue(prop));
        if (color === undefined) {
          attrs[prop] = 'none';
        } else {
          attrs[prop] = color[0];
          const alpha = color[1] * Number(cs.getPropertyValue(`${prop}-opacity`));
          if (alpha !== 1) {
            attrs[`${prop}-opacity`] = String(alpha);
          }
        }
      }
      for (const prop of PLAIN_PROPS) {
        attrs[prop] = px(cs.getPropertyValue(prop));
      }
    }
    if (TEXTS.has(name)) {
      for (const prop of TEXT_PROPS) {
        attrs[prop] = px(cs.getPropertyValue(prop));
      }
      // text-anchor only applies where a text chunk starts.
      if (name === 'tspan' && !startsChunk(el)) {
        attrs['text-anchor'] = '';
      }
      const fontSize = parseFloat(cs.fontSize) || 16;
      for (const attr of ['x', 'y', 'dx', 'dy']) {
        const v = el.getAttribute(attr);
        if (v?.endsWith('em')) {
          attrs[attr] = String(parseFloat(v) * fontSize);
        }
      }
    }
    resolved.set(el, attrs);
  }
  resolveGradients(root, resolved);
  for (const [el, attrs] of resolved) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === '') {
        el.removeAttribute(k);
      } else {
        el.setAttribute(k, v);
      }
    }
    // Chromium writes styles set through the CSSOM back to the attribute lazily, and would
    // write an empty `style=""` after the removal. Reading the attribute flushes it first.
    el.getAttribute('style');
    el.removeAttribute('style');
    for (const attr of BASELINE_ATTRS) {
      el.removeAttribute(attr);
    }
  }
  for (const style of root.querySelectorAll('style')) {
    style.remove();
  }

  // Many renderers ignore dominant-baseline and alignment-baseline, so replace the shift
  // they caused with an explicit y.
  for (const [text, y] of before) {
    const delta = y - text.getBBox().y;
    if (Math.abs(delta) > 0.01) {
      shiftY(text, delta);
      for (const tspan of text.querySelectorAll('tspan[y]')) {
        shiftY(tspan, delta);
      }
    }
  }

  decodeTextEntities(root);
};

/**
 * Serializes SVG markup as XML. HTML serialization writes entities such as `&nbsp;` and
 * drops namespace declarations, which XML parsers reject.
 * @param code - SVG markup, possibly wrapped in other HTML elements.
 */
export const toXml = (code: string): string => {
  const doc = new DOMParser().parseFromString(`<body>${code}</body>`, 'text/html');
  const svg = doc.querySelector('svg');
  return svg ? new XMLSerializer().serializeToString(svg) : code;
};
