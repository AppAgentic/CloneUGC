import { createHash } from "node:crypto";

function encode(value: unknown, path: string): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${path} contains a non-finite number`);
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item, index) => encode(item, `${path}[${index}]`)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => {
        const item = record[key];
        if (item === undefined) {
          throw new TypeError(`${path}.${key} is undefined`);
        }
        return `${JSON.stringify(key)}:${encode(item, `${path}.${key}`)}`;
      });
    return `{${entries.join(",")}}`;
  }
  throw new TypeError(`${path} contains unsupported value type ${typeof value}`);
}

export function canonicalJson(value: unknown): string {
  return encode(value, "$root");
}

export function contentHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
