import { spawn } from 'child_process';
export function buildPrompt(message, opts) {
    const parts = [];
    if (opts?.systemPrompt) {
        parts.push(`[System Instructions]\n${opts.systemPrompt}\n`);
    }
    if (opts?.history && opts.history.length > 0) {
        parts.push('[Conversation History]');
        for (const msg of opts.history) {
            const role = msg.role === 'assistant' ? 'You' : 'Other';
            parts.push(`${role}: ${msg.content}`);
        }
        parts.push('');
    }
    parts.push(`[Current Message]\n${message}`);
    return parts.join('\n');
}
export function runCommand({ adapterName, command, args, cwd, env = {}, timeout, stdinMode = 'pipe', }) {
    return new Promise((resolve, reject) => {
        const proc = spawn(command, args, {
            cwd: cwd ?? process.cwd(),
            env: { ...process.env, ...env },
            stdio: [stdinMode, 'pipe', 'pipe'],
        });
        if (stdinMode === 'pipe') {
            proc.stdin?.end();
        }
        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', (d) => { stdout += d.toString(); });
        proc.stderr.on('data', (d) => { stderr += d.toString(); });
        const timer = setTimeout(() => {
            proc.kill('SIGTERM');
            reject(new Error(`[${adapterName}] timed out after ${timeout}ms`));
        }, timeout);
        proc.on('close', (code) => {
            clearTimeout(timer);
            if (code === 0) {
                resolve(stdout.trim());
            }
            else {
                reject(new Error(`[${adapterName}] exited with code ${code}: ${stderr.trim()}`));
            }
        });
        proc.on('error', (err) => {
            clearTimeout(timer);
            reject(new Error(`[${adapterName}] spawn error: ${err.message}`));
        });
    });
}
//# sourceMappingURL=shared.js.map