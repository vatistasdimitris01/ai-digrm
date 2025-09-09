import React, { useMemo, useRef, useEffect, useState, forwardRef, useImperativeHandle } from 'react';
import type { DiagramNode, Edge } from '../types';
import DiagramNodeComponent from './DiagramNode';

interface DiagramViewProps {
  nodes: DiagramNode[];
  edges: Edge[];
  theme: 'light' | 'dark';
  focusedNodeId: string | null;
  onNodeClick: (nodeId: string) => void;
  onClearFocus: () => void;
  onNodeMeasured: (nodeId: string, width: number, height: number) => void;
  onCopy: (text: string) => void;
  onRegenerate: (nodeId: string) => void;
  onEdit: (nodeId: string, currentText: string) => void;
}

export interface DiagramViewHandle {
  zoomToFit: () => void;
  focusOnNode: (nodeId: string) => void;
}

interface Point {
    x: number;
    y: number;
}

const getBoundaryPoint = (source: DiagramNode, target: DiagramNode, offset: number = 0): Point => {
    const sourceCenter = { x: source.position.x, y: source.position.y };
    const targetCenter = { x: target.position.x, y: target.position.y };

    const dx = targetCenter.x - sourceCenter.x;
    const dy = targetCenter.y - sourceCenter.y;

    if (dx === 0 && dy === 0) return sourceCenter;

    const angle = Math.atan2(dy, dx);

    const halfWidth = source.width / 2;
    const halfHeight = source.height / 2;
    const cornerAngle = Math.atan2(halfHeight, halfWidth);
    let x, y;

    if (-cornerAngle <= angle && angle <= cornerAngle) {
        x = sourceCenter.x + halfWidth; y = sourceCenter.y + halfWidth * Math.tan(angle);
    } else if (cornerAngle < angle && angle < Math.PI - cornerAngle) {
        y = sourceCenter.y + halfHeight; x = sourceCenter.x + halfHeight / Math.tan(angle);
    } else if (angle >= Math.PI - cornerAngle || angle <= -(Math.PI - cornerAngle)) {
        x = sourceCenter.x - halfWidth; y = sourceCenter.y - halfWidth * Math.tan(angle);
    } else {
        y = sourceCenter.y - halfHeight; x = sourceCenter.x - halfHeight / Math.tan(angle);
    }

    if (offset > 0) {
        const norm = Math.sqrt(dx*dx + dy*dy);
        x -= (dx/norm) * offset;
        y -= (dy/norm) * offset;
    }
    
    return { x, y };
};

const DiagramView = forwardRef<DiagramViewHandle, DiagramViewProps>(({ nodes, edges, theme, focusedNodeId, onNodeClick, onClearFocus, onNodeMeasured, onCopy, onRegenerate, onEdit }, ref) => {
    const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });
    const viewRef = useRef<HTMLDivElement>(null);
    const isPanning = useRef(false);
    const isAnimating = useRef(false);
    const animationTimeout = useRef<number | null>(null);
    const lastMousePosition = useRef({ x: 0, y: 0 });

    const nodeMap = useMemo(() => new Map(nodes.map(node => [node.id, node])), [nodes]);

    const activeNodeIds = useMemo(() => {
        if (!focusedNodeId) return null;

        const primaryActive = new Set<string>([focusedNodeId]);
        edges.forEach(edge => {
            if (edge.source === focusedNodeId) primaryActive.add(edge.target);
            if (edge.target === focusedNodeId) primaryActive.add(edge.source);
        });

        const finalActiveIds = new Set<string>(primaryActive);
        
        primaryActive.forEach(activeId => {
             edges.forEach(edge => {
                let otherNodeId: string | null = null;
                if (edge.source === activeId) otherNodeId = edge.target;
                
                if (otherNodeId) {
                    const otherNode = nodeMap.get(otherNodeId);
                    if (otherNode && (otherNode.type === 'source' || otherNode.type === 'code')) {
                        finalActiveIds.add(otherNodeId);
                    }
                }
            });
        });

        return finalActiveIds;
    }, [focusedNodeId, edges, nodeMap]);


    const contentBounds = useMemo(() => {
        if (nodes.length === 0) return { width: window.innerWidth, height: window.innerHeight, offsetX: 0, offsetY: 0 };
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        nodes.forEach(n => {
            const left = n.position.x - n.width / 2;
            const right = n.position.x + n.width / 2;
            const top = n.position.y - n.height / 2;
            const bottom = n.position.y + n.height / 2;
            if (left < minX) minX = left;
            if (right > maxX) maxX = right;
            if (top < minY) minY = top;
            if (bottom > maxY) maxY = bottom;
        });
        return { width: (maxX - minX) + 2000, height: (maxY - minY) + 2000, offsetX: minX - 1000, offsetY: minY - 1000 };
    }, [nodes]);

    const animateToTransform = (targetTransform: { scale: number, x: number, y: number }) => {
        if (animationTimeout.current) clearTimeout(animationTimeout.current);
        isAnimating.current = true;
        setTransform(targetTransform);
        animationTimeout.current = window.setTimeout(() => {
            isAnimating.current = false;
        }, 700);
    };

    const focusOnNode = (nodeId: string) => {
        const node = nodeMap.get(nodeId);
        const view = viewRef.current;
        if (!node || !view) return;
        
        const targetScale = 1.0;
        const viewWidth = view.clientWidth;
        const viewHeight = view.clientHeight;
        const newX = -node.position.x * targetScale + viewWidth / 2;
        const newY = -node.position.y * targetScale + viewHeight / 2;
        
        animateToTransform({ scale: targetScale, x: newX, y: newY });
    };

    const zoomToFit = () => {
        const view = viewRef.current;
        if (!view || nodes.length === 0) return;
    
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        nodes.forEach(n => {
            minX = Math.min(minX, n.position.x - n.width / 2);
            maxX = Math.max(maxX, n.position.x + n.width / 2);
            minY = Math.min(minY, n.position.y - n.height / 2);
            maxY = Math.max(maxY, n.position.y + n.height / 2);
        });
    
        const contentWidth = maxX - minX;
        const contentHeight = maxY - minY;
    
        if (contentWidth <= 0 || contentHeight <= 0) {
            focusOnNode(nodes[0].id);
            return;
        }
        
        const viewWidth = view.clientWidth;
        const viewHeight = view.clientHeight;
        const padding = 150;
        const scaleX = (viewWidth - padding * 2) / contentWidth;
        const scaleY = (viewHeight - padding * 2) / contentHeight;
        const newScale = Math.min(scaleX, scaleY, 1.2);
    
        const contentCenterX = minX + contentWidth / 2;
        const contentCenterY = minY + contentHeight / 2;
        const newX = -contentCenterX * newScale + viewWidth / 2;
        const newY = -contentCenterY * newScale + viewHeight / 2;
    
        animateToTransform({ scale: newScale, x: newX, y: newY });
    };

    useImperativeHandle(ref, () => ({ zoomToFit, focusOnNode }));

    useEffect(() => { if (viewRef.current && nodes.length === 1) focusOnNode('start-node') }, [nodes.length]);
    
    useEffect(() => {
        const view = viewRef.current;
        if (!view) return;

        const handleWheel = (e: WheelEvent) => {
            e.preventDefault();
            isAnimating.current = false;
            if(animationTimeout.current) clearTimeout(animationTimeout.current);

            const { clientX, clientY, deltaY, ctrlKey } = e;
            const rect = view.getBoundingClientRect();
            setTransform(prev => {
                const scaleFactor = ctrlKey ? Math.pow(0.995, deltaY) : 1 - deltaY * 0.001;
                const newScale = Math.max(0.1, Math.min(2, prev.scale * scaleFactor));
                const mouseX = clientX - rect.left;
                const mouseY = clientY - rect.top;
                const worldX = (mouseX - prev.x) / prev.scale;
                const worldY = (mouseY - prev.y) / prev.scale;
                const newX = mouseX - worldX * newScale;
                const newY = mouseY - worldY * newScale;
                return { scale: newScale, x: newX, y: newY };
            });
        };

        const handleMouseDown = (e: MouseEvent) => {
            if (e.target !== e.currentTarget) return;
            isAnimating.current = false;
            if(animationTimeout.current) clearTimeout(animationTimeout.current);
            isPanning.current = true;
            lastMousePosition.current = { x: e.clientX, y: e.clientY };
            view.style.cursor = 'grabbing';
        };

        const handleMouseUp = () => { 
            isPanning.current = false;
            view.style.cursor = 'grab';
         };

        const handleMouseMove = (e: MouseEvent) => {
            if (isPanning.current) {
                const dx = e.clientX - lastMousePosition.current.x;
                const dy = e.clientY - lastMousePosition.current.y;
                lastMousePosition.current = { x: e.clientX, y: e.clientY };
                setTransform(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
            }
        };

        const handleBackgroundClick = (e: MouseEvent) => {
            if (e.target === e.currentTarget) {
                onClearFocus();
            }
        };

        view.addEventListener('wheel', handleWheel, { passive: false });
        view.addEventListener('mousedown', handleMouseDown);
        view.addEventListener('click', handleBackgroundClick);
        window.addEventListener('mouseup', handleMouseUp);
        view.addEventListener('mousemove', handleMouseMove);

        return () => {
            view.removeEventListener('wheel', handleWheel);
            view.removeEventListener('mousedown', handleMouseDown);
            view.removeEventListener('click', handleBackgroundClick);
            window.removeEventListener('mouseup', handleMouseUp);
            view.removeEventListener('mousemove', handleMouseMove);
            if(animationTimeout.current) clearTimeout(animationTimeout.current);
        };
    }, [onClearFocus]);
    
    const arrowColor = theme === 'dark' ? '#6b7280' : '#9ca3af';

    return (
        <div ref={viewRef} className="w-full h-full absolute inset-0 overflow-hidden cursor-grab active:cursor-grabbing bg-slate-50 dark:bg-gray-900">
            <div
                className="absolute"
                style={{
                    transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
                    transformOrigin: 'top left',
                    transition: isAnimating.current ? 'transform 0.7s cubic-bezier(0.4, 0, 0.2, 1)' : 'none',
                }}
            >
                <div style={{ position: 'relative', width: `${contentBounds.width}px`, height: `${contentBounds.height}px`, top: `${contentBounds.offsetY}px`, left: `${contentBounds.offsetX}px` }}>
                    <svg width={contentBounds.width} height={contentBounds.height} className="absolute top-0 left-0 pointer-events-none">
                        <defs>
                            <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto" markerUnits="strokeWidth"><polygon points="0 0, 10 3.5, 0 7" fill={arrowColor} /></marker>
                        </defs>
                        {edges.map(edge => {
                            const sourceNode = nodeMap.get(edge.source);
                            const targetNode = nodeMap.get(edge.target);
                            if (!sourceNode || !targetNode) return null;
                           
                            const start = getBoundaryPoint(sourceNode, targetNode);
                            const end = getBoundaryPoint(targetNode, sourceNode, 15);

                            const isFaded = focusedNodeId && (!activeNodeIds?.has(edge.source) || !activeNodeIds?.has(edge.target));
                            const path = `M ${start.x - contentBounds.offsetX} ${start.y - contentBounds.offsetY} L ${end.x - contentBounds.offsetX} ${end.y - contentBounds.offsetY}`;
                            
                            return <path key={edge.id} d={path} stroke={arrowColor} strokeWidth="2" fill="none" markerEnd="url(#arrowhead)" className="transition-opacity duration-500" style={{ opacity: isFaded ? 0.1 : 1 }} />;
                        })}
                    </svg>
                    {nodes.map(node => <DiagramNodeComponent key={node.id} node={{...node, position: {x: node.position.x - contentBounds.offsetX, y: node.position.y - contentBounds.offsetY}}} isFaded={!!focusedNodeId && !activeNodeIds?.has(node.id)} onClick={onNodeClick} onMeasured={onNodeMeasured} onCopy={onCopy} onRegenerate={onRegenerate} onEdit={onEdit} />)}
                </div>
            </div>
            <style>{`@keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }`}</style>
        </div>
    );
});

export default DiagramView;