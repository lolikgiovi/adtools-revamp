export function getIconSvg() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" xmlns="http://www.w3.org/2000/svg">
    <rect x="2" y="3" width="8" height="6" rx="1.5"/><rect x="14" y="15" width="8" height="6" rx="1.5"/>
    <path d="M6 9v9h8M10 6h8v9"/>
  </svg>`;
}

// Lucide-style geometry, matching the original PlantUML Workbench's icon vocabulary.
const workbenchPaths = {
  chevronRight: '<path d="m9 6 6 6-6 6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  files: '<path d="M15 2H6a2 2 0 0 0-2 2v12"/><rect x="8" y="6" width="12" height="16" rx="2"/>',
  sidebar: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18m7-13-4 4 4 4"/>',
  sidebarClosed: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18m3-13 4 4-4 4"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  filePlus: '<path d="M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v4m10-6v6h6M3 15h6m-3-3v6"/>',
  folderPlus: '<path d="M20 20H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2m-8-10v6m-3-3h6"/>',
  folder: '<path d="M20 20H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Zm0 0v6h6M8 13h8m-8 4h6"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M12 3v12m-5-7 5-5 5 5"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M12 3v12m-5-5 5 5 5-5"/>',
  format: '<path d="m16 3 5 5L8 21l-5-5ZM14 5l5 5M3 3v4m-2-2h4m14 12v4m-2-2h4"/>',
  palette:
    '<circle cx="8" cy="8" r=".5"/><circle cx="12" cy="6" r=".5"/><circle cx="16" cy="8" r=".5"/><path d="M12 22a10 10 0 1 1 10-10 4 4 0 0 1-4 4h-2a2 2 0 0 0-1 3.7A1.3 1.3 0 0 1 14 22Z"/>',
  preview: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18m-7-13 4 4-4 4"/>',
  previewClosed: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18m-4-13-4 4 4 4"/>',
  maximize: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  restore: '<path d="M3 8h5V3m8 0v5h5M8 21v-5H3m18 0h-5v5"/>',
  close: '<path d="m18 6-12 12M6 6l12 12"/>',
  restart: '<path d="M3 10a9 9 0 1 1 3 9M3 3v7h7"/>',
  commands:
    '<rect x="3" y="3" width="6" height="6" rx="3"/><rect x="15" y="3" width="6" height="6" rx="3"/><rect x="3" y="15" width="6" height="6" rx="3"/><rect x="15" y="15" width="6" height="6" rx="3"/><path d="M9 6h6M6 9v6m3 3h6m3-9v6"/>',
};

export function workbenchIcon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${workbenchPaths[name] || ""}</svg>`;
}
