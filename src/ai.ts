import { webSearch } from "./search"

type ChatMessage = {
  role: "system" | "user" | "assistant"
  content: string
}

type NVIDIAToolCall = {
  id: string
  type: string
  function: {
    name: string
    arguments: string
  }
}

type NVIDIAMessage = {
  role: string
  content: string | null
  tool_calls?: NVIDIAToolCall[]
}

type NVIDIAResponse = {
  choices: {
    index: number
    message: NVIDIAMessage
    finish_reason: string
  }[]
}

const WEB_SEARCH_DESCRIPTION =
  "Search the web for real, up-to-date information. Use ONLY when the question involves current events, recent news, new technology or discoveries, current prices, schedules, current people or organizations, or any information you can not reliably know or verify from your own knowledge. Never use it for greetings, casual chat, or stable well-known knowledge."

export class NVIDIAClient {
  private apiKey: string
  private model: string

  constructor() {
    this.apiKey = process.env.NVIDIA_API_KEY as string
    this.model = process.env.NVIDIA_MODEL as string

    if (!this.apiKey) {
      throw new Error("NVIDIA_API_KEY environment variable is not set")
    }

    if (!this.model) {
      throw new Error("NVIDIA_MODEL environment variable is not set")
    }
  }

  async getReply(messages: ChatMessage[]): Promise<string> {
    const chat: unknown[] = messages.map(m => ({ role: m.role, content: m.content }))
    let full = ""
    const executedQueries: string[] = []

    for (let round = 0; round < 3; round++) {
      const data = await this.requestNVIDIA(chat, true)
      const choice = data.choices && data.choices[0]

      if (!choice) {
        throw new Error("No choices returned from NVIDIA API")
      }

      console.log("FINISH REASON:", choice.finish_reason)

      if (choice.finish_reason === "length") {
        throw new Error("NVIDIA response truncated by token limit (finish_reason=length)")
      }

      const toolCalls = (choice.message && choice.message.tool_calls) || []

      if (toolCalls.length === 0) {
        full = (choice.message && choice.message.content) || ""
        break
      }

      chat.push(choice.message)

      for (const tc of toolCalls) {
        let query = ""
        if (tc.function && tc.function.name === "web_search") {
          try {
            const args = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>
            query = typeof args.query === "string" ? args.query : ""
          } catch {
            query = ""
          }
        }

        if (query) {
          executedQueries.push(query)
          console.log(`WEB SEARCH: requested query: "${query}"`)
          let resultText: string
          try {
            resultText = await webSearch(query)
          } catch (err) {
            console.error("WEB SEARCH: failed:", (err as Error).message)
            resultText = "Search failed or could not be completed"
          }
          chat.push({ role: "tool", tool_call_id: tc.id, content: resultText })
        } else {
          chat.push({ role: "tool", tool_call_id: tc.id, content: "Error: missing or invalid search query" })
        }
      }
    }

    if (executedQueries.length > 0) {
      console.log(`WEB SEARCH: used=true queries=[${executedQueries.join(" | ")}]`)
    } else {
      console.log("WEB SEARCH: used=false")
    }

    if (!full) {
      // The model kept requesting tool calls without producing a final answer.
      // Make one last request without tools to force a direct text answer.
      console.log("No final text after tool rounds, requesting a direct answer without tools")
      const data = await this.requestNVIDIA(chat, false)
      const choice = data.choices && data.choices[0]

      if (!choice) {
        throw new Error("No choices returned from NVIDIA API")
      }

      if (choice.finish_reason === "length") {
        throw new Error("NVIDIA response truncated by token limit (finish_reason=length)")
      }

      full = (choice.message && choice.message.content) || ""
    }

    if (!full) {
      throw new Error("No content returned from NVIDIA API")
    }

    return full
  }

  private async requestNVIDIA(messages: unknown[], withTools: boolean): Promise<NVIDIAResponse> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      max_tokens: 8192,
      chat_template_kwargs: {
        reasoning_effort: "low",
        clear_thinking: true
      }
    }

    if (withTools) {
      body.tools = [
        {
          type: "function",
          function: {
            name: "web_search",
            description: WEB_SEARCH_DESCRIPTION,
            parameters: {
              type: "object",
              properties: {
                query: { type: "string", description: "The web search query" }
              },
              required: ["query"]
            }
          }
        }
      ]
    }

    const doFetch = async (includeTools: boolean): Promise<Response> => {
      const requestBody: Record<string, unknown> = { ...body }
      if (includeTools) {
        requestBody.tools = body.tools
      } else {
        delete requestBody.tools
      }

      return fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`
        },
        signal: AbortSignal.timeout(60000),
        body: JSON.stringify(requestBody)
      })
    }

    let response = await doFetch(withTools)

    if (!response.ok) {
      const errorText = await response.text()
      if (withTools && response.status === 400 && /tool|function/i.test(errorText)) {
        console.log("Function calling rejected, retrying without tools")
        response = await doFetch(false)
      }
      if (!response.ok) {
        const errorText2 = await response.text()
        throw new Error(`NVIDIA API error: ${response.status} - ${errorText2.slice(0, 300)}`)
      }
    }

    return (await response.json()) as NVIDIAResponse
  }
}

type GeminiUsageMetadata = {
  promptTokenCount?: number
  candidatesTokenCount?: number
  totalTokenCount?: number
  thoughtsTokenCount?: number
}

export class GeminiClient {
  private apiKey: string
  private model: string

  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY as string
    this.model = (process.env.GEMINI_MODEL as string) || "gemini-3.5-flash-lite"

    if (!this.apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is not set")
    }
  }

  async getReply(messages: ChatMessage[]): Promise<string> {
    const systemParts = messages
      .filter(m => m.role === "system")
      .map(m => m.content)
      .join("\n\n")

    const nativeContents: unknown[] = messages
      .filter(m => m.role !== "system")
      .map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }]
      }))

    const webSearchTool = [
      {
        functionDeclarations: [
          {
            name: "web_search",
            description: WEB_SEARCH_DESCRIPTION,
            parameters: {
              type: "OBJECT",
              properties: {
                query: { type: "STRING", description: "The web search query" }
              },
              required: ["query"]
            }
          }
        ]
      }
    ]

    let full = ""
    const executedQueries: string[] = []

    for (let round = 0; round < 3; round++) {
      const result = await this.requestGemini(systemParts, nativeContents, webSearchTool)
      full = result.text

      if (result.functionCalls.length === 0) {
        break
      }

      nativeContents.push({
        role: "model",
        parts: result.functionCalls.map(fc => ({ functionCall: fc }))
      })

      const responseParts: unknown[] = []
      for (const fc of result.functionCalls) {
        if (fc.name === "web_search" && fc.args && typeof fc.args.query === "string") {
          executedQueries.push(fc.args.query)
          console.log(`WEB SEARCH: requested query: "${fc.args.query}"`)
          try {
            const searchResult = await webSearch(fc.args.query)
            responseParts.push({
              functionResponse: { name: "web_search", response: { result: searchResult } }
            })
          } catch (err) {
            console.error("WEB SEARCH: failed:", (err as Error).message)
            responseParts.push({
              functionResponse: {
                name: "web_search",
                response: { error: "Search failed or could not be completed" }
              }
            })
          }
        } else {
          responseParts.push({
            functionResponse: { name: fc.name, response: { error: "Unknown function" } }
          })
        }
      }
      nativeContents.push({ role: "user", parts: responseParts })
    }

    if (executedQueries.length > 0) {
      console.log(`WEB SEARCH: used=true queries=[${executedQueries.join(" | ")}]`)
    } else {
      console.log("WEB SEARCH: used=false")
    }

    if (!full) {
      // The model kept requesting tool calls without producing a final answer.
      // Make one last request without tools to force a direct text answer
      // instead of failing the whole request.
      console.log("No final text after tool rounds, requesting a direct answer without tools")
      const finalResult = await this.requestGemini(systemParts, nativeContents, undefined)
      full = finalResult.text
    }

    if (!full) {
      throw new Error("No content returned from Gemini API")
    }

    return full
  }

  private async requestGemini(
    systemText: string,
    contents: unknown[],
    tools: unknown
  ): Promise<{ text: string; functionCalls: { name: string; args: Record<string, unknown> }[]; finishReason: string | null }> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:streamGenerateContent?alt=sse`

    const requestBody: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: systemText }] },
      contents,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 8192,
        thinkingConfig: { thinkingLevel: "low" }
      }
    }

    if (tools !== undefined && tools !== null) {
      requestBody.tools = tools
    }

    const doFetch = async (): Promise<Response> => {
      const makeRequest = () =>
        fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": this.apiKey
          },
          signal: AbortSignal.timeout(120000),
          body: JSON.stringify(requestBody)
        })

      let lastError: Error | null = null
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) {
          const delayMs = attempt === 1 ? 2000 : 5000
          console.log(`Gemini rate-limited, retrying in ${delayMs / 1000}s (attempt ${attempt + 1}/3)`)
          await new Promise(resolve => setTimeout(resolve, delayMs))
        }
        const res = await makeRequest()
        if (res.ok) return res
        const errText = await res.text()
        lastError = new Error(`Gemini API error: ${res.status} - ${errText.slice(0, 300)}`)
        if (res.status !== 429 && res.status !== 503) throw lastError
      }
      throw lastError || new Error("Gemini API request failed")
    }

    let response = await doFetch()

    if (!response.ok) {
      const errorText = await response.text()
      if (response.status === 400 && /tool|function/i.test(errorText)) {
        console.log("Function calling rejected, retrying without tools")
        delete requestBody.tools
        response = await doFetch()
        if (!response.ok) {
          const errorText2 = await response.text()
          throw new Error(`Gemini API error: ${response.status} - ${errorText2.slice(0, 300)}`)
        }
      } else {
        throw new Error(`Gemini API error: ${response.status} - ${errorText.slice(0, 300)}`)
      }
    }

    let full = ""
    const functionCalls: { name: string; args: Record<string, unknown> }[] = []
    let usage: GeminiUsageMetadata | null = null
    let finishReason: string | null = null
    const decoder = new TextDecoder()
    let buffer = ""

    const processLine = (line: string) => {
      const trimmed = line.trim()
      if (!trimmed.startsWith("data: ")) return
      const payload = trimmed.slice(6)
      if (payload === "[DONE]") return
      try {
        const parsed = JSON.parse(payload)
        if (parsed.usageMetadata) {
          usage = parsed.usageMetadata as GeminiUsageMetadata
        }
        const candidates = parsed.candidates || []
        if (candidates.length > 0) {
          const parts = (candidates[0].content && candidates[0].content.parts) || []
          for (const p of parts) {
            if (p.text) full += p.text
            if (p.functionCall && p.functionCall.name) {
              functionCalls.push({
                name: p.functionCall.name,
                args: p.functionCall.args || {}
              })
            }
          }
          if (candidates[0].finishReason) {
            finishReason = candidates[0].finishReason
          }
        }
      } catch {
        // ignore partial-line parse errors
      }
    }

    for await (const chunk of response.body!) {
      buffer += decoder.decode(chunk, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() || ""
      for (const line of lines) {
        processLine(line)
      }
    }

    // Flush any final SSE line that arrived without a trailing newline.
    // Without this, the last chunk (which often carries the final text part
    // and the finishReason) is silently dropped and the answer gets cut.
    buffer += decoder.decode()
    if (buffer.trim()) {
      processLine(buffer)
    }

    console.log("FINISH REASON:", finishReason)
    const finalUsage = usage as GeminiUsageMetadata | null
    if (finalUsage) {
      console.log(
        `TOKENS: prompt=${finalUsage.promptTokenCount ?? "?"} output=${finalUsage.candidatesTokenCount ?? "?"} thoughts=${finalUsage.thoughtsTokenCount ?? "?"} total=${finalUsage.totalTokenCount ?? "?"}`
      )
    }
    if (finishReason === "MAX_TOKENS") {
      console.log("WARNING: Gemini response hit the output token limit")
    }

    return { text: full, functionCalls, finishReason }
  }
}
