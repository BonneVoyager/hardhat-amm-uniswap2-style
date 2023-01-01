import { ethers } from 'hardhat'

async function main() {
  const [deployer] = await ethers.getSigners()
  const allowed: string[] = [deployer.address]
  const whitelist: string[] = [deployer.address]
  console.info('Deployer address is:', deployer.address)

  // Deploy NEW token first with correct treasury address
  const NewCoin = await ethers.getContractFactory('NewCoin')
  const token = await NewCoin.deploy()
  await token.deployed()
  console.info('NEW deployed to:', token.address)

  // Then deploy the ICO and pass token address to it
  const NewICO = await ethers.getContractFactory('NewICO')
  const ico = await NewICO.deploy(token.address, [...whitelist])
  await ico.deployed()
  console.info('ICO deployed to:', ico.address, whitelist)

  // Initialize the NEW token, optionally enable tax and/or transfers
  //await (await token.enableTax(true)).wait()
  await (await token.enableTransfers()).wait()
  await (await token.initialize(deployer.address, ico.address, [ico.address, ...allowed])).wait()
  console.info('NEW contract initialized with:', ico.address, allowed)

  // Deploy the LP contract
  const NewLP = await ethers.getContractFactory('NewLP')
  const pool = await NewLP.deploy(token.address)
  await pool.deployed()
  console.info('Pool deployed to:', pool.address, token.address)

  // Deploy the Router contract
  const NewRouter = await ethers.getContractFactory('NewRouter')
  const router = await NewRouter.deploy(token.address, pool.address)
  await router.deployed()
  console.info('Router deployed to:', router.address, token.address, pool.address)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
