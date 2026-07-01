export interface MemoryVectorizer {
  readonly id: string;
  vectorize(text: string): readonly number[];
  similarity(left: readonly number[], right: readonly number[]): number;
}

/**
 * A tiny dependency-free relevance vectorizer. It is intentionally not sold as
 * a semantic embedding model: it hashes normalized word and bigram tokens into
 * a fixed local vector so Phase 7 can rank memories without running a heavy AI
 * model. A future embedding adapter can replace it behind the same interface.
 */
export class HashedTokenVectorizer implements MemoryVectorizer {
  readonly id = "hashed-token-v1";

  constructor(private readonly dimensions = 192) {}

  vectorize(text: string): readonly number[] {
    const vector = new Array<number>(this.dimensions).fill(0);
    const tokens = tokenize(text);
    const features = [...tokens];
    for (let index = 0; index + 1 < tokens.length; index += 1) {
      features.push(`${tokens[index]}_${tokens[index + 1]}`);
    }
    for (const feature of features) {
      const hash = fnv1a(feature);
      const slot = hash % this.dimensions;
      const sign = ((hash >>> 7) & 1) === 0 ? 1 : -1;
      vector[slot] += sign;
    }
    const length = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    return length > 0 ? vector.map(value => value / length) : vector;
  }

  similarity(left: readonly number[], right: readonly number[]): number {
    const length = Math.min(left.length, right.length);
    let dot = 0;
    for (let index = 0; index < length; index += 1) dot += left[index] * right[index];
    return Math.max(-1, Math.min(1, dot));
  }
}

export function normalizeMemoryText(text: string): string {
  return tokenize(text).join(" ");
}

function tokenize(text: string): string[] {
  return text
    .toLocaleLowerCase()
    .replace(/\bfavourite\b/g, "favorite")
    .replace(/\bfavourites\b/g, "favorites")
    .replace(/\bcolour\b/g, "color")
    .replace(/\bcolours\b/g, "colors")
    .replace(/[’']/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(token => token.length >= 2 && !STOP_WORDS.has(token));
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "but", "by", "for", "from",
  "has", "have", "he", "her", "his", "i", "in", "is", "it", "its", "me", "my",
  "of", "on", "or", "our", "she", "that", "the", "their", "them", "they", "this",
  "to", "was", "we", "were", "what", "when", "where", "which", "who", "will", "with",
  "you", "your",
]);
