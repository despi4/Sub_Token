import {
  el, setStatus, connect,
  getEthBalance, getSubBalance,
  getTierPriceWei,
  BACKEND_URL
} from "./common.js";

let ctx = null;

let currentCampaignId = 1n;
let campaignOwner = null; // lowercase
let isOwner = false;

let mode = "user"; // "user" | "creator"

function setMode(next) {
  mode = next;
  el("modeLabel").textContent = next === "creator" ? "Creator" : "User";
  showTab(next === "creator" ? "creator" : "explore");
}

function showTab(which) {
  const creator = which === "creator";

  el("tabExplore").classList.toggle("active", !creator);
  el("tabCreator").classList.toggle("active", creator);

  el("viewExplore").classList.toggle("hidden", creator);
  el("viewCreator").classList.toggle("hidden", !creator);

  // In creator view: show tools only if owner
  el("creatorOnly").classList.toggle("hidden", !isOwner);
  el("creatorBlocked").classList.toggle("hidden", isOwner);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;", "'":"&#039;"
  }[m]));
}

function renderPosts(access, posts) {
  const root = el("posts");
  root.innerHTML = "";

  if (!posts || posts.length === 0) {
    root.innerHTML = `<p class="muted small">No posts yet.</p>`;
    return;
  }

  for (const p of posts) {
    const body = access === "full" ? (p.body || "") : (p.bodyPreview || "");
    const div = document.createElement("div");
    div.className = "card postCard";
    div.innerHTML = `
      <h4>${escapeHtml(p.title)}</h4>
      <div class="postMeta">by ${escapeHtml(p.author)} • ${escapeHtml(p.createdAt)}</div>
      <div class="small" style="margin-top:8px; white-space:pre-wrap;">${escapeHtml(body)}</div>
    `;
    root.appendChild(div);
  }
}

async function refreshBalances() {
  el("ethBal").textContent = `${await getEthBalance(ctx.provider, ctx.user)} ETH`;
  el("subBal").textContent = `${await getSubBalance(ctx.token, ctx.user)} SUB`;
}

async function refreshSubscription() {
  const until = await ctx.hybrid.activeUntil(currentCampaignId, ctx.user);
  const active = await ctx.hybrid.isActive(currentCampaignId, ctx.user);

  el("activeUntil").textContent = String(until);
  el("isActive").textContent = String(active);

  el("premiumBox").classList.toggle("hidden", !active);
  el("previewBox").classList.toggle("hidden", active);
}

async function refreshMyContribution() {
  const amt = await ctx.hybrid.contributions(currentCampaignId, ctx.user);
  el("myContrib").textContent = `${ethers.formatEther(amt)} ETH`;
}

async function loadCampaign() {
  currentCampaignId = BigInt(el("campaignId").value.trim());

  setStatus("Loading campaign…", "warn");
  const c = await ctx.hybrid.getCampaign(currentCampaignId);

  const title = c.title ?? c[0];
  campaignOwner = (c.owner ?? c[1]).toLowerCase();
  const collected = ethers.formatEther(c.collectedWei ?? c[4]);
  const deadline = String(c.deadline ?? c[3]);

  el("campTitle").textContent = title;
  el("campOwner").textContent = campaignOwner;
  el("campCollected").textContent = `${collected} ETH`;
  el("campDeadline").textContent = deadline;

  isOwner = ctx.user.toLowerCase() === campaignOwner;

  // Ensure creator view shows correct lock/tools state
  showTab(mode === "creator" ? "creator" : "explore");

  // Defaults
  el("tierId").value = el("tierId").value || "1";

  await refreshSubscription();
  await refreshMyContribution().catch(() => {});
  setStatus("Campaign ready ✅", "ok");
}

async function donate() {
  const amountEth = el("donEth").value.trim();

  setStatus("Confirm donation in MetaMask…", "warn");
  const tx = await ctx.hybrid.contribute(currentCampaignId, {
    value: ethers.parseEther(amountEth)
  });
  setStatus(`Pending: ${tx.hash}`, "warn");
  await tx.wait();

  setStatus("Donation successful ✅", "ok");
  await refreshBalances();
  await refreshMyContribution();
  await loadCampaign();
}

async function subscribeRenew() {
  const tierId = BigInt(el("tierId").value.trim());
  const priceWei = await getTierPriceWei(ctx.hybrid, currentCampaignId, tierId);

  setStatus("Confirm subscription in MetaMask…", "warn");
  const tx = await ctx.hybrid.subscribe(currentCampaignId, tierId, { value: priceWei });
  setStatus(`Pending: ${tx.hash}`, "warn");
  await tx.wait();

  setStatus("Subscribed/Renewed ✅", "ok");
  await refreshBalances();
  await refreshSubscription();
  await refreshMyContribution();
}

async function loadPosts() {
  setStatus("Loading posts…", "warn");

  const url = `${BACKEND_URL}/campaigns/${currentCampaignId}/posts?address=${ctx.user}`;
  const resp = await fetch(url);
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || "Failed to load posts");

  el("contentAccess").textContent = data.access;
  renderPosts(data.access, data.posts);

  setStatus("Posts loaded ✅", "ok");
}

async function publishPost() {
  if (!isOwner) throw new Error("Creator mode locked: you are not the campaign owner");

  const title = el("postTitle").value.trim();
  const body = el("postBody").value.trim();
  if (!title || !body) throw new Error("Fill post title and body");

  const nonce = Math.floor(Math.random() * 1e9);
  const message =
`CrowdSubHybrid Creator Post
campaignId: ${currentCampaignId}
address: ${ctx.user}
nonce: ${nonce}`;

  setStatus("Sign message in MetaMask…", "warn");
  const signature = await ctx.signer.signMessage(message);

  setStatus("Publishing post…", "warn");
  const resp = await fetch(`${BACKEND_URL}/campaigns/${currentCampaignId}/posts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, body, address: ctx.user, message, signature })
  });

  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || "Publish failed");

  setStatus("Post published ✅", "ok");
}

async function createCampaign() {
  if (!ctx) throw new Error("Connect first");

  const title = el("newTitle").value.trim();
  const goalEth = el("newGoal").value.trim();
  const dur = BigInt(el("newDur").value.trim());

  setStatus("Confirm campaign creation…", "warn");
  const tx = await ctx.hybrid.createCampaign(title, ethers.parseEther(goalEth), dur);
  setStatus(`Pending: ${tx.hash}`, "warn");
  await tx.wait();

  setStatus("Campaign created ✅ (open by ID)", "ok");
}

async function createTier() {
  if (!isOwner) throw new Error("Creator mode locked: you are not the campaign owner");

  const name = el("newTierName").value.trim();
  const priceEth = el("newTierPrice").value.trim();
  const period = BigInt(el("newTierPeriod").value.trim());

  setStatus("Confirm tier creation…", "warn");
  const tx = await ctx.hybrid.createTier(
    currentCampaignId,
    name,
    ethers.parseEther(priceEth),
    period
  );
  setStatus(`Pending: ${tx.hash}`, "warn");
  await tx.wait();

  setStatus("Tier created ✅", "ok");
}

async function finalize() {
  if (!isOwner) throw new Error("Creator mode locked: you are not the campaign owner");

  setStatus("Confirm finalize…", "warn");
  const tx = await ctx.hybrid.finalize(currentCampaignId);
  setStatus(`Pending: ${tx.hash}`, "warn");
  await tx.wait();

  setStatus("Finalized ✅", "ok");
  await loadCampaign();
}

// ===== UI EVENTS =====
el("tabExplore").onclick = () => setMode("user");
el("tabCreator").onclick = () => setMode("creator");

el("btnConnect").onclick = async () => {
  try {
    setStatus("Connecting…", "warn");
    ctx = await connect();

    el("addr").textContent = ctx.user;
    el("net").textContent = `${ctx.network.name} (chainId=${Number(ctx.network.chainId)})`;

    setMode("user");

    await refreshBalances();
    await loadCampaign().catch(() => {});
    setStatus("Connected ✅", "ok");
  } catch (e) {
    setStatus(e.shortMessage || e.message, "err");
  }
};

el("btnLoad").onclick = async () => {
  try {
    if (!ctx) throw new Error("Connect first");
    await loadCampaign();
  } catch (e) {
    setStatus(e.shortMessage || e.message, "err");
  }
};

el("btnDonate").onclick = async () => {
  try {
    if (!ctx) throw new Error("Connect first");
    await donate();
  } catch (e) {
    setStatus(e.shortMessage || e.message, "err");
  }
};

el("btnSubscribe").onclick = async () => {
  try {
    if (!ctx) throw new Error("Connect first");
    await subscribeRenew();
  } catch (e) {
    setStatus(e.shortMessage || e.message, "err");
  }
};

el("btnLoadPosts").onclick = async () => {
  try {
    if (!ctx) throw new Error("Connect first");
    await loadPosts();
  } catch (e) {
    setStatus(e.shortMessage || e.message, "err");
  }
};

el("btnMyContrib").onclick = async () => {
  try {
    if (!ctx) throw new Error("Connect first");
    await refreshMyContribution();
    setStatus("Updated ✅", "ok");
  } catch (e) {
    setStatus(e.shortMessage || e.message, "err");
  }
};

el("btnRefresh").onclick = async () => {
  try {
    if (!ctx) throw new Error("Connect first");
    await refreshBalances();
    await refreshSubscription();
    setStatus("Updated ✅", "ok");
  } catch (e) {
    setStatus(e.shortMessage || e.message, "err");
  }
};

// Creator actions
el("btnPublishPost").onclick = async () => {
  try {
    if (!ctx) throw new Error("Connect first");
    await publishPost();
  } catch (e) {
    setStatus(e.shortMessage || e.message, "err");
  }
};

el("btnCreateCampaign").onclick = async () => {
  try {
    if (!ctx) throw new Error("Connect first");
    await createCampaign();
  } catch (e) {
    setStatus(e.shortMessage || e.message, "err");
  }
};

el("btnCreateTier").onclick = async () => {
  try {
    if (!ctx) throw new Error("Connect first");
    await createTier();
  } catch (e) {
    setStatus(e.shortMessage || e.message, "err");
  }
};

el("btnFinalize").onclick = async () => {
  try {
    if (!ctx) throw new Error("Connect first");
    await finalize();
  } catch (e) {
    setStatus(e.shortMessage || e.message, "err");
  }
};

if (window.ethereum) {
  window.ethereum.on?.("accountsChanged", () => window.location.reload());
  window.ethereum.on?.("chainChanged", () => window.location.reload());
}
