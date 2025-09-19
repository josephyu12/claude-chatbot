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
  const [files, setFiles] = useState([]);
  const [pastedImages, setPastedImages] = useState([]);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

  const handleFileChange = (e) => {
    const selectedFiles = Array.from(e.target.files);
    const newFiles = selectedFiles.map(file => ({
      file: file,
      url: URL.createObjectURL(file),
      name: file.name,
      type: file.type
    }));
    setFiles(prevFiles => [...prevFiles, ...newFiles]);
    setPastedImages([]); // Clear pasted images when files are selected
  };

  const handlePaste = async (e) => {
    const items = e.clipboardData.items;
    const imageItems = [];
    
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        e.preventDefault();
        const blob = items[i].getAsFile();
        const url = URL.createObjectURL(blob);
        imageItems.push({
          file: blob,
          url: url,
          name: `pasted-image-${Date.now()}-${i}.png`,
          type: blob.type
        });
      }
    }
    
    if (imageItems.length > 0) {
      setPastedImages(prevImages => [...prevImages, ...imageItems]);
      setFiles([]); // Clear selected files when pasting images
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleKeyDown = (e) => {
    // Submit on Enter, but allow Shift+Enter for new lines
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (prompt.trim() || files.length > 0 || pastedImages.length > 0) {
        handleSubmit(e);
      }
    }
  };

  const removeFile = (index, isPasted = false) => {
    if (isPasted) {
      setPastedImages(prevImages => prevImages.filter((_, i) => i !== index));
    } else {
      setFiles(prevFiles => prevFiles.filter((_, i) => i !== index));
    }
  };

  const clearAllFiles = () => {
    // Revoke all object URLs to prevent memory leaks
    [...files, ...pastedImages].forEach(item => {
      if (item.url) URL.revokeObjectURL(item.url);
    });
    
    setFiles([]);
    setPastedImages([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    const allFiles = [...files, ...pastedImages];
    if (!prompt.trim() && allFiles.length === 0) return;
    
    setLoading(true);

    const userMessage = { 
      role: 'user', 
      content: prompt, 
      files: allFiles.length > 0 ? allFiles.map(item => ({
        name: item.name,
        type: item.type,
        url: item.url
      })) : null
    };
    setHistory((prevHistory) => [...prevHistory, userMessage, { role: 'assistant', content: "", isStreaming: true }]); 

    try {
      let res;
      if (allFiles.length > 0) {
        const formData = new FormData();
        formData.append("prompt", prompt);
        allFiles.forEach((item, index) => {
          formData.append("files", item.file);
        });

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

      if (allFiles.length > 0) {
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
    clearAllFiles();
    setLoading(false);
  };

  const allFiles = [...files, ...pastedImages];

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
            placeholder="Paste your prompt or images... (Enter to send, Shift+Enter for new line)"
            rows={10}
            disabled={loading}
            style={{ paddingBottom: allFiles.length > 0 ? '80px' : '10px' }}
          />
          {allFiles.length > 0 && (
            <div style={{ 
              position: 'absolute', 
              bottom: '10px', 
              left: '10px', 
              right: '10px',
              display: 'flex', 
              alignItems: 'center',
              background: 'rgba(255,255,255,0.9)',
              padding: '5px',
              borderRadius: '5px',
              flexWrap: 'wrap',
              gap: '5px',
              maxHeight: '70px',
              overflowY: 'auto'
            }}>
              {allFiles.map((item, index) => (
                <div key={index} style={{ display: 'flex', alignItems: 'center', background: '#f0f0f0', borderRadius: '3px', padding: '2px 5px' }}>
                  {item.type.startsWith('image/') ? (
                    <img 
                      src={item.url} 
                      alt={item.name} 
                      style={{ height: '30px', marginRight: '5px', borderRadius: '3px' }} 
                    />
                  ) : (
                    <span style={{ fontSize: '12px', marginRight: '5px' }}>📄</span>
                  )}
                  <span style={{ fontSize: '12px', maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.name}
                  </span>
                  <button 
                    type="button" 
                    onClick={() => removeFile(files.indexOf(item) !== -1 ? files.indexOf(item) : index, files.indexOf(item) === -1)}
                    style={{ 
                      background: '#ff4444', 
                      color: 'white', 
                      border: 'none', 
                      borderRadius: '3px',
                      padding: '2px 5px',
                      marginLeft: '5px',
                      cursor: 'pointer',
                      fontSize: '11px'
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button 
                type="button" 
                onClick={clearAllFiles}
                style={{ 
                  background: '#ff4444', 
                  color: 'white', 
                  border: 'none', 
                  borderRadius: '3px',
                  padding: '2px 8px',
                  cursor: 'pointer',
                  fontSize: '12px'
                }}
              >
                Clear All
              </button>
            </div>
          )}
        </div>
        <br />
          <input
            ref={fileInputRef}
            id="file-input"
            type="file"
            onChange={handleFileChange}
            disabled={loading}
            multiple
            style={{ marginBottom: '10px' }}
          />
        <br />
          <button type="submit" disabled={loading || (!prompt.trim() && allFiles.length === 0)}>
            {loading ? 'Thinking...' : 'Ask Claude (or press Enter)'}
          </button>
      </form>
      
      {[...history].reverse().map((m, i) => {
        // Process content directly in the render
        const processedContent = processContent(m.content, m.isStreaming);
        
        return (
          <div key={history.length - 1 - i} className={`message ${m.role}`}> 
            <strong>{m.role === "user" ? "You" : "Claude"}:</strong>
            {m.files && (
              <div style={{ margin: "8px 0", display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {m.files.map((file, fileIndex) => (
                  <div key={fileIndex}>
                    {file.type.startsWith("image/") ? (
                      <img src={file.url} alt={file.name} style={{ maxWidth: "200px", borderRadius: "8px" }} />
                    ) : (
                      <div style={{ padding: '8px', background: '#f0f0f0', borderRadius: '8px' }}>
                        📄 {file.name}
                      </div>
                    )}
                  </div>
                ))}
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