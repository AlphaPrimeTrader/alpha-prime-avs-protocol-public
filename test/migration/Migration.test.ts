import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

const SCALE = 10n ** 18n;
const OLD_USER = "0x3FE6f0b8777a7BaAF945ea8FEE6a657f3bd632Ba";
const BENEFICIARY = "0x46785c0bcb28c29e0CfBeF23101C98CA8356FC27";
const SECOND_OLD_USER = "0x8a7f9e1b4d5c6a7b8c9d0e1f2a3b4c5d6e7f8091";
const OTHER_BENEFICIARY = "0x6a7b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f7";
const MIGRATION_DOMAIN = ethers.id("AVS_MIGRATION_V1");
const MIGRATION_AMOUNT = 12_000n * SCALE;

async function deployMigrationSystem(useFeeToken = false) {
  const [owner, outsider] = await ethers.getSigners();
  const ownerAddress = await owner.getAddress();

  const usdt = useFeeToken
    ? await ethers.deployContract("FeeOnTransferMock", [100])
    : await ethers.deployContract("TestUSDT", [ownerAddress]);
  const oldLedger = await ethers.deployContract("OldLedgerMock", [
    ownerAddress,
  ]);
  const oldVault = await ethers.deployContract("OldVaultMock", [
    ownerAddress,
    await usdt.getAddress(),
    await oldLedger.getAddress(),
  ]);
  const avsLedger = await ethers.deployContract("AVSLedger", [ownerAddress]);
  const avsToken = await ethers.deployContract("AVSToken", [ownerAddress]);
  const avsVault = await ethers.deployContract("AVSVault", [
    ownerAddress,
    await usdt.getAddress(),
  ]);
  const policy = await ethers.deployContract("AVSTokenPolicyMock");
  const tradeSettlement = await ethers.deployContract("LedgerSourceMock");
  const marketplace = await ethers.deployContract("VaultActorMock");
  const trading = await ethers.deployContract("VaultActorMock");

  await Promise.all([
    usdt.waitForDeployment(),
    oldLedger.waitForDeployment(),
    oldVault.waitForDeployment(),
    avsLedger.waitForDeployment(),
    avsToken.waitForDeployment(),
    avsVault.waitForDeployment(),
    policy.waitForDeployment(),
    tradeSettlement.waitForDeployment(),
    marketplace.waitForDeployment(),
    trading.waitForDeployment(),
  ]);

  const migration = await ethers.deployContract("Migration", [
    ownerAddress,
    await oldLedger.getAddress(),
    await oldVault.getAddress(),
    await usdt.getAddress(),
    await avsVault.getAddress(),
    await avsLedger.getAddress(),
    await avsToken.getAddress(),
  ]);
  await migration.waitForDeployment();

  await oldLedger.setVault(await oldVault.getAddress());
  await oldLedger.setDailyAPYBps(0);
  await oldVault.setExecutor(await migration.getAddress(), true);

  await avsLedger.bindAVSToken(await avsToken.getAddress());
  await avsLedger.configureVault(await avsVault.getAddress());
  await avsLedger.configureTradeSettlement(await tradeSettlement.getAddress());

  await avsVault.setAVSToken(await avsToken.getAddress());
  await avsVault.setAVSLedger(await avsLedger.getAddress());
  await avsVault.setMigration(await migration.getAddress());
  await avsVault.setMarketplace(await marketplace.getAddress());
  await avsVault.setTradingContract(await trading.getAddress());
  await avsVault.setReserveTarget(MIGRATION_AMOUNT);

  await avsToken.setAccountPolicy(await policy.getAddress());
  await avsToken.setVault(await avsVault.getAddress());
  await policy.authorize(await avsToken.getAddress(), BENEFICIARY);

  await oldLedger.seedUser(
    OLD_USER,
    10_000n * SCALE,
    2_000n * SCALE,
    999_000n * SCALE,
    1,
  );
  await usdt.mint(await oldVault.getAddress(), MIGRATION_AMOUNT);

  return {
    owner,
    outsider,
    usdt,
    oldLedger,
    oldVault,
    avsLedger,
    avsToken,
    avsVault,
    migration,
    policy,
    tradeSettlement,
    marketplace,
    trading,
  };
}

function migrationCapitalId(oldUser: string): string {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "address"],
      [MIGRATION_DOMAIN, oldUser],
    ),
  );
}

describe("Migration", function () {
  it("constructs only with explicit deployed dependencies and exposes no owner money-out API", async function () {
    const [owner] = await ethers.getSigners();
    const system = await deployMigrationSystem();
    const factory = await ethers.getContractFactory("Migration");

    await expect(
      ethers.deployContract("Migration", [
        await owner.getAddress(),
        ethers.ZeroAddress,
        await system.oldVault.getAddress(),
        await system.usdt.getAddress(),
        await system.avsVault.getAddress(),
        await system.avsLedger.getAddress(),
        await system.avsToken.getAddress(),
      ]),
    )
      .to.be.revertedWithCustomError(factory, "InvalidContract")
      .withArgs(ethers.ZeroAddress);

    const functionNames = system.migration.interface.fragments
      .filter((fragment) => fragment.type === "function")
      .map((fragment) => fragment.name);
    expect(functionNames).to.not.include.members([
      "withdraw",
      "rescue",
      "sweep",
      "execute",
      "call",
    ]);
    const migrateFragment = system.migration.interface.getFunction("migrate");
    expect(migrateFragment?.inputs.map((input) => input.type)).to.deep.equal([
      "address",
      "address",
    ]);
    expect(await system.migration.owner()).to.equal(await owner.getAddress());
  });

  it("migrates the complete live balance to a whitelisted beneficiary atomically", async function () {
    const {
      owner,
      usdt,
      oldLedger,
      oldVault,
      avsLedger,
      avsToken,
      avsVault,
      migration,
    } = await deployMigrationSystem();
    const capitalId = migrationCapitalId(OLD_USER);

    const userInfo = await oldLedger.getUserInfo(OLD_USER);
    expect(userInfo.depositAmount).to.equal(10_000n * SCALE);
    expect(userInfo.accumulatedProfit).to.equal(2_000n * SCALE);
    expect(userInfo.totalProfitEver).to.equal(999_000n * SCALE);
    expect(userInfo.totalBalance).to.equal(MIGRATION_AMOUNT);
    expect(await migration.capitalId(OLD_USER)).to.equal(capitalId);
    expect(await avsLedger.quoteCapitalInflow(MIGRATION_AMOUNT)).to.equal(
      MIGRATION_AMOUNT,
    );

    await expect(migration.connect(owner).migrate(OLD_USER, BENEFICIARY))
      .to.emit(migration, "UserMigrated")
      .withArgs(
        OLD_USER,
        BENEFICIARY,
        capitalId,
        MIGRATION_AMOUNT,
        MIGRATION_AMOUNT,
      );

    expect(await migration.migrated(OLD_USER)).to.equal(true);
    expect(await usdt.balanceOf(await oldVault.getAddress())).to.equal(0n);
    expect(await usdt.balanceOf(await migration.getAddress())).to.equal(0n);
    expect(await usdt.balanceOf(await avsVault.getAddress())).to.equal(
      MIGRATION_AMOUNT,
    );
    expect(
      await usdt.allowance(
        await migration.getAddress(),
        await avsVault.getAddress(),
      ),
    ).to.equal(0n);
    expect(await avsToken.balanceOf(BENEFICIARY)).to.equal(MIGRATION_AMOUNT);
    expect(await avsToken.totalSupply()).to.equal(MIGRATION_AMOUNT);
    expect(await avsLedger.totalNetAssets()).to.equal(MIGRATION_AMOUNT);
    expect(await avsLedger.processedCapitalInflow(capitalId)).to.equal(true);
    expect((await avsLedger.capitalRecord(capitalId)).beneficiary).to.equal(
      BENEFICIARY,
    );
    expect((await avsLedger.capitalRecord(capitalId)).capitalAmount).to.equal(
      MIGRATION_AMOUNT,
    );
    const remaining = await oldLedger.getUserInfo(OLD_USER);
    expect(remaining.totalBalance).to.equal(0n);
  });

  it("reuses a beneficiary while keeping each old user one-time and capital IDs distinct", async function () {
    const { usdt, oldLedger, migration, avsToken, avsLedger } =
      await deployMigrationSystem();
    const secondAmount = 500n * SCALE;
    await oldLedger.seedUser(SECOND_OLD_USER, secondAmount, 0, 0, 1);
    const oldVaultAddress = await migration.oldVault();
    await usdt.mint(oldVaultAddress, secondAmount);

    await migration.migrate(OLD_USER, BENEFICIARY);
    await migration.migrate(SECOND_OLD_USER, BENEFICIARY);

    await expect(migration.migrate(OLD_USER, BENEFICIARY))
      .to.be.revertedWithCustomError(migration, "AlreadyMigrated")
      .withArgs(OLD_USER);
    expect(await avsToken.balanceOf(BENEFICIARY)).to.equal(
      MIGRATION_AMOUNT + secondAmount,
    );
    expect(
      await avsLedger.processedCapitalInflow(migrationCapitalId(OLD_USER)),
    ).to.equal(true);
    expect(
      await avsLedger.processedCapitalInflow(
        migrationCapitalId(SECOND_OLD_USER),
      ),
    ).to.equal(true);
    expect(migrationCapitalId(OLD_USER)).to.not.equal(
      migrationCapitalId(SECOND_OLD_USER),
    );
  });

  it("requires owner execution, a whitelisted beneficiary, and a nonzero full balance", async function () {
    const { owner, outsider, migration, oldLedger } =
      await deployMigrationSystem();
    await expect(migration.connect(outsider).migrate(OLD_USER, BENEFICIARY))
      .to.be.revertedWithCustomError(migration, "Unauthorized")
      .withArgs(await outsider.getAddress());
    await expect(
      migration.migrate(ethers.ZeroAddress, BENEFICIARY),
    ).to.be.revertedWithCustomError(migration, "InvalidOldUser");
    await expect(migration.migrate(OLD_USER, OTHER_BENEFICIARY))
      .to.be.revertedWithCustomError(migration, "BeneficiaryNotWhitelisted")
      .withArgs(ethers.getAddress(OTHER_BENEFICIARY));

    await oldLedger.seedUser(SECOND_OLD_USER, 0, 0, 100n * SCALE, 1);
    await expect(migration.migrate(SECOND_OLD_USER, BENEFICIARY))
      .to.be.revertedWithCustomError(migration, "NoMigratableBalance")
      .withArgs(ethers.getAddress(SECOND_OLD_USER));
    expect(await owner.getAddress()).to.equal(await migration.owner());
  });

  it("checks remaining AVS supply and capital collisions before touching legacy state", async function () {
    const system = await deployMigrationSystem();
    const { owner, oldLedger, oldVault, avsToken, avsVault, avsLedger, usdt } =
      system;
    const collisionLedger = await ethers.deployContract(
      "MigrationLedgerReaderMock",
      [MIGRATION_AMOUNT, true],
    );
    await collisionLedger.waitForDeployment();
    const collisionMigration = await ethers.deployContract("Migration", [
      await owner.getAddress(),
      await oldLedger.getAddress(),
      await oldVault.getAddress(),
      await usdt.getAddress(),
      await avsVault.getAddress(),
      await collisionLedger.getAddress(),
      await avsToken.getAddress(),
    ]);
    await collisionMigration.waitForDeployment();
    await expect(
      collisionMigration.migrate(OLD_USER, BENEFICIARY),
    ).to.be.revertedWithCustomError(
      collisionMigration,
      "CapitalAlreadyProcessed",
    );

    const sink = await ethers.getSigners().then((signers) => signers[2]);
    const sinkAddress = await sink.getAddress();
    const tokenMintActor = await ethers.deployContract("AVSTokenVaultMock");
    await tokenMintActor.waitForDeployment();
    await system.policy.authorize(await avsToken.getAddress(), sinkAddress);
    await avsToken.setVault(await tokenMintActor.getAddress());
    const maxSupply = await avsToken.MAX_SUPPLY();
    await tokenMintActor.mint(
      await avsToken.getAddress(),
      sinkAddress,
      maxSupply - 100n,
    );
    await avsToken.setVault(await avsVault.getAddress());

    const supplyReader = await ethers.deployContract(
      "MigrationLedgerReaderMock",
      [MIGRATION_AMOUNT, false],
    );
    await supplyReader.waitForDeployment();
    const supplyMigration = await ethers.deployContract("Migration", [
      await owner.getAddress(),
      await oldLedger.getAddress(),
      await oldVault.getAddress(),
      await usdt.getAddress(),
      await avsVault.getAddress(),
      await supplyReader.getAddress(),
      await avsToken.getAddress(),
    ]);
    await supplyMigration.waitForDeployment();

    const oldBalanceBefore = await usdt.balanceOf(await oldVault.getAddress());
    const legacyBefore = await oldLedger.getUserInfo(OLD_USER);
    await expect(supplyMigration.migrate(OLD_USER, BENEFICIARY))
      .to.be.revertedWithCustomError(supplyMigration, "MaxSupplyExceeded")
      .withArgs(MIGRATION_AMOUNT, 100n);
    expect(await usdt.balanceOf(await oldVault.getAddress())).to.equal(
      oldBalanceBefore,
    );
    expect((await oldLedger.getUserInfo(OLD_USER)).totalBalance).to.equal(
      legacyBefore.totalBalance,
    );
  });

  it("rejects fee-on-transfer legacy withdrawals and rolls back the old Ledger debit", async function () {
    const { migration, oldLedger, oldVault, usdt } =
      await deployMigrationSystem(true);
    const oldBalanceBefore = await usdt.balanceOf(await oldVault.getAddress());
    const legacyBefore = await oldLedger.getUserInfo(OLD_USER);

    await expect(migration.migrate(OLD_USER, BENEFICIARY))
      .to.be.revertedWithCustomError(migration, "ExactAmountNotReceived")
      .withArgs(MIGRATION_AMOUNT, 11_880n * SCALE);
    expect(await usdt.balanceOf(await oldVault.getAddress())).to.equal(
      oldBalanceBefore,
    );
    expect((await oldLedger.getUserInfo(OLD_USER)).totalBalance).to.equal(
      legacyBefore.totalBalance,
    );
    expect(await migration.migrated(OLD_USER)).to.equal(false);
  });

  it("rolls back legacy withdrawal when the configured AVS Vault downstream call fails", async function () {
    const system = await deployMigrationSystem();
    const { migration, oldLedger, oldVault, avsVault, usdt } = system;
    const failingLedger = await ethers.deployContract("VaultLedgerMock");
    await failingLedger.waitForDeployment();
    await failingLedger.configureReturn(1n, true);
    await avsVault.setAVSLedger(await failingLedger.getAddress());

    const oldBalanceBefore = await usdt.balanceOf(await oldVault.getAddress());
    const legacyBefore = await oldLedger.getUserInfo(OLD_USER);
    await expect(
      migration.migrate(OLD_USER, BENEFICIARY),
    ).to.be.revertedWithCustomError(failingLedger, "LedgerMockReverted");
    expect(await usdt.balanceOf(await oldVault.getAddress())).to.equal(
      oldBalanceBefore,
    );
    expect((await oldLedger.getUserInfo(OLD_USER)).totalBalance).to.equal(
      legacyBefore.totalBalance,
    );
    expect(await usdt.balanceOf(await migration.getAddress())).to.equal(0n);
    expect(await migration.migrated(OLD_USER)).to.equal(false);
  });

  it("protects the full migration transaction from nested migration calls", async function () {
    const [owner] = await ethers.getSigners();
    const usdt = await ethers.deployContract("TestUSDT", [
      await owner.getAddress(),
    ]);
    const oldLedger = await ethers.deployContract("OldLedgerMock", [
      await owner.getAddress(),
    ]);
    const reentrantVault = await ethers.deployContract(
      "ReentrantOldVaultMock",
      [await usdt.getAddress()],
    );
    const avsLedger = await ethers.deployContract("AVSLedger", [
      await owner.getAddress(),
    ]);
    const avsToken = await ethers.deployContract("AVSToken", [
      await owner.getAddress(),
    ]);
    const avsVault = await ethers.deployContract("AVSVault", [
      await owner.getAddress(),
      await usdt.getAddress(),
    ]);
    const policy = await ethers.deployContract("AVSTokenPolicyMock");
    const tradeSettlement = await ethers.deployContract("LedgerSourceMock");
    const marketplace = await ethers.deployContract("VaultActorMock");
    const trading = await ethers.deployContract("VaultActorMock");
    await Promise.all([
      usdt.waitForDeployment(),
      oldLedger.waitForDeployment(),
      reentrantVault.waitForDeployment(),
      avsLedger.waitForDeployment(),
      avsToken.waitForDeployment(),
      avsVault.waitForDeployment(),
      policy.waitForDeployment(),
      tradeSettlement.waitForDeployment(),
      marketplace.waitForDeployment(),
      trading.waitForDeployment(),
    ]);
    const migration = await ethers.deployContract("Migration", [
      await reentrantVault.getAddress(),
      await oldLedger.getAddress(),
      await reentrantVault.getAddress(),
      await usdt.getAddress(),
      await avsVault.getAddress(),
      await avsLedger.getAddress(),
      await avsToken.getAddress(),
    ]);
    await migration.waitForDeployment();
    await avsLedger.bindAVSToken(await avsToken.getAddress());
    await avsToken.setAccountPolicy(await policy.getAddress());
    await policy.authorize(await avsToken.getAddress(), BENEFICIARY);
    await oldLedger.seedUser(OLD_USER, MIGRATION_AMOUNT, 0, 0, 1);
    await reentrantVault.setReentry(await migration.getAddress(), BENEFICIARY);
    await usdt.mint(await reentrantVault.getAddress(), MIGRATION_AMOUNT);
    await expect(
      reentrantVault.startMigration(OLD_USER, BENEFICIARY),
    ).to.be.revertedWithCustomError(migration, "ReentrancyGuardReentrantCall");
  });

  it("permanently closes and prevents all later migrations", async function () {
    const { owner, outsider, migration } = await deployMigrationSystem();
    await expect(migration.connect(outsider).closeMigration())
      .to.be.revertedWithCustomError(migration, "Unauthorized")
      .withArgs(await outsider.getAddress());
    await expect(migration.connect(owner).closeMigration()).to.emit(
      migration,
      "MigrationClosed",
    );
    expect(await migration.migrationClosed()).to.equal(true);
    await expect(
      migration.connect(owner).migrate(OLD_USER, BENEFICIARY),
    ).to.be.revertedWithCustomError(migration, "MigrationClosedError");
    await expect(
      migration.connect(owner).closeMigration(),
    ).to.be.revertedWithCustomError(migration, "MigrationAlreadyClosed");
  });

  it("calculates and applies live profit before a legacy debit", async function () {
    const { oldLedger, oldVault } = await deployMigrationSystem();
    await oldLedger.setDailyAPYBps(100);
    const latest = (await ethers.provider.getBlock("latest"))!;
    await ethers.provider.send("evm_setNextBlockTimestamp", [
      latest.timestamp + 86_400,
    ]);
    await oldLedger.seedUser(
      SECOND_OLD_USER,
      100n * SCALE,
      0,
      0,
      latest.timestamp,
    );
    const live = await oldLedger.getUserInfo(SECOND_OLD_USER);
    expect(live.accumulatedProfit).to.equal(SCALE);
    expect(live.totalBalance).to.equal(101n * SCALE);

    await expect(
      oldVault.withdraw(SECOND_OLD_USER, await oldVault.getAddress(), SCALE),
    ).to.be.revertedWithCustomError(oldVault, "Unauthorized");
  });
});
