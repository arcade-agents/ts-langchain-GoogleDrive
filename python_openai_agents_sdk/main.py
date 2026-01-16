from agents import (Agent, Runner, AgentHooks, Tool, RunContextWrapper,
                    TResponseInputItem,)
from functools import partial
from arcadepy import AsyncArcade
from agents_arcade import get_arcade_tools
from typing import Any
from human_in_the_loop import (UserDeniedToolCall,
                               confirm_tool_usage,
                               auth_tool)

import globals


class CustomAgentHooks(AgentHooks):
    def __init__(self, display_name: str):
        self.event_counter = 0
        self.display_name = display_name

    async def on_start(self,
                       context: RunContextWrapper,
                       agent: Agent) -> None:
        self.event_counter += 1
        print(f"### ({self.display_name}) {
              self.event_counter}: Agent {agent.name} started")

    async def on_end(self,
                     context: RunContextWrapper,
                     agent: Agent,
                     output: Any) -> None:
        self.event_counter += 1
        print(
            f"### ({self.display_name}) {self.event_counter}: Agent {
                # agent.name} ended with output {output}"
                agent.name} ended"
        )

    async def on_handoff(self,
                         context: RunContextWrapper,
                         agent: Agent,
                         source: Agent) -> None:
        self.event_counter += 1
        print(
            f"### ({self.display_name}) {self.event_counter}: Agent {
                source.name} handed off to {agent.name}"
        )

    async def on_tool_start(self,
                            context: RunContextWrapper,
                            agent: Agent,
                            tool: Tool) -> None:
        self.event_counter += 1
        print(
            f"### ({self.display_name}) {self.event_counter}:"
            f" Agent {agent.name} started tool {tool.name}"
            f" with context: {context.context}"
        )

    async def on_tool_end(self,
                          context: RunContextWrapper,
                          agent: Agent,
                          tool: Tool,
                          result: str) -> None:
        self.event_counter += 1
        print(
            f"### ({self.display_name}) {self.event_counter}: Agent {
                # agent.name} ended tool {tool.name} with result {result}"
                agent.name} ended tool {tool.name}"
        )


async def main():

    context = {
        "user_id": os.getenv("ARCADE_USER_ID"),
    }

    client = AsyncArcade()

    arcade_tools = await get_arcade_tools(
        client, toolkits=["GoogleDrive"]
    )

    for tool in arcade_tools:
        # - human in the loop
        if tool.name in ENFORCE_HUMAN_CONFIRMATION:
            tool.on_invoke_tool = partial(
                confirm_tool_usage,
                tool_name=tool.name,
                callback=tool.on_invoke_tool,
            )
        # - auth
        await auth_tool(client, tool.name, user_id=context["user_id"])

    agent = Agent(
        name="",
        instructions="# Introduction
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

By following these workflows, the Google Drive Assistant will operate efficiently and effectively, ensuring users achieve their file management goals seamlessly.",
        model=os.environ["OPENAI_MODEL"],
        tools=arcade_tools,
        hooks=CustomAgentHooks(display_name="")
    )

    # initialize the conversation
    history: list[TResponseInputItem] = []
    # run the loop!
    while True:
        prompt = input("You: ")
        if prompt.lower() == "exit":
            break
        history.append({"role": "user", "content": prompt})
        try:
            result = await Runner.run(
                starting_agent=agent,
                input=history,
                context=context
            )
            history = result.to_input_list()
            print(result.final_output)
        except UserDeniedToolCall as e:
            history.extend([
                {"role": "assistant",
                 "content": f"Please confirm the call to {e.tool_name}"},
                {"role": "user",
                 "content": "I changed my mind, please don't do it!"},
                {"role": "assistant",
                 "content": f"Sure, I cancelled the call to {e.tool_name}."
                 " What else can I do for you today?"
                 },
            ])
            print(history[-1]["content"])

if __name__ == "__main__":
    import asyncio

    asyncio.run(main())