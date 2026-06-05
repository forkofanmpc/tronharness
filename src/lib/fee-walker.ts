import type { FeeFieldMatch } from "./types.js";

const FEE_KEY_PATTERN =
  /fee|gas|energy|resource|limit|price|sponsor|delegate|bandwidth|stake/i;

/** Deep-walk JSON and collect keys matching fee/resource patterns. */
export function walkFeeRelatedFields(
  obj: unknown,
  path = "",
  matches: FeeFieldMatch[] = [],
): FeeFieldMatch[] {
  if (obj === null || obj === undefined) {
    return matches;
  }

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      walkFeeRelatedFields(obj[i], `${path}[${i}]`, matches);
    }
    return matches;
  }

  if (typeof obj === "object") {
    for (const [key, value] of Object.entries(obj)) {
      const currentPath = path ? `${path}.${key}` : key;
      if (FEE_KEY_PATTERN.test(key)) {
        matches.push({ path: currentPath, key, value });
      }
      walkFeeRelatedFields(value, currentPath, matches);
    }
  }

  return matches;
}
