export type LayerKey = "buildings" | "sewer" | "power" | "mobility" | "sensors" | "construction";

type Props = {
  layers: Record<LayerKey, boolean>;
  onToggle: (key: LayerKey) => void;
  onManage: () => void;
};

export default function LayerControls({ layers, onToggle, onManage }: Props) {
  return (
    <section className="reference-card layer-card">
      <header><div><span>VISIBLE SYSTEMS</span><h3>District layers</h3></div><button onClick={onManage}>Manage</button></header>
      <div>{([
        ["buildings", "Built form", "624 structures", "#7aa2ff"], ["sewer", "Sewer", "18.2 km", "#4f6fff"], ["power", "Power", "46 assets", "#00dfff"], ["mobility", "Mobility", "Live traffic", "#168cff"], ["sensors", "Sensors", "128 online", "#7cecff"], ["construction", "Capital works", "7 sites", "#ffffff"],
      ] as Array<[LayerKey, string, string, string]>).map(([key, label, meta, color]) => <button key={key} className={layers[key] ? "active" : ""} onClick={() => onToggle(key)}><i style={{ background: color }} /><span><strong>{label}</strong><small>{meta}</small></span><em /></button>)}</div>
    </section>
  );
}
