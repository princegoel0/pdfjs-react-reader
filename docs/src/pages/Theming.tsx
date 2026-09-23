import { ThemeExample } from '../examples/ThemeExample';

const TOKENS: [string, string, string][] = [
  ['--pjsr-bg', '#ffffff', 'Page and menu surface'],
  ['--pjsr-fg', '#181d27', 'Primary text and icon strokes'],
  ['--pjsr-muted-fg', '#5c6470', 'Secondary text — keep it above 4.5:1 on --pjsr-bg'],
  ['--pjsr-border', '#e4e7ec', 'Hairlines'],
  ['--pjsr-toolbar-bg', '#fcfcfd', 'Toolbar strip'],
  ['--pjsr-hover-bg', '#f0f1f3', 'Control hover fill'],
  ['--pjsr-accent', '#4f46e5', 'Focus rings, active toggles, selection tint'],
  ['--pjsr-viewport-bg', '#e8eaef', 'Backdrop behind the pages'],
  ['--pjsr-page-shadow', 'layered soft shadow', 'Page elevation'],
  ['--pjsr-menu-shadow', 'layered soft shadow', 'Overflow menu elevation'],
  ['--pjsr-danger-fg', '#d92d20', 'Errors'],
  ['--pjsr-radius / --pjsr-radius-lg', '8 / 12px', 'Corner radii'],
  ['--pjsr-control-h', '32px (44px on coarse pointers)', 'Button and field height'],
  ['--pjsr-icon', '16px (20px on coarse pointers)', 'Glyph size; tracks control height'],
  ['--pjsr-cluster-gap', '6px (8px on coarse pointers)', 'Gap between toolbar controls'],
  ['--pjsr-row-h', '30px', 'Sidebar tab and outline row height'],
  ['--pjsr-swatch-hit / --pjsr-caret-w', '32px / 20px', 'Ink swatch tap box, outline caret'],
];

export function Theming() {
  return (
    <>
      <h1>Theming</h1>
      <p className="doc-lede">
        Plain CSS custom properties, no CSS-in-JS and no build-time theme step. Every colour and
        size in the shell resolves from a token declared on <code>.pjsr-viewer</code>.
      </p>

      <ThemeExample />

      <h2>Where to put them</h2>
      <p>
        The viewer declares the tokens on its own root element, so setting them on{' '}
        <code>:root</code> or an ancestor will lose. There are two ways to win:
      </p>
      <pre>
        <code>{`/* 1. A stylesheet rule with equal or higher specificity */
.pjsr-viewer {
  --pjsr-accent: #0b7285;
  --pjsr-viewport-bg: #f1f3f5;
}

/* 2. The style prop, which lands on the same element and beats the class */
<PdfViewer src={src} style={{ '--pjsr-accent': '#0b7285' }} />`}</code>
      </pre>
      <p>
        Option 2 is what the live example above uses, and is the one to reach for when the theme is
        a runtime value.
      </p>

      <h2>The tokens</h2>
      <table className="doc-table">
        <thead>
          <tr>
            <th>Token</th>
            <th>Default</th>
            <th>Used for</th>
          </tr>
        </thead>
        <tbody>
          {TOKENS.map(([name, value, note]) => (
            <tr key={name}>
              <td>
                <code>{name}</code>
              </td>
              <td>
                <code>{value}</code>
              </td>
              <td>{note}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Going darker</h2>
      <p>
        A dark theme is a colour pass, not a rewrite — but two things need attention.{' '}
        <code>--pjsr-page-shadow</code> should shrink to a single low-opacity layer, since a soft
        32 px blur reads as a halo on a dark backdrop. And the text layer's selection highlight is
        built with <code>color-mix()</code> over the accent, so check it against your page colour
        rather than assuming the default reads.
      </p>

      <h2>Layout, not just colour</h2>
      <p>
        <code>--pjsr-control-h</code> and <code>--pjsr-icon</code> are coupled on purpose: the glyph
        scales with the control so a 44 px button does not look like an empty pill. If you raise
        <code>--pjsr-control-h</code>, raise <code>--pjsr-icon</code> with it — and remember that
        the toolbar's overflow planner measures real widths, so it will fold more controls away
        automatically at larger sizes.
      </p>

      <h2>Class names</h2>
      <p>
        Everything is prefixed <code>pjsr-</code> and flat — no CSS modules, no hashed class names —
        so you can also target parts directly when a token is not enough:
        <code>.pjsr-toolbar</code>, <code>.pjsr-page</code>, <code>.pjsr-text-layer</code>,{' '}
        <code>.pjsr-ink-layer</code>, <code>.pjsr-sidebar</code>, <code>.pjsr-thumbnail</code>,{' '}
        <code>.pjsr-overflow-menu</code>. The print container is <code>.pjsr-print</code> and its
        rules live under <code>@media print</code>; there is deliberately no <code>@page</code>{' '}
        rule, so the library cannot interfere with the host app's own printing.
      </p>
    </>
  );
}
