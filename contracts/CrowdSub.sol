// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./SubToken.sol";

contract CrowdSub {
    struct Campaign {
        string title;
        address owner;
        uint256 goalWei;
        uint256 deadline;      // timestamp
        uint256 collectedWei;
        bool finalized;
    }

    struct Tier {
        uint256 priceWei;
        uint256 periodSeconds;
        bool exists;
    }

    SubToken public immutable token;

    // simple reward rate: 1 ETH => 100 SUB
    // since ETH uses 18 decimals, we mint msg.value * 100 (SUB also 18 decimals)
    uint256 public constant REWARD_MULTIPLIER = 100;

    uint256 public campaignCount;

    mapping(uint256 => Campaign) public campaigns;
    mapping(uint256 => mapping(address => uint256)) public contributions;

    mapping(uint256 => uint256) public tierCount;
    mapping(uint256 => mapping(uint256 => Tier)) public tiers;

    // campaignId => user => activeUntil
    mapping(uint256 => mapping(address => uint256)) public activeUntil;
    // campaignId => user => tierId (last chosen)
    mapping(uint256 => mapping(address => uint256)) public userTier;

    event CampaignCreated(uint256 indexed campaignId, address indexed owner, string title, uint256 goalWei, uint256 deadline);
    event Contributed(uint256 indexed campaignId, address indexed user, uint256 amountWei, uint256 rewardMinted);
    event Finalized(uint256 indexed campaignId, uint256 collectedWei);
    event Withdrawn(uint256 indexed campaignId, address indexed owner, uint256 amountWei);

    event TierCreated(uint256 indexed campaignId, uint256 indexed tierId, uint256 priceWei, uint256 periodSeconds);
    event Subscribed(uint256 indexed campaignId, uint256 indexed tierId, address indexed user, uint256 paidWei, uint256 newActiveUntil, uint256 rewardMinted);

    error NotOwner();
    error NotFound();
    error Ended();
    error NotEnded();
    error AlreadyFinalized();
    error InvalidTier();
    error WrongPayment();
    error NothingToWithdraw();

    constructor(address tokenAddress) {
        token = SubToken(tokenAddress);
    }

    // ---------- Crowdfunding core ----------

    function createCampaign(string calldata title, uint256 goalWei, uint256 durationSeconds) external returns (uint256) {
        require(bytes(title).length > 0, "title empty");
        require(durationSeconds > 0, "duration=0");

        uint256 id = ++campaignCount;
        campaigns[id] = Campaign({
            title: title,
            owner: msg.sender,
            goalWei: goalWei,
            deadline: block.timestamp + durationSeconds,
            collectedWei: 0,
            finalized: false
        });

        emit CampaignCreated(id, msg.sender, title, goalWei, campaigns[id].deadline);
        return id;
    }

    function contribute(uint256 campaignId) external payable {
        Campaign storage c = campaigns[campaignId];
        if (c.owner == address(0)) revert NotFound();
        if (block.timestamp > c.deadline) revert Ended();
        if (c.finalized) revert AlreadyFinalized();
        require(msg.value > 0, "value=0");

        c.collectedWei += msg.value;
        contributions[campaignId][msg.sender] += msg.value;

        uint256 reward = msg.value * REWARD_MULTIPLIER;
        token.mint(msg.sender, reward);

        emit Contributed(campaignId, msg.sender, msg.value, reward);
    }

    function finalize(uint256 campaignId) external {
        Campaign storage c = campaigns[campaignId];
        if (c.owner == address(0)) revert NotFound();
        if (c.finalized) revert AlreadyFinalized();
        if (block.timestamp <= c.deadline) revert NotEnded();

        c.finalized = true;
        emit Finalized(campaignId, c.collectedWei);
    }

    function withdraw(uint256 campaignId) external {
        Campaign storage c = campaigns[campaignId];
        if (c.owner == address(0)) revert NotFound();
        if (msg.sender != c.owner) revert NotOwner();
        if (!c.finalized) revert NotEnded();

        uint256 amount = c.collectedWei;
        if (amount == 0) revert NothingToWithdraw();

        c.collectedWei = 0;
        (bool ok, ) = payable(c.owner).call{value: amount}("");
        require(ok, "transfer failed");

        emit Withdrawn(campaignId, c.owner, amount);
    }

    // ---------- Subscription layer (Hybrid) ----------

    function createTier(uint256 campaignId, uint256 priceWei, uint256 periodSeconds) external returns (uint256) {
        Campaign storage c = campaigns[campaignId];
        if (c.owner == address(0)) revert NotFound();
        if (msg.sender != c.owner) revert NotOwner();
        require(priceWei > 0, "price=0");
        require(periodSeconds > 0, "period=0");

        uint256 tid = ++tierCount[campaignId];
        tiers[campaignId][tid] = Tier({priceWei: priceWei, periodSeconds: periodSeconds, exists: true});

        emit TierCreated(campaignId, tid, priceWei, periodSeconds);
        return tid;
    }

    function subscribe(uint256 campaignId, uint256 tierId) external payable {
        Campaign storage c = campaigns[campaignId];
        if (c.owner == address(0)) revert NotFound();
        if (block.timestamp > c.deadline) revert Ended(); // подписки только пока активна кампания
        if (c.finalized) revert AlreadyFinalized();

        Tier memory t = tiers[campaignId][tierId];
        if (!t.exists) revert InvalidTier();
        if (msg.value != t.priceWei) revert WrongPayment();

        // продлеваем: если подписка активна — добавляем период, иначе стартуем с now
        uint256 base = activeUntil[campaignId][msg.sender] > block.timestamp
            ? activeUntil[campaignId][msg.sender]
            : block.timestamp;

        uint256 newUntil = base + t.periodSeconds;
        activeUntil[campaignId][msg.sender] = newUntil;
        userTier[campaignId][msg.sender] = tierId;

        // деньги считаем как вклад (для требований tracking contributions)
        c.collectedWei += msg.value;
        contributions[campaignId][msg.sender] += msg.value;

        uint256 reward = msg.value * REWARD_MULTIPLIER;
        token.mint(msg.sender, reward);

        emit Subscribed(campaignId, tierId, msg.sender, msg.value, newUntil, reward);
    }

    function isActive(uint256 campaignId, address user) external view returns (bool) {
        return activeUntil[campaignId][user] > block.timestamp;
    }
}
