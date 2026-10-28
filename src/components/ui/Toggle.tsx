import { cn } from '../../utils/cn';

export function Toggle({ checked, onChange }: { checked: boolean, onChange: (c: boolean) => void }) {
  return (
    <button 
      onClick={() => onChange(!checked)}
      className={cn(
        "w-10 h-5 rounded-full relative transition-colors duration-200 cursor-pointer",
        checked ? "bg-[#e5a038]" : "bg-black/20"
      )}
    >
      <div className={cn(
        "absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-200 shadow-sm",
        checked ? "translate-x-5" : "translate-x-0"
      )} />
    </button>
  );
}
