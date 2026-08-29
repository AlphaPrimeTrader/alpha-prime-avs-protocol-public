import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

const KEY_A = {
  qx: "0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296",
  qy: "0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5",
};

const KEY_B = {
  qx: "0x7cf27b188d034f7e8a52380304b51ac3c08969e277f21b35a60b48fc47669978",
  qy: "0x07775510db8ed040293d9ac69f7430dbba7dade63ce982299e04b79d227873d1",
};

const SALT_A = ethers.id("avs-account-a");
const SALT_B = ethers.id("avs-account-b");

async function deploySystem() {
  const [deployer, outsider] = await ethers.getSigners();
  const implementation = await ethers.deployContract("AVSAccount");
  await implementation.waitForDeployment();

  const factory = await ethers.deployContract("AVSAccountFactory", [
    await implementation.getAddress(),
  ]);
  await factory.waitForDeployment();

  return { deployer, outsider, implementation, factory };
}

async function createAccount(
  factory: Awaited<ReturnType<typeof deploySystem>>["factory"],
  key: typeof KEY_A,
  salt: string,
) {
  const predicted = await factory.predictAccount(key.qx, key.qy, salt);
  await (await factory.createAccount(key.qx, key.qy, salt)).wait();
  return ethers.getContractAt("AVSAccount", predicted);
}

async function impersonate(address: string) {
  await ethers.provider.send("hardhat_setBalance", [
    address,
    "0x56BC75E2D63100000",
  ]);
  await ethers.provider.send("hardhat_impersonateAccount", [address]);
  return ethers.getSigner(address);
}

describe("A) AVS Smart Account creation and Factory", function () {
  it("creates Smart Account A at the predicted deterministic address", async function () {
    const { factory } = await deploySystem();
    const predicted = await factory.predictAccount(KEY_A.qx, KEY_A.qy, SALT_A);
    const account = await createAccount(factory, KEY_A, SALT_A);

    expect(await account.getAddress()).to.equal(predicted);
    expect(await factory.isAVSAccount(predicted)).to.equal(true);
    expect(await account.signer()).to.deep.equal([KEY_A.qx, KEY_A.qy]);
  });

  it("creates Smart Account B for a different Passkey", async function () {
    const { factory } = await deploySystem();
    const account = await createAccount(factory, KEY_B, SALT_B);

    expect(await factory.isAVSAccount(await account.getAddress())).to.equal(true);
    expect(await account.signer()).to.deep.equal([KEY_B.qx, KEY_B.qy]);
  });

  it("gives accounts A and B different addresses", async function () {
    const { factory } = await deploySystem();
    const accountA = await createAccount(factory, KEY_A, SALT_A);
    const accountB = await createAccount(factory, KEY_B, SALT_B);

    expect(await accountA.getAddress()).not.to.equal(await accountB.getAddress());
  });

  it("returns the same account for repeated creation parameters", async function () {
    const { factory } = await deploySystem();
    const accountA = await createAccount(factory, KEY_A, SALT_A);
    const firstAddress = await accountA.getAddress();
    const firstCode = await ethers.provider.getCode(firstAddress);

    expect(
      await factory.createAccount.staticCall(KEY_A.qx, KEY_A.qy, SALT_A),
    ).to.equal(firstAddress);
    await (await factory.createAccount(KEY_A.qx, KEY_A.qy, SALT_A)).wait();

    expect(await ethers.provider.getCode(firstAddress)).to.equal(firstCode);
  });

  it("cannot initialize a clone twice", async function () {
    const { factory } = await deploySystem();
    const account = await createAccount(factory, KEY_A, SALT_A);

    await expect(account.initialize(KEY_B.qx, KEY_B.qy))
      .to.be.revertedWithCustomError(account, "InvalidInitialization");
  });

  it("locks the implementation against initialization", async function () {
    const { implementation } = await deploySystem();

    await expect(implementation.initialize(KEY_A.qx, KEY_A.qy))
      .to.be.revertedWithCustomError(implementation, "InvalidInitialization");
  });

  it("keeps a funded implementation inert even when called as EntryPoint", async function () {
    const { deployer, implementation } = await deploySystem();
    const implementationAddress = await implementation.getAddress();
    const entryPointAddress = await implementation.entryPoint();
    const amount = ethers.parseEther("1");

    await (
      await deployer.sendTransaction({
        to: implementationAddress,
        value: amount,
      })
    ).wait();

    const entryPointSigner = await impersonate(entryPointAddress);
    await expect(
      implementation.connect(entryPointSigner).execute(ethers.ZeroHash, "0x"),
    )
      .to.be.revertedWithCustomError(implementation, "AccountUnauthorized")
      .withArgs(entryPointAddress);

    const userOperation = {
      sender: implementationAddress,
      nonce: 0n,
      initCode: "0x",
      callData: "0x",
      accountGasLimits: ethers.ZeroHash,
      preVerificationGas: 0n,
      gasFees: ethers.ZeroHash,
      paymasterAndData: "0x",
      signature: "0x",
    };

    await (
      await implementation
        .connect(entryPointSigner)
        .validateUserOp(userOperation, ethers.ZeroHash, amount)
    ).wait();

    expect(await ethers.provider.getBalance(implementationAddress)).to.equal(
      amount,
    );
  });
});

describe("B) Authorization and asset custody", function () {
  it("rejects arbitrary execution by an unauthorized EOA", async function () {
    const { factory, outsider } = await deploySystem();
    const account = await createAccount(factory, KEY_A, SALT_A);

    await expect(account.connect(outsider).execute(ethers.ZeroHash, "0x"))
      .to.be.revertedWithCustomError(account, "AccountUnauthorized")
      .withArgs(await outsider.getAddress());
  });

  it("does not let the Factory transfer ERC-20 tokens from Account A", async function () {
    const { factory } = await deploySystem();
    const account = await createAccount(factory, KEY_A, SALT_A);
    const token = await ethers.deployContract("MockERC20");
    await token.waitForDeployment();
    await (await token.mint(await account.getAddress(), 500n)).wait();

    const factorySigner = await impersonate(await factory.getAddress());
    await expect(account.connect(factorySigner).execute(ethers.ZeroHash, "0x"))
      .to.be.revertedWithCustomError(account, "AccountUnauthorized")
      .withArgs(await factory.getAddress());

    expect(await token.balanceOf(await account.getAddress())).to.equal(500n);
  });

  it("does not let Account B control Account A", async function () {
    const { factory } = await deploySystem();
    const accountA = await createAccount(factory, KEY_A, SALT_A);
    const accountB = await createAccount(factory, KEY_B, SALT_B);
    const accountBSigner = await impersonate(await accountB.getAddress());

    await expect(accountA.connect(accountBSigner).execute(ethers.ZeroHash, "0x"))
      .to.be.revertedWithCustomError(accountA, "AccountUnauthorized")
      .withArgs(await accountB.getAddress());
  });

  it("can receive native BNB/ETH in the local EVM", async function () {
    const { deployer, factory } = await deploySystem();
    const account = await createAccount(factory, KEY_A, SALT_A);
    const amount = ethers.parseEther("1");

    await (
      await deployer.sendTransaction({
        to: await account.getAddress(),
        value: amount,
      })
    ).wait();

    expect(await ethers.provider.getBalance(await account.getAddress())).to.equal(
      amount,
    );
  });

  it("can receive an ERC-20 test token", async function () {
    const { factory } = await deploySystem();
    const account = await createAccount(factory, KEY_A, SALT_A);
    const token = await ethers.deployContract("MockERC20");
    await token.waitForDeployment();

    await (await token.mint(await account.getAddress(), 1_000_000n)).wait();

    expect(await token.balanceOf(await account.getAddress())).to.equal(1_000_000n);
  });
});