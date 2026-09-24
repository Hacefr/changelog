const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { Octokit } = require("@octokit/rest");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Render Environment Variables
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER = process.env.REPO_OWNER;
const REPO_NAME = process.env.REPO_NAME;
const LOCAL_LOCK = path.join(__dirname, 'admin_account.json');

const octokit = new Octokit({ auth: GITHUB_TOKEN });

function hashPassword(pass) {
    return crypto.createHash('sha256').update(pass + "mc_secret_salt").digest('hex');
}

// 1. Check if Admin Account exists
app.get('/api/auth/status', async (req, res) => {
    // Check local disk first
    if (fs.existsSync(LOCAL_LOCK)) {
        return res.json({ isRegistered: true });
    }

    // Check GitHub
    try {
        await octokit.repos.getContent({
            owner: REPO_OWNER,
            repo: REPO_NAME,
            path: '.admin_lock.json',
        });
        res.json({ isRegistered: true });
    } catch (err) {
        res.json({ isRegistered: false });
    }
});

// 2. Register (Instant Token & Permanent Lock)
app.post('/api/auth/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Missing fields!" });

    const lockData = {
        username: username.trim(),
        passwordHash: hashPassword(password)
    };

    // Save to local disk immediately
    try {
        fs.writeFileSync(LOCAL_LOCK, JSON.stringify(lockData, null, 2));
    } catch (e) {}

    // Save to GitHub in background
    try {
        await octokit.repos.createOrUpdateFileContents({
            owner: REPO_OWNER,
            repo: REPO_NAME,
            path: '.admin_lock.json',
            message: "Lock admin registration [skip ci]",
            content: Buffer.from(JSON.stringify(lockData, null, 2)).toString('base64')
        });
    } catch (err) {
        console.error("GitHub Lock Save:", err.message);
    }

    // Return active session token immediately (No reload needed!)
    const token = hashPassword(lockData.username + lockData.passwordHash);
    res.json({ success: true, token });
});

// 3. Login
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;

    let lock = null;

    // Check local disk
    if (fs.existsSync(LOCAL_LOCK)) {
        try {
            lock = JSON.parse(fs.readFileSync(LOCAL_LOCK, 'utf8'));
        } catch (e) {}
    }

    // Fallback to GitHub
    if (!lock) {
        try {
            const { data: fileData } = await octokit.repos.getContent({
                owner: REPO_OWNER,
                repo: REPO_NAME,
                path: '.admin_lock.json',
            });
            const raw = Buffer.from(fileData.content, 'base64').toString('utf8');
            lock = JSON.parse(raw);
        } catch (err) {
            return res.status(500).json({ error: "No admin account found!" });
        }
    }

    if (lock.username === username.trim() && lock.passwordHash === hashPassword(password)) {
        const token = hashPassword(lock.username + lock.passwordHash);
        res.json({ success: true, token });
    } else {
        res.status(401).json({ error: "Invalid username or password!" });
    }
});

// 4. Fetch Changelog
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
        res.json([]);
    }
});

// 5. Save & Publish to GitHub
app.post('/api/save-changelog', async (req, res) => {
    const { data } = req.body;

    try {
        let sha = null;
        try {
            const { data: currentFile } = await octokit.repos.getContent({
                owner: REPO_OWNER,
                repo: REPO_NAME,
                path: 'changelog.json',
            });
            sha = currentFile.sha;
        } catch (e) {}

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

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Editor active on port ${PORT}`));
