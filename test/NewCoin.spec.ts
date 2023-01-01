import { expect } from 'chai'
import { ethers } from 'hardhat'
import type { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

import type { NewCoin } from '../typechain-types'
import { unit } from './utils'

describe('NewCoin', async () => {
  let deployer: SignerWithAddress
  let treasury: SignerWithAddress
  let alice: SignerWithAddress
  let bob: SignerWithAddress

  let token: NewCoin

  before(async () => ([deployer, treasury, alice, bob] = await ethers.getSigners()))

  beforeEach(async () => {
    const NewCoinFactory = await ethers.getContractFactory('NewCoin')
    token = await NewCoinFactory.deploy()
    await token.deployed()

    await token.initialize(treasury.address, deployer.address, [deployer.address])
  })

  describe('Tokenomics', () => {
    it('Is named "NewCoin"', async () => {
      expect(await token.name()).to.eq('NewCoin')
    })

    it('Has symbol "NEW"', async () => {
      expect(await token.symbol()).to.eq('NEW')
    })

    it('Has correct owner address assigned', async () => {
      expect(await token.owner()).to.eq(deployer.address)
    })

    it('Has correct treasury address assigned', async () => {
      expect(await token.treasury()).to.eq(treasury.address)
    })

    it('Has total supply of 500k tokens', async () => {
      expect(await token.totalSupply()).to.eq(unit(500_000))
    })

    it('Minted 150k NEW to the receiver', async () => {
      expect(await token.balanceOf(deployer.address)).to.eq(unit(150_000))
    })

    it('Minted 350k NEW to the treasury', async () => {
      expect(await token.balanceOf(treasury.address)).to.eq(unit(350_000))
    })
  })

  describe('Tax logic', () => {
    it('Should be disabled by default', async () => {
      expect(await token.taxEnabled()).to.be.false
    })

    it('Allows the owner to enable/disable 5% tax', async () => {
      expect(await token.TAX_PERCENTAGE()).to.eq(5)
      await token.enableTax(true)
      expect(await token.taxEnabled()).to.be.true
      await token.enableTax(false)
      expect(await token.taxEnabled()).to.be.false
    })

    it('Prevents owners from overwriting tax flag with the same value', async () => {
      await expect(token.connect(deployer).enableTax(false)).to.be.revertedWith('tax unchanged')
    })

    it('Prevents non-owners from changing tax flag', async () => {
      await expect(token.connect(alice).enableTax(true)).to.be.revertedWith('caller not the owner')
    })

    it('Emits "TaxEnabled" after changing tax flag', async () => {
      await expect(await token.enableTax(true))
        .to.emit(token, 'TaxEnabled')
        .withArgs(true)
      await expect(await token.enableTax(false))
        .to.emit(token, 'TaxEnabled')
        .withArgs(false)
    })

    it('Taxes transfers with 5% when tax is enabled', async () => {
      await token.transfer(alice.address, unit(100)) // transfer()
      expect(await token.balanceOf(alice.address)).to.eq(unit(100))

      await token.enableTax(true)

      const treasuryBalance = await token.balanceOf(treasury.address)
      await token.increaseAllowance(deployer.address, unit(100))
      await token.transferFrom(deployer.address, bob.address, unit(100)) // transferFrom()
      expect(await token.balanceOf(bob.address)).to.eq(unit(95))
      expect(await token.balanceOf(treasury.address)).to.eq(treasuryBalance.add(unit(5)))
    })
  })

  describe('Transferring logic', () => {
    it('Allows non-allowed addresses to transfer when it is allowed', async () => {
      await token.transfer(alice.address, unit(100))
      expect(await token.balanceOf(alice.address)).to.eq(unit(100))

      await token.enableTransfers()

      await expect(await token.connect(alice).transfer(bob.address, unit(50)))
        .to.emit(token, 'Transfer')
        .withArgs(alice.address, bob.address, unit(50))
      expect(await token.balanceOf(bob.address)).to.eq(unit(50))
    })

    it('Prevents non-allowed addresses to transfer when that is not allowed', async () => {
      await token.transfer(alice.address, unit(100)) // transfer()
      expect(await token.balanceOf(alice.address)).to.eq(unit(100))

      await expect(token.connect(alice).transfer(bob.address, unit(50))).to.be.revertedWith('not allowed')
    })

    it('Prevents from transfering the tokens to the token contract', async () => {
      await expect(token.transfer(token.address, unit(50))).to.be.revertedWith('contract transfer not allowed')
    })
  })
})
