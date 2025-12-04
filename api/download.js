const https = require('https');
const http = require('http');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36';
const VIDEO_ID_PATTERN = /(s_[0-9A-Za-z_-]{8,})/;
// Primary: Direct CDN (fastest), Fallback: CDN Proxy
const CDN_DIRECT = 'https://oscdn2.dyysy.com/MP4/';
const CDN_PROXY = 'https://api.soracdn.workers.dev/download-proxy?id=';
const REQUEST_TIMEOUT = 60000;

const extractId = (url) => url.match(VIDEO_ID_PATTERN)?.[1] || null;
const formatSize = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

function fetchVideo(url) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;
        const chunks = [];

        const req = protocol.get(url, {
            headers: { 'User-Agent': USER_AGENT },
            timeout: REQUEST_TIMEOUT
        }, (res) => {
            if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }

            const contentType = res.headers['content-type'] || '';
            if (!contentType.includes('video')) {
                reject(new Error('Not a video'));
                return;
            }

            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        });

        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
    });
}

module.exports = async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { url } = req.body || {};
    const videoId = extractId(url || '');

    if (!videoId) {
        return res.status(400).json({ error: 'Invalid video URL or code' });
    }

    try {
        let buffer;
        let source = 0;

        // Try Direct CDN first (fastest)
        try {
            const directUrl = CDN_DIRECT + videoId + '.mp4';
            buffer = await fetchVideo(directUrl);
            source = 0; // Direct CDN
        } catch {
            // Fallback to CDN Proxy
            const proxyUrl = CDN_PROXY + videoId;
            buffer = await fetchVideo(proxyUrl);
            source = 1; // CDN Proxy
        }

        if (buffer.length > 45 * 1024 * 1024) {
            return res.status(413).json({ error: 'Video too large (>45MB)' });
        }

        return res.status(200).json({
            cleanUrl: `data:video/mp4;base64,${buffer.toString('base64')}`,
            size: formatSize(buffer.length),
            filename: `${videoId}_HD.mp4`,
            source,
            quality: 'HD',
            delogoApplied: false,
        });
    } catch (err) {
        console.error('Download error:', err.message);
        return res.status(500).json({ error: err.message || 'Download failed' });
    }
};
