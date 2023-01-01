//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.16;

import "./NewCoin.sol";
import "./NewLP.sol";

contract NewRouter {
    // New Liquidity Pool contract
    NewLP public pool;

    // NewCoin contract
    NewCoin public token;

    /// @param token_ address of the token contract
    /// @param pool_ address of the liquidity pool contract
    constructor(NewCoin token_, NewLP pool_) {
        token = token_;
        pool = pool_;
    }

    /// @notice Performs the sanity checks, transfers ETH/NEW to the pool and sends the liquidity "to" address.
    ///   Also sends the remaining ETH to the caller in case there is any.
    /// @param amountNEWExpected expected amount of NEW to add to the liquidity pool
    /// @param to address to which transfer the liquidity tokens
    function addLiquidity(uint256 amountNEWExpected, address to) external payable {
        (uint256 amountETH, uint256 amountNEW) = _getAddLiquidityDeposits(msg.value, amountNEWExpected);

        (bool success,) = address(pool).call{value: amountETH}(""); // solhint-disable-line avoid-low-level-calls
        require(success, "ETH transfer failed");
        require(token.transferFrom(msg.sender, address(pool), amountNEW), "NEW transfer failed");

        pool.mint(to);

        if (msg.value > amountETH) { // send potential remaining ETH to the user
            (bool success2,) = msg.sender.call{value: msg.value - amountETH}(""); // solhint-disable-line avoid-low-level-calls
            require(success2, "remaining ETH transfer failed");
        }
    }
  
    /// @notice Transfers the liquidity tokens from the caller and sends a share of ETH/NEW "to" address.
    /// @param liquidity amount of liquidity tokens to burn
    /// @param to address to which to send ETH and NEW tokens for burned liquidity
    function removeLiquidity(uint256 liquidity, address to) external {
        require(pool.transferFrom(msg.sender, address(pool), liquidity), "liquidity transfer failed");
        pool.burn(to);
    }

    /// @notice Performs the safety checks and transfers ETH or NEW in and transfers ETH or NEW back (out).
    ///   If you send ETH with the call, the function will swap NEW for it. amountNEWIn param will then be ignored.
    ///   Otherwise, use amountNEWIn param to swap ETH for NEW and do not send any ETH with the function call.
    /// @param amountNEWIn amount of NEW to swap
    /// @param amountOutMin minimum output amount (for slippage calculations)
    /// @param to address to which to send out ETH or NEW
    function swap(uint256 amountNEWIn, uint256 amountOutMin, address to) external payable {
        (uint256 amountIn, bool ethIn) = _checkAmountIn(msg.value, amountNEWIn);
        (uint256 reserveETH, uint256 reserveNEW) = pool.getReserves();
        if (ethIn) {
            uint256 amountNEWOut = getAmountOut(amountIn, reserveETH, reserveNEW);            
            (bool success,) = address(pool).call{value: amountIn}(""); // solhint-disable-line avoid-low-level-calls
            require(success, "ETH in transfer failed");
            uint256 toNEWBalanceBefore = token.balanceOf(to);
            pool.swap(to, 0, amountNEWOut);
            uint256 amountNEWOutActual = token.balanceOf(to) - toNEWBalanceBefore; // fee-on-transfer support
            require(amountNEWOutActual >= amountOutMin, "NEW min amount");
        } else {
            require(token.transferFrom(msg.sender, address(pool), amountNEWIn), "NEW in transfer failed");
            uint256 amountInActual = token.balanceOf(address(pool)) - reserveNEW; // fee-on-transfer support
            uint256 amountETHOut = getAmountOut(amountInActual, reserveNEW, reserveETH);
            require(amountETHOut >= amountOutMin, "ETH min amount");
            pool.swap(to, amountETHOut, 0);
        }
    }

    /// @notice Returns out amount (the one you should receive) for the swap given some input ETH/NEW amounts.
    ///   There is a constant 1% fee for swapping the tokens.
    /// @param amountIn input amount of ETH or NEW
    /// @param reserveIn reserve in used for the calculation
    /// @param reserveOut reserve out used for the calculation
    /// @return uint256 output amount
    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) public pure returns (uint256) {
        require(amountIn > 0, "insufficient input amount");
        require(reserveIn > 0 && reserveOut > 0, "insufficient liquidity");
        uint256 amountInWithFee = amountIn * 99;
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = (reserveIn * 100) + amountInWithFee;
        return numerator / denominator;
    }

    /// @notice Check input amounts based on the amountETHIn and amountNEWIn arguments.
    ///   It should be either amountETHIn or amountNEWIn, not both.
    /// @return uint256 normalized input amount
    /// @return bool whether ETH was included in the call
    function _checkAmountIn(uint256 amountETHIn, uint256 amountNEWIn) private pure returns (uint256, bool) {
        bool ethIn;
        uint256 amountIn = amountNEWIn;
        if (amountETHIn > 0) {
            ethIn = true;
            amountIn = amountETHIn;
        }
        return (amountIn, ethIn);
    }

    /// @notice Checks the expected ETC/NEW amounts and use them to return the actual amounts.
    ///   The calculations are performed based on the ETH/NEW ratio from the reserves.
    /// @param amountETHExpected expected amount of ETH to add to the pool
    /// @param amountNEWExpected expected amount of NEW tokens to add to the pool
    /// @return uint256 actual amount of ETH to add to the pool
    /// @return uint256 actual amount of NEW to add to the pool
    function _getAddLiquidityDeposits(
        uint256 amountETHExpected,
        uint256 amountNEWExpected
    ) private view returns (uint256, uint256) {
        (uint256 reserveETH, uint256 reserveNEW) = pool.getReserves();
        if (reserveETH == 0 && reserveNEW == 0) { // initialize the pool with expected amounts
            require(amountETHExpected > 0 && amountNEWExpected > 0, "insufficient initial amounts");
            return (amountETHExpected, amountNEWExpected);
        } else {
            require(amountETHExpected > 0 || amountNEWExpected > 0, "insufficient amounts");
            uint256 amountNEWActual = (amountETHExpected * reserveNEW) / reserveETH;
            if (amountNEWActual <= amountNEWExpected) {
                return (amountETHExpected, amountNEWActual);
            } else {
                uint256 amountETHActual =  (amountNEWExpected * reserveETH) / reserveNEW;
                assert(amountETHActual <= amountETHExpected);
                return (amountETHActual, amountNEWExpected);
            }
        }
    }
}
