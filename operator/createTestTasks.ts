import { ethers } from "ethers";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
dotenv.config();

// Setup env variables
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);
/// TODO: Hack
let chainId = 31337;

const avsDeploymentData = JSON.parse(
  fs.readFileSync(
    path.resolve(
      __dirname,
      `../contracts/deployments/hello-world/${chainId}.json`
    ),
    "utf8"
  )
);
const helloWorldServiceManagerAddress =
  avsDeploymentData.addresses.helloWorldServiceManager;
const helloWorldServiceManagerABI = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, "../abis/HelloWorldServiceManager.json"),
    "utf8"
  )
);
// Initialize contract objects from ABIs
const helloWorldServiceManager = new ethers.Contract(
  helloWorldServiceManagerAddress,
  helloWorldServiceManagerABI,
  wallet
);

// Test proposals
const testProposals = [
  // Good value proposals (should get Y)
  "exchange 1$ USDC for 2$ ETH",
  "swap 10$ DAI for 10$ USDC",
  "trade 5$ ETH for 5000$ BTC",

  // Scam proposals (should get N)
  "exchange 1$ USDC for 500$ AIPEPE",
  "swap 10$ ETH for 1000000$ ELONMOON",
  "invest 100$ USDC in SAFEMOON token",

  // Partial value proposals (should get alternative suggestions)
  "exchange 1$ USDC for 0.5$ ETH",
  "swap 10$ DAI for 9$ USDC with 2% fee",
  "trade 10$ ETH for 9500$ BTC with high slippage",
  "exchange 100$ USDC for 90$ DAI through an unknown DEX",
  "swap 50$ ETH for 45$ WBTC with 10% fee",
  "trade 1000$ USDT for 950$ ETH with 24 hour delay",

  // With operator tags
  `exchange 1$ USDC for 2$ ETH @${chainId}:${wallet.address}`,
  `swap 10$ DAI for 10000$ DOGECOIN @${chainId}:${wallet.address}`,

  // With metadata
  'exchange 1$ USDC for 2$ ETH {"parentTask": 1}',
  'swap 10$ ETH for 1000000$ ELONMOON {"parentTask": 2}',
];

async function createTestTasks() {
  console.log("Creating test tasks...");

  for (const proposal of testProposals) {
    try {
      console.log(`Creating task: ${proposal}`);
      const tx = await helloWorldServiceManager.createNewTask(proposal);
      const receipt = await tx.wait();
      console.log(`Transaction successful with hash: ${receipt.hash}`);

      // Wait a bit between transactions
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (error) {
      console.error("Error creating task:", error);
    }
  }

  console.log("All test tasks created!");
}

// Run the function
createTestTasks().catch((error) => {
  console.error("Error in main function:", error);
});
