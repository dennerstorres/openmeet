// ADR 0026: small Fluent wrappers shared by the migrated screens.
import { Button, ToggleButton, Tooltip, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
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
  pressed,
  expanded,
  className,
}: {
  label: string;
  icon: ReactElement;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  pressed?: boolean;
  expanded?: boolean;
  className?: string;
}) {
  const styles = useStyles();
  const classes = mergeClasses(danger && styles.danger, className);
  return (
    <Tooltip content={label} relationship="label" withArrow>
      {pressed === undefined ? (
        <Button appearance="subtle" size="small" icon={icon} disabled={disabled} aria-expanded={expanded} className={classes} onClick={onClick} />
      ) : (
        <ToggleButton appearance="subtle" size="small" checked={pressed} icon={icon} disabled={disabled} className={classes} onClick={onClick} />
      )}
    </Tooltip>
  );
}
