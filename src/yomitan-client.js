/**
 * Yomitan HTTP API Client
 * Yomitan's backend.js exposes a simple HTTP server (usually on 127.0.0.1:19633)
 * which accepts POST requests with a specific JSON structure.
 */

// Default Yomitan API Server URL
const DEFAULT_URL = process.env.YOMITAN_API_URL || 'http://127.0.0.1:19633';

export class YomitanClient {
  constructor(baseUrl = DEFAULT_URL) {
    this.baseUrl = baseUrl;
  }

  /**
   * Send a request to the Yomitan HTTP API
   * @param {string} action The action to perform (e.g. 'termEntries', 'kanjiEntries')
   * @param {object} body The request body parameters
   * @returns {Promise<any>} The parsed response data
   */
  async invoke(action, body = {}) {
    const maxRetries = 3;
    const timeoutMs = 15000;
    let attempt = 0;

    while (attempt < maxRetries) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        // Build URL including action path e.g. http://127.0.0.1:19633/termEntries
        const url = new URL(action, this.baseUrl).toString();
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const responseJson = await response.json();

        // HTTP API returns the data directly (yomitan_api.py extracts 'data' from NativeMessaging response)
        return responseJson;
      } catch (error) {
        clearTimeout(timeoutId);
        
        attempt++;
        
        if (error.name === 'AbortError') {
          if (attempt >= maxRetries) throw new Error(`Yomitan API timeout after ${timeoutMs}ms.`);
        } else if (error.cause && error.cause.code === 'ECONNREFUSED') {
          if (attempt >= maxRetries) {
            throw new Error(
              `Failed to connect to Yomitan API at ${this.baseUrl}. ` +
              `Make sure Yomitan is running and 'Enable Yomitan API' is checked in Settings -> Advanced -> API.`
            );
          }
        } else {
          // Do not retry on other errors (like 400 Bad Request or parsing errors)
          throw error;
        }

        // Exponential backoff
        await new Promise(res => setTimeout(res, 500 * Math.pow(2, attempt - 1)));
      }
    }
  }

  // --- Convenience Methods ---

  async findTerms(term) {
    return this.invoke('termEntries', { term });
  }

  async findKanji(character) {
    return this.invoke('kanjiEntries', { character });
  }

  async tokenizeText(text, scanLength = 20, parser = 'internal') {
    return this.invoke('tokenize', { 
      text, 
      scanLength, 
      parser 
    });
  }

  async getAnkiFields(text, type = 'term', markers = [], maxEntries = 1, includeMedia = false) {
    return this.invoke('ankiFields', { 
      text, 
      type, 
      markers, 
      maxEntries, 
      includeMedia 
    });
  }

  async getVersion() {
    return this.invoke('yomitanVersion');
  }
}
