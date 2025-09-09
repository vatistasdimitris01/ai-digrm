import React, { useMemo, useRef, useEffect, useState, forwardRef, useImperativeHandle } from 'react';
import type { DiagramNode, Edge } from '../types';
import DiagramNodeComponent from './DiagramNode';
import html2canvas from 'html2canvas';

interface DiagramViewProps {
  nodes: DiagramNode[];
  edges: Edge[];
  theme: 'light' | 'dark';
  focusedNodeId: string | null;
  editingNodeId: string | null;
  onNodeClick: (nodeId: string) => void;
  onClearFocus: () => void;
  onNodeMeasured: (nodeId: string, width: number, height: number) => void;
  onCopy: (text: string) => void;
  onRegenerate: (nodeId: string) => void;
  onEdit: (nodeId: string, currentText: string) => void;
  onSaveEdit: (nodeId: string, newText: string) => void;
  onCancelEdit: () => void;
}

export interface DiagramViewHandle {
  zoomToFit: () => void;
  focusOnNode: (nodeId: string) => void;
  exportAsPng: () => void;
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

const DiagramView = forwardRef<DiagramViewHandle, DiagramViewProps>(({ nodes, edges, theme, focusedNodeId, editingNodeId, onNodeClick, onClearFocus, onNodeMeasured, onCopy, onRegenerate, onEdit, onSaveEdit, onCancelEdit }, ref) => {
    const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });
    const viewRef = useRef<HTMLDivElement>(null);
    const isInteracting = useRef(false);
    const isAnimating = useRef(false);
    const animationTimeout = useRef<number | null>(null);
    const lastInteractionPosition = useRef({ x: 0, y: 0 });
    const lastPinchDist = useRef(0);

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
    
    const drawnEdges = useMemo(() => {
        return edges.map(edge => {
            const sourceNode = nodeMap.get(edge.source);
            const targetNode = nodeMap.get(edge.target);
            if (!sourceNode || !targetNode || sourceNode.width === 0 || targetNode.width === 0) return null;
           
            const start = getBoundaryPoint(sourceNode, targetNode);
            const end = getBoundaryPoint(targetNode, sourceNode, 15);

            const isFaded = focusedNodeId && (!activeNodeIds?.has(edge.source) || !activeNodeIds?.has(edge.target));
            const path = `M ${start.x - contentBounds.offsetX} ${start.y - contentBounds.offsetY} L ${end.x - contentBounds.offsetX} ${end.y - contentBounds.offsetY}`;
            
            return { id: edge.id, path, isFaded };
        }).filter((e): e is { id: string; path: string; isFaded: boolean; } => e !== null);
    }, [edges, nodeMap, focusedNodeId, activeNodeIds, contentBounds.offsetX, contentBounds.offsetY]);


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

    const exportAsPng = async () => {
        const element = viewRef.current;
        if (!element) return;
    
        const uiButtons = element.parentElement?.querySelectorAll<HTMLElement>('.absolute.top-4, .absolute.bottom-0');
        uiButtons?.forEach(el => el.style.visibility = 'hidden');
    
        const canvas = await html2canvas(element, {
            useCORS: true,
            backgroundColor: theme === 'dark' ? '#111827' : '#f9fafb',
            logging: false,
        });
    
        uiButtons?.forEach(el => el.style.visibility = 'visible');
    
        const data = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.href = data;
        link.download = 'ai-diagram.png';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    useImperativeHandle(ref, () => ({ zoomToFit, focusOnNode, exportAsPng }));

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
        
        const handleInteractionStart = (x: number, y: number) => {
            if (isInteracting.current) return;
            isAnimating.current = false;
            if(animationTimeout.current) clearTimeout(animationTimeout.current);
            isInteracting.current = true;
            lastInteractionPosition.current = { x, y };
            view.style.cursor = 'grabbing';
        };

        const handleInteractionMove = (x: number, y: number) => {
            if (!isInteracting.current) return;
            const dx = x - lastInteractionPosition.current.x;
            const dy = y - lastInteractionPosition.current.y;
            lastInteractionPosition.current = { x, y };
            setTransform(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
        };

        const handleInteractionEnd = () => { 
            isInteracting.current = false;
            lastPinchDist.current = 0;
            view.style.cursor = 'grab';
         };

        const handleMouseDown = (e: MouseEvent) => { if (e.target === e.currentTarget) handleInteractionStart(e.clientX, e.clientY); };
        const handleMouseMove = (e: MouseEvent) => { if (isInteracting.current) handleInteractionMove(e.clientX, e.clientY); };
        
        const handleTouchStart = (e: TouchEvent) => {
            if (e.target !== e.currentTarget) return;
            e.preventDefault();
            const touches = e.touches;
            if (touches.length === 1) {
                handleInteractionStart(touches[0].clientX, touches[0].clientY);
            } else if (touches.length === 2) {
                isInteracting.current = false; // Stop panning
                const dx = touches[0].clientX - touches[1].clientX;
                const dy = touches[0].clientY - touches[1].clientY;
                lastPinchDist.current = Math.sqrt(dx * dx + dy * dy);
            }
        };

        const handleTouchMove = (e: TouchEvent) => {
            e.preventDefault();
            const touches = e.touches;
            if (touches.length === 1 && isInteracting.current) {
                handleInteractionMove(touches[0].clientX, touches[0].clientY);
            } else if (touches.length === 2) {
                const dx = touches[0].clientX - touches[1].clientX;
                const dy = touches[0].clientY - touches[1].clientY;
                const newDist = Math.sqrt(dx * dx + dy * dy);
                if (lastPinchDist.current > 0) {
                    const rect = view.getBoundingClientRect();
                    const pinchCenterX = (touches[0].clientX + touches[1].clientX) / 2 - rect.left;
                    const pinchCenterY = (touches[0].clientY + touches[1].clientY) / 2 - rect.top;
                    
                    setTransform(prev => {
                        const scaleFactor = newDist / lastPinchDist.current;
                        const newScale = Math.max(0.1, Math.min(2, prev.scale * scaleFactor));
                        const worldX = (pinchCenterX - prev.x) / prev.scale;
                        const worldY = (pinchCenterY - prev.y) / prev.scale;
                        const newX = pinchCenterX - worldX * newScale;
                        const newY = pinchCenterY - worldY * newScale;
                        return { scale: newScale, x: newX, y: newY };
                    });
                }
                lastPinchDist.current = newDist;
            }
        };

        const handleBackgroundClick = (e: MouseEvent) => { if (e.target === e.currentTarget) onClearFocus(); };

        view.addEventListener('wheel', handleWheel, { passive: false });
        view.addEventListener('mousedown', handleMouseDown);
        view.addEventListener('click', handleBackgroundClick);
        window.addEventListener('mouseup', handleInteractionEnd);
        view.addEventListener('mousemove', handleMouseMove);
        
        view.addEventListener('touchstart', handleTouchStart, { passive: false });
        view.addEventListener('touchmove', handleTouchMove, { passive: false });
        view.addEventListener('touchend', handleInteractionEnd);
        view.addEventListener('touchcancel', handleInteractionEnd);


        return () => {
            view.removeEventListener('wheel', handleWheel);
            view.removeEventListener('mousedown', handleMouseDown);
            view.removeEventListener('click', handleBackgroundClick);
            window.removeEventListener('mouseup', handleInteractionEnd);
            view.removeEventListener('mousemove', handleMouseMove);

            view.removeEventListener('touchstart', handleTouchStart);
            view.removeEventListener('touchmove', handleTouchMove);
            view.removeEventListener('touchend', handleInteractionEnd);
            view.removeEventListener('touchcancel', handleInteractionEnd);

            if(animationTimeout.current) clearTimeout(animationTimeout.current);
        };
    }, [onClearFocus]);
    
    const arrowColor = theme === 'dark' ? '#6b7280' : '#9ca3af';

    return (
        <div ref={viewRef} className="w-full h-full absolute inset-0 overflow-hidden cursor-grab active:cursor-grabbing bg-slate-50 dark:bg-gray-900" style={{ touchAction: 'none' }}>
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
                        {drawnEdges.map(edge => (
                            <path key={edge.id} d={edge.path} stroke={arrowColor} strokeWidth="2" fill="none" markerEnd="url(#arrowhead)" className="transition-opacity duration-500" style={{ opacity: edge.isFaded ? 0.1 : 1 }} />
                        ))}
                    </svg>
                    {nodes.map(node => <DiagramNodeComponent 
                        key={node.id} 
                        node={{...node, position: {x: node.position.x - contentBounds.offsetX, y: node.position.y - contentBounds.offsetY}}} 
                        isFaded={!!focusedNodeId && !activeNodeIds?.has(node.id)} 
                        isEditing={node.id === editingNodeId}
                        onClick={onNodeClick} 
                        onMeasured={onNodeMeasured} 
                        onCopy={onCopy} 
                        onRegenerate={onRegenerate} 
                        onEdit={onEdit}
                        onSaveEdit={onSaveEdit}
                        onCancelEdit={onCancelEdit}
                    />)}
                </div>
            </div>
            <style>{`@keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }`}</style>
        </div>
    );
});

export default DiagramView;