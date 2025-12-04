# SoraPure - Download Sora2 Videos Without Watermark

Download OpenAI Sora2 videos without watermark.

**Live:** [sorapure.vercel.app](https://sorapure.vercel.app)

**Telegram Bot:** [@sorapure_bot](https://t.me/sorapure_bot)

![Before & After](preview.jpg)

## How It Works

### Problem

OpenAI Sora2 adds watermarks to all public videos. When downloading through the official interface or API (`/backend/project_y/post/{id}`), you get a version with a watermark in the bottom right corner.

### Solution

An alternative CDN proxy was discovered that returns original videos **without watermark**.

---

## Architecture

```
┌─────────────┐     POST /download      ┌─────────────┐
│   Browser   │ ──────────────────────► │   Express   │
│ (index.html)│                         │   Server    │
└─────────────┘                         └──────┬──────┘
                                               │
                    ┌──────────────────────────┼──────────────────────────┐
                    │                          │                          │
                    ▼                          ▼                          ▼
           ┌───────────────┐          ┌───────────────┐          ┌───────────────┐
           │   Method 1    │          │   Method 2    │          │   Method 3    │
           │   CDN Proxy   │          │  project_y    │          │  cdn.openai   │
           │   (HD)        │          │ API + FFmpeg  │          │   fallback    │
           │  NO WM ✓      │          │  delogo       │          │               │
           └───────────────┘          └───────────────┘          └───────────────┘
```

### Download Methods (Priority Order)

| #   | Method                 | Watermark | Auth Required      |
| --- | ---------------------- | --------- | ------------------ |
| 1   | CDN Proxy              | NO        | No                 |
| 2   | project_y API + FFmpeg | Removed   | Yes (Bearer token) |
| 3   | cdn.openai.com         | Maybe     | No                 |

---

## Installation

```bash
# Clone
git clone https://github.com/bakhtiersizhaev/sorapure.git
cd sorapure

# Install dependencies
npm install

# Run
npm start
# or
node server.js
```

Service will be available at http://localhost:3000

## Configuration (.env)

```env
# Optional - only used as fallback
SORA_BEARER_TOKEN=
SORA_COOKIES=
PORT=3000
```

Token and cookies are only needed if the primary method stops working.

### How to Get Bearer Token (if needed)

1. Open https://sora.chatgpt.com and log in
2. Open DevTools (F12) → Network tab
3. Open any video
4. Find request to `backend/project_y/post/s_...`
5. In Headers → Request Headers find `authorization`
6. Copy the value **after** `Bearer `

---

## API

### POST /download

**Request:**

```json
{
    "url": "https://sora.chatgpt.com/p/s_xxxxx"
}
```

or just video code:

```json
{
    "url": "s_xxxxx"
}
```

**Response:**

```json
{
    "cleanUrl": "data:video/mp4;base64,...",
    "size": "5.0 MB",
    "filename": "s_xxxxx_HD.mp4",
    "source": 1,
    "quality": "HD",
    "delogoApplied": false
}
```

| source | Description                           |
| ------ | ------------------------------------- |
| 1      | CDN proxy (no watermark)              |
| 2      | project_y API (FFmpeg delogo applied) |
| 3      | cdn.openai.com fallback               |

---

## Technical Details

### FFmpeg delogo (Fallback)

If CDN proxy is unavailable and official API is used, watermark is removed via FFmpeg:

```bash
ffmpeg -i input.mp4 -vf "delogo=x=iw-160:y=ih-60:w=150:h=50" -c:a copy output.mp4
```

Parameters:

- `x=iw-160` — 160 pixels from right edge
- `y=ih-60` — 60 pixels from bottom edge
- `w=150, h=50` — blur area size

---

## Dependencies

- **express** — HTTP server
- **axios** — HTTP client for downloading
- **dotenv** — configuration via .env
- **ffmpeg** (system) — for watermark removal (fallback method)

## Project Structure

```
sorapure/
├── server.js        # Express API server
├── public/
│   └── index.html   # Web interface
├── .env             # Configuration (don't commit!)
├── .env.example     # Configuration template
├── package.json
└── README.md
```

---

## License

MIT — use at your own risk.

## Disclaimer

This tool is intended for downloading your own content and educational purposes (demonstration of reverse engineering methods). Use for copyright infringement is prohibited. The author is not responsible for misuse.

---

## Author

**[Bakhtier Sizhaev](https://t.me/bakhtier_sizhaev)** (AI2KEY)

- Telegram: [@bakhtier_sizhaev](https://t.me/bakhtier_sizhaev)

---

## Changelog

- **v2.0** — Found and integrated CDN proxy (no watermark), modern UI
- **v1.0** — Initial version with Chinese CDNs (no longer working)
