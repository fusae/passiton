import { closeDb } from './state.js';
const SHUTDOWN_TIMEOUT_MS = 5_000;
export function installGracefulShutdown(server) {
    let shuttingDown = false;
    const shutdown = (signal) => {
        if (shuttingDown)
            return;
        shuttingDown = true;
        console.log(`[server] received ${signal}, shutting down`);
        const timer = setTimeout(() => {
            closeDb();
            process.exit(1);
        }, SHUTDOWN_TIMEOUT_MS);
        timer.unref();
        server.close(() => {
            clearTimeout(timer);
            closeDb();
            process.exit(0);
        });
    };
    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));
}
//# sourceMappingURL=shutdown.js.map