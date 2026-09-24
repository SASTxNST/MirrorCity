export type AssetDefinition = { id: string; name: string; category: string; code: string; description: string; size: string; tone: string; file?: string; format?: "OBJ" | "GLB"; preview?: string; stats?: Array<{ label: string; value: string }> };

type Props = {
  replacing: boolean;
  search: string;
  onSearchChange: (search: string) => void;
  categories: string[];
  category: string;
  onCategoryChange: (category: string) => void;
  assets: AssetDefinition[];
  totalCount: number;
  onClose: () => void;
  onView: (asset: AssetDefinition) => void;
  onPlace: (asset: AssetDefinition) => void;
  onDownload: (asset: AssetDefinition) => void;
};

export default function AssetPanel({ replacing, search, onSearchChange, categories, category, onCategoryChange, assets, totalCount, onClose, onView, onPlace, onDownload }: Props) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section className="asset-library" role="dialog" aria-modal="true" aria-labelledby="asset-library-title">
        <header className="library-header">
          <div><span>{replacing ? "REPLACE SELECTED ASSET" : "3D CONTENT CATALOGUE"}</span><h2 id="asset-library-title">Civic asset library</h2><p>{replacing ? "Choose a model below to swap it into the same position." : "Place optimized planning assets in the twin or download a model for your own 3D pipeline."}</p></div>
          <button aria-label="Close asset library" onClick={onClose}>×</button>
        </header>
        <div className="library-controls">
          <label><span>⌕</span><input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="Search pumps, power, shelters…" /></label>
          <div>{categories.map((item) => <button key={item} className={category === item ? "active" : ""} onClick={() => onCategoryChange(item)}>{item}</button>)}</div>
        </div>
        <div className="asset-catalogue">
          {assets.map((asset) => <article className="catalogue-card" key={asset.id}>
            <div className={`catalogue-preview tone-${asset.tone} ${asset.preview ? "lidar-preview" : ""}`} style={asset.preview ? { backgroundImage: `url(${asset.preview})` } : undefined}>{!asset.preview && <span className={`asset-model model-${asset.id}`}><i /><b /></span>}<em>{asset.preview ? "OPEN3D" : "LOW POLY"}</em></div>
            <div className="catalogue-copy"><span>{asset.category}</span><h3>{asset.name}</h3><p>{asset.description}</p><small>{asset.format ?? "OBJ"} · Metric scale · {asset.size}</small></div>
            <div className={`catalogue-actions ${asset.file ? "has-view" : ""}`}>{asset.file && <button className="view-button" onClick={() => onView(asset)}>◉ View 3D</button>}<button className="place-button" onClick={() => onPlace(asset)}>{replacing ? "↺ Use this model" : "＋ Place in twin"}</button><button className="download-button" onClick={() => onDownload(asset)}>↓ Download {asset.format ?? "OBJ"}</button></div>
          </article>)}
          {!assets.length && <div className="empty-assets"><strong>No assets found</strong><span>Try a different search or category.</span></div>}
        </div>
        <footer className="library-footer"><span><i /> {totalCount} verified planning assets</span><p>Includes three Open3D terrain reconstructions generated from the supplied IITH dataset.</p></footer>
      </section>
    </div>
  );
}
