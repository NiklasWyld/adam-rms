// In-memory S3 HTTP fixture, scoped to integration tests. Production always uses AdamRMS's S3 service.
// This fixture verifies object transfer and metadata integration, not AWS signature cryptography.
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const objects = new Map();
const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'ETag,Content-Disposition,Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    const url = new URL(req.url, 'http://127.0.0.1:19090');
    if (!url.pathname.startsWith('/planning-e2e/') || !/^[a-f0-9]{64}$/.test(url.searchParams.get('X-Amz-Signature') || '')) {
        res.writeHead(403); return res.end('Invalid test S3 request');
    }
    if (req.method === 'PUT') {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        objects.set(url.pathname, { bytes: Buffer.concat(chunks), type: req.headers['content-type'] || 'application/octet-stream' });
        res.setHeader('ETag', '"planning-fixture"'); res.writeHead(200); return res.end();
    }
    const object = objects.get(url.pathname);
    if (!object) { res.writeHead(404); return res.end(); }
    res.setHeader('Content-Type', object.type);
    if (url.searchParams.has('response-content-disposition')) res.setHeader('Content-Disposition', url.searchParams.get('response-content-disposition'));
    res.setHeader('Content-Length', object.bytes.length);
    res.writeHead(200); res.end(req.method === 'HEAD' ? undefined : object.bytes);
});
server.listen(19090, '127.0.0.1', () => {
    const child = spawn(process.execPath, [require.resolve('@playwright/test/cli'), 'test', ...process.argv.slice(2)], {
        cwd: path.resolve(__dirname, '..'), stdio: 'inherit',
        env: { ...process.env, E2E_PLANNING_S3: '1' }
    });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
    child.on('exit', code => { process.exitCode = code === null ? 1 : code; server.close(); objects.clear(); });
});
server.on('error', error => { console.error(error); process.exitCode = 1; });
