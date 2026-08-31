// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title AVSToken
 * @notice Restricted-transfer AVS protocol share token.
 *
 * The token deliberately keeps three authority domains separate:
 * - the owner configures and permanently locks the Vault and Account Policy;
 * - Account Policy permanently authorizes accounts;
 * - the Vault mints AVS to already-authorized accounts.
 */
contract AVSToken is ERC20 {
    uint256 public constant MAX_SUPPLY = 20_000_000 * 1e18;

    address public owner;
    address public vault;
    address public accountPolicy;
    bool public vaultLocked;
    bool public accountPolicyLocked;

    mapping(address account => bool) public isWhitelisted;

    event AccountAuthorized(address indexed account);
    event VaultUpdated(
        address indexed previousVault,
        address indexed newVault
    );
    event AccountPolicyUpdated(
        address indexed previousPolicy,
        address indexed newPolicy
    );
    event VaultLocked();
    event AccountPolicyLocked();
    event OwnershipRenounced(address indexed previousOwner);

    error Unauthorized(address caller);
    error InvalidOwner();
    error InvalidContract(address candidate);
    error AuthorityCollision(address candidate);
    error ConfigurationLocked();
    error ConfigurationNotReady();
    error InvalidAccount();
    error AccountAlreadyAuthorized(address account);
    error NotWhitelisted(address account);
    error TransferNotAllowed(address caller, address from, address to);
    error ApprovalNotAllowed(address caller, address spender);
    error InvalidAmount();
    error MaxSupplyExceeded(uint256 requested, uint256 available);
    error BurnDisabled();
    error OwnershipRenunciationNotReady();

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized(msg.sender);
        _;
    }

    modifier onlyVault() {
        if (msg.sender != vault || vault == address(0)) {
            revert Unauthorized(msg.sender);
        }
        _;
    }

    modifier onlyAccountPolicy() {
        if (msg.sender != accountPolicy || accountPolicy == address(0)) {
            revert Unauthorized(msg.sender);
        }
        _;
    }

    constructor(address initialOwner) ERC20("AVS", "AVS") {
        if (initialOwner == address(0)) revert InvalidOwner();
        owner = initialOwner;
    }

    function decimals() public pure override returns (uint8) {
        return 18;
    }

    function authorizeAccount(address account) external onlyAccountPolicy {
        if (account == address(0)) revert InvalidAccount();
        if (isWhitelisted[account]) {
            revert AccountAlreadyAuthorized(account);
        }

        isWhitelisted[account] = true;
        emit AccountAuthorized(account);
    }

    function setVault(address newVault) external onlyOwner {
        if (vaultLocked) revert ConfigurationLocked();
        _requireContract(newVault);
        if (newVault == owner || newVault == accountPolicy) {
            revert AuthorityCollision(newVault);
        }

        address previousVault = vault;
        vault = newVault;
        emit VaultUpdated(previousVault, newVault);
    }

    function setAccountPolicy(address newPolicy) external onlyOwner {
        if (accountPolicyLocked) revert ConfigurationLocked();
        _requireContract(newPolicy);
        if (newPolicy == owner || newPolicy == vault) {
            revert AuthorityCollision(newPolicy);
        }

        address previousPolicy = accountPolicy;
        accountPolicy = newPolicy;
        emit AccountPolicyUpdated(previousPolicy, newPolicy);
    }

    function lockVault() external onlyOwner {
        if (vaultLocked) revert ConfigurationLocked();
        if (vault == address(0)) revert ConfigurationNotReady();

        vaultLocked = true;
        emit VaultLocked();
    }

    function lockAccountPolicy() external onlyOwner {
        if (accountPolicyLocked) revert ConfigurationLocked();
        if (accountPolicy == address(0)) revert ConfigurationNotReady();

        accountPolicyLocked = true;
        emit AccountPolicyLocked();
    }

    function mint(address to, uint256 amount) external onlyVault {
        if (to == address(0)) revert InvalidAccount();
        if (!isWhitelisted[to]) revert NotWhitelisted(to);
        if (amount == 0) revert InvalidAmount();

        uint256 supply = totalSupply();
        uint256 available = MAX_SUPPLY - supply;
        if (amount > available) revert MaxSupplyExceeded(amount, available);

        _mint(to, amount);
    }

    function approve(
        address spender,
        uint256 amount
    ) public override returns (bool) {
        if (!isWhitelisted[msg.sender] || !isWhitelisted[spender]) {
            revert ApprovalNotAllowed(msg.sender, spender);
        }
        return super.approve(spender, amount);
    }

    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) public override returns (bool) {
        _requireTransferAllowed(msg.sender, from, to);
        return super.transferFrom(from, to, amount);
    }

    function renounceOwnership() external onlyOwner {
        if (
            vault == address(0) ||
            accountPolicy == address(0) ||
            !vaultLocked ||
            !accountPolicyLocked
        ) {
            revert OwnershipRenunciationNotReady();
        }

        address previousOwner = owner;
        owner = address(0);
        emit OwnershipRenounced(previousOwner);
    }

    function _update(
        address from,
        address to,
        uint256 amount
    ) internal override {
        if (from == address(0)) {
            if (!isWhitelisted[to]) revert NotWhitelisted(to);
        } else if (to == address(0)) {
            revert BurnDisabled();
        } else {
            _requireTransferAllowed(msg.sender, from, to);
        }

        super._update(from, to, amount);
    }

    function _requireTransferAllowed(
        address caller,
        address from,
        address to
    ) private view {
        if (
            !isWhitelisted[caller] ||
            !isWhitelisted[from] ||
            !isWhitelisted[to]
        ) {
            revert TransferNotAllowed(caller, from, to);
        }
    }

    function _requireContract(address candidate) private view {
        if (candidate == address(0) || candidate.code.length == 0) {
            revert InvalidContract(candidate);
        }
    }
}