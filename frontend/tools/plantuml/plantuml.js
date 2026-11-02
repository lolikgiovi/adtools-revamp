// Adapted from lolikgiovi/plantuml at 74bc3e7.
const colorRows = [
  {
    label: "Bolder",
    suffix: "_BOLDER",
    colors: ["#AE2E24", "#A54900", "#946F01", "#4B6B1F", "#226F4E", "#216B83", "#0054CB", "#943D72", "#5E4DB1"],
  },
  {
    label: "Default",
    suffix: "",
    colors: ["#CA372C", "#C35100", "#CE9E05", "#5A7F24", "#21835A", "#227D9B", "#0F66E4", "#AD4887", "#6E5DC5"],
  },
  {
    label: "Subtle",
    suffix: "_SUBTLE",
    colors: ["#F87169", "#FEA263", "#F4CD47", "#699A23", "#23A06B", "#2998BD", "#1E7AFD", "#CE519D", "#826FDC"],
  },
  {
    label: "Subtlest",
    suffix: "_SUBTLEST",
    colors: ["#FFD5D2", "#FEDEC7", "#F8E5A0", "#D3F1A6", "#B9F4DC", "#C5ECFB", "#CCE0FF", "#FDD0EC", "#DFD8FD"],
  },
];
const colorNames = ["RED", "ORANGE", "YELLOW", "LIME", "GREEN", "TEAL", "BLUE", "PINK", "PURPLE"];
const confluencePalette =
  colorRows
    .map((row, i) =>
      [
        "' =========================",
        `' Row ${i + 1} \u2013 ${row.label}`,
        "' =========================",
        ...colorNames.map((name, index) => `!define ${`COLOR_${name}${row.suffix}`.padEnd(24)}${row.colors[index]}`),
      ].join("\n"),
    )
    .join("\n\n") + "\n\n'''''''''''''''''''''''''''''''''''''''''''''''''\n";
const sequenceTemplate = `@startuml POST /v1/example
title POST /v1/example

${confluencePalette}
' =========================
' Diagram participants
' =========================
actor Requestor as requestor #DeepSkyBlue

box "Microservice" #PowderBlue
  control "service" as service #DeepSkyBlue
  database "config" as config #DeepSkyBlue
endbox

' =========================
' Formatting options
' =========================
hide footbox
'autonumber

skinparam defaultFontName Comic Sans MS
skinparam sequence {
  ParticipantFontSize 15
  ActorFontSize 15
  ArrowFontName Comic Sans MS
  ParticipantFontName Comic Sans MS
}

' =========================
' Microservice logic
' =========================
requestor -> service : request
activate service

group Get Config
  service -> config++ : findConfigByParameterKeysAndIsDeletedFalse()
  note right of service
    Parameter keys:
    * application.feature.enabled
    * application.timeout.seconds

    SELECT parameter_key, parameter_value
    FROM config
    WHERE parameter_key IN (:parameterKeys)
    AND is_deleted = 0;
  end note
  config --> service-- : configResponse

  break IF any config key is missing
    service --> requestor : HTTP 500, code: 80000
  end break
end group

service --> requestor : HTTP 200
deactivate service
@enduml
`;
const starterSequence = sequenceTemplate;
const classTemplate = `@startuml
skinparam classAttributeIconSize 0

class Workspace {
  +id: String
  +name: String
  +open()
}

class Diagram {
  +name: String
  +source: String
  +render(): SVG
}

Workspace "1" *-- "many" Diagram
@enduml
`;
function formatPlantUml(source, indent = "  ") {
  if (/^\s*@start(?!uml(?:\s|$))\w+/im.test(source)) return source;
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  let depth = 0;
  let protectedEnd = null;
  let multilineComment = false;
  const output = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (protectedEnd) {
      output.push(raw);
      if (protectedEnd.test(line)) protectedEnd = null;
      continue;
    }
    if (multilineComment) {
      output.push(raw);
      if (line.includes("'/")) multilineComment = false;
      continue;
    }
    if (/^\/'/.test(line)) {
      output.push(raw);
      multilineComment = !line.slice(2).includes("'/");
      continue;
    }
    if (/^:[^;]*$/.test(line)) {
      protectedEnd = /;$/;
      output.push(raw);
      continue;
    }
    if (!line) {
      output.push("");
      continue;
    }
    if (
      /^(?:note|hnote|rnote|legend|title|header|footer|caption)(?:\s|$)/i.test(line) &&
      !line.includes(":") &&
      !/^(?:title|caption)\s+\S/i.test(line)
    ) {
      const kind = line.split(/\s/)[0].toLowerCase();
      const end = /^(?:hnote|rnote)$/.test(kind) ? "(?:h?note|rnote)" : kind;
      protectedEnd = new RegExp(`^end\\s*${end}$`, "i");
      output.push(indent.repeat(depth) + line);
      continue;
    }
    if (/^!/.test(line) || /^'/.test(line)) {
      output.push(indent.repeat(depth) + raw.trimEnd().trimStart());
      continue;
    }
    const closes =
      /^(?:end(?:\s+(?:box|fork|split|group|partition))?|endbox|endif|endwhile|endswitch|repeat\s+while)\b/i.test(line) || /^}/.test(line);
    const branch = /^(?:else|elseif|case|fork\s+again|split\s+again)\b/i.test(line);
    if (closes || branch) depth = Math.max(0, depth - 1);
    output.push(indent.repeat(depth) + line);
    const opens =
      /^(?:alt|opt|loop|par|break|critical|group|box|partition|fork|split|repeat)\b/i.test(line) ||
      /^(?:if|while|switch)\s*\(/i.test(line) ||
      /{\s*$/.test(line);
    if (opens || branch) depth++;
  }
  return output.join("\n").replace(/\n*$/, "\n");
}
export { classTemplate, colorNames, colorRows, confluencePalette, formatPlantUml, sequenceTemplate, starterSequence };
