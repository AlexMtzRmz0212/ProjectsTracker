// A small translation layer: no library, English is the source language.
//
// Text is written in English where it is used and wrapped: __("Save"). The other languages are plain
// dictionaries keyed by that same English text (see es.js), so a string nobody has translated yet simply
// shows in English. {name} marks a value: __("Hello {name}", { name }). For counts use _n(n, one, other).
//
// Components call `useT()` to be redrawn when the language changes; code outside React (lib/*.js) uses the
// module-level __ and _n, which always answer in the current language.

import { Fragment, createElement, useSyncExternalStore } from "react";
import es from "./es";

export const LANGUAGES = [
  { code: "en", label: "EN", name: "English" },
  { code: "es", label: "ES", name: "Español" },
];

const DICTIONARIES = { es: es.text };
const KEY = "pt-lang"; // per device on purpose: the page is in a language before anyone has signed in

const supported = (code) => LANGUAGES.some((l) => l.code === code);

function initialLanguage() {
  try {
    const saved = localStorage.getItem(KEY);
    if (supported(saved)) return saved;
  } catch {
    // storage blocked: fall through to the browser's language
  }
  const preferred = (typeof navigator !== "undefined" && navigator.languages?.[0]) || "en";
  return supported(preferred.slice(0, 2).toLowerCase()) ? preferred.slice(0, 2).toLowerCase() : "en";
}

let current = initialLanguage();
const listeners = new Set();

if (typeof document !== "undefined") document.documentElement.lang = current;

export const getLanguage = () => current;

/** Switch language: remembered on this device and every component using `useT` is drawn again. */
export function setLanguage(code) {
  if (!supported(code) || code === current) return;
  current = code;
  try {
    localStorage.setItem(KEY, code);
  } catch {
    // not remembered; it still applies for this visit
  }
  if (typeof document !== "undefined") document.documentElement.lang = code;
  listeners.forEach((fn) => fn());
}

const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

const fill = (text, params) =>
  params ? text.replace(/\{(\w+)\}/g, (whole, name) => (params[name] === undefined ? whole : String(params[name]))) : text;

/** The text in the current language (English when it has no translation). */
export function __(text, params) {
  return fill(DICTIONARIES[current]?.[text] ?? text, params);
}

/** Like __, with elements for the {names}: __r("Press {button} to sync", { button: <b>Sync</b> }). The words around
 *  them are translated whole, so the sentence can put them wherever the language wants. */
export function __r(text, nodes) {
  const parts = (DICTIONARIES[current]?.[text] ?? text).split(/{(w+)}/);
  return parts.map((part, i) => (i % 2 === 0 ? part : createElement(Fragment, { key: i }, nodes?.[part] ?? `{${part}}`)));
}

/** Marks text that is written outside a component (a table of labels) so it is still found for translation; the
 *  place that shows it passes it through __. */
export const N_ = (text) => text;

/** One of two forms by count: _n(3, "{n} habit", "{n} habits"). `n` is also available as {n}. */
export function _n(n, one, other, params) {
  return __(n === 1 ? one : other, { n, ...params });
}

/** A server error message in the current language: the exact ones, then the ones with a name in them. */
export function translateError(message) {
  const table = DICTIONARIES[current];
  if (!table || !message) return message;
  if (table[message]) return table[message];
  for (const [pattern, text] of es.errors) {
    const match = message.match(pattern);
    if (match) return fill(text, match.groups);
  }
  return message;
}

/** The date-fns locale for the current language (undefined is date-fns's own English). */
export const dateLocale = () => (current === "es" ? es.dateLocale : undefined);

/** Call in any component that shows text: it is drawn again when the language changes. */
export function useT() {
  const language = useSyncExternalStore(subscribe, getLanguage, getLanguage);
  return language;
}
