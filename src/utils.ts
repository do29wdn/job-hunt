export function includesCI(haystack: string, needle: string): boolean {
    return haystack.toLowerCase().includes(needle.toLowerCase());
}
export function containsAny(haystack: string, needles: string[]): boolean {
    const h = haystack.toLowerCase();
    return needles.some((n) => h.includes(n.toLowerCase()));
}
export async function fetchJson<T>(url: string, init?: RequestInit & {
    timeoutMs?: number;
}): Promise<T | null> {
    const { timeoutMs = 15000, ...rest } = init ?? {};
    try {
        const res = await fetch(url, {
            ...rest,
            headers: { Accept: "application/json", ...(rest.headers as Record<string, string> | undefined) },
            signal: rest.signal ?? AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) {
            console.warn(`[fetch] ${url} HTTP ${res.status}`);
            return null;
        }
        return (await res.json()) as T;
    }
    catch (e) {
        console.warn(`[fetch] ${url} failed`, e instanceof Error ? e.message : e);
        return null;
    }
}
export function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
export function escapeAttr(s: string): string {
    return escapeHtml(s).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
const NAMED_ENTITIES: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
};
export function decodeEntities(s: string): string {
    return s
        .replace(/&#(\d+);/g, (_m: string, d: string) => {
        try {
            return String.fromCodePoint(Number(d));
        }
        catch {
            return String.fromCharCode(Number(d) & 0xffff);
        }
    })
        .replace(/&#[xX]([0-9a-fA-F]+);/g, (m: string, h: string) => {
        try {
            return String.fromCodePoint(parseInt(h, 16));
        }
        catch {
            return m;
        }
    })
        .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (m: string, e: string) => NAMED_ENTITIES[e] ?? m);
}
export function stripHtml(s: string | undefined): string | undefined {
    if (!s)
        return undefined;
    const out = decodeEntities(s.replace(/<[^>]*>/g, " "))
        .replace(/\s+/g, " ")
        .trim();
    return out || undefined;
}
export function pLimit(concurrency: number) {
    const limit = Math.max(1, concurrency | 0);
    let active = 0;
    const queue: Array<() => void> = [];
    const release = () => {
        active--;
        const next = queue.shift();
        if (next) {
            active++;
            next();
        }
    };
    return <T>(fn: () => Promise<T>): Promise<T> => new Promise<T>((resolve, reject) => {
        const run = () => {
            try {
                fn().then(resolve, reject).finally(release);
            }
            catch (e) {
                release();
                reject(e);
            }
        };
        if (active < limit) {
            active++;
            run();
        }
        else {
            queue.push(run);
        }
    });
}
