#!/usr/bin/env python3
"""Manage Agent Usage multi-account configurations and settings."""

import json
import os
import sys

PRIMARY_CONFIG_PATH = os.path.expanduser("~/.config/herdr-app/agent-usage-accounts.json")
LEGACY_CONFIG_PATH = os.path.expanduser("~/.config/herdr-app/openusage-accounts.json")

DEFAULT_CONFIG = {
    "accounts": [
        {
            "id": "claude-default",
            "provider": "claude",
            "name": "Claude Code",
            "label": "Work (Keychain)",
            "authType": "keychain",
            "keychainService": "Claude Code-credentials",
            "enabled": True,
        },
        {
            "id": "codex-default",
            "provider": "codex",
            "name": "OpenAI Codex",
            "label": "ChatGPT Plus",
            "authType": "auth_file",
            "authPath": "~/.codex/auth.json",
            "enabled": True,
        },
        {
            "id": "antigravity-default",
            "provider": "antigravity",
            "name": "Google Antigravity",
            "label": "Primary",
            "authType": "cli",
            "enabled": True,
        },
        {
            "id": "opencode-default",
            "provider": "opencode",
            "name": "OpenCode",
            "label": "Go Default",
            "authType": "cli",
            "enabled": True,
        },
    ],
    "settings": {
        "displayMode": "remaining",
        "showPaceGuide": True,
        "refreshInterval": 120,
    },
}


def load_config():
    if os.path.exists(PRIMARY_CONFIG_PATH):
        try:
            with open(PRIMARY_CONFIG_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return DEFAULT_CONFIG

    if os.path.exists(LEGACY_CONFIG_PATH):
        try:
            with open(LEGACY_CONFIG_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
            save_config(data)
            return data
        except Exception:
            pass

    save_config(DEFAULT_CONFIG)
    return DEFAULT_CONFIG


def save_config(config):
    target_path = PRIMARY_CONFIG_PATH
    dir_name = os.path.dirname(target_path)
    os.makedirs(dir_name, mode=0o700, exist_ok=True)
    temp_path = f"{target_path}.tmp.{os.getpid()}"
    try:
        # Write to temporary file with restrictive permissions (0600)
        flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
        mode = 0o600
        fd = os.open(temp_path, flags, mode)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=2, ensure_ascii=False)
        # Atomically replace destination
        os.replace(temp_path, target_path)
    except Exception:
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                pass
        raise


def main():
    if len(sys.argv) < 2:
        print(json.dumps(load_config()))
        return

    cmd = sys.argv[1]
    config = load_config()

    if cmd == "list":
        print(json.dumps(config))
    elif cmd == "add":
        if len(sys.argv) < 3:
            print(json.dumps({"ok": False, "error": "Missing account data"}))
            return
        try:
            account = json.loads(sys.argv[2])
            if not isinstance(account, dict):
                raise ValueError("Account must be a JSON object")
            provider = str(account.get("provider", "")).strip().lower()
            if not provider or not provider.replace("-", "").isalnum():
                raise ValueError("Invalid provider specified")
            if not account.get("id"):
                import time
                account["id"] = f"{provider}-{int(time.time())}"
            # Check for null bytes or invalid paths
            if "authPath" in account and "\0" in str(account["authPath"]):
                raise ValueError("Null bytes in authPath")
            # Check if exists
            exists = False
            for i, a in enumerate(config["accounts"]):
                if a["id"] == account["id"]:
                    config["accounts"][i] = account
                    exists = True
                    break
            if not exists:
                config["accounts"].append(account)
            save_config(config)
            print(json.dumps({"ok": True, "config": config}))
        except Exception as e:
            print(json.dumps({"ok": False, "error": str(e)}))
    elif cmd == "remove":
        if len(sys.argv) < 3:
            print(json.dumps({"ok": False, "error": "Missing account id"}))
            return
        target_id = sys.argv[2]
        config["accounts"] = [a for a in config["accounts"] if a["id"] != target_id]
        save_config(config)
        print(json.dumps({"ok": True, "config": config}))
    elif cmd == "toggle":
        if len(sys.argv) < 3:
            print(json.dumps({"ok": False, "error": "Missing account id"}))
            return
        target_id = sys.argv[2]
        for a in config["accounts"]:
            if a["id"] == target_id:
                a["enabled"] = not a.get("enabled", True)
                break
        save_config(config)
        print(json.dumps({"ok": True, "config": config}))
    else:
        print(json.dumps(config))


if __name__ == "__main__":
    main()
