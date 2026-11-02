// Failure cases: model tab width drift; note body corruption; branches nesting incorrectly;
// preprocessor blocks ignored; braces in strings/comments/labels; switch cases and fork branches;
// multiline activities; multiple diagrams; non-UML formats; non-idempotence; deeply nested inputs.
export const formatFixtures = [
  {
    name: "literal error text is a valid diagram label",
    source: "@startuml\nA -> B: Syntax Error\n@enduml",
    expected: "@startuml\nA -> B: Syntax Error\n@enduml\n",
  },
  {
    name: "nested sequence with notes and else",
    source:
      "@startuml\ngroup Request\nalt valid\nA -> B: {payload}\nnote right of B\n  SELECT id\n    FROM config\nend note\nelse invalid\nloop Retry\nB --> A: Failed\nend\nend\nend\n@enduml",
    expected:
      "@startuml\ngroup Request\n  alt valid\n    A -> B: {payload}\n    note right of B\n      SELECT id\n        FROM config\n    end note\n  else invalid\n    loop Retry\n      B --> A: Failed\n    end\n  end\nend\n@enduml\n",
  },
  {
    name: "preprocessor function and conditionals",
    source:
      '@startuml\n!function $label($x)\n!if $x == 1\n!return "yes"\n!else\n!return "no"\n!endif\n!endfunction\nA -> B: $label(1)\n@enduml',
    expected:
      '@startuml\n!function $label($x)\n  !if $x == 1\n    !return "yes"\n  !else\n    !return "no"\n  !endif\n!endfunction\nA -> B: $label(1)\n@enduml\n',
  },
  {
    name: "activity switch and parallel branches",
    source:
      "@startuml\nstart\nswitch (route)\ncase (a)\nfork\n:One;\nfork again\n:Two;\nend fork\ncase (b)\n:Fallback;\nendswitch\nstop\n@enduml",
    expected:
      "@startuml\nstart\nswitch (route)\n  case (a)\n    fork\n      :One;\n    fork again\n      :Two;\n    end fork\n  case (b)\n    :Fallback;\nendswitch\nstop\n@enduml\n",
  },
  {
    name: "quoted and commented braces with inline notes",
    source:
      '@startuml\npackage "API {v1}" {\nclass A {\n+run(): void\n}\nclass B\nnote right of A: {literal}\nA --> B: contains {\n}\nA --> B\n@enduml',
    expected:
      '@startuml\npackage "API {v1}" {\n  class A {\n    +run(): void\n  }\n  class B\n  note right of A: {literal}\n  A --> B: contains {\n}\nA --> B\n@enduml\n',
  },
  {
    name: "one-line headers and protected comment",
    source:
      "@startuml\nheader A page header\nfooter Page 1\n/' keep {\n  exact indentation\n'/\ngroup Test ' {\nA -> B: test\nend\n@enduml",
    expected:
      "@startuml\nheader A page header\nfooter Page 1\n/' keep {\n  exact indentation\n'/\ngroup Test ' {\n  A -> B: test\nend\n@enduml\n",
  },
  {
    name: "multiple diagrams reset nesting",
    source: "@startuml\nclass A {\n+x\n}\n@enduml\n@startuml\nA -> B: hello\n@enduml",
    expected: "@startuml\nclass A {\n  +x\n}\n@enduml\n@startuml\nA -> B: hello\n@enduml\n",
  },
  {
    name: "multiline activity and nested repeat",
    source:
      "@startuml\nstart\nrepeat\n:First line\n  second line;\nif (valid?) then (yes)\n:Accept;\nelse (no)\n:Retry;\nendif\nrepeat while (again?)\nstop\n@enduml",
    expected:
      "@startuml\nstart\nrepeat\n  :First line\n    second line;\n  if (valid?) then (yes)\n    :Accept;\n  else (no)\n    :Retry;\n  endif\nrepeat while (again?)\nstop\n@enduml\n",
  },
  {
    name: "non-UML source remains untouched",
    source: '@startjson\n{ "nested": { "x": 1 } }\n@endjson',
    expected: '@startjson\n{ "nested": { "x": 1 } }\n@endjson',
  },
];
for (const depth of [4, 12, 32]) {
  formatFixtures.push({
    name: `nested sequence depth ${depth}`,
    source: ["@startuml", ...Array(depth).fill("group Nested"), "A -> B: Done", ...Array(depth).fill("end"), "@enduml"].join("\n"),
    expected: [
      "@startuml",
      ...Array.from({ length: depth }, (_, i) => "  ".repeat(i) + "group Nested"),
      "  ".repeat(depth) + "A -> B: Done",
      ...Array.from({ length: depth }, (_, i) => "  ".repeat(depth - i - 1) + "end"),
      "@enduml",
      "",
    ].join("\n"),
  });
}
