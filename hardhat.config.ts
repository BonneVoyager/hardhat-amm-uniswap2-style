import * as dotenv from 'dotenv'

import '@nomicfoundation/hardhat-toolbox'
import { HardhatUserConfig } from 'hardhat/config'
import 'hardhat-contract-sizer'

dotenv.config()

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

const config: HardhatUserConfig = {
  solidity: '0.8.16',
  networks: {
    hardhat: {
      accounts: {
        count: 50, // setting to 50 so unit tests and fuzzing tests have enough signers
      },
    },
    goerli: {
      url: process.env.GOERLI_URL || '',
      accounts: [process.env.PRIVATE_KEY as string],
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    currency: 'USD',
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
}

export default config
