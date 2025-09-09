export type NodeType = 'user' | 'ai' | 'source' | 'system' | 'code';

export interface Source {
  uri: string;
  title: string;
}

export interface WeatherData {
    location: string;
    high: string;
    low:string;
}

export interface StockData {
    name: string;
    symbol: string;
    price: string;
    change: string;
    changePercent: string;
    direction: 'up' | 'down' | 'neutral';
}

export interface CodeData {
    language: string;
    content: string;
}

export interface NodeData {
  text: string;
  uri?: string; // Used for source nodes
  sources?: Source[]; // Used by AI node to report sources
  isLoading?: boolean;
  weather?: WeatherData;
  stock?: StockData;
  reasoning?: string;
  language?: string; // For code nodes
}

export interface DiagramNode {
  id: string;
  type: NodeType;
  data: NodeData;
  position: { x: number; y: number };
  width: number;
  height: number;
}

export interface Edge {
  id: string;
  source: string;
  target: string;
}
