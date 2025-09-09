import React, { useRef, useLayoutEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import type { DiagramNode, WeatherData, StockData } from '../types';
import { SunIcon, StockUpIcon, StockDownIcon, TerminalIcon, CopyIcon, RegenerateIcon, EditIcon } from './Icons';

const WeatherComponent: React.FC<{ data: WeatherData }> = ({ data }) => (
    <div className="flex items-center space-x-3 p-3">
        <SunIcon className="w-8 h-8 text-yellow-500 flex-shrink-0" />
        <div>
            <div className="font-bold text-lg text-gray-800 dark:text-white leading-tight">{data.location}</div>
            <div className="text-sm text-gray-600 dark:text-gray-300">H: {data.high} / L: {data.low}</div>
        </div>
    </div>
);

const StockComponent: React.FC<{ data: StockData }> = ({ data }) => {
    const isUp = data.direction === 'up';
    const colorClass = isUp ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400';
    return (
        <div className="flex justify-between items-start p-3">
            <div>
                <div className="text-md font-bold text-gray-800 dark:text-white">{data.name} ({data.symbol})</div>
                <div className="text-xl font-light text-gray-900 dark:text-white">{data.price}</div>
            </div>
            <div className={`text-right ${colorClass}`}>
                {isUp ? <StockUpIcon className="w-10 h-10" /> : <StockDownIcon className="w-10 h-10" />}
                <div className="text-sm font-semibold mt-1">
                    {data.change} ({data.changePercent})
                </div>
            </div>
        </div>
    );
};

const MarkdownContent: React.FC<{ content: string; isCodeBlock?: boolean; language?: string }> = ({ content, isCodeBlock = false, language }) => (
    <div className={`prose prose-sm dark:prose-invert max-w-none prose-p:my-2 prose-headings:my-3 ${isCodeBlock ? '' : 'p-3'}`}>
        <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
            components={{
                code({ node, className, children, ...props }) {
                    const match = /language-(\w+)/.exec(className || '');
                    // Use the language prop for dedicated code nodes, or parse from className for inline
                    const displayLanguage = language || (match ? match[1] : 'code');
                    
                    return (
                         <div className="my-3 bg-gray-900 rounded-md overflow-hidden border border-gray-600 not-prose">
                            <div className="flex items-center gap-2 text-xs text-gray-400 bg-gray-800/50 px-4 py-1">
                                <TerminalIcon className="w-4 h-4 text-green-400" />
                                <span>{displayLanguage}</span>
                            </div>
                            <pre className="!bg-transparent !p-4 text-sm whitespace-pre-wrap break-words"><code {...props} className={className}>{children}</code></pre>
                        </div>
                    );
                }
            }}
        >
            {isCodeBlock ? `\`\`\`${language}\n${content}\n\`\`\`` : content}
        </ReactMarkdown>
    </div>
);

const ActionButton: React.FC<{ onClick: () => void; title: string; children: React.ReactNode }> = ({ onClick, title, children }) => {
    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        onClick();
    };
    return (
        <button
            onClick={handleClick}
            title={title}
            className="p-1.5 rounded-full text-gray-500 dark:text-gray-400 hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
        >
            {children}
        </button>
    );
};


interface DiagramNodeComponentProps {
    node: DiagramNode;
    isFaded: boolean;
    onClick: (nodeId: string) => void;
    onMeasured: (nodeId: string, width: number, height: number) => void;
    onCopy: (text: string) => void;
    onRegenerate: (nodeId: string) => void;
    onEdit: (nodeId: string, currentText: string) => void;
}

const DiagramNodeComponent: React.FC<DiagramNodeComponentProps> = ({ node, isFaded, onClick, onMeasured, onCopy, onRegenerate, onEdit }) => {
    const nodeRef = useRef<any>(null);
    const [justCopied, setJustCopied] = useState(false);

    useLayoutEffect(() => {
        if (nodeRef.current) {
            const width = nodeRef.current.offsetWidth;
            const height = nodeRef.current.offsetHeight;
            if (width > 0 && height > 0 && (node.width !== width || node.height !== height)) {
                onMeasured(node.id, width, height);
            }
        }
    }, [node.data, node.width, node.height, node.id, onMeasured]);

    const handleCopy = () => {
        onCopy(node.data.text);
        setJustCopied(true);
        setTimeout(() => setJustCopied(false), 1500);
    };

    const nodeStyles: { [key: string]: string } = {
        user: 'bg-green-100 dark:bg-green-900/60 border-green-300 dark:border-green-700 text-green-900 dark:text-white',
        ai: 'bg-blue-100/80 dark:bg-blue-900/60 border-blue-300 dark:border-blue-700 text-blue-900 dark:text-white',
        system: 'bg-gray-200/80 dark:bg-gray-800/60 border-gray-400 dark:border-gray-600 text-gray-700 dark:text-gray-200',
        source: 'bg-yellow-100/80 dark:bg-yellow-900/60 border-yellow-300 dark:border-yellow-700 text-yellow-900 dark:text-yellow-100',
        code: 'bg-gray-900/80 border-gray-600 text-white',
    };
    
    const loadingStyle = 'bg-pink-100 dark:bg-pink-900/80 border-pink-400 dark:border-pink-500';
    const fadedStyle = 'opacity-30 blur-[2px]';
    
    const baseClasses = `absolute p-1 rounded-2xl shadow-lg backdrop-blur-md transition-all duration-500 cursor-pointer flex flex-col gap-0 group`;
    const finalClasses = `${baseClasses} ${isFaded ? fadedStyle : ''} ${node.data.isLoading ? loadingStyle : nodeStyles[node.type]}`;

    if (node.type === 'source') {
        return (
             <div ref={nodeRef}
                className={finalClasses}
                onClick={(e) => { e.stopPropagation(); onClick(node.id); }}
                style={{ left: `${node.position.x}px`, top: `${node.position.y}px`, width: `${node.width}px`, minHeight: `${node.height}px`, transform: 'translate(-50%, -50%)', borderWidth: '1px' }}>
                <a href={node.data.uri} target="_blank" rel="noopener noreferrer" className="block p-2">
                    <p className="m-0 font-semibold truncate" title={node.data.text}>{node.data.text}</p>
                    <p className="m-0 text-xs text-yellow-700 dark:text-yellow-300 truncate opacity-80" title={node.data.uri}>{node.data.uri}</p>
                </a>
            </div>
        );
    }
    
    const content = node.data.text || (node.type === 'code' ? '...' : '');

    return (
        <div
            ref={nodeRef}
            onClick={(e) => { e.stopPropagation(); onClick(node.id); }}
            onMouseDown={(e) => e.stopPropagation()} 
            className={finalClasses}
            style={{
                left: `${node.position.x}px`,
                top: `${node.position.y}px`,
                width: `${node.width}px`,
                minHeight: `${node.height}px`,
                transform: 'translate(-50%, -50%)',
                borderWidth: '1px'
            }}
        >
             <div className="absolute top-1 right-1 z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center bg-white/50 dark:bg-black/20 backdrop-blur-sm rounded-full p-0.5">
                {node.type === 'user' && !node.data.isLoading && (
                    <ActionButton onClick={() => onEdit(node.id, content)} title="Edit">
                        <EditIcon className="w-4 h-4" />
                    </ActionButton>
                )}
                {node.type === 'ai' && !node.data.isLoading && (
                    <ActionButton onClick={() => onRegenerate(node.id)} title="Regenerate">
                        <RegenerateIcon className="w-4 h-4" />
                    </ActionButton>
                )}
                {!node.data.isLoading && content && (
                    <ActionButton onClick={handleCopy} title={justCopied ? "Copied!" : "Copy"}>
                        <CopyIcon className="w-4 h-4" />
                    </ActionButton>
                )}
            </div>

            {node.data.isLoading ? (
                 <div className="flex items-center justify-center space-x-2 w-full h-full p-3">
                    <div className="w-3 h-3 bg-pink-500 dark:bg-pink-400 rounded-full animate-pulse [animation-delay:-0.3s]"></div>
                    <div className="w-3 h-3 bg-pink-500 dark:bg-pink-400 rounded-full animate-pulse [animation-delay:-0.15s]"></div>
                    <div className="w-3 h-3 bg-pink-500 dark:bg-pink-400 rounded-full animate-pulse"></div>
                </div>
            ) : (
                <div className="divide-y divide-blue-200 dark:divide-blue-800/50">
                    {node.data.weather && <div className="border-b border-black/10 dark:border-white/10"><WeatherComponent data={node.data.weather} /></div>}
                    {node.data.stock && <div className="border-b border-black/10 dark:border-white/10"><StockComponent data={node.data.stock} /></div>}
                    
                    {node.type === 'code' ? (
                        <MarkdownContent content={content} isCodeBlock={true} language={node.data.language} />
                    ) : (node.type === 'ai' || node.type === 'system') ? (
                        <MarkdownContent content={content} />
                    ) : (node.type === 'user') ? (
                        <div className="p-3">{content}</div>
                    ) : null}

                    {node.data.reasoning && (
                        <div className="bg-pink-100/30 dark:bg-pink-900/30 p-3">
                            <h4 className="font-bold text-xs text-pink-700 dark:text-pink-300 mb-1">Reasoning:</h4>
                            <p className="text-xs italic text-pink-800 dark:text-pink-200 m-0">{node.data.reasoning}</p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default React.memo(DiagramNodeComponent);