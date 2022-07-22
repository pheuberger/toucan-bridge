const { ethers, upgrades } = require("hardhat");

async function deployProxy(contractName, registry, args = []) {
	const factory = await ethers.getContractFactory(contractName);
	const contract = await upgrades.deployProxy(factory, args, {
		kind: "uups",
	});
	await contract.deployed();
	if (registry) await contract.setToucanContractRegistry(registry.address);
	return contract;
}

async function _getNewTokenId(tx, eventName) {
	const receipt = await tx.wait();
	const mintedEvent = receipt.events.find((e) => e.event === eventName);
	return mintedEvent.args.tokenId.toNumber();
}

async function getBatchId(tx) {
	return _getNewTokenId(tx, "BatchMinted");
}

async function getProjectTokenId(tx) {
	return _getNewTokenId(tx, "ProjectMinted");
}

async function getProjectVintageTokenId(tx) {
	return _getNewTokenId(tx, "ProjectVintageMinted");
}

function yearStartTime(year) {
	return new Date(year, 0, 0).getTime() / 1000;
}

async function prepareToucanEnv(admin, broker) {
	const contracts = await deployFixedContracts();

	// Now, setup a TCO2 that we can use to burn and mint
	const projectId = await deployProject(contracts.projects, admin.address);
	const vintageId = await deployVintage(projectId, admin.address, contracts.vintages);
	const tco2 = await deployAndFractionalizeTco2(contracts, broker, admin, vintageId);

	return { ...contracts, tco2 };
}

async function deployVintage(projectId, adminAddress, cVintages) {
	console.log(`Creating a new vintage for carbon project ${projectId}...`);
	let vTx = await cVintages.addNewVintage(adminAddress, {
		projectTokenId: projectId,
		name: "vintage1Name",
		startTime: yearStartTime("2017"),
		endTime: yearStartTime("2018"),
		totalVintageQuantity: 3000, // tonnes
		isCorsiaCompliant: true,
		isCCPcompliant: true,
		coBenefits: "",
		correspAdjustment: "",
		additionalCertification: "",
		uri: "",
	});
	const vintageId = await getProjectVintageTokenId(vTx);
	console.log(`Created vintage 2017 ${vintageId}`);
	return vintageId;
}

async function deployFixedContracts() {
	// Deploy Toucan contract registry
	console.log("Deploying ToucanContractRegistry...");
	const registry = await deployProxy("ToucanContractRegistry");

	// Deploy CarbonProjects
	console.log("Deploying CarbonProjects...");
	const projects = await deployProxy("CarbonProjects", registry);
	await registry.setCarbonProjectsAddress(projects.address);

	// Deploy CarbonProjectVintages
	console.log("Deploying CarbonProjectVintages...");
	const vintages = await deployProxy("CarbonProjectVintages", registry);
	await registry.setCarbonProjectVintagesAddress(vintages.address);

	// Deploy CarbonOffsetBatches
	console.log("Deploying CarbonOffsetBatches...");
	const batches = await deployProxy("CarbonOffsetBatches", registry, [registry.address]);
	await registry.setCarbonOffsetBatchesAddress(batches.address);

	// Deploy TCO2 factory
	console.log("Deploying ToucanCarbonOffsetsFactory...");
	const tco2Factory = await deployProxy("ToucanCarbonOffsetsFactory", registry, [registry.address]);
	await registry.setToucanCarbonOffsetsFactoryAddress(tco2Factory.address);

	// Deploy TCO2 beacon
	console.log("Deploying ToucanCarbonOffsets beacon...");
	const tco2Impl = await ethers.getContractFactory("ToucanCarbonOffsets");
	const beacon = await upgrades.deployBeacon(tco2Impl);
	await tco2Factory.setBeacon(beacon.address);
	return { registry, projects, vintages, batches, tco2Factory };
}

async function deployProject(cProjects, adminAddress) {
	console.log("Creating a new carbon project...");
	const pTx = await cProjects.addNewProject(
		adminAddress,
		"projectId1",
		"standard1",
		"methodology1",
		"region1",
		"storageMethod1",
		"method1",
		"emissionType1",
		"category1",
		"uri1"
	);
	const projectId = await getProjectTokenId(pTx);
	console.log(`Created carbon project ${projectId}`);
	return projectId;
}

async function deployAndFractionalizeTco2(contracts, broker, admin, vintageId) {
	// Deploy TCO2
	console.log(`Deploying a TCO2 for vintage ${vintageId}...`);
	await contracts.tco2Factory.deployFromVintage(vintageId);
	const tco2Array = await contracts.tco2Factory.getContracts();
	const tco2 = await ethers.getContractAt("ToucanCarbonOffsets", tco2Array[0]);
	console.log(`Deployed eligible TCO2 ${tco2.address}`);

	// Admin is able to verify
	const role = await contracts.batches.VERIFIER_ROLE();
	await contracts.batches.grantRole(role, admin.address);

	// Mint an empty batch to start the bridging process for the broker
	console.log("Starting the tokenization process for a broker...");
	console.log("1. Minting an empty batch...");
	const batchTx = await contracts.batches.connect(broker).mintEmptyBatch(broker.address);
	const batchId = await getBatchId(batchTx);
	console.log(`Minted batch ${batchId}`);

	// Confirm credit tokenization
	console.log("2. Updating the batch with data...");
	await contracts.batches.connect(admin).updateBatchWithData(batchId, "serialNumber1", 2000, "uri1");
	console.log("3. Linking the batch to the vintage...");
	await contracts.batches.connect(admin).linkWithVintage(batchId, vintageId);
	console.log("4. Confirming the batch...");
	await contracts.batches.connect(admin).confirmRetirement(batchId);

	// Broker can now fractionalize to TCO2
	console.log("5. Fractionalizing the batch to TCO2...");
	await contracts.batches.connect(broker).fractionalize(batchId);
	return tco2;
}

module.exports = { prepareToucanEnv };
