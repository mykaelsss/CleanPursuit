import type { ImagePickerAsset } from 'expo-image-picker';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, View } from 'react-native';

import AppCard from '@/components/app-card';
import { FormButton } from '@/components/create-quest/form-controls';
import LocationStep, { type LocationDraft } from '@/components/create-quest/location-step';
import PhotoStep from '@/components/create-quest/photo-step';
import QuestDetailsStep from '@/components/create-quest/quest-details-step';
import { CreateQuestButton, CreateQuestHero, QuestReadiness, QuestReward } from '@/components/create-quest/quest-status';
import QuestSummary from '@/components/create-quest/quest-summary';
import SafetyWarningModal from '@/components/create-quest/safety-warning-modal';
import ScheduleStep from '@/components/create-quest/schedule-step';
import { createInitialSchedule, isValidSchedule, scheduleDates } from '@/components/create-quest/schedule-utils';
import ScreenLayout from '@/components/screen-layout';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { ApiError, type Hazard, type PhotoAnalysis, type Quest, type ReportTags } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { parseLocation, parseVolume, saveQuest, type CreationProgress } from '@/lib/create-quest';
import { uploadReportPhoto, type PhotoProgress } from '@/lib/report-photo';

const emptyLocation: LocationDraft = { latitude: '', longitude: '', placeName: '' };

type PhotoFields = 'description' | 'categories' | 'hazards' | 'volume';

export default function CreateQuestScreen() {
  const { authedRequest } = useAuth();
  const theme = useTheme();
  const [tags, setTags] = useState<ReportTags | null>(null);
  const [tagsError, setTagsError] = useState(false);
  const [photo, setPhoto] = useState<ImagePickerAsset | null>(null);
  const [fileId, setFileId] = useState<string | null>(null);
  const [photoStatus, setPhotoStatus] = useState<'idle' | 'uploading' | 'analyzing' | 'ready' | 'error'>('idle');
  const [photoMessage, setPhotoMessage] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedHazards, setSelectedHazards] = useState<string[]>([]);
  const [pendingHazards, setPendingHazards] = useState<string[]>([]);
  const [volume, setVolume] = useState({ low: '', high: '' });
  const [location, setLocation] = useState(emptyLocation);
  const [locationConfirmed, setLocationConfirmed] = useState(false);
  const [locationBusy, setLocationBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [scheduleParty, setScheduleParty] = useState(true);
  const [schedule, setSchedule] = useState(createInitialSchedule);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [reportedHazards, setReportedHazards] = useState<Hazard[]>([]);
  const [duplicateReview, setDuplicateReview] = useState<Quest | null>(null);
  const [result, setResult] = useState<{ quest: Quest; eventId?: string; duplicate: boolean } | null>(null);
  const photoProgress = useRef<PhotoProgress>({});
  const progress = useRef<CreationProgress>({});
  const photoVersion = useRef(0);
  const skippedAnalysis = useRef<number | null>(null);
  const dirty = useRef(new Set<PhotoFields>());
  const submitting = useRef(false);

  const loadTags = useCallback(async () => {
    await authedRequest<ReportTags>('/tags').then(setTags).catch(() => setTagsError(true));
  }, [authedRequest]);
  useEffect(() => { void loadTags(); }, [loadTags]);
  useEffect(() => () => { photoVersion.current++; }, []);

  const edit = (field: PhotoFields) => {
    dirty.current.add(field);
    setConfirmed(false);
  };

  const preparePhoto = async (asset: ImagePickerAsset, version: number, upload: PhotoProgress) => {
    setPhotoStatus('uploading');
    setPhotoMessage('Preparing and uploading your before photo...');
    try {
      const id = await uploadReportPhoto(asset, authedRequest, upload);
      if (version !== photoVersion.current) return;
      setFileId(id);
      setPhotoStatus('analyzing');
      setPhotoMessage('Looking for litter, categories, hazards and a trash amount. You can fill in the details while you wait.');
      try {
        const analysis = await authedRequest<PhotoAnalysis>(`/files/${id}/analysis`, { method: 'POST' });
        if (version !== photoVersion.current || skippedAnalysis.current === version) return;
        if (!dirty.current.has('description')) setDescription(analysis.description);
        if (!dirty.current.has('categories')) setSelectedTags(analysis.categories);
        if (!dirty.current.has('hazards')) setPendingHazards(analysis.hazards);
        if (!dirty.current.has('volume')) setVolume({
          low: analysis.estimatedVolume ? String(analysis.estimatedVolume.minGallons) : '',
          high: analysis.estimatedVolume ? String(analysis.estimatedVolume.maxGallons) : '',
        });
        setConfirmed(false);
        setPhotoMessage(analysis.showsLitter
          ? 'Suggestions are ready. Review the description, categories, hazards and amount before confirming.'
          : 'AI did not see litter in this photo. Check it and describe what needs cleaning. You can still continue.');
      } catch {
        if (version !== photoVersion.current || skippedAnalysis.current === version) return;
        setPhotoMessage('Photo uploaded. AI suggestions are unavailable. Fill in the report yourself to continue.');
      }
      if (version === photoVersion.current) setPhotoStatus('ready');
    } catch (err) {
      if (version !== photoVersion.current) return;
      setPhotoStatus('error');
      setPhotoMessage(err instanceof Error ? err.message : 'Photo upload failed. Please retry.');
    }
  };

  const changePhoto = (next: ImagePickerAsset | null) => {
    const version = ++photoVersion.current;
    const upload: PhotoProgress = {};
    photoProgress.current = upload;
    skippedAnalysis.current = null;
    setPhoto(next);
    setFileId(null);
    setConfirmed(false);
    setPendingHazards([]);
    setPhotoMessage(null);
    setPhotoStatus('idle');
    if (!dirty.current.has('description')) setDescription('');
    if (!dirty.current.has('categories')) setSelectedTags([]);
    if (!dirty.current.has('hazards')) setSelectedHazards([]);
    if (!dirty.current.has('volume')) setVolume({ low: '', high: '' });
    if (next) void preparePhoto(next, version, upload);
  };

  const toggleHazard = (code: string) => {
    edit('hazards');
    if (selectedHazards.includes(code)) {
      setSelectedHazards((current) => current.filter((item) => item !== code));
    } else {
      setPendingHazards((current) => [...new Set([...current, code])]);
    }
  };
  const answerHazard = (accept: boolean) => {
    if (accept && pendingHazards[0]) {
      setSelectedHazards((current) => [...new Set([...current, pendingHazards[0]])]);
    }
    setConfirmed(false);
    setPendingHazards((current) => current.slice(1));
  };

  const point = parseLocation(location.latitude, location.longitude);
  const amount = parseVolume(volume.low, volume.high);
  const detailsValid = title.trim().length >= 3 && description.trim().length > 0 &&
    selectedTags.length > 0 && amount !== null && !!tags &&
    selectedTags.every((code) => tags.categories.some((tag) => tag.code === code)) &&
    selectedHazards.every((code) => tags.hazards.some((tag) => tag.code === code));
  const photoReady = !!fileId && photoStatus === 'ready';
  const completedSteps = [photoReady, detailsValid && confirmed && pendingHazards.length === 0,
    !!point && !!location.placeName.trim() && locationConfirmed && !locationBusy, !scheduleParty || isValidSchedule(schedule)].filter(Boolean).length;
  const ready = completedSteps === 4;

  const createQuest = async () => {
    if (submitting.current || !ready || !fileId || !point) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const quest = await saveQuest(authedRequest, {
        photoFileId: fileId, description: description.trim(), location: point,
        placeName: location.placeName.trim(), categories: selectedTags, hazards: selectedHazards,
        ...(amount ? { estimatedVolume: amount } : {}),
      }, title, progress.current, () => {
        setSaved(!!progress.current.report);
        setReportedHazards(progress.current.report?.hazards ?? []);
      });
      const duplicate = !!progress.current.report?.duplicateOf;
      if (scheduleParty && duplicate && !duplicateReview) {
        setDuplicateReview(quest);
        return;
      }
      let eventId: string | undefined;
      if (scheduleParty) {
        // Validate again because a start time can pass while the report is being saved.
        if (!isValidSchedule(schedule)) throw new Error('Your quest is saved. Choose a future start and an end within 12 hours, then retry scheduling.');
        const { start, end } = scheduleDates(schedule);
        const event = await authedRequest<{ id: string }>(`/quests/${quest.id}/events`, {
          method: 'POST', body: { scheduledStart: start.toISOString(), scheduledEnd: end.toISOString() },
        });
        eventId = event.id;
      }
      setResult({ quest, eventId, duplicate });
    } catch (err) {
      const message = err instanceof ApiError || err instanceof Error ? err.message : 'Check your connection and try again.';
      setError(progress.current.quest ? `Quest saved. Party scheduling did not finish: ${message}`
        : progress.current.report ? `Report saved. Quest creation did not finish: ${message}` : message);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  const reset = () => {
    changePhoto(null);
    dirty.current.clear();
    progress.current = {};
    setTitle(''); setDescription(''); setSelectedTags([]); setSelectedHazards([]);
    setVolume({ low: '', high: '' }); setLocation(emptyLocation); setLocationConfirmed(false);
    setSchedule(createInitialSchedule()); setScheduleParty(true); setSaved(false);
    setReportedHazards([]);
    setError(null); setDuplicateReview(null); setResult(null);
  };

  if (result) return (
    <ScreenLayout title={result.duplicate ? 'Spot already reported' : 'Quest created'}
      subtitle={result.duplicate ? 'Your report was saved and linked to the original spot.' : 'Your cleanup spot is now a community quest.'}>
      <QuestSummary quest={result.quest} reportedHazards={reportedHazards} />
      <ThemedText>{result.eventId ? 'Your party is scheduled. You are its organizer and first attendee.'
        : 'You have raised awareness of this spot. Creating a quest does not sign you up for a party.'}</ThemedText>
      <FormButton label="Browse cleanup parties" onPress={() => router.navigate('/events')} />
      <FormButton label="Create another quest" onPress={reset} />
    </ScreenLayout>
  );

  return (
    <>
      <ScreenLayout title="Create a quest" subtitle="Report a cleanup spot and invite your neighborhood to help."
        headerContent={<CreateQuestHero />}>
        <QuestReadiness completedSteps={completedSteps} />
        {saved ? <ThemedText type="small">Your report is saved. Its details are locked while you finish creating the quest or scheduling a party.</ThemedText> : null}
        {!saved ? <View pointerEvents={busy ? 'none' : 'auto'} style={styles.section} aria-hidden={busy}>
          <PhotoStep photo={photo} onPhotoChange={changePhoto} />
          {photoMessage ? <ThemedText type="small" accessibilityLiveRegion="polite">{photoMessage}</ThemedText> : null}
          {photoStatus === 'uploading' || photoStatus === 'analyzing' ? <ActivityIndicator color={theme.tint} /> : null}
          {photoStatus === 'error' && photo ? <FormButton label="Retry photo upload"
            onPress={() => void preparePhoto(photo, photoVersion.current, photoProgress.current)} /> : null}
          {photoStatus === 'analyzing' ? <FormButton label="Continue without AI suggestions" onPress={() => {
            skippedAnalysis.current = photoVersion.current;
            setPhotoStatus('ready');
            setPhotoMessage('Photo uploaded. Fill in and confirm the report yourself.');
          }} /> : null}
          {tags ? <QuestDetailsStep title={title} description={description} tags={tags}
            volumeLow={volume.low} volumeHigh={volume.high} selectedTags={selectedTags} selectedSafetyFlags={selectedHazards}
            onTitleChange={(value) => { setTitle(value); setConfirmed(false); }}
            onDescriptionChange={(value) => { edit('description'); setDescription(value); }}
            onVolumeChange={(low, high) => { edit('volume'); setVolume({ low, high }); }}
            onTagPress={(code) => { edit('categories'); setSelectedTags((current) =>
              current.includes(code) ? current.filter((item) => item !== code) : [...current, code]); }}
            onSafetyFlagPress={toggleHazard} /> : tagsError ? (
              <AppCard><ThemedText>Could not load report categories and hazards.</ThemedText>
                <FormButton label="Retry loading categories" onPress={() => { setTagsError(false); void loadTags(); }} /></AppCard>
            ) : <ActivityIndicator color={theme.tint} />}
          <Check label="I reviewed the description, trash categories, hazards and amount." checked={confirmed}
            disabled={!photoReady || !detailsValid || pendingHazards.length > 0} onPress={() => setConfirmed(!confirmed)} />
          <LocationStep value={location} onBusyChange={setLocationBusy}
            onChange={(value) => { setLocation(value); setLocationConfirmed(false); }} />
          <Check label="I confirm these coordinates mark the cleanup spot." checked={locationConfirmed}
            disabled={!point || !location.placeName.trim() || locationBusy} onPress={() => setLocationConfirmed(!locationConfirmed)} />
        </View> : null}
        {duplicateReview ? <AppCard>
          <ThemedText type="smallBold">This spot already has a report</ThemedText>
          <ThemedText>Your report was linked to it. Review the original quest before scheduling your party there.</ThemedText>
          <QuestSummary quest={duplicateReview} reportedHazards={reportedHazards} />
          <FormButton label="Finish without a party" disabled={busy} onPress={() => setResult({
            quest: duplicateReview, duplicate: true,
          })} />
        </AppCard> : null}
        <View pointerEvents={busy ? 'none' : 'auto'} style={styles.section}>
          <AppCard>
            <View style={styles.toggleRow}>
              <ThemedText type="smallBold" style={styles.toggleLabel}>Organize a scheduled party</ThemedText>
              <Switch accessibilityLabel="Organize a scheduled party" value={scheduleParty} onValueChange={setScheduleParty} disabled={busy} />
            </View>
            <ThemedText type="small" themeColor="textSecondary">{scheduleParty
              ? 'You will be the party leader and first attendee. Only the leader can end the party.'
              : 'Create the quest to raise awareness. You can choose a cleanup party later.'}</ThemedText>
          </AppCard>
          {scheduleParty ? <ScheduleStep value={schedule} onChange={setSchedule} /> : null}
          {scheduleParty && !isValidSchedule(schedule) ? <ThemedText type="small" themeColor="error">
            Choose a future start and an end after it, at most 12 hours later.
          </ThemedText> : null}
        </View>
        <QuestReward />
        {error ? <ThemedText themeColor="error" accessibilityRole="alert">{error}</ThemedText> : null}
        <CreateQuestButton ready={ready} busy={busy}
          label={busy ? 'Saving...' : duplicateReview && scheduleParty ? 'Schedule party on this quest' : saved ? 'Finish creating quest' : 'Create quest'}
          onPress={() => void createQuest()} />
      </ScreenLayout>
      <SafetyWarningModal flag={tags?.hazards.find((flag) => flag.code === pendingHazards[0])}
        onCancel={() => answerHazard(false)} onConfirm={() => answerHazard(true)} />
    </>
  );
}

function Check({ label, checked, disabled, onPress }: {
  label: string; checked: boolean; disabled: boolean; onPress: () => void;
}) {
  const theme = useTheme();
  return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked, disabled }}
    aria-checked={checked} aria-disabled={disabled}
    disabled={disabled} onPress={onPress} style={[styles.check, { borderColor: checked ? theme.tint : theme.border }, disabled && styles.disabled]}>
    <ThemedText type="smallBold">{checked ? '☑' : '☐'} {label}</ThemedText>
  </Pressable>;
}

const styles = StyleSheet.create({
  section: { gap: 16 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  toggleLabel: { flex: 1 },
  check: { minHeight: 48, borderWidth: 1, borderRadius: 14, padding: 14, justifyContent: 'center' },
  disabled: { opacity: 0.5 },
});
