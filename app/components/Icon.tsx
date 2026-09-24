export type IconName = "twin" | "scenario" | "layers" | "assets" | "data" | "activity" | "settings" | "help" | "search" | "bell" | "plus" | "compare" | "import" | "play" | "orbit" | "measure" | "building";

export function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    twin: <><rect x="3.5" y="3.5" width="17" height="17" rx="5"/><path d="M8 15V9l4-2 4 2v6l-4 2-4-2Z"/><path d="m8 9 4 2 4-2M12 11v6"/></>,
    scenario: <><circle cx="12" cy="12" r="8.5"/><path d="M10 8.5 15.5 12 10 15.5v-7Z"/></>,
    layers: <><path d="m12 3.5 8.5 4.3L12 12 3.5 7.8 12 3.5Z"/><path d="m4.5 12 7.5 3.8 7.5-3.8M4.5 16.2 12 20l7.5-3.8"/></>,
    assets: <><path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5v-7Z"/><path d="m4 8.5 8 4.5 8-4.5M12 13v7"/></>,
    data: <><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></>,
    activity: <><path d="M4 19V9M9.3 19V5M14.7 19v-7M20 19V3"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
    help: <><circle cx="12" cy="12" r="9"/><path d="M9.7 9a2.5 2.5 0 1 1 3.2 2.4c-.7.3-.9.8-.9 1.6M12 17h.01"/></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 4.5 4.5"/></>,
    bell: <><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7M10 20h4"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    compare: <><path d="M8 4H4v4M16 20h4v-4M4 8c1.7-3 4.3-4.5 8-4.5 3 0 5.3 1 7 3M20 16c-1.7 3-4.3 4.5-8 4.5-3 0-5.3-1-7-3"/></>,
    import: <><path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 14v6h14v-6"/></>,
    play: <path d="m9 7 8 5-8 5V7Z"/>,
    orbit: <><circle cx="12" cy="12" r="3"/><path d="M4 12a8 3.5 0 0 0 16 0 8 3.5 0 0 0-16 0Z"/></>,
    measure: <><path d="M4 17 17 4l3 3L7 20l-3-3Z"/><path d="m8 13 3 3M11 10l3 3M14 7l3 3"/></>,
    building: <><path d="M5 21V5l9-2v18M14 9h5v12M8 8h2M8 12h2M8 16h2M17 13v2M17 18v3M3 21h18"/></>,
  };
  return <svg className="ui-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}
