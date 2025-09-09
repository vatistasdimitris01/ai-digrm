import React, { useState } from 'react';
import { ArrowUpIcon } from './Icons';

interface ChatInputProps {
  onSend: (prompt: string) => void;
  isLoading: boolean;
}

const ChatInput: React.FC<ChatInputProps> = ({ onSend, isLoading }) => {
  const [prompt, setPrompt] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (prompt.trim() && !isLoading) {
      onSend(prompt.trim());
      setPrompt('');
    }
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 p-4 flex justify-center z-50">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-3xl bg-white/80 dark:bg-gray-800/80 backdrop-blur-md rounded-2xl shadow-2xl flex items-center pr-2 border border-gray-300 dark:border-gray-600"
      >
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Ask me anything..."
          className="flex-grow bg-transparent text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 p-4 focus:outline-none rounded-2xl"
          disabled={isLoading}
        />
        <button
          type="submit"
          disabled={isLoading || !prompt.trim()}
          className="w-10 h-10 flex items-center justify-center rounded-full bg-blue-600 text-white disabled:bg-gray-400 dark:disabled:bg-gray-500 disabled:cursor-not-allowed hover:bg-blue-500 transition-colors duration-200"
        >
          {isLoading ? (
            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
          ) : (
            <ArrowUpIcon className="w-6 h-6" />
          )}
        </button>
      </form>
    </div>
  );
};

export default ChatInput;