"""Bridge between job-hunter (Node) and python-jobspy.

Usage: python3 scripts/jobspy_bridge.py <opts.json> <out.json>

Design notes:
- Config is read from a JSON FILE, never interpolated into a shell string, so a
  malicious/typo'd config value can never become a shell command.
- Errors exit non-zero so the Node side records a board FAILURE — the self-healing
  health system can then auto-disable a persistently broken source.
- Temp files are cleaned up by the Node caller.
"""

import json
import math
import sys


def main() -> int:
    opts_path, out_path = sys.argv[1], sys.argv[2]
    try:
        with open(opts_path, "r", encoding="utf-8") as f:
            opts = json.load(f)

        from jobspy import scrape_jobs

        kwargs = {
            k: v
            for k, v in {
                "site_name": opts.get("site"),
                "search_term": opts.get("searchTerm"),
                "location": opts.get("location"),
                "results_wanted": opts.get("resultsWanted", 20),
                "hours_old": opts.get("hoursOld", 72),
                "country_indeed": opts.get("countryIndeed", "India"),
                "is_remote": bool(opts.get("isRemote", False)),
            }.items()
            if v is not None
        }
        jobs = scrape_jobs(verbose=0, **kwargs)

        # jobspy returns a pandas DataFrame
        data = jobs.to_dict(orient="records") if hasattr(jobs, "to_dict") else []

        # JSON has no NaN
        for rec in data:
            for key, val in list(rec.items()):
                if isinstance(val, float) and math.isnan(val):
                    rec[key] = None

        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(data, f)
        print(f"jobspy done {len(data)}")
        return 0
    except Exception as exc:  # noqa: BLE001 - surfaced to Node as a board failure
        print(f"jobspy error: {exc}", file=sys.stderr)
        try:
            with open(out_path, "w", encoding="utf-8") as f:
                json.dump([], f)
        except OSError:
            pass
        return 1


if __name__ == "__main__":
    sys.exit(main())
