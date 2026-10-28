import { cn } from '../../utils/cn';

export function Checkbox({ checked, onChange, label }: { checked: boolean, onChange: (c: boolean) => void, label?: string }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer w-fit">
      <div className={cn(
        "w-4 h-4 rounded-sm border flex items-center justify-center transition-colors",
        checked ? "bg-[#e5a038] border-[#e5a038]" : "border-black/20 bg-white"
      )}>
        {checked && <div className="w-2 h-2 bg-white rounded-sm" style={{ clipPath: 'polygon(14% 44%, 0 65%, 50% 100%, 100% 16%, 80% 0%, 43% 62%)' }} />}
      </div>
      <input 
        type="checkbox" 
        className="hidden"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label && <span className="text-[13px] text-text-main">{label}</span>}
    </label>
  );
}
