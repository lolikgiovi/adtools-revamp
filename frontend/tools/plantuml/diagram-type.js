// A bounded diagram kind for analytics, read from PlantUML structure only; diagram text never leaves the device.
const START_TYPES = { mindmap: "mindmap", gantt: "gantt", wbs: "wbs", json: "json", yaml: "yaml", salt: "salt" };

// Ordered: activity and state syntax also contain arrows, so the generic sequence check runs last.
const UML_TYPES = [
  ["activity", /^\s*(start|stop|end)\s*$|^\s*:[^\n]*;\s*$/m],
  ["state", /^\s*state\s|\[\*\]/m],
  ["class", /^\s*(class|interface|abstract|enum)\s/m],
  ["component", /^\s*(component|package|node|cloud)\s|^\s*\[[^\]*]+\]\s*$/m],
  ["usecase", /^\s*usecase\s|^\s*\([^)]+\)/m],
  ["sequence", /^\s*(participant|actor|boundary|control|entity|database|collections|queue)\s|^\s*[\w"]+\s*-+>+/m],
];

export function diagramType(source) {
  const text = String(source || "");
  const start = /@start(\w+)/.exec(text)?.[1]?.toLowerCase();
  if (start && START_TYPES[start]) return START_TYPES[start];
  return UML_TYPES.find(([, pattern]) => pattern.test(text))?.[0] || "other";
}
