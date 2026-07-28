import Constants from 'expo-constants';
import * as Haptics from 'expo-haptics';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CloudAlertIcon, CloudCheckIcon, CloudIcon } from '../src/components/icons';
import { BOARDS } from '../src/data/boards';
import { exportBackupFile, pickBackupFile } from '../src/lib/backupFile';
import {
  applyEnvelope,
  clearUndoSnapshot,
  currentBackupState,
  fingerprint,
  undoRestore,
  undoSnapshotExists,
} from '../src/lib/backupRestore';
import { parseBackup, summarize } from '../src/lib/backupSchema';
import { requestBackup } from '../src/lib/backupScheduler';
import { BackupError } from '../src/lib/cloudBackup';
import { VoicePicker } from '../src/components/VoicePicker';
import { isSupported as isFocusGuardSupported } from '../src/lib/focusGuard/camera';
import { previewVoice } from '../src/lib/focusGuard/voice/player';
import { geminiKeyPool } from '../src/lib/gemini';
import { generatePlan, maintainPlan } from '../src/lib/planEngine';
import { isCloudConfigured } from '../src/lib/supabase';
import type { ClassLevel, StudyGroup } from '../src/lib/types';
import { useAppStore } from '../src/store/useAppStore';
import { deviceLabel, useCloudStore } from '../src/store/useCloudStore';
import { color, font, radius, space, type } from '../src/theme/tokens';

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const profile = useAppStore((s) => s.profile);
  const setProfile = useAppStore((s) => s.setProfile);
  const plan = useAppStore((s) => s.plan);
  const setPlan = useAppStore((s) => s.setPlan);
  const vibrationEnabled = useAppStore((s) => s.vibrationEnabled !== false);
  const toggleVibration = useAppStore((s) => s.toggleVibration);
  const focusGuardEnabled = useAppStore((s) => s.focusGuardEnabled);
  const toggleFocusGuard = useAppStore((s) => s.toggleFocusGuard);
  const focusVoiceEnabled = useAppStore((s) => s.focusVoiceEnabled);
  const toggleFocusVoice = useAppStore((s) => s.toggleFocusVoice);
  const focusVoiceId = useAppStore((s) => s.focusVoiceId);
  const setFocusVoiceId = useAppStore((s) => s.setFocusVoiceId);
  const quizAttempts = useAppStore((s) => s.quizAttempts);
  const flashcards = useAppStore((s) => s.flashcards);
  const chatHistory = useAppStore((s) => s.chatHistory);
  const clearChat = useAppStore((s) => s.clearChat);
  const resetAll = useAppStore((s) => s.resetAll);

  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(profile?.name ?? '');
  const [showBoardModal, setShowBoardModal] = useState(false);
  const [profileNotice, setProfileNotice] = useState<string | null>(null);
  const [repairNotice, setRepairNotice] = useState<string | null>(null);
  const [chatClearedNotice, setChatClearedNotice] = useState(false);

  // ---- cloud backup ----
  const cloudSession = useCloudStore((s) => s.session);
  const cloudAuto = useCloudStore((s) => s.autoBackup);
  const cloudLastAt = useCloudStore((s) => s.lastBackupAt);
  const cloudError = useCloudStore((s) => s.lastError);
  const cloudStatus = useCloudStore((s) => s.status);
  const cloudConflict = useCloudStore((s) => s.conflict);
  const cloudDeviceId = useCloudStore((s) => s.deviceId);
  const undoAvailableAt = useCloudStore((s) => s.undoAvailableAt);
  const disarmCloud = useCloudStore((s) => s.disarm);

  const [backupNotice, setBackupNotice] = useState<string | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [fileBusy, setFileBusy] = useState(false);
  const [undoPresent, setUndoPresent] = useState(false);

  const cloudConfigured = isCloudConfigured();

  // The store flag can outlive the on-disk snapshot (e.g. app data cleared), so
  // confirm the file is really there before offering Undo.
  useEffect(() => {
    let alive = true;
    void undoSnapshotExists().then((exists) => {
      if (alive) setUndoPresent(exists);
    });
    return () => {
      alive = false;
    };
  }, [undoAvailableAt]);

  const flashBackup = (msg: string) => {
    setBackupError(null);
    setBackupNotice(msg);
    setTimeout(() => setBackupNotice(null), 4000);
  };

  const failBackup = (e: unknown) => {
    setBackupNotice(null);
    setBackupError(e instanceof BackupError ? e.message : 'Something went wrong. Try again.');
    setTimeout(() => setBackupError(null), 6000);
  };

  const triggerHapticIfEnabled = () => {
    if (vibrationEnabled) {
      try {
        Haptics.selectionAsync();
      } catch {}
    }
  };

  const handleToggleVibration = () => {
    toggleVibration();
    if (!vibrationEnabled) {
      try {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {}
    }
  };

  // 1. Save Student Name
  const handleSaveName = () => {
    if (!profile || !nameInput.trim()) return;
    triggerHapticIfEnabled();
    const newProfile = { ...profile, name: nameInput.trim() };
    setProfile(newProfile);
    setEditingName(false);
    setProfileNotice('Student name updated!');
    setTimeout(() => setProfileNotice(null), 3000);
  };

  /**
   * Switching class or group necessarily rebuilds the plan — the two syllabi
   * share almost no chapter IDs, so completed work cannot carry across. That
   * makes it a genuinely destructive action, and it used to fire on a single
   * tap with no warning: one stray tap during judging erased every completed
   * session. Confirm first, naming exactly what is lost, using the same
   * Alert/window.confirm pattern as Erase All Data.
   */
  const confirmRegenerate = (what: string, apply: () => void) => {
    const doneCount = plan ? plan.sessions.filter((s) => s.done).length : 0;
    if (doneCount === 0) {
      apply();
      return;
    }
    const body =
      `Changing your ${what} rebuilds the study plan from the new syllabus. ` +
      `${doneCount} completed session${doneCount === 1 ? '' : 's'} will be cleared, ` +
      'and your readiness score resets.';
    if (Platform.OS === 'web') {
      if (window.confirm(body)) apply();
      return;
    }
    Alert.alert('Rebuild your plan?', body, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Rebuild plan', style: 'destructive', onPress: apply },
    ]);
  };

  // 2. Change Class Level (9 vs 10) — updates store & regenerates study plan
  const handleSelectClass = (newClass: ClassLevel) => {
    if (!profile || profile.classLevel === newClass) return;
    triggerHapticIfEnabled();
    confirmRegenerate('class level', () => {
      const newProfile = { ...profile, classLevel: newClass };
      setProfile(newProfile);
      // Re-run plan generator so the calendar plan uses the new class's syllabus dataset
      setPlan(generatePlan(newProfile));
      setProfileNotice(`Switched to Class ${newClass}! Study plan & subjects regenerated.`);
      setTimeout(() => setProfileNotice(null), 3500);
    });
  };

  // 3. Change Study Group (Bio vs CS vs Arts) — updates store & regenerates study plan
  const handleSelectGroup = (newGroup: StudyGroup) => {
    if (!profile || profile.group === newGroup) return;
    triggerHapticIfEnabled();
    confirmRegenerate('study group', () => {
      const newProfile = { ...profile, group: newGroup };
      setProfile(newProfile);
      // Re-run plan generator so the calendar plan uses the new group's subject list
      setPlan(generatePlan(newProfile));
      const label =
        newGroup === 'science-bio'
          ? 'Biology'
          : newGroup === 'science-cs'
          ? 'Computer Science'
          : 'Arts';
      setProfileNotice(`Switched to ${label} group! Study plan & subjects regenerated.`);
      setTimeout(() => setProfileNotice(null), 3500);
    });
  };

  // 4. Change BISE Board — updates store & Ustaad AI context
  const handleSelectBoard = (newBoardId: string) => {
    if (!profile || profile.boardId === newBoardId) return;
    triggerHapticIfEnabled();
    const newProfile = { ...profile, boardId: newBoardId };
    setProfile(newProfile);
    setShowBoardModal(false);
    const bName = BOARDS.find((b) => b.id === newBoardId)?.name ?? newBoardId;
    setProfileNotice(`Board updated to ${bName}! Ustaad AI context updated.`);
    setTimeout(() => setProfileNotice(null), 3500);
  };

  const handleRepairPlan = () => {
    if (!plan || !profile) return;
    triggerHapticIfEnabled();
    const repaired = maintainPlan(plan, profile);
    setPlan(repaired);
    setRepairNotice('Plan re-balanced for upcoming days!');
    setTimeout(() => setRepairNotice(null), 3000);
  };

  const handleClearChat = () => {
    triggerHapticIfEnabled();
    clearChat();
    setChatClearedNotice(true);
    setTimeout(() => setChatClearedNotice(false), 3000);
  };

  const handleResetAll = () => {
    const doReset = () => {
      // Stop this device uploading its now-empty state over a good cloud backup.
      disarmCloud('local data erased');
      resetAll();
      router.replace('/onboarding');
    };
    const body =
      'This erases your profile, plan, quiz history, and flashcards on this device. Your cloud backup is not deleted.';
    if (Platform.OS === 'web') {
      if (window.confirm(body)) {
        doReset();
      }
      return;
    }
    Alert.alert('Start over?', body, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Erase everything', style: 'destructive', onPress: doReset },
    ]);
  };

  // Fixed for the lifetime of the build — the pool is resolved from inlined
  // env values at module load, so there is nothing to subscribe to.
  const keyPool = geminiKeyPool();

  // False on web, and false on a dev client built before the camera modules
  // were added — the toggle disables itself rather than promising something
  // this build cannot deliver.
  const focusGuardSupported = isFocusGuardSupported();

  const handleToggleFocusGuard = () => {
    triggerHapticIfEnabled();
    toggleFocusGuard();
  };

  const handleToggleFocusVoice = () => {
    triggerHapticIfEnabled();
    toggleFocusVoice();
  };

  const handleSelectVoice = (id: string) => {
    triggerHapticIfEnabled();
    setFocusVoiceId(id);
  };

  const backupMeta = () => ({
    appVersion: Constants.expoConfig?.version ?? '',
    platform: Platform.OS,
    deviceLabel: deviceLabel(Platform.OS, cloudDeviceId),
  });

  const handleBackupNow = async () => {
    triggerHapticIfEnabled();
    try {
      await requestBackup('manual');
      flashBackup('Backed up to the cloud.');
    } catch (e) {
      failBackup(e);
    }
  };

  const handleExportFile = async () => {
    if (fileBusy) return;
    triggerHapticIfEnabled();
    setFileBusy(true);
    try {
      const outcome = await exportBackupFile(currentBackupState(), backupMeta());
      flashBackup(
        outcome.via === 'download'
          ? `Downloaded ${outcome.fileName}`
          : outcome.via === 'share-sheet'
            ? `Backup file ready: ${outcome.fileName}`
            : `Saved ${outcome.fileName} to this device.`,
      );
    } catch (e) {
      if (e instanceof BackupError && e.kind === 'cancelled') return;
      failBackup(e);
    } finally {
      setFileBusy(false);
    }
  };

  const applyImported = async (raw: string) => {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      failBackup(new BackupError("That file isn't valid JSON.", 'corrupt'));
      return;
    }

    const parsed = parseBackup(json);
    if (!parsed.ok) {
      failBackup(new BackupError(parsed.error.message, parsed.error.kind));
      return;
    }

    const summary = summarize(parsed.envelope);
    const warnLine = parsed.warnings.length > 0 ? `\n\nNote: ${parsed.warnings.join(' ')}` : '';
    const message = `Replace this device's data with this backup?\n\n${summary}${warnLine}\n\nYou can undo straight afterwards.`;

    const run = async () => {
      try {
        const result = await applyEnvelope(parsed.envelope);
        const bits = ['Backup restored from file.'];
        if (result.planRepaired) bits.push('Missed sessions were moved forward.');
        if (parsed.warnings.length > 0) bits.push(parsed.warnings.join(' '));
        flashBackup(bits.join(' '));
        setUndoPresent(result.undoSaved);
        setTimeout(() => router.replace('/(tabs)/today'), 900);
      } catch (e) {
        failBackup(e);
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm(message)) await run();
      return;
    }
    Alert.alert('Restore this backup?', message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Restore', style: 'destructive', onPress: () => void run() },
    ]);
  };

  const handleImportFile = async () => {
    if (fileBusy) return;
    triggerHapticIfEnabled();
    setFileBusy(true);
    try {
      const raw = await pickBackupFile();
      await applyImported(raw);
    } catch (e) {
      if (e instanceof BackupError && e.kind === 'cancelled') return;
      failBackup(e);
    } finally {
      setFileBusy(false);
    }
  };

  const handleUndoRestore = async () => {
    triggerHapticIfEnabled();
    try {
      await undoRestore();
      setUndoPresent(false);
      flashBackup('Restore undone — this device is back to how it was.');
      setTimeout(() => router.replace('/(tabs)/today'), 900);
    } catch (e) {
      setUndoPresent(false);
      failBackup(e instanceof Error ? new BackupError(e.message, 'corrupt') : e);
    }
  };

  const handleDiscardUndo = async () => {
    triggerHapticIfEnabled();
    await clearUndoSnapshot();
    setUndoPresent(false);
    flashBackup('Undo copy cleared.');
  };

  /** One-line description of where cloud backup stands right now. */
  const cloudStatusLine = (): string => {
    if (!cloudConfigured) return 'Not available in this build';
    if (!cloudSession) return 'Not signed in';
    if (cloudConflict) return 'Needs your attention';
    if (cloudStatus === 'uploading') return 'Backing up…';
    if (cloudError) return cloudError.message;
    if (!cloudLastAt) return 'Signed in — not backed up yet';
    const mins = Math.round((Date.now() - new Date(cloudLastAt).getTime()) / 60_000);
    if (mins < 1) return 'Backed up just now';
    if (mins < 60) return `Backed up ${mins} min ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `Backed up ${hrs} hour${hrs === 1 ? '' : 's'} ago`;
    const days = Math.round(hrs / 24);
    return `Backed up ${days} day${days === 1 ? '' : 's'} ago`;
  };

  const CloudStatusIcon = cloudConflict || cloudError ? CloudAlertIcon : cloudLastAt ? CloudCheckIcon : CloudIcon;

  const boardName = profile
    ? BOARDS.find((b) => b.id === profile.boardId)?.name ?? profile.boardId
    : 'Punjab Board';

  const handleClose = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/progress' as any);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + space.md }]}>
      <Stack.Screen options={{ animation: 'slide_from_bottom' }} />

      {/* Top Bar */}
      <View style={styles.topBar}>
        <Pressable onPress={handleClose} hitSlop={12}>
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.topUrdu}>ترتیبات</Text>
          <Text style={styles.topTitle}>Settings</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={FadeInDown.duration(350)}>
          {/* Section 1: App Preferences */}
          <Text style={styles.sectionLabel}>PREFERENCES — ترجیحات</Text>

          <View style={styles.card}>
            <View style={styles.settingRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.settingTitle}>Vibration & Haptics</Text>
                <Text style={styles.settingSub}>
                  Tactile haptic feedback on button taps, quiz answers, and study session actions
                </Text>
              </View>
              <Pressable
                style={[
                  styles.toggleTrack,
                  vibrationEnabled ? styles.toggleTrackOn : styles.toggleTrackOff,
                ]}
                onPress={handleToggleVibration}
              >
                <View
                  style={[
                    styles.toggleThumb,
                    vibrationEnabled ? styles.toggleThumbOn : styles.toggleThumbOff,
                  ]}
                />
              </Pressable>
            </View>

            <View style={styles.divider} />

            {/* Focus Guard. Default off, and the explainer below is deliberately
                specific: a camera pointed at a student is a serious thing to ask
                for, so the ask states exactly what is and is not captured. */}
            <View style={styles.settingRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.settingTitle}>Focus Guard</Text>
                <Text style={styles.settingSub}>
                  Uses the front camera during study sessions to notice when you
                  step away or lose focus, and pauses the timer while you&apos;re gone.
                </Text>
              </View>
              <Pressable
                style={[
                  styles.toggleTrack,
                  focusGuardEnabled ? styles.toggleTrackOn : styles.toggleTrackOff,
                ]}
                onPress={handleToggleFocusGuard}
                disabled={!focusGuardSupported}
              >
                <View
                  style={[
                    styles.toggleThumb,
                    focusGuardEnabled ? styles.toggleThumbOn : styles.toggleThumbOff,
                  ]}
                />
              </Pressable>
            </View>

            {/* Voice is its own opt-in, not a sub-setting of Focus Guard: a
                phone that starts talking in a room shared with family is a
                different kind of consent from a camera that stays silent. */}
            {focusGuardSupported && focusGuardEnabled && (
              <View style={styles.settingRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.settingTitle}>Spoken cues</Text>
                  <Text style={styles.settingSub}>
                    Says a short line out loud when setting up, when you step away,
                    and if you look sleepy — the moments you aren&apos;t reading the screen.
                  </Text>
                </View>
                <Pressable
                  style={[
                    styles.toggleTrack,
                    focusVoiceEnabled ? styles.toggleTrackOn : styles.toggleTrackOff,
                  ]}
                  onPress={handleToggleFocusVoice}
                >
                  <View
                    style={[
                      styles.toggleThumb,
                      focusVoiceEnabled ? styles.toggleThumbOn : styles.toggleThumbOff,
                    ]}
                  />
                </Pressable>
              </View>
            )}

            {focusGuardSupported && focusGuardEnabled && focusVoiceEnabled && (
              <Animated.View entering={FadeInDown.duration(260)} style={styles.voiceBlock}>
                <Text style={styles.voiceHeading}>CHOOSE A VOICE — آواز</Text>
                <VoicePicker
                  selectedId={focusVoiceId}
                  onSelect={handleSelectVoice}
                  onPreview={previewVoice}
                />
              </Animated.View>
            )}

            <View style={styles.noticeBox}>
              <Text style={styles.noticeText}>
                {focusGuardSupported
                  ? 'Everything happens on this phone. No photo or video is ever saved, ' +
                    'and nothing leaves the device — Manzil only keeps a few numbers ' +
                    'about head position. Turn it off any time, including mid-session.'
                  : 'Focus Guard needs the phone app with camera support — it can’t run here.'}
              </Text>
            </View>
          </View>

          {/* Section 2: About Developer */}
          <Text style={styles.sectionLabel}>ABOUT DEVELOPER — ڈویلپر کا تعارف</Text>
          <View style={styles.card}>
            <View style={styles.devHeader}>
              <View style={styles.devHeaderMain}>
                <View style={styles.devTitleRow}>
                  <Text style={styles.devNameEng}>Bilal Murtaza</Text>
                  <Text style={styles.devNameUrdu}>بلال مرتضیٰ</Text>
                </View>
                <View style={styles.devBadge}>
                  <Text style={styles.devBadgeText}>Creator & Lead Architect of Manzil</Text>
                </View>
              </View>
            </View>

            <View style={styles.divider} />

            <Text style={styles.bioText}>
              From childhood, I have been deeply fascinated by computers and software. I've always
              loved diving deep into these machines — understanding how they work, how they are
              engineered from the ground up, and spending my free time exploring, learning, and
              creating new technology.
            </Text>
            <Text style={[styles.bioText, { marginTop: 10 }]}>
              Manzil was crafted with that exact passion with the help of AI to give Pakistani
              matriculation students a world-class, offline-first study planner that truly respects
              their syllabus and board pairing scheme.
            </Text>
          </View>

          {/* Section 3: Study Profile */}
          {profile && (
            <>
              <Text style={styles.sectionLabel}>STUDY PROFILE — تعلیمی خاکہ</Text>
              <View style={styles.card}>
                {profileNotice && (
                  <Animated.View entering={FadeInDown.duration(250)} style={styles.noticeBox}>
                    <Text style={styles.noticeText}>✓ {profileNotice}</Text>
                  </Animated.View>
                )}

                {/* 1. Student Name */}
                <View style={styles.editRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.infoLabel}>Student Name</Text>
                    {editingName ? (
                      <View style={styles.inlineInputRow}>
                        <TextInput
                          style={styles.nameTextInput}
                          value={nameInput}
                          onChangeText={setNameInput}
                          autoFocus
                          placeholder="Your Name"
                          placeholderTextColor={color.inkFaint}
                        />
                        <Pressable style={styles.saveBtn} onPress={handleSaveName}>
                          <Text style={styles.saveBtnText}>Save</Text>
                        </Pressable>
                      </View>
                    ) : (
                      <Text style={styles.infoValue}>{profile.name}</Text>
                    )}
                  </View>
                  {!editingName && (
                    <Pressable
                      style={styles.editPill}
                      onPress={() => {
                        setNameInput(profile.name);
                        setEditingName(true);
                      }}
                    >
                      <Text style={styles.editPillText}>Edit</Text>
                    </Pressable>
                  )}
                </View>

                {/* 2. Class Level */}
                <View style={styles.editRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.infoLabel}>Class Level</Text>
                    <View style={styles.segmentedRow}>
                      {(['9', '10'] as ClassLevel[]).map((cls) => {
                        const active = profile.classLevel === cls;
                        return (
                          <Pressable
                            key={cls}
                            style={[styles.segTab, active && styles.segTabActive]}
                            onPress={() => handleSelectClass(cls)}
                          >
                            <Text style={[styles.segTabText, active && styles.segTabTextActive]}>
                              Class {cls}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                </View>

                {/* 3. Study Group */}
                <View style={styles.editRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.infoLabel}>Study Group</Text>
                    <View style={styles.segmentedRow}>
                      {[
                        { id: 'science-bio', label: 'Bio Science' },
                        { id: 'science-cs', label: 'CS Science' },
                        { id: 'arts', label: 'Arts' },
                      ].map((g) => {
                        const active = profile.group === g.id;
                        return (
                          <Pressable
                            key={g.id}
                            style={[styles.segTab, active && styles.segTabActive]}
                            onPress={() => handleSelectGroup(g.id as StudyGroup)}
                          >
                            <Text style={[styles.segTabText, active && styles.segTabTextActive]}>
                              {g.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                </View>

                {/* 4. BISE Board */}
                <View style={styles.editRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.infoLabel}>BISE Board</Text>
                    <Text style={styles.infoValue}>{boardName}</Text>
                  </View>
                  <Pressable
                    style={styles.editPill}
                    onPress={() => setShowBoardModal(!showBoardModal)}
                  >
                    <Text style={styles.editPillText}>
                      {showBoardModal ? 'Close' : 'Change Board'}
                    </Text>
                  </Pressable>
                </View>

                {/* Expanded Board Selector */}
                {showBoardModal && (
                  <Animated.View entering={FadeInDown.duration(250)} style={styles.boardGrid}>
                    <Text style={styles.boardGridTitle}>Select your Punjab BISE Board:</Text>
                    {BOARDS.filter((b) => b.available).map((b) => {
                      const selected = profile.boardId === b.id;
                      return (
                        <Pressable
                          key={b.id}
                          style={[styles.boardOption, selected && styles.boardOptionSelected]}
                          onPress={() => handleSelectBoard(b.id)}
                        >
                          <Text
                            style={[styles.boardOptionText, selected && styles.boardOptionTextSelected]}
                          >
                            {b.name} ({b.city})
                          </Text>
                          {selected && <Text style={styles.boardCheckMark}>✓</Text>}
                        </Pressable>
                      );
                    })}
                  </Animated.View>
                )}

                {/* 5. Exam Start Date */}
                <View style={[styles.editRow, { borderBottomWidth: 0 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.infoLabel}>Exam Start Date</Text>
                    <Text style={styles.infoValue}>{profile.examDate}</Text>
                  </View>
                </View>

                {repairNotice && (
                  <View style={styles.noticeBox}>
                    <Text style={styles.noticeText}>{repairNotice}</Text>
                  </View>
                )}

                <Pressable style={styles.actionRowBtn} onPress={handleRepairPlan}>
                  <Text style={styles.actionRowText}>↻ Re-balance missed study sessions</Text>
                </Pressable>
              </View>
            </>
          )}

          {/* Section 3.5: Cloud Backup */}
          <Text style={styles.sectionLabel}>CLOUD BACKUP — کلاؤڈ بیک اپ</Text>
          <View style={styles.card}>
            <View style={styles.settingRow}>
              <CloudStatusIcon
                size={22}
                color={cloudConflict || cloudError ? color.rust : cloudLastAt ? color.greenMid : color.inkFaint}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.settingTitle}>
                  {cloudSession ? 'Your progress is protected' : 'Protect your progress'}
                </Text>
                <Text style={styles.settingSub}>{cloudStatusLine()}</Text>
              </View>
            </View>

            {cloudSession && (
              <>
                <View style={styles.divider} />
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Account</Text>
                  <Text style={styles.infoValue}>{cloudSession.email}</Text>
                </View>
                <View style={[styles.infoRow, { borderBottomWidth: 0 }]}>
                  <Text style={styles.infoLabel}>Automatic backup</Text>
                  <Text style={styles.infoValue}>{cloudAuto === 'armed' ? 'On' : 'Off'}</Text>
                </View>
              </>
            )}

            {backupNotice && (
              <View style={styles.noticeBox}>
                <Text style={styles.noticeText}>{backupNotice}</Text>
              </View>
            )}
            {backupError && (
              <View style={[styles.noticeBox, styles.noticeBoxError]}>
                <Text style={[styles.noticeText, styles.noticeTextError]}>{backupError}</Text>
              </View>
            )}

            {!cloudConfigured && (
              <View style={styles.noticeBox}>
                <Text style={styles.noticeText}>
                  Cloud backup isn&apos;t set up in this build — use Export below to save a backup file.
                </Text>
              </View>
            )}

            {cloudConfigured && (
              <>
                {cloudSession && cloudAuto === 'armed' && !cloudConflict && (
                  <Pressable style={styles.actionRowBtn} onPress={() => void handleBackupNow()}>
                    <Text style={styles.actionRowText}>↑ Back up now</Text>
                  </Pressable>
                )}
                <Pressable style={styles.actionRowBtn} onPress={() => router.push('/cloud')}>
                  <Text style={styles.actionRowText}>
                    {cloudSession ? 'Manage backup & restore →' : '☁ Set up cloud backup'}
                  </Text>
                </Pressable>
              </>
            )}
          </View>

          {/* Section 4: Data & Storage */}
          <Text style={styles.sectionLabel}>DATA & STORAGE — ڈیٹا اور ذخیرہ</Text>
          <View style={styles.card}>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Quizzes Attempted</Text>
              <Text style={styles.infoValue}>{quizAttempts.length}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Flashcards Created</Text>
              <Text style={styles.infoValue}>{flashcards.length}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Ustaad Messages</Text>
              <Text style={styles.infoValue}>{chatHistory.length}</Text>
            </View>
            {/* Key slots are inlined at build time, so a key that was added to
                .env or the expo.dev secrets but never picked up would otherwise
                be completely invisible — it would simply never get used. This
                row is how you can tell the difference. */}
            <View style={[styles.infoRow, { borderBottomWidth: 0 }]}>
              <Text style={styles.infoLabel}>Ustaad AI Keys</Text>
              <Text style={styles.infoValue}>
                {keyPool.total === 0
                  ? 'None configured'
                  : `${keyPool.total} ${keyPool.total === 1 ? 'key' : 'keys'}`}
              </Text>
            </View>

            {chatClearedNotice && (
              <View style={styles.noticeBox}>
                <Text style={styles.noticeText}>Ustaad chat history cleared!</Text>
              </View>
            )}

            {chatHistory.length > 0 && (
              <Pressable style={styles.actionRowBtn} onPress={handleClearChat}>
                <Text style={styles.actionRowText}>🗑 Clear Ustaad chat history</Text>
              </Pressable>
            )}

            {/* Backup files work with no account and no network — this pair is the
                floor beneath every other backup path and is never gated. */}
            <Pressable
              style={[styles.actionRowBtn, fileBusy && { opacity: 0.6 }]}
              onPress={() => void handleExportFile()}
              disabled={fileBusy}
            >
              <Text style={styles.actionRowText}>⤓ Export backup file</Text>
            </Pressable>
            <Pressable
              style={[styles.actionRowBtn, fileBusy && { opacity: 0.6 }]}
              onPress={() => void handleImportFile()}
              disabled={fileBusy}
            >
              <Text style={styles.actionRowText}>⤒ Import backup file</Text>
            </Pressable>

            {undoPresent && (
              <>
                <View style={styles.divider} />
                <Text style={styles.settingSub}>
                  A copy of this device&apos;s data from just before the last restore is still saved.
                </Text>
                <Pressable style={styles.actionRowBtn} onPress={() => void handleUndoRestore()}>
                  <Text style={styles.actionRowText}>↩ Undo restore</Text>
                </Pressable>
                <Pressable style={styles.actionRowBtn} onPress={() => void handleDiscardUndo()}>
                  <Text style={styles.actionRowText}>Discard undo copy</Text>
                </Pressable>
              </>
            )}
          </View>

          {/* Section 5: Reset */}
          <View style={{ marginTop: space.lg }}>
            <Pressable style={styles.resetCardBtn} onPress={handleResetAll}>
              <Text style={styles.resetCardText}>Erase All Data & Re-Onboard</Text>
            </Pressable>
          </View>

          {/* Footer App Info */}
          <View style={styles.appFooter}>
            <Text style={styles.appTitle}>Manzil · منزل</Text>
            <Text style={styles.appVersion}>Version 1.0.0 · Contest Edition</Text>
            <Text style={styles.appSub}>100% Offline Plan Engine · Punjab BISE Board Aligned</Text>
            {/* Required by the ElevenLabs free-tier terms the voice pack was
                generated under. Regenerating with another vendor means editing
                this line and re-running scripts/generate-voice.ts. */}
            <Text style={styles.appSub}>Focus Guard voice by ElevenLabs · elevenlabs.io</Text>
          </View>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.paper },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: space.xl,
    paddingBottom: space.md,
  },
  closeText: { fontSize: 20, color: color.inkSoft, fontFamily: font.medium },
  topUrdu: {
    fontFamily: font.urdu,
    fontSize: 12,
    lineHeight: 28,
    color: color.greenMid,
  },
  topTitle: { ...type.heading, fontSize: 18, color: color.ink, marginTop: -4 },

  scrollContent: { paddingHorizontal: space.xl, paddingBottom: 40 },

  sectionLabel: {
    fontFamily: font.semibold,
    fontSize: 10,
    letterSpacing: 1.2,
    color: color.greenMid,
    textTransform: 'uppercase',
    marginTop: space.lg,
    marginBottom: space.sm,
  },

  card: {
    backgroundColor: color.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    padding: space.lg,
  },

  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  settingTitle: { fontFamily: font.semibold, fontSize: 15, color: color.ink },
  settingSub: { ...type.small, color: color.inkSoft, marginTop: 3, lineHeight: 18 },

  toggleTrack: {
    width: 50,
    height: 30,
    borderRadius: 15,
    padding: 3,
    justifyContent: 'center',
  },
  toggleTrackOn: { backgroundColor: color.green },
  toggleTrackOff: { backgroundColor: color.lineStrong },

  toggleThumb: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: color.card,
  },
  toggleThumbOn: { alignSelf: 'flex-end' },
  toggleThumbOff: { alignSelf: 'flex-start' },

  devHeader: {
    paddingVertical: 2,
  },
  devHeaderMain: {
    gap: 6,
  },
  devTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  devNameEng: {
    fontFamily: font.bold,
    fontSize: 20,
    letterSpacing: -0.3,
    color: color.ink,
  },
  devNameUrdu: {
    fontFamily: font.urduBold,
    fontSize: 18,
    lineHeight: 34,
    color: color.greenMid,
  },
  devBadge: {
    alignSelf: 'flex-start',
    backgroundColor: color.greenSoft,
    borderRadius: radius.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginTop: 2,
  },
  devBadgeText: {
    fontFamily: font.semibold,
    fontSize: 11,
    color: color.greenDeep,
    letterSpacing: 0.2,
  },

  divider: { height: 1, backgroundColor: color.line, marginVertical: space.md },

  bioText: { ...type.small, color: color.inkSoft, lineHeight: 21 },

  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },

  editRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  infoLabel: { ...type.small, color: color.inkSoft, marginBottom: 4 },
  infoValue: { fontFamily: font.semibold, fontSize: 14, color: color.ink },

  editPill: {
    backgroundColor: color.greenSoft,
    borderRadius: radius.full,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  editPillText: { fontFamily: font.semibold, fontSize: 11, color: color.greenDeep },

  inlineInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  nameTextInput: {
    flex: 1,
    fontFamily: font.semibold,
    fontSize: 14,
    color: color.ink,
    backgroundColor: color.paper,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.green,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  saveBtn: {
    backgroundColor: color.green,
    borderRadius: radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  saveBtnText: { fontFamily: font.semibold, fontSize: 12, color: color.paperOnDark },

  segmentedRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 4,
  },
  segTab: {
    flex: 1,
    backgroundColor: color.paper,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.line,
    paddingVertical: 7,
    alignItems: 'center',
  },
  segTabActive: {
    backgroundColor: color.greenSoft,
    borderColor: color.green,
  },
  segTabText: { fontFamily: font.medium, fontSize: 12, color: color.inkSoft },
  segTabTextActive: { fontFamily: font.bold, fontSize: 12, color: color.greenDeep },

  boardGrid: {
    backgroundColor: color.cardWarm,
    borderRadius: radius.md,
    padding: space.md,
    marginVertical: space.sm,
    gap: 6,
  },
  boardGridTitle: { fontFamily: font.semibold, fontSize: 12, color: color.ink, marginBottom: 4 },
  boardOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: color.card,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.line,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  boardOptionSelected: {
    backgroundColor: color.greenSoft,
    borderColor: color.green,
  },
  boardOptionText: { fontFamily: font.medium, fontSize: 13, color: color.inkSoft },
  boardOptionTextSelected: { fontFamily: font.bold, fontSize: 13, color: color.greenDeep },
  boardCheckMark: { fontFamily: font.bold, fontSize: 14, color: color.green },

  lockBadge: {
    backgroundColor: color.inkWash,
    borderRadius: radius.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  lockBadgeText: { fontFamily: font.medium, fontSize: 11, color: color.paperOnDark },

  actionRowBtn: {
    marginTop: space.md,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: color.cardWarm,
    borderRadius: radius.sm,
  },
  actionRowText: { fontFamily: font.semibold, fontSize: 13, color: color.greenDeep },

  noticeBox: {
    marginBottom: space.sm,
    padding: 10,
    backgroundColor: color.greenSoft,
    borderRadius: radius.sm,
    alignItems: 'center',
  },
  noticeText: { fontFamily: font.semibold, fontSize: 12, color: color.greenDeep, textAlign: 'center' },
  noticeBoxError: { backgroundColor: color.rustSoft },
  noticeTextError: { color: color.rust, lineHeight: 18 },

  resetCardBtn: {
    backgroundColor: color.rustSoft,
    borderWidth: 1,
    borderColor: color.rust,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  resetCardText: { fontFamily: font.semibold, fontSize: 14, color: color.rust },

  appFooter: {
    alignItems: 'center',
    marginTop: space.xxl,
  },
  appTitle: { fontFamily: font.bold, fontSize: 16, color: color.ink },
  appVersion: { ...type.smallMedium, color: color.inkSoft, marginTop: 3 },

  voiceBlock: { marginTop: space.sm },
  voiceHeading: {
    fontFamily: font.semibold,
    fontSize: 11,
    letterSpacing: 1.3,
    textTransform: 'uppercase',
    color: color.inkFaint,
    marginBottom: 2,
  },
  appSub: { ...type.micro, color: color.inkFaint, marginTop: 4 },
});
