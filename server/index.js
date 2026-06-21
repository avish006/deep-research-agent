const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Serve static frontend files in production
app.use(express.static(path.join(__dirname, '../client/dist')));


// ── Helpers ───────────────────────────────────────────────────────────────────
function getSafeTopicFilename(topic) {
    return topic.replace(/[^a-zA-Z0-9 \-_]/g, '_').substring(0, 50).trim();
}

// ── Research SSE endpoint ─────────────────────────────────────────────────────
// Query params: topic (required), apiKey (required)
app.get('/api/research/stream', (req, res) => {
    const { topic, apiKey } = req.query;

    if (!topic)  return res.status(400).json({ error: 'topic is required' });
    if (!apiKey) return res.status(400).json({ error: 'apiKey is required' });

    console.log(`[SSE] Starting research: "${topic}"`);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const send = (type, payload) => {
        res.write(`event: ${type}\n`);
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    const projectRoot = path.resolve(__dirname, '..');
    
    // In production/Docker we use the global python, locally we use the venv
    const isProduction = process.env.NODE_ENV === 'production';
    const pythonExec = isProduction 
        ? 'python' 
        : path.join(projectRoot, 'venv', 'Scripts', 'python.exe');


    // Inject the user-supplied API key and model as environment variables.
    // These override whatever is in the .env file at the OS-env level.
    const pythonProcess = spawn(pythonExec, ['main.py', topic], {
        cwd: projectRoot,
        env: {
            ...process.env,
            GOOGLE_API_KEY:           apiKey,
            PYTHONIOENCODING:         'utf-8',
            PYTHONUTF8:               '1',
        }
    });

    pythonProcess.stdout.setEncoding('utf8');
    pythonProcess.stderr.setEncoding('utf8');

    const processLine = (line) => {
        const trimmed = line.trim();
        if (trimmed) send('log', { line: trimmed });
    };

    let stdoutBuf = '', stderrBuf = '';

    pythonProcess.stdout.on('data', chunk => {
        stdoutBuf += chunk;
        const lines = stdoutBuf.split('\n');
        stdoutBuf = lines.pop();
        lines.forEach(processLine);
    });

    pythonProcess.stderr.on('data', chunk => {
        stderrBuf += chunk;
        const lines = stderrBuf.split('\n');
        stderrBuf = lines.pop();
        lines.forEach(processLine);
    });

    pythonProcess.on('close', (code) => {
        if (stdoutBuf.trim()) processLine(stdoutBuf);
        if (stderrBuf.trim()) processLine(stderrBuf);

        if (code !== 0) {
            send('error', { message: `Process exited with code ${code}` });
            return res.end();
        }

        try {
            const safeTopic = getSafeTopicFilename(topic);
            const outputDir = path.join(projectRoot, 'outputs');
            let reportContent = null;

            const exactPath = path.join(outputDir, `${safeTopic}.md`);
            if (fs.existsSync(exactPath)) {
                reportContent = fs.readFileSync(exactPath, 'utf8');
            } else if (fs.existsSync(outputDir)) {
                const files = fs.readdirSync(outputDir)
                    .map(f => ({ name: f, time: fs.statSync(path.join(outputDir, f)).mtime.getTime() }))
                    .sort((a, b) => b.time - a.time);
                if (files.length > 0)
                    reportContent = fs.readFileSync(path.join(outputDir, files[0].name), 'utf8');
            }

            reportContent
                ? send('done', { report: reportContent })
                : send('error', { message: 'Report file not found after successful run' });
        } catch (err) {
            send('error', { message: err.message });
        }

        res.end();
    });

    req.on('close', () => { pythonProcess.kill(); res.end(); });
});

// Catch-all to serve index.html for React Router (if added later) or general fallbacks
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

app.listen(PORT, () => console.log(`Deep Research Server running on port ${PORT}`));
