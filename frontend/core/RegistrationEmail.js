export function isRegistrationEmailAllowed(email) {
  return typeof email === "string" && /^[^@\s]+@bankmandiri\.co\.id$/i.test(email.trim());
}
