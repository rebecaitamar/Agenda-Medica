/** Color de identificación de cada especialidad (verde salvia / celeste), según su orden. */
const TONES = [
  { dot: "bg-sage-700", soft: "bg-sage-50", border: "border-sage-200", text: "text-sage-800", chip: "bg-sage-100 text-sage-800" },
  { dot: "bg-sky-700", soft: "bg-sky-50", border: "border-sky-100", text: "text-sky-700", chip: "bg-sky-100 text-sky-700" },
];

export function toneFor(index: number) {
  return TONES[index % TONES.length];
}
