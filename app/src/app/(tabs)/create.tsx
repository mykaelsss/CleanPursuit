import type { ImagePickerAsset } from 'expo-image-picker';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';

import AppCard from '@/components/app-card';
import { ConfirmCheck, FormButton } from '@/components/create-quest/form-controls';
import LocationStep, { type LocationDraft } from '@/components/create-quest/location-step';
import PhotoStep, { type PhotoSource, type PhotoStatus } from '@/components/create-quest/photo-step';
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
import { parseLocation, parseVolume, photoPoint, saveQuest, type CreationProgress } from '@/lib/create-quest';
import { uploadReportPhoto, type PhotoProgress } from '@/lib/report-photo';
import { currentPoint, formatCoordinate, placeNameFor } from '@/lib/spot-location';

const emptyLocation: LocationDraft = { latitude: '', longitude: '', placeName: '' };

type PhotoFields = 'title' | 'description' | 'categories' | 'hazards' | 'volume';

export default function CreateQuestScreen() {
  const { authedRequest } = useAuth();
  const theme = useTheme();
  const [tags, setTags] = useState<ReportTags | null>(null);
  const [tagsError, setTagsError] = useState(false);
  const [photo, setPhoto] = useState<ImagePickerAsset | null>(null);
  const [fileId, setFileId] = useState<string | null>(null);
  const [photoStatus, setPhotoStatus] = useState<PhotoStatus>('idle');
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
  const [locationNote, setLocationNote] = useState<string | null>(null);
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
  // Set once the reporter edits or looks up the location, so the photo no longer fills it in.
  const locationTouched = useRef(false);
  const submitting = useRef(false);

  // The analysis callback reads tags from here, because its closure can predate the tags loading.
  const loadedTags = useRef<ReportTags | null>(null);

  const loadTags = useCallback(async () => {
    await authedRequest<ReportTags>('/tags').then((loaded) => {
      loadedTags.current = loaded;
      setTags(loaded);
    }).catch(() => setTagsError(true));
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
      setPhotoMessage('Suggesting a title, description, categories, hazards and a trash amount. You can fill in the details while you wait.');
      try {
        const analysis = await authedRequest<PhotoAnalysis>(`/files/${id}/analysis`, { method: 'POST' });
        if (version !== photoVersion.current || skippedAnalysis.current === version) return;
        if (!dirty.current.has('title') && analysis.title) setTitle(analysis.title);
        if (!dirty.current.has('description')) setDescription(analysis.description);
        if (!dirty.current.has('categories')) setSelectedTags(analysis.categories);
        if (!dirty.current.has('hazards')) suggestHazards(analysis.hazards);
        if (!dirty.current.has('volume')) setVolume({
          low: analysis.estimatedVolume ? String(analysis.estimatedVolume.minGallons) : '',
          high: analysis.estimatedVolume ? String(analysis.estimatedVolume.maxGallons) : '',
        });
        setConfirmed(false);
        setPhotoMessage(analysis.showsLitter
          ? 'Suggestions are ready. Review the title, description, categories, hazards and amount before confirming.'
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

  // Only drop-off hazards (sharps, biohazard) wait for the Yes/No warning. Other suggestions are added
  // straight away and codes the API does not know are dropped. Before tags load, all of them wait.
  const suggestHazards = (codes: string[]) => {
    const known = loadedTags.current ? new Map(loadedTags.current.hazards.map((hazard) => [hazard.code, hazard])) : null;
    if (!known) return setPendingHazards(codes);
    setSelectedHazards(codes.filter((code) => known.has(code) && !known.get(code)!.requiresDropoff));
    setPendingHazards(codes.filter((code) => known.get(code)?.requiresDropoff));
  };

  // Fills in the spot from the photo's GPS tags, or from the phone for a photo just taken on it.
  // A library photo without GPS may be from elsewhere, so it leaves the location empty.
  const fillLocation = async (asset: ImagePickerAsset, source: PhotoSource | undefined, version: number) => {
    const stale = () => version !== photoVersion.current || locationTouched.current;
    let point = photoPoint(asset);
    let note = 'Filled in from where the photo was taken. Check that it marks the cleanup spot, then confirm.';
    if (!point && source === 'camera' && Platform.OS !== 'web') {
      point = await currentPoint().catch(() => null);
      note = 'Filled in from your current location. Check that it marks the cleanup spot, then confirm.';
    }
    if (!point || stale()) return;
    const placeName = await placeNameFor(point);
    if (stale()) return;
    setLocation({ latitude: formatCoordinate(point.latitude), longitude: formatCoordinate(point.longitude), placeName });
    setLocationConfirmed(false);
    setLocationNote(note);
  };

  const changePhoto = (next: ImagePickerAsset | null, source?: PhotoSource) => {
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
    if (!dirty.current.has('title')) setTitle('');
    if (!dirty.current.has('description')) setDescription('');
    if (!dirty.current.has('categories')) setSelectedTags([]);
    if (!dirty.current.has('hazards')) setSelectedHazards([]);
    if (!dirty.current.has('volume')) setVolume({ low: '', high: '' });
    if (!locationTouched.current) {
      setLocation(emptyLocation);
      setLocationConfirmed(false);
      setLocationNote(null);
    }
    if (next) {
      void preparePhoto(next, version, upload);
      void fillLocation(next, source, version);
    }
  };

  const toggleHazard = (code: string) => {
    edit('hazards');
    if (selectedHazards.includes(code)) {
      setSelectedHazards((current) => current.filter((item) => item !== code));
    } else if (!tags?.hazards.find((hazard) => hazard.code === code)?.requiresDropoff) {
      setConfirmed(false);
      setSelectedHazards((current) => [...new Set([...current, code])]);
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

  const skipAnalysis = () => {
    skippedAnalysis.current = photoVersion.current;
    setPhotoStatus('ready');
    setPhotoMessage('Photo uploaded. Fill in and confirm the report yourself.');
  };

  const point = parseLocation(location.latitude, location.longitude);
  const amount = parseVolume(volume.low, volume.high);
  const detailsValid = title.trim().length >= 3 && description.trim().length > 0 &&
    selectedTags.length > 0 && amount !== null && !!tags &&
    selectedTags.every((code) => tags.categories.some((tag) => tag.code === code)) &&
    selectedHazards.every((code) => tags.hazards.some((tag) => tag.code === code));
  const photoReady = !!fileId && photoStatus === 'ready';
  const locationValid = !!point && !!location.placeName.trim() && !locationBusy;
  const steps = [
    photoReady,
    detailsValid && confirmed && pendingHazards.length === 0,
    locationValid && locationConfirmed,
    !scheduleParty || isValidSchedule(schedule),
  ];
  const completedSteps = steps.filter(Boolean).length;
  const ready = completedSteps === 4;

  // Why the details confirmation is disabled, checked in the order the form is filled in.
  const detailsHint = !photo ? 'Add a before photo first.'
    : photoStatus === 'error' ? 'Retry the photo upload first.'
    : photoStatus === 'analyzing' ? 'Waiting for AI suggestions. You can also continue without them.'
    : !photoReady ? 'Waiting for the photo to upload.'
    : title.trim().length < 3 ? 'Add a quest title of at least 3 characters.'
    : !description.trim() ? 'Describe the litter and the spot.'
    : selectedTags.length === 0 ? 'Pick at least one trash category.'
    : amount === null ? 'Fix the trash amount, or leave both fields blank.'
    : pendingHazards.length > 0 ? 'Answer the safety warning first.'
    : null;
  const locationHint = locationBusy ? null
    : !point ? 'Add valid coordinates first.'
    : !location.placeName.trim() ? 'Add a place name or address.'
    : null;
  const nextStepHint = saved && !steps[3] ? 'Fix the party time, or turn off scheduling.'
    : !steps[0] ? 'Next: add a before photo.'
    : !steps[1] ? 'Next: finish and confirm the quest details.'
    : !steps[2] ? 'Next: pin the spot and confirm it.'
    : !steps[3] ? 'Next: fix the party time, or turn off scheduling.'
    : null;

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
    dirty.current.clear();
    locationTouched.current = false;
    changePhoto(null);
    progress.current = {};
    setTitle(''); setDescription(''); setSelectedTags([]); setSelectedHazards([]);
    setVolume({ low: '', high: '' }); setLocation(emptyLocation); setLocationConfirmed(false); setConfirmed(false);
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
      <FormButton label="Open the quests map" onPress={() => router.navigate('/events')} />
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
          <PhotoStep photo={photo} status={photoStatus} message={photoMessage} onPhotoChange={changePhoto}
            onRetry={() => { if (photo) void preparePhoto(photo, photoVersion.current, photoProgress.current); }}
            onSkipAnalysis={skipAnalysis} />
          {tags ? <QuestDetailsStep title={title} description={description} tags={tags} done={steps[1]}
            volumeLow={volume.low} volumeHigh={volume.high} selectedTags={selectedTags} selectedSafetyFlags={selectedHazards}
            onTitleChange={(value) => { edit('title'); setTitle(value); }}
            onDescriptionChange={(value) => { edit('description'); setDescription(value); }}
            onVolumeChange={(low, high) => { edit('volume'); setVolume({ low, high }); }}
            onTagPress={(code) => { edit('categories'); setSelectedTags((current) =>
              current.includes(code) ? current.filter((item) => item !== code) : [...current, code]); }}
            onSafetyFlagPress={toggleHazard}>
            <ConfirmCheck label="I reviewed the description, trash categories, hazards and amount." checked={confirmed}
              disabled={!photoReady || !detailsValid || pendingHazards.length > 0} hint={detailsHint}
              onPress={() => setConfirmed(!confirmed)} />
          </QuestDetailsStep> : tagsError ? (
              <AppCard><ThemedText>Could not load report categories and hazards.</ThemedText>
                <FormButton label="Retry loading categories" onPress={() => { setTagsError(false); void loadTags(); }} /></AppCard>
            ) : <ActivityIndicator color={theme.tint} />}
          <LocationStep value={location} onBusyChange={setLocationBusy} done={steps[2]} note={locationNote}
            onChange={(value) => {
              locationTouched.current = true;
              setLocation(value); setLocationConfirmed(false); setLocationNote(null);
            }}>
            <ConfirmCheck label="These coordinates mark the cleanup spot." checked={locationConfirmed}
              disabled={!locationValid} hint={locationHint} onPress={() => setLocationConfirmed(!locationConfirmed)} />
          </LocationStep>
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
          <ScheduleStep enabled={scheduleParty} onEnabledChange={setScheduleParty} disabled={busy} done={steps[3]}
            value={schedule} onChange={setSchedule} />
        </View>
        <QuestReward />
        {error ? <ThemedText themeColor="error" accessibilityRole="alert">{error}</ThemedText> : null}
        <CreateQuestButton ready={ready} busy={busy} hint={nextStepHint}
          label={busy ? 'Saving...' : duplicateReview && scheduleParty ? 'Schedule party on this quest' : saved ? 'Finish creating quest' : 'Create quest'}
          onPress={() => void createQuest()} />
      </ScreenLayout>
      <SafetyWarningModal flag={tags?.hazards.find((flag) => flag.code === pendingHazards[0])}
        onCancel={() => answerHazard(false)} onConfirm={() => answerHazard(true)} />
    </>
  );
}

const styles = StyleSheet.create({
  section: { gap: 16 },
});
