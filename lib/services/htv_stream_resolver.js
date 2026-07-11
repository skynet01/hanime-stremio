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
    this.metadataConcurrency = htv.metadataConcurrency || 24;
    this.metadataSampleSize = htv.metadataSampleSize || 12;
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
      if (response.status !== 200) {
        logger.warn('HTV stream metadata endpoint unavailable', {
          slug,
          status: response.status,
          contentType: response.headers && response.headers['content-type']
        });
        return byHeight;
      }
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
   * Read duration and segment URLs from a playable media playlist.
   * @private
   */
  async _fetchHlsPlaylist(url) {
    const response = await axios.get(url, {
      headers: {
        referer: 'https://hanime.tv/',
        'user-agent': this.userAgent
      },
      timeout: this.timeoutMs,
      validateStatus: () => true
    });
    if (response.status !== 200 || typeof response.data !== 'string') {
      throw new Error(`playlist returned status ${response.status}`);
    }

    let durationSeconds = 0;
    const segments = [];
    let pendingDuration = 0;
    for (const rawLine of response.data.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (line.startsWith('#EXTINF:')) {
        const seconds = Number.parseFloat(line.slice('#EXTINF:'.length));
        if (Number.isFinite(seconds)) {
          pendingDuration = seconds;
          durationSeconds += seconds;
        }
      } else if (line && !line.startsWith('#')) {
        segments.push({
          url: new URL(line, url).toString(),
          durationSeconds: pendingDuration
        });
        pendingDuration = 0;
      }
    }

    return {
      durationMs: Math.round(durationSeconds * 1000),
      segments
    };
  }

  /**
   * Obtain a segment's full byte size without downloading it. The current CDN
   * omits Content-Length on HEAD but exposes the total in a one-byte range.
   * @private
   */
  async _fetchSegmentSize(url) {
    const response = await axios.get(url, {
      headers: {
        Range: 'bytes=0-0',
        referer: 'https://hanime.tv/',
        'user-agent': this.userAgent
      },
      responseType: 'stream',
      timeout: Math.min(this.timeoutMs, 5000),
      validateStatus: () => true
    });

    if (response.data && typeof response.data.destroy === 'function') {
      response.data.destroy();
    }

    const contentRange = response.headers && response.headers['content-range'];
    const rangeMatch = typeof contentRange === 'string'
      ? contentRange.match(/\/([0-9]+)$/)
      : null;
    if (rangeMatch) return Number(rangeMatch[1]);

    const contentLength = Number(response.headers && response.headers['content-length']);
    return response.status === 200 && Number.isFinite(contentLength) && contentLength > 0
      ? contentLength
      : null;
  }

  /**
   * Map async work with a fixed upper bound on simultaneous CDN requests.
   * @private
   */
  async _mapWithConcurrency(items, mapper) {
    const results = new Array(items.length);
    let nextIndex = 0;
    const workers = Array.from(
      { length: Math.min(this.metadataConcurrency, items.length) },
      async () => {
        while (nextIndex < items.length) {
          const index = nextIndex++;
          results[index] = await mapper(items[index]);
        }
      }
    );
    await Promise.all(workers);
    return results;
  }

  /**
   * Select evenly distributed segments so fallback size estimation has a
   * stable, small request budget regardless of movie length.
   * @private
   */
  _sampleSegments(segments) {
    if (segments.length <= this.metadataSampleSize) return segments;

    const sampled = [];
    for (let index = 0; index < this.metadataSampleSize; index++) {
      const segmentIndex = Math.floor(
        (index + 0.5) * segments.length / this.metadataSampleSize
      );
      sampled.push(segments[segmentIndex]);
    }
    return sampled;
  }

  /**
   * Derive metadata from the playable HLS assets when the legacy manifest
   * endpoint is unavailable. Duration comes from all EXTINF entries; size is
   * estimated from evenly sampled segment Content-Range totals.
   * @private
   */
  async _fetchHlsMetadata(sources) {
    const byHeight = new Map();
    const playlists = await Promise.all(sources.map(async (source) => {
      try {
        return await this._fetchHlsPlaylist(source.url);
      } catch (error) {
        logger.warn('HTV HLS metadata playlist fetch failed', {
          height: source.height,
          error: error.message
        });
        return null;
      }
    }));

    const segmentTasks = [];
    playlists.forEach((playlist, sourceIndex) => {
      if (!playlist) return;
      this._sampleSegments(playlist.segments).forEach(segment => {
        segmentTasks.push({ sourceIndex, ...segment });
      });
    });

    const segmentSizes = await this._mapWithConcurrency(segmentTasks, async (task) => {
      try {
        return await this._fetchSegmentSize(task.url);
      } catch (error) {
        return null;
      }
    });

    const totals = sources.map(() => ({ bytes: 0, durationSeconds: 0 }));
    segmentTasks.forEach((task, index) => {
      const bytes = segmentSizes[index];
      if (Number.isFinite(bytes) && bytes > 0 && task.durationSeconds > 0) {
        totals[task.sourceIndex].bytes += bytes;
        totals[task.sourceIndex].durationSeconds += task.durationSeconds;
      }
    });

    playlists.forEach((playlist, index) => {
      if (!playlist) return;
      const total = totals[index];
      const estimatedBytes = total.durationSeconds > 0
        ? total.bytes * (playlist.durationMs / 1000) / total.durationSeconds
        : 0;
      const filesizeMbs = estimatedBytes > 0
        ? Math.round((estimatedBytes / (1024 * 1024)) * 10) / 10
        : undefined;
      byHeight.set(Number(sources[index].height), {
        filesizeMbs,
        durationMs: playlist.durationMs || undefined
      });
    });

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

    const sources = Array.isArray(payload.sources) ? payload.sources : [];
    const normalizedSources = sources
      .map((s) => {
        const rawUrl = s.url || s.src || '';
        if (!rawUrl) return null;
        return {
          height: s.height || s.label || '',
          url: rawUrl.startsWith('http') ? rawUrl : `${this.hlsHost}${rawUrl}`
        };
      })
      .filter(Boolean);

    const metadata = await metadataPromise;
    const missingMetadataSources = normalizedSources.filter((source) => {
      const meta = metadata.get(Number(source.height));
      return !meta || !meta.filesizeMbs || !meta.durationMs;
    });
    const hlsMetadata = missingMetadataSources.length > 0
      ? await this._fetchHlsMetadata(missingMetadataSources)
      : new Map();

    return normalizedSources.map((source) => {
      const primary = metadata.get(Number(source.height)) || {};
      const fallback = hlsMetadata.get(Number(source.height)) || {};
      return {
        ...source,
        filesizeMbs: primary.filesizeMbs || fallback.filesizeMbs,
        durationMs: primary.durationMs || fallback.durationMs
      };
    });
  }
}

module.exports = HtvStreamResolver;
module.exports.sealMessage = sealMessage;
module.exports.openMessage = openMessage;
