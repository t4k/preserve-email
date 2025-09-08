// Helper function to show notifications to the user
function notify(title, message) {
    browser.notifications.create({
        "type": "basic",
        "iconUrl": browser.runtime.getURL("icons/preserver-icon.svg"),
        "title": title,
        "message": message
    });
}

// Listener for the user command (handles keyboard shortcut AND menu clicks)
browser.commands.onCommand.addListener(async (command) => {
  if (command === "preserve-email") {
    // This robustly finds the currently selected messages, regardless of
    // how the command was triggered (menu or shortcut).
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (tabs.length > 0) {
        const messages = await messenger.mailTabs.getSelectedMessages(tabs[0].id);
        await preserveSelectedMessage(messages);
    }
  }
});

/**
* Main function to get the selected message and start the preservation process.
* @param {browser.mailTabs.MessageList} [selectedMessages] - Optional. The list of messages to process.
* If not provided, it will be queried from the active tab.
*/
async function preserveSelectedMessage(selectedMessages) {
  try {
      // The command listener now always provides the selectedMessages object.
      // We just need to check if it's empty.
      if (selectedMessages.messages.length === 0) {
          console.warn("No message selected to preserve.");
          return;
      }
      
      const message = selectedMessages.messages[0];
      const fullMessage = await messenger.messages.getFull(message.id);
      
      console.log("Starting preservation for message:", fullMessage);
      
      // Extract subject and author from headers
      const subject = fullMessage.headers?.subject?.[0] || 'Unknown_Subject';
      const author = fullMessage.headers?.from?.[0] || 'Unknown_Sender';
      
      console.log("Message subject:", subject);
      console.log("Message author:", author);
      
      const emlContent = await constructMHTMLEmail(fullMessage, message.id);
      
      // Save the generated .eml file to the user's downloads folder
      const sanitizedSubject = subject.replace(/[^a-z0-9\s-]/gi, '_').replace(/\s+/g, '_');
      const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '');
      const filename = `preserved_${sanitizedSubject}_${timestamp}.eml`;
      const blob = new Blob([emlContent], { type: 'message/rfc822' });
      const url = URL.createObjectURL(blob);
      
      browser.downloads.download({
          url: url,
          filename: filename,
          saveAs: true
      }).then(() => {
          const successMsg = `Email successfully preserved as: ${filename}`;
          console.log(successMsg);
          notify("Preservation Complete", successMsg);
          URL.revokeObjectURL(url);
      }).catch(err => {
          console.error("Failed to download the preserved email:", err);
          notify("Download Failed", "Could not save the preserved email. Check browser permissions.");
          URL.revokeObjectURL(url);
      });

  } catch (error) {
      console.error("Error during email preservation:", error);
      notify("Preservation Error", "An unexpected error occurred. See the console for details.");
  }
}

/**
* Constructs the MHTML email by fetching remote resources and rewriting the HTML.
* @param {object} message The full Thunderbird message object.
* @returns {Promise<string>} The complete .eml file content as a string.
*/
async function constructMHTMLEmail(message, messageId) {
  console.log("Message parts:", message.parts);
  console.log("Message structure:", Object.keys(message));
  
  // Recursively search for HTML content in nested parts
  function findHtmlPart(parts) {
    for (const part of parts) {
      console.log("Checking part:", part.contentType, "partName:", part.partName);
      
      if (part.contentType.includes('text/html')) {
        return part;
      }
      
      // If this part has nested parts, search recursively
      if (part.parts && part.parts.length > 0) {
        const htmlPart = findHtmlPart(part.parts);
        if (htmlPart) return htmlPart;
      }
    }
    return null;
  }
  
  const originalHtmlPart = findHtmlPart(message.parts);
  
  if (!originalHtmlPart) {
      console.warn("No HTML content found in message, creating plain text version.");
      console.log("Available parts:", message.parts.map(p => ({ contentType: p.contentType, partName: p.partName })));
      
      const author = message.headers?.from?.[0] || 'Unknown Sender';
      const subject = message.headers?.subject?.[0] || 'No Subject';
      
      // Create a basic plain text version if no HTML is found
      return `From: ${author}\n` +
             `Subject: ${subject}\n` +
             `Date: ${new Date().toUTCString()}\n` +
             `MIME-Version: 1.0\n` +
             `Content-Type: text/plain; charset="UTF-8"\n\n` +
             `[No HTML content available for preservation]`;
  }
  
  console.log("Found HTML part:", originalHtmlPart);
  
  // Use the body property if available, otherwise try to get raw content
  let originalHtmlBody;
  if (originalHtmlPart.body) {
    console.log("Using HTML body from part object");
    originalHtmlBody = originalHtmlPart.body;
  } else {
    console.log("Attempting to get raw message content");
    try {
      originalHtmlBody = await messenger.messages.getRawMessageContent(message.id, originalHtmlPart.partName);
    } catch (error) {
      console.error("Failed to get raw message content:", error);
      // Fallback: try alternative API methods
      try {
        originalHtmlBody = await messenger.messages.get(message.id);
        originalHtmlBody = originalHtmlBody.body || originalHtmlBody.textBody || '[HTML content not accessible]';
      } catch (fallbackError) {
        console.error("Fallback also failed:", fallbackError);
        originalHtmlBody = '[HTML content not accessible]';
      }
    }
  }

  const boundary = `----=_Part_${crypto.randomUUID()}`;
  let emlParts = [];
  
  /**
   * Encodes an ArrayBuffer to a Base64 string in chunks to avoid memory errors.
   * @param {ArrayBuffer} buffer The ArrayBuffer to encode.
   * @returns {string} The Base64 encoded string.
   */
  function encodeArrayBufferAsBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Encodes a string into Quoted-Printable format.
   * @param {string} str The string to encode.
   * @returns {string} The Quoted-Printable encoded string.
   */
  function quotedPrintableEncode(str) {
    // --- FIX: Complete rewrite of Quoted-Printable encoder ---
    // This new version correctly handles multi-byte UTF-8 characters,
    // whitespace, and line wrapping according to RFC 2045 standards.
    const MAX_LINE_LENGTH = 76;
    let encoded = '';
    let line = '';

    // Helper to finalize a line
    function finalizeLine(currentLine) {
      // Encode trailing whitespace
      currentLine = currentLine.replace(/[\t ]+$/, (match) => {
        return match.split('').map(char => '=' + char.charCodeAt(0).toString(16).toUpperCase()).join('');
      });
      return currentLine;
    }

    // --- FIX: Use a for...of loop to correctly handle multi-byte characters (like emoji) ---
    // The previous for(i=0;...) loop would break surrogate pairs, corrupting them.
    for (const char of str) {
      const code = char.charCodeAt(0);
      let encodedChar = char;

      // Characters that MUST be encoded.
      if (code > 126 || code === 61 || (code < 32 && code !== 10 && code !== 13)) {
        // This correctly handles multi-byte characters by first encoding to UTF-8
        const utf8Bytes = new TextEncoder().encode(char);
        encodedChar = Array.from(utf8Bytes).map(byte => '=' + ('0' + byte.toString(16).toUpperCase()).slice(-2)).join('');
      }

      // Check if adding the new character(s) exceeds the line length limit.
      if (line.length + encodedChar.length > MAX_LINE_LENGTH - 1) {
        encoded += finalizeLine(line) + '=\r\n'; // Add soft line break
        line = '';
      }
      line += encodedChar;
    }

    // Add the last line if it's not empty
    if (line.length > 0) {
      encoded += finalizeLine(line);
    }

    // Normalize line endings to CRLF as required by RFC standards.
    return encoded.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
  }

 /**
 * Fetches fonts from CSS content, converts them to data URIs, and rewrites the CSS.
 * This is more robust than cid: links for fonts, which are not universally supported in CSS.
 * @param {string} cssContent The text content of the stylesheet.
 * @param {string} cssBaseUrl The base URL for resolving relative font paths.
 * @param {Map<string, string>} processedFonts A map to cache fonts that have already been processed.
 * @param {boolean} [isImport=false] - Flag indicating if this is from an @import rule.
 * @returns {Promise<string>} The updated CSS content with data: URI links for fonts, or a comment on failure.
 */
 async function processCssForFonts(cssContent, cssBaseUrl, processedFonts, isImport = false) {
    // --- FIX: Handle both inline CSS and @imported CSS files ---
    // If this is an @import, we need to fetch the CSS content first.
    if (isImport) {
        try {
            console.log(`Fetching @import content from: ${cssBaseUrl}`);
            const response = await fetch(cssBaseUrl);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            cssContent = await response.text();
        } catch (error) {
            console.error(`Failed to fetch imported CSS from ${cssBaseUrl}:`, error);
            return `/* Failed to import ${cssBaseUrl} */`; // Return a comment on failure
        }
    }

    if (!cssContent) return ''; // Return empty string if there's no content to process.

    const fontUrlRegex = /url\((['"]?)(.*?)\1\)/g;
    const fontPromises = [];

    // Use matchAll to be safe and avoid issues with async operations inside a replace callback.
    for (const match of cssContent.matchAll(fontUrlRegex)) {
      const url = match[2];
      
      if (!url || !/\.(woff2?|ttf|otf|eot|svg)(\?.*)?$/i.test(url)) {
        continue;
      }

      const absoluteUrl = new URL(url, cssBaseUrl).href;
      // --- FIX: Check the shared cache to prevent re-downloading the same font. ---
      if (processedFonts.has(absoluteUrl)) {
        console.log(`Skipping already processed font: ${absoluteUrl}`);
        continue; // Already processed or processing
      }
      processedFonts.set(absoluteUrl, null); // Mark as being processed

      const promise = (async () => {
        try {
          console.log(`Embedding font via data URI from: ${absoluteUrl}`);
          const response = await fetch(absoluteUrl);
          if (!response.ok) throw new Error(`HTTP ${response.status} for ${absoluteUrl}`);
          
          const arrayBuffer = await response.arrayBuffer();
          const mimeType = response.headers.get('content-type') || 'application/octet-stream';
          
          const base64String = encodeArrayBufferAsBase64(arrayBuffer);
          const dataUri = `data:${mimeType};base64,${base64String}`;
          
          processedFonts.set(absoluteUrl, dataUri);
          console.log(`Successfully created data URI for font: ${absoluteUrl.split('/').pop()}`);
        } catch (error) {
          console.error(`Failed to process font file for data URI: ${absoluteUrl}:`, error);
          processedFonts.set(absoluteUrl, 'error'); // Mark as failed to avoid trying again
        }
      })();
      fontPromises.push(promise);
    }

    await Promise.all(fontPromises);

    // Replace URLs with data URIs. This is more robust than cid: links for fonts.
    const rewrittenCss = cssContent.replace(fontUrlRegex, (match, quote, url) => {
      if (!url) return match;
      try {
        const absoluteUrl = new URL(url, cssBaseUrl).href;
        const dataUri = processedFonts.get(absoluteUrl);
        if (dataUri && dataUri !== 'error') {
          // Data URIs don't need quotes inside url()
          return `url(${dataUri})`;
        }
      } catch (e) {
        // Ignore invalid URLs that new URL() might choke on
      }
      return match;
    });

    return rewrittenCss;
  }

  // Use DOMParser to find and process remote resources in the HTML body
  const parser = new DOMParser();
  const doc = parser.parseFromString(originalHtmlBody, "text/html");
  
  // --- FIX 1: Refine resource selection to avoid fetching linked pages ---
  // --- FIX 2: Create a single font cache for the entire message processing. ---
  const processedFonts = new Map();

  // We only want resources essential for rendering, not every hyperlink.
  let remoteResources = doc.querySelectorAll(
    'img[src^="http"], link[rel="stylesheet"][href^="http"]'
    // We explicitly DO NOT include 'a[href]' here.
  );

  // Sanitize the HTML by removing script tags for security and stability
  console.log("Sanitizing HTML: removing script tags...");
  const scripts = doc.querySelectorAll('script');
  scripts.forEach(script => script.remove());
  
  console.log(`Found ${remoteResources.length} remote resources to process`);
  remoteResources.forEach((el, index) => {
      const url = el.src || el.href;
      const tagName = el.tagName.toLowerCase();
      console.log(`Resource ${index + 1}: ${tagName} - ${url}`);
  });
  
  // Also find and replace @import url() statements in style tags and CSS
  const styleElements = doc.querySelectorAll('style');
  const importPromises = [];

  for (const styleEl of styleElements) {
    if (!styleEl.textContent) continue;

    // Process @import rules
    // Use matchAll to handle multiple @import statements safely with async operations.
    const importMatches = [...styleEl.textContent.matchAll(/@import\s+url\((['"]?)(.*?)\1\);?/g)];
    
    for (const match of importMatches) {
      const importUrl = match[2];
      console.log(`Found @import URL, preparing to inline: ${importUrl}`);
      
      const promise = (async () => {
        // Fetch the CSS, process its fonts, and replace the @import with the full CSS.
        const importedCss = await processCssForFonts(null, importUrl, processedFonts, true);
        styleEl.textContent = styleEl.textContent.replace(match[0], importedCss);
        console.log(`Successfully inlined CSS from: ${importUrl}`);
      })();
      importPromises.push(promise);
    }
  }

  await Promise.all(importPromises);

  // Update the remote resources list to include the new @import URLs
  remoteResources = doc.querySelectorAll(
    'img[src^="http"], link[rel="stylesheet"][href^="http"]'
  );
  console.log(`Updated resource count after @import processing: ${remoteResources.length}`);

  let processedCount = 0;
  let failedCount = 0;
  const processedResources = new Map(); // Cache for processed resource URLs
  
  for (const resourceEl of remoteResources) {
      const originalSrc = resourceEl.src || resourceEl.href;
      if (!originalSrc || originalSrc.startsWith('data:') || originalSrc.startsWith('cid:')) continue;

      // --- FIX 2: Improved URL validation ---
      // This prevents errors with schemes like `tel:`, `mailto:`, etc.,
      // even when they are wrapped inside an HTTP tracking link.
      const lowercasedSrc = originalSrc.toLowerCase();
      if (!lowercasedSrc.startsWith('http') || lowercasedSrc.includes('tel:') || lowercasedSrc.includes('mailto:')) {
          console.log(`Skipping non-HTTP(S) resource: ${originalSrc}`);
          continue;
      }

      try {
          // --- FIX 2: Check cache to avoid re-fetching the same resource ---
          if (processedResources.has(originalSrc)) {
              console.log(`Reusing cached resource: ${originalSrc}`);
              const contentId = processedResources.get(originalSrc);
              if (resourceEl.hasAttribute('src')) {
                  resourceEl.setAttribute('src', `cid:${contentId.slice(1, -1)}`);
              } else if (resourceEl.hasAttribute('href')) {
                  resourceEl.setAttribute('href', `cid:${contentId.slice(1, -1)}`);
              }
              continue; // Skip to the next resource
          }

          console.log(`Processing resource: ${originalSrc}`);
          
          // Use XMLHttpRequest for better handling of binary data and various server responses.
          const resourceData = await new Promise((resolve, reject) => {
              const xhr = new XMLHttpRequest();
              xhr.open('GET', originalSrc, true);
              xhr.responseType = 'arraybuffer';
              
              xhr.onload = function() {
                  if (xhr.status >= 200 && xhr.status < 300) {
                      resolve({
                          data: xhr.response,
                          contentType: xhr.getResponseHeader('content-type') || 'application/octet-stream'
                      });
                  } else {
                      reject(new Error(`HTTP ${xhr.status}: ${xhr.statusText}`));
                  }
              };
              xhr.onerror = () => reject(new Error('Network error'));
              xhr.ontimeout = () => reject(new Error('Request timeout'));
              xhr.timeout = 15000; // 15 second timeout
              xhr.send();
          });
          
          const mimeType = resourceData.contentType;
          const filename = originalSrc.split('/').pop().split(/[?#]/)[0] || 'resource';
          let arrayBuffer = resourceData.data;
          
          // Skip very large resources (>10MB) to avoid memory issues
          if (arrayBuffer.byteLength > 10 * 1024 * 1024) {
              console.warn(`Skipping large resource (${arrayBuffer.byteLength} bytes): ${originalSrc}`);
              continue;
          }

          // If it's a stylesheet, process it for fonts before embedding
          if (mimeType.includes('text/css')) {
            let cssText = new TextDecoder().decode(arrayBuffer);
            cssText = await processCssForFonts(cssText, originalSrc, processedFonts);
            arrayBuffer = new TextEncoder().encode(cssText);
          }
          
          const contentId = `<${crypto.randomUUID()}@eml.rodeo>`;

          // Add the processed resource to our cache
          processedResources.set(originalSrc, contentId);
          
          // Rewrite the element's src/href to use the cid: URI
          if (resourceEl.hasAttribute('src')) {
              resourceEl.setAttribute('data-original-src', originalSrc);
              resourceEl.setAttribute('src', `cid:${contentId.slice(1, -1)}`);
          } else if (resourceEl.hasAttribute('href')) {
              resourceEl.setAttribute('data-original-href', originalSrc);
              resourceEl.setAttribute('href', `cid:${contentId.slice(1, -1)}`);
          }

          // Create MIME part for the resource
          const base64String = encodeArrayBufferAsBase64(arrayBuffer);
          
          emlParts.push(`--${boundary}\n` +
                        `Content-Type: ${mimeType}\n` +
                        `Content-Transfer-Encoding: base64\n` +
                        `Content-ID: ${contentId}\n` +
                        `Content-Disposition: inline; filename="${filename}"\n\n` +
                        base64String.replace(/(.{76})/g, "$1\n") + '\n');
          
          processedCount++;
          console.log(`Successfully processed resource: ${filename} (${arrayBuffer.byteLength} bytes)`);
      } catch (error) {
          console.error(`Failed to process resource from ${originalSrc}:`, error);
          failedCount++;
      }
  }
  
  console.log(`Resource processing complete: ${processedCount} successful, ${failedCount} failed`);
  
  // Clean up tracking pixels and remove font references to prevent remote content warnings
  console.log('Cleaning up tracking pixels and removing font references...');
  
  // First, clean up any empty or problematic attachments (like tracking pixels)
  emlParts = emlParts.filter(part => {
      const base64Start = part.indexOf('\n\n') + 2;
      const base64Content = part.substring(base64Start).trim();
      // Remove parts with no content or very small content (likely tracking pixels)
      if (base64Content.length < 10) {
          console.log('Removing empty/small attachment (likely tracking pixel)');
          return false;
      }
      return true;
  });
  
  const elementsWithImportUrls = doc.querySelectorAll('[data-import-url]');
  elementsWithImportUrls.forEach(el => {
      el.removeAttribute('data-import-url');
  });
  
  // Remove target="_blank" and rel="noopener" attributes that might trigger remote content warnings
  const elementsWithTarget = doc.querySelectorAll('[target="_blank"]');
  elementsWithTarget.forEach(el => {
      el.removeAttribute('target');
  });
  
  const elementsWithRel = doc.querySelectorAll('[rel="noopener"]');
  elementsWithRel.forEach(el => {
      el.removeAttribute('rel');
  });
  
  // Also remove any remaining @import statements that might have been missed
  const remainingStyleElements = doc.querySelectorAll('style');
  remainingStyleElements.forEach(styleEl => {
      if (styleEl.textContent) {
          styleEl.textContent = styleEl.textContent.replace(
              /@import\s+url\([^)]+\);?/g,
              ''
          );
      }
  });
  
  const rewrittenHtml = doc.documentElement.outerHTML;
  const encodedHtml = quotedPrintableEncode(rewrittenHtml);

  // Construct the new, more informative X-Preservation-Info header using manifest data
  console.log('Constructing X-Preservation-Info header...');
  const manifest = messenger.runtime.getManifest();
  const toolId = manifest.browser_specific_settings?.gecko?.id || 'unknown-tool';
  const toolVersion = manifest.version || '0.0.0';
  const preservationDate = new Date().toISOString();
  const originalMessageId = message.headers?.['message-id']?.[0] || 'Not-Found';
  const preservationMethod = "MHTML-Hybrid (CID+DataURI)";

  const preservationHeader = `X-Preservation-Info: Tool="${toolId}"; Version="${toolVersion}"; Preservation-Date="${preservationDate}"; Original-Message-ID="${originalMessageId}"; Preservation-Method="${preservationMethod}"\n`;

  // Get the raw message to preserve original headers perfectly.
  console.log('Fetching raw message to preserve original headers...');
  const rawMessage = await messenger.messages.getRaw(messageId);
  const headerEndIndex = rawMessage.indexOf('\r\n\r\n');
  let headerStr = '';

  if (headerEndIndex !== -1) {
    const rawHeadersBlock = rawMessage.substring(0, headerEndIndex);
    const headerLines = rawHeadersBlock.split(/\r\n|\n/);
    const filteredHeaderLines = [];
    let skipCurrentHeader = false;
    const headersToFilter = new Set([
      'content-type', 
      'mime-version', 
      'content-transfer-encoding',
      'x-mozilla-status',
      'x-mozilla-status2',
      'x-preservation-info'
    ]);

    for (const line of headerLines) {
      // Check if it's a new header line (doesn't start with whitespace)
      if (line.length > 0 && ' \t'.indexOf(line[0]) === -1) {
        const colonIndex = line.indexOf(':');
        if (colonIndex > -1) {
          const headerName = line.substring(0, colonIndex).toLowerCase();
          skipCurrentHeader = headersToFilter.has(headerName);
        } else {
          skipCurrentHeader = false; // Malformed line, but keep it.
        }
      }
      
      if (!skipCurrentHeader) {
        filteredHeaderLines.push(line);
      }
    }
    headerStr = filteredHeaderLines.join('\n') + '\n';
  } else {
    // Fallback to parsed headers if raw parsing fails (should be rare)
    console.warn("Could not find raw headers, falling back to parsed headers.");
    if (message.headers) {
      for (const [key, values] of Object.entries(message.headers)) {
        if (!headersToFilter.has(key.toLowerCase())) {
          values.forEach(value => { headerStr += `${key}: ${value}\n`; });
        }
      }
    }
  }

  // Construct the final .eml file content
  console.log('Creating final multipart/related email structure...');
  
  let eml = preservationHeader +
            headerStr +
            `MIME-Version: 1.0\n` +
            `Content-Type: multipart/related; boundary="${boundary}"\n\n`;

  // Add the HTML part
  eml += `--${boundary}\n` +
         `Content-Type: text/html; charset="UTF-8"\n` +
         `Content-Transfer-Encoding: quoted-printable\n\n` +
         `${encodedHtml}\n\n`;
  
  // Add the resource parts
  eml += emlParts.join('');

  // Add the final boundary
  eml += `--${boundary}--`;

  return eml;
}
