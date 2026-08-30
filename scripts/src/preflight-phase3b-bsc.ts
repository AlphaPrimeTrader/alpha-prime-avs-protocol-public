import "@nomicfoundation/hardhat-ethers";
import { network } from "hardhat";

import { MINIMUM_BALANCE_WEI, preflight } from "./phase3b-bsc-common.js";

const { ethers } = await network.create();
const result = await preflight(ethers);

console.log("PHASE_3B_BSC_TESTNET_PREFLIGHT=PASS");
console.log(`CHAIN_ID=${result.chainId}`);
console.log(`DEPLOYER=${result.deployer}`);
console.log(`ENTRYPOINT_RUNTIME_HASH=${result.entryPointRuntimeHash}`);
console.log(`MINIMUM_BALANCE_WEI=${MINIMUM_BALANCE_WEI}`);
console.log(`BALANCE_WEI=${result.balance}`);