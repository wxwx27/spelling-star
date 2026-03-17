import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-[#ffdab9]">
          <div className="bg-white p-8 rounded-3xl border-4 border-[#2d3436] shadow-[12px_12px_0px_0px_#2d3436] max-w-md w-full text-center">
            <AlertCircle size={64} className="mx-auto text-red-500 mb-4" />
            <h2 className="text-2xl font-black mb-2">哎呀！出錯了</h2>
            <p className="text-gray-600 mb-6">
              應用程式遇到了一些問題。請嘗試重新整理頁面。
            </p>
            <div className="bg-gray-100 p-4 rounded-xl text-left text-xs font-mono overflow-auto max-h-40 mb-6">
              {this.state.error?.message}
            </div>
            <button
              onClick={() => window.location.reload()}
              className="w-full bg-[#2d3436] text-white font-bold py-3 rounded-xl border-4 border-[#2d3436] hover:bg-black transition-all"
            >
              重新整理
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
