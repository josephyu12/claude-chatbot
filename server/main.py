from fastapi import FastAPI, Request, Form, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel
from anthropic import Anthropic
from dotenv import load_dotenv
import os
import uuid
import os, shutil, uuid, base64, mimetypes

load_dotenv()
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://claude-chatbot-one.vercel.app"],
    allow_methods=["*"],
    allow_headers=["*"],
)

claude_client = Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
MODEL = "claude-opus-4-20250514"
chat_memory = []

class ClaudePrompt(BaseModel):
    prompt: str


@app.post("/api/claude/upload")
async def upload_file(prompt: str = Form(...), files: list[UploadFile] = File(...)):
    # Save files to a temp directory
    temp_dir = "uploaded_files"
    os.makedirs(temp_dir, exist_ok=True)
    
    content_blocks = []
    file_names = []
    
    # Add text prompt if provided
    if prompt and prompt.strip():
        content_blocks.append({"type": "text", "text": prompt.strip()})
    
    # Process each uploaded file
    for file in files:
        file_id = str(uuid.uuid4())
        file_path = os.path.join(temp_dir, f"{file_id}_{file.filename}")
        
        # Save file
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        # Read file as base64
        with open(file_path, "rb") as f:
            file_bytes = f.read()
        base64_data = base64.b64encode(file_bytes).decode("utf-8")
        
        # Detect MIME type
        mime_type, _ = mimetypes.guess_type(file_path)
        if not mime_type:
            mime_type = "image/png"  # fallback
        
        # Add image to content blocks
        content_blocks.append({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": mime_type,
                "data": base64_data,
            },
        })
        
        file_names.append(file.filename)
        
        # Clean up temp file
        os.remove(file_path)
    
    global chat_memory
    chat_memory.append({
        "role": "user",
        "content": content_blocks,
    })
    
    # Get Claude's response
    try:
        response = claude_client.messages.create(
            model=MODEL,
            max_tokens=4096,
            temperature=0.7,
            messages=chat_memory,
        )
        reply = response.content[0].text
        chat_memory.append({"role": "assistant", "content": reply})
        return JSONResponse({"response": reply, "files": file_names})
    except Exception as e:
        return JSONResponse({"response": f"Error: {e}", "files": file_names})
    
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
                for event in stream:
                    if event.type == "content_block_delta":
                        delta = event.delta.text
                        full_response += delta
                        yield f"data: {delta}\n\n"
                # append final assistant message
                chat_memory.append({"role": "assistant", "content": full_response})
        except Exception as e:
            yield f"data: ERROR: {str(e)}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")