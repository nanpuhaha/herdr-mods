#!/usr/bin/env python3
"""Manage Agent Usage multi-account configurations and settings."""

import json
import os
import sys

PRIMARY_CONFIG_PATH = os.path.expanduser("~/.config/herdr-app/agent-usage-accounts.json")
LEGACY_CONFIG_PATH = os.path.expanduser("~/.config/herdr-app/openusage-accounts.json")

def get_config_path():
    if os.path.exists(PRIMARY_CONFIG_PATH):
        return PRIMARY_CONFIG_PATH
    if os.path.exists(LEGACY_CONFIG_PATH):
        return LEGACY_CONFIG_PATH
    return PRIMARY_CONFIG_PATH

CONFIG_PATH = get_config_path()

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
    if not os.path.exists(CONFIG_PATH):
        save_config(DEFAULT_CONFIG)
        return DEFAULT_CONFIG
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return DEFAULT_CONFIG


def save_config(config):
    os.makedirs(os.path.dirname(CONFIG_PATH), exist_ok=True)
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2, ensure_ascii=False)


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
            if not account.get("id"):
                import time
                account["id"] = f"{account.get('provider', 'custom')}-{int(time.time())}"
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
