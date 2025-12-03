'use strict';

require('dotenv').config();

const express = require('express');
const axios = require('axios');
const { exec } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// Configuration
const PORT = process.env.PORT || 3000;
const REQUEST_TIMEOUT = 120000;
const API_TIMEOUT = 30000;
const FFMPEG_TIMEOUT = 120000;

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36';

const VIDEO_ID_PATTERN = /(s_[0-9A-Za-z_-]{8,})/;

const DELOGO = { x: 'iw-160', y: 'ih-60', w: 150, h: 50 };

// Endpoints (base64)
const ENDPOINTS = {
    CDN_PROXY: 'aHR0cHM6Ly9hcGkuc29yYWNkbi53b3JrZXJzLmRldi9kb3dubG9hZC1wcm94eT9pZD0=',
    SORA_API: 'aHR0cHM6Ly9zb3JhLmNoYXRncHQuY29tL2JhY2tlbmQvcHJvamVjdF95L3Bvc3Qv',
    OPENAI_CDN: 'aHR0cHM6Ly9jZG4ub3BlbmFpLmNvbS9NUDQv',
};

const Source = { NONE: -1, CDN_PROXY: 1, SORA_API: 2, OPENAI_CDN: 3 };

const config = {
    bearerToken: process.env.SORA_BEARER_TOKEN || '',
    cookies: process.env.SORA_COOKIES || '',
};

// Helpers
const decode = (s) => Buffer.from(s, 'base64').toString('utf-8');
const extractId = (url) => url.match(VIDEO_ID_PATTERN)?.[1] || null;
const formatSize = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

function generateHash(id, ts) {
    return crypto.createHash('md5').update(`${id}:${ts}:${process.pid}`).digest('hex').slice(0, 8);
}

function safeDelete(filePath) {
    try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {}
}

// Download strategies
async function fromCdnProxy(videoId, requestId) {
    try {
        const res = await axios({
            url: decode(ENDPOINTS.CDN_PROXY) + videoId,
            method: 'GET',
            responseType: 'stream',
            timeout: REQUEST_TIMEOUT,
            headers: { 'User-Agent': USER_AGENT, 'X-Request-Id': requestId },
        });

        if (res.status === 200 && res.headers['content-type']?.includes('video')) {
            return res;
        }
    } catch {}
    return null;
}

async function fromSoraApi(videoId, token, cookies) {
    if (!token) return null;

    try {
        const headers = {
            'User-Agent': USER_AGENT,
            Accept: 'application/json',
            Referer: `https://sora.chatgpt.com/p/${videoId}`,
            Origin: 'https://sora.chatgpt.com',
            Authorization: `Bearer ${token}`,
        };
        if (cookies) headers.Cookie = cookies;

        const api = await axios({
            url: decode(ENDPOINTS.SORA_API) + videoId,
            method: 'GET',
            timeout: API_TIMEOUT,
            headers,
        });

        const att = api.data?.post?.attachments?.[0];
        if (!att) return null;

        let videoUrl = att.download_urls?.no_watermark;
        let needsProcessing = false;

        if (!videoUrl) {
            videoUrl = att.downloadable_url || att.download_urls?.watermark || att.encodings?.source?.path;
            needsProcessing = true;
        }

        if (!videoUrl) return null;

        const res = await axios({
            url: videoUrl,
            method: 'GET',
            responseType: 'stream',
            timeout: REQUEST_TIMEOUT,
            headers: { 'User-Agent': USER_AGENT },
        });

        return res.status === 200 ? { response: res, needsProcessing } : null;
    } catch {}
    return null;
}

async function fromOpenAiCdn(videoId) {
    try {
        const res = await axios({
            url: decode(ENDPOINTS.OPENAI_CDN) + videoId + '.mp4',
            method: 'GET',
            responseType: 'stream',
            timeout: API_TIMEOUT,
            headers: { 'User-Agent': USER_AGENT },
        });
        return res.status === 200 ? res : null;
    } catch {}
    return null;
}

// Video processing
async function saveStream(stream, outputPath) {
    const ws = fs.createWriteStream(outputPath);
    stream.data.pipe(ws);
    return new Promise((resolve, reject) => {
        ws.on('finish', resolve);
        ws.on('error', reject);
    });
}

async function removeWatermark(input, output) {
    const filter = `delogo=x=${DELOGO.x}:y=${DELOGO.y}:w=${DELOGO.w}:h=${DELOGO.h}`;
    const cmd = `ffmpeg -i "${input}" -vf "${filter}" -c:a copy "${output}" -y`;

    return new Promise((resolve, reject) => {
        exec(cmd, { timeout: FFMPEG_TIMEOUT }, (err) => {
            safeDelete(input);
            if (err) {
                safeDelete(output);
                reject(new Error('Processing failed'));
            } else {
                resolve();
            }
        });
    });
}

// Express app
const app = express();

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

app.use(express.json({ limit: '100mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (_, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/download', async (req, res) => {
    const { url } = req.body;
    const token = req.body.token || config.bearerToken;
    const cookies = req.body.cookies || config.cookies;

    const videoId = extractId(url || '');
    if (!videoId) {
        return res.status(400).json({ error: 'Invalid video URL or code' });
    }

    const hash = generateHash(videoId, Date.now());
    const tmpDir = os.tmpdir();
    const inputPath = path.join(tmpDir, `${hash}_in.mp4`);
    const outputPath = path.join(tmpDir, `${hash}_out.mp4`);

    try {
        let stream = null;
        let source = Source.NONE;
        let needsProcessing = false;

        // Try CDN proxy first (no watermark)
        stream = await fromCdnProxy(videoId, hash);
        if (stream) {
            source = Source.CDN_PROXY;
        }

        // Try Sora API
        if (!stream) {
            const result = await fromSoraApi(videoId, token, cookies);
            if (result) {
                stream = result.response;
                source = Source.SORA_API;
                needsProcessing = result.needsProcessing;
            }
        }

        // Try OpenAI CDN
        if (!stream) {
            stream = await fromOpenAiCdn(videoId);
            if (stream) source = Source.OPENAI_CDN;
        }

        if (!stream) {
            return res.status(404).json({ error: 'Video source unavailable' });
        }

        await saveStream(stream, inputPath);

        let buffer;
        if (needsProcessing) {
            await removeWatermark(inputPath, outputPath);
            buffer = fs.readFileSync(outputPath);
            safeDelete(outputPath);
        } else {
            buffer = fs.readFileSync(inputPath);
            safeDelete(inputPath);
        }

        res.json({
            cleanUrl: `data:video/mp4;base64,${buffer.toString('base64')}`,
            size: formatSize(buffer.length),
            filename: `${videoId}_HD.mp4`,
            source,
            quality: 'HD',
            delogoApplied: needsProcessing,
        });
    } catch (err) {
        safeDelete(inputPath);
        safeDelete(outputPath);
        res.status(500).json({ error: err.message || 'Download failed' });
    }
});

app.listen(PORT, () => console.log(`SoraPure running on port ${PORT}`));
