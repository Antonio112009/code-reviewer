---
name: LLM application security
description: Defects in LLM, agent and MCP code, such as prompt injection with tools, model output reaching sinks, over-privileged or unconfirmed tools, prompt-only guardrails, unbounded consumption, unchecked stop reasons, client-side keys, RAG/thread authorization and MCP trust.
category: security
priority: 72
tier: essential
tags:
  - OWASP-LLM01
  - OWASP-LLM02
  - OWASP-LLM05
  - OWASP-LLM06
  - OWASP-LLM07
  - OWASP-LLM08
  - OWASP-LLM10
  - CWE-1427
  - CWE-79
  - CWE-918
  - CWE-770
  - CWE-639
activation:
  content:
    - (?:\bfrom\s+|\brequire\(\s*|\bimport\(\s*)['"](?:openai|ai|ollama|langchain|@anthropic-ai/[\w-]+|@ai-sdk/[\w-]+|@langchain/[\w-]+|@google/genai|@mistralai/mistralai|@openai/agents|@modelcontextprotocol/[\w-]+|@aws-sdk/client-bedrock(?:-agent)?-runtime)(?:/[\w./-]{0,60})?['"]|^\s*(?:from|import)\s+(?:openai|anthropic|langchain\w*|langgraph|llama_index|litellm|google\.genai|mistralai|ollama|mcp|fastmcp|pydantic_ai|crewai|autogen\w*|smolagents|dspy)\b
    - \b(?:openai-go|anthropic-sdk-go|go-openai|langchaingo|com\.anthropic|com\.openai|langchain4j|springframework\.ai|Azure\.AI\.OpenAI|Anthropic\.SDK|Microsoft\.SemanticKernel|Microsoft\.Extensions\.AI|OpenAI::Client|Anthropic::Client)\b
    - \b(?:chat\.completions\.create|responses\.create|generateText|streamText|generateObject|streamObject|ChatOpenAI|ChatAnthropic|AgentExecutor|create_react_agent|bind_tools|tool_choice|tool_calls|tool_use|dangerouslyAllowBrowser|maxOutputTokens|max_output_tokens|max_completion_tokens|max_tokens|stop_reason|finish_reason|system_prompt|systemPrompt|SYSTEM_PROMPT|McpServer|FastMCP|registerTool|call_tool)\b
  examples:
    - 'import OpenAI from "openai";'
    - 'client = OpenAI::Client.new(access_token: token)'
    - 'const response = await client.chat.completions.create({ model, messages, tool_choice: "auto" });'
---
- **Prompt injection with tools**: untrusted text (web pages, emails, files, RAG chunks, tool results, memories) in prompts while the model holds side-effecting or data-reading tools → hijacked actions, exfiltration. Fix: isolate untrusted content, least privilege.
- **Output to sinks**: model output fed to `eval`, SQL, shell, `innerHTML`, file paths, redirects or fetched URLs; Markdown rendered with remote images → XSS, RCE, SSRF, zero-click exfiltration. Fix: treat output as untrusted input.
- **Over-privileged tools**: tool handlers using app-wide credentials instead of the end user's, unconfined path/SQL/URL arguments, write-capable DB roles → cross-user access, SSRF. Fix: per-user authz inside each tool.
- **No human approval**: destructive or external-effect tools (delete, pay, email, push, shell) auto-executed → irreversible actions from injected text. Fix: confirmation step, scoped tokens.
- **Prompt-only guardrails**: access rules, secrecy or content policy enforced only by system-prompt wording or an LLM judge → bypassed by injection. Fix: enforce in code; keep secrets out of prompts.
- **Unbounded consumption**: no `max_tokens`, agent loops without step caps, client-chosen `model` or limits, unbounded history or retries, no per-user quota → cost blow-ups, DoS. Fix: caps, budgets, abort signals.
- **Unchecked results**: `finish_reason`/`stop_reason` (`length`, `max_tokens`, `refusal`) ignored; tool arguments or JSON output parsed without schema validation → truncated data treated as complete, crashes. Fix: check stop reasons, validate with a schema.
- **Client-side keys**: provider SDKs called from browsers or apps (`dangerouslyAllowBrowser: true`, public env keys) → key theft, unmetered use. Fix: an authenticated server proxy.
- **RAG and thread authorization**: retrieval without per-user/tenant filters, answer caches keyed only by prompt, client-supplied thread, file or response ids used unchecked → cross-user leakage. Fix: filter and bind ids by principal.
- **MCP trust**: user-chosen MCP server URLs or stdio commands, trusted third-party tool descriptions, local HTTP servers without auth or `Origin` checks, token passthrough → tool poisoning, DNS rebinding. Fix: allowlists, bind localhost.
