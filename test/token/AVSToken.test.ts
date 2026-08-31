import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

const SCALE = 10n ** 18n;
const MAX_SUPPLY = 20_000_000n * SCALE;

async function deployToken() {
  const [deployer, owner, outsider, accountA, accountB] =
    await ethers.getSigners();
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

  return {
    token,
    policy,
    vault,
    deployer,
    owner,
    outsider,
    accountA,
    accountB,
  };
}

async function configure(
  token: Awaited<ReturnType<typeof ethers.deployContract>>,
  owner: Awaited<ReturnType<typeof ethers.getSigners>>[number],
  policy: Awaited<ReturnType<typeof ethers.deployContract>>,
  vault: Awaited<ReturnType<typeof ethers.deployContract>>,
) {
  await token.connect(owner).setAccountPolicy(await policy.getAddress());
  await token.connect(owner).setVault(await vault.getAddress());
}

async function authorize(
  token: Awaited<ReturnType<typeof ethers.deployContract>>,
  policy: Awaited<ReturnType<typeof ethers.deployContract>>,
  account: string,
) {
  await policy.authorize(await token.getAddress(), account);
}

describe("AVSToken", function () {
  describe("metadata and ownership", function () {
    it("starts with the required metadata and zero supply", async function () {
      const { token, owner, deployer } = await deployToken();

      expect(await token.name()).to.equal("AVS");
      expect(await token.symbol()).to.equal("AVS");
      expect(await token.decimals()).to.equal(18);
      expect(await token.MAX_SUPPLY()).to.equal(MAX_SUPPLY);
      expect(await token.totalSupply()).to.equal(0n);
      expect(await token.owner()).to.equal(await owner.getAddress());
      expect(await token.owner()).to.not.equal(await deployer.getAddress());
    });

    it("rejects a zero owner", async function () {
      await expect(
        ethers.deployContract("AVSToken", [ethers.ZeroAddress]),
      ).to.be.revertedWithCustomError(
        await ethers.getContractFactory("AVSToken"),
        "InvalidOwner",
      );
    });
  });

  describe("Account Policy", function () {
    it("allows only Account Policy to authorize non-zero accounts", async function () {
      const { token, owner, outsider, policy, vault, accountA } =
        await deployToken();
      await configure(token, owner, policy, vault);

      await expect(
        token.connect(owner).authorizeAccount(await accountA.getAddress()),
      )
        .to.be.revertedWithCustomError(token, "Unauthorized")
        .withArgs(await owner.getAddress());
      await expect(
        token.connect(outsider).authorizeAccount(await accountA.getAddress()),
      )
        .to.be.revertedWithCustomError(token, "Unauthorized")
        .withArgs(await outsider.getAddress());
      await expect(
        policy.authorize(await token.getAddress(), ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(token, "InvalidAccount");

      await expect(
        policy.authorize(await token.getAddress(), await accountA.getAddress()),
      )
        .to.emit(token, "AccountAuthorized")
        .withArgs(await accountA.getAddress());
      expect(await token.isWhitelisted(await accountA.getAddress())).to.equal(
        true,
      );
      await expect(
        policy.authorize(await token.getAddress(), await accountA.getAddress()),
      )
        .to.be.revertedWithCustomError(token, "AccountAlreadyAuthorized")
        .withArgs(await accountA.getAddress());
    });

    it("has permanent authorization with no removal or enumeration surface", async function () {
      const { token, owner, policy, vault, accountA } = await deployToken();
      await configure(token, owner, policy, vault);
      await authorize(token, policy, await accountA.getAddress());

      expect(await token.isWhitelisted(await accountA.getAddress())).to.equal(
        true,
      );
      expect(
        token.interface.fragments.some(
          (fragment) =>
            fragment.type === "function" &&
            /remove|deauthorize|blacklist|freeze|suspend/i.test(
              fragment.name ?? "",
            ),
        ),
      ).to.equal(false);
      expect(
        token.interface.fragments.some(
          (fragment) =>
            fragment.type === "function" &&
            /whitelist/i.test(fragment.name ?? "") &&
            fragment.name !== "isWhitelisted",
        ),
      ).to.equal(false);
    });
  });

  describe("configuration and locks", function () {
    it("requires deployed contracts and lets the owner change each before locking", async function () {
      const { token, owner, outsider, policy, vault, accountA, accountB } =
        await deployToken();
      const replacementPolicy =
        await ethers.deployContract("AVSTokenPolicyMock");
      const replacementVault = await ethers.deployContract("AVSTokenVaultMock");
      await Promise.all([
        replacementPolicy.waitForDeployment(),
        replacementVault.waitForDeployment(),
      ]);

      await expect(token.connect(outsider).setVault(await vault.getAddress()))
        .to.be.revertedWithCustomError(token, "Unauthorized")
        .withArgs(await outsider.getAddress());
      await expect(
        token.connect(owner).setVault(ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(token, "InvalidContract");
      await expect(
        token.connect(owner).setVault(await owner.getAddress()),
      ).to.be.revertedWithCustomError(token, "InvalidContract");
      await expect(
        token.connect(owner).setAccountPolicy(ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(token, "InvalidContract");
      await expect(
        token.connect(owner).setAccountPolicy(await owner.getAddress()),
      ).to.be.revertedWithCustomError(token, "InvalidContract");

      await expect(
        token.connect(owner).setVault(await vault.getAddress()),
      ).to.emit(token, "VaultUpdated");
      await expect(
        token.connect(owner).setVault(await replacementVault.getAddress()),
      ).to.emit(token, "VaultUpdated");
      await expect(
        token.connect(owner).setAccountPolicy(await policy.getAddress()),
      ).to.emit(token, "AccountPolicyUpdated");
      await expect(
        token
          .connect(owner)
          .setAccountPolicy(await replacementPolicy.getAddress()),
      ).to.emit(token, "AccountPolicyUpdated");

      expect(await token.vault()).to.equal(await replacementVault.getAddress());
      expect(await token.accountPolicy()).to.equal(
        await replacementPolicy.getAddress(),
      );
      expect(await token.isWhitelisted(await accountA.getAddress())).to.equal(
        false,
      );
      expect(await token.isWhitelisted(await accountB.getAddress())).to.equal(
        false,
      );
    });

    it("locks each configuration irreversibly", async function () {
      const { token, owner, policy, vault } = await deployToken();
      await configure(token, owner, policy, vault);

      await expect(token.connect(owner).lockVault()).to.emit(
        token,
        "VaultLocked",
      );
      await expect(
        token.connect(owner).setVault(await vault.getAddress()),
      ).to.be.revertedWithCustomError(token, "ConfigurationLocked");
      await expect(
        token.connect(owner).lockVault(),
      ).to.be.revertedWithCustomError(token, "ConfigurationLocked");

      await expect(token.connect(owner).lockAccountPolicy()).to.emit(
        token,
        "AccountPolicyLocked",
      );
      await expect(
        token.connect(owner).setAccountPolicy(await policy.getAddress()),
      ).to.be.revertedWithCustomError(token, "ConfigurationLocked");
      await expect(
        token.connect(owner).lockAccountPolicy(),
      ).to.be.revertedWithCustomError(token, "ConfigurationLocked");
    });

    it("rejects role collisions in either configuration order", async function () {
      const { token, owner } = await deployToken();
      const combined = await ethers.deployContract(
        "AVSTokenCombinedAuthorityMock",
      );
      await combined.waitForDeployment();

      await token.connect(owner).setVault(await combined.getAddress());
      await expect(
        token.connect(owner).setAccountPolicy(await combined.getAddress()),
      )
        .to.be.revertedWithCustomError(token, "AuthorityCollision")
        .withArgs(await combined.getAddress());

      const secondToken = await ethers.deployContract("AVSToken", [
        await owner.getAddress(),
      ]);
      await secondToken.waitForDeployment();
      await secondToken
        .connect(owner)
        .setAccountPolicy(await combined.getAddress());
      await expect(
        secondToken.connect(owner).setVault(await combined.getAddress()),
      )
        .to.be.revertedWithCustomError(secondToken, "AuthorityCollision")
        .withArgs(await combined.getAddress());
    });

    it("does not allow locking or renouncing before both configurations are ready", async function () {
      const { token, owner, policy, vault } = await deployToken();

      await expect(
        token.connect(owner).lockVault(),
      ).to.be.revertedWithCustomError(token, "ConfigurationNotReady");
      await expect(
        token.connect(owner).lockAccountPolicy(),
      ).to.be.revertedWithCustomError(token, "ConfigurationNotReady");
      await expect(
        token.connect(owner).renounceOwnership(),
      ).to.be.revertedWithCustomError(token, "OwnershipRenunciationNotReady");

      await configure(token, owner, policy, vault);
      await token.connect(owner).lockVault();
      await expect(
        token.connect(owner).renounceOwnership(),
      ).to.be.revertedWithCustomError(token, "OwnershipRenunciationNotReady");
    });
  });

  describe("Vault minting", function () {
    it("allows only Vault to mint positive amounts to whitelisted accounts", async function () {
      const { token, owner, outsider, policy, vault, accountA } =
        await deployToken();
      await configure(token, owner, policy, vault);
      await authorize(token, policy, await accountA.getAddress());

      await expect(
        token.connect(owner).mint(await accountA.getAddress(), SCALE),
      )
        .to.be.revertedWithCustomError(token, "Unauthorized")
        .withArgs(await owner.getAddress());
      await expect(
        token.connect(outsider).mint(await accountA.getAddress(), SCALE),
      )
        .to.be.revertedWithCustomError(token, "Unauthorized")
        .withArgs(await outsider.getAddress());
      await expect(
        vault.mint(
          await token.getAddress(),
          await outsider.getAddress(),
          SCALE,
        ),
      )
        .to.be.revertedWithCustomError(token, "NotWhitelisted")
        .withArgs(await outsider.getAddress());
      await expect(
        vault.mint(await token.getAddress(), await accountA.getAddress(), 0n),
      ).to.be.revertedWithCustomError(token, "InvalidAmount");

      await expect(
        vault.mint(
          await token.getAddress(),
          await accountA.getAddress(),
          SCALE,
        ),
      )
        .to.emit(token, "Transfer")
        .withArgs(ethers.ZeroAddress, await accountA.getAddress(), SCALE);
      expect(await token.balanceOf(await accountA.getAddress())).to.equal(
        SCALE,
      );
      expect(await token.totalSupply()).to.equal(SCALE);
    });

    it("enforces the exact maximum supply", async function () {
      const { token, owner, policy, vault, accountA } = await deployToken();
      await configure(token, owner, policy, vault);
      await authorize(token, policy, await accountA.getAddress());

      await vault.mint(
        await token.getAddress(),
        await accountA.getAddress(),
        MAX_SUPPLY,
      );
      expect(await token.totalSupply()).to.equal(MAX_SUPPLY);
      await expect(
        vault.mint(await token.getAddress(), await accountA.getAddress(), 1n),
      )
        .to.be.revertedWithCustomError(token, "MaxSupplyExceeded")
        .withArgs(1n, 0n);
    });
  });

  describe("restricted ERC-20 operations", function () {
    async function fundedFixture() {
      const fixture = await deployToken();
      const { token, owner, policy, vault, accountA, accountB, outsider } =
        fixture;
      await configure(token, owner, policy, vault);
      await authorize(token, policy, await accountA.getAddress());
      await authorize(token, policy, await accountB.getAddress());
      await vault.mint(
        await token.getAddress(),
        await accountA.getAddress(),
        10n * SCALE,
      );
      return fixture;
    }

    it("allows only whitelisted-to-whitelisted transfers", async function () {
      const { token, accountA, accountB, outsider } = await fundedFixture();

      await expect(
        token.connect(accountA).transfer(await accountB.getAddress(), SCALE),
      )
        .to.emit(token, "Transfer")
        .withArgs(
          await accountA.getAddress(),
          await accountB.getAddress(),
          SCALE,
        );
      await expect(
        token.connect(accountA).transfer(await outsider.getAddress(), SCALE),
      )
        .to.be.revertedWithCustomError(token, "TransferNotAllowed")
        .withArgs(
          await accountA.getAddress(),
          await accountA.getAddress(),
          await outsider.getAddress(),
        );
      await expect(
        token.connect(outsider).transfer(await accountB.getAddress(), SCALE),
      )
        .to.be.revertedWithCustomError(token, "TransferNotAllowed")
        .withArgs(
          await outsider.getAddress(),
          await outsider.getAddress(),
          await accountB.getAddress(),
        );
      await expect(token.connect(accountA).transfer(ethers.ZeroAddress, SCALE))
        .to.be.revertedWithCustomError(token, "ERC20InvalidReceiver")
        .withArgs(ethers.ZeroAddress);
    });

    it("restricts approvals to whitelisted caller and spender", async function () {
      const { token, accountA, accountB, outsider } = await fundedFixture();

      await expect(
        token.connect(accountA).approve(await accountB.getAddress(), SCALE),
      )
        .to.emit(token, "Approval")
        .withArgs(
          await accountA.getAddress(),
          await accountB.getAddress(),
          SCALE,
        );
      await expect(
        token.connect(accountA).approve(await outsider.getAddress(), SCALE),
      )
        .to.be.revertedWithCustomError(token, "ApprovalNotAllowed")
        .withArgs(await accountA.getAddress(), await outsider.getAddress());
      await expect(
        token.connect(outsider).approve(await accountB.getAddress(), SCALE),
      )
        .to.be.revertedWithCustomError(token, "ApprovalNotAllowed")
        .withArgs(await outsider.getAddress(), await accountB.getAddress());
    });

    it("enforces whitelist state for transferFrom at execution time", async function () {
      const { token, policy, accountA, accountB, outsider } =
        await fundedFixture();

      await token
        .connect(accountA)
        .approve(await accountB.getAddress(), 2n * SCALE);
      await expect(
        token
          .connect(accountB)
          .transferFrom(
            await accountA.getAddress(),
            await accountB.getAddress(),
            SCALE,
          ),
      )
        .to.emit(token, "Transfer")
        .withArgs(
          await accountA.getAddress(),
          await accountB.getAddress(),
          SCALE,
        );
      await expect(
        token
          .connect(accountB)
          .transferFrom(
            await accountA.getAddress(),
            await outsider.getAddress(),
            SCALE,
          ),
      )
        .to.be.revertedWithCustomError(token, "TransferNotAllowed")
        .withArgs(
          await accountB.getAddress(),
          await accountA.getAddress(),
          await outsider.getAddress(),
        );
      await expect(
        token
          .connect(outsider)
          .transferFrom(
            await accountA.getAddress(),
            await accountB.getAddress(),
            SCALE,
          ),
      )
        .to.be.revertedWithCustomError(token, "TransferNotAllowed")
        .withArgs(
          await outsider.getAddress(),
          await accountA.getAddress(),
          await accountB.getAddress(),
        );
      await expect(
        token
          .connect(accountB)
          .transferFrom(await accountA.getAddress(), ethers.ZeroAddress, SCALE),
      )
        .to.be.revertedWithCustomError(token, "TransferNotAllowed")
        .withArgs(
          await accountB.getAddress(),
          await accountA.getAddress(),
          ethers.ZeroAddress,
        );
      await expect(
        token
          .connect(accountB)
          .transferFrom(
            await accountA.getAddress(),
            await accountB.getAddress(),
            2n * SCALE,
          ),
      ).to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");

      await authorize(token, policy, await outsider.getAddress());
      await token.connect(accountA).approve(await outsider.getAddress(), SCALE);
      await expect(
        token
          .connect(outsider)
          .transferFrom(
            await accountA.getAddress(),
            await accountB.getAddress(),
            SCALE,
          ),
      )
        .to.emit(token, "Transfer")
        .withArgs(
          await accountA.getAddress(),
          await accountB.getAddress(),
          SCALE,
        );
    });

    it("does not expose burn or admin control paths", async function () {
      const { token, owner, policy, vault } = await deployToken();
      const functionNames = token.interface.fragments
        .filter((fragment) => fragment.type === "function")
        .map((fragment) => fragment.name);

      expect(functionNames.filter((name) => name === "mint")).to.have.length(1);
      expect(functionNames).to.not.include.members([
        "burn",
        "burnFrom",
        "pause",
        "unpause",
        "transferOwnership",
        "upgradeTo",
        "adminMint",
        "ownerMint",
      ]);
      expect(await token.owner()).to.equal(await owner.getAddress());
      expect(await token.vault()).to.equal(ethers.ZeroAddress);
      expect(await token.accountPolicy()).to.equal(ethers.ZeroAddress);
      expect(await policy.getAddress()).to.not.equal(
        await token.accountPolicy(),
      );
      expect(await vault.getAddress()).to.not.equal(await token.vault());
    });
  });

  describe("ownership renunciation", function () {
    it("renounces only after both configured locks and preserves authorities", async function () {
      const { token, owner, policy, vault, accountA, accountB } =
        await deployToken();
      await configure(token, owner, policy, vault);
      await authorize(token, policy, await accountA.getAddress());
      await token.connect(owner).lockVault();
      await token.connect(owner).lockAccountPolicy();

      await expect(token.connect(owner).renounceOwnership())
        .to.emit(token, "OwnershipRenounced")
        .withArgs(await owner.getAddress());
      expect(await token.owner()).to.equal(ethers.ZeroAddress);

      await expect(token.connect(owner).setVault(await vault.getAddress()))
        .to.be.revertedWithCustomError(token, "Unauthorized")
        .withArgs(await owner.getAddress());
      await expect(
        token.connect(owner).renounceOwnership(),
      ).to.be.revertedWithCustomError(token, "Unauthorized");

      await vault.mint(
        await token.getAddress(),
        await accountA.getAddress(),
        SCALE,
      );
      await expect(
        policy.authorize(await token.getAddress(), await accountB.getAddress()),
      )
        .to.emit(token, "AccountAuthorized")
        .withArgs(await accountB.getAddress());
      await expect(
        token.connect(accountA).transfer(await accountB.getAddress(), SCALE),
      ).to.emit(token, "Transfer");
    });
  });
});
