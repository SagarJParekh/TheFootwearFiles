import { useEffect } from 'react';
import { redoEdit, requestCamera, setTool, setView, undoEdit, useStore } from '../state/store';

export function useKeyboardShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z' && !e.shiftKey) {
        e.preventDefault();
        undoEdit();
      } else if (mod && ((k === 'z' && e.shiftKey) || k === 'y')) {
        e.preventDefault();
        redoEdit();
      } else if (!mod && !useStore.getState().scanDialogOpen) {
        const { view } = useStore.getState();
        if (k === 'g') setView({ gizmo: view.gizmo === 'translate' ? 'none' : 'translate' });
        else if (k === 'r') setView({ gizmo: view.gizmo === 'rotate' ? 'none' : 'rotate' });
        else if (k === 'f') requestCamera('fit');
        else if (k === 'escape') {
          setView({ gizmo: 'none' });
          setTool('none');
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
