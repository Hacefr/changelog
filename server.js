const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { Octokit } = require("@octokit/rest");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Render Environment Variables
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER = process.env.REPO_OWNER;
const REPO_NAME = process.env.REPO_NAME;

if (!GITHUB_TOKEN) {
    console.error("WARNING: GITHUB_TOKEN is missing in Render Environment Variables!");
}

const octokit = new Octokit({ auth: GITHUB_TOKEN });

function hashPassword(pass) {
    return crypto.createHash('sha256').update(pass + "mc_secret_salt").digest('hex');
}

// 1. Check if the 1 admin account exists on GitHub
app.get('/api/auth/status', async (req, res) => {
    try {
        await octokit.repos.getContent({
            owner: REPO_OWNER,
            repo: REPO_NAME,
            path: '.admin_lock.json',
        });
        res.json({ isRegistered: true });
    } catch (err) {
        // File doesn't exist -> Registration is open
        res.json({ isRegistered: false });
    }
});

// 2. Register the 1-time account (Saved directly to GitHub)
app.post('/api/auth/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Missing fields!" });

    try {
        // Double check it doesn't already exist
        try {
            await octokit.repos.getContent({ owner: REPO_OWNER, repo: REPO_NAME, path: '.admin_lock.json' });
            return res.status(403).json({ error: "Admin already registered and locked!" });
        } catch (e) { /* File doesn't exist, proceed */ }

        const lockData = {
            username: username.trim(),
            passwordHash: hashPassword(password)
        };

        await octokit.repos.createOrUpdateFileContents({
            owner: REPO_OWNER,
            repo: REPO_NAME,
            path: '.admin_lock.json',
            message: "Lock admin registration [skip ci]",
            content: Buffer.from(JSON.stringify(lockData, null, 2)).toString('base64')
        });

        res.json({ success: true });
    } catch (err) {
        console.error("Register Error:", err);
        res.status(500).json({ error: "GitHub API Error: " + err.message });
    }
});

// 3. Login
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const { data: fileData } = await octokit.repos.getContent({
            owner: REPO_OWNER,
            repo: REPO_NAME,
            path: '.admin_lock.json',
        });

        const raw = Buffer.from(fileData.content, 'base64').toString('utf8');
        const lock = JSON.parse(raw);

        if (lock.username === username.trim() && lock.passwordHash === hashPassword(password)) {
            const token = hashPassword(lock.username + lock.passwordHash);
            res.json({ success: true, token });
        } else {
            res.status(401).json({ error: "Invalid username or password!" });
        }
    } catch (err) {
        res.status(500).json({ error: "Could not read admin lock: " + err.message });
    }
});

// 4. Fetch full changelog from GitHub for editing
app.get('/api/changelog', async (req, res) => {
    try {
        const { data: fileData } = await octokit.repos.getContent({
            owner: REPO_OWNER,
            repo: REPO_NAME,
            path: 'changelog.json',
        });
        const raw = Buffer.from(fileData.content, 'base64').toString('utf8');
        res.json(JSON.parse(raw));
    } catch (err) {
        // Return empty array if file isn't found
        res.json([]);
    }
});

// 5. Save & Publish all changelogs to GitHub
app.post('/api/save-changelog', async (req, res) => {
    const { token, data } = req.body;

    try {
        // Check token only if lock file exists
        try {
            const { data: lockFileData } = await octokit.repos.getContent({
                owner: REPO_OWNER,
                repo: REPO_NAME,
                path: '.admin_lock.json',
            });
            const lock = JSON.parse(Buffer.from(lockFileData.content, 'base64').toString('utf8'));
            const validToken = hashPassword(lock.username + lock.passwordHash);

            if (token && token !== validToken) {
                return res.status(403).json({ error: "Session invalid. Please log in again." });
            }
        } catch (e) {
            // Lock file not found, proceed safely
        }

        // Fetch SHA of changelog.json to overwrite it
        let sha = null;
        try {
            const { data: currentFile } = await octokit.repos.getContent({
                owner: REPO_OWNER,
                repo: REPO_NAME,
                path: 'changelog.json',
            });
            sha = currentFile.sha;
        } catch (e) {
            // File does not exist yet, will be created fresh
        }

        // Commit update directly to GitHub
        await octokit.repos.createOrUpdateFileContents({
            owner: REPO_OWNER,
            repo: REPO_NAME,
            path: 'changelog.json',
            message: `Publish changelog update [skip ci]`,
            content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'),
            sha: sha || undefined
        });

        res.json({ success: true });
    } catch (err) {
        console.error("Save Error:", err);
        res.status(500).json({ error: "GitHub Push Failed: " + err.message });
    }
});

// Catch-all to serve the admin dashboard
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Changelog Editor live on port ${PORT}`));
