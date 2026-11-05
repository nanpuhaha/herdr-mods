#!/usr/bin/env python3
"""Print OpenCode Go usage limits as JSON for OpenUsage mod."""

import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone

CACHE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".cache-opencode.json")
CACHE_MAX_AGE = 7 * 24 * 3600


def read_cache():
    try:
        with open(CACHE_PATH, encoding="utf-8") as f:
            c = json.load(f)
        if time.time() - float(c.get("fetched_at", 0)) <= CACHE_MAX_AGE:
            return c
    except Exception:
        pass
    return None


def write_cache(data):
    try:
        with open(CACHE_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f)
    except Exception:
        pass


def ms_to_iso(ms):
    if not ms or not isinstance(ms, (int, float)):
        return None
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat()


def main():
    env = os.environ.copy()
    home = os.path.expanduser("~")
    extra_paths = [f"{home}/.opencode/bin", "/opt/homebrew/bin", "/usr/local/bin"]
    env["PATH"] = ":".join(extra_paths) + ":" + env.get("PATH", "")

    try:
        result = subprocess.run(
            ["opencode", "api", "GET", "/api/experimental/usage/limits"],
            capture_output=True,
            text=True,
            timeout=10,
            env=env,
            cwd=home,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or f"opencode exited {result.returncode}")

        body = json.loads(result.stdout)
        data = body.get("data", {})
        go = data.get("go")
        if not go:
            raise RuntimeError("OpenCode Go data not found (sign in required)")

        now = time.time()
        res = {
            "ok": True,
            "fetched_at": now,
            "workspace": data.get("workspace", {}).get("name", "Default"),
            "rolling": {
                "utilization": float(go.get("rolling", {}).get("percent", 0)),
                "remaining": round(100 - float(go.get("rolling", {}).get("percent", 0)), 1),
                "resets_at": ms_to_iso(go.get("rolling", {}).get("resetsAt")),
                "limited": bool(go.get("rolling", {}).get("limited")),
            } if "rolling" in go else None,
            "weekly": {
                "utilization": float(go.get("weekly", {}).get("percent", 0)),
                "remaining": round(100 - float(go.get("weekly", {}).get("percent", 0)), 1),
                "resets_at": ms_to_iso(go.get("weekly", {}).get("resetsAt")),
                "limited": bool(go.get("weekly", {}).get("limited")),
            } if "weekly" in go else None,
            "monthly": {
                "utilization": float(go.get("monthly", {}).get("percent", 0)),
                "remaining": round(100 - float(go.get("monthly", {}).get("percent", 0)), 1),
                "resets_at": ms_to_iso(go.get("monthly", {}).get("resetsAt")),
                "limited": bool(go.get("monthly", {}).get("limited")),
            } if "monthly" in go else None,
        }
        write_cache(res)
        print(json.dumps(res))
    except Exception as e:
        cached = read_cache()
        if cached:
            cached["cached"] = True
            cached["warning"] = str(e)
            print(json.dumps(cached))
        else:
            print(json.dumps({"ok": False, "error": str(e)}))


if __name__ == "__main__":
    main()
