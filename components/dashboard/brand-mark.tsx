import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * Davinki "D" mark. Reads `public/brand/davinki-mark.svg` - see
 * `public/brand/README.md` for how to swap in the real logo asset.
 */
export function BrandMark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <Image
      src="/brand/davinki-mark.svg"
      alt=""
      width={size}
      height={size}
      className={cn("shrink-0", className)}
      priority
    />
  );
}

export function BrandLockup({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5">
      <BrandMark size={22} />
      {collapsed ? null : (
        <span className="text-sm font-semibold tracking-tight">Davinki Trading</span>
      )}
    </div>
  );
}
