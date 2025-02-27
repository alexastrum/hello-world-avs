# Evaluator Operator

This is an evaluator operator that assesses agent proposals and outputs a response. It uses Gemini AI to evaluate proposals and determine if they should be executed, ignored, or modified.

## Features

- Evaluates agent proposals using Gemini AI
- Outputs a response:
  - `Y` - The request should be executed as is (good value)
  - `N` - The request should be ignored (scam or worthless)
  - Complete alternative suggestion - Proposes an alternative action (partial value or needs modification)
- Provides a simple UI to view tasks and evaluations
- Uses in-memory storage to preserve full alternative suggestions

## How It Works

The evaluator uses Gemini AI to analyze proposals and determine their value. When a proposal needs modification, the AI generates a complete alternative suggestion rather than just a single character.

These full responses are stored in an in-memory Map that associates task indices with their complete evaluations. The UI retrieves these full responses when displaying task evaluations.

Note: In a production environment, you would want to store these responses in a database or on-chain for persistence across restarts.

## Setup

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Create a `.env` file based on `.env.example` and fill in:
   - `PRIVATE_KEY`: Your Ethereum private key
   - `RPC_URL`: Your Ethereum RPC URL
   - `GOOGLE_GENAI_API_KEY`: Your Google AI API key (get one from [Google AI Studio](https://makersuite.google.com/app/apikey))

## Usage

### Running the Evaluator Operator

```bash
pnpm run start:evaluator
```

This will:

1. Register the operator with EigenLayer
2. Start monitoring for new tasks
3. Evaluate each task using Gemini AI
4. Respond to the task with the evaluation result
5. Store the full response in memory for UI display

### Running the UI

```bash
pnpm run start:ui
```

This will start a simple web server at http://localhost:3000 that displays:

- All tasks in the system
- Evaluations for each task, including full alternative suggestions
- Color-coded responses (green for Y, red for N, orange for alternatives)

### Creating Test Tasks

```bash
pnpm run start:test-tasks
```

This will create test tasks in the system with various types of proposals:

- Good value proposals (should get Y)
- Scam proposals (should get N)
- Partial value proposals (should get alternative suggestions)
- Proposals with operator tags and metadata

## Task Format

Tasks can include:

- Human readable proposal with the proposed action
- Optional tags like `@$chainId:$contractAddr` to target specific operators
- Optional metadata in JSON format
- Optional transaction payload

Example task:

```
exchange 1$ USDC for 500 $AIPEPE @31337:0x123...abc
```

## Evaluation Logic

The evaluator uses Gemini AI to assess proposals based on:

- Whether tokens mentioned are known scams
- Whether the exchange offers fair value
- Whether the proposal needs modification

When a proposal needs modification, the evaluator now provides a complete alternative suggestion rather than just a single character.

## License

This project is licensed under the MIT License.
