import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cn } from "@/lib/utils";

function Switch({
  className,
  size = "default",
  ...props
}: SwitchPrimitive.Root.Props & {
  size?: "sm" | "default";
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "group/switch peer my-0 inline-flex shrink-0 cursor-pointer items-center justify-start rounded-full border border-muted-foreground bg-secondary p-0.5 outline-none focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-ring data-checked:border-primary data-checked:bg-primary data-disabled:cursor-not-allowed data-disabled:opacity-50 data-[size=default]:h-7 data-[size=default]:w-12 data-[size=default]:[--switch-travel:1.375rem] data-[size=sm]:h-6 data-[size=sm]:w-9 data-[size=sm]:[--switch-travel:1rem]",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none ms-0 block shrink-0 rounded-full border border-current bg-card text-muted-foreground group-data-[size=default]/switch:size-5 group-data-[size=sm]/switch:size-3.5 data-checked:translate-x-(--switch-travel) motion-safe:transition-[translate] rtl:data-checked:-translate-x-(--switch-travel)",
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
