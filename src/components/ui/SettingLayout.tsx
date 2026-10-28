import React from 'react';
import { cn } from '../../utils/cn';

export function Section({ title, children }: { title: string, children: React.ReactNode }) {
  return (
    <div className="mb-12">
      <div className="flex items-center gap-4 mb-6">
        <div className="w-8 h-px bg-black/10"></div>
        <span className="text-[15px] font-medium text-text-main">{title}</span>
        <div className="flex-1 h-px bg-black/10"></div>
      </div>
      <div className="space-y-6 pl-12">
        {children}
      </div>
    </div>
  );
}

export function Row({ 
  label, 
  children, 
  align = "center" 
}: { 
  label?: React.ReactNode, 
  children: React.ReactNode, 
  align?: "center" | "start" 
}) {
  return (
    <div className={cn("flex min-h-[32px]", align === "center" ? "items-center" : "items-start")}>
      {label && (
        <div className={cn("w-48 text-[13px] text-text-main shrink-0", align === "start" && "pt-2")}>
          {label}
        </div>
      )}
      <div className={cn("flex-1 flex flex-col gap-3", !label && "ml-48")}>
        <div className={cn("flex flex-wrap gap-3 w-full", align === "center" ? "items-center" : "items-start")}>
          {children}
        </div>
      </div>
    </div>
  );
}
