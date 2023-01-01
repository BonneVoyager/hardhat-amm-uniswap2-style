# Hardhat AMM Uniswap V2 style

This is a Uniswap V2's style AMM project with full test coverage. The goal of this repository is to learn how liquidity pools work on Uniswap V2.

Additionally, the repository has a taxable ERC20 token to demonstrate AMM support for such tokens.

Code in this repository is meant as an exercise and not to be used on mainnet.

# Development

### Install dependencies

```
npm install
```

### Run linting

```
npm run lint
```

### Run tests

```
npm run test
```

### Run coverage

```
npm run coverage
```

## Deployment

Pass environment variables via `.env` file or shell using the below example.

```ini
ETHERSCAN_API_KEY=abc
GOERLI_URL=https://eth-ropsten.alchemyapi.io/v2/<ALCHEMY_KEY>
PRIVATE_KEY=0x123
```
