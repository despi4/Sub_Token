/* global ethers */

const SEPOLIA_CHAIN_ID = 11155111;

let provider, signer, user;
let crowdfunding, token;

const el = (id) => document.getElementById(id);

function setStatus(msg, cls = "muted") {
  const s = el("status");
  s.className = `${cls} small`;
  s.textContent = `status: ${msg}`;
}

async function connectWallet() {
  if (!window.ethereum) throw new Error("MetaMask not found");

  await window.ethereum.request({ method: "eth_requestAccounts" });

  provider = new ethers.BrowserProvider(window.ethereum);
  signer = await provider.getSigner();
  user = await signer.getAddress();

  el("addr").textContent = user;

  await checkNetwork();
  await refreshEthBalance();
}

async function checkNetwork() {
  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);

  el("net").textContent = `${network.name} (chainId=${chainId})`;

  if (chainId !== SEPOLIA_CHAIN_ID) {
    setStatus("Wrong network. Please switch MetaMask to Sepolia.", "warn");
    throw new Error("Wrong network: please select Sepolia");
  }
  setStatus("Connected to Sepolia ✅", "ok");
}

async function refreshEthBalance() {
  if (!provider || !user) return;
  const bal = await provider.getBalance(user);
  el("ethBal").textContent = `${ethers.formatEther(bal)} ETH`;
}

async function refreshTokenBalance() {
  if (!token || !user) {
    el("tokBal").textContent = "—";
    return;
  }
  const bal = await token.balanceOf(user);
  // assuming 18 decimals (standard)
  el("tokBal").textContent = `${ethers.formatUnits(bal, 18)} RWD`;
}

function parseJSONAbi(text) {
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error("ABI must be a JSON array");
    return parsed;
  } catch (e) {
    throw new Error("Invalid ABI JSON. Paste the ABI array from Remix.");
  }
}

async function initContracts() {
  if (!signer) throw new Error("Connect wallet first");

  const crowdAddr = el("crowdAddr").value.trim();
  const tokenAddr = el("tokenAddr").value.trim();
  if (!crowdAddr || !tokenAddr) throw new Error("Paste both contract addresses");

  const crowdAbi = parseJSONAbi(el("crowdAbi").value.trim());
  const tokenAbi = parseJSONAbi(el("tokenAbi").value.trim());

  crowdfunding = new ethers.Contract(crowdAddr, crowdAbi, signer);
  token = new ethers.Contract(tokenAddr, tokenAbi, signer);

  setStatus("Contracts initialized ✅", "ok");
  await refreshTokenBalance();
}

async function createCampaign() {
  if (!crowdfunding) throw new Error("Initialize contracts first");

  const title = el("cTitle").value;
  const goalEth = el("cGoal").value;
  const duration = BigInt(el("cDur").value);

  setStatus("Creating campaign… (confirm in MetaMask)");
  const tx = await crowdfunding.createCampaign(
    title,
    ethers.parseEther(goalEth),
    duration
  );
  setStatus(`Pending: ${tx.hash}`);

  await tx.wait();
  setStatus("Campaign created ✅", "ok");
}

async function contribute() {
  if (!crowdfunding) throw new Error("Initialize contracts first");

  const id = BigInt(el("campId").value);
  const amountEth = el("donateEth").value;

  setStatus("Sending contribution… (confirm in MetaMask)");
  const tx = await crowdfunding.contribute(id, {
    value: ethers.parseEther(amountEth),
  });
  setStatus(`Pending: ${tx.hash}`);

  await tx.wait();
  setStatus("Contribution successful ✅ (Reward token minted)", "ok");

  await refreshEthBalance();
  await refreshTokenBalance();
}

async function loadCampaign() {
  if (!crowdfunding) throw new Error("Initialize contracts first");

  const id = BigInt(el("infoId").value);

  setStatus("Loading campaign…");
  // Your contract has getCampaign(uint256) returning struct
  const c = await crowdfunding.getCampaign(id);

  // Depending on Solidity, struct fields come by index + named keys.
  el("infoTitle").textContent = c.title ?? c[0];
  el("infoOwner").textContent = c.owner ?? c[1];
  el("infoGoal").textContent = ethers.formatEther(c.goalWei ?? c[2]);
  el("infoDeadline").textContent = String(c.deadline ?? c[3]);
  el("infoCollected").textContent = ethers.formatEther(c.collectedWei ?? c[4]);
  el("infoFinal").textContent = String(c.finalized ?? c[5]);

  setStatus("Campaign loaded ✅", "ok");
}

async function myContribution() {
  if (!crowdfunding) throw new Error("Initialize contracts first");
  if (!user) throw new Error("Connect wallet first");

  const id = BigInt(el("infoId").value);

  setStatus("Reading my contribution…");
  // mapping contributions(campaignId, user) exists in your contract
  const amt = await crowdfunding.contributions(id, user);
  el("myContrib").textContent = ethers.formatEther(amt);

  setStatus("Contribution loaded ✅", "ok");
}

async function finalizeCampaign() {
  if (!crowdfunding) throw new Error("Initialize contracts first");

  const id = BigInt(el("finId").value);

  setStatus("Finalizing… (confirm in MetaMask)");
  const tx = await crowdfunding.finalize(id);
  setStatus(`Pending: ${tx.hash}`);

  await tx.wait();
  setStatus("Finalized ✅", "ok");
}

// UI bindings
el("btnConnect").onclick = async () => {
  try {
    await connectWallet();
  } catch (e) {
    setStatus(e.shortMessage || e.message, "err");
  }
};

el("btnInit").onclick = async () => {
  try {
    await initContracts();
  } catch (e) {
    setStatus(e.shortMessage || e.message, "err");
  }
};

el("btnCreate").onclick = async () => {
  try {
    await createCampaign();
  } catch (e) {
    setStatus(e.shortMessage || e.message, "err");
  }
};

el("btnDonate").onclick = async () => {
  try {
    await contribute();
  } catch (e) {
    setStatus(e.shortMessage || e.message, "err");
  }
};

el("btnLoad").onclick = async () => {
  try {
    await loadCampaign();
  } catch (e) {
    setStatus(e.shortMessage || e.message, "err");
  }
};

el("btnMyContrib").onclick = async () => {
  try {
    await myContribution();
  } catch (e) {
    setStatus(e.shortMessage || e.message, "err");
  }
};

el("btnFinalize").onclick = async () => {
  try {
    await finalizeCampaign();
  } catch (e) {
    setStatus(e.shortMessage || e.message, "err");
  }
};

// optional: auto-update balances when account changes
if (window.ethereum) {
  window.ethereum.on?.("accountsChanged", () => window.location.reload());
  window.ethereum.on?.("chainChanged", () => window.location.reload());
}
