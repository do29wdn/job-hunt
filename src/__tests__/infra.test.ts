import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile, rm, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadDotEnv, isDryRun } from "../env.js";
import { loadSeenJobs, saveSeenJobs } from "../storage/seen-jobs.js";
import { loadHealth, saveHealth, recordSuccess, recordFail, isDisabled } from "../pipeline/health.js";
import { escapeAttr, escapeHtml, decodeEntities, stripHtml, pLimit, fetchJson } from "../utils.js";
const tmp = join(tmpdir(), `job-hunter-tests-${Date.now()}`);
await mkdir(tmp, { recursive: true });
test("loadDotEnv: parses values, quotes, comments; never overrides real env", async () => {
    const envPath = join(tmp, "test.env");
    await writeFile(envPath, [
        "# comment line",
        "TEST_A=plain",
        'TEST_B="quoted value"',
        "TEST_C='single quoted'",
        "export TEST_D=exported",
        "TEST_E=value # trailing comment",
        "not-a-valid-line",
        "",
    ].join("\n"), "utf-8");
    const prevA = process.env.TEST_A;
    process.env.TEST_A = "from-real-env";
    try {
        await loadDotEnv(envPath);
        assert.equal(process.env.TEST_A, "from-real-env");
        assert.equal(process.env.TEST_B, "quoted value");
        assert.equal(process.env.TEST_C, "single quoted");
        assert.equal(process.env.TEST_D, "exported");
        assert.equal(process.env.TEST_E, "value");
    }
    finally {
        if (prevA === undefined)
            delete process.env.TEST_A;
        else
            process.env.TEST_A = prevA;
        for (const k of ["TEST_B", "TEST_C", "TEST_D", "TEST_E"])
            delete process.env[k];
    }
});
test("loadDotEnv: missing file is a no-op", async () => {
    await loadDotEnv(join(tmp, "does-not-exist.env"));
    assert.ok(true);
});
test("isDryRun", () => {
    const prev = process.env.DRY_RUN;
    process.env.DRY_RUN = "false";
    assert.equal(isDryRun(), false);
    process.env.DRY_RUN = "true";
    assert.equal(isDryRun(), true);
    if (prev === undefined)
        delete process.env.DRY_RUN;
    else
        process.env.DRY_RUN = prev;
});
test("seen-jobs: double-space fingerprint ids are migrated on load", async () => {
    const path = join(tmp, "seen.json");
    await writeFile(path, JSON.stringify([
        {
            id: "vercel|security software engineer iam|remote  united states",
            source: "watchlist:greenhouse:vercel",
            title: "Security Software Engineer, IAM",
            company: "vercel",
            url: "https://job-boards.greenhouse.io/vercel/jobs/1",
            firstSeenAt: "2026-08-30T00:00:00.000Z",
        },
    ]), "utf-8");
    const seen = await loadSeenJobs(path);
    assert.ok(seen.has("vercel|security software engineer iam|remote united states"));
    const { fingerprint } = await import("../pipeline/normalize.js");
    assert.ok(seen.has(fingerprint({
        company: "Vercel",
        title: "Security Software Engineer, IAM",
        location: "Remote - United States",
    })));
});
test("seen-jobs: persistence strips descriptions (repo-bloat fix)", async () => {
    const path = join(tmp, "seen2.json");
    const seen = new Map([
        [
            "acme|software engineer|pune india",
            {
                id: "acme|software engineer|pune india",
                source: "greenhouse:acme",
                title: "Software Engineer",
                company: "acme",
                url: "https://x/1",
                firstSeenAt: "2026-09-01T00:00:00.000Z",
                lastSeenAt: "2026-09-01T00:00:00.000Z",
                description: "x".repeat(8000),
                score: 72,
                reasons: ["Role title matches preferences"],
            } as any,
        ],
    ]);
    await saveSeenJobs(path, seen);
    const raw = JSON.parse(await readFile(path, "utf-8"));
    assert.equal(raw[0].description, undefined);
    assert.equal(raw[0].score, 72);
});
test("health: 3 consecutive fails auto-disable, success re-enables", async () => {
    const store: Record<string, any> = {};
    recordFail(store, "greenhouse:broken", "boom", 100);
    recordFail(store, "greenhouse:broken", "boom", 100);
    assert.equal(isDisabled(store["greenhouse:broken"]), false);
    recordFail(store, "greenhouse:broken", "boom", 100);
    assert.equal(isDisabled(store["greenhouse:broken"]), true);
    recordSuccess(store, "greenhouse:broken", 5, 50);
    assert.equal(isDisabled(store["greenhouse:broken"]), false);
});
test("health: path comes from config (healthPath), save + load round-trip", async () => {
    const path = join(tmp, "health.json");
    const store: Record<string, any> = {};
    recordSuccess(store, "ashby:notion", 40, 123);
    await saveHealth(store, path);
    const loaded = await loadHealth(path);
    assert.equal(loaded["ashby:notion"].success, 1);
});
test("escapeAttr escapes quotes for href attributes", () => {
    assert.equal(escapeAttr('a"b<c'), "a&quot;b&lt;c");
    assert.equal(escapeAttr("it's"), "it&#39;s");
    assert.equal(escapeHtml("a<b>&c"), "a&lt;b&gt;&amp;c");
});
test("decodeEntities / stripHtml clean ATS HTML", () => {
    assert.equal(decodeEntities("Equal&nbsp;Opportunity &amp; Accommodations"), "Equal Opportunity & Accommodations");
    assert.equal(stripHtml("<p>Hello <b>World</b>  &#x27;</p>"), "Hello World '");
});
test("pLimit actually limits concurrency", async () => {
    const limit = pLimit(3);
    let active = 0;
    let maxActive = 0;
    const tasks = Array.from({ length: 12 }, () => limit(async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 10));
        active--;
    }));
    await Promise.all(tasks);
    assert.ok(maxActive <= 3, `max concurrency was ${maxActive}`);
    assert.ok(maxActive >= 2, "tasks should have run in parallel");
});
test("fetchJson returns null for unreachable hosts (timeout/error path)", async () => {
    const res = await fetchJson("http://127.0.0.1:1/definitely-not-listening", { timeoutMs: 3000 });
    assert.equal(res, null);
});
test("cleanup temp dir", async () => {
    await rm(tmp, { recursive: true, force: true });
    assert.ok(true);
});
