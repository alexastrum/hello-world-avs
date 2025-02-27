import { ethers } from "ethers";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import { getTaskResponse } from "./evaluator"; // Import the getTaskResponse function

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
const helloWorldServiceManager = new ethers.Contract(
  helloWorldServiceManagerAddress,
  helloWorldServiceManagerABI,
  wallet
);

// Store tasks and responses
interface Task {
  index: number;
  name: string;
  createdBlock: number;
  timestamp: number;
}

interface TaskResponse {
  operator: string;
  response: string;
  timestamp: number;
}

const tasks: Task[] = [];
const taskResponses: Record<number, TaskResponse[]> = {};

// Simple HTTP server to display tasks and evaluations
const server = http.createServer(async (req, res) => {
  res.writeHead(200, { "Content-Type": "text/html" });

  let html = `
  <!DOCTYPE html>
  <html>
  <head>
    <title>Evaluator Operator UI</title>
    <meta http-equiv="refresh" content="10">
    <style>
      body { font-family: Arial, sans-serif; margin: 20px; }
      .task { border: 1px solid #ddd; padding: 15px; margin-bottom: 15px; border-radius: 5px; }
      .task-header { display: flex; justify-content: space-between; margin-bottom: 10px; }
      .task-title { font-weight: bold; font-size: 18px; }
      .task-meta { color: #666; font-size: 14px; }
      .response { background-color: #f9f9f9; padding: 10px; margin-top: 10px; border-radius: 3px; }
      .response-header { display: flex; justify-content: space-between; margin-bottom: 5px; }
      .response-operator { font-weight: bold; }
      .response-time { color: #666; font-size: 14px; }
      .response-value { font-size: 16px; padding: 5px; border-radius: 3px; }
      .response-value.Y { color: white; background-color: green; display: inline-block; }
      .response-value.N { color: white; background-color: red; display: inline-block; }
      .response-value.alternative { color: white; background-color: orange; display: block; margin-top: 5px; white-space: pre-line; }
      h1 { color: #333; }
    </style>
  </head>
  <body>
    <h1>Evaluator Operator UI</h1>
    <p>Displaying tasks and evaluations from the delegationManager chatroom.</p>
    <div id="tasks">
  `;

  // Sort tasks by timestamp (newest first)
  const sortedTasks = [...tasks].sort((a, b) => b.timestamp - a.timestamp);

  for (const task of sortedTasks) {
    const date = new Date(task.timestamp);
    html += `
      <div class="task">
        <div class="task-header">
          <div class="task-title">Task #${task.index}: ${task.name}</div>
          <div class="task-meta">Created: ${date.toLocaleString()}</div>
        </div>
    `;

    const responses = taskResponses[task.index] || [];
    if (responses.length > 0) {
      for (const response of responses) {
        const responseDate = new Date(response.timestamp);
        const responseClass =
          response.response === "Y"
            ? "Y"
            : response.response === "N"
            ? "N"
            : "alternative";

        html += `
          <div class="response">
            <div class="response-header">
              <div class="response-operator">Operator: ${response.operator.substring(
                0,
                6
              )}...${response.operator.substring(38)}</div>
              <div class="response-time">${responseDate.toLocaleString()}</div>
            </div>
        `;

        if (responseClass === "Y" || responseClass === "N") {
          html += `<div class="response-value ${responseClass}">Evaluation: ${response.response}</div>`;
        } else {
          html += `<div class="response-value ${responseClass}">${response.response}</div>`;
        }

        html += `</div>`;
      }
    } else {
      html += `<div class="response">No evaluations yet</div>`;
    }

    html += `</div>`;
  }

  html += `
    </div>
  </body>
  </html>
  `;

  res.end(html);
});

// Listen for new tasks
const monitorTasks = async () => {
  console.log("Starting to monitor tasks...");

  // Get past events
  const latestBlockNumber = await provider.getBlockNumber();
  const startBlock = Math.max(0, latestBlockNumber - 1000); // Look back 1000 blocks

  const pastEvents = await helloWorldServiceManager.queryFilter(
    helloWorldServiceManager.filters.NewTaskCreated,
    startBlock
  );

  for (const event of pastEvents) {
    // Cast event to EventLog to access args
    const eventLog = event as ethers.EventLog;
    const taskIndex = eventLog.args[0];
    const task = eventLog.args[1];
    const block = await provider.getBlock(event.blockNumber);

    if (block) {
      tasks.push({
        index: Number(taskIndex),
        name: task.name,
        createdBlock: Number(task.taskCreatedBlock),
        timestamp: Number(block.timestamp) * 1000, // Convert to milliseconds
      });
    }
  }

  // Listen for new task events
  helloWorldServiceManager.on(
    "NewTaskCreated",
    async (taskIndex, task, event) => {
      console.log(`New task detected: ${task.name}`);
      const block = await provider.getBlock(event.blockNumber);

      if (block) {
        tasks.push({
          index: Number(taskIndex),
          name: task.name,
          createdBlock: Number(task.taskCreatedBlock),
          timestamp: Number(block.timestamp) * 1000, // Convert to milliseconds
        });
      }
    }
  );

  // Listen for task response events
  helloWorldServiceManager.on(
    "TaskResponded",
    async (taskIndex, task, operator, event) => {
      console.log(`Task ${taskIndex} responded by ${operator}`);
      const block = await provider.getBlock(event.blockNumber);

      if (block) {
        // Try to get the response from our in-memory storage
        let evaluationResult;
        try {
          // First try to get from our in-memory storage
          evaluationResult = getTaskResponse(Number(taskIndex));
        } catch (error) {
          console.warn("Could not get response from in-memory storage:", error);

          // Fallback to getting from contract
          try {
            // Get the response data from the contract
            const responseData =
              await helloWorldServiceManager.allTaskResponses(
                operator,
                taskIndex
              );

            // Decode the response (this is a simplification - actual decoding depends on your contract)
            const decodedData = ethers.AbiCoder.defaultAbiCoder().decode(
              ["address[]", "bytes[]", "uint32"],
              responseData
            );

            // Extract the signature and convert to evaluation result
            const signatures = decodedData[1];
            evaluationResult = "N"; // Default

            if (signatures && signatures.length > 0) {
              try {
                // This is a simplification - actual extraction depends on your contract
                const signatureBytes = signatures[0];

                // For simplicity, we'll just use Y or N based on the first byte
                const firstByte = ethers.getBytes(signatureBytes)[0];
                evaluationResult = firstByte === 89 ? "Y" : "N"; // ASCII for Y is 89
              } catch (error) {
                console.error("Error decoding response:", error);
              }
            }
          } catch (error) {
            console.error("Error getting response from contract:", error);
            evaluationResult = "N"; // Default to N if we can't get the response
          }
        }

        if (!taskResponses[Number(taskIndex)]) {
          taskResponses[Number(taskIndex)] = [];
        }

        taskResponses[Number(taskIndex)].push({
          operator,
          response: evaluationResult,
          timestamp: Number(block.timestamp) * 1000, // Convert to milliseconds
        });
      }
    }
  );
};

const startServer = (port: number) => {
  server.listen(port, () => {
    console.log(`UI server running at http://localhost:${port}/`);
  });
};

const main = async () => {
  await monitorTasks();
  startServer(3000);
};

main().catch((error) => {
  console.error("Error in main function:", error);
});
