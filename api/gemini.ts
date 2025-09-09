import { GoogleGenAI, Type } from "@google/genai";

export const config = {
  runtime: 'edge',
};

// Types duplicated from ../types.ts for Vercel Deno runtime compatibility.
type NodeType = 'user' | 'ai' | 'source' | 'system' | 'code';
interface DiagramNode {
  id: string;
  type: NodeType;
  data: { text: string };
  position: { x: number; y: number };
}
interface Edge {
  id: string;
  source: string;
  target: string;
}

const systemInstruction = `You are an expert diagramming assistant. Your goal is to create a clean, aesthetically pleasing mind-map. Analyze the user's prompt and the provided diagram state to give a helpful response and determine the best placement for it.

- **Diagram Analysis:** Use the provided diagram nodes and edges to understand the conversation history.
- **Web Search:** Use your web search tool for real-time information.
- **Node Placement:**
    - Identify the most relevant existing node to connect your response to and provide its ID in \`sourceNodeId\`.
    - Choose an optimal {x, y} coordinate for your new response node. It should be aesthetically pleasing, avoid overlaps, and be placed with significant spacing from its source node (typically 600-900 units away).
- **Tool Usage:** If the user asks for weather, stocks, or code, populate the corresponding fields in the JSON output. For code, ensure the \`code\` object is populated and do not include the code block in the main response text.
- **Response Format:** You MUST output a helpful, Markdown-formatted text response first. After your text response, you MUST provide a single, valid JSON code block that contains all the structured data (position, reasoning, sourceNodeId, and any tool data). The JSON block must start with \`\`\`json and end with \`\`\`.

Example response format:
This is a helpful text response about the topic.

\`\`\`json
{
  "position": {"x": 100, "y": 200},
  "reasoning": "Placed near the user's question.",
  "sourceNodeId": "user-12345",
  "weather": null,
  "stock": null,
  "code": null
}
\`\`\``;


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

        const result = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: promptPayload,
            config: {
                tools: [{ googleSearch: {} }],
                systemInstruction,
            },
        });

        const fullResponseText = result.text;
        const jsonBlockRegex = /```json\s*([\s\S]*?)\s*```/;
        const jsonMatch = fullResponseText.match(jsonBlockRegex);
        
        let parsedJsonData: any = {};
        let responseText = fullResponseText;

        if (jsonMatch && jsonMatch[1]) {
            try {
                parsedJsonData = JSON.parse(jsonMatch[1]);
                responseText = fullResponseText.substring(0, jsonMatch.index).trim();
            } catch (e) {
                console.error("Failed to parse JSON from model response:", e);
                responseText = "Sorry, the AI returned an invalid response. Please try again.";
            }
        }
        
        const rawSources = result.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
        const sources = rawSources
            .map((chunk: any) => ({
                uri: chunk.web?.uri ?? '',
                title: chunk.web?.title ?? 'Untitled Source'
            }))
            .filter((source: { uri: string; }) => source.uri);

        const finalPayload = { ...parsedJsonData, responseText, sources };
        
        // Add fallbacks for required fields to prevent frontend errors
        if (!finalPayload.position) {
            const lastNode = nodes[nodes.length - 1] || { position: { x: 0, y: 0 } };
            finalPayload.position = { x: lastNode.position.x, y: lastNode.position.y + 350 };
        }
        if (!finalPayload.sourceNodeId) {
            const lastUserNode = nodes.filter(n => n.type === 'user').pop();
            finalPayload.sourceNodeId = lastUserNode ? lastUserNode.id : 'start-node';
        }
        if (!finalPayload.reasoning) {
            finalPayload.reasoning = "Placement determined by default logic.";
        }

        return new Response(JSON.stringify(finalPayload), {
            headers: { "Content-Type": "application/json" },
        });

    } catch (error) {
        console.error("Error in serverless function:", error);
        const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
        return new Response(JSON.stringify({ error: errorMessage }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
};