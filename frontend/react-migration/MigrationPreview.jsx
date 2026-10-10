import React, { useEffect, useState } from "react";
import { UUIDGenerator } from "./UUIDGenerator.jsx";
import { LegacyToolHost } from "./LegacyToolHost.jsx";

const routes = [
  { id: "uuid-generator", label: "UUID Generator", kind: "react" },
  { id: "json-tools", label: "JSON Tools", kind: "legacy" },
];

function readRoute() {
  const route = window.location.hash.slice(1);
  return routes.some((entry) => entry.id === route) ? route : "uuid-generator";
}

export function MigrationPreview() {
  const [route, setRoute] = useState(readRoute);

  useEffect(() => {
    window.addEventListener("hashchange", setRouteFromHash);
    return () => window.removeEventListener("hashchange", setRouteFromHash);
  }, []);

  function setRouteFromHash() {
    setRoute(readRoute());
  }

  const current = routes.find((entry) => entry.id === route);

  return (
    <div className="migration-shell">
      <aside className="migration-sidebar" aria-label="Migration preview navigation">
        <strong>AD Tools · React preview</strong>
        <nav aria-label="Tools">
          {routes.map((entry) => (
            <a key={entry.id} href={`#${entry.id}`} aria-current={route === entry.id ? "page" : undefined}>
              {entry.label}
            </a>
          ))}
        </nav>
      </aside>
      <main className="migration-content">
        <header className="migration-header">
          <h1>{current.label}</h1>
          <span>{current.kind === "react" ? "React route" : "Legacy route"}</span>
        </header>
        {route === "uuid-generator" ? <UUIDGenerator /> : <LegacyToolHost toolId={route} />}
      </main>
    </div>
  );
}
