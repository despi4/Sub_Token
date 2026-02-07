import { el, setStatus, connect, getEthBalance, getSubBalance } from "./common.js";

let ctx = null;

async function refreshSub() {
  const campaignId = BigInt(el("campId").value.trim());
  const until = await ctx.hybrid.activeUntil(campaignId, ctx.user);
  const active = await ctx.hybrid.isActive(campaignId, ctx.user);

  el("activeUntil").textContent = String(until);
  el("isActive").textContent = String(active);
  el("premium").style.display = active ? "block" : "none";
}

async function refreshBalances() {
  el("ethBal").textContent = `${await getEthBalance(ctx.provider, ctx.user)} ETH`;
  el("subBal").textContent = `${await getSubBalance(ctx.token, ctx.user)} SUB`;
}

el("btnConnect").onclick = async () => {
  try {
    setStatus("Connecting…", "warn");
    ctx = await connect();
    el("net").textContent = `${ctx.network.name} (chainId=${Number(ctx.network.chainId)})`;
    el("addr").textContent = ctx.user;

    await refreshBalances();
    await refreshSub().catch(() => {});
    setStatus("Connected ✅", "ok");
  } catch (e) {
    setStatus(e.shortMessage || e.message, "err");
  }
};

el("btnRefresh").onclick = async () => {
  try {
    await refreshBalances();
    await refreshSub();
    setStatus("Updated ✅", "ok");
  } catch (e) {
    setStatus(e.shortMessage || e.message, "err");
  }
};
