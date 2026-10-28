import { useEffect, useState } from 'react';
import { Copy, Minus, Square, X } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';

export default function TitleBar() {
  const appWindow = getCurrentWindow();
  const [isMaximized, setIsMaximized] = useState(false);

  const handleCloseWindow = async () => {
    await appWindow.close();
  };

  useEffect(() => {
    const syncState = async () => {
      const maximized = await appWindow.isMaximized();
      setIsMaximized(maximized);
    };
    void syncState();
    const unlistenResizedPromise = appWindow.onResized(() => {
      void syncState();
    });
    const unlistenMovedPromise = appWindow.onMoved(() => {
      void syncState();
    });
    return () => {
      void unlistenResizedPromise.then((unlisten) => unlisten());
      void unlistenMovedPromise.then((unlisten) => unlisten());
    };
  }, [appWindow]);

  const handleToggleZoom = async () => {
    if (isMaximized) {
      await appWindow.unmaximize();
      setIsMaximized(false);
      return;
    }
    await appWindow.maximize();
    setIsMaximized(true);
  };

  const handleDoubleClickTitleBar = () => {
    void handleToggleZoom();
  };

  return (
    <div className="h-11 flex justify-end items-center bg-main select-none">
      <div
        data-tauri-drag-region
        className="window-drag flex-1 h-full cursor-move"
        onDoubleClick={handleDoubleClickTitleBar}
      />
      <div className="no-drag flex items-center h-full pr-1" onMouseDown={(event) => event.stopPropagation()}>
        <button
          type="button"
          title="最小化"
          onClick={() => {
            void appWindow.minimize();
          }}
          className="w-12 h-10 flex items-center justify-center text-text-muted hover:bg-black/5 rounded-md transition-colors cursor-pointer"
        >
          <Minus size={17} strokeWidth={2.2} />
        </button>
        <button
          type="button"
          title={isMaximized ? '向下还原' : '最大化'}
          onClick={() => {
            void handleToggleZoom();
          }}
          className="w-12 h-10 flex items-center justify-center text-text-muted hover:bg-black/5 rounded-md transition-colors cursor-pointer"
        >
          {isMaximized ? <Copy size={16} strokeWidth={2.1} /> : <Square size={16} strokeWidth={2.1} />}
        </button>
        <button
          type="button"
          title="关闭"
          onClick={() => {
            void handleCloseWindow();
          }}
          className="w-12 h-10 flex items-center justify-center text-text-muted hover:bg-red-500 hover:text-white rounded-md transition-colors cursor-pointer"
        >
          <X size={18} strokeWidth={2.2} />
        </button>
      </div>
    </div>
  );
}
