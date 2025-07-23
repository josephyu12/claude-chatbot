from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from anthropic import Anthropic
from dotenv import load_dotenv
import os

load_dotenv()
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

claude_client = Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
MODEL = "claude-opus-4-20250514"
chat_memory = []

class ClaudePrompt(BaseModel):
    prompt: str

@app.post("/api/claude")
async def chat_with_claude(prompt: ClaudePrompt):
    global chat_memory
    chat_memory.append({"role": "user", "content": prompt.prompt})
    try:
        response = claude_client.messages.create(
            model=MODEL,
            max_tokens=4096,
            temperature=0.7,
            messages=chat_memory,
        )
        reply = response.content[0].text
        chat_memory.append({"role": "assistant", "content": reply})
        return {"response": reply}
    except Exception as e:
        return {"response": f"Error: {e}"}

@app.post("/api/claude/stream")
async def stream_claude_response(prompt: ClaudePrompt):
    global chat_memory
    chat_memory.append({"role": "user", "content": prompt.prompt})

    def event_generator():
        try:
            with claude_client.messages.stream(
                model=MODEL,
                max_tokens=4096,
                temperature=0.7,
                messages=chat_memory,
            ) as stream:
                full_response = ""
                for event in stream.text_stream:  # ✅ this is a regular iterator
                    full_response += event
                    yield f"data: {event}\n\n"
                chat_memory.append({"role": "assistant", "content": full_response})
        except Exception as e:
            yield f"data: ERROR: {str(e)}\n\n"


    return StreamingResponse(event_generator(), media_type="text/event-stream")