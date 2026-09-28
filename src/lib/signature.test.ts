/**
 * The geometry between a drawing pad and a signature field.
 *
 * Three of these tests exist because the mapping flips an axis, which is the kind of thing
 * that reads correctly either way and paints a mirror image: a mark written with the flip
 * missing is still a plausible squiggle, and nothing in the file says it is upside down.
 */
import { describe, expect, it } from 'vitest';
import { boxToPage, isSignable, padToBox, signatureContent } from './signature';

const BOX = [72, 660, 272, 720] as const;
const PAD = { width: 200, height: 60 };

describe('padToBox', () => {
  it('puts the top-left of the pad at 0,1 — a box counts y from the bottom', () => {
    expect(padToBox([{ x: 0, y: 0 }], PAD)).toEqual([{ x: 0, y: 1 }]);
  });

  it('puts the bottom-right of the pad at 1,0', () => {
    expect(padToBox([{ x: 200, y: 60 }], PAD)).toEqual([{ x: 1, y: 0 }]);
  });

  it('maps the middle of the pad to the middle of the box on both axes', () => {
    expect(padToBox([{ x: 100, y: 30 }], PAD)).toEqual([{ x: 0.5, y: 0.5 }]);
  });

  it('keeps a stroke that ran off the pad outside the box rather than flattening it', () => {
    // The appearance is clipped to the box by the format, so the mark simply stops at the
    // edge — which is what a reader who dragged too far expects. Clamping would bend it.
    expect(padToBox([{ x: 400, y: -60 }], PAD)).toEqual([{ x: 2, y: 2 }]);
  });

  it('keeps one point per input point and leaves the input alone', () => {
    const input = [
      { x: 0, y: 10 },
      { x: 50, y: 20 },
    ];
    const before = structuredClone(input);
    expect(padToBox(input, PAD)).toHaveLength(2);
    expect(input).toEqual(before);
  });

  it('refuses a pad with no size, because both axes divide by it', () => {
    expect(padToBox([{ x: 1, y: 1 }], { width: 0, height: 60 })).toEqual([]);
    expect(padToBox([{ x: 1, y: 1 }], { width: 200, height: -1 })).toEqual([]);
  });
});

describe('boxToPage', () => {
  it('puts 0,0 at the box’s bottom-left and 1,1 at its top-right', () => {
    expect(boxToPage([{ x: 0, y: 0 }, { x: 1, y: 1 }], BOX)).toEqual([
      { x: 72, y: 660 },
      { x: 272, y: 720 },
    ]);
  });

  it('scales to the box, so the same mark fits two fields of different sizes', () => {
    const mark = [{ x: 0.5, y: 0.5 }];
    expect(boxToPage(mark, BOX)).toEqual([{ x: 172, y: 690 }]);
    expect(boxToPage(mark, [0, 0, 100, 100])).toEqual([{ x: 50, y: 50 }]);
  });

  it('refuses a box with no area, which is a file that cannot display the mark anywhere', () => {
    expect(boxToPage([{ x: 0.5, y: 0.5 }], [100, 100, 100, 200])).toEqual([]);
    expect(boxToPage([{ x: 0.5, y: 0.5 }], [100, 200, 100, 100])).toEqual([]);
    expect(boxToPage([{ x: 0.5, y: 0.5 }], [0, 0, Number.NaN, 10])).toEqual([]);
  });

  it('round-trips a pad point through the box it came from', () => {
    const drawn = { x: 40, y: 15 };
    const [placed] = boxToPage(padToBox([drawn], PAD), BOX);
    expect(placed!.x).toBeCloseTo(72 + (40 / 200) * 200, 6);
    expect(placed!.y).toBeCloseTo(720 - (15 / 60) * 60, 6);
  });
});

describe('isSignable', () => {
  it('needs two points, because one is a dot and a dot is not a signature', () => {
    expect(isSignable([])).toBe(false);
    expect(isSignable([{ x: 0, y: 0 }])).toBe(false);
    expect(isSignable([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(true);
  });
});

describe('signatureContent', () => {
  const points = [
    { x: 10, y: 20 },
    { x: 30.004, y: 40 },
    { x: 50, y: 60 },
  ];

  it('strokes one path: a move, then a line per remaining point', () => {
    // One exact string, because the order of these operators is the contract: colour and
    // width have to precede the path, and `S` has to close it.
    expect(signatureContent(points)).toBe('q 0 0 0 RG 2 w 1 J 1 j 10 20 m 30 40 l 50 60 l S Q');
  });

  it('rounds to two decimals, which is finer than a printer and smaller than a scribble', () => {
    expect(signatureContent(points)).toContain('30 40 l');
    expect(signatureContent(points)).not.toContain('30.004');
  });

  it('takes a width and a colour, defaulting to a black stroke two units wide', () => {
    expect(signatureContent(points)).toContain('0 0 0 RG 2 w');
    expect(signatureContent(points, { width: 3.5, color: [0.1, 0.2, 0.3] })).toContain(
      '0.1 0.2 0.3 RG 3.5 w',
    );
    expect(signatureContent(points, { width: 0 })).toContain('2 w');
  });

  it('drops a coordinate that is not a number rather than writing NaN into the stream', () => {
    // A `NaN` in a content stream is not a skipped mark: the parser fails, and the page it
    // fails on is the page the reader was trying to look at.
    const junk = [
      { x: 10, y: 20 },
      { x: Number.NaN, y: 30 },
      { x: 40, y: Number.POSITIVE_INFINITY },
      { x: 50, y: 60 },
    ];
    const content = signatureContent(junk);
    expect(content).not.toContain('NaN');
    expect(content).not.toContain('Infinity');
    expect(content).toContain('10 20 m');
    expect(content).toContain('50 60 l');
  });

  it('writes nothing at all when fewer than two usable points survive', () => {
    expect(signatureContent([])).toBe('');
    expect(signatureContent([{ x: Number.NaN, y: 1 }])).toBe('');
  });
});
