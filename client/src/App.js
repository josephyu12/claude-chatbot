import { useState } from 'react';
import './App.css';
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { atomDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import "katex/dist/katex.min.css"; // Import KaTeX CSS for math styling

function App() {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState([]);
  const [file, setFile] = useState(null);

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    const userMessage = { role: 'user', content: prompt, file: file ? { name: file.name, type: file.type, url: URL.createObjectURL(file) } : null };
    setHistory((prevHistory) => [...prevHistory, userMessage, { role: 'assistant', content: "" }]); 

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
          }
          return updatedHistory;
        });
        // Reset file input to delete the chosen file from the input spot
        const fileInput = document.getElementById('file-input');
        if (fileInput) fileInput.value = "";
      } else {
        const reader = res.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let fullResponse = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          const lines = chunk.split("").filter(Boolean);

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
        }
        return updatedHistory;
      });
    }

    setPrompt('');
    setFile(null);
    setLoading(false);
  };

  return (
    <div className="App">
      <h1>Claude Chat (Streaming + Memory)</h1>
      <form onSubmit={handleSubmit}>
        <input
          id="file-input"
          type="file"
          onChange={handleFileChange}
          style={{ marginBottom: '10px' }}
        />
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Paste your prompt..."
          rows={10}
        />
        <br />
        <input
          type="file"
          onChange={handleFileChange}
          disabled={loading}
        />
        <br />
        <button type="submit" disabled={loading}>
          {loading ? 'Thinking...' : 'Ask Claude'}
        </button>
      </form>
      
      {[...history].reverse().map((m, i) => (
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
            children={m.content}
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeKatex]}
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
      ))}
    </div>
  );
}

export default App;