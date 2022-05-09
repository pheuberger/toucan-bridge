// We import Chai to use its asserting functions here.
const { expect } = require("chai");
const { ethers } = require("hardhat");

// import { solidity } from "ethereum-waffle";
// chai.use(solidity);

describe("Token contract", function () {
	let bridge;
	let owner;
	let addr1;
	let addr2;
	let nctFake = "0x1a6583dE167Cee533B5dbAe194D2e5858aaE7C01";
	let tco2Fake = "0x1a6583dE167Cee533B5dbAe194D2e5858aaE7C01";
	let recipient = "regen1xrjg7dpdlfds8vhyj22hg5zhg9g7dwmlaxqsys";

	beforeEach(async function () {
		// Get the ContractFactory and Signers here.
		let Bridge = await ethers.getContractFactory("ToucanBridge");
		[owner, addr1, addr2] = await ethers.getSigners();

		bridge = await Bridge.deploy(owner.address, nctFake);
		await bridge.deployed();
	});

	it("Should set the right owner and initial parameters", async function () {
		expect(await bridge.owner()).to.equal(owner.address);
		expect(await bridge.totalTransferred()).to.equal(0);
	});

	it("should pasue and unpause", async function () {
		await bridge.connect(owner).pause();
		expect(await bridge.paused()).equal(true);

		await bridge.connect(owner).unpause();
		expect(await bridge.paused()).equal(false);

		await expect(bridge.connect(addr1).pause()).to.be.revertedWith("not an owner");
		expect(await bridge.paused()).equal(false);
	});

	describe("Bridge", function () {
		it("should fail with non positive amount", async function () {
			await expect(bridge.connect(addr1).bridge(recipient, tco2Fake, 0, "note")).to.be.revertedWith(
				"amount must be positive"
			);
		});

		it("should fail with non regen recipient address", async function () {
			await expect(
				bridge.connect(addr1).bridge("cosmos1xrjg7dpdlfds8vhyj22hg5zhg9g7dwmlaxqsys", tco2Fake, 10, "note")
			).to.be.revertedWith("regen address must start with 'regen1'");

			await expect(bridge.connect(addr1).bridge("regen1xrj", tco2Fake, 10, "note")).to.be.revertedWith(
				"regen address is at least 44 characters long"
			);
		});

		it("should fail when contract is paused", async function () {
			await bridge.connect(owner).pause();

			await expect(bridge.connect(addr1).bridge(recipient, tco2Fake, 10, "note")).to.be.revertedWith(
				"Pausable: paused"
			);
		});
	});
});
