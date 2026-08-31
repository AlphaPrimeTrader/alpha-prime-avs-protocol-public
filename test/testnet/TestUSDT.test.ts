import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

describe("TestUSDT", function () {
  it("uses the explicit owner and starts as a zero-supply 18-decimal token", async function () {
    const [owner] = await ethers.getSigners();
    const token = await ethers.deployContract("TestUSDT", [
      await owner.getAddress(),
    ]);

    expect(await token.name()).to.equal("Test USDT");
    expect(await token.symbol()).to.equal("USDT");
    expect(await token.decimals()).to.equal(18);
    expect(await token.totalSupply()).to.equal(0n);
    expect(await token.owner()).to.equal(await owner.getAddress());
  });

  it("allows only the explicit owner to mint test balances", async function () {
    const [owner, outsider, recipient] = await ethers.getSigners();
    const token = await ethers.deployContract("TestUSDT", [
      await owner.getAddress(),
    ]);
    const amount = 250n * 10n ** 18n;

    await expect(
      token.connect(outsider).mint(await recipient.getAddress(), amount),
    )
      .to.be.revertedWithCustomError(token, "Unauthorized")
      .withArgs(await outsider.getAddress());
    await expect(token.mint(await recipient.getAddress(), amount))
      .to.emit(token, "Transfer")
      .withArgs(ethers.ZeroAddress, await recipient.getAddress(), amount);
    expect(await token.balanceOf(await recipient.getAddress())).to.equal(
      amount,
    );
    expect(await token.totalSupply()).to.equal(amount);
  });

  it("preserves plain ERC20 transfer and allowance amounts without fees", async function () {
    const [owner, sender, recipient, spender] = await ethers.getSigners();
    const token = await ethers.deployContract("TestUSDT", [
      await owner.getAddress(),
    ]);
    const minted = 1_000n * 10n ** 18n;
    const transferAmount = 125n * 10n ** 18n;
    const delegatedAmount = 75n * 10n ** 18n;

    await token.mint(await sender.getAddress(), minted);
    await expect(
      token
        .connect(sender)
        .transfer(await recipient.getAddress(), transferAmount),
    )
      .to.emit(token, "Transfer")
      .withArgs(
        await sender.getAddress(),
        await recipient.getAddress(),
        transferAmount,
      );
    expect(await token.balanceOf(await recipient.getAddress())).to.equal(
      transferAmount,
    );

    await token
      .connect(sender)
      .approve(await spender.getAddress(), delegatedAmount);
    expect(
      await token.allowance(
        await sender.getAddress(),
        await spender.getAddress(),
      ),
    ).to.equal(delegatedAmount);
    await expect(
      token
        .connect(spender)
        .transferFrom(
          await sender.getAddress(),
          await recipient.getAddress(),
          delegatedAmount,
        ),
    )
      .to.emit(token, "Transfer")
      .withArgs(
        await sender.getAddress(),
        await recipient.getAddress(),
        delegatedAmount,
      );
    expect(await token.balanceOf(await recipient.getAddress())).to.equal(
      transferAmount + delegatedAmount,
    );
    expect(await token.balanceOf(await sender.getAddress())).to.equal(
      minted - transferAmount - delegatedAmount,
    );
    expect(
      await token.allowance(
        await sender.getAddress(),
        await spender.getAddress(),
      ),
    ).to.equal(0n);
  });

  it("rejects zero owners and zero mint recipients", async function () {
    await expect(
      ethers.deployContract("TestUSDT", [ethers.ZeroAddress]),
    ).to.be.revertedWithCustomError(
      await ethers.getContractFactory("TestUSDT"),
      "InvalidOwner",
    );

    const [owner] = await ethers.getSigners();
    const token = await ethers.deployContract("TestUSDT", [
      await owner.getAddress(),
    ]);
    await expect(
      token.mint(ethers.ZeroAddress, 1n),
    ).to.be.revertedWithCustomError(token, "InvalidRecipient");
  });
});
