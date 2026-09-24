const express = require('express');
const { Octokit } = require("@octokit/rest");
const app = express();

app.use(express.json());
app.use(express.static('public')); // Serves the edit GUI

// Configuration (Set these in Render's Environment Variables)
const GITHUB_TOKEN = process.env.GITHUB_TOKEN; // Personal Access Token from GitHub
const REPO_OWNER = process.env.REPO_OWNER;     // Your GitHub Username
const REPO_NAME = process.env.REPO_NAME;       // Your Repo Name
const ADMIN_PASSWORD = process.env.ADMIN_PASS || "minecraft123";

const octokit = new Octokit({ auth: GITHUB_TOKEN });

// API Endpoint to Push Update to GitHub
app.post('/api/save-changelog', async (req, res) => {
    const { password, data } = req.body;

    if (password !== ADMIN_PASSWORD) {
        return res.status(403).json({ error: "Invalid password!" });
    }

    try {
        // 1. Get the current file SHA from GitHub
        const { data: fileData } = await octokit.repos.getContent({
            owner: REPO_OWNER,
            repo: REPO_NAME,
            path: 'changelog.json',
        });

        // 2. Commit the new updated changelog
        await octokit.repos.createOrUpdateFileContents({
            owner: REPO_OWNER,
            repo: REPO_NAME,
            path: 'changelog.json',
            message: `Update changelog via Editor [skip ci]`,
            content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'),
            sha: fileData.sha,
        });

        res.json({ success: true, message: "Published directly to GitHub!" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Editor running on port ${PORT}`));
