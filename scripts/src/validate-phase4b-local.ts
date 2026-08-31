import { network } from "hardhat";

const { ethers } = await network.create();
const SCALE = 10n ** 18n;
const MAX_SUPPLY = 20_000_000n * SCALE;

const [deployer, owner, accountA, accountB] = await ethers.getSigners();
const token = await ethers.deployContract("AVSToken", [
  await owner.getAddress(),
]);
const policy = await ethers.deployContract("AVSTokenPolicyMock");
const vault = await ethers.deployContract("AVSTokenVaultMock");
await Promise.all([
  token.waitForDeployment(),
  policy.waitForDeployment(),
  vault.waitForDeployment(),
]);

await token
  .connect(owner)
  .getFunction("setAccountPolicy")
  .send(await policy.getAddress());
await token
  .connect(owner)
  .getFunction("setVault")
  .send(await vault.getAddress());
await token.connect(owner).getFunction("lockAccountPolicy").send();
await token.connect(owner).getFunction("lockVault").send();
await policy
  .getFunction("authorize")
  .send(await token.getAddress(), await accountA.getAddress());
await policy
  .getFunction("authorize")
  .send(await token.getAddress(), await accountB.getAddress());
await vault
  .getFunction("mint")
  .send(await token.getAddress(), await accountA.getAddress(), SCALE);
await token
  .connect(accountA)
  .getFunction("transfer")
  .send(await accountB.getAddress(), SCALE / 2n);

if ((await token.owner()) !== (await owner.getAddress())) {
  throw new Error("Owner changed before explicit renunciation.");
}
if ((await token.totalSupply()) !== SCALE) {
  throw new Error("Local AVS Token supply smoke check failed.");
}
if ((await token.MAX_SUPPLY()) !== MAX_SUPPLY) {
  throw new Error("Local AVS Token cap smoke check failed.");
}
if ((await token.balanceOf(await accountB.getAddress())) !== SCALE / 2n) {
  throw new Error("Local restricted transfer smoke check failed.");
}

console.log("PHASE_4B_LOCAL_VALIDATION=PASS");
console.log(`DEPLOYER=${await deployer.getAddress()}`);
console.log(`INITIAL_OWNER=${await owner.getAddress()}`);
console.log(`AVS_TOKEN=${await token.getAddress()}`);
console.log(`TOTAL_SUPPLY=${await token.totalSupply()}`);
console.log(`MAX_SUPPLY=${await token.MAX_SUPPLY()}`);
