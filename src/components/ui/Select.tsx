import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';
import { cn } from '../../utils/cn';

export function Select({ 
  value, 
  onChange, 
  options, 
  className = "w-48" 
}: { 
  value: string, 
  onChange: (val: string) => void, 
  options: { label: string, value: string }[], 
  className?: string 
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const selectedLabel = options.find(o => o.value === value)?.label || value;

  const updatePosition = () => {
    if (containerRef.current && isOpen) {
      const rect = containerRef.current.getBoundingClientRect();
      setMenuStyle({
        position: 'absolute',
        top: `${rect.bottom + window.scrollY + 4}px`,
        left: `${rect.left + window.scrollX}px`,
        width: `${rect.width}px`,
        zIndex: 50,
      });
    }
  };

  useEffect(() => {
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true); // true to catch all scroll events
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current && !containerRef.current.contains(event.target as Node) &&
        menuRef.current && !menuRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setIsOpen(!isOpen);
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    } else if (isOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const currentIndex = options.findIndex(o => o.value === value);
      let nextIndex = currentIndex;
      
      if (e.key === 'ArrowDown') {
        nextIndex = currentIndex < options.length - 1 ? currentIndex + 1 : 0;
      } else {
        nextIndex = currentIndex > 0 ? currentIndex - 1 : options.length - 1;
      }
      onChange(options[nextIndex].value);
    }
  };

  return (
    <>
      <div 
        ref={containerRef} 
        className={cn("relative focus:outline-none", className)}
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        <div 
          onClick={() => setIsOpen(!isOpen)}
          className={cn(
            "px-3 py-1.5 border rounded-md bg-white text-[13px] text-text-main cursor-pointer flex items-center justify-between transition-colors select-none",
            isOpen ? "border-[#e5a038]" : "border-black/10 hover:border-black/20 focus:border-[#e5a038]"
          )}
        >
          <span>{selectedLabel}</span>
          <ChevronDown size={14} className={cn("text-text-muted transition-transform", isOpen && "rotate-180")} />
        </div>
      </div>
      
      {isOpen && createPortal(
        <div 
          ref={menuRef}
          style={menuStyle}
          className="py-1 bg-white border border-black/10 rounded-md shadow-lg max-h-60 overflow-y-auto custom-scrollbar"
        >
          {options.map((opt) => (
            <div 
              key={opt.value}
              onClick={() => {
                onChange(opt.value);
                setIsOpen(false);
              }}
              className={cn(
                "px-3 py-2 text-[13px] cursor-pointer flex items-center justify-between transition-colors select-none",
                value === opt.value ? "text-[#e5a038] bg-[#e5a038]/5" : "text-text-main hover:bg-black/5"
              )}
            >
              <span>{opt.label}</span>
              {value === opt.value && <Check size={14} className="text-[#e5a038]" />}
            </div>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}
