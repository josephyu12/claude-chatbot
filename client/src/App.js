import { useState, useRef } from 'react';
import './App.css';
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { atomDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import "katex/dist/katex.min.css"; // Import KaTeX CSS for math styling

// Helper function to check if math delimiters are balanced
function hasCompleteMath(content) {
  // Count occurrences of $$ for display math
  const displayMathMatches = content.match(/\$\$/g) || [];
  const displayMathCount = displayMathMatches.length;
  
  // For inline math, we need to count $ but exclude $$
  const inlineMathMatches = content.match(/(?<!\$)\$(?!\$)/g) || [];
  const inlineMathCount = inlineMathMatches.length;
  
  // Check if we have even numbers (paired delimiters)
  return displayMathCount % 2 === 0 && inlineMathCount % 2 === 0;
}

// Process content to handle incomplete math during streaming
function processContent(content, isStreaming) {
  if (!isStreaming || hasCompleteMath(content)) {
    return content;
  }
  
  // If streaming and math is incomplete, find the last complete math expression
  let lastSafeIndex = content.length;
  
  // Check for incomplete display math ($$)
  const displayMathMatches = [...content.matchAll(/\$\$/g)];
  if (displayMathMatches.length % 2 !== 0) {
    // Odd number means unclosed $$
    lastSafeIndex = displayMathMatches[displayMathMatches.length - 1].index;
  }
  
  // Check for incomplete inline math ($)
  const inlineMathPattern = /(?<!\$)\$(?!\$)/g;
  const inlineMathMatches = [...content.matchAll(inlineMathPattern)];
  if (inlineMathMatches.length % 2 !== 0) {
    // Odd number means unclosed $
    const lastMatch = inlineMathMatches[inlineMathMatches.length - 1];
    lastSafeIndex = Math.min(lastSafeIndex, lastMatch.index);
  }
  
  return content.substring(0, lastSafeIndex) + (lastSafeIndex < content.length ? '...' : '');
}

function App() {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState([]);
  const [file, setFile] = useState(null);
  const [pastedImage, setPastedImage] = useState(null);
  const textareaRef = useRef(null);

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
    setPastedImage(null); // Clear pasted image when file is selected
  };

  const handlePaste = async (e) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        e.preventDefault();
        const blob = items[i].getAsFile();
        setFile(blob);
        setPastedImage(URL.createObjectURL(blob));
        
        // Clear the file input
        const fileInput = document.getElementById('file-input');
        if (fileInput) fileInput.value = "";
        break;
      }
    }
  };

  const handleKeyDown = (e) => {
    // Submit on Enter, but allow Shift+Enter for new lines
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (prompt.trim() || file) {
        handleSubmit(e);
      }
    }
  };

  const clearFile = () => {
    setFile(null);
    setPastedImage(null);
    const fileInput = document.getElementById('file-input');
    if (fileInput) fileInput.value = "";
  };

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    if (!prompt.trim() && !file) return;
    
    setLoading(true);

    const userMessage = { 
      role: 'user', 
      content: prompt, 
      file: file ? { 
        name: file.name || 'pasted-image.png', 
        type: file.type, 
        url: pastedImage || URL.createObjectURL(file) 
      } : null 
    };
    setHistory((prevHistory) => [...prevHistory, userMessage, { role: 'assistant', content: "", isStreaming: true }]); 

    try {
      let res;
      if (file) {
        const formData = new FormData();
        formData.append("prompt", prompt);
        formData.append("file", file);

        res = await fetch("https://claude-chatbot-g4ed.onrender.com/api/claude/upload", {
          method: "POST",
          body: formData
        });
      } else {
        res = await fetch("https://claude-chatbot-g4ed.onrender.com/api/claude/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt })
        });
      }

      if (file) {
        const data = await res.json();
        setHistory((prevHistory) => {
          const updatedHistory = [...prevHistory];
          const lastAssistantMessageIndex = updatedHistory.length - 1;
          if (updatedHistory[lastAssistantMessageIndex] && updatedHistory[lastAssistantMessageIndex].role === 'assistant') {
            updatedHistory[lastAssistantMessageIndex].content = data.response;
            updatedHistory[lastAssistantMessageIndex].isStreaming = false;
          }
          return updatedHistory;
        });
      } else {
        const reader = res.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let fullResponse = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            // Mark streaming as complete
            setHistory((prevHistory) => {
              const updatedHistory = [...prevHistory];
              const lastAssistantMessageIndex = updatedHistory.length - 1;
              if (updatedHistory[lastAssistantMessageIndex] && updatedHistory[lastAssistantMessageIndex].role === 'assistant') {
                updatedHistory[lastAssistantMessageIndex].isStreaming = false;
              }
              return updatedHistory;
            });
            break;
          }
          const chunk = decoder.decode(value);
          const lines = chunk.split("data: ").filter(Boolean);
          
          for (const line of lines) {
            fullResponse += line.replace(/\n\n$/, "");
            setHistory((prevHistory) => {
              const updatedHistory = [...prevHistory];
              const lastAssistantMessageIndex = updatedHistory.length - 1;
              if (updatedHistory[lastAssistantMessageIndex] && updatedHistory[lastAssistantMessageIndex].role === 'assistant') {
                updatedHistory[lastAssistantMessageIndex].content = fullResponse;
              }
              return updatedHistory;
            });
          }
        }
      }
    } catch (err) {
      console.error("Stream error:", err);
      setHistory((prevHistory) => {
        const updatedHistory = [...prevHistory];
        const lastAssistantMessageIndex = updatedHistory.length - 1;
        if (updatedHistory[lastAssistantMessageIndex] && updatedHistory[lastAssistantMessageIndex].role === 'assistant') {
          updatedHistory[lastAssistantMessageIndex].content = `Error: ${err.message}`;
          updatedHistory[lastAssistantMessageIndex].isStreaming = false;
        }
        return updatedHistory;
      });
    }

    setPrompt('');
    clearFile();
    setLoading(false);
  };

  return (
    <div className="App">
      <h1>Claude Chat (Streaming + Memory)</h1>
      <form onSubmit={handleSubmit}>
        <div style={{ position: 'relative' }}>
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onPaste={handlePaste}
            onKeyDown={handleKeyDown}
            placeholder="Paste your prompt or image... (Enter to send, Shift+Enter for new line)"
            rows={10}
            disabled={loading}
            style={{ paddingBottom: pastedImage ? '60px' : '10px' }}
          />
          {pastedImage && (
            <div style={{ 
              position: 'absolute', 
              bottom: '10px', 
              left: '10px', 
              display: 'flex', 
              alignItems: 'center',
              background: 'rgba(255,255,255,0.9)',
              padding: '5px',
              borderRadius: '5px'
            }}>
              <img 
                src={pastedImage} 
                alt="Pasted" 
                style={{ height: '40px', marginRight: '10px', borderRadius: '3px' }} 
              />
              <button 
                type="button" 
                onClick={clearFile}
                style={{ 
                  background: '#ff4444', 
                  color: 'white', 
                  border: 'none', 
                  borderRadius: '3px',
                  padding: '5px 10px',
                  cursor: 'pointer'
                }}
              >
                Remove
              </button>
            </div>
          )}
        </div>
        <br />
        <input
          id="file-input"
          type="file"
          onChange={handleFileChange}
          disabled={loading}
          style={{ marginBottom: '10px' }}
        />
        <br />
        <button type="submit" disabled={loading || (!prompt.trim() && !file)}>
          {loading ? 'Thinking...' : 'Ask Claude (or press Enter)'}
        </button>
      </form>
      
      {[...history].reverse().map((m, i) => {
        // Process content directly in the render
        const processedContent = processContent(m.content, m.isStreaming);
        
        return (
          <div key={history.length - 1 - i} className={`message ${m.role}`}> 
            <strong>{m.role === "user" ? "You" : "Claude"}:</strong>
            {m.file && (
              <div style={{ margin: "8px 0" }}>
                {m.file.type.startsWith("image/") ? (
                  <img src={m.file.url} alt={m.file.name} style={{ maxWidth: "300px", borderRadius: "8px" }} />
                ) : (
                  <a href={m.file.url} download={m.file.name}>{m.file.name}</a>
                )}
              </div>
            )}
            <ReactMarkdown
              children={processedContent}
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[[rehypeKatex, {
                throwOnError: false,
                errorColor: '#cc0000',
                strict: 'warn',
                trust: true,
                macros: {
                  "\\RR": "\\mathbb{R}",
                  "\\ZZ": "\\mathbb{Z}",
                  "\\NN": "\\mathbb{N}",
                  "\\QQ": "\\mathbb{Q}",
                  "\\CC": "\\mathbb{C}"
                }
              }]]}
              components={{
                code({ node, inline, className, children, ...props }) {
                  const match = /language-(\w+)/.exec(className || "");
                  return !inline && match ? (
                    <SyntaxHighlighter
                      children={String(children).replace(/\n$/, "")}
                      style={atomDark}
                      language={match[1]}
                      PreTag="div"
                      {...props}
                    />
                  ) : (
                    <code className="bg-gray-200 rounded px-1 py-0.5 text-sm" {...props}>
                      {children}
                    </code>
                  );
                },
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

export default App;