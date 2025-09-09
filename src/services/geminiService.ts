import type { Source, WeatherData, StockData, DiagramNode, Edge, CodeData } from '../types';

export interface GroundedResponseData {
    sources: Source[];
    weather?: WeatherData;
    stock?: StockData;
    code?: CodeData;
    position?: { x: number, y: number };
    reasoning?: string;
    sourceNodeId?: string;
    responseText: string;
}

export const getGroundedResponse = async (
    prompt: string,
    nodes: DiagramNode[],
    edges: Edge[],
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

        if (!response.ok) {
            const errorBody = await response.json().catch(() => ({ error: 'Failed to parse error response.' }));
            const errorText = errorBody.error || `API request failed with status ${response.status}`;
            throw new Error(errorText);
        }

        return await response.json();

    } catch (error) {
        console.error("Error fetching grounded response from API proxy:", error);
        let errorMessage;
        if (error instanceof Error && error.name === 'AbortError') {
             errorMessage = "The request timed out after 60 seconds. Please try a simpler prompt or check your connection.";
        } else {
             errorMessage = error instanceof Error ? error.message : String(error);
        }
        throw new Error(errorMessage);
    }
};
