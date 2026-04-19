#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const STATE_BRANCH = "runtime-state";
const STATE_PATH = ".runtime/recovery-state.json";
const API_BASE = "https://api.github.com";

function encodeContentPath(value) {
  return value
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function parseArgs(argv) {
  const out = {
    mode: null,
    output: null,
    input: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!out.mode && (arg === "read" || arg === "write")) {
      out.mode = arg;
    } else if (arg === "--output") {
      out.output = path.resolve(process.cwd(), argv[++i]);
    } else if (arg === "--input") {
      out.input = path.resolve(process.cwd(), argv[++i]);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!out.mode) {
    throw new Error("Mode must be read or write");
  }

  return out;
}

function getEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function githubRequest(url, init = {}) {
  const token = getEnv("GITHUB_TOKEN");
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "container-keepalive",
      ...(init.headers || {}),
    },
  });

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}

  return { response, text, json };
}

async function ensureStateBranch(ownerRepo) {
  const [owner, repo] = ownerRepo.split("/");
  const branchRefUrl = `${API_BASE}/repos/${owner}/${repo}/git/ref/heads/${STATE_BRANCH}`;
  const current = await githubRequest(branchRefUrl);
  if (current.response.ok) {
    return current.json.object.sha;
  }
  if (current.response.status !== 404) {
    throw new Error(`Failed to inspect state branch: ${current.response.status} ${current.text}`);
  }

  const repoMeta = await githubRequest(`${API_BASE}/repos/${owner}/${repo}`);
  if (!repoMeta.response.ok) {
    throw new Error(`Failed to load repository metadata: ${repoMeta.response.status} ${repoMeta.text}`);
  }

  const defaultBranch = repoMeta.json.default_branch;
  const defaultRef = await githubRequest(`${API_BASE}/repos/${owner}/${repo}/git/ref/heads/${defaultBranch}`);
  if (!defaultRef.response.ok) {
    throw new Error(`Failed to load default branch ref: ${defaultRef.response.status} ${defaultRef.text}`);
  }

  const created = await githubRequest(`${API_BASE}/repos/${owner}/${repo}/git/refs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ref: `refs/heads/${STATE_BRANCH}`,
      sha: defaultRef.json.object.sha,
    }),
  });

  if (!created.response.ok && created.response.status !== 422) {
    throw new Error(`Failed to create state branch: ${created.response.status} ${created.text}`);
  }

  return defaultRef.json.object.sha;
}

async function readState(ownerRepo) {
  const [owner, repo] = ownerRepo.split("/");
  const result = await githubRequest(
    `${API_BASE}/repos/${owner}/${repo}/contents/${encodeContentPath(STATE_PATH)}?ref=${STATE_BRANCH}`,
  );

  if (result.response.status === 404) {
    return null;
  }
  if (!result.response.ok) {
    throw new Error(`Failed to read recovery state: ${result.response.status} ${result.text}`);
  }

  return {
    sha: result.json.sha,
    data: JSON.parse(Buffer.from(result.json.content, "base64").toString("utf8")),
  };
}

async function writeState(ownerRepo, data) {
  const [owner, repo] = ownerRepo.split("/");
  await ensureStateBranch(ownerRepo);

  const current = await readState(ownerRepo);
  const payload = {
    message: `Update recovery state at ${new Date().toISOString()}`,
    branch: STATE_BRANCH,
    content: Buffer.from(JSON.stringify(data, null, 2)).toString("base64"),
  };

  if (current?.sha) {
    payload.sha = current.sha;
  }

  const result = await githubRequest(`${API_BASE}/repos/${owner}/${repo}/contents/${encodeContentPath(STATE_PATH)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!result.response.ok) {
    throw new Error(`Failed to write recovery state: ${result.response.status} ${result.text}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const ownerRepo = getEnv("GITHUB_REPOSITORY");

  if (args.mode === "read") {
    const state = await readState(ownerRepo);
    const data = state?.data || {};
    const rendered = `${JSON.stringify(data, null, 2)}\n`;
    if (args.output) {
      await fs.writeFile(args.output, rendered);
    } else {
      process.stdout.write(rendered);
    }
    return;
  }

  if (!args.input) {
    throw new Error("--input is required in write mode");
  }

  const data = JSON.parse(await fs.readFile(args.input, "utf8"));
  await writeState(ownerRepo, data);
  process.stdout.write("recovery_state_written\n");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
