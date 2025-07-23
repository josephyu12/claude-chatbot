import React, { useState } from 'react';
import './App.css';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { atomDark } from "react-syntax-highlighter/dist/esm/styles/prism";

function App() {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState([]);

const handleSubmit = async (e) => {
  e.preventDefault();
  setLoading(true);

  const userMessage = { role: 'user', content: prompt };
  setHistory((prevHistory) => [...prevHistory, userMessage, { role: 'assistant', content: "" }]); 

  try {
    const res = await fetch("http://localhost:8000/api/claude/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt })
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let fullResponse = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
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
  setLoading(false);
};


  return (
    <div className="App">
      <h1>Claude Chat (Streaming + Memory)</h1>
      <form onSubmit={handleSubmit}>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Paste your prompt..."
          rows={10}
        />
        <br />
        <button type="submit" disabled={loading}>
          {loading ? 'Thinking...' : 'Ask Claude'}
        </button>
      </form>
      
      {/* Reverse the history array before mapping to display newest messages first */}
      {[...history].reverse().map((m, i) => (
        <div key={history.length - 1 - i} className={`message ${m.role}`}> 
          <strong>{m.role === "user" ? "You" : "Claude"}:</strong>
          <ReactMarkdown
            children={m.content}
            remarkPlugins={[remarkGfm]}
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