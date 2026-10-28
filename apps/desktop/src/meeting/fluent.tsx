// ADR 0026: small Fluent wrappers shared by the migrated screens.
import { Button, Tooltip, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import type { ReactElement } from "react";

const useStyles = makeStyles({
  danger: { color: tokens.colorPaletteRedForeground1 },
});

// Icon-only button with its label as tooltip and accessible name.
export function IconAction({
  label,
  icon,
  onClick,
  disabled,
  danger,
  className,
}: {
  label: string;
  icon: ReactElement;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  className?: string;
}) {
  const styles = useStyles();
  return (
    <Tooltip content={label} relationship="label" withArrow>
      <Button appearance="subtle" size="small" icon={icon} disabled={disabled} className={mergeClasses(danger && styles.danger, className)} onClick={onClick} />
    </Tooltip>
  );
}
