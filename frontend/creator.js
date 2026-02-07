import { el, setStatus, connect, getEthBalance, getSubBalance, BACKEND_URL } from "./common.js";

/** @type {null | {provider:any, signer:any, user:string, token:any, hybrid:any, network:any}} */
let ctx = null;

async function refreshBalances() {
  el("ethBal").textContent = `${await getEthBalance(ctx.provider, ctx.user)} ETH`;
  el("subBal").textContent = `${await getSubBalance(ctx.token, ctx.user)} SUB`;
}

async function refreshTierCount() {
  const campaignId = BigInt(el("tierCampId").value.trim());
  const count = await ctx.hybrid.tierCount(campaignId);
  el("tierCount").textContent = String(count);
  el("lastTierId").textContent = count > 0n ? String(count) : "—";
}

async function createCampaign() {
  const title = el("cTitle").value.trim();
  const goalEth = el("cGoal").value.trim();
  const dur = BigInt(el("cDur").value.trim());

  setStatus("Creating campaign… confirm in MetaMask", "warn");
  const tx = await ctx.hybrid.createCampaign(title, ethers.parseEther(goalEth), dur);
  setStatus(`Pending: ${tx.hash}`, "warn");
  await tx.wait();
  setStatus("Campaign created ✅", "ok");
}

async function createTier() {
  const campaignId = BigInt(el("tierCampId").value.trim());
  const name = el("tierName").value.trim();
  const priceEth = el("tierPriceEth").value.trim();
  const period = BigInt(el("tierPeriod").value.trim());

  setStatus("Creating tier… confirm in MetaMask", "warn");
  const tx = await ctx.hybrid.createTier(campaignId, name, ethers.parseEther(priceEth), period);
  setStatus(`Pending: ${tx.hash}`, "warn");
  await tx.wait();

  setStatus("Tier created ✅", "ok");
  await refreshTierCount();
}

el("btnConnect").onclick = async () => {
  try {
    setStatus("Connecting…", "warn");
    ctx = await connect();

    el("net").textContent = `${ctx.network.name} (chainId=${Number(ctx.network.chainId)})`;
    el("addr").textContent = ctx.user;

    await refreshBalances();
    await refreshTierCount().catch(() => {});
    setStatus("Connected ✅", "ok");
  } catch (e) {
    setStatus(e.shortMessage || e.message, "err");
  }
};

el("btnCreateCampaign").onclick = async () => {
  try {
    if (!ctx) throw new Error("Connect MetaMask first");
    await createCampaign();
    await refreshBalances();
  } catch (e) {
    setStatus(e.shortMessage || e.message, "err");
  }
};

el("btnCreateTier").onclick = async () => {
  try {
    if (!ctx) throw new Error("Connect MetaMask first");
    await createTier();
    await refreshBalances();
  } catch (e) {
    setStatus(e.shortMessage || e.message, "err");
  }
};

el("btnTierCount").onclick = async () => {
  try {
    if (!ctx) throw new Error("Connect MetaMask first");
    await refreshTierCount();
    setStatus("Tier count loaded ✅", "ok");
  } catch (e) {
    setStatus(e.shortMessage || e.message, "err");
  }
};

// reload on account/network change
if (window.ethereum) {
  window.ethereum.on?.("accountsChanged", () => window.location.reload());
  window.ethereum.on?.("chainChanged", () => window.location.reload());
}

async function publishPost() {
  const campaignId = el("postCampId").value.trim();
  const title = el("postTitle").value.trim();
  const body = el("postBody").value.trim();

  if (!campaignId || !title || !body) throw new Error("Fill all post fields");

  // Message to sign (simple, works for defense)
  const nonce = Math.floor(Math.random() * 1e9);
  const message =
`CrowdSubHybrid Creator Post
campaignId: ${campaignId}
address: ${ctx.user}
nonce: ${nonce}`;

  setStatus("Signing message… confirm in MetaMask", "warn");
  const signature = await ctx.signer.signMessage(message);

  setStatus("Publishing post…", "warn");
  const resp = await fetch(`${BACKEND_URL}/campaigns/${campaignId}/posts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title, body,
      address: ctx.user,
      message,
      signature
    })
  });

  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || "Publish failed");

  setStatus("Post published ✅", "ok");
}

el("btnPublishPost").onclick = async () => {
  try {
    if (!ctx) throw new Error("Connect MetaMask first");
    await publishPost();
  } catch (e) {
    setStatus(e.shortMessage || e.message, "err");
  }
};

