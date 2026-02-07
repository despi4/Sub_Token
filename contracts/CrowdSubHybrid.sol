// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./RewardToken.sol";

contract CrowdSubHybrid {
    struct Campaign {
        string title;
        address owner;
        uint256 goalWei;
        uint256 deadline;      // unix timestamp
        uint256 collectedWei;
        bool finalized;
    }

    struct Tier {
        string name;
        uint256 priceWei;
        uint256 periodSeconds;
        bool exists;
    }

    RewardToken public immutable token;

    // reward: 1 ETH => 100 SUB
    uint256 public constant REWARD_MULTIPLIER = 100;

    uint256 public campaignCount;

    mapping(uint256 => Campaign) public campaigns;
    mapping(uint256 => mapping(address => uint256)) public contributions;

    // tiers per campaign
    mapping(uint256 => uint256) public tierCount;
    mapping(uint256 => mapping(uint256 => Tier)) public tiers;

    // subscription status per campaign per user
    mapping(uint256 => mapping(address => uint256)) public activeUntil; // timestamp
    mapping(uint256 => mapping(address => uint256)) public userTier;    // last tier id

    event CampaignCreated(uint256 indexed campaignId, address indexed owner, string title, uint256 goalWei, uint256 deadline);
    event Contributed(uint256 indexed campaignId, address indexed contributor, uint256 amountWei, uint256 rewardMinted);
    event Finalized(uint256 indexed campaignId, uint256 totalCollectedWei);

    event TierCreated(uint256 indexed campaignId, uint256 indexed tierId, string name, uint256 priceWei, uint256 periodSeconds);
    event Subscribed(uint256 indexed campaignId, uint256 indexed tierId, address indexed user, uint256 paidWei, uint256 newActiveUntil, uint256 rewardMinted);

    error NotFound();
    error NotOwner();
    error Ended();
    error NotEnded();
    error AlreadyFinalized();
    error InvalidTier();
    error WrongPayment();

    constructor(address tokenAddress) {
        token = RewardToken(tokenAddress);
    }

    // -------- Crowdfunding core requirements --------

    function createCampaign(
        string calldata title,
        uint256 goalWei,
        uint256 durationSeconds
    ) external returns (uint256) {
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

    function getCampaign(uint256 campaignId) external view returns (Campaign memory) {
        Campaign memory c = campaigns[campaignId];
        if (c.owner == address(0)) revert NotFound();
        return c;
    }

    // -------- Subscription layer (tiers + manual renew) --------

    function createTier(
        uint256 campaignId,
        string calldata name,
        uint256 priceWei,
        uint256 periodSeconds
    ) external returns (uint256) {
        Campaign storage c = campaigns[campaignId];
        if (c.owner == address(0)) revert NotFound();
        if (msg.sender != c.owner) revert NotOwner();
        if (block.timestamp > c.deadline) revert Ended();
        if (c.finalized) revert AlreadyFinalized();

        require(bytes(name).length > 0, "name empty");
        require(priceWei > 0, "price=0");
        require(periodSeconds > 0, "period=0");

        uint256 tid = ++tierCount[campaignId];
        tiers[campaignId][tid] = Tier({
            name: name,
            priceWei: priceWei,
            periodSeconds: periodSeconds,
            exists: true
        });

        emit TierCreated(campaignId, tid, name, priceWei, periodSeconds);
        return tid;
    }

    // subscribe = renew (manual renew)
    function subscribe(uint256 campaignId, uint256 tierId) external payable {
        Campaign storage c = campaigns[campaignId];
        if (c.owner == address(0)) revert NotFound();
        if (block.timestamp > c.deadline) revert Ended();
        if (c.finalized) revert AlreadyFinalized();

        Tier memory t = tiers[campaignId][tierId];
        if (!t.exists) revert InvalidTier();
        if (msg.value != t.priceWei) revert WrongPayment();

        // extend from current activeUntil if still active; otherwise start now
        uint256 base = activeUntil[campaignId][msg.sender] > block.timestamp
            ? activeUntil[campaignId][msg.sender]
            : block.timestamp;

        uint256 newUntil = base + t.periodSeconds;
        activeUntil[campaignId][msg.sender] = newUntil;
        userTier[campaignId][msg.sender] = tierId;

        // count subscription payments as contributions too (fulfills contribution tracking requirement)
        c.collectedWei += msg.value;
        contributions[campaignId][msg.sender] += msg.value;

        uint256 reward = msg.value * REWARD_MULTIPLIER;
        token.mint(msg.sender, reward);

        emit Subscribed(campaignId, tierId, msg.sender, msg.value, newUntil, reward);
    }

    // access check for frontend
    function isActive(uint256 campaignId, address user) external view returns (bool) {
        return activeUntil[campaignId][user] > block.timestamp;
    }

    function getTier(uint256 campaignId, uint256 tierId) external view returns (Tier memory) {
        Tier memory t = tiers[campaignId][tierId];
        if (!t.exists) revert InvalidTier();
        return t;
    }
}
