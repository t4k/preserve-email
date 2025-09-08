#!/usr/bin/env python3
import json
import sys
from pathlib import Path

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 .github/scripts/release.py <new_version>")
        sys.exit(1)

    new_version = sys.argv[1]
    # The script is in .github/scripts/, so the project root is two levels up.
    project_root = Path(__file__).parent.parent.parent

    # --- Update manifest.json ---
    manifest_path = project_root / 'manifest.json'
    print(f"Reading {manifest_path}...")
    with open(manifest_path, 'r+') as f:
        manifest = json.load(f)
        manifest['version'] = new_version
        f.seek(0)
        json.dump(manifest, f, indent=2)
        f.truncate()
        f.write('\n')
    print(f"Updated manifest.json to version {new_version}")

    # --- Update updates.json ---
    updates_path = project_root / 'updates.json'
    addon_id = manifest['browser_specific_settings']['gecko']['id']
    update_link = f"https://github.com/t4k/preserve-email/releases/download/v{new_version}/preserve_email-{new_version}-tb.xpi"
    
    print(f"Reading {updates_path}...")
    with open(updates_path, 'r+') as f:
        updates = json.load(f)
        updates['addons'][addon_id]['updates'].insert(0, {
            "version": new_version,
            "update_link": update_link
        })
        f.seek(0)
        json.dump(updates, f, indent=2)
        f.truncate()
        f.write('\n')
    print(f"Added version {new_version} to updates.json")

if __name__ == "__main__":
    main()