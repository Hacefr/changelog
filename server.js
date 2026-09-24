const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Octokit } = require("@octokit/rest");

const app = express();
app.use(express.json());
app.use(express.static('public'));

const DATA_FILE = path.join(__dirname, 'admin_account.json');

// GitHub Config from Render Environment Variables
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const REPO_OWNER = process.env.REPO_OWNER;
const REPO_NAME = process.env.REPO_NAME;

// Simple password hashing helper
function hashPassword(pass) {
    return crypto.createHash('sha256').update(pass).digest('hex');
}

// 1. Check if the 1-and-only account already exists
app.get('/api/auth/status', (req, res) => {
    const exists = fs.existsSync(DATA_FILE);
    res.json({ isRegistered: exists });
});

// 2. ONE-TIME SIGNUP (Self-destructs after 1 use)
app.post('/api/auth/register', (req, res) => {
    if (fs.existsSync(DATA_FILE)) {
        return res.status(403).json({ error: "Registration is permanently closed!" });
    }

    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: "Username and password required!" });
    }

    const accountData = {
        username: username.trim(),
        passwordHash: hashPassword(password)
    };

    // Save account to disk — permanently kills future signups
    fs.writeFileSync(DATA_FILE, JSON.stringify(accountData));
    res.json({ success: true, message: "Admin account registered and locked!" });
});

// 3. LOGIN
app.post('/api/auth/login', (req, res) => {
    if (!fs.existsSync(DATA_FILE)) {
        return res.status(400).json({ error: "No admin account registered yet!" });
    }

    const { username, password } = req.body;
    const account = JSON.parse(fs.readFileSync(DATA_FILE));

    if (account.username === username.trim() && account.passwordHash === hashPassword(password)) {
        // Return a simple session token
        const token = hashPassword(account.username + account.passwordHash);
        res.json({ success: true, token });
    } else {
        res.status(401).json({ error: "Invalid credentials!" });
    }
});

// 4. PUBLISH TO GITHUB
app.post('/api/save-changelog', async (req, res) => {
    const { token, data } = req.body;

    if (!fs.existsSync(DATA_FILE)) return res.status(401).json({ error: "Unauthorized" });
    const account = JSON.parse(fs.readFileSync(DATA_FILE));
    const validToken = hashPassword(account.username + account.passwordHash);

    if (token !== validToken) {
        return res.status(403).json({ error: "Session expired or invalid. Log in again." });
    }

    try {
        // Fetch existing changelog.json SHA from GitHub
        const { data: fileData } = await octokit.repos.getContent({
            owner: REPO_OWNER,
            repo: REPO_NAME,
            path: 'changelog.json',
        });

        // Push update directly to GitHub repository
        await octokit.repos.createOrUpdateFileContents({
            owner: REPO_OWNER,
            repo: REPO_NAME,
            path: 'changelog.json',
            message: `Update changelog via Book Editor [skip ci]`,
            content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'),
            sha: fileData.sha,
        });

        res.json({ success: true, message: "Successfully pushed to GitHub!" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Editor active on port ${PORT}`));
