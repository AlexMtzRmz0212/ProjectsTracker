import {
  BookOpen, Briefcase, Camera, Code, Coffee, Cpu, Database, Dumbbell, Film,
  FlaskConical, Folder, Gamepad2, Globe, GraduationCap, Hammer, Heart, Leaf,
  Lightbulb, Music, Palette, PenTool, Rocket, Smartphone, Wrench,
} from "lucide-react";

// Printing inks: mid-tones dark enough to carry paper-colored text when filled,
// and calm enough to sit on buff paper or the green ledger cover.
export const PROJECT_COLORS = [
  "#2f5d8a", // prussian
  "#4b4f9c", // indigo
  "#267270", // teal
  "#3a744b", // viridian
  "#66701f", // olive
  "#8f6416", // ochre
  "#a9542e", // sienna
  "#a63d55", // madder
  "#7a4a78", // plum
  "#56606b", // slate
];

// v1 offered neon hues and projects keep the hex they were saved with, so each
// old hue is shown as its nearest ink. Saving the project stores the ink.
// Fuchsia has no close ink; slate keeps it distinct from plum.
const LEGACY_INKS = {
  "#8b5cf6": "#7a4a78", // violet → plum
  "#6366f1": "#4b4f9c", // indigo → indigo
  "#0ea5e9": "#2f5d8a", // sky → prussian
  "#06b6d4": "#267270", // cyan → teal
  "#10b981": "#3a744b", // emerald → viridian
  "#84cc16": "#66701f", // lime → olive
  "#f59e0b": "#8f6416", // amber → ochre
  "#f97316": "#a9542e", // orange → sienna
  "#f43f5e": "#a63d55", // rose → madder
  "#d946ef": "#56606b", // fuchsia → slate
};

export function inkFor(color) {
  return LEGACY_INKS[color?.toLowerCase()] ?? color;
}

/** Paper-colored text for anything filled with a project ink. */
export const ON_INK = "#f8f2df";

// Stored on the project by key, so renaming an import never breaks saved data.
export const PROJECT_ICONS = {
  folder: Folder,
  code: Code,
  rocket: Rocket,
  palette: Palette,
  pen: PenTool,
  book: BookOpen,
  school: GraduationCap,
  flask: FlaskConical,
  cpu: Cpu,
  database: Database,
  phone: Smartphone,
  globe: Globe,
  briefcase: Briefcase,
  idea: Lightbulb,
  hammer: Hammer,
  wrench: Wrench,
  music: Music,
  camera: Camera,
  film: Film,
  game: Gamepad2,
  fitness: Dumbbell,
  heart: Heart,
  leaf: Leaf,
  coffee: Coffee,
};

export function iconFor(key) {
  return PROJECT_ICONS[key] ?? Folder;
}

/** Translucent version of a hex color, via color-mix so it works with any input. */
export function tint(color, percent) {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
}

/** A project ink used as a glyph or line: lifted toward the text color in dark
 *  mode (--ink-lift) so mid-tone inks stay legible on the dark cover. */
export function inkText(color) {
  return `color-mix(in srgb, ${color}, var(--text) var(--ink-lift))`;
}
