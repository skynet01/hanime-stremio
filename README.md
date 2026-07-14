# Hanime.tv Stremio Addon

[![Fly.io](https://img.shields.io/badge/Fly.io-hosting-unavailable?logo=fly.io&color=lightgrey)](#)

A self-hostable Stremio addon for browsing and streaming content from Hanime.tv, with authenticated stream access, catalog search, genre filtering, brand/studio filtering, and an Uncensored catalog.

# ⚠️ Important Announcement – Configuration Required

Hanime has **removed all stream URLs from their public API**.  
To access streams, the addon now requires **authentication with your Hanime account**.

---

### ✅ Configuration Required

This addon version includes a **required configuration page** with credential verification.  
You **must** enter your **Hanime email and password** to access streams.

**Benefits:**
- ✅ **Streams are now working** with authenticated access
- ✅ **Premium users** automatically get **1080p quality**
- ✅ The configure page verifies credentials before generating the install URL
- ✅ Credentials are securely stored and only used for API authentication
- ✅ Multiple users can use the same addon instance with different credentials

**How to Configure:**
1. Install the addon in Stremio
2. When prompted, click "Configure" or go to the addon settings
3. Enter your Hanime email and password
4. Save the configuration
5. Streams will now work!

---

### 🔒 Security Note

Your credentials are stored locally in Stremio and only sent to Hanime's API for authentication.  
The addon does not store or log your password in plain text.

## Quick Start

### Using Docker Compose (Recommended)

```bash
docker compose up -d
```

The addon will be accessible at `http://localhost:61327/manifest.json`

### Using Podman Compose

```bash
podman compose up -d
```

### Using Node.js Directly

```bash
npm install
npm start
```

## Deployed / Hosted Version Status

🚫 **Public hosted version is currently unavailable**

The addon is **no longer hosted publicly**.

Running this addon on Fly.io (or similar platforms) requires **paid plans with high and unpredictable costs** due to:

- Continuous traffic from Stremio clients
- Bandwidth-heavy streaming metadata requests
- Always-on server requirements

Because of this, maintaining a **free or public hosted instance is not financially sustainable**.

Stremio Addons page:
```
https://stremio-addons.net/addons/hanime
```
> **Note:** Issues with the deployed version may be caused by free hosting limitations or Hanime CDN blocking. For best performance, self-host using Docker.

## Installation in Stremio

1. Open Stremio
2. Go to Addons → Community Addons
3. Paste the manifest URL (local: `http://localhost:61327/manifest.json`)
4. Click "Install"

## What's Changed From the Original

This fork includes several changes beyond the original Hanime Stremio addon:

- Authenticated stream access after Hanime removed stream URLs from the public API
- Required configuration flow for Hanime email/password credentials
- `/verify` endpoint used by the configure page to test credentials before install
- Multi-user session handling so different Stremio users can use different Hanime credentials
- Premium account support for 1080p streams when Hanime marks the account as premium
- Uncensored catalog that automatically applies the `uncensored` tag
- Genre and brand/studio filtering in catalog browsing
- Curated Uncensored genre and brand lists that only show filters with matching uncensored results
- Cleaner Stremio search behavior: global search is limited to the main Hanime catalog and Series catalog to avoid duplicate rows from sort-only catalogs
- Redesigned configure/landing page with the current install URL handling
- Runtime logo support through `/images/logo.png`
- Additional discovery scripts for refreshing uncensored brand and genre datasets
- Updated cache, rate limit, slow-down, and proxy-aware server behavior for self-hosting

## Configuration

Key environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `61327` | Server port |
| `PUBLIC_URL` | - | Public base URL used for manifest assets and install links |
| `LOG_LEVEL` | `debug` | Logging level (debug/info/warn/error/silent) |
| `CACHE_ENABLED` | `true` | Enable caching |
| `CACHE_MAX_SIZE` | `5000` | Maximum cache entries |
| `CACHE_BROWSER_CACHE` | `true` | Enable browser caching |
| `CACHE_REDIS_URL` | - | Redis connection URL for persistent cache |
| `REDIS_URL` | - | Backward-compatible Redis connection URL |
| `RATE_LIMIT_ENABLED` | `true` | Enable request rate limiting |
| `SLOW_DOWN_ENABLED` | `true` | Enable gradual request slow-down before rate limits |
| `TRUST_PROXY` | `true` | Trust reverse proxy headers for client IP detection |
| `ADDON_NAME` | `Hanime` | Stremio addon display name |
| `ADDON_ID` | `hanime-addon` | Stremio addon ID |
| `ADDON_VERSION` | package version | Override manifest version |
| `HTV_HANDSHAKE_URL` | hosted relay URL | Cloudflare Worker handshake relay endpoint |
| `HTV_RELAY_SECRET` | - | Bearer secret shared with the handshake relay Worker |

See `docker-compose.yml` for all available options.

The hosted deployment resolves streams through the single-purpose Worker in
`workers/handshake-relay`. Self-hosters must deploy that Worker (or an
equivalent fixed-target relay) and configure the same `HTV_RELAY_SECRET` on
both services.

Deploy the included Worker after adjusting its account and custom domain:

```bash
npx wrangler secret put RELAY_SECRET \
  --config workers/handshake-relay/wrangler.jsonc
npx wrangler deploy --config workers/handshake-relay/wrangler.jsonc
```

Set the identical value as `HTV_RELAY_SECRET` in the addon environment. The
relay accepts only authenticated `POST /api/v11/handshake` requests and has a
fixed Hanime upstream; it is not a general-purpose proxy.

Upstream caches are demand-driven; the addon does not poll Hanime on a timer.
Stream handshakes and the shared search dataset are reused for six hours after
the first request, while metadata is reused for 36 hours.

## Available Catalogs

- **Hanime**: main searchable catalog with genre and brand/studio filters
- **Hanime Series**: searchable series aggregation catalog
- **Hanime Uncensored**: uncensored-only browsing with pruned genre and brand/studio filters
- **Hanime Recent**, **Most Likes**, **Most Views**, and **Newest**: sort-focused browsing catalogs

Search is intentionally exposed only on the main Hanime and Series catalogs. The sort-only and Uncensored catalogs omit search to prevent Stremio from showing duplicate rows for the same query.

## Maintenance Scripts

Refresh generated Uncensored filter datasets when Hanime's catalog changes:

```bash
npm run discover-brands
npm run discover-uncensored-genres
```

These scripts probe Hanime's search API with paced requests and update:

- `lib/data/uncensored-brands.json`
- `lib/data/uncensored-genres.json`

## Troubleshooting

- **Thumbnails not loading**: Ensure `PUBLIC_URL` is set correctly
- **No streams**: Check network connectivity and enable `LOG_LEVEL=debug`
- **Credential verification fails**: Confirm the Hanime account works on hanime.tv and retry from `/configure`
- **Duplicate search rows**: Reinstall the addon so Stremio picks up the latest manifest extras
- **High memory**: Reduce `CACHE_MAX_SIZE`
- **Slow catalogs**: Increase `CACHE_MAX_SIZE` or adjust cache TTLs

## Credits

Forked from [mrcanelas/hanime-tv-addon](https://github.com/mrcanelas/hanime-tv-addon).

## License

MIT

## Disclaimer

This addon is for educational purposes only. Ensure you comply with local laws and Hanime.tv's terms of service when using this addon.
