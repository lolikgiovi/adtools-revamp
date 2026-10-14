# Monitoring domain failure modes (before implementation)
- Changed numeric values lose precision, or null and empty CLOB become equivalent.
- Planning writes untouched columns or treats new rows as updates.
- Cloning rewrites query text, loses children, aliases original objects, or copies compatibility rows.
- Legacy orphan fields disappear or unrelated duplicate orders block editing.
- Existing PK and parent changes bypass validation.
- Required values, precision, enum, length and chart requirements are missed.
- A restored in-flight submission becomes writable and is submitted twice.
Integration verification additionally covers locked conflicts, rollback, auditing and full CLOB round trips on LOCAL Oracle.
