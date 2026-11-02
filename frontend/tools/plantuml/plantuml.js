import { formatPlantUml } from "./formatter.js";

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
export { classTemplate, colorNames, colorRows, confluencePalette, formatPlantUml, sequenceTemplate, starterSequence };
