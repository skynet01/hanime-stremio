const crypto = require('crypto');
const axios = require('axios');
const { getAppSignature } = require('@nekolab/hanime/dist/modules/crypto');
const logger = require('../logger');
const signatureService = require('./htv_signature_service');

// hanime's "insecure" message envelope: AES-256-GCM, key = SHA-256 of a fixed
// label, AAD = a second fixed label. Used to seal the handshake request token
// and to open the `x-token` response header. (Names taken verbatim from
// hanime's app_init bundle: encryptInsecureMessage / decryptInsecureMessage.)
const MSG_KEY = crypto.createHash('sha256').update('htv-insecure-handshake-v1').digest();
const MSG_AAD = Buffer.from('htv-insecure-v1');

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlDecode = (str) => Buffer.from(
  String(str).replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(str.length / 4) * 4, '='),
  'base64'
);

/**
 * Seal an object into a hanime "insecure" message token.
 * @param {Object} obj
 * @returns {string} base64url token
 */
function sealMessage(obj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', MSG_KEY, iv, { authTagLength: 16 });
  cipher.setAAD(MSG_AAD);
  const data = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  const envelope = {
    v: 1,
    alg: 'AES-256-GCM',
    iv: b64url(iv),
    tag: b64url(cipher.getAuthTag()),
    data: b64url(data)
  };
  return b64url(Buffer.from(JSON.stringify(envelope)));
}

/**
 * Open a hanime "insecure" message token.
 * @param {string} token base64url token
 * @returns {Object} parsed payload
 */
function openMessage(token) {
  const envelope = JSON.parse(b64urlDecode(token).toString('utf8'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', MSG_KEY, b64urlDecode(envelope.iv), { authTagLength: 16 });
  decipher.setAAD(MSG_AAD);
  decipher.setAuthTag(b64urlDecode(envelope.tag));
  const plain = Buffer.concat([decipher.update(b64urlDecode(envelope.data)), decipher.final()]).toString('utf8');
  return JSON.parse(plain);
}

class HtvStreamResolver {
  /**
   * @param {Object} config - App config (uses config.api.htv)
   */
  constructor(config) {
    const htv = (config && config.api && config.api.htv) || {};
    this.handshakeUrl = htv.handshakeUrl || 'https://guest.freeanimehentai.net/api/v11/handshake';
    this.manifestUrl = htv.manifestUrl || 'https://guest.freeanimehentai.net/rapi/v7/videos_manifests';
    this.hlsHost = htv.hlsHost || 'https://hanime.tv';
    this.timeoutMs = htv.timeoutMs || 15000;
    this.userAgent = htv.userAgent || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';
  }

  /**
   * Fetch per-resolution metadata (file size, duration) for a slug. The
   * playback URLs on this endpoint are dead, but its metadata is real; we use
   * it only to label the streams. App2-signed, no login required.
   * @private
   * @param {string} slug
   * @param {string} [sessionToken]
   * @returns {Promise<Map<number, {filesizeMbs: number, durationMs: number}>>}
   */
  async _fetchStreamMetadata(slug, sessionToken) {
    const byHeight = new Map();
    try {
      const t = Math.floor(Date.now() / 1000);
      const response = await axios.get(`${this.manifestUrl}/${encodeURIComponent(slug)}`, {
        headers: {
          'x-claim': String(t),
          'x-signature-version': 'app2',
          'x-signature': getAppSignature(t),
          'x-session-token': sessionToken || '',
          'user-agent': this.userAgent
        },
        timeout: this.timeoutMs,
        validateStatus: () => true
      });
      if (response.status !== 200) return byHeight;
      const servers = (response.data && response.data.videos_manifest && response.data.videos_manifest.servers) || [];
      servers.forEach((server) => {
        (server.streams || []).forEach((s) => {
          const height = Number(s.height);
          if (height && !byHeight.has(height)) {
            byHeight.set(height, {
              filesizeMbs: s.filesize_mbs || 0,
              durationMs: s.duration_in_ms || 0
            });
          }
        });
      });
    } catch (error) {
      logger.debug('HTV stream metadata fetch failed', { slug, error: error.message });
    }
    return byHeight;
  }

  /**
   * Resolve playable HLS streams for a video slug via the /api/v11/handshake
   * flow. Returns absolute hanime.tv/hls URLs that Stremio can play directly
   * (their segments and AES key are openly fetchable). Empty array on failure.
   *
   * @param {string} slug - Video slug (e.g. "bible-black-6")
   * @param {string} [sessionToken] - Optional session token to unlock premium
   *   (e.g. 1080p) qualities; omit for guest playback.
   * @returns {Promise<Array<{height: (string|number), url: string}>>}
   */
  async resolveStreams(slug, sessionToken) {
    if (!slug) return [];

    // Metadata (size/duration) is label-only and comes from a separate
    // endpoint, so fetch it alongside the handshake rather than serially.
    const metadataPromise = this._fetchStreamMetadata(slug, sessionToken);

    const sig = await signatureService.getSignature();
    if (!sig) {
      logger.warn('HTV stream resolve: no signature available', { slug });
      return [];
    }

    const token = sealMessage({
      timestamp_unix: Math.floor(Date.now() / 1000),
      directive: 'htv_player_handshake',
      slug
    });

    const headers = {
      'content-type': 'application/json',
      accept: 'application/json',
      'user-agent': this.userAgent,
      referer: 'https://hanime.tv/',
      origin: 'https://hanime.tv',
      'x-signature-version': 'web2',
      'x-signature': sig.signature,
      'x-time': String(sig.time)
    };
    if (sessionToken) headers['x-session-token'] = sessionToken;

    let response;
    try {
      response = await axios.post(this.handshakeUrl, { token }, {
        headers,
        timeout: this.timeoutMs,
        validateStatus: () => true
      });
    } catch (error) {
      logger.warn('HTV handshake request failed', { slug, error: error.message });
      return [];
    }

    const xToken = response.headers['x-token'];
    if (response.status !== 200 || !xToken) {
      logger.warn('HTV handshake non-200 or missing x-token', {
        slug,
        status: response.status,
        errorId: response.data && response.data.error_id
      });
      return [];
    }

    let payload;
    try {
      payload = openMessage(xToken);
    } catch (error) {
      logger.warn('HTV handshake x-token decode failed', { slug, error: error.message });
      return [];
    }

    const metadata = await metadataPromise;
    const sources = Array.isArray(payload.sources) ? payload.sources : [];
    return sources
      .map((s) => {
        const rawUrl = s.url || s.src || '';
        if (!rawUrl) return null;
        const url = rawUrl.startsWith('http') ? rawUrl : `${this.hlsHost}${rawUrl}`;
        const meta = metadata.get(Number(s.height)) || {};
        return {
          height: s.height || s.label || '',
          url,
          filesizeMbs: meta.filesizeMbs || 0,
          durationMs: meta.durationMs || 0
        };
      })
      .filter(Boolean);
  }
}

module.exports = HtvStreamResolver;
module.exports.sealMessage = sealMessage;
module.exports.openMessage = openMessage;
