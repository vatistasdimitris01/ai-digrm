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

const responseSchema = {
    type: Type.OBJECT,
    properties: {
        responseText: { type: Type.STRING, description: "Your full, helpful, Markdown-formatted text response to the user." },
        weather: { 
            type: Type.OBJECT,
            nullable: true,
            properties: {
                location: { type: Type.STRING },
                high: { type: Type.STRING },
                low: { type: Type.STRING }
            }
        },
        stock: {
            type: Type.OBJECT,
            nullable: true,
            properties: {
                name: { type: Type.STRING },
                symbol: { type: Type.STRING },
                price: { type: Type.STRING },
                change: { type: Type.STRING },
                changePercent: { type: Type.STRING },
                direction: { type: Type.STRING, enum: ['up', 'down', 'neutral'] }
            }
        },
        code: {
            type: Type.OBJECT,
            nullable: true,
            properties: {
                language: { type: Type.STRING },
                content: { type: Type.STRING }
            }
        },
        position: {
            type: Type.OBJECT,
            properties: {
                x: { type: Type.NUMBER },
                y: { type: Type.NUMBER }
            }
        },
        reasoning: { type: Type.STRING, description: "Brief explanation for the placement choice of the new node." },
        sourceNodeId: { type: Type.STRING, description: "ID of the most relevant existing node to connect this response to." }
    },
    required: ["responseText", "position", "reasoning", "sourceNodeId"]
};


const systemInstruction = `You are an expert diagramming assistant. Your goal is to create a clean, aesthetically pleasing mind-map. Analyze the user's prompt and the provided diagram state to give a helpful response and determine the best placement for it.

- **Diagram Analysis:** Use the provided diagram nodes and edges to understand the conversation history.
- **Web Search:** Use your web search tool for real-time information and cite your sources in the response text.
- **Node Placement:**
    - Identify the most relevant existing node to connect your response to and provide its ID in \`sourceNodeId\`.
    - Choose an optimal {x, y} coordinate for your new response node. It should be aesthetically pleasing, avoid overlaps, and be placed with significant spacing from its source node (typically 600-900 units away).
- **Tool Usage:** If the user asks for weather, stocks, or code, populate the corresponding fields in the JSON output. For code, ensure the \`code\` object is populated and do not include the code block in the main \`responseText\`.
- **Response Format:** You MUST respond ONLY with a valid JSON object that conforms to the provided schema.`;

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
                responseMimeType: "application/json",
                responseSchema,
            },
        });

        const responseJson = JSON.parse(result.text);
        const rawSources = result.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
        const sources = rawSources
            .map((chunk: any) => ({
                uri: chunk.web?.uri ?? '',
                title: chunk.web?.title ?? 'Untitled Source'
            }))
            .filter((source: { uri: string; }) => source.uri);

        const finalPayload = { ...responseJson, sources };

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
