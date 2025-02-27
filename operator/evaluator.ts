import { ethers } from "ethers";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { genkit } from "genkit";
import { googleAI, gemini15Pro } from "@genkit-ai/googleai";

dotenv.config();

// Initialize Genkit with Google AI
const ai = genkit({
  plugins: [googleAI()],
  model: gemini15Pro,
});

// In-memory storage for full responses
const taskResponses: Map<number, string> = new Map();

// Function to store a task response
const storeTaskResponse = (taskIndex: number, response: string) => {
  taskResponses.set(taskIndex, response);
  console.log(`Stored response for task ${taskIndex}: ${response}`);
};

// Function to get a task response
const getTaskResponse = (taskIndex: number): string => {
  return taskResponses.get(taskIndex) || "N";
};

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
// Load core deployment data
const coreDeploymentData = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, `../contracts/deployments/core/${chainId}.json`),
    "utf8"
  )
);

const delegationManagerAddress = coreDeploymentData.addresses.delegation;
const avsDirectoryAddress = coreDeploymentData.addresses.avsDirectory;
const helloWorldServiceManagerAddress =
  avsDeploymentData.addresses.helloWorldServiceManager;
const ecdsaStakeRegistryAddress = avsDeploymentData.addresses.stakeRegistry;

// Load ABIs
const delegationManagerABI = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, "../abis/IDelegationManager.json"),
    "utf8"
  )
);
const ecdsaRegistryABI = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, "../abis/ECDSAStakeRegistry.json"),
    "utf8"
  )
);
const helloWorldServiceManagerABI = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, "../abis/HelloWorldServiceManager.json"),
    "utf8"
  )
);
const avsDirectoryABI = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../abis/IAVSDirectory.json"), "utf8")
);

// Initialize contract objects from ABIs
const delegationManager = new ethers.Contract(
  delegationManagerAddress,
  delegationManagerABI,
  wallet
);
const helloWorldServiceManager = new ethers.Contract(
  helloWorldServiceManagerAddress,
  helloWorldServiceManagerABI,
  wallet
);
const ecdsaRegistryContract = new ethers.Contract(
  ecdsaStakeRegistryAddress,
  ecdsaRegistryABI,
  wallet
);
const avsDirectory = new ethers.Contract(
  avsDirectoryAddress,
  avsDirectoryABI,
  wallet
);

// Function to evaluate a proposal using Gemini
async function evaluateProposal(proposal: string): Promise<string> {
  try {
    // Define the prompt for evaluation
    const prompt = `
    You are an evaluator for cryptocurrency transactions. Evaluate the following proposal and respond with:
    Y - the request should be executed as is - it's good value
    N - the request should be ignored (if it's a scam or worthless)
    A complete alternative suggestion - if it's partial value or needs modification
    
    Here's what you need to know:
    - If the proposal mentions exchanging for tokens that are known scams (like most memecoins with "PEPE" in the name), respond with N
    - If the proposal is for a fair exchange where the user gets equal or greater value, respond with Y
    - If the proposal is for an exchange where the user gets less value but it might still be reasonable, respond with a complete alternative suggestion
    
    For alternative suggestions:
    - Start with "Alternative: " followed by your suggestion
    - Be specific about what should be changed (fees, slippage, token amounts, etc.)
    - Keep it concise but informative (1-2 sentences)
    - Explain why your alternative is better
    
    Proposal to evaluate: "${proposal}"
    
    If your response is Y or N, respond with just that single character.
    If suggesting an alternative, provide a complete but concise suggestion starting with "Alternative: ".
    `;

    // Generate the evaluation
    const { text } = await ai.generate(prompt);
    const response = text.trim();

    // Return Y or N as is, but return the full response for alternatives
    if (response === "Y" || response === "N") {
      return response;
    } else {
      // Return the full alternative suggestion
      return response;
    }
  } catch (error) {
    console.error("Error evaluating proposal:", error);
    return "N"; // Default to rejecting on error
  }
}

// Function to sign and respond to a task with evaluation
const signAndRespondToTask = async (
  taskIndex: number,
  taskCreatedBlock: number,
  taskName: string
) => {
  try {
    console.log(`Evaluating task ${taskIndex}: ${taskName}`);

    // Evaluate the proposal
    const evaluation = await evaluateProposal(taskName);
    console.log(`Evaluation result for task ${taskIndex}: ${evaluation}`);

    // Store the full evaluation response for retrieval by the UI
    storeTaskResponse(taskIndex, evaluation);

    // Sign the evaluation result
    const messageHash = ethers.solidityPackedKeccak256(
      ["string"],
      [evaluation]
    );
    const messageBytes = ethers.getBytes(messageHash);
    const signature = await wallet.signMessage(messageBytes);

    console.log(`Signing and responding to task ${taskIndex}`);

    const operators = [await wallet.getAddress()];
    const signatures = [signature];
    const signedTask = ethers.AbiCoder.defaultAbiCoder().encode(
      ["address[]", "bytes[]", "uint32"],
      [
        operators,
        signatures,
        ethers.toBigInt((await provider.getBlockNumber()) - 1),
      ]
    );

    const tx = await helloWorldServiceManager.respondToTask(
      { name: taskName, taskCreatedBlock: taskCreatedBlock },
      taskIndex,
      signedTask
    );
    await tx.wait();
    console.log(
      `Responded to task ${taskIndex} with evaluation: ${evaluation}`
    );
  } catch (error) {
    console.error(`Error processing task ${taskIndex}:`, error);
  }
};

const registerOperator = async () => {
  // Registers as an Operator in EigenLayer.
  try {
    const tx1 = await delegationManager.registerAsOperator(
      {
        __deprecated_earningsReceiver: await wallet.address,
        delegationApprover: "0x0000000000000000000000000000000000000000",
        stakerOptOutWindowBlocks: 0,
      },
      ""
    );
    await tx1.wait();
    console.log("Operator registered to Core EigenLayer contracts");
  } catch (error) {
    console.error("Error in registering as operator:", error);
  }

  const salt = ethers.hexlify(ethers.randomBytes(32));
  const expiry = Math.floor(Date.now() / 1000) + 3600; // Example expiry, 1 hour from now

  // Define the output structure
  let operatorSignatureWithSaltAndExpiry = {
    signature: "",
    salt: salt,
    expiry: expiry,
  };

  // Calculate the digest hash
  const operatorDigestHash =
    await avsDirectory.calculateOperatorAVSRegistrationDigestHash(
      wallet.address,
      await helloWorldServiceManager.getAddress(),
      salt,
      expiry
    );
  console.log(operatorDigestHash);

  // Sign the digest hash with the operator's private key
  console.log("Signing digest hash with operator's private key");
  const operatorSigningKey = new ethers.SigningKey(process.env.PRIVATE_KEY!);
  const operatorSignedDigestHash = operatorSigningKey.sign(operatorDigestHash);

  // Encode the signature in the required format
  operatorSignatureWithSaltAndExpiry.signature = ethers.Signature.from(
    operatorSignedDigestHash
  ).serialized;

  console.log("Registering Operator to AVS Registry contract");

  // Register Operator to AVS
  const tx2 = await ecdsaRegistryContract.registerOperatorWithSignature(
    operatorSignatureWithSaltAndExpiry,
    wallet.address
  );
  await tx2.wait();
  console.log("Operator registered on AVS successfully");
};

// Function to parse task metadata and extract relevant information
const parseTaskMetadata = (taskName: string) => {
  // Extract contract addresses, method calls, and other metadata
  const contractTags = taskName.match(/@(\d+):0x[a-fA-F0-9]{40}/g) || [];
  const parentTaskMatch = taskName.match(/{"parentTask":\s*(\d+)}/) || [];

  return {
    contractTags,
    parentTaskId: parentTaskMatch[1] ? parseInt(parentTaskMatch[1]) : null,
    rawProposal: taskName,
  };
};

const monitorNewTasks = async () => {
  helloWorldServiceManager.on(
    "NewTaskCreated",
    async (taskIndex: number, task: any) => {
      console.log(`New task detected: ${task.name}`);

      // Parse the task metadata
      const metadata = parseTaskMetadata(task.name);
      console.log(`Task metadata:`, metadata);

      // Process and respond to the task
      await signAndRespondToTask(taskIndex, task.taskCreatedBlock, task.name);
    }
  );

  console.log("Monitoring for new tasks...");
};

const main = async () => {
  await registerOperator();
  monitorNewTasks().catch((error) => {
    console.error("Error monitoring tasks:", error);
  });
};

main().catch((error) => {
  console.error("Error in main function:", error);
});

// Export the getTaskResponse function for use by the UI
export { getTaskResponse };
