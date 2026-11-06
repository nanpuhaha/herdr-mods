#!/usr/bin/env python3
"""Print Claude subscription usage as one JSON object for the usage-status mod.

Reads the OAuth token Claude Code keeps in the login Keychain, asks Anthropic's
usage endpoint for the current limits, and prints only the windows the bar
needs. The token never leaves this process and is never written to stdout.

A successful result is cached on disk so the meter can keep showing the last
known numbers, clearly marked stale, while the endpoint is rate limited.
"""

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

DEFAULT_KEYCHAIN_SERVICE = "Claude Code-credentials"
USAGE_URL = "https://api.anthropic.com/api/oauth/usage"
CACHE_MAX_AGE = 7 * 24 * 3600
WINDOWS = ("five_hour", "seven_day", "seven_day_opus", "seven_day_sonnet")


def get_cache_path(service_name):
    clean = "".join(c if c.isalnum() else "_" for c in service_name)
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), f".cache-claude-{clean}.json")


def access_token(service_name=DEFAULT_KEYCHAIN_SERVICE):
    """Return Claude Code's OAuth token without exposing it to the caller."""
    result = subprocess.run(
        ["security", "find-generic-password", "-s", service_name, "-w"],
        capture_output=True,
        text=True,
        timeout=10,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Claude credentials not found in Keychain ({service_name})")
    credentials = json.loads(result.stdout)
    token = credentials.get("claudeAiOauth", {}).get("accessToken")
    if not token:
        raise RuntimeError(f"Claude Keychain item ({service_name}) has no access token")
    return token
    return token


def fetch_usage(token):
    """Fetch the usage document for this token."""
    request = urllib.request.Request(
        USAGE_URL,
        headers={
            "Authorization": f"Bearer {token}",
            "anthropic-beta": "oauth-2025-04-20",
            "User-Agent": "claude-code/2.1.317",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.loads(response.read().decode("utf-8"))


def summarize(body):
    """Keep only the utilization and reset time of each named window."""
    windows = {}
    for name in WINDOWS:
        window = body.get(name)
        if isinstance(window, dict):
            windows[name] = {
                "utilization": window.get("utilization"),
                "resets_at": window.get("resets_at"),
            }
    return windows


def read_cache(service_name):
    """Return the last successful summary, if it is recent enough."""
    try:
        path = get_cache_path(service_name)
        with open(path, encoding="utf-8") as handle:
            cached = json.load(handle)
        if time.time() - float(cached.get("fetched_at", 0)) <= CACHE_MAX_AGE:
            return cached
    except Exception:
        pass
    return None


def write_cache(summary, fetched_at, service_name):
    """Persist the last successful summary without making the meter fail."""
    try:
        path = get_cache_path(service_name)
        with open(path, "w", encoding="utf-8") as handle:
            json.dump({"fetched_at": fetched_at, **summary}, handle)
    except Exception:
        pass


def cached_result(warning, service_name):
    """Show the last known numbers, labelled with the warning that caused them."""
    cached = read_cache(service_name)
    if not cached:
        return None
    return {"ok": True, "cached": True, "warning": warning, **cached}


def main():
    service_name = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] else DEFAULT_KEYCHAIN_SERVICE
    try:
        summary = summarize(fetch_usage(access_token(service_name)))
        fetched_at = time.time()
        write_cache(summary, fetched_at, service_name)
        print(json.dumps({"ok": True, "fetched_at": fetched_at, **summary}))
    except urllib.error.HTTPError as error:
        retry_after = error.headers.get("Retry-After")
        warning = f"usage request failed ({error.code})"
        cached = cached_result(warning, service_name)
        if cached:
            print(json.dumps({**cached, "retry_after": retry_after}))
        else:
            print(json.dumps({"ok": False, "error": warning, "retry_after": retry_after}))
    except Exception as error:  # noqa: BLE001 - the mod shows any failure as offline
        warning = str(error)[:200]
        cached = cached_result(warning, service_name)
        print(json.dumps(cached if cached else {"ok": False, "error": warning}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
