import { useEffect, useState } from 'react';
import { useGraphStore } from '../../store/graphStore';
import type { Toast } from '../../store/graphStore/slices/toastSlice';
import { Info, CheckCircle2, AlertTriangle, AlertCircle, X } from 'lucide-react';
import '../../styles/toast.css';

const ICONS = {
  info: <Info size={20} className="toast__icon" />,
  success: <CheckCircle2 size={20} className="toast__icon" />,
  warning: <AlertTriangle size={20} className="toast__icon" />,
  error: <AlertCircle size={20} className="toast__icon" />,
};

function ToastItem({ toast }: { toast: Toast }) {
  const dismissToast = useGraphStore(state => state.dismissToast);
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsExiting(true);
      // Wait for exit animation
      setTimeout(() => dismissToast(toast.id), 200);
    }, toast.timeoutMs);

    return () => clearTimeout(timer);
  }, [toast.id, toast.timeoutMs, dismissToast]);

  const handleDismiss = () => {
    setIsExiting(true);
    setTimeout(() => dismissToast(toast.id), 200);
  };

  return (
    <div 
      className={`toast toast--${toast.kind} ${isExiting ? 'toast--exiting' : ''}`}
      role="alert"
    >
      {ICONS[toast.kind]}
      
      <div className="toast__content">
        <div className="toast__title">{toast.title}</div>
        {toast.message && <div className="toast__message">{toast.message}</div>}
      </div>

      <button 
        type="button" 
        className="toast__dismiss" 
        onClick={handleDismiss}
        aria-label="Dismiss"
      >
        <X size={16} />
      </button>
    </div>
  );
}

export function ToastHost() {
  const toasts = useGraphStore(state => state.toasts);

  // Limit to 5 visible toasts
  const visibleToasts = toasts.slice(0, 5);

  if (visibleToasts.length === 0) return null;

  return (
    <div className="toast-container">
      {visibleToasts.map(toast => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
