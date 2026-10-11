import { useCallback, useEffect, useState } from 'react';
import { Linking, View } from 'react-native';

import AppCard from '@/components/app-card';
import { FormButton } from '@/components/create-quest/form-controls';
import { ThemedText } from '@/components/themed-text';
import type { Hazard, Quest } from '@/lib/api';
import { useAuth } from '@/lib/auth';

type Guidance = {
  items: { id: string; name: string }[];
  hazards: Hazard[];
};
type Dropoffs = {
  guidance: string[];
  escalationRecommended: boolean;
  locations: { id: string; name: string; address: string; latitude: number; longitude: number; notes: string | null }[];
};

export default function QuestSummary({ quest, reportedHazards = [] }: { quest: Quest; reportedHazards?: Hazard[] }) {
  const { authedRequest } = useAuth();
  const [equipment, setEquipment] = useState<Guidance | null>(null);
  const [dropoffs, setDropoffs] = useState<Dropoffs | null>(null);
  const [error, setError] = useState(false);
  const newHazards = reportedHazards.filter((hazard) => !quest.report.hazards.some((existing) => existing.code === hazard.code));
  const hazards = [...quest.report.hazards, ...newHazards];
  const questRequiresDropoff = quest.report.hazards.some((hazard) => hazard.requiresDropoff);
  const requiresDropoff = hazards.some((hazard) => hazard.requiresDropoff);
  const load = useCallback(async () => {
    await Promise.all([
      authedRequest<Guidance>(`/quests/${quest.id}/equipment`),
      questRequiresDropoff ? authedRequest<Dropoffs>(`/quests/${quest.id}/dropoffs`) : Promise.resolve(null),
    ]).then(([gear, sites]) => {
      setEquipment(gear);
      setDropoffs(sites);
      setError(false);
    }).catch(() => setError(true));
  }, [authedRequest, quest.id, questRequiresDropoff]);
  useEffect(() => { void load(); }, [load]);
  const point = quest.report.location;
  return <AppCard>
    <ThemedText type="subtitle">{quest.title}</ThemedText>
    <ThemedText>{quest.report.placeName ?? `${point.latitude}, ${point.longitude}`}</ThemedText>
    <ThemedText type="small">Location: {point.latitude.toFixed(6)}, {point.longitude.toFixed(6)}</ThemedText>
    <ThemedText type="smallBold">Difficulty: {quest.report.difficultyTier}</ThemedText>
    <ThemedText>{quest.report.description}</ThemedText>
    {quest.report.estimatedVolume?.bags.map((bag) => <ThemedText key={bag.size} type="small">
      {bag.size} bags ({bag.gallons} gal): {bag.min}-{bag.max}
    </ThemedText>)}
    {newHazards.length > 0 ? <ThemedText type="smallBold">Your new sighting adds safety flags: {newHazards.map((hazard) => hazard.label).join(', ')}</ThemedText> : null}
    {hazards.map((hazard) => <ThemedText key={hazard.code} type="small">{hazard.label}: {hazard.warning}</ThemedText>)}
    {equipment?.items.length && newHazards.length === 0 ? <ThemedText type="small">Recommended gear: {equipment.items.map((item) => item.name).join(', ')}</ThemedText> : null}
    {dropoffs?.guidance.map((text) => <ThemedText key={text} type="small">{text}</ThemedText>)}
    {requiresDropoff ? <ThemedText type="small">Do not touch sharps or biological waste. Contact local sanitation for escalation. Verify acceptance and opening hours before visiting a drop-off.</ThemedText> : null}
    {dropoffs?.escalationRecommended ? <ThemedText type="small">No suitable nearby drop-off was found. Contact local sanitation for help.</ThemedText> : null}
    {dropoffs?.locations.map((site) => <View key={site.id} style={{ gap: 8 }}>
      <ThemedText type="smallBold">{site.name}</ThemedText>
      <ThemedText type="small">{site.address}</ThemedText>
      {site.notes ? <ThemedText type="small">{site.notes}</ThemedText> : null}
      <FormButton label={`Directions to ${site.name}`} onPress={() => {
        void Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${site.latitude},${site.longitude}`)
          .catch(() => setError(true));
      }} />
    </View>)}
    {error ? <><ThemedText type="small">Could not load safety resources or open directions.</ThemedText>
      <FormButton label="Retry safety resources" onPress={() => void load()} /></> : null}
  </AppCard>;
}
