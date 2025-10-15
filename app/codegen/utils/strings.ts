export function sanitizeIdentifier(source: string): string {
  const cleaned = source.replace(/[^A-Za-z0-9_]/g, "_");
  const prefixed = /^[A-Za-z_]/.test(cleaned) ? cleaned : `_${cleaned}`;
  return prefixed.replace(/_+/g, "_");
}

export function numberLiteral(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`Cannot emit non-finite number: ${value}`);
  }

  if (Object.is(value, -0)) {
    return "-0.0";
  }

  if (Number.isInteger(value)) {
    return value.toFixed(1);
  }

  const text = value.toString();
  if (text.includes("e") || text.includes("E")) {
    return Number(value).toExponential(8);
  }

  return text;
}

export function indentLines(block: string, level = 1): string {
  const indent = "  ".repeat(Math.max(0, level));
  return block
    .split("\n")
    .map((line) => (line.length > 0 ? `${indent}${line}` : line))
    .join("\n");
}
