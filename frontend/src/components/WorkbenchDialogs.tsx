import { ShortcutHelpDialog } from "./ShortcutHelpDialog";

type WorkbenchDialogsProps = {
  showShortcutHelp: boolean;
  onCloseShortcutHelp: () => void;
};

export function WorkbenchDialogs({
  showShortcutHelp,
  onCloseShortcutHelp,
}: WorkbenchDialogsProps) {
  return (
    <>
      <ShortcutHelpDialog onClose={onCloseShortcutHelp} open={showShortcutHelp} />
    </>
  );
}
