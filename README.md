# Hanime.tv Stremio Addon

[![Fly.io](https://img.shields.io/badge/Fly.io-hosting-unavailable?logo=fly.io&color=lightgrey)](#)

A Stremio addon for browsing and streaming content from Hanime.tv.

# ⚠️ Important Announcement – Configuration Required

Hanime has **removed all stream URLs from their public API**.  
To access streams, the addon now requires **authentication with your Hanime account**.

---

### ✅ Configuration Required

This addon version includes a **required configuration page**.  
You **must** enter your **Hanime email and password** to access streams.

**Benefits:**
- ✅ **Streams are now working** with authenticated access
- ✅ **Premium users** automatically get **1080p quality**
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

## Configuration

Key environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `61327` | Server port |
| `LOG_LEVEL` | `info` | Logging level (debug/info/warn/error) |
| `CACHE_ENABLED` | `true` | Enable caching |
| `CACHE_MAX_SIZE` | `1000` | Maximum cache entries |
| `CACHE_BROWSER_CACHE` | `true` | Enable browser caching |
| `CACHE_REDIS_URL` | - | Redis connection URL for persistent cache |
| `CACHE_UPSTASH_REDIS_URL` | - | Upstash Redis URL for persistent cache |
| `CACHE_UPSTASH_REDIS_TOKEN` | - | Upstash Redis token for persistent cache |

See `docker-compose.yml` for all available options.

## Available Catalogs

- General catalog, Series, Recent, Most Likes, Most Views, Newest
- Search by name and filter by genre

## Troubleshooting

- **Thumbnails not loading**: Ensure `PUBLIC_URL` is set correctly
- **No streams**: Check network connectivity and enable `LOG_LEVEL=debug`
- **High memory**: Reduce `CACHE_MAX_SIZE`
- **Slow catalogs**: Increase `CACHE_MAX_SIZE` or adjust cache TTLs

## Credits

Forked from [mrcanelas/hanime-tv-addon](https://github.com/mrcanelas/hanime-tv-addon).

## License

MIT

## Disclaimer

This addon is for educational purposes only. Ensure you comply with local laws and Hanime.tv's terms of service when using this addon.
