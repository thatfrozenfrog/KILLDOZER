import { fitTerminal } from "./terminal";
import { getIsConnected } from "./shell";

export function setupResizeHandle() {
  const resizeHandle = document.getElementById('resize-handle');
  const controlPanel = document.getElementById('control-panel') as HTMLElement;
  
  if (!resizeHandle || !controlPanel) return;

  let isResizing = false;
  let startX = 0;
  let startWidth = 0;

  resizeHandle.addEventListener('mousedown', (e: MouseEvent) => {
    isResizing = true;
    startX = e.clientX;
    startWidth = controlPanel.offsetWidth;
    resizeHandle.classList.add('resizing');
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e: MouseEvent) => {
    if (!isResizing) return;

    const deltaX = startX - e.clientX;
    const newWidth = startWidth + deltaX;
    
    const minWidth = 250;
    const maxWidth = 600;
    
    if (newWidth >= minWidth && newWidth <= maxWidth) {
      controlPanel.style.width = `${newWidth}px`;
      controlPanel.style.minWidth = `${newWidth}px`;
    }
  });

  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      resizeHandle.classList.remove('resizing');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      // Refit terminal after resize
      fitTerminal(getIsConnected());
    }
  });
}
