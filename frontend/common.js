/* global ethers */

export const SEPOLIA_CHAIN_ID = 11155111;

export const BACKEND_URL = "http://localhost:8080";

export const TOKEN_ADDRESS  = "0x8f1395984dF840399eb464CcF14Bea1498816B74";
export const HYBRID_ADDRESS = "0xe800F57F7016E938d5D1Ed56Ed864A8C5bC03389";

export const TOKEN_ABI = [
  "function balanceOf(address) view returns (uint256)"
];

export const HYBRID_ABI = [
  "function createCampaign(string title,uint256 goalWei,uint256 durationSeconds) returns (uint256)",
  "function contribute(uint256 campaignId) payable",
  "function finalize(uint256 campaignId)",
  "function getCampaign(uint256 campaignId) view returns (tuple(string title,address owner,uint256 goalWei,uint256 deadline,uint256 collectedWei,bool finalized))",
  "function contributions(uint256 campaignId,address user) view returns (uint256)",

  "function createTier(uint256 campaignId,string name,uint256 priceWei,uint256 periodSeconds) returns (uint256)",
  "function tierCount(uint256 campaignId) view returns (uint256)",
  "function getTier(uint256 campaignId,uint256 tierId) view returns (tuple(string name,uint256 priceWei,uint256 periodSeconds,bool exists))",

  "function subscribe(uint256 campaignId,uint256 tierId) payable",
  "function activeUntil(uint256 campaignId,address user) view returns (uint256)",
  "function isActive(uint256 campaignId,address user) view returns (bool)"
];

export function el(id){ return document.getElementById(id); }

export function setStatus(msg, cls="muted"){
  const s = el("status");
  if (!s) return;
  s.className = `status ${cls} small`;
  s.textContent = `status: ${msg}`;
}

export async function getEthBalance(provider, user){
  const bal = await provider.getBalance(user);
  return ethers.formatEther(bal);
}

export async function getSubBalance(token, user){
  const bal = await token.balanceOf(user);
  return ethers.formatUnits(bal, 18);
}

export async function getTierPriceWei(hybrid, campaignId, tierId){
  const t = await hybrid.getTier(campaignId, tierId);
  return t.priceWei ?? t[1];
}

async function ensureSepolia() {
  const sepoliaHex = "0xaa36a7"; // 11155111

  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: sepoliaHex }],
    });
  } catch (err) {
    if (err && err.code === 4902) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: sepoliaHex,
          chainName: "Sepolia Test Network",
          nativeCurrency: { name: "SepoliaETH", symbol: "ETH", decimals: 18 },
          rpcUrls: ["https://rpc.sepolia.org"],
          blockExplorerUrls: ["https://sepolia.etherscan.io"]
        }],
      });
      return;
    }
    throw err;
  }
}

export async function connect() {
  if (!window.ethereum) throw new Error("MetaMask not found");

  // This triggers the MetaMask popup
  await window.ethereum.request({ method: "eth_requestAccounts" });

  // Auto switch/add Sepolia
  await ensureSepolia();

  const provider = new ethers.BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  const user = await signer.getAddress();

  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);
  if (chainId !== SEPOLIA_CHAIN_ID) {
    throw new Error("Wrong network. Please select Sepolia (11155111).");
  }

  const token  = new ethers.Contract(TOKEN_ADDRESS, TOKEN_ABI, signer);
  const hybrid = new ethers.Contract(HYBRID_ADDRESS, HYBRID_ABI, signer);

  return { provider, signer, user, token, hybrid, network };
}
