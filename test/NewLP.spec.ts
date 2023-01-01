import { expect } from 'chai'
import { ethers } from 'hardhat'
import type { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

import type { NewCoin, NewLP } from '../typechain-types'
import { unit } from './utils'

describe('NewRouter', async () => {
  let deployer: SignerWithAddress
  let treasury: SignerWithAddress
  let alice: SignerWithAddress

  let pool: NewLP
  let token: NewCoin

  before(async () => ([deployer, treasury, alice] = await ethers.getSigners()))

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
  })

  describe('Checks', () => {
    it('Has NewCoin assigned', async () => {
      expect(await pool.token()).to.eq(token.address)
    })
  })
})
