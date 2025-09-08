# Release Script

This script automates the process of updating version numbers for a new release.

## Usage

1.  From the **root of the project directory**, run the script with the new version number as an argument. For example, to release version `1.0.1`:

    ```bash
    python3 .github/scripts/release.py 1.0.1
    ```

    This will automatically update `manifest.json` and `updates.json`.

2.  Review the changes and commit them to git:

    ```bash
    git add manifest.json updates.json
    git commit -m "Release v1.0.1"
    ```

3.  Create and push a new git tag to trigger the release workflow on GitHub:

    ```bash
    git tag v1.0.1
    git push && git push --tags
    ```