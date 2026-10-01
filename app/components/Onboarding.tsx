"use client";

import { useState } from "react";
import { useUser } from "@clerk/clerk-react";
import { PLACES, type Place } from "../../lib/places";

export type Profile = {
  role: string;
  interests: string[];
  homePlaceId: string;
  onboardedAt: string;
};

const ROLES = [
  { id: "student", label: "Student", note: "Learning how cities work" },
  { id: "researcher", label: "Researcher", note: "Studying urban systems" },
  { id: "planner", label: "Urban planner", note: "Shaping what gets built" },
  { id: "engineer", label: "Engineer", note: "Water, power, roads" },
  { id: "government", label: "Government", note: "Ward, municipal, state" },
  { id: "responder", label: "Disaster response", note: "Floods, fires, evacuation" },
  { id: "journalist", label: "Journalist", note: "Reporting on the city" },
  { id: "curious", label: "Just curious", note: "Here to look around" },
];

const INTERESTS = [
  { id: "flights", label: "Aircraft", note: "Live" },
  { id: "quakes", label: "Earthquakes", note: "Live" },
  { id: "fires", label: "Active fires", note: "Live" },
  { id: "air", label: "Air & weather", note: "Live" },
  { id: "flood", label: "Flood risk", note: "Model" },
  { id: "power", label: "Power grid", note: "Model" },
  { id: "sewer", label: "Sewer capacity", note: "Model" },
  { id: "evacuation", label: "Evacuation", note: "Model" },
];

type Props = { onDone: (profile: Profile) => void };

export default function Onboarding({ onDone }: Props) {
  const { user } = useUser();
  const [step, setStep] = useState(0);
  const [role, setRole] = useState<string | null>(null);
  const [interests, setInterests] = useState<string[]>([]);
  const [placeId, setPlaceId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const firstName = user?.firstName ?? user?.username ?? user?.primaryEmailAddress?.emailAddress?.split("@")[0] ?? "there";

  function toggleInterest(id: string) {
    setInterests((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]));
  }

  async function finish(place: Place) {
    const profile: Profile = {
      role: role ?? "curious",
      interests,
      homePlaceId: place.id,
      onboardedAt: new Date().toISOString(),
    };
    setSaving(true);
    setError(null);
    try {
      // unsafeMetadata is the user's own preference store: writable from the
      // browser with their session, and nothing here is a security boundary.
      await user?.update({ unsafeMetadata: { ...(user.unsafeMetadata ?? {}), mirrorcity: profile } });
      onDone(profile);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save your answers. Try once more.");
      setSaving(false);
    }
  }

  const steps = [
    {
      index: "STEP 01 / 03",
      title: <>Hi {firstName}.<br /><em>Let&apos;s start your journey.</em></>,
      blurb: "Two questions, then you are in. Your answers shape which layers load first and where the map opens.",
      body: (
        <div className="c-chips">
          {ROLES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="c-chip"
              aria-pressed={role === entry.id}
              onClick={() => {
                setRole(entry.id);
                setStep(1);
              }}
            >
              {entry.label}
              <small>{entry.note}</small>
            </button>
          ))}
        </div>
      ),
      heading: "Who are you?",
      canAdvance: role !== null,
    },
    {
      index: "STEP 02 / 03",
      title: <>What do you<br /><em>want to watch?</em></>,
      blurb: "Live layers stream from public feeds. Models run in your browser. Pick as many as you like, or none, and change it later.",
      body: (
        <div className="c-chips">
          {INTERESTS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="c-chip"
              aria-pressed={interests.includes(entry.id)}
              onClick={() => toggleInterest(entry.id)}
            >
              {entry.label}
              <small>{entry.note}</small>
            </button>
          ))}
        </div>
      ),
      heading: null,
      canAdvance: true,
    },
    {
      index: "STEP 03 / 03",
      title: <>Where do you<br /><em>want to start?</em></>,
      blurb: "Each of these is densely mapped in OpenStreetMap, so the first thing you see is a real place rather than an empty plane.",
      body: (
        <div className="c-places">
          {PLACES.map((place) => (
            <button
              key={place.id}
              type="button"
              className="c-place"
              aria-pressed={placeId === place.id}
              disabled={saving}
              onClick={() => {
                setPlaceId(place.id);
                void finish(place);
              }}
            >
              <small>{place.region}</small>
              <b>{place.name}</b>
              <u>{place.note}</u>
            </button>
          ))}
        </div>
      ),
      heading: null,
      canAdvance: placeId !== null,
    },
  ];

  const current = steps[step];

  return (
    <div className="c-gate-main">
      <div className="c-step-head">
        <div className="c-step-index">
          <span>{current.index}</span>
          <b />
          <div className="c-progress">
            {steps.map((entry, index) => (
              <i key={entry.index} className={index <= step ? "on" : ""} />
            ))}
          </div>
        </div>
        <h1>{current.title}</h1>
        <p>{current.blurb}</p>
      </div>

      {current.heading && <p className="c-micro" style={{ marginBottom: 14 }}>{current.heading}</p>}
      {current.body}

      {error && <p className="c-error">{error}</p>}

      <div className="c-step-foot">
        <span className="c-micro">{saving ? "Saving…" : step === 2 ? "Pick a place to finish" : "Select to continue"}</span>
        {step > 0 && (
          <button type="button" className="c-btn ghost" onClick={() => setStep(step - 1)} disabled={saving}>
            Back
          </button>
        )}
        {step < 2 && (
          <button type="button" className="c-btn primary" disabled={!current.canAdvance} onClick={() => setStep(step + 1)}>
            Continue
          </button>
        )}
      </div>
    </div>
  );
}
