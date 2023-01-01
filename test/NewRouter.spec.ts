import { expect } from 'chai'
import { ethers } from 'hardhat'
import type { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

import type { NewCoin, NewLP, NewRouter } from '../typechain-types'
import { EventWithBigNumbers, calculateReceiptETHPaid, getEvents, getEventsAmounts, setETHBalance, unit } from './utils'

describe('NewRouter', async () => {
  let deployer: SignerWithAddress
  let treasury: SignerWithAddress
  let alice: SignerWithAddress
  let bob: SignerWithAddress

  let pool: NewLP
  let router: NewRouter
  let token: NewCoin

  const env = process.env
  const FUZZ_ITERATIONS = env.FUZZ_ITERATIONS ? +env.FUZZ_ITERATIONS : 10
  const FUZZ_RANDOM = env.FUZZ_RANDOM ? + env.FUZZ_RANDOM : +Math.random().toFixed(18)
  const FUZZ_ITERATIONS_RANDOM_USE_CASES = env.FUZZ_ITERATIONS_RANDOM_USE_CASES ? +env.FUZZ_ITERATIONS_RANDOM_USE_CASES : 50
  const RATIO = env.RATIO ? +env.RATIO : 5 // 5 NEW for 1 ETH
  const NEW_TAX_ON = env.NEW_TAX_ON ? env.NEW_TAX_ON !== '0' : true

  before(async () => ([deployer, treasury, alice, bob] = await ethers.getSigners()))

  beforeEach(async () => {
    const NewCoinFactory = await ethers.getContractFactory('NewCoin')
    token = await NewCoinFactory.deploy()
    await token.deployed()
    await token.initialize(treasury.address, deployer.address, [])
    await token.enableTransfers()
    await token.transfer(alice.address, unit(10_000))

    const NewLPFactory = await ethers.getContractFactory('NewLP')
    pool = await NewLPFactory.deploy(token.address)
    await pool.deployed()

    const NewRouterFactory = await ethers.getContractFactory('NewRouter')
    router = await NewRouterFactory.deploy(token.address, pool.address)
    await router.deployed()

    // fund the pool with "ICO funds"
    // making a shortcut here so I don't need to run ICO logic, if you're curious why, please read my reasoning in the readme
    const [icoETH, icoNEW] = [unit(30_000), unit(150_000)]
    await setETHBalance(treasury.address, icoETH.add(unit(1))) // add 1 extra ETH for the gas fees
    await token.connect(treasury).approve(router.address, icoNEW)
    await router.connect(treasury).addLiquidity(icoNEW, treasury.address, { value: icoETH })

    if (NEW_TAX_ON) { // optionally, enable NEW 5% tax
      await token.enableTax(true)
    }
  })

  const processAddLiquidity = async () => {
    const [amountETHExpected, amountNEWExpected] = [unit(FUZZ_RANDOM), unit(FUZZ_RANDOM).mul(RATIO)]
    let aliceETHBalance = await ethers.provider.getBalance(alice.address)
    let aliceNEWBalance = await token.balanceOf(alice.address)
    let poolETHBalance = await ethers.provider.getBalance(pool.address)
    let poolNEWBalance = await token.balanceOf(pool.address)

    const txReceiptUnresolvedApproval = await token.connect(alice).approve(router.address, amountNEWExpected)
    const txReceiptUnresolved = await router.connect(alice).addLiquidity(amountNEWExpected, alice.address, { value: amountETHExpected })

    const txReceiptApproval = await txReceiptUnresolvedApproval.wait()
    const txReceipt = await txReceiptUnresolved.wait()
    const txETHDeducted = calculateReceiptETHPaid(txReceipt).add(calculateReceiptETHPaid(txReceiptApproval))
    const { amountETH, amountNEW, amountNEWTotal } = getEventsAmounts(token, pool, txReceipt, 'Minted')
    const remainingsETH = amountETHExpected.sub(amountETH)

    expect(await ethers.provider.getBalance(pool.address)).to.eq(poolETHBalance.add(amountETH))
    expect(await token.balanceOf(pool.address)).to.eq(poolNEWBalance.add(amountNEW))
    const [reserveETH, reserveNEW] = await pool.getReserves()
    expect(reserveETH).to.eq(poolETHBalance.add(amountETH))
    expect(reserveNEW).to.eq(poolNEWBalance.add(amountNEW))
    expect(await ethers.provider.getBalance(alice.address)).to.eq(aliceETHBalance.sub(amountETHExpected).sub(txETHDeducted).add(remainingsETH))
    expect(await token.balanceOf(alice.address)).to.eq(aliceNEWBalance.sub(amountNEWTotal))

    aliceETHBalance = await ethers.provider.getBalance(alice.address)
    aliceNEWBalance = await token.balanceOf(alice.address)
    poolETHBalance = await ethers.provider.getBalance(pool.address)
    poolNEWBalance = await token.balanceOf(pool.address)
  }

  const processRemoveLiquidity = async () => {
    let aliceLiquidity = await pool.balanceOf(alice.address)
    let aliceETHBalance = await ethers.provider.getBalance(alice.address)
    let aliceNEWBalance = await token.balanceOf(alice.address)
    let poolETHBalance = await ethers.provider.getBalance(pool.address)
    let poolNEWBalance = await token.balanceOf(pool.address)

    const partialLiquidity = unit(FUZZ_RANDOM)
    const txReceiptUnresolvedAllowance = await pool.connect(alice).approve(router.address, partialLiquidity)
    const txReceiptUnresolved = await router.connect(alice).removeLiquidity(partialLiquidity, alice.address)

    const txReceiptAllowance = await txReceiptUnresolvedAllowance.wait()
    const txReceipt = await txReceiptUnresolved.wait()
    const txETHDeducted = calculateReceiptETHPaid(txReceipt).add(calculateReceiptETHPaid(txReceiptAllowance))
    const { amountETH, amountNEW, amountNEWTotal } = getEventsAmounts(token, pool, txReceipt, 'Burned')

    expect(await pool.connect(alice).allowance(alice.address, router.address)).to.eq(unit(0))
    expect(await ethers.provider.getBalance(pool.address)).to.eq(poolETHBalance.sub(amountETH))
    expect(await token.balanceOf(pool.address)).to.eq(poolNEWBalance.sub(amountNEWTotal))
    const [reserveETH, reserveNEW] = await pool.getReserves()
    expect(reserveETH).to.eq(poolETHBalance.sub(amountETH))
    expect(reserveNEW).to.eq(poolNEWBalance.sub(amountNEWTotal))
    expect(await pool.balanceOf(alice.address)).to.eq(aliceLiquidity.sub(partialLiquidity))
    expect(await ethers.provider.getBalance(alice.address)).to.eq(aliceETHBalance.add(amountETH).sub(txETHDeducted))
    expect(await token.balanceOf(alice.address)).to.eq(aliceNEWBalance.add(amountNEW))

    aliceLiquidity = await pool.balanceOf(alice.address)
    aliceETHBalance = await ethers.provider.getBalance(alice.address)
    aliceNEWBalance = await token.balanceOf(alice.address)
    poolETHBalance = await ethers.provider.getBalance(pool.address)
    poolNEWBalance = await token.balanceOf(pool.address)
  }

  const processSwap = async () => {
    let [reserveETHBefore, reserveNEWBefore] = await pool.getReserves()
    let bobETHBalance = await ethers.provider.getBalance(bob.address)
    let bobNEWBalance = await token.balanceOf(bob.address)
    let poolETHBalance = await ethers.provider.getBalance(pool.address)
    let poolNEWBalance = await token.balanceOf(pool.address)

    const ethAmount = unit(FUZZ_RANDOM)
    const newAmount = ethAmount.mul(RATIO)
    const useETH = Math.random() > 0.5

    let txReceiptUnresolved
    let txReceiptUnresolvedAllowance
    if (useETH) {
      txReceiptUnresolved = await router.connect(bob).swap(unit(0), unit(0), bob.address, { value: ethAmount })
    } else {
      txReceiptUnresolvedAllowance = await token.connect(bob).approve(router.address, newAmount)
      txReceiptUnresolved = await router.connect(bob).swap(newAmount, unit(0), bob.address)
    }

    const txReceipt = await txReceiptUnresolved.wait()
    let txETHDeducted = calculateReceiptETHPaid(txReceipt)
    if (txReceiptUnresolvedAllowance) {
      const txReceiptAllowance = await txReceiptUnresolvedAllowance.wait()
      txETHDeducted = txETHDeducted.add(calculateReceiptETHPaid(txReceiptAllowance))
    }
    const { amountNEWTax, secondEvent } = getEventsAmounts(token, pool, txReceipt, 'Swapped')
    const { amountETHIn, amountNEWIn, amountETHOut, amountNEWOut } = secondEvent

    expect(await token.connect(bob).allowance(bob.address, router.address)).to.eq(unit(0))
    expect(await ethers.provider.getBalance(pool.address)).to.eq(poolETHBalance.add(amountETHIn).sub(amountETHOut))
    expect(await token.balanceOf(pool.address)).to.eq(poolNEWBalance.add(amountNEWIn).sub(amountNEWOut))
    const [reserveETH, reserveNEW] = await pool.getReserves()
    expect(reserveETH).to.eq(reserveETHBefore.add(amountETHIn).sub(amountETHOut))
    expect(reserveNEW).to.eq(reserveNEWBefore.add(amountNEWIn).sub(amountNEWOut))
    expect(await ethers.provider.getBalance(bob.address)).to.eq(bobETHBalance.add(amountETHOut).sub(amountETHIn).sub(txETHDeducted))
    expect(await token.balanceOf(bob.address)).to.eq(bobNEWBalance.add(amountNEWOut).sub(amountNEWIn).sub(amountNEWTax))

    ;[reserveETHBefore, reserveNEWBefore] = await pool.getReserves()
    bobETHBalance = await ethers.provider.getBalance(bob.address)
    bobNEWBalance = await token.balanceOf(bob.address)
    poolETHBalance = await ethers.provider.getBalance(pool.address)
    poolNEWBalance = await token.balanceOf(pool.address)
  }

  describe('Checks', () => {
    it('Has NewCoin assigned', async () => {
      expect(await router.token()).to.eq(token.address)
    })

    it('Has NewLP assigned', async () => {
      expect(await router.pool()).to.eq(pool.address)
    })

    it('Syncs the reserve amounts', async () => {
      const poolETHBalanceBefore = await ethers.provider.getBalance(pool.address)
      const poolNEWBalanceBefore = await token.balanceOf(pool.address)
      const [reserveETHBefore, reserveNEWBefore] = await pool.getReserves()
      expect(poolETHBalanceBefore).to.eq(reserveETHBefore)
      expect(poolNEWBalanceBefore).to.eq(reserveNEWBefore)

      const newAmount = unit(100)
      const txReceiptUnresolved = await token.connect(alice).transfer(pool.address, newAmount)
      const txReceipt = await txReceiptUnresolved.wait()
      const { amountNEW } = getEventsAmounts(token, pool, txReceipt)
      expect(await token.balanceOf(pool.address)).to.eq(reserveNEWBefore.add(amountNEW))
      expect(poolNEWBalanceBefore).to.eq(reserveNEWBefore)

      const txReceiptUnresolvedSync = await pool.connect(alice).sync()
      expect(await token.balanceOf(pool.address)).to.eq(reserveNEWBefore.add(amountNEW))
      const [reserveETHAfter, reserveNEWAfter] = await pool.getReserves()
      await expect(txReceiptUnresolvedSync).to.emit(pool, 'UpdatedReserves').withArgs(reserveETHAfter, reserveNEWAfter)
      expect(reserveETHAfter).to.eq(poolETHBalanceBefore)
      expect(reserveNEWAfter).to.eq(reserveNEWBefore.add(amountNEW))
    })
  })

  describe('Adding liquidity', () => {
    const [amountETHExpected, amountNEWExpected] = [unit(1), unit(1).mul(RATIO)]

    it('Correctly set the balances and reserves after adding liquidity', async () => {
      const aliceETHBalanceBefore = await ethers.provider.getBalance(alice.address)
      const aliceNEWBalanceBefore = await token.balanceOf(alice.address)
      const poolETHBalanceBefore = await ethers.provider.getBalance(pool.address)
      const poolNEWBalanceBefore = await token.balanceOf(pool.address)
      const [reserveETHBefore, reserveNEWBefore] = await pool.getReserves()

      const txReceiptUnresolvedApproval = await token.connect(alice).approve(router.address, amountNEWExpected)
      const txReceiptUnresolved = await router.connect(alice).addLiquidity(amountNEWExpected, alice.address, { value: amountETHExpected })

      const txReceiptAllowance = await txReceiptUnresolvedApproval.wait()
      const txReceipt = await txReceiptUnresolved.wait()
      const txETHDeducted = calculateReceiptETHPaid(txReceipt).add(calculateReceiptETHPaid(txReceiptAllowance))
      const { amountNEW } = getEventsAmounts(token, pool, txReceipt, 'Minted')

      expect(await ethers.provider.getBalance(alice.address)).to.eq(aliceETHBalanceBefore.sub(amountETHExpected).sub(txETHDeducted))
      expect(await token.balanceOf(alice.address)).to.eq(aliceNEWBalanceBefore.sub(amountNEWExpected))
      expect(await ethers.provider.getBalance(pool.address)).to.eq(poolETHBalanceBefore.add(amountETHExpected))
      expect(await token.balanceOf(pool.address)).to.eq(poolNEWBalanceBefore.add(amountNEW))
      const [reserveETH, reserveNEW] = await pool.getReserves()
      expect(reserveETH).to.eq(reserveETHBefore.add(amountETHExpected))
      expect(reserveNEW).to.eq(reserveNEWBefore.add(amountNEW))
    })

    it('Correctly adds predefined liquidity in different ratios', async () => {
      await token.connect(alice).approve(router.address, amountNEWExpected)
      await router.connect(alice).addLiquidity(amountNEWExpected, alice.address, { value: amountETHExpected })
      await token.connect(alice).approve(router.address, amountNEWExpected.mul(2))
      await router.connect(alice).addLiquidity(amountNEWExpected.mul(2), alice.address, { value: amountETHExpected })
      await token.connect(alice).approve(router.address, amountNEWExpected)
      await router.connect(alice).addLiquidity(amountNEWExpected, alice.address, { value: amountETHExpected.mul(3) })
      await token.connect(alice).approve(router.address, amountNEWExpected.mul(4))
      await router.connect(alice).addLiquidity(amountNEWExpected.mul(4), alice.address, { value: amountETHExpected })
      await token.connect(alice).approve(router.address, amountNEWExpected)
      await router.connect(alice).addLiquidity(amountNEWExpected, alice.address, { value: amountETHExpected.mul(5) })
    })

    it('Correctly handles "to" param', async () => {
      const aliceLiquidityBefore = await pool.balanceOf(alice.address)
      const bobLiquidityBefore = await pool.balanceOf(bob.address)
      expect(aliceLiquidityBefore).to.eq(unit(0))
      expect(bobLiquidityBefore).to.eq(unit(0))

      await token.connect(alice).approve(router.address, amountNEWExpected)
      await router.connect(alice).addLiquidity(amountNEWExpected, bob.address, { value: amountETHExpected })

      expect(await pool.balanceOf(alice.address)).to.eq(unit(0))
      expect(await pool.balanceOf(bob.address)).not.to.eq(unit(0))
    })

    it('Emits "Minted" event after adding liquidity', async () => {
      await token.connect(alice).approve(router.address, amountNEWExpected)
      const txReceiptUnresolved = await router.connect(alice).addLiquidity(amountNEWExpected, alice.address, { value: amountETHExpected })
      const txReceipt = await txReceiptUnresolved.wait()
      const [mintedEvent] = getEvents(pool, txReceipt, 'Minted')
      const { amountETH, amountNEW } = mintedEvent as EventWithBigNumbers
      await expect(txReceiptUnresolved).to.emit(pool, 'Minted')
        .withArgs(router.address, alice.address, amountETH, amountNEW)
    })

    it('Prevents from initializing zero amounts', async () => {
      const NewLPFactory = await ethers.getContractFactory('NewLP')
      pool = await NewLPFactory.deploy(token.address)
      await pool.deployed()

      const NewRouterFactory = await ethers.getContractFactory('NewRouter')
      router = await NewRouterFactory.deploy(token.address, pool.address)
      await router.deployed()

      await expect(router.connect(alice).addLiquidity(unit(0), alice.address, { value: unit(0) }))
        .to.be.revertedWith('insufficient initial amounts')
    })

    it('Prevents from adding insufficient liquidity', async () => {
      await token.connect(alice).approve(router.address, amountNEWExpected)
      await router.connect(alice).addLiquidity(amountNEWExpected, alice.address, { value: amountETHExpected })

      await expect(router.connect(alice).addLiquidity(unit(0), alice.address, { value: unit(0) }))
        .to.be.revertedWith('insufficient amounts')
    })

    it(`Fuzzing [${FUZZ_ITERATIONS}] with ${FUZZ_RANDOM}`, async () => {
      for (let i = 0; i < FUZZ_ITERATIONS; i++) {
        await processAddLiquidity()
      }
    })
  })

  describe('Removing liquidity', () => {
    const [amountETHExpected, amountNEWExpected] = [unit(1), unit(1).mul(RATIO)]

    it('Correctly set the balances and reserves after removing all wallet liquidity', async () => {
      await token.connect(alice).approve(router.address, amountNEWExpected)
      await router.connect(alice).addLiquidity(amountNEWExpected, alice.address, { value: amountETHExpected })

      const aliceETHBalanceBefore = await ethers.provider.getBalance(alice.address)
      const aliceNEWBalanceBefore = await token.balanceOf(alice.address)
      const poolETHBalanceBefore = await ethers.provider.getBalance(pool.address)
      const poolNEWBalanceBefore = await token.balanceOf(pool.address)
      const [reserveETHBefore, reserveNEWBefore] = await pool.getReserves()
      const liquidity = await pool.balanceOf(alice.address)
      const txReceiptUnresolvedAllowance = await pool.connect(alice).approve(router.address, liquidity)
      const txReceiptUnresolved = await router.connect(alice).removeLiquidity(liquidity, alice.address)

      const txReceiptAllowance = await txReceiptUnresolvedAllowance.wait()
      const txReceipt = await txReceiptUnresolved.wait()
      const txETHDeducted = calculateReceiptETHPaid(txReceipt).add(calculateReceiptETHPaid(txReceiptAllowance))
      const { amountETH, amountNEW, amountNEWTotal } = getEventsAmounts(token, pool, txReceipt, 'Burned')

      expect(await ethers.provider.getBalance(alice.address)).to.eq(aliceETHBalanceBefore.add(amountETH).sub(txETHDeducted))
      expect(await token.balanceOf(alice.address)).to.eq(aliceNEWBalanceBefore.add(amountNEW))
      expect(await pool.connect(alice).allowance(router.address, router.address)).to.eq(unit(0))
      expect(await ethers.provider.getBalance(pool.address)).to.eq(poolETHBalanceBefore.sub(amountETH))
      expect(await token.balanceOf(pool.address)).to.eq(poolNEWBalanceBefore.sub(amountNEWTotal))
      const [reserveETH, reserveNEW] = await pool.getReserves()
      expect(reserveETH).to.eq(reserveETHBefore.sub(amountETH))
      expect(reserveNEW).to.eq(reserveNEWBefore.sub(amountNEWTotal))
    })

    it('Correctly handles "to" param', async () => {
      await token.connect(alice).approve(router.address, amountNEWExpected)
      await router.connect(alice).addLiquidity(amountNEWExpected, alice.address, { value: amountETHExpected })

      const bobETHBalanceBefore = await ethers.provider.getBalance(bob.address)
      const bobNEWBalanceBefore = await token.balanceOf(bob.address)
      const liquidity = await pool.balanceOf(alice.address)
      await pool.connect(alice).approve(router.address, liquidity)
      const txReceiptUnresolved = await router.connect(alice).removeLiquidity(liquidity, bob.address)

      const txReceipt = await txReceiptUnresolved.wait()
      const { amountETH, amountNEW } = getEventsAmounts(token, pool, txReceipt, 'Burned')

      expect(await ethers.provider.getBalance(bob.address)).to.eq(bobETHBalanceBefore.add(amountETH))
      expect(await token.balanceOf(bob.address)).to.eq(bobNEWBalanceBefore.add(amountNEW))
    })

    it('Emits "Burned" event after removing liquidity', async () => {
      await token.connect(alice).approve(router.address, amountNEWExpected)
      await router.connect(alice).addLiquidity(amountNEWExpected, alice.address, { value: amountETHExpected })
      const liquidity = await pool.balanceOf(alice.address)
      await pool.connect(alice).approve(router.address, liquidity)
      const txReceiptUnresolved = await router.connect(alice).removeLiquidity(liquidity, alice.address)
      const txReceipt = await txReceiptUnresolved.wait()
      const [burnedEvent] = getEvents(pool, txReceipt, 'Burned')
      const { amountETH, amountNEW } = burnedEvent as EventWithBigNumbers
      await expect(txReceiptUnresolved).to.emit(pool, 'Burned')
        .withArgs(router.address, alice.address, amountETH, amountNEW)
    })

    it('Prevents from burning zero liquidity', async () => {
      await token.connect(alice).approve(router.address, amountNEWExpected)
      await router.connect(alice).addLiquidity(amountNEWExpected, alice.address, { value: amountETHExpected })

      await expect(router.connect(alice).removeLiquidity(unit(0), alice.address))
        .to.be.revertedWith('need to burn more liquidity')
    })

    it(`Fuzzing [${FUZZ_ITERATIONS}] with ${FUZZ_RANDOM}`, async () => {
      await token.connect(alice).approve(router.address, unit(FUZZ_ITERATIONS).mul(RATIO))
      await router.connect(alice).addLiquidity(unit(FUZZ_ITERATIONS).mul(RATIO), alice.address, { value: unit(FUZZ_ITERATIONS) })

      for (let i = 0; i < FUZZ_ITERATIONS; i++) {
        await processRemoveLiquidity()
      }
    })
  })

  describe('Swapping', () => {
    const [amountETHExpected, amountNEWExpected] = [unit(10), unit(10).mul(RATIO)]

    beforeEach(async () => {
      await token.connect(alice).approve(router.address, amountNEWExpected)
      await router.connect(alice).addLiquidity(amountNEWExpected, alice.address, { value: amountETHExpected })
    })

    it('Correctly gets ETH amount out', async () => {
      const [reserveETH, reserveNEW] = await pool.getReserves()
      await router.getAmountOut(unit(1).mul(RATIO), reserveNEW, reserveETH)
    })

    it('Correctly gets NEW amount out', async () => {
      const [reserveETH, reserveNEW] = await pool.getReserves()
      await router.getAmountOut(unit(1), reserveETH, reserveNEW)
    })

    it('Correctly swaps ETH for NEW', async () => {
      const ethAmount = unit(1)
      const bobETHBalanceBefore = await ethers.provider.getBalance(bob.address)
      const bobNEWBalanceBefore = await token.balanceOf(bob.address)
      const poolETHBalanceBefore = await ethers.provider.getBalance(pool.address)
      const poolNEWBalanceBefore = await token.balanceOf(pool.address)
      const txReceiptUnresolved = await router.connect(bob).swap(unit(0), unit(0), bob.address, { value: ethAmount })

      const txReceipt = await txReceiptUnresolved.wait()
      const txETHDeducted = calculateReceiptETHPaid(txReceipt)
      const { amountNEW, amountNEWTotal, secondEvent } = getEventsAmounts(token, pool, txReceipt, 'Swapped')
      const { amountETHIn, amountNEWIn, amountETHOut, amountNEWOut } = secondEvent
      expect(amountETHIn).to.eq(ethAmount)
      expect(amountNEWIn).to.eq(unit(0))
      expect(amountETHOut).to.eq(unit(0))
      expect(amountNEWOut).to.eq(amountNEWTotal)

      expect(await ethers.provider.getBalance(bob.address)).to.eq(bobETHBalanceBefore.add(amountETHOut).sub(amountETHIn).sub(txETHDeducted))
      expect(await token.balanceOf(bob.address)).to.eq(bobNEWBalanceBefore.add(amountNEW))
      expect(await ethers.provider.getBalance(pool.address)).to.eq(poolETHBalanceBefore.add(ethAmount))
      expect(await token.balanceOf(pool.address)).to.eq(poolNEWBalanceBefore.sub(amountNEWOut))
    })

    it('Correctly swaps NEW for ETH', async () => {
      const newAmount = unit(1).mul(RATIO)
      const bobETHBalanceBefore = await ethers.provider.getBalance(bob.address)
      const bobNEWBalanceBefore = await token.balanceOf(bob.address)
      const poolETHBalanceBefore = await ethers.provider.getBalance(pool.address)
      const poolNEWBalanceBefore = await token.balanceOf(pool.address)
      const txReceiptUnresolvedBobTransfer = await token.connect(treasury).transfer(bob.address, newAmount.mul(2)) // send extra in case of tax on
      const txReceiptBobTransfer = await txReceiptUnresolvedBobTransfer.wait()
      const { amountNEW: amountNEWExtra } = getEventsAmounts(token, pool, txReceiptBobTransfer)

      const txReceiptUnresolvedApproval = await token.connect(bob).approve(router.address, newAmount)
      const txReceiptUnresolved = await router.connect(bob).swap(newAmount, unit(0), bob.address)

      const txReceiptApproval = await txReceiptUnresolvedApproval.wait()
      const txReceipt = await txReceiptUnresolved.wait()
      const txETHDeducted = calculateReceiptETHPaid(txReceipt).add(calculateReceiptETHPaid(txReceiptApproval))
      const { amountNEW, amountNEWTotal, secondEvent } = getEventsAmounts(token, pool, txReceipt, 'Swapped')
      const { amountETHIn, amountNEWIn, amountETHOut, amountNEWOut } = secondEvent
      expect(amountETHIn).to.eq(unit(0))
      expect(amountNEWIn).to.eq(amountNEW)
      expect(amountETHOut).to.eq(amountETHOut)
      expect(amountNEWOut).to.eq(unit(0))

      expect(await ethers.provider.getBalance(bob.address)).to.eq(bobETHBalanceBefore.add(amountETHOut).sub(amountETHIn).sub(txETHDeducted))
      expect(await token.balanceOf(bob.address)).to.eq(bobNEWBalanceBefore.add(amountNEWExtra).sub(amountNEWTotal))
      expect(await ethers.provider.getBalance(pool.address)).to.eq(poolETHBalanceBefore.sub(amountETHOut))
      expect(await token.balanceOf(pool.address)).to.eq(poolNEWBalanceBefore.add(amountNEW))
    })

    it('Correctly handles "to" param', async () => {
      const aliceNEWBalanceBefore = await token.balanceOf(alice.address)
      const bobNEWBalanceBefore = await token.balanceOf(bob.address)
      const txReceiptUnresolved = await router.connect(alice).swap(unit(0), unit(0), bob.address, { value: unit(1) })
      const txReceipt = await txReceiptUnresolved.wait()
      const { amountNEW } = getEventsAmounts(token, pool, txReceipt, 'Swapped')
      expect(await token.balanceOf(bob.address)).to.eq(bobNEWBalanceBefore.add(amountNEW))
      expect(await token.balanceOf(alice.address)).to.eq(aliceNEWBalanceBefore)
    })

    it('Correctly calculates 1% fee', async () => {
      const [reserveETH, reserveNEW] = await pool.getReserves()
      const amountInWithFee = unit(1).mul(99)
      const numerator = amountInWithFee.mul(reserveNEW)
      const denominator = reserveETH.mul(100).add(amountInWithFee)
      const calculatedAmountOut = numerator.div(denominator)
      const amountOut = await router.getAmountOut(unit(1), reserveETH, reserveNEW)
      expect(amountOut).to.eq(calculatedAmountOut)
    })

    it('Emits "Swapped" event after removing liquidity', async () => {
      const txReceiptUnresolved = await router.connect(bob).swap(unit(0), unit(0), bob.address, { value: unit(1) })
      const txReceipt = await txReceiptUnresolved.wait()
      const [swappedEvent] = getEvents(pool, txReceipt, 'Swapped')
      const { amountETHIn, amountNEWIn, amountETHOut, amountNEWOut } = swappedEvent as EventWithBigNumbers
      await expect(txReceiptUnresolved).to.emit(pool, 'Swapped')
        .withArgs(router.address, bob.address, amountETHIn, amountNEWIn, amountETHOut, amountNEWOut)
    })

    it('Prevents from swapping zero amounts', async () => {
      await expect(router.connect(bob).swap(unit(0), unit(0), bob.address, { value: unit(0) }))
        .to.be.revertedWith('insufficient input amount')
    })

    it('Prevents from swapping ETH to NEW because of amount output min', async () => {
      const amountETHIn = unit(1)
      const [reserveETH, reserveNEW] = await pool.getReserves()
      const amountNEWOut = await router.getAmountOut(amountETHIn, reserveETH, reserveNEW)
      await expect(router.connect(bob).swap(unit(0), amountNEWOut.add(1), bob.address, { value: amountETHIn }))
        .to.be.revertedWith('NEW min amount')
    })

    it('Prevents from swapping NEW to ETH because of amount output min', async () => {
      const amountNEWIn = unit(1).mul(RATIO)
      const [reserveETH, reserveNEW] = await pool.getReserves()
      const amountETHOut = await router.getAmountOut(unit(1).mul(RATIO), reserveNEW, reserveETH)
      await token.connect(treasury).transfer(bob.address, amountNEWIn.mul(2)) // send extra in case of tax on
      await token.connect(bob).approve(router.address, amountNEWIn)
      await expect(router.connect(bob).swap(amountNEWIn, amountETHOut.add(1), bob.address))
        .to.be.revertedWith('ETH min amount')
    })

    it(`Fuzzing [${FUZZ_ITERATIONS}] with ${FUZZ_RANDOM}`, async () => {
      await token.connect(alice).approve(router.address, unit(FUZZ_ITERATIONS).mul(RATIO))
      await router.connect(alice).addLiquidity(unit(FUZZ_ITERATIONS).mul(RATIO), alice.address, { value: unit(FUZZ_ITERATIONS) })
      await token.connect(treasury).transfer(bob.address, unit(FUZZ_ITERATIONS).mul(RATIO).mul(10))

      for (let i = 0; i < FUZZ_ITERATIONS; i++) {
        await processSwap()
      }
    })
  })

  describe('Random add/remove/swap operations', () => {
    it(`Fuzzing [${FUZZ_ITERATIONS_RANDOM_USE_CASES}] with ${FUZZ_RANDOM}`, async () => {
      await token.connect(alice).approve(router.address, unit(FUZZ_ITERATIONS).mul(RATIO))
      await router.connect(alice).addLiquidity(unit(FUZZ_ITERATIONS).mul(RATIO), alice.address, { value: unit(FUZZ_ITERATIONS) })

      await token.connect(alice).approve(router.address, unit(FUZZ_ITERATIONS).mul(RATIO))
      await router.connect(alice).addLiquidity(unit(FUZZ_ITERATIONS).mul(RATIO), alice.address, { value: unit(FUZZ_ITERATIONS) })
      await token.connect(treasury).transfer(bob.address, unit(FUZZ_ITERATIONS).mul(RATIO).mul(10))

      let random = (FUZZ_RANDOM * 721) % 1
      for (let i = 0; i < FUZZ_ITERATIONS_RANDOM_USE_CASES; i++) {
        random = (random * 721) % 1
        const isAdd = random < 0.333
        const isRemove = random >= 0.333 && random < 0.666
        if (isAdd) {
          await processAddLiquidity()
        } else if (isRemove) {
          await processRemoveLiquidity()
        } else {
          await processSwap()
        }
      }
    })
  })
})
