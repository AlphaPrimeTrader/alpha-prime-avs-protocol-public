import "@nomicfoundation/hardhat-ethers";
import { network } from "hardhat";

import { MINIMUM_BALANCE_WEI, preflight } from "./phase3b-bsc-common.js";

const { ethers } = await network.create();
const result = await preflight(ethers);

console.log("PHASE_4B_BSC_TESTNET_PREFLIGHT=PASS");
console.log("NETWORK=BSC_TESTNET");
console.log(`CHAIN_ID=${result.chainId}`);
console.log(`DEPLOYER=${result.deployer}`);
console.log(`INITIAL_OWNER=${result.deployer}`);
console.log(`DEPLOYER_BNB_BALANCE_WEI=${result.balance}`);
console.log(`DEPLOYER_BNB_BALANCE=${ethers.formatEther(result.balance)} BNB`);
console.log(`MINIMUM_BALANCE_WEI=${MINIMUM_BALANCE_WEI}`);
console.log("CONSTRUCTOR_INITIAL_OWNER_EXPLICIT=true");
