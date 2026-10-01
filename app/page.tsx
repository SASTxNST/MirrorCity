"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { SignedIn, SignedOut, SignInButton, SignUpButton, UserButton, useUser } from "@clerk/clerk-react";
import Onboarding, { type Profile } from "./components/Onboarding";
import { findPlace, PLACES } from "../lib/places";

function ConsoleBar({ right }: { right?: React.ReactNode }) {
  return (
    <header className="c-bar">
      <div className="c-bar-cell">
        <Link href="/" className="c-mark"><i /><b>MIRROR<span>CITY</span></b></Link>
      </div>
      <div className="c-bar-cell">
        <span className="c-micro-dim">Open spatial intelligence</span>
      </div>
      <div className="c-bar-cell">{right}</div>
    </header>
  );
}

function StatusBar({ note }: { note: string }) {
  const [clock, setClock] = useState("");
  useEffect(() => {
    const tick = () => setClock(new Date().toISOString().slice(11, 19) + "Z");
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <footer className="c-statusbar">
      <span>MirrorCity / v0.2</span>
      <span>{note}</span>
      <span className="c-data">{clock}</span>
    </footer>
  );
}

// Signed out. One instruction, one action, nothing else to read.
function Welcome() {
  return (
    <div className="c-gate-main">
      <div className="c-step-head">
        <div className="c-step-index">
          <span>Access required</span>
          <b />
        </div>
        <h1>Welcome.</h1>
        <p>
          MirrorCity renders real places in 3D from open map data and streams live feeds over them: aircraft
          overhead, earthquakes, active fires, air and weather. To access, first sign in to the platform.
        </p>
      </div>

      <div className="c-step-foot" style={{ marginTop: 10, borderTop: 0, paddingTop: 0 }}>
        <span className="c-micro">Free · no card</span>
        <SignUpButton mode="modal">
          <button type="button" className="c-btn ghost">Create account</button>
        </SignUpButton>
        <SignInButton mode="modal">
          <button type="button" className="c-btn primary">Sign in</button>
        </SignInButton>
      </div>
    </div>
  );
}

// Signed in and onboarded: a short launch board, not a dashboard.
function Launchpad({ profile }: { profile: Profile }) {
  const { user } = useUser();
  const home = findPlace(profile.homePlaceId) ?? PLACES[0];
  const firstName = user?.firstName ?? user?.username ?? "operator";

  return (
    <div className="c-gate-main">
      <div className="c-step-head">
        <div className="c-step-index">
          <span>Session ready</span>
          <b />
          <span className="c-live"><i />Live feeds online</span>
        </div>
        <h1>Hi {firstName}.<br /><em>Your map is ready.</em></h1>
        <p>
          Opening at {home.name}, {home.region}. Every building, road and waterway is real geometry from
          OpenStreetMap, clipped to the area you load.
        </p>
      </div>

      <div className="c-places">
        {PLACES.map((place) => (
          <Link
            key={place.id}
            href={`/explore?place=${place.id}`}
            className="c-place"
            aria-pressed={place.id === home.id}
          >
            <small>{place.region}</small>
            <b>{place.name}</b>
            <u>{place.note}</u>
          </Link>
        ))}
      </div>

      <div className="c-step-foot">
        <span className="c-micro">{profile.interests.length} layer{profile.interests.length === 1 ? "" : "s"} selected</span>
        <Link href="/workspace" className="c-btn ghost">Simulation workspace</Link>
        <Link href={`/explore?place=${home.id}`} className="c-btn primary">Open the map</Link>
      </div>
    </div>
  );
}

export default function Home() {
  const { user, isLoaded } = useUser();
  const [justOnboarded, setJustOnboarded] = useState<Profile | null>(null);

  // The profile lives on the Clerk user, so it survives across devices without
  // a table of our own.
  const profile = useMemo<Profile | null>(() => {
    if (justOnboarded) return justOnboarded;
    const stored = (user?.unsafeMetadata as { mirrorcity?: Profile } | undefined)?.mirrorcity;
    return stored?.homePlaceId ? stored : null;
  }, [user, justOnboarded]);

  return (
    <div className="console">
      <div className="c-gate">
        <ConsoleBar
          right={
            <>
              <SignedOut><span className="c-live off"><i />Signed out</span></SignedOut>
              <SignedIn><UserButton /></SignedIn>
            </>
          }
        />

        <div className="c-gate-body">
          <aside className="c-grid-field" />

          {!isLoaded ? (
            <div className="c-gate-main">
              <p className="c-micro">Connecting…</p>
            </div>
          ) : (
            <>
              <SignedOut><Welcome /></SignedOut>
              <SignedIn>
                {profile ? <Launchpad profile={profile} /> : <Onboarding onDone={setJustOnboarded} />}
              </SignedIn>
            </>
          )}

          <aside className="c-grid-field" />
        </div>

        <StatusBar note={isLoaded ? (user ? "Authenticated" : "Awaiting sign-in") : "Handshake"} />
      </div>
    </div>
  );
}
