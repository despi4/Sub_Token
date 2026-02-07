import {
  setStatus, connect,
  getEthBalance, getSubBalance,
  getTierPriceWei,
  BACKEND_URL
} from "./common.js";

function $(id) { return document.getElementById(id); }

function bindClick(id, fn) {
  const node = $(id);
  if (!node) return;
  node.onclick = fn;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  }[m]));
}

let ctx = null;

// selected campaign
let selectedCampaignId = null;     // string
let selectedCampaignOwner = null;  // lowercase
let isOwner = false;

// cache: on-chain campaign info by id
const onChainCache = new Map(); // id -> { title, owner, goalEth, collectedEth, deadline, finalized }

function setView(tab) {
  const explore = tab === "explore";

  $("viewExplore")?.classList.toggle("hidden", !explore);
  $("viewCreator")?.classList.toggle("hidden", explore);

  $("tabExplore")?.classList.toggle("active", explore);
  $("tabCreator")?.classList.toggle("active", !explore);

  // ✅ hide details when switching tabs (fix "details still visible in creator")
  $("detailsWrap")?.classList.add("hidden");

  // creator management should not "stick"
  $("creatorOnly")?.classList.add("hidden");
}

async function refreshBalances() {
  if (!ctx) return;
  const eth = await getEthBalance(ctx.provider, ctx.user);
  const sub = await getSubBalance(ctx.token, ctx.user);
  if ($("ethBal")) $("ethBal").textContent = eth;
  if ($("subBal")) $("subBal").textContent = sub;
}

async function loadCampaignOnChain(campaignId) {
  if (!ctx) throw new Error("Connect first");
  const id = String(campaignId);

  // optional cache
  // if (onChainCache.has(id)) return onChainCache.get(id);

  const c = await ctx.hybrid.getCampaign(BigInt(id));
  const title = c.title ?? c[0];
  const owner = (c.owner ?? c[1]).toLowerCase();
  const goalWei = c.goalWei ?? c[2];
  const collectedWei = c.collectedWei ?? c[4];
  const deadline = c.deadline ?? c[3];
  const finalized = c.finalized ?? c[5];

  const info = {
    title,
    owner,
    goalEth: ethers.formatEther(goalWei),
    collectedEth: ethers.formatEther(collectedWei),
    deadline: String(deadline),
    finalized: Boolean(finalized)
  };

  onChainCache.set(id, info);
  return info;
}

function setProgress(collectedEthStr, goalEthStr) {
  const collected = Number(collectedEthStr || "0");
  const goal = Number(goalEthStr || "0");

  const pct = goal > 0 ? Math.min(100, Math.floor((collected / goal) * 100)) : 0;

  if ($("detailsCollectedEth")) $("detailsCollectedEth").textContent = collectedEthStr;
  if ($("detailsGoalEth")) $("detailsGoalEth").textContent = goalEthStr;
  if ($("detailsPercent")) $("detailsPercent").textContent = String(pct);

  const bar = $("detailsProgressBar");
  if (bar) bar.style.width = `${pct}%`;
}

function renderDetailsShell(card) {
  // show wrapper + empty details container
  $("detailsWrap")?.classList.remove("hidden");

  const root = $("campaignDetails");
  if (!root) return;

  root.innerHTML = `
    <div class="stat-card">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:14px;">
        <div>
          <h2 style="margin:0;">${escapeHtml(card.title || "Campaign")}</h2>
          <div class="muted small">
            Campaign ID: <code>${escapeHtml(card.campaignId)}</code> • Owner: <code id="detailsOwner">—</code>
          </div>
        </div>
        <span class="badge" id="ownerBadge" style="display:none;">You are owner</span>
      </div>

      <div style="margin-top:12px; display:grid; grid-template-columns: 1fr 1fr 1fr; gap:12px;">
        <div>
          <div class="muted small">Collected</div>
          <div style="font-weight:bold;" id="detailsCollected">—</div>
        </div>
        <div>
          <div class="muted small">Deadline (unix)</div>
          <div style="font-weight:bold;" id="detailsDeadline">—</div>
        </div>
        <div>
          <div class="muted small">Status</div>
          <div style="font-weight:bold;" id="detailsStatus">—</div>
        </div>
      </div>

      <div style="margin-top:18px; display:grid; grid-template-columns: 1fr 1fr; gap:14px;">
        <div>
          <h3 style="margin:0 0 10px 0;">Support</h3>
          <label>Donate (ETH)</label>
          <input id="donEth" value="0.001" />
          <button id="btnDonate" style="width:100%">Donate</button>

          <div style="height:12px;"></div>

          <label>Tier ID</label>
          <input id="tierId" value="1" />
          <button id="btnSubscribe" style="width:100%">Subscribe / Renew</button>

          <div class="muted small" style="margin-top:10px;">
            Reward SUB token is minted on participation (education token).
          </div>
        </div>

        <div>
          <h3 style="margin:0 0 10px 0;">Gated Content</h3>
          <button id="btnLoadPosts" class="secondary" style="width:100%">Load Posts</button>
          <div class="muted small" style="margin-top:8px;">Access: <code id="contentAccess">—</code></div>
          <div id="posts" style="margin-top:10px;"></div>
        </div>
      </div>

      <div id="ownerTools" class="stat-card hidden" style="margin-top:16px;">
        <h3 style="margin-top:0;">Owner Tools</h3>
        <div class="muted small">Visible only for campaign owner wallet.</div>
        <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:10px;">
          <button id="btnCreateTierInline" class="secondary">Add Tier</button>
          <button id="btnPublishPostInline" class="secondary">Publish Post</button>
          <button id="btnFinalizeInline" class="secondary">Finalize</button>
        </div>
      </div>
    </div>
  `;
}

function renderPosts(access, posts) {
  const root = $("posts");
  if (!root) return;

  root.innerHTML = "";
  if (!posts || posts.length === 0) {
    root.innerHTML = `<div class="muted small">No posts yet.</div>`;
    return;
  }

  for (const p of posts) {
    const body = access === "full" ? (p.body || "") : (p.bodyPreview || "");
    const div = document.createElement("div");
    div.className = "stat-card";
    div.style.marginTop = "10px";
    div.innerHTML = `
      <h3 style="margin:0 0 6px 0;">${escapeHtml(p.title)}</h3>
      <div class="muted small">by ${escapeHtml(p.author)} • ${escapeHtml(p.createdAt)}</div>
      <div style="margin-top:10px; white-space:pre-wrap;">${escapeHtml(body)}</div>
    `;
    root.appendChild(div);
  }
}

async function openCampaign(card) {
  if (!ctx) throw new Error("Connect wallet first");

  selectedCampaignId = String(card.campaignId);
  renderDetailsShell(card);

  setStatus("Loading campaign…", "warn");

  const onchain = await loadCampaignOnChain(selectedCampaignId);

  selectedCampaignOwner = onchain.owner;
  isOwner = ctx.user.toLowerCase() === selectedCampaignOwner;

  // Details top info
  $("detailsOwner").textContent = selectedCampaignOwner;
  $("detailsCollected").textContent = `${onchain.collectedEth} ETH`;
  $("detailsDeadline").textContent = onchain.deadline;
  $("detailsStatus").textContent = onchain.finalized ? "Finalized" : "Active";

  // ✅ Progress in detailsWrap progress section
  setProgress(onchain.collectedEth, onchain.goalEth);

  // ✅ Creator management card (left side studio) shows only if owner of selected
  $("creatorOnly")?.classList.toggle("hidden", !isOwner);

  if (isOwner) {
    $("ownerBadge").style.display = "inline-block";
    $("ownerTools")?.classList.remove("hidden");
  }

  // ===== bind dynamic buttons =====
  bindClick("btnDonate", async () => {
    try {
      const amountEth = $("donEth")?.value?.trim();
      if (!amountEth) throw new Error("Enter donate amount");

      setStatus("Confirm donation in MetaMask…", "warn");
      const tx = await ctx.hybrid.contribute(BigInt(selectedCampaignId), { value: ethers.parseEther(amountEth) });
      setStatus(`Pending: ${tx.hash}`, "warn");
      await tx.wait();

      setStatus("Donation success ✅", "ok");
      await refreshBalances();
      await openCampaign(card);
    } catch (e) {
      setStatus(e.shortMessage || e.message, "err");
    }
  });

  bindClick("btnSubscribe", async () => {
    try {
      const tierIdStr = $("tierId")?.value?.trim();
      if (!tierIdStr) throw new Error("Enter tier id");

      const tierId = BigInt(tierIdStr);
      const priceWei = await getTierPriceWei(ctx.hybrid, BigInt(selectedCampaignId), tierId);

      setStatus("Confirm subscription in MetaMask…", "warn");
      const tx = await ctx.hybrid.subscribe(BigInt(selectedCampaignId), tierId, { value: priceWei });
      setStatus(`Pending: ${tx.hash}`, "warn");
      await tx.wait();

      setStatus("Subscribed ✅", "ok");
      await refreshBalances();
    } catch (e) {
      setStatus(e.shortMessage || e.message, "err");
    }
  });

  bindClick("btnLoadPosts", async () => {
    try {
      setStatus("Loading posts…", "warn");
      const url = `${BACKEND_URL}/campaigns/${selectedCampaignId}/posts?address=${ctx.user}`;
      const resp = await fetch(url);
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Failed to load posts");

      $("contentAccess").textContent = data.access;
      renderPosts(data.access, data.posts);
      setStatus("Posts loaded ✅", "ok");
    } catch (e) {
      setStatus(e.message, "err");
    }
  });

  // owner tools
  bindClick("btnCreateTierInline", async () => {
    try {
      if (!isOwner) throw new Error("Only owner can add tier");

      const name = prompt("Tier name:", "Bronze");
      if (!name) return;

      const priceEth = prompt("Tier price (ETH):", "0.001");
      if (!priceEth) return;

      const periodSec = prompt("Period seconds:", "60");
      if (!periodSec) return;

      setStatus("Confirm tier creation…", "warn");
      const tx = await ctx.hybrid.createTier(
        BigInt(selectedCampaignId),
        name,
        ethers.parseEther(priceEth),
        BigInt(periodSec)
      );
      setStatus(`Pending: ${tx.hash}`, "warn");
      await tx.wait();

      setStatus("Tier created ✅", "ok");
    } catch (e) {
      setStatus(e.shortMessage || e.message, "err");
    }
  });

  bindClick("btnPublishPostInline", async () => {
    try {
      if (!isOwner) throw new Error("Only owner can publish posts");

      const title = prompt("Post title:", "Update #1");
      if (!title) return;

      const body = prompt("Post body:", "Hello supporters! This is gated content.");
      if (!body) return;

      const nonce = Math.floor(Math.random() * 1e9);
      const message =
`CrowdSubHybrid Creator Post
campaignId: ${selectedCampaignId}
address: ${ctx.user}
nonce: ${nonce}`;

      setStatus("Sign message in MetaMask…", "warn");
      const signature = await ctx.signer.signMessage(message);

      setStatus("Publishing post…", "warn");
      const resp = await fetch(`${BACKEND_URL}/campaigns/${selectedCampaignId}/posts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body, address: ctx.user, message, signature })
      });

      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Publish failed");

      setStatus("Post published ✅", "ok");
    } catch (e) {
      setStatus(e.shortMessage || e.message, "err");
    }
  });

  bindClick("btnFinalizeInline", async () => {
    try {
      if (!isOwner) throw new Error("Only owner can finalize");

      setStatus("Confirm finalize…", "warn");
      const tx = await ctx.hybrid.finalize(BigInt(selectedCampaignId));
      setStatus(`Pending: ${tx.hash}`, "warn");
      await tx.wait();

      setStatus("Finalized ✅", "ok");
      await openCampaign(card);
    } catch (e) {
      setStatus(e.shortMessage || e.message, "err");
    }
  });

  setStatus("Campaign loaded ✅", "ok");
}

async function loadCampaignCards() {
  const list = $("campaignList");
  if (!list) return;

  list.innerHTML = `<div class="muted">Loading campaigns...</div>`;

  const resp = await fetch(`${BACKEND_URL}/campaigns`);
  const data = await resp.json();

  const campaigns = data.campaigns || [];
  if (campaigns.length === 0) {
    list.innerHTML = `<div class="muted">No campaigns yet. Create one in My Studio.</div>`;
    return;
  }

  list.innerHTML = "";

  for (const c of campaigns) {
    // on-chain enrich (progress)
    let onchain = null;
    try {
      if (ctx) onchain = await loadCampaignOnChain(c.campaignId);
    } catch {
      // ignore errors (RPC sometimes fails)
    }

    const collectedEth = onchain?.collectedEth ?? "0";
    const goalEth = onchain?.goalEth ?? "0";
    const pct = (Number(goalEth) > 0)
      ? Math.min(100, Math.floor((Number(collectedEth) / Number(goalEth)) * 100))
      : 0;

    const card = document.createElement("div");
    card.className = "campaign-card";

    card.innerHTML = `
      <img class="campaign-banner" src="${escapeHtml(c.imageUrl)}" alt="banner" />
      <div class="campaign-content">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <h3>${escapeHtml(c.title)}</h3>
          <span class="badge">ID ${escapeHtml(c.campaignId)}</span>
        </div>

        <div class="muted small" style="min-height:40px;">
          ${escapeHtml(c.description || "")}
        </div>

        <div class="progress-container">
          <div class="progress-bar" style="width:${pct}%"></div>
        </div>
        <div class="progress-stats">
          <span><b>${escapeHtml(collectedEth)}</b> <span class="muted">/ ${escapeHtml(goalEth)} ETH</span></span>
          <span class="percent-label">${pct}%</span>
        </div>

        <div class="card-footer">
          <div class="muted small">Owner: <code>${escapeHtml((c.owner || "").slice(0,6))}…${escapeHtml((c.owner || "").slice(-4))}</code></div>
          <button class="secondary" data-open="1">Open</button>
        </div>
      </div>
    `;

    card.querySelector("button")?.addEventListener("click", async () => {
      try {
        await openCampaign(c);
      } catch (e) {
        setStatus(e.shortMessage || e.message, "err");
      }
    });

    list.appendChild(card);
  }
}

async function saveCampaignCard() {
  if (!ctx) throw new Error("Connect first");

  const campaignId = $("cardCampaignId")?.value?.trim();
  const imageUrl = $("cardImageUrl")?.value?.trim();
  const description = $("cardDesc")?.value?.trim();

  if (!campaignId || !imageUrl) throw new Error("Fill Campaign ID and Image URL");

  const onchain = await loadCampaignOnChain(campaignId);
  const owner = onchain.owner;
  const me = ctx.user.toLowerCase();

  if (owner !== me) throw new Error("Only campaign owner can update card data");

  const nonce = Math.floor(Math.random() * 1e9);
  const message =
`CrowdSubHybrid Campaign Card
campaignId: ${campaignId}
address: ${ctx.user}
nonce: ${nonce}`;

  setStatus("Sign message in MetaMask…", "warn");
  const signature = await ctx.signer.signMessage(message);

  setStatus("Saving card…", "warn");
  const resp = await fetch(`${BACKEND_URL}/campaigns`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      campaignId,
      title: onchain.title,
      imageUrl,
      description: description || "",
      address: ctx.user,
      message,
      signature
    })
  });

  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || "Save failed");

  setStatus("Campaign card saved ✅", "ok");
  await loadCampaignCards();
}

async function createCampaign() {
  if (!ctx) throw new Error("Connect first");

  const title = $("newTitle")?.value?.trim();
  const goalEth = $("newGoal")?.value?.trim() || "0";
  const durStr = $("newDur")?.value?.trim();

  if (!title || !durStr) throw new Error("Fill title and duration");

  setStatus("Confirm campaign creation…", "warn");
  const tx = await ctx.hybrid.createCampaign(title, ethers.parseEther(goalEth), BigInt(durStr));
  setStatus(`Pending: ${tx.hash}`, "warn");
  await tx.wait();

  setStatus("Campaign created ✅ (now set card data)", "ok");
}

async function doConnect() {
  setStatus("Connecting…", "warn");
  ctx = await connect();

  if ($("addr")) $("addr").textContent = ctx.user;
  if ($("net")) $("net").textContent = `${ctx.network.name} (chainId=${Number(ctx.network.chainId)})`;

  await refreshBalances();
  await loadCampaignCards().catch(() => {});
  setStatus("Connected ✅", "ok");
}

window.addEventListener("DOMContentLoaded", () => {
  setView("explore");

  bindClick("tabExplore", () => setView("explore"));
  bindClick("tabCreator", () => setView("creator"));

  bindClick("btnCloseDetails", () => $("detailsWrap")?.classList.add("hidden"));

  bindClick("btnConnect", async () => {
    try { await doConnect(); }
    catch (e) { setStatus(e.shortMessage || e.message, "err"); }
  });

  bindClick("btnLoadCampaigns", async () => {
    try {
      await loadCampaignCards();
      setStatus("Campaign list updated ✅", "ok");
    } catch (e) {
      setStatus(e.message, "err");
    }
  });

  bindClick("btnCreateCampaign", async () => {
    try { await createCampaign(); }
    catch (e) { setStatus(e.shortMessage || e.message, "err"); }
  });

  bindClick("btnSaveCard", async () => {
    try { await saveCampaignCard(); }
    catch (e) { setStatus(e.shortMessage || e.message, "err"); }
  });

  // These two are just hints (real actions are inside campaign -> Owner Tools)
  bindClick("btnCreateTier", () => setStatus("Open your campaign in Marketplace → Owner Tools → Add Tier", "warn"));
  bindClick("btnPublishPost", () => setStatus("Open your campaign in Marketplace → Owner Tools → Publish Post", "warn"));
});
