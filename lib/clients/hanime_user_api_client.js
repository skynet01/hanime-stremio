const { HanimeClient } = require('@nekolab/hanime');

// Upstream retired the /rapi/v4 app API (2026-07). Auth now lives on /rapi/v7
// with an {email, password} payload instead of v4's {burger, fries}, and
// per-video data moved to the v8 endpoint. The bundled @nekolab/hanime lib
// still targets v4, so we override its base URL and bypass its login() and
// getHentaiVideo() while keeping its request client (signatures, casing).
const APP_API_BASE_V7 = 'https://www.universal-cdn.com/rapi/v7';

/**
 * Clean API wrapper for Hanime operations
 * Provides methods without console logging for use in other projects
 * Automatically handles session token expiration and refresh
 */
class HanimeUserApi {
  /**
   * Create a new HanimeAPI instance
   * @param {string} sessionToken - Optional existing session token
   * @param {string} email - Optional user email for auto-refresh
   * @param {string} password - Optional user password for auto-refresh
   * @param {number} sessionTokenExpireTimeUnix - Optional expiration time (Unix timestamp)
   */
  constructor(sessionToken = null, email = null, password = null, sessionTokenExpireTimeUnix = null) {
    this.client = this._createClient(sessionToken);
    this.email = email;
    this.password = password;
    this.sessionTokenExpireTimeUnix = sessionTokenExpireTimeUnix;
  }

  // ============================================================================
  // Public Methods
  // ============================================================================

  /**
   * Login with email and password
   * @param {string} email - User email
   * @param {string} password - User password
   * @returns {Promise<Object>} Login result with user info and session token
   */
  async login(email, password) {
    // v7 sessions endpoint; response is camelized by the lib's request client
    const loginResult = await this._withTimeout(
      this.client.reqClient.request(
        this.client.BASE_URLS.app,
        '/sessions',
        { email, password },
        'POST'
      ),
      'login'
    );
    this.client.sessionToken = loginResult.sessionToken;
    this.client.info = loginResult;

    // Store credentials and expiration for auto-refresh
    this.email = email;
    this.password = password;
    this.sessionTokenExpireTimeUnix = loginResult.sessionTokenExpireTimeUnix;
    this.isPremium = !!loginResult.user.isAbleToAccessPremium;

    return {
      user: {
        id: loginResult.user.id,
        email: loginResult.user.email,
        name: loginResult.user.name,
        slug: loginResult.user.slug,
        coins: loginResult.user.coins,
        avatarUrl: loginResult.user.avatarUrl,
        isPremium: loginResult.user.isAbleToAccessPremium,
        premiumStatus: loginResult.user.btPremiumStatus
      },
      sessionToken: loginResult.sessionToken,
      sessionTokenExpireTimeUnix: loginResult.sessionTokenExpireTimeUnix,
      sessionTokenExpiresAt: new Date(loginResult.sessionTokenExpireTimeUnix * 1000),
      fullResponse: loginResult // Include full response if needed
    };
  }

  /**
   * Get current session token
   * @returns {string|null} Session token or null if not logged in
   */
  getSessionToken() {
    return this.client.sessionToken || null;
  }

  /**
   * Get session token expiration time (Unix timestamp)
   * @returns {number|null} Expiration time or null if not set
   */
  getSessionTokenExpireTimeUnix() {
    return this.sessionTokenExpireTimeUnix || null;
  }

  /**
   * Check if user is logged in
   * @returns {boolean} True if logged in
   */
  isLoggedIn() {
    return this.getSessionToken() !== null;
  }

  /**
   * Set credentials for auto-refresh (useful if credentials weren't provided in constructor)
   * @param {string} email - User email
   * @param {string} password - User password
   */
  setCredentials(email, password) {
    this.email = email;
    this.password = password;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Build a HanimeClient pointed at the current (v7) app API.
   * Always create clients through this so the base-URL override survives
   * session refreshes.
   * @private
   * @param {string|null} sessionToken - Session token or null
   * @returns {HanimeClient} Configured client
   */
  _createClient(sessionToken) {
    const client = new HanimeClient(sessionToken);
    client.BASE_URLS.app = APP_API_BASE_V7;
    return client;
  }

  /**
   * Bound a vendored-client request with a timeout. The bundled
   * @nekolab/hanime RequestsClient uses fetch() with no signal/timeout, so a
   * slow or stalled upstream would otherwise hang login/stream requests
   * indefinitely (and hold the request open until Stremio itself gives up).
   * @private
   * @param {Promise} promise - The in-flight request
   * @param {string} label - Operation name for the timeout error
   * @param {number} ms - Timeout in milliseconds (default 15s)
   * @returns {Promise} Resolves with the request result or rejects on timeout
   */
  _withTimeout(promise, label, ms = 15000) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Hanime ${label} request timed out after ${ms}ms`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

}

module.exports = HanimeUserApi;
