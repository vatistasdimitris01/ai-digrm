import { GoogleGenAI } from "@google/genai";

// Types duplicated from ../types.ts for Vercel Deno runtime compatibility.
// In a full project with a build system, these could be shared.
type NodeType = 'user' | 'ai' | 'source' | 'system' | 'code';

interface Source {
  uri: string;
  title: string;
}

interface WeatherData {
    location: string;
    high: string;
    low:string;
}

interface StockData {
    name: string;
    symbol: string;
    price: string;
    change: string;
    changePercent: string;
    direction: 'up' | 'down' | 'neutral';
}

interface CodeData {
    language: string;
    content: string;
}

interface NodeData {
  text: string;
  uri?: string; // Used for source nodes
  sources?: Source[]; // Used by AI node to report sources
  isLoading?: boolean;
  weather?: WeatherData;
  stock?: StockData;
  reasoning?: string;
  language?: string; // For code nodes
}

interface DiagramNode {
  id: string;
  type: NodeType;
  data: NodeData;
  position: { x: number; y: number };
  width: number;
  height: number;
}

interface Edge {
  id: string;
  source: string;
  target: string;
}

const systemInstruction = `You are an expert diagramming assistant with powerful tools. Your primary goal is to create a clean, sparse, aesthetically pleasing mind-map. Spread nodes out significantly to avoid clutter.

**IMPORTANT**: Before responding, you MUST analyze the full \`Current Diagram State\` provided to understand the conversation's history and context. This is crucial for answering follow-up questions correctly.

**Your Capabilities:**
1.  **Code Generation & Extraction:** If a user asks for code, generate it. **IMPORTANT**: You MUST extract the code block from your markdown response and place it into the \`code\` field in your final JSON object. Do not leave it in the main text response.
2.  **Web Search:** You can search the web for real-time information. You MUST cite your sources. When you use a web source, mention it naturally in your response (e.g., "According to wunderground.com...") and also ensure it's available as a separate source node.
3.  **Intelligent Diagramming:** Analyze the user's prompt and the entire diagram to understand the conversational flow.

**Your Response process:**
1.  **Formulate Response:** Generate a helpful, Markdown-formatted text response. Briefly mention that you have provided a code block if applicable.
2.  **Structure Data (if applicable):**
    *   If the query is for weather or stocks, populate the corresponding JSON fields.
    *   If you generated code, populate the \`code\` field with \`language\` and \`content\`.
3.  **Determine Connection Point:** Identify the *most relevant* existing node to connect your response to. Provide its ID in the \`sourceNodeId\` field.
4.  **Determine Position:** Choose an optimal {x, y} coordinate for your new response node. The position should be aesthetically pleasing, avoid overlaps, and be placed with significant spacing from its source node (typically 600-900 units away).
5.  **Explain Your Reasoning:** Briefly explain why you chose that position in the \`reasoning\` field. E.g., "Placed below the data analysis question to show the computed result."
6.  **Streaming Output:** First, stream your full Markdown text response. After the text is fully streamed, you MUST append a single, final JSON object containing all other data inside a markdown code block: \`\`\`json ... \`\`\`.

**Final JSON object structure:**
{
  "weather": { "location": "Athens, Greece", "high": "88°F", "low": "72°F" } | null,
  "stock": { ... } | null,
  "code": { "language": "python", "content": "print('Hello, World!')" } | null,
  "position": { "x": <number>, "y": <number> },
  "reasoning": "Your brief explanation for the placement choice.",
  "sourceNodeId": "ID of the most relevant node to connect to."
}`;

export default async (req: Request): Promise<Response> => {
    const apiKey = process.env.API_KEY;
    if (!apiKey) {
        return new Response(JSON.stringify({ error: "API_KEY environment variable not set" }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
    
    if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    try {
        const { prompt, nodes, edges } = await req.json() as { prompt: string; nodes: DiagramNode[]; edges: Edge[] };
        
        const ai = new GoogleGenAI({ apiKey });
        
        const promptPayload = `User prompt: "${prompt}"\n\nCurrent Diagram State:\nNodes: ${JSON.stringify(nodes.map(n => ({id: n.id, type: n.type, position: n.position, data: { text: n.data.text.substring(0, 100) + '...'}})))}\nEdges: ${JSON.stringify(edges)}`;

        const stream = await ai.models.generateContentStream({
            model: "gemini-2.5-flash",
            contents: promptPayload,
            config: {
                tools: [{ googleSearch: {} }],
                systemInstruction,
            },
        });

        const readableStream = new ReadableStream({
            async start(controller) {
                try {
                    for await (const chunk of stream) {
                        const chunkPayload = JSON.stringify(chunk);
                        controller.enqueue(new TextEncoder().encode(`data: ${chunkPayload}\n\n`));
                    }
                } catch (error) {
                    console.error("Error during stream processing:", error);
                    const errorChunk = JSON.stringify({ error: error.message });
                    controller.enqueue(new TextEncoder().encode(`data: ${errorChunk}\n\n`));
                } finally {
                    controller.close();
                }
            },
        });

        return new Response(readableStream, {
            headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
            },
        });

    } catch (error) {
        console.error("Error in serverless function:", error);
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
};
