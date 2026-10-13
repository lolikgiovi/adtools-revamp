"""Reproduce discovery counts from the exported snapshot; no database access."""
import collections
import json
from pathlib import Path

root = Path(__file__).parent
raw = json.loads((root / 'config-snapshot-2026-10-12.json').read_text())
rows = next(iter(raw.values())) if isinstance(raw, dict) else raw
data = {row['SECTION']: json.loads(row['PAYLOAD']) if row['PAYLOAD'] else [] for row in rows}
for table, records in data.items():
    print(f'{table}: {len(records)}')
for child, fk, parent, pk in [
    ('DSH_SUMMARY_FIELD', 'GROUP_ID', 'DSH_SUMMARY_GROUP', 'GROUP_ID'),
    ('DSH_DETAIL_COLUMN', 'TABLE_ID', 'DSH_DETAIL_TABLE', 'TABLE_ID'),
]:
    parent_ids = {row[pk] for row in data[parent]}
    orphans = [row for row in data[child] if row[fk] not in parent_ids]
    print(f'{child} orphans: {len(orphans)}; {dict(collections.Counter(row[fk] for row in orphans))}')
for table, parent in [
    ('DSH_SUMMARY_GROUP', 'MENU_ID'), ('DSH_DETAIL_TABLE', 'MENU_ID'),
    ('DSH_SUMMARY_FIELD', 'GROUP_ID'), ('DSH_DETAIL_COLUMN', 'TABLE_ID'),
]:
    counts = collections.Counter((row[parent], row['DISPLAY_ORDER']) for row in data[table])
    print(f'{table} duplicate order slots: {[(key, count) for key, count in counts.items() if count > 1]}')
