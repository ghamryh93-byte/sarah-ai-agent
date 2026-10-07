const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

const MAX_RESULTS = 5
const MAX_RESULT_CHARS = 2400

const ENTITY_MAP: Record<string, string> = {
  ["&" + "amp;"]: "&",
  ["&" + "quot;"]: '"',
  ["&" + "#x27;"]: "'",
  ["&" + "#39;"]: "'",
  ["&" + "lt;"]: "<",
  ["&" + "gt;"]: ">",
  ["&" + "nbsp;"]: " "
}

function decodeEntities(text: string): string {
  let out = text
  for (const [entity, char] of Object.entries(ENTITY_MAP)) {
    out = out.split(entity).join(char)
  }
  return out.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
}

function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  )
}

function extractRealUrl(href: string): string {
  const match = href.match(/[?&]uddg=([^&"']+)/)
  if (match) {
    try {
      return decodeURIComponent(match[1])
    } catch {
      return href
    }
  }
  return href
}

export async function webSearch(query: string): Promise<string> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept-Language": "ar,en;q=0.8"
    },
    signal: AbortSignal.timeout(15000)
  })

  if (!response.ok) {
    throw new Error(`Web search failed with status ${response.status}`)
  }

  const html = await response.text()
  const results: string[] = []

  const blockRegex = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g

  let match: RegExpExecArray | null
  while ((match = blockRegex.exec(html)) !== null && results.length < MAX_RESULTS) {
    const realUrl = extractRealUrl(match[1])
    const title = stripTags(match[2])
    const snippet = stripTags(match[3])
    if (title && snippet) {
      results.push(`- ${title}: ${snippet} (Source: ${realUrl})`)
    }
  }

  if (results.length === 0) {
    return "No useful search results were found for this query."
  }

  const combined = results.join("\n")
  return combined.length > MAX_RESULT_CHARS ? combined.slice(0, MAX_RESULT_CHARS) : combined
}
