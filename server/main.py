from fastapi import FastAPI, Request, Form, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel
from anthropic import Anthropic
from dotenv import load_dotenv
from PIL import Image
import io
import os
import uuid
import base64
import mimetypes
import PyPDF2
import docx
import pandas as pd
import chardet

load_dotenv()
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://claude-chatbot-one.vercel.app"],
    allow_methods=["*"],
    allow_headers=["*"],
)

def extract_text_from_file(file_bytes: bytes, filename: str, mime_type: str) -> str:
    """Extract text content from various file types"""
    try:
        # PDF files
        if mime_type == 'application/pdf' or filename.lower().endswith('.pdf'):
            pdf_reader = PyPDF2.PdfReader(io.BytesIO(file_bytes))
            text = ""
            for page in pdf_reader.pages:
                text += page.extract_text() + "\n"
            return text.strip()
        
        # Word documents
        elif mime_type in ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 
                          'application/msword'] or filename.lower().endswith(('.docx', '.doc')):
            doc = docx.Document(io.BytesIO(file_bytes))
            text = "\n".join([paragraph.text for paragraph in doc.paragraphs])
            return text.strip()
        
        # Excel files
        elif mime_type in ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                          'application/vnd.ms-excel'] or filename.lower().endswith(('.xlsx', '.xls')):
            df = pd.read_excel(io.BytesIO(file_bytes))
            return df.to_string()
        
        # CSV files
        elif mime_type == 'text/csv' or filename.lower().endswith('.csv'):
            # Detect encoding
            detected = chardet.detect(file_bytes)
            encoding = detected['encoding'] or 'utf-8'
            text = file_bytes.decode(encoding)
            return text
        
        # Text files
        elif mime_type == 'text/plain' or filename.lower().endswith('.txt'):
            # Detect encoding
            detected = chardet.detect(file_bytes)
            encoding = detected['encoding'] or 'utf-8'
            return file_bytes.decode(encoding)
        
        else:
            return None
            
    except Exception as e:
        print(f"Error extracting text from {filename}: {e}")
        return None

claude_client = Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
MODEL = "claude-opus-4-20250514"
chat_memory = []

class ClaudePrompt(BaseModel):
    prompt: str

def compress_image(image_bytes: bytes, max_size_mb: float = 4.5) -> tuple[bytes, str]:
    """
    Compress an image to ensure it's under the specified size limit.
    Returns the compressed image bytes and the media type.
    """
    max_size_bytes = int(max_size_mb * 1024 * 1024)
    
    # Open the image
    img = Image.open(io.BytesIO(image_bytes))
    
    # Convert RGBA to RGB if necessary (JPEG doesn't support transparency)
    if img.mode in ('RGBA', 'LA', 'P'):
        background = Image.new('RGB', img.size, (255, 255, 255))
        if img.mode == 'P':
            img = img.convert('RGBA')
        background.paste(img, mask=img.split()[-1] if img.mode == 'RGBA' else None)
        img = background
    
    # Start with high quality
    quality = 95
    
    while True:
        # Save to bytes
        output = io.BytesIO()
        img.save(output, format='JPEG', quality=quality, optimize=True)
        output_bytes = output.getvalue()
        
        # Check size
        if len(output_bytes) <= max_size_bytes:
            return output_bytes, "image/jpeg"
        
        # If quality is already low, resize the image
        if quality <= 20:
            width, height = img.size
            scale = 0.8
            new_width = int(width * scale)
            new_height = int(height * scale)
            img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)
            quality = 85  # Reset quality after resize
        else:
            # Reduce quality
            quality -= 10

@app.post("/api/claude/upload")
async def upload_file(prompt: str = Form(...), files: list[UploadFile] = File(...)):
    content_blocks = []
    file_names = []
    
    # Add text prompt if provided
    if prompt and prompt.strip():
        content_blocks.append({"type": "text", "text": prompt.strip()})
    
    # Process each uploaded file
    for file in files:
        try:
            # Read file content
            file_bytes = await file.read()
            original_size = len(file_bytes)
            
            # Detect MIME type
            mime_type, _ = mimetypes.guess_type(file.filename)
            if not mime_type:
                # Try to determine from file extension
                if file.filename.lower().endswith('.pdf'):
                    mime_type = "application/pdf"
                elif file.filename.lower().endswith(('.doc', '.docx')):
                    mime_type = "application/msword"
                elif file.filename.lower().endswith(('.xls', '.xlsx')):
                    mime_type = "application/vnd.ms-excel"
                elif file.filename.lower().endswith('.csv'):
                    mime_type = "text/csv"
                elif file.filename.lower().endswith('.txt'):
                    mime_type = "text/plain"
                else:
                    mime_type = "application/octet-stream"
            
            # Check if it's an image and if it needs compression
            if mime_type.startswith('image/'):
                # Check size (5MB = 5 * 1024 * 1024 bytes)
                if original_size > 5 * 1024 * 1024:
                    print(f"Compressing {file.filename} (original size: {original_size:,} bytes)")
                    file_bytes, mime_type = compress_image(file_bytes)
                    print(f"Compressed to {len(file_bytes):,} bytes")
            
                # Convert to base64
                base64_data = base64.b64encode(file_bytes).decode("utf-8")
                
                # Verify the base64 encoded size
                encoded_size = len(base64_data)
                if encoded_size > 5 * 1024 * 1024:
                    print(f"Warning: Base64 encoded size is still too large: {encoded_size:,} bytes")
                    # Try more aggressive compression
                    file_bytes, mime_type = compress_image(file_bytes, max_size_mb=3.5)
                    base64_data = base64.b64encode(file_bytes).decode("utf-8")
                
                # Add image to content blocks
                content_blocks.append({
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": mime_type,
                        "data": base64_data,
                    },
                })
            else:
                # Try to extract text from document
                extracted_text = extract_text_from_file(file_bytes, file.filename, mime_type)
                if extracted_text:
                    # Add document content as text
                    content_blocks.append({
                        "type": "text",
                        "text": f"\n\n[Content from {file.filename}]:\n{extracted_text}\n"
                    })
                else:
                    # If extraction failed, notify user
                    content_blocks.append({
                        "type": "text",
                        "text": f"\n\n[Unable to extract content from {file.filename}]\n"
                    })
            
            file_names.append(file.filename)
            
        except Exception as e:
            print(f"Error processing file {file.filename}: {e}")
            # You might want to add error info to the response
            continue
    
    # Add to chat memory
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
        # Remove the failed message from memory
        if chat_memory and chat_memory[-1]["role"] == "user":
            chat_memory.pop()
        return JSONResponse(
            {"response": f"Error: {str(e)}", "files": file_names}, 
            status_code=500
        )

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
                        yield f"{delta}\n\n"
                # append final assistant message
                chat_memory.append({"role": "assistant", "content": full_response})
        except Exception as e:
            # Remove the failed message from memory
            if chat_memory and chat_memory[-1]["role"] == "user":
                chat_memory.pop()
            yield f"data: ERROR: {str(e)}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")

@app.post("/api/claude/clear")
async def clear_chat():
    """Clear the chat memory"""
    global chat_memory
    chat_memory = []
    return JSONResponse({"message": "Chat memory cleared"})