import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * Davinki "D" mark - `public/brand/davinki-mark.png`, cropped from the
 * owner-supplied logo (public/brand/README.md documents provenance).
 * The source art is white-on-transparent, so it reads correctly against
 * the app's dark theme with no filter; `invert dark:invert-0` flips it to
 * dark-on-transparent for the light theme without touching the asset
 * itself.
 */
export function BrandMark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <Image
      src="/brand/davinki-mark.png"
      alt=""
      width={size}
      height={size}
      className={cn("invert dark:invert-0 shrink-0", className)}
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
