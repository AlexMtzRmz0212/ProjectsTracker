// Text helpers. The app is English only: text is written where it is used and wrapped, __("Save"), where {name}
// marks a value, __("Hello {name}", { name }). For counts use _n(n, one, other).

import { Fragment, createElement } from "react";

const fill = (text, params) =>
  params ? text.replace(/\{(\w+)\}/g, (whole, name) => (params[name] === undefined ? whole : String(params[name]))) : text;

/** The text with its {names} filled in. */
export const __ = (text, params) => fill(text, params);

/** Like __, with elements for the {names}: __r("Press {button} to sync", { button: <b>Sync</b> }). */
export function __r(text, nodes) {
  const parts = text.split(/\{(\w+)\}/);
  return parts.map((part, i) => (i % 2 === 0 ? part : createElement(Fragment, { key: i }, nodes?.[part] ?? `{${part}}`)));
}

/** Marks text that is written outside a component (a table of labels); the place that shows it passes it through __. */
export const N_ = (text) => text;

/** One of two forms by count: _n(3, "{n} habit", "{n} habits"). `n` is also available as {n}. */
export function _n(n, one, other, params) {
  return __(n === 1 ? one : other, { n, ...params });
}
