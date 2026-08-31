import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import hardhatEthersChaiMatchers from "@nomicfoundation/hardhat-ethers-chai-matchers";
import hardhatMocha from "@nomicfoundation/hardhat-mocha";
import { defineConfig } from "hardhat/config";

export default defineConfig({
  plugins: [hardhatEthers, hardhatMocha, hardhatEthersChaiMatchers],
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    artifacts: "./.hardhat/artifacts",
    cache: "./.hardhat/cache",
  },
  networks: {
    bscTestnet: {
      type: "http",
      chainId: 97,
      url: "https://data-seed-prebsc-1-s1.bnbchain.org:8545",
      accounts: process.env.BSC_TESTNET_DEPLOYER_PRIVATE_KEY
        ? [process.env.BSC_TESTNET_DEPLOYER_PRIVATE_KEY]
        : [],
    },
  },
});
