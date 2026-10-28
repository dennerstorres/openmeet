// ADR 0026 POC: Fluent UI v9 under the production CSP (style-src 'self').
import { StrictMode, useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  FluentProvider,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Tab,
  TabList,
  makeStyles,
  teamsHighContrastTheme,
  tokens,
  webDarkTheme,
  webLightTheme,
  type Theme,
} from "@fluentui/react-components";
import { CallEndRegular, MicRegular, MoreHorizontalRegular } from "@fluentui/react-icons";

const themes: Record<string, Theme> = { light: webLightTheme, dark: webDarkTheme, hc: teamsHighContrastTheme };

const useStyles = makeStyles({
  page: { minHeight: "100vh", padding: tokens.spacingHorizontalXXL, display: "flex", flexDirection: "column", gap: tokens.spacingVerticalL },
  row: { display: "flex", gap: tokens.spacingHorizontalM },
});

function Poc() {
  const [theme, setTheme] = useState("light");
  const [violations, setViolations] = useState<string[]>([]);
  const styles = useStyles();
  useEffect(() => {
    const onViolation = (e: SecurityPolicyViolationEvent) => setViolations((v) => [...v, `${e.violatedDirective} ${e.blockedURI}`]);
    document.addEventListener("securitypolicyviolation", onViolation);
    return () => document.removeEventListener("securitypolicyviolation", onViolation);
  }, []);
  return (
    <FluentProvider theme={themes[theme]}>
      <main className={styles.page}>
        <TabList selectedValue={theme} onTabSelect={(_, d) => setTheme(String(d.value))}>
          <Tab value="light">Light</Tab>
          <Tab value="dark">Dark</Tab>
          <Tab value="hc">Alto contraste</Tab>
        </TabList>
        <div className={styles.row}>
          <Button appearance="primary" icon={<MicRegular />}>
            Microfone
          </Button>
          <Dialog>
            <DialogTrigger disableButtonEnhancement>
              <Button icon={<CallEndRegular />}>Sair</Button>
            </DialogTrigger>
            <DialogSurface>
              <DialogBody>
                <DialogTitle>Sair da sala?</DialogTitle>
                <DialogContent>Câmera e microfone serão desligados.</DialogContent>
                <DialogActions>
                  <DialogTrigger disableButtonEnhancement>
                    <Button appearance="secondary">Cancelar</Button>
                  </DialogTrigger>
                  <Button appearance="primary">Sair</Button>
                </DialogActions>
              </DialogBody>
            </DialogSurface>
          </Dialog>
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <Button icon={<MoreHorizontalRegular />} aria-label="Mais" />
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                <MenuItem>Configurações</MenuItem>
                <MenuItem>Compartilhar tela</MenuItem>
              </MenuList>
            </MenuPopover>
          </Menu>
        </div>
        <output id="csp-violations">{violations.length === 0 ? "0 violações de CSP" : violations.join("\n")}</output>
      </main>
    </FluentProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <Poc />
  </StrictMode>,
);
