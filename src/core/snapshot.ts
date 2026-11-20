import { CoreIssue } from "./diagnostics";

/** Canonical JSON for the plain JSON input DTO (RFC 8785 key order and ECMAScript scalar serialization). */
export function canonicalSnapshot(value: unknown): string {
  if (Array.isArray(value)) return "[" + Array.from(value, canonicalSnapshot).join(",") + "]";
  if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return "{" + entries.map(([k, v]) => canonicalSnapshot(k) + ":" + canonicalSnapshot(v)).join(",") + "}";
  }
  if (typeof value === "string") {
    if (/[\uD800-\uDFFF]/u.test(value)) throw new TypeError("Unpaired surrogate in snapshot");
  } else if (
    value !== null &&
    typeof value !== "boolean" &&
    !(typeof value === "number" && Number.isFinite(value))
  ) {
    throw new TypeError("Expected a JSON scalar");
  }
  return JSON.stringify(value);
}

export async function digestCanonical(json: string): Promise<string> {
  if (!globalThis.crypto?.subtle)
    throw new CoreIssue(
      "resource",
      "digest-unavailable",
      "Для хеша снимка требуется Web Crypto в защищённом контексте.",
      { field: "inputDigest" },
      {},
      "DIGEST_UNAVAILABLE",
    );
  const bytes = new TextEncoder().encode(json);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function snapshotDigest(inputs: unknown): Promise<string> {
  return digestCanonical(canonicalSnapshot(inputs));
}
