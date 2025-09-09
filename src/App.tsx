import React, { useState, useCallback, useRef, useEffect } from 'react';
import type { DiagramNode, Edge, NodeData, Source, CodeData } from './types';
import ChatInput from './components/ChatInput';
import DiagramView, { type DiagramViewHandle } from './components/DiagramView';
import { getGroundedResponse } from './services/geminiService';
import { HomeIcon, SunIcon, MoonIcon, ResetFocusIcon, ExportIcon } from './components/Icons';

const NODE_WIDTH = 350;
const USER_NODE_HEIGHT = 80;
const AI_NODE_BASE_HEIGHT = 150;
const SOURCE_NODE_HEIGHT = 80;
const CODE_NODE_WIDTH = 500;

const findNonOverlappingPosition = (
    nodes: DiagramNode[],
    startPos: { x: number; y: number },
    nodeWidth: number,
    nodeHeight: number
): { x: number; y: number } => {
    const PADDING = 80;
    let currentPos = { ...startPos };
    let isOverlapping = true;
    let attempts = 0;
    const maxAttempts = 200; 
    let angle = Math.random() * Math.PI * 2;
    let step = 250;
    let turn = 0;

    while (isOverlapping && attempts < maxAttempts) {
        isOverlapping = false;
        for (const node of nodes) {
            const dx = Math.abs(currentPos.x - node.position.x);
            const dy = Math.abs(currentPos.y - node.position.y);
            const minXDist = (nodeWidth + node.width) / 2 + PADDING;
            const minYDist = (nodeHeight + node.height) / 2 + PADDING;

            if (dx < minXDist && dy < minYDist) {
                isOverlapping = true;
                break;
            }
        }

        if (isOverlapping) {
            currentPos = {
                x: startPos.x + step * Math.cos(angle),
                y: startPos.y + step * Math.sin(angle),
            };
            angle += Math.PI / 3.5; 
            turn++;
            if (turn > 0 && turn % 7 === 0) {
                step += 150;
            }
        }
        attempts++;
    }
    return currentPos;
};

const estimateAiNodeSize = (data: Partial<NodeData> & { code?: CodeData }): { width: number, height: number } => {
    const baseWidth = NODE_WIDTH;
    let estimatedHeight = 40; 

    if (data.weather) estimatedHeight += 70;
    if (data.stock) estimatedHeight += 90;
    if (data.reasoning) estimatedHeight += 60;
    if (data.text) {
        const lines = (data.text.match(/\n/g) || []).length + 1;
        const textHeight = Math.max(lines * 20, data.text.length * 0.45); 
        estimatedHeight += textHeight;
    }

    return { width: baseWidth, height: Math.max(AI_NODE_BASE_HEIGHT, Math.min(800, estimatedHeight)) };
};

const getDescendants = (startNodeId: string, nodes: DiagramNode[], edges: Edge[]): Set<string> => {
    const descendants = new Set<string>();
    const queue = [startNodeId];
    const visited = new Set<string>([startNodeId]);

    while (queue.length > 0) {
        const currentId = queue.shift()!;
        edges.forEach(edge => {
            if (edge.source === currentId && !visited.has(edge.target)) {
                descendants.add(edge.target);
                visited.add(edge.target);
                queue.push(edge.target);
            }
        });
    }
    return descendants;
};


const App: React.FC = () => {
    const [theme, setTheme] = useState<'dark' | 'light'>(localStorage.theme || 'dark');
    const [nodes, setNodes] = useState<DiagramNode[]>([
        {
            id: 'start-node',
            type: 'system',
            data: { text: "Hello! I can place my responses anywhere on the canvas and connect them to the most relevant thoughts. Ask me anything!" },
            position: { x: 0, y: 0 },
            width: NODE_WIDTH + 50,
            height: USER_NODE_HEIGHT
        }
    ]);
    const [edges, setEdges] = useState<Edge[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
    const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
    const lastUserNodeId = useRef<string>('start-node');
    const diagramViewRef = useRef<DiagramViewHandle>(null);

    const nodesRef = useRef(nodes);
    useEffect(() => { nodesRef.current = nodes; }, [nodes]);
    const edgesRef = useRef(edges);
    useEffect(() => { edgesRef.current = edges; }, [edges]);

    useEffect(() => {
        if (theme === 'dark') {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }
        localStorage.setItem('theme', theme);
    }, [theme]);

    const handleToggleTheme = () => setTheme(theme === 'light' ? 'dark' : 'light');
    
    const handleResetView = () => {
        setFocusedNodeId(null);
        diagramViewRef.current?.zoomToFit();
    };

    const handleExport = useCallback(() => {
        diagramViewRef.current?.exportAsPng();
    }, []);

    const handleNodeClick = (nodeId: string) => {
        if (editingNodeId && editingNodeId !== nodeId) {
            setEditingNodeId(null);
        }
        const newFocusedId = focusedNodeId === nodeId ? null : nodeId;
        setFocusedNodeId(newFocusedId);
        if (newFocusedId) {
            diagramViewRef.current?.focusOnNode(nodeId);
        }
    };
    
    const handleClearFocus = () => {
        setFocusedNodeId(null);
        setEditingNodeId(null);
    }

    const handleNodeMeasured = useCallback((nodeId: string, width: number, height: number) => {
        setNodes(prevNodes => {
            const nodeToUpdate = prevNodes.find(n => n.id === nodeId);
            if (nodeToUpdate && (nodeToUpdate.width !== width || nodeToUpdate.height !== height)) {
                return prevNodes.map(n => (n.id === nodeId ? { ...n, width, height } : n));
            }
            return prevNodes;
        });
    }, []);
    
    const handleCopy = useCallback((text: string) => {
        navigator.clipboard.writeText(text);
    }, []);
    
    const handleRegenerate = useCallback((nodeId: string) => {
        if (!window.confirm("This will delete this response and all subsequent responses. Are you sure you want to regenerate?")) {
            return;
        }
        const currentNodes = nodesRef.current;
        const currentEdges = edgesRef.current;
        
        const parentEdge = currentEdges.find(e => e.target === nodeId);
        if (!parentEdge) return;
        
        const parentNode = currentNodes.find(n => n.id === parentEdge.source);
        if (!parentNode || parentNode.type !== 'user') return;
        
        const descendants = getDescendants(nodeId, currentNodes, currentEdges);
        descendants.add(nodeId);
        
        setNodes(currentNodes.filter(n => !descendants.has(n.id)));
        setEdges(currentEdges.filter(e => !descendants.has(e.source) && !descendants.has(e.target)));
        
        lastUserNodeId.current = parentNode.id;
        handleSend(parentNode.data.text);
    }, []);

    const handleEdit = useCallback((nodeId: string) => {
        setFocusedNodeId(nodeId);
        setEditingNodeId(nodeId);
    }, []);

    const handleCancelEdit = useCallback(() => {
        setEditingNodeId(null);
    }, []);

    const handleSaveEdit = useCallback((nodeId: string, newText: string) => {
        setEditingNodeId(null);
        const currentNodes = nodesRef.current;
        const originalNode = currentNodes.find(n => n.id === nodeId);
        if (!originalNode || newText.trim() === "" || newText === originalNode.data.text) {
            return;
        }

        const currentEdges = edgesRef.current;
        const descendants = getDescendants(nodeId, currentNodes, currentEdges);
        
        setNodes(currentNodes.map(n => n.id === nodeId ? {...n, data: {...n.data, text: newText}} : n).filter(n => !descendants.has(n.id)));
        setEdges(currentEdges.filter(e => !descendants.has(e.source) && !descendants.has(e.target)));
        
        lastUserNodeId.current = nodeId;
        handleSend(newText);
    }, []);


    const handleSend = useCallback(async (prompt: string, sourceNodeOverride?: string) => {
        setIsLoading(true);
        setFocusedNodeId(null);
        setEditingNodeId(null);
        
        const sourceNodeId = sourceNodeOverride || lastUserNodeId.current;
        const currentNodes = nodesRef.current; 

        const sourceNode = currentNodes.find(n => n.id === sourceNodeId) ?? currentNodes[0];
        const userNodeId = `user-${Date.now()}`;
        const aiNodeId = `ai-${Date.now()}`;
        
        const randomAngle = Math.random() * 2 * Math.PI;
        const distance = 600;
        const initialUserNodePos = {
            x: sourceNode.position.x + Math.cos(randomAngle) * distance,
            y: sourceNode.position.y + Math.sin(randomAngle) * distance,
        };

        const finalUserNodePos = findNonOverlappingPosition(currentNodes, initialUserNodePos, NODE_WIDTH, USER_NODE_HEIGHT);
        
        const userNode: DiagramNode = {
            id: userNodeId, type: 'user', data: { text: prompt },
            position: finalUserNodePos,
            width: NODE_WIDTH, height: USER_NODE_HEIGHT
        };
        const nodesWithUser = [...currentNodes, userNode];

        const initialThinkingPos = { x: userNode.position.x, y: userNode.position.y + 350 };
        const finalThinkingPos = findNonOverlappingPosition(nodesWithUser, initialThinkingPos, NODE_WIDTH, AI_NODE_BASE_HEIGHT);
        const thinkingNode: DiagramNode = {
            id: aiNodeId, type: 'ai', data: { text: '', isLoading: true },
            position: finalThinkingPos,
            width: NODE_WIDTH, height: AI_NODE_BASE_HEIGHT
        };
        
        const userEdge: Edge = { id: `${sourceNode.id}-to-${userNodeId}`, source: sourceNode.id, target: userNodeId };
        const thinkingEdge: Edge = { id: `${userNodeId}-to-${aiNodeId}`, source: userNodeId, target: aiNodeId };
        
        setNodes([...nodesWithUser, thinkingNode]);
        setEdges(prev => [...prev, userEdge, thinkingEdge]);
        lastUserNodeId.current = userNodeId;
        setTimeout(() => diagramViewRef.current?.focusOnNode(userNodeId), 100);

        const MAX_CONTEXT_NODES = 15;
        const recentNodes = nodesWithUser.slice(-MAX_CONTEXT_NODES);
        const recentNodeIds = new Set(recentNodes.map(n => n.id));
        const recentEdges = edgesRef.current.filter(e => recentNodeIds.has(e.source) || recentNodeIds.has(e.target));

        try {
            const response = await getGroundedResponse(prompt, recentNodes, recentEdges);
            const { sources, weather, stock, code, position, reasoning, sourceNodeId: connectionTargetId, responseText } = response;
            
            if (!responseText) {
                throw new Error("AI returned an empty response.");
            }

            const finalAiData: NodeData = { text: responseText, weather, stock, reasoning, isLoading: false, sources };
            const estimatedSize = estimateAiNodeSize({...finalAiData, code });

            const nodesToPlaceInfo: Array<{ id: string, type: 'ai' | 'source' | 'code', data: NodeData, width: number, height: number, startPos: { x: number, y: number } }> = [];
            
            const aiStartPos = position || { x: userNode.position.x, y: userNode.position.y + 600 };
            nodesToPlaceInfo.push({ id: aiNodeId, type: 'ai', data: finalAiData, width: estimatedSize.width, height: estimatedSize.height, startPos: aiStartPos });
            
            const newSourceInfos: Array<Source> = [];
            const existingSourcesMap = new Map<string, string>();
            nodesRef.current.forEach(n => {
                if (n.type === 'source' && n.data.uri) existingSourcesMap.set(n.data.uri, n.id);
            });

            if (sources) {
                sources.forEach(source => {
                    if (!existingSourcesMap.has(source.uri)) {
                        newSourceInfos.push(source);
                        existingSourcesMap.set(source.uri, `new-source-${source.uri}`); // Placeholder
                    }
                });
            }
            
            newSourceInfos.forEach((source, index) => {
                const sourceNodeStartPos = {
                    x: aiStartPos.x + (index - (newSourceInfos.length - 1) / 2) * (NODE_WIDTH + 80),
                    y: aiStartPos.y + 400,
                };
                nodesToPlaceInfo.push({ id: `source-${Date.now()}-${index}`, type: 'source', data: { text: source.title, uri: source.uri }, width: NODE_WIDTH, height: SOURCE_NODE_HEIGHT, startPos: sourceNodeStartPos });
            });

            if (code) {
                 const codeNodeStartPos = { x: aiStartPos.x, y: aiStartPos.y + 400 };
                 nodesToPlaceInfo.push({ id: `code-${Date.now()}`, type: 'code', data: { text: code.content, language: code.language }, width: CODE_NODE_WIDTH, height: 200, startPos: codeNodeStartPos });
            }
            
            let collisionCheckNodes = nodesRef.current.filter(n => n.id !== aiNodeId);
            const newlyPlacedNodes: DiagramNode[] = [];
            
            nodesToPlaceInfo.forEach(info => {
                const finalPosition = findNonOverlappingPosition(collisionCheckNodes, info.startPos, info.width, info.height);
                const finalNode: DiagramNode = { ...info, position: finalPosition };
                newlyPlacedNodes.push(finalNode);
                collisionCheckNodes.push(finalNode);
            });

            const newSourceNodes = newlyPlacedNodes.filter(n => n.type === 'source');
            const newCodeNode = newlyPlacedNodes.find(n => n.type === 'code');
            
            const newEdges: Edge[] = [];
            
            if (sources) {
                sources.forEach(source => {
                    const sourceId = existingSourcesMap.get(source.uri) ?? newSourceNodes.find(n => n.data.uri === source.uri)?.id;
                    if (sourceId) {
                        newEdges.push({ id: `${aiNodeId}-to-${sourceId}`, source: aiNodeId, target: sourceId });
                    }
                });
            }
            
            if (newCodeNode) {
                newEdges.push({ id: `${aiNodeId}-to-${newCodeNode.id}`, source: aiNodeId, target: newCodeNode.id });
            }
            
            setNodes(prev => [...prev.filter(n => n.id !== aiNodeId), ...newlyPlacedNodes]);
            
            setEdges(prev => {
                const connectionSourceId = connectionTargetId && nodesRef.current.some(n => n.id === connectionTargetId) ? connectionTargetId : userNodeId;
                const edgesWithoutTemporary = prev.filter(e => e.target !== aiNodeId);
                const finalEdges = [...edgesWithoutTemporary, ...newEdges];
                finalEdges.push({id: `${connectionSourceId}-to-${aiNodeId}`, source: connectionSourceId, target: aiNodeId});
                return finalEdges.filter((edge, index, self) => index === self.findIndex(e => (e.source === edge.source && e.target === edge.target)));
            });
            
            setTimeout(() => {
                 diagramViewRef.current?.focusOnNode(aiNodeId);
                 setFocusedNodeId(aiNodeId);
            }, 100);

        } catch (error) {
            console.error("Failed to get AI response:", error);
            const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
            setNodes(prev => prev.map(n => 
                n.id === aiNodeId 
                ? { ...n, data: { ...n.data, text: `Sorry, an error occurred: ${errorMessage}`, isLoading: false } } 
                : n
            ));
        } finally {
            setIsLoading(false);
        }

    }, []);

    return (
        <main className="h-screen w-screen text-gray-900 dark:text-white overflow-hidden relative font-sans bg-slate-50 dark:bg-gray-900">
            <DiagramView ref={diagramViewRef} nodes={nodes} edges={edges} theme={theme} focusedNodeId={focusedNodeId} editingNodeId={editingNodeId} onNodeClick={handleNodeClick} onClearFocus={handleClearFocus} onNodeMeasured={handleNodeMeasured} onCopy={handleCopy} onRegenerate={handleRegenerate} onEdit={handleEdit} onSaveEdit={handleSaveEdit} onCancelEdit={handleCancelEdit} />
            <div className="absolute top-4 left-4 z-10 flex items-center gap-2">
                <button 
                    onClick={handleResetView}
                    className="p-3 bg-white/80 dark:bg-gray-800/80 backdrop-blur-md rounded-full text-gray-600 dark:text-gray-300 hover:text-black dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-700 transition-all duration-200 shadow-lg"
                    title="Zoom to Fit"
                >
                    <HomeIcon className="w-6 h-6" />
                </button>
                 <button 
                    onClick={handleExport}
                    className="p-3 bg-white/80 dark:bg-gray-800/80 backdrop-blur-md rounded-full text-gray-600 dark:text-gray-300 hover:text-black dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-700 transition-all duration-200 shadow-lg"
                    title="Export as PNG"
                >
                    <ExportIcon className="w-6 h-6" />
                </button>
                 {focusedNodeId && (
                    <button 
                        onClick={handleClearFocus}
                        className="p-3 bg-white/80 dark:bg-gray-800/80 backdrop-blur-md rounded-full text-gray-600 dark:text-gray-300 hover:text-black dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-700 transition-all duration-200 shadow-lg"
                        title="Reset Focus"
                    >
                        <ResetFocusIcon className="w-6 h-6" />
                    </button>
                )}
            </div>
            <div className="absolute top-4 right-4 z-10">
                 <button 
                    onClick={handleToggleTheme}
                    className="p-3 bg-white/80 dark:bg-gray-800/80 backdrop-blur-md rounded-full text-gray-600 dark:text-gray-300 hover:text-black dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-700 transition-all duration-200 shadow-lg"
                    title="Toggle Theme"
                >
                    {theme === 'light' ? <MoonIcon className="w-6 h-6" /> : <SunIcon className="w-6 h-6" />}
                </button>
            </div>
            <ChatInput onSend={(prompt) => handleSend(prompt)} isLoading={isLoading} />
        </main>
    );
};

export default App;
