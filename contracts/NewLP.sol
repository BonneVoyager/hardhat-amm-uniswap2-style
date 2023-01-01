//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.16;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

import "./NewCoin.sol";

contract NewLP is ERC20 {
    // used for re-entrancy protection
    bool private _locked;

    // amount of reserves in ETH
    uint256 private _reserveETH;

    // amount of reserves in NEW
    uint256 private _reserveNEW;

    // minimum allowed liquidity
    uint256 public constant MINIMUM_LIQUIDITY = 1000;

    // NewCoin contract
    NewCoin public token;

    event Burned(address indexed sender, address indexed to, uint256 amountETH, uint256 amountNEW);
    event Minted(address indexed sender, address indexed to, uint256 amountETH, uint256 amountNEW);
    event Swapped(address indexed sender, address indexed to, uint256 amountETHIn, uint256 amountNEWIn, uint256 amountETHOut, uint256 amountNEWOut);
    event UpdatedReserves(uint256 amountETH, uint256 amountNEW);

    modifier noReentrant() {
        require(!_locked, "no re-entrancy");
        _locked = true;
        _;
        _locked = false;
    }

    /// @param token_ address of the token contract
    constructor(NewCoin token_) ERC20("NEW", "NewLPToken") {
        token = token_;
    }

    /// @notice Mints appropriate amount of liquidity tokens "to" address based on changed ETH/NEW amounts.
    ///   And then updates the reserves based on which the calculations were performed.
    /// @param to address to which mint the liquidity tokens
    function mint(address to) external noReentrant {
        (uint256 reserveETH, uint256 reserveNEW) = getReserves();
        uint256 balanceETH = address(this).balance;
        uint256 balanceNEW = token.balanceOf(address(this));
        uint256 amountETH = balanceETH - reserveETH;
        uint256 amountNEW = balanceNEW - reserveNEW;

        uint256 totalSupply = totalSupply();
        uint256 liquidity;
        if (totalSupply == 0) {
            require(amountETH * amountNEW > 0, "initializing zero liquidity");
            liquidity = Math.sqrt(amountETH * amountNEW) - MINIMUM_LIQUIDITY;
            _mint(address(1), MINIMUM_LIQUIDITY); // OZ blocks minting to address(0)
        } else {
            liquidity = _min((amountETH * totalSupply) / reserveETH, (amountNEW * totalSupply) / reserveNEW);
        }
        require(liquidity > 0, "need more liquidity");
        _mint(to, liquidity);

        _updateReserves(balanceETH, balanceNEW);
        emit Minted(msg.sender, to, amountETH, amountNEW);
    }

    /// @notice Burns relevant amount of liquidity tokens and transfers ETH and NEW "to" address.
    ///   And then updates the reserves to use the most recent balance amounts.
    /// @param to address to transfer the ETH and NEW for the burned liquidity tokens
    function burn(address to) external noReentrant {
        uint256 balanceETH = address(this).balance;
        uint256 balanceNEW = token.balanceOf(address(this));
        uint256 liquidity = balanceOf(address(this));
        uint256 totalSupply = totalSupply();
        uint256 amountETH = (liquidity * balanceETH) / totalSupply;
        uint256 amountNEW = (liquidity * balanceNEW) / totalSupply;
        require(amountETH > 0 && amountNEW > 0, "need to burn more liquidity");

        _burn(address(this), liquidity);
        (bool success,) = to.call{value: amountETH}(""); // solhint-disable-line avoid-low-level-calls
        require(success, "ETH transfer failed");
        require(token.transfer(to, amountNEW), "NEW transfer failed");

        _updateReserves(address(this).balance, token.balanceOf(address(this)));
        emit Burned(msg.sender, to, amountETH, amountNEW);
    }

    /// @notice Swaps a certain amount of ETH or NEW in exchange for sent funds.
    ///   And then updates the reserves to use the most recent balance amounts.
    /// @param to address to transfer the ETH or NEW
    /// @param amountETHOut amount of ETH to send
    /// @param amountNEWOut amount of NEW to send
    function swap(address to, uint256 amountETHOut, uint256 amountNEWOut) external noReentrant {
        require(amountETHOut > 0 || amountNEWOut > 0, "insufficient output amount");
        (uint256 reserveETH, uint256 reserveNEW) = getReserves();
        require(amountETHOut < reserveETH && amountNEWOut < reserveNEW, "not enough liquidity");

        if (amountETHOut > 0) {
            (bool success,) = to.call{value: amountETHOut}(""); // solhint-disable-line avoid-low-level-calls
            require(success, "ETH transfer failed");
        }
        if (amountNEWOut > 0) {
            require(token.transfer(to, amountNEWOut), "NEW transfer failed");
        }

        uint256 balanceETH = address(this).balance;
        uint256 balanceNEW = token.balanceOf(address(this));
        uint256 amountETHIn = balanceETH > reserveETH - amountETHOut ? balanceETH - reserveETH - amountETHOut : 0;
        uint256 amountNEWIn = balanceNEW > reserveNEW - amountNEWOut ? balanceNEW - reserveNEW - amountNEWOut : 0;
        require(amountETHIn > 0 || amountNEWIn > 0, "insufficient input amount");
        uint256 updatedETHBalance = (balanceETH * 100) - amountETHIn;
        uint256 updatedNEWBalance = (balanceNEW * 100) - amountNEWIn;
        require(updatedETHBalance * updatedNEWBalance >= reserveETH * reserveNEW * (100**2), "invalid k");

        _updateReserves(balanceETH, balanceNEW);
        emit Swapped(msg.sender, to, amountETHIn, amountNEWIn, amountETHOut, amountNEWOut);
    }

    /// @notice Refreshes the reserve balances to the actual balances.
    ///   Use this in case there are sub-optimal rates for ETH-NEW.
    function sync() external {
        _updateReserves(address(this).balance, token.balanceOf(address(this)));
    }

    /// @notice Returns the reserves.
    /// @return uint256 ETH reserve
    /// @return uint256 NEW reserve
    function getReserves() public view returns (uint256, uint256) {
        return (_reserveETH, _reserveNEW);
    }

    /// @notice Gets the minimum from two numbers.
    /// @param first value for comparison
    /// @param second value for comparison
    /// @return uint256 minimum value
    function _min(uint256 first, uint256 second) private pure returns (uint256) {
        return first < second ? first : second;
    }

    /// @notice Updates the reserves.
    /// @param balanceETH updated ETH balance
    /// @param balanceNEW updated NEW balance
    function _updateReserves(uint256 balanceETH, uint256 balanceNEW) private {
        _reserveETH = balanceETH;
        _reserveNEW = balanceNEW;
        emit UpdatedReserves(_reserveETH, _reserveNEW);
    }

    /// @notice allows receiving ETH transfer
    receive() external payable {} // solhint-disable-line no-empty-blocks
}
