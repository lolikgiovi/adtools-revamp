export function registrationDepartment(value, required = false) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new Error("Please select a department.");
    return null;
  }
  if (!["RETAIL", "SME", "NBDS", "ENTERPRISE", "PARTNERSHIP", "WHOLESALE"].includes(value))
    throw new Error("Please select a valid department.");
  return value;
}
