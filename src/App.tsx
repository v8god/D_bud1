import CharacterWorkbench from "./ui/pages/CharacterWorkbench";
import DesktopBuddyOverlay from "./ui/pages/DesktopBuddyOverlay";
import "./index.css";

export default function App() {
  const params = new URLSearchParams(window.location.search);
  const showWorkbench = params.get("mode") === "workbench";

  return showWorkbench ? <CharacterWorkbench /> : <DesktopBuddyOverlay />;
}
