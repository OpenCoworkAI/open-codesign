import { useCodesignStore } from '../store';

export function handlePreviewFullscreenEscape(): void {
  const state = useCodesignStore.getState();
  if (state.view !== 'workspace' || !state.previewFullscreen || state.commentBubble) return;
  if (state.interactionMode !== 'default') {
    state.setInteractionMode('default');
    return;
  }
  state.setPreviewFullscreen(false);
}
