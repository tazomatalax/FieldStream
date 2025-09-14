#!/usr/bin/env node
/**
 * Publish Markdown issues in docs/issues to GitHub Issues.
 *
 * Requirements:
 * - Environment variables:
 *   - GITHUB_TOKEN        (required)  — GitHub Personal Access Token with repo scope
 *   - GITHUB_REPO_OWNER   (required)  — e.g., "tazomatalax"
 *   - GITHUB_REPO_NAME    (required)  — e.g., "FieldStream"
 *   - DRY_RUN=true        (optional)  — don't create/close, just print actions
 *
 * Usage (PowerShell):
 *   $env:GITHUB_TOKEN = "<your-token>"
 *   $env:GITHUB_REPO_OWNER = "tazomatalax"
 *   $env:GITHUB_REPO_NAME = "FieldStream"
 *   node scripts/publish-github-issues.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const ISSUES_DIR = path.resolve(ROOT, 'docs', 'issues');

const TOKEN = process.env.GITHUB_TOKEN;
const OWNER = process.env.GITHUB_REPO_OWNER;
const REPO = process.env.GITHUB_REPO_NAME;
const DRY_RUN = (process.env.DRY_RUN || '').toLowerCase() === 'true';

if (!TOKEN || !OWNER || !REPO) {
  console.error('Missing required env vars. Please set GITHUB_TOKEN, GITHUB_REPO_OWNER, GITHUB_REPO_NAME.');
  process.exit(1);
}

function parseFrontMatter(content) {
  const lines = content.split(/\r?\n/);
  if (lines[0].trim() !== '---') {
    return { attrs: {}, body: content };
  }
  let i = 1;
  const attrs = {};
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '---') {
      i++;
      break;
    }
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    // strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith('\'') && val.endsWith('\''))) {
      val = val.slice(1, -1);
    }
    if (key === 'labels') {
      // Expect format: [a, b, c]
      const m = val.match(/^\[(.*)\]$/);
      if (m) {
        attrs.labels = m[1]
          .split(',')
          .map(s => s.trim())
          .filter(Boolean);
      } else {
        attrs.labels = [];
      }
    } else {
      attrs[key] = val;
    }
  }
  const body = lines.slice(i).join('\n').trim();
  return { attrs, body };
}

function ghRequest(method, path, data) {
  const payload = data ? JSON.stringify(data) : undefined;
  const opts = {
    method,
    hostname: 'api.github.com',
    path,
    headers: {
      'User-Agent': 'fieldstream-issue-publisher',
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${TOKEN}`,
    }
  };
  if (payload) {
    opts.headers['Content-Type'] = 'application/json';
    opts.headers['Content-Length'] = Buffer.byteLength(payload);
  }
  return new Promise((resolve, reject) => {
    const req = https.request(opts, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(body ? JSON.parse(body) : {}); } catch { resolve({}); }
        } else {
          reject(new Error(`GitHub API ${method} ${path} failed: ${res.statusCode} ${body}`));
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function searchIssueByTitle(title) {
  const q = encodeURIComponent(`repo:${OWNER}/${REPO} in:title "${title}" type:issue`);
  const res = await ghRequest('GET', `/search/issues?q=${q}`);
  if (res && res.total_count > 0) {
    return res.items[0];
  }
  return null;
}

async function createIssue(title, body, labels) {
  if (DRY_RUN) {
    console.log(`[DRY] Create issue: ${title} labels=${JSON.stringify(labels)}`);
    return { number: 0 };
  }
  try {
    return await ghRequest('POST', `/repos/${OWNER}/${REPO}/issues`, {
      title,
      body,
      labels: labels && labels.length ? labels : undefined,
    });
  } catch (err) {
    // Fallback: retry without labels if validation failed
    const msg = String(err.message || '');
    if (/Validation Failed|422/.test(msg) && labels && labels.length) {
      console.warn(`Label assignment failed, retrying without labels for: ${title}`);
      return await ghRequest('POST', `/repos/${OWNER}/${REPO}/issues`, { title, body });
    }
    throw err;
  }
}

async function closeIssue(number) {
  if (DRY_RUN) {
    console.log(`[DRY] Close issue #${number}`);
    return;
  }
  await ghRequest('PATCH', `/repos/${OWNER}/${REPO}/issues/${number}`, { state: 'closed' });
}

async function main() {
  const files = fs.readdirSync(ISSUES_DIR)
    .filter(f => f.toLowerCase().endsWith('.md') && f.toLowerCase() !== 'readme.md')
    .sort();

  console.log(`Found ${files.length} issue files in ${ISSUES_DIR}`);

  for (const file of files) {
    const full = path.join(ISSUES_DIR, file);
    const raw = fs.readFileSync(full, 'utf8');
    const { attrs, body } = parseFrontMatter(raw);
    const id = attrs.id || path.basename(file, '.md').toUpperCase();
    const title = attrs.title ? `[${id}] ${attrs.title}` : `[${id}]`;
    const labels = attrs.labels || [];
    const status = (attrs.status || 'Open').toLowerCase();
    const issueBody = `${body}\n\n---\nSource: ${path.relative(ROOT, full)}`;

    try {
      const existing = await searchIssueByTitle(title);
      if (existing) {
        console.log(`Skip (exists): ${title} -> #${existing.number} (${existing.state})`);
        // Optionally close if status says Closed and it's open
        if (status === 'closed' && existing.state !== 'closed') {
          console.log(`Closing existing issue #${existing.number} to match status...`);
          await closeIssue(existing.number);
        }
        continue;
      }

      const created = await createIssue(title, issueBody, labels);
      const num = created.number;
      console.log(`Created #${num}: ${title}`);
      if (status === 'closed') {
        await closeIssue(num);
        console.log(`Closed #${num}: ${title}`);
      }
    } catch (err) {
      console.error(`Error processing ${file}:`, err.message);
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
