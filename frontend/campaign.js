import { el, setStatus, connect, getEthBalance, getSubBalance, getTierPriceWei, BACKEND_URL } from "./common.js";

/** @type {null | {provider:any, signer:any, user:string, token:any, hybrid:any, network:any}} */
let ctx = null;

async function refreshBalances() {
  el("ethBal").textContent = `${await getEthBalance(ctx.provider, ctx.user)} ETH`;
  el("subBal").textContent = `${await getSubBalance(ctx.token, ctx.user)} SUB`;
}

async function loadCampaign() {
  const id = BigInt(el("campId").value.trim());
  setStatus("Loading campaign…", "warn");

  const c = await ctx.hybrid.getCampaign(id);

  el("infoTitle").textContent = c.title ?? c[0];
  el("infoOwner").textContent = c.owner ?? c[1];
  el("infoGoal").textContent = ethers.formatEther(c.goalWei ?? c[2]);
  el("infoDeadline").textContent = String(c.deadline ?? c[3]);
  el("infoCollected").textContent = ethers.formatEther(c.collectedWei ?? c[4]);
  el("infoFinalized").textContent = String(c.finalized ?? c[5]);

  setStatus("Campaign loaded ✅", "ok");
}

async function myContribution() {
  const id = BigInt(el("campId").value.trim());
  setStatus("Reading your contribution…", "warn");

  const amt = await ctx.hybrid.contributions(id, ctx.user);
  el("myContrib").textContent = ethers.formatEther(amt);

  setStatus("Contribution loaded ✅", "ok");
}

async function donate() {
  const id = BigInt(el("campId").value.trim());
  const amountEth = el("donEth").value.trim();

  setStatus("Sending donation… confirm in MetaMask", "warn");
  const tx = await ctx.hybrid.contribute(id, { value: ethers.parseEther(amountEth) });
  setStatus(`Pending: ${tx.hash}`, "warn");
  await tx.wait();

  setStatus("Donation successful ✅ (SUB minted)", "ok");
  await refreshBalances();
  await loadCampaign().catch(() => {});
  await myContribution().catch(() => {});
}

async function refreshSubscription() {
  const id = BigInt(el("campId").value.trim());

  const until = await ctx.hybrid.activeUntil(id, ctx.user);
  const active = await ctx.hybrid.isActive(id, ctx.user);

  el("activeUntil").textContent = String(until);
  el("isActive").textContent = String(active);

  el("premium").style.display = active ? "block" : "none";
}

async function subscribeRenew() {
  const campaignId = BigInt(el("campId").value.trim());
  const tierId = BigInt(el("tierId").value.trim());

  // read exact tier price from chain to avoid WrongPayment()
  const priceWei = await getTierPriceWei(ctx.hybrid, campaignId, tierId);

  setStatus("Subscribing/Renewing… confirm in MetaMask", "warn");
  const tx = await ctx.hybrid.subscribe(campaignId, tierId, { value: priceWei });
  setStatus(`Pending: ${tx.hash}`, "warn");
  await tx.wait();

  setStatus("Subscribed/Renewed ✅", "ok");
  await refreshBalances();
  await refreshSubscription();
  await loadCampaign().catch(() => {});
  await myContribution().catch(() => {});
}

async function finalizeCampaign() {
  const id = BigInt(el("campId").value.trim());

  setStatus("Finalizing… confirm in MetaMask", "warn");
  const tx = await ctx.hybrid.finalize(id);
  setStatus(`Pending: ${tx.hash}`, "warn");
  await tx.wait();

  setStatus("Finalized ✅", "ok");
  await loadCampaign().catch(() => {});
}

el("btnConnect").onclick = async () => {
  try {
    setStatus("Connecting…", "warn");
    ctx = await connect();

    el("net").textContent = `${ctx.network.name} (chainId=${Number(ctx.network.chainId)})`;
    el("addr").textContent = ctx.user;

    await refreshBalances();
    await loadCampaign().catch(() => {});
    await refreshSubscription().catch(() => {});
    setStatus("Connected ✅", "ok");
  } catch (e) {
    setStatus(e.shortMessage || e.message, "err");
  }
};

el("btnLoad").onclick = async () => {
  try {
    if (!ctx) throw new Error("Connect MetaMask first");
    await loadCampaign();
  } catch (e) {
    setStatus(e.shortMessage || e.message, "err");
  }
};

el("btnMyContrib").onclick = async () => {
  try {
    if (!ctx) throw new Error("Connect MetaMask first");
    await myContribution();
  } catch (e) {
    setStatus(e.shortMessage || e.message, "err");
  }
};

el("btnDonate").onclick = async () => {
  try {
    if (!ctx) throw new Error("Connect MetaMask first");
    await donate();
  } catch (e) {
    setStatus(e.shortMessage || e.message, "err");
  }
};

el("btnRefreshSub").onclick = async () => {
  try {
    if (!ctx) throw new Error("Connect MetaMask first");
    await refreshSubscription();
    setStatus("Subscription status updated ✅", "ok");
  } catch (e) {
    setStatus(e.shortMessage || e.message, "err");
  }
};

el("btnSubscribe").onclick = async () => {
  try {
    if (!ctx) throw new Error("Connect MetaMask first");
    await subscribeRenew();
  } catch (e) {
    setStatus(e.shortMessage || e.message, "err");
  }
};

el("btnFinalize").onclick = async () => {
  try {
    if (!ctx) throw new Error("Connect MetaMask first");
    await finalizeCampaign();
  } catch (e) {
    setStatus(e.shortMessage || e.message, "err");
  }
};

// reload on account/network change
if (window.ethereum) {
  window.ethereum.on?.("accountsChanged", () => window.location.reload());
  window.ethereum.on?.("chainChanged", () => window.location.reload());
}

function renderPosts(access, posts) {
  const root = el("posts");
  root.innerHTML = "";

  if (!posts || posts.length === 0) {
    root.innerHTML = `<p class="muted small">No posts yet.</p>`;
    return;
  }

  for (const p of posts) {
    const bodyHtml = (access === "full")
      ? `<div class="small" style="margin-top:6px; white-space:pre-wrap;">${escapeHtml(p.body)}</div>`
      : `<div class="small" style="margin-top:6px; white-space:pre-wrap;">${escapeHtml(p.bodyPreview || "")}</div>`;

    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <h3 style="margin-bottom:6px;">${escapeHtml(p.title)}</h3>
      <div class="muted small">by ${escapeHtml(p.author)} • ${escapeHtml(p.createdAt)}</div>
      ${bodyHtml}
    `;
    root.appendChild(card);
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"
  }[m]));
}

async function loadPosts() {
  const id = el("campId").value.trim();
  setStatus("Loading posts…", "warn");

  const url = `${BACKEND_URL}/campaigns/${id}/posts?address=${ctx.user}`;
  const resp = await fetch(url);
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || "Failed to load posts");

  el("contentAccess").textContent = data.access;
  renderPosts(data.access, data.posts);
  setStatus("Posts loaded ✅", "ok");
}

el("btnLoadPosts").onclick = async () => {
  try {
    if (!ctx) throw new Error("Connect MetaMask first");
    await loadPosts();
  } catch (e) {
    setStatus(e.shortMessage || e.message, "err");
  }
};

