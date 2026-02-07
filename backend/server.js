import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { ethers } from "ethers";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ==== CONFIG ====
// You can change RPC if you want (Alchemy/Infura). This public one usually works:
const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL || "https://sepolia.gateway.tenderly.co";

// Your deployed addresses (Sepolia)
const HYBRID_ADDRESS = "0xe800F57F7016E938d5D1Ed56Ed864A8C5bC03389";

// Minimal ABI needed by backend
const HYBRID_ABI = [
  "function getCampaign(uint256) view returns (tuple(string title,address owner,uint256 goalWei,uint256 deadline,uint256 collectedWei,bool finalized))",
  "function isActive(uint256,address) view returns (bool)"
];

const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC_URL);
const hybrid = new ethers.Contract(HYBRID_ADDRESS, HYBRID_ABI, provider);

// ==== STORAGE (JSON file) ====
const DATA_FILE = path.join(process.cwd(), "posts.json");

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ posts: [] }, null, 2));
  }
  const raw = fs.readFileSync(DATA_FILE, "utf8");
  return JSON.parse(raw);
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function nowIso() {
  return new Date().toISOString();
}

function previewText(text, n = 140) {
  if (!text) return "";
  return text.length > n ? text.slice(0, n) + "…" : text;
}

// ==== AUTH HELPERS ====
async function getCampaignOwner(campaignId) {
  const c = await hybrid.getCampaign(campaignId);
  const owner = (c.owner ?? c[1]).toLowerCase();
  return owner;
}

function recoverAddress(message, signature) {
  // ethers v6
  return ethers.verifyMessage(message, signature).toLowerCase();
}

// ==== ROUTES ====
app.get("/health", async (req, res) => {
  res.json({ ok: true, time: nowIso(), network: "sepolia", hybrid: HYBRID_ADDRESS });
});

/**
 * GET /campaigns/:id/posts?address=0x...
 * - If address has active subscription => full posts
 * - Else => preview only
 */
app.get("/campaigns/:id/posts", async (req, res) => {
  try {
    const campaignId = BigInt(req.params.id);
    const address = (req.query.address || "").toString().toLowerCase();

    const db = loadData();
    const posts = db.posts.filter(p => p.campaignId === campaignId.toString());

    // If no address provided -> preview only (safe default)
    if (!address) {
      return res.json({
        access: "preview",
        posts: posts.map(p => ({
          id: p.id,
          campaignId: p.campaignId,
          title: p.title,
          bodyPreview: previewText(p.body),
          createdAt: p.createdAt,
          author: p.author
        }))
      });
    }

    // On-chain access check
    const active = await hybrid.isActive(campaignId, address);

    if (!active) {
      return res.json({
        access: "preview",
        posts: posts.map(p => ({
          id: p.id,
          campaignId: p.campaignId,
          title: p.title,
          bodyPreview: previewText(p.body),
          createdAt: p.createdAt,
          author: p.author
        }))
      });
    }

    // Active => full
    return res.json({ access: "full", posts });

  } catch (e) {
    return res.status(500).json({ error: e.message || "Server error" });
  }
});

/**
 * POST /campaigns/:id/posts
 * body: { title, body, address, message, signature }
 *
 * Rules:
 * - Must sign message in MetaMask
 * - Recovered address must match provided address
 * - Address must be campaign owner (on-chain)
 */
app.post("/campaigns/:id/posts", async (req, res) => {
  try {
    const campaignId = BigInt(req.params.id);

    const { title, body, address, message, signature } = req.body || {};
    if (!title || !body || !address || !message || !signature) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const addr = address.toLowerCase();
    const recovered = recoverAddress(message, signature);

    if (recovered !== addr) {
      return res.status(401).json({ error: "Invalid signature (address mismatch)" });
    }

    // Check owner on-chain
    const owner = await getCampaignOwner(campaignId);
    if (owner !== addr) {
      return res.status(403).json({ error: "Only campaign owner can add posts" });
    }

    const db = loadData();
    const newPost = {
      id: cryptoRandomId(),
      campaignId: campaignId.toString(),
      title: String(title),
      body: String(body),
      author: addr,
      createdAt: nowIso()
    };

    db.posts.push(newPost);
    saveData(db);

    return res.json({ ok: true, post: newPost });

  } catch (e) {
    return res.status(500).json({ error: e.message || "Server error" });
  }
});

function cryptoRandomId() {
  // simple unique-ish id
  return `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
  console.log(`Using RPC: ${SEPOLIA_RPC_URL}`);
});
