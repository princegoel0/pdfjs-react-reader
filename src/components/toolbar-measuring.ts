import { createContext } from 'react';

/**
 * True while a toolbar control is being rendered inside the bar's hidden measurement copy.
 *
 * The bar folds on widths read from that copy, and a control whose width depends on its own value is measured at
 * whatever state it happens to be in. Measured at 1,100 px (#243): print's page scope is 116 px while it reads
 * "All pages" and 197 px once the reader chooses "From–to" — so the fold decision arrived *out of the reader's
 * own interaction*, evicting the control they had just used (and the two range fields they had just asked for)
 * into the overflow panel. Measuring the widest state a control can take moves the decision to before the
 * interaction, where it belongs: the bar is laid out for the control it will have to hold.
 *
 * A control that grows should read this and render its widest state in the copy only. The provider adds no DOM
 * node, so the sizer's children stay the items being measured.
 */
export const ToolbarMeasuring = createContext(false);
