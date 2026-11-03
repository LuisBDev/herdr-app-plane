import { View, div } from "gpui-kit";
import { panes, spaces, run, props, closeOverlay } from "herdr";

export default class PlaneOpen extends View {
  init() {
    const overlay = props()?.overlay;
    if (!overlay) return;
    const pane = panes().find((p) => p.mod === "plane-board");
    const space = pane && spaces().find((s) => s.tabs.some((t) => t.id === pane.tab));
    if (space) {
      run("space.select", { id: space.id });
      run("tab.select", { id: pane.tab });
    } else {
      run("tab.new", { name: "Plane", mod: "plane-board" });
    }
    closeOverlay(overlay);
  }
  render() { return div(); }
}
