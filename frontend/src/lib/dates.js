// date-fns with the current language's names for months and days. Import from here instead of "date-fns" for
// anything that writes a date out; the arithmetic helpers are passed through unchanged.
import {
  format as dfFormat,
  formatDistanceToNow as dfDistance,
  formatDistanceToNowStrict as dfDistanceStrict,
} from "date-fns";
import { dateLocale } from "../i18n";

export * from "date-fns";

export const format = (date, pattern, options) => dfFormat(date, pattern, { locale: dateLocale(), ...options });
export const formatDistanceToNow = (date, options) => dfDistance(date, { locale: dateLocale(), ...options });
export const formatDistanceToNowStrict = (date, options) => dfDistanceStrict(date, { locale: dateLocale(), ...options });
