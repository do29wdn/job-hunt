// Heavy DS implementations for pattern recognition & sorting

// Aho-Corasick automaton for multi-pattern substring search O(n + m + z)
export class AhoCorasick {
  private trie: Array<Map<string, number>> = [new Map()];
  private fail: number[] = [0];
  private output: Array<Set<string>> = [new Set()];
  private patterns: Map<string, string> = new Map(); // lower -> original

  constructor(patterns: string[]) {
    for (const p of patterns) {
      const lower = p.toLowerCase();
      this.patterns.set(lower, p);
      this.insert(lower);
    }
    this.build();
  }

  private insert(pattern: string): void {
    let node = 0;
    for (const ch of pattern) {
      const next = this.trie[node].get(ch);
      if (next !== undefined) {
        node = next;
      } else {
        const newNode = this.trie.length;
        this.trie[node].set(ch, newNode);
        this.trie.push(new Map());
        this.fail.push(0);
        this.output.push(new Set());
        node = newNode;
      }
    }
    this.output[node].add(pattern);
  }

  private build(): void {
    const queue: number[] = [];
    for (const [, node] of this.trie[0]) {
      this.fail[node] = 0;
      queue.push(node);
    }
    while (queue.length) {
      const r = queue.shift()!;
      for (const [ch, child] of this.trie[r]) {
        queue.push(child);
        let f = this.fail[r];
        while (f && !this.trie[f].has(ch)) f = this.fail[f];
        this.fail[child] = this.trie[f].get(ch) ?? 0;
        for (const pat of this.output[this.fail[child]]) this.output[child].add(pat);
      }
    }
  }

  search(text: string): Set<string> {
    const lower = text.toLowerCase();
    let node = 0;
    const found = new Set<string>();
    for (const ch of lower) {
      while (node && !this.trie[node].has(ch)) node = this.fail[node];
      node = this.trie[node].get(ch) ?? 0;
      for (const pat of this.output[node]) found.add(this.patterns.get(pat) ?? pat);
    }
    return found;
  }
}

// Levenshtein distance (DP) for fuzzy matching
export function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

export function fuzzyMatch(haystack: string, needle: string, maxDist = 2): boolean {
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  if (h.includes(n)) return true;
  // sliding window fuzzy
  const len = n.length;
  for (let i = 0; i <= h.length - len; i++) {
    const window = h.slice(i, i + len);
    if (levenshtein(window, n) <= maxDist) return true;
  }
  return false;
}

// Max-Heap for top-K sorting O(n log k) vs O(n log n)
export class MaxHeap<T> {
  private data: T[] = [];
  constructor(private compare: (a: T, b: T) => number) {}
  push(item: T): void {
    this.data.push(item);
    this.bubbleUp(this.data.length - 1);
  }
  private bubbleUp(i: number): void {
    while (i > 0) {
      const p = Math.floor((i - 1) / 2);
      if (this.compare(this.data[i], this.data[p]) <= 0) break;
      [this.data[i], this.data[p]] = [this.data[p], this.data[i]];
      i = p;
    }
  }
  pop(): T | undefined {
    if (!this.data.length) return undefined;
    const top = this.data[0];
    const end = this.data.pop()!;
    if (this.data.length) {
      this.data[0] = end;
      this.bubbleDown(0);
    }
    return top;
  }
  private bubbleDown(i: number): void {
    const n = this.data.length;
    while (true) {
      let largest = i;
      const l = 2 * i + 1, r = 2 * i + 2;
      if (l < n && this.compare(this.data[l], this.data[largest]) > 0) largest = l;
      if (r < n && this.compare(this.data[r], this.data[largest]) > 0) largest = r;
      if (largest === i) break;
      [this.data[i], this.data[largest]] = [this.data[largest], this.data[i]];
      i = largest;
    }
  }
  size(): number { return this.data.length; }
  sorted(): T[] {
    return [...this.data].sort((a, b) => this.compare(b, a));
  }
}

// Bloom filter-ish fingerprint for dedupe (hashing)
export function bloomHash(s: string, seeds = 3): string[] {
  const hashes: string[] = [];
  for (let seed = 0; seed < seeds; seed++) {
    let h = 2166136261 ^ seed;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i) + seed * 31;
      h = Math.imul(h, 16777619);
    }
    hashes.push((h >>> 0).toString(36));
  }
  return hashes;
}

// Jaccard similarity for dedupe titles
export function jaccard(a: string, b: string): number {
  const setA = new Set(a.toLowerCase().split(/\s+/));
  const setB = new Set(b.toLowerCase().split(/\s+/));
  const inter = [...setA].filter((x) => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : inter / union;
}
