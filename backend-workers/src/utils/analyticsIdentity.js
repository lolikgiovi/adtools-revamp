export const OWNER_ANALYTICS_EMAIL = "fashalli.bilhaq@bankmandiri.co.id";
export const DEVELOPMENT_ANALYTICS_EMAIL = "dev@localhost";

const EXCLUDED_ANALYTICS_EMAIL_SQL = [OWNER_ANALYTICS_EMAIL, DEVELOPMENT_ANALYTICS_EMAIL]
  .map((email) => `'${email.replaceAll("'", "''")}'`)
  .join(", ");

export function includedAnalyticsEmailSql(column) {
  return `LOWER(TRIM(COALESCE(${column}, ''))) NOT IN (${EXCLUDED_ANALYTICS_EMAIL_SQL})`;
}
