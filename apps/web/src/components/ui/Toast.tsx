'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from 'react';

type ToastVariant = 'success' | 'error' | 'info';

interface ToastMessage {
  id: number;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  toast: (message: string, variant?: ToastVariant) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const variantClasses: Record<ToastVariant, string> = {
  success: 'bg-primary-fixed text-on-primary-fixed',
  error: 'bg-error-container text-on-error-container',
  info: 'bg-surface-container-high text-on-surface',
};

const variantIcons: Record<ToastVariant, string> = {
  success: 'check_circle',
  error: 'error',
  info: 'info',
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const counter = useRef(0);

  const toast = useCallback((message: string, variant: ToastVariant = 'info') => {
    const id = ++counter.current;
    setToasts((prev) => [...prev, { id, message, variant }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {/* Toast container */}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="fixed bottom-24 inset-x-4 z-[100] flex flex-col items-center gap-2 pointer-events-none"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={[
              'inline-flex items-center gap-2 rounded-xl px-4 py-3 shadow-float',
              'font-label-lg pointer-events-auto',
              'animate-in fade-in slide-in-from-bottom-2 duration-200',
              variantClasses[t.variant],
            ].join(' ')}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
              {variantIcons[t.variant]}
            </span>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}
