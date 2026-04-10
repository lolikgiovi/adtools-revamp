import { getIconSvg as getAboutIconSvg } from "../pages/about/icon.js";
import { getIconSvg as getSettingsIconSvg } from "../pages/settings/icon.js";
import { getIconSvg as getSignoutIconSvg } from "../pages/signout/icon.js";
import { getIconSvg as getBase64IconSvg } from "../tools/base64-tools/icon.js";
import { getIconSvg as getCompareConfigIconSvg } from "../tools/compare-config/icon.js";
import { getIconSvg as getHtmlIconSvg } from "../tools/html-editor/icon.js";
import { getIconSvg as getImageCheckerIconSvg } from "../tools/image-checker/icon.js";
import { getIconSvg as getJsonIconSvg } from "../tools/json-tools/icon.js";
import { getIconSvg as getMasterLockeyIconSvg } from "../tools/master-lockey/icon.js";
import { getIconSvg as getMergeSqlIconSvg } from "../tools/merge-sql/icon.js";
import { getIconSvg as getQrIconSvg } from "../tools/qr-tools/icon.js";
import { getIconSvg as getQuickQueryIconSvg } from "../tools/quick-query/icon.js";
import { getIconSvg as getRunBatchIconSvg } from "../tools/run-batch/icon.js";
import { getIconSvg as getRunQueryIconSvg } from "../tools/run-query/icon.js";
import { getIconSvg as getSplunkIconSvg } from "../tools/splunk-template/icon.js";
import { getIconSvg as getSqlInIconSvg } from "../tools/sql-in-clause/icon.js";
import { getIconSvg as getTlvIconSvg } from "../tools/tlv-viewer/icon.js";
import { getIconSvg as getUuidIconSvg } from "../tools/uuid-generator/icon.js";

const ICON_REGISTRY = new Map([
  ["about", getAboutIconSvg],
  ["settings", getSettingsIconSvg],
  ["signout", getSignoutIconSvg],
  ["base64", getBase64IconSvg],
  ["database", getQuickQueryIconSvg],
  ["database-compare", getCompareConfigIconSvg],
  ["html", getHtmlIconSvg],
  ["image-check", getImageCheckerIconSvg],
  ["json", getJsonIconSvg],
  ["jenkins-batch", getRunBatchIconSvg],
  ["jenkins-query", getRunQueryIconSvg],
  ["language", getMasterLockeyIconSvg],
  ["merge-sql", getMergeSqlIconSvg],
  ["qr", getQrIconSvg],
  ["splunk-template", getSplunkIconSvg],
  ["sql-in", getSqlInIconSvg],
  ["tlv", getTlvIconSvg],
  ["uuid", getUuidIconSvg],
]);

const DEFAULT_ICON = () => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" xmlns="http://www.w3.org/2000/svg">
  <circle cx="12" cy="12" r="9" />
  <path d="M12 7v10" />
  <path d="M7 12h10" />
</svg>`;

export function getIconSvg(iconName) {
  const provider = ICON_REGISTRY.get(iconName);
  if (!provider) return DEFAULT_ICON();

  try {
    return provider();
  } catch (_) {
    return DEFAULT_ICON();
  }
}
