import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import AppCard from '@/components/app-card';
import { FormButton } from '@/components/create-quest/form-controls';
import { ThemedText } from '@/components/themed-text';
import type { Hazard, Quest, QuestDropoffs, QuestEquipment, VolumeEstimate } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { TIER_LABELS } from '@/lib/event-format';

const BAG_LABELS: Record<VolumeEstimate['bags'][number]['size'], string> = {
  kitchen: 'kitchen bags', large: 'large trash bags', contractor: 'contractor bags',
};

export default function QuestSummary({ quest, reportedHazards = [] }: { quest: Quest; reportedHazards?: Hazard[] }) {
  const { authedRequest } = useAuth();
  const [equipment, setEquipment] = useState<QuestEquipment | null>(null);
  const [dropoffs, setDropoffs] = useState<QuestDropoffs | null>(null);
  const [error, setError] = useState(false);
  const newHazards = reportedHazards.filter((hazard) => !quest.report.hazards.some((existing) => existing.code === hazard.code));
  const hazards = [...quest.report.hazards, ...newHazards];
  const requiresDropoff = hazards.some((hazard) => hazard.requiresDropoff);
  const requiredGear = equipment?.items.filter((item) => item.required) ?? [];
  const recommendedGear = equipment?.items.filter((item) => !item.required) ?? [];
  const load = useCallback(async () => {
    // The escalation path comes back even when only the new sighting has a drop-off hazard.
    await Promise.all([
      authedRequest<QuestEquipment>(`/quests/${quest.id}/equipment`),
      requiresDropoff ? authedRequest<QuestDropoffs>(`/quests/${quest.id}/dropoffs`) : Promise.resolve(null),
    ]).then(([gear, sites]) => {
      setEquipment(gear);
      setDropoffs(sites);
      setError(false);
    }).catch(() => setError(true));
  }, [authedRequest, quest.id, requiresDropoff]);
  useEffect(() => { void load(); }, [load]);
  const point = quest.report.location;
  return <AppCard>
    <ThemedText type="subtitle">{quest.title}</ThemedText>
    {quest.report.placeName ? <ThemedText>{quest.report.placeName}</ThemedText> : null}
    <ThemedText type="small" themeColor="textSecondary">{point.latitude.toFixed(6)}, {point.longitude.toFixed(6)}</ThemedText>
    <ThemedText type="smallBold">Difficulty: {TIER_LABELS[quest.report.difficultyTier]}</ThemedText>
    <ThemedText>{quest.report.description}</ThemedText>
    {quest.report.estimatedVolume ? <ThemedText type="small">
      Bring {quest.report.estimatedVolume.bags.map((bag) =>
        `${bag.min === bag.max ? bag.min : `${bag.min}-${bag.max}`} ${BAG_LABELS[bag.size]} (${bag.gallons} gal)`).join(', or ')}.
    </ThemedText> : null}
    {newHazards.length > 0 ? <ThemedText type="smallBold">Your new sighting adds safety flags: {newHazards.map((hazard) => hazard.label).join(', ')}</ThemedText> : null}
    {hazards.map((hazard) => <ThemedText key={hazard.code} type="small">{hazard.label}: {hazard.warning}</ThemedText>)}
    {requiredGear.length > 0 && newHazards.length === 0 ? <ThemedText type="smallBold">Required gear: {requiredGear.map((item) => item.name).join(', ')}</ThemedText> : null}
    {recommendedGear.length > 0 && newHazards.length === 0 ? <ThemedText type="small">Recommended gear: {recommendedGear.map((item) => item.name).join(', ')}</ThemedText> : null}
    {dropoffs ? <ThemedText type="small">{dropoffs.escalation.message}</ThemedText> : null}
    {dropoffs?.requiresDropoff && dropoffs.dropoffs.length === 0 ? <ThemedText type="small">No drop-off site was found nearby. Call {dropoffs.escalation.phone} instead.</ThemedText> : null}
    {dropoffs?.requiresDropoff && dropoffs.dropoffs.length > 0 ? <FormButton
      label={`See ${dropoffs.dropoffs.length} nearby drop-off ${dropoffs.dropoffs.length === 1 ? 'site' : 'sites'}`}
      onPress={() => router.push(`/quests/${quest.id}/dropoffs`)} /> : null}
    {requiresDropoff ? <FormButton label="Safety resources" onPress={() => router.push('/resources')} /> : null}
    {error ? <><ThemedText type="small">Could not load safety resources.</ThemedText>
      <FormButton label="Retry safety resources" onPress={() => void load()} /></> : null}
  </AppCard>;
}
