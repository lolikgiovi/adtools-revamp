export function registrationRole(value, required = false) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new Error("Please select a role.");
    return null;
  }
  if (!["ANALYST", "ENGINEER"].includes(value)) throw new Error("Please select a valid role.");
  return value;
}
