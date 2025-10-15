const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
const DEFAULT_LENGTH = 12;

export function nanoid(length: number = DEFAULT_LENGTH): string {
  const targetLength = Math.max(4, Math.min(length, 32));
  const buffer = new Uint8Array(targetLength);
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    crypto.getRandomValues(buffer);
  } else {
    for (let i = 0; i < targetLength; i++) {
      buffer[i] = Math.floor(Math.random() * 256);
    }
  }

  let id = "";
  for (const value of buffer) {
    id += ALPHABET[value % ALPHABET.length];
  }
  return id;
}
