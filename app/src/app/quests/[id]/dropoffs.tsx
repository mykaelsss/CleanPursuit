import { Link, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AppBadge from '@/components/app-badge';
import AppButton from '@/components/app-button';
import AppCard from '@/components/app-card';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Dropoff, Quest, QuestDropoffs, QuestEquipment } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { openDirections } from '@/lib/directions';
import { openUrl } from '@/lib/open-url';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; quest: Quest; dropoffs: QuestDropoffs; equipment: QuestEquipment };

export default function QuestDropoffsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { authedRequest } = useAuth();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      authedRequest<Quest>(`/quests/${id}`),
      authedRequest<QuestDropoffs>(`/quests/${id}/dropoffs`),
      authedRequest<QuestEquipment>(`/quests/${id}/equipment`),
    ])
      .then(([quest, dropoffs, equipment]) => {
        if (!cancelled) setState({ status: 'ready', quest, dropoffs, equipment });
      })
      .catch((err: Error) => {
        if (!cancelled) setState({ status: 'error', message: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, [authedRequest, id]);

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.four }]}>
      <Stack.Screen options={{ title: 'Drop-off sites' }} />
      {state.status === 'loading' && <ActivityIndicator color={theme.tint} style={styles.loading} />}
      {state.status === 'error' && <ThemedText themeColor="error">{state.message}</ThemedText>}
      {state.status === 'ready' && (
        <DropoffDetails quest={state.quest} dropoffs={state.dropoffs} equipment={state.equipment} />
      )}
      <Link href="/resources" asChild>
        <Pressable accessibilityRole="link" style={styles.resourcesLink}>
          <ThemedText type="smallBold" themeColor="tint">
            Safety resources for NYC
          </ThemedText>
        </Pressable>
      </Link>
    </ScrollView>
  );
}

function DropoffDetails({
  quest,
  dropoffs: { requiresDropoff, dropoffs, escalation },
  equipment,
}: {
  quest: Quest;
  dropoffs: QuestDropoffs;
  equipment: QuestEquipment;
}) {
  const hazards = quest.report.hazards.filter((hazard) => hazard.requiresDropoff);
  const requiredGear = equipment.items.filter((item) => item.required);

  return (
    <>
      <ThemedText type="subtitle">{quest.title}</ThemedText>

      {!requiresDropoff && (
        <ThemedText themeColor="textSecondary">
          This quest has no sharps or biohazard, so it does not need a drop-off site.
        </ThemedText>
      )}

      {requiresDropoff && (
        <>
          <AppCard title={`Recommended: call ${escalation.phone}`}>
            <ThemedText type="small">{escalation.message}</ThemedText>
            <View style={styles.actions}>
              <AppButton label={`Call ${escalation.phone}`} onPress={() => openUrl(`tel:${escalation.phone}`)} />
              <AppButton label="Report online" variant="secondary" onPress={() => openUrl(escalation.url)} />
            </View>
          </AppCard>

          {hazards.map((hazard) => (
            <AppCard key={hazard.code} title={hazard.label}>
              <ThemedText type="small">{hazard.warning}</ThemedText>
            </AppCard>
          ))}

          {requiredGear.length > 0 && (
            <AppCard title="Required gear">
              {requiredGear.map((item) => (
                <View key={item.id} style={styles.gearItem}>
                  <ThemedText type="smallBold">{item.name}</ThemedText>
                  {item.description && (
                    <ThemedText type="small" themeColor="textSecondary">
                      {item.description}
                    </ThemedText>
                  )}
                </View>
              ))}
            </AppCard>
          )}

          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionTitle}>
            NEAREST DROP-OFF SITES
          </ThemedText>
          {dropoffs.length === 0 ? (
            <ThemedText themeColor="textSecondary">
              No drop-off site was found nearby. Call {escalation.phone} so the city can collect it.
            </ThemedText>
          ) : (
            dropoffs.map((dropoff) => <DropoffCard key={dropoff.id} dropoff={dropoff} />)
          )}
        </>
      )}
    </>
  );
}

function DropoffCard({ dropoff }: { dropoff: Dropoff }) {
  return (
    <AppCard
      title={dropoff.name}
      rightContent={
        <ThemedText type="small" themeColor="textSecondary">
          {formatDistance(dropoff.distanceM)}
        </ThemedText>
      }>
      {!dropoff.verified && <AppBadge label="UNVERIFIED - CALL AHEAD" />}
      <ThemedText type="small">{dropoff.address}</ThemedText>
      {dropoff.hours && (
        <ThemedText type="small" themeColor="textSecondary">
          Hours: {dropoff.hours}
        </ThemedText>
      )}
      {dropoff.notes && (
        <ThemedText type="small" themeColor="textSecondary">
          Where: {dropoff.notes}
        </ThemedText>
      )}
      {dropoff.phone && <PhoneLink phone={dropoff.phone} />}
      <AppButton
        label="Directions"
        accessibilityHint="Opens directions in a maps app"
        onPress={() =>
          openDirections({
            name: dropoff.name,
            latitude: dropoff.location.latitude,
            longitude: dropoff.location.longitude,
            googlePlaceId: dropoff.googlePlaceId,
          })
        }
      />
    </AppCard>
  );
}

function PhoneLink({ phone }: { phone: string }) {
  return (
    <Pressable
      onPress={() => openUrl(`tel:${phone.replace(/[^\d+]/g, '')}`)}
      accessibilityRole="link"
      accessibilityLabel={`Call ${phone}`}>
      <ThemedText type="smallBold" themeColor="tint">
        {phone}
      </ThemedText>
    </Pressable>
  );
}

const METERS_PER_MILE = 1609.344;

function formatDistance(meters: number): string {
  const miles = meters / METERS_PER_MILE;
  return miles < 0.1 ? 'Under 0.1 mi' : `${miles.toFixed(1)} mi`;
}

const styles = StyleSheet.create({
  content: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    padding: Spacing.four,
    gap: Spacing.three,
  },
  loading: {
    marginTop: Spacing.five,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  gearItem: {
    gap: Spacing.half,
  },
  sectionTitle: {
    letterSpacing: 1,
    marginTop: Spacing.two,
  },
  resourcesLink: {
    alignSelf: 'center',
    paddingVertical: Spacing.two,
  },
});
