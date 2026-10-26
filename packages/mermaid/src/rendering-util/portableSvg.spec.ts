import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makePortable, toXml } from './portableSvg.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Attaches the markup to the document, as mermaid does before serializing. */
const mount = (markup: string): SVGSVGElement => {
  const host = document.createElement('div');
  host.innerHTML = `<svg xmlns="${SVG_NS}">${markup}</svg>`;
  document.body.appendChild(host);
  return host.querySelector('svg')!;
};

describe('makePortable', () => {
  beforeEach(() => {
    // JSDOM has no layout engine.
    // @ts-expect-error getBBox is not defined on SVGElement in JSDOM
    SVGElement.prototype.getBBox = () => ({ x: 0, y: 0, width: 0, height: 0 });
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('removes style sheets and inline styles', () => {
    const svg = mount(
      '<style>.node rect { fill: red; }</style><g class="node"><rect width="10" height="10" style="stroke: blue"/></g>'
    );
    makePortable(svg);
    expect(svg.querySelector('style')).toBeNull();
    expect(svg.querySelector('rect')!.hasAttribute('style')).toBe(false);
  });

  it('replaces foreignObject labels with centered SVG text', () => {
    const svg = mount(
      '<foreignObject x="5" y="10" width="100" height="40"><div xmlns="http://www.w3.org/1999/xhtml">Hello</div></foreignObject>'
    );
    makePortable(svg);
    expect(svg.querySelector('foreignObject')).toBeNull();
    const text = svg.querySelector('text')!;
    expect(text.textContent).toBe('Hello');
    expect(text.querySelector('tspan')!.getAttribute('x')).toBe('50');
    expect(text.parentElement!.getAttribute('transform')).toBe('translate(5, 10)');
  });

  it('keeps the SVG fallback of a switch and drops its foreignObject', () => {
    const svg = mount(
      '<switch><foreignObject width="10" height="10"><div xmlns="http://www.w3.org/1999/xhtml">A</div></foreignObject><text>A</text></switch>'
    );
    makePortable(svg);
    expect(svg.querySelector('switch')).toBeNull();
    expect(svg.querySelector('foreignObject')).toBeNull();
    expect(svg.querySelectorAll('text')).toHaveLength(1);
  });

  it('merges per-word tspans that do not start a text chunk', () => {
    const svg = mount(
      '<text><tspan x="0" y="0">one </tspan><tspan class="w">two </tspan><tspan class="w">three</tspan></text>'
    );
    makePortable(svg);
    const spans = svg.querySelectorAll('tspan');
    expect(spans).toHaveLength(2);
    expect(spans[1].textContent).toBe('two three');
  });

  it('removes rects without a size', () => {
    const svg = mount('<rect/><rect width="0" height="5"/><rect width="5" height="5"/>');
    makePortable(svg);
    expect(svg.querySelectorAll('rect')).toHaveLength(1);
  });

  it('removes baseline attributes and replaces their shift with y', () => {
    const svg = mount('<text y="10" dominant-baseline="middle">A</text>');
    const text = svg.querySelector('text')!;
    vi.spyOn(text, 'getBBox')
      .mockReturnValueOnce({ x: 0, y: 4, width: 10, height: 10 } as DOMRect)
      .mockReturnValueOnce({ x: 0, y: 0, width: 10, height: 10 } as DOMRect);
    makePortable(svg);
    expect(text.hasAttribute('dominant-baseline')).toBe(false);
    expect(text.getAttribute('y')).toBe('14');
  });

  it('converts em text offsets to px', () => {
    const svg = mount('<text><tspan x="0" dy="1.5em" style="font-size: 10px">A</tspan></text>');
    makePortable(svg);
    expect(svg.querySelector('tspan')!.getAttribute('dy')).toBe('15');
  });

  it('decodes HTML entities in text', () => {
    const svg = mount('<text>a&amp;nbsp;b</text>');
    makePortable(svg);
    expect(svg.querySelector('text')!.textContent).toBe('a b');
  });

  it('gives gradients explicit coordinates', () => {
    const svg = mount(
      '<defs><linearGradient id="g"><stop offset="0" stop-color="#ff0000"/></linearGradient></defs>'
    );
    makePortable(svg);
    const gradient = svg.querySelector('linearGradient')!;
    expect(gradient.getAttribute('x1')).toBe('0%');
    expect(gradient.getAttribute('x2')).toBe('100%');
  });
});

describe('toXml', () => {
  it('serializes SVG as XML', () => {
    const xml = toXml(
      '<svg xmlns="http://www.w3.org/2000/svg"><image xlink:href="a.png"/><text>a&nbsp;b</text></svg>'
    );
    const doc = new DOMParser().parseFromString(xml, 'image/svg+xml');
    expect(doc.querySelector('parsererror')).toBeNull();
    expect(xml).not.toContain('&nbsp;');
    const href = doc.querySelector('image')!.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
    expect(href).toBe('a.png');
  });

  it('unwraps the SVG from surrounding elements', () => {
    expect(toXml('<div><svg xmlns="http://www.w3.org/2000/svg"></svg></div>')).toMatch(/^<svg/);
  });
});
