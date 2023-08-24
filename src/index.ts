#!/usr/bin/env node

import { ethers, utils } from "ethers";
import { CacheFS } from "./fs/cacheFs";
import { checkRequirements } from "./requirements"
import { getSafeApiKit } from "./safe-api/kit";
import { syncSafes } from "./safe/sync";
import { SafeCDKit } from "./utils/types";
import YAML from 'yaml';
import { syncProposals } from "./proposal/sync";
import { Command, Option } from 'commander';
import { writeFileSync } from "fs";
import { promisify } from 'util';
const exec = promisify(require('child_process').exec);
const program = new Command();

interface GlobalConfig {
	network: string;
}

function validateGlobalConfig(config: any): GlobalConfig {
	if (!config.network) {
		throw new Error(`Missing network in global config`)
	}
	return config as GlobalConfig
}

program
	.name('safecd')
	.description('Reconcile git repository with safes')
	.version('1.0.0');

const rpcOption = new Option("--rpc <char>", "ethereum rpc endpoint").env("RPC");
rpcOption.mandatory = true;

const transactionApis: { [key: string]: string } = {
	"mainnet": "https://safe-transaction-mainnet.safe.global",
	"goerli": "https://safe-transaction-goerli.safe.global",
}

// const { LedgerSigner } = require("@ethersproject/hardware-wallets");
// const ledgerSigner = new LedgerSigner(provider, "hid", "m/44'/60'/0'/0/0");

// await sak.addSafeDelegate({
// 	label: "safecd",
// 	signer: ledgerSigner
// })

program
	.command('sync')
	.description('syncs current directory with safes')
	.addOption(rpcOption)
	.addOption(new Option("--dry-run", "do not write to disk").default(false).env("DRY_RUN"))
	.addOption(new Option("--upload", "upload to safe").default(false).env("UPLOAD"))
	.action(async (options) => {
		await checkRequirements();

		console.log()
		console.log("  ================================================  ")
		console.log()
		console.log("  ███████╗ █████╗ ███████╗███████╗ ██████╗██████╗")
		console.log("  ██╔════╝██╔══██╗██╔════╝██╔════╝██╔════╝██╔══██╗")
		console.log("  ███████╗███████║█████╗  █████╗  ██║     ██║  ██║")
		console.log("  ╚════██║██╔══██║██╔══╝  ██╔══╝  ██║     ██║  ██║")
		console.log("  ███████║██║  ██║██║     ███████╗╚██████╗██████╔╝")
		console.log("  ╚══════╝╚═╝  ╚═╝╚═╝     ╚══════╝ ╚═════╝╚═════╝")
		console.log()
		console.log("  ================================================  ")
		console.log()

		const pks = process.env.PRIVATE_KEYS?.split(',') || [];
		console.log(`  rpc=${options.rpc}`)
		console.log(`  dryRun=${options.dryRun}`)
		console.log(`  upload=${options.upload}`)
		console.log()
		console.log("  ================================================  ")
		console.log()
		const shouldUpload = options.upload;
		const shouldWrite = !(options.dryRun);
		const provider = new ethers.providers.JsonRpcProvider(options.rpc);
		const signers: { [key: string]: ethers.Signer } = {};
		let loaded = false;
		for (const pk of pks) {
			loaded = true;
			const signer = new ethers.Wallet(pk, provider);
			signers[utils.getAddress(signer.address)] = signer;
			console.log(`  loaded signer for ${await signer.address}`)
		}
		if (loaded) {
			console.log()
			console.log("  ================================================  ")
			console.log()
		}
		const fs = new CacheFS();
		const config = validateGlobalConfig(YAML.parse(fs.read("./safecd.yaml")));
		const chainId = (await provider.getNetwork()).chainId;
		const safeApiUrl = transactionApis[config.network] as string;
		if (!safeApiUrl) {
			throw new Error(`Unsupported network ${config.network}`)
		}
		const sak = await getSafeApiKit(provider, safeApiUrl);
		const scdk: SafeCDKit = {
			sak,
			provider,
			signers,
			rpcUrl: options.rpc,
			safeUrl: safeApiUrl,
			shouldUpload,
			shouldWrite,
			fs,
			network: config.network,
			network_id: chainId,
		}


		console.log("stage 1: syncing safes, transactions, owners and delegates");
		await syncSafes(scdk);
		console.log("stage 1: done.")
		if (scdk.shouldWrite && scdk.shouldUpload) {
			console.log("stage 2: syncing & uploading proposals");
		} else {
			console.log("stage 2: syncing proposals");
		}
		const hasProposed = await syncProposals(scdk);
		console.log("stage 2: done.")

		if (hasProposed) {
			console.log("stage 3: sleeping 10 seconds then syncing safes, transactions, owners and delegates");
			await new Promise(resolve => setTimeout(resolve, 10000));
			await syncSafes(scdk);
			console.log("stage 3: done.")
		}

		console.log()
		console.log("  ================================================  ")
		console.log()

		scdk.fs.printDiff();
		scdk.fs.commit(scdk.shouldWrite);
	})

program.command('init')
	.requiredOption("--network <char>", "network to use for the repository")
	.requiredOption("--safe <char>", "initial safe address")
	.action(async (options) => {
		console.log("initializing current directory")
		await exec("forge init")
		await exec("rm -rf src test script")
		await exec("git clone https://github.com/kilnfi/safecd-templates.git ./template")
		await exec("cp -r ./template/script .")
		await exec("cp ./template/.gitignore .")
		await exec("rm -rf template")
		await exec("mkdir safes")
		writeFileSync("./safecd.yaml", YAML.stringify({
			network: options.network,
		}))
		writeFileSync(`./safes/${options.safe}`, YAML.stringify({
			address: options.safe,
			name: options.safe,
			type: "safe"
		}))

	})

program.parse();