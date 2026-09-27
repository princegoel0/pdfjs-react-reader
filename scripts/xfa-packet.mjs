/*
 * The XFA packet shared by `make-xfa-pdf.mjs` (one stream, `/XFA` a single EmbeddedFile)
 * and `make-xfa-array-pdf.mjs` (`/XFA` an array of name/stream pairs, which is how
 * LiveCycle writes most real forms).
 *
 * It lives here rather than being copied because the two fixtures must differ in
 * exactly one thing — the container shape — for a comparison between them to mean
 * anything. The fragment strings below are the same bytes that appear inside the
 * single-stream packet, so the packet is assembled from them rather than written twice.
 *
 * Three shapes are load-bearing, and each was found by a failed measurement (see the
 * 0.6 notes in ROADMAP):
 *  - the page box is on `<medium short long>`, not on `<pageArea w h>`:
 *    `PageArea[$toHTML]()` reads only `this.medium`, and without it `XFAFactory.dims`
 *    are NaN, the viewport collapses, and the whole document fails to load. pdf.js
 *    warns "XFA - No medium specified in pageArea: please file a bug."
 *  - the datasets island needs the `<data>` wrapper: `Binder` reads `root.datasets.data`.
 *  - a data element named `name`, `length` or `prototype` is fatal: the element factory
 *    is a class, so `DatasetsNamespace[name]` finds `Function.name` and the parser dies
 *    with "is not a function". A node called `<name>` is common in real forms, which
 *    makes that a pdf.js limitation, not a fixture bug — so the fields here are named
 *    something else and the point stands either way.
 */

export const TEMPLATE_NS = 'http://www.xfa.org/schema/xfa-template/3.9/';
export const DATA_NS = 'http://www.xfa.org/schema/xfa-data/1.0/';
export const FORM_NS = 'urn:xfa:fixture';

/**
 * The template island: one page area, a heading, two text fields and a footnote.
 * Its box is 500x700 while the PDF's MediaBox is 612x792, which is what proves the
 * XFA layout — not the container — drives the rendered page size.
 */
export function xfaTemplateFragment() {
  return `<template xmlns="${TEMPLATE_NS}">
  <subform name="form1" w="500pt" h="700pt" x="0pt" y="0pt" placement="block">
    <pageSet>
      <pageArea name="PageArea1" id="Page1">
        <medium short="500pt" long="700pt" orientation="portrait"/>
        <contentArea x="60pt" y="60pt" w="380pt" h="580pt"/>
      </pageArea>
    </pageSet>
    <desc><text>XFA fixture</text></desc>
    <draw name="heading" x="60pt" y="560pt" w="400pt" h="24pt">
      <value><text>Painted by the XFA layer, not the canvas</text></value>
    </draw>
    <field name="applicantName" x="60pt" y="520pt" w="240pt" h="18pt">
      <desc><text>Name</text></desc>
      <ui><textEdit/></ui>
      <value><text>Fallback</text></value>
    </field>
    <field name="applicantCountry" x="60pt" y="490pt" w="240pt" h="18pt">
      <desc><text>Country</text></desc>
      <ui><textEdit/></ui>
      <value><text>Fallback</text></value>
    </field>
    <draw name="footnote" x="60pt" y="110pt" w="400pt" h="18pt">
      <value><text>End of the template</text></value>
    </draw>
  </subform>
</template>`;
}

/** The datasets island, whose bound values override the template's `<value>` fallbacks. */
export function xfaDatasetsFragment() {
  return `<datasets xmlns="${DATA_NS}">
  <data>
    <form1 xmlns="${FORM_NS}">
      <applicantName>Ada Lovelace</applicantName>
      <applicantCountry>United Kingdom</applicantCountry>
    </form1>
  </data>
</datasets>`;
}

/** The XML declaration and the opening `<xdp:xdp>` element, which wrap the islands. */
export function xfaXdpPrologue() {
  return '<?xml version="1.0" encoding="UTF-8"?>\n<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">\n';
}

/**
 * The packet as one stream — what `xfa-sample.pdf` carries, and what the array
 * fixtures split into fragments so their concatenation is byte-identical to it.
 */
export function xfaFullPacket() {
  return `${xfaXdpPrologue()}${xfaTemplateFragment()}\n${xfaDatasetsFragment()}\n</xdp:xdp>`;
}

/**
 * The assertions both generators make about the packet before either writes a byte.
 * Exported so the array fixture cannot drift from the one that is known to render.
 */
export function packetProblems(packet) {
  const problems = [];
  if (!packet.startsWith('<?xml') || !/<xdp:xdp/.test(packet)) {
    problems.push('the packet is not an xdp:xdp document');
  }
  for (const [name, needle] of [
    ['template namespace', `xmlns="${TEMPLATE_NS}"`],
    ['datasets namespace', `xmlns="${DATA_NS}"`],
    ['pageSet', '<pageSet>'],
    ['pageArea', '<pageArea'],
    ['medium (the only thing that gives the page a size)', '<medium short='],
    ['data wrapper', '<data>'],
  ]) {
    if (!packet.includes(needle)) problems.push(`the packet has no ${name} (${needle})`);
  }
  const island = packet.slice(packet.indexOf('<datasets'), packet.indexOf('</datasets>'));
  const colliding = [...island.matchAll(/<\s*([A-Za-z_][\w:-]*)/g)]
    .map((m) => m[1])
    .filter((name) => ['name', 'length', 'prototype'].includes(name));
  if (colliding.length) {
    problems.push(`datasets element(s) named after a Function static: ${colliding.join(', ')}`);
  }
  return problems;
}
