# Preserve Email :: Thunderbird Add-on

A Thunderbird add-on that creates high-fidelity, self-contained copies of messages in the `.eml` format. It embeds all remote content (images, stylesheets, etc.) to ensure the email can be viewed perfectly offline, forever.

## Features
*   **Keyboard Shortcut Trigger**: Use a keyboard shortcut (`Ctrl+Shift+P`) to preserve emails.
*   **Complete Archival**: Downloads and embeds all remote images, stylesheets, and web fonts.
*   **MHTML Format**: Saves messages as `multipart/related` (.eml), the standard for web page archives.
*   **Data Integrity**: Preserves original URLs in `data-original-src`/`data-original-href` attributes for forensic and archival reference.
*   **Robust CSS Handling**: Correctly processes `@import` rules within stylesheets to capture all styling.
*   **Metadata Header**: Adds a custom `X-Preservation-Info` header with details about the tool, version, and date.
*   **Clean and Secure**: Strips out potentially harmful `<script>` tags.

## Installation

1.  Download the latest `.xpi` file from the Releases page.
2.  In Thunderbird, go to `Tools > Add-ons and Themes`.
3.  Click the gear icon and select "Install Add-on From File...".
4.  Select the downloaded `.xpi` file.

*(Once published, this section can be updated to link to the official Thunderbird Add-ons store.)*

## Usage

1.  Select one or more messages in Thunderbird.
2.  Trigger the preservation by pressing the keyboard shortcut:
    *   `Ctrl+Shift+P`
3.  A "Save As" dialog will appear to save the preserved `.eml` file.

## Technical Details

### MHTML Format

The add-on creates emails in a hybrid MHTML (MIME HTML) format to ensure the best rendering across different email clients:

- **Multipart/Related Structure**: Uses MIME multipart/related to combine HTML and resources
- **Content-ID References**: Remote URLs are replaced with `cid:` references to embedded content
-**Data URI Embedding**: Web fonts (e.g., from Google Fonts) are embedded directly into the CSS as `data:` URIs. This method is more robustly supported by email clients than `cid:` links within stylesheets.
- **Base64 Encoding**: All embedded resources are Base64-encoded for transport
- **Preservation Headers**: Custom headers track the preservation method and tool version

### Supported Resources

The add-on can embed:
- Images (`<img src="...">`).
- Stylesheets (`<link href="...">`), including those referenced via `@import`.
- Web Fonts (`@font-face` rules in CSS), which are converted to `data:` URIs for maximum compatibility.

### Error Handling

- **Network Failures**: If a resource cannot be downloaded, it's skipped with a console warning.
- **Invalid HTML**: Gracefully handles malformed HTML content.
- **Large Resources**: No size limits (browser/Thunderbird limits apply).

## Development

### Prerequisites

- Thunderbird 91.0 or later
- Basic knowledge of JavaScript and MIME/email formats

### Key Files

- **`manifest.json`**: Add-on configuration, permissions, and keyboard shortcut
- **`background/background.js`**: Main preservation logic and MHTML generation

### Testing

1. Make your changes to the source files
2. Reload the add-on in Thunderbird:
   - Go to `Tools` → `Add-ons and Themes`
   - Find your add-on and click the reload button
3. Test with various emails containing remote resources

### Debugging

- Open Thunderbird's Developer Tools (`Tools` → `Developer Tools`)
- Check the Console tab for JavaScript errors and processing logs
- The background script logs detailed information about the preservation process

## License

This project is licensed under the Mozilla Public License 2.0. See the [LICENSE](LICENSE) file for details.

## Acknowledgments

This tool was developed with the assistance of AI models, including Google's Gemini and models from Anthropic and OpenAI, which were instrumental in debugging, code generation, and refining the implementation.

## Version History

- **v1.0.0**:
  - Initial public release.
  - Preserves messages in MHTML format, embedding remote images, stylesheets, and web fonts.
  - Correctly handles complex CSS including `@import` rules and web fonts from services like Google Fonts.
  - Fixes common encoding issues with multi-byte characters (e.g., emoji).
  - Includes robust error handling and resource caching.
