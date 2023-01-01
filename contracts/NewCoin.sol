//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.16;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract NewCoin is ERC20 {
    // number of percentages taken from each transfer when tax logic is enabled
    uint256 public constant TAX_PERCENTAGE = 5;

    // owner of the contract
    address public immutable owner;

    // whether the contract was initialized
    bool public initialized;

    // whether the tax logic is enabled
    bool public taxEnabled;

    // whether the transfers are enabled, transfers need to be manually allowed by the owner after the deployment
    bool public transfersEnabled;

    // treasury address used for tax transfers
    address public treasury;

    // addresses allowed to transfer funds before global transfers are enabled by the owner
    mapping(address => bool) public allowed;

    event Initialized();
    event TaxEnabled(bool newStatus);
    event TransfersEnabled();

    modifier onlyAllowed {
        require(transfersEnabled || allowed[msg.sender], "not allowed");
        _;
    }

    modifier onlyOwner {
        require(msg.sender == owner, "caller not the owner");
        _;
    }

    constructor() ERC20("NewCoin", "NEW") {
        owner = msg.sender;
    }

    /// @notice Initializes the contract by minting the tokens to receiver and treasury addresses, adds a list
    ///   of addresses allowed to transfer tokens before global transfers are enabled. Can be called only once.
    /// @param treasury_ trasury address used for tax transfers, will also receive 350k tokens
    /// @param receiver_ another address to receive 150k tokens, e.g. ICO contract
    /// @param allowed_ addresses allowed to make the transfers before they're globally enabled by the owner
    function initialize(address treasury_, address receiver_, address[] calldata allowed_) external onlyOwner {
        require(!initialized, "cannot initialize twice");
        initialized = true;
        treasury = treasury_;
        for (uint256 i = 0; i < allowed_.length; i++) {
            allowed[allowed_[i]] = true;
        }
        emit Initialized();
        _mint(treasury_, 350000 * 1 ether);
        _mint(receiver_, 150000 * 1 ether);
    }

    /// @notice Calculates a tax based on given amount. Can be 0 when tax logic is disabled.
    /// @param amount amount on which the tax is calculated
    /// @return amount amount of tax
    function _calculateTax(uint256 amount) private view returns (uint256) {
        if (taxEnabled) {
            return (amount * TAX_PERCENTAGE) / 100;
        } else {
            return 0;
        }
    }

    /// @notice Allows the owner to enable or disable tax logic.
    /// @param enable whether to enable to disable the tax
    function enableTax(bool enable) external onlyOwner {
        require(taxEnabled != enable, "tax unchanged");
        taxEnabled = enable;
        emit TaxEnabled(enable);
    }

    /// @notice Allows the owner to enable the transfers. Can be called only once.
    function enableTransfers() external onlyOwner {
        require(!transfersEnabled, "already enabled");
        transfersEnabled = true;
        emit TransfersEnabled();
    }

    /// @notice The difference from standard ERC20 _transfer() is that it runs taxation logic.
    /// @param sender address of the sender
    /// @param recipient address of the recipient
    /// @param amount specified amount of tokens to be transferred
    function _transfer(address sender, address recipient, uint256 amount) internal virtual override onlyAllowed {
        require(recipient != address(this), "contract transfer not allowed");
        uint256 taxAmount = _calculateTax(amount);
        if (taxAmount > 0) {
            amount -= taxAmount;
            super._transfer(sender, treasury, taxAmount);
        }
        super._transfer(sender, recipient, amount);
    }
}
