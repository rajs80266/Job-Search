import type { NegativeTerm, Profile, Term } from "@server/types";
import {
  removeAt,
  removeCity,
  renameCity,
  replaceAt,
  togglePreferredCity,
} from "../../lib/profile-edit";
import { AddButton, EditorSection, NumberField, RemoveButton, TagInput, TextField } from "./fields";

interface EditorProps {
  profile: Profile;
  onChange: (profile: Profile) => void;
}

const ROW = "grid grid-cols-[minmax(8rem,1fr)_minmax(10rem,2fr)_auto] items-end gap-2";

function KeywordList({
  title,
  note,
  kind,
  profile,
  onChange,
}: EditorProps & { title: string; note: string; kind: "core" | "adjacent" }) {
  const items = profile.keywords[kind];
  const set = (next: Term[]): void =>
    onChange({ ...profile, keywords: { ...profile.keywords, [kind]: next } });

  return (
    <EditorSection title={title} note={note}>
      {items.map((item, index) => (
        <div key={index} className={ROW}>
          <TextField
            label={index === 0 ? "Term" : `Term ${index + 1}`}
            hideLabel={index > 0}
            value={item.term}
            onChange={(term) => set(replaceAt(items, index, { term }))}
          />
          <TagInput
            label="Aliases (comma-separated)"
            hideLabel={index > 0}
            values={item.aliases}
            onChange={(aliases) => set(replaceAt(items, index, { aliases }))}
            placeholder="spellings and synonyms"
          />
          <RemoveButton
            label={`Remove ${item.term || "keyword"}`}
            onClick={() => set(removeAt(items, index))}
          />
        </div>
      ))}
      <AddButton onClick={() => set([...items, { term: "", aliases: [] }])}>Add keyword</AddButton>
    </EditorSection>
  );
}

export function CoreKeywords(props: EditorProps) {
  return (
    <KeywordList
      {...props}
      kind="core"
      title="Core keywords"
      note="Your target stack. A core term in the title is worth the most."
    />
  );
}

export function AdjacentKeywords(props: EditorProps) {
  return (
    <KeywordList
      {...props}
      kind="adjacent"
      title="Adjacent keywords"
      note="Neighbouring stacks. Relevant, but not the target."
    />
  );
}

export function WeightsEditor({ profile, onChange }: EditorProps) {
  const { weights, tiers } = profile;
  const setWeights = (patch: Partial<Profile["weights"]>): void =>
    onChange({ ...profile, weights: { ...weights, ...patch } });
  const setTiers = (patch: Partial<Profile["tiers"]>): void =>
    onChange({ ...profile, tiers: { ...tiers, ...patch } });

  return (
    <EditorSection
      title="Weights and tiers"
      note="Score = title points + role bonus + capped description points − penalties."
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <NumberField
          label="Core in title"
          value={weights.core.title}
          onChange={(title) => setWeights({ core: { ...weights.core, title } })}
        />
        <NumberField
          label="Core in description"
          value={weights.core.description}
          onChange={(description) => setWeights({ core: { ...weights.core, description } })}
        />
        <NumberField
          label="Adjacent in title"
          value={weights.adjacent.title}
          onChange={(title) => setWeights({ adjacent: { ...weights.adjacent, title } })}
        />
        <NumberField
          label="Adjacent in description"
          value={weights.adjacent.description}
          onChange={(description) => setWeights({ adjacent: { ...weights.adjacent, description } })}
        />
        <NumberField
          label="Role bonus"
          value={weights.roleBonus}
          onChange={(roleBonus) => setWeights({ roleBonus })}
          hint="Core in title + a role word"
        />
        <NumberField
          label="Description cap"
          value={weights.descriptionCap}
          onChange={(descriptionCap) => setWeights({ descriptionCap })}
          hint="Keep below High"
        />
      </div>
      <div className="grid grid-cols-3 gap-3 border-t border-line pt-3">
        <NumberField
          label="High from score"
          value={tiers.high}
          onChange={(high) => setTiers({ high })}
        />
        <NumberField
          label="Medium from score"
          value={tiers.medium}
          onChange={(medium) => setTiers({ medium })}
        />
        <NumberField
          label="Low from score"
          value={tiers.low}
          onChange={(low) => setTiers({ low })}
        />
      </div>
      <TagInput
        label="Role words (a core keyword plus one of these in the title earns the role bonus)"
        values={profile.roleTerms}
        onChange={(roleTerms) => onChange({ ...profile, roleTerms })}
      />
    </EditorSection>
  );
}

export function NegativeTerms({ profile, onChange }: EditorProps) {
  const items = profile.negativeTerms;
  const set = (next: NegativeTerm[]): void => onChange({ ...profile, negativeTerms: next });

  return (
    <EditorSection
      title="Negative terms"
      note="Each match subtracts its penalty once. “Except” phrases cancel the match where they occur."
    >
      {items.map((item, index) => (
        <div key={index} className="space-y-2 border-b border-line pb-3 last:border-b-0 last:pb-0">
          <div className="grid grid-cols-[minmax(8rem,1fr)_6rem_11rem_auto] items-end gap-2">
            <TextField
              label="Term"
              value={item.term}
              onChange={(term) => set(replaceAt(items, index, { term }))}
            />
            <NumberField
              label="Penalty"
              value={item.penalty}
              onChange={(penalty) => set(replaceAt(items, index, { penalty }))}
            />
            <div>
              <label htmlFor={`scope-${index}`} className="mb-1 block text-xs text-muted">
                Looks in
              </label>
              <select
                id={`scope-${index}`}
                value={item.scope}
                onChange={(event) =>
                  set(
                    replaceAt(items, index, { scope: event.target.value as NegativeTerm["scope"] }),
                  )
                }
                className="h-8 w-full rounded-sm border border-line bg-surface px-2 text-sm"
              >
                <option value="title">Title only</option>
                <option value="titleAndDescription">Title and description</option>
              </select>
            </div>
            <RemoveButton
              label={`Remove ${item.term || "negative term"}`}
              onClick={() => set(removeAt(items, index))}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <TagInput
              label="Aliases"
              values={item.aliases}
              onChange={(aliases) => set(replaceAt(items, index, { aliases }))}
            />
            <TagInput
              label="Except (phrases that cancel it)"
              values={item.except}
              onChange={(except) => set(replaceAt(items, index, { except }))}
            />
          </div>
        </div>
      ))}
      <AddButton
        onClick={() =>
          set([...items, { term: "", aliases: [], penalty: 10, except: [], scope: "title" }])
        }
      >
        Add negative term
      </AddButton>
    </EditorSection>
  );
}

export function CitiesEditor({ profile, onChange }: EditorProps) {
  const { cities } = profile;
  const preferred = profile.candidate.preferredCities;
  const preferable = [...cities.map((city) => city.name), "Remote"];

  return (
    <EditorSection
      title="Cities"
      note="Names are what the City filter shows. Aliases are the spellings found in listings."
    >
      <fieldset className="space-y-1">
        <legend className="text-xs text-muted">Preferred (listed first in the City filter)</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {preferable.map((city) => (
            <label key={city} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                className="accent-accent"
                checked={preferred.includes(city)}
                onChange={() => onChange(togglePreferredCity(profile, city))}
              />
              {city || "(unnamed)"}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="space-y-2 border-t border-line pt-3">
        {cities.map((city, index) => (
          <div key={index} className={ROW}>
            <TextField
              label={index === 0 ? "City" : `City ${index + 1}`}
              hideLabel={index > 0}
              value={city.name}
              onChange={(name) => onChange(renameCity(profile, index, name))}
            />
            <TagInput
              label="Aliases (comma-separated)"
              hideLabel={index > 0}
              values={city.aliases}
              onChange={(aliases) =>
                onChange({ ...profile, cities: replaceAt(cities, index, { aliases }) })
              }
            />
            <RemoveButton
              label={`Remove ${city.name || "city"}`}
              onClick={() => onChange(removeCity(profile, index))}
            />
          </div>
        ))}
      </div>
      <AddButton
        onClick={() => onChange({ ...profile, cities: [...cities, { name: "", aliases: [] }] })}
      >
        Add city
      </AddButton>
    </EditorSection>
  );
}
