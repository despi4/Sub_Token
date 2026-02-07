// backend/server.js
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { ethers } from "ethers";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

/**
 * ===== CONFIG =====
 * If RPC fails, change SEPOLIA_RPC_URL env:
 * SEPOLIA_RPC_URL="https://..." node server.js
 */
const SEPOLIA_RPC_URL =
  process.env.SEPOLIA_RPC_URL || "https://sepolia.gateway.tenderly.co";

const HYBRID_ADDRESS = "0xe800F57F7016E938d5D1Ed56Ed864A8C5bC03389";

// Minimal ABI required by the backend
const HYBRID_ABI = [
  "function getCampaign(uint256) view returns (tuple(string title,address owner,uint256 goalWei,uint256 deadline,uint256 collectedWei,bool finalized))",
  "function isActive(uint256,address) view returns (bool)",
];

const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC_URL);
const hybrid = new ethers.Contract(HYBRID_ADDRESS, HYBRID_ABI, provider);

/**
 * ===== FILE STORAGE (no SQL) =====
 */
const POSTS_FILE = path.join(process.cwd(), "posts.json");
const CAMPAIGNS_FILE = path.join(process.cwd(), "campaigns.json");

function ensureFile(filePath, defaultJson) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultJson, null, 2));
  }
}

function readJson(filePath, defaultJson) {
  ensureFile(filePath, defaultJson);
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function nowIso() {
  return new Date().toISOString();
}

function cryptoRandomId() {
  return `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

function previewText(text, n = 140) {
  if (!text) return "";
  return text.length > n ? text.slice(0, n) + "…" : text;
}

/**
 * ===== AUTH HELPERS =====
 * We use MetaMask signature to prove address.
 */
function recoverAddress(message, signature) {
  return ethers.verifyMessage(message, signature).toLowerCase();
}

async function getCampaignOwner(campaignId) {
  const c = await hybrid.getCampaign(campaignId);
  return (c.owner ?? c[1]).toLowerCase();
}

/**
 * ===== ROUTES =====
 */
app.get("/health", async (_req, res) => {
  res.json({
    ok: true,
    time: nowIso(),
    network: "sepolia",
    rpc: SEPOLIA_RPC_URL,
    hybrid: HYBRID_ADDRESS,
  });
});

/**
 * ---- Campaign Cards (photo + description) ----
 * Stored off-chain, but verified on-chain that caller is owner.
 */

// Get campaign card list
app.get("/campaigns", (_req, res) => {
  try {
    const db = readJson(CAMPAIGNS_FILE, { campaigns: [] });
    res.json({ campaigns: db.campaigns });
  } catch (e) {
    res.status(500).json({ error: e.message || "Server error" });
  }
});

// Create/Update campaign card (only campaign owner)
app.post("/campaigns", async (req, res) => {
  try {
    const { campaignId, title, imageUrl, description, address, message, signature } =
      req.body || {};

    if (!campaignId || !title || !imageUrl || !address || !message || !signature) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const cid = BigInt(campaignId);
    const addr = String(address).toLowerCase();

    // Signature check
    const recovered = recoverAddress(message, signature);
    if (recovered !== addr) {
      return res.status(401).json({ error: "Invalid signature (address mismatch)" });
    }

    // On-chain owner check
    const owner = await getCampaignOwner(cid);
    if (owner !== addr) {
      return res.status(403).json({ error: "Only campaign owner can save campaign card" });
    }

    const db = readJson(CAMPAIGNS_FILE, { campaigns: [] });

    // Replace existing card for this id (avoid duplicates)
    db.campaigns = db.campaigns.filter((c) => c.campaignId !== String(campaignId));

    db.campaigns.push({
      campaignId: String(campaignId),
      title: String(title),
      imageUrl: String(imageUrl),
      description: String(description || ""),
      owner: addr,
      createdAt: nowIso(),
    });

    writeJson(CAMPAIGNS_FILE, db);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || "Server error" });
  }
});

/**
 * ---- Posts (content) ----
 * Full posts are returned only if user has active subscription on-chain.
 */

// Get posts for campaign (preview/full depending on isActive)
app.get("/campaigns/:id/posts", async (req, res) => {
  try {
    const campaignId = BigInt(req.params.id);
    const address = (req.query.address || "").toString().toLowerCase();

    const db = readJson(POSTS_FILE, { posts: [] });
    const posts = db.posts.filter((p) => p.campaignId === campaignId.toString());

    // default: preview
    const toPreview = () =>
      posts.map((p) => ({
        id: p.id,
        campaignId: p.campaignId,
        title: p.title,
        bodyPreview: previewText(p.body),
        createdAt: p.createdAt,
        author: p.author,
      }));

    if (!address) {
      return res.json({ access: "preview", posts: toPreview() });
    }

    const active = await hybrid.isActive(campaignId, address);
    if (!active) {
      return res.json({ access: "preview", posts: toPreview() });
    }

    return res.json({ access: "full", posts });
  } catch (e) {
    res.status(500).json({ error: e.message || "Server error" });
  }
});

// Publish a post (only campaign owner)
app.post("/campaigns/:id/posts", async (req, res) => {
  try {
    const campaignId = BigInt(req.params.id);
    const { title, body, address, message, signature } = req.body || {};

    if (!title || !body || !address || !message || !signature) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const addr = String(address).toLowerCase();

    // Signature check
    const recovered = recoverAddress(message, signature);
    if (recovered !== addr) {
      return res.status(401).json({ error: "Invalid signature (address mismatch)" });
    }

    // Owner check
    const owner = await getCampaignOwner(campaignId);
    if (owner !== addr) {
      return res.status(403).json({ error: "Only campaign owner can add posts" });
    }

    const db = readJson(POSTS_FILE, { posts: [] });

    const newPost = {
      id: cryptoRandomId(),
      campaignId: campaignId.toString(),
      title: String(title),
      body: String(body),
      author: addr,
      createdAt: nowIso(),
    };

    db.posts.push(newPost);
    writeJson(POSTS_FILE, db);

    res.json({ ok: true, post: newPost });
  } catch (e) {
    res.status(500).json({ error: e.message || "Server error" });
  }
});

/**
 * ===== START =====
 */
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
  console.log(`RPC: ${SEPOLIA_RPC_URL}`);
  console.log(`HYBRID: ${HYBRID_ADDRESS}`);
});
