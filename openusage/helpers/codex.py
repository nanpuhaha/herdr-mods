#!/usr/bin/env python3
"""Print Codex subscription usage as one JSON object for OpenUsage mod.

Supports custom auth.json path via sys.argv[1].
"""

import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

USAGE_URL = "https://chatgpt.com/backend-api/wham/usage"
CACHE_MAX_AGE = 7 * 24 * 3600


def auth_path(custom_path=None):
    if custom_path:
        return os.path.expanduser(custom_path)
    root = os.environ.get("CODEX_HOME") or os.path.join(os.path.expanduser("~"), ".codex")
    return os.path.join(root, "auth.json")


def get_cache_path(custom_path=None):
    if custom_path:
        clean = "".join(c if c.isalnum() else "_" for c in os.path.basename(custom_path))
        return os.path.join(os.path.dirname(os.path.abspath(__file__)), f".cache-codex-{clean}.json")
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), ".cache-codex.json")


def read_cache(custom_path=None):
    try:
        with open(get_cache_path(custom_path), encoding="utf-8") as handle:
            cached = json.load(handle)
        if time.time() - float(cached.get("fetched_at", 0)) <= CACHE_MAX_AGE:
            return cached
    except Exception:
        pass
    return None


def write_cache(summary, fetched_at, custom_path=None):
    try:
        with open(get_cache_path(custom_path), "w", encoding="utf-8") as handle:
            json.dump({"fetched_at": fetched_at, **summary}, handle)
    except Exception:
        pass


def cached_result(warning, custom_path=None):
    cached = read_cache(custom_path)
    if not cached:
        return None
    return {"ok": True, "cached": True, "warning": warning, **cached}


def jwt_claims(token):
    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        return json.loads(base64.urlsafe_b64decode(payload))
    except Exception:
        return {}


def jwt_account_id(token):
    return jwt_claims(token).get("https://api.openai.com/auth", {}).get("chatgpt_account_id")


def jwt_expired(token):
    exp = jwt_claims(token).get("exp")
    return isinstance(exp, (int, float)) and exp <= time.time()


def credentials(custom_path=None):
    path = auth_path(custom_path)
    if not os.path.exists(path):
        return None
    try:
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
        if str(data.get("auth_mode", "")).lower() not in ("", "chatgpt"):
            return None
        tokens = data.get("tokens") or {}
        token = tokens.get("access_token")
        if not token:
            return None
        account = tokens.get("account_id") or jwt_account_id(token)
        return token, account
    except Exception:
        return None


def reset_iso(stamp):
    if stamp is None:
        return None
    if isinstance(stamp, str):
        return stamp
    try:
        number = float(stamp)
        if number > 1e11:
            number /= 1000.0
        return datetime.fromtimestamp(number, tz=timezone.utc).isoformat()
    except Exception:
        return None


def window(value):
    if not isinstance(value, dict):
        return None
    used = value.get("used_percent")
    if used is None:
        left = value.get("remaining_percent")
        if left is not None:
            used = 100 - float(left)
    if used is None:
        return None
    reset = value.get("reset_at") or value.get("resets_at") or value.get("reset_time_ms")
    if reset is None and value.get("reset_after_seconds") is not None:
        reset = time.time() + float(value["reset_after_seconds"])
    return {"utilization": round(float(used), 1), "resets_at": reset_iso(reset)}


def bucket(rate):
    result = {"five_hour": None, "seven_day": None}
    fields = (
        ("primary_window", "five_hour"),
        ("secondary_window", "seven_day"),
        ("five_hour", "five_hour"),
        ("weekly", "seven_day"),
        ("primary", "five_hour"),
        ("secondary", "seven_day"),
    )
    for key, fallback in fields:
        raw = rate.get(key)
        parsed = window(raw)
        if not parsed:
            continue
        kind = fallback
        seconds = raw.get("limit_window_seconds") if isinstance(raw, dict) else None
        if isinstance(seconds, (int, float)):
            if seconds <= 6 * 3600:
                kind = "five_hour"
            elif seconds >= 6 * 86400:
                kind = "seven_day"
        result[kind] = parsed
    return result


def main():
    custom_path = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] else None
    try:
        found = credentials(custom_path)
        if not found:
            print(json.dumps({"ok": False, "missing": True, "error": f"Codex auth file not found: {auth_path(custom_path)}"}))
            return 0
        token, account = found
        if jwt_expired(token):
            message = "Codex token expired"
            cached = cached_result(message, custom_path)
            print(json.dumps(cached if cached else {"ok": False, "missing": True, "error": message}))
            return 0
        headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "User-Agent": "codex-cli/0.98.0",
        }
        if account:
            headers["ChatGPT-Account-Id"] = account
        request = urllib.request.Request(USAGE_URL, headers=headers)
        with urllib.request.urlopen(request, timeout=15) as response:
            body = json.loads(response.read().decode("utf-8"))
        rate = body.get("rate_limit") or body.get("rate_limits") or {}
        if not isinstance(rate, dict):
            rate = {}
        summary = {"plan": body.get("plan_type"), **bucket(rate)}
        fetched_at = time.time()
        write_cache(summary, fetched_at, custom_path)
        print(json.dumps({"ok": True, "fetched_at": fetched_at, **summary}))
    except urllib.error.HTTPError as error:
        message = "Codex token expired" if error.code == 401 else f"Codex usage request failed ({error.code})"
        cached = cached_result(message, custom_path)
        print(json.dumps(cached if cached else {"ok": False, "error": message}))
    except Exception as error:
        message = str(error)[:200]
        cached = cached_result(message, custom_path)
        print(json.dumps(cached if cached else {"ok": False, "error": message}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
