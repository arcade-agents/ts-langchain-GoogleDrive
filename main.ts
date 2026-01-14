"use strict";
import { getTools, confirm, arcade } from "./tools";
import { createAgent } from "langchain";
import {
  Command,
  MemorySaver,
  type Interrupt,
} from "@langchain/langgraph";
import chalk from "chalk";
import * as readline from "node:readline/promises";

// configure your own values to customize your agent

// The Arcade User ID identifies who is authorizing each service.
const arcadeUserID = process.env.ARCADE_USER_ID;
if (!arcadeUserID) {
  throw new Error("Missing ARCADE_USER_ID. Add it to your .env file.");
}
// This determines which MCP server is providing the tools, you can customize this to make a Slack agent, or Notion agent, etc.
// all tools from each of these MCP servers will be retrieved from arcade
const toolkits=['GoogleDrive'];
// This determines isolated tools that will be
const isolatedTools=[];
// This determines the maximum number of tool definitions Arcade will return
const toolLimit = 100;
// This prompt defines the behavior of the agent.
const systemPrompt = `# Introduction
Welcome to your Google Drive Assistant! This agent is designed to help you efficiently manage your Google Drive files and folders. Whether you need to create, upload, rename, share, or download files, this ReAct agent will guide you through the necessary steps using a variety of tools available for interaction with Google Drive.

# Instructions
1. Always seek to understand the user's intent and what they wish to accomplish with their Google Drive.
2. Utilize the various tools at your disposal to perform tasks, such as creating folders, uploading files, moving files, and downloading files, based on user requests.
3. Follow the workflows outlined below for structured task completion.
4. Keep the user informed about the actions being taken and any necessary information required (like folder names, file URLs, etc.).
5. Encourage user-driven file selection and authorization when necessary through the Google File Picker.

# Workflows

## 1. Create a New Folder
- **Step 1**: Ask the user for the name of the folder and a parent folder path if applicable.
- **Step 2**: Use `GoogleDrive_CreateFolder` to create the new folder.

## 2. Upload a File
- **Step 1**: Inquire about the file name, URL, and the folder path (if any) where the file should be uploaded.
- **Step 2**: Use `GoogleDrive_UploadFile` to upload the file to the specified location.

## 3. Rename a File or Folder
- **Step 1**: Request the current path or ID of the file/folder to be renamed and the new name.
- **Step 2**: Use `GoogleDrive_RenameFile` to rename the specified file or folder.

## 4. Share a File or Folder
- **Step 1**: Gather the file path or ID, email addresses of users to share with, and the desired permission role.
- **Step 2**: Use `GoogleDrive_ShareFile` to share the specified file or folder.

## 5. Download a File
- **Step 1**: Ask for the file path or ID of the file to download.
- **Step 2**: Use `GoogleDrive_DownloadFile` or `GoogleDrive_DownloadFileChunk` (if the file is large) to download the specified file.

## 6. Move a File or Folder
- **Step 1**: Collect the source file path/ID, destination folder path/ID, and optional new filename.
- **Step 2**: Use `GoogleDrive_MoveFile` to move the file or folder to a new location.

## 7. Search for Files
- **Step 1**: Request the search query and any folder or file type filters from the user.
- **Step 2**: Use `GoogleDrive_SearchFiles` to find and return the relevant files.

## 8. Get File Tree Structure
- **Step 1**: Ask the user if they want the full tree structure or to limit it to shared drives.
- **Step 2**: Use `GoogleDrive_GetFileTreeStructure` to retrieve and display the file/folder hierarchy.

## 9. Check User Profile
- **Step 1**: Call `GoogleDrive_WhoAmI` to retrieve information about the user, such as their profile and Google Drive environment.
- **Step 2**: Present the user with their relevant information for any further actions needed. 

By following these workflows, the Google Drive Assistant will operate efficiently and effectively, ensuring users achieve their file management goals seamlessly.`;
// This determines which LLM will be used inside the agent
const agentModel = process.env.OPENAI_MODEL;
if (!agentModel) {
  throw new Error("Missing OPENAI_MODEL. Add it to your .env file.");
}
// This allows LangChain to retain the context of the session
const threadID = "1";

const tools = await getTools({
  arcade,
  toolkits: toolkits,
  tools: isolatedTools,
  userId: arcadeUserID,
  limit: toolLimit,
});



async function handleInterrupt(
  interrupt: Interrupt,
  rl: readline.Interface
): Promise<{ authorized: boolean }> {
  const value = interrupt.value;
  const authorization_required = value.authorization_required;
  const hitl_required = value.hitl_required;
  if (authorization_required) {
    const tool_name = value.tool_name;
    const authorization_response = value.authorization_response;
    console.log("⚙️: Authorization required for tool call", tool_name);
    console.log(
      "⚙️: Please authorize in your browser",
      authorization_response.url
    );
    console.log("⚙️: Waiting for you to complete authorization...");
    try {
      await arcade.auth.waitForCompletion(authorization_response.id);
      console.log("⚙️: Authorization granted. Resuming execution...");
      return { authorized: true };
    } catch (error) {
      console.error("⚙️: Error waiting for authorization to complete:", error);
      return { authorized: false };
    }
  } else if (hitl_required) {
    console.log("⚙️: Human in the loop required for tool call", value.tool_name);
    console.log("⚙️: Please approve the tool call", value.input);
    const approved = await confirm("Do you approve this tool call?", rl);
    return { authorized: approved };
  }
  return { authorized: false };
}

const agent = createAgent({
  systemPrompt: systemPrompt,
  model: agentModel,
  tools: tools,
  checkpointer: new MemorySaver(),
});

async function streamAgent(
  agent: any,
  input: any,
  config: any
): Promise<Interrupt[]> {
  const stream = await agent.stream(input, {
    ...config,
    streamMode: "updates",
  });
  const interrupts: Interrupt[] = [];

  for await (const chunk of stream) {
    if (chunk.__interrupt__) {
      interrupts.push(...(chunk.__interrupt__ as Interrupt[]));
      continue;
    }
    for (const update of Object.values(chunk)) {
      for (const msg of (update as any)?.messages ?? []) {
        console.log("🤖: ", msg.toFormattedString());
      }
    }
  }

  return interrupts;
}

async function main() {
  const config = { configurable: { thread_id: threadID } };
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(chalk.green("Welcome to the chatbot! Type 'exit' to quit."));
  while (true) {
    const input = await rl.question("> ");
    if (input.toLowerCase() === "exit") {
      break;
    }
    rl.pause();

    try {
      let agentInput: any = {
        messages: [{ role: "user", content: input }],
      };

      // Loop until no more interrupts
      while (true) {
        const interrupts = await streamAgent(agent, agentInput, config);

        if (interrupts.length === 0) {
          break; // No more interrupts, we're done
        }

        // Handle all interrupts
        const decisions: any[] = [];
        for (const interrupt of interrupts) {
          decisions.push(await handleInterrupt(interrupt, rl));
        }

        // Resume with decisions, then loop to check for more interrupts
        // Pass single decision directly, or array for multiple interrupts
        agentInput = new Command({ resume: decisions.length === 1 ? decisions[0] : decisions });
      }
    } catch (error) {
      console.error(error);
    }

    rl.resume();
  }
  console.log(chalk.red("👋 Bye..."));
  process.exit(0);
}

// Run the main function
main().catch((err) => console.error(err));