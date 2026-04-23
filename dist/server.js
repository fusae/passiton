// Server module — HTTP + WebSocket
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import * as state from './state.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(__dirname, 'web');
const MIME = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
};
function json(res, status, data) {
    const body = JSON.stringify(data);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(body);
}
function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            }
            catch (e) {
                reject(e);
            }
        });
        req.on('error', reject);
    });
}
function serveStatic(res, filePath) {
    const ext = path.extname(filePath);
    const mime = MIME[ext] ?? 'application/octet-stream';
    try {
        const content = fs.readFileSync(filePath);
        res.writeHead(200, { 'Content-Type': mime });
        res.end(content);
    }
    catch {
        res.writeHead(404);
        res.end('Not found');
    }
}
export function createServer(router, port) {
    const clients = new Set();
    // Forward router events to all WebSocket clients
    router.on('event', (event) => {
        const payload = JSON.stringify(event);
        for (const ws of clients) {
            if (ws.readyState === 1 /* OPEN */) {
                ws.send(payload);
            }
        }
    });
    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url ?? '/', `http://localhost:${port}`);
        const pathname = url.pathname;
        const method = req.method ?? 'GET';
        // CORS for local dev
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        if (method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }
        try {
            // ── API routes ─────────────────────────────────────────────────────────
            // GET /api/agents
            if (pathname === '/api/agents' && method === 'GET') {
                const agents = await Promise.all(router.listAdapters().map(async (a) => ({
                    name: a.name,
                    healthy: await a.healthCheck().catch(() => false),
                })));
                return json(res, 200, agents);
            }
            // GET /api/sessions
            if (pathname === '/api/sessions' && method === 'GET') {
                const statusFilter = url.searchParams.get('status');
                const sessions = state.listSessions(statusFilter ? { status: statusFilter } : undefined);
                return json(res, 200, sessions);
            }
            // POST /api/sessions
            if (pathname === '/api/sessions' && method === 'POST') {
                const body = await parseBody(req);
                const session = router.startSession({
                    from: body.from,
                    to: body.to,
                    initialPrompt: body.initialPrompt,
                    maxRounds: body.maxRounds,
                    approveMode: body.approveMode,
                    cwd: body.cwd,
                });
                return json(res, 201, session);
            }
            // GET /api/sessions/:id
            const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/);
            if (sessionMatch && method === 'GET') {
                const session = state.getSession(sessionMatch[1]);
                if (!session)
                    return json(res, 404, { error: 'Not found' });
                const messages = state.getMessages(session.id);
                return json(res, 200, { ...session, messages });
            }
            // POST /api/sessions/:id/pause
            const pauseMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/pause$/);
            if (pauseMatch && method === 'POST') {
                const session = await router.pauseSession(pauseMatch[1]);
                return json(res, 200, session);
            }
            // POST /api/sessions/:id/resume
            const resumeMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/resume$/);
            if (resumeMatch && method === 'POST') {
                const body = await parseBody(req);
                const session = await router.resumeSession(resumeMatch[1], body.extraRounds);
                return json(res, 200, session);
            }
            // POST /api/sessions/:id/stop
            const stopMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/stop$/);
            if (stopMatch && method === 'POST') {
                const session = await router.stopSession(stopMatch[1]);
                return json(res, 200, session);
            }
            // POST /api/sessions/:id/message
            const msgMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/message$/);
            if (msgMatch && method === 'POST') {
                const body = await parseBody(req);
                const msg = router.injectMessage(msgMatch[1], body.content, body.side ?? 'from');
                return json(res, 200, msg);
            }
            // POST /api/sessions/:id/takeover
            const takeoverMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/takeover$/);
            if (takeoverMatch && method === 'POST') {
                const session = await router.pauseSession(takeoverMatch[1]);
                return json(res, 200, { ...session, takenOver: true });
            }
            // POST /api/sessions/:id/release
            const releaseMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/release$/);
            if (releaseMatch && method === 'POST') {
                const session = await router.resumeSession(releaseMatch[1]);
                return json(res, 200, session);
            }
            // ── Static files ────────────────────────────────────────────────────────
            if (method === 'GET') {
                if (pathname === '/' || pathname === '/index.html') {
                    return serveStatic(res, path.join(WEB_DIR, 'index.html'));
                }
                const staticPath = path.join(WEB_DIR, pathname.replace(/^\//, ''));
                if (fs.existsSync(staticPath) && fs.statSync(staticPath).isFile()) {
                    return serveStatic(res, staticPath);
                }
                // SPA fallback
                return serveStatic(res, path.join(WEB_DIR, 'index.html'));
            }
            json(res, 404, { error: 'Not found' });
        }
        catch (err) {
            console.error('[server] error:', err);
            json(res, 500, { error: String(err) });
        }
    });
    // ── WebSocket ──────────────────────────────────────────────────────────────
    const wss = new WebSocketServer({ server, path: '/ws' });
    wss.on('connection', (ws) => {
        clients.add(ws);
        ws.on('close', () => clients.delete(ws));
        ws.on('error', () => clients.delete(ws));
        // Send current sessions on connect
        ws.send(JSON.stringify({ type: 'init', payload: state.listSessions() }));
    });
    server.listen(port, () => {
        console.log(`[server] Turing running at http://localhost:${port}`);
    });
    return server;
}
//# sourceMappingURL=server.js.map