import type { Source, WeatherData, StockData, DiagramNode, Edge, CodeData } from '../types';

export interface GroundedResponseData {
    sources: Source[];
    weather?: WeatherData;
    stock?: StockData;
    code?: CodeData;
    position?: { x: number, y: number };
    reasoning?: string;
    sourceNodeId?: string;
    fullText: string;
}

export const streamGroundedResponse = async (
    prompt: string,
    nodes: DiagramNode[],
    edges: Edge[],
    onStream: (textChunk: string) => void
): Promise<GroundedResponseData> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60-second timeout

    try {
        const response = await fetch('/api/gemini', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, nodes, edges }),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok || !response.body) {
            const errorText = await response.text();
            throw new Error(`API request failed with status ${response.status}: ${errorText}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = "";
        let jsonBlock = "";
        let inJsonBlock = false;
        let groundingMetadata;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const sseChunk = decoder.decode(value, { stream: true });
            const lines = sseChunk.split('\n');

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.substring(6);
                    if (data) {
                        try {
                            const chunk = JSON.parse(data);
                            if (chunk.error) {
                                throw new Error(`Stream error from server: ${chunk.error}`);
                            }
                            
                            if (chunk.candidates && chunk.candidates[0] && chunk.candidates[0].groundingMetadata) {
                                groundingMetadata = chunk.candidates[0].groundingMetadata;
                            }
                            
                            const chunkText = chunk.text ?? "";

                            if (!inJsonBlock) {
                                const jsonMarker = "```json";
                                const jsonStartIndex = chunkText.indexOf(jsonMarker);
                                if (jsonStartIndex !== -1) {
                                    inJsonBlock = true;
                                    const textPart = chunkText.substring(0, jsonStartIndex);
                                    onStream(textPart);
                                    fullText += textPart;
                                    jsonBlock += chunkText.substring(jsonStartIndex + jsonMarker.length);
                                } else {
                                    onStream(chunkText);
                                    fullText += chunkText;
                                }
                            } else {
                                jsonBlock += chunkText;
                            }
                        } catch(e) {
                            console.error("Error parsing SSE data chunk:", e, "Data:", data);
                        }
                    }
                }
            }
        }
        
        const finalJson = jsonBlock.replace(/```/g, "").trim();
        let parsedResponse: any = {};
        try {
            if (finalJson) {
                parsedResponse = JSON.parse(finalJson);
            }
        } catch (e) {
            console.error("Failed to parse JSON from stream:", finalJson);
        }

        const rawSources = groundingMetadata?.groundingChunks ?? [];
        const sources: Source[] = rawSources
            .map((chunk: any) => ({
                uri: chunk.web?.uri ?? '',
                title: chunk.web?.title ?? 'Untitled Source'
            }))
            .filter((source: Source) => source.uri);

        return { sources, ...parsedResponse, fullText };

    } catch (error) {
        console.error("Error fetching grounded response from API proxy:", error);
        let errorMessage;
        if (error instanceof Error && error.name === 'AbortError') {
             errorMessage = "The request timed out after 60 seconds. Please try a simpler prompt or check your connection.";
        } else {
             errorMessage = error instanceof Error ? error.message : String(error);
        }
        onStream(`\n\nSorry, I encountered an error: ${errorMessage}`);
        return { sources: [], fullText: "" };
    }
};
