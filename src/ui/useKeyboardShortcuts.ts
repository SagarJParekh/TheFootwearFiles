import { useEffect } from 'react';
import { redoEdit, requestCamera, setTool, setView, undoEdit, useStore } from '../state/store';

export function useKeyboardShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      // Only text-entry fields keep their own keys; checkboxes, sliders and buttons don't block shortcuts.
      const textEntry =
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        (target.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'button'].includes((target as HTMLInputElement).type));
      if (textEntry) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z' && !e.shiftKey) {
        e.preventDefault();
        undoEdit();
      } else if (mod && ((k === 'z' && e.shiftKey) || k === 'y')) {
        e.preventDefault();
        redoEdit();
      } else if (!mod && !useStore.getState().scanDialogOpen) {
        const { view, doc } = useStore.getState();
        if ((k === 'g' || k === 'r') && doc?.basePlaneLocked) return;
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
