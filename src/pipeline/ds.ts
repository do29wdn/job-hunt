export class AhoCorasick {
    private trie: Array<Map<string, number>> = [new Map()];
    private fail: number[] = [0];
    private output: Array<Set<string>> = [new Set()];
    private patterns: Map<string, string> = new Map();
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
            }
            else {
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
                while (f && !this.trie[f].has(ch))
                    f = this.fail[f];
                this.fail[child] = this.trie[f].get(ch) ?? 0;
                for (const pat of this.output[this.fail[child]])
                    this.output[child].add(pat);
            }
        }
    }
    search(text: string): Set<string> {
        const lower = text.toLowerCase();
        let node = 0;
        const found = new Set<string>();
        for (const ch of lower) {
            while (node && !this.trie[node].has(ch))
                node = this.fail[node];
            node = this.trie[node].get(ch) ?? 0;
            for (const pat of this.output[node])
                found.add(this.patterns.get(pat) ?? pat);
        }
        return found;
    }
}
export function levenshtein(a: string, b: string): number {
    const m = a.length, n = b.length;
    if (m === 0)
        return n;
    if (n === 0)
        return m;
    const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++)
        dp[i][0] = i;
    for (let j = 0; j <= n; j++)
        dp[0][j] = j;
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
    if (h.includes(n))
        return true;
    const len = n.length;
    for (let i = 0; i <= h.length - len; i++) {
        const window = h.slice(i, i + len);
        if (levenshtein(window, n) <= maxDist)
            return true;
    }
    return false;
}
export function jaccard(a: string, b: string): number {
    const setA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
    const setB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
    const inter = [...setA].filter((x) => setB.has(x)).length;
    const union = new Set([...setA, ...setB]).size;
    return union === 0 ? 0 : inter / union;
}
